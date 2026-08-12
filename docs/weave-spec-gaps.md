# The Weave: scope addendum and gap list

**This is an addendum to `docs/weave-spec.md`, not a replacement.** The spec
still says what the Weave is FOR. This says what is true of the build as of
2026-08-11, where the two differ, and which of the differences are damage and
which are improvements.

Audited 2026-08-11, three passes over all 806 lines of the spec, one claim at a
time, against `feature/the-weave` (67 commits; all suites green at the time of
audit).

The work plan that answers this document is `docs/weave-recovery-plan.md`.
**No further feature code is written until that plan is complete and signed
off.**

---

## How this happened

The spec lived in gitignored `local/updateplan.md` for the entire build. It was
never promoted to `docs/`, so nothing was ever compared to it. The tests
described the build. The documentation described the build. The build described
itself. All three agreed with each other and none of them agreed with the spec.

Two properties made it invisible for months:

1. **Missing scope raises no error.** A scan that never opens the Outline does
   not fail -- it returns fewer stops. There is nothing to see, nothing to
   catch, and no test can assert the absence of a thing it was never told to
   expect.
2. **Live testing finds what is WRONG, never what is ABSENT.** Every defect
   fixed in the 2026-08-11 sweep came from the writer using the product. That
   loop is structurally incapable of finding a capability that was never built;
   the writer would have to notice a name that should have been flagged and
   was not, in a project whose every name they already know.

