# routers/ai.py -- AI API
# ====================================
# Every AI-powered endpoint lives here: the Writing Companion chat (including
# Draft and Enhance modes), Smart Advisor editor passes and revisions, scene
# break suggestions, the Profile Builder companion and its generation tools,
# chapter/scene summaries, plus model listing for the Settings picker.
#
# The shared pipeline for each endpoint:
#   1. Validate the request (non-empty text, API key present, model eligible)
#   2. Build the system prompt from prompts.py
#   3. Call OpenRouter via openrouter.py (which handles timeouts and errors)
#   4. Sanitize the response (em dash removal)
#   5. Return the structured response to the frontend

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.settings_store import load_settings
from app.ai.openrouter import run_completion, run_chat, list_models
from app.ai.providers import ProviderConfig, OPENROUTER, active_provider
from app.ai.sanitizer import sanitize
from app.ai.prompts import (
    build_editor_chat_system_prompt,
    build_editor_pass_system_prompt,
    build_revise_suggestion_system_prompt,
    build_profile_chat_system_prompt,
    generate_usage_preview_prompt,
    generate_quick_overview_prompt,
    trim_trait_prompt,
    audit_importance_prompt,
    generate_section_summary_prompt,
    generate_full_summary_prompt,
    generate_chapter_summary_prompt,
    generate_scene_summary_prompt,
    generate_scene_title_prompt,
    generate_scene_break_suggestions_prompt,
    context_stance_instruction,
    content_mode_instruction,
    EDITOR_PASS_SUBCATEGORIES,
    TEMPERATURE_DEFAULTS,
)
import uuid
from app.utils.scene_parser import split_into_scenes_with_meta, count_hr_breaks
from app.progress_store import record_advisor_run
from app.settings_store import get_rollover_hour
import httpx
import json
import os
import re

router = APIRouter(prefix="/api/ai", tags=["ai"])


# ── Pydantic Models ───────────────────────────────────────────────────────────

class ContextChip(BaseModel):
    """
    A piece of profile context the writer has explicitly attached to an AI request.
    Context chips let AI assistants know about characters, locations, etc.
    without the assistant having implicit access to the whole project.

    Analogy: attaching a character sheet to a game master request.
    You only share what's relevant to the current question.
    """
    type: str    # "character" | "relationship" | "location" | "lore" | etc.
    name: str    # Display name, e.g. "Elara Voss"
    content: str # The profile summary or relevant content to include as context


# ── Profile Generation Models ─────────────────────────────────────────────────

class GenerateUsagePreviewRequest(BaseModel):
    """
    Asks the AI to generate a prose explanation of how this trait's importance
    level affects AI behavior. Shown on demand in the UI, not stored in YAML.
    """
    profile_name:    str
    profile_type:    str
    section_heading: str
    trait:           str
    description:     str
    importance:      str   # core|present|background|contextual|hidden
    model_id: str | None = None


class GenerateUsagePreviewResponse(BaseModel):
    usage_preview: str


class TrimTraitRequest(BaseModel):
    """
    Asks AI to rewrite a wordy/bloated trait description more concisely.
    Triggered when the word count gauge hits Wordy or Bloated.
    """
    profile_name:    str
    profile_type:    str
    section_heading: str
    trait:           str
    description:     str
    importance:      str   # core|present|background|contextual|hidden
    word_count:      int
    model_id: str | None = None


class TrimTraitResponse(BaseModel):
    trimmed: str


class AuditImportanceRequest(BaseModel):
    """
    Sends all trait blocks for a profile to AI, which flags mismatched
    importance levels -- e.g. a 'background' trait that reads like 'core'.
    """
    profile_name:    str
    profile_type:    str
    trait_blocks: list[dict]   # [{trait, description, importance, section_heading}, ...]
    model_id: str | None = None


class AuditImportanceResponse(BaseModel):
    flags: list[dict]   # [{trait, current_importance, suggested_importance, reason}, ...]


class GenerateSectionSummaryRequest(BaseModel):
    """
    Asks the AI to write a compact summary of one profile section.
    The summary lives under the ## AI Summary: heading and is used as AI context.
    """
    profile_name:    str
    profile_type:    str
    section_heading: str
    section_content: str   # The formatted content of the section (trait blocks or plain text)
    model_id: str | None = None


class GenerateSectionSummaryResponse(BaseModel):
    section_summary: str


class GenerateFullSummaryRequest(BaseModel):
    """
    Asks the AI to write a full profile summary synthesizing all sections.
    For character profiles this should be multi-paragraph and reflect trait weights.

    Phase 6 addition: when project_path is provided for a character profile,
    the backend scans profiles/relationships/ for files that mention this
    character and appends their Overview / Current Dynamic sections as extra
    context. The resulting summary can then weave in how this character
    relates to others instead of describing them in isolation.
    """
    profile_name:    str
    profile_type:    str
    profile_content: str   # All sections formatted into a single readable block
    model_id: str | None = None
    # Optional in Phase 6 so older callers still work. When provided AND the
    # profile_type is "character", the endpoint looks up related relationship
    # profiles and passes them as supporting context.
    project_path: str | None = None


class GenerateFullSummaryResponse(BaseModel):
    full_summary: str
    # Phase 6: names of standalone relationship profiles whose snippets were
    # injected into the user message. Empty list when no relationships were
    # found, when the profile isn't a character, or when project_path is
    # missing. Lets the UI show the writer "we folded in: [Name1, Name2]"
    # so the relationship-aware behavior is visible instead of opaque.
    relationship_sources_used: list[str] = []


# ── Phase 6: Chapter Summary Generation (plain Markdown) ────────────────────
# The summary is a single Markdown document saved at
# <project>/summaries/chapters/<chapter-stem>.md. The AI writes the full body
# in one shot (not JSON); backend sanitizes and writes it to disk.

class GenerateChapterSummaryRequest(BaseModel):
    chapter_path: str          # Absolute path to the chapter .md file
    project_path: str          # Absolute path to the project root
    model_id:     str | None = None
    content_mode: str = "general"


class GenerateChapterSummaryResponse(BaseModel):
    content:      str          # The generated Markdown body (as saved on disk)
    filename:     str          # Summary filename inside summaries/chapters/
    model_used:   str


# ── Phase 6: Scene Summary Generation (plain Markdown) ──────────────────────
# Scene summaries are the per-scene version of the chapter summary. Each
# chapter is split on `---` horizontal rules; each resulting scene gets its
# own file under <project>/summaries/scenes/<stem>/scene-NN.md.
#
# Why return the body instead of writing to disk like chapter summaries do:
#   - The selection-based flow opens a preview modal so the writer can edit
#     the summary, pick a slot, or discard it before anything is saved.
#   - The auto-split flow also wants to confirm each overwrite before writing.
#   - Keeping generate separate from save makes both flows clean.

class GenerateSceneSummaryRequest(BaseModel):
    """
    Ask the AI to summarize a single scene. Does NOT write to disk -- the
    frontend decides when (and where) to persist via /api/documents/scene-summary.
    """
    chapter_path: str               # Absolute path -- used only for story context + validation
    project_path: str               # Absolute path to the project root
    scene_text:   str               # The scene body to summarize (sent by the frontend)
    scene_title:  str | None = None # If None, AI generates a short title as a second call
    model_id:     str | None = None
    content_mode: str = "general"


class GenerateSceneSummaryResponse(BaseModel):
    title:      str   # Final title -- either the one the caller passed, or an AI-generated one
    content:    str   # Summary body (sanitized Markdown)
    model_used: str


class SplitChapterScenesRequest(BaseModel):
    """Ask the backend to parse a chapter into scene blocks (no AI call)."""
    chapter_path: str
    project_path: str


class SplitChapterScene(BaseModel):
    """One entry in the split-chapter response."""
    index:         int         # 1-based positional index
    title:         str | None  # Extracted title (heading / bold / italic), or None
    text_preview:  str         # First ~200 chars of the scene, for UI display
    text:          str         # Full scene body (frontend sends this back to generate-scene-summary)
    start:         int         # Character offset in the chapter text
    end:           int


class SplitChapterScenesResponse(BaseModel):
    scenes:   list[SplitChapterScene]
    hr_count: int   # Number of valid HR scene breaks found; 0 triggers the no-HR fallback UI


class ProfileChatMessage(BaseModel):
    role: str     # "user" or "assistant"
    content: str


class ProfileChatRequest(BaseModel):
    """
    One turn of the Profile Builder chat.

    The backend is fully stateless -- the frontend sends the complete
    message history and selected context on every turn.
    Session history lives only in React state.

    behavior_mode controls which system prompt the backend uses.
    Supported values (more added over time):
      "general"          -- open-ended conversation, no specific task
      "interpret_profile" -- AI reads selected context and explains how
                             AI writing tools would use each piece
    """
    profile_name:    str
    profile_type:    str
    profile_content: str              # Full formatted profile text from the frontend
    messages:        list[ProfileChatMessage]
    model_id:        str | None = None
    behavior_mode:   str        = "general"   # Which AI behavior is active
    content_mode:    str        = "general"   # "general" | "mature" | "explicit"
    project_path:    str | None = None        # Project root -- used for story context injection
    # Section labels from the frontend SECTION_CONFIGS -- passed so the backend
    # always uses the current template structure without hardcoding section names.
    # Defaults cover the standard character profile if not provided.
    section_labels:  list[str]  = [
        "Physical Traits", "Personality Traits", "Motivations",
        "Voice Notes", "Hidden and Foreshadowing Traits",
        "Relationships Overview", "Notes",
    ]


class ProfileChatResponse(BaseModel):
    reply: str
    model_used: str = ""  # The resolved model ID so the UI can display it


