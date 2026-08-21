# The Outline -- specification

**Status:** in build for v2.0.2. Source of truth for the Outline feature.
Where this document and the code disagree, the code is wrong until the writer
rules otherwise.

---

## 1. What the Outline is

**A second main editor.** Raw Markdown, type and go. Clicking Outline in the
sidebar opens the ordinary note editor on `notes/outline.md` -- the same
editor, the same Save button, the same unsaved indicator as a chapter.

It is not a form. It is not a wizard. The writer's outline is prose they own,
and the app's job is to get out of the way and offer structure when asked.

### What it replaced, and why

The old Outline opened `OutlinePlanner`, a form screen: a "Project Targets"
card of tag inputs, and one collapsible card per `##` heading. Three problems,
all reported:

1. **It was a form, not an editor.** A writer wanting to type a paragraph had
   to find the right card and expand it.
2. **"+ New Template" was unreachable.** It only rendered in the *raw* note
   editor, so making a new outline meant first discovering a "Raw view" button
   in the corner of a screen you were trying to leave.
3. **New Template overwrote everything** with a large pre-filled scaffold --
   three acts, worldbuilding hooks, a chapter plan, every field carrying an
   italic example. A writer who wanted a fresh start got somebody else's book.

---

## 2. The worksheet

### On disk

A new book's `notes/outline.md`:

```
# Outline -- The Ashen Pact

Title: The Ashen Pact
Series: The Ember Throne Saga
Genre: Epic Fantasy
Tone: Grimdark, slow burn
Description: A disgraced necromancer is called back to the capital.
Setting:
Theme:
Tense:
Target Word Count: 90000
Target Chapter Count:

```

That is the whole file. Ten labels in this order, one H1, and blank space
where the writer starts typing.

### What is deliberately absent

- **No YAML frontmatter.** The old file opened with a `---` block of
  `target_word_count`, `expected_characters`, `chapters` and teaching
  comments. It was machine data sitting at the top of a human document.
- **No `---` anywhere in the shipped worksheet.** The frontmatter regex is
  `\A`-anchored, and the healer keys on that anchor. A rule that can drift to
  position 0 is a corruption vector for no benefit; a blank line separates
  just as well.
- **No `<!-- TREAT AS SEED METADATA -->` block.** That comment existed because
  the templates shipped *invented* example values -- "Kael", "Ironhold" -- and
  a model reading the file could adopt them as canon. The worksheet ships no
  invented values at all: every line is blank or the writer's own text. There
  is nothing false left to protect against.
- **No instruction prose.** Teaching lives in `<Explain of="..." />`. Teaching
  in the file gets exported, searched, replaced, scanned as prose, and re-read
  by the AI.

### Parsing

Only two lines are read back by anything:

```
Target Word Count: 90000
Target Chapter Count: 30
```

Tolerant of: any case, a leading `-` or `*` bullet, `**bold**`, arbitrary
internal whitespace, and comma grouping (`90,000`). **First match wins**, so a
stray mention further down the writer's prose cannot override the header. A
value that is absent, non-numeric or non-positive means **unset** -- never
zero, because zero is a real target and "I have not decided" is not.

