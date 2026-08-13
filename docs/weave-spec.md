<!--
  THIS FILE IS THE SOURCE OF TRUTH FOR THE WEAVE.

  It is the writer's own design document, promoted out of local/updateplan.md
  on 2026-08-11 -- late, and that lateness is the point of this note.

  While it lived only in local/ (gitignored) nothing could be checked against
  it. Tests described the build. The docs described the build. The build
  described itself. All three agreed with each other and none of them agreed
  with this file, and the drift was invisible because MISSING SCOPE RAISES NO
  ERROR: a scan that never opens the Outline does not fail, it just returns
  fewer stops. It took a writer noticing an absence, by hand, to find it.

  The Audiobook Converter did not have this problem. Its spec was promoted to
  docs/ early, grew as the feature grew, and its tests cite it by section
  number ("spec 17", "spec 25", "spec 27"). That is the standard this file is
  held to from here:

    1. A claim here outranks the code. Where they disagree, the CODE is wrong
       until the writer says otherwise.
    2. Changing behaviour means changing this file in the same commit.
    3. A claim worth keeping is worth a test that cites it.

  Kept verbatim as written. Corrections belong in it, not around it.
-->

---

# AMENDMENTS -- approved 2026-08-11

Everything below this block is the original document, unchanged. These are the
decisions taken after `docs/weave-spec-gaps.md` audited all 806 lines against
the build. Where an amendment and the body disagree, **the amendment wins.**

The rule that produced them: a deviation that is an improvement gets recorded
HERE, so it stops being silent divergence. A deviation that is damage gets
repaired in code. Nothing is left as an unexplained difference.

The work these amendments schedule is `docs/weave-recovery-plan.md`.

## A. Build decisions accepted into the spec (R0.8)

Seven places the build improved on this document. Approved; the body is
superseded on each point.

1. **Four passes, not three sizes.** Full weave / Targeted / Quick pass are
   replaced by **Dress the Loom** (what is here and what relates to what),
   **Weave the Chapters** (did anything change), **Read the Cloth** (where the
   book contradicts itself) and **Unwoven** (the ground rules, its own job).
   Named by the writer. Every stop kind belongs to exactly one pass, pinned by
   a contract test. "Targeted" becomes a scope modifier inside a pass rather
   than a stage of its own.
2. **The world-rules corpus lives in Python** (`backend/app/codex/world_rules.py`),
   not `app/src/data/worldRules.ts`. It is scan input, and the scan is Python;
   shipping it to the frontend to send it back would be a round trip for
   nothing.
3. **Anchors are stored as text; ordinals are computed, never stored.** The
   `at_ord` / `until_ord` / `revealed_ord` columns are deliberately absent --
   a stored ordinal is a second source of truth for reading order that goes
   stale the moment a chapter moves.
4. **Eight role pickers, not nine.** `fallback` is not a pickable role: it is
   what happens when nothing is picked, and offering it as a choice invites the
   writer to configure the absence of a configuration.
5. **`migrate/restore` and `migrate/compare` are kept** -- a reversibility
   story beyond what this document described, and the migration is the most
   dangerous button in the programme.
6. **Agency gating (`ACTIVE_TYPES`) is kept.** Only Characters and Creatures
   are asked how they connect; Locations, Lore, Factions, Deities, Governments,
   Religions and Cultures are passive and get connected TO. From live use: "a
   location wouldn't know anyone or have anything to do with someone." An
   Untied pair with one active end stands its question on the active end.
   Writer-overridable per type via `"active": true|false`.
7. **Five extra built-in types are kept**: government, deity, creature, culture,
   language.

Also accepted into the spec as intended behaviour, having been proven necessary
by live testing rather than designed here:

- **The closed world.** From the moment Weaving opens the writer does not leave
  it until the task is done or they X out. Every stop kind resolves inside the
  popup. Held structurally: the panel takes no navigation callbacks and a
  source-read test bans them.
- **Continuous flow.** After any action the screen states what happened and
  offers the next step, with a named exit that says what it does. Finishing a
  stop ADVANCES the walk; it never dismisses a panel back onto the same stop.
- **The required reason line**, asked BEFORE the relation type, capped to one
  line by the shape of the input. It outranks the relation for brief quality:
  `antagonist_of` is a category a model could guess; "she is hiding her theft
  from him" is the scene.
- **A connection is an axis.** The pair `(A, B)` is the axis and its states are
  a run on it, so a friendship that deepens supersedes correctly instead of the
  writer hand-closing each previous Tie.
- **Every feature explains itself**: one "What's this?" per surface answering
  what / why / necessary / what it spends, in a typed registry, with a
  cross-language test that fails the build over a false "free" claim.

## B. Rulings on contradictions (R0.9)

Ten places the build went against this document. All ten ruled 2026-08-11.

| # | The contradiction | Ruling |
|---|---|---|
| 1 | Context inspect built as a list; body says "a small map, not a list" | **BOTH.** A small non-interactive graph of the brief's Threads and their Ties at the anchor, above the list. The map answers "what shape is this"; the list stays the workbench for removal, cost and reading the exact words |
| 2 | `weave_brief` added as a wire field; body says "chips need no wire change" | **KEEP THE FIELD.** As chips the automatic brief becomes indistinguishable from the writer's deliberate attachments, inherits the Canon/Reference stance meant for their choices, pollutes established-chip dedup, and has nowhere to carry the "as of this point in the story" framing |
| 3 | `GET /run` and `GET /resolve` deleted as dead code | **RESTORE BOTH.** They looked orphaned because their consumers were never built. `/run` is required for resume; `/resolve` is the only way to ask "who is she as of chapter 7" for a writer rather than for the brief |
| 4 | Two teaching registries; body wants one | **KEEP TWO, BIND THEM.** A term has an icon and a definition; a screen has a cost, a necessity and steps. One type would give every term a meaningless cost field. A contract test asserts they cannot contradict each other |
| 5 | `PROFILE_FOLDERS` / `SECTION_CONFIGS` duplicated rather than replaced | **COLLAPSE INTO THE REGISTRY.** The body is right and the drift already shipped as a bug (Locations with "Physical Description" and Locations with "Appearance") |
| 6 | A parallel Markdown parser; body says the profile parser is "reused nearly whole" | **CONVERGE ON ONE -- THE CODEX PARSER.** Same destination, opposite route: the codex format is a strict superset, so bending the profile parser to it was the wrong direction. Port its legacy-YAML repair across, then delete it once nothing calls it |
| 7 | Two deletion orders ignored | **CARRY BOTH OUT, SEQUENCED.** The false comment at `profiles.py:125` goes immediately -- it is a lie in the code and the migration exists because it is one. `merge_profile_with_arc` goes when the route that calls it goes |
| 8 | Unplaced and Loose thread walked one at a time; body wants a multi-select list and "all at once" | **BODY WINS.** Forty unplaced facts should be a tick-list, not forty screens. Folded into one piece of work with the Unwoven domain board, since it is the same interaction |
| 9 | Frayed fill shows every missing section, with no prose-derived suggestions | **SPLIT.** "From what the prose already says" is right and missing -- build it. "One field at a time" is overruled by the writer: it is the same force-march that ruling 8 removes |
| 10 | Nine stop kinds where this document's table names five | **KEEP BOTH ADDITIONS, AMEND THE TABLE.** `pinned` (the writer's own mark -- the one stop that is not a rule firing) and `early_mention` |

## D. Amendment of 2026-08-12: importance and disclosure are two axes