class ModelInfo(BaseModel):
    id: str
    name: str
    context_length: int
    cost_input_per_million: float
    cost_output_per_million: float
    output_modalities: list[str] = ["text"]  # e.g. ["text"] or ["text", "image"]
    is_free: bool = False                     # True if id ends in :free or cost == 0
    is_moderated: bool = False                # True if model has content filters (refuses explicit)
    supports_reasoning: bool = False          # True if the model can return a reasoning trace


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/models", response_model=list[ModelInfo])
async def get_models():
    """
    Fetches the current model list from the active AI provider and returns it.
    The Settings screen uses this to populate the model picker dropdown.

    Requires a valid API key for the active provider to be saved in settings.
    """
    settings = load_settings()
    provider = active_provider(settings)
    api_key = settings.get(provider.api_key_setting, "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=f"No {provider.label} API key found. Add your key in Settings first."
        )

    try:
        models = await list_models(api_key, provider=provider)
        return [ModelInfo(**m) for m in models]
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach {provider.label}: {e}"
        )


# ── Provider Error Translation ────────────────────────────────────────────────
# Providers return standard HTTP status codes when something goes wrong on their
# end. Rather than showing the raw HTTP code (confusing) or a generic "AI request
# failed" message (useless), we translate the most common codes into sentences
# the writer can actually act on. Messages are templated on the provider so a
# NanoGPT failure says "NanoGPT", not "OpenRouter".

def _provider_msg(e: httpx.HTTPStatusError) -> str:
    """
    Pull the provider's own human-readable error message out of the response body.

    OpenAI-compatible services return errors as JSON shaped like
    {"error": {"message": "Grok 3 Mini is deprecated...", "code": 404}}.
    That message is frequently the single most useful thing for the writer (it
    often names the exact replacement model), so we surface it instead of
    discarding the body and showing only a bare status code.

    Returns "" when the body is missing, not JSON, or not in a shape we know.
    The response is already fully buffered by httpx at this point (we make
    non-streaming calls), so reading .json() here is safe and synchronous.
    """
    try:
        body = e.response.json()
    except (ValueError, TypeError):
        return ""
    if not isinstance(body, dict):
        return ""
    # Preferred shape: {"error": {"message": "..."}}
    err = body.get("error")
    if isinstance(err, dict) and isinstance(err.get("message"), str):
        return err["message"].strip()
    # Some shapes put the message at the top level instead.
    if isinstance(body.get("message"), str):
        return body["message"].strip()
    return ""


def _provider_exc(e: httpx.HTTPStatusError, provider: ProviderConfig = OPENROUTER) -> HTTPException:
    """
    Convert a provider HTTPStatusError into a user-facing FastAPI exception.

    Why a helper instead of inline if/elif chains?
    There are ~12 endpoint catch blocks. A single helper means the messages are
    consistent and only need updating in one place when a provider changes behaviour.
    """
    status = e.response.status_code
    # The provider's own message, if it sent one. Appended to our friendlier text
    # so the writer sees both "what to do" and "what the provider actually said".
    provider_msg = _provider_msg(e)
    name = provider.label
    if status == 401:
        return HTTPException(
            status_code=401,
            detail=f"{name} API key is invalid. Double-check your key in Settings.",
        )
    if status == 402:
        return HTTPException(
            status_code=402,
            detail=(
                f"{name} account has insufficient credits. "
                f"Add credits at {provider.key_hint} or switch to Free and choose a new tiered model in Settings."
            ),
        )
    if status == 429:
        return HTTPException(
            status_code=429,
            detail=(
                f"{name} rate limit reached -- too many requests in a short window. "
                "Wait a moment and try again. "
                f"If this keeps happening, check your {name} plan limits at {provider.key_hint} or switch to a different model."
                "Suggestion: Deposit $5-10. Go-to app Settings>Model Cost Tier> Budget or Free. It sips tokens, promise"
            ),
        )
    if status == 404:
        # A 404 from a chat completion almost always means the chosen model is
        # gone -- deprecated or renamed by its provider -- or simply not a valid
        # model ID. This is the failure that looks like the service being down
        # even though the account and key are fine. The body usually names the
        # exact replacement (e.g. "switch to Grok 4.3"), so we lead with
        # actionable guidance and append their message verbatim.
        base = (
            f"The AI model this project uses is unavailable on {name}, "
            "usually because the provider deprecated or renamed it. "
            "Pick a current model in Project Settings (this project may override "
            "the global model in Settings)."
        )
        return HTTPException(
            status_code=502,
            detail=f"{base} {name} says: {provider_msg}" if provider_msg else base,
        )
    if status >= 500:
        return HTTPException(
            status_code=502,
            detail=(
                f"{name} service error (HTTP {status}). "
                "This is on their end -- try again in a few seconds."
            ),
        )
    base = f"{name} returned an unexpected error: HTTP {status}."
    return HTTPException(
        status_code=502,
        detail=f"{base} {name} says: {provider_msg}" if provider_msg else base,
    )


# Backward-compatible aliases. test_openrouter_errors.py (and any older code)
# calls these OpenRouter-flavored names; they now delegate to the templated
# provider versions with OpenRouter fixed in.
_openrouter_msg = _provider_msg


def _openrouter_exc(e: httpx.HTTPStatusError) -> HTTPException:
    return _provider_exc(e, OPENROUTER)


# ── Content Mode and Model Routing ────────────────────────────────────────────
# These helpers validate that a model is eligible for the requested content mode
# and is not blocked by the user's allowlist/blocklist settings.

VALID_CONTENT_MODES = {"general", "mature", "explicit"}


def _validate_model_content_mode(settings: dict, model_id: str, content_mode: str) -> None:
    """
    Check that the model supports the requested content mode.

    Uses the model_content_modes setting to determine compatibility.
    Models NOT listed in model_content_modes are ALLOWED for all content modes
    by default. Only models explicitly configured with a restricted list are checked.

    This is an "opt-in restriction" model, not "opt-in permission":
    - If you don't configure anything: all models work with all content modes.
    - If you add a model to model_content_modes with specific modes: only those modes are allowed.

    Why this default? Most models handle mature/explicit content. Requiring writers
    to manually configure every model's content modes before using explicit mode
    creates a confusing barrier. Only restrict models known to refuse certain content.
    """
    if content_mode not in VALID_CONTENT_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown content mode: '{content_mode}'. Must be general, mature, or explicit."
        )

    # "general" mode is always allowed
    if content_mode == "general":
        return

    # Check the model's allowed modes from settings.
    # If the model is NOT in the config at all, it's allowed for everything.
    model_modes = settings.get("model_content_modes", {})
    if model_id not in model_modes:
        return  # Not configured = no restriction = all modes allowed

    allowed = model_modes[model_id]
    if content_mode not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The model '{model_id}' is restricted to '{', '.join(allowed)}' content modes "
                f"(configured in Settings > Model Routing). "
                f"Remove the restriction or switch to a different model."
            ),
        )


def _validate_model_allowed(settings: dict, model_id: str) -> None:
    """
    Check allowlist/blocklist. If allowlist is non-empty, only those models
    can be used. Otherwise, blocklisted models are rejected.
    """
    allowlist = settings.get("model_allowlist", [])
    blocklist = settings.get("model_blocklist", [])

    if allowlist and model_id not in allowlist:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The model '{model_id}' is not on the allowlist. "
                "Update your model allowlist in Settings, or switch to an allowed model."
            ),
        )

    if blocklist and model_id in blocklist:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The model '{model_id}' is on the blocklist. "
                "Remove it from the blocklist in Settings, or switch to a different model."
            ),
        )


# ── Story Context Injection ───────────────────────────────────────────────────
# Reads series.json + project.json and builds a STORY CONTEXT block that gets
# prepended to AI system prompts. Book-level non-null values override series.
# This gives AI awareness of genre, tone, pacing, and other story settings.

# Imported here (not at the top) deliberately, next to the only code that uses
# it -- noqa silences ruff's E402 module-level-import placement warning.
from app.routers.series import read_series_settings  # noqa: E402


def _build_story_context(project_path: str | None) -> str:
    """
    Build a STORY CONTEXT block from series.json + project.json.

    Override logic: if a book-level field is non-null/non-empty, it overrides
    the series-level value. This lets individual books customize tone, pacing, etc.

    Returns an empty string if no project path is provided or no settings exist.
    """
    if not project_path:
        return ""

    # Read project.json
    project_file = os.path.join(project_path, "project.json")
    project_data: dict = {}
    if os.path.exists(project_file):
        try:
            with open(project_file, "r", encoding="utf-8") as f:
                project_data = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    # Read series.json if the project belongs to a series
    series_path = project_data.get("series_path", "")
    series_data = read_series_settings(series_path) if series_path else None

    # Merge: book-level overrides series-level for these fields. Ordered so
    # related fields read together in the prompt: what the story is (genre/
    # tone/theme/setting), how it's told (pacing/POV/tense), then audience.
    # theme/setting/point_of_view/tense come from the Book Details panel and
    # exist only in project.json (series.json has no such fields -- the
    # .get() below just returns "" for them at series level).
    context_fields = [
        "genre", "subgenre", "tone", "theme", "setting", "pacing",
        "point_of_view", "tense", "target_audience", "content_mode", "keywords",
    ]

    merged: dict[str, str] = {}
    for field in context_fields:
        series_val = (series_data or {}).get(field, "")
        book_val = project_data.get(field, None)
        # Book overrides series if non-null and non-empty
        val = book_val if (book_val is not None and book_val != "") else series_val
        if val and val != "":
            # Convert lists to comma-separated strings
            if isinstance(val, list):
                val = ", ".join(str(v) for v in val)
            merged[field] = str(val)

    if not merged:
        return ""

    # Build the block. Labels are auto-derived from the key ("target_audience"
    # -> "Target Audience"); the override map catches the one key where
    # .title() gets English capitalization wrong ("Point Of View").
    label_overrides = {"point_of_view": "Point of View"}
    lines = ["STORY CONTEXT (auto-injected from project/series settings):"]
    for key, val in merged.items():
        label = label_overrides.get(key) or key.replace("_", " ").title()
        lines.append(f"  {label}: {val}")
    lines.append("")

    return "\n".join(lines) + "\n"


