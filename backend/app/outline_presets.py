# outline_presets.py -- the sections a writer can drop into their outline
# ========================================================================
# The Outline is a blank page you type into. This is the drawer of ready-made
# sections beside it: pick "Premise" and a Premise section is appended, with a
# prompt telling you what belongs there and one example showing the shape.
#
# It replaces the five whole-document templates. Those handed a first-time
# novelist somebody else's book -- three acts, worldbuilding hooks, a chapter
# plan, every field carrying an italic example -- and the only way to get a
# fresh one was a button that overwrote everything. A writer wants the Premise
# box, not the novel-shaped form.
#
#
# THE RULE THAT GOVERNS EVERY BODY BELOW
# --------------------------------------
# NO PRESET CONTAINS AN INVENTED PROPER NOUN. Not one name, place, faction or
# title. Examples are built out of role words: "a disgraced soldier", "the
# heir", "the winter road".
#
# AND EVERY EXAMPLE SAYS IT IS DISPOSABLE, in the example itself:
# `_Example -- delete this: ..._`. A writer who adds a section should never
# have to work out which of the lines in it the app expects them to keep.
# The italics alone were not enough -- reported after the first section was
# added -- so the instruction is inside the text that needs deleting.
#
# This is not a style preference. Preset text lands in notes/outline.md, and
# that file is read by two things that will believe it:
#
#   THE WEAVE'S SCAN treats a capitalised word in a planning document as a
#   name the writer has DECIDED on -- no frequency floor, because deciding a
#   name once is enough. An example reading "Kael must reach Ironhold" would
#   put two people's worth of fiction into the writer's world and then ask
#   them about it.
#
#   AI CONTEXT can carry the outline as an attached chip. A model reading a
#   fabricated example alongside the writer's real material has no way to tell
#   which is which.
#
# The old templates needed a whole <!-- TREAT AS SEED METADATA --> banner to
# warn the AI off their invented values. Ship no invented values and the
# warning is unnecessary. test_outline_presets.py enforces it.
#
#
# WHY THIS IS PYTHON AND NOT A TYPESCRIPT REGISTRY
# ------------------------------------------------
# codex/scan.py has to subtract these words from planned-name candidates, and
# it runs inside the PACKAGED backend, where a relative path into the renderer
# bundle may not exist. A missing path there costs the writer their
# planned-name filter silently -- which is the exact R11.7 failure mode. The
# frontend fetches these over HTTP and holds no copy of the text.

from __future__ import annotations

from typing import TypedDict


class Preset(TypedDict):
    id:         str
    group:      str
    label:      str
    #: Exactly the H2 written into the file. The greying rule matches on this.
    heading:    str
    body:       str
    #: True for sections a writer needs once PER CHARACTER. These never grey
    #: out, because "already in your outline" is the wrong answer when the
    #: writer is on their fourth character.
    repeatable: bool


def _p(id_: str, group: str, label: str, heading: str, body: str,
       repeatable: bool = False) -> Preset:
    return {
        "id": id_, "group": group, "label": label,
        "heading": heading, "body": body.strip() + "\n",
        "repeatable": repeatable,
    }


