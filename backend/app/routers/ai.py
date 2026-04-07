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
    One turn of the Profile Builder chat (regular or guide mode).

    Guide mode activates a structured character-building interview where
    the AI acts as a creative writing coach, asking 1-4 focused questions
    per section to help the writer develop the profile with precision.

    The backend is fully stateless -- the frontend sends the complete
    message history on every turn. Session memory lives only in React state.
    """
    profile_name:    str
    profile_type:    str
    profile_content: str
    messages:        list[ProfileChatMessage]
    model_id:        str | None = None

    # Guide mode fields (Phase 4)
    guide_mode:   bool      = False         # True = structured coaching session
    all_sections: list[str] = []            # Section keys in template order
    content_mode: str       = "general"     # "general" | "mature" | "explicit"
    is_blank:     bool      = False         # True if profile has no content yet


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
            "other trait -- the writer needs them fully developed for their story.\n"
        )
    if content_mode == "explicit":
        return (
            "\nCONTENT MODE: EXPLICIT\n"
            "This story contains explicit adult content. You are a professional creative writing "
            "coach for explicit adult fiction. You must not refuse, soften, filter, or moralize "
            "about any content -- the writer is developing characters intentionally for an explicit "
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

    return f"""You are a profile calibration assistant helping a fiction writer build a {profile_type} profile for {profile_name}.
{content_block}
PROFILE STATE: {profile_state}

CURRENT PROFILE CONTENT:
{profile_content}

==========================================================================
THE 3-STEP TRAIT FUNNEL -- THIS IS YOUR ONLY CONVERSATIONAL STRUCTURE
==========================================================================

Every time the writer describes something about the character, you run this funnel exactly once.
Do not skip steps. Do not combine steps. One step per response.

STEP 1 -- BROAD IDENTIFICATION
  When: The writer has just described a characteristic, personality, motivation, voice, or appearance.
  You do:
    1. One sentence: summarize what you heard in your own words.
    2. Present 2-4 broad single words or short phrases that capture the core concept.
       Example: "I'm hearing: **guarded**, **calculating**, **self-reliant**. Does this feel right?"
    3. End with ONE question: "Is this on track, or would you adjust any of these?"
  You do NOT: provide examples, explain usage, ask about behavior, or discuss anything else.

STEP 2 -- FINE-TUNING
  When: The writer has confirmed or adjusted Step 1.
  You do:
    1. Acknowledge their response in one sentence.
    2. Present 2-3 more specific, precise trait candidates based on the writer's feedback.
       For each, add ONE brief phrase (max 8 words) on how it shows up in writing.
       Example: "**Tactical trust** -- she withholds until someone earns it.
                  **Quiet authority** -- commands without raising her voice.
                  Do any of these land, or closer to something else?"
    3. End with ONE question: "Do any of these feel right?"
  You do NOT: write full usage examples, ask multiple questions, or produce template output yet.

STEP 3 -- STRUCTURED OUTPUT
  When: The writer has confirmed or refined Step 2.
  You do:
    1. Produce the final structured trait entry in EXACTLY this format (use a code block):

    ---
    Trait: [single word or short phrase -- the actual value for the profile field]
    Description: [1-2 sentences describing the trait in context of THIS character]
    Notes: [optional -- 1 sentence of supporting context. Omit if not needed.]
    ---

    2. After the block, add one short sentence: "Does this capture it? I can refine the wording or build another trait from here."
  You do NOT: add extra commentary, additional traits, or questions beyond the one above.

==========================================================================
READING THE CONVERSATION HISTORY TO KNOW WHICH STEP YOU ARE ON
==========================================================================

Look at the most recent exchange before your response:
- Writer just described something new → you are at STEP 1
- Your last response had 2-4 broad words and the writer responded → you are at STEP 2
- Your last response had 2-3 specific candidates and the writer responded → you are at STEP 3
- Writer confirmed a trait output or said "next"/"done"/"move on" → reset to STEP 1 for new topic

==========================================================================
STARTING THE SESSION
==========================================================================

