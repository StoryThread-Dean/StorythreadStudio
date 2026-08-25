# Names an Entry Answers To -- Specification

**Status:** partly shipped (v2.0.0, inside Weaving); the writer-facing half
specified 2026-08-25 for v2.0.3. Sections are numbered so tests can cite them.

**What this is.** A character is rarely called one thing. Gwendolyn Barksdale is
*Gwendolyn* on her birth certificate, *Gwen* to everyone who knows her, and
*Willow* on stage. All three are her. This is how the writer says so, and how
the app keeps the three pointing at one profile.

**How to read this.** Numbered sections are the CONTRACT. Where this and the
code disagree, **the code is wrong** until the writer rules otherwise.

**The report, 2026-08-25.** The machinery exists and only Weaving can reach it:
"We need to build a way for A) writer can manually type in the known Aliases
before even going to Weaving walkthrough." The writer is world-building ahead of
the manuscript -- profiles, lore, relationships, outline and beats all before
chapter 1 -- so every path that starts from prose is closed to them. Aliases are
knowledge they have NOW.

---

## 1. What already exists

Recorded so none of it is rebuilt.

| Piece | Where |
|---|---|
| `aliases: [...]` in a Thread's frontmatter, round-tripped | `codex/threads.py:265,617-619` |
| `POST /api/codex/alias` -- teach an entry another word | `routers/codex.py:2033-2105` |
| Ambiguity REFUSED by name: one word cannot mean two things | same, the `alias_taken` branch |
| `display_name` -- what the story calls it, kept apart from `name` | `codex/threads.py`, `absorb` |
| `build_alias_map` -- every name and alias to entity ids | `codex/mentions.py` |
| **A word in the alias map is not Unspun by definition** | `codex/mentions.py`, `unbound_names` |
| `absorb` -- move a word off a placeholder into a real entry | `routers/codex.py` |
| The Unspun stop's third answer (R11.6) | `features/codex/BindDot.tsx` |

**So the backend for manual entry is already built.** `POST /alias` takes an
entity id and a word, refuses an ambiguous one naming the owner, optionally sets
the label, and reindexes. What is missing is a way to call it that does not
involve finding the word in prose first.

## 2. The gaps

1. **No writer-facing control.** Every route to an alias starts from a word the
   scan found in the manuscript. A writer with no manuscript cannot reach any of
   them.
2. **`profiles/` has no aliases at all.** `routers/profiles.py` does not mention
   the word. On an unconverted project the field does not exist, so a manual
   alias would have nowhere to live.
3. **An alias binds silently, and is never confirmed.** Once "Gwen" is recorded,
   the scan stops raising it -- correct, and it means the writer is never asked
   whether the binding is right. A mistyped or mis-assigned alias is invisible
   forever, because being invisible is exactly what a correct alias does.
4. **A rename leaves aliases behind.** Changing an entry's `name` touches
   `aliases` not at all. The writer's own example: Gwendolyn becomes Audrey, the
   nickname becomes Drea or Audie, and `Gwen` sits there still binding prose to
   her. Nothing raises it, because a stale alias and a good one are the same
   shape.

Gaps 3 and 4 are the "works from both sides" half of the report, and they are
one problem: **the app has no moment at which it asks whether a recorded name is
still true.**

---

## 3. Where aliases live

### 3.1 Both dialects, like every other field

`aliases: list[str]` is added to `routers/profiles.py`, read and written, so a
`profiles/`-home project can hold them. Bound by a contract test against
`codex/threads.py`, because a field one parser knows and the other drops is the
bug R11.3 and the `subtext` round trip were each an instance of.

Absent means none. Written only when non-empty, so an ordinary profile resaves
with no diff.

### 3.2 Which kinds get the control

**Characters and creatures**, per the report, and **every other kind too.**

The writer was unsure ("not sure if we need it for the others"). They do:
a place is *Ashfall*, *the Ash*, *the burned city*; a faction is *the Guild* and
*the Weavers*. `build_alias_map` already walks EVERY Thread regardless of kind,
and `POST /alias` takes any entity id, so restricting the UI to two kinds would
be a limit invented by the screen and contradicted by the index behind it.

### 3.3 `name`, `display_name` and aliases stay three things

- `name` -- what the entry IS. The filing name. `Gwendolyn Barksdale`.
- `display_name` -- what the story CALLS it, when that differs. `Gwen`.
- `aliases` -- every other word that means it. `Willow`, `Gwendolyn`.

Already true in the codex and worth restating, because the obvious
simplification -- one list, first entry wins -- loses the distinction that lets
a profile be filed under a full name and read under a nickname.

---

## 4. Typing them in (A and B)

### 4.1 Where

In the Profile Builder header, under Name, on every kind. Not behind a menu: a
writer who knows their character has three names needs to see the field on the
page where the character is written.

### 4.2 What it does

One chip per alias, an input to add another, and a remove. Enter adds, because
typing three nicknames should not need three trips to a button.

**AMENDED WHILE BUILDING: it edits the BUFFER, not the route.** The first draft
of this section had each add post to `POST /api/codex/alias`. That is how
Weaving does it and it is wrong here: the Profile Builder's locked rule is
manual save, so an alias typed on this screen is unsaved work until Ctrl+S, like
the name above it. Writing one field immediately while every other field on the
page waits would give one screen two behaviours.

Weaving keeps posting immediately, and that stays right there: a walkthrough
answers one question at a time and has no save button to press.