Deliberately **not** tolerant of alternate spellings ("Word target", "Target
words"). One spelling, shipped and taught. Over-flexible parsing produces
silent surprises a writer cannot debug.

### The eight descriptive lines are NOT a master

Title, Series, Genre, Tone, Description, Setting, Theme and Tense are all Book
Details fields, stored in `project.json`, and injected into AI prompts as
STORY CONTEXT.

> The worksheet's eight descriptive lines are **a one-way copy, made on
> request, and never read back**. `project.json` stays the single master for
> everything the AI sees. Only **Target Word Count** and **Target Chapter
> Count** are mastered in `outline.md`, and neither exists in `project.json`.

Corollary: **saving Book Details must never rewrite the outline.** One
explicit button ("Fill from Book Details") is the only door. A settings save
that silently edits the writer's outline file is the same class of surprise as
the corruption regression in section 6.

---

## 3. Preset sections

A dropdown of ready-made sections. Choosing one appends it to the outline;
that entry then greys out, because the dropdown reads the outline.

### The rule that governs their content

**No preset body contains an invented proper noun.**

Preset text lands in a file that (a) feeds the Weave's planned-name scan and
(b) can be attached to AI context as a chip. An example reading *"e.g. Kael
must reach Ironhold"* would put two fabricated names into the writer's world
and raise them as things they had planned. An example reading *"a healer who
cannot heal herself takes a job guarding the man who crippled her"* teaches
the same thing and poisons nothing.

Every example line is italic and prefixed `_Example:`, so it reads as
illustration and is trivial to find and delete.

### Where the catalog lives

`backend/app/outline_presets.py`, served over HTTP. **Not** a TypeScript
registry with a contract test.

The reason is deployment, not taste: `_template_vocabulary()` in
`codex/scan.py` must subtract preset words from planned-name candidates, and
it runs inside the packaged Python backend, where a relative path into the
renderer bundle may not exist. A missing path there costs the writer their
planned-name filter *silently* -- exactly the R11.7 failure mode. The frontend
holds no copy of the text.

### The catalog

| Group | Sections |
|---|---|
| Story Core | Premise, Story Promise, Central Conflict, Protagonist |
| Story Overview | Story Summary, Beginning State, Inciting Change, Escalating Change, Crisis, Climax, Resolution |
| Character Module | Identity, Story Function -- both **repeatable** |
| Structure | Act Beats, Midpoint |
| World Module | Setting Sketch, Rules and Limits, Factions and Powers |
| Chapter Plan | Chapter Plan |

"Setting Sketch" rather than "Setting", so its `##` heading is visibly
distinct from the worksheet's `Setting:` line.

### Greying out

- Source of truth is the **live editor buffer**, not the saved file. A preset
  inserted but not yet saved greys immediately; Ctrl+Z un-greys it.
- Match is **exact after normalisation** on `##` lines: lowercase, collapse
  whitespace, drop a trailing ` -- suffix`.
- **Not fuzzy, not substring.** Substring matching would grey out Climax
  because the writer wrote `## Climax and Resolution`, with no way to get the
  other one back.
- Renaming or deleting a heading un-greys it automatically, because the buffer
  is the truth. No bookkeeping.
- **Repeatable presets never grey.** Identity and Story Function are
  per-character; a writer needs them many times.
- A greyed item stays visible and disabled, says "Already in your outline",
  and **clicking it scrolls the editor to that heading**. A dead end that
  still helps.

### Insertion

Appended at the end of the document after a blank line -- never at the cursor,
which mid-sentence would split the writer's prose. One CodeMirror transaction,
so one Ctrl+Z undoes the whole paste.

---

## 4. Book Details

Gains **Target Chapter Count**, beneath Word Count Target, same "blank means
leave alone" rule, stored in the outline worksheet rather than `project.json`.

The **Fill from Book Details** button (formerly "+ New Template") writes the
worksheet into the editor buffer, unsaved, respecting manual save. When a
worksheet already exists it **fills blank lines only** and never overwrites
what the writer typed. One transaction, so Ctrl+Z reverts it -- which is why
it needs no confirm dialog, unlike the hard overwrite it replaces.

---

## 5. The Writing Progress gauge

| Segment | Weight | Measures |
|---|---:|---|
| Manuscript | 60 | words on disk vs Target Word Count (falls back to the story-type default) |
| Outline | 20 | `100 x fields_filled / 10` |
| Notes | 20 | non-outline notes present |
| Weave | 0, informational | entry counts per kind |

**Outline is a gradient now**, not the old binary `100 if has_frontmatter else
0`. Three filled fields is 30% of the Outline slice.

**The Weave slice is counted, not scored.** With no writer-declared cast list
there is no honest denominator, and inventing one ("a novel should have 12
characters") would be the app deciding how many people are in someone's book.

**The `expected_characters` / `expected_locations` / `expected_lore` /
`expected_relationships` inputs are dropped.** The Weave already knows the
writer's cast, and the Unwoven pass already asks about planned-but-unwritten
things.

> Consequence that must ship in the same change: the old profiles slice was
> scored as *matched / expected* against those very lists. Removing them
> without reweighting would leave a 30-point hole and cap the gauge at 70%
> forever.

The weighted split is gated on `outline_present` rather than
`has_frontmatter`. **CHANGELOG must note** that hand-made outlines with no
frontmatter previously used 100%-manuscript and now use the weighted split.

**Per-chapter word targets retire.** They only ever came from hand-edited
YAML. The per-chapter list stays (filename, title, words, reading order); the
target bars go. Deliberately rejected: making the Chapter Plan preset a
parseable table, which would re-create a machine-read structure inside the
writer's file -- the exact thing this redesign removes -- and would break the
first time they reformatted it.

Target Chapter Count gets exactly one use: the Manuscript row reads
*"12 of 30 chapters"*.

---

## 6. Converting an existing outline

Every project on disk today has YAML frontmatter and a full template body.

### Healing is subtractive. It is NOT re-templating.

Existing projects keep their template body untouched. It is the writer's now,
whatever it started as. **Only the machine block at the top converts.** That
is the difference between a migration and data loss.

### Six non-negotiable properties

The Planner corruption regression (see `backend/tests/test_outline_sections.py`)
happened because `_reconstruct_outline` **split a file into parts and rebuilt
it**. The healer must not be that shape.

1. **A text transform, never parse-and-reconstruct.** It removes one leading
   region and inserts one block. No `"".join(parts)`. The body is carried
   through as one opaque slice.
2. **A no-line-lost post-condition, enforced in code.** Before writing, assert
   that every original line outside the removed frontmatter still appears, in
   order, in the output. On failure: **abort, write nothing, log loudly.**
3. **A fused-separator guard.** Assert the output contains no `^---##` line --
   the exact historic bug shape.
4. **Idempotent.** Healing a healed file is a byte-for-byte no-op.
5. **Refuse when ambiguous.** No `\A` frontmatter match, or a YAML body that
   fails `safe_load`: do nothing and log. A malformed file the writer can see
   beats a file the app quietly rewrote.
6. **Snapshot, then write atomically.** Pre-heal bytes are copied to
   `.storythread/snapshots/outline-heal/<timestamp>/notes/outline.md`, reusing
   the shape `search.py` already uses for global replace. The write goes
   through `replace_atomic`.

### Nothing the writer typed is discarded

If the old frontmatter holds non-empty `expected_*` lists or a `chapters:`
list, those values move into a visible section at the end of the file:

```
## Kept from your old outline

Characters: Kael, Vire
Locations: Ironhold
Chapters: Opening (3000), The Fall (4200)
```

The labels are chrome that the scan strips; the values are the writer's own
invented names and correctly reach the Unwoven pass. Empty lists simply
disappear.

### When it runs

**Automatically on open, at one call site:** `GET /api/documents/note`, guarded
on `filename == "outline.md"`. That is where the file is read anyway, so there
is no window serving a stale read, and it matches the heal-on-load precedent
the original corruption fix established.

The response carries `healed: bool`. When true the editor shows a dismissible
banner naming the snapshot and offering the next step.

**Files with no frontmatter are never touched automatically.** The healer only
ever removes the app's own YAML. Adding anything is offered, through Fill from
Book Details. Automatic is subtractive; additive is always asked.

### Defence in depth

`read_targets` tries the worksheet lines first and **falls back to legacy
YAML**. So "the gauge is correct" is decoupled from "the file has been
rewritten": if healing is refused, broken, or has simply not run yet, nothing
downstream degrades.

---

## 7. What retires

**Deleted:** `OutlinePlanner.tsx`; `GET`/`POST /api/documents/outline` and its
four models; `_parse_outline_sections`, `_serialize_frontmatter_block`,
`_reconstruct_outline` (**this is what removes the corruption class
entirely**); `POST /api/projects/apply-outline-template`; the five template
renderers and `outline_templates.py`; `VALID_OUTLINE_TEMPLATES`,
`STORY_TYPE_DEFAULT_TEMPLATE`, `OutlineTemplateType`; both template pickers and
the modal; the `outline_planner` view.

**Kept deliberately:**

- `VALID_STORY_TYPES` and `STORY_TYPE_OPTIONS`. `story_type` drives the gauge's
  fallback target, `is_serial` (which drives the placeholder card and a null
  target), and the recent-projects list. Only the tile hint text changes -- it
  currently advertises the retiring scaffolds by name.
- Existing `project.json` files keep their `outline_template` key. Stop reading
  it; do not strip it. `test_project_portability.py` depends on unknown-key
  tolerance.
- `outline_frontmatter.py`, **renamed to `yaml_frontmatter.py`**. It cannot be
  deleted: `progress.py::_profile_name_from_file` uses
  `parse_outline_frontmatter` to read a **profile's** `name:` field. It was
  never outline-specific. Only `set_target_word_count` moves out.

### The change nobody would think of

`_template_vocabulary()` renders all five templates and subtracts their words
from planned-name candidates. Measured on the writer's real outlines: 53
planned names down to 23, and 34 metadata tags down to 9.

**On the day the renderers are deleted, every existing project still contains a
full template body -- but the scan stops subtracting its words.** The noise
jumps straight back to 53. Deleting the templates would silently undo R11.7 for
every project already on disk.

Mitigation, which **must ship in the same commit as the deletion**: render the
five templates once, commit the extracted word set as
`backend/app/data/retired_outline_vocabulary.txt`, and union it in permanently.

---

## 8. Rules inherited from the app

- **Manual save only.** Unsaved changes look unsaved; leaving confirms.
  `components/learn/useAttemptClose.ts` is the one close guard.
- **Every feature explains itself.** `<Explain of="outline.worksheet" />` and
  `<Explain of="outline.presets" />`, both `FREE` -- no model is called
  anywhere in this feature.
- **Every step proposes the next one.** Inserting a preset says what happened
  and what is next.
- **No em dashes** in any shipped text. `--`.
