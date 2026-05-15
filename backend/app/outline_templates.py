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


# ── Writing-Progress frontmatter ─────────────────────────────────────────────
#
# Per-template default target word counts. The Writing Progress gauge reads
# these to compute the project-completion percentage when the writer hasn't
# overridden them in the outline's YAML frontmatter. Values are midpoints of
# common publishing-industry ranges for each form -- defensible defaults that
# the writer can easily replace.
#
# Serial fiction has no fixed total target because serials are chapter-self-
# contained and ongoing. The gauge renders a placeholder card for serials
# instead of the percentage bar (see roadmap.md "Serial fiction progress
# model" for the deferred design).

TEMPLATE_DEFAULTS: dict[str, dict] = {
    "novel":          {"target_word_count": 90000},
    "novella":        {"target_word_count": 30000},
    "novelette":      {"target_word_count": 13000},
    "short_story":    {"target_word_count": 6000},
    "serial_fiction": {"target_word_count": None},
}


def _frontmatter_block(template_type: str) -> str:
    """
    Build the YAML frontmatter block at the very top of a new outline.

    Why YAML frontmatter and not part of the HTML metadata comment below?
      - YAML between `---` delimiters is the industry-standard "structured
        metadata at the top of a Markdown file" convention. Writers familiar
        with Obsidian, Jekyll, or Hugo will recognize the pattern. PyYAML
        parses it cleanly with no regex.
      - The Writing Progress gauge polls this block to know what the writer
        is planning toward (target word count, expected character / location /
        lore / relationship lists, optional per-chapter word targets).
      - Empty lists are fine -- the gauge falls back to story-type defaults
        when fields are blank. The block exists with empty slots so the
        writer can fill them in without inventing the schema.

    Inline `#` comments teach the writer what each field means without
    needing a separate documentation lookup.
    """
    defaults = TEMPLATE_DEFAULTS.get(template_type, TEMPLATE_DEFAULTS["novel"])
    target = defaults.get("target_word_count")

    # Render `target_word_count` either as the integer default or as YAML null
    # for serial fiction. A trailing comment on the null line explains why.
    if target is None:
        target_line = (
            "target_word_count: null  "
            "# Serial fiction is chapter-self-contained; no fixed total target yet."
        )
    else:
        target_line = f"target_word_count: {target}"

    return (
        "---\n"
        "# OUTLINE TRACKING DATA -- read by the Writing Progress gauge.\n"
        "# Fill these in as you plan. Empty lists are fine; the gauge falls\n"
        "# back to story-type defaults when fields are blank.\n"
        f"{target_line}\n"
        "expected_characters: []      # e.g. [Kael, Vire, Empress Asha]\n"
        "expected_locations: []       # e.g. [Ironhold, The Hollow Crown]\n"
        "expected_lore: []            # e.g. [The Ashen Pact]\n"
        "expected_relationships: []   # e.g. [Kael & Vire]\n"
        "chapters: []                 # Optional per-chapter word targets,\n"
        "                             # e.g. [{title: \"Opening\", word_target: 3000}]\n"
        "---"
    )


def _template_preamble(metadata: OutlineMetadata, template_type: str) -> str:
    """
    Build the full top-of-file preamble: YAML frontmatter + HTML metadata.

    Order matters. YAML frontmatter must be the very first thing in the file
    (the convention is anchored to the start of the document) so the parser
    can find it. The HTML metadata comment goes underneath and stays hidden
    from Markdown preview.
    """
    return f"{_frontmatter_block(template_type)}\n\n{_metadata_block(metadata)}"


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
    meta = _template_preamble(metadata, "novel")
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
    meta = _template_preamble(metadata, "short_story")
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


# ── Novella template ─────────────────────────────────────────────────────────

