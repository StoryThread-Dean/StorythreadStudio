# Connection Builder -- specification

**Status:** specified, not built. Written 2026-09-03, before any code, on the
rule that cost the Weave weeks: a feature's spec belongs in `docs/`, checked in,
from the start. Where this spec and the code disagree, the CODE is wrong until
the writer rules otherwise.

**Implements:** `POST /api/codex/propose-ties`, role `character_reasoning` --
one of the five AI passes named in [`weave-spec.md`](weave-spec.md) and deferred
to v2.1.0 as recovery-plan phase 9. This spec does not invent a new feature; it
finishes a committed one, and amends the part of the commitment that was wrong.

---

## 1. Why this exists

The writer ported a full novel-series world into the Weave -- roughly fifteen
active characters, a dozen locations, a dozen relationship entries, four lore
entries -- and ran `Weaving > Dress the Loom`. It reported fifteen stops.

> "Dress the Loom says 15 things, only its not just 15 things. Its 15 characters
> all with 6 to a dozen and more connections each that take time to setup one by
> one. I spent 20 minutes on just one character making non-stop connections and
> this was absolutely mind numbing."

Projected scale for this series: 7-9 main characters, ~36 side characters, 3-4
dozen locations, and an open-ended list of ruling entities and lore.

**The manual system is not the problem and is not being replaced.** It works,
and it works well at the scale it was designed for -- *The Curse of the Tomb
Raider* and *Becoming a Hero* were both built by hand. This is an additional
route to the same result, for a world too large to hand-build.

### 1.1 Where the twenty minutes actually goes

Recording one connection today costs, per connection:

1. pick the other end, from every entry in the world;
2. pick a relation from ~70 grouped options;
3. **write a reason sentence in your own words** -- required. `post_tie` refuses
   with `reason_required` and the refusal is the point of the feature
   (`routers/codex.py:1021`): `A -- connected to -- B` spends brief budget to say
   nothing the prose did not already show;
4. optionally an inverse relation and an inverse reason.

At 6-12 connections across ~100 entries that is **600-1200 hand-composed
sentences**. Step 3 is both the most expensive keystroke and the one a model can
draft from profile text. So the highest-value output of this pass is not the
relation type -- it is the drafted reason with a quote behind it.

### 1.2 Two gaps found while specifying this

**(a) The specified pass would not have solved the reported problem.**
`weave-spec.md` attaches tie proposals to the `untied` stop kind, and `untied`
lives in **Weave the Chapters** (`PASS_WEFT`), not Dress the Loom. Its only
source is `together.py` -- who shares a *scene* with whom -- and `scan.py:1106`
is blunt about it:

```python
if not request.wants(STOP_UNTIED) or not together:
    return []
```

A writer with no chapters written gets nothing from it. The reported problem is
at the **`loose_thread`** stop in Dress the Loom, and wants proposals derived
from **profile text**. `weave-spec.md` does list "a Thread's own text" as an
Untied source, but that source was never implemented and the stop it feeds sits
in the wrong pass for a world that exists before its prose does.

**(b) `loose_thread` already has a shortlist, and it is dark.** The stop carries
`detail.likely` -- "the ones the prose has already put in the room with this
one" (`scan.py:957`) -- also computed from `together`. With no manuscript it is
empty, so the writer faces the full dropdown. See section 7.1.

---

## 2. What this is, and what it is not

**It is** a workbench that reads the writer's existing entries and proposes
connections between them, with a quote from the text it read, a relation from
the legal set, a direction, and a drafted reason. The writer reviews per entry
and accepts.

**It is not:**

- a replacement for the manual Tie editor, which stays exactly as it is;
- a fact proposer (`propose-facts` is a separate specified pass);
- a Thread creator (`propose-threads` is separate; this pass proposes
  connections only *between entries that already exist*, and never invents an
  entry -- same refusal the Profile Extractor makes);
- dependent on the manuscript. It works with zero chapters, thirty of thirty-six,
  no outline, or a full one. Manuscript and outline text are *additional*
  sources when present, never required.

---

## 3. Rulings (writer, 2026-09-03)

Recorded here the day they were made so they cannot become decisions nothing was
compared against.

| # | Ruling |
|---|---|
| R1 | **Acceptance is per entry, with quotes visible.** One card per entry lists all its proposals; the writer unticks what is wrong and one Accept records the rest. NOT per-tie clicking, and NOT a confidence threshold that accepts unread proposals. |
| R2 | **Its own workbench**, at `The Weave > Weaving > Connection Builder`. Not a stop inside the Dress the Loom walk. A 400-proposal job is not a sitting, and a walkthrough the writer cannot leave is the wrong container for it. |
| R3 | **The reason line is a freely composed draft.** The model writes it in its own words from the whole profile, not constrained to restating the quoted sentence. See section 9 for the Write Boundary consequence, which is real. |
| R4 | **Accept writes immediately.** The ties reach `codex/` on Accept; the entry ticks off and the run advances. Not staged behind a manual save. A review spanning several evenings must not be lost to a stray close. |
| R5 | **Re-check reports and never touches.** Revalidation of existing ties reports holds / changed / contradicted with the quote that moved, and offers keep / overwrite / revisit later. It alters nothing on its own, and it does not add stops to any walk. |

