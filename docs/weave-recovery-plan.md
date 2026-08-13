# The Weave: recovery plan

**Status: PHASE 0 COMPLETE (2026-08-11, all decisions approved by the writer). Building Phase 1.**

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
- [x] **R0.8** Section B amendments -- **APPROVED 2026-08-11**, recorded in
      the spec's amendment block section A.
      - [x] four passes replace Full / Targeted / Quick
      - [x] world-rules corpus in Python
      - [x] anchors stored as text; ordinals computed, never stored
      - [x] eight role pickers, not nine (`fallback` excluded)
      - [x] `migrate/restore` + `migrate/compare` kept
      - [x] `ACTIVE_TYPES` agency gating kept
      - [x] five extra built-in types kept
      - [x] the "What got BETTER" improvements added to the spec as intended
            behaviour (closed world, continuous flow, required reason line,
            pair-as-axis, self-explanation rule)
- [x] **R0.9** Section C rulings -- **ALL TEN DECIDED 2026-08-11** ("all ten
      as recommended"), recorded in the spec's amendment block section B.
      - [x] 1 context inspect: **BOTH** -- small map above, list below
      - [x] 2 `weave_brief`: **KEEP THE FIELD**, amend the spec
      - [x] 3 **RESTORE** `GET /run` and `GET /resolve`
      - [x] 4 **KEEP TWO** registries, bound by a contract test
      - [x] 5 **COLLAPSE** into the registry
      - [x] 6 **CONVERGE ON ONE PARSER** -- the codex one
      - [x] 7 **CARRY OUT BOTH** deletion orders, sequenced
      - [x] 8 Unplaced + Loose thread: **BODY WINS** -- batch views
      - [x] 9 **SPLIT** -- build prose prefill, overrule "one field at a time"
      - [x] 10 **KEEP** `pinned` + `early_mention`, amend the table
- [x] **R0.10** Amended `docs/weave-spec.md` with a dated amendment block
      (sections A, B, C) recording every R0.8 and R0.9 decision. The amendment
      block states that where it and the body disagree, the amendment wins.
- [x] **R0.11** Three spec defects fixed: the byte-identical duplicate of the
      Verification section deleted; "Nine pickers" corrected to eight; the role
      feature table annotated as INTENT, with the untagged features scheduled
      rather than silently dropped.
- [x] **R0.12** Re-scoped. **v2.0.0:** phases 1-6, 8, 10. **Deferred to
      v2.1.0:** phase 7 (scene identity -- chapter anchors are genuinely
      useful and nobody has asked for finer) and phase 9 (the five AI passes --
      v2.0.0 ships a deterministic Weave and says so). Written into
      `docs/roadmap.md`, including the one carve-out to settle before release:
      knowledge violation, which the spec calls "the reason the frame system
      exists".

**Phase 0 exit criterion:** R0.8 through R0.12 complete. **MET 2026-08-11.**

---

## Phase 1 -- Undo the damage from this session (smallest, highest confidence)

Ordered first because it is small, mechanical, and restores spec fidelity
before anything is built on top of it. Each is gated on its R0.9 ruling.

- [x] **R1.1** `GET /resolve` restored, with the two route tests that were
      deleted alongside it and a refusal test. It is the only way to ask "who
      is she as of chapter seven" for a WRITER rather than for a model.
- [x] **R1.2** `GET /run` restored; `POST /run/resume` built; the start screen
      offers **Carry on where you left off** beside **Start fresh** and says
      what the difference is. A resumed walk says so on its first stop.
      *Why it hid:* applied and dismissed answers live in the BOOK and survive
      either way -- what only a SESSION holds is what was deferred and which
      kinds were muted, so a writer who closed the app mid-walk met every
      question they had already put off. Six frontend and six backend tests,
      including the fallback for a run list that names a session which is gone.
- [x] **R1.3** Both, per ruling 1. `BriefShape` draws the Threads the brief
      carries and the Ties BETWEEN them, above the list, deliberately
      non-interactive -- it answers "does this look like the right corner of my
      world?", and every action already has a home in the list below. It draws
      only what the brief carries: a line to a pruned Thread would read as
      "this is in the brief" about something that is not. A Thread attached to
      nothing else is drawn hollow and counted in words, because a brief of
      unconnected entries reads to a model as a list of facts rather than as a
      world. Seven tests, including that a graph response with no `edges` key
      cannot take the panel's controls down with the decoration.
- [x] **R1.4** `weave_brief` kept. Ruling 2 was keep-and-amend, so this is a
      SPEC change with no code: recorded in the amendment block with the
      reasoning (as chips, the automatic brief becomes indistinguishable from
      the writer's own attachments, inherits the Canon/Reference stance meant
      for their choices, pollutes established-chip dedup, and has nowhere to
      carry the "as of this point in the story" framing).
- [x] **R1.5a** The false comment at `profiles.py:125` is gone. It claimed
      hidden traits were "never sent to the AI API", which was untrue -- they
      were sent like any other, and only their prompt position differed. The
      Weave's conversion exists partly because of this, rewriting every hidden
      trait as `ai_scope: on-request`, which is what actually withholds it. A
      comment promising a writer their private notes are not transmitted is the
      worst kind of wrong.
- [ ] **R1.5b** Delete `merge_profile_with_arc`. **Still blocked after R2.1,
      and the reason changed.** The ruling sequenced it "when that route goes,
      alongside R2.1" -- but R2.1 kept `profiles/` as a live home for
      unconverted projects, so the route it belongs to is still doing real work
      for exactly the projects the ruling was protecting. Recorded rather than
      quietly skipped. It goes when `profiles/` stops being a home, which is a
      decision for the writer, not a side effect of a task.
- [x] **R1.6** Two registries kept and BOUND. `registries.test.ts` is the only
      file that knows about both: an Explain key naming a term must name one
      that exists, an explanation that IS a term's disclosure must use that
      term's own word, every stop kind must have a disclosure somewhere, and the
      two shapes must stay distinct (a term has an icon and a tone; an
      explanation has a necessity and a cost -- which is the argument for two
      registries in one assertion). It found three real drifts on its first run:
      the explanation of Weaving never said "Weaving", the Frayed fill never
      said "Frayed", and the Snag fixer never said "Snag".

---

## Phase 2 -- The premise (gap A1) -- BLOCKER

The spec's opening example -- the heroine who believes her father died until
chapter fifteen -- cannot be recorded through the interface, because the four
types it is about are edited in a screen with no fact UI.

- [x] **R2.1** The Profile Builder reads and writes wherever this project's
      entries actually live. It no longer knows which folder that is: it asks
      `GET /health`, which reports `entries_home` from ONE function
      (`entries_home` in `migrate.py`), and every `build_sections` call site asks
      the same function -- so the sidebar's count and the editor's list come from
      the same folder by construction. That disagreement was the writer's
      original report: thirteen Characters in the tree, twelve on the map, five
      openable.
      The rules, in order, each because getting it wrong hides part of the
      world: an interrupted conversion reads as `profiles/` (that is what a
      restore puts back); a converted project is `codex/`; an unconverted project
      whose `profiles/` holds work stays `profiles/` even if Weaving has made a
      few `codex/` entries, because hiding thirteen profiles behind three
      placeholders is the worse failure; anything else is `codex/`, so a new
      project -- or one where the writer went to the Weave first -- has its
      entries editable the moment they exist.
      Rule three leaves a real gap and it is stated out loud rather than papered
      over: `/health` also reports how many entries are in the OTHER folder, and
      the screen says "3 entries were made in the Weave and are not shown here",
      names why, and offers `profile.home` as an Explain. The reverse is
      deliberately silent -- conversion leaves `profiles/` in place on purpose,
      so counting it would raise an alarm about files that are meant to be there.
      Two implementations behind one interface (`app/src/screens/profileSource.ts`),
      because conversion is an offer rather than a toll gate and a writer who has
      never opened the Weave must find their profiles where they left them.
      *The thing that had to not go wrong:* a Thread holds connections, aliases,
      the story's own name for something, and the Run. This screen edits none of
      it, so the whole Thread is carried through a load and handed back on save.
      A save that sent only what the form knows would have deleted a character's
      connections the first time the writer fixed a typo, with nothing on screen
      saying so. That is the first test in `profileSource.test.ts`, and it was
      checked by reinstating the bug.
      Also: saves carry `base_revision` so a stale save is refused with the
      writer's text still in the buffer; deletes let the Weave forget the entry
      so a name still in the prose is asked about again; Import is hidden rather
      than offered-and-broken (R2.7); `updated_at` is stamped on save and both
      dates set on create, matching what `/api/profiles/save` has always done.
- [x] **R2.2a** The three copies of the section list are RECONCILED and
      BOUND. `backend/tests/test_profile_registry_agreement.py` reads
      `profile.ts` from Python (the trick `test_explain_costs.py` uses) and fails
      if the form, `profiles.py` and the registry disagree on any id, heading,
      trait-block flag or order; `app/src/types/sectionKeys.test.ts` fails if a
      key is not what its own heading derives to, if Quick Build appends into a
      section nothing renders, or if a section loses its help.
      It found three live bugs, all of them mine from earlier in this recovery,
      and one of them destructive: `profiles.py` still keyed the character page's
      Hidden and Foreshadowing section as `hidden_and_foreshadowing` while the
      form asked for `hidden_and_foreshadowing_traits`, so the section read as
      empty and **the next save wrote that emptiness over the writer's hidden
      traits**. Quick Build's Hidden row appended into a section nothing
      rendered, and that section's help had quietly stopped appearing. None of
      the three raises an error: an empty section looks like one you have not
      filled in yet.
      Also corrected here: the registry built headings with `.title()`, giving
      "Rule Or Concept" and "Tone And Atmosphere" where the Profile Builder
      writes "Rule or Concept" and "Tone and Atmosphere" -- the same section
      named two different ways depending on which screen created the entry.
- [x] **R2.2b** The form is built from the world. `SECTION_CONFIGS` and
      `PROFILE_TYPE_LABELS` are DELETED from `profile.ts`, and `ProfileType` is a
      string rather than a union of six -- the union was the reason the app could
      hold exactly six kinds of thing. Sections, labels and tabs come from the
      project's own `types.json` at runtime (`types/sectionRegistry.ts`).
      Two consumers stopped needing the table at all rather than being handed it:
      `formatProfileForAI` and the chip picker now ask the DATA whether a section
      holds traits, which is true for every kind -- before this, a Faction or a
      Deity serialised to the model as nothing, because the table only knew four
      kinds.
      Tabs follow the SIDEBAR's rule (`GET /sections`) rather than a second one,
      so a kind appears in both screens together and an unused one appears in
      neither. Listing every Profiles kind would have put ten tabs on a page
      whose main problem is already crowding.
      The hook deliberately has NO fallback table: a fetch that fails says so.
      A silent default would be the fourth copy of the list, and the copy nobody
      remembers to update.
      `sectionKeys.test.ts` is replaced by `sectionRegistry.test.ts` -- the old
      one watched a table that no longer exists -- and the Python agreement test
      lost its TypeScript half with an explanation, because a test that keeps
      passing after the thing it watched was deleted is worse than no test.
- [x] **R2.8** Editors for the six kinds with none, which fell out of R2.2b
      rather than being six jobs: Cultures, Creatures, Governments, Factions,
      Deities and Religions all declare their sections in the registry, so the
      form renders them with no per-kind code -- as does any kind a writer
      invents. Add one in the Weave sidebar and its tab is in the Profile
      Builder.
- [x] **R2.3a** `role` and `character_kind` are indexed. Migration 005 (its
      own migration, per the append-only rule), written on reindex, and returned
      by `/api/codex/list`. Both were in every Thread FILE from the start and in
      no index row, so a profile list would have drawn every character as an
      untitled main. Tested as an UPGRADE from v4, not a fresh install --
      including that an existing row survives it, since every row in a real
      project predates the columns.
- [x] **R2.3b** `POST /thread/new` accepts `role` and `character_kind`, so the
      create form's two questions survive the trip. Without them every character
      the Profile Builder made would have opened as an untitled Main. Only
      "side" is written to disk, which is what keeps a converted character's file
      byte-identical.
- [x] **R2.4** `POST /entity` records a save event. `/api/profiles/save` has
      always credited a save to Writing Progress and this route never did,
      because when it was written only the Weave's own inline forms edited
      Threads -- so the moment the Profile Builder points here, the writer's
      streak and word count would have stopped moving with no error anywhere.
      Best effort on purpose: losing an entry because a streak could not be
      updated would be the worse failure, and there is a test for exactly that.
- [x] **R2.5** **THE BLOCKER, CLEARED.** The spec's opening example can be
      recorded end to end by a writer, and `test_the_opening_example.py` does it
      through the HTTP surface -- a unit test of the resolver would have passed
      for the entire time the example was unrecordable.
      The Run editor was EXTRACTED from `ThreadEditor` rather than copied into
      the Profile Builder, so a fact recorded on either screen is the same fact.
      `revealed_at` gained the control it never had anywhere: "the reader learns
      this", separate from "from when", which is the pair that makes a reveal
      recordable and is what the story scrubber's spoiler mode moves through.
      On an unconverted project the editor says why it cannot help rather than
      taking a chapter and dropping it on save.
      *What writing the test taught, and it is worth keeping:* the example needs
      THREE facts, not two. A belief is only drawn on when resolving from that
      character's viewpoint (`frames_for` returns objective truth alone without a
      pov), which is correct -- her mistake is not a fact about the world, and a
      brief for a scene she is not in should not carry it. So her change of mind
      at chapter fifteen is its own fact on her own frame, and it supersedes the
      belief by position.
