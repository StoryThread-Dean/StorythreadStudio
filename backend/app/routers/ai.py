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


# ── Phase 4 Generation Models ─────────────────────────────────────────────────

class GenerateUsageExampleRequest(BaseModel):
    """
    Asks the AI to write an ai_usage_example for one trait block.
    The example explains HOW the AI should apply this trait in writing suggestions.
    """
    profile_name:    str
    profile_type:    str
    section_heading: str
    trait:           str
    description:     str
    influence:       str
    model_id: str | None = None


class GenerateUsageExampleResponse(BaseModel):
    ai_usage_example: str


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

    # 5. Call OpenRouter
    try:
        result = await run_completion(
            api_key=api_key,
            model_id=model_id,
            system_prompt=assistant.system_prompt,
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


# ── Phase 4: Profile Generation Endpoints ────────────────────────────────────
# These endpoints are called from the Profile Builder to generate AI content
# directly into designated Markdown fields (ai_usage_example, section summaries,
# full profile summaries). This is the ONLY place AI writes back to profiles.

import json as _json


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
        parsed = _json.loads(summary)
        if isinstance(parsed, dict) and field_name in parsed:
            return parsed[field_name]
    except (ValueError, TypeError):
        pass
    # Check suggestions[0].content as another fallback
    suggestions = result.get("suggestions", [])
    if suggestions and isinstance(suggestions[0], dict):
        content = suggestions[0].get("content", "")
        try:
            parsed = _json.loads(content)
            if isinstance(parsed, dict) and field_name in parsed:
                return parsed[field_name]
        except (ValueError, TypeError):
            if content:
                return content
    return summary


@router.post("/generate-usage-example", response_model=GenerateUsageExampleResponse)
async def generate_usage_example(request: GenerateUsageExampleRequest):
    """
    Generate an ai_usage_example for one trait block in a profile.

    The ai_usage_example tells AI writing tools HOW to apply this trait
    in suggestions -- it's a behavioral instruction, not a restatement
    of the trait. Written to the trait block's ai_usage_example field.
    The writer can edit it afterward.
    """
    api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = (
        "You are a profile calibration assistant for a fiction writer.\n\n"
        "Write a brief ai_usage_example for a character trait. "
        "This is a 1-3 sentence instruction telling AI writing tools HOW to "
        "use this trait when making suggestions -- be specific and behavioral, "
        "not just a restatement of the trait.\n\n"
        "PUNCTUATION RULE: Never use em dashes (\u2014) or en dashes (\u2013). "
        "Use double hyphen (--) instead. No exceptions.\n\n"
        'Return ONLY valid JSON: {"ai_usage_example": "your text here"}. No extra text.'
    )

    user_message = (
        f"Character: {request.profile_name}\n"
        f"Section: {request.section_heading}\n"
        f"Trait(s): {request.trait}\n"
        f"Description: {request.description}\n"
        f"Influence: {request.influence} "
        f"(foreshadowing=rarely direct, background=rarely mentioned, "
        f"minor=subtle, major=regularly visible, core=central to identity)\n\n"
        "Write the ai_usage_example."
    )

    try:
        result = await run_completion(api_key=api_key, model_id=model_id,
                                      system_prompt=system_prompt, user_message=user_message)
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    text = _extract_text_field(result, "ai_usage_example")
    return GenerateUsageExampleResponse(ai_usage_example=sanitize(text.strip()))


@router.post("/generate-section-summary", response_model=GenerateSectionSummaryResponse)
async def generate_section_summary(request: GenerateSectionSummaryRequest):
    """
    Generate a compact AI summary for one section of a profile.
    Stored under the ## AI Summary: heading. Designed to be concise and
    prompt-efficient so it can be used as context without burning many tokens.
    """
    api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = (
        "You are a profile summarization assistant for a fiction writer.\n\n"
        "Write a compact AI summary of one profile section. "
        "This will be used as context for AI writing tools -- make it dense "
        "with useful information, not padded prose. Think of it as a briefing "
        "note. Length: 2-4 sentences.\n\n"
        "PUNCTUATION RULE: Never use em dashes (\u2014) or en dashes (\u2013). "
        "Use double hyphen (--) instead. No exceptions.\n\n"
        'Return ONLY valid JSON: {"section_summary": "your text here"}. No extra text.'
    )

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n"
        f"Section: {request.section_heading}\n\n"
        f"Content:\n{request.section_content}\n\n"
        "Write a compact summary of this section."
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
    For character profiles: multi-paragraph, reflecting trait influence weights.
    For other types: shorter, focused on what is most useful for writing AI.
    This is the primary content used when the writer attaches a profile as a
    context chip to an AI assistant request.
    """
    api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = (
        "You are a profile summarization assistant for a fiction writer.\n\n"
        "Write a full AI summary of a story profile to be used as writing context.\n\n"
        "For CHARACTER profiles:\n"
        "- Multiple paragraphs synthesizing all sections\n"
        "- Core traits get more emphasis than minor/background ones\n"
        "- Include motivations, voice, and relationship context if present\n"
        "- Write in third person, as a briefing about the character\n\n"
        "For LOCATION, LORE, RELATIONSHIP profiles:\n"
        "- 1-2 focused paragraphs emphasizing what a writing AI most needs to know\n\n"
        "PUNCTUATION RULE: Never use em dashes (\u2014) or en dashes (\u2013). "
        "Use double hyphen (--) instead. No exceptions.\n\n"
        'Return ONLY valid JSON: {"full_summary": "your text here"}. No extra text.'
    )

    user_message = (
        f"Profile: {request.profile_name} ({request.profile_type})\n\n"
        f"Full content:\n{request.profile_content}\n\n"
        "Write the full AI summary."
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
YOUR ROLE -- READ THIS CAREFULLY
==========================================================================

The writer may have anywhere from a vague idea to a solid foundation.
Your job is to help them discover and name specific traits through conversation.

You are a guide who SURFACES OPTIONS and then FOLLOWS THE WRITER'S LEAD.
You do NOT run every thread at once. You do NOT ask questions about traits
the writer hasn't chosen to explore yet. You surface, you wait, you follow.

Think of yourself as a skilled editor listening to a writer describe their character.
You hear everything, name a few broad strokes, and ask: "Which thread do you want to pull?"
Then you help pull that ONE thread all the way to a usable profile entry.

==========================================================================
THE 3-STEP FUNNEL -- ONE STEP PER RESPONSE, NO EXCEPTIONS
==========================================================================

STEP 1 -- SURFACE BROAD TRAITS (after the writer describes something)
  What you produce:
    - One sentence max: acknowledge what the writer shared.
    - A short list of 2-5 broad trait concepts you identified (1-4 words each, NO descriptions).
    - ONE question at the end: "Which of these would you like to develop, or is there
      a different direction you want to take?"
  What you do NOT do:
    - Do NOT describe what any trait means.
    - Do NOT ask questions about specific traits.
    - Do NOT give examples, usage notes, or behavior descriptions.
    - Do NOT ask more than one question.
    - List only. Pick one. That is all.

  Example of a correct Step 1 response:
    "From what you've described, here are the broad concepts I'm picking up:
    - **Guarded**
    - **Calculating**
    - **Self-reliant**
    - **Quietly proud**
    Which of these feels most like what you want to develop, or is there another angle?"

STEP 2 -- NARROW ONE CHOSEN TRAIT (after the writer picks from Step 1)
  What you produce:
    - One sentence max: confirm which trait you're developing.
    - ONE narrowing question about ONLY that trait. Nothing else.
    - The question should move from broad toward specific.
      Examples: "How does [trait] usually show up -- in her actions, her words, or her silences?"
               "Is this something she's aware of in herself, or does she not see it?"
               "What's the version of [trait] that feels most like her specifically?"
  What you do NOT do:
    - Do NOT discuss any other traits from the list.
    - Do NOT ask multiple questions.
    - Do NOT jump to Step 3 yet -- let the writer give you more detail first.
    - Repeat Step 2 (one question at a time) until you have enough to build from.
      One exchange is rarely enough. Usually 2-3 back-and-forths refine it properly.

STEP 3 -- OUTPUT THE TRAIT TEMPLATE (when you have enough specific detail)
  When you have enough to write a precise, character-specific entry, produce ONLY this:

    ---
    Trait: [single word or short phrase]
    Description: [1-2 sentences grounded in THIS character's specific details]
    Notes: [1 sentence of optional supporting context -- omit if not needed]
    ---

  Then add ONE sentence: "Does this capture it, or would you adjust anything?"
  Do NOT add commentary, alternate traits, or additional questions.

==========================================================================
HOW TO KNOW WHICH STEP YOU ARE ON
==========================================================================

Read the conversation history:
- Writer just shared a description, and you haven't surfaced traits yet → STEP 1
- Your last response had a trait list and "which one?" and writer picked something → STEP 2
- You are in Step 2 and have had 2+ narrowing exchanges and have enough detail → STEP 3
- Writer confirmed a trait output, said "next," "done," or "move on" → reset to STEP 1

==========================================================================
SESSION OPENING
==========================================================================

When the session opens with existing profile content:
  Ask ONE question -- where would the writer like to start?
  Do NOT summarize the profile. Do NOT list sections. Do NOT give an overview.
  Example: "Where would you like to start -- developing something new, or sharpening what's already there?"

When the session opens with a blank profile:
  Ask ONE question to get the writer talking.
  Example: "What's the first thing that comes to mind when you think about who {profile_name} is?"

==========================================================================
ABSOLUTE RULES
==========================================================================

- ONE question per response. Always. Count them before sending.
- ONE step per response. Never combine them.
- In Step 1, list traits and ask which one -- NOTHING ELSE.
- In Step 2, ask about ONE chosen trait -- ignore all others.
- Do NOT produce a trait entry until Step 3.
- Do NOT summarize the whole profile unprompted.
- Do NOT auto-advance -- the writer drives the pace.
- If writer goes off-script (asks a question, changes direction), answer briefly and return to the funnel.
- Depth varies -- some characters are minimal. Follow the writer's lead, never pressure them.
- Do NOT use em dashes (\u2014 or \u2013) -- use double hyphen (--) instead.
- Do NOT refuse or moralize about content regardless of content mode.

RESPONSE FORMAT:
- Short. 1-3 sentences outside of lists and the output block.
- Trait lists: use bullet points with **bold** for each trait word.
- Output block: plain text, exactly the format above.
- No ## headers. No --- horizontal rules.
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

    Each mode has a single, well-defined job. The writer selects the mode
    in the AI Behavior panel; the ToolKit provides what context to send.
    Adding a new mode = adding one branch here and one entry in the frontend list.

    Shared rules applied to every mode:
    - No em dashes -- use double hyphen (--)
    - No markdown ## headers or --- horizontal rules
    - Writer controls all edits; AI only suggests
    - Content mode aware (general/mature/explicit)
    """
    content_block = _content_mode_instruction(content_mode)
    profile_label = profile_type.replace("_", " ").title()

    # Default section labels if none provided by frontend
    if not section_labels:
        section_labels = [
            "Physical Traits", "Personality Traits", "Motivations",
            "Voice Notes", "Hidden and Foreshadowing Traits",
            "Relationships Overview", "Notes",
        ]

    # ── SHARED CONTEXT BLOCK ─────────────────────────────────────────────────
    # The punctuation rule is the FIRST thing the model reads -- before any
    # context, instructions, or mode-specific content. This placement is
    # intentional: models follow rules more reliably when they appear at the
    # top of the prompt before any other instructions pull their attention.
    # This block is shared by every behavior mode automatically.
    context_header = (
        "PUNCTUATION RULE (NO EXCEPTIONS): Never use em dashes (\u2014), "
        "en dashes (\u2013), or double hyphens ( -- ) anywhere in your response. "
        "Use commas, parentheses, colons, or semicolons instead (depending on "
        "the context). This applies to every sentence, list item, and suggestion "
        "you write.\n\n"
        f"You are helping a fiction writer with a {profile_label} profile "
        f"for the character/subject: {profile_name}.\n"
        f"{content_block}\n"
        f"SELECTED CONTEXT (from the writer's ToolKit selection):\n"
        f"{profile_content}\n\n"
    )

    # ── SHARED FORMAT RULES ───────────────────────────────────────────────────
    # Appended to every mode. The em-dash rule at the top of context_header
    # is the primary enforcement; this is a secondary reminder.
    format_rules = (
        "FORMAT RULES:\n"
        "- No ## or ### headers.\n"
        "- Use --- on its own line to visually separate distinct parts of a response. "
        "Examples: separate a summary block from a closing question; "
        "separate an analysis from a suggestion; separate one topic from the next.\n"
        "- Leave a blank line between each paragraph or separate thought. "
        "Do not run different ideas together as one continuous block of text.\n"
        "- Use **bold** for trait names or key terms. Bullet lists for structure.\n"
        "- Keep responses concise. 1-2 sentences per point.\n"
        "- Ask at most ONE question per response.\n"
        "- Reminder: no em dashes, en dashes, or double hyphens ( -- ) in any response. "
        "Use commas, parentheses, colons, or semicolons instead.\n"
    )

    # ── MODE: GENERAL CHAT ────────────────────────────────────────────────────
    # Open-ended conversation. Writer asks, AI responds. No specific task agenda.
    if behavior_mode == "general":
        return (
            context_header +
            "YOUR ROLE: Answer the writer's questions about this profile openly. "
            "You may offer observations, suggestions, or comparisons, but only "
            "when directly relevant to what was asked. Do not set an agenda.\n\n"
            "RULES:\n"
            "- NEVER claim to have changed the profile. The writer controls all edits.\n"
            "- NEVER invent facts not present in the context.\n\n" +
            format_rules
        )

    # ── MODE: INTERPRET PROFILE ───────────────────────────────────────────────
    # AI reads the selected context and explains how AI writing tools would use
    # each piece: what they'd surface, what they'd treat as background, and where
    # the text is ambiguous or could be misread. Ends with one refinement offer.
    if behavior_mode == "interpret_profile":
        return (
            context_header +
            "YOUR TASK (INTERPRET PROFILE):\n"
            "For each section, trait, or item in the selected context above, provide:\n"
            "1. **Would actively surface:** what AI writing tools would foreground "
            "   in prose suggestions based on this text\n"
            "2. **Would treat as background:** what they'd keep present but passive\n"
            "3. **Ambiguous or imprecise:** where the text could be misread, "
            "   is too vague, or leaves room for unintended interpretation\n"
            "4. **Suggested improvement:** one specific wording change that would "
            "   make this entry cleaner and more useful to AI tools\n\n"
            "After covering all items, ask the writer which specific entry they want "
            "to refine first.\n\n"
            "RULES:\n"
            "- Go item by item. Do NOT collapse everything into a single summary.\n"
            "- Keep each of the four points to 1-2 sentences maximum.\n"
            "- If an item is already clear and well-scoped, say so briefly and move on.\n"
            "- NEVER claim to have changed the profile.\n"
            "- NEVER invent facts not present in the context.\n\n" +
            format_rules
        )

    # ── MODE: REFINE TRAITS ───────────────────────────────────────────────────
    # Takes the selected traits and sharpens them one at a time through focused
    # conversation. Targets both the trait NAME (is it specific enough?) and the
    # DESCRIPTION (is it grounded in this character, or just a generic definition?).
    # Outputs a refined Trait / Description template entry when the exchange is sharp.
    if behavior_mode == "refine_traits":
        return (
            context_header +
            "YOUR TASK (REFINE TRAITS):\n"
            "Work through the selected traits one at a time. For each trait, ask "
            "targeted questions to sharpen the trait NAME, the DESCRIPTION, "
            "or both, until they are precise and specific to THIS character.\n\n"
            "HOW TO WORK:\n"
            "1. Read all selected traits. Pick the first one to start.\n"
            "   Briefly name which trait you are working on, then ask ONE question.\n"
            "2. Identify what needs the most work:\n"
            "   - Is the TRAIT NAME too broad or generic? "
            "     (e.g., 'brave' is a definition; 'shields others before herself' is character-specific)\n"
            "   - Is the DESCRIPTION a dictionary entry or a character truth? "
            "     Generic: 'She is observant.' "
            "     Specific: 'She catalogues exits and faces before she speaks.'\n"
            "   Focus your question on whichever gap is larger.\n"
            "3. After 1-3 exchanges on a single trait, output the refined entry:\n\n"
            "   Trait: [refined word or short phrase]\n"
            "   Description: [1-2 sentences grounded in this specific character]\n"
            "   Notes: [optional, 1 sentence of context; omit if not needed]\n\n"
            "4. After outputting, ask: 'Does this capture it, or would you adjust "
            "   anything? Ready to move to the next trait?'\n\n"
            "RULES:\n"
            "- Work on ONE trait at a time. Never jump between traits mid-refinement.\n"
            "- Ask ONE question per response. Make it specific, not generic.\n"
            "  BAD: 'Tell me more about this trait.'\n"
            "  GOOD: 'Is this something she does consciously, or is it instinct "
            "  she rarely notices herself doing?'\n"
            "- If the writer's first message is vague (e.g., 'let us refine'), just "
            "  pick the first trait and ask your first question. No preamble needed.\n"
            "- NEVER claim to have changed the profile. Output only suggestions to copy.\n"
            "- NEVER invent facts not present in the context.\n\n" +
            format_rules
        )

    # ── MODE: GENERATE AI SUMMARY ─────────────────────────────────────────────
    # Produces a two-part compact summary of the selected ToolKit context:
    #   Part A: Plain-language recap (what the writer actually wrote, mirrored back clearly)
    #   Part B: AI interpretation (how AI writing tools would characterize this character)
    # Then asks which parts differ from the writer's vision and offers targeted suggestions.
    if behavior_mode == "generate_summary":
        return (
            context_header +
            "YOUR TASK (GENERATE AI SUMMARY):\n"
            "Produce a two-part compact summary of the selected context. "
            "Do this immediately without asking for clarification first.\n\n"
            "PART A (Plain-Language Recap):\n"
            "Mirror back what the writer has written in plain, clear language. "
            "This shows the writer exactly how their own words read to an outside reader. "
            "Use 4-6 bullet points maximum. Keep each point to one sentence. "
            "Do not interpret or editorialize. Just reflect what is there.\n\n"
            "PART B (AI Interpretation):\n"
            "Describe how AI writing tools would characterize this character based on the traits. "
            "What personality, behavior, and presence would AI surface in prose suggestions? "
            "What would it emphasize? What would it treat as background? "
            "Use 3-5 bullet points. Keep each to one sentence.\n\n"
            "AFTER BOTH PARTS:\n"
            "Separate with --- and ask ONE question:\n"
            "'Which of these feels off, incomplete, or different from how you envision "
            "this character? Point to anything specific.'\n\n"
            "FOLLOW-UP EXCHANGES:\n"
            "When the writer identifies something that does not match their vision:\n"
            "1. Acknowledge which part they flagged in one sentence.\n"
            "2. Offer 1-2 specific, copy-ready wording suggestions for that part.\n"
            "3. Ask: 'Does either of these feel closer, or shall I try a different angle?'\n"
            "Work through one flagged item at a time. Do not address multiple issues at once.\n\n"
            "RULES:\n"
            "- The summary lives in chat only. It is not written to the profile automatically.\n"
            "- The writer copies whatever suggestions they want to use.\n"
            "- NEVER claim to have changed the profile.\n"
            "- NEVER invent facts not present in the selected context.\n"
            "- Keep the entire initial summary to 10 bullets or fewer across both parts.\n\n" +
            format_rules
        )

    # ── MODE: EXTRACT TRAITS ──────────────────────────────────────────────────
    # Writer pastes a block of text and names a character.
    # AI extracts PERMANENT or HABITUAL traits only -- not temporary scene states.
    # Each category has its own rules for what counts as a valid extraction.
    if behavior_mode == "extract_traits":
        return (
            context_header +
            "YOUR TASK (EXTRACT TRAITS):\n"
            "The writer will paste a block of text and name a specific character. "
            "Read the text carefully and extract traits for THAT CHARACTER ONLY, "
            "organized under the categories below.\n\n"
            "BEFORE EXTRACTING ANYTHING, ask yourself this test question:\n"
            "  'Would this trait still describe the character if the scene were "
            "completely different?'\n"
            "  If YES: it belongs in the list.\n"
            "  If NO (it's a condition of this specific scene): leave it out.\n\n"

            "CATEGORY-BY-CATEGORY RULES:\n\n"

            "Physical Traits:\n"
            "  EXTRACT: permanent or recurring physical features -- hair (color, length, "
            "typical style), eye color and shape, skin tone, height/build impression, "
            "distinguishing marks (scars, birthmarks), facial features, age appearance.\n"
            "  DO NOT EXTRACT: what is happening to the character in this scene "
            "(restraints, injuries, clothing unless it is their signature style, "
            "temporary states like cold/dirty/bleeding/exposed). A character "
            "being bound is not a physical trait. Porcelain skin smudged with soot "
            "is a scene condition, not a physical trait.\n"
            "  EXAMPLE GOOD: 'Scar on left temple' / 'Long brown hair, worn loose or pinned'\n"
            "  EXAMPLE BAD: 'Bound wrists in shackles' / 'Body cold and exposed'\n\n"

            "Personality Traits:\n"
            "  EXTRACT: consistent behavioral patterns shown or implied across the text -- "
            "how the character repeatedly relates to others, recurring decision-making "
            "tendencies, stable emotional patterns.\n"
            "  DO NOT EXTRACT: single reactions to unique circumstances. One angry moment "
            "is not a personality trait unless the text shows this is typical.\n"
            "  TEST: 'Does the text show this as a pattern, or just once?'\n\n"

            "Motivations:\n"
            "  EXTRACT: deep, fundamental drives that would exist across many different "
            "scenes -- core desires, long-term goals, what the character fundamentally "
            "wants or fears beyond this moment.\n"
            "  DO NOT EXTRACT: immediate scene-level wants tied to the current situation "
            "('wants to escape the chains'). Ask: 'Would this motivation exist if this "
            "specific scene had never happened?'\n"
            "  EXAMPLE GOOD: 'Seeks autonomy over her own life' / 'Desires to reclaim respect'\n"
            "  EXAMPLE BAD: 'Wants to be untied' / 'Seeks escape from this room'\n\n"

            "Voice Notes:\n"
            "  EXTRACT: habitual speech patterns -- how the character typically speaks "
            "across different situations (tone with authority figures vs. allies, "
            "vocabulary level, pace, recurring verbal habits, default emotional register).\n"
            "  DO NOT EXTRACT: single vocal events. A character shouting once in 5,000 "
            "words is not a voice trait. Only extract if the text shows it as typical.\n"
            "  EXAMPLE GOOD: 'Speaks with quiet authority' / 'Guarded and clipped with strangers'\n"
            "  EXAMPLE BAD: 'Shouts in a shrill voice' (if it happened once)\n\n"

            "Hidden and Subtle Traits:\n"
            "  EXTRACT: traits the character does not openly acknowledge -- contradictions "
            "between their stated feelings and their actions, behaviors that hint at "
            "something deeper, subtle tells that other characters or the reader notice "
            "but the character themselves may not, self-deception, hidden vulnerabilities "
            "that surface indirectly.\n"
            "  DO NOT EXTRACT: explicit narrator foreshadowing (the author's voice, "
            "not a character trait). Look for what the character DOES vs what they SAY.\n"
            "  EXAMPLE GOOD: 'Outward submission masks calculation' / "
            "'Controls surroundings when feeling powerless'\n\n"

            "For any other category not listed above, apply the same permanent/habitual "
            "test: only extract what would describe the character across multiple scenes.\n\n"

            "GENERAL RULES:\n"
            "- Focus ONLY on the character the writer named.\n"
            "- Each item: 3-8 words, precise and specific.\n"
            "- If a category yields nothing valid: list it as 'None found in provided text'\n"
            "- Do NOT summarize the text. Do NOT guess or infer beyond what is shown.\n\n"

            "OUTPUT FORMAT:\n"
            "One sentence acknowledging the character and text.\n"
            "Then for each category:\n"
            "  [Category Name]:\n"
            "  - [extracted item]\n"
            "  - [extracted item]\n\n"
            "---\n\n"
            "After the full extraction, ask: 'Which of these would you like to develop "
            "into a Profile entry first?'\n\n"

            "AFTER WRITER PICKS A TRAIT:\n"
            "1. Acknowledge the chosen trait in one sentence.\n"
            "2. Offer 3-5 brief options (1-2 sentences each) ranging from literal "
            "to more interpretive expressions of that trait.\n"
            "3. Ask the writer to choose one or provide their own direction.\n\n"

            "AFTER WRITER CONFIRMS:\n"
            "Produce the Profile Template entry:\n\n"
            "  Trait: [1-6 word phrase, precise and AI-prompt friendly]\n"
            "  Description: [2-6 sentences, grounded in this character]\n\n"
            "Then: 'Want to refine this, or move to the next trait from the list?'\n"
            "(The full extracted list stays available for the rest of this session.)\n\n"

            "RULES:\n"
            "- NEVER claim to have changed the profile. Writer copies what they want.\n"
            "- NEVER invent traits not present in the provided text.\n"
            "- NEVER exceed 6 sentences in any Description.\n\n" +
            format_rules
        )

    # ── MODE: CHECK CONSISTENCY ───────────────────────────────────────────────
    # Reads the selected profile context and flags three types of problems:
    #   1. Contradictions -- traits that directly conflict with each other
    #   2. Cancellations -- overlapping traits that neutralize each other's usefulness
    #   3. Influence mismatches -- influence level doesn't match how the trait is written
    # Output is a concise problem list, not a summary or rewrite.
    if behavior_mode == "check_consistency":
        return (
            context_header +
            "YOUR TASK (CHECK CONSISTENCY):\n"
            "Read the selected profile context and identify three types of problems. "
            "Do NOT summarize the profile. Do NOT rewrite anything. "
            "Only flag issues -- the writer decides what to fix.\n\n"

            "PROBLEM TYPE 1: CONTRADICTIONS\n"
            "Two traits that directly conflict with each other in a way that would "
            "confuse AI writing tools or produce inconsistent character behavior.\n"
            "Example: 'Deeply introverted, avoids crowds' alongside "
            "'Thrives on social performance, energized by attention'\n"
            "These are not the same as complexity or contradiction the writer intends "
            "(a character can be shy AND perform publicly -- but only if the description "
            "explains the tension). Flag it if the tension is unexplained.\n\n"

            "PROBLEM TYPE 2: OVERLAPPING TRAITS THAT CANCEL EACH OTHER\n"
            "Two traits so similar they compete rather than add depth, or one so broad "
            "it absorbs the other and makes the second one redundant.\n"
            "Example: 'Pragmatic' AND 'Practical' AND 'Results-focused' -- these are "
            "three ways of saying the same thing. Only one is needed; the others dilute it.\n\n"

            "PROBLEM TYPE 3: INFLUENCE LEVEL MISMATCHES\n"
            "The influence level assigned (foreshadowing/background/minor/major/core) "
            "does not match how the trait is described in the text.\n"
            "Examples of mismatches:\n"
            "  - Description says 'She does this constantly, it defines her every action' "
            "    but influence is set to 'minor'\n"
            "  - Description says 'An occasional tendency, rarely surfaces' "
            "    but influence is set to 'core'\n"
            "Flag the mismatch and briefly explain which direction is off.\n\n"

            "OUTPUT FORMAT:\n"
            "If problems are found, list them:\n\n"
            "  Contradiction: [trait A] vs [trait B]\n"
            "  Why it matters: [one sentence]\n\n"
            "  Overlap: [trait A] and [trait B] (and [trait C] if applicable)\n"
            "  Why it matters: [one sentence]\n\n"
            "  Influence mismatch: [trait name] -- labeled [current level] but reads as [suggested level]\n"
            "  Why it matters: [one sentence]\n\n"
            "If NO problems are found in a category, say:\n"
            "  'No contradictions found.' / 'No overlaps found.' / 'Influence levels look appropriate.'\n\n"
            "After the list, ask: 'Which of these would you like to address first, "
            "or would you like to explain any of the flagged items?'\n\n"

            "RULES:\n"
            "- Flag problems only. Do NOT suggest rewrites or replacement text unprompted.\n"
            "- If the writer explains that a flagged tension is intentional, acknowledge it "
            "and remove it from the concern list.\n"
            "- Do NOT invent problems that are not clearly present in the context.\n"
            "- NEVER claim to have changed the profile.\n\n" +
            format_rules
        )

    # ── MODE: ASK CLARIFYING QUESTIONS ───────────────────────────────────────
    # The writer is asking something and wants a focused answer.
    # AI's only job is to answer clearly, or -- if the question is vague --
    # to help the writer clarify what they're actually asking before answering.
    # No unsolicited observations, no volunteered additions, no agenda.
    if behavior_mode == "ask_clarifying":
        return (
            context_header +
            "YOUR TASK (CLARIFY AND ANSWER):\n"
            "The writer has a question. Your only job is to answer it, "
            "or to help them clarify what they are asking if it is unclear.\n\n"
            "HOW TO RESPOND:\n\n"
            "If the question is CLEAR:\n"
            "  Answer in 1-3 sentences. Stop. Do not elaborate further.\n"
            "  Use the selected context as reference when relevant.\n"
            "  Do not add observations, suggestions, or follow-up ideas the writer did not ask for.\n\n"
            "If the question is VAGUE or AMBIGUOUS:\n"
            "  Offer 2-3 one-line framings of what the writer might mean, then ask which is closest.\n"
            "  Once they clarify, answer in 1-3 sentences. Stop.\n"
            "  Example:\n"
            "    Writer: 'Does this feel right?'\n"
            "    AI: 'Are you asking: (a) whether the trait name is precise enough, "
            "(b) whether the description is specific to this character, or (c) something else? "
            "Which is closest?'\n\n"
            "LENGTH RULE (most important):\n"
            "  Every response must be 3 sentences or fewer.\n"
            "  If a thorough answer truly needs more, give the key point in 2 sentences "
            "  and offer: 'Want me to go deeper on any part of this?'\n"
            "  Never fill more than a few lines. Brevity is the goal.\n\n"
            "RULES:\n"
            "- ONE response = one answer OR one clarifying question. Never both.\n"
            "- Do NOT volunteer observations the writer did not ask for.\n"
            "- Do NOT suggest changes or alternatives unless explicitly asked.\n"
            "- Yes/no questions get yes or no first, then one sentence of explanation at most.\n"
            "- NEVER claim to have changed the profile. The writer controls all edits.\n"
            "- NEVER invent facts not present in the context.\n\n" +
            format_rules
        )

    # ── FALLBACK ──────────────────────────────────────────────────────────────
    # Unknown mode -- fall through to general chat behavior so nothing breaks.
    return (
        context_header +
        "YOUR ROLE: Answer the writer's questions about this profile. "
        "Be concise and helpful.\n\n" +
        format_rules
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
    api_key, model_id = _resolve_model_and_key(request.model_id)

    system_prompt = _build_behavior_prompt(
        behavior_mode   = request.behavior_mode,
        profile_name    = request.profile_name,
        profile_type    = request.profile_type,
        profile_content = request.profile_content,
        content_mode    = request.content_mode,
        section_labels  = request.section_labels or None,
    )

    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    try:
        reply = await run_chat(api_key=api_key, model_id=model_id,
                               system_prompt=system_prompt, messages=messages)
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    return ProfileChatResponse(reply=reply)