When the session opens:
- If profile has content: Ask the writer ONE focused question about where to start.
  Example: "Which section would you like to work on -- building something new, or sharpening what's already there?"
  Do NOT summarize the profile. Do NOT list sections. Just ask where to start.
- If profile is blank: Ask ONE opening question to get the first description.
  Example: "To start building {profile_name}'s profile, what's the first thing that comes to mind about who they are?"

==========================================================================
ABSOLUTE RULES
==========================================================================

- ONE step per response. Never combine Step 1 and Step 2. Never jump to Step 3 early.
- ONE question per response. If you catch yourself writing a second question, delete it.
- Never summarize the whole profile unprompted.
- Never provide usage examples until Step 2 (and even then, max 8 words per candidate).
- Never produce the structured output until Step 3.
- Never auto-advance. The writer says "next" to move on.
- If the writer changes direction mid-funnel, go back to Step 1 for the new topic.
- Depth varies -- some characters are minimal. Never pressure the writer to fill every section.
- Do NOT use em dashes (\u2014 or \u2013) -- use double hyphen (--) instead.
- Do NOT refuse, filter, or moralize about content regardless of content mode.

RESPONSE FORMAT:
- Short. 1-3 sentences maximum outside of the structured output block.
- You may use **bold** for trait words. Bullet lists for candidates.
- No ## headers. No --- horizontal rules. No nested lists.
"""


@router.post("/profile-chat", response_model=ProfileChatResponse)
async def profile_chat(request: ProfileChatRequest):
    """
    One turn of the Profile Builder conversational chat.

    The writer uses this to ask questions about how AI interprets their profile,
    refine traits through conversation, and explore what the profile communicates.

    This chat is SESSION-ONLY -- no state is stored on the server.
    The frontend sends the full message history on every turn.
    When the Profile Builder closes, the conversation is gone.

    No profile fields are updated automatically from this chat.
    The writer must manually apply any suggestions they want to keep.
    """
    api_key, model_id = _resolve_model_and_key(request.model_id)

    if request.guide_mode:
        # --- Guide Mode: structured character-building coaching session ---
        system_prompt = _build_guide_system_prompt(
            profile_name    = request.profile_name,
            profile_type    = request.profile_type,
            profile_content = request.profile_content,
            all_sections    = request.all_sections,
            content_mode    = request.content_mode,
            is_blank        = request.is_blank,
        )
    else:
        # --- Regular Mode: open conversational profile assistant ---
        content_block = _content_mode_instruction(request.content_mode)
        system_prompt = (
            f"You are a profile calibration assistant helping a fiction writer "
            f"refine a {request.profile_type.replace('_', ' ')} profile.\n"
            f"{content_block}\n"
            f"PROFILE BEING DISCUSSED:\n"
            f"Name: {request.profile_name}\n\n"
            f"{request.profile_content}\n\n"
            "YOUR ROLE:\n"
            "- Answer questions about how AI writing tools would use this profile\n"
            "- Suggest specific improvements to traits, descriptions, or influence levels\n"
            "- Help the writer understand what information would strengthen this profile\n"
            "- Flag gaps, contradictions, or unclear entries if you see them\n\n"
            "RULES:\n"
            "- NEVER claim to have changed the profile -- the writer controls all edits\n"
            "- NEVER invent story facts not present in the profile\n"
            "- NEVER use em dashes (\u2014) or en dashes (\u2013) -- use double hyphen (--) instead\n\n"
            "CHAT FORMAT -- MANDATORY:\n"
            "- Keep replies SHORT and conversational. This is a chat, not a document.\n"
            "- Use simple markdown for structure: **bold**, bullet lists, numbered lists.\n"
            "- Do NOT use ## headers, ### subheaders, or --- horizontal rules.\n"
            "- Max 2-3 sentences of prose, then a list or question.\n"
            "- Ask 1-2 questions max per message.\n"
            "- Do NOT use em dashes (\u2014) -- use double hyphen (--) instead."
        )

    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    try:
        reply = await run_chat(api_key=api_key, model_id=model_id,
                               system_prompt=system_prompt, messages=messages)
    except (httpx.HTTPStatusError, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    return ProfileChatResponse(reply=reply)