- [x] **R2.5c** "Whose truth" is a picker, not a text box. Found by writing the
      writer's own first-steps instructions: the control was a free-text field
      hinted "name a character", and a frame is stored as an ENTITY ID. So a
      writer types "Alexandra Langford", it saves, it looks correct on the page,
      and it never resolves as her belief because nothing matches that string to
      her entry. Silent, and the kind of wrong nobody would think to suspect.
      Now the same rule the chapter pickers follow: the writer chooses from their
      own entries and the app keeps the id. The entry being edited is offered
      first, since most beliefs on a character's page are that character's own,
      and a frame the world no longer recognises is kept and labelled rather than
      reset -- resetting it would turn a character's mistaken belief into a fact
      about the book.
- [x] **R2.5d** A fact collapses to one line, and one opens at a time. The
      writer's own words after recording three facts on Alexandra Langford:
      "seeing how the landscape is becoming very Bulky and busy on the Profiles
      page ... Truncate it into a Detailed line entry below ... Only allowing one
      of these to be expanded at any given time keeping the landscape clean and
      less busy." A fact now reads as when it starts, what is true (truncated on
      a word), whose it is, and when the reader learns it -- so six facts are six
      lines rather than a screen and a half of controls. A new fact opens itself,
      because collapsed it would say "(nothing written yet)" and the button would
      look like it had done nothing. `factSummary` is exported and tested on its
      own.