**Approved by the writer.** This document, and the profile system it inherits,
treat `hidden` as the fifth level of importance:

> Core / Present / Background / Contextual / Hidden

That is wrong, and it is wrong in a way that cost the writer the use of their
best material. Importance answers "how much does this shape them". Hidden
answers "may it be said out loud". The two are unrelated, and the writer's own
worked example is the proof:

> A villain avoids hospitals because he watched his parents die in one. He will
> not enter one and will not say the word (**core** -- it decides where the plot
> can go). He freezes when he sees people holding hands, because they died
> holding hands (**present**). If asked, he says only that they were taken from
> him early (**background**).

Three traits, all secret, at three weights. On one scale they collapse into each
other, and worse: `hidden` sorts LOWEST in every prompt, so the trait driving
the most scenes arrived as the faintest signal on the page.

**So the axes are split.**

1. `importance` keeps four levels and means weight only.
2. A per-trait `subtext` flag carries disclosure. True means: AI receives the
   trait, uses it at its full weight, and is forbidden from naming, quoting or
   revealing it. It shows as behaviour. The instruction that enforces this has
   been in `ai/prompts.py` the whole time; what was missing was a control that
   did not force a writer to trade weight for secrecy.
3. **"Never send" is deliberately NOT built.** Author Notes is the room for
   material that must not travel, and it is manually attachable when the writer
   wants it. **That guarantee is now enforced rather than assumed** (R5.5):
   `notes/author-notes.md` is named in `scan.py`'s `PRIVATE_NOTES` and skipped
   where the app reads the writer's other documents, and a source-read test
   fails the build if a corpus builder starts including it. It stays the
   writer's to attach by hand and theirs to export; what the rule means is that
   nothing in this app reads it on its own initiative. Written down because the
   control this replaces was dropped ON THE STRENGTH of it -- a promise about
   privacy resting on a convention is the "hidden is never sent" falsehood one
   level up.
4. A secret is NOT a timed reveal. Subtext is never said, at any point; the
   reader learning something in chapter fifteen is a fact with `revealed_at` on
   the entry's Run. Both are needed and they are different mechanisms.

**This also reverses an earlier build decision recorded in section A.** The
conversion set `ai_scope: on-request` on every hidden trait, on the sound
observation that the prompt's never-name rule is not a hard gate. But that trade
is worse than the problem it solved: withholding a secret stops the model naming
it by stopping the model KNOWING it, so the villain above arrives with no reason
to avoid anything and behaves like somebody else. `ai_scope` means availability;
`subtext` means disclosure; the never-name instruction is what protects a secret.

Files written before the split are read as what they meant: `importance: hidden`
becomes weight `present` plus `subtext`. `present` because the old level recorded
no weight at all, and every one of them is listed for the writer to weigh
properly rather than a value being guessed and hidden.

Recovery tasks R2.12a-e.

---

## C. Defects in this document, corrected

1. The Verification section appeared **twice, byte-identical**. The duplicate is
   deleted.
2. The role table lists nine roles including `fallback`, while the `ROLES`
   literal further down lists eight. Eight is correct -- see amendment A4.
3. The role feature lists in the table are **intent, not inventory.**
   `ROLE_INFO` in `backend/app/ai/roles.py` is deliberately narrowed to
   features that actually have a tagged call site, because
   `test_role_call_sites.py` fails the build for a role claiming a consumer it
   does not have. Features named in the table below and not yet tagged --
   Guide mode, Unwoven question expansion, act/outline/beat passes, Check
   Consistency, Weave fact and Tie proposals, mention detection -- are
   scheduled in the recovery plan, not silently dropped.

---