# ── Phase 6: Relationship-aware summary helper ───────────────────────────────
# When generating a character's full AI summary, we scan profiles/relationships/
# for files that mention this character and lift a short snippet from each one.
# The snippet becomes extra context so the summary synthesis can weave in how
# the character relates to others, not just describe them in isolation.
#
# We deliberately keep this lightweight (plain text scan, no full profile
# parsing) so a typo or malformed relationship file doesn't block summary
# generation for an unrelated character.

_RELATIONSHIP_SNIPPET_CAP = 400    # Per-section character cap -- keep prompts tight.


def _extract_frontmatter_field(raw: str, field: str) -> str:
    """
    Pull a single top-level YAML frontmatter field without a full YAML parse.
    Cheap and good enough for "name:" lookups -- we only need the value to
    label the snippet, not to reconstruct the profile.
    """
    # Frontmatter lives between the first two "---" separators.
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return ""
    fm = parts[1]
    # Match "name: value" at the start of a line; value may be quoted.
    m = re.search(rf"^{re.escape(field)}\s*:\s*(.+?)$", fm, flags=re.MULTILINE)
    if not m:
        return ""
    return m.group(1).strip().strip('"').strip("'")


def _extract_section(raw: str, heading: str) -> str:
    """
    Extract the body text under a `# Heading` line in a Markdown profile file.
    Stops at the next `# heading` line. Returns empty string if the heading
    isn't present. Used for Overview / Current Dynamic pulls.
    """
    # `^# heading$` followed by everything up to the next `^# ` line or EOF.
    pattern = rf"^#\s+{re.escape(heading)}\s*$\n(.*?)(?=^#\s+|\Z)"
    m = re.search(pattern, raw, flags=re.MULTILINE | re.DOTALL)
    if not m:
        return ""
    body = m.group(1).strip()
    # Strip any `## AI Summary:` tail so we don't double-dip on AI content.
    body = re.split(r"^##\s+AI Summary:", body, maxsplit=1, flags=re.MULTILINE)[0]
    return body.strip()


def _find_related_relationships(project_path: str, character_name: str) -> list[tuple[str, str]]:
    """
    Scan profiles/relationships/*.md for files that mention the given character
    and return [(relationship_name, compact_snippet), ...].

    Match rule: case-insensitive substring match on the character name anywhere
    in the file. This errs on the side of including near-misses (nicknames,
    possessives) rather than dropping real matches.

    Snippet composition: Overview (capped) + Current Dynamic (capped), so the
    AI gets what the character IS to this other party and how things currently
    stand between them.
    """
    rel_dir = os.path.join(project_path, "profiles", "relationships")
    if not os.path.isdir(rel_dir):
        return []

    name_lower = character_name.strip().lower()
    if not name_lower:
        return []

    results: list[tuple[str, str]] = []
    try:
        with os.scandir(rel_dir) as entries:
            for entry in entries:
                if not entry.is_file() or not entry.name.endswith(".md"):
                    continue
                try:
                    with open(entry.path, "r", encoding="utf-8") as f:
                        raw = f.read()
                except OSError:
                    continue

                if name_lower not in raw.lower():
                    continue

                rel_name = _extract_frontmatter_field(raw, "name") or entry.name.removesuffix(".md")
                overview = _extract_section(raw, "Overview")
                dynamic  = _extract_section(raw, "Current Dynamic")

                snippet_parts: list[str] = []
                if overview:
                    snippet_parts.append(f"Overview: {overview[:_RELATIONSHIP_SNIPPET_CAP]}")
                if dynamic:
                    snippet_parts.append(f"Current Dynamic: {dynamic[:_RELATIONSHIP_SNIPPET_CAP]}")
                if not snippet_parts:
                    # Nothing structured to pull -- fall back to a short slice
                    # of the body so the AI still sees *something* linking them.
                    snippet_parts.append(raw[:_RELATIONSHIP_SNIPPET_CAP].strip())

                results.append((rel_name, "\n".join(snippet_parts)))
    except OSError:
        return []

    return results


# ── Phase 4: Profile Generation Endpoints ────────────────────────────────────
# These endpoints are called from the Profile Builder to generate AI content
# for designated fields (usage previews, section summaries, full profile
# summaries). Usage previews are shown on demand, not stored.


def _resolve_model_and_key(model_id_override: str | None) -> tuple[ProviderConfig, str, str]:
    """
    Resolve which provider, API key, and model this request should use.
    Returns a (provider, api_key, model_id) 3-tuple -- the single dispatch
    seam every AI endpoint goes through, so switching providers in Settings
    reroutes ALL AI features at once.

    Model resolution order: request override (the project's default_model)
    -> global settings default_model -> the provider's fallback model.
    NanoGPT has no fallback (its catalog differs from OpenRouter's, so a
    guessed slug would just 404) -- the writer must pick a model explicitly.

    Raises HTTPException 400 if no API key is saved or no model resolves.
    """
    settings = load_settings()
    provider = active_provider(settings)
    api_key  = settings.get(provider.api_key_setting, "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=f"No {provider.label} API key found. Add your key in Settings first."
        )
    model_id = (
        model_id_override
        or settings.get("default_model", "")
        or provider.fallback_model
    )
    if not model_id:
        raise HTTPException(
            status_code=400,
            detail=f"No model selected. Pick a {provider.label} model in Settings."
        )
    return provider, api_key, model_id


def _prompt_cache_enabled(provider: ProviderConfig) -> bool:
    """Should this request mark its system prompt as cacheable?

    Two gates: the provider must understand cache_control (OpenRouter only
    today -- see ProviderConfig.supports_cache_control) AND the writer's
    Prompt Caching setting must be on (default on). Kept as a helper rather
    than read inside run_chat/run_completion so hermetic tests can call the
    real client functions without touching the developer's settings file.
    """
    return provider.supports_cache_control and bool(load_settings().get("prompt_caching", True))


def _extract_text_field(result: dict, field_name: str) -> str:
    """
    Extract a specific text field from the model response dict.

    Generation endpoints ask the model for JSON like {"section_summary": "..."}
    or {"full_summary": "..."}. run_completion() now preserves all original keys
    from the model's parsed JSON in the result dict, so the simplest path is
    checking the top-level keys first.

    Fallback chain:
      1. result[field_name]          -- direct key (most common, now that run_completion preserves them)
      2. json.loads(result["summary"]) -> [field_name]  -- model put it inside summary as nested JSON
      3. suggestions[0].content      -- model used the revision schema instead
      4. result["summary"]           -- last resort, return whatever summary holds
    """
    # 1. Direct key -- the model returned {"section_summary": "..."} and
    #    run_completion preserved it in the result dict.
    direct = result.get(field_name)
    if direct and isinstance(direct, str):
        return direct

    # 2. Nested JSON inside summary -- some models double-wrap their response
    summary = result.get("summary", "")
    try:
        parsed = json.loads(summary)
        if isinstance(parsed, dict) and field_name in parsed:
            return parsed[field_name]
    except (ValueError, TypeError):
        pass

    # 3. Suggestions fallback -- model used revision schema instead of our format
    suggestions = result.get("suggestions", [])
    if suggestions and isinstance(suggestions[0], dict):
        content = suggestions[0].get("content", "")
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict) and field_name in parsed:
                return parsed[field_name]
        except (ValueError, TypeError):
            if content:
                return content

    # 4. Last resort
    return summary


