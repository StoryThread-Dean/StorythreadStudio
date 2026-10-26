# Chapter Outline -- specification

**Status:** SHIPPED. Slices 1 and 2 on 2026-09-05, slice 3 on 2026-09-06.

**Source of truth for the feature.** Where this document and the code disagree,
the code is wrong until the writer rules otherwise. Behaviour changes go in the
same commit as the change to this file.

---

## 1. What it is, and the gap it fills

Chapter summaries and scene summaries look **backward**. They are generated from
prose that already exists and describe what was written. Nothing in the app
looked **forward** at chapter scale: there was no place to write down what has
to happen in chapter seven before chapter seven exists.

A Chapter Outline is that place. In the writer's words:

> "the main key events that take place that move the scenes, dialogue, action,
>  events along. essentially giving a play-by-play high level overview."

One per chapter, beside Chapter Summary and Scene Summaries.

**The gap was already assumed closed.** `_DRAFT_RESPONSE_RULES` and
`_ENHANCE_RESPONSE_RULES` in `backend/app/ai/prompts.py` both tell the model to
treat "the attached profiles, outline, and location notes as canon". That
instruction has shipped for releases and nothing ever delivered an outline
unless the writer hand-attached the book outline as a note chip.

### 1.1 "Working events"

The numbered key points in the outline ARE the working events. This is one
feature, not two. It has nothing to do with the Weave's `event` entry kind,
which stays what it is: a first-class world entry for a thing that happened.

---

## 2. What it is NOT

### 2.1 Not the book outline's Chapter-by-Chapter Plan

`notes/outline.md` has a Chapter Plan preset -- one or two lines per chapter,
the whole book in one scrollable place. That stays exactly as it is.

**Nothing is copied in either direction.** The two answer different questions
and are read at different moments: the Plan is the shape of the book, the
Chapter Outline is the play-by-play inside one chapter. Because nothing is
copied, the same fact can never disagree with itself in two places -- the rule
`docs/outline-spec.md` established when it made Book Details the single master.

```
notes/outline.md                     outlines/chapters/07-seven-to-one.md
  ## Chapter-by-Chapter Plan           1. The column is spotted at dusk
  - Ch 7 -- Seven to One: alien         2. Vance argues for withdrawal
    mercenaries destroy a much          3. The mercenaries hit the flank
    larger Slaver force ...             4. Kipling follows the wrong order
```

### 2.2 Not scene Beats

The app's hierarchy is **Story > Act > Chapter > Scene > Beat**. A Beat already
exists: a parsed, checkboxed planning checkpoint (`Beat{text, done}`) living in
an app-owned `## Beats` section inside a scene's sidecar summary.

| | Scene Beat | Chapter Outline |
|---|---|---|
| Rung | Scene | Chapter |
| Format | parsed checkboxes, app-owned section | free markdown, writer-owned file |
| State | done / not done | none |
| Home | inside `summaries/scenes/<stem>/scene-NN.md` | its own file |

The Chapter Outline is the plan the scenes get **cut from**. Beats are
checkpoints inside a scene that has already been cut. Do not merge them, and do
not give the Chapter Outline a `## Beats` section -- two things on one rung name
is the confusion this section exists to prevent.

### 2.3 Not parsed

`docs/outline-spec.md` records a standing ruling:

> "Deliberately rejected: making the Chapter Plan preset a parseable table,
>  which would re-create a machine-read structure inside the writer's file --
>  the exact thing this redesign removes -- and would break the first time they
>  reformatted it."

A chapter outline is a writer's file and gets the same treatment. **The app
never parses it into a data structure.** It reads it as text and sends it as
text. There are no line ids, no checkbox state, no required numbering. A writer
who prefers dashes, prose paragraphs or a table gets exactly what they typed.

The one thing that reads it structurally is the Weaving scan, and it reads it
as PROSE looking for names -- the same way it already reads `notes/`.

---

## 3. On disk

```
<project>/outlines/chapters/<chapter-stem>.md
```

Keyed off the manuscript filename stem, exactly as `summaries/chapters/<stem>.md`
is, so `manuscript/07-seven-to-one.md` pairs with
`outlines/chapters/07-seven-to-one.md`.

- Plain Markdown. **No frontmatter.**
- Created lazily on first write. Never scaffolded at project creation, the same
  rule `summaries/` follows.
- Ends with exactly one newline, normalised on save.

