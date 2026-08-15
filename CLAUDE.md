# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## CURRENT STATE: v2.0.0 SHIPPED. v2.0.1 (Profile Extractor) built, unreleased

**v2.0.0 shipped 2026-08-14** (115 commits, tag v2.0.0, installer live). The
recovery plan is 93 of 107 with the rest deferred by scope or blocked on a
ruling; it is history now rather than a work queue.

**v2.0.1 is BUILT and unreleased: the Profile Extractor.** Reads the manuscript
and proposes what each entry should say. Its ten decisions and the reasoning
behind each are in `docs/roadmap.md`; the section is the record, not a plan.
The one thing to understand before touching it: **it carries no evidence on
purpose** (an Overview is synthesis with no sentence to quote), so the writer's
per-item click is the ONLY safeguard between a model's guess and their story
bible. Any convenience that removes a click removes the whole protection --
no accept-all, nothing pre-ticked, and a proposal for an entry that does not
exist refuses rather than creating one.

**Work the next unchecked task in `docs/weave-recovery-plan.md`.** Phase 0
(documents and decisions) is complete and signed off; building is unblocked.

Why: the Weave was built for weeks against a specification that was never in
the repository (it sat in gitignored `local/updateplan.md`). Nothing was ever
compared to it. A 2026-08-11 audit of all 806 spec lines found the programme's
own opening example unreachable through the UI, no AI anywhere in a feature
specified as AI-guided, no way to export the Weave, and a skipped migration
step that removes the writer's world from chips, exports and search at once.

| Document | What it is |
|---|---|
| `docs/weave-spec.md` | **Source of truth.** The writer's design document |
| `docs/weave-spec-gaps.md` | Scope addendum: findings, how it happened, what got better |
| `docs/weave-recovery-plan.md` | **The work ledger.** Ids R0.1-R10.6; the plan's own progress table is the count, since live testing keeps adding tasks |

**Progress is checked off in TWO places, in the same commit: the task's
checkbox in the recovery plan, and the ledger line below.** This exists so a
session interrupted mid-task, or forced into a long debugging detour, can find
its place without relying on memory or conversation history.

> **LEDGER — last updated 2026-08-14.** 93 of 107 tasks done.
> **Phase 0 COMPLETE** — spec promoted, audited, addendum written, all ten
> contradictions ruled, seven amendments approved, three spec defects fixed,
> scope set (v2.0.0 = phases 1-6, 8, 10; deferred to v2.1.0 = phase 7 scene
> identity and phase 9 AI passes).
> **Phase 1 COMPLETE** except R1.5b, which is STILL blocked and for a new
> reason: R2.1 kept `profiles/` as a live home for unconverted projects, so
> `merge_profile_with_arc`'s route is still doing the work the ruling was
> protecting. It goes when `profiles/` stops being a home -- a decision for the
> writer, not a side effect of a task.
> R1.1 `GET /resolve` restored · R1.2 `GET /run` restored and `POST /run/resume`
> built with Carry on / Start fresh · R1.3 `BriefShape` map above the
> context-inspect list · R1.4 `weave_brief` kept (spec amendment) · R1.5a the
> false hidden-trait comment deleted · R1.6 the two teaching registries bound
> by a contract test.
> **PHASE 2 COMPLETE (25 of 25).** The premise is reachable. Groundwork went first because
> both halves fail SILENTLY: R2.3a `role` + `character_kind` indexed (migration
> 005, tested as an upgrade) · R2.4 `POST /entity` records a Writing Progress
> save event, which it never did.
> **R2.1 DONE — the Profile Builder no longer knows which folder it reads.** It
> asks `GET /health`, which reports `entries_home` from the one function that
> decides (`migrate.py`); every `build_sections` call site asks the same
> function, so the sidebar's count and the editor's list cannot disagree again
> (that disagreement was the writer's original 13-vs-12 report). `profiles/`
> stays live for unconverted projects because conversion is an offer, not a toll
> gate; where both folders hold work the bigger world wins and the screen SAYS
> how many entries it is not showing. Two implementations, one interface:
> `app/src/screens/profileSource.ts`. The load carries the whole Thread through
> and the save hands it back, so editing an overview cannot delete a character's
> connections — that test was verified by reinstating the bug.
> **R2.2a DONE — the three copies of the section list are bound by contract
> tests** (Python reads `profile.ts`). It found three live bugs, all mine from
> earlier in this recovery, one destructive: `profiles.py` keyed Hidden and
> Foreshadowing differently from the form, so the section read empty and a save
> wrote that emptiness over the writer's hidden traits.
> **R2.3b DONE** — create carries `role` + `character_kind`.
> **R2.6 DONE** — `_find_related_relationships` reads the folder the project
> actually uses. It was the last hardcoded `profiles/` path in any AI route and
> the one that could not announce itself: it returns a list, and an empty list
> is an ordinary answer, so a converted project would have quietly stopped
> weaving relationships into full summaries. Shipped in Phase 6 with no tests;
> it has six now.
> **R2.10a/b and R2.11 DONE** — from the writer's live test of R2.1, grouped
> with R2.5 on their instruction. The characters that were previously invisible
> turned out to be visible in the wrong GROUP, because Weaving could not send a
> template: Quick Create now asks and **defaults to Side**, and a character can
> be moved either way from the Profile Builder header (in memory, manual save).
> Side to Main moves nothing; Main to Side dissolves traits into lines and states
> the one lossy part first — a `hidden` trait loses `ai_scope: on-request`, the
> thing that actually withholds it. Latent bug found on the way: a Main page
> rendered ONLY the trait list, so prose in a trait section was invisible on disk.
> R2.11: every sidebar row has the menu and the backend says what it may offer
> (`rename` / `removal`), which fixes the misaligned counts AND deletes another
> rule the frontend was keeping a second copy of. Renaming a shipped kind was
> already safe (label only); renaming a built-in NOTE was not, and is now refused
> with the reason — `notes/outline.md` is read by that path.
> **R2.12a DONE — the three prompts that lied about hidden traits.** "Hidden is
> never sent to AI" has been wrong in three places now; each was found by
> reading, because a false promise about privacy raises no error. The Importance
> Audit was the worst: it told the model to advise DEMOTING a hidden trait to
> gain accuracy the writer already had, paid for with the secret. Also
> corrected: feedback may NAME a hidden trait (it is the writer's own note),
> suggested prose may not. `test_hidden_trait_promise.py` reads the real prompt
> text; verified by reinstating the claim.
> **R2.12b-e DONE — importance and disclosure are two axes.** `importance` keeps
> four levels and means weight; a per-trait `subtext` flag says whether it may be
> said out loud. The writer's villain settled it: his parents dying in a hospital
> is CORE by weight and secret by disclosure, and one scale could only hold one of
> those — with `hidden` sorting LOWEST, so the trait driving the most scenes was
> the faintest signal in the prompt. Legacy `importance: hidden` reads as present
> + subtext; `parse_thread(heal_legacy=False)` exists for the one caller that
> needs the file as WRITTEN (the conversion comparison). **Reverses an earlier fix
> of mine**: the migration's `ai_scope: on-request` stopped the AI naming a secret
> by stopping it knowing the secret. "Never send" deliberately not built — Author
> Notes is that room, and R5.5 makes the guarantee real. Main/Side is now lossless
> (a Side section shows its secrets as traits, since prose cannot carry "never say
> this"). `SubtextGuide` is the eleven-page walkthrough: one secret through three
> weights and through Draft, Enhance and a context check, with the same scene
> written at each weight so the choice is concrete. Spec amended, section D.
> **R2.12f DONE — and it is the lesson worth keeping.** The walkthrough shipped
> reachable only from the panel that LISTS secrets, and that panel hides itself
> when a profile has none, so the writer looked next to Hidden and Foreshadowing
> on both templates and found nothing. A guide nothing offers is documentation,
> not help. It is now beside that heading on both templates whether or not
> anything is marked, plus on a trait card once its switch is on. When adding an
> Explain or a guide, check the surface it hangs off is VISIBLE in the empty
> state.
> **R2.12g DONE** — the Weave's own brief now marks a secret. `context.py`
> rendered a trait as a bare `- trait: description`, dropping the weight AND the
> SUBTEXT marker, so a secret sent through the automatic brief arrived as
> ordinary text while the same trait sent as a CHIP was protected. Found by
> checking the walkthrough's claims against the code when the writer said "if
> that is so" rather than affirming them. Two serialisers, one marker, bound by
> a test that reads `profileFormat.ts` from Python.
> **R2.5 DONE — THE BLOCKER IS CLEARED.** The spec's opening example (the heroine
> who believes her father died until chapter fifteen) can now be recorded end to
> end, and `test_the_opening_example.py` does it over HTTP. The Run editor was
> EXTRACTED from `ThreadEditor` rather than copied, so a fact recorded on either
> screen is the same fact, and `revealed_at` gained the control it had nowhere:
> "the reader learns this", separate from "from when". That pair is what the
> story scrubber's spoiler mode moves through, which is why the timeline has
> never appeared to do anything. Note for future work: a belief is only drawn on
> when resolving from that character's POV, so the example needs THREE facts --
> her belief, the truth, and her change of mind on her own frame.
> **R2.5b** — a full suite run failed once on `os.replace` (WinError 5) and
> passed twice alone. That is not a flaky test: on Windows a replace fails while
> a scanner, the indexer, a sync client or the writer's own editor holds the file
> for a moment, so a writer's Save fails at random with no diagnosable cause.
> `replace_atomic` retries ~150ms then raises honestly. Applied to the Weave's
> writes; the other stores are R10.6.
> **PHASE 3 COMPLETE (4 of 4).** The three surfaces that lost a converted world
> all find it again. Chips REUSE `profileSource` rather than fetching
> `profiles/` themselves, so the picker and the editor cannot disagree about
> where entries live; Global Search walks `codex/` (it covered everything except
> the folder a converted project keeps its world in, and "no results" is
> indistinguishable from "you have not written that yet"); exports read the live
> folder. That last one uncovered a bug older than the Weave: **the profiles
> appendix has never worked**, because it read `profiles/<TYPE>` while the
> folders are PLURAL — so ticking "include profiles" produced an export with no
> profiles in it and said nothing. `test_after_conversion.py` converts a project
> and asks all three surfaces the same question, end to end, because unit tests
> of each passed throughout the period the bug existed.
> **PHASE 4 COMPLETE (5 of 5).** The Weave can leave the app. `POST
> /export/weave` writes a dated bundle in three shapes with three different
> promises: Markdown for a person (chapter names, every connection carrying its
> reason), JSON for a program (ids intact), CSV as three tables because a nested
> CSV is not a CSV. `include_weave` on the manuscript export and the snapshot.
> **Every anchor travels as an id AND a label** — drop the id and a program
> cannot follow a renamed chapter, drop the label and a person cannot read the
> file. Read from the FILES rather than the index, so an export cannot be wrong
> in a way a reindex would quietly fix. `test_codex_export.py` is the file the
> spec named and which did not exist: 25 tests.
> **PHASE 5 COMPLETE (5 of 5).** The planning documents became a place questions
> can COME FROM rather than only evidence that a manuscript word is a name — a
> writer with nine factions in their outline and two of them written was asked
> about two. R5.1/R5.2/R5.4: a planned name is raised, says which document it
> came from, needs no frequency floor (a name the writer DECIDED on is not prose
> noise even once), is attached to no chapter, and carries `from_planning` so
> anything reasoning about what the BOOK contains can tell written from intended.
> R5.3 gave `parse_markup` its first caller — `[[Ashfall]]` in a note is the
> strongest signal in the scan, the writer pointing rather than the app guessing,
> and it is never asked of the manuscript. **R5.5: `PRIVATE_NOTES` makes Author
> Notes an enforced exclusion**, which is why a per-trait "never send" was not
> needed; a source-read test fails the build if a new corpus builder reads it.
> Two bugs the tests bit first: `_strip_chrome` ate `[[...]]` as an audiobook
> marker, and a marked name was counted twice.
> **PHASE 6 COMPLETE (5 of 5).** Unwoven was asking twelve trunk questions out
> of a corpus of thirty-three and calling that a world. **R6.0 was found while
> sizing R6.3 and had to go first:** `lands_as` says where an answer BELONGS and
> was also read as proof the question was settled, which works while one question
> owns a landing place and collapses when several share one. Eleven land in a lore
> entry's `rule_or_concept`, so one entry about blood price silenced marriage,
> inheritance, war rules and forms of address at once -- four domains, none of
> them answered by a word. An entry now carries `answers: [question_id]` in its
> own frontmatter: still derived, still in the writer's Markdown, gone when the
> entry is. **R6.1** was the same class of bug as the rest of this recovery: a
> depth ceiling keyed to `DEPTH_FULL`, which is the Warp pass, inside the pass
> whose depth is `unwoven_pass` -- so the comparison could not be true and every
> branch question was dead code. Nothing failed; the walk just asked the same
> dozen forever. **R6.2** paces a sitting to twelve, a round at a time ACROSS the
> world (three-at-a-time showed four domains out of ten, always alphabetically
> the same four), with what the writer's own answer OPENED first inside a part --
> plain trunk-first would have reinstated R6.1 by arithmetic, and a test written
> for R6.1 caught it. **R6.3** grew the corpus 33 to 100, ten per domain, each
> answerable in a sentence. **R6.4** is the domain board (every part, real count,
> a bar for what is decided, finished parts still shown) plus a ten-page
> walkthrough that argues from a cost and shows the same beat written with and
> without the ground decided. Spec amended, Unwoven section.
> **PHASE 8 IN PROGRESS (4 of 11).** All four so far were the same failure: a
> capability that was BUILT, correct, and connected to nothing. **R8.1** is the
> clearest case and the lesson is general -- `refresh` computed staleness
> correctly from day one and returned a COUNT, and a count is not something an
> interface can act on. It cannot mark the card the writer is looking at and it
> cannot scope a re-run, so the right answer went unrendered for the whole build
> while the test suite proved it was right. The report NAMES things now (which
> stops, which chapters); a banner reads it on the first stop of a resumed walk,
> each stale card says the quote is the NEW wording, and the scoped re-check says
> how many stale stops belong to no chapter and would be left out.
> **R8.2** -- `group_tangles` had a producer of nothing, so eleven findings from
> one moved date arrived as eleven questions. A group of one stays a Snag (the
> function returns groups of one for its caller's convenience, and taking that
> literally would put "Tangle: 1 problem" in front of an identical screen);
> Unplaced is never swept in, because "where does this belong" and "which of these
> is right" have different fixers; the members are worked through inside the one
> stop, and "all of these are deliberate" is the button that makes the grouping
> pay. The map cluster the spec describes is NOT built and says so.
> **R8.3** -- "Never ask" had one meaning and it was not the specified one: it
> muted a kind for the whole book without saying so, so the case the wording was
> written for (leave this unreliable narrator alone) could only be had by turning
> the check off for a whole novel. It asks how widely now and writes nothing until
> told.
> **R8.4** -- the two detectors the spec named and nothing implemented, shipped
> NARROWER than its words on purpose and amended to match. "Prose references a
> fact" is a reading, not arithmetic; there is no mechanical way to know that "she
> thought of her father, alive somewhere north" is `father.fate: alive`, and a
> checker that guessed would accuse the writer of spoilers they did not write.
> That is check 3's job in the AI pass. What ships is the writer's own two anchors
> disagreeing: told before it is true, a correction reaching the reader before what
> it corrects (the opening example read backwards), and a connection ending at or
> before it starts -- which every other check silently skips, because an empty
> window never reaches them. The fixer gained the reveal-point control it had
> nowhere; without it the walk would report problems it offered no way to fix,
> which is the one thing the closed-world rule forbids.
> **R8.5 DONE by DROPPING `codex_mention`**, and the reason is worth keeping: it
> could not have been kept fresh by the index's own mechanism. Mentions derive
> from the MANUSCRIPT and `ensure_fresh` fingerprints `codex/`, so every chapter
> the writer edited would have left the rows silently wrong while the gate
> reported the index current -- a cache that answers confidently and wrongly,
> with nothing in a position to notice. Nothing asks for it either. Migration 006
> drops it; 002 still creates it, because editing an applied migration is the bug
> 004 exists to remember, so fresh and upgraded databases both pass through the
> same two states.
> **R8.7 DONE** -- the caching caveat was computed by `resolve_role_model` from
> the day Model Roles shipped and rendered by nothing. It is a claim about MONEY
> (caching is one toggle, so a writer reasonably assumes it covers every role),
> so it is bound like `test_explain_costs.py`: Python reads `providerMeta.ts` and
> fails the build if the screen and `providers.py` disagree in either direction.
> **R8.8 DONE** -- `GuidedWalk` moved to `components/learn/` and `WalkDemo`
> became an audio-or-shown union, because a Weave step has nothing to listen to.
> The Weave surface is `RunWalk`, teaching the THREE facts the programme's own
> opening example needs. One fact reading "believes her father died" is the
> obvious thing to type and makes a world where nobody, including her, ever
> learns otherwise -- and no check can catch it, because that world is perfectly
> consistent, just not the writer's book.
> **R8.9 DONE -- the fourth layer, and it is READ-ONLY on purpose.** The Run
> editor already edits the three switches on two screens through one component; a
> second place to change them would give one idea two vocabularies, which is the
> failure this whole recovery keeps finding. So it answers what the switches DO:
> where the fact is in force (a bar, not a sentence to assemble), what replaced
> it, and what a model actually receives. That answer lives in three modules and
> no screen had ever put it in one place.
> **R8.10 DONE, and the test bit immediately.** 23 of ~70 directional relations
> had no inverse, so from the far end they read "loves (the other way round)" --
> on the OTHER entry's page, where the writer did not make the choice. All 23
> have one now. The cross-language half does not apply here (the picker fetches
> relations rather than copying them), so the contract is on the vocabulary
> itself: a group the picker orders, no two identical labels in one heading, no
> endpoints naming kinds that do not exist.
> **R8.11 DONE -- and writing it found a live bug I did NOT fix.** The graph
> route's docstring says a Tie true LATER comes back `active: false` so the map
> draws it dashed; `record_visibility` hides a future Tie before that branch is
> reached, so `active: false` can only ever mean "ended". Same class as R6.1: a
> documented capability whose condition can never be true, raising nothing.
> Reported rather than patched because it changes what the map SHOWS. The test
> pins the truth so the suite is not green over a claim it does not check.
> **R8.6 DONE -- the dead level is DELETED, on the writer's ruling.** It was
> deader than the audit said: `_resolve_model_and_key` never reads project.json
> at all, it synthesises `{"default_model": override}` from one frontend field,
> so a per-book assignment could not have arrived however faithfully
> `projects.py` stored one. The test that "proved" it worked passed by handing in
> a project dict no caller can produce -- a test that builds the world instead of
> observing it. It now pins the opposite. Roles are app-wide; the per-book
> DEFAULT MODEL is untouched and still works.
> **R8.6b DONE -- the bug R8.11 found, fixed on the writer's ruling.** The map
> draws a coming connection dashed again. `show_future` on the Lens, set by the
> MAP ALONE: the resolver and the brief go on treating a future fact as not in
> force, which is the one guarantee anchors exist to give. Two bounds kept and
> both tested -- the spoiler rule still runs (an unforeshadowed future connection
> is withheld, a foreshadowed one is drawn), and an unintroduced endpoint still
> hides the whole edge, or the map would announce a character who has not
> appeared.
> **PHASE 8 COMPLETE (12 of 12).**
> **PHASE 11 (3 of 4) -- the rulings that never became task ids.** A 2026-08-14
> audit found that three of the ten section-C rulings approved on 2026-08-11 were
> never given ids, so the progress table silently excluded them. That is this
> programme's own failure mode: a decision recorded somewhere that nothing was
> comparing the build against.
> **R11.1 (ruling 8)** -- `Sweep.tsx`, the tick-list. "Forty unplaced facts should
> be a tick-list, not forty screens." OFFERED from the walk rather than replacing
> it, because "not a forced march" cuts both ways. Nothing ticked on open;
> choosing a chapter ticks its own row; a ticked row with no chapter is counted
> out loud rather than silently skipped; a partial failure keeps what landed and
> says how far it got. Snags are deliberately NOT sweepable -- each is a different
> argument, and a tick-list invites settling them without reading them.
> **R11.2 (ruling 5)** -- `SECTION_CONFIGS` and `PROFILE_FOLDERS` are COMPUTED
> from `DEFAULT_TYPES` now. A contract test that catches drift is second best to
> nothing being able to drift. Verified field-for-field identical before the swap.
> **R11.3 (ruling 6, the unblocked half)** -- the deletion is blocked by the same
> thing as R1.5b (`profiles/` is still a home), but the PORT was hiding real data
> loss: the pre-v1.0.10 `influence` scale was healed by `profiles.py` and unknown
> to `threads.py`, so a converted older project read every trait weight as absent
> and defaulted it to `background`, the FAINTEST -- and `foreshadowing`, which
> meant SECRET, lost its weight and its secrecy. Nothing raised anything, because
> a weight is a number and there is no obviously wrong one. One map, in
> `codex/normalize.py`, read by both dialects.
> **Two live bugs fixed alongside.** A colon in a trait name ("Story role: Comic
> Relief", which the app's OWN picker inserts) made a whole Personality section
> parse as prose -- both writers now quote when YAML would misread, and both
> parsers repair the files already on disk. And the Unwoven guide was mounted only
> on the setup screen while the stop card also offered it, so that button set a
> flag and drew nothing.
> **R11.5 -- the accidental-close guard**, on the writer's request after live
> testing: "very sensitive to accidental clicking outside the field causing the
> entire window to Exit prematurely ... happened multiple times to me already."
> Seven overlays wired the backdrop straight to onClose and FIVE held typed text,
> including Quick Fill (the writer's own prose) and the Tie editor's required
> reason line. The app's locked rule already covered it ("Manual save only ...
> Confirm before closing") and the audiobook has obeyed it for two releases; the
> Weave never did. `useAttemptClose` is now the one way out -- backdrop, X and
> Escape through one guard, which they did not share before. It ASKS only when
> there is something to lose: a confirm on every close is one the writer learns
> to dismiss without reading. The walk's message names the PLACE ("you are 3 of
> 12 through this pass"), not "unsaved changes", because every answer is written
> as it is made and the place is the expensive part.
> **R11.6 -- the two answers an Unspun stop could not give.** Reported with one
> example carrying both faults: "Blaskowitz Sideburn" is part of a surname glued
> to part of a nickname, "there was no way for me to EDIT the text it flagged",
> and "I couldn't CONNECT that name to an existing profile for Newton". The stop
> offered Create and Never and nothing else, so a mis-grouped phrase had two
> wrong answers and no right one. The word is now editable BEFORE any destination
> is chosen -- it was editable only inside the create form, so correcting a word
> meant first agreeing to make a profile you did not want. `POST /alias` is the
> missing route: `absorb` moves a word off a placeholder ENTITY and an Unspun
> word has no entity, so absorbing would mean writing a file, deleting it and
> reindexing twice to record a string. An ambiguous word is REFUSED by name --
> a word meaning two things binds to neither, so accepting it quietly would put a
> name in the world that looks recorded and never matches again. Correcting the
> word retires the original phrase (said out loud, not done quietly), or the same
> wrong grouping returns on the next scan.
> **R11.7 -- the outline template is not the writer's world.** R5.1 made planning
> documents a source, which turned the template into one. Measured on the writer's
> own outlines: 53 planned names where about six were real, and 34 that were almost
> all Genre and Tone tags. Now 23 and 9. Three mechanisms and the third is the
> interesting one: the app WROTE the outline templates, so rather than inferring
> which capitalised words are scaffolding it renders them and subtracts their
> vocabulary -- a fact, not a heuristic. Two mistakes worth remembering: harvesting
> the template through the chrome strip first threw away the very words the set is
> for (32 words instead of 158), and running the label rule before the bold rule
> cut bold chapter titles in half, which is where "Half Limit" and "Margin" came
> from. THE VALUE AFTER A LABEL IS KEPT -- "Status Quo: The 3 teams (Alpha, Bravo,
> Charlie)" must still yield the writer's three invented names, and a rule that
> dropped whole lines would have thrown them out with the label.
> **PHASE 10 STARTED (3 of 6).**
> **R10.2 -- ONE v2.0.0.** `main` is at v1.1.0 and all 106 commits since are on
> this branch, interleaved: Model Roles, local models and the whole Weave. The
> three planned tier-3 releases never happened AS releases, so there is nothing to
> tag retroactively; their content is part of v2.0.0 and the CHANGELOG says so
> rather than pretending otherwise. The tier rule decides it: judge by what the
> RELEASE delivers. **v2.0.1 follows immediately with the Profile Extractor**, on
> the writer's ruling -- it is "part in parsol to the original purpose and
> envisioning of The Weave", lives at `The Weave > Weaving | Profile Extractor`,
> and requires Weaving to have been run FIRST (the request carries a snippet of
> each established entry, so the entries must exist). That pulls one AI pass
> forward; the other four stay in v2.1.0.
> **R10.1 -- the CHANGELOG.** A `## [2.0.0]` section, 27 bullets, writer-facing
> (what they get, not task ids). Heading says `- UNRELEASED`: `release.ps1`
> extracts the section but does not stamp the date, so that word is a manual swap
> at cut time.
> **R10.6 -- three one-line changes done.** The only bare `os.replace` calls left
> in `app/` are inside `replace_atomic` itself. Also fixed a comment in
> `findings.py` claiming the Weave followed the pattern those stores used, which
> had been backwards since R2.5b fixed the Weave first.
> **PHASE 10 COMPLETE (6 of 6).** R10.3 gave the backend a real version (it had
> reported 0.1.0 through eleven releases, from three hand-typed copies); R10.4
> added seven manual-smoke scenarios, migration first as THE DANGEROUS ONE;
> **R10.5 returns RELEASE READY** -- 1897 backend, 1370 frontend, zero blockers,
> smoke acknowledged. The one open issue is #21, an intermittent CastPanel flake
> labelled `qa-automation`, not a blocker.
> **Two things found after the plan was written, both from live testing.** The
> Weaving walk went silent on chapter 6 and said "your world and your book agree",
> which it is in no position to claim -- it reads NAMES, and that scene had three
> men described rather than named plus two names revealed once each in dialogue.
> The screen now states what the pass cannot see. Underneath it sat a real bug:
> `evidence.is_a_name` is used as a GATE, so a name appearing only at a sentence
> start or only just inside an opening quote (`"Duncan," he said`) is invisible
> however often it occurs. RULED: leave the gate, the Profile Extractor covers it;
> the tempting fix was measured and floods (Look, Right, Yes, Sorry, Wait survive
> a "never written lowercase" test). Pinned by five tests.
> **Portability is now proven rather than assumed.** The writer asked whether a
> book moves between computers; nothing was checking it. It does, exactly, because
> no absolute path is stored in project data -- `project.json`'s `root_path` is the
> one exception and is healed on open. `app.db` may be deleted freely; the Weaving
> ANSWERS under `.storythread/weave/` may not, and a transfer filtering hidden
> folders loses them silently. Eight tests, plus smoke scenario 24. The root-cause
> test caught ITSELF first: it searched for the raw path only and passed while
> project.json held the old location, because JSON escapes backslashes.
> Phases 7 and 9 are deferred to v2.1.0.
> Branch health: 1973 backend tests, 1419 frontend tests, ruff and tsc clean.

### Spec discipline (applies to every feature, not just the Weave)

1. **A feature's spec belongs in `docs/`, checked in, from the start.** The
   Audiobook Converter did this and shipped clean; the Weave did not.
2. **Where a spec and the code disagree, the CODE is wrong** until the writer
   rules otherwise.
3. **Behaviour changes go in the same commit as the spec change.** A deviation
   that is an improvement gets the spec AMENDED -- it is never left as silent
   divergence.
4. **A claim worth keeping is worth a test that cites it.** See
   `test_explain_costs.py`: Python reads the TypeScript registry so a "free"
   claim cannot outlive the route it describes.
5. **Never document the build in place of the spec.** Correcting docs to match
   drifted code erases the evidence of the drift and leaves build, tests and
   docs mutually consistent and all three wrong.
6. **Remember what testing cannot do.** Live testing finds what is WRONG; it
   never finds what is ABSENT. Missing scope raises no error. Only reading the
   spec against the code finds a capability that was never built.

---

## Project Status

**Status: shipped.** The current release is **v1.1.0** -- see `CHANGELOG.md` for the full release history and `docs/features.md` for what the product does today.

**Versioning is a three-tier rule, not semver.** Tier 3 (`v1.1.x`) = enhancements to existing features. Tier 2 (`v1.x.0`) = additions, like the Audiobook Converter. Tier 1 (`vX.0.0`) = major restructuring -- a change needing its own dashboard, or one that alters multiple existing features at once. Judge the tier by what the RELEASE delivers, not by the size of the programme it belongs to.

The phase history below is the pre-1.0 build record, kept for context. Some items it names were later replaced -- those are marked inline. The biggest post-phase change: structured feedback moved out of the chat panel into the **Smart Advisor** toolbar (inline issue overlays via `POST /api/ai/editor-pass`), and the Writing Companion chat gained **Draft mode** (v1.0.6) and **Enhance mode** (v1.0.7).

Phases 0-4, 5A-5E, and 6 are complete and merged into `main`. Phase 5 was redesigned into an AI Respec with 5 sub-phases (5A-5E). Phase 6 delivered full-manuscript export (with opt-in chapter summaries / scene summaries / notes / profiles), manual snapshot export, scene summaries (per-scene files with auto-split and selection-based preview), summary quality tuning (cliff-notes reframing + preamble filter), relationship-aware full profile summaries, and a backend-health banner for uniform error handling.

### Phases 1-3 -- Complete
Core app: Tauri shell + React scaffold, FastAPI backend, project create/open, CodeMirror Markdown editor, file save, profiles (character/relationship/location/lore/summaries), OpenRouter integration, 9 writing assistants (later replaced by Smart Advisor + Writing Companion), Settings modal, em dash enforcement.

### Phase 4 + Polish -- Complete
Context chips, ai_usage_example generation (removed in 5A), section/full summaries, Profile Builder chat with 7 behavior modes (reduced to 4 in 5A), ToolKit context selector (replaced by the auto-suggest ChipPicker in 5D), visual polish pass.

### Phase 5A -- Profile Builder Rebuild -- Complete
- **Importance levels** replace influence scale: Core / Present / Background / Contextual / Hidden
- **Description-only trait blocks**: ai_usage_example and notes fields removed from TraitBlock
- **Adaptive word count gauge**: per-importance thresholds with visual color-coded bar
- **4 simplified behavior modes** replace 7: Chat, Refine, Extract Traits, Check Consistency
- **ProfileBuilder.tsx rebuilt from scratch**, backend backward-compatible (old influence auto-migrated)

### Phase 5B -- AI Tools -- Complete
- **"How AI uses this" preview**: Sparkles button on TraitBlockCard, expandable prose explanation via `/generate-usage-preview`
- **AI Trim tool**: Scissors button at Wordy/Bloated gauge, `/trim-trait` endpoint, Apply button replaces description
- **AI Importance Audit**: profile-level audit button, `/audit-importance` endpoint flags importance mismatches

### Phase 5C -- Series/Book Structure -- Complete
- **series.py router**: `/api/series/create`, `/open`, `/list-books` for managing book series
- **Book-in-series creation**: `/api/projects/create-in-series` with arcs/ subfolder, series_id/series_path in project.json
- **Arc files**: `/api/profiles/arc/list`, `/arc/profile`, `/arc/create`, `/arc/save` for per-book character arcs
- **Profile merge**: `merge_profile_with_arc()` overlays book arc on canonical profile, `/api/profiles/merged` endpoint
- **Story context injection**: `_build_story_context()` reads series.json + project.json, auto-injects into AI system prompts
- **ProjectHome.tsx rebuilt**: series creation, browsing, book-in-series flows

### Phase 5D -- Toolkit & Routing -- Complete
- **Auto-suggest ChipPicker**: character profiles shown as ghost chips on mount, one-click attach
- **Series source toggle**: "This Book" vs "Series Profiles" in ChipPicker for series projects
- **Content mode routing**: `_validate_model_content_mode()` validates model supports requested mode
- **Model allowlist/blocklist**: `_validate_model_allowed()` enforced in run-assistant, stored in settings
- **Settings UI: Model Routing section**: allowlist, blocklist, per-model content modes configuration
- **Expanded chip types**: series_character, series_relationship, series_location, series_lore

### Phase 5E -- Writing Companion -- Complete
- Chat-based editor right panel replaces button-based assistant UI
- 3 category tabs (Readability / Structure / Context) **toggleable**: click to activate structured feedback, click again to return to general chat
- No selection = full chapter context; text selected = only that text
- ChatMarkdown extracted to shared component (used by both editor and Profile Builder)
- POST /api/ai/editor-chat endpoint with category-specific system prompts
- Context chips always visible on all tabs
- Multi-turn conversation with session history
- Character limits: 30K selected text, 100K full chapter
- Structured feedback: AI quotes specific passages, labels as Praise/Issue/Suggestion, provides before/after rewrites
- General chat mode (no tab selected): open conversational, no structured format
- Selection highlight persists when clicking into chat panel (drawSelection: true, transparent line backgrounds)
- **Superseded since:** the category tabs moved out of the chat into the Smart Advisor toolbar (inline overlays, `POST /api/ai/editor-pass` + `/api/ai/revise-suggestion`). The Writing Companion is now general chat plus Draft and Enhance modes -- see `docs/features.md`.

### Post-5E Polish
- Fixed AI copying instruction template into output (prompt used example-based format instead of numbered template)
- Fixed numbered list resets in AI responses (--- separators replace numbered lists)
- Fixed selection highlight only showing on paragraph edges (transparent .cm-line backgrounds, semi-transparent .cm-activeLine)

### Phase 6 -- Export and Polish -- Complete
- **Scene summaries**: per-scene `summaries/scenes/<stem>/scene-NN.md` files. Auto-split flow (chapter `---` separators drive a sequential per-scene generator with yes/no/cancel overwrite prompts) and selection-based preview modal with slot picker. Expandable sidebar grandchildren under each chapter (Chapter -> Chapter Summary + Scene Summaries -> Scene 1, 2, 3...). `scene_parser.py` drops cosmetic preambles (chapter title + epigraph) under 50 words when an HR follows.
- **Summary quality tuning**: both chapter and scene summary prompts rewritten as "cliff notes" (primary directive = gist, grounding rules secondary). Temperature switched from `extraction` to `critique` (same 0.3 value, clearer semantics). User messages wrap source text in `--- BEGIN/END ---` markers with explicit "Summarize, do not extend" framing.
- **Expanded export**: `POST /api/export/full-manuscript` and `POST /api/export/snapshot` accept `include_chapter_summaries` / `include_scene_summaries` / `include_notes` / `include_profiles` flags. Full-manuscript appends each as a `#` appendix; snapshot mirrors the folder layout.
- **Relationship-aware full profile summaries**: `generate-full-summary` accepts `project_path`; for character profiles it scans `profiles/relationships/*.md` for the character's name and passes Overview / Current Dynamic snippets as "RELATED RELATIONSHIPS" context so the summary weaves in who the character is to others.
- **Backend-health banner**: `useBackendHealth` hook polls `/health` every 10s; a single fixed-position banner shows when the backend is unreachable, replacing per-feature cryptic fetch errors. Dismiss-until-state-changes behavior.

---

## What Storythread Studio Is

A **Windows desktop, local-first Markdown writing app** for fiction writers. The writer does all the drafting. AI acts as reviewer, editor, and brainstorming partner -- never a ghostwriter. AI assists on demand; it never auto-applies changes or autonomously updates story content.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Desktop shell | Tauri v2 | Packages the app as a Windows `.msi` installer; bridges OS features (file dialogs, window management) to the web UI |
| Frontend | React + TypeScript (Vite) | All UI panels and screens |
| UI components | shadcn/ui + Tailwind CSS v4 | Pre-built, dark-mode-ready components the developer can understand and modify |
| State management | Zustand | Simple, beginner-friendly global state for React |
| Backend | Python + FastAPI | Local service running on `localhost`; handles file I/O, AI routing, and database access |
| Package manager | uv | Python dependency management (replaces pip/poetry) |
| Database | SQLite via aiosqlite | Stores metadata, settings, cache -- Markdown files remain source of truth |
| AI access | OpenRouter | Single API key for multiple models; supports content-mode routing |

---

## Repository Structure

```
StorythreadStudio/        <- repo root
  app/                    <- Tauri + React frontend (run npm commands from here)
    src/                  <- React/TypeScript source files
    src-tauri/            <- Tauri/Rust shell
    public/               <- static assets
  backend/                <- Python FastAPI backend (run uv commands from here)
    app/
      main.py             <- FastAPI entry point and route registration
      __init__.py         <- marks app/ as a Python package
    pyproject.toml        <- Python dependencies managed by uv
    tests/                <- pytest suite
  docs/                   <- product docs (scope, architecture, features, roadmap, releasing)
  tests/                  <- manual-smoke.md release checklist
  scripts/                <- release.ps1 and helper scripts
  CHANGELOG.md
  CLAUDE.md
```

## Build Commands

All commands must be run from the correct subdirectory.

### Backend (Python / FastAPI) -- run from `backend/`

```bash
# Install all Python dependencies from pyproject.toml
uv sync

# Start the FastAPI local server in development mode (auto-reloads on file changes)
uv run uvicorn app.main:app --reload --port 8000

# ...or from ANYWHERE in the repo, which is safer -- see the note below:
#   .\scripts\dev-backend.ps1

# Verify the backend imports cleanly without starting the server
uv run python -c "from app.main import app; print('OK')"

# Run backend tests
uv run pytest

# Check code for problems and auto-format
uv run ruff check .
uv run ruff format .
```

**`app` MEANS TWO THINGS IN THIS REPO, and it bites here.** `app/` at the root
is the React frontend; `backend/app/` is the Python package. So
`uvicorn app.main:app` only works from `backend/` -- run it from the repo root
and Python resolves `app` to the FRONTEND folder, finds no `main.py`, and
uvicorn says:

```
ERROR:    Error loading ASGI app. Could not import module "app.main".
```

That names the module rather than the mistake, so it reads as a broken import in
the backend, and with `--reload` it repeats on every save as though the problem
were spreading. `scripts/dev-backend.ps1` exists to remove the choice: it resolves
`backend/` from its own location, checks the import first so a REAL import error
prints its own traceback instead of the same misleading line, and then starts
uvicorn.

### Frontend + Tauri (React / TypeScript) -- run from `app/`

```bash
# Install JavaScript dependencies
npm install

# Start the full app in development mode (launches Tauri window + Vite + hot reload)
npm run tauri dev

# Build a production Windows installer
npm run tauri build

# TypeScript type check only (no output files)
npx tsc --noEmit

# Run frontend tests
npm run test

# Type check (there is NO `npm run lint` script -- tsc is the frontend gate)
npx tsc --noEmit
```

---

## Testing

Two automated test suites plus a manual checklist. All three are wired into `/pre-release` (see `.claude/commands/pre-release.md`).

### Test layout

- `backend/tests/` -- pytest + pytest-asyncio. Uses FastAPI's `TestClient` for HTTP-level tests and `async with open_db(tmp_path)` for store-level tests. Test files named `test_*.py`. Current files:
  - `test_db_migrations.py` -- the app.db migration ladder, and the only thing that finds this class of bug: an UPGRADE. Every other test builds its database from scratch, where an ALTER smuggled into an already-applied migration looks perfectly correct -- which is how a real project came to die on `no such column`. Pins that a v2 or v3 database ends up byte-identical to a fresh one, and that each rung runs on the one before it
  - `test_explain_costs.py` -- does the help text tell the truth about MONEY: Python reads the TypeScript explanation registry, finds each named route's handler, and fails if one that calls `_resolve_model_and_key` is described as free (or the reverse). A "free" claim is a promise about the writer's credit, and the `universal` incident proved a frontend claim about the backend is only as good as something checking it
  - `test_outline_frontmatter.py` -- outline YAML frontmatter parser
  - `test_outline_sections.py` -- outline section parsing / reconstruction (Planner corruption regressions)
  - `test_progress_store.py` -- word counting, night-owl rollover, event recording
  - `test_progress_routes.py` -- `/api/progress/summary` and `/api/progress/daily` HTTP endpoints
  - `test_settings_store.py` -- settings persistence, atomic writes, backup/corruption recovery
  - `test_editor_chat_prompts.py` -- Writing Companion prompt construction
  - `test_enhance_mode.py` -- Enhance mode payloads and prompts
  - `test_sanitizer_routing.py` -- em-dash sanitizer routing per AI path
  - `test_openrouter_errors.py` -- OpenRouter error translation (401/402/404/429/5xx)
  - `test_scene_breaks.py` -- scene break suggestions
  - `test_chapter_progress.py` -- per-chapter word-target matching
  - `test_structure_manifest.py` -- acts/order manifest: synthesis, healing, PUT, ordering consumers
  - `test_rename_chapter_cascade.py` -- file-renaming chapter rename + cascade (summaries, structure, progress)
  - `test_scene_beats.py` -- `## Beats` parsing, preservation on AI regen, /scene-beats
  - `test_story_context_fields.py` -- Book Details fields in _build_story_context
  - `test_project_settings_fields.py` -- Book Details persistence, outline word target, ui-state, numeric starter
  - `test_providers.py` -- provider registry + _resolve_model_and_key dispatch (NanoGPT key/model rules)
  - `test_model_roles.py` -- Model Roles: the eight roles, precedence at all three levels, an unconfigured install resolving identically to before roles existed, and the rule that matters most -- **a configured-but-unusable role reports itself unusable and NEVER substitutes another model**
  - `test_role_call_sites.py` -- reads the real router source: every AI call site names a known role, none uses the pre-roles signature, and ROLE_INFO's feature lists match what the call sites actually do (a role marked in use with no consumer fails the build)
  - `test_role_settings_routes.py` -- the roles catalog endpoint + saving assignments (unknown roles/providers dropped, and the response echoes what was really stored)
  - `test_local_endpoint.py` -- what "Local model" is allowed to mean: loopback/private/.local accepted, public addresses refused with the rule explained, `/v1` normalization per API style
  - `test_think_blocks.py` -- inline `<think>` reasoning traces stripped from local-model replies before the writer or the conversation history sees them
  - `test_nanogpt_models.py` -- tolerant /models normalization for thin catalogs
  - `test_provider_errors.py` -- provider-templated error translation (NanoGPT messages)
  - `test_settings_routes.py` -- ai_provider / NanoGPT key / prompt_caching over the Settings API
  - `test_prompt_caching.py` -- cache_control payload shapes, provider gating, NanoGPT headers
  - `test_editor_chat_materials_flow.py` -- materials echo + placement, stance persistence, temperature split
  - `test_profile_chat_prompts.py` -- profile-chat prompt builder incl. Interview mode contract (interviewer-not-inventor, triggers/origins, full-block rounds)
  - `test_character_kinds.py` -- Main vs Side character templates: kind frontmatter, tolerant trait-section parsing, plain-text round trip
  - `test_quick_overview.py` -- side-character Generate Overview: prompt guardrails (grounding, subtext, vary-angle) + endpoint payload
  - `test_names_store.py` -- name-generator seed data contracts (counts, era honesty, no em dashes) + names.db seed/fallback/reseed
  - `test_names_routes.py` -- /api/names/cultures + /pool endpoints incl. fallback used_era and 400s
  - `test_audiobook_extraction.py` -- audiobook import extractors (TXT/MD/DOCX/EPUB/Storythread-project) incl. real DOCX+EPUB round trips, chapter detection, PDF rejection
  - `test_audiobook_markers.py` -- narration marker grammar ([pause]/[scene-break]/[chapter-break]/[exclude]), derived structure, warnings
  - `test_audiobook_pronunciation.py` -- pronunciation rules, [say] inline overrides, TTS payload prep (`--` to em dash, payload only)
  - `test_audiobook_workspace_routes.py` -- (also covers Dialogue Check: four voices not fifty-four, markers stripped rather than honoured, oversize refusal, no workspace required) -- /api/audiobook import/project/narration/pronunciations/recents/segments end to end
  - `test_audiobook_segmenter.py` -- segment sizing (paragraph grouping, sentence fallback, marker cuts) + stable-ID identity across inserts/edits/chapter renumbering
  - `test_audiobook_generation.py` -- generation engine: run lifecycle, per-segment persistence, pause/cancel between segments, retry cap + pessimistic attempts, truncation validation, restart recovery, workspace lockfile, narration-settings/dialogue/marker pace flow + staleness
  - `test_audiobook_local_worker.py` -- kokoro-worker manager: KokoroBackend transport errors, spawn command + version gate, install flow (SHA256 integrity, polluted-dir replace, locked-file loud failure), voices/preview/preview-selection endpoints
  - `test_audiobook_marker_demos.py` -- WAV stitcher (exact silence, format guards), audible marker demos (scripts render clean, speeds match narrated values), render_marked_text (rules, silence, pace spans, cut-into-span warnings, trace)
  - `test_audiobook_flow.py` -- flow synthesis: mid-paragraph pauses cut the AUDIO of a continuous render (never the text), gap located by the duration-calibrated matcher -- pins the pre-pause slur fix
  - `test_audiobook_assembly.py` -- the assembler against REAL ffmpeg: stitch -> loudnorm -> encode, ffprobe verifies durations, ID3 tags, M4B chapter markers (a missing ffmpeg fails loudly, never skips)
  - `test_audiobook_metadata.py` -- book metadata + cover art (spec 17): manifest store, HTTP surface, cover validators
  - `test_audiobook_tts_providers.py` -- hosted catalog + prices, the print-pass estimator, cloud synthesis behind the local seam, and error classification (a retryable verdict on a billing error would charge twice)
  - `test_audiobook_settings_routes.py` -- the audiobook settings surface: key masking (never echoed back, omitted = leave alone, "" = clear) and engine-pair validation refused out loud
  - `test_audiobook_narration_selection.py` -- three-level engine resolution (book -> settings -> writing fallback), `can_spend` vs `fallback_note` vs `caveat`, and each demoted engine's recorded reason
  - `test_audiobook_mp3_transport.py` -- per-model `response_format`, mp3 byte sniffing + decode, and the self-healing 400 retry (provider names a format, or the field is dropped)
  - `test_audiobook_level_matching.py` -- loudness matching at assembly (-20 dBFS RMS, -1 dBFS ceiling, clamped gain), including that flow dynamics survive it
  - `test_audiobook_pdf.py` -- PDF import against REAL PDFs built by `tests/pdf_builder.py`: scanned rejection, running-header/page-number removal that never eats prose or headings, hyphen rejoining, paragraph reconstruction by indent and by line length
  - `test_audiobook_speakers.py` -- the cast + [voice:NAME] spans (spec 27): span parsing and its three failure modes, voice change as a hard segment boundary, name-to-voice resolution, recasting requeues only that character
  - `test_audiobook_speaker_analysis.py` -- the AI speaker pass (spec 27.3): a proposal that does not quote the source character for character is DROPPED, overlap/ordering rules, prompt guardrails, and the endpoint writing nothing
  - `test_audiobook_storage.py` -- storage measurement + cleanup (spec 25): per-category sizes, orphan detection by leftover, nothing irreversible pre-checked, deleted audio resets its segment records, export-only state, retention migration
  - **The Weave** (`feature/the-weave`, for v2.0.0):
  - `test_codex_types.py` -- the type registry: validation, and that an invalid `types.json` is NEVER silently repaired over the writer's customization
  - `test_codex_anchors.py` -- anchors as ids, ordinals computed never stored, a scene-less anchor valid everywhere
  - `test_codex_resolve.py` -- the heart: effective sets, derived supersession, same-anchor ambiguity is a Snag rather than an ordering, frames survive a rename, `ai_scope: never` unreachable
  - `test_codex_tie_run.py` -- a connection that CHANGES: the writer's own three scenarios (a friendship deepening, a parentage that never changes, animosity turning to love), the pair as the axis so nothing is closed by hand, and the one place connections differ from facts -- an undated connection is true of the whole book while an undated fact is Unplaced, though a WRITTEN anchor that no longer resolves is still Unplaced for both
  - `test_codex_visibility.py` -- one set of rules for facts AND Ties; an edge is only as visible as the least visible thing it touches
  - `test_codex_threads.py` -- Thread round trip; nothing a hand-edited file contains is ever dropped
  - `test_codex_store.py` -- index health: a failed write marks dirty, a dirty index rebuilds before serving, an out-of-band edit is caught by the revision fingerprint
  - `test_codex_sections.py` / `test_codex_edit_delete.py` -- the sidebar growth rule; renaming a kind brings its entries, deleting one that holds entries is REFUSED with a count, a deleted note goes to trash
  - `test_codex_migration.py` -- dry run writes nothing, idempotent, marker only on success, an interrupted run offers resume or restore
  - `test_codex_world_walkthrough.py` -- a REAL densely connected world end to end (Drizzt Do'Urden's, given as the worked example): every relation in it expressible, a custom kind connectable once the writer names the relation, and the world navigable from any point -- standing on the Drow entry finds all five drow. Writing it found four things a writer could not say, none of which any single-rule test could show
  - `test_codex_tie_editor.py` -- recording a connection by hand, and what a BIGGER vocabulary costs: about seventy grouped relations ship now, so a hand-typed label collides constantly and is interpreted rather than refused (already yours, use it; shipped but unadopted, adopt it; covers the wrong pair, widen it -- and a no-op never writes a types.json the project never had); the reported world (faction worships deity, faction part of religion, religion worships deity) is now expressible, a writer can NAME a connection the app never thought of, an older project is OFFERED shipped relations rather than having types.json rewritten behind it, and cardinality WARNS rather than refusing
  - `test_codex_absorb.py` -- taking a WORD into an entry, which is deliberately not a merge: a placeholder is derived (no prose, no ties, no facts) and one holding writing is REFUSED, every absorbed word then resolves to the survivor everywhere, and `display_name` (what the story calls it) is kept separate from `name` (what it is) so Alexandra Langford can be labelled Lexa
  - `test_codex_pins.py` -- marking a connection by hand: the action MARKS rather than connects (no relation to get wrong, and "nothing to connect it to yet" is a good reason to mark), nothing is written into the manuscript, a pin is raised until ANSWERED rather than until a rule stops, and answering it for good removes the mark so the count stays believable
  - `test_codex_migration_report.py` -- what a conversion can SAY it did: a per-file manifest that outlives the HTTP response, and a before/after comparison read from the BACKUP (profiles/ may have been edited since), with the one content change it makes surfaced rather than hidden inside a "same" verdict
  - `test_codex_fact_patch.py` -- editing one fact in place (PATCH keeps the id other facts' supersedes point at; anchors validated; identity fields refused) and creating an entry WITH starter text (unknown section refused by name). Includes the integration that matters: marking both sides of a snag `intentional` silences it on the NEXT SCAN -- and fixing the round-trip hole it exposed, where `intentional` existed in the schema and the index but the Markdown writer dropped it
  - `test_codex_routes.py` -- the HTTP surface, including that every refusal the router raises comes from the closed set of codes in `app/codex/errors.py`, and that a connection with no REASON is refused: the Weave exists so a writer need not paste context, and `A -- connected to -- B` spends brief budget to say nothing the prose did not already show
  - `test_codex_icon_keywords.py` -- TWO cross-language contracts, both read `lexicon.ts` from Python: every icon name the app can store is bundled, and every stop kind `scan.py` can send has words on screen
  - `test_codex_mentions.py` -- an ambiguous mention NEVER silently binds (a bound mention pulls a Thread into AI context, so a wrong bind is invisible); the two things allowed to settle one
  - `test_codex_graph.py` -- the map over HTTP: a Thread not yet introduced omitted at an earlier anchor (which nothing asserted), an edge never outliving the endpoint it points at, a secret connection withheld until the reader learns it, what is left out COUNTED rather than silently dropped, and one developing relationship as one line whose label changes. Writing it found a live bug it reports rather than hides: a Tie true LATER is hidden before the route's `not_yet` branch is reached, so the dashed "coming soon" line the docstring promises cannot fire
  - `test_provider_caching_claims.py` -- does the Model Roles screen tell the truth about caching: Python reads `providerMeta.ts` against `providers.py` and fails either way round, because a wrong claim here costs the writer money on every repeat request
  - `test_codex_snags.py` -- the structural checks, and the one deliberately NOT made: a value changing across the book is the feature, not a contradiction
  - `test_codex_together.py` -- who shares a SCENE with whom: why the unit is the scene and not the chapter (a chapter that cuts between locations must not pair up strangers), an ambiguous name never counted as present, and the floor that keeps Untied from becoming the next 177-entry noise problem
  - `test_codex_scan.py` -- the FOUR passes (Dress the Loom / Weave the Chapters / Read the Cloth / Unwoven), which replaced three SIZES of one thing with four different questions: every stop kind belongs to exactly one pass (a kind in two gets asked twice, a kind in none silently stops being findable), the old wire names still map, and an unknown pass shows the first rather than refusing. Plus the free pass; stops re-derived and never stored; a non-UTF-8 chapter skipped and named rather than taking the scan down; and the Loose thread wording, which is a question about how an entry relates to OTHER entries and says up front (with a count) that the prose already finding the name is a separate thing that works
  - `test_codex_findings.py` -- a run survives deleting `app.db`; staged-then-discarded comes back; applied and dismissed never do; staleness checked locally with no AI call
  - `test_codex_context.py` -- the amended context rule, one test per obligation; pinned content never pruned and refused rather than truncated
  - `test_codex_weaving_routes.py` -- scan / run ledger / brief end to end; a run id off the wire is not trusted as a path
  - `test_world_rules.py` -- the Unwoven corpus: every unlock and crosslink resolves, a crosslink always leaves its domain, every answer lands somewhere the app understands
- `app/src/**/*.test.{ts,tsx}` -- vitest + `@testing-library/react`, runs in jsdom. Current files:
  - `src/components/progress/ProjectCompletionGauge.test.tsx` -- compact bar, slide-over, serial mode
  - `src/components/editor/ThesaurusPopover.test.tsx` -- thesaurus popover
  - `src/components/sidebar/ActGroup.test.tsx` -- acts tree pieces (ActGroup + RowMenu)
  - `src/hooks/useProjectUiState.test.ts` -- per-book UI-state hook (load guard, debounce)
  - `src/components/learn/Explain.test.tsx` -- the self-explanation contract: every entry answers what / why / necessary / what-it-spends, uses the app's own words rather than the code's, and the screens a writer can get stuck on are read as SOURCE to prove they actually render it (a registry nothing renders is documentation, not help)
  - `src/utils/spellcheck.test.ts` -- spellcheck suggestions
  - `src/utils/buildEditorChatPayload.test.ts` -- Writing Companion payload builder + history persistence (appendTurnToHistory)
  - `src/utils/modelFiltering.test.ts` -- model list filtering + recommended models (provider-aware)
  - `src/components/settings/ProviderPanel.test.tsx` -- per-provider Settings panels + PROVIDER_META registry (incl. the local entry: no key field, and the note stating the local-only restriction)
  - `src/components/settings/ModelRolesSection.test.tsx` -- the Model Roles screen: each role names the features it covers, roles nothing uses yet say so, unassigned roles name the Default Model they fall back to, and an assignment that cannot run warns that it will REFUSE rather than substitute
  - `src/data/characterSpines.test.ts` -- Enneagram/archetype canned-content contracts (fiction-first, fill-in hooks, no em dashes)
  - `src/data/traitPools.test.ts` -- trait randomizer: tier replacement semantics, archetype flavor bias, deterministic rolls
  - `src/data/names/fantasyNames.test.ts` -- fantasy name assembly: 12-race roster, deterministic rng, speakability fuzz, phonology disjointness
  - `src/components/profiles/NameGeneratorPanel.test.tsx` -- generator panel: optgroups, era hiding for races, 6+6 deals, partial accept, fallback note
  - `src/features/audiobook/AudiobookDashboard.test.tsx` -- audiobook dashboard: recents render, empty state, open flow, remove-keeps-files endpoint
  - `src/features/audiobook/WorkspaceView.test.tsx` -- narration editor: inline pause insertion (scroll preserved), [say]/[exclude]/pace wraps, Remove marker stripping, manual save PUT + chapter re-derive, marker help panel, pronunciation dialog
  - `src/features/audiobook/GenerationPanel.test.tsx` -- narration rail: voices load, generate posts + live progress, paused-run resume, failed-segment surfacing, up-to-date force flow, engine-unavailable message
  - `src/features/audiobook/anchorPlacement.test.ts` -- the [say] popout is never placed below the halfway line (it expands after opening) and never hangs off an edge
  - `src/features/audiobook/markers.test.ts` -- stripAudioMarkers (wrappers dissolve, words never deleted) + paragraphBoundsAt
  - `src/features/audiobook/ImportPanel.test.tsx` -- Get Started flow (spec 5.1.2): workspace location auto-chosen and explained, override sticks, Create posts source + workspace + title
  - `src/features/audiobook/BookDetailsPanel.test.tsx` -- metadata form: loads on mount, dirty tracking (manual save), full-field PUT, cover pick/validate/preview/remove
  - `src/features/audiobook/SayEditor.test.tsx` -- the [say] popout: brackets are chrome, Accept wraps and hops, already-overridden occurrences skipped, Preview sends the word's sentence
  - `src/features/audiobook/insertScan.test.ts` -- walkthrough scanner contract, pinned with the user's real manuscript examples incl. broken-marker repairs, plus the word-reading axis (whole words only, never inside a say span, never collapsed against a beat on the same spot) and the marker-aware `sentenceAround`
  - `src/features/audiobook/heteronyms.test.ts` -- the shipped word-reading table's contracts: every rule here is a way the ENGINE was measured to fail (no mid-word capital -- espeak splits the word; no `ih` before a consonant -- the h is spoken; the already-correct words and the deferred stress family stay out)
  - `src/features/audiobook/InsertWalkthrough.test.tsx` -- walkthrough panel: stops walk in order, Apply is a buffer edit (never a save), Skip advances, per-kind muting, Ctrl+Enter fast path; the pop-out shell (a dialog, backdrop closes it, kinds say what they are FOR, the whole paragraph is shown and never spills into the next, an empty walk offers a way out); the guided walk explains SOUND rather than buttons, gives every beat kind before/after audio, and frames marker repairs as repairs; word readings offer each candidate as AUDIO with nothing pre-selected, play the writer's own sentence, cache replays, count the same word ahead instead of applying in bulk, and are excluded from Auto-apply
  - the tutorial's own contracts: opens by saying it is optional and naming the engine's faults, teaches what a pause IS before naming a place to put one, runs one continuous scene through the beat steps, admits the short-burst suggestion is a matter of taste, gives word readings their own two Play buttons, and has no keyboard step (those moved under the buttons)
  - tutorial navigation in that file goes by step TITLE, never a click count -- a count breaks whenever a step is inserted, and matching a bare title silently matches the mute-checkbox labels behind the card
  - `src/features/audiobook/AudiobookSettingsDialog.test.tsx` -- settings surface: a masked key is never sent back, engine shelf + demoted drawer with reasons, empty-tier admission, pace re-scale notice
  - `src/features/audiobook/PremiumNarrationPanel.test.tsx` -- the money gate: engine reported not chosen, unusable engine offers no buttons, estimate precedes any confirm, a stale estimate cannot survive an engine change
  - `src/features/audiobook/VoicePicker.test.tsx` -- one picker, three shapes (two dropdowns / one / free text), value stays a single composed id in all of them
  - `src/features/audiobook/ToggleSwitch.test.tsx` -- a switch, not a checkbox: its look carries the state
  - `src/features/audiobook/SpokenLine.test.tsx` -- the read-aloud flourish never costs readability (every word present as text, spaces survive, staggered delays)
  - `src/features/audiobook/CastPanel.test.tsx` -- the cast screen: manuscript names offered as one-click adds, duplicate names block the save, one-book-one-engine explained
  - `src/features/audiobook/speakerScan.test.ts` -- the Cast workbench's scanner: chapter ranges, one stop per PARAGRAPH, tags read both ways, pronouns rejected, a tag never leaks across a paragraph break, assign/reassign/clear round trips, character removal counts usage and keeps every word
  - `src/features/audiobook/CastPanel.test.tsx` -- the workbench: help stays closed until asked, voices fold once a cast exists, Pro column only when connected, only this chapter's characters shown, a click lands on the buffer immediately, removal warns with real counts
  - `src/features/audiobook/StorageDialog.test.tsx` -- the delete screen: only free-to-rebuild categories pre-checked, losses stated on the row, the confirm repeats categories + size, cancelling deletes nothing, locked files surfaced
  - `src/features/audiobook/ExportPanel.test.tsx` -- retention after export: keep says nothing, ask shows the size, auto-delete acts and reports it, and only intermediate audio is ever removed
  - **The Weave**:
  - `src/features/codex/lexicon.test.ts` -- one vocabulary: every term has an icon, a line and a longer answer, keyed by the WIRE CODE the backend sends
  - `src/features/codex/layout.test.ts` -- deterministic graph layout: adding a node never moves the others
  - `src/features/codex/Scrubber.test.tsx` -- the story timeline: a stop per chapter, act bands sized by how much book each act is, and the resting chapter's title EXPANDED and wrapped while neighbours truncate (the cause and effect the first version had none of); still a real range input, announcing "Chapter 3, Caught in the Rain" rather than "3"
  - `src/features/codex/WeaveMap.test.tsx` / `WeaveList.test.tsx` -- scrubbing an anchor, spoiler mode hiding an unrevealed Tie's EDGE, and the list as a peer view rather than a degraded one
  - `src/features/codex/ThreadEditor.test.tsx` -- writing an entry that is not a profile: sections come from the REGISTRY (so a kind added this morning works), manual save means unsaved work looks unsaved and leaving is confirmed, a conflicting save is REFUSED with the writer's text still in the buffer, and an unplaced fact can be seen as unplaced and placed against the writer's own chapters
  - `src/features/codex/TieEditor.test.tsx` -- saying how two things relate: a connection is allowed to be UNTYPED and that is the default ("just connect them", say how later), the other end before the relation, only what means something between those two kinds, "nothing else fits" answered three ways, a flipped relation stored from the OTHER end, and connections read from the end being looked at
: the other end before the relation, only what means something between those two kinds, "nothing fits" answered three ways (flip the pair, adopt a shipped relation, name your own), a flipped relation stored from the OTHER end, and connections read from the end being looked at
  - `src/features/codex/BindDot.test.tsx` -- saying what a bare dot is: the wording is load-bearing (a word MOVED, never merged or deleted), other placeholders are not offered as targets, standing alone is a real answer, and the label question says the entry keeps its own name
  - `src/features/codex/WeaveNav.test.tsx` -- the sidebar: three groups always, sections grow, and a typo'd section can be renamed or removed (a fixed one offers no menu at all)
  - `src/features/codex/StaleNotice.test.tsx` -- the walk admitting its evidence moved: it speaks when something changed and stays QUIET when nothing did, names the chapters rather than counting them, admits what a chapter-scoped re-check would leave out, and always offers the way back out of a narrowing
  - `src/features/codex/FactLayer.test.tsx` -- the fourth zoom level, and what it deliberately does not do: no control to edit anything (the Run editor owns that), a span that ends only where something SAYS it replaces this fact, and the last panel being what a model actually receives
  - `src/features/codex/RunWalk.test.tsx` -- the three facts a belief needs, taught on the shared GuidedWalk card (now in `components/learn/`), including the mistake named before the fix and a demo shown rather than played
  - `src/features/codex/GuideBody.test.tsx` / `customName.test.ts` -- the per-group guides, and the custom-name rules
  - `src/features/codex/WeavingPanel.test.tsx` -- the walkthrough: a real count rather than an estimate, every stop shows its evidence and can say why, four DIFFERENT ways to answer, and the one-click action creates an EMPTY entry that is immediately Frayed
  - `src/features/codex/MigrationPanel.test.tsx` -- consent for the most dangerous button in the programme: the dry run is not optional, the plan is itemised rather than summed, the backup is named BEFORE the button, two clicks with the count repeated, and an interrupted run offers resume or restore rather than guessing
  - `src/features/codex/MigrationResults.test.tsx` -- the account a conversion gives afterwards: every entry listed and grouped by kind (not counted), each one openable as original-vs-converted field by field, "changed" and "missing" kept distinct, and the raw files offered because a table is an interpretation
- `tests/manual-smoke.md` -- human walks through this before cutting a release. Covers the Tauri-shell flows (file dialogs, the updater, native menus, sidecar lifecycle) that automated tests can't reach today.

### Test commands

Run these from the repo root (or the subdirectory noted):

```powershell
# ── Backend (run from backend/) ───────────────────────────────────────────────
cd backend

# Run all tests (verbose, shows each test name)
uv run pytest -v

# Run all tests (quiet summary, same as /pre-release Stage 1)
uv run pytest --no-header -q

# Run a single test file
uv run pytest tests/test_progress_store.py -v

# ── Frontend (run from app/) ──────────────────────────────────────────────────
cd app

# Single-run mode -- exits when done (same as /pre-release Stage 2)
npm run test -- --run

# Watch mode -- reruns on file changes (for active development)
npm run test

# ── Full pre-release gate ─────────────────────────────────────────────────────
# Run the /pre-release slash command in Claude Code.
# It runs pytest + vitest + GitHub blocker check + manual smoke acknowledgment
# and prints a RELEASE READY / DO NOT RELEASE verdict.
# See .claude/commands/pre-release.md for the full spec.
```

**Before every release, run `/pre-release` and get a `✅ RELEASE READY` verdict before cutting the build.**
The gate cannot pass with zero tests, open `pre-release-blocker` issues, or an unacknowledged manual smoke.

### Why no automated end-to-end suite

Storythread Studio is a Tauri desktop app. File dialogs, native menus, the auto-updater, and the FastAPI sidecar live in the Rust shell, not the WebView. Playwright drives browsers, not Tauri binaries; pointing it at `localhost:1420` would give false coverage on every flow that needs the shell. Real desktop E2E (via `tauri-driver`) is a separate roadmap item. Until then, automated tests cover the React + Python layers and `tests/manual-smoke.md` covers shell-dependent paths.

There is **no staging URL.** This app is distributed as a `.msi` installer via GitHub Releases. The only "URL" is the local Vite dev server at `http://localhost:1420` during `npm run tauri dev`.

### When you find a regression

1. **Reproduce twice.** If it does not repro consistently, note that explicitly in the issue.
2. **Capture context.** Failing command output, snapshot if applicable, reproduction steps a human can follow without you.
3. **File a GitHub issue via the `github` MCP.** Title = short imperative ("Smart Advisor pass fails on chapters > 50k chars"). Body = repro / expected / actual / version / log excerpts. Labels = `qa-automation` plus an area label if obvious.
4. **Report to the user in chat** with the issue link.
5. **Do not silently fix.** Bug-fix work needs an explicit user request -- never as a side effect of test-running.

### Testing guardrails

- **Never run tests against any non-local environment.** No remote production exists. If "staging" is ever added, `/pre-release` must be updated to gate against it.
- **Never skip a failing test to make a suite pass.** No `pytest.skip`, no `xfail`, no commented-out assertions, no `it.skip(...)`. Fix the test or fix the code; do not hide the failure.
- **Never auto-merge.** All commits and PRs go through explicit human review. No `gh pr merge --auto`, no automated merge bots.

---

## Architecture Overview

Storythread Studio uses a **three-layer local architecture**. No cloud. No sync. Everything runs on the user's machine.

```
[ Tauri Window ]
       |
[ React UI (Vite + TypeScript) ]   <-- all panels, editor, AI side panel
       |  HTTP on localhost
[ FastAPI Backend (Python) ]       <-- file I/O, parsing, AI calls, DB queries
       |
[ Markdown files + SQLite ]        <-- dual storage (see below)
```

**The frontend never reads files directly.** All data flows through the FastAPI backend.

### Dual Storage Model

Two storage systems work together:

- **Markdown files** -- the permanent source of truth. Chapters, profiles, notes, and summaries all live as `.md` files in the project folder. These are human-readable and can be backed up or published to GitHub as-is.
- **SQLite** (`<project>/.storythread/app.db`) -- a fast local cache. It holds Writing Progress events (`progress_event`) and, on `feature/the-weave`, the Weave's graph index (`codex_entity` / `codex_alias` / `codex_tie` / `codex_fact` / `codex_meta`). Settings live in `~/.storythread/settings.json`, NOT in this database. Anything stored here must be rebuildable from Markdown.
- **The ONE exception under `.storythread/`**: `weave/runs/<run-id>.json` holds what the writer answered during a Weaving session (applied / deferred / retired / muted). That is not derivable from anything, so it is deliberately not in `app.db` -- deleting the cache must never cost the writer answers they already gave.

Think of Markdown as the filing cabinet and SQLite as the index cards on your desk -- the cabinet is what matters; the index cards just make lookup faster.

### Project Folder Layout

Each writing project the user creates gets its own folder:

```
MyNovel/
  project.json          <- project settings (model, content mode, series linkage)
  manuscript/           <- chapter .md files
  notes/                <- outline, style guide, themes
  profiles/             <- characters, relationships, locations, lore
    arcs/               <- (series projects only) per-book character/relationship arcs
  summaries/            <- AI summaries: chapters/ + scenes/<chapter-stem>/scene-NN.md
  exports/              <- combined manuscripts and dated snapshots
  .storythread/         <- app.db, cache, logs (NOT source code)
```

Full folder schema is in `docs/architecture.md`.

---

## AI Boundaries (Critical -- Never Violate)

### The Write Boundary

AI output may only be written directly to these **designated generated-content fields** in Markdown:

- `ai_profile_summary`
- `ai_section_summary`
- `chapter_summary`
- `scene_summary`

One deliberate, user-approved exception (v1.0.10): the **[Generate Overview] button on SIDE/BACKGROUND character profiles** fills the Overview field from the writer's own filled-in fields. It is writer-clicked per use, lands in an editable field, and saves nothing until the writer saves. Scoped to fast side-character assembly only -- do NOT generalize this pattern to other human-authored fields without explicit user direction.

AI must **never silently overwrite** human-authored prose, profile descriptions, notes, or story drafts. All other AI output goes to the side panel only, where the writer copies it manually.

### The Em Dash Rule

**AI must never output em dash or en dash characters (U+2014 / U+2013).** The approved substitute is `--` (double hyphen). This is a locked product rule enforced at three layers:

1. **Prompt layer** -- every system prompt explicitly bans em dashes
2. **Sanitizer layer** -- `backend/app/ai/sanitizer.py` post-processes all model output, replacing any em/en dash with `--`
3. **Style guide layer** -- the project's style guide Markdown file records this rule

Path nuance (since v1.0.6): prose-producing paths (Draft mode, revise suggestions) keep the approved `--` punctuation; the conversational chat path additionally folds `--` into commas/colons so replies read naturally. Routing is covered by `backend/tests/test_sanitizer_routing.py`.

### Content Mode

The app supports three content modes: `general`, `mature`, `explicit`. The project `project.json` sets a default. Requests can override it. Model routing must respect content compatibility -- if no eligible model exists for a request, show a clear error rather than silently degrading.

---

## Non-Negotiable Product Rules

- **Manual save only** -- no autosave. Unsaved changes show a visual indicator. Confirm before closing.
- **One chapter open at a time** in the editor.
- **Session-only undo/redo** -- no archival draft history for prose in MVP.
- **Explicitly inspectable and controllable context** -- AI may automatically receive story context relevant to the current point in the story, but the writer must be able to inspect what will be sent, remove individual Threads, exclude categories, and turn automatic Weave context off entirely. **No context is transmitted until the writer initiates an AI action.**
  - This AMENDS the original rule ("explicit context attachment; AI never has implicit project access"), which the Weave makes untrue -- the app now assembles a brief on the writer's behalf. What is non-negotiable is that they can see it, cut it, and switch it off. Enforced in `backend/app/codex/context.py`; pinned by `backend/tests/test_codex_context.py`.
- **The Weave walkthrough is a closed world** -- the writer does not leave the popup until the task is done or they X out. Every stop kind resolves INSIDE it (Quick Entry creates base-level entries with a name, kind and one starter line; thin entries fill in inline; contradictions settle in place). The panel has NO navigation callbacks, enforced by a source-read test. The Weave builds the framework only; expanding entries is the writer's later work elsewhere.
- **Every step in a walkthrough proposes the next one** -- after any completed action the screen states what happened and offers the next step, with a named exit that says what it does. Finishing a stop ADVANCES the walk; it never dismisses a panel back onto the same stop. Several separately-reported "dead ends" were all this one rule.
- **Every feature explains itself** -- each screen, panel and popup offers ONE **"What's this?"** (icon-only where a row is crowded), opening a panel that FLOATS rather than rearranging the layout, with any steps inside it under a "How to do this" heading. An explanation must answer four things or it is not one: what it is, **why** it exists or is happening now, whether it is **necessary** (required / recommended / optional), and, as a nice-to-have rather than an obligation, **what it spends**. Saying nothing about money is fine; saying the wrong thing is not, and `test_explain_costs.py` fails the build over a "free" claim on a route that calls a model. This is a TYPE, not a habit: `app/src/components/learn/explanations.ts`, rendered by `<Explain of="key" />`. The two rules above are halves of one thing -- flow makes the app ask what is next, this lets it answer how and why and at what cost.
- **AI output reviewed before use** -- results show in side panel. Applied by the writer via copy/paste. No auto-apply.

---

## Code Style and Comment Philosophy

This project is **learning-focused, not industry-standard**. The primary audience for the code is the developer building it as a personal learning project.

**Every meaningful code block should have comments that:**
- Explain **what** it does in plain language
- Explain **why** it exists and how it fits the bigger picture
- Use **short analogies** where helpful (e.g., "FastAPI is like a restaurant waiter -- it takes orders from the frontend and brings back what was requested from the kitchen")
- Call out anything that might be surprising or non-obvious

Favor **longer, clearly annotated code** over compact, clever code. A function with 10 lines of comments is better than a one-liner that requires prior expertise to understand.

---

## UI Design Direction

- **Dark mode** -- Charcoal-black background #0F172A (approximately `#1A1A1A`), off-white `#F0F0F0`/light `#E0E0E0` text, secondary text `#60A5FA`, Accent: #22C55E, high contrast. 
- **shadcn/ui** with Tailwind CSS for all components -- clean, modern, fully customizable
- **Three-panel layout** on the main writing screen: left navigation panel, center Markdown editor, right AI assistant panel
- **Embedded UX hints** are a first-class design feature: tooltips, contextual help text, and onboarding cues built into the UI from the start -- both to help the fiction writer use the app and to help the developer understand what each UI piece does
- The **writer's text** is always the visual focus. UI chrome should be minimal and non-intrusive.

---

## Available MCP servers

Two MCP servers are configured for this project (see `.mcp.json`). Use them where they help; skip them where they would mislead.

### playwright (research / ad-hoc only)

**Use when:**
- Fetching content from external web pages when WebFetch is not enough (heavy JS, login-walled docs, complex SPAs).
- Capturing accessibility snapshots of external sites for debugging or comparison.
- Ad-hoc browser exploration on `http://localhost:1420` when WebFetch cannot reach the interaction you need.

**Do NOT use when:**
- Running `/pre-release`. Playwright cannot drive the Tauri shell; coverage would be misleading. The pre-release gate uses pytest + vitest + the manual smoke checklist.
- Testing any flow that depends on `@tauri-apps/api` (file dialogs, the updater, native menus, the embedded sidecar). Those simply do not exist when Playwright drives a plain browser.
- Replacing pytest or vitest for any automated-test purpose.

### github (issues + repo metadata only)

**Use when:**
- Filing a `qa-automation` issue for a regression (see "When you find a regression" under Testing).
- Listing open `pre-release-blocker` issues during `/pre-release`.
- Reading existing issues for context when debugging or understanding a feature's history.
- Adding labels or comments to existing issues with explicit user approval.

**Do NOT use when:**
- Creating or modifying releases. Use the workflow in `docs/RELEASING.md` and `scripts/release.ps1`.
- Force-pushing or rewriting git history.
- Merging pull requests. Never auto-merge -- see the testing guardrails above.
- Closing issues without explicit user direction.

---

## Key Reference Files

**A feature with a spec is held to it.** Where a spec and the code disagree,
the CODE is wrong until the writer says otherwise; behaviour changes belong in
the same commit as the spec change; and a claim worth keeping is worth a test
that cites it. This is not a style preference -- the Weave was built for weeks
against a spec that was never checked in, so the tests described the build, the
docs described the build, and a whole missing capability ("reads the AVAILABLE
documents" -- notes, outline, style guide) went unnoticed because absent scope
raises no error. Never document the build in place of the spec; that erases the
evidence of drift.

| File | Contains |
|---|---|
| `docs/weave-spec.md` | **Source of truth for the Weave** (v2.0.0): the world model, anchors, Ties, stop kinds, Weaving, context assembly, Model Roles |
| `docs/audiobook-converter-spec.md` | Source of truth for the Audiobook Converter (shipped v1.1.0); tests cite it by section number |
| `docs/product-scope.md` | Core goals, writing philosophy, locked product rules, in/out-of-scope |
| `docs/architecture.md` | Three-layer architecture, dual storage model, folder layout, current API surface |
| `docs/features.md` | What the product does today: editor, Profile Builder, Smart Advisor, Writing Companion, series, exports, settings |
| `docs/roadmap.md` | Scheduled / Proposed / Nice-to-Have features, plus dropped items |
| `docs/RELEASING.md` | Release runbook (signing key setup, per-release checklist) |
| `CHANGELOG.md` | Shipped changes per version |
| `README.md` | Public-facing project description, install instructions, donation links |