@router.post("/generate-usage-preview", response_model=GenerateUsagePreviewResponse)
async def generate_usage_preview(request: GenerateUsagePreviewRequest):
    """
    Generate a prose explanation of how a trait's importance level affects AI behavior.

    The preview is generated on demand and shown in a popover -- never persisted.
    It helps the writer understand what their importance setting actually means
    for this specific trait.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = generate_usage_preview_prompt()

    user_message = (
        f"Character: {request.profile_name}\n"
        f"Section: {request.section_heading}\n"
        f"Trait(s): {request.trait}\n"
        f"Description: {request.description}\n"
        f"Importance: {request.importance}\n\n"
        "Explain how AI will use this trait at this importance level."
    )

    try:
        result = await run_completion(provider=provider, api_key=api_key, model_id=model_id,
                                      cache_prompts=_prompt_cache_enabled(provider),
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["critique"])
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    text = _extract_text_field(result, "usage_preview")
    return GenerateUsagePreviewResponse(usage_preview=sanitize(text.strip()))


class QuickOverviewRequest(BaseModel):
    """POST /generate-quick-overview -- side/background characters only.

    The frontend sends whatever the writer has already filled in; empty
    fields are simply omitted from the prompt. A deliberate, writer-clicked
    exception to the no-ghostwriting stance, scoped to fast side-character
    assembly: output lands in the editable Overview field, nothing saves
    until the writer saves, clicking again rerolls a different angle.
    """
    name: str
    role: str = ""
    tags: list[str] = []
    # Section heading -> the writer's text for it (Quick Build lines etc.).
    sections: dict[str, str] = {}
    model_id: str | None = None
    content_mode: str = "general"
    project_path: str | None = None


class QuickOverviewResponse(BaseModel):
    overview: str
    model_used: str = ""


@router.post("/generate-quick-overview", response_model=QuickOverviewResponse)
async def generate_quick_overview(request: QuickOverviewRequest):
    """
    Turn a side character's filled-in fields into a compact Overview -- a
    mini encapsulated story of who this person is. Regenerating gives a
    varied result (generation temperature + an explicit vary-your-angle
    instruction in the prompt).
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = generate_quick_overview_prompt()
    mode_block = content_mode_instruction(request.content_mode)
    if mode_block:
        system_prompt = system_prompt + "\n" + mode_block

    # Story context (genre/tone/setting...) shades the overview's voice.
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    parts = [f"Name: {request.name}"]
    if request.role.strip():
        parts.append(f"Role: {request.role.strip()}")
    if request.tags:
        parts.append(f"Tags: {', '.join(request.tags)}")
    for heading, text in request.sections.items():
        if text.strip():
            parts.append(f"{heading}:\n{text.strip()}")
    user_message = (
        "Write the overview for this character from these details:\n\n"
        + "\n\n".join(parts)
    )

    try:
        reply = await run_chat(
            provider      = provider,
            cache_prompts = _prompt_cache_enabled(provider),
            api_key       = api_key,
            model_id      = model_id,
            system_prompt = system_prompt,
            messages      = [{"role": "user", "content": user_message}],
            # generation temperature: the vary-each-click behavior comes from
            # sampling randomness plus the prompt's vary-your-angle rule.
            temperature   = TEMPERATURE_DEFAULTS["generation"],
            # prose mode keeps the approved ' -- ' punctuation -- this text
            # lands in the profile, not in a chat bubble.
            sanitize_mode = "prose",
        )
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    return QuickOverviewResponse(overview=reply.strip(), model_used=model_id)


# ── Word count "Good" ranges per importance (mirrors frontend GAUGE_THRESHOLDS) ──
# Used by the Trim tool to tell AI the ideal word range for a given importance level.
_GOOD_RANGES: dict[str, str] = {
    "core":       "41-120",
    "present":    "31-100",
    "background": "21-60",
    "contextual": "16-40",
    "hidden":     "any length",
}


@router.post("/trim-trait", response_model=TrimTraitResponse)
async def trim_trait(request: TrimTraitRequest):
    """
    Suggest a more concise rewrite of a wordy/bloated trait description.

    The writer triggers this when the word gauge hits Wordy or Bloated.
    AI rewrites the description to land in the "Good" range while keeping
    all the key details the AI needs at that importance level.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    good_range = _GOOD_RANGES.get(request.importance, "30-80")

    system_prompt = trim_trait_prompt(request.importance, good_range, request.word_count)

    user_message = (
        f"Character: {request.profile_name} ({request.profile_type})\n"
        f"Section: {request.section_heading}\n"
        f"Trait(s): {request.trait}\n"
        f"Importance: {request.importance}\n"
        f"Current description ({request.word_count} words):\n"
        f"{request.description}\n\n"
        f"Rewrite this to land within {good_range} words."
    )

    try:
        result = await run_completion(provider=provider, api_key=api_key, model_id=model_id,
                                      cache_prompts=_prompt_cache_enabled(provider),
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["critique"])
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    text = _extract_text_field(result, "trimmed")
    return TrimTraitResponse(trimmed=sanitize(text.strip()))


@router.post("/audit-importance", response_model=AuditImportanceResponse)
async def audit_importance(request: AuditImportanceRequest):
    """
    Analyze all trait blocks in a profile and flag mismatched importance levels.

    For example: a 'background' trait with rich emotional hooks should be 'core',
    or a 'core' trait with a vague one-liner should be fleshed out or downgraded.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    # Format the trait blocks as a readable list for the AI
    blocks_text = ""
    for b in request.trait_blocks:
        blocks_text += (
            f"- Section: {b.get('section_heading', 'unknown')}\n"
            f"  Trait: {b.get('trait', '')}\n"
            f"  Importance: {b.get('importance', 'background')}\n"
            f"  Description: {b.get('description', '')}\n\n"
        )

    system_prompt = audit_importance_prompt()

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n\n"
        f"Trait blocks:\n{blocks_text}\n"
        "Review these and flag any importance level mismatches."
    )

    try:
        result = await run_completion(provider=provider, api_key=api_key, model_id=model_id,
                                      cache_prompts=_prompt_cache_enabled(provider),
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["critique"])
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    # Parse the flags array from the AI response
    raw_text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    try:
        parsed = json.loads(raw_text)
        flags = parsed.get("flags", [])
    except json.JSONDecodeError:
        flags = []

    # Sanitize all text in flags
    for flag in flags:
        for key in ("trait", "reason"):
            if key in flag and isinstance(flag[key], str):
                flag[key] = sanitize(flag[key])

    return AuditImportanceResponse(flags=flags)


@router.post("/generate-section-summary", response_model=GenerateSectionSummaryResponse)
async def generate_section_summary(request: GenerateSectionSummaryRequest):
    """
    Generate a compact AI summary for one section of a profile.
    Stored under the ## AI Summary: heading. Designed to be concise and
    prompt-efficient so it can be used as context without burning many tokens.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = generate_section_summary_prompt()

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n"
        f"Section: {request.section_heading}\n\n"
        f"Content:\n{request.section_content}\n\n"
        "Convert this into an AI-prompt-friendly summary. Distinguish what the writer "
        "clearly emphasizes from what is mentioned only in passing."
    )

    try:
        result = await run_completion(provider=provider, api_key=api_key, model_id=model_id,
                                      cache_prompts=_prompt_cache_enabled(provider),
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["profile"])
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    text = _extract_text_field(result, "section_summary")
    return GenerateSectionSummaryResponse(section_summary=sanitize(text.strip()))


@router.post("/generate-full-summary", response_model=GenerateFullSummaryResponse)
async def generate_full_summary(request: GenerateFullSummaryRequest):
    """
    Generate a full synthesized AI summary for an entire profile.
    For character profiles: multi-paragraph, reflecting trait importance weights.
    For other types: shorter, focused on what is most useful for writing AI.
    This is the primary content used when the writer attaches a profile as a
    context chip to an AI assistant request.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = generate_full_summary_prompt()

    # Base user message: the profile itself.
    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n\n"
        f"Full content:\n{request.profile_content}\n\n"
    )

    # Phase 6: fold in related relationship snippets for character profiles.
    # We keep this purely additive so non-character profiles and older callers
    # (no project_path) hit the same code path as before.
    relationship_sources_used: list[str] = []
    if request.profile_type == "character" and request.project_path:
        related = _find_related_relationships(request.project_path, request.profile_name)
        if related:
            rel_block_lines = [
                "RELATED RELATIONSHIPS (other profiles in this project that mention this character -- weave these into the summary where they clarify who the character is in relation to others; do NOT copy them verbatim):",
                "",
            ]
            for rel_name, snippet in related:
                rel_block_lines.append(f"[{rel_name}]")
                rel_block_lines.append(snippet)
                rel_block_lines.append("")
                relationship_sources_used.append(rel_name)
            user_message += "\n".join(rel_block_lines) + "\n"

    user_message += (
        "Refine this Overview into an AI-prompt-friendly version. "
        "Audit each passage for relevance first. Flag anything disconnected. "
        "Then refine the relevant content so AI's interpretation matches the writer's vision. "
        "IMPORTANT: preserve the writer's level of detail. If they wrote 3 paragraphs, "
        "the refined version should be approximately 3 paragraphs. Do not compress or shorten."
    )

    try:
        result = await run_completion(provider=provider, api_key=api_key, model_id=model_id,
                                      cache_prompts=_prompt_cache_enabled(provider),
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["profile"])
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    text = _extract_text_field(result, "full_summary")
    return GenerateFullSummaryResponse(
        full_summary=sanitize(text.strip()),
        relationship_sources_used=relationship_sources_used,
    )


# ── Phase 6 helpers: chapter summary file I/O ───────────────────────────────
# Chapter summaries live as plain Markdown files under
# <project>/summaries/chapters/<chapter-stem>.md. The AI produces the full
# Markdown body in one shot; the endpoint writes it to disk verbatim.

def _read_chapter_text(project_path: str, chapter_path: str) -> str:
    """
    Validate that chapter_path lives under project_path/manuscript/ and return
    the chapter's raw Markdown text. Path-traversal safe: realpath comparison
    prevents "../../etc/passwd" style requests.
    """
    manuscript_dir = os.path.realpath(os.path.join(project_path, "manuscript"))
    full = os.path.realpath(chapter_path)
    if not full.startswith(manuscript_dir + os.sep) and full != manuscript_dir:
        raise HTTPException(status_code=400, detail="Chapter path must be inside the project's manuscript folder.")
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail=f"Chapter not found: {chapter_path}")
    with open(full, "r", encoding="utf-8") as f:
        return f.read()


def _chapter_title_from_text(chapter_text: str, fallback: str) -> str:
    """
    Extract the chapter's display name from its first `# Heading`. Falls back
    to the filename stem if no heading is found.
    """
    for line in chapter_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip() or fallback
    return fallback


def _chapter_summary_path(project_path: str, chapter_filename: str) -> str:
    """Resolve the absolute path of the summary file for a given chapter stem."""
    stem   = os.path.splitext(chapter_filename)[0]
    folder = os.path.join(project_path, "summaries", "chapters")
    return os.path.join(folder, f"{stem}.md")