A numbered list is the convention the empty state suggests and nothing enforces:

```markdown
1. The column is spotted at dusk; Kipling counts seven and says so.
2. Vance argues for withdrawal. Milton overrules him in front of everyone.
3. The mercenaries hit the flank before the party has agreed a plan.
4. Kipling follows the wrong order and it works, which is worse.
```

**Why a new top-level folder.** `summaries/` was considered and rejected: a
forward-looking plan is not a summary, and filing it there would make the folder
name lie about half its contents. `notes/chapters/` was considered and rejected
too -- `notes/` is flat today, and its Weave reader is non-recursive, so nothing
came free from it anyway.

### 3.1 The cascade

A chapter's stem is its identity, so everything keyed to it moves together. The
Chapter Outline joins that list:

| On chapter rename | On chapter delete |
|---|---|
| `manuscript/<stem>.md` renamed | removed |
| `summaries/chapters/<stem>.md` moved | removed |
| `summaries/scenes/<stem>/` moved | removed |
| **`outlines/chapters/<stem>.md` moved** | **removed** |
| `structure.json` entry updated | entry removed |
| progress rows repointed | kept (history survives) |

Fail-soft with a reported flag, like its siblings: the rename cannot be undone
once the manuscript file has moved, so a failure downstream is reported rather
than raised. **Nothing to move counts as success** -- a chapter with no outline
must not report a failed move.

---

## 4. Editing it

A third child row under each chapter in the sidebar, beside Chapter Summary and
Scene Summaries. Opens a full editor:

- `MarkdownEditor` (CodeMirror), the same component the manuscript uses.
- **Manual save only**, per the locked product rule. Ctrl+S, a Save button, and
  an unsaved / saved pill.
- An empty state that teaches rather than looking broken.

---

## 5. How it reaches AI

Three ways, in increasing order of how little the writer has to do.

### 5.1 Attached by hand, as a chip

A `chapter_outline` chip type in the context picker, listed like chapter
summaries and named `"<Chapter Title> (Outline)"`. The current chapter's outline
is offered in the Suggested row.

Costs no new backend plumbing: `ContextChip` does not validate `type`, and the
materials builder renders any type as `=== BEGIN CHAPTER OUTLINE: <name> ===`.

### 5.2 Automatically, when drafting or enhancing that chapter

When the writer Drafts or Enhances chapter seven, **chapter seven's outline goes
with the request**, alongside the Weave's world brief. This is the case the
feature exists for: the outline is the guide, the book outline is the shape, and
the Weave's connections are who the people are.

It travels as its own field on the wire and is rendered into the materials
message **between the chips and the Weave brief**, because that is the honest
order of what each one is:

```
ATTACHED CONTEXT      what the writer chose for this turn
CHAPTER OUTLINE       the plan for this chapter
FROM YOUR WORLD       the world, as of this point in the story
FULL CHAPTER          the prose
```

It is gated to Draft, Enhance and open chat, and withheld from the structured
review passes. Readability, Structure and Context are reading prose that
EXISTS -- how it reads, how it is built, whether it fits -- and a plan is not
evidence about any of those, so sending it would charge the writer on every
pass to tell the model something it has no use for. Same rule the Weave brief
already follows per pass.

**Open chat was added in v2.0.6**, when the Chapter Outline screen gained the
Writing Companion beside it. A writer looking at their plan and asking whether
it holds together was talking to a model that could not see the document on
screen. Open conversation is the one category where the plan is the likely
subject; it stays inspectable and switchable on the context bar, so it cannot
become a cost the writer cannot see or stop.

**Two outlines now exist, and the prompts say which is which.** Both
`_DRAFT_RESPONSE_RULES` and `_ENHANCE_RESPONSE_RULES` named "outline" and meant
the book one. With two in play, one word for both is how a model comes to draft
at the wrong scale: a chapter of plot squeezed into one scene, or the shape of
the book restated instead of written.

**The locked context rule applies in full.** Automatic context must be
inspectable, removable, and switchable off. The outline appears as a row in the
existing Weave context bar with its token count and a checkbox, the preference
is remembered per book, and its tokens count against the same budget so the
Weave's own allowance shrinks honestly rather than the request quietly growing.

### 5.3 The Weaving scan reads it