### 3.1 Why R1 is allowed here when the Profile Extractor forbids it

The Extractor's rule is absolute *for the Extractor*: no accept-all, nothing
pre-ticked, because it **carries no evidence on purpose** -- an Overview is
synthesis with no sentence to quote -- so the per-item click is the only
safeguard between a model's guess and the story bible.

That justification is contingent, not universal. Tie proposals **do** carry
evidence: a quote verified character-for-character (section 6.2). The writer is
reading the evidence when they scan the card, so a grouped accept is a different
act from an accept-all over unevidenced synthesis. This distinction is the whole
argument for R1 and must not be quietly generalised back to the Extractor.

---

## 4. Where it sits

```
The Weave > Weaving > Connection Builder

 LEFT RAIL                 BODY
 Characters (15)           one entry card at a time:
   [x] Alexandra             its proposals, each with
   [x] Dean Marsh            quote, relation, direction,
   [ ] Kessler               drafted reason, confidence
 Locations (12)  *
 Lore (4)        *
                           [ Accept N ticked ]  [ Skip entry ]
 Run made 2026-09-03.
 63 of 412 reviewed.
```

`*` Passive kinds are shown for **coverage, not as work**. Proposals are
generated only *from* entries whose type `is_active` -- the same rule
`loose_thread` already applies (`scan.py:913`): Croft Manor's way into the story
is through Lara, and asking the manor produced a dropdown where "logically none
of the entries make sense". A location becomes connected when someone active is
tied to it. The rail shows locations and lore with a count of how many accepted
ties now reach them, so the writer can see the passive half filling in.

**Draining Dress the Loom is automatic and is the point.** A `loose_thread` stop
exists because nothing connects to that entry. Accepting its proposals means the
next scan does not raise it. The fifteen stops go down as the workbench is
worked, with no separate bookkeeping.

---

## 5. Sources, in priority order

Every proposal names which source it came from.

1. **The entry's own text** -- Overview, trait descriptions, notes. The primary
   source, and the one that makes this work with no manuscript.
2. **The outline and notes**, when present. Already an established source class
   (recovery R5.1); `from_planning` exists to distinguish intended from written.
3. **Manuscript prose**, when present.

**`PRIVATE_NOTES` (Author Notes) is never read.** It is an enforced exclusion
with a source-read test that fails the build if a new corpus builder touches it
(recovery R5.5). This pass is a new corpus builder and is bound by it.

### 5.1 The caution that must be carried

From the roadmap, recorded during the Tie editor work and directly applicable:

> **Do not read a relation out of a proper noun.** "Companions of the Hall" is
> the name the five main characters call themselves; it is not evidence that its
> members are in a "companion of" relation.

The prompt states this as a rule (section 6.1, rule 6).

---

## 6. The proposal contract

### 6.1 The prompt

Follows `backend/app/audiobook/speaker_analysis.py` **wholesale**, as
`weave-spec.md` requires of every AI pass: JSON-only output, a QUOTE-EXACTLY
rule, confidence below 0.5 rather than a confident guess, a returned `dropped`
count shown to the writer, unparseable output returning an empty pass rather
than an error, and the endpoint writing nothing.

Returned shape:

```json
{
  "proposals": [
    {
      "quote": "the sentence from the source, character for character",
      "source": "entry_text | outline | manuscript",
      "dst_name": "the other entry, named as the roster names it",
      "rel": "a relation id from the supplied legal set",
      "flipped": false,
      "reason": "the drafted reason line, in the model's own words",
      "at": null,
      "confidence": 0.9
    }
  ]
}
```

Prompt rules, in addition to speaker_analysis's:

1. **QUOTE EXACTLY** from the supplied text. If you cannot reproduce it, leave
   the proposal out.
2. **Only entries on the roster.** Never name a thing not on it. Proposing a
   connection to something that does not exist is not a proposal, it is an
   invention.
3. **`rel` must be an id from the supplied legal set** for this pair of kinds.
   If none fits, use the plain `connected_to`.
4. **The reason says why these two belong together**, in one sentence, from the
   profile as a whole. It may not assert a fact the sources do not support.
5. **Do not propose an anchor** unless the quote itself names a chapter or a
   point in time. An undated Tie is true of the whole book, which is the right
   default (`test_codex_tie_run.py`).