@router.post("/generate-chapter-summary", response_model=GenerateChapterSummaryResponse)
async def generate_chapter_summary(request: GenerateChapterSummaryRequest):
    """
    Generate a plain-Markdown chapter summary from a chapter file.
    Writes the result to <project>/summaries/chapters/<chapter-stem>.md and
    returns the content so the UI can display it immediately.

    Pipeline:
      1. Read chapter text from disk (path-traversal safe)
      2. Build system prompt from CHAPTER_SUMMARY_INSTRUCTIONS + PUNCTUATION_RULE
      3. Call run_chat() with chapter text as the single user message. run_chat
         returns plain text and applies sanitize_chat() automatically, which
         replaces em dashes and ` -- ` with commas per the writer's preference.
      4. Write the sanitized Markdown to summaries/chapters/<stem>.md
      5. Return the content + filename + model
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    chapter_text = _read_chapter_text(request.project_path, request.chapter_path)
    stem         = os.path.splitext(os.path.basename(request.chapter_path))[0]
    chapter_name = _chapter_title_from_text(chapter_text, fallback=stem)

    system_prompt = generate_chapter_summary_prompt(request.content_mode)
    # The explicit "SUMMARIZE the following" framing + "do not extend" reminder
    # cuts down on models that otherwise slip into narrative-continuation mode.
    # Keep the chapter text as the final block so it's visually clear where
    # the source material lives.
    user_message = (
        f"Summarize the following chapter. Do NOT extend, rewrite, or reimagine it. "
        f"Use ONLY information that appears in the text below.\n\n"
        f"Chapter title: {chapter_name}\n\n"
        f"--- BEGIN CHAPTER TEXT ---\n"
        f"{chapter_text}\n"
        f"--- END CHAPTER TEXT ---"
    )

    try:
        # run_chat (not run_completion) because we want plain text output, not
        # JSON. sanitize_chat() runs inside run_chat to enforce the no-em-dash,
        # no-double-hyphen rule on anything the model slips past the prompt.
        # "critique" temperature (0.3) keeps the model grounded -- summaries
        # need the same low-randomness treatment as structured reviews, not
        # the creative "generation" temperature.
        body = await run_chat(
            provider      = provider,
            cache_prompts = _prompt_cache_enabled(provider),
            api_key       = api_key,
            model_id      = model_id,
            system_prompt = system_prompt,
            messages      = [{"role": "user", "content": user_message}],
            temperature   = TEMPERATURE_DEFAULTS["critique"],
        )
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    filename     = f"{stem}.md"
    summary_dir  = os.path.join(request.project_path, "summaries", "chapters")
    summary_path = os.path.join(summary_dir, filename)
    os.makedirs(summary_dir, exist_ok=True)

    # Strip whatever leading/trailing whitespace the model adds, then write.
    content = body.strip() + "\n"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(content)

    return GenerateChapterSummaryResponse(
        content    = content,
        filename   = filename,
        model_used = model_id,
    )


# ── Scene Summary endpoints ─────────────────────────────────────────────────

@router.post("/split-chapter-scenes", response_model=SplitChapterScenesResponse)
async def split_chapter_scenes(request: SplitChapterScenesRequest):
    """
    Parse a chapter file and return the list of scene blocks with metadata.

    No AI call is made here -- this is pure Markdown parsing. The frontend
    calls this first so it knows:
      - how many scenes to iterate through
      - which titles were extracted (vs need AI title generation later)
      - whether to show the no-HR fallback modal (hr_count == 0)

    The frontend passes each scene's `text` back to /generate-scene-summary
    as-is, so we include the full body here (not just a preview).
    """
    chapter_text = _read_chapter_text(request.project_path, request.chapter_path)
    hr_count     = count_hr_breaks(chapter_text)
    scenes       = split_into_scenes_with_meta(chapter_text)

    # Build preview snippets for UI display. We only send the first ~200 chars
    # so the Scene Summaries sidebar row can show a hint without bloating the
    # response. The full `text` field is still sent for the generate call.
    result = [
        SplitChapterScene(
            index        = s.index,
            title        = s.title,
            text_preview = (s.text[:200] + "…") if len(s.text) > 200 else s.text,
            text         = s.text,
            start        = s.start,
            end          = s.end,
        )
        for s in scenes
    ]

    return SplitChapterScenesResponse(scenes=result, hr_count=hr_count)


@router.post("/generate-scene-summary", response_model=GenerateSceneSummaryResponse)
async def generate_scene_summary(request: GenerateSceneSummaryRequest):
    """
    Generate a summary for a single scene. Does NOT write to disk.

    Pipeline:
      1. Resolve model + validate routing (allowlist, content mode).
      2. Build system prompt from SCENE_SUMMARY_INSTRUCTIONS (+ content mode
         preamble + story context) and call run_chat() with the scene text.
      3. If the caller didn't pre-extract a title, make a second, smaller
         run_chat() call to ask the AI for a 2-5 word scene title. This is
         cheap because the model only returns a handful of tokens.
      4. Return {title, content, model_used}. The frontend decides whether to
         save (overwrite prompt, preview modal, etc.) via /api/documents/scene-summary.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    settings = load_settings()
    _validate_model_content_mode(settings, model_id, request.content_mode)
    _validate_model_allowed(settings, model_id)

    # Validate that the chapter_path really does live inside this project.
    # We don't need the text itself (the caller passes scene_text directly),
    # but this catches a mis-wired frontend passing a path from another project.
    _read_chapter_text(request.project_path, request.chapter_path)

    scene_text = request.scene_text.strip()
    if not scene_text:
        raise HTTPException(status_code=400, detail="Scene text is empty.")

    # Body of the summary -- one AI call, plain-text run_chat so the
    # em-dash sanitizer runs automatically on the output.
    system_prompt = generate_scene_summary_prompt(request.content_mode)
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    # Explicit "SUMMARIZE the following" framing keeps models from slipping
    # into narrative-continuation mode. The BEGIN/END markers make it visually
    # unambiguous which block is source material and which is instruction.
    user_message = (
        f"Summarize the following scene. Do NOT extend, rewrite, or reimagine it. "
        f"Use ONLY information that appears in the text below.\n\n"
        f"--- BEGIN SCENE TEXT ---\n"
        f"{scene_text}\n"
        f"--- END SCENE TEXT ---"
    )

    try:
        # "critique" temperature (0.3) -- summaries are low-randomness work,
        # same as structured reviews. The "generation" temperature is for
        # creative continuation and would let the model drift.
        body = await run_chat(
            provider      = provider,
            cache_prompts = _prompt_cache_enabled(provider),
            api_key       = api_key,
            model_id      = model_id,
            system_prompt = system_prompt,
            messages      = [{"role": "user", "content": user_message}],
            temperature   = TEMPERATURE_DEFAULTS["critique"],
        )
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    content = body.strip()

    # Title -- prefer the one the caller extracted (from heading/bold/italic).
    # Only call the AI a second time if we don't have one yet. A failed title
    # call falls back to "Scene" rather than bubbling up an error, because the
    # summary itself already succeeded and blocking on a title would be worse
    # UX than a generic label the writer can edit.
    title = (request.scene_title or "").strip()
    if not title:
        try:
            title_reply = await run_chat(
                provider      = provider,
            cache_prompts = _prompt_cache_enabled(provider),
            api_key       = api_key,
                model_id      = model_id,
                system_prompt = generate_scene_title_prompt(),
                messages      = [{"role": "user", "content": (
                    f"Give a 2-5 word title for the following scene. "
                    f"Base the title ONLY on what is in the text.\n\n"
                    f"--- BEGIN SCENE TEXT ---\n"
                    f"{scene_text}\n"
                    f"--- END SCENE TEXT ---"
                )}],
                temperature   = TEMPERATURE_DEFAULTS["critique"],
            )
            # Models sometimes wrap the title in quotes or add trailing punctuation.
            # We strip those off so the title lands clean.
            title = title_reply.strip().strip('"').strip("'").rstrip(".!?,:; ")
            # Collapse any stray newlines -- a title is a single line by contract.
            title = title.replace("\n", " ").strip()
        except (httpx.HTTPStatusError, httpx.RequestError):
            title = "Scene"

    if not title:
        title = "Scene"

    return GenerateSceneSummaryResponse(
        title      = title,
        content    = content,
        model_used = model_id,
    )


# ── Scene Break Suggestions ───────────────────────────────────────────────────
# Reads a whole chapter and proposes where to insert `---` scene breaks. Like
# every AI feature here, it only SUGGESTS: the writer places the breaks by hand
# (the locked no-auto-apply rule). Suggestions are quote-anchored (verbatim text
# just before each break) because line numbers aren't stable but exact text is.

class SuggestSceneBreaksRequest(BaseModel):
    chapter_path: str | None = None          # for context/logging; not required
    project_path: str | None = None          # for story-context injection
    chapter_text: str                        # the full chapter markdown
    model_id:     str | None = None
    content_mode: str = "general"


class SceneBreakSuggestion(BaseModel):
    quote:       str                         # verbatim text just before the break
    explanation: str                         # why a break here helps
    severity:    str                         # "strong" | "moderate" | "subtle"


class SuggestSceneBreaksResponse(BaseModel):
    suggestions: list[SceneBreakSuggestion]
    analysis:    str                         # overall pacing commentary
    model_used:  str


_VALID_BREAK_SEVERITIES = {"strong", "moderate", "subtle"}


@router.post("/suggest-scene-breaks", response_model=SuggestSceneBreaksResponse)
async def suggest_scene_breaks(request: SuggestSceneBreaksRequest):
    """Suggest where to place `---` scene breaks in a chapter (review-only)."""
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    settings = load_settings()
    _validate_model_content_mode(settings, model_id, request.content_mode)
    _validate_model_allowed(settings, model_id)

    chapter_text = request.chapter_text.strip()
    if not chapter_text:
        raise HTTPException(status_code=400, detail="Chapter text is empty.")
    # Same full-chapter cap as the editor-pass / editor-chat full-chapter path.
    if len(chapter_text) > 100_000:
        raise HTTPException(
            status_code=400,
            detail=f"Chapter is too long ({len(chapter_text):,} chars, max 100,000). "
                   f"Try splitting it first."
        )

    system_prompt = generate_scene_break_suggestions_prompt(request.content_mode)
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    user_message = (
        "Analyze the following chapter and suggest where scene breaks would help.\n\n"
        "--- BEGIN CHAPTER TEXT ---\n"
        f"{chapter_text}\n"
        "--- END CHAPTER TEXT ---"
    )

    try:
        # critique temperature (0.3): identifying structural beats is analytic
        # work, not creative generation -- we want consistency, not drift.
        raw = await run_chat(
            provider      = provider,
            cache_prompts = _prompt_cache_enabled(provider),
            api_key       = api_key,
            model_id      = model_id,
            system_prompt = system_prompt,
            messages      = [{"role": "user", "content": user_message}],
            temperature   = TEMPERATURE_DEFAULTS["critique"],
        )
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    # Parse the model's JSON. Tolerate fences/preamble via the shared extractor.
    # A malformed response yields no suggestions rather than a 500 -- the writer
    # just sees "no suggestions" instead of a crash.
    parsed: dict = {}
    block = _extract_json_block(raw)
    if block:
        try:
            loaded = json.loads(block)
            if isinstance(loaded, dict):
                parsed = loaded
        except json.JSONDecodeError:
            parsed = {}

    suggestions: list[SceneBreakSuggestion] = []
    for s in parsed.get("suggestions", []):
        if not isinstance(s, dict):
            continue
        quote = sanitize(str(s.get("quote", "")).strip())
        explanation = sanitize(str(s.get("explanation", "")).strip())
        if not quote or not explanation:
            continue
        severity = str(s.get("severity", "moderate")).strip().lower()
        if severity not in _VALID_BREAK_SEVERITIES:
            severity = "moderate"
        suggestions.append(SceneBreakSuggestion(
            quote=quote, explanation=explanation, severity=severity,
        ))

    analysis = sanitize(str(parsed.get("analysis", "")).strip())

    return SuggestSceneBreaksResponse(
        suggestions = suggestions,
        analysis    = analysis,
        model_used  = model_id,
    )