def _novella_template(metadata: OutlineMetadata) -> str:
    """
    Novella scaffold, tuned for roughly 18,000 to 40,000 words.

    Structure: a compressed three-act with a tighter middle than a novel.
    Novellas typically follow one POV, one central conflict, and skip the
    subplot-heavy interior of a novel. Chapter count is usually 6 to 15
    chapters of 2,000 to 4,000 words each.

    The scaffold below mirrors the novel structure but trims the
    worldbuilding-hooks block and deemphasizes subplots, since these are
    the two areas that most often bloat a novella into novel territory.
    """
    meta = _template_preamble(metadata, "novella")
    title_display = _or_blank(metadata.get("title"))
    heading = f"# Outline -- {title_display}" if title_display else "# Outline"

    return (
        f"{meta}\n\n"
        f"{heading}\n\n"
        "_Novella Template (compressed three-act, 18k-40k words). Replace every "
        "`_italic_` example with your own ideas. Delete any section that doesn't "
        "serve the story you're writing._\n\n"
        "---\n\n"
        "## Front Matter\n\n"
        "- **Working Title:** _e.g. The Night Tide_\n"
        "- **Series:** _Leave blank for standalone, or fill in the series name._\n"
        "- **Genre:** _e.g. Literary horror_\n"
        "- **Tone:** _e.g. Quiet dread, slow burn, intimate scale_\n"
        "- **POV / Tense:** _Novellas usually stay in a single POV. e.g. First-person past tense._\n"
        "- **Target Length:** _e.g. 30,000 words / ~10 chapters of ~3,000 words each_\n"
        "- **Logline:** _One sentence. Who wants what, and what's in their way?_\n"
        "- **Premise:** _Two or three sentences expanding the logline._\n"
        "- **Theme:** _What the story is really about beneath the plot._\n\n"
        "---\n\n"
        "## Cast (kept small on purpose)\n\n"
        "_Novellas live or die by tight focus. Three to five named characters is "
        "usually plenty. Full profiles live in profiles/characters._\n\n"
        "- **Protagonist:** _Name, want, flaw, the lie they believe._\n"
        "- **Antagonist or Opposing Force:** _Person, system, or condition that resists "
        "the protagonist. Doesn't have to be a villain._\n"
        "- **Key Relationship:** _The one other character who matters most. Often the "
        "mirror through which the protagonist's change is shown._\n"
        "- **Supporting Cast:** _One or two minor figures, briefly._\n\n"
        "---\n\n"
        "## Setting in One Paragraph\n\n"
        "_Novellas reward a sharply-drawn small world over a sprawling one. Where "
        "and when does this story happen, and what one detail makes that place feel "
        "specific to this story?_\n\n"
        "- _..._\n\n"
        "---\n\n"
        "## Act I -- Setup (roughly 25%, 1 to 3 chapters)\n\n"
        "_Establish the world, the protagonist, and the disturbance that starts the story._\n\n"
        "- **Opening Image:** _What does the reader see first?_\n"
        "- **Status Quo:** _Life before the story starts. The wound or want already there._\n"
        "- **Inciting Incident:** _The disturbance that makes the story necessary._\n"
        "- **Threshold:** _The decision to act. The point of no return._\n\n"
        "---\n\n"
        "## Act II -- Confrontation (roughly 50%, 4 to 8 chapters)\n\n"
        "_The interior of a novella stays focused on ONE escalating thread. Resist the "
        "temptation to add subplots._\n\n"
        "- **First Push:** _The protagonist tries the obvious solution. It doesn't work._\n"
        "- **Midpoint Reversal:** _New information or a change of fortune reframes the "
        "problem. Roughly the halfway mark._\n"
        "- **Pressure Mounts:** _Complications stack up. The protagonist is forced to "
        "give up something they were holding onto._\n"
        "- **Low Point:** _The plan fails. The protagonist's flaw is exposed. They must "
        "change internally to move forward._\n\n"
        "---\n\n"
        "## Act III -- Resolution (roughly 25%, 1 to 3 chapters)\n\n"
        "_The protagonist applies the internal change to solve the external problem._\n\n"
        "- **New Plan:** _The protagonist commits with new understanding._\n"
        "- **Climax:** _External and internal conflict resolve in the same beat._\n"
        "- **Closing Image:** _Mirror or contrast of the opening. Show what changed._\n\n"
        "---\n\n"
        "## Chapter-by-Chapter Plan\n\n"
        "_One or two lines per chapter. Aim for 2,000 to 4,000 words per chapter._\n\n"
        "- **Chapter 1:** _..._\n"
        "- **Chapter 2:** _..._\n"
        "- **Chapter 3:** _..._\n\n"
        "---\n\n"
        "## Notes to Self\n\n"
        "_Loose ideas, scraps of dialogue, images, questions to resolve later._\n\n"
        "- _..._\n"
    )


# ── Novelette template ───────────────────────────────────────────────────────