6. **Do not read a relation out of a name.** A group's name is what defines the
   grouping, not evidence about its members.
7. Never use em dash or en dash characters; use a double hyphen.

### 6.2 Verification, before the writer ever sees a proposal

A proposal is **dropped** -- silently, counted, and the count reported -- when:

| Check | Why |
|---|---|
| `quote` is not in the source text character for character (`text.find`) | The speaker_analysis rule. A paraphrased quote is the app inventing evidence. |
| `dst_name` does not resolve to an existing entry | No invented entries. Resolution goes through the same alias-aware path chips use, so "Jim" finds James. |
| `dst_name` resolves ambiguously | An ambiguous mention never silently binds (`test_codex_mentions.py`). A wrong bind pulls the wrong Thread into every future brief. |
| `rel` is not in the legal set for this kind pair | Closed-set validation, from `GET /relations?src_type=&dst_type=` (`routers/codex.py:858`), which already returns forward / reverse / available. No new code. |
| the pair is already tied in either direction | Ties are stored one way round only; both ends go in the check, as `_untied_stops` already does. |
| `src_id == dst_id` | `post_tie` refuses it anyway. |
| `reason` is empty after `normalize_reason` | It could not be saved, so offering it wastes a click. |

The `dropped` count is shown on the entry card. A dropped proposal costs the
writer one suggestion; an unverified one costs them their world.

### 6.3 Direction and the inverse

The model proposes one direction plus a `flipped` flag. The **registry supplies
the inverse relation** -- all ~70 shipped relations have one since R8.10 fixed
the 23 that did not. The model is not asked for `rel_inverse`.

`reason_inverse` is left empty on an AI-accepted tie. The reason reads from the
end the writer was working from, and inventing a second sentence for the far end
doubles the drafted-prose surface for no gain.

---

## 7. Cost

`weave-spec.md` requires the ladder stance: "the deterministic pass always runs
first so the model is only asked what the prose did not answer. Cost is quoted
before the button; nothing runs until Start." Both apply.

### 7.1 The free pass runs first, and it is worth having on its own

Before any model call, compute `likely` from **profile text cross-references**:
entry A's text naming entry B is a candidate pair, alias-aware. This is
deterministic, free, and it also fixes the dark shortlist from section 1.2(b) --
`loose_thread.detail.likely` should be fed from this too, so the *manual* editor
gets a short list even with no manuscript. That is a small change with value
independent of this whole feature.

### 7.2 Chunking, and the caching that makes it affordable

One call per active entry: that entry's full text, plus a **compact roster** of
every other entry (name, kind, one line). The roster is byte-identical across
every call in the run, so it goes in a cached prefix -- prompt caching already
exists and is provider-gated (`test_prompt_caching.py`). Without caching the
roster is re-sent ~100 times; with it, once.

The estimate is shown before Start, per the ladder rule, and the panel opens on
the free pass rather than pointed at a paid button.

---

## 8. Storage

Reuse the shape of `codex/extraction_store.py`, which was built for exactly this
situation and says so:

- **Exactly one current run**, held as a file under `.storythread/weave/`, worked
  through over as many evenings as it takes. No history.
- **A file, not `app.db`.** Everything in the SQLite cache is rebuildable from
  Markdown and the cache is documented as safe to delete. A proposal was **paid
  for in tokens**. Deleting a cache must never cost the writer money.
- **`unreviewed_count` guards superseding.** Starting a new run on top of
  unreviewed proposals throws away things the writer bought, so the route
  refuses without explicit consent. Same shape as the accidental-close guard.

---

## 9. The AI Write Boundary -- a required amendment

**This is the part that cannot ship quietly.** The Write Boundary permits AI text
to be written directly only into `ai_profile_summary`, `ai_section_summary`,
`chapter_summary`, and `scene_summary`. A Tie's `reason` is human-authored prose.

Under R3 the drafted reason is **freely composed model prose**, and on Accept it
is written to `codex/` (R4) into a field every future AI brief reads as the
writer's own words. There is one precedent for widening the boundary -- the
v1.0.10 **Generate Overview** button on side characters -- allowed because it is
writer-clicked per use, lands in an editable field, and saves nothing until the
writer saves. R3 keeps the first two of those three and drops the third.

**The writer was told this and ruled for it.** Recording the ruling and its cost
rather than the ruling alone.

### 9.1 What must land in the same commit as the code

1. `CLAUDE.md`'s **AI Boundaries** section gains a second named exception,
   scoped to the Tie `reason` field, reached only through this workbench,
   editable before Accept, and explicitly NOT generalisable to other
   human-authored fields.