The Weave — a story-aware world model, and Model Roles

 Context

 Storythread Studio ships today with a profiles system that AI reads as static. A character
 profile describes one person, unchanging, from page one to the last page. That is inherently wrong:
 a heroine who spends fourteen chapters believing her father died in a raid is a different person in
 chapter fifteen, and every thought, decision and line of dialogue after the reveal should follow
 from the new fact, not the old one. The same is true of locations, lore, and relationships.

 Three gaps follow, and this program closes them:

 1. No narrative state. Nothing records where in the story a fact became true. Verified by
 sweep — no provenance on any field, no "established in chapter N", no timeline of any kind. AI
 cannot be asked "who is she, as of chapter 7?"
 2. No unified world model. Characters, relationships, locations and lore are four hardcoded
 folder types. Nowhere for objects, concepts, factions, governments or religions; no typed
 connections, custom fields, tags-as-structure, or mention tracking. Catching AI up means
 hand-attaching profiles until the token count hurts.
 3. One model does every job. Every AI call resolves to a single model. Critique, brainstorming,
 long-context analysis and prose generation all land on the same one, whatever its strengths.

 The outcome is the Weave: one linked, typed, timeline-aware world model that resolves to a point
 in the story, controls what AI may see, assembles its own context, is shown as a graph the writer
 can scrub through their own book, and is filled in by an AI-guided walkthrough that teaches as it
 goes — running on a model chosen per job.

 The graph framing

 From the reference the writer chose (blazorhelpwebsite.com/ViewBlogPost/20086, "The Story Domain
 Is A Graph"): "A novel is the canonical 'details table inside a details table' structure." Its
 recognition criterion is the one that matters here:

 ▎ "Any time you have a parent-child or many-to-many relationship that the AI is being asked to
 ▎ reason about, you have a Knowledge Graph hiding."

 That is exactly this program. Its worked example — "the query 'what does Alice look like in Act II?'
 becomes a two-hop graph traversal instead of a complicated SQL filter" — is precisely our
 resolve(thread, at). The design below treats the Weave as a graph in the data model, in the API,
 and on screen.

 The blog models down to Paragraph nodes with IN_TIMELINE / AT_LOCATION / FEATURES_CHARACTER
 edges. We stop one level coarser, at the scene (codex_mention), which is the same idea at a
 granularity the writer can actually maintain. Going to paragraph later needs no redesign.

 (R8.5: the scene granularity is still right and still what ships -- `together.py`
 works in scenes -- but it is COMPUTED during the scan rather than stored, and
 `codex_mention` is dropped. See the amendment under the schema below.)

 ▎ SynapTale (synaptale.com/graph?ch=100) would not render for inspection — it is a JS app and the
 ▎ browser backend kept closing. Its title ("a living wiki for long fiction") and that ?ch= parameter
 ▎ confirm the concept: a world graph scoped to a chapter. That is the anchor scrubber below.

 Naming — writer-facing vs. code

 The backend calls it the Codex (clinical, unambiguous in code). Everything the writer sees uses
 the weaving lexicon. Both appear throughout this plan deliberately.

 ┌────────────────┬───────────────────────┬─────────────────────────────────────────────────┬────────────────────┐
 │  Writer sees   │         Code          │                     Meaning                     │ Icon (provisional) │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ the Weave      │ codex                 │ the whole world model                           │ Network            │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Thread         │ entity                │ one entry                                       │ per type (below)   │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Tie            │ link                  │ a typed connection                              │ Link2              │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ a Thread's Run │ timeline / fact       │ how it changes across the story                 │ History            │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Weaving        │ walkthrough           │ the guided build-out session                    │ Waypoints          │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Unspun         │ missing-entity        │ a name in the prose with no Thread              │ CircleDashed       │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Frayed         │ thin-entity           │ a Thread too thin to be useful                  │ Gauge              │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Untied         │ unlinked              │ a connection the prose asserts, nothing records │ Unlink             │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Unplaced       │ undated-fact          │ a fact with no point in the story               │ CalendarOff        │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Unwoven        │ unasked-rule          │ world-rule ground not yet worked out            │ Compass            │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Snag           │ contradiction         │ two facts that disagree                         │ AlertTriangle      │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Tangle         │ contradiction-cluster │ several Snags sharing a cause                   │ GitMerge           │
 ├────────────────┼───────────────────────┼─────────────────────────────────────────────────┼────────────────────┤
 │ Loose thread   │ orphan                │ a Thread nothing connects to                    │ Unplug             │
 └────────────────┴───────────────────────┴─────────────────────────────────────────────────┴────────────────────┘

 Thread type icons: character User · relationship Heart · faction Flag · location MapPin ·
 lore BookOpen · religion Sparkles · object Package · concept Lightbulb · event CalendarClock.

 Versioning

 Per the project's tier rule — tier 1 (v2.0.0) for a change demanding a major dashboard or reworking
 multiple features; tier 2 (v1.2.0) for an addition like the Audiobook Converter; tier 3 (v1.1.x)
 for enhancements to existing features. All three releases here are tier 3.

 ┌─────────┬──────────────────────────────────────────────────────────┐
 │ Release │                          Ships                           │
 ├─────────┼──────────────────────────────────────────────────────────┤
 │ v1.1.1  │ Model Roles                                              │
 ├─────────┼──────────────────────────────────────────────────────────┤
 │ v1.1.2  │ The Weave — data layer, the map, the teaching layer      │
 ├─────────┼──────────────────────────────────────────────────────────┤
 │ v1.1.3  │ Weaving — story-aware context and the guided walkthrough │
 └─────────┴──────────────────────────────────────────────────────────┘

 ▎ versioning-convention.md in memory predates the tier rule and contradicts it — update when work starts.

 Decisions taken in the design session

 ┌──────────────────────┬────────────────────────────────────────────────────────────────────────────┐
 │       Decision       │                                   Choice                                   │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Build order          │ Model Roles first, then the Weave                                          │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Manuscript linking   │ Detection in prose; explicit @/[[ ]] markup only outside the manuscript    │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Fact storage         │ A Thread's Run lives in its own .md; SQLite is a rebuildable index         │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Migration            │ One-time conversion of profiles/ → codex/                                  │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Model assignment     │ ~8 roles, features tagged in code                                          │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Anchor precision     │ Chapter + scene                                                            │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Context              │ The app assembles the brief; chips stay for manual add and exclude         │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Visibility           │ Three switches per fact: whose truth / when the reader learns / may AI see │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Shared identity code │ Extract to utils/stable_ids.py; audiobook imports from there               │
 ├──────────────────────┼────────────────────────────────────────────────────────────────────────────┤
 │ Interface            │ Graph-first, layered, every term iconed and explained, teaching built in   │
 └──────────────────────┴────────────────────────────────────────────────────────────────────────────┘

 ---
 Design language and the teaching layer

 Cross-cutting, and built first in v1.1.2 — not retrofitted. The app's own doctrine already says
 so: GuidedWalk.tsx opens "This app is a teaching tool before it is a production tool," and
 CLAUDE.md calls embedded UX hints a first-class design feature.

 One Lexicon, one source of truth

 Every term in the table above gets an icon, a one-line definition, a statement of what it does for
 the writer, and a longer disclosure — all in one file, so the sidebar, the map legend, the walk
 rail, tooltips and the tutorial cannot drift apart. This generalises the
 STOP_KIND_LABELS / STOP_KIND_HINTS / DEFAULT_MUTED_KINDS trio in insertScan.ts and the
 PROVIDER_META registry in providerMeta.ts.

 // app/src/features/codex/lexicon.ts
 export interface LexEntry {
   term: string;              // "Loose thread"      -- what the writer reads
   code: string;              // "orphan"            -- what the code calls it
   Icon: LucideIcon;
   tone: "emerald" | "amber" | "rose" | "blue" | "violet" | "zinc";
   short: string;             // one line, for tooltips and the legend
   does: string;              // what it DOES for you, in second person
   whatsThis: React.ReactNode;// 2-4 sentences, the disclosure body
   example?: React.ReactNode; // what it looks like on screen
 }
 export const LEXICON: Record<string, LexEntry>;

 A contract test asserts every stop kind, Thread type and Tie relation has an entry — a term that can
 appear on screen with no explanation behind it fails the build. (Precedent:
 characterSpines.test.ts, heteronyms.test.ts.)

 Promote the teaching components

 WhatsThis.tsx and GuidedWalk.tsx currently live in app/src/features/audiobook/. Move both to
 app/src/components/learn/, re-exporting from the old paths so the audiobook feature is untouched —
 the same no-risk trick as stable_ids.py. The roadmap already calls for a standard guided walk per
 feature (docs/roadmap.md:91).

 GuidedWalk's demos field is audio-specific. Generalise it to a WalkDemo union so a Weave step
 can show a visual demo — a small before/after graph fragment — where the audiobook shows a clip.
 Its existing two-button A/B shape is the right one; only the medium changes.

 Four rules the interface must keep

 1. Show what and why, never just do it. Every proposal states the evidence it used and what will
 change, before anything is applied. This is already the repo's AI boundary rule; the Weave makes
 it visible. Every walkthrough stop carries a "Why am I seeing this?" — the text that triggered
 it and the rule that fired.
 2. Teach in place. WhatsThis on every term, sourced from LEXICON. GuidedWalk on every
 surface. Nothing spotlights or blocks — the panel underneath stays usable, as GuidedWalk already
 guarantees.
 3. Layered, not flat. Every view is a zoom of the one above, never a new screen, so context is
 never lost:
   - Constellation — the whole world, clustered by type, only major labels.
   - Neighborhood — one Thread and everything within N Ties, labels on.
   - Thread card — the entry and its Run.
   - Fact — one fact, its three switches, its evidence.
 4. Visual before verbal. Where a thing can be drawn, draw it. Type colour and icon on every
 Thread everywhere it appears — map, sidebar, chip, brief, walk stop — so a writer learns the
 vocabulary by recognition rather than by reading a glossary.

 ---
 v1.1.1 — Model Roles

 Self-contained, no data-model risk, and the Weave's AI passes use it from day one rather than being
 retrofitted. Zero behaviour change on upgrade — an install with no roles configured resolves
 exactly as today, and a test pins that.

 The roles

 ┌─────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │        Role         │                                         Features tagged with it                                         │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ critique            │ Smart Advisor pass, chapter summaries, scene summaries, importance audit, trim-trait, Check Consistency │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ character_reasoning │ Profile chat (Interview, Refine), speaker analysis, Weave fact and Tie proposals                        │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ long_context        │ Full-manuscript and series-wide analysis (mostly new consumers in v1.1.3)                               │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ brainstorm          │ Writing Companion general chat, Guide mode, Unwoven question expansion                                  │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ structure           │ Scene-break suggestions, act/outline/beat passes                                                        │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ research            │ Research transformation — notes and source material into usable story material                          │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ prose               │ Draft mode, Enhance mode, revise-suggestion                                                             │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ extraction          │ Cheap mechanical work: usage previews, Extract Traits, quick overview, mention detection                │
 ├─────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ fallback            │ Anything unassigned                                                                                     │
 └─────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 Design — mirror the audiobook precedent

 backend/app/audiobook/tts_providers.py:732 resolve_narration_selection() already solved this
 shape: three-level precedence, one flat fully-populated payload, and a clean split between "unusable"
 and "usable but flawed". Its rationale applies verbatim — one function owns precedence because
 several surfaces ask, and duplicating it in TypeScript lets them disagree about money. Read it and
 backend/tests/test_audiobook_narration_selection.py first.

 New backend/app/ai/roles.py:

 ROLES = ["critique", "character_reasoning", "long_context", "brainstorm",
          "structure", "research", "prose", "extraction"]

 def resolve_role_model(settings: dict, project: dict | None, role: str) -> dict:
     """One flat payload every caller sees the same shape of:
        {role, provider_key, provider_label, model_id, source,
         has_api_key, usable, fallback_note, caveat}
        source: "project" | "role" | "default" | "none"
     """

 Precedence: project.json → model_roles[role] → settings model_roles[role] →
 project.default_model → settings default_model → provider.fallback_model (today's path).

 A role assignment is {provider, model}, not a bare model string — different roles use different
 providers, so active_provider() resolves per role and the key comes from that provider's own
 api_key_setting. This is the one structural change from today, where provider is global.

 Changes

 backend/app/routers/ai.py — _resolve_model_and_key(model_id_override) (line 704) becomes
 _resolve_model_and_key(role, model_id_override=None), then a mechanical pass tagging ~14 call sites
 per the table. _prompt_cache_enabled (line 739) already takes a provider — but note a role pointing
 at NanoGPT silently loses prompt caching, which the UI should say out loud.

 backend/app/ai/providers.py — add the two fields already reserved in the header comment
 (lines 20-28): model_list_style: str = "openai", strip_think_blocks: bool = False. Then:

 LOCAL = ProviderConfig(
     key="local", label="Local model", base_url="",   # from settings.local_base_url
     api_key_setting="", key_hint="Ollama or LM Studio on this machine",
     requires_api_key=False, strip_think_blocks=True, fallback_model=None,
 )

 Ollama's native GET /api/tags needs model_list_style="ollama_tags" in openrouter.py::list_models,
 which already branches to _normalize_generic_models for non-OpenRouter providers.

 backend/app/ai/sanitizer.py — strip_think_blocks(text) removing inline <think>…</think>,
 gated on the provider flag. Local reasoning models emit these; they must never reach the writer or
 the conversation history.

 backend/app/settings_store.py — add model_roles: {} and local_base_url: "" to
 DEFAULT_SETTINGS. ⚠️  save_settings() whitelists against DEFAULT_SETTINGS; a key missing there is
 silently dropped on save. Mirror both into SettingsResponse / UpdateSettingsRequest
 (routers/settings.py).

 backend/app/routers/projects.py — model_roles: {} in project.json (lines 377 / 567,
 partial-update block ~924).

 Frontend — new app/src/components/settings/ModelRolesSection.tsx in screens/Settings.tsx
 (next to Section 4 "Model Routing", line 1005). Eight pickers, each listing which features use this (AMENDED 2026-08-11: eight, not nine -- `fallback` is not a pickable role; see the amendment block at the top)
 role underneath, each with a WhatsThis explaining what that kind of job is and why a model choice
 matters for it. Add a local entry to PROVIDER_META; ProviderPanel.tsx already hides the key
 field when requiresKey is false. app/src/utils/modelFiltering.ts needs a bypass for local models —
 its provider-prefix rules are OpenRouter-slug-shaped and will mis-filter a bare local model name.

 docs/research-multi-provider.md is effectively a pre-written design doc for this release.

 Tests

 - test_model_roles.py — precedence at all three levels; a role on a second provider reads that
 provider's key; an unconfigured install resolves identically to today (pinned).
 - test_role_call_sites.py — every AI endpoint requests a role; no call site passes None.
 - Extend test_settings_routes.py, test_providers.py, test_sanitizer_routing.py.
 - ModelRolesSection.test.tsx — feature lists render per role; an unassigned role says so; every
 role has a WhatsThis.

 ---
 v1.1.2 — The Weave (data layer, the map, the teaching layer)

 Folder layout

 MyNovel/
   codex/
     types.json            <- type registry + custom fields + Tie vocabulary
     characters/  relationships/  locations/  lore/
     factions/  religions/  objects/  concepts/  events/
   profiles.backup-2026-08-09/   <- written by migration, never auto-deleted

 The type registry is data, not code. PROFILE_FOLDERS and SECTION_CONFIGS
 (profiles.py:58,114) are hardcoded and duplicated on the frontend (app/src/types/profile.ts:114).
 Replace both with codex/types.json, seeded from built-in defaults and served to the frontend so the
 two cannot drift. Factions, religions, or a writer's own custom type then cost no code.

 Thread file format

 Additive over today's format — _parse_profile_markdown (profiles.py:416) and
 _generate_profile_markdown (:516) are reused nearly whole, including the tolerant trait-section
 fallback at :464-477.

 ---
 type: character
 entity_id: 8f3c…          # reuses the existing profile_id uuid
 name: Elara Voss
 aliases: [Elara, the Thread-daughter]
 tags: [noble, thread-touched]
 fields:
   born: 1247
 ties:
   - rel: mentored_by
     target: e-garrick
     at: ch03/s01           # optional — when the Tie becomes true
 ---

 # Overview
 … existing sections, unchanged …

 # Run
 - id: f-a91c3d
   at: ch03/s02
   axis: belief.father
   value: "Believes her father died in the raid."
   frame: elara             # whose truth
   revealed_at: ch03/s02    # when the reader learns it
   ai_scope: always         # never | on-request | always
 - id: f-77b1e0
   at: ch01
   axis: fact.father
   value: "Garrick is alive, in hiding."
   frame: truth
   revealed_at: ch14/s01
   ai_scope: on-request

 frame / revealed_at / ai_scope are the three switches — author-only secrets, hidden motives,
 misinformation, unreliable narration and layered-world premises in one mechanism. Each renders as a
 labelled control with its own WhatsThis, never a bare dropdown.

 ▎ ⚠️  Fix during migration: profiles.py:125 claims importance hidden is "never sent to the AI
 ▎ API". It is sent — formatProfileForAI serializes it and the prompt merely asks the model not to
 ▎ name it. ai_scope is the real gate. Migrate hidden → ai_scope: on-request, delete the comment.

 Anchors — stable identity for chapters and scenes

 The load-bearing prerequisite. An anchor is ch<chapter_id>/s<scene_id>, stored as IDs.
 Ordinals are computed on demand, never stored — the ordering authority stays
 structure_store.ordered_chapter_filenames().

 Chapter IDs. manuscript/structure.json → version 2; chapter entries become
 {"id": "c-3f9c2e1b", "file": "01-chapter-1.md"}. _heal() (structure_store.py:73) migrates v1
 strings on load. ordered_chapter_filenames() keeps returning filenames so its consumers are
 untouched; add ordered_chapter_ids() and chapter_id_for_file(). Acts already carry a-xxxxxxxx
 IDs (_new_act_id, line 63) — same style, same rationale.

 Preserve the lifecycle rule (lines 25-34): structure.json is not created at scaffold time. Mint
 chapter IDs lazily, on the first anchor, so a project that never opens the Weave stays
 byte-identical. Renames become free for identity — sync_rename_chapter() swaps the file while the
 id never moves.

 Scene IDs. The audiobook segmenter already solved this: content_hash() (segmenter.py:84) plus
 _lcs_match() (:341, order-preserving longest-common-subsequence over hashes), pinned by
 test_audiobook_segmenter.py.

 - Extract both to backend/app/utils/stable_ids.py; segmenter.py imports from there. Two import
 lines change, zero logic. The existing segmenter tests running unchanged is the proof.
 - New sidecar manuscript/scenes.json: chapter_id → [{id: "s-xxxxxxxx", hash, index}].
 - On chapter save: re-split via scene_parser.split_into_scenes_with_meta, hash each scene, LCS-match
 old→new. Unmatched new scenes mint IDs; unmatched old IDs become tombstones, so an anchor into
 deleted text degrades to its chapter rather than dangling.
 - A scene-less anchor (ch07) is valid everywhere, not an error case — so unreliable matching
 degrades to chapter level instead of breaking the feature.
 - Register scenes.json in the rename cascade (documents.py:1178-1222) and the search exclusion
 list (search.py:31-38).

 SQLite index — the graph store

 Rebuildable from Markdown; Markdown stays the source of truth. Extract open_db / get_db_path /
 the migration runner from progress_store.py:39,127,163 into backend/app/db.py, leaving thin
 re-exports. backend/app/codex_store.py registers its own migrations on the same append-only list.

 codex_entity  (entity_id PK, type, name, filename, status, ai_scope, updated_at)
 codex_alias   (entity_id, alias)
 codex_tie     (src_id, rel, dst_id, at_ord, until_ord)
 codex_fact    (fact_id PK, entity_id, axis, value, frame,
                at_ord, at_anchor, revealed_ord, ai_scope, supersedes, intentional)
 codex_mention (entity_id, chapter_id, scene_id, at_ord, count)

 This is the knowledge graph: codex_entity are nodes, codex_tie are edges, codex_fact makes both
 time-varying. POST /api/codex/reindex rebuilds it all. Every write is best-effort with
 log.exception, as progress_store already does — an index failure must never block a save.

 **AMENDED 2026-08-13 (R8.5): codex_mention is GONE.** It was created, indexed,
 cleared on every reindex, and never once inserted into, so each rebuild dutifully
 emptied a table that was already empty. It is dropped rather than filled, and the
 reason is not effort: this index's freshness gate compares a fingerprint of
 `codex/`, and mentions are derived from the MANUSCRIPT. Every chapter the writer
 edited would have left the rows silently wrong while `ensure_fresh` reported the
 index current — a cache with a freshness contract it cannot honour, answering
 confidently and wrongly with nothing in a position to notice. Nor is anything
 asking for it: mention counts come from `scan._mention_counts` and scene
 co-presence from `together.py`, both while the manuscript is already open and in
 memory, so persisting a second copy would buy a lookup nobody makes at the price
 of re-reading a novel on every save. Migration 006 drops it; 002 still creates it,
 because editing an applied migration is the bug 004 exists to remember.

 Ties — the connection vocabulary

 Relation types live in types.json, seeded per type-pair and extensible:

 - character↔character — mentored_by, parent_of, sibling_of, married_to, serves, betrayed,
 loves, rivals
 - character↔faction — member_of, leads, founded, exiled_from, sworn_to
 - character↔location — born_in, rules, exiled_from, haunts
 - faction↔faction — at_war_with, allied_with, vassal_of, schism_of
 - any↔lore/religion — believes, practices, forbidden_by, prophesied_in

 Store one direction only and derive the inverse (mentored_by ⇄ mentor_of) — storing both lets
 them drift. Ties carry optional at / until, so a connection that only becomes true in chapter 9 is
 recordable as such rather than as a flat truth.

 The Weave map ⭐

 The centrepiece, and the thing that makes the data layer visible instead of theoretical.

 No graph library is in package.json (React 19, CodeMirror, Tailwind, lucide, react-markdown,
 nspell, uuid — nothing for viz). Build it as inline SVG with a small layout module written in the
 repo. That matches the app's no-extra-deps habit and the learning-focused comment philosophy, and it
 keeps the Tauri bundle small. dataviz-style rigour applies: type colour is categorical and must
 stay legible in the app's dark palette.

 - Nodes = Threads, each with its type icon and colour, sized by Tie count.
 - Edges = Ties, directional, labelled with the relation, styled by state: solid when true at the
 current anchor, dashed when not yet true, faded when expired (until).
 - The anchor scrubber runs along the bottom — chapters as ticks, acts as bands. Dragging it
 re-renders the graph as of that point in the story: Threads appear when introduced, Ties light
 up when they become true, facts change under them. A spoiler toggle sits beside it: hide anything
 the reader has not learned yet. This is the ?ch= idea, and it is the visual proof that the
 timeline system works — a writer who drags that handle understands the entire feature in seconds.
 - Deterministic layout. Seeded, so the map does not reshuffle on every open — spatial memory is
 most of a graph's value. Writers can drag nodes; positions persist per book via the existing
 useProjectUiState hook (.storythread/ui-state.json).
 - Layers as described above: Constellation → Neighborhood → Thread card → Fact, each a zoom.
 - Legend is the Lexicon, rendered from the same registry, each entry with its WhatsThis.
 - Every empty state teaches: an empty map says what a Thread is and offers to make the first one.

 Routes

 New backend/app/routers/codex.py, prefix /api/codex:

 ┌──────────────────────────────────────────────────────────────┬──────────────────────────────────────────────┐
 │                            Route                             │                   Purpose                    │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ GET /types                                                   │ type registry + Tie vocabulary               │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ GET /list?type · GET /entity · POST /entity · DELETE /entity │ Thread CRUD                                  │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ GET /ties?entity_id · POST /tie · DELETE /tie                │ Ties                                         │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ POST /fact · PATCH /fact · DELETE /fact                      │ a Thread's Run                               │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ GET /resolve?entity_id&at&frame                              │ the Thread as of an anchor                   │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ GET /graph?at&types&depth&root                               │ nodes + edges for the map at an anchor       │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ GET /anchors                                                 │ chapters + scenes with IDs, in reading order │
 ├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
 │ POST /reindex · POST /migrate                                │ index rebuild, one-time conversion           │
 └──────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┘

 Export and portability

 Confirmed against backend/app/routers/export.py: POST /export/full-manuscript already supports
 markdown | txt | docx | epub with include_* flags, and /export/snapshot mirrors the folder.
 Because Threads stay plain Markdown with their Run inside them, copying the project folder already
 takes the whole Weave — no lock-in by construction. On top of that:

 - include_weave on both endpoints — full-manuscript appends Threads as a # appendix grouped by
 type with Ties and Runs rendered readably; snapshot mirrors codex/ verbatim.
 - POST /export/weave — a portability bundle in three shapes: Markdown (the folder as-is),
 JSON (every Thread, Tie and fact with resolved anchors, for import elsewhere), and CSV
 (one entities table, one ties table — what spreadsheets and other tools accept).
 - Anchors export as both IDs and human labels (ch07/s03 and "Chapter 7, Scene 3") so the data
 means something outside the app.

 Migration

 POST /api/codex/migrate — reversible, and it reports what it did:

 1. Copy profiles/ → profiles.backup-<date>/ first. Never auto-delete.
 2. Convert: profile_id → entity_id, folders → Weave types, importance: hidden →
 ai_scope: on-request.
 3. Absorb profiles/arcs/ into anchor-scoped facts. merge_profile_with_arc() (profiles.py:1071)
 is built, tested, and has zero frontend callers — delete it rather than maintain a second
 overlay mechanism.
 4. Repoint chip sources (ChipPicker, App.tsx:3658), export appendices, search exclusions.
 5. Summarize; leave profiles/ until the writer confirms.

 Frontend

 New app/src/features/codex/ — the audiobook feature is the precedent for a self-contained island.
 Map view, Thread list by type, Thread editor (sections + custom fields + tags), a Ties panel, and
 a Run strip showing facts against chapter order with the three switches.

 ⚠️  app/src/App.tsx is a 4,594-line god-component with no state library. Do not extend it — keep
 the Weave an island, as WorkspaceView.tsx does.

 Tests

 - test_codex_anchors.py — chapter IDs survive rename; scene IDs survive insert/edit/reorder;
 deleted scenes tombstone; scene-less anchors valid; ordinals order across acts.
 - test_codex_store.py — index rebuild is lossless; a corrupt index never blocks a save.
 - test_codex_resolve.py — the heart: as-of resolution, supersedes chains, frame selection,
 spoiler filtering, ai_scope: never unreachable by any path.
 - test_codex_graph.py — /graph at an anchor omits Threads not yet introduced and Ties not yet true.
 - test_codex_ties.py · test_codex_migration.py · test_codex_export.py.
 - lexicon.test.ts — every stop kind, Thread type and Tie relation has an entry with icon,
 definition and disclosure. A term with no explanation fails the build.
 - WeaveMap.test.tsx — scrubbing to an earlier anchor removes later Threads; spoiler toggle hides
 unrevealed facts; layout is deterministic across mounts; dragged positions persist.

 ---
 v1.1.3 — Weaving (story-aware context + the guided walkthrough)

 Context assembly

 POST /api/codex/context → {project_path, at, role, budget_tokens, include[], exclude[], pov}
 returns {brief, threads[], token_estimate, omitted[], as_of}.

 Detect what the chapter mentions → resolve each Thread as of the anchor → drop anything revealed
 later → drop ai_scope: never, include on-request only when asked → fit the budget, dropping
 lowest-importance first and reporting what was dropped (no silent caps).

 The inspect panel is a small map, not a list: the Threads going into the brief, drawn with their
 Ties, at the anchor being written. The writer sees the shape of what AI is about to be told.

 Mention detection — backend/app/codex/mentions.py, reusing guardrails proven in
 speakerScan.ts: the NOT_A_NAME pronoun/article blocklist, and soleName()'s refusal to guess
 when a paragraph names two people. Explicit @name / [[name]] markup is parsed in notes, outline,
 summaries and Thread fields; the manuscript stays clean prose.

 Chips need no wire change. ContextChip is {type, name, content} and the backend never
 validates type (ai.py:56), so the brief ships as chips and _build_materials_message()
 (ai.py:1694) renders it unchanged. Chips stay for manual add and exclude.

 Depth — how much Weaving this session

 Chosen before a session starts. The scan runs first and is free, so the count shown is real, not an
 estimate:

 ┌───────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │   Stage   │                                                                            Scope                                                                             │
 ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Full      │ Every domain, every depth, whole project. Warned plainly: "This found 340 stops. That is many sessions of work. Your progress saves as you go, and you can   │
 │ weave     │ stop anywhere."                                                                                                                                              │
 ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Targeted  │ Pick domains (Religion only), Thread types (Factions only), and/or a chapter range. That session does that and nothing else.                                 │
 ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Quick     │ Problems only — Snags, Loose threads, Frayed. Skips the world-rule questions entirely.                                                                       │
 │ pass      │                                                                                                                                                              │
 └───────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 Stop kinds

 Triage is four-way everywhere — a false positive must die, a "later" must return:

 Apply · Not a connection (wrong — never re-raise) · Not yet (right, but not today, or not
 true until later in the book) · Never ask (mute this kind for this target)

 Every stop shows its evidence quote, its "Why am I seeing this?", and its position on the
 map, so the writer sees where in the world they are working.

 **AMENDED 2026-08-13 (R8.3), "Never ask".** The build had ONE meaning for this and
 it was not the one above: it muted the kind for the whole book, and said nothing
 about doing so. The narrow half was unreachable, which matters because it is the
 case the wording was written for -- a deliberately unreliable narrator's entry
 should stop being asked about contradictions without turning contradiction
 checking off for an entire novel.

 So the button now ASKS which, and writes nothing until the writer chooses: "About
 <name> only", which says the rest of the book is still checked, or "Anywhere in
 the book". The narrow choice is offered only where the stop has an entry to
 narrow to -- an Unspun name has none yet, so it would name nothing and silence
 nothing. Both are reversible, and both are stored in the book's own answers file
 (`muted_kinds`, `muted_targets`) rather than in a session, because "never" cannot
 mean "until you open Weaving tomorrow".

 Unspun — a name with no Thread

 Keyword and name detection surfaces candidates; the writer picks which are real. "Not a connection"
 permanently retires a phrase, so "the old woman" never asks again.

 AMENDED (R5.1-R5.4, 2026-08-12): the planning documents are a place a stop can COME FROM, not
 only corroboration that a manuscript word is a name. The outline is where a world gets decided;
 the manuscript is where it arrives, later, a chapter at a time -- so a writer with nine factions
 planned and two written was being asked about two. A planned name is a SOFTER stop in four ways,
 which is the R5.4 ruling: no frequency floor applies (a name the writer decided on is not prose
 noise even once), the stop says which document it came from in that document's own name, it is
 attached to no chapter (there is no sentence to go and look at), and it carries from_planning so
 anything reasoning about what the BOOK contains can tell written from intended. A name in both is
 one question, asked from the chapter. Markup the writer typed by hand is the strongest signal of
 all and needs no floor or corroboration; the manuscript is never asked to carry it.

 Frayed — a Thread too thin

 Required fields per type come from types.json. Shows what is missing and offers to fill it from
 what the prose already says, one field at a time.

 Untied — a connection the prose asserts but nothing records

 Sources: manuscript prose ("Garrick had taught her everything"), a Thread's own text, and explicit
 markup that resolves to no Tie. Each proposal carries the verified source quote, a proposed relation,
 a direction, both endpoints, an optional anchor, and a confidence. The writer can confirm, change
 the relation type from the vocabulary, flip the direction, set the anchor ("only true from
 ch.9"), or reject — and sees the proposed edge drawn on the map before accepting. "Not yet" here means
 record it, dated later, which is why Ties carry at/until.

 Unplaced — a fact with no point in the story

 A multi-select list, not a forced march: tick what to place now, leave the rest. False positives
 get "Not a connection"; the remainder returns next session.

 Snag — two facts that disagree  ⭐

 Five checks, deterministic-first:

 1. Axis conflict — two facts on one axis, overlapping validity, same frame, different values.
 2. Timeline impossibility — a fact referenced before its at anchor.
 3. Knowledge violation — the reason the frame system exists. A character acts on or speaks about
 something they do not know at that anchor: no fact in their frame establishes it and no scene gives
 it to them. Elara referencing her living father in ch.9 when she learns in ch.14.
 4. Reveal-order break — prose references a fact before its revealed_at; the book spoils itself.
 5. Tie conflict — mutually exclusive Ties active at once (married_to two people with no
 intervening fact; member_of two factions at war).

 **AMENDED 2026-08-13 (R8.4), checks 2 and 4.** Both existed only on this page for
 the whole of the Weave's build; they are implemented now, and NARROWER than the
 words above, on purpose.

 Checks 2 and 4 as written say "referenced" and "prose references" — matching a
 sentence of the writer's manuscript to a particular FACT. That is a reading, not
 arithmetic. There is no mechanical way to know that "she thought of her father,
 alive somewhere north" is the fact `father.fate: alive`, and a checker that
 guessed would accuse the writer of spoilers they did not write. That is exactly
 the line `snags.py` draws in its own header between the half that is arithmetic
 and the half that is interpretation, and the interpreting half is check 3, which
 lives in the AI pass with quoted evidence and the freedom to be wrong. Check 4 as
 worded straddles a line the rest of the design keeps.

 What IS mechanical is the writer's own two anchors disagreeing with each other,
 and that is what ships:

 - **Timeline impossibility** (`impossible_order`) — a fact whose `revealed_at`
   comes before its `at`: the reader is told a thing is true before the point at
   which it becomes true. And a Tie whose `until` is at or before its `at`: a
   connection that is never true anywhere, which every other check silently skips
   because its active window is empty.
 - **Reveal-order break** (`reveal_order`) — a fact reaches the reader before the
   fact it supersedes does. This is the programme's opening example read
   backwards: the heroine believes her father died, the truth supersedes that
   belief, and if the TRUTH is marked as reaching the reader first then the arc is
   dead on arrival. Both sides are shown; either anchor may be the mistake.

 The prose half of check 4 that DOES ship is the Early mention stop, which
 compares a bound mention against the point a Thread is introduced. It is worded
 as a question rather than an error, because the mention may be the intended one
 and the anchor may be the mistake.

 Both new checks honour `intentional`, like every other one: dramatic irony is
 built on telling the reader first, and a checker that cannot be told so becomes
 noise the writer stops reading.

 Each Snag shows both sides with anchors and quoted evidence, drawn as a red edge between the two
 nodes on the map, and offers: correct side A / correct side B / add a reconciling fact (often "she
 learned earlier than recorded" → re-anchor) / mark as deliberate / not yet. Mark as deliberate
 sets intentional: true and never re-fires — much good fiction contradicts itself on purpose, and a
 checker that cannot be told so becomes noise the writer stops reading.

 Tangle — Snags sharing an entity or axis group into one stop, shown as a highlighted cluster on
 the map, so the writer sees the systemic cause rather than five symptoms.

 **AMENDED 2026-08-13 (R8.2).** The grouping function was written and unit-tested
 from the start and CALLED BY NOTHING, so a moved date arrived as eleven separate
 questions about one mistake for the whole of the build. It has a producer now, and
 three details are settled that this paragraph did not cover:

 - A group of ONE stays a Snag. `group_tangles` returns a single finding as a
   group of one so its caller can have one code path; taking that literally would
   put "Tangle: 1 problem" and an extra click in front of an identical screen.
 - Grouping is by (entity, axis), and Unplaced is never swept in. "Where does this
   belong?" and "which of these is right?" are different questions with different
   fixers, and bundling them would put two unrelated decisions behind one button.
 - The members are worked through INSIDE the one stop, and there is a group-level
   "all of these are deliberate". That button is the reason the grouping pays:
   marking eleven facts deliberate one at a time is the problem back again.

 The highlighted cluster on the map is NOT built. The Tangle is a walkthrough stop
 today; drawing it on the graph is a later refinement, recorded rather than
 quietly dropped.

 Unwoven — the root system

 Not a questionnaire. app/src/data/worldRules.ts, canned data with contract tests, following
 characterSpines.ts and traitPools.ts:

 { id, domain, prompt, why, depth: 1 | 2 | 3,
   unlocks: string[],      // child questions this answer opens
   crosslinks: string[],   // questions in OTHER domains this answer touches
   lands_as: { type, field } }

 Ten domains: governance · law and justice · economy and trade · religion and belief · the power system
 (magic or technology) and its cost · kinship and inheritance · war and violence · language and naming ·
 geography and travel · calendar and memory.

 Depth maps to the chosen stage: 1 = trunk (~10 per domain), 2 = branches (consequences),
 3 = capillaries (fine texture).

 Crosslinks are what make it a root system rather than a list. Answering "succession is decided by
 combat" unlocks "what stops every heir being murdered in childhood?" and crosslinks into law
 ("is kinslaying prosecuted, and by whom?") and religion ("does the faith sanctify the outcome?").
 Roots branch down and reconnect sideways — and the writer sees that: answering a question draws
 its new node and the crosslink edges onto the map, so the world visibly grows.

 Answers land as Threads or fields on existing Threads — never a separate notes pile — so they
 participate in context assembly like everything else. AI proposes answers grounded in what already
 exists ("your prose says X, which implies Y — is that right?"), never inventing freely.

 AMENDED (R6.0-R6.4, 2026-08-12). Four things, three of them found by building it out to the size
 this section always specified.

 1. AN ANSWER RECORDS WHICH QUESTION IT ANSWERS. `lands_as` is where an answer BELONGS, and it was
    also being read as proof that the question was settled. That works while one question owns a
    landing place and collapses when several share one: there are about fifty places an answer can
    go and a hundred questions to ask, so eleven of them land in a lore entry's "rule or concept",
    and one entry about blood price silenced marriage, inheritance, war rules and forms of address
    at once. An entry now carries `answers: [question_id]` in its own frontmatter. Still derived and
    never a ledger — it lives in the writer's Markdown, survives deleting the cache, and goes away
    with the entry. Where a question owns its landing place outright (eleven of the hundred do),
    content alone still settles it, because nobody hand-types a question id into a file.
 2. DEPTH IS A PROPERTY OF THE CORPUS, NOT A SETTING. "Depth maps to the chosen stage" above
    described the three-sizes model that the four passes replaced; the code kept a ceiling keyed to
    a pass name Unwoven never uses, so every branch and capillary question was unreachable and the
    walk asked the same trunk questions forever. What a writer is ready for is decided by what they
    have answered, which is what `unlocks` is.
 3. A SITTING IS BOUNDED, AND SAYS SO. A dozen questions, taken a round at a time across the whole
    world rather than three at a time from one part of it (which showed four domains out of ten,
    always the same four). Inside a part, what the writer's own answer OPENED comes first. Nothing
    is dropped or hidden: the stop says how much its part has left.
 4. THE DOMAIN BOARD. Every part of the world with a real count and a bar showing how much is
    decided, always including parts with nothing left, because progress the writer cannot see does
    not encourage them. Picking one asks about that part only. Plus a paged walkthrough that argues
    from a cost ("you will otherwise decide this in chapter nineteen in a way that contradicts
    chapter four") and shows the same beat written with and without the ground decided.

 Loose thread — a Thread nothing connects to

 Lists them all at once with what each would need to earn its place. On the map they sit at the rim
 with nothing attached, which is the clearest possible statement of the problem.

 Resuming a session — the findings ledger

 - Deterministic stops are never stored. They re-derive every run from source and destination
 state, so they are always fresh and cost nothing.
 - AI findings are stored and never re-bought. A run returning 100 findings that gets through 15
 keeps the other 85.

 codex_run     (run_id PK, started_at, scope_json, depth, model_used, found, applied)
 codex_finding (finding_id PK, run_id, kind, target_id, payload_json,
                evidence_hash, anchor, state, created_at)
 -- state: pending | applied | deferred | dismissed | stale

 Staleness, cheaply. Each finding stores a content_hash of its evidence span — the same
 stable_ids.content_hash used for scenes and audiobook segments. On resume, re-hash locally: no AI
 call, no tokens. Unchanged text keeps the finding; changed text marks it stale, and stale findings
 are re-derived deterministically where possible or held behind an honest banner — "12 findings need
 re-checking, that text changed" — with a re-run scoped to only those. Nothing is silently shown as
 current when it is not.

 **AMENDED 2026-08-13 (R8.1).** Every word of the paragraph above was implemented
 except the last three sentences, and they are the ones that matter: staleness was
 computed correctly from the first day, returned as a COUNT, and read by no screen
 — so a question the writer had put off about a sentence they later rewrote came
 back quoting the new sentence with nothing saying the question was older than the
 words in it. The cause is worth recording, because it is not laziness: a count is
 not something an interface can act on. It cannot mark the card the writer is
 looking at, and it cannot scope a re-run.

 The report therefore NAMES things — which stops went stale, and which chapters
 they live in — and two surfaces read it: a banner on the first stop of a resumed
 walk, and a mark on each stale card saying the quote above is the new wording. The
 scoped re-run is a plain scan narrowed to those chapters, which is free like every
 scan; it says how many stale stops belong to no chapter and would therefore be
 left out, and a narrowed walk that runs dry offers the way back rather than
 claiming the pass is finished.

 Applied and dismissed never return. Deferred do — exactly the Mentor behaviour: skip it, and the next
 Weaving asks again until it is properly filled in.

 The panel

 Clone the shipped pattern: app/src/features/codex/codexScan.ts + WeavingPanel.tsx, from
 insertScan.ts (555 lines, 41 tests) and InsertWalkthrough.tsx (577 lines, 43 tests). Keep the
 whole contract — pure scanner, Stop/Option types, per-kind label/hint/mute maps (now sourced from
 LEXICON), axis-scoped dedupe, a left rail of muteable kinds with counts and purpose hints, Back,
 Ctrl+Enter gated off meaning-choices, an empty state that explains itself, and GuidedWalk for the
 tutorial.

 Adopt the Cast workbench ladder (CastPanel.tsx): manual / free / free-ai / auto, opening on
 free — "a panel that opens already pointed at a paid action presumes." The deterministic pass
 always runs first so the model is only asked what the prose did not answer. Cost is quoted before the
 button; nothing runs until Start.

 AI passes

 All follow backend/app/audiobook/speaker_analysis.py wholesale — JSON-only prompt with a
 QUOTE-EXACTLY rule, character-for-character text.find() verification, overlap-first-wins, confidence
 below 0.5 rather than a confident guess, a returned dropped count shown to the writer, unparseable
 output returning an empty pass rather than an error, and the endpoint writing nothing (pinned by a
 before/after snapshot test).

 ┌─────────────────────────────────────────────────┬──────────────────────────────────────────┐
 │                      Route                      │                   Role                   │
 ├─────────────────────────────────────────────────┼──────────────────────────────────────────┤
 │ POST /api/codex/scan                            │ none — free, deterministic, always first │
 ├─────────────────────────────────────────────────┼──────────────────────────────────────────┤
 │ POST /api/codex/propose-threads                 │ extraction                               │
 ├─────────────────────────────────────────────────┼──────────────────────────────────────────┤
 │ POST /api/codex/propose-facts                   │ character_reasoning                      │
 ├─────────────────────────────────────────────────┼──────────────────────────────────────────┤
 │ POST /api/codex/propose-ties                    │ character_reasoning                      │
 ├─────────────────────────────────────────────────┼──────────────────────────────────────────┤
 │ POST /api/codex/check-snags                     │ critique                                 │
 ├─────────────────────────────────────────────────┼──────────────────────────────────────────┤
 │ POST /api/codex/expand-unwoven                  │ brainstorm                               │
 ├─────────────────────────────────────────────────┼──────────────────────────────────────────┤
 │ GET /api/codex/run · POST /api/codex/run/resume │ the findings ledger                      │
 └─────────────────────────────────────────────────┴──────────────────────────────────────────┘

 Tests

 - codexScan.test.ts — every kind; applied proposals suppressed via destination state; deferred
 items return; "not a connection" never re-raises.
 - WeavingPanel.test.tsx — four-way triage; Apply writes to the Thread buffer, not disk; depth stages
 scope the walk; the full-weave warning states a real count; every stop carries a "Why am I seeing
 this?"; empty walk offers a way out.
 - test_codex_snags.py — all five detectors, especially knowledge violation; intentional
 silences permanently; Tangles group by shared cause.
 - test_codex_findings.py — a run resumes with no AI call; changed evidence marks stale, not current;
 applied and dismissed never return; deferred do.
 - worldRules.test.ts — every unlocks/crosslinks id resolves; no orphan nodes; no em dashes.
 - test_codex_context.py — budget fitting reports omissions; spoilers past the anchor never appear;
 ai_scope: never unreachable; a POV frame swap changes the brief.

 ---
 Verification

 Per release:

 cd backend;  uv run pytest --no-header -q;  uv run ruff check .
 cd ../app;   npm run test -- --run;  npx tsc --noEmit;  npm run lint

 Then /pre-release for a ✅ RELEASE READY verdict.

 End to end, by hand (npm run tauri dev from app/):

 - v1.1.1 — Assign three roles to three models across two providers. Run Smart Advisor, Draft mode
 and a chapter summary; each reports the model you assigned. Clear all roles; behaviour identical to
 v1.1.0. Point prose at a local Ollama model; Draft works with no key and no <think> leakage.
 - v1.1.2 — Migrate a real project; confirm the backup, that every profile survived, that arcs
 became facts. Record the father example: belief at ch3/s2, truth at ch1 revealed ch14. Open the
 map and drag the scrubber from ch1 to ch20 — Threads and Ties appear as the story introduces them;
 toggle spoilers and the ch14 truth disappears before its anchor. Rename a chapter, reorder acts;
 anchors hold. Insert a scene break mid-chapter; later scene IDs do not shift. Reindex from
 scratch; nothing lost. Export all formats plus JSON and CSV; Ties and Runs survive each.
 - v1.1.3 — Open ch.7, inspect the brief: Elara reads as grieving. Open ch.15: she knows. The ch.14
 reveal never appears in the ch.7 brief. Run a Full weave; the warning states a real count. Apply 15
 findings, close the app, reopen, resume — the rest are there with no AI call. Edit a chapter between
 sessions; affected findings flag stale rather than showing as current. Defer Mentor; re-run; it asks
 again. Fill it in; re-run; it does not. Plant a knowledge violation (a character referencing what
 they cannot know) and confirm the Snag detector catches it.

 Add shell-dependent flows to tests/manual-smoke.md as each release lands.

 Risks and standing notes

 - Migration rewrites the writer's files. Backup first, never auto-delete, keep profiles/ until
 confirmed. Highest-risk step in the program.
 - Scene identity is load-bearing. Scene-less anchors must be valid from day one so unreliable
 matching degrades instead of breaking.
 - The map is the biggest unknown by effort. Hand-rolled SVG with a deterministic layout is the
 right call for bundle size and the codebase's style, but if the layout fights back, ship
 Constellation + Neighborhood + scrubber first and defer force-directed refinement — the scrubber is
 the part that earns the feature.
 - save_settings() silently drops keys absent from DEFAULT_SETTINGS; every new setting touches
 three files.
 - Anything keyed to a chapter filename joins the rename cascade (documents.py:1178-1222) and the
 search exclusion list (search.py:31-38).
 - CLAUDE.md:338 is out of date about app.db contents; update when codex_store lands, along with
 versioning-convention.md for the tier rule.
 - Per repo policy: file regressions as GitHub issues, never silently fix, never auto-merge.