- [x] **R2.5e** Three corrections from the writer's second testing pass, and two
      of them were semantics rather than wording.
      **"True of the world" read as "everybody knows".** Their words: "True to
      the world means to me that the whole world knows that Alexandra believes
      her father to be dead. Logically that doesn't make sense because strangers
      don't know." Exactly right, and the label was doing the damage: the app
      does not model who knows what among characters at all. It models what is
      TRUE, and separately what one character has WRONG. So the question is now
      "Is this true, or does someone think it?", answered by "Actually true in
      your story" or "Only what X thinks (may be wrong)", with the rule stated
      where it is needed: being true is not the same as being known, so choose
      actually true even when nobody has been told, and name a character only
      when they are wrong. That also settles their Kipling case, where both
      options looked right -- she IS an orphan, so it is simply true.
      **Nothing could say "before the story".** A fact could take a chapter,
      which claims it happened as the book opened, or nothing, which is the
      Weave's word for "you have not told me yet" and gets asked about. Neither
      is true of an orphaning, a war or a scar -- so the commonest case had the
      worst answer. `BEFORE_STORY` is an anchor resolving to a position below
      every chapter, held in `anchors.py` beside `ALWAYS` so resolution, spoiler
      visibility, the snag checkers and the scan cannot disagree about where the
      book begins. The resolver's private copy of that constant is gone. It is
      deliberate, so never Unplaced; in force from page one, so never a spoiler
      by default; and it can still carry a reveal point, which is how something
      true all along is learned in chapter eight. Nine backend tests.
      **The Run is violet now**, matching the Weave everywhere else in the app
      and distinct from the profile sections' indigo, so the writer's eye lands
      on it. Their point about it needing to be "more upfront" as a feature is
      the wider Profile Builder restructure, still a discussion.
      *Deliberately NOT built:* story chronology. A flashback chapter sits at a
      reading position while depicting an earlier time, and anchors are reading
      order. Recorded rather than half-solved -- see the note below.
- [x] **R2.5b** A save that loses a race no longer loses the work. A full suite
      run failed once on `os.replace` with PermissionError (WinError 5) and
      passed twice in isolation -- which reads as a flaky test and is not one. On
      Windows a replace fails while the file is held for a moment by a virus
      scanner, the search indexer, a sync client or the writer's own editor. That
      is a writer pressing Save and getting a failure they cannot diagnose,
      rarely enough never to report and often enough to stop trusting the app.
      `replace_atomic` retries over about 150ms and then raises honestly, because
      a save that quietly did not happen is worse than one that says so. Applied
      to the Weave's own writes, which is where the fault was seen; the other
      stores are R10.6 rather than being swept up unexamined.
- [x] **R2.6** `_find_related_relationships` reads the folder this project
      actually uses -- the last hardcoded `profiles/` path in any AI route, and
      the one that could not announce itself. It returns a LIST, and an empty
      list is an ordinary result for a character with no relationships written
      yet, so on a converted project it would simply have stopped finding
      anything: no error, no warning, just a thinner Full AI Summary for a reason
      nothing on screen could explain. The folder comes from `entries_home` plus
      the type registry rather than being spelled a second time, so it follows a
      renamed Relationships section. Both headings it reads (`Overview`,
      `Current Dynamic`) are identical in a Thread file and a profile, which is
      why one reader serves both -- pinned by a test asserting the two produce
      the same text, so if that ever stops being true this fails instead of the
      writer noticing their summaries got worse. The behaviour shipped in
      Phase 6 with no tests at all; it has six now.