2. `weave-spec.md` is amended: `propose-ties` reads entry text as a first-class
   source and is reachable from a workbench, not only from the manuscript-derived
   `untied` stop. Section 1.2(a) is the reason.
3. `docs/features.md` and the CHANGELOG describe it in writer-facing terms.

### 9.2 Provenance -- proposed mitigation, not a condition

Record on each tie that its reason was **drafted and never edited**, cleared the
moment the writer edits it. One field. It hides nothing, changes no behaviour,
and gives section 10 something to prioritise: a drafted-and-never-read reason is
the most likely thing in the world to be wrong. Offered for the writer's
decision.

---

## 10. Re-check (revalidation)

A second mode over **existing** ties, answering the writer's case: Character A
was B's rival, A has been repurposed as B's love interest, and the recorded tie
is now wrong.

Each existing tie is reported as one of:

| Verdict | Meaning |
|---|---|
| **holds** | current text still supports it |
| **changed** | still a connection, but the relation looks wrong now |
| **contradicted** | the text now says otherwise; the quote that changed is shown |
| **no evidence** | hand-made, or its source text is gone -- nothing to check, and said so rather than counted as passing |

Per R5 it reports only, offering **keep / overwrite / revisit later**, and adds
no stops to any walk.

`findings.refresh()` already computes "the evidence text moved under it" and
names what went stale (`findings.py:470`). Note its existing carve-out: a stop
with no evidence has nothing to go stale. That is precisely why an AI-proposed
tie must **persist its quote** -- without it, the tie is permanently in the "no
evidence" bucket and can never be re-checked. Persisting the quote is what makes
section 10 possible at all.

---

## 11. Tests

Named here so the build can be checked against this page rather than the page
rewritten to match the build.

**`backend/tests/test_codex_propose_ties.py`**
- every drop reason in 6.2, one test each, and the `dropped` count reaching the writer
- a paraphrased quote is dropped (verified by reinstating the bug)
- a `dst_name` that is not on the roster is dropped, and no entry is created
- an ambiguous name is dropped rather than bound
- a `rel` outside the legal set for the kind pair is refused by name
- an already-tied pair produces nothing
- unparseable model output returns an empty pass, not a 500
- **the endpoint writes nothing** -- before/after snapshot, as speaker_analysis is pinned
- `PRIVATE_NOTES` is never read (source-read test, extending R5.5's)
- proposals come only from `is_active` kinds
- an anchor is proposed only when the quote names one

**`backend/tests/test_codex_recheck_ties.py`**
- the four verdicts; a tie with no persisted quote reports `no evidence` rather than `holds`
- re-check writes nothing under any verdict

**`app/src/features/codex/ConnectionBuilder.test.tsx`**
- a proposal below 0.5 confidence renders unticked; above it, ticked
- every ticked proposal shows its quote -- the card cannot present a proposal
  with the evidence hidden, because R1's whole justification is that the writer
  is reading it
- Accept records exactly the ticked rows and no others
- Skip entry records nothing and advances
- the dropped count is stated, not hidden
- the cost estimate precedes any paid action, and the panel does not open on it
- a run started over unreviewed proposals asks first

**Contract test:** the legal relation set the prompt is given comes from the same
`GET /relations` the manual editor uses. Two sources of truth for what may
connect to what is the failure mode this whole recovery kept finding.

---

## 12. Open items

Genuinely undecided; not oversights.

1. ~~**Relationship entries.**~~ **CLOSED 2026-09-04.** They were the same
   information in two places, and the answer is that the `relationship` KIND is
   retired: a relationship with an entry on the other end is a Tie, and one
   without is a trait block in the character's own `relationships` section.
   Existing entries stay readable and editable; the app no longer creates them.
   See `weave-spec.md`, the 2026-09-04 amendment to the Ties section.

   **Two consequences for this pass.** Section 6.2's duplicate check is
   unchanged (already-tied pairs are skipped), but the roster it resolves
   against **must exclude `relationship`-type entries**: two of the writer's own
   files are named exactly after their character, so the alias index answers
   with two rows -- the person, and the file about them -- and every label
   naming one of those people is refused as ambiguous. Measured: six false
   refusals out of six. A retired kind can never be a valid endpoint anyway.

   And the pass now has a second legitimate output: a proposal whose other end
   resolves to nothing is a **relationship with no target**, not a dead end.
   That is section 3's D3 ruling, and it is where "Former Partner" and "Guild
   and City Adventurers" belong.
2. **Section 9.2 provenance field** -- writer's call.
3. **Whether re-check runs per entry or over the whole world**, and whether it
   can be scoped to entries whose text has changed since their ties were made.
4. **The `likely` shortlist fix (7.1) may ship separately and first.** It is
   free, deterministic, helps the manual editor immediately, and does not depend
   on any of this.