Chapter outlines join `notes/` as a planning source. A faction the writer has
only ever named in chapter twelve's outline is raised as a planned name, carries
`from_planning` like every other planned name, and says which chapter's outline
it came from -- "you use this in chapter 12's outline" is a better reason than
a frequency count.

---

## 6. Build Chapter Outline

An AI helper whose only job is to build the outline the writer describes, in
their words.

- Lives in the Chapter Outline editor, not the chat panel on the right. Two
  reasons, and the second is the structural one: the writer is looking at the
  document the text is going into, and **Insert has to write into that
  editor's buffer** -- the CodeMirror handle is a ref inside that view, so
  driving it from the chat pane would mean lifting the ref into `App` for
  another pane to reach across into.
- It receives the writer's instruction, whatever outline is in the editor
  right now, the chapter's prose if any has been written, and the Weave brief
  the writer already inspected. **Not** the book outline: it does not go and
  read files behind the writer's back, because context they cannot see is what
  the locked context rule exists to prevent. Attach it as a chip if you want it.
- A chapter that is only a `# Heading` counts as unwritten. That is the
  ordinary state of a chapter being planned, and sending the heading as "what
  is already written" hands the model an empty block and invites it to treat
  the chapter as started.
- It runs on the **structure** model role -- "shape and pacing: acts, chapters,
  scenes, beats" -- which is exactly what a chapter outline is.
- **It returns text and writes nothing.**

### 6.1 Insert, and the write boundary

The reply carries an **Insert** button that puts the text into the Chapter
Outline editor, where it sits **unsaved and fully editable** until the writer
saves.

This stays inside the AI write boundary and does not need a new exception to it.
The boundary forbids AI output landing in a human-authored field "without the
writer applying it, per action" -- and `docs/roadmap.md` already ruled that "an
explicit per-section Apply button would stay inside the write boundary". Insert
is that button. Nothing reaches disk without a save.

The three conditions the Generate Overview precedent set are all met: it is
writer-clicked per use, it lands in an editable field, and it saves nothing
until the writer saves.

### 6.1a Names are the writer's to invent

**The rule that connects the two halves of this slice.** Section 5.3 teaches the
Weaving scan to read chapter outlines, so a capitalised name in one is raised as
something the writer has planned. A model that invents "the Ashfall Compact" to
make a line read better therefore does not just add a word: the writer inserts
it, saves it, and the Weave later asks them about a faction they never chose, as
though it were their own idea.

So the prompt forbids proper nouns that are not already in the material it was
given, and tells it what to do instead -- "the older guard", "the northern
settlement". A description is honest about being a gap; an invented name looks
like a decision. The outline presets carry the same rule for the same reason,
and `test_chapter_outline_ai.py` asserts it rather than trusting the prompt to
be read carefully.

### 6.2 What it must say about itself

It is **optional**, and the explanation says so plainly. A writer who knows
exactly what happens in their chapter should type it and never open this. It
earns its place for a writer finding the story as they write it.

---

## 7. Planned in

An entry can say which chapters PLAN to use it:

```
Kipling
  Appears in:  ch 1, ch 4          (declared by the writer)
  Planned in:  ch 7, ch 8, ch 12   (found in those chapters' outlines)
```

**Derived, and never stored.** This is the rule that matters most in this
document, and it is written down because the app has already made the opposite
mistake once. R8.5 deleted the `codex_mention` table because mentions derived
from the manuscript while the freshness gate fingerprints `codex/` -- so every
chapter the writer edited left the rows silently wrong with the index reporting
itself current. A cache that answers confidently and wrongly, with nothing in a
position to notice.

"Planned in" derives from `outlines/`, which the index does not fingerprint
either. So it is computed on read, from the files, every time. Forty small
files is cheap. A confidently wrong answer is not.

It is rendered beside `appears_in` and clearly distinguished from it:
`appears_in` is **authored** -- a statement the writer made -- and this is
**derived**. They must never look like the same kind of claim.

---

## 8. Shipping

| Slice | What | Usable on its own | |
|---|---|---|---|
| 1 | The document: file, editor, sidebar row, cascade, export, search, chip | write and keep an outline | SHIPPED |
| 2 | Automatic in Draft, Enhance and open chat, with the context-bar row | the AI writes to the plan | SHIPPED |
| 3 | Build Chapter Outline + Insert; the Weave scan; Planned in | the AI helps build the plan | SHIPPED |

Each slice runs the four gates before the next begins.