**Ambiguity is refused with the other entry NAMED**, in nearly the route's own
words -- *"'Gwen' already means Gwendolyn Ashby. One word cannot mean two
things, or mentions of it would match neither."* That sentence explains the
consequence rather than just refusing, which is why it is worth reusing.

**The screen's check is partial, and that is stated rather than hidden.** It
compares against the entries this screen has loaded, which is the current KIND
only. It catches the common collision -- two people both called Gwen -- and
cannot see across kinds. `POST /alias` remains the authority whenever an alias
reaches it through the Weave, and closing the gap means either loading every
kind here or checking on save. Open question 4.

**Already-true is not an error.** The writer's belief about their own world is
correct and there is nothing to do; the screen says so and moves on.

### 4.3 What it does NOT do

No auto-generation. The app does not offer "Gwen" because the name is
Gwendolyn. A guessed alias that the writer does not notice is a wrong binding
they never chose, and the whole point of section 5 is that wrong bindings are
invisible.

---

## 5. Asking whether it is still true (C)

### 5.1 The rule

**An alias is confirmed ONCE against the manuscript, and re-asked when the
entry's name changes.**

Not every scan -- a stop that reappears every run is a stop the writer learns to
dismiss. Not never -- that is gap 3.

### 5.2 The stop

When a scan finds an alias in prose and that alias has not been confirmed for
the entry's CURRENT name, it raises one stop:

> **"Gwen" appears in Chapter 4, and you have it recorded as another name for
> Gwendolyn Barksdale.** Is that right?
>
> - Yes, that is her
> - No, it means something else  (offers to remove the alias)
> - Not a name at all  (retires the word)

Evidence is the quoted line, like every other stop.

### 5.3 Staleness comes free, from the stop key

The stop's key is `alias_check|<entity_id>|<alias>|<slug of the entry's current
name>`.

**Renaming the entry changes the key**, so a confirmed alias becomes an
unconfirmed one automatically and is asked again. No new stored field, nothing
to keep in sync, and no way for the record to disagree with the file -- the same
reasoning that keeps ordinals computed rather than stored.

The writer's own scenario lands exactly right: Gwendolyn becomes Audrey, and the
next scan asks whether `Gwen` is still one of her names rather than binding it
silently for the rest of the book.

Answers persist in the run ledger under `.storythread/weave/runs/`, which is
already the one thing under `.storythread/` that is not derivable and not in
`app.db`.

### 5.4 It only fires on prose

An alias the manuscript never uses is never asked about. A writer building the
world ahead of chapter 1 records twelve nicknames and is asked about none of
them until the prose uses one, which is the first moment the answer matters.

---

## 6. What must be tested

1. `aliases` round-trips through BOTH parsers; absent stays absent; an ordinary
   profile resaves with no diff (3.1). Verified by reinstating the drop.
2. Adding an alias from the Profile Builder reaches the same route Weaving uses,
   so the two cannot diverge (4.2).
3. An ambiguous alias is refused with the OWNER NAMED, and nothing is written
   (4.2).
4. Re-adding a word the entry already answers to is not an error (4.2).
5. Every kind offers the control, not just characters (3.2).
6. A word in the alias map is still never raised as Unspun -- the existing
   guarantee must survive (1).
7. An alias found in prose raises the check stop once, and not again after it is
   answered (5.2).
8. **Renaming the entry re-raises it** (5.3). The acceptance case, and the one
   that fails if the key stops carrying the name.
9. An alias the prose never uses raises nothing (5.4).
10. Answering "no" removes the alias and the word becomes Unspun again on the
    next scan, because it is now a name with no entry behind it.

---

## 7. Deliberately not built

- **Generating aliases from a name** (4.3).
- **Fuzzy matching.** "Gwenn" does not find Gwen. A near-miss that binds is a
  wrong binding, and section 5 exists because those are invisible.
- **Per-alias validity windows.** A trait has `true_in` and an entry has
  `appears_in`; an alias that is only true after chapter nine is a real idea and
  is not this release. `revealed_at` on a FACT already covers the case that
  matters (the reader learning a true name).
- **Renaming an entry from the alias control.** Promoting an alias to the name
  is a rename, and rename already exists.

---

## 8. Open questions

1. **Should answering "no" delete the alias or just unbind it here?** Deleting
   is simpler and matches "one word cannot mean two things". Unbinding per
   chapter would need per-chapter alias state, which nothing else in the Weave
   has.
2. **Does `display_name` want a control here too**, or does setting the label
   stay part of the alias row (`as_label` already exists on the route)?
3. **Relationships.** Reported in the same message as "another section I need to
   tackle ... because it currently doesn't work". Not scoped here; recorded so
   it is not lost.
4. **Should the screen's duplicate check see every kind?** Today it sees the
   current one (4.2). Loading every kind to check a nickname is a real cost on a
   large world; checking on save is cheaper but tells the writer later. Neither
   is obviously right.

---

## 9. Build status, 2026-08-25

**Sections 3 and 4 are built.** Aliases round-trip through both parsers, the
editor is on every kind in the Profile Builder header, and the contract test
pins that neither dialect can drop them.

**Section 5 is NOT built.** The stop, the stop key carrying the entry's name,
and the re-ask after a rename are specified and unimplemented. Until they are:

- a manually typed alias binds prose silently and correctly, which is the whole
  point of typing it in; but
- **a rename still leaves stale aliases behind**, exactly as reported, and
  nothing raises them.

So the writer's "works from both sides" concern is half answered. Typing them in
works. Being asked whether they are still true does not exist yet, and the
Gwendolyn-becomes-Audrey case still ends with `Gwen` quietly bound to Audrey.
