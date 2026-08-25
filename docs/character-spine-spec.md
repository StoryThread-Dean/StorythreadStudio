# Character Spines -- Specification

**Status:** redesign of a shipped feature (v1.0.10), specified 2026-08-25 for
v2.0.3. Sections are numbered so tests can cite them.

**What this is.** The two controls at the top of a character profile that help a
writer decide who someone IS before writing them: **Personality (Enneagram)**,
the inner engine, and **Story Role**, the job they do in the book. Both ship
canned text. No AI, no network, no cost.

**How to read this.** Numbered sections are the CONTRACT. Where this document
and the code disagree, **the code is wrong** until the writer rules otherwise,
and a behaviour change belongs in the same commit as the change to this file.

**Why it is being redesigned.** The writer's report, 2026-08-25: "I still like
the idea of the personality type, but we need a way for the writer to see an
interface pop-up with an extended pick and choose the sections of the
personality ... its the right idea, but poorly executed currently and
situational at best." The idea is sound and stays; the interaction does not.

---

## 1. The failure, precisely

Recorded because each half is a different mistake and only one of them is about
content.

### 1.1 The Enneagram inserts one indivisible paragraph

`ENNEAGRAM_OPTIONS[n].summary` is a single string of roughly five fused
sentences, and picking a type drops all of it in. The writer's worked example,
Saki Murakami, a recurring merchant who appears only in her own shop, given
type 1: "Wants to be good and beyond reproach and dreads being corrupt or wrong.
That's a good trait for a merchant. notices the crooked picture frame in any
room isn't helpful as they only ever appear situationally in their own store."

Both judgements are correct, and no interface existed to act on either. The
content is not the problem. **The granularity is.**

### 1.2 The type does not persist, and least of all where it was reported

The select renders `value=""` always, so it snaps back to "Pick to insert a
starting point..." -- reported as "the functionality and purpose of picking the
ennegram never stays put".

This is worse on the template the report came from. A MAIN character gets a
named trait block, `Enneagram: 1 -- The Reformer`, so something records the
choice. A SIDE character goes through `appendToSectionContent`, which appends
the paragraph as **unlabelled prose**. Saki is a side character. For her,
nothing on disk recorded that a type had been chosen at all.

### 1.3 It was a known problem answered with documentation

`SpinePickers.tsx` says, of the select clearing itself: "looks broken until you
know that, which is exactly the kind of thing 'show me how' is for."

An explanation is the right answer to a thing that is confusing but correct. It
is the wrong answer to a thing that is confusing because it is wrong. Naming
this because it is the third instance this release (the Loose thread headline
and the off-screen Explain panel were the others) and it is worth being able to
recognise: **when the help text has to apologise for the behaviour, change the
behaviour.**

### 1.4 Every role pick erases the roles already there

Both controls assign rather than add:

- `updateProfileField("role", e.target.value)` -- the grouped quick-pick
- `updateProfileField("role", picked.label)` -- the archetype picker

Reported against the second, true of both. The writer's case: Saki is a
"Merchant, Red Herring", and adding Everyman "literally erases what currently
exists in Role."

### 1.5 There are two Role controls, and the better-looking one is worse

- **Next to the Role field:** grouped Popular / Less Common / Niche, 28 options,
  `w-24` wide, **no explanation of any option**.
- **Below, in `SpinePickers`:** ungrouped, 15 archetypes, and it HAS the
  per-option help the writer called "helpful and useful".

Reported as confusing, and it is: the control with the better list has no help,
and the control with the help has the shorter list. The two lists share only 5
literal entries (Mentor, Villain, Rival, Confidant, Comic Relief) plus
conceptual pairs like Hero/Protagonist and Shadow/Villain, so this is a MERGE,
not a deletion -- and the archetype picker also inserts writing guidance, which
is the single most useful piece of content in the feature.

### 1.6 The role list does not contain the writer's own example

`ROLE_SUGGESTIONS` has no **Merchant**. It has no Innkeeper, Healer, Guard,
Suspect or Witness either. It grew out of story-theory vocabulary -- Threshold
Guardian, Greek Chorus, Shapeshifter -- and never covered the ordinary people a
world is full of. The writer typed "Merchant" by hand, which is the report.

