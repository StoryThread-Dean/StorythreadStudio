# Features

This is a snapshot of what Storythread Studio does today. For where it is going next, see [`roadmap.md`](roadmap.md).

## Editor

- CodeMirror 6 Markdown editor with a serif typeface optimized for long reading
- Manual save (`Ctrl+S` or Save button); unsaved-change indicator with a confirm-before-close prompt; saving refreshes the sidebar title from the chapter's `# Heading`
- Session undo and redo
- Formatting toolbar, font selector, find and replace
- A **Tools** pulldown in the title bar collects the one-off actions: Generate Scene Summaries, Suggest Scene Breaks, Chapter Summary, Reader Mode, Passage / Dialogue Check, and Export
- **Passage / Dialogue Check** reads the selected passage aloud. Reading silently hides a passage's rhythm -- the writer supplies the pauses and emphasis without noticing, and an indifferent voice does not. It catches repeated words, sentences that only parse on the second read, and right-word-wrong-word errors no checker flags ("walked through the dessert" is perfectly spelled). Four voices, remembered per book, entirely local and free using the same engine as the Audiobook Converter; it saves nothing and applies no markers
- Light and dark themes (app-wide, persisted)
- Selection highlight persists when the writer moves focus into the chat or Smart Advisor panels

## Project structure

Each project is a folder the user owns. The app reads and writes Markdown files inside that folder; it never touches anything outside it.

- `manuscript/` — one chapter per Markdown file; `structure.json` holds acts + reading order once the writer uses acts
- `notes/` — outline, style guide, themes, plus any free notes the writer adds
- `profiles/` — character, relationship, location, lore profiles
- `profiles/arcs/` — for series projects, per-book overrides on canonical profiles
- `summaries/chapters/` — one summary file per chapter
- `summaries/scenes/<chapter-stem>/scene-NN.md` — per-scene summaries (with an optional `## Beats` checklist)
- `exports/` — combined manuscript file plus dated snapshot folders
- `.storythread/` — local cache (safe to delete; rebuilt from Markdown) + per-book remembered UI state

## Sidebar and manuscript hierarchy

The left panel presents Story > Act > Chapter > Scene > Beat:

- **Book Details** — a section header at the top that opens the Book Details popout (formerly "Project Settings" behind a gear icon, now the single home for everything book-level): Title, Description, Genre, Tone, Theme, Setting, Word Count target, Chapter Count target, Point of View, Tense, Target Audience, plus content mode and the model picker. All story fields but the two targets flow into AI prompts as STORY CONTEXT; the targets live in the outline worksheet and drive the Writing Progress gauge.
- **Acts** — created with "+ New Act"; chapters move between acts and reorder via each row's hover "..." menu (Move up / Move down / Move to Act). Acts collapse, and the collapsed state is remembered per book. Moves never rename chapter files.
- **Chapters** — double-click to rename. A rename updates the heading AND the filename (slug follows the title, `NN-` prefix kept), and carries the chapter's summary, scene summaries, act slot, and progress history along.
- **Scenes** — expandable under each chapter (from scene summaries); each scene with beats shows a done/total badge and expandable read-only beat rows.
- **Notes / Profiles** — collapsible sections; collapse state remembered per book across restarts and updates.
- **Writing Progress** — pinned at the bottom of the panel, always visible no matter how much of the tree is expanded; the breakdown slide-over opens upward.

## Profile Builder

A guided workspace for authoring structured project context.

### Profile types

Character, Relationship, Location, Lore. Each type has its own section template (Overview, Personality Traits, History, Tone and Atmosphere, Rule or Concept, etc.) defined in code, not user-edited.

### Trait blocks

Profile sections are made of trait blocks. A trait block is a single trait or a small group of related traits with a description and an importance level.

```md
- trait: observant, punctual, eloquent
  description: "She is the textbook example of someone always on time and has her things together."
  importance: core
```

### Importance levels

Replace an older "influence" scale. Importance controls when (and whether) a trait is sent to the AI.

| Level | Meaning |
|---|---|
| **Core** | Central to identity or narrative role. Always sent to AI at top prompt position |
| **Present** | Regularly relevant. Sent when the character is in the scene |
| **Background** | Exists in canon but rarely surfaced. Sent only when directly relevant |
| **Contextual** | Situational. Sent only when the writer explicitly attaches it |
| **Hidden** | Writer-only reference. Never sent to the AI; AI may not name a hidden trait, only express it as subtext |

### Adaptive word-count gauge

Each trait block shows a word count gauge tuned to its importance level. Higher-importance traits tolerate more words because they need detail to be useful in prompts. Hidden traits have no gauge.

### Two character templates (Main vs Side/Background)

Character creation offers a template choice, stored as `character_kind` in frontmatter (absent = main, so pre-v1.0.10 files are untouched):

- **Main** — the full trait-block template: importance levels, word gauges, the Importance Audit.
- **Side / Background** — every section is a single free-text field; Quick Build appends lines into them. Per-section AI Summary tiles are dropped (only the Full AI Summary at the bottom remains; existing summaries survive a resave). Trait-section headings are shared between templates, and the parser round-trips plain paragraphs under a trait heading instead of dropping them.

The Profile Builder's character list splits into collapsible **Main** and **Side / Background** groups; the chat attachment picker mirrors the same grouping.

### Name generator (characters)