PRESETS: list[Preset] = [
    # ── Story Core ───────────────────────────────────────────────────────────
    _p("premise", "Story Core", "Premise", "Premise", """
One or two sentences: who wants what, and what stands in the way.

_Example -- delete this: a disgraced soldier has to escort the heir she once tried to kill,
before the winter road closes._
"""),
    _p("story_promise", "Story Core", "Story Promise", "Story Promise", """
What the first chapter promises the reader, and how the last one pays it off.

_Example -- delete this: promised a locked-room mystery in a house nobody can leave. Paid off
by the culprit turning out to be the house._
"""),
    _p("central_conflict", "Story Core", "Central Conflict", "Central Conflict", """
The one pressure the whole book runs on. Name both sides of it.

_Example -- delete this: the survivors need the well; the people who own the well need them
gone._
"""),
    _p("protagonist", "Story Core", "Protagonist", "Protagonist", """
Goals: what they are trying to get.

Motivations: why they want it badly enough to pay for it.

Main obstacle: the thing that will not move.

Stakes: what it costs them if they fail.

_Example -- delete this: wants her brother's name cleared; will not let the
family end in disgrace; the only witness is the man who framed him; if she
fails she hangs beside him._
"""),

    # ── Story Overview ───────────────────────────────────────────────────────
    _p("story_summary", "Story Overview", "Story Summary", "Story Summary", """
The whole book in a paragraph, ending included. Write it the way you would
tell a friend what happens.

_Example -- delete this: a courier takes one last job, discovers the package
is a child, and spends the rest of the book deciding whether to deliver it.
She does not._
"""),
    _p("beginning_state", "Story Overview", "Beginning State", "Beginning State", """
How things stand before the story disturbs them. The ordinary that is about to
break.

_Example -- delete this: the mill has run the valley for four generations and
nobody alive remembers it stopping._
"""),
    _p("inciting_change", "Story Overview", "Inciting Change", "Inciting Change", """
The event that makes the story necessary. After it, going back is no longer an
option.

_Example -- delete this: the river is dammed upstream overnight, without
warning and without anyone to appeal to._
"""),
    _p("escalating_change", "Story Overview", "Escalating Change", "Escalating Change", """
What gets worse, and in what order. Three or four steps is usually enough.

_Example -- delete this: the well runs low; the neighbours stop sharing; the
first family leaves; the ones who stay start counting who is left._
"""),
    _p("crisis", "Story Overview", "Crisis", "Crisis", """
The worst moment. The plan fails and the cost of carrying on becomes clear.

_Example -- delete this: the petition works, and the ruling arrives four days
after the last of the crop dies._
"""),
    _p("climax", "Story Overview", "Climax", "Climax", """
The confrontation everything has been aimed at. Say what is decided, and by
whom.

_Example -- delete this: she breaks the dam herself, in daylight, where
everyone can see who did it._
"""),
    _p("resolution", "Story Overview", "Resolution", "Resolution", """
The new ordinary. What changed, what did not, and what the reader is left
holding.

_Example -- delete this: the valley has water and no mill. She is not
forgiven, and stays anyway._
"""),

    # ── Character Module ─────────────────────────────────────────────────────
    # Both repeatable: a book has more than one character, and greying these
    # out after the first would make the drawer useless from character two on.
    _p("identity", "Character Module", "Identity", "Identity -- (name)", """
Name:

Role in the story:

Age:

Race / gender:

Species / culture / faction:

_Example -- delete this: the miller's daughter, 26, human, valley-born,
sworn to no house._
""", repeatable=True),
    _p("story_function", "Character Module", "Story Function", "Story Function -- (name)", """
What this character is for. What would break in the story if you cut them.

_Example -- delete this: she is the only one who remembers the valley before
the dam, so without her nobody can say what was lost._
""", repeatable=True),

    # ── Structure ────────────────────────────────────────────────────────────
    # Salvaged from the three-act scaffold in the retired novel template.
    _p("act_beats", "Structure", "Act Beats", "Act Beats", """
Act One: setup, then the inciting change. Roughly the first quarter.

Act Two: escalation and the crisis. Roughly the middle half.

Act Three: climax and resolution. Roughly the last quarter.

_Example -- delete this: One, the dam goes up. Two, every lawful route fails
in turn. Three, she stops asking permission._
"""),
    _p("midpoint", "Structure", "Midpoint", "Midpoint", """
The turn in the middle. Something is learned or lost that changes what the
protagonist is TRYING to do, not just how hard it is.

_Example -- delete this: she learns the dam was legal all along, so the goal
stops being justice and starts being water._
"""),

    # ── World Module ─────────────────────────────────────────────────────────
    # "Setting Sketch" rather than "Setting", so the H2 is visibly distinct
    # from the worksheet's `Setting:` line at the top of the same file.
    _p("setting_sketch", "World Module", "Setting Sketch", "Setting Sketch", """
Where and when. The three or four facts a reader needs before anything else
makes sense.

_Example -- delete this: a narrow farming valley, one road in, forty years
after the last war, in a country that has stopped noticing it._
"""),
    _p("rules_and_limits", "World Module", "Rules and Limits", "Rules and Limits", """
What can and cannot happen here, and what it costs. Magic, technology, law,
weather -- whatever the story leans on.

_Example -- delete this: water rights are owned, not shared, and a claim
older than living memory beats one anybody can remember making._
"""),
    _p("factions_and_powers", "World Module", "Factions and Powers", "Factions and Powers", """
Who holds power, who wants it, and what each of them would do to keep or take
it.

_Example -- delete this: the mill owners hold the charter; the farmers hold
the votes; the magistrate holds both and wants to keep holding them._
"""),

    # ── Chapter Plan ─────────────────────────────────────────────────────────
    _p("chapter_plan", "Chapter Plan", "Chapter Plan", "Chapter Plan", """
One or two lines per chapter. You do not have to plan them all -- some writers
plan the next three and no further.

_Example -- delete this: Chapter 1, the water stops. Chapter 2, she rides
upstream and finds the dam. Chapter 3, the magistrate refuses to see her._

Chapter 1:

Chapter 2:

Chapter 3:
"""),
]

#: Group order for the dropdown. Roughly the order the questions are worth
#: answering in, which is not the same as alphabetical.
GROUP_ORDER: list[str] = [
    "Story Core",
    "Story Overview",
    "Character Module",
    "Structure",
    "World Module",
    "Chapter Plan",
]


def render_preset(preset: Preset) -> str:
    """The Markdown a preset appends: its H2, then its body."""
    return f"## {preset['heading']}\n\n{preset['body']}"


def all_preset_text() -> str:
    """
    Every preset rendered, for the Weave's scaffolding vocabulary.

    codex/scan.py subtracts these words from planned-name candidates so a
    writer is never asked about "Protagonist" or "Midpoint" as though they had
    invented it.
    """
    return "\n\n".join(render_preset(p) for p in PRESETS)