The grouping is the cause: **Popular / Less Common / Niche sorts by frequency**,
which tells a writer nothing about which role they are looking for.

---

## 2. Rulings

Taken by the writer, 2026-08-25.

1. **The Enneagram type becomes a stored field.** The profile remembers it,
   identically on main and side templates.
2. **Role is a comma list that is APPENDED to**, never overwritten, and never
   duplicated. It stays a single string.
3. **One Role control.** The grouped list survives, the per-option help moves up
   and expands, and the archetype's writing guidance stays as an explicit
   insert.
4. **NOT fed to AI in this release.** See 8.

---

## 3. Facets: the unit the writer actually chooses

### 3.1 The model

A `SpineOption` gains `facets`, an ordered list. Each facet is one sentence the
writer can take or leave on its own:

```ts
interface SpineFacet {
  id: string;               // stable, for tests and for greying
  kind: "wants" | "dreads" | "habit" | "speech" | "cracks" | "hook";
  text: string;             // ONE sentence, insertable alone
}
```

`kind` groups the list under headings so eight lines read as a structure rather
than a wall. It is not a filter and the writer never picks by kind.

### 3.2 Type 1, decomposed, as the worked example

The formula the data file already declares -- "behavior + speech pattern + how
they crack under pressure, ending with a fill-in hook" -- is exactly the seam.
Nothing is rewritten; the paragraph is cut where it already joins.

| kind | text |
|---|---|
| wants | Wants to be good and beyond reproach. |
| dreads | Dreads being corrupt or wrong. |
| habit | Holds themselves and everyone nearby to a standard no one agreed to. |
| habit | Notices the crooked picture frame in any room. |
| habit | Apologizes rarely but corrects often. |
| speech | Speech is precise, measured, lightly instructional. |
| cracks | Under pressure the inner critic turns outward: nitpicking becomes resentment, resentment becomes cold fury at a world that will not behave. |
| hook | This sharpens around ____ because ____. |

**Splitting the habits into separate lines is the load-bearing part of this
whole spec.** It is what lets the crooked picture frame go while "a standard no
one agreed to" stays -- the writer's exact edit. A decomposition that kept
behaviour as one facet would have failed the report it was written for.

### 3.3 The rule for authoring facets

- One sentence, one facet. A facet joined by "and" is two facets.
- A facet must read correctly ALONE. Nothing may depend on a sentence above it.
- No invented proper nouns. Same rule as the outline presets, same reason: a
  model would adopt one as canon and the Weave's scan would raise it as a
  planned name.
- No em dashes.
- `hook` facets keep their `____` blanks. They are a prompt to the writer, and
  filling them in is the point.

### 3.4 The old `summary` field

Kept, and kept in sync: it is the concatenation of every facet. Deleting it
would break `insertPrefilledTraitBlock` call sites and the existing tests for no
gain, and having it derived means the two cannot disagree. A contract test
asserts `summary === facets.map(f => f.text).join(" ")`.

---

## 4. The pop-up

### 4.1 What opens it

The header shows the stored type and offers the pop-up. There is no
snapping-back select anywhere (1.2):

```
Personality:  1 -- The Reformer   [change type]  [pick facets]
```

Unset, it reads as an invitation rather than a blank: `Personality: not set
[choose a type]`.

### 4.2 Nothing is pre-ticked, and there are two one-click sets

Nothing ticked on open, because this writes into the writer's own file -- the
rule the Sweep and the storage dialog already follow.

But an empty list every time would make the quick path slower than the thing it
replaced, and "I want to give her a personality quickly" is the reported use
case. So two buttons tick a set without writing anything:

- **Essentials** -- `wants`, `dreads`, `speech`. The three the writer kept.
- **Everything** -- all of them, which is exactly today's behaviour, still one
  click away for anyone who wants it.

Both only move ticks. Insertion is always a separate, explicit press.

### 4.3 Already-taken facets are greyed, from the LIVE BUFFER

