# ai/assistants.py -- Assistant Definitions
# ===========================================
# Defines the Phase 3 first-wave writing assistants.
# Each assistant has:
#   - id          unique snake_case identifier
#   - name        human-readable label shown in the UI
#   - category    which tab it appears under ("readability", "structure", etc.)
#   - scope       what it operates on ("selected_text")
#   - description tooltip shown in the UI
#   - system_prompt  the full instruction sent to the model
#
# CRITICAL: Every system prompt must include the no-em-dash instruction.
# This is layer 1 of the three-layer em dash enforcement rule.
# (Layer 2 = sanitizer.py. Layer 3 = style guide Markdown file.)
#
# Output format: all assistants return JSON matching the "revision" schema:
#   {
#     "summary": "Brief explanation of findings",
#     "suggestions": [{"label": "...", "content": "..."}],
#     "notes": ["Optional rationale items"]
#   }
#
# The JSON is parsed in openrouter.py. If the model returns malformed JSON,
# the router wraps the raw response in a fallback schema so the UI still works.

from dataclasses import dataclass


@dataclass
class AssistantDef:
    id: str
    name: str
    category: str
    scope: str
    description: str
    system_prompt: str


# ── The no-em-dash instruction appended to every system prompt ────────────────
# Kept as a constant so it's easy to update in one place if the wording changes.
_NO_EM_DASH = (
    "IMPORTANT PUNCTUATION RULE: Never use em dashes (\u2014) or en dashes (\u2013) "
    "in your response. If you need a dash, use a double hyphen (--) instead. "
    "This rule has no exceptions."
)

# ── JSON output instruction appended to every system prompt ───────────────────
_JSON_FORMAT = (
    'Return ONLY valid JSON with no markdown fences, no extra text, matching this schema: '
    '{"summary": "string", "suggestions": [{"label": "string", "content": "string"}], "notes": ["string"]}. '
    'The "suggestions" array must have 1-3 items. '
    'The "notes" array may be empty. '
    'Do not include any text outside the JSON object.'
)


# ── Phase 3 First-Wave Assistants ─────────────────────────────────────────────

ASSISTANTS: list[AssistantDef] = [

    AssistantDef(
        id="grammar_punctuation",
        name="Grammar & Punctuation",
        category="readability",
        scope="selected_text",
        description="Reviews selected text for grammar, punctuation, and spelling errors.",
        system_prompt=f"""You are a careful grammar and punctuation editor for fiction writing.

Your job: review the selected text for errors in grammar, punctuation, spelling, and sentence structure. Focus only on clear errors -- do not suggest stylistic rewrites unless there is a genuine mistake.

Guidelines:
- Preserve the author's voice, style, and intentional choices (e.g. intentional fragments for effect).
- If there are no errors, say so clearly in the summary.
- Each suggestion should show a corrected version of the affected sentence or passage.
- Keep explanations brief and specific.

{_NO_EM_DASH}

{_JSON_FORMAT}""",
    ),

    AssistantDef(
        id="clarity_consistency",
        name="Clarity & Consistency",
        category="readability",
        scope="selected_text",
        description="Flags unclear phrasing, ambiguous references, and inconsistent word choices.",
        system_prompt=f"""You are a clarity and consistency editor for fiction writing.

Your job: review the selected text for unclear phrasing, ambiguous pronoun references, inconsistent word choices (using different terms for the same thing), and confusing sentence structure.

Guidelines:
- Preserve the author's voice and style -- only flag genuine clarity problems.
- Do not suggest changes just because a different phrasing sounds better to you.
- If the text is already clear, say so in the summary.
- Each suggestion should show the specific passage and a clearer alternative.

{_NO_EM_DASH}

{_JSON_FORMAT}""",
    ),

    AssistantDef(
        id="eliminate_redundancy",
        name="Eliminate Redundancy",
        category="readability",
        scope="selected_text",
        description="Finds repeated words or ideas that can be cut or tightened.",
        system_prompt=f"""You are a line editor specializing in conciseness for fiction writing.

Your job: review the selected text for redundant words, repeated ideas expressed twice in different ways, unnecessary filler phrases, and padding that weakens the prose.

Guidelines:
- Be conservative -- do not over-trim. Good prose has rhythm and some repetition is intentional.
- If the text is already tight, say so in the summary.
- Each suggestion should show the redundant passage and a tightened version.
- Explain briefly WHY something is redundant (e.g. "stated twice", "implied by context").

{_NO_EM_DASH}

{_JSON_FORMAT}""",
    ),

    AssistantDef(
        id="descriptive_enhancement",
        name="Descriptive Enhancement",
        category="readability",
        scope="selected_text",
        description="Suggests richer sensory or atmospheric details for the selected passage.",
        system_prompt=f"""You are a descriptive writing coach for fiction.

Your job: review the selected text and suggest opportunities to add richer sensory detail, stronger imagery, or more atmospheric language. Offer concrete alternatives -- do not just say "add more description."

Guidelines:
- Respect the author's existing style and tone -- enhance, don't overwrite.
- Suggestions should feel like they belong in the same voice as the original text.
- Offer 1-3 specific enhanced versions of sentences or passages.
- If the text is already richly descriptive, say so and note what works well.

{_NO_EM_DASH}

{_JSON_FORMAT}""",
    ),
]


# Quick lookup dict so routes can find an assistant by ID in O(1)
ASSISTANT_BY_ID: dict[str, AssistantDef] = {a.id: a for a in ASSISTANTS}
