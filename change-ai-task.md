# Writing Assistant AI Stabilization Plan

## Problem

AI responses are inconsistent due to three root causes:
1. **Contradictory punctuation rules** across prompts (some say "use double hyphen," others say "never use double hyphen")
2. **Story text stuffed into system prompts** instead of user messages -- models confuse content with instructions
3. **No unified identity** -- each mode reinvents the AI's persona, causing tone/format drift

## Architecture Principle

**One stable identity, multiple modes.** Every AI interaction shares one base contract. Modes are short addenda. System prompts contain ONLY instructions. All variable content (selected text, context chips, chapters) goes into user messages.

---

## File Changes

| File | Action | Purpose |
|------|--------|---------|
| `app/ai/prompts.py` | **CREATE** | Single source of truth for all system prompts |
| `app/ai/openrouter.py` | **MODIFY** | Add optional `temperature` parameter |
| `app/routers/ai.py` | **MODIFY** | Import from `prompts.py`, restructure message construction, delete inline prompts |

**Implementation order:** `prompts.py` → `openrouter.py` → `ai.py`

---

## Task 1: Create `app/ai/prompts.py`

This file holds ALL system prompt text. After this refactor, `ai.py` contains ZERO multi-line prompt strings.

### 1.1 Unified punctuation rule constant