def _novelette_template(metadata: OutlineMetadata) -> str:
    """
    Novelette scaffold, tuned for roughly 8,000 to 18,000 words.

    Structure: Freytag's Pyramid (the classical five-stage shape:
    exposition, rising action, climax, falling action, denouement).
    Novelettes are too long for the single-arc compression of a short
    story but too short for the three-act sprawl of a novella, so the
    five-stage Freytag shape is a natural fit. Single POV, one central
    conflict, no subplots.

    Typical layout: 4 to 7 chapters or sections of 1,500 to 3,000 words each.
    """
    meta = _template_preamble(metadata, "novelette")
    title_display = _or_blank(metadata.get("title"))
    heading = f"# Outline -- {title_display}" if title_display else "# Outline"

    return (
        f"{meta}\n\n"
        f"{heading}\n\n"
        "_Novelette Template (Freytag's Pyramid, 8k-18k words). Replace every "
        "`_italic_` example with your own ideas. Delete any section that doesn't "
        "serve the story you're writing._\n\n"
        "---\n\n"
        "## Front Matter\n\n"
        "- **Working Title:** _e.g. The Salt Bell_\n"
        "- **Genre:** _e.g. Speculative fiction_\n"
        "- **Tone:** _e.g. Wistful, restrained_\n"
        "- **POV / Tense:** _Single POV. e.g. Third-person limited, present tense._\n"
        "- **Target Length:** _e.g. 12,000 words / 5 sections_\n"
        "- **Logline:** _One sentence. Who wants what, and what's in their way?_\n"
        "- **Premise:** _Two sentences expanding the logline._\n"
        "- **Theme:** _What the story is really about beneath the plot._\n\n"
        "---\n\n"
        "## Cast (small)\n\n"
        "_Two or three named characters. Anything more starts to feel crowded at "
        "this length._\n\n"
        "- **Protagonist:** _Name, want, flaw._\n"
        "- **Counterforce:** _Person or condition that opposes the protagonist._\n"
        "- **Witness or Mirror (optional):** _The third presence who reflects the change._\n\n"
        "---\n\n"
        "## Setting in One Sentence\n\n"
        "_Where, when, and what one specific detail anchors it._\n\n"
        "- _..._\n\n"
        "---\n\n"
        "## Freytag's Pyramid\n\n"
        "_Five stages. Each is one section/chapter or a tight pair of scenes._\n\n"
        "### 1. Exposition\n\n"
        "_Establish the protagonist, the world, and the wound. Keep it brief: a "
        "novelette doesn't have room for a long setup._\n\n"
        "- _..._\n\n"
        "### 2. Rising Action\n\n"
        "_The disturbance and the escalating attempts to deal with it. Each scene "
        "raises the stakes or narrows the protagonist's options._\n\n"
        "- _..._\n\n"
        "### 3. Climax\n\n"
        "_The peak. The decision or revelation that everything has been building "
        "toward. Often a single scene._\n\n"
        "- _..._\n\n"
        "### 4. Falling Action\n\n"
        "_The immediate consequences. The dust settling. Usually shorter than the "
        "rising action._\n\n"
        "- _..._\n\n"
        "### 5. Denouement\n\n"
        "_The new equilibrium. What the world looks like now. Often quiet, almost an "
        "epilogue tone._\n\n"
        "- _..._\n\n"
        "---\n\n"
        "## Section-by-Section Plan\n\n"
        "_One or two lines per section. Aim for 1,500 to 3,000 words per section._\n\n"
        "- **Section 1 (Exposition):** _..._\n"
        "- **Section 2 (Rising):** _..._\n"
        "- **Section 3 (Climax):** _..._\n"
        "- **Section 4 (Falling):** _..._\n"
        "- **Section 5 (Denouement):** _..._\n\n"
        "---\n\n"
        "## Notes to Self\n\n"
        "_Loose ideas, scraps of dialogue, images, questions._\n\n"
        "- _..._\n"
    )


# ── Serial Fiction template ──────────────────────────────────────────────────