@router.post("/profile-chat", response_model=ProfileChatResponse)
async def profile_chat(request: ProfileChatRequest):
    """
    Profile Builder chat -- routes to a behavior-specific system prompt.

    The behavior_mode field controls what the AI is trying to do this session.
    Each mode has a distinct system prompt tuned for that specific task.
    New modes are added over time without changing this routing structure.

    Session-only: no state on the server. Frontend sends full history each turn.
    Writer controls all profile edits -- AI only suggests, never writes directly.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    # 1. System prompt = instructions only (no profile content)
    system_prompt = build_profile_chat_system_prompt(
        behavior_mode  = request.behavior_mode,
        profile_type   = request.profile_type,
        content_mode   = request.content_mode,
        section_labels = request.section_labels or None,
    )

    # Prepend story context (series/book settings) if a project path is provided
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    # 2. Materials message with profile content. The Profile Builder frontend
    #    recomputes formatProfileForAI(profile) and sends it on EVERY turn --
    #    so edits made mid-conversation are always visible to the AI, and the
    #    profile never drops out of context. (The Writing Companion solves
    #    the same problem differently: it echoes materials back for the
    #    frontend to persist in history -- see editor_chat.)
    conversation = [{"role": m.role, "content": m.content} for m in request.messages]

    if request.profile_content.strip():
        profile_label = request.profile_type.replace("_", " ").title()
        materials = {
            "role": "user",
            "content": (
                f"PROFILE CONTEXT ({profile_label}: {request.profile_name}):\n\n"
                f"{request.profile_content}"
            ),
        }
        messages = [materials] + conversation
    else:
        messages = conversation

    # Pick temperature based on behavior mode. "interview" deliberately takes
    # the default profile temperature (0.5): it asks focused questions and
    # organizes the writer's answers -- it should not get creative.
    if request.behavior_mode in ("extract_traits", "check_consistency"):
        temp = TEMPERATURE_DEFAULTS["critique"]
    elif request.behavior_mode == "guide":
        temp = TEMPERATURE_DEFAULTS["generation"]
    else:
        temp = TEMPERATURE_DEFAULTS["profile"]

    try:
        reply = await run_chat(provider=provider, api_key=api_key, model_id=model_id,
                                   cache_prompts=_prompt_cache_enabled(provider),
                               system_prompt=system_prompt, messages=messages,
                               temperature=temp)
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    return ProfileChatResponse(reply=reply, model_used=model_id)


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5E: WRITING COMPANION (Editor Chat)
# ══════════════════════════════════════════════════════════════════════════════

class EditorChatMessage(BaseModel):
    role: str
    content: str


class EditorChatRequest(BaseModel):
    """One turn of the Writing Companion chat in the main editor."""
    category:        str                     # "readability" | "structure" | "context" | "chat" | "draft" | "enhance"
    text_content:    str                     # Selected text OR full chapter (for enhance: the passage to expand)
    is_full_chapter: bool = False
    messages:        list[EditorChatMessage]
    context_chips:   list[ContextChip] = []
    model_id:        str | None = None
    content_mode:    str = "general"
    project_path:    str | None = None
    # Enhance mode only: a window of paragraphs around the selection, sent as
    # grounding (facts/continuity/outcomes) that the model must NOT rewrite.
    # Empty for every other mode.
    surrounding_context: str = ""
    # Enhance mode only: the length budget. "restate" = ~same length rewrite;
    # "default" = 1.5-2.2x; "expanded" = 2.2-4x. The writer's message is the direction.
    enhance_level:   str = "default"
    # The writer's Canon/Reference toggle. True (default) = attached profiles/
    # outline/locations are canon the AI must stay consistent with. False = they
    # are reference only and the writer's typed direction takes precedence.
    treat_attachments_as_canon: bool = True
    # True when ANY chips are attached in the UI -- including ones already
    # sent on an earlier turn (context_chips only carries the NEW ones).
    # Keeps the ATTACHMENT STANCE instruction in the system prompt for the
    # whole life of the attachment, not just the turn it was added.
    has_attached_context: bool = False
    # Reasoning toggle: when True (and the model supports it), OpenRouter is
    # asked for the model's reasoning trace, returned alongside the reply.
    # The frontend only offers the toggle for reasoning-capable models.
    include_reasoning: bool = False


class EditorChatResponse(BaseModel):
    reply: str
    model_used: str = ""       # The resolved model ID so the UI can display it
    reasoning: str | None = None  # The model's reasoning trace, when requested + emitted
    # Echo of the materials message (chips + chapter text) the backend
    # prepended this turn, so the frontend can persist it into the chat
    # history as a hidden message. Without this, attached profiles were in
    # front of the model for exactly ONE turn and then vanished -- the root
    # cause of "the AI forgot my character's voice". None when no new
    # materials were sent (or in enhance mode, which resends fresh per turn).
    materials_content: str | None = None


# Absolute ceiling on a single Enhance rewrite, in approximate words. Multiplier
# targets are clamped to this so a large highlight can't demand a runaway rewrite
# (which is where coherence falls apart). Effect is an ADAPTIVE multiplier: the
# bigger the selection, the smaller the effective ratio. LLMs enhance a few lines
# to a paragraph reliably; past that, focused beats sprawling.
_ENHANCE_MAX_WORDS = 800

# Multiplier band per level: (low, high). Restate is ~same length; the writer's
# chat message positions within the band and supplies the direction.
_ENHANCE_BANDS = {
    "restate":  (1.0, 1.2),
    "default":  (1.5, 2.2),
    "expanded": (2.2, 4.0),
}


def _enhance_length_directive(level: str, selection: str) -> str:
    """
    Build the per-turn ENHANCEMENT LEVEL directive with a CONCRETE word target
    computed from the selection size. The band sets the target; it is then clamped
    to _ENHANCE_MAX_WORDS so a large highlight can't balloon. Goes in the user
    materials message (not the system prompt) so the system prompt stays stable.
    """
    words = max(1, round(len(selection) / 6))          # ~6 chars/word incl. spacing
    if level not in _ENHANCE_BANDS:
        level = "default"                              # unknown -> default band + label
    low_mult, high_mult = _ENHANCE_BANDS[level]

    if level == "restate":
        return (
            f"ENHANCEMENT LEVEL: Restate. The passage is about {words} words. Keep your rewrite "
            f"about the same length (roughly {words} words); rework the wording to satisfy my "
            f"direction above, do not pad it out. Flex slightly longer only if the direction "
            f"genuinely requires it, such as splitting one sentence into two."
        )

    low = round(words * low_mult)
    high = round(words * high_mult)
    capped = high > _ENHANCE_MAX_WORDS
    if capped:
        high = _ENHANCE_MAX_WORDS
    if low > high:
        low = high
    label = "Default" if level == "default" else "Expanded"
    directive = (
        f"ENHANCEMENT LEVEL: {label}. The passage is about {words} words. Aim for roughly "
        f"{low} to {high} words total. Add the depth my direction calls for"
        + (", including a line of dialogue if it fits" if level == "default" else "")
        + ", and break the result into natural paragraphs."
    )
    if capped:
        directive += (
            " This is a large passage, so keep the rewrite focused and within this word "
            "target rather than expanding every sentence."
        )
    return directive


def _build_materials_message(
    text_content: str,
    is_full_chapter: bool,
    context_chips: list[ContextChip],
    surrounding_context: str = "",
    enhance_level: str = "default",
    is_enhance: bool = False,
    treat_as_canon: bool = True,
) -> dict:
    """
    Build a user message containing all variable content (selected text,
    context chips). This keeps the system prompt stable and instruction-only.

    treat_as_canon controls how the attached chips are framed (the writer's
    Canon/Reference toggle): canon = established truth, reference = the writer's
    typed direction takes precedence. The matching stance instruction is added to
    the system prompt by the caller.

    For enhance mode (is_enhance=True) the message has a specific shape so the
    model can tell grounding from target:
      chips -> SURROUNDING CONTEXT (grounding, do-not-rewrite) -> PASSAGE TO
      ENHANCE (the only thing to rewrite) -> the level directive.
    """
    lines = []

    if context_chips:
        if treat_as_canon:
            lines.append("ATTACHED CONTEXT (treat as canon for this story):")
        else:
            lines.append("ATTACHED REFERENCE (details you may draw on; my direction takes precedence):")
        lines.append("")
        # Each chip is wrapped in BEGIN/END delimiters so the model treats it
        # as an isolated block. Without these markers, when several characters
        # are attached, traits can bleed across profiles in long responses --
        # the AI may assign one character's [core] trait to another. The
        # explicit closing tag forces a hard boundary.
        for chip in context_chips:
            type_label = chip.type.replace("_", " ").upper()
            header = f"=== BEGIN {type_label}: {chip.name} ==="
            footer = f"=== END {type_label}: {chip.name} ==="
            lines.append(header)
            lines.append(chip.content.strip())
            lines.append(footer)
            lines.append("")
        lines.append("---")
        lines.append("")

    # Enhance mode: the surrounding paragraphs are grounding only. Same BEGIN/END
    # framing as chips so the boundary with the target passage is unambiguous.
    if is_enhance and surrounding_context.strip():
        lines.append(
            "SURROUNDING CONTEXT (grounding only -- do NOT rewrite or expand this; "
            "use it for facts, names, continuity, and outcomes):"
        )
        lines.append("=== BEGIN SURROUNDING CONTEXT ===")
        lines.append(surrounding_context.strip())
        lines.append("=== END SURROUNDING CONTEXT ===")
        lines.append("")

    # Only include the text section if there's actual text. When the writer
    # has Include Chapter toggled OFF and nothing selected, text_content is
    # empty -- adding an empty "SELECTED PASSAGE:" header confuses the AI
    # into thinking the context failed to load.
    if text_content.strip():
        if is_enhance:
            # The target passage. Wrapped in explicit markers so the model never
            # confuses it with the surrounding grounding block above.
            lines.append("PASSAGE TO ENHANCE (rewrite ONLY this):")
            lines.append("=== BEGIN PASSAGE TO ENHANCE ===")
            lines.append(text_content)
            lines.append("=== END PASSAGE TO ENHANCE ===")
            lines.append("")
            lines.append(_enhance_length_directive(enhance_level, text_content))
        else:
            label = "FULL CHAPTER" if is_full_chapter else "SELECTED PASSAGE"
            lines.append(f"{label}:")
            lines.append(text_content)

    return {"role": "user", "content": "\n".join(lines)}


@router.post("/editor-chat", response_model=EditorChatResponse)
async def editor_chat(request: EditorChatRequest):
    """Writing Companion chat endpoint for the main editor panel."""
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    settings = load_settings()
    _validate_model_content_mode(settings, model_id, request.content_mode)
    _validate_model_allowed(settings, model_id)

    max_len = 100_000 if request.is_full_chapter else 30_000
    if len(request.text_content) > max_len:
        label = "chapter" if request.is_full_chapter else "selection"
        raise HTTPException(
            status_code=400,
            detail=f"The {label} is too long ({len(request.text_content):,} chars, "
                   f"max {max_len:,}). Try a shorter passage."
        )

    # Enhance mode also ships a surrounding-paragraph window; bound it too so a
    # huge window can't blow past context limits.
    if len(request.surrounding_context) > 30_000:
        raise HTTPException(
            status_code=400,
            detail=f"The surrounding context is too long ({len(request.surrounding_context):,} chars, "
                   f"max 30,000). Try enhancing a passage with less text around it."
        )

    is_enhance = request.category == "enhance"

    # 1. System prompt = instructions only (no story text, no chips)
    system_prompt = build_editor_chat_system_prompt(
        category     = request.category,
        content_mode = request.content_mode,
    )

    # Prepend story context if available
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    # Attachment stance: when the writer has chips attached, tell the model
    # whether to treat them as canon (enforce) or reference (the writer's
    # direction wins). Driven by the Canon/Reference toggle in the attachment
    # popup. Keyed on has_attached_context (attached in the UI at all), not
    # just context_chips (only the NEW ones this turn) -- the stance must
    # hold for as long as the chips are in play, and a byte-identical system
    # prompt across turns is also what makes prompt caching effective.
    if request.context_chips or request.has_attached_context:
        system_prompt = system_prompt + "\n\n" + context_stance_instruction(request.treat_attachments_as_canon)

    # 2. Build a "materials" user message with variable content -- but only if
    #    the frontend actually sent something new. On follow-up turns the frontend
    #    omits text_content and chips that were already sent in a prior turn.
    #    That dedup is safe because of the materials_content echo below: the
    #    frontend persists the echoed materials into its chat history as a
    #    hidden message, so "already sent" genuinely means "already in the
    #    conversation the model sees" -- not "vanished after one turn".
    has_new_materials = (
        bool(request.text_content.strip())
        or bool(request.context_chips)
        or bool(request.surrounding_context.strip())
    )

    conversation = [{"role": m.role, "content": m.content} for m in request.messages]

    materials_content: str | None = None
    if has_new_materials:
        materials = _build_materials_message(
            text_content        = request.text_content,
            is_full_chapter     = request.is_full_chapter,
            context_chips       = request.context_chips,
            surrounding_context = request.surrounding_context,
            enhance_level       = request.enhance_level,
            is_enhance          = is_enhance,
            treat_as_canon      = request.treat_attachments_as_canon,
        )
        # Insert the materials just BEFORE the newest user message rather than
        # at the front of the whole conversation. Turn 1 is identical either
        # way; for chips attached mid-conversation this keeps the earlier
        # messages byte-stable (append-only), which is what lets provider-side
        # prompt caching keep matching the prefix.
        if conversation:
            messages = conversation[:-1] + [materials] + conversation[-1:]
        else:
            messages = [materials]
        # Echo the materials so the frontend can persist them into history.
        # Enhance stays transient by design -- it resends its target passage
        # fresh every turn, and persisting each copy would bloat the history.
        if not is_enhance:
            materials_content = materials["content"]
    else:
        messages = conversation

    # Pick temperature: open chat gets the most randomness; Draft and Enhance
    # write story prose FROM the attached materials, so they run slightly
    # cooler (see draft_prose in TEMPERATURE_DEFAULTS) to keep character
    # voice anchored to the profiles; the structured review categories run
    # coolest of all.
    if request.category == "chat":
        temp = TEMPERATURE_DEFAULTS["generation"]
    elif request.category in ("draft", "enhance"):
        temp = TEMPERATURE_DEFAULTS["draft_prose"]
    else:
        temp = TEMPERATURE_DEFAULTS["critique"]

    # Pick the sanitizer mode. Draft and Enhance both produce story prose, where
    # an approved ' -- ' is legitimate punctuation, so they use the prose
    # sanitizer (strips em/en dashes only). Every other mode is conversational
    # and uses the chat sanitizer, which also folds ' -- ' down to commas.
    sanitize_mode = "prose" if request.category in ("draft", "enhance") else "chat"

    try:
        if request.include_reasoning:
            # Tuple return shape -- see run_chat's include_reasoning docstring.
            reply, reasoning = await run_chat(provider=provider, api_key=api_key, model_id=model_id,
                                   cache_prompts=_prompt_cache_enabled(provider),
                                              system_prompt=system_prompt, messages=messages,
                                              temperature=temp, sanitize_mode=sanitize_mode,
                                              include_reasoning=True)
        else:
            reply = await run_chat(provider=provider, api_key=api_key, model_id=model_id,
                                   cache_prompts=_prompt_cache_enabled(provider),
                                   system_prompt=system_prompt, messages=messages,
                                   temperature=temp, sanitize_mode=sanitize_mode)
            reasoning = None
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    return EditorChatResponse(reply=reply, model_used=model_id, reasoning=reasoning,
                              materials_content=materials_content)


# ── Editor Pass (Inline Overlay Feedback) ─────────────────────────────────────
# The editor-pass endpoint powers the inline highlight system in the manuscript
# editor. The frontend calls it with a category (readability/structure/context)
# plus subcategory toggles, the chapter text, and any attached profile chips.
# The AI returns a JSON list of issues, each anchored to a verbatim quote from
# the chapter. The frontend locates each quote in the editor and decorates it
# as a clickable highlight.
#
# Why structured JSON instead of the existing editor-chat prose flow?
#   editor-chat returns markdown the writer reads in the side panel; the
#   redesign moves feedback ONTO the manuscript itself, which means the
#   frontend has to know exactly what to highlight, what label to show, and
#   what the suggested rewrite is. JSON lets us hand all three pieces over
#   in one round trip without screen-scraping prose.

class EditorPassRequest(BaseModel):
    category:         str                          # "readability" | "structure" | "context"
    subcategories:    list[str] = []               # subcategory keys; empty = all of them
    chapter_text:     str                          # the passage the AI should review (may be whole chapter or just a selection)
    is_selection:     bool = False                 # True when chapter_text is a writer-selected range, not the whole chapter
    context_chips:    list[ContextChip] = []
    model_id:         str | None = None
    content_mode:     str = "general"
    project_path:     str | None = None
    chapter_filename: str | None = None            # for Writing Progress logging; the chapter file the writer is reviewing


class EditorIssueModel(BaseModel):
    """One AI-flagged issue. The frontend matches `quote` against the chapter
    text to determine where to render the highlight; if no exact match is
    found, the frontend silently drops the issue (rather than mis-highlighting
    a similar-looking passage)."""
    id:           str
    category:     str           # one of EDITOR_PASS_SUBCATEGORIES[<top>] keys
    severity:     str           # "praise" | "issue" | "suggestion"
    quote:        str           # verbatim chapter text -- frontend uses for locate
    explanation:  str
    suggestions:  list[str] = []


class EditorPassResponse(BaseModel):
    issues:     list[EditorIssueModel]
    model_used: str = ""


def _coerce_issues(payload: object) -> list[dict]:
    """
    Accept either a list of issues or a wrapper object {"issues": [...]}.
    Some models return one shape, some the other; we accept both rather than
    failing. Returns an empty list if the shape is unrecognized.
    """
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        items = payload.get("issues")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
    return []


def _extract_json_block(raw: str) -> str | None:
    """
    Find a JSON object inside a model response. Some models obey the
    'no preamble, no fence' instruction; others wrap output in ```json or
    chat around it. We look for the first '{' and the last matching '}'.
    Returns None if nothing JSON-like is present.
    """
    if not raw:
        return None
    start = raw.find("{")
    if start < 0:
        return None
    end = raw.rfind("}")
    if end <= start:
        return None
    return raw[start:end + 1]


def _parse_pass_response(raw: str, allowed_subcategory_keys: set[str]) -> list[dict]:
    """
    Parse the model's response into a list of issue dicts. Tolerates: bare
    JSON, JSON with leading/trailing text, JSON wrapped in a markdown fence,
    and lists vs. {"issues": [...]} wrappers. Returns issues filtered to
    only those whose 'category' is in the allowed set -- this prevents the
    AI from inventing categories the frontend doesn't know how to render.
    """
    block = _extract_json_block(raw)
    if not block:
        return []
    try:
        parsed = json.loads(block)
    except json.JSONDecodeError:
        return []
    items = _coerce_issues(parsed)
    cleaned: list[dict] = []
    for item in items:
        cat = str(item.get("category", "")).strip().lower()
        if cat not in allowed_subcategory_keys:
            # Silently drop unrecognized categories rather than fail the whole
            # pass. A typo from the model shouldn't lose the writer's other
            # 8 valid issues.
            continue
        sev = str(item.get("severity", "issue")).strip().lower()
        if sev not in ("praise", "issue", "suggestion"):
            sev = "issue"
        quote = str(item.get("quote", "")).strip()
        if not quote:
            # No quote = nothing to highlight. Drop.
            continue
        explanation = str(item.get("explanation", "")).strip()
        # Suggestions can be a list or, occasionally, a single string from
        # confused models. Normalize to a list of trimmed non-empty strings.
        raw_sugs = item.get("suggestions", [])
        if isinstance(raw_sugs, str):
            raw_sugs = [raw_sugs]
        if not isinstance(raw_sugs, list):
            raw_sugs = []
        sugs = [str(s).strip() for s in raw_sugs if str(s).strip()]
        cleaned.append({
            "id":          str(uuid.uuid4()),
            "category":    cat,
            "severity":    sev,
            "quote":       sanitize(quote),
            "explanation": sanitize(explanation),
            "suggestions": [sanitize(s) for s in sugs],
        })
    return cleaned


@router.post("/editor-pass", response_model=EditorPassResponse)
async def editor_pass(request: EditorPassRequest):
    """
    Run an editor pass over a chapter. Returns a list of inline issues the
    frontend renders as clickable highlights. See module-level docstring
    above for the architectural rationale.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    settings = load_settings()
    _validate_model_content_mode(settings, model_id, request.content_mode)
    _validate_model_allowed(settings, model_id)

    cat_defs = EDITOR_PASS_SUBCATEGORIES.get(request.category)
    if not cat_defs:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown editor pass category: {request.category!r}. "
                   f"Expected one of: {list(EDITOR_PASS_SUBCATEGORIES.keys())}.",
        )

    # Cap the input length. Selection mode gets a tighter cap (30K) because
    # the writer is explicitly scoping the pass; if a selection runs that
    # long it's almost certainly an accident. Full-chapter mode keeps the
    # 100K cap that matches editor-chat. Beyond either cap the request is
    # likely to time out or blow the model's context window.
    max_chars = 30_000 if request.is_selection else 100_000
    if len(request.chapter_text) > max_chars:
        mode_label = "selection" if request.is_selection else "chapter"
        raise HTTPException(
            status_code=400,
            detail=f"The {mode_label} is too long ({len(request.chapter_text):,} chars, "
                   f"max {max_chars:,}). Try a shorter passage or split the chapter.",
        )

    # Build the system prompt + materials user message. This re-uses the
    # exact same chip-wrapping logic as editor-chat (BEGIN/END delimiters,
    # ATTACHED CONTEXT block) so attached profiles behave identically across
    # the two endpoints.
    system_prompt = build_editor_pass_system_prompt(
        category      = request.category,
        subcategories = request.subcategories,
        content_mode  = request.content_mode,
    )
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    materials = _build_materials_message(
        text_content    = request.chapter_text,
        is_full_chapter = not request.is_selection,
        context_chips   = request.context_chips,
    )
    messages = [materials]

    try:
        raw = await run_chat(
            provider      = provider,
            cache_prompts = _prompt_cache_enabled(provider),
            api_key       = api_key,
            model_id      = model_id,
            system_prompt = system_prompt,
            messages      = messages,
            # critique temperature: low randomness, focused output. Same as
            # the structured-feedback path through editor-chat.
            temperature   = TEMPERATURE_DEFAULTS["critique"],
        )
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    allowed_keys = set(cat_defs.keys())
    issues_raw = _parse_pass_response(raw, allowed_keys)

    issues = [EditorIssueModel(**item) for item in issues_raw]

    # Writing Progress: log this advisor invocation. Records project, chapter
    # file, and which category ran (readability / structure / context). The
    # aggregator in routers/progress.py grants the chapter a daily task credit
    # once all three categories have run on it the same day. Best-effort --
    # record_advisor_run() never raises.
    if request.project_path and request.chapter_filename:
        await record_advisor_run(
            request.project_path,
            f"manuscript/{request.chapter_filename}",
            request.category,
            rollover_hour=get_rollover_hour(),
        )

    return EditorPassResponse(issues=issues, model_used=model_id)


# ── Revise Suggestion (per-issue refinement) ──────────────────────────────────
# Called when the writer clicks a quick-modifier button on an issue popover
# (Rewrite / Expand / Shorten / Describe / Rephrase / Add Sensory Detail /
# Change Tone / Default). Scoped to ONE issue's quote+suggestion+modifier --
# does not see the whole chapter, which keeps the call fast and cheap.

class ReviseSuggestionRequest(BaseModel):
    quote:              str   # the original passage being suggested over
    current_suggestion: str   # the suggestion the writer wants revised
    modifier:           str   # one of the modifier names; "default" = open rewrite
    context_chips:      list[ContextChip] = []
    model_id:           str | None = None
    content_mode:       str = "general"
    project_path:       str | None = None


class ReviseSuggestionResponse(BaseModel):
    suggestion: str
    model_used: str = ""


@router.post("/revise-suggestion", response_model=ReviseSuggestionResponse)
async def revise_suggestion(request: ReviseSuggestionRequest):
    """
    Refine a single issue's suggestion based on a creative-transformation
    modifier. Returns one new suggestion that replaces the old one in the
    issue popover; does not affect any other issue or the manuscript.
    """
    provider, api_key, model_id = _resolve_model_and_key(request.model_id)

    settings = load_settings()
    _validate_model_content_mode(settings, model_id, request.content_mode)
    _validate_model_allowed(settings, model_id)

    if not request.quote.strip():
        raise HTTPException(status_code=400, detail="Quote is required.")

    system_prompt = build_revise_suggestion_system_prompt(
        modifier     = request.modifier,
        content_mode = request.content_mode,
    )
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    # Materials message: the original passage + current suggestion. Wrapped
    # with attached chips so character voice context still applies. The
    # 'is_full_chapter' flag is False because we're not sending the whole
    # chapter -- just the quote + suggestion.
    materials_text = (
        f"ORIGINAL PASSAGE:\n{request.quote}\n\n"
        f"CURRENT SUGGESTION (revise this):\n{request.current_suggestion}"
    )
    materials = _build_materials_message(
        text_content    = materials_text,
        is_full_chapter = False,
        context_chips   = request.context_chips,
    )

    try:
        raw = await run_chat(
            provider      = provider,
            cache_prompts = _prompt_cache_enabled(provider),
            api_key       = api_key,
            model_id      = model_id,
            system_prompt = system_prompt,
            messages      = [materials],
            temperature   = TEMPERATURE_DEFAULTS["generation"],
        )
    except httpx.HTTPStatusError as e:
        raise _provider_exc(e, provider)
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Could not reach {provider.label}: {e}")

    # Strip surrounding whitespace and any accidental markdown fence the
    # model wrapped around the prose. The prompt forbids these but weak
    # models slip up; cheap to clean up here rather than show fence text
    # to the writer.
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # Drop the opening fence (with optional language tag) and the
        # closing fence on the last line.
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    cleaned = sanitize(cleaned.strip())

    return ReviseSuggestionResponse(suggestion=cleaned, model_used=model_id)