```python
PUNCTUATION_RULE = (
    "PUNCTUATION RULE (NO EXCEPTIONS): "
    "Never use em dashes (\u2014) or en dashes (\u2013). "
    "Use commas, periods, colons, semicolons, or parentheses instead. "
    "Do not use double hyphens ( -- ) as a substitute."
)
Every prompt in this file must reference this constant instead of writing its own version.

1.2 Temperature defaults

TEMPERATURE_DEFAULTS = {
    "critique":    0.3,
    "generation":  0.7,
    "profile":     0.5,
    "extraction":  0.3,
}
1.3 Content mode instruction
Move _content_mode_instruction() from ai.py into prompts.py as content_mode_instruction(). Logic unchanged.

1.4 Base writing assistant contract

BASE_WRITING_ASSISTANT_CONTRACT = f"""You are a writing assistant for a fiction writer. Your job is to help them plan, draft, revise, and continue their story while staying consistent with the provided story materials.

CORE RULES
- Be practical and craft-focused. Give the writer something they can use immediately.
- Treat ATTACHED CONTEXT (profiles, lore, relationships, outlines, chapter summaries) as established canon.
- Do not invent new canon facts that contradict the attached context.
- Do not invent new named characters, locations, magic systems, or plot devices unless the writer asks or they exist in attached context.
- If key information is missing, ask at most ONE clarifying question, only when you truly cannot proceed.
- If you can proceed with reasonable assumptions, proceed and label assumptions clearly.

WHEN THE WRITER ASKS TO "WRITE THE NEXT PART" OR "CONTINUE"
1. Continue directly from the final line of the provided excerpt.
2. Match the excerpt's POV and tense exactly. Do not switch unless asked.
3. Match voice, tone, and pacing implied by STORY CONTEXT and the excerpt.
4. Honor character voices and motivations from attached profiles.
5. Aim for clean, publishable prose. Not an outline or summary.
6. Default length: 400 to 800 words unless the writer specifies otherwise.
7. Output only story prose unless the writer explicitly asks for notes, options, or an outline.

WHEN THE WRITER ASKS FOR FEEDBACK OR REVISION
- Quote the specific line(s) you are responding to.
- Give 3 to 5 actionable points maximum per response.
- If you provide a rewrite, keep the writer's meaning and style.

CLARIFYING QUESTION PROTOCOL
If the request is ambiguous, ask ONE question. But if the excerpt or context clearly implies the answer, do not ask. Just proceed.

{PUNCTUATION_RULE}

STYLE
- Avoid generic encouragement or filler praise.
- Be specific, direct, and helpful.
- Use markdown formatting (bold, bullets, blockquotes) when it helps readability.
- Do not use ## or ### headers in chat responses.
"""
1.5 Mode addendum functions
Create these functions that return SHORT addenda (not full prompts). Each is appended after the base contract:

build_editor_chat_system_prompt(category: str, content_mode: str) -> str

Combines: base contract + content mode instruction + category-specific addendum.

Does NOT accept text_content, context_chips, or any story content -- those go in user messages.

Categories and their addenda:

"chat" -- general writing conversation, no structured format required
"readability" -- grammar, clarity, redundancy, descriptive language. Uses structured response format (quote passage → label Praise/Issue/Suggestion → explain → rewrite if Suggestion)
"structure" -- dialogue, POV, tone, pacing, character development. Same structured format.
"context" -- continuity checking against attached profiles. Same structured format.
build_profile_chat_system_prompt(behavior_mode: str, profile_type: str, content_mode: str, section_labels: list[str] | None) -> str

Combines: base contract + content mode instruction + behavior-specific addendum.

Does NOT accept profile_content or profile_name -- those go in user messages.

Behavior modes and their addenda:

"general" / "chat" / "ask_clarifying" -- open profile conversation
"refine" / "refine_traits" / "interpret_profile" / "generate_summary" -- refine and interpret
"extract_traits" -- extract traits from a passage
"check_consistency" -- find contradictions and overlap
"guide" -- guided profile building (replaces the current _build_guide_system_prompt)
Migrate the content from the existing _build_behavior_prompt() and _build_guide_system_prompt() functions in ai.py, but:

Remove any punctuation rules from the addenda (the base contract already has it)
Remove any duplicated core rules (canon respect, clarifying question limits, etc.)
Remove profile_content from being embedded in the prompt text
Keep only the mode-specific focus, format expectations, and behavioral instructions
wrap_assistant_prompt(raw_assistant_prompt: str) -> str

Appends PUNCTUATION_RULE to any assistant's system prompt from assistants.py.

1.6 Generation prompt functions
Move inline system prompts from these endpoints into functions in prompts.py:

generate_usage_preview_prompt() -> str
trim_trait_prompt(importance: str, good_range: str, word_count: int) -> str
audit_importance_prompt() -> str
generate_section_summary_prompt() -> str
generate_full_summary_prompt() -> str
Each must use PUNCTUATION_RULE from the constant.

Task 2: Add temperature to app/ai/openrouter.py
Add temperature: float | None = None parameter to both run_chat() and run_completion().

If provided, include "temperature": temperature in the request body sent to OpenRouter. If None, omit it entirely.

Task 3: Refactor app/routers/ai.py
3.1 Replace all inline prompts with imports

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
After this, ai.py must contain ZERO multi-line system prompt strings. Search and replace all of them.

3.2 Refactor editor_chat() -- separate instructions from content
Before: _build_editor_chat_prompt() puts selected text + context chips + chapter content inside the system prompt.

After: System prompt is instructions only. Variable content goes in a prepended user message.


def _build_materials_message(
    text_content: str,
    is_full_chapter: bool,
    context_chips: list[ContextChip],
) -> dict:
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
    label = "FULL CHAPTER" if is_full_chapter else "SELECTED PASSAGE"
    lines.append(f"{label}:")
    lines.append(text_content)
    return {"role": "user", "content": "\n".join(lines)}
In editor_chat():

Build system prompt from build_editor_chat_system_prompt(category, content_mode) -- no story text
Prepend story context if available
Build materials message using _build_materials_message()
Construct messages as: [materials_message] + conversation_history
Pass appropriate temperature: 0.3 for readability/structure/context, 0.7 for chat
3.3 Refactor profile_chat() -- same pattern
Build system prompt from build_profile_chat_system_prompt(behavior_mode, profile_type, content_mode, section_labels) -- no profile content
Prepend story context if available
Build materials message:

materials = {
    "role": "user",
    "content": f"PROFILE CONTEXT ({profile_type.title()}: {profile_name}):\n\n{profile_content}",
}
Construct messages as: [materials] + conversation_history
Pass appropriate temperature: 0.3 for extract/consistency, 0.7 for guide, 0.5 for others
3.4 Refactor run_assistant()

system_prompt = wrap_assistant_prompt(assistant.system_prompt)
# Then prepend story_context as before
Pass temperature=0.3.

3.5 Refactor all generation endpoints
Replace each inline system prompt with its prompts.py function. Pass temperature=0.3 for extraction/audit, temperature=0.5 for summaries.

3.6 Delete dead functions from ai.py
Remove entirely:

_build_guide_system_prompt()
_build_behavior_prompt()
_build_editor_chat_prompt()
_content_mode_instruction()
Task 4: Verification
Grep checks (all must pass)

# Zero matches in ai.py -- all prompts live in prompts.py now
grep -n "Never use em dash" app/routers/ai.py
grep -n "PUNCTUATION RULE" app/routers/ai.py
grep -c "You are a" app/routers/ai.py  # should be 0 or only in comments

# Exactly one punctuation rule definition
grep -rn "em dash" app/ai/prompts.py    # should match
grep -rn "em dash" app/routers/ai.py    # should NOT match
grep -rn "em dash" app/ai/assistants.py # should NOT match

# No story text in system prompt builders
grep -n "text_content" app/ai/prompts.py    # should NOT match
grep -n "profile_content" app/ai/prompts.py # should NOT match
grep -n "context_chips" app/ai/prompts.py   # should NOT match
Functional tests
Editor chat (chat): "Continue the story" with a passage + character chip. Verify correct POV/tense, references character accurately.
Editor chat (readability): Paste paragraph with grammar error. Verify AI quotes the line and fixes it.
Editor chat (structure): Paste dialogue-heavy scene. Verify AI comments on voice distinctiveness.
Profile chat (general): Ask about a trait. Verify focused response, no rambling.
Profile chat (guide): Blank profile. Verify AI asks a focused opening question.
Run assistant: Any assistant on any passage. Verify no em dashes in output.
Generate section summary: Verify concise, instruction-oriented output.
Continue story: Attach outline + character profiles as context chips, ask to continue. Verify AI follows outline beats and character voices.