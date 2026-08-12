# The Weave: recovery plan

**Status: PHASE 0 -- no feature code is being written.**

This plan repairs the gap between `docs/weave-spec.md` (what the Weave is for)
and the build (what it does). The findings it answers are in
`docs/weave-spec-gaps.md`.

---

## The rules this plan runs under

1. **No feature code until Phase 0 is complete and signed off.** Phase 0 is
   documents and decisions only.
2. **Every task below is checked off HERE and in the ledger line in
   `CLAUDE.md`** the moment it is done. If a session is interrupted, or testing
   forces a long detour, the checkboxes are how the next session knows where it
   is. Do not rely on memory or on conversation history.
3. **A task is not done when the code works. It is done when its
   done-when line is true** -- which for most tasks includes a test and a spec
   or doc update in the same commit.
4. **The spec outranks the code.** Where they disagree, the code is wrong until
   the writer rules otherwise. Deviations that are improvements get the SPEC
   amended (Phase 0, task 0.4) -- they are never left as silent divergence.
5. **Never sync documentation toward the code.** That erases evidence of drift.
   Correct the code, or amend the spec deliberately.

Task ids (R0.1, R1.2 ...) are stable. Reference them in commit messages.

---

## Phase 0 -- Stop, record, and decide (NO CODE)

- [x] **R0.1** Promote the spec into the repository as `docs/weave-spec.md`,
      verbatim, with a header stating it is the source of truth.
      *Done-when:* the file exists, is tracked by git, and CLAUDE.md links it.
- [x] **R0.2** Audit all 806 spec lines against the build, one claim at a time.
      *Done-when:* every claim has a verdict with file:line evidence.
- [x] **R0.3** Write the scope addendum: findings, how it happened, the damage
      attributable to the spec not being referenced, and what got better.
      *Done-when:* `docs/weave-spec-gaps.md` covers all four and names the
      improvements explicitly.
- [x] **R0.4** Write this recovery plan with a checkbox per task.
- [x] **R0.5** Add the spec-discipline rules to `CLAUDE.md` so they bind future
      sessions, with a ledger line pointing at this plan.
- [x] **R0.6** Verify the 67 commits so far are healthy.
      *Done-when:* clean tree, backend + frontend suites green, lint clean.
      *Result 2026-08-11:* 1573 backend, 1098 frontend, ruff clean, tsc clean.
- [x] **R0.7** Update Claude memory: the standing rule, the plan pointer, and
      the open decisions.
- [ ] **R0.8** **WRITER SIGN-OFF on the section B amendments.** Seven build
      decisions that improved on the spec. Approving them means the SPEC gets
      edited to match, in one commit, and they stop being divergence.
      *Awaiting decision:*
      - [ ] four passes (Dress the Loom / Weave the Chapters / Read the Cloth /
            Unwoven) replace Full / Targeted / Quick
      - [ ] world-rules corpus in Python rather than `app/src/data/worldRules.ts`
      - [ ] anchors stored as text; ordinals computed, never stored
      - [ ] eight role pickers, not nine (`fallback` excluded)
      - [ ] `migrate/restore` + `migrate/compare` kept
      - [ ] `ACTIVE_TYPES` agency gating kept
      - [ ] five extra built-in types kept (government, deity, creature,
            culture, language)
      - [ ] the improvements listed in the addendum's "What got BETTER"
            section are added to the spec as intended behaviour
- [ ] **R0.9** **WRITER RULINGS on the section C contradictions.** Ten places
      the build went against the document. Each needs revert / keep-and-amend:
      - [ ] context inspect: list, or the spec's "small map"?
      - [ ] `weave_brief` wire field, or ship the brief as chips?
      - [ ] restore `GET /run` and `GET /resolve`?
      - [ ] one lexicon or two teaching registries?
      - [ ] collapse `PROFILE_FOLDERS`/`SECTION_CONFIGS` into the registry?
      - [ ] one Markdown parser or two dialects?
      - [ ] carry out the two deletion orders (`merge_profile_with_arc`, the
            false `profiles.py:125` comment)?
      - [ ] Unplaced + Loose thread: multi-select lists, or one-at-a-time?
      - [ ] Frayed fill: one field at a time?
      - [ ] `pinned` + `early_mention` added to the spec's lexicon table?
- [ ] **R0.10** Amend `docs/weave-spec.md` to record every approved decision
      from R0.8 and R0.9, with a dated amendment block. *Done-when:* the spec
      contains no claim the writer has not either approved or scheduled.
- [ ] **R0.11** Fix the three spec defects: duplicated Verification section;
      nine-roles table vs eight-role literal; drifted role feature lists.
- [ ] **R0.12** Re-scope: assign every Phase 1-9 task to **v2.0.0** or
      **deferred**, and write the deferred set into `docs/roadmap.md`.
      *Done-when:* nothing in this plan is unassigned.

**Phase 0 exit criterion:** R0.8 through R0.12 complete. Only then does code
begin.

---

## Phase 1 -- Undo the damage from this session (smallest, highest confidence)

Ordered first because it is small, mechanical, and restores spec fidelity
before anything is built on top of it. Each is gated on its R0.9 ruling.

- [ ] **R1.1** Restore `GET /resolve` (spec 469) with a route test.
- [ ] **R1.2** Restore `GET /run` and add `POST /run/resume` (spec 717).
      *Done-when:* reopening Weaving resumes a session rather than minting a
      new run, and the spec's "reopen, resume" acceptance line passes.
- [ ] **R1.3** Context inspect per the R0.9 ruling.
- [ ] **R1.4** `weave_brief` per the R0.9 ruling.
- [ ] **R1.5** Carry out the two deletion orders.
- [ ] **R1.6** Teaching registries per the R0.9 ruling.

---

## Phase 2 -- The premise (gap A1) -- BLOCKER

The spec's opening example -- the heroine who believes her father died until
chapter fifteen -- cannot be recorded through the interface, because the four
types it is about are edited in a screen with no fact UI.

- [ ] **R2.1** Point the Profile Builder at `codex/` (plan already drafted in
      memory `profiles-to-codex-plan`; `codex/` wins on conflict).
- [ ] **R2.2** Reconcile `PROFILE_FOLDERS` / `SECTION_CONFIGS` / `profile.ts`
      into the registry (also closes section C item 5).
- [ ] **R2.3** Add `role` + `character_kind` to the codex index; extend
      `NewThreadBody`.
- [ ] **R2.4** Wire `record_save_event` into `POST /entity` -- otherwise
      Writing Progress goes dark silently on repoint.
- [ ] **R2.5** Give characters, relationships, locations and lore a **Run
      editor**, including a `revealed_at` control (gap A9).
      *Done-when:* the spec's opening example can be recorded end to end by a
      writer, with a test that does it.
- [ ] **R2.6** Fix `_find_related_relationships` (hardcoded `profiles/`, fails
      silently).
- [ ] **R2.7** Port `POST /api/profiles/import` to codex.
- [ ] **R2.8** Editors for the six kinds with none (Cultures, Creatures,
      Governments, Factions, Deities, Religions), driven by the registry.
- [ ] **R2.9** Relationships decision: keep as the long-form page a Tie points
      at, per the recommendation. Nothing can auto-convert them -- the two
      parties were never stored as ids.

---

## Phase 3 -- Migration completeness (gap A4) -- BLOCKER

Spec 503 step 4 was skipped. After migration the writer's world vanishes from
three surfaces at once.

- [ ] **R3.1** Repoint chip sources at the codex (ChipPicker + App.tsx).
- [ ] **R3.2** Add `codex/` to Global Search.
- [ ] **R3.3** Export appendices read the codex (see Phase 4).
- [ ] **R3.4** A migration test that asserts all three surfaces still find the
      writer's entries afterwards.

---

## Phase 4 -- Export and portability (gap A3) -- BLOCKER

- [ ] **R4.1** `include_weave` on `/export/full-manuscript` and
      `/export/snapshot`.
- [ ] **R4.2** `POST /export/weave`: Markdown, JSON and CSV bundles.
- [ ] **R4.3** Anchors exported as ids **and** human labels.
- [ ] **R4.4** Export UI: a Weave checkbox and a bundle button.
- [ ] **R4.5** `test_codex_export.py` -- the named test file that does not exist.

---

## Phase 5 -- Sources (gap A7)

- [ ] **R5.1** The scan reads notes, outline, style guide and themes as
      SOURCES, not only as corroboration.
- [ ] **R5.2** Stops say where a name came from ("named in your Outline" reads
      differently from "named in chapter 4").
- [ ] **R5.3** Wire `parse_markup` so `@name` / `[[name]]` outside the
      manuscript does something.
- [ ] **R5.4** Decide and implement whether planning-document names are a
      softer stop that never counts toward contradiction checks.

---

## Phase 6 -- Unwoven (gap A6)

- [ ] **R6.1** Fix the always-false depth comparison so branch and capillary
      questions are reachable.
- [ ] **R6.2** Decide pacing -- one answer can open eleven questions.
- [ ] **R6.3** Grow the corpus toward "~10 per domain" (currently ~18%).
- [ ] **R6.4** The domain board (a card per domain with open counts) replacing
      the one-at-a-time drip, plus the multi-page LOTR walkthrough.

---

## Phase 7 -- Scene identity (gap A5)

- [ ] **R7.1** Mint scene ids into `manuscript/scenes.json` on chapter save,
      LCS-matching old to new; tombstone deleted scenes.
- [ ] **R7.2** Register `scenes.json` in the rename cascade and search
      exclusions.
- [ ] **R7.3** Scene stops on the scrubber.
- [ ] **R7.4** Scene tests in `test_codex_anchors.py` (currently zero).

---

## Phase 8 -- Honesty and completeness of the walk

- [ ] **R8.1** Surface stale findings (gap A8) -- the banner and a scoped
      re-run.
- [ ] **R8.2** Call `group_tangles` so Tangle has a producer.
- [ ] **R8.3** Mute per target, not globally.
- [ ] **R8.4** Reveal-order break and timeline-impossibility detectors.
- [ ] **R8.5** Write to `codex_mention`, or drop the table and say so.
- [ ] **R8.6** Per-book `model_roles` in `project.json`, or delete the dead
      precedence level and its faking test.
- [ ] **R8.7** Surface the prompt-caching caveat in the Model Roles UI.
- [ ] **R8.8** `GuidedWalk` moved to `components/learn/`, generalised to a
      `WalkDemo` union, and used on a Weave surface.
- [ ] **R8.9** The Fact layer (gap: two of four interface layers exist).
- [ ] **R8.10** Tie relations covered by the lexicon contract test.
- [ ] **R8.11** `test_codex_graph.py` -- including "a Thread not yet introduced
      is omitted at an earlier anchor", which nothing asserts today.

---

## Phase 9 -- The AI passes (gap A2)

Large. A legitimate candidate for deferral IF the product says plainly that
Weaving is deterministic today -- but knowledge violation may have to come with
it, since the spec calls it the reason the frame system exists.

- [ ] **R9.1** Scope decision: v2.0.0 or v2.1.0.
- [ ] **R9.2** `POST /api/codex/check-snags` -- knowledge violation.
- [ ] **R9.3** `POST /api/codex/propose-ties` -- relation, direction,
      confidence.
- [ ] **R9.4** `POST /api/codex/propose-facts`.
- [ ] **R9.5** `POST /api/codex/propose-threads`.
- [ ] **R9.6** `POST /api/codex/expand-unwoven`.
- [ ] **R9.7** All five follow the `speaker_analysis.py` contract: JSON-only,
      quote-exactly, `text.find()` verification, dropped count shown, endpoint
      writes nothing.
- [ ] **R9.8** The Cast ladder (manual / free / free-ai / auto) and cost quoted
      before the button.

---

## Phase 10 -- Release hygiene

- [ ] **R10.1** CHANGELOG entries for the Weave work (currently none).
- [ ] **R10.2** Decide the release boundary: three tier-3 releases as specified,
      or one v2.0.0.
- [ ] **R10.3** Version bump and tags.
- [ ] **R10.4** Walk the spec's Verification section as a manual checklist; add
      shell-dependent flows to `tests/manual-smoke.md`.
- [ ] **R10.5** `/pre-release` to a RELEASE READY verdict.

---

## Progress

| Phase | Tasks | Done |
|---|---|---|
| 0 Stop and record | 12 | 7 |
| 1 Undo session damage | 6 | 0 |
| 2 The premise | 9 | 0 |
| 3 Migration completeness | 4 | 0 |
| 4 Export | 5 | 0 |
| 5 Sources | 4 | 0 |
| 6 Unwoven | 4 | 0 |
| 7 Scene identity | 4 | 0 |
| 8 Walk honesty | 11 | 0 |
| 9 AI passes | 8 | 0 |
| 10 Release | 5 | 0 |
| **Total** | **72** | **7** |