A facet whose text is already in the Personality section is greyed and cannot be
double-inserted.

Compared against the **live editor buffer**, not the saved file -- the rule the
outline presets already use, and for the same reason: an unsaved insert greys
immediately and Ctrl+Z un-greys it. A writer who reopens the pop-up to add two
more facets sees which four they already took.

Matching is exact on the facet's text. If the writer has edited the sentence the
match fails and the facet offers itself again. **That is the correct failure
direction:** offering something twice costs one glance, and silently greying a
line the writer has rewritten would hide a facet they never took.

### 4.4 Where the text lands

One trait block per insertion batch on the MAIN template, named
`Enneagram: <label>`, importance `core`, holding the chosen facets.

On the SIDE template, an appended paragraph -- but **labelled**, which fixes
1.2. A side character keeps a record of its type like a main one does.

Inserting again adds to the existing block rather than creating a second one.
Two blocks both named `Enneagram: 1 -- The Reformer` is the kind of duplicate
that makes a writer distrust the feature.

### 4.5 Changing type

Changing the stored type **never touches text already inserted.** The writer's
prose is theirs; a type is a starting point, and half of a type 1 plus half of a
type 8 is a legitimate character rather than a mistake to clean up. Changing the
type says plainly that earlier text stays and can be deleted by hand.

---

## 5. The stored field

`enneagram` on the character: the option **id** (`e1`), not the label.

An id survives relabelling; a label does not. `1 -- The Reformer` reaching the
file means a future wording change silently orphans every profile.

- **Absent means not set.** Every profile ever written is in that state and
  stays in it. Nothing changes for a writer who never opens this.
- Written to frontmatter only when set, so an ordinary profile resaves with no
  diff.
- An unknown id (hand-edited, or from a future version) reads as **not set** and
  is **carried through on save** rather than dropped. Refusing to guess in the
  destructive direction is the rule `normalize_trait_window` already follows.
- Both dialects carry it: `profiles.py` and `codex/threads.py`, bound by a
  contract test, because a field one parser knows and the other drops is the
  bug R11.3 and the `subtext` round trip were both instances of.

**No facet selection is stored.** The facets ARE the text in the Personality
section, which is their only master. Storing "4 facets taken" beside the text
would be a second copy of a derived fact, free to drift the moment the writer
edits a sentence -- and 4.3 derives it from the buffer anyway.

### 5.1 Story Role is NOT a second stored field

It is one or more entries in `role` (6). An archetype is a role, and giving it
its own field would mean one idea with two homes and a rule about which wins --
the failure this codebase keeps finding.

---

## 6. Role

### 6.1 Append, dedupe, never overwrite

Picking appends to the comma list. Picking something already present does
nothing. Comparison is case-insensitive and whitespace-trimmed, so `merchant`
does not join `Merchant`.

`role` stays a single string, so every existing reader -- the Weave index, the
sidebar rows, prompt builders, `archetypeIdForRole` -- keeps working with no
migration.

`archetypeIdForRole` currently matches the WHOLE field against an archetype
label, so it returns nothing for `Merchant, Red Herring, Everyman`. It must
match any comma-separated part, or Quick Build's default silently stops working
for exactly the writer who used this feature.

### 6.2 One control

The grouped dropdown beside the Role field is the only Role control. The
`SpinePickers` Story Role select is removed.

The per-option help moves up, expands, and covers **every** role, not just the
15 archetypes -- so the list with the better coverage gains the help it never
had (1.5). For a role that has archetype guidance, the panel also shows the
"weakness to write toward" line and offers a button to insert it into
Personality Traits.

That insert is explicit and separate from picking the role. Picking a role
writes the role name and nothing else.

### 6.3 Grouped by what the writer is looking for

Frequency groups are replaced by function groups. A writer knows they need
somebody who sells things; they do not know whether that is Popular or Niche.