Opened from the dice button beside the Name field, or "Need a name?" in the + New form. Pick a culture (20, grouped by region) plus one of five era buckets (Medieval/Renaissance through Current, with an honest closest-available fallback when a culture doesn't reach that far back), or one of 12 fantasy races (assembled from race-true syllable components -- endless output). Deals 6 given names + 6 surnames per roll with no-repeat paging; given and surname select independently and either alone is a valid pick. Real-world pools are served by the backend from an app-level `~/.storythread/names.db`, seeded at startup from JSON shipped with the app (versioned reseed; delete the DB and it rebuilds) -- built to expand with more cultures and, later, writer-added names.

### Personality spine dropdowns (characters)

Two cheat-sheet dropdowns in the profile header, under Status/Tags, each with per-option "What's this?" help: **Personality (Enneagram)** — 9 types, each summary carrying the type's core desire, core fear, and stress behavior — and **Story Role (Archetype)** — the 12 Jungian archetypes plus Comic Relief, Confidant, and Rival. Picking one inserts a fiction-first starting paragraph (behavior + speech pattern + how they crack under pressure, ending in a trigger/origin fill-in hook) into Personality Traits — a `[core]` trait block on Main, appended text on Side — with a confirmation note showing where it went. A Story Role pick also fills the Role field and merges its key-aspect Tags; the Role field additionally has a quick-pick list grouped Popular / Less Common / Niche. All canned text shipped in code — writer-initiated insertion, zero AI calls.

### Quick Build (side/background profiles)

Opens at the top of Side/Background character profiles. Pick a Story Role (weights the rolls; re-derived from the profile's Role field on reopen, so "Villain" finds Shadow / Villain), then reroll curated sentence-length options per section — Physical, Mannerism, Voice, Want/Motivation, and Hidden/Foreshadowing (secrets, tells, and planted details built to pay off later) — and click any option to append it to the matching section as a new line.

A **[Generate Overview]** button on the Overview section spins the filled-in fields (Name, Role, Tags, trait lines, relationships, notes) into a compact mini-story of the character: grounded in the writer's own entries, lightly embellished to connect them, hidden details expressed as subtext only, and a varied angle on each click. Output lands in the editable Overview field and saves nothing until the writer saves. This is a deliberate, documented exception to the write boundary, scoped to side characters only (see `CLAUDE.md` AI Boundaries). Pools run 50+ options per section and rerolls page through the whole pool before anything repeats. An opt-in **NSFW toggle** (red, per character, never automatic) swaps the pools: off = normal options with the Explicit box greyed out; on = NSFW pools replace normal; the Explicit checkbox swaps in a third fill-in-the-blank tier ("secretly wants to be ____") the writer completes.

### Profile-level AI tools

| Tool | What it does |
|---|---|
| **Section summary** | Generates a compact `## AI Summary: Section` summary into Markdown |
| **Full profile summary** | Generates a multi-paragraph `# Full AI Summary` synthesizing all sections, weighted by importance. For characters, also reads `profiles/relationships/` and weaves in connected dynamics |
| **"How AI uses this" preview** | Sparkles button on a trait block; on-demand prose explanation of how that trait's importance level shapes AI behavior. Shown in a popover, not stored |
| **AI Trim** | Scissors button that appears when a trait is in the Wordy/Bloated range; rewrites the description to a tighter target length |
| **AI Importance Audit** | Profile-level pass that flags importance-level mismatches across all trait blocks |

### Profile Builder chat

A right-side panel for refining a profile in conversation. Five behavior modes: **Chat**, **Refine**, **Extract Traits**, **Check Consistency**, and **Interview Me**. Chat does not auto-write back to the profile; the writer accepts suggestions manually.

**Interview Me** (v1.0.10) flips the direction: the AI interviews the writer about the character and organizes THEIR answers — interviewer and organizer, never the inventor (invented details are always labeled take-or-discard). The first pass asks 5–8 basics; section checkboxes above the chat input pick what to expand next, and each round asks 2–4 questions that dig for triggers and origins ("untrusting — of whom? what happened?") rather than adjectives. Every round ends with the full updated copy/paste profile block, so the writer can stop at any point with something usable. Book Details (genre, tone, theme, setting, audience) shade the questions when filled in — shade, never straitjacket.

### Profile import and fork

Import a character profile from another project as a fully independent copy. The fork gets a new profile ID and is editable in the new story; there is no sync back to the source.

## Smart Advisor

Inline editor overlays for structured feedback. Three top-level categories trigger from the editor toolbar:

- **Readability** — Grammar, Clarity, Redundancy, Descriptive (subcategory toggles)
- **Structure** — Dialogue, POV, Tone, Character, Pacing
- **Context** — Character Consistency, Relationships, Setting, Lore

### How a pass works

1. Writer clicks a category button. Subcategory checkboxes scope the pass.
2. The chapter (or selected passage) is sent to `/api/ai/editor-pass` with attached context chips.
3. The AI returns structured JSON: a list of issues, each with a verbatim quote, severity (praise / issue / suggestion), category label, explanation, and suggested rewrite.
4. The frontend anchors each issue to its quote and decorates the manuscript with colored underlines (amber / violet / teal). Multi-issue overlaps show a numeric stack badge.

### The popover

Click any highlight to open a popover anchored below the issue:

- Severity badge, category label, explanation
- The original passage and the suggested rewrite, rendered as a word-level diff (additions in green, removals struck through)
- Eight modifier buttons that re-cast the suggestion: **Default** (revert to AI's first take), **Rewrite**, **Expand**, **Shorten**, **Describe**, **Rephrase**, **Add Sensory Detail**, **Change Tone**
- **Accept** / **Ignore** actions

Default is a client-side revert. The other seven call `/api/ai/revise-suggestion` with that single issue and modifier name and replace the suggestion in place.

### Stable anchoring

Issue ranges are managed through a CodeMirror `StateField` that auto-maps positions through every transaction. Accepting one suggestion (which can replace many words) shifts every other issue's anchor to its new correct position automatically. If a future edit collapses an issue's range to zero length, that issue silently drops off — no stale highlights linger.

### Subcategory persistence

Subcategory checkboxes per category persist in `localStorage`, so the writer's preferences survive reloads.

### Scene break suggestions

A **Suggest Breaks** action (v1.0.7): the AI reads the chapter and proposes where a `---` scene break would strengthen the pacing, with a short reason for each. The writer decides what to apply.

## Writing Companion

The right-side chat panel beside the editor. Structured feedback passes are handled by Smart Advisor; the Companion covers conversational and generative help:

- **Chat (default)** — open conversational AI help: brainstorming, voice work, ad-hoc questions.
- **Draft mode** (v1.0.6) — a toggle next to the chat input turns the AI into a drafting partner: the message is treated as a premise and the AI writes manuscript-style prose from it (roughly 800–1200 words per segment), using attached context chips as canon. A **Continue** button extends the scene segment by segment. Off by default; drafted prose keeps the approved `--` punctuation.
- **Enhance mode** (v1.0.7) — highlight a passage and describe how it should be improved (sensory detail, mood, pacing, how a character comes across). Three reach levels: **Restate** (reword at the same length), **Default** (a richer pass), **Expanded** (a fuller rewrite). The rewrite appears in the chat for the writer to place manually; nothing changes automatically.

Two supporting controls (v1.0.7): **"New ask"** starts a fresh request without clearing the conversation, and attached chips can be marked **Canon** (writing stays consistent with them) or **Reference** (in-the-moment instructions lead).

### Context chips

The writer attaches profiles, summaries, and notes as chips. Each chip has include flags so the writer can choose what part of the profile actually goes into the prompt:

- **Summary** — the profile's `# Full AI Summary` section
- **Traits** — structured trait blocks
- **Overview** — the human-written `# Overview` section
- **Details** — the rest of the body

Defaults are Summary + Traits on. The Profile Builder chat uses a more permissive default that includes the entire profile.

Attached materials **persist for the whole conversation** (v1.0.10): the backend echoes the materials block it sent and the frontend stores it in the chat history as a hidden message, so profiles and the included chapter genuinely stay in front of the model on every later turn (they are sent over the wire once, then ride in history). The Canon/Reference stance stays active for as long as chips are attached. A VOICE FIDELITY rule in the base prompt keeps `[core]` voice and mannerism traits constant across turns and modes -- vary the expression, never drop the trait. The persisted chapter text is a snapshot from when it was attached; **New ask** refreshes it.

### Multi-character handling

When multiple character chips are attached, each profile's body is wrapped with explicit `=== BEGIN <TYPE>: <NAME> ===` / `=== END ===` delimiters in the prompt so the AI does not conflate traits across characters.

### Selection vs. full chapter

With nothing selected, the chat treats the whole chapter as context (capped at 100K characters). With a passage selected, only that passage is sent (capped at 30K). Selection highlight persists while the chat is focused.

## Series structure

A series is a parent folder that contains multiple book projects plus a shared `series-profiles/` directory.

- **Canonical profiles** live at the series level and stay consistent across books.
- **Arc files** live in each book's `profiles/arcs/` folder and overlay book-specific changes onto the canonical profile (different relationship status, new injuries, evolving motivations).
- **Profile merge** combines canonical + arc at request time so AI sees the right state for the book the writer is in.
- The **ChipPicker** offers a "This Book" / "Series Profiles" toggle so the writer can attach either source.
- **Story context** (`series.json` + `project.json`) is automatically prepended to every AI system prompt so the model knows the project's tone, genre, content mode, and POV defaults.

## Summaries

### Chapter summaries

One file per chapter under `summaries/chapters/`. Generated on demand from the chapter prose. Prompt is tuned to "cliff notes" framing: gist as primary directive, grounding rules secondary, no rewriting in polished prose.

### Scene summaries

Per-scene files at `summaries/scenes/<chapter-stem>/scene-NN.md`. Two ways to create them:

- **Auto-split** — the chapter's `---` horizontal rule scene breaks drive a sequential generator; each scene gets its own summary file with a yes / no / cancel overwrite prompt
- **Selection-based** — a modal lets the writer preview a summary of the selected text and pick the slot it belongs in

The sidebar shows scene summaries as expandable grandchildren under each chapter.

### Scene beats

Each scene summary can carry a **Beats** checklist — planning checkpoints like "MC finds the letter" — edited in the scene summary view (check off, edit in place, reorder, delete, add). Beats are stored as a `## Beats` section at the end of the scene's summary file, never in the manuscript prose, and regenerating the summary with AI leaves them untouched. The sidebar shows each scene's beats as read-only children with a done/total badge.

## Export

Two export modes, both run from `POST /api/export/full-manuscript` and `POST /api/export/snapshot`:

- **Full manuscript** — combines chapters in order into a single file in `exports/`. Optional flags append chapter summaries, scene summaries, notes, and profiles as `#` appendices.
- **Manual snapshot** — dated folder under `exports/snapshot-YYYY-MM-DD/` mirroring the project layout, with the same opt-in toggles for summaries, notes, and profiles.

### Exporting is not the same as moving

An export is for **leaving the app**: a manuscript to send to a reader, a Weave
bundle a spreadsheet or another program can read. It carries the work, not the
app's own state, so it does not include Weaving answers -- what you retired,
muted or put off. Those are a record of what you told this app to stop asking and
mean nothing outside it.

**To move a book to another computer, move the folder.** Upload the project
folder to a drive, download it on the other machine, open it there. Everything
arrives identical, Weaving history included, and you carry on where you stopped.
See `docs/architecture.md` for what makes that work and the one transfer method
to avoid (anything that filters hidden folders and so drops `.storythread/`).


## The Weave

*In development on `feature/the-weave`, for v2.0.0. Not in a shipped release yet.*

The Weave is one linked, time-aware world model. Every character, place, faction,
object and idea is a **Thread**; the connections between them are **Ties**; and a
Thread's **Run** records how it changes across the story.

The Run is the point of the whole thing. A profile today describes one unchanging
person from page one to the last page, which is wrong: a heroine who spends
fourteen chapters believing her father died in a raid is a different person in
chapter fifteen. Ask the Weave about chapter seven and you get the belief; ask
about chapter fifteen and you get the truth.

### Saying how, from a grouped list

The relation goes in one dropdown, inside the sentence it records:

```
Record it as
Alexandra Langford [ choose from ...  v ]  Lara Croft
                   | Family
                   |   parent of
                   |   sibling of
                   |   cousin of
                   | Knows / Known
                   |   friend of
                   |   partners with
                   | Intimate
                   |   married to (one at a time)
                   | ...
                   | Write my own...
```

It replaced a column of buttons where every button *was* the save action. That
shape was wrong twice: about seventy relations ship now, which makes a column a
wall, and a writer looking for something to press could not tell the wall was it.
One dropdown refines one save button.

**Leaving it at "choose from ..." is a real answer**, not an unfinished one -- the
connection records as the plain kind and can be labelled on a later pass. The
reason line is the required half; the relation is the queryable half.

Relations are grouped under **Family · Knows / Known · Intimate · Against · Duty
and standing · Belonging · Place · Belief · Things and events**, and only the ones
that mean something between those two kinds of entry are offered. A relation the
world does not have yet is in the list too and is adopted when chosen -- which is
not behind the writer's back, because choosing it *is* the request.

Two things ride in an option's label because an option has no second line:
`(stored the other way)` for a relation that runs from the other end, since the
writer will see it listed under that entry afterwards and an unexplained flip
looks like a bug; and `(one at a time)` for cardinality, worth knowing before
choosing rather than after.

**The other end can be a different relation, not just different wording.**
Alexandra is *friends of* Lara; Lara is *business partners with* Alexandra. Both
are true, from different ends, and no derivation produces the second from the
first. Left unset, the registry's own inverse is used -- `mentored by` reads as
`mentor of` -- which is right almost always, and is why the override is optional.

**Writing your own** is in the list rather than beside it, so it is found while
choosing rather than after giving up. It carries a warning that the label becomes
part of the connection string sent to AI, so plain words a model already knows
cost less and land better than invented ones. Guidance, not a rule: an invented
culture may genuinely need a word no model knows, and then the reason line carries
the meaning. A name the app already knows is not an error -- it is used, adopted,
or widened to cover the pair in front of you, never refused.

### A connection changes across the book

A relationship is not a fact of the premise. Three scenarios, all ordinary:

| | |
|---|---|
| Chapter 2 they meet through a friend; chapter 4 they are friends; chapter 8 she saves his life | changes twice |
| Chapter 1 she is his daughter | never changes |
| Chapter 7 she is disgusted by him; chapter 8 they work together; chapter 11 they are lovers | changes twice, and reverses |

All three work, because **the pair is an axis**. `(Alexandra, Dean)` is the axis
and the states are a run on it, so a connection supersedes its own earlier states
exactly the way a fact does: the latest state at or before the point being read
is the one in force, and **the writer closes nothing by hand.** Recording
"friends" at chapter 4 is all it takes -- "acquaintances" stops applying from
there on, and reading chapter 3 still gives acquaintances.

Two states on one pair at the same chapter with nothing to order them is a
**Snag**, reported, never silently resolved -- the same rule facts follow, for
the same reason: a quietly-picked winner would be a relationship the book never
establishes.

**An undated connection is true of the whole book.** This is the one place
connections and facts differ, and the asymmetry is real: a fact records a
*change*, and a change with no point in the story is meaningless, so an undated
fact is Unplaced. A connection records that two things *relate* -- "she is his
daughter" is simply true, and asking a writer to date it is asking them to date
the premise. A dated state still supersedes it from its own chapter onward, so a
relationship that starts as the premise can still develop. An anchor that was
written and no longer resolves -- a deleted chapter -- is still Unplaced, because
that is a real problem rather than a default.

`frame` and `revealed_at` work on a connection's states too, which is what makes
the hard versions expressible: Alexandra believes they are friends while Dean is
using her -- two states, one pair, both in force, not a contradiction. And a
secret marriage stays hidden until its reveal chapter, including the wording of
whatever it replaced.

**`until` survives for the one thing supersession cannot say.** "They stopped
being friends and became nothing" is a different statement from "they became
enemies." Replacement is derived; ending is declared.

**On the map this is one line, not three.** The states of a connection are one
edge whose label changes as the scrubber moves -- which is what the scrubber was
built for. Drawing a line per state would make a developing friendship look like
a crowd.

**A limit worth knowing:** anchors are narrative position, not in-world dates.
The app knows chapter 11 follows chapter 8 and nothing about the year that passed
between them. "A year on, and they cannot be apart" is recorded in the writer's
own words rather than computed, and the app cannot do arithmetic with it. Real
dates would need a per-world calendar, which is a separate thing.

### A connection has to say WHY

The one field a connection cannot be saved without is a single line, in the
writer's own words, saying why the two are connected. Not the relation label --
that is optional and can come on a later pass.

The order is deliberate, and it follows from what the Weave is for. The point is
that a writer can ask AI for help without pasting profiles and explaining
context. Measured against that:

| Recorded | What AI learns |
|---|---|
| `Alexandra -- connected to -- Dean` | that two people exist near each other, which the prose already showed |
| `Alexandra -- is hiding her theft from -- Dean` | the tension, the stakes, and the thing Dean must not notice |

A relation label like `antagonist_of` is a category a model could mostly have
guessed. The sentence is the scene. So the app asks for the sentence first and
**refuses a connection without one**, rather than accumulating thousands of bare
edges that make every brief longer and no smarter.

**Brevity is arithmetic, not style policing.** The reason goes into the brief
every time the writer asks for help, multiplied by every connection in scope:
twenty connections at a line each is affordable; twenty at four paragraphs each
would spend the whole budget on edges before the chapter is even included. A
wordy reason does not merely read badly -- it gets **pruned out of the brief**, so
the writer did the work and lost the benefit. The field is therefore a
**single-line input rather than a text area** (the shape of the box teaches the
rule before any counter has to), capped at 140 characters, and the cap is sent by
the backend so the box can never be wider than what is kept.

A connection may also carry a second line for how it reads from the other end --
"Alexandra is hiding her theft from Dean" does not reverse cleanly. That one is
offered, not demanded, because a writer mid-thought should not be made to answer
twice.

Three switches on every fact and every Tie decide what is visible:

| Switch | Question it answers |
|---|---|
| `frame` | Whose truth is this? Objective, or something one character believes |
| `revealed_at` | When does the reader learn it? Later than the point being written = spoiler |
| `ai_scope` | May AI see it at all? never / on request / always |

Together they cover author-only secrets, hidden motives, misinformation,
unreliable narration and layered-world premises with one mechanism -- and they
apply to Ties as well as facts, so spoiler mode cannot hide a secret while drawing
a large labelled edge that gives it away.

Threads are ordinary Markdown files under `codex/`, so copying the project folder
takes the whole world model with it.

### Weaving

A guided session that reads the manuscript and the Weave together and walks the
writer through what it found, one decision at a time.

**Four passes, because they are four different questions.** What was here first
was Full / Targeted / Quick, which is three sizes of one thing -- the only real
choice was how long to be there. These are named out of the same loom vocabulary
as the rest of the Weave, and the metaphor carries the dependency deliberately:
you cannot weave a weft without a warp.

| Pass | When | What it asks |
|---|---|---|
| **Dress the Loom** | Start here | What is here, and what relates to what |
| **Weave the Chapters** | As you write | Did anything change? Pairs the scenes keep putting together with nothing recorded between them |
| **Read the Cloth** | When you step back | Where does the book contradict itself? |
| **Unwoven** | Any time | The ground rules of the world, which is its own job |

(Weave the Chapters reads the whole book today. Scoping it to the chapter being
written -- "run it from chapter eight and the app already knows when" -- is the
designed next step for it, tracked on the roadmap, not a current behaviour.)

**The order is a teaching fact, not a lock.** Dressing the loom is never
finished -- a world grows for the life of a book -- so a gate would never open.
Where a later pass needs something an earlier one provides, it asks for it inline
rather than sending you back. Unwoven is separate because world invention is not
tidying, and mixing it in buries the connection work under questions about how
succession functions.

Every kind of finding belongs to exactly one pass. A kind in two gets asked
twice; a kind in none silently stops being findable -- so a test holds the
division rather than a convention.

**It scans before it asks, and the scan is free.** No model, no role, no cost --
just arithmetic over the book and the world. That is what lets it say "this found
340 things to look at, which is many sessions of work" and mean it, instead of
quoting an estimate that turns out wrong two hours in.

What it can find without spending anything:

| | |
|---|---|
| **Unspun** | a name in the prose with no entry behind it |
| **Frayed** | an entry too thin to be useful |
| **Loose thread** | an entry that relates to nothing else in the world |
| **Untied** | two entries the prose keeps putting in the same scene with nothing recorded between them |
| **Snag** | two facts that disagree, or a supersession that cannot be right |
| **Unplaced** | a fact with no point in the story, so it never takes effect |
| **Told early** | something named in a chapter where the map would be hiding it |
| **Unwoven** | ground rules of the world that have not been decided yet |
| **Pinned** | a phrase the writer marked by hand, raised until answered |

Every stop shows the text that triggered it and answers **"why am I seeing
this?"** with the rule that fired. Four ways to answer, and they are deliberately
different: resolve it in place; a **permanent no worded for the kind it is on**
(*Never make this an entry* on a name, *Not a problem* on a contradiction,
*Leave it as it is* on a thin entry, *Not a connection* only where it really is
one); *not yet* (comes back); and *never ask* about this kind (reversible -- and
it skips the rest of that kind in the current sitting too).

**Only Characters and Creatures are asked how they connect.** Croft Manor's way
into the story is through Lara -- she inherited it, lives in it, left it -- so
the manor is never the subject of a connection question. Locations, lore,
factions, deities, ruling authorities, religions, cultures and the rest are *passive*:
they become connected when someone active is tied to them, an unconnected one is
not a problem, and a pair the scenes keep sharing stands its question on the
active end, so the sentence reads "Lara lives in Croft Manor" rather than a
manor being asked what it thinks of anyone. Two passive things in a room
together is scenery, not a stop. The split is data: a type in the writer's own
`types.json` may carry `"active": true` (a sentient ship that should ask) or
`false`, and that word wins. It gates the walk only -- recording a connection
from a passive entry by hand works everywhere.

**The prose already knows who the likely answers are.** Both connection
questions are backed by the same free count: which entries are named in the same
**scene**. The scene is the unit deliberately -- a chapter that cuts between two
locations would otherwise pair up characters who are never in the same room. So
the picker behind "how is this connected?" leads with the entries the story keeps
putting in the room, each saying how many scenes it shares, and the full list
stays one click away. It is a shortcut, not a filter.

**Untied** is the same count speaking unprompted, and it has a floor: two
strangers pass on a street once, so one shared scene says nothing. It proposes
that a connection exists and never what the connection IS -- a knight and the
dragon he is hunting share a great many scenes.

**Two different things get called *connected*, and the walk says which it
means.** A name in the prose finding its entry is automatic -- it needs nothing
from the writer, and it works from the moment the entry exists. An entry relating
to *other* entries is what Loose thread is about. Told as a bare absence
("Nothing connects to Alexandra Langford") the stop reads as the app having lost
a profile that plainly exists, so it is asked as a question instead -- **"How is
Alexandra Langford connected to the story?"** -- shown beneath her own entry's
icon and name, and it opens by saying how many times the prose already found her.
The number is there to be checked.

**And every step can explain itself.** Beside anything you could reasonably be
stuck on there is one **What's this?** -- a question mark on its own where a row
is crowded -- and it opens a panel that floats over the screen rather than
rearranging it. That last part matters: in the Smart Advisor toolbar an inline
panel grew the row, shoved the pass buttons sideways and pushed the manuscript
down the page. An explanation has to answer four things:

| | |
|---|---|
| **What** it is | one line, in the app's own words |
| **Why** | why it exists, or why it is happening right now |
| **Necessary?** | required, worth doing, or entirely optional |
| **What it spends** | where it is worth saying, including when the answer is nothing |

Where a feature does spend, the note names the cheaper way of doing the same
thing. A Smart Advisor pass reads the whole chapter unless something is selected,
so "select a passage first" is not a tip -- it is the difference in the bill. The
rewrite modifiers on an issue card cost per press, which is worth knowing before
cycling through all seven to see what they do.

And the reverse is worth saying too: Quick Build, the personality and story-role
cheat sheets, the name generator and the right-click thesaurus all read like AI
features and are not. Their text comes from lists that ship with the app. A writer
who assumes otherwise avoids the cheapest tools in here.

That last row is a nice-to-have rather than a rule, and worth including more often
than not, because most of this app costs nothing and a model-shaped app trains
people to expect otherwise. Silence about money is fine; being wrong about it is
not, and a build fails over a "free" claim on anything that calls a model. "Free. No AI is called, so
this costs nothing" is worth the space. Where something does spend, the note says
*what* -- one call over a chapter reads very differently from a pass over the
whole book.

The steps sit in the same panel under a **How to do this** heading. They were a
second button once; two worded buttons cost about 240px per use and two of them
stacked on one screen read as clutter rather than as help.

The two rules are halves of one thing: the flow makes the app ask what comes
next, and this lets it answer how, why, and at what cost.

**The Weave is a closed world.** From the moment the walkthrough opens, the
writer does not leave it until they are done or they X out -- every path, for
every kind of finding, resolves inside the popup. Creating an entry, filling a
thin one in, answering a world question, fixing a contradiction, placing a fact:
all of it happens in place, and finishing returns to the walkthrough at the next
stop. This exists because the alternative was tested and reported plainly:
advancing to another screen -- even a well-built one -- closed the walk behind
the writer. "Good intentions, terrible execution."

The creation path is **Quick Entry**: a name, a kind, and one starter line. The
Weave builds base-level entries and connections only -- the framework. Expanding
them into full profiles is the writer's later work, from the sidebar, in their
own time. Where the starter line arrives prefilled, it is the writer's own
sentence from the manuscript. Answering an Unwoven question this way puts the
answer in the exact section the question tracks, so it stops being asked by
re-derivation -- and when the world already has an entry of that kind, adding
the answer to it is offered before creating a second one.

Fixing a contradiction offers all three honest answers: keep one side (the other
is removed), edit a side in place -- its text or its chapter -- or say both are
right **on purpose**, which marks every side deliberate and means it is never
asked again. Edits keep the fact's identity, so orderings the writer already
settled cannot silently break.

**Identity is asked once, at creation, and never again.** An entry the walk
minted arrives with a writer-confirmed name and kind, so a thin one is asked to
be WRITTEN -- the same fill-in as any other -- not re-identified. The one
genuine leftover case, a minted word that is really another name for an entry
that already exists, is a side path inside the fill form, phrased from the
word's side.

The rule is held structurally, not by discipline: the walkthrough component has
no navigation callbacks at all, and a test reads its source to keep it that way.

**Every step proposes the next one.** This is a rule the walkthrough is held to,
not a property of one screen. Completing an action and returning to where you
started has silently ended the sequence -- so after a connection is recorded the
screen says what it recorded and asks:

> Recorded: **Alexandra Langford friend of Lara Croft**
>
> Would you like Alexandra Langford to connect to anyone or anything else?
>
> **[ Yes -- make another connection ]**  **[ No, I am good for now ]**
> *takes you to the next thing in the walk*

Two named exits rather than one ambiguous Close, and the exit says what it will
do. "Finished with this" **advances the walk**; backing out returns to the same
stop with your place kept. A screen reachable both inside the walk and on its own
carries both wordings, because there is nothing to advance to from the map and
claiming otherwise would be a lie.

**The walk remembers its sitting.** The stop list is a snapshot taken at Start,
so the panel keeps its own session memory: walking Back onto something already
answered shows a receipt of what was chosen rather than the live question
(answering twice was how work got duplicated), *never ask* takes effect
immediately rather than next session, and a stop whose subject stopped existing
mid-walk -- absorbed, or fixed through the editor -- says "already sorted out
somewhere else" with a way forward, instead of a 404 or a spinner that never
ends.

**Tangles resolve one Snag at a time for now.** The lexicon's Tangle -- several
contradictions sharing a cause -- is not yet produced as its own grouped stop;
each Snag in it arrives individually and settles through the same fixer. Grouping
them into one stop is a later refinement of the same screen, not a different one.

**Nothing about the book is stored.** Stops are re-derived every run, so a Thread
that gets its Overview filled in stops being Frayed because the condition ended --
not because a record says it was handled. What IS stored is the writer's answers,
under `.storythread/weave/`, which is the one place under `.storythread/` that is
not a rebuildable cache. Permanent answers -- applied, *not a connection*, muted
kinds, and which John a name meant -- live in `answers.json` **per book**, not per
session, so "permanently" survives closing the panel. The per-session run files
beside it are logs of what happened in one sitting.

**Applied means saved.** Every inline resolution writes the file first and
records the answer after, so "applied" in the ledger is always a fact about the
disk. The ledger also defines a *staged* state for a change sitting in an
unsaved buffer -- no current screen uses it, because the walk's own forms save
directly; it exists so a future buffer-editing surface cannot break the promise
that a discarded edit comes back as a question rather than sitting in the
ledger claiming to be done.

Nothing here writes FOR the writer: the only text Quick Entry can arrive
holding is the writer's own sentence from the manuscript, offered as an
editable starter. The app does not write the writer's characters.

**An empty entry can be connected to straight away.** It was excluded at first,
on the reasoning that something not yet said to BE anything is a word rather than
a thing -- and that turned out to make the walk dead-end on its own output: the
entry created thirty seconds ago was missing from the list of things to connect
to. Since a connection now carries a reason in the writer's words, "she is hiding
her theft from him" says what he is to her whether or not his entry has prose in
it yet. Bare entries are offered and marked as bare, so nothing is passed off as
more than it is.

### Unwoven, and why it is a root system

Unwoven is the only stop that is not about a mistake. It asks the questions a
world has not answered -- how power passes, what magic costs and who pays, what
the worst thing a person can be accused of is.

What keeps it from being a chore is that answers reach across domains --
*"succession is decided by single combat"* touches the law (*is kinslaying
prosecuted?*) and the faith (*does it sanctify this?*) -- and every question
says where its answer belongs, so it becomes part of the world rather than
another pile of notes.

The corpus also holds **follow-up questions** that an answer is designed to
open (*"what stops every heir being murdered in childhood?"*), never asked
before their parent is answered. Today the walk asks the trunk questions only;
surfacing the branches is scheduled work on the roadmap, not a current
behaviour.

### Context assembly

The Writing Companion carries a **world context bar** under the attachments: it
says how many Threads the Weave will send and roughly what they cost, and
**Inspect** opens the whole brief. Each Thread shows why it is there ("named in
what you are writing", "connected to someone here"), what it costs, and an x
that drops it; a kind can be dropped whole; **Read it exactly as the AI will**
shows the actual words. One switch turns automatic world context off and
returns the app to attachments only. Those choices follow the *book* -- "leave
the gods out of it" is a fact about the story, not about the machine.

The brief is assembled **as of the chapter open in the editor**, and nothing is
assembled until that point is known: with no anchor the Weave would answer as
of the end of the book, and a writer in chapter four would be handed a brief
that knows chapter nineteen. Assembling sends nothing anywhere -- it is
arithmetic over local files. The brief travels only as part of a request the
writer started, which is the locked rule, and it arrives after their own
attachments, because a chip is something they chose for this turn and the
Weave is standing context about the world.

When an AI feature runs at a point in the story, the app assembles a brief from
the Weave as of that point. The budget subtracts every other claim on the window
by name -- room for the reply, the system prompt, the writer's own text,
scaffolding, anything pinned by hand -- so what is left is what the Weave may
actually spend, and the panel can show where the window went instead of an
unexplained "context full".

Pinned content is never the thing that gets dropped, everything dropped is
reported, and pinned content that cannot fit is **refused rather than truncated**:
half a character profile reads as a whole one and the model has no way to tell.

Per the locked context rule in `docs/product-scope.md`, the writer can inspect the
brief, remove individual Threads, exclude whole categories, and switch automatic
Weave context off entirely -- which returns the app to manual chips only. Nothing
is sent until the writer starts an AI action. Each of those four is a test in
`WeaveContextBar.test.tsx`, and so is the clause most likely to rot: that
assembling a brief transmits nothing.

**Where the brief actually goes.** The Writing Companion, in every mode --
ordinary chat, Draft, Enhance and Reasoning are one request underneath -- and
**Smart Advisor's Context pass**, which is the pass that checks the writing
against the story rather than against the language.

Readability and Structure do not get it. They read prose mechanics and shape;
sending them a brief would cost a brief's worth of tokens per run to be ignored.
The summary and profile tools still use manual chips.

That split is stated on the context bar itself, because it was reported as a
question the screen could not answer: attached profiles DO reach all three Smart
Advisor passes, through the same request, so assuming the Threads did too was the
reasonable reading. The pass that receives the brief is named once on each side
of the wire and bound by a cross-language test.

### Where an entry appears

An entry may carry `appears_in`, a list of the chapters it is in. **Authored,
never derived**: the free scan OFFERS what the prose shows and only an accepted
offer is written, because presence computed from the manuscript and cached goes
silently wrong the moment a chapter is edited.

Context assembly filters on it and reports the count, per the rule that anything
omitted is said out loud. Two things outrank a placement, and they are what make
filtering safe rather than merely tight: a **pinned** Thread, and a Thread
**named in the text being written**. An entry with no placement is never
filtered -- silence means "not said", not "nowhere" -- so a project that has
never used this behaves exactly as before.

The map reads it as a third state rather than a second. Not-yet-introduced stays
HIDDEN (the spoiler rule, which runs first); among what is left, an entry placed
elsewhere is drawn grey and one placed here is drawn in full. An edge is as
present as its less present end.

Editable from the entry itself, from the map's entry panel, and from the Weaving
walk -- one component mounted in three places, because a walk is a good place to
answer a question once and a bad place to change the answer later.

### Traits that are only true for part of the book

Every trait has a **True all the way through** switch, on by default. Turn it off
and tick the chapters where it holds.

This exists for characters who change, and the case that produced it is the
plainest one there is: a protagonist who is slight and unremarkable in chapter
one and, after her transformation, tall and powerfully built. Both are honest
descriptions. Neither is true of the book. A profile that can hold only one makes
the writer choose which half of their protagonist the AI is allowed to know; one
holding both, with nothing to tell them apart, hands a model two bodies.

Three states:

| `true_in` | Means |
|---|---|
| absent | Always true. Every trait written before this, unchanged. |
| a list of chapters | True there; left out of AI context elsewhere. |
| empty | True nowhere -- shelved without being deleted, and the card says so. |

The arrow beside a chapter ticks it and every chapter after it, which is what
"from the transformation onwards" usually means.

Two paths have no chapter to stand at -- the whole-book brief, and a profile
attached by hand as a context chip. Those MARK instead of filtering, with
`ONLY IN chapter 1` beside the existing weight and `SUBTEXT` markers, so a model
receiving both descriptions is told they are alternatives rather than left to
merge them. One token, defined once, used by both serialisers.

Prose sections are untouched: there is nowhere to hang a window off a paragraph.

### Profile Extractor

`The Weave > Weaving | Profile Extractor`. The Weave's first AI pass. It reads
the manuscript and proposes what each entry should say -- an overview, physical
and personality traits, motivations, notes -- so that filling in a story bible
does not mean re-reading your own book and writing down what is already in it.

**It carries no evidence, and that is deliberate.** An Overview is synthesis;
there is no sentence to quote against it. So the writer's per-item click is the
only safeguard between a model's guess and their story bible, and the screen is
built around protecting it: no accept-all, nothing ticked when the list arrives,
every proposal shown beside what that entry currently says, and a proposal for an
entry that does not exist REFUSES rather than creating one.

**Add or replace, never blend.** Adding keeps the writer's paragraphs exactly as
they are and puts the new one after them. Replacing is a separate button because
it is the only action that can lose words. A proposed trait either stands alone
or folds into a trait the writer picks -- the app never guesses which, because a
wrongly folded trait carries the writer's own label and is easy to miss later.

**It finds two kinds of character the scan structurally cannot**: people the
prose describes without naming ("the tall man", "the hulking figure"), whose
description is kept AS the name rather than replaced by an invented one; and
names that only ever appear as someone being addressed (`"Duncan," he said`),
which sit where a capital was required anyway and are invisible to a name scan.

**A novel is read in parts and comes back as one list.** The book is split by
input tokens, chapters whole and consecutive; a character appearing in chapters
one and six is one entry with two proposals, not two entries. The screen states
how many requests it will take before the writer commits, and each part is saved
as it lands, so a failure at part four of five keeps the first three. The saved
read survives closing the app; starting a new one says how many unreviewed
proposals it would discard first, because those were paid for.

Requires Weaving to have been run first: the request carries a snippet of each
established entry, so the entries have to exist.

## Audiobook Converter

A standalone workspace that turns a finished manuscript into an audiobook: per-chapter MP3s, a combined MP3, and an M4B with chapter marks. Reached from Project Home. Each audiobook is its own folder; the source manuscript is copied in and never modified.

The headline workflow is **draft locally, print premium** -- narrate the whole book free with the local narrator to hear awkward prose and fix pronunciations, then regenerate once with a paid voice when the book is final. Full specification: [`audiobook-converter-spec.md`](audiobook-converter-spec.md).

### Import

- DOCX, EPUB, Markdown, TXT, PDF, or an existing Storythread project
- Chapters detected per format (headings, EPUB spine, Markdown `#`, project manifest)
- Text-based PDFs only. A scanned book is refused rather than guessed at, because OCR errors would be spoken aloud. PDF import reconstructs what page layout removed: repeated headers and footers, page numbers, hyphens split across lines, and paragraph breaks. Every step reports what it did.
- Chapters can be added or removed from the workspace afterward

### The narration copy and its markers

The workspace edits a *copy* of the manuscript, so nothing here touches the book. Manual save only, same as the writing app.

| Marker | Effect |
|---|---|
| `[pause:0.8]` | Exactly that many seconds of silence |
| `[scene-break]` / `[chapter-break]` | Longer silence, lengths set per book |
| `[exclude]...[/exclude]` | Present on screen, never spoken |
| `[say:Hay-SOOS]Jesus[/say]` | One-spot pronunciation override |
| `[pace:+2]...[/pace]` | Faster or slower in steps, capped to the band the engine renders cleanly |
| `[voice:Elena]...[/voice]` | Narrated in that character's voice |

Plus a **pronunciation dictionary** for book-wide and app-wide rules, and **Preview selection** -- select any passage and hear exactly how it will sound, markers and all, free. Every marker has a "What's this?" card with a live-rendered audio example.

### The Formatting Walkthrough

A pop-out that walks the chapter from the cursor and stops wherever narration could be improved, one decision at a time. Edits land in the editor; Save still commits.

- **Beats** before and after mid-paragraph dialogue, between runs of three or more clipped sentences, and after interjections
- **Fixes** for markers typed wrong (`[pace:=2]`, an unclosed `[pause:0.4`), which the parser can otherwise only warn about
- **Word readings** for the 22 words where the narrator reliably guesses wrong (*read*, *wound*, *close*, *lead*, *bow*). Each pronunciation is offered as audio in the writer's own sentence; nothing is applied automatically, because which reading is right depends on what the writer meant
- Each suggestion type can be switched off, and one button adds every remaining pause at once behind a confirm. Marker fixes and word readings are never batched
- **[Show me how this works]** is a ten-step tutorial with before/after audio on every audible claim

### Narration engines

One engine per book; only the voice varies within it.

- **Free** -- local Kokoro-82M, 54 voices, an on-demand ~372 MB download (SHA256-verified, installed from inside the app, version-gated)
- **Budget** -- hosted Kokoro, the same 54 voices, roughly 35 cents for a novel
- **Standard** -- deliberately empty. Three candidates were auditioned and demoted; the app says so rather than recommending one it does not trust
- **Pro** -- Deepgram Aura-2, ElevenLabs Turbo

Demoted engines stay visible in a labelled drawer with the reason each was rejected. Narration borrows the writing API key by default or takes its own; keys are masked and never echoed back. Any voice or passage can be auditioned for a fraction of a cent, and a print pass quotes the exact dollar cost before spending, with the number repeated in the confirm.

### Cast and multiple voices

A **Cast** panel names the narrator and any characters and gives each a voice (a draft voice from the local narrator, a print voice from the paid engine). Manuscript names are offered as one-click additions. A **Find speakers** pass asks the AI who speaks each line and walks the proposals one at a time -- accept, correct the name, or keep the narrator. The AI proposes and never applies, and any suggestion it cannot quote from the text word for word is discarded. Recasting a character re-narrates only that character's lines.

### Generation, freshness, and storage

- Background generation with pause, resume, cancel, per-segment progress, and restart recovery
- Segments keep stable identities across edits, so inserting a paragraph regenerates one segment rather than the chapter
- A freshness dot per chapter: green matches, amber partly edited, red fully edited, hollow not yet narrated. Nothing regenerates on its own
- **Draft pass** trades seam quality for roughly half the time while testing; draft audio re-queues automatically before an export so it can never ship by accident
- A **Storage** screen measures the workspace by category and deletes only what is ticked. Free-to-rebuild categories start ticked; segment audio and finished exports never do
- Deleting segment audio while exports remain marks the book **Export Only**, honestly, since sections can no longer be regenerated without narrating again

### Output

Per-chapter MP3s with real ID3 titles, one combined MP3, and an M4B with navigable chapter marks, all mastered to the same broadcast-safe loudness. Book metadata and cover art are embedded. The audio assembler (~139 MB, LGPL FFmpeg) installs on demand from inside the app.

## Settings

A modal accessible from the sidebar. Sections:

- **AI Provider** — selector cards, one per connection, each with its own dedicated panel: tailored "How to connect" steps, its own masked API key, and a Test Connection button. Shipped connections: **OpenRouter** (recommended default; hosts the Prompt Caching toggle and the cost-tier slider), **NanoGPT** (pay-per-prompt, many unmoderated models; no published pricing, so the cost-tier filter is hidden), and **Local model** (below). Keys stay stored per provider — switching never loses one, and the switch only takes effect on Save, which reloads the model list from the new provider and warns if the saved default model isn't in its catalog. Panels are registry-driven (`providerMeta.ts` + `backend/app/ai/providers.py`), so a future connection is one entry on each side.
- **Local model** — a runtime on the writer's own machine (Ollama, LM Studio, llama.cpp). No API key and no per-token cost. The panel takes a server address and an **API style** (OpenAI-compatible or Ollama's native one, chosen explicitly rather than guessed); Test Connection distinguishes a bad address, nothing listening, and a server answering in the *other* style — naming the setting to flip in that last case. Replies from local reasoning models have inline `<think>...</think>` traces stripped before the writer or the conversation history sees them. **Only local destinations are accepted**: loopback, private-network addresses, or a `.local` name. A public address is refused with the rule explained, because every local runtime speaks the same API as a hosted one and without that line "Local model" would quietly become an undocumented way to connect any remote service.
- **Prompt Caching** (inside the OpenRouter panel, default on) — marks the unchanged part of each request (instructions + story context) as cacheable so supported models charge less and respond faster on repeats. Never sent to other providers.
- **Default model** — model picker populated from the active provider's catalog, with a cost-tier slider on providers that publish pricing. This is what any unassigned role uses.
- **Model Roles** — one model per KIND of job (see below)
- **Content mode** — project-level default (`general`, `mature`, `explicit`) overridable per request
- **Model Routing** — allowlist, blocklist, and per-model content-mode declarations enforced at request time
- **Theme** — light / dark
- **Debug options**

## Model Roles

The app asks an AI to do very different things, and the models available today are not equally good at all of them. A **role** is a kind of job. The writer assigns one model to each role, and every AI feature declares which role it belongs to — so assigning a model to Critique points the Smart Advisor, chapter summaries, scene summaries, AI Trim and the importance audit at it in one move.

Eight roles, each listing on screen exactly which features use it:

| Role | Used by |
|---|---|
| **Critique** | Smart Advisor pass, Writing Companion review categories, chapter and scene summaries, importance audit, AI Trim |
| **Character reasoning** | Profile Builder chat, Interview mode, full profile summaries, dialogue speaker analysis |
| **Brainstorming** | Writing Companion chat |
| **Structural analysis** | Scene break suggestions |
| **Prose** | Draft mode, Enhance mode, Revise suggestion |
| **Extraction** (cheap work) | Usage previews, Generate Overview, section summaries |
| **Long-context analysis** | *nothing yet* -- arrives with the Weave's AI passes, which are deferred to v2.1.0 |
| **Research transformation** | *nothing yet* |

The last two are marked "not used yet" on screen with the reason, rather than presenting a control that silently does nothing.

**The list is collapsed by default** — one line per role: name, the model currently chosen (or "Use Default Model"), and a one-line description that truncates rather than wrapping, so all eight fit on screen at once. Opening a row reveals the full explanation behind "What's this?" (what the job is, why it matters, and what a better model actually buys you there), the features it covers, and the two pickers. Only one row opens at a time, so the list never scrolls itself away. A broken assignment shows a warning icon on the collapsed row, so it is visible without opening anything.

The **From Source** picker greys out services that are not connected yet — no API key, or for a local model no address — and labels them "not connected" rather than hiding them, so what exists and what is merely unconfigured are distinguishable.

The **Model** picker opens with a short **Recommended** group of four to seven models drawn from the curated list and spread across price buckets, each labelled by bucket (Free / Lowest / Pricier / Priority Best) and ordered cheapest first. The bucket name is the whole recommendation — there is nothing further to read. The full catalog follows underneath, with the recommended entries not repeated. Recommendations only appear for providers whose catalog matches the curated ids; elsewhere the group is simply absent.

A role assignment is a **provider and a model together**, not just a model id, so different roles can live on different services — critique on OpenRouter while prose runs on a local model.

Two behaviours matter more than the rest:

- **Leaving a role unassigned is the supported default.** It falls through to the Default Model, exactly as the app behaved before roles existed. An upgrading install changes nothing until the writer changes something.
- **An assigned role never silently substitutes.** If it cannot run — no key for that service, an unreachable local server, a model the provider does not offer — the feature refuses and says why. Without this, a writer could assign Claude to prose, hit a missing key, and unknowingly have their book drafted by a different model.

Per-book role overrides are supported by the resolver but have no UI yet; today roles are app-wide.

## Content mode and routing

Three content modes: `general`, `mature`, `explicit`. Project-level default lives in `project.json`; individual requests may override.

Routing enforces two filters today:

- **Content compatibility** — `_validate_model_content_mode()` checks the model's declared `model_content_modes` in settings and rejects the request if the active mode is not allowed for that model
- **Allowlist / blocklist** — `_validate_model_allowed()` enforces per-project model lists

If no eligible model exists for a request, the app shows a clear error rather than silently degrading.

## Em dash enforcement

Three layers, all required:

1. **Prompt layer** — every AI system prompt explicitly bans em dashes
2. **Sanitizer layer** — `backend/app/ai/sanitizer.py` rewrites any em or en dash in the response to the approved `--` substitute before the frontend sees it. The conversational chat path additionally folds `--` into commas/colons; prose-producing paths (Draft mode, revise suggestions) keep `--`
3. **Style guide layer** — the project's `notes/style-guide.md` records the rule for the writer's reference

## Auto-update

The packaged app checks GitHub Releases on launch (production builds only; dev builds skip the check). When a new version is available:

1. A slim banner appears at the top of the app.
2. **View details** opens a modal with the release notes (rendered Markdown), a download progress bar, and an explicit **Download & Install** button.
3. After install completes, the writer clicks **Relaunch** to load the new version.

Updates never download or install automatically.

A first-launch-after-update banner highlights the new version with a changelog link and a donation nudge.

## Backend health monitor

A `useBackendHealth` hook polls `/health` every ten seconds. If the backend is unreachable, a single fixed-position banner replaces all the per-feature "Failed to fetch" errors that would otherwise clutter the UI. The banner dismisses itself when the backend returns.

## Donation infrastructure

- **About panel** with current version, license, donor self-attest flag, and links to GitHub Sponsors and Ko-fi
- **Periodic donation prompt** every 30–50 launches when the user has not marked themselves a donor (24-hour anti-nag dismiss)
- **Donor flag** is honor-system; checking it stops the prompts and shows a "Thank you for donating!" badge in the sidebar

## Packaging and distribution

- Tauri v2 bundle on Windows, distributed as a signed `.msi` from GitHub Releases
- FastAPI backend frozen via PyInstaller and shipped as a Tauri sidecar so end users do not need Python
- Update bundles are signed with a minisign key; the public key is embedded in the v1.0.0 binary and verified on every update download
- Apache 2.0 license