def _serial_fiction_template(metadata: OutlineMetadata) -> str:
    """
    Serial fiction scaffold, tuned for installment-based storytelling
    (web serials, episodic releases, long-running ongoing fiction).
    Per-installment chapter target: 1,500 to 5,000 words.

    Structure: a SEASON arc (5 to 12 episodes typically) sitting inside an
    overarching SERIES arc, with per-episode beat sheets. Each episode
    needs its own hook (cold open) and cliffhanger (or strong stinger)
    so readers come back for the next installment. The scaffold below
    plans one season; copy this file or duplicate the Season block to
    plan further seasons.
    """
    meta = _template_preamble(metadata, "serial_fiction")
    title_display = _or_blank(metadata.get("title"))
    heading = f"# Outline -- {title_display}" if title_display else "# Outline"

    return (
        f"{meta}\n\n"
        f"{heading}\n\n"
        "_Serial Fiction Template (episodic, 1.5k-5k word installments). Replace "
        "every `_italic_` example with your own ideas. Delete any section that "
        "doesn't serve the story you're writing._\n\n"
        "---\n\n"
        "## Front Matter\n\n"
        "- **Working Title:** _e.g. The Seventh Floor_\n"
        "- **Genre:** _e.g. LitRPG / Slice-of-life fantasy_\n"
        "- **Tone:** _e.g. Slow-burn, wry, character-first_\n"
        "- **POV / Tense:** _Serials often use first-person present for immediacy. Pick "
        "one and stay consistent across installments._\n"
        "- **Per-Episode Target:** _e.g. 3,000 words. Be honest about what you can "
        "sustain at your release cadence._\n"
        "- **Release Cadence:** _e.g. One episode every Monday_\n"
        "- **Logline:** _One sentence. The premise the reader sees in week one._\n"
        "- **Series Premise:** _Two or three sentences. The thing the reader is here for "
        "across many episodes._\n"
        "- **Theme:** _What the story is really about beneath the episode-to-episode plot._\n\n"
        "---\n\n"
        "## Recurring Cast\n\n"
        "_Serials need a small core cast that reappears every few episodes. Big rotating "
        "casts confuse readers reading in installments. Full profiles live in "
        "profiles/characters._\n\n"
        "- **Protagonist:** _Name, want, flaw. The reader follows them every episode._\n"
        "- **Recurring Allies:** _Two or three names with a one-line role each._\n"
        "- **Recurring Antagonist or Opposition:** _The persistent counterforce._\n"
        "- **Episodic Cast:** _Characters who appear for one or two episodes then exit._\n\n"
        "---\n\n"
        "## Series Arc (the long game)\n\n"
        "_The slow-burning question that takes many seasons to answer. Readers in week "
        "one shouldn't see the answer. Readers in week 100 should feel like it was "
        "always there._\n\n"
        "- **Central Mystery or Goal:** _The thing the protagonist is ultimately moving "
        "toward across the whole serial._\n"
        "- **What Changes Over Time:** _The world-state or character-state evolution that "
        "would be visible if you read episode 1 and episode 50 back to back._\n"
        "- **Long-Range Foreshadowing Threads:** _Two or three setups planted early that "
        "pay off much later. Note where the seeds are planted and where they bloom._\n\n"
        "---\n\n"
        "## Season 1 Arc\n\n"
        "_One season is typically 5 to 12 episodes. The season has its own beginning, "
        "middle, and end while leaving the series-level mystery unresolved._\n\n"
        "- **Season Premise:** _What this season is about specifically._\n"
        "- **Season Inciting Incident:** _Episode 1 or 2. The thing that kicks the season off._\n"
        "- **Season Midpoint:** _Roughly the middle episode. A reveal or reversal that "
        "changes the protagonist's understanding._\n"
        "- **Season Climax:** _Penultimate or final episode. The big payoff._\n"
        "- **Season Cliffhanger:** _Last episode beat. Sets up the next season without "
        "feeling unfinished._\n\n"
        "---\n\n"
        "## Episode-by-Episode Plan\n\n"
        "_One or two lines per episode plus the hook and the closing beat. Each episode "
        "should advance the season arc by one notch and stand on its own as a satisfying "
        "installment._\n\n"
        "Episode template:\n\n"
        "- **Cold Open / Hook:** _The first scene. Something that makes the reader keep "
        "reading past the title._\n"
        "- **Middle:** _The episode's own beats. One or two scenes that complicate the "
        "protagonist's situation._\n"
        "- **Closing Beat:** _A cliffhanger, a revelation, or a strong emotional stinger. "
        "Something the reader carries between installments._\n\n"
        "### Episode 1 -- _e.g. Pilot_\n\n"
        "- **Cold Open / Hook:** _..._\n"
        "- **Middle:** _..._\n"
        "- **Closing Beat:** _..._\n\n"
        "### Episode 2 -- _..._\n\n"
        "- **Cold Open / Hook:** _..._\n"
        "- **Middle:** _..._\n"
        "- **Closing Beat:** _..._\n\n"
        "### Episode 3 -- _..._\n\n"
        "- **Cold Open / Hook:** _..._\n"
        "- **Middle:** _..._\n"
        "- **Closing Beat:** _..._\n\n"
        "_(Add more episode blocks as you plan further into the season.)_\n\n"
        "---\n\n"
        "## Reader Engagement Notes\n\n"
        "_Serial fiction lives or dies by reader retention between installments. Track "
        "what's working._\n\n"
        "- **Recap Strategy:** _How will you remind returning readers what happened? "
        "(Brief in-episode reference vs. a separate recap page.)_\n"
        "- **Open Questions:** _Which plot or character questions are unresolved RIGHT "
        "NOW? Readers are tracking these. Don't let them quietly lapse._\n"
        "- **Reader Promises:** _Setups that have been planted but not yet paid off. "
        "Each one is a debt the writer owes the reader._\n\n"
        "---\n\n"
        "## Notes to Self\n\n"
        "_Loose ideas, scraps of dialogue, future episode seeds._\n\n"
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
    "novel":          _novel_template,
    "novella":        _novella_template,
    "novelette":      _novelette_template,
    "short_story":    _short_story_template,
    "serial_fiction": _serial_fiction_template,
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