| Group | For |
|---|---|
| Leads | Protagonist, Deuteragonist, Anti-hero, Point-of-view character |
| Opposition | Antagonist, Villain, Rival, Nemesis, Foil, Henchman, Enforcer |
| Allies and companions | Sidekick, Best Friend, Confidant, Mentor, Guardian, Comic Relief, Loyal Retainer |
| Family and household | Parent Figure, Sibling, Child, Spouse, Estranged Relative, Servant |
| Love and attachment | Love Interest, Rival Suitor, Former Lover, Unrequited Admirer |
| Trade and community | **Merchant**, Innkeeper, Healer, Smith, Guard, Employer, Landlord, Neighbor, Teacher, Priest |
| Mystery and misdirection | **Red Herring**, Suspect, Witness, Informant, Investigator, Keeper of the Secret, Unreliable Narrator, Double Agent |
| Power and institution | Ruler, Official, Commander, Soldier, Zealot, Spy, Judge |
| Structural and mythic | Herald, Threshold Guardian, Shapeshifter, Catalyst, Trickster, Scapegoat, Greek Chorus, Narrator, Wildcard |

Every role currently in `ROLE_SUGGESTIONS` appears somewhere in this table.
Removing one a writer has already typed would be a silent loss, and a contract
test pins it.

Saki Murakami's three roles -- Merchant, Red Herring, Everyman -- are now all
pickable, from three different groups. That is the acceptance case.

---

## 7. What must be tested

1. Every facet reads as one sentence alone: no leading conjunction, ends in a
   stop, no em dash, no invented proper noun (3.3).
2. `summary` equals the facets joined, for every option in both lists (3.4).
3. Type 1 decomposes to the eight facets in 3.2, with the three habits SEPARATE.
   The report was about granularity; this is the test that holds it.
4. Nothing is ticked on open; Essentials ticks exactly wants + dreads + speech;
   Everything ticks all; and neither writes anything until Insert (4.2).
5. A facet already in the buffer is greyed, un-greys on undo, and an edited
   sentence offers itself again rather than staying greyed (4.3).
6. A second insertion extends the existing block instead of creating a twin
   (4.4).
7. Changing the type leaves inserted text untouched (4.5).
8. `enneagram` round-trips through BOTH parsers; absent stays absent; an unknown
   id reads as unset and is not dropped on save (5). Verified by reinstating the
   drop.
9. A side character keeps a LABELLED record of its type (1.2). This is the
   reported case and it must fail if the label is removed.
10. Picking a role appends; picking a duplicate does nothing; case and
    whitespace do not create duplicates; the field is never assigned over (6.1).
11. `archetypeIdForRole` finds the archetype in a multi-role field (6.1).
12. Exactly ONE Role control exists in the profile header. A source read, since
    the defect was two of them (6.2).
13. Every role has help text, and every role in the old `ROLE_SUGGESTIONS`
    survives into the new groups (6.2, 6.3).
14. Saki's three roles are all pickable (6.3).

---

## 8. Deliberately not built

- **Feeding the type to AI.** Offered and declined for this release. It would
  mean deciding how much weight a rough starting point should carry in a prompt,
  and it touches `_build_story_context` and the Weave's brief. The type being
  stored is what makes it possible later.
- **Storing which facets were taken** (5).
- **Enneagram wings, levels of health, or instinctual variants.** Real parts of
  the system and a wall of jargon in a writing app.
- **MBTI naming**, anywhere, ever. Trademarked. The existing header comment
  stands.
- **A facet pop-up for Story Role.** Considered; archetype guidance is two or
  three sentences, so there is little to trim, and 6.2's insert button is
  enough. If the writer later wants it, 3.1's model already fits.
- **Auto-suggesting a type** from what the writer has written. That is a
  judgement about a person from prose, and getting it wrong is worse than not
  offering it.

---

## 9. Open questions

1. **Should Essentials include `cracks`?** It is the strongest arc fuel and the
   longest line. Currently out, on the grounds that the writer kept three short
   facets and hesitated over that one.
2. **Should a role be removable from the list without editing text?** 6.1 keeps
   `role` a string, so removal is a text edit today. Chips were offered and
   declined; this is the part of that decision the writer may still feel.
3. **Do the nine role groups want an order other than the one above?** They are
   currently listed lead-first, which is not the same as most-used-first.
