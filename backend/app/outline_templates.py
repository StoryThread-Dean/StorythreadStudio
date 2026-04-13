# outline_templates.py -- Starter outlines for new books
# =========================================================
# When a new book (or standalone project) is created, the writer picks
# a template: "novel" or "short_story". That template is rendered into
# notes/outline.md with any metadata we already know (title, series,
# genre, tone, description) pre-filled.
#
# Why HTML comments for the metadata?
# -----------------------------------
# The AI can read outline.md when the writer attaches it as context. If
# we put raw pre-filled values at the top like "Logline: A reluctant
# necromancer..." the AI might treat that example as ground truth and
# parrot it back. By putting known metadata inside <!-- HTML comments -->
# Markdown hides them from rendered view AND we include an explicit
# "these are the seed values, not story facts" note so the AI knows to
# treat them as hints, not facts. The writer still sees them if they
# open the file in a plain text viewer.
#
# Adding new templates later
# --------------------------
# This module exports a single function: render_outline(template_type, metadata).
# To add a new template (Save the Cat, Hero's Journey, etc.), add a new
# function below and register it in the TEMPLATES dict at the bottom.
# The frontend picker's option list should be kept in sync.

from typing import TypedDict


# ── Metadata shape ────────────────────────────────────────────────────────────
# This is what the frontend (or project creation code) passes in. Any field
# can be missing or empty -- the template handles that gracefully.
class OutlineMetadata(TypedDict, total=False):
    title:        str   # Book or project title (e.g. "The Ashen Pact")
    series_name:  str   # Parent series name if the book is in a series
    genre:        str   # e.g. "Dark Fantasy"
    tone:         str   # e.g. "Grimdark, slow burn"
    description:  str   # Short description entered during creation


# ── Shared helpers ────────────────────────────────────────────────────────────

def _or_blank(value: str | None) -> str:
    """Return the value if it's a non-empty string, otherwise an empty string.
    Keeps the f-strings below clean -- a missing value renders as `(none)`
    inside the HTML comment block rather than crashing or showing 'None'."""
    if value is None:
        return ""
    return value.strip()


def _metadata_block(metadata: OutlineMetadata) -> str:
    """
    Build the HTML-comment metadata preamble at the top of every outline.

    This block is hidden from Markdown rendering but visible when the
    AI reads the raw file. We explicitly label them as seed values so
    the AI doesn't confuse them with established story facts.
    """
    title       = _or_blank(metadata.get("title"))        or "(not set)"
    series      = _or_blank(metadata.get("series_name"))  or "(standalone)"
    genre       = _or_blank(metadata.get("genre"))        or "(not set)"
    tone        = _or_blank(metadata.get("tone"))         or "(not set)"
    description = _or_blank(metadata.get("description"))  or "(not set)"

    # NOTE: We wrap the seed block in an HTML comment so it doesn't render
    # in the Markdown preview but is still machine-readable. The explicit
    # "TREAT AS SEED METADATA" header tells the AI (and future-you) that
    # these strings are starting hints, not story truth.
    return (
        "<!--\n"
        "TREAT AS SEED METADATA -- NOT ESTABLISHED STORY FACTS.\n"
        "These values were copied from the book/series creation form.\n"
        "The writer will overwrite anything that doesn't fit the real story.\n"
        "AI assistants: do NOT assume these lines are canon. Use only what\n"
        "the writer confirms in the visible outline below.\n"
        "----------------------------------------------------------------\n"
        f"  Title:       {title}\n"
        f"  Series:      {series}\n"
        f"  Genre:       {genre}\n"
        f"  Tone:        {tone}\n"
        f"  Description: {description}\n"
        "-->"
    )


# ── Novel template ────────────────────────────────────────────────────────────