- [x] **R2.7** Import ported, and widened. The profile system could import
      CHARACTERS only; that was a limit of the profile system rather than of the
      idea, so `POST /api/codex/import` accepts any kind this world's registry
      knows and refuses one it does not BY NAME. Everything the writer wrote
      comes across -- name, sections, every trait with its weight and its
      secrecy, the words of every fact.
      Three things are deliberately left behind, and the screen SAYS SO rather
      than dropping them quietly: connections (a tie names an entity in the other
      book, so carried across it would draw a line to nothing), where facts
      happen (an anchor is a chapter of the other book, so kept it would leave
      the fact silently out of force forever -- cleared, it is Unplaced, which is
      a question with an answer), and whose belief a fact was. A clean entry
      produces no warnings at all, because a list of caveats on an import that
      lost nothing teaches the writer to skip reading them.
      One new refusal code, added deliberately rather than reusing a near-fit:
      `import_unreadable` is about a file the writer picked from outside the
      project, which is neither a missing entry nor a corrupt project file. The
      closed-set test caught the first attempt at reusing one.

- [x] **R2.9** Relationships stay, as the long-form page a Tie points at, and
      **the connections panel is on the profile page** -- which it was not.
      `ProfileConnections` was built and tested in an earlier commit and mounted
      NOWHERE. Every test in its file passed the whole time, because they render
      the component directly; the writer, who had asked for exactly this, could
      not find it on any screen and listed Connections in their restructure as
      something they expected to see. A component with no consumer is a component
      that does not exist. That is the SECOND time in this recovery -- the
      Weaving panel was rendered inside a branch of the view switch that never
      ran, and its tests passed too -- so the mount is pinned by a source read.
      The ruling itself needs no conversion code and never could: a relationship
      profile names its two parties in PROSE, never as ids, so nothing can
      reliably turn one into a Tie. The division of labour is the point. A Tie is
      the queryable spine plus one required reason line, cheap enough to put in
      front of a model. A Relationship entry is the history no brief could afford
      -- and it keeps its place as an ordinary kind, with the same editor every
      other kind now gets.
      *Left for later, deliberately:* linking a Tie to its long-form page. The
      only available signal is a name match in prose (which is what
      `_find_related_relationships` does), and a half-built link that guesses
      wrong is worse than a writer opening the page themselves.

### Hidden traits: two questions on one control (2026-08-12)

Came out of testing the Main/Side converter. The writer's worked example -- a
villain who avoids hospitals because his parents died in one, freezes at held
hands, and deflects the question -- is three traits that are all secret and all
at DIFFERENT weights (core, present, background). Today `hidden` is a rung on the
importance ladder, so all three collapse to one level and sort LOWEST in the
prompt: the trait that drives the most scenes arrives as the weakest signal on
the page.

The diagnosis: importance is being asked two unrelated questions. WEIGHT (how
much this shapes them) and DISCLOSURE (may it be said out loud) are orthogonal,
and the villain proves it -- his parents are core by weight and secret by
disclosure, and today he cannot be both.

Approved by the writer: importance drops to four levels, disclosure becomes its
own control, and "never send" is NOT built -- Author Notes is the place for
material that must not travel (see R5.5).

- [x] **R2.12a** The three prompts that lied about hidden traits are corrected.
      "Hidden is never sent to AI" has now been wrong in three places and each
      was found by reading rather than by using the app, because a false promise
      about privacy raises no error. Worst was the Importance Audit, which told
      the model to advise the writer to DEMOTE a hidden trait "that would improve
      AI accuracy" -- accuracy they already had, paid for with the secret. Also
      corrected: both analytical paths forbade naming a hidden trait even in
      FEEDBACK, which made a consistency check vague about the writer's own note.
      The rule protects the manuscript, not the writer: feedback may name it,
      suggested prose may not. `test_hidden_trait_promise.py` reads the real
      prompt text so the claim cannot return a fourth time -- verified by
      reinstating it.
- [x] **R2.12b** The axes are split in the data. `importance` keeps four levels
      and means weight; a per-trait `subtext` flag carries disclosure. Both file
      formats hold it, only when true (so a project with no secrets produces no
      diff), and it round-trips through both parsers. Legacy `importance: hidden`
      and the even older `influence: foreshadowing` read as weight `present` plus
      `subtext`, so nothing has to be rewritten to behave correctly.
      *Undoes a wrong fix of mine:* the migration set `ai_scope: on-request` on
      every hidden trait, which stops the AI naming the secret by stopping the AI
      KNOWING it -- on the villain, that is the entire character withheld.
      `ai_scope` means availability again; the never-name instruction is what
      protects a secret, and it has been in `prompts.py` all along.
      `parse_thread` gained `heal_legacy=False` for one caller: the
      before-and-after comparison, which needs the file AS WRITTEN or the one
      content change the conversion makes is invisible in the screen built to
      show it. Twelve tests in `test_trait_disclosure.py`, plus four rewritten
      tests that had described the old behaviour.
      The spec is amended in the same commit (section D).
- [x] **R2.12c** The control is its own button on the trait card, beside a
      dropdown that now offers four weights. `SecretsPanel` lists every secret on
      the page with the section it lives in and its weight, editable there --
      which is the grouping the writer asked for WITHOUT the move they suggested:
      a secret belongs beside what it explains, and relocated into a bucket it
      becomes a floating fact with nothing for the model to attach it to. The
      panel also says out loud that anything written before the split reads as
      Present, turning an invisible wrong default into a short, finite job.
      Two special cases disappeared with the fifth level: the word-count gauge
      had none for hidden (so the app refused to advise on the length of the
      writer's most careful material) and the trim tool had no range for it.
- [x] **R2.12d** Main/Side is lossless in both directions, and the warning
      shipped with R2.10b is gone because the loss is gone. A Side section shows
      its plain box and, only when it holds one, its secrets as traits: prose has
      nowhere to carry "never say this", so flattening a secret would strip the
      one thing stopping the model writing it out loud. Ordinary traits still
      dissolve into lines. A Side character can now keep a secret at all, which
      they could not before.
- [x] **R2.12e** `character.subtext` explains the setting, and
      `SubtextGuide` is the paged walkthrough the writer specified: eleven pages,
      one secret walked through three weights and three features.
      Severus Snape is the example, because the whole point needs a character
      whose surface and hidden layer are BOTH already known -- his reason is
      withheld for seven books while shaping every scene he is in. All example
      prose is written for the walkthrough; nothing is quoted, since the point is
      to show what THIS APP produces from a profile.
      Pages: the two questions · the example · Core / Present / Background each
      with the line the model receives and a worked passage · **the same secret at
      three weights on one identical scene**, which is the "end results of
      different path choices" · in a Draft · in an Enhance pass · in Smart
      Advisor's context check (including that feedback MAY name a secret while
      suggested prose may not) · what turning it off produces · and why a secret
      is not a timed reveal.
      Sixteen tests, navigating by page TITLE rather than click count, and one
      that sweeps every page for an em dash.
- [x] **R2.12f** The walkthrough is REACHABLE. Reported by the writer
      immediately: "its not in the usual spot within a Character profile next to
      Hidden and Foreshadowing ... Nothing." They were right. It was offered only
      from `SecretsPanel`, which returns null when a profile has no secrets, so a
      writer meeting the idea for the first time -- exactly who it is for -- had no
      way in. A guide nothing offers is documentation, not help.
      It now sits beside the **Hidden and Foreshadowing Traits** heading on both
      templates (the heading row is shared, so neither template is a special
      case), with the `What's this?` next to it, present whether or not anything is
      marked yet. A second `What's this?` appears on a trait card once its switch
      is on, which is the moment the question occurs. Pinned by a source read --
      the precedent Explain.test.tsx set -- and verified by reinstating the bug.
- [x] **R2.12g** The Weave's OWN brief marks a secret. `context.py` rendered a
      trait as a bare `- trait: description`, dropping both the weight and the
      SUBTEXT marker -- so a secret reaching a model through the automatic brief
      arrived as ordinary text with nothing for the never-name rule to key on,
      while the same trait sent as a CHIP was protected. A privacy promise that
      holds or fails depending on which path happened to be used is not a promise.
      Found by checking the walkthrough's claims against the code rather than
      affirming them when the writer asked "if that is so". Both serialisers now
      emit `[core, SUBTEXT]`, and a test reads `profileFormat.ts` from Python so
      the two cannot drift into marking it two different ways. The weight travels
      now too: every trait used to arrive flat, so a Core voice trait read no
      louder to the model than a Background one.

### Open question: story time versus reading order (raised 2026-08-12)

Anchors are READING ORDER -- chapter one is position one. A flashback chapter
sits at its reading position while depicting an earlier time, so a fact anchored
"from chapter eight" is in force during a chapter-ten flashback set years before
it. The writer raised this while asking for "before the story begins":

> "This could potentially be useful if the Writer makes a flashback scene that
> this information is still relevant or possibly NOT relevant because the
> flashback occurs BEFORE the event takes place."

`BEFORE_STORY` covers the common half (things already true when the book opens)
and does not touch the rest. Modelling story time properly means a second axis on
every anchor and a way to say what a chapter depicts, which is a spec-level
decision rather than a control. Recorded here rather than half-built.

**Raised by the writer's live testing of R2.1 (2026-08-12), grouped with R2.5 on
their instruction ("This can be grouped up with R2.5").** The good news from that
test: the missing characters now appear and a save on a connected character kept
its connections. The bad news was a consequence of the good news -- with the
Weave-made characters finally visible, they were all in the wrong group.

- [x] **R2.10a** Quick Create asks whether a character is Main or Side, and
      **starts on Side**. Every character Weaving made arrived as a Main because
      the create route could not carry a template at all (fixed in R2.3b), so a
      book's walk-ons all landed in the Main group. Side is the default because
      of what that button IS: a name the prose mentions once is far more often a
      shopkeeper than a viewpoint character, and the two mistakes do not cost the
      same -- a Side page promoted later loses nothing, while a Main page for a
      walk-on is six empty trait sections asking to be filled in.
- [x] **R2.10b** A character can be moved between the two pages, either way,
      from the Profile Builder header. In memory, marked unsaved, committed by
      the writer -- manual save is the product rule and a conversion is not an
      exception, which also makes it free to try and abandon.
      *Side to Main moves nothing:* both pages keep their words in the same place
      in the file, so the trait lists simply start empty. This exposed a latent
      bug worth its own note: a Main page rendered ONLY the trait list, so prose
      in a trait section (from a hand-edit, from Quick Build, or from this
      conversion) sat on disk invisibly. It is now shown whenever there is any,
      labelled as notes rather than traits.
      *Main to Side dissolves each trait into a line* ("scarred hands -- From the
      fire.") appended under whatever prose was already there. The one thing that
      is genuinely not one-to-one is reported BEFORE the writer commits: a
      `hidden` trait carries `ai_scope: on-request`, which is the mechanism that
      actually withholds it from a prompt, so as a plain line it becomes ordinary
      text. Those lines start with "Hidden:" and the dialog states the count.
      Sixteen tests, including a round trip asserting no word is lost in either
      direction.
- [x] **R2.11** Every row in the Weave sidebar has the three-dot menu, and what
      it offers is decided by the BACKEND. Reported as cosmetic -- the counts
      beside Characters and Lore sat flush against the edge while Factions and
      Deities sat a menu-width in -- and it was really the recovery's recurring
      bug: the frontend kept its own list of "fixed" sections, a rule written
      down twice in the place least able to enforce it. A row with no menu had
      nothing holding the space one occupies, hence the misalignment.
      Each section now reports `rename` and `removal`, and the writer's own
      instinct about the risk turned out to be already implemented: `rename_type`
      has always kept a shipped kind's id and folder and changed only its label,
      so Characters can be called anything without stranding the code that names
      it. What was NOT safe is a built-in note -- `notes/outline.md` carries the
      book's word target in its frontmatter and is read by that path -- so
      renaming one is now refused with that reason rather than merely left out of
      the menu, while removing it still works and puts the words in
      `notes/trash/`. A shipped kind is hidden rather than deleted, and the
      dialog says that hiding an occupied section will not take it off the
      sidebar, because a button that appears to do nothing is worse than one that
      explains itself.

---

## Phase 2b -- The Profile Builder restructure (2026-08-12)

The writer, after live-testing the Run editor: "the profile builder is already
getting extremely crowded with information and details. The Writer's eye needs to
naturally gravitate towards the main/primary features we need them to focus on
... Tree Trunk > Main branches > Branches > Leaves ... This idea and revamped
approach is to give the Writer less instant Chaos."

Their order, with two changes argued rather than assumed: Overview sits SECOND
because it is the shortest thing on the page and the one that stops an entry
counting as Frayed, and the Run sits above Connections because Weaving builds
connections FOR the writer while the Run is the only part no other screen can
produce.

- [x] **R2.13a** Tags retired. Verified before removing: nothing read them except
      one side-character prompt -- absent from the chip serialiser and from the
      Weave's brief, so they reached no AI path at all -- and the Story Role
      picker auto-filled them with words the app then ignored, which is worse
      than useless because the writer could not tell the field was inert. The
      control is gone, the FIELD stays so nothing typed before is deleted, and
      the picker now fills the Role and nothing else.
- [x] **R2.13b** Sex and age, characters only, up with the name. Sex is
      [M] [F] [Custom] with a box greyed out until Custom is chosen, exactly as
      asked. Age is FREE TEXT and that is the point: "18 months", "18", "18ish",
      "approx 30", "Unknown" and blank are all real answers, and a number field
      would refuse five of the six. Both formats hold them, written only when
      the writer has said something.
- [x] **R2.13c** The page order: Basics, Overview, the Run, Connections, then the
      trait tools and the traits, with the Full AI Summary last.
- [x] **R2.13d** Traits are collapsed tiles. A closed one is the name, the
      weight, a "never named" marker where it applies, and the description
      truncated on a word -- one line a writer can scan. Every trait used to
      render as a full card with two AI buttons and a gauge, so twenty traits was
      a wall the writer scrolled past looking for the one they wanted.
      MORE THAN ONE STAYS OPEN, unlike the Run's facts, and that is the writer's
      instruction: "I want the expands to remain open while Writer is working
      within that profile, allowing the scroll to do the heavy lifting." Comparing
      two traits while editing a third is ordinary work. Every profile opens with
      all of them closed, and a newly added trait opens itself, because collapsed
      it would be a blank line and the button would look like it did nothing.
- [x] **R2.13e** `profile.page` explains the screen from beside its title, and
      `ProfilePageGuide` is the seven-page walkthrough of the whole page in its
      order. Deliberately SHALLOW -- it says what each part is for and hands off
      to the per-section guides, because a first walkthrough that taught weights,
      secrecy, frames and reveal points would be the wall of information this
      restructure exists to remove. It ends by saying where to STOP: a name and
      one line is a real entry, and nothing here nags for the rest.
- [x] **R2.13g** Colour, and two things it made possible. Each section has its
      own stripe, assigned by POSITION rather than by name so it works for the six
      kinds that had no editor last week and for anything a writer invents. Every
      trait wears its section's colour as its border, which answers "which section
      am I in" halfway down a long page for the cost of nothing.
      **Hidden and Foreshadowing gets its own ground**, not just its own stripe:
      violet, the Weave's colour elsewhere in the app, over a darker panel.
      Asked for as "shadowy while still eye catching and functional ... stand out
      as different while keeping with the theme", and it reads as a room with the
      lights lower rather than as a warning -- which is right, since there is
      nothing wrong with a secret.
      **AI summaries open closed**, one line each saying whether they are written
      or empty, several expandable at once. They are a restatement of the section
      directly above them, so open by default they were the same words twice on a
      page whose problem is length. Keying the section wrappers by PROFILE was the
      part that mattered: without the filename in the key React reuses the
      components, so every summary opened on the last character would still be
      open on the next one.
      **Relationships Overview is retired** -- its job is done twice over, by
      Connections and by Relationship entries. RETIRED, NOT DELETED: both parsers
      work from the section list, so removing the entry outright would have
      dropped the writer's paragraph from the file on the next save. It stays in
      the list, it round trips, and the form hides it unless it already holds
      something -- so it disappears for good once the words have been moved
      somewhere better, and never before.
- [x] **R2.13f** Three corrections from the writer on seeing it: Overview moved
      BELOW Connections (their reasoning, better than mine -- who somebody IS
      reads better once you know who they are TO people; my argument for second
      place was about the app's bookkeeping rather than about reading the page),
      the Run given the same gap under it that every other block has (it and
      Connections were sitting on top of each other and read as one thing), and
      Connections defaulted to chips rather than expanded.

---

## Phase 3 -- Migration completeness (gap A4) -- BLOCKER

Spec 503 step 4 was skipped. After migration the writer's world vanishes from
three surfaces at once.

- [x] **R3.1** The chip picker reads the same folder the editor does, by REUSING
      `profileSource` rather than fetching `/api/profiles` itself. That is the
      point of that layer: two screens cannot disagree about where a writer's
      entries live if only one of them decides. Before this, attaching a
      character on a converted project sent the model their pre-conversion text,
      or nothing at all once the writer had tidied `profiles/` away -- and an
      empty picker looks exactly like a project with no characters in it.
      Series profiles stay on the old path deliberately: a series folder is not a
      project and has never been converted, so asking it where its entries live
      would be asking a question it cannot answer.
- [x] **R3.2** Global Search walks `codex/`. It covered manuscript, notes,
      profiles, summaries and arcs -- everything except the folder a converted
      project keeps its whole world in. Searching for a character returned their
      OLD text or nothing, and "no results" is indistinguishable from "you have
      not written that yet". Both folders are listed rather than one swapped for
      the other, so an unconverted project is untouched and a converted one still
      finds the backup if the writer keeps it.
- [x] **R3.3** Exports read the live folder -- and this uncovered a bug older
      than the Weave. **The profiles appendix has never worked.** It read
      `profiles/<TYPE>` ("profiles/character") while the folders are PLURAL
      ("profiles/characters"), so ticking "include profiles" produced an export
      with no profiles in it and said nothing about it. Two bugs in one line: the
      folder name, and reading `profiles/` at all after conversion. Both go away
      by asking `entries_home` and taking folder names from the registry, which
      also means all fourteen kinds are exported instead of four. The snapshot
      copies the live folder under its own name.
- [x] **R3.4** `test_after_conversion.py` converts a real project and asks all
      three surfaces the same question: can you still find Elara Voss? End to end
      on purpose -- unit tests of each surface passed throughout the period the
      bug existed, because each was correct about the folder it was told to read.
      It also pins the other direction: an unconverted project sees no change,
      and search still covers the manuscript. Verified by reverting each fix and
      watching its own test fail.

---

## Phase 4 -- Export and portability (gap A3) -- BLOCKER

- [x] **R4.1** `include_weave` on both. It is a DIFFERENT thing from
      `include_profiles`, and the distinction is the point: profiles exports what
      the writer WROTE, the prose of each entry, which already travelled by
      copying the folder. The Weave flag exports what the Weave ADDS -- who is
      connected to whom and why, and what is true at which point in the book --
      which lived only in YAML frontmatter and in an index the docs call a
      rebuildable cache. On a manuscript export it is a readable appendix; in a
      snapshot it is all three shapes in a `weave/` folder.
- [x] **R4.2** `POST /export/weave` writes a dated bundle. Three shapes, three
      promises: **Markdown** for a person (chapter names, and every connection
      carrying the reason the writer gave it), **JSON** for a program (ids
      intact, so somebody building on this is not screen-scraping), and **CSV**
      as three tables, because a nested CSV is not a CSV and a spreadsheet is
      where a great many novelists keep their lists. Read from the FILES rather
      than the index, so an export cannot be wrong in a way a reindex would
      quietly fix. It reports what it wrote as counts a writer can check.
- [x] **R4.3** Every anchor travels as an id AND a label, in all three shapes.
      Its own task for a reason: drop the id and a program cannot follow a
      renamed chapter; drop the label and a person cannot read the file. Which
      half goes decides who the export is useless to. An anchor whose chapter has
      been deleted gets an empty label rather than an invented one.
- [x] **R4.4** The export screen has a Weave checkbox beside Profiles, and a
      separate **Export the Weave** button with its own `What's this?`. Its own
      button rather than a third checkbox because it answers a different
      question: not "what goes in my manuscript" but "how do I get my world OUT
      of this app". A writer reaching for that is backing up, leaving, or handing
      the world to somebody else, and none of those want a novel wrapped round
      it -- so it takes no chapter selection and no format picker.
- [x] **R4.5** `test_codex_export.py`, the file the spec names and which did not
      exist. Twenty-five tests: the three shapes, both halves of every anchor,
      the flag on both other exports, and the awkward cases -- an empty world
      exports honestly, an unplaced fact says so rather than printing a blank,
      and a deleted chapter leaves the label empty.

---

## Phase 5 -- Sources (gap A7)

- [x] **R5.1** The scan reads notes, outline, style guide and themes as
      SOURCES, not only as corroboration.
- [x] **R5.2** Stops say where a name came from ("named in your Outline" reads
      differently from "named in chapter 4").
- [x] **R5.3** Wire `parse_markup` so `@name` / `[[name]]` outside the
      manuscript does something.
- [x] **R5.4** Decide and implement whether planning-document names are a
      softer stop that never counts toward contradiction checks.
- [x] **R5.5** **Author Notes becomes an enforced exclusion, not a convention.**
      The writer's reasoning for dropping a per-trait "never send" was that
      Author Notes is the room private material lives in -- and nothing in the
      code says so. `scan.py` globs `notes/*.md` indiscriminately, which is
      harmless today (the scan is local and deterministic) and stops being
      harmless the moment R5.1 reads notes as SOURCES or a Phase 9 AI pass reads
      "the available documents". A named constant, every AI-facing corpus builder
      skipping it, and a test -- otherwise this is the "hidden is never sent"
      falsehood again, one level up.
      *Second, live:* the profile's own **Notes** section IS sent by profile chat
      and generate-full-summary (`LEGACY_INCLUDE` has `details: true`) while the
      chip picker defaults to NOT sending it (`DEFAULT_CHIP_INCLUDE` has
      `details: false`). Same field, two answers, nothing on screen saying which.
      Make them agree and say so on the field.

---

## Phase 6 -- Unwoven (gap A6)

- [x] **R6.0** **An answer records which question it answers.** Found while
      sizing R6.3, and it made R6.3 impossible rather than merely unwise:
      `lands_as` was read as proof a question was settled, and there are about
      fifty landing places for a hundred questions, so eleven land in a lore
      entry's `rule_or_concept`. One entry about blood price silenced marriage,
      inheritance, war rules and forms of address at once -- four domains, none
      of them answered by a word. Entries now carry `answers: [question_id]` in
      their own frontmatter; still derived, never a ledger. Where a question
      owns its landing place (eleven of the hundred), content alone still counts.
- [x] **R6.1** Fix the always-false depth comparison so branch and capillary
      questions are reachable.
- [x] **R6.2** Decide pacing -- one answer can open eleven questions.
- [x] **R6.3** Grow the corpus toward "~10 per domain" (currently ~18%).
- [x] **R6.4** The domain board (a card per domain with open counts) replacing
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

- [x] **R8.1** Surface stale findings (gap A8) -- the banner and a scoped
      re-run. The cause is worth keeping: `refresh` returned a COUNT, and a count
      is not something an interface can act on -- it cannot mark the card the
      writer is looking at and it cannot scope a re-run, so the correct
      computation went unrendered for the whole build. The report NAMES things
      now (which stops, which chapters), a banner reads it on the first stop of a
      resumed walk, and each stale card says the quote above is the new wording.
      The narrowed walk says what it leaves out and offers the way back.
- [x] **R8.2** Call `group_tangles` so Tangle has a producer. A group of one
      stays a Snag; Unplaced is never swept in; the members are worked through
      inside the one stop, and "all of these are deliberate" is the button that
      makes the grouping pay. The map cluster the spec describes is NOT built and
      is recorded as such.
- [x] **R8.3** Mute per target, not globally. The button asks how widely and
      writes nothing until told; the narrow choice is offered only where there is
      an entry to narrow to.
- [x] **R8.4** Reveal-order break and timeline-impossibility detectors --
      deliberately NARROWER than the spec's wording, which says "prose
      references a fact". Matching a sentence to a fact is a reading, not
      arithmetic, and it is check 3's job in the AI pass. What ships is the
      writer's own two anchors disagreeing: a fact told before it becomes true, a
      correction that reaches the reader before the thing it corrects, and a
      connection that ends at or before it starts. Spec amended. The fixer gained
      the reveal-point control it had nowhere, or the walk would have reported
      problems it gave the writer no way to fix.
- [x] **R8.5** **DROPPED, and the reason is not effort.** `codex_mention` could
      not have been kept fresh by the index's own mechanism: mentions derive
      from the MANUSCRIPT and `ensure_fresh` fingerprints `codex/`, so every
      chapter the writer edited would leave the rows silently wrong while the
      gate reported the index current. Nothing asks for it either -- counts come
      from `scan._mention_counts` and co-presence from `together.py`, both while
      the manuscript is already in memory. Migration 006 drops it; 002 still
      creates it, because editing an applied migration is the bug 004 remembers.
- [x] **R8.6** **DELETED, on the writer's ruling.** The level was deader than the
      gaps note said: `_resolve_model_and_key` never reads project.json at all --
      it synthesises `{"default_model": override}` from one frontend field -- so
      a per-book assignment could not have arrived however faithfully
      `projects.py` stored one. Building it meant ~10 request models, every
      frontend caller and a per-book screen, and a half-threaded version is worse
      than none: a writer whose choice reaches Draft but not Enhance has an app
      they cannot explain. The faking test now pins the opposite -- a stray
      `model_roles` in a project dict is IGNORED rather than half-honoured. The
      per-book DEFAULT MODEL is untouched; it is level 2 and it works.
- [x] **R8.6b** (new, from R8.11) **The map draws a coming connection again.**
      "Dashed when not yet true" was in the spec and the route's own docstring
      and could not fire: `record_visibility` hid a future Tie before the
      `not_yet` branch ran, so `active: false` only ever meant expired. Fixed
      with `show_future` on the Lens, set by the MAP alone -- the resolver and
      the brief go on treating a future fact as not in force. Two bounds kept:
      the spoiler rule still runs (an unforeshadowed future connection is
      withheld; a foreshadowed one is drawn), and an unintroduced endpoint still
      hides the whole edge.
- [x] **R8.7** Surface the prompt-caching caveat in the Model Roles UI. It is a
      claim about MONEY, so it is bound by a contract test in the
      `test_explain_costs.py` mould: Python reads `providerMeta.ts` and fails the
      build if the screen's caching claim disagrees with `providers.py`, in
      either direction.
- [x] **R8.8** `GuidedWalk` moved to `components/learn/`, `WalkDemo` generalised
      to an audio-or-shown union, and used on a Weave surface: `RunWalk` teaches
      the THREE facts the programme's own opening example needs. One fact reading
      "believes her father died" is the obvious thing to type and produces a
      world where nobody, including her, ever learns otherwise -- and nothing can
      detect it, because that world is perfectly consistent.
- [x] **R8.9** The Fact layer, the fourth of four. Deliberately READ-ONLY: the
      Run editor already edits the three switches on two screens through one
      component, and a second place to change them would give one idea two
      vocabularies. What it adds is the EFFECT -- where the fact is in force,
      what replaced it, and what a model actually receives -- which is spread
      across the resolver, the visibility rules and the brief, and which no
      screen had ever gathered.
- [x] **R8.10** Tie relations covered by the vocabulary contract test, and it
      found something: 23 of ~70 directional relations had no inverse, so from
      the far end they read "loves (the other way round)" on a page the writer
      did not make the choice on. All 23 now have one.
- [x] **R8.11** `test_codex_graph.py` -- 14 tests including the one nothing
      asserted. **It also found a live bug, reported rather than fixed:** the
      route's docstring says a Tie true LATER comes back `active: false` so the
      map can draw it dashed, and `record_visibility` hides a future Tie before
      that branch is reached. Same class as R6.1 -- a documented capability whose
      condition can never be true. Fixing it changes what the map SHOWS, which is
      the writer's call.

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
- [ ] **R10.6** Route the remaining atomic writes through `replace_atomic`:
      `settings_store`, `structure_store` and the audiobook JSON store. R2.5b
      fixed the Weave's own writes, where the Windows lock failure was actually
      observed; these are the same one-line change in code this recovery does not
      own, so they are recorded rather than swept up unexamined. The failure mode
      is identical -- a save that fails at random with no cause a writer could
      diagnose.

---

## Phase 11 -- the rulings that never became tasks

Approved 2026-08-11 in `weave-spec-gaps.md` section C, and then not given ids,
so the progress table below silently excluded them. Found by the 2026-08-14
audit. The mechanism is the one this whole programme is about: a decision
recorded somewhere that nothing was comparing the build against.

- [x] **R11.1** (ruling 8) Unplaced and Loose thread as a tick-list. `Sweep.tsx`,
      offered from the walk rather than replacing it.
- [x] **R11.2** (ruling 5) `SECTION_CONFIGS` / `PROFILE_FOLDERS` derived from the
      registry rather than written out again. One definition, nothing to drift.
- [x] **R11.3** (ruling 6, the half that is not blocked) the legacy `influence`
      scale ported into `codex/normalize.py` and read by both dialects. Deleting
      the second parser stays blocked on `profiles/` ceasing to be a home --
      the same decision as R1.5b.
- [ ] **R11.4** (ruling 9, second half) Frayed's QuickFill filling "from what the
      prose already says". Deferred to v2.1.0 with Phase 9: it needs the AI pass.

---

## Progress

| Phase | Tasks | Done |
|---|---|---|
| 0 Stop and record | 12 | **12** |
| 1 Undo session damage | 7 | 6 |
| 2 The premise | 25 | 25 |
| 2b Profile Builder | 7 | 7 |
| 3 Migration completeness | 4 | 4 |
| 4 Export | 5 | 5 |
| 5 Sources | 5 | **5** |
| 6 Unwoven | 5 | **5** |
| 7 Scene identity | 4 | 0 |
| 8 Walk honesty | 12 | **12** |
| 9 AI passes | 8 | 0 |
| 10 Release | 6 | 0 |
| 11 Late rulings | 4 | **3** |
| **Total** | **104** | **84** |
