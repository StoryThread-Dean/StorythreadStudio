# routers/ai.py -- AI Assistant API
# ====================================
# Handles running writing assistants, listing models, and connection testing.
#
# Routes:
#   GET  /api/ai/models          -- list OpenRouter models (for Settings model picker)
#   POST /api/ai/run-assistant   -- run a writing assistant on selected text
#
# The run-assistant pipeline:
#   1. Validate the request (assistant ID, non-empty text, API key present)
#   2. Look up the assistant's system prompt from assistants.py
#   3. Build the user message (the selected text, cleanly wrapped)
#   4. Call OpenRouter via openrouter.py (which handles timeouts and errors)
#   5. Sanitize the response (em dash removal)
#   6. Return the structured response to the frontend

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.settings_store import load_settings
from app.ai.assistants import ASSISTANT_BY_ID, ASSISTANTS
from app.ai.openrouter import run_completion, run_chat, list_models
from app.ai.sanitizer import sanitize
from app.ai.prompts import (
    build_editor_chat_system_prompt,
    build_profile_chat_system_prompt,
    wrap_assistant_prompt,
    generate_usage_preview_prompt,
    trim_trait_prompt,
    audit_importance_prompt,
    generate_section_summary_prompt,
    generate_full_summary_prompt,
    content_mode_instruction,
    TEMPERATURE_DEFAULTS,
)
import httpx
import json
import os

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


class RunAssistantRequest(BaseModel):
    assistant_id: str                   # Must match an AssistantDef.id in assistants.py
    selected_text: str                  # The text the writer has highlighted in the editor
    model_id: str | None = None         # Optional override; falls back to settings default
    context_chips: list[ContextChip] = []  # Explicitly attached profile context (Phase 4)
    project_path: str | None = None     # Project root path -- used to inject series/book context
    content_mode: str = "general"       # "general" | "mature" | "explicit" -- for routing


# ── Phase 4 Generation Models ─────────────────────────────────────────────────

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
    """
    profile_name:    str
    profile_type:    str
    profile_content: str   # All sections formatted into a single readable block
    model_id: str | None = None


class GenerateFullSummaryResponse(BaseModel):
    full_summary: str


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
    profile_content: str              # Only the ToolKit-selected context
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


class AssistantSuggestion(BaseModel):
    label: str
    content: str


class RunAssistantResponse(BaseModel):
    assistant_id: str
    assistant_name: str
    summary: str
    suggestions: list[AssistantSuggestion]
    notes: list[str]
    model_used: str
    had_em_dashes: bool   # True if the sanitizer had to fix the model's output


class AssistantMeta(BaseModel):
    """Lightweight assistant info returned by the registry endpoint."""
    id: str
    name: str
    category: str
    scope: str
    description: str


class ModelInfo(BaseModel):
    id: str
    name: str
    context_length: int
    cost_input_per_million: float
    cost_output_per_million: float
    output_modalities: list[str] = ["text"]  # e.g. ["text"] or ["text", "image"]
    is_free: bool = False                     # True if id ends in :free or cost == 0
    is_moderated: bool = False                # True if model has content filters (refuses explicit)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/assistants", response_model=list[AssistantMeta])
async def list_assistants():
    """
    Returns the full list of registered assistants with their metadata.
    The frontend uses this to build the assistant buttons in the right panel.
    For Phase 3, this is a static list seeded from assistants.py.
    """
    return [
        AssistantMeta(
            id=a.id,
            name=a.name,
            category=a.category,
            scope=a.scope,
            description=a.description,
        )
        for a in ASSISTANTS
    ]


@router.get("/models", response_model=list[ModelInfo])
async def get_models():
    """
    Fetches the current model list from OpenRouter and returns it.
    The Settings screen uses this to populate the model picker dropdown.

    Requires a valid API key to be saved in settings.
    """
    api_key = load_settings().get("openrouter_api_key", "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No OpenRouter API key found. Add your key in Settings first."
        )

    try:
        models = await list_models(api_key)
        return [ModelInfo(**m) for m in models]
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter returned an error: HTTP {e.response.status_code}"
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach OpenRouter: {e}"
        )


@router.post("/run-assistant", response_model=RunAssistantResponse)
async def run_assistant(request: RunAssistantRequest):
    """
    Run a writing assistant on the writer's selected text.

    Steps:
      1. Validate the assistant ID and selected text
      2. Load the API key and resolve the model to use
      3. Build and send the request to OpenRouter
      4. Return the sanitized, structured response

    The response always includes had_em_dashes=True if the sanitizer had to
    fix em dashes that the model included despite the prompt instruction.
    This is useful for debugging prompt quality.
    """
    # 1. Validate assistant
    assistant = ASSISTANT_BY_ID.get(request.assistant_id)
    if not assistant:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown assistant: '{request.assistant_id}'. "
                   f"Valid options: {list(ASSISTANT_BY_ID.keys())}"
        )

    # 2. Validate selected text
    selected = request.selected_text.strip()
    if not selected:
        raise HTTPException(
            status_code=400,
            detail="No text selected. Highlight some text in the editor before running an assistant."
        )
    if len(selected) > 8000:
        raise HTTPException(
            status_code=400,
            detail="Selected text is too long (max 8000 characters). Select a smaller passage."
        )

    # 3. Resolve API key and model
    settings = load_settings()
    api_key = settings.get("openrouter_api_key", "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No OpenRouter API key found. Add your key in Settings first."
        )

    model_id = request.model_id or settings.get("default_model", "openai/gpt-4o-mini")

    # 3b. Content mode routing: check if the resolved model supports the requested mode
    _validate_model_content_mode(settings, model_id, request.content_mode)

    # 3c. Allowlist/blocklist filtering
    _validate_model_allowed(settings, model_id)

    # 4. Build the user message.
    # If the writer has attached context chips, prepend them before the selected text.
    # This is the "explicit context attachment" rule from the spec -- the AI never
    # has implicit access to the full project; only what the writer explicitly shares.
    context_block = ""
    if request.context_chips:
        lines = ["ATTACHED CONTEXT (provided by the writer for reference):\n"]
        for chip in request.context_chips:
            lines.append(f"[{chip.type.replace('_', ' ').title()}: {chip.name}]")
            lines.append(chip.content.strip())
            lines.append("")
        lines.append("---\n")
        context_block = "\n".join(lines)

    user_message = (
        f"{context_block}"
        f"Please review the following passage:\n\n---\n{selected}\n---"
    )

    # 5. Call OpenRouter -- wrap the assistant prompt with unified punctuation rule,
    #    then prepend story context if available
    system_prompt = wrap_assistant_prompt(assistant.system_prompt)
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    try:
        result = await run_completion(
            api_key=api_key,
            model_id=model_id,
            system_prompt=system_prompt,
            user_message=user_message,
            temperature=TEMPERATURE_DEFAULTS["critique"],
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise HTTPException(status_code=401, detail="OpenRouter API key is invalid.")
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter returned an error: HTTP {e.response.status_code}"
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach OpenRouter: {e}. Check your internet connection."
        )

    # 6. Build and return the response
    return RunAssistantResponse(
        assistant_id=assistant.id,
        assistant_name=assistant.name,
        summary=result.get("summary", ""),
        suggestions=[
            AssistantSuggestion(**s)
            for s in result.get("suggestions", [])
            if isinstance(s, dict) and "label" in s and "content" in s
        ],
        notes=result.get("notes", []),
        model_used=result.get("model_used", model_id),
        had_em_dashes=result.get("had_em_dashes", False),
    )


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

from app.routers.series import read_series_settings


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

    # Merge: book-level overrides series-level for these fields
    context_fields = ["genre", "subgenre", "tone", "pacing", "target_audience", "content_mode", "keywords"]

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

    # Build the block
    lines = ["STORY CONTEXT (auto-injected from project/series settings):"]
    for key, val in merged.items():
        label = key.replace("_", " ").title()
        lines.append(f"  {label}: {val}")
    lines.append("")

    return "\n".join(lines) + "\n"


# ── Phase 4: Profile Generation Endpoints ────────────────────────────────────
# These endpoints are called from the Profile Builder to generate AI content
# for designated fields (usage previews, section summaries, full profile
# summaries). Usage previews are shown on demand, not stored.


def _resolve_model_and_key(model_id_override: str | None) -> tuple[str, str]:
    """
    Load settings, validate the API key exists, and resolve the model to use.
    Raises HTTPException 400 if no API key is saved.
    Helper shared by all Phase 4 generation endpoints.
    """
    settings = load_settings()
    api_key  = settings.get("openrouter_api_key", "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No OpenRouter API key found. Add your key in Settings first."
        )
    model_id = model_id_override or settings.get("default_model", "openai/gpt-4o-mini")
    return api_key, model_id


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

    Unlike the old ai_usage_example (which was stored in YAML), this preview
    is generated on demand and shown in a popover -- not persisted. It helps
    the writer understand what their importance setting actually means for
    this specific trait.
    """
    api_key, model_id = _resolve_model_and_key(request.model_id)

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
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["extraction"])
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    text = _extract_text_field(result, "usage_preview")
    return GenerateUsagePreviewResponse(usage_preview=sanitize(text.strip()))


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
    api_key, model_id = _resolve_model_and_key(request.model_id)

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
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["critique"])
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    text = _extract_text_field(result, "trimmed")
    return TrimTraitResponse(trimmed=sanitize(text.strip()))


@router.post("/audit-importance", response_model=AuditImportanceResponse)
async def audit_importance(request: AuditImportanceRequest):
    """
    Analyze all trait blocks in a profile and flag mismatched importance levels.

    For example: a 'background' trait with rich emotional hooks should be 'core',
    or a 'core' trait with a vague one-liner should be fleshed out or downgraded.
    """
    api_key, model_id = _resolve_model_and_key(request.model_id)

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
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["extraction"])
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

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
    api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = generate_section_summary_prompt()

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n"
        f"Section: {request.section_heading}\n\n"
        f"Content:\n{request.section_content}\n\n"
        "Convert this into an AI-prompt-friendly summary. Distinguish what the writer "
        "clearly emphasizes from what is mentioned only in passing."
    )

    try:
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["profile"])
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

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
    api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = generate_full_summary_prompt()

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n\n"
        f"Full content:\n{request.profile_content}\n\n"
        "Refine this Overview into an AI-prompt-friendly version. "
        "Audit each passage for relevance first. Flag anything disconnected. "
        "Then refine the relevant content so AI's interpretation matches the writer's vision. "
        "IMPORTANT: preserve the writer's level of detail. If they wrote 3 paragraphs, "
        "the refined version should be approximately 3 paragraphs. Do not compress or shorten."
    )

    try:
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message,
                                      temperature=TEMPERATURE_DEFAULTS["profile"])
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    text = _extract_text_field(result, "full_summary")
    return GenerateFullSummaryResponse(full_summary=sanitize(text.strip()))


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
    api_key, model_id = _resolve_model_and_key(request.model_id)

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

    # 2. Materials message with profile content -- only on the first turn.
    #    The frontend sends profile_content on the initial message and omits it
    #    on follow-ups (it's already in the conversation history from turn 1).
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

    # Pick temperature based on behavior mode
    if request.behavior_mode in ("extract_traits", "check_consistency"):
        temp = TEMPERATURE_DEFAULTS["extraction"]
    elif request.behavior_mode == "guide":
        temp = TEMPERATURE_DEFAULTS["generation"]
    else:
        temp = TEMPERATURE_DEFAULTS["profile"]

    try:
        reply = await run_chat(api_key=api_key, model_id=model_id,
                               system_prompt=system_prompt, messages=messages,
                               temperature=temp)
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    return ProfileChatResponse(reply=reply)


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5E: WRITING COMPANION (Editor Chat)
# ══════════════════════════════════════════════════════════════════════════════

class EditorChatMessage(BaseModel):
    role: str
    content: str


class EditorChatRequest(BaseModel):
    """One turn of the Writing Companion chat in the main editor."""
    category:        str                     # "readability" | "structure" | "context"
    text_content:    str                     # Selected text OR full chapter
    is_full_chapter: bool = False
    messages:        list[EditorChatMessage]
    context_chips:   list[ContextChip] = []
    model_id:        str | None = None
    content_mode:    str = "general"
    project_path:    str | None = None


class EditorChatResponse(BaseModel):
    reply: str


def _build_materials_message(
    text_content: str,
    is_full_chapter: bool,
    context_chips: list[ContextChip],
) -> dict:
    """
    Build a user message containing all variable content (selected text,
    context chips). This keeps the system prompt stable and instruction-only.
    """
    lines = []

    if context_chips:
        lines.append("ATTACHED CONTEXT (treat as canon for this story):")
        lines.append("")
        for chip in context_chips:
            lines.append(f"[{chip.type.replace('_', ' ').title()}: {chip.name}]")
            lines.append(chip.content.strip())
            lines.append("")
        lines.append("---")
        lines.append("")

    # Only include the text section if there's actual text. When the writer
    # has Include Chapter toggled OFF and nothing selected, text_content is
    # empty -- adding an empty "SELECTED PASSAGE:" header confuses the AI
    # into thinking the context failed to load.
    if text_content.strip():
        label = "FULL CHAPTER" if is_full_chapter else "SELECTED PASSAGE"
        lines.append(f"{label}:")
        lines.append(text_content)

    return {"role": "user", "content": "\n".join(lines)}


@router.post("/editor-chat", response_model=EditorChatResponse)
async def editor_chat(request: EditorChatRequest):
    """Writing Companion chat endpoint for the main editor panel."""
    api_key, model_id = _resolve_model_and_key(request.model_id)

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

    # 1. System prompt = instructions only (no story text, no chips)
    system_prompt = build_editor_chat_system_prompt(
        category     = request.category,
        content_mode = request.content_mode,
    )

    # Prepend story context if available
    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    # 2. Build a "materials" user message with variable content -- but only if
    #    the frontend actually sent something new. On follow-up turns the frontend
    #    omits text_content and chips that were already sent in a prior turn (they're
    #    already in the conversation history). Skipping the materials message here
    #    avoids resending the same chapter + profiles on every single turn.
    has_new_materials = bool(request.text_content.strip()) or bool(request.context_chips)

    conversation = [{"role": m.role, "content": m.content} for m in request.messages]

    if has_new_materials:
        materials = _build_materials_message(
            text_content    = request.text_content,
            is_full_chapter = request.is_full_chapter,
            context_chips   = request.context_chips,
        )
        messages = [materials] + conversation
    else:
        messages = conversation

    # Pick temperature: structured categories get lower randomness
    temp = (
        TEMPERATURE_DEFAULTS["generation"] if request.category == "chat"
        else TEMPERATURE_DEFAULTS["critique"]
    )

    try:
        reply = await run_chat(api_key=api_key, model_id=model_id,
                               system_prompt=system_prompt, messages=messages,
                               temperature=temp)
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    return EditorChatResponse(reply=reply)