def _novel_template(metadata: OutlineMetadata) -> str:
    """
    Fiction/Fantasy-oriented novel outline scaffold.

    Structure:
      - Front matter (title/logline/theme/POV)
      - Worldbuilding Hooks (light -- detailed profiles live elsewhere)
      - Character Anchors (pointers into Profile Builder)
      - Three-Act Structure with teaching prompts
      - Chapter-by-chapter planning scaffold

    The prose is intentionally teaching-flavored. Every section has one
    example line in italics so a first-time novelist has something to
    react to instead of a blank page. The writer is expected to overwrite
    these examples.
    """
    meta = _metadata_block(metadata)
    # Seed the visible header from title if available -- but keep it generic
    # enough that a blank title just produces "# Outline".
    title_display = _or_blank(metadata.get("title"))
    heading = f"# Outline -- {title_display}" if title_display else "# Outline"

    return (
        f"{meta}\n\n"
        f"{heading}\n\n"
        "_Novel Template (Fiction / Fantasy). Replace every `_italic_` "
        "example with your own ideas. Delete any section that doesn't "
        "serve the story you're writing._\n\n"
        "---\n\n"
        "## Front Matter\n\n"
        "- **Working Title:** _e.g. The Ashen Pact_\n"
        "- **Series:** _e.g. The Ember Throne Saga, Book 2 -- or leave blank for standalone_\n"
        "- **Genre:** _e.g. Epic Fantasy with political intrigue_\n"
        "- **Tone:** _e.g. Grimdark, slow burn, morally grey_\n"
        "- **POV / Tense:** _e.g. Third-person limited, past tense, two alternating POVs_\n"
        "- **Target Length:** _e.g. 90,000 words / ~30 chapters_\n"
        "- **Logline:** _One sentence. Who wants what, and what's in their way?_\n"
        "  _e.g. A disgraced necromancer must resurrect the king he once betrayed "
        "before the dead empress claims the throne._\n"
        "- **Premise:** _Two or three sentences expanding the logline into the hook._\n"
        "- **Theme:** _What the story is really about beneath the plot._\n"
        "  _e.g. Loyalty vs. self-preservation. Whether the dead owe anything to the living._\n\n"
        "---\n\n"
        "## Worldbuilding Hooks\n\n"
        "_Just the bones here. Deep worldbuilding lives in profiles/lore and "
        "profiles/locations. This section is for the three or four facts the "
        "reader needs to understand the story._\n\n"
        "- **Setting Summary:** _Where and when does this story take place?_\n"
        "- **Magic / Tech Rules:** _What are the limits? What's the cost?_\n"
        "- **Central Conflict of the World:** _What tension exists before the "
        "protagonist enters the story?_\n\n"
        "---\n\n"
        "## Character Anchors\n\n"
        "_One line per character here. Full profiles live in profiles/characters "
        "and are built using the Profile Builder. The point of this section is "
        "to list the load-bearing cast at a glance._\n\n"
        "- **Protagonist:** _Name -- the want, the flaw, the lie they believe._\n"
        "- **Antagonist:** _Name -- what they want, and why they believe it's right._\n"
        "- **Ally / Mentor:** _Name -- what they teach the protagonist._\n"
        "- **Foil / Rival:** _Name -- which trait of the protagonist they reflect or contrast._\n"
        "- **Supporting Cast:** _Brief list._\n\n"
        "---\n\n"
        "## Act I -- Setup (roughly 25%)\n\n"
        "_The ordinary world, the inciting incident, and the decision to act._\n\n"
        "- **Opening Image:** _What does the reader see first? What mood does it set?_\n"
        "- **Protagonist's Status Quo:** _Life before the story starts. What do they want? "
        "What do they lack?_\n"
        "- **Inciting Incident:** _The event that disturbs the status quo and makes the story "
        "necessary. Usually lands in chapter 1-3._\n"
        "- **Debate / Refusal:** _The protagonist resists the call. Why? What are they afraid of?_\n"
        "- **Threshold / Break into Act II:** _The point of no return. The protagonist commits "
        "to the journey and can no longer go back._\n\n"
        "---\n\n"
        "## Act II -- Confrontation (roughly 50%)\n\n"
        "_The longest act. Escalating complications, a midpoint reversal, and a crushing low point._\n\n"
        "- **First Trials:** _Early obstacles. The protagonist is reacting more than leading._\n"
        "- **B-Story / Subplot:** _The secondary thread that runs parallel (romance, mentor "
        "relationship, internal growth). Should speak to the theme._\n"
        "- **Midpoint:** _Stakes are raised. New information reframes the problem. Often a false "
        "victory or false defeat._\n"
        "- **Escalation:** _The antagonist counters. Complications multiply. Allies fall away or "
        "reveal themselves._\n"
        "- **All Is Lost / Dark Night of the Soul:** _The crushing low point. The protagonist's "
        "plan fails. They must change internally to move forward._\n\n"
        "---\n\n"
        "## Act III -- Resolution (roughly 25%)\n\n"
        "_The protagonist applies their internal change to solve the external problem._\n\n"
        "- **Break into Act III:** _The new plan. The protagonist commits with new understanding._\n"
        "- **Climax:** _The final confrontation. The external conflict and the internal conflict "
        "resolve in the same beat._\n"
        "- **Resolution / Falling Action:** _The new normal. What has changed? What lingers?_\n"
        "- **Closing Image:** _Mirror or contrast of the opening image. Shows the transformation._\n\n"
        "---\n\n"
        "## Chapter-by-Chapter Plan\n\n"
        "_Rough one-to-two-line summaries per chapter. Update as you draft. Not "
        "every chapter needs to be planned before writing -- some writers plan all, "
        "others only the next three._\n\n"
        "- **Chapter 1:** _e.g. Kael returns to the ruined capital and finds the king's signet "
        "ring on a corpse that isn't the king's. (Inciting incident.)_\n"
        "- **Chapter 2:** _..._\n"
        "- **Chapter 3:** _..._\n\n"
        "---\n\n"
        "## Notes to Self\n\n"
        "_Loose ideas, scraps of dialogue, images, questions to resolve later. "
        "No structure required. The dumping ground._\n\n"
        "- _..._\n"
    )