It was made worse by a well-intentioned habit: documentation was repeatedly
corrected to match the code. When the code has drifted from the spec, syncing
docs toward code **erases the evidence of the drift**. `features.md:397` ("reads
the manuscript and the Weave together") is an example -- an accurate
description of a build that was not doing what it was asked to do.

**The Audiobook Converter is the control case.** Its spec sat in the same
`local/` folder, was promoted to `docs/audiobook-converter-spec.md` at the
start, grew from 55KB to 123KB as the feature grew, and its tests cite it by
section number. It shipped clean. The difference was not planning quality --
the two documents are comparable. The difference was that one was in the
repository.

---

## Damage attributable to the spec not being referenced

Distinguished from ordinary incompleteness, because these are decisions that
would not have been taken had the document been open:

| What | When | Why it happened |
|---|---|---|
| `GET /run` deleted as dead code | 2026-08-11 | Specified at line 717; looked orphaned because `/run/resume` was never built |
| `GET /resolve` deleted as dead code | 2026-08-11 | Specified at line 469; looked orphaned because no screen consumed it |
| Context inspect built as a list | 2026-08-11 | Spec 541 says "a small map, **not a list**"; the opposite was chosen and the reasoning documented in the component |
| `weave_brief` added as a wire field | 2026-08-11 | Spec 549 says "chips need no wire change" |
| A second teaching registry (`explanations.ts`) | earlier | Spec 139-146 asked for ONE lexicon "so [surfaces] cannot drift apart" |
| `PROFILE_FOLDERS` / `SECTION_CONFIGS` duplicated instead of replaced | earlier | Spec 313-316 said replace both **and** the frontend mirror; the registry became a third definition, and the resulting drift is documented in `types_registry.py:132-141` |
| A parallel Markdown parser | earlier | Spec 320-322 said the profile parser would be "reused nearly whole" |
| Two explicit deletion orders ignored | earlier | `merge_profile_with_arc` (spec 501) and the false comment at `profiles.py:125` (spec 363) |

Four of these were introduced in a single session by an assistant working from
the code because the spec was not in the repository. That is the mechanism,
demonstrated live, and it is the reason for the process rules now in CLAUDE.md.

---

## What got BETTER than the spec

Stated plainly, because a gap list that only records failure would misrepresent
the state of the project. These are real improvements made during the build and
they should survive into the amended spec -- see section B.

- The **closed-world walkthrough**: every stop resolves inside the popup, held
  structurally by a source-read test. The spec did not ask for this; live
  testing proved it necessary.
- The **required reason line** on every connection, asked before the relation
  type. Worth more to the AI brief than the relation ever was.
- The **pair-as-axis Tie run**, so a connection that changes across the book
  supersedes correctly instead of the writer hand-closing each state.
- The **self-explanation product rule** (what / why / necessary / what it
  spends) with a cross-language test that fails the build over a false "free"
  claim.
- The **continuous-flow rule**: every step proposes the next one.
- **Agency** (`ACTIVE_TYPES`) -- only characters and creatures are asked how
  they connect, from the Croft Manor case.
- `migrate/restore` and `migrate/compare` -- a reversibility story beyond the
  spec.

Findings are grouped by what they ask of us, not by severity alone:

- **A. NOT BUILT** -- real work, spec is right
- **B. BUILT DIFFERENTLY, ON PURPOSE** -- the build is arguably better; these
  are spec amendments to approve, not work
- **C. CONTRADICTS THE SPEC** -- a decision was taken against the document,
  usually without knowing it; each needs a ruling
- **D. SPEC DEFECTS** -- errors in the document itself

---

## A. NOT BUILT

### A1. The premise is unreachable for the four types it is about
The spec opens with a heroine who believes her father died until chapter
fifteen. Characters, relationships, locations and lore are edited in
`ProfileBuilder.tsx`, which has **no Run or fact UI at all**. `ThreadEditor.tsx`
-- the only editor with facts -- is routed to "every Weave kind the Profile
Builder does not cover" (`App.tsx:2502`). **The example the whole programme was
written around cannot be recorded through the interface.** Everything else in
this list is smaller than this.

### A2. There is no AI anywhere in the Weave
The spec's headline outcome is a world model "filled in by an **AI-guided**
walkthrough ... running on a model chosen per job". `backend/app/codex/` and
`routers/codex.py` import nothing from `app.ai`. All five specified passes are
absent: `/propose-threads`, `/propose-facts`, `/propose-ties`, `/check-snags`,
`/expand-unwoven`. Weaving is 100% deterministic pattern-matching.

Consequences that follow from this one gap:
- **Knowledge violation is not detected** -- the spec calls it "the reason the
  frame system exists". Deferred into `/check-snags` (`snags.py:19-21`), which
  was never written.
- Frayed cannot "offer to fill it from what the prose already says".
- Untied cannot propose a relation, direction or confidence.
- Unwoven cannot propose answers grounded in existing prose.
- "AI findings are stored and never re-bought" is vacuous.

### A3. The Weave cannot be exported
Spec 484-491 asked for `include_weave` on both export endpoints, a
`POST /export/weave` bundle (Markdown / JSON / CSV), and anchors exported as
both ids and human labels. **None exist.** Both export paths still copy only
the legacy `profiles/` folder, so a writer who migrates gets exports that
silently omit their entire world. For a local-first app whose promise is that
the writer owns their files, this is the most serious non-premise gap here.

### A4. Migration step 4 was skipped entirely
Spec 503: "repoint chip sources, export appendices, search exclusions." None of
the three happened. After a successful migration the writer's Threads vanish
from chip attachment (`ChipPicker` still queries `/api/profiles/list` with four
hardcoded types), from every export, and from Global Search (`search.py` never
learned `codex/` exists) -- simultaneously. **This is the root cause of the
Profiles complaint reported from live testing.**

### A5. Scene identity is never minted
`manuscript/scenes.json` is read (`anchors.py:87`) and written by nothing. No
LCS re-match on save, no tombstones. Every anchor in every real project is
chapter-level only; the `s-xxxx` half of the anchor design is unreachable, and
the scrubber is chapter-only to match.

### A6. Unwoven is a root system with one level
`scan.py:404` compares `request.depth` to `DEPTH_FULL` ("warp") at a line only
reachable when depth is `"unwoven_pass"`, so `max_depth` is permanently 1. All
13 depth-2 and both depth-3 questions are dead code, including the spec's own
worked example. The corpus is also ~18% of its specified size (18 trunk
questions across ten domains against "~10 per domain").

### A7. The Weave reads the manuscript as its only source
`unbound_names` runs over manuscript chapters alone. Notes, outline, style
guide and themes are used only as `NameEvidence` to strengthen names **already
found in the prose**. A faction that exists only in the outline produces no
stop and no Thread, ever. `parse_markup` (`@name`, `[[name]]`) is written,
correct, and called only by its own tests -- so explicit markup outside the
manuscript does nothing.

### A8. Stale findings are computed and then discarded
The backend marks findings stale and returns the count; `weavingApi.ts` types
it; **no component reads it**. Stale stops appear identical to fresh ones,
which is exactly what spec line 675 forbids ("nothing is silently shown as
current when it is not").

### A9. Smaller, but real
- `codex_mention` -- table created, indexed, cleared on reindex, **never
  inserted into**. Mention tracking is scaffolding only.
- Tangle -- implemented, unit-tested, **never called** by any production path.
- Resume -- `POST /run/resume` never written; the panel always mints a new run.
- `revealed_at` -- one of the three switches the spec calls the mechanism, with
  **no input control** in the only fact editor.
- Per-book model roles -- `projects.py` has no `model_roles`, so the top level
  of the documented precedence chain is dead code **with a passing test that
  fakes the project dict**.
- The prompt-caching caveat the spec said "the UI should say out loud" is
  computed and never rendered.
- `GuidedWalk` was neither moved to `components/learn/` nor generalised to a
  `WalkDemo` union, and appears on **no Weave surface**.
- The layered interface is two of four layers -- no Constellation/Neighborhood
  labelling distinction, the Thread card is a screen swap rather than a zoom,
  and **there is no Fact layer at all**.
- "Never ask" mutes a kind globally; the spec says "for this target".
- Reveal-order break and timeline impossibility have no detectors (~2.5 of the
  five specified Snag checks exist).
- Missing named test files: `test_codex_graph.py`, `test_codex_export.py`;
  `test_codex_anchors.py` has zero scene tests; Tie relations are exempt from
  the lexicon contract test.
- Three releases (v1.1.1 / v1.1.2 / v1.1.3) collapsed into one unlogged blob --
  `package.json` still says 1.1.0, no `v1.1.1` tag, no CHANGELOG entry for the
  Weave.

---

## B. BUILT DIFFERENTLY, ON PURPOSE -- approve as spec amendments

These are cases where the build is arguably better and the SPEC is what is out
of date. Recommend accepting and amending the document.

1. **Four passes** (Dress the Loom / Weave the Chapters / Read the Cloth /
   Unwoven) replacing Full / Targeted / Quick. The writer chose these names in
   session on 2026-08-11.
2. **World-rules corpus in Python** (`world_rules.py`) rather than
   `app/src/data/worldRules.ts` -- it is scan input, and the scan is Python.
3. **Anchors stored as text**, not `*_ord` integer columns; ordinals computed
   on demand (`db.py:80` documents the reasoning).
4. **Eight role pickers, not nine** -- `fallback` deliberately excluded
   (`roles.py:46-50`).
5. **`migrate/restore` and `migrate/compare`** -- a reversibility story beyond
   what the spec described.
6. **`ACTIVE_TYPES` gating** -- only characters and creatures are asked how
   they connect. A live-testing decision (the Croft Manor rule) with no basis
   in the spec.
7. **Five extra built-in types** (government, deity, creature, culture,
   language).

---

## C. CONTRADICTS THE SPEC -- needs a ruling

1. **The context inspect panel is a list.** Spec 541: "a small map, **not a
   list**". Built as a list on 2026-08-11 with the reasoning documented in the
   component. The writer never sees the *shape* of what AI is about to be told.
2. **`weave_brief` is a new wire field.** Spec 549: "**Chips need no wire
   change** ... the brief ships as chips". Built as its own request field.
3. **`GET /run` and `GET /resolve` were deleted** as dead code on 2026-08-11.
   Both are specified routes (lines 717, 469).
4. **Two teaching registries.** Spec 139-146 asked for ONE lexicon "so the
   sidebar, the map legend, the walk rail, tooltips and the tutorial cannot
   drift apart". `lexicon.ts` and `explanations.ts` now both feed the same Weave
   screens.
5. **`PROFILE_FOLDERS` / `SECTION_CONFIGS` were duplicated, not replaced.**
   Spec 313-316: "Replace both ... and the frontend duplicate ... so the two
   cannot drift." There are now **three** definitions of a character's
   sections. The drift this caused is already documented in
   `types_registry.py:132-141`.
6. **A parallel Markdown parser.** Spec 320-322 said the profile parser and
   generator would be "reused nearly whole"; `threads.py` is an independent
   508-line implementation, so two dialects exist.
7. **Two explicit deletion orders ignored**: `merge_profile_with_arc` is still
   defined and called (spec 501 says delete it); the false comment at
   `profiles.py:125` ("hidden = never sent to the AI API") that spec 363
   ordered deleted is still there.
8. **Unplaced and Loose thread** were built as one-at-a-time walks; the spec
   asks for a multi-select list and "lists them all at once", explicitly "not a
   forced march".
9. **Frayed's QuickFill** shows all missing sections at once; the spec says
   "from what the prose already says, **one field at a time**".
10. **Nine stop kinds** where the spec's lexicon table names five (`pinned` and
    `early_mention` are additions to the writer-facing vocabulary).

Items 1-3 were introduced on 2026-08-11 by an assistant working from the code
because the spec was not in the repository. They are the clearest possible
demonstration of the mechanism this document exists to end.

---

## D. SPEC DEFECTS

1. The Verification section is duplicated verbatim (lines 736-761 and 762-787).
2. The role table lists nine roles; the `ROLES` literal at line 236 lists
   eight. The document contradicts itself.
3. Role feature lists in the table have drifted from what shipped (Guide mode,
   Unwoven expansion, act/outline/beat passes, Check Consistency, Weave fact
   and Tie proposals, mention detection).

---

## Acceptance criteria that would fail today

From the spec's own Verification section:

- "Run a Full weave; the warning states a real count" -- the warning has no
  number, and "Full weave" no longer exists as a writer-facing pass.
- "Apply 15 findings, close the app, reopen, **resume**" -- no resume path.
- "Edit a chapter between sessions; affected findings flag **stale** rather
  than showing as current" -- stale is never rendered.
- "Plant a **knowledge violation** and confirm the Snag detector catches it" --
  no such detector exists in any form.
- `worldRules.test.ts` / `codexScan.test.ts` in the release sweep -- neither
  file exists.
