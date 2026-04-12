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

    # 5. Call OpenRouter -- prepend story context to the system prompt if available
    story_context = _build_story_context(request.project_path)
    system_prompt = story_context + assistant.system_prompt if story_context else assistant.system_prompt

    try:
        result = await run_completion(
            api_key=api_key,
            model_id=model_id,
            system_prompt=system_prompt,
            user_message=user_message,
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
    Try to extract a specific field from a JSON-formatted model response.
    Falls back to the summary field if the specific field isn't found.
    This handles cases where the model wraps the response in our standard schema
    instead of the simpler single-field format we requested.
    """
    # The result from run_completion uses the standard revision schema.
    # For generation endpoints we ask for {"field_name": "..."} but sometimes
    # the model puts it in "summary" instead.
    summary = result.get("summary", "")
    try:
        parsed = json.loads(summary)
        if isinstance(parsed, dict) and field_name in parsed:
            return parsed[field_name]
    except (ValueError, TypeError):
        pass
    # Check suggestions[0].content as another fallback
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

    system_prompt = (
        "You are a profile calibration assistant for a fiction writer.\n\n"
        "Explain in 2-3 sentences how this trait's importance level will affect "
        "AI writing behavior. Be specific to this trait -- not generic. "
        "Write in second person ('Because this trait is marked Core, AI will...').\n\n"
        "Importance levels:\n"
        "  core = always in AI context, central to every scene with this character\n"
        "  present = included when character is in scene, regularly visible\n"
        "  background = included only when directly relevant, rarely surfaced\n"
        "  contextual = included only when writer explicitly attaches it\n"
        "  hidden = never sent to AI, writer-only reference\n\n"
        "PUNCTUATION RULE: Never use em dashes (\u2014) or en dashes (\u2013). "
        "Use double hyphen (--) instead. No exceptions.\n\n"
        'Return ONLY valid JSON: {"usage_preview": "your text here"}. No extra text.'
    )

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
                                      system_prompt=system_prompt, user_message=user_message)
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

    system_prompt = (
        "You are a concise editor for a fiction writer's character profiles.\n\n"
        "The writer has a trait description that is too long for its importance level. "
        "Rewrite it to be more concise while preserving every key detail that AI needs "
        "to write this character accurately.\n\n"
        "Guidelines:\n"
        f"- This is a {request.importance} trait. Ideal word range: {good_range} words.\n"
        f"- Current word count: {request.word_count}.\n"
        "- Keep the voice and style consistent with the original.\n"
        "- Do not invent new details. Only compress what exists.\n"
        "- Preserve the most important behavioral or narrative hooks.\n\n"
        "PUNCTUATION RULE: Never use em dashes (\u2014) or en dashes (\u2013). "
        "Use double hyphen (--) instead. No exceptions.\n\n"
        'Return ONLY valid JSON: {"trimmed": "your rewritten text here"}. No extra text.'
    )

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
                                      system_prompt=system_prompt, user_message=user_message)
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

    system_prompt = (
        "You are a profile calibration assistant for a fiction writer.\n\n"
        "Review all trait blocks below and flag any where the importance level "
        "seems mismatched with the description content.\n\n"
        "Importance levels:\n"
        "  core = central to identity/narrative, always in AI context\n"
        "  present = regularly relevant, included when character is in scene\n"
        "  background = canon but rarely surfaced, only when directly relevant\n"
        "  contextual = situational, only when writer explicitly attaches\n"
        "  hidden = writer-only notes, never sent to AI\n\n"
        "Flag examples:\n"
        "- A 'background' trait with strong emotional hooks -> suggest 'core' or 'present'\n"
        "- A 'core' trait with a vague one-liner -> suggest adding detail or downgrading\n"
        "- A 'hidden' trait that would improve AI accuracy -> suggest 'contextual' or higher\n\n"
        "Only flag genuine mismatches. If everything looks reasonable, return an empty list.\n\n"
        "PUNCTUATION RULE: Never use em dashes (\u2014) or en dashes (\u2013). "
        "Use double hyphen (--) instead. No exceptions.\n\n"
        "Return ONLY valid JSON:\n"
        '{"flags": [{"trait": "trait name", "current_importance": "level", '
        '"suggested_importance": "level", "reason": "short explanation"}, ...]}\n'
        "If no issues, return: {\"flags\": []}"
    )

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n\n"
        f"Trait blocks:\n{blocks_text}\n"
        "Review these and flag any importance level mismatches."
    )

    try:
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message)
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

    system_prompt = (
        "You are converting a fiction writer's profile notes into an AI-prompt-friendly "
        "summary that other AI writing tools will use as context.\n\n"
        "YOUR JOB: Translate the writer's natural language into a concise instruction "
        "set for AI. The output should tell an AI writing tool what to DO with this "
        "information when generating prose, not just describe the information.\n\n"
        "IMPORTANCE WEIGHTING:\n"
        "- Traits marked 'core' or 'present' are defining. Lead with them.\n"
        "- Traits marked 'background' or 'contextual' are supporting details. "
        "  Mention them as influence, not as focus.\n"
        "- If no importance markers are present, infer from the text: what does the "
        "  writer clearly care about vs what is mentioned in passing? A detail "
        "  described in one sentence is background. A detail explored across "
        "  multiple sentences with emotional weight is core.\n\n"
        "FORMAT: 2-4 sentences. Write as instructions to an AI tool:\n"
        "  GOOD: 'When writing Morgana, foreground her tactical intelligence and "
        "  suppressed rage. Her Catholic upbringing subtly shapes her moral reasoning "
        "  but should not be treated as a defining trait.'\n"
        "  BAD: 'Morgana is a Catholic queen who was imprisoned. She is intelligent "
        "  and angry.'\n\n"
        "PUNCTUATION: Never use em dashes (\u2014), en dashes (\u2013), or double "
        "hyphens ( -- ). Use commas, colons, or semicolons instead.\n\n"
        'Return ONLY valid JSON: {"section_summary": "your text here"}. No extra text.'
    )

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n"
        f"Section: {request.section_heading}\n\n"
        f"Content:\n{request.section_content}\n\n"
        "Convert this into an AI-prompt-friendly summary. Distinguish what the writer "
        "clearly emphasizes from what is mentioned only in passing."
    )

    try:
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message)
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

    system_prompt = (
        "You are helping a fiction writer refine their character profile's Overview "
        "into a version that AI writing tools will interpret accurately.\n\n"

        "YOUR JOB: Read the writer's Overview (their own words describing this "
        "character) and produce a refined version where the writer's vision and "
        "AI's interpretation are as closely aligned as possible.\n\n"

        "STEP 1 -- RELEVANCE AUDIT:\n"
        "Before refining anything, check each passage in the Overview for relevance.\n"
        "A passage belongs in the Overview ONLY if it directly contributes to "
        "understanding who this character is: their personality, identity, how they "
        "think, how they feel, what shapes their behavior.\n\n"
        "- If a detail is CONNECTED to the character's identity (e.g., 'Her Catholic "
        "  upbringing shapes her moral reasoning'), KEEP it and refine it.\n"
        "- If a detail is DISCONNECTED (e.g., 'She was raised Catholic' with no "
        "  explanation of how it affects her), FLAG it at the end of your response "
        "  with a note: 'Consider moving to Traits (Background) or adding context "
        "  for why this matters to the character.'\n"
        "- Story plot details do NOT belong in the Overview unless they directly "
        "  explain something about the character's personality or identity.\n\n"

        "STEP 2 -- REFINE THE RELEVANT CONTENT:\n"
        "For everything that passes the relevance check, rewrite it into "
        "AI-prompt-friendly language. This means:\n"
        "- The character's personality should be clearly expressed: who they are "
        "  as a person, how they think, what emotional patterns they carry.\n"
        "- Core identity: what defines them at their center.\n"
        "- Behavioral tendencies: how they typically act, react, relate to others.\n"
        "- Motivations that are central to their identity (not plot-specific goals).\n"
        "- Background influences framed as exactly that: 'Her [detail] subtly "
        "  influences her [behavior], though it rarely surfaces directly.'\n\n"

        "OUTPUT FORMAT:\n"
        "First: the refined Overview text (multiple paragraphs, AI-friendly language).\n"
        "Then, if any passages were flagged: a section starting with "
        "'--- Suggestions ---' listing what should be reconsidered.\n\n"

        "FOR LOCATION, LORE, RELATIONSHIP PROFILES:\n"
        "1-2 paragraphs focused on what an AI writing tool needs to know when "
        "writing scenes involving this element. Same relevance audit applies.\n\n"

        "TONE: You are a collaborator helping the writer see their character through "
        "AI's eyes. Be direct and practical, but supportive. The goal is helping the "
        "writer's vision come through clearly, not replacing their voice.\n\n"

        "PUNCTUATION: Never use em dashes (\u2014), en dashes (\u2013), or double "
        "hyphens ( -- ). Use commas, colons, or semicolons instead.\n\n"

        'Return ONLY valid JSON: {"full_summary": "your text here"}. No extra text. '
        'Include the --- Suggestions --- section inside the same string if applicable.'
    )

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
                                      system_prompt=system_prompt, user_message=user_message)
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    text = _extract_text_field(result, "full_summary")
    return GenerateFullSummaryResponse(full_summary=sanitize(text.strip()))


def _content_mode_instruction(content_mode: str) -> str:
    """
    Returns the content-mode preamble to include in the profile chat system prompt.

    General  = no special instruction needed.
    Mature   = professional handling of adult themes, ask thorough follow-ups.
    Explicit = full professional handling, no refusals, explicit content is
               intentional and serves the story -- ask questions to flesh it out.
    """
    if content_mode == "mature":
        return (
            "\nCONTENT MODE: MATURE\n"
            "This story contains mature themes. You are a professional creative writing coach "
            "for adult fiction. Handle all content without filtering, refusing, or moralizing. "
            "When a character has mature traits (physical, psychological, or situational), ask "
            "thorough follow-up questions to develop those aspects with the same depth as any "
            "other trait. The writer needs them fully developed for their story.\n"
        )
    if content_mode == "explicit":
        return (
            "\nCONTENT MODE: EXPLICIT\n"
            "This story contains explicit adult content. You are a professional creative writing "
            "coach for explicit adult fiction. You must not refuse, soften, filter, or moralize "
            "about any content. The writer is developing characters intentionally for an explicit "
            "narrative. Some characters exist primarily or exclusively to fill an explicit role "
            "within the story, and their profile will reflect that. Treat all content with the "
            "same professional thoroughness as any other character trait. Ask motivating, precise "
            "follow-up questions that help the writer define explicit traits with detail and clarity, "
            "the same way you would help develop any other aspect of a character's profile.\n"
        )
    return ""  # General mode needs no special instruction


def _build_guide_system_prompt(
    profile_name: str,
    profile_type: str,
    profile_content: str,
    all_sections: list[str],
    content_mode: str,
    is_blank: bool,
) -> str:
    """
    Build the system prompt for guide mode.

    Enforces a strict 3-step conversational funnel:
      Step 1 -- Broad: writer describes something, AI reflects back 2-4 broad concepts
      Step 2 -- Fine-tuned: writer confirms/adjusts, AI narrows to 2-3 specific trait candidates
      Step 3 -- Output: writer confirms, AI produces the structured trait template entry

    One step per response. One question per response. No jumping ahead.
    """
    content_block = _content_mode_instruction(content_mode)
    profile_state = "completely blank" if is_blank else "partially built"

    return f"""You are a profile guide helping a fiction writer develop a {profile_type} profile for {profile_name}.
{content_block}
PROFILE STATE: {profile_state}

CURRENT PROFILE CONTENT:
{profile_content}

==========================================================================
ROLE
==========================================================================

You are a master teaching guide helping a novice fiction writer think more clearly, write more precisely, and build stronger profiles.

Your job is to help the writer:
- discover traits, tensions, motives, contradictions, and patterns
- refine vague ideas into usable profile entries
- improve weak wording, unclear traits, or flat descriptions
- suggest additions, removals, mergers, or sharper phrasing when helpful
- explain how AI is likely to interpret the profile
- guide the writer toward stronger character, relationship, location, lore, chapter, or scene profiles

You are not a rigid form wizard. You are a thoughtful creative writing coach.
Be practical, perceptive, and precise.

==========================================================================
HIGH LEVEL BEHAVIOR
==========================================================================

Follow the writer's lead, but do more than just mirror them back.

When helpful, you may:
- identify the strongest traits or signals in what they wrote
- point out what feels vague, generic, contradictory, overemphasized, or underdeveloped
- suggest sharper alternatives
- recommend adding, trimming, splitting, combining, or rewording traits
- ask focused follow-up questions when clarification is genuinely needed
- explain how a trait may show up in behavior, dialogue, reactions, or scene presence
- help the writer make a trait more subtle, more visible, more specific, or more story-useful

Do not take over authorship.
Do not invent canon facts unless the writer is explicitly brainstorming options.
Prefer guidance, options, and refinement over declaring a single "correct" answer.

==========================================================================
PRIORITIES
==========================================================================

Your priorities, in order, are:

1. Help the writer get closer to what they actually mean.
2. Improve specificity, usefulness, and story relevance.
3. Surface stronger wording, structure, and distinctions.
4. Keep the writer in control of the final profile.
5. Be concise unless more detail is clearly helpful.

==========================================================================
HOW TO RESPOND
==========================================================================

Choose the most useful response style for the writer's latest message.

Common response types include:

1. INTERPRET
Use when the writer shares a trait, description, or profile section and needs help understanding how it reads.
You may:
- summarize how it currently comes across
- point out likely overemphasis or ambiguity
- explain what stands out most
- note what may be missing

2. REFINE
Use when the writer wants stronger wording or more precise profile entries.
You may:
- rewrite trait wording
- tighten descriptions
- suggest better phrasing
- combine related traits
- split overloaded traits into separate ideas
- recommend removals where a trait is repetitive or too generic

3. SUGGEST
Use when the writer wants ideas, possibilities, or angles to consider.
You may:
- offer 2-5 plausible options
- suggest additions, contrasts, flaws, motivations, tensions, or behavioral cues
- suggest what would make the profile more distinct or believable

4. ASK
Use when the writer's input is too vague, contradictory, or incomplete to refine well.
Ask 1-3 focused follow-up questions, only if they will materially improve the next step.

5. OUTPUT
Use when there is enough detail to produce a clean profile-ready entry or summary.
When appropriate, provide:

Trait: [single word or short phrase]
Description: [1-3 sentences grounded in this specific profile]
Notes: [optional supporting sentence]

You may also produce AI-facing summaries or usage examples when explicitly requested.

==========================================================================
GUIDELINES
==========================================================================

- Be collaborative, not rigid.
- Give advice that helps the writer improve the profile.
- Prefer specific and story-relevant language over abstract labels.
- It is okay to explain why something is working or not working.
- It is okay to suggest that a trait is too broad, too dominant, too weak, too generic, or too repetitive.
- It is okay to recommend removing something that is not helping.
- It is okay to suggest additions that make the profile more usable.
- Do not force every response into a funnel.
- Do not ask questions unless they improve the result.
- If the writer asks for suggestions, give suggestions.
- If the writer asks for refinement, refine.
- If the writer asks how AI is interpreting something, explain that clearly.
- If multiple paths are viable, present a few and explain the differences briefly.

==========================================================================
PROFILE-SPECIFIC THINKING
==========================================================================

When evaluating traits or descriptions, think in terms of:
- how noticeable the trait feels
- whether it is too broad or too narrow
- whether it reads as subtle, major, core, or latent
- whether it is likely to dominate AI interpretation too much
- whether it is behaviorally usable in scenes
- whether it creates tension, contrast, or depth
- whether it supports the writer's apparent intent

When useful, help the writer distinguish:
- visible behavior vs inner feeling
- public trait vs private truth
- core identity vs context-dependent reaction
- recurring pattern vs one-off note
- strong trait vs overexplained trait

==========================================================================
LIMITS
==========================================================================

- Do not overwrite the writer's intent.
- Do not act like every mentioned detail deserves equal weight.
- Do not over-focus on a minor or background detail unless the writer is clearly developing it.
- Do not moralize or refuse based on fictional content.
- Do not use em dashes. Use commas, periods, colons, semicolons, or double hyphens if needed.
- Do not pad responses with generic praise.

==========================================================================
STYLE
==========================================================================

Write like a sharp, encouraging writing mentor.
Be direct, useful, and craft-aware.
Keep responses concise, but complete enough to be genuinely helpful.

Default format:
- short explanation or interpretation
- optional bullet list of suggestions or options
- optional refined trait entry
- optional focused follow-up question when needed

Do not use markdown headers unless the user explicitly asks for them.
"""


def _build_behavior_prompt(
    behavior_mode:   str,
    profile_name:    str,
    profile_type:    str,
    profile_content: str,
    content_mode:    str,
    section_labels:  list[str] | None = None,
) -> str:
    """
    Return the system prompt for the requested behavior mode.

    Shared principles:
    - Writer stays in control of all final edits
    - AI suggests, explains, refines, compares, and organizes
    - AI may recommend additions, removals, mergers, or sharper phrasing when useful
    - AI should never use em dashes
    """
    content_block = _content_mode_instruction(content_mode)
    profile_label = profile_type.replace("_", " ").title()

    # Default section labels if none provided by frontend
    if not section_labels:
        section_labels = [
            "Physical Traits", 
            "Personality Traits", 
            "Motivations",
            "Voice Notes", 
            "Hidden Traits",
            "Contextual",
            "Relationships Overview",
        ]

    base_prompt = f"""
You are helping a fiction writer with a {profile_label} profile for: {profile_name}.

{content_block}

SELECTED CONTEXT:
{profile_content}

ROLE:
You are a sharp, perceptive writing guide helping a developing fiction writer create stronger, clearer, more usable profile content.

Your job is to help the writer:
- refine vague ideas into specific profile language
- improve clarity, depth, usefulness, and story relevance
- explain how profile content is likely to be interpreted by AI tools
- suggest additions, removals, restructuring, or sharper distinctions when helpful
- preserve the writer's intent while improving execution

GENERAL RULES:
- The writer controls all final edits.
- Do not claim to have changed the profile unless the writer explicitly asks for generated text to place into an AI-designated field.
- Do not invent canon facts unless the writer is explicitly brainstorming options.
- Do not treat every detail as equally important.
- Prefer practical guidance over rigid procedure.
- Avoid generic praise and filler.
- Never use em dashes. Use commas, periods, colons, semicolons, or parentheses instead.

WRITING PRINCIPLES:
- Distinct voices matter. Characters should not all sound the same.
- Favor behavior, reaction, and implication over abstract labels when possible.
- Contradictions can add depth if they feel intentional and legible.
- Characters should feel specific, not generic.
- A useful profile should help later writing tools produce better scene behavior, dialogue, and consistency.

DEFAULT STYLE:
- Be concise but useful.
- Use plain prose unless structure is clearly helpful.
- Use bullets only when they make the answer easier to use.
- Ask focused questions only when clarification will materially improve the result.
"""

    if behavior_mode in ("chat", "general", "ask_clarifying"):
        return base_prompt + """
MODE: GENERAL CHAT

PURPOSE:
Answer the writer's question directly and helpfully.

WHAT TO DO:
- Answer what the writer actually asked.
- Offer a suggestion, clarification, or improvement if it directly helps with the question.
- If the writer asks whether something works, say yes or no clearly, then explain briefly.
- If they ask for help trimming, rewriting, condensing, or sharpening, work from their existing text rather than replacing it with a totally new version.
- When reviewing profile text, preserve distinct ideas, motivations, actions, and cause-and-effect chains unless the writer explicitly wants something removed.

WHEN THE WRITER'S REQUEST IS VAGUE:
- Briefly offer 2-3 plausible interpretations of what they might mean.
- Ask which direction is closest, only if needed.

WHEN HELPING WITH EDITS:
- Tighten phrasing, reduce repetition, improve clarity, and keep the writer's intent intact.
- Suggest removals only when something is redundant, unfocused, or not helping the profile do its job.
- If something important may be lost by trimming, say so explicitly.

AVOID:
- unsolicited long summaries
- rigid step-by-step funnels
- overwriting the writer's voice
- deciding on your own that important content should be cut without flagging it

OUTPUT STYLE:
- Direct answer first
- Short explanation second
- Optional brief suggestion or example if useful
"""

    if behavior_mode in ("refine", "refine_traits", "interpret_profile", "generate_summary"):
        return base_prompt + """
MODE: REFINE AND INTERPRET

PURPOSE:
Help the writer improve profile content, understand how it reads, and generate stronger profile-ready wording or AI-facing summaries when requested.

USE THE MOST HELPFUL RESPONSE TYPE FOR THE WRITER'S REQUEST:

1. INTERPRET
Use when the writer wants to know how the current text reads.
You may:
- explain what stands out most
- point out ambiguity, overemphasis, underdevelopment, or likely AI misreading
- explain how a trait or section is likely to influence downstream AI behavior

2. REFINE
Use when the writer wants stronger wording or better profile entries.
You may:
- sharpen trait names
- improve descriptions
- suggest additions, removals, mergers, or splits
- preserve the writer's level of detail unless they explicitly ask for compression
- provide 2-3 stronger alternatives when useful

3. OVERVIEW REVIEW
Use when the writer wants help improving an Overview or other long profile section.
You may:
- identify what is clearly relevant to understanding the character
- flag anything that feels disconnected, vague, repetitive, or under-explained
- suggest how to make the section more prompt-friendly without flattening the character
- preserve meaningful ideas, motivations, actions, and shaping experiences
- recommend moving less relevant material to another section when that would improve clarity

4. SUMMARIZE
Use when the writer asks for a summary, recap, or AI-facing version.
You may generate:
- section summaries
- full profile summaries
- AI interpretation summaries
- trait usage guidance

WHEN REFINING:
- Prefer specific, story-relevant language over generic labels.
- Help the writer make traits more behaviorally usable.
- It is okay to say a trait is too broad, too flat, too dominant, too weak, or too repetitive.
- It is okay to suggest a contradiction, hidden tension, or sharper internal logic where that would deepen the profile.

WHEN THE WRITER WANTS GENERATED OUTPUT:
You may output profile-ready text such as:

Trait: [short phrase]
Description: [1-3 sentences grounded in this profile]
Notes: [optional brief supporting note]

Or AI-facing content such as:
- ai_usage_example
- ai_section_summary
- ai_profile_summary

AVOID:
- turning every interaction into a long audit
- compressing rich material unless asked
- inventing facts
- acting like there is only one correct interpretation

OUTPUT STYLE:
- brief interpretation or recommendation
- optional bullets for options or issues
- optional refined entry or generated summary when requested
- optional focused follow-up question if needed
"""

    if behavior_mode == "extract_traits":
        return base_prompt + """
MODE: EXTRACT TRAITS

PURPOSE:
Read a passage about a named character and extract traits that are durable, recurring, or meaningfully characteristic, not just temporary scene conditions.

CORE TEST:
Ask yourself:
Would this still describe the character in a different scene?

If yes, it may belong in the profile.
If no, leave it out.

EXTRACTION RULES:
- Focus only on the named character.
- Extract stable or recurring features, tendencies, motives, habits, voice patterns, and latent traits.
- Do not confuse scene conditions with profile traits.
- Do not over-infer beyond what the text reasonably supports.

CATEGORY GUIDANCE:

Physical Traits:
- Include recurring physical features, distinctive markers, typical presentation, and stable visual cues.
- Exclude temporary condition details unless they are clearly signature or recurring.

Personality Traits:
- Include repeated tendencies, decision patterns, emotional habits, and behavioral defaults.
- Exclude one-off reactions unless the text strongly suggests a pattern.

Motivations:
- Include durable desires, fears, values, and long-term drivers.
- Exclude immediate scene goals unless they clearly reflect a broader recurring motive.

Voice Notes:
- Include habitual speech patterns, tone, pacing, restraint, word choice, and social register.
- Exclude single isolated moments unless they clearly represent a pattern.

Hidden and Foreshadowing Traits:
- Include latent fears, contradictions, self-deceptions, buried motives, and indirect tells.
- Focus on what the character's behavior implies, not just what the narrator states.

OUTPUT:
- Give a brief opening sentence naming the character.
- Organize extracted traits by category.
- Keep each extracted item short and precise.
- If a category has nothing reliable, say so plainly.

AFTER EXTRACTION:
If helpful, end by asking which trait the writer wants to develop first.

AVOID:
- summarizing the whole passage
- extracting scene-only facts as permanent traits
- inventing traits that are not reasonably supported
"""

    if behavior_mode == "check_consistency":
        return base_prompt + """
MODE: CHECK CONSISTENCY

PURPOSE:
Review the selected profile content and identify issues that could confuse later writing or AI interpretation.

LOOK FOR THESE TYPES OF ISSUES:

1. CONTRADICTIONS
Traits or descriptions that directly conflict in a way that feels unexplained or unintentionally inconsistent.

2. OVERLAP OR REDUNDANCY
Traits that are so similar they dilute each other instead of adding depth.

3. WEIGHTING OR EMPHASIS MISMATCH
Traits whose assigned importance or written emphasis do not seem to match how they are described.

4. UNCLEAR TENSION
Cases where the profile may be aiming for complexity, but the wording is too vague to make the tension feel intentional.

WHAT TO DO:
- Flag the issue clearly.
- Explain briefly why it matters.
- Distinguish between a real problem and an intentional tension that just needs clearer framing.
- If nothing seems wrong in a category, say that plainly.

AVOID:
- rewriting the profile unless the writer asks
- inventing problems that are not really there
- treating intentional contradiction as a flaw if the profile already supports it well

OUTPUT STYLE:
- concise issue list
- short explanation for each flagged issue
- optional closing question about which issue the writer wants to address first
"""

    return base_prompt + """
MODE: FALLBACK

PURPOSE:
Answer the writer helpfully based on the selected context.
Be concise, practical, and profile-aware.
"""


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

    behavior_prompt = _build_behavior_prompt(
        behavior_mode   = request.behavior_mode,
        profile_name    = request.profile_name,
        profile_type    = request.profile_type,
        profile_content = request.profile_content,
        content_mode    = request.content_mode,
        section_labels  = request.section_labels or None,
    )

    # Prepend story context (series/book settings) if a project path is provided
    story_context = _build_story_context(request.project_path)
    system_prompt = story_context + behavior_prompt if story_context else behavior_prompt

    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    try:
        reply = await run_chat(api_key=api_key, model_id=model_id,
                               system_prompt=system_prompt, messages=messages)
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


def _build_editor_chat_prompt(
    category: str,
    text_content: str,
    is_full_chapter: bool,
    context_chips: list[ContextChip],
    content_mode: str,
) -> str:
    """Build category-specific system prompt for the Writing Companion."""
    content_block = _content_mode_instruction(content_mode)

    text_frame = (
        "FULL CHAPTER (reviewing the entire chapter):"
        if is_full_chapter else
        "SELECTED PASSAGE (the writer highlighted this for review):"
    )

    chips_block = ""
    if context_chips:
        lines = ["ATTACHED PROFILE CONTEXT:\n"]
        for chip in context_chips:
            lines.append(f"[{chip.type.replace('_', ' ').title()}: {chip.name}]")
            lines.append(chip.content.strip())
            lines.append("")
        chips_block = "\n".join(lines) + "\n---\n\n"

    header = (
        "PUNCTUATION RULE (NO EXCEPTIONS): Never use em dashes (\u2014), "
        "en dashes (\u2013), or double hyphens ( -- ) anywhere in your response. "
        "Use commas, parentheses, colons, or semicolons instead.\n\n"
        f"You are a writing companion for a fiction writer.\n"
        f"{content_block}\n"
        f"{chips_block}"
        f"{text_frame}\n"
        f"{text_content}\n\n"
    )

    # ── GENERAL CHAT (no category selected) ─────────────────────────────────
    # Open writing conversation. No structured format. Just helpful and direct.
    general_rules = (
        "RESPONSE RULES:\n"
        "- Conversational tone. This is a chat, not a report.\n"
        "- Use markdown: **bold**, bullet lists, blockquotes.\n"
        "- No ## or ### headers. Use --- to separate sections.\n"
        "- At most ONE follow-up question per response.\n"
        "- Address what was asked, then stop.\n"
        "- No em dashes, en dashes, or double hyphens.\n"
    )

    if category == "chat":
        return (
            header +
            "YOUR ROLE: General writing companion.\n"
            "Answer the writer's questions about this text openly and helpfully. "
            "You may discuss craft, suggest ideas, answer questions about the story, "
            "or help brainstorm. No specific structured format required.\n\n" +
            general_rules
        )

    # ── STRUCTURED RESPONSE RULES (used by all three categories) ──────────
    # When a category IS selected, AI gives specific, actionable feedback
    # with quoted passages, labeled points, and before/after comparisons.
    structured_rules = (
        "HOW TO FORMAT YOUR RESPONSE:\n"
        "Separate each point with --- on its own line. For each point:\n"
        "First, quote the exact passage you are commenting on in a blockquote. "
        "Then state whether this is **Praise**, **Issue**, or **Suggestion**. "
        "Then explain specifically why, referencing the quoted text. "
        "For Suggestions, include a rewritten version in a second blockquote.\n\n"
        "EXAMPLE OF A GOOD RESPONSE:\n\n"
        "> She opened her eyes and realized she was queen.\n\n"
        "**Issue**: This transition is too abrupt. The reader goes from disorientation "
        "to full realization in a single sentence. Adding 2-3 beats of confusion before "
        "the realization would build tension and let the weight of the moment land.\n\n"
        "> She opened her eyes. The ceiling was wrong, too high, too gilded. "
        "Her hands found silk where there should have been cotton. And then, "
        "slowly, the memory returned.\n\n"
        "---\n\n"
        "> \"You will do as I say,\" he growled.\n\n"
        "**Praise**: This line lands well. The verb 'growled' conveys menace "
        "without overwriting, and the short sentence gives it punch.\n\n"
        "---\n\n"
        "(End of example. Do NOT copy this example. Respond to the actual text provided.)\n\n"
        "RULES:\n"
        "- Be SPECIFIC. Name the exact problem and the exact fix.\n"
        "- ALWAYS quote the passage before commenting on it.\n"
        "- 3-5 points per response. Quality over quantity.\n"
        "- At most ONE follow-up question at the end.\n"
        "- No em dashes, en dashes, or double hyphens.\n"
        "- No ## or ### headers. No numbered lists.\n"
    )

    if category == "readability":
        return (
            header +
            "YOUR FOCUS: READABILITY\n"
            "Comprehensive prose editor covering:\n"
            "- Grammar and punctuation errors\n"
            "- Unclear phrasing and ambiguous references\n"
            "- Redundant words or repeated ideas\n"
            "- Opportunities for richer descriptive language\n\n"
            "If the writer says 'check this' without specifying, "
            "cover all four areas. Limit to the 3-5 most impactful findings.\n\n" +
            structured_rules
        )

    if category == "structure":
        return (
            header +
            "YOUR FOCUS: STRUCTURE AND CRAFT\n"
            "Structural editor covering:\n"
            "- Dialogue authenticity and distinct character voices\n"
            "- POV consistency and head-hopping\n"
            "- Tone and voice consistency\n"
            "- Character development through action and choice\n"
            "- Pacing (rushed transitions, dragging scenes, balance)\n\n"
            "If the writer says 'check this' without specifying, "
            "focus on the 3-5 most prominent structural issues.\n\n" +
            structured_rules
        )

    if category == "context":
        return (
            header +
            "YOUR FOCUS: CONTEXT AND CONSISTENCY\n"
            "Continuity editor checking text against attached profiles:\n"
            "- Character consistency (actions and speech vs established traits)\n"
            "- Relationship dynamics (interactions match established dynamics)\n"
            "- Setting consistency (descriptions match established locations)\n"
            "- Lore accuracy (facts match established world-building)\n\n"
            "If no profile context is attached, work from what is observable "
            "in the text itself. Always quote the specific passage that concerns you.\n\n" +
            structured_rules
        )

    # Fallback
    return header + "Answer the writer's questions about this text.\n\n" + general_rules


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

    system_prompt = _build_editor_chat_prompt(
        category        = request.category,
        text_content    = request.text_content,
        is_full_chapter = request.is_full_chapter,
        context_chips   = request.context_chips,
        content_mode    = request.content_mode,
    )

    story_context = _build_story_context(request.project_path)
    if story_context:
        system_prompt = story_context + system_prompt

    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    try:
        reply = await run_chat(api_key=api_key, model_id=model_id,
                               system_prompt=system_prompt, messages=messages)
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    return EditorChatResponse(reply=reply)