# ── Short story template ──────────────────────────────────────────────────────

def _short_story_template(metadata: OutlineMetadata) -> str:
    """
    Short-story outline scaffold, tuned for 2,000-10,000 words.

    Includes FOUR common narrative structures as collapsible <details>
    sections. The writer picks one (or blends them), deletes the rest.
    Each structure has inline teaching notes and examples.

    Structures included:
      - Seven-Point Structure (Hook / PP1 / Pinch 1 / Midpoint / Pinch 2 / PP2 / Resolution)
      - Freytag's Pyramid (classic five-act dramatic curve)
      - Three-Act Short (compressed novel structure)
      - In Medias Res (start mid-action, fill in via flashback)
    """
    meta = _metadata_block(metadata)
    title_display = _or_blank(metadata.get("title"))
    heading = f"# Outline -- {title_display}" if title_display else "# Outline"

    return (
        f"{meta}\n\n"
        f"{heading}\n\n"
        "_Short Story Template (2,000-10,000 words). Tight, linear structure. "
        "Fill in the core fields, then pick ONE of the four structures below "
        "and delete the others._\n\n"
        "---\n\n"
        "## Core Fields\n\n"
        "- **Working Title:** _e.g. The Lighthouse at Dawn_\n"
        "- **Target Word Count:** _e.g. 5,000 words_\n"
        "- **Genre / Tone:** _e.g. Literary horror, melancholic_\n"
        "- **Protagonist:** _Name and the one trait that matters for this story._\n"
        "  _e.g. Mara, a lighthouse keeper who refuses to leave her post._\n"
        "- **Central Conflict:** _One sentence. Internal, external, or both._\n"
        "  _e.g. She must decide whether to answer the radio call she knows is her dead brother._\n"
        "- **Setting:** _Where and when. Short stories live or die by a vivid single setting._\n"
        "  _e.g. A storm-battered lighthouse on the Irish coast, one winter night in 1954._\n"
        "- **Theme / Question:** _What is the story asking?_\n"
        "  _e.g. Does love outlast reason?_\n"
        "- **Ending Type:** _Resolved / ambiguous / twist / open-ended. Short stories often "
        "earn the right to end ambiguously._\n\n"
        "---\n\n"
        "## Pick ONE Structure Below\n\n"
        "_Each `<details>` block is collapsed by default in preview. Expand whichever "
        "you want to use, fill it in, and delete the rest. Or blend -- the structures "
        "overlap more than they differ._\n\n"
        # ── Seven-Point ────────────────────────────────────────────────────
        "<details>\n"
        "<summary><strong>Seven-Point Structure</strong> "
        "(Dan Wells -- great for plot-driven stories with clean escalation)</summary>\n\n"
        "_Work backwards from the resolution. Decide the ending first, then the hook "
        "that contrasts it. Everything in between raises stakes in even steps._\n\n"
        "- **1. Hook:** _The opposite state of the resolution. Where the character starts "
        "emotionally or situationally._\n"
        "  _e.g. Mara is content. She turns off the radio when it crackles, as she has for years._\n"
        "- **2. Plot Point 1 (Call to Action):** _The event that forces the protagonist into "
        "the story. They can't ignore it._\n"
        "  _e.g. The voice on the radio says her name. In her brother's voice._\n"
        "- **3. Pinch Point 1:** _Pressure from the antagonistic force. Stakes clarified._\n"
        "  _e.g. The storm cuts power. The radio keeps working. That shouldn't be possible._\n"
        "- **4. Midpoint:** _A shift from reaction to action. The protagonist decides to engage "
        "rather than endure._\n"
        "  _e.g. She answers back. She asks him to say something only he would know._\n"
        "- **5. Pinch Point 2:** _A worse pressure. The protagonist's plan or assumption fails._\n"
        "  _e.g. He says it. But the answer is wrong in a way that's worse than right._\n"
        "- **6. Plot Point 2:** _The final piece clicks. The protagonist has what they need "
        "to make the climactic choice._\n"
        "  _e.g. She realizes the voice isn't her brother -- it's been in the lighthouse the "
        "whole time, learning._\n"
        "- **7. Resolution:** _The answer to the hook. What did the protagonist learn, lose, "
        "or become?_\n"
        "  _e.g. She unscrews the radio and throws it into the sea. She turns the light on for "
        "the ships. She stays._\n"
        "</details>\n\n"
        # ── Freytag's Pyramid ─────────────────────────────────────────────
        "<details>\n"
        "<summary><strong>Freytag's Pyramid</strong> "
        "(Classic five-part dramatic curve -- great for tragedy and literary shorts)</summary>\n\n"
        "_The traditional shape taught in English class. Rising action, a single peak, "
        "falling action. Works well when the story is about a single decisive moment._\n\n"
        "- **1. Exposition:** _Introduce character, setting, and the balance before it's "
        "disturbed._\n"
        "- **2. Rising Action:** _A sequence of events that escalate tension toward the peak._\n"
        "- **3. Climax:** _The turning point. Highest emotional pitch. A choice is made._\n"
        "- **4. Falling Action:** _The consequences unfold. Momentum carries downward._\n"
        "- **5. Denouement / Resolution:** _The new equilibrium. What the world looks like "
        "after._\n"
        "</details>\n\n"
        # ── Three-Act Short ────────────────────────────────────────────────
        "<details>\n"
        "<summary><strong>Three-Act Short</strong> "
        "(Compressed novel structure -- great for character-driven shorts)</summary>\n\n"
        "_The novel shape, radically compressed. Each act is one or two scenes, not "
        "many chapters. Works when the short story is essentially a novel in miniature._\n\n"
        "- **Act I -- Setup (≈20%):** _Character in their world. Inciting incident. "
        "Decision to act._\n"
        "- **Act II -- Confrontation (≈60%):** _Rising complications. Midpoint reversal. "
        "Low point._\n"
        "- **Act III -- Resolution (≈20%):** _Climax. Falling action. Closing image._\n"
        "</details>\n\n"
        # ── In Medias Res ──────────────────────────────────────────────────
        "<details>\n"
        "<summary><strong>In Medias Res</strong> "
        "(Start mid-action, fill in via flashback -- great for high-tension openings)</summary>\n\n"
        "_Open in the middle of something urgent. Use flashback, dialogue, or "
        "internal monologue to fill in the why as the story continues. Short stories "
        "especially benefit from this because they don't have time for slow setup._\n\n"
        "- **1. Opening In Medias Res:** _Drop the reader into a moment of tension or "
        "action. Don't explain yet._\n"
        "  _e.g. Mara's hand is on the radio dial. Her brother has been dead for eleven years._\n"
        "- **2. Orientation Beat:** _A brief pause (a paragraph, not a chapter) to ground "
        "the reader. Who, where, and what are the stakes of THIS moment._\n"
        "- **3. Flashback / Context:** _Fill in the backstory that led here. Keep it lean -- "
        "only what the reader needs to understand the opening._\n"
        "- **4. Return to Present, Escalation:** _Back to the present moment. The situation "
        "worsens or the truth gets worse._\n"
        "- **5. Climax / Resolution:** _Same as any other structure. The moment breaks, and "
        "the character is different on the other side._\n"
        "</details>\n\n"
        "---\n\n"
        "## Plot Beat Scratchpad\n\n"
        "_Free-form space. Loose scenes, lines of dialogue, images, questions. "
        "Short stories often come together through a single image or line -- write "
        "them down here as they arrive._\n\n"
        "- _..._\n"
    )


# ── Registry + public entry point ────────────────────────────────────────────
#
# The frontend sends a template_type string. We look it up here and call the
# matching function. Adding a new template = add a function + register it.
#
# If the frontend sends an unknown value, we fall back to the novel template
# with a gentle warning comment -- better than crashing project creation.

TEMPLATES = {
    "novel":       _novel_template,
    "short_story": _short_story_template,
}


def render_outline(template_type: str, metadata: OutlineMetadata | None = None) -> str:
    """
    Public entry point. Returns the outline.md body for the given template.

    Args:
        template_type: "novel" | "short_story" (more will be added over time).
        metadata:      Dict with optional title, series_name, genre, tone,
                       description. Any field can be missing.
    """
    md = metadata or {}
    renderer = TEMPLATES.get(template_type)
    if renderer is None:
        # Unknown template -- fall back to novel and note it in a comment so
        # the writer isn't left wondering why they got something unexpected.
        fallback = _novel_template(md)
        warning = (
            f"<!-- NOTE: Requested template '{template_type}' was not recognized. "
            "Fell back to the Novel template. -->\n\n"
        )
        return warning + fallback
    return renderer(md)
