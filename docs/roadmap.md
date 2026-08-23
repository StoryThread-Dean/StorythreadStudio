# Roadmap

This is a living document. Items move between buckets as priorities change. Anything that ships drops off this list and lives in [`features.md`](features.md). Anything intentionally not built lives in [`product-scope.md`](product-scope.md) under "Out of scope."

For shipped releases see [`../CHANGELOG.md`](../CHANGELOG.md).

---

## Scheduled

Committed work for the near-term roadmap.

### The facelift and the Outline rebuild -- the v2.0.2 release

Two pieces of work shipped together, on the writer's ruling that the tier
rule could bend once: "we just had two MAJOR updates in 3 releases".

**The facelift.** The app had no design system. Colour was 2,431 raw Tailwind
palette classes on top of ten semantic tokens, and only two of the fourteen
colour families were adjusted for light mode -- so most of light mode was
dark-mode shades on cream. `app/src/App.css` now holds `--st-*` role tokens
for both themes, a generated bridge that re-aims Tailwind's own palette at
them, and a real `.audiobook-theme` scope that keeps the Audiobook Converter's
charcoal world out of it. Two bugs fell out of the audit: the Interface size
setting was ignored by roughly half the app's text, and line spacing had never
reached the page at all.

**The Outline** stopped being a form. See `docs/outline-spec.md` for the whole
design; the short version is that it is a second main editor with a drawer of
nineteen opt-in sections, and the five whole-document templates are gone.
Every existing outline is converted on first open, subtractively, with a
backup and a post-condition that aborts rather than write a shorter file.

Still open at the time of writing: the shared UI primitives, converting the
remaining raw palette call sites onto role tokens, the icon set, and deleting
the bridge once nothing needs it.
### The Weave -- the v2.0.0 feature

One linked, time-aware world model, replacing the four hardcoded profile folders.
What is built so far is described in [`features.md`](features.md) and
[`architecture.md`](architecture.md).

Tier 1, judged by the three clauses: a new major surface (the map), changed AI
context behaviour across every existing feature, and a one-time migration of
source-of-truth files. The Audiobook Converter is the calibration point -- a
comparable size, shipped as tier 2 -- but it ADDED a workspace without touching
existing data or existing behaviour, and that difference in kind is what makes
this one tier 1.

Delivery is one long-lived branch with three milestones, merged to `main` as a
single release. Nothing ships piecemeal, because a writer who migrates halfway
through cannot easily go back.

| Milestone | Contents | State |
|---|---|---|
| M1 | Data layer, `types.json`, anchors, the graph index, migration | built |
| M2 | The Weave map, the anchor scrubber, the list view | built |
| M3 | Weaving: the deterministic scan, the findings ledger, context assembly, the walkthrough, Unwoven | built |

**Still open in M3:** the AI passes (Untied proposals, semantic Snags, expanding
an Unwoven answer).

The assembled brief is now wired into the **Writing Companion**: a world
context bar under the attachments, with inspection, per-Thread removal,
per-category exclusion and an off switch, all remembered per book. The amended
context rule is exercised in the running app for that one surface. Extending it
to the Smart Advisor and the other AI tools is the follow-on -- each needs its
own inspect control before it may receive context automatically, because the
rule is about what the writer can SEE, not about where the plumbing reaches.

#### Scope after the 2026-08-11 spec audit

A three-pass audit of all 806 lines of `docs/weave-spec.md` against the build
found the programme substantially off its own specification -- because the spec
had never been in the repository, so nothing was ever compared to it. Findings:
`docs/weave-spec-gaps.md`. Repair plan, 107 tasks: `docs/weave-recovery-plan.md`.

**In v2.0.0** (recovery-plan phases 1-6, 8, 10): undo the contradictions
introduced while the spec was unreferenced; give characters, relationships,
locations and lore a Run editor so the programme's own opening example can
actually be recorded; finish the migration (chips, exports, search); Weave
export and the portability bundle; read notes and the outline as sources, not
only as corroboration; make Unwoven's branch questions reachable; surface stale
findings; release hygiene.

**Deferred to v2.1.0:**

- **Scene identity.** `manuscript/scenes.json` is read and never written, so
  every anchor is chapter-level. Chapter granularity is genuinely useful and no
  writer has asked for finer, so minting scene ids, LCS re-matching on save and
  tombstoning move out. Recovery-plan phase 7.
- **The five AI passes** -- `propose-threads`, `propose-facts`, `propose-ties`,
  `check-snags`, `expand-unwoven`. None exist; the deterministic half that the
  spec says should run first is what shipped, and it works. v2.0.0 ships a
  deterministic Weave and SAYS SO plainly rather than implying otherwise.
  Recovery-plan phase 9.
  - **One carve-out to decide before release:** knowledge violation (a
    character acting on what they cannot yet know) was deferred into
    `check-snags`, and the spec calls it "the reason the frame system exists".
    Shipping frames without it is defensible only if the product does not claim
    the check exists.

Two more, surfaced by the 2026-08-11 head-to-tail sweep and stated in
`features.md` as not-yet-behaviour so the docs stay honest:

- **Chapter-scoped Weave the Chapters.** The pass reads the whole book; the
  design ("run it from chapter eight and the app already knows when, so `at`
  is recorded for free") needs the panel to send `chapter_ids`, which the
  backend already accepts and honours.
- **Unwoven branch questions.** The world-rules corpus declares follow-ups at
  depths 2-3 ("what stops every heir being murdered in childhood?"), and a
  depth check pins every scan to depth 1, so no branch has ever been asked.
  Needs a decision on pacing (a branch per answer risks eleven questions per
  sitting) before the check is lifted.

The migration UI is now built: the Weave screen runs the dry run on open,
itemises it folder by folder, names the backup destination before the button,
and requires a second click that repeats the count and the destination. An
interrupted run offers resume or restore rather than guessing.

#### Pinning a connection by hand -- BUILT

Weaving will miss things, so the writer needs a way to say "this matters"
about a word the scan never raised. Requested from live testing, with the
right instinct already in it: *"just tagging it for potential connection
might be enough for the walkthrough to then safely pick it up from there."*

That instinct is the design. **The action marks, it does not connect.**

| Problem with connecting directly | Why marking avoids it |
|---|---|
| The writer picks the wrong relation or direction | Nothing is recorded except "look at this", so there is nothing to get wrong |
| There is nothing to connect it to yet | A mark can wait indefinitely; a half-made Tie cannot |
| It needs the Tie editor, which does not exist | A mark needs no editor at all |

Shape: select a word or phrase (`Kithicor`, `Kithicor Forest`), right-click,
and under a **Weaving** group choose **Mark for Weaving**. The existing
context-menu items (thesaurus and the rest) stay exactly where they are. The
same action works in the manuscript, notes, and entry fields, because the
writer should not have to remember which surface they are on.

Two rules it must keep:

- **Nothing is written into the manuscript.** No `[[markup]]` in prose -- that
  is a locked product rule. The mark is stored out of band in
  `.storythread/weave/answers.json` beside `retired`, as a PHRASE rather than
  an offset, so it survives the text moving. It is writer input, not derivable
  from the book, which is exactly what that file is for.
- **It becomes a stop, not an entry.** The scan emits it like any other stop,
  so it inherits everything already built: the evidence quote, "why am I
  seeing this?", the four ways to answer, and the fact that marking something
  that later gets an entry stops being raised on its own.

Writer-facing name: **Pinned**, with a pin icon. Pinning fabric before you
stitch it is the same idea in the same vocabulary -- it holds a piece in place
until the real join is made.

One thing that fell out of building it: a pin is the only stop kind that is
raised until the writer ANSWERS it rather than until a condition ends. Every
other stop exists because something in the book is true; this one exists
because the writer pointed at something. No rule can know when a hand-made
mark is dealt with, so dropping it on a rule would lose the one thing in the
scan that was never derivable.

#### The map -- open items from live testing

Right idea, wrong execution so far. Two are fixed; three are not.

**Fixed.** Dragging a Thread jumped away from the cursor and then trailed it,
which was two bugs: no grip offset was recorded on mouse-down (so the centre
snapped to the cursor), and the cursor was mapped across the whole element
while the drawing is letterboxed inside its own viewBox (a constant offset in
one direction, exactly as reported).

**Also fixed: a bare dot now means something, and a click binds it.** A dot
is drawn hollow and dashed when its entry has nothing in it, and filled with
its kind icon once it does -- so the legend below the map is now a promise the
map keeps. A single click on a bare dot asks what it is; a click that travels
more than a few pixels is a drag and opens nothing, which was the reported bug
(every attempt to reposition a dot also opened something).

**And the word merge is gone, deliberately.** The objection was right: a dot
for Alexandra Langford disappearing reads as her profile being deleted. What
actually happens is that a WORD moves -- Alexandra Langford, Alexandra,
Langford, Lexi, Lexa and Drea all become words she answers to, every mention
of any of them resolves to her from then on, and the placeholder that was
standing in for the word stops standing in for anything. The screen says it in
those terms. An entry with writing in it is REFUSED rather than absorbed.

The label is separate from the name: `display_name` is what the story calls a
thing, `name` is what it is. Alexandra Langford stays Alexandra Langford while
the map says Lexa.

#### Connection Types -- the next expansion, deliberately deferred

A connection is currently either plain ("connected to") or one of the named
relations in `types.json`. The next step, agreed in review, is a small set of
**types a writer picks from** once a connection exists:

> Family, Friends, Companion, Rival, Enemy, Acquaintance, plus **[Custom]**
> for the unique ones -- "Summoned by", "Mind connected to".

The order matters and is the whole reason it is deferred. Making a connection
comes first; saying what KIND of connection it is comes second. A writer knows
two things belong together long before they want to argue with themselves
about whether that is a friendship, a bond or ownership, and being made to
choose in that moment produces either a bad answer or no connection at all.

So the plain connection shipped first, and typing it is an improvement to
something that already exists rather than a toll gate in front of making it.

Also on this list when it is picked up: a **Connection Type Check**. Some type
and endpoint combinations will not make sense (a location cannot be somebody's
Rival), and the writer should be told rather than stopped -- the same
warn-do-not-refuse stance cardinality already takes.

#### A caution recorded from review, worth keeping

**Do not read a relation out of a proper noun.** "Companions of the Hall" is
the name the five main characters call themselves; it is not evidence that its
members are in a "companion of" relation. The Hand and the Foot in Ninja
Turtles are factions, not body parts. The name is what defines the grouping,
not the words inside it.

This was an assumption made and corrected during the Tie editor work, and it
generalises: the writer's manual grouping does the work, and the app takes
over from there.

**Also built: the scrubber as a timeline.** Act bands over the chapters they
contain, sized by how much book each act is; a stop on every chapter; and the
resting chapter's title opened out and word-wrapped while its neighbours
truncate. That expansion is the cause and effect -- the writer sees the handle
land ON a chapter rather than inferring it from a colour change elsewhere.

Act grouping comes from the same `structure.json` the sidebar reads. Two
sources of truth about the shape of a book would eventually disagree, and the
writer would have no way to tell which was lying.

The drawn track is decoration over a genuine `<input type="range">`, kept
deliberately: a custom widget would have to reimplement arrow keys, Home and
End, and the screen-reader role, and the List view being the accessibility
answer for the map would be undercut by a scrubber that could only be dragged.
It announces itself as "Chapter 3, Caught in the Rain" rather than as "3".

**Also built: Unspun asks once per thing, not once per name.** Names are
grouped before anything is asked, so "Lara Croft", "Lara" and "Croft" are one
question and creating the entry once settles all three.

Worth being precise about the cause, because it was not a wrong guess: the
app ASKED three times about one thing, and every answer was individually
reasonable. The fix is upstream of the answer.

Grouping is by word SUBSET rather than substring -- "Cambridge Library" is not
a run of characters inside "Cambridge Campus Library" and is obviously the
same place. And a name that fits into TWO groups is left standalone: "John" is
inside both "John Vale" and "John Thorne", who are two different men, and a
wrong grouping is invisible once accepted.

Two things fell out of building it. The frequency floor now applies to the
GROUP, since "Lara Croft" once plus "Lara" twice is one thing mentioned three
times. And a soft line wrap no longer counts as forcing a capital -- only a
paragraph break does -- because writers hard-wrap prose and a name was
invisible whenever the line happened to break in front of it.

**Not built yet:**

**Also built: the Tie editor.** The reported case can now be recorded in full
-- the Daughters of Pathicus worship the deity Pathicus, are part of the Faith
of Pathicus, and the Faith worships him too. Reached from a focused entry on
the map.

Two things had to change for that to be possible. The shipped connection
vocabulary covered characters and factions and almost nothing else, so a
faction could not worship a deity at all -- seven relations were added for the
kinds that had none. And a writer can now NAME a connection themselves, because
a tool for writing invented worlds cannot ship the complete list of ways things
in them relate. The checker reads relations from `types.json`, so a named one
works everywhere with no further change.

Design notes worth keeping:

- **The other end first, then how.** A writer thinks "the Daughters and
  Pathicus" before they think "worships", and the list of relations depends on
  the pair anyway.
- **Only what means something between those two kinds**, read from the
  registry, so the list is short and every item in it is true.
- **"Nothing fits" is never a dead end.** It has three answers, all offered:
  turn the pair around, adopt a shipped relation this world lacks (types.json
  is the writer's file and is never modified behind their back), or name it.
- **Read from the end you are standing at.** An incoming "part of" shows as
  "contains", so the writer never translates a direction in their head.
- **Cardinality warns, it does not refuse.** Two simultaneous seats of power is
  usually a mistake and sometimes a disputed throne. The app records what was
  asked for and says what it noticed.

**The Thread editor is built.** Every shipped kind the Profile Builder does not
cover -- factions, religions, governments, deities, creatures, cultures,
objects, concepts, events, languages -- now has somewhere to be written, and
Weaving routes to it instead of apologising. Sections come from `types.json`,
so nothing about the shape of an entry is hardcoded. Manual save throughout:
unsaved work looks unsaved, leaving is confirmed, and a save that would
overwrite a newer file is refused with the writer's text still in the buffer.

It also edits the Run, which is what Weaving's Unplaced stops send writers
there to do -- "when" is a list of the writer's own chapters, and "not placed
yet" is selectable so the state Weaving is complaining about is visible.

**CORRECTED 2026-08-14.** This said a kind the writer invented "has no sections
of its own ... so an editor would open on nothing to type in", and called that an
honest dead end. It is no longer true: `add_type` seeds `overview`, `details` and
`notes` (`backend/app/codex/types_registry.py`), and a custom kind fills in like
any other -- pinned by a test in `WeavingPanel.test.tsx`. Verified by making one.

What IS still missing is letting the writer CHOOSE a custom kind's sections. They
get the three above and cannot add a fourth or rename them from the UI, which is a
smaller and different gap from the one this paragraph described.

Also open before release: the manual-smoke additions for each milestone.

### Who is IN this chapter -- declared presence -- SHIPPED in v2.0.1

**SHIPPED. Corrected 2026-08-23**, where this section still read "raised by the
writer, not scoped yet" for a release after it went out. `appears_in` is
authored rather than derived, written by one route
(`backend/app/routers/codex.py:1983-1991`), carried through the Thread
(`codex/threads.py:289,618-620`) and read by both the scan (`scan.py:1050`) and
the brief (`context.py:356`); the screen is `features/codex/AppearsIn.tsx`. A
shipped feature listed as unscoped is the same drift as an unbuilt one listed as
done -- it invites a second implementation of a thing that already works.

The record below is kept as written, because the reasoning is the useful part.

**The ask, in their words:** "I want to make sure to include is where Profiles
can be TAGGED within the story in Scenes and Chapters. Example: Serena the main
protagonist of the story is in every Chapter. Newton is in Chapter 1,2,7,8,9 ...
Lou is only in Chapter 2."

**And the reason, which is the part that decides the design:** "An epic
adventure story may have 30-60 character profiles with dozens of creatures,
20-40 locations. Having to check and uncheck what the writer wants to attach as
context can be tedious. We have the early ideas of auto attaching context
through the [Inspect]=On buttons, I just want to make sure there is another
method to do this manually in case the writer wants to have more control."

**The larger frame they set, worth keeping because it is the product thesis:**
the Weave, Weaving and the Profile Extractor are meant to be entered from any
direction and to loop -- write, weave, generate, write again; or outline, weave,
fill in by hand, draft with the lore constraining it, weave again. "There are
countless variations of this process that should naturally become circular in
its design."

#### What exists today, exactly

`context.assemble` ranks every visible Thread and trims to the token budget:

    pinned  >  mentioned in the text being written  >  one Tie from those  >  rest

`mentioned` is computed PER REQUEST from `body.text` -- the words on the writer's
screen right now -- by `find_mentions`, and an ambiguous name is deliberately
never bound. Visibility and anchors then filter by where in the story they are.

So the app already knows who the CURRENT PARAGRAPH names. What it has no concept
of is who is IN chapter seven.

#### The trap, which is why this needs a decision rather than a patch

The obvious implementation is to derive presence by scanning the manuscript and
cache it. **That is exactly what R8.5 deleted `codex_mention` for.** Mentions
derive from the MANUSCRIPT while the index fingerprints `codex/`, so every
chapter the writer edited would leave the rows silently wrong while the
freshness gate reported the index current -- a cache that answers confidently
and wrongly with nothing in a position to notice.

Deriving it again, by any mechanism, reintroduces that.

#### The shape that fits

**Presence is AUTHORED, not derived.** The same thing an anchor already is: a
fact the writer states, living in their Markdown, travelling with the file, with
no cache to go stale and nothing to rebuild. `appears_in: [chapter ids]` on the
entry, exactly as `at:` works on a fact.

That also answers the request as asked -- they wanted "another method to do this
manually ... in case the writer wants to have more control", and authored data
IS the manual method.

The free scan can then OFFER what it sees ("your prose puts Serena in chapters 1
to 9 -- record that?") without ever being the source of truth. A suggestion the
writer accepts becomes their statement; an unaccepted one is not stored, so
nothing can drift.

#### RULED 2026-08-15

1. **It FILTERS, and says what it left out.** Only entries tagged into this
   chapter reach the brief, plus anything pinned or named in the text being
   written -- both of which already outrank everything and must keep doing so.
   The inspect panel states how many were held back, which is the rule this app
   applies everywhere else: anything omitted is counted out loud, because a
   silently shorter list is indistinguishable from a smaller world.

   The two overrides are not exceptions to the filter, they are the reason it is
   safe. A writer who pins a Thread has said "this one, now", and a name in the
   prose is the strongest signal there is -- neither can be filtered out by a
   tag the writer set last week.

2. **The free scan offers, the writer confirms, one entry at a time.** It
   already reads every chapter for Weaving, so the suggestion costs nothing and
   calls no model. Only what is ACCEPTED is stored -- an unaccepted suggestion
   is not data, so there is nothing to go stale, and the authored-not-derived
   line holds.

   Bulk accept-all was considered and rejected: accepting sixty unseen
   suggestions is deriving them with an extra click, and it would put the app
   back where R8.5 found it.

3. **Chapters now, scenes when Phase 7 lands.** Chapter ids are stable today.
   Scene-level presence needs stable scene identity, which is deferred to
   v2.1.0, and blocking this behind it would leave the 60-character context
   problem unsolved in the meantime. The field is a list of anchors, so scenes
   extend it later rather than replacing it.

#### Not scoped to a release yet

This is the writer's next feature by intent but has no version. It is
independent of the v2.0.1 Extractor work and does not block the release.

### Profile Extractor -- BUILT, in v2.0.1

**BUILT 2026-08-14.** All ten decisions below are implemented and the section is
kept as the record of WHY each one is what it is. Where the build differs from a
decision, the decision wins and the difference is noted inline; nothing here was
quietly dropped.

Shipped as: `app/codex/extract.py` (the prompt, the request, the parsing),
`app/codex/extraction_store.py` (the one saved run), `app/routers/extractor.py`
(the HTTP surface, and the only path that writes to a profile),
`features/codex/ExtractorSetup.tsx` / `ExtractorReview.tsx` / `ExtractorScreen.tsx`
/ `ExtractorGuide.tsx`. Pinned by `test_codex_extract.py` (38),
`test_extractor_routes.py` (23) and `Extractor.test.tsx` (29).

**SCHEDULED 2026-08-14, on the writer's ruling, which overrules an earlier
recommendation of mine.** I had put this in v2.1.0 with the deferred AI passes on
the grounds that it is an AI pass and the largest single item on this page. The
writer disagreed and the disagreement is the correct one:

> "I disagree that this should be build out separately from v2.0.0's initial The
> Weave release. This is really part in parsol to the original purpose and
> envisioning of the The Weave. This is really at best, v2.0.1 Addendum add on. I
> want this built out immediately with The Weave release."

So: **v2.0.0 ships the Weave as it stands; v2.0.1 adds the Profile Extractor,
straight after.** It is not held behind the rest of Phase 9. The other four AI
passes (propose-ties, propose-facts, propose-threads, check-snags) and the
knowledge-violation check stay in v2.1.0 -- this pulls ONE pass forward, not the
phase.

**WHERE IT LIVES:** `The Weave > Weaving | Profile Extractor`. A sibling of
Weaving in the Weave's own navigation, not a mode inside the walkthrough.

**AND WEAVING COMES FIRST, deliberately.** The writer's words: "Not part of the
Weaving as that process needs to be done separately and on its own first prior to
running this AI powered feature." That is not just sequencing advice, it is what
makes the feature work: the request carries a snippet of every established entry
(decision 3), so the entries have to exist before there is anything to build on.
Run it on an empty world and it proposes a world from scratch with nothing to
match against -- which is the expensive way to get the noisiest possible result.

The screen therefore has to SAY so, in its own words rather than in a doc: what
the feature is, when it is the right thing to reach for, a "What's this?", and a
"Show me how this works" with worked pages. Same obligation every other surface
in this app carries, and here it is load-bearing -- a writer who runs this first
will conclude the feature is bad when they have simply run it too early.

**IT ALSO INHERITS A JOB WEAVING CANNOT DO, decided 2026-08-14 from live
testing.** The writer walked chapters 1 to 5 of a real book, then found chapters 6
and 7 raised nothing. Five people are in one scene there and Weaving could see
none of them:

> "All three are not specifically named but described as 'the hulking figure',
> 'massive man', 'injured man'. Another character is 'the tall man' ... The third
> man is the Body builder man, 'The big linebacker-shaped silhouette' ... The
> descriptive elements to them ARE the characters."

This is a real and ordinary way to write. A shadowy figure doing business under a
description is a character with a role, a presence and, in that scene, a reveal --
the hulking figure turns out to be the super-villain Altas, and the tall man is
never named at all yet is plainly the most dangerous person in the room.

**Weaving will never find these, and should not try.** It works by finding
capitalised names, so "the tall man" is three ordinary words to it. Any rule that
tried to promote noun phrases into characters would have to decide that "the tall
man" is a person while "the long hallway" is not, from the same evidence, on every
noun phrase in a novel. That is a reading, not arithmetic -- the same line R8.4
drew when it refused to guess that "she thought of her father, alive somewhere
north" is `father.fate: alive`. The writer reached the same conclusion unprompted
("This might not be anything the app can detect by itself as its following the
rules that it enforces") and named the fallback, which is this feature.

So the Extractor proposes **described-but-unnamed characters** alongside named
ones, with three rules that follow from what it is:

1. **The description is the working name.** An entry called "The tall man", with
   the description as its evidence. Not a guess at a real name, and never a name
   invented to fill the field.
2. **It offers to fold one into an existing entry when the prose reveals them.**
   "The hulking figure ... revealed to be Altas" is one character with two labels
   across a book, which is what `display_name` and aliases already exist for. The
   offer is the writer's to accept; the app does not merge on a hunch.
3. **An unrevealed one stays unrevealed.** The tall man has no name in the book
   yet, so the entry has no name either, and that is a finished state rather than
   an incomplete one. A writer who has not decided must not be nagged into
   deciding by an app.
4. **It also picks up the NAMED characters Weaving structurally cannot see.**
   Found while investigating the above: a name that only ever appears where a
   capital was required anyway -- at the start of a sentence, or just inside an
   opening quote -- is invisible to the scan, however often it occurs. `"Duncan,"
   he said` is the most ordinary way a name reaches a reader. **Ruled 2026-08-14:
   the scan is left as it is and this feature covers it**, because the safe-looking
   fix was measured and is not safe (Look, Right, Yes, Sorry, Wait and Meanwhile
   all pass a "never written in lowercase" test), and because a model reading the
   prose gets these right for free while it is already reading for point 1.
   Pinned by five tests in `test_codex_mentions.py`; Weaving now says on screen
   that this is something it cannot see.

**And the A-then-B shape is the writer's, recorded because it is the design:**
"That is the two A then B takes of which the Weaving does the first pass at
creating the initial characters first through the walkthrough, then B is the
Profile Generator which picks up the details and attaches them in segments to
which a character/faction/creature/government/lore can be built." Weaving builds
the framework from what is mechanically knowable; the Extractor reads the prose
and fills it. Neither does the other's job, and this is the clearest statement of
why there are two of them.



The writer's own proposal, recorded here the day it was made so it cannot become
another decision nothing was comparing the build against. **Not scoped to a
release yet.** It belongs with the Weave's AI passes (recovery plan Phase 9),
which are deferred to v2.1.0, and it is the largest single thing on this page.

**The idea.** One interface that reads the manuscript (in parts or whole) with the
list of ALREADY KNOWN entries attached, and comes back with proposed content for
each: Overview, physical / personality / motivation / voice traits, Notes. It
proposes for entries the writer already has AND names the ones it found that they
do not. Per kind: Characters, Locations, Creatures, Lore, Factions, and ruling
bodies (the writer's note: "Governments ... is more ruling entities than truly
restricted to the term government").

**The review surface**, from the writer's sketch. A left rail of kinds and the
entries under each, ticked as they are dealt with. The body is two columns, the AI
proposal beside the CURRENT profile, so nothing is judged in the abstract:

```
| Profile Extractions        "What's this?"  "Show me how to use this" (1/N)
| v Characters   | - Rosie
|  - Serena  [x] |  AI proposal            | Current profile        | Actions
|  - Newton  [x] |  Overview: ...          | Overview: original ... | [Overwrite] [Merge] [Remove]
|  - Rosie       |  Physical trait 1 ...                            | [Add to profile] [Remove]
|  - Lou         |  Personality trait 1 ...                         | [Add to profile] [Remove]
|  - Steel Beam  |  Notes: ...             | Notes: original ...    | [Overwrite] [Merge] [Remove]
| > Lore         |
| > Creatures    | Additional profiles found, not in Profiles yet
| > Factions     |  > Huffington City   [Add to Locations]  [Remove]
| > Government   |  > Mayor Bloomfield  [Add to Character]  [Remove]
|                |  v The Null
|                |    Name: The Null [x]   Aliases: Nullem [x]
|                |    Overview ... [x]   Physical trait 1 [ ]   Motivation 1 [x]
|                |                          [Add to Character] [Remove]
```

**THE PURPOSE, in the writer's own words, and it reframes every decision below:**

> "The true purpose of this is NOT the true accuracy that AI is literally going to
> build the profile for the writer. Instead, this feature is to give something to
> the writer for which he will edit / fine-tune / build from and hone so that the
> actual envision of that character is more accurately represented for future AI
> requests and Smart Advisor and Draft building processes. Simplify the Profile
> building process as this can be EXTREMELY time consuming, just as long, if not
> longer than it takes for other writers to write the entire book itself."

That is a starting point, not an answer. It means speed and editability outrank
precision, and it means the review surface is the feature -- the pass is only the
raw material for it.

**THE THREE FORKS, ANSWERED 2026-08-14.**

1. **Unit of a request: WHOLE MANUSCRIPT is the recommended path.** Per chapter is
   for addenda, fixes and additions afterwards, and it BUNCHES the ticked chapters
   into one request rather than one request per chapter. The writer's example:
   a whole-manuscript pass covered chapters 1-8 of an intended 15; later they want
   9-11 only, excluding the main characters already established, and expecting
   4 new side characters, 2 new locations, 1 new main villain finally introduced,
   and 1 character who appeared briefly in chapter 2 and has now returned.

2. **Merge means APPEND, for prose.** If the existing Overview has two paragraphs
   and the proposal has one, Merge leaves the writer's two and adds the third.
   Nothing of theirs is rewritten or reordered. (Overwrite and Add remain the
   other two answers; Merge is the one that must never lose their words.)

3. **Matching: the request CARRIES a snippet of each established entry.** A brief
   extract of what is already recorded -- the top details of `rosie.md`, a short
   current description -- goes up with the manuscript, so the pass has something to
   attach to and builds on it rather than starting over. `build_alias_map` and the
   ambiguity rule from `mentions.py` remain the binding rule: an ambiguous match
   never silently binds.

**FOUR MORE DECISIONS, 2026-08-14.**

4. **No evidence carried.** Proposals do not cite chapters or quote source
   sentences. It is a draft the writer is going to rewrite, so verification
   machinery would be effort spent on text that is about to be replaced.

   TWO CONSEQUENCES, and they must be built in rather than remembered:

   - The WRITE BOUNDARY becomes the only safeguard, not one of several. With no
     evidence to check against, nothing may reach a profile without a per-item
     click. No "apply all", no default-ticked rows -- the same rule `Sweep.tsx`
     follows, and here it is the whole of the protection.
   - The screen must SAY it is unchecked. `speaker_analysis` earns trust by
     showing a dropped count; this pass has nothing to drop, so the honesty
     obligation moves to the wording: this was derived from the manuscript, it
     has not been verified against anything, and it is a starting point. That is
     an `Explain` entry, not a footnote.

5. **Registry-driven: every kind.** Whatever `types.json` holds, including
   Religions, Deities, Cultures, Objects, Events, Languages and anything the
   writer invents this afternoon. Costs nothing extra -- the pass reads each
   kind's sections from the registry exactly as every other screen does, which is
   what R11.2 collapsing the section tables was for.

6. **A trait can be ADDED or MERGED INTO ONE THE WRITER PICKS.** Both, per the
   sketch's prose. The case it exists for: the profile already says "Fiercely
   loyal" and the pass proposes "Loyal to a fault". Add makes two traits; Merge
   folds the second into a chosen existing one. The picker is required -- merging
   into a guessed trait is how a writer's own wording gets overwritten.

7. **Exclusions are TICKED, with a smart default.** Before anything is spent, a
   list of established entries with the fully-written ones pre-ticked as "leave
   alone", and every tick reversible. Automatic skipping was rejected for a
   specific reason from the writer's own example: it cannot know that a character
   who appeared briefly in chapter 2 has returned for the rest of the book, so it
   would skip exactly the entry they wanted revisited.

**ASSUMED UNLESS CORRECTED** (recorded so a wrong assumption is visible rather
than buried in code):

- (Proposals persisting was listed here as an assumption and is now DECISION 8,
  stated by the writer. The reasoning still holds and is worth keeping: a
  whole-manuscript pass costs real money, and this repo's rule is that what the
  writer paid for is never re-bought -- `findings.py` keeps answers in a file
  rather than in the rebuildable cache for exactly that reason.)
- **Merge appends at the end.** The writer's paragraphs stay in their order and the
  new one follows. Nothing of theirs is reordered.
- **Content mode routes as it already does.** A manuscript is the writer's own
  prose; an explicit book needs a model that permits it, and
  `_validate_model_content_mode` already decides that. This pass does not get its
  own rule.
- **`long_context` finally has a consumer.** The role has been reserved since Model
  Roles shipped with the note that it "arrives with the Weave's AI passes"; this is
  that. Its `reserved` flag and note change on the day this ships, and
  `test_role_call_sites.py` will fail the build if they do not.

**THREE MORE DECISIONS, 2026-08-14.**

8. **ONE RUN, SAVED LOCALLY, REVIEWABLE ACROSS SESSIONS.** The writer's words:
   "that process is saved locally for processing to which the writer can do all in
   one go, or if its extremely large, might take multiple sessions. The data
   remains until a brand new process request is made, to which the previous one is
   overwritten as the new one supersedes it."

   So: a whole-manuscript pass on a long novel is not a sitting, it is a job. The
   returned proposals persist under `.storythread/` and the writer works through
   them over as many sessions as it takes. There is exactly one current extraction
   at a time and no history -- a new run replaces it entirely.

   (RECORDED WRONG FIRST TIME, and corrected here rather than quietly. I read
   "stale like the Weave" as the Weave's staleness DETECTION -- hashing evidence to
   flag a proposal whose source text moved -- and wrote a per-chapter-hash mechanism
   for it. That was not what was asked. It is also unbuildable alongside decision 4:
   with no evidence carried there is nothing to hash. The real answer is simpler and
   needs none of that machinery.)

   TWO OBLIGATIONS FOLLOW, and the first is not optional:

   - **A new run must not silently discard unreviewed proposals.** Overwriting is
     the writer's stated intent, but those proposals were paid for in tokens, and
     this repo's rule is that what the writer paid for is never re-bought. So a run
     started while the previous one still holds unreviewed items says how many will
     be lost, and asks. Same shape as the close guard (R11.5) and for the same
     reason: the destructive act is fine, doing it without saying so is not.
   - **The manuscript may change under a long review, and nothing will flag it.**
     That is the direct consequence of one-run-until-superseded, and it is the
     writer's choice rather than an oversight -- so the screen should say when the
     run was made, and leave re-running to them. Recorded here so a future session
     does not "fix" it by adding staleness detection nobody asked for.

9. **A new entry arrives BASE-LEVEL, not fully built.** `[Add to Character]`
   creates what Quick Entry creates -- a name, a kind, one starter line -- and the
   proposed traits are then added one at a time, each by its own click. Slower than
   writing the whole proposal in at once, and right for two reasons: it is what the
   Weave does everywhere else, and with no evidence carried (decision 4) a
   one-click full profile would be the largest unreviewed write in the app.

   **Characters arrive as SIDE.** The same default and the same reasoning as
   R2.10a: a name the prose mentions is far more often a shopkeeper than a
   viewpoint character, and the two mistakes do not cost the same -- a Side page
   promoted later loses nothing, while a Main page for a walk-on is six empty trait
   sections asking to be filled in. Promotion already exists, is lossless, and is
   the writer's to make from the Profile Builder header (R2.10b).

10. **Its own screen.** Not a mode inside the Weaving popup. This is a long review
    session with a left rail and two columns, which is a different shape from a
    walkthrough stop, and the popup is already carrying eight sub-views.

    WHICH MEANS THE CLOSED-WORLD RULE DOES NOT APPLY TO IT, and that is worth
    stating so nobody later "fixes" it by moving it inside. That rule is about the
    WALKTHROUGH: a writer answering a stop must not be sent away mid-question,
    because the walk gives up its place. A review screen has no place to give up --
    the writer arrives at it deliberately, works through a list, and leaves when
    they choose. `WeaveScreen` is the nearest precedent (persistent chrome, a body
    that swaps between map and list) and the likeliest home.

    This decision is entangled with the static-shell question, so the two should be
    settled in the same design session rather than one constraining the other by
    accident.

**What it must inherit, not reinvent.** Every one of these already exists and is
tested; the pass is new, the plumbing is not:

- From the `speaker_analysis.py` contract (Phase 9's R9.7): JSON only, and the
  endpoint WRITES NOTHING. The quote-exactly and dropped-count halves do NOT
  apply here and it was an error to list them -- an Overview is synthesis and has
  no single source sentence, so that rule would discard almost every proposal.
  See decision 4 for what replaces it.
- The write boundary. AI output may not land in human-authored fields without the
  writer applying it, per action, which is what every button in the sketch is.
- `Sweep.tsx`'s restraint: nothing pre-ticked, a count that matches what it
  writes, partial progress kept on failure.
- `WordFix`'s answers: a proposed entry that is really another name for one the
  writer has needs `POST /alias`, not a second profile.
- Money said before it is spent (`Explain`'s cost field, `test_explain_costs.py`),
  and the Cast ladder's manual / free / free-AI / auto tiers (R9.8).

**Why it is worth the size.** It inverts the Weave's current direction. Weaving
asks the writer to describe a world it found the NAMES of; this reads what they
have already written and proposes the CONTENT, which is the work a writer would
otherwise do by re-reading their own book. It is also the strongest answer to the
reported frustration that the walkthrough's suggested Overview text "was nearly
always wrong": a whole-manuscript read has context a single-quote heuristic
cannot.

#### Live feedback from the first real review session (2026-08-14)

The first working run, on *Becoming a Hero*. The pass itself landed well --
"most of these trait entries were one to two liners that I could fold into
existing traits. This is excellent." Four things came out of actually using it,
and the last is a design problem rather than a bug.

**1. A trait title is not enough to fold by.** Serena had four physical, four
personality and five motivation traits (Survival, Proving Herself, Emulating
Resilience, Seeking Identity, Seeking Purpose). Choosing which to fold a
proposal into meant guessing from the label alone:

> "the titles alone were not enough to determine what was in each of those
> traits ... I need the ability to see what is actually written and determine
> which to fold into."

So the fold-into picker carries the trait's TEXT, not only its name, and the
"what you have now" column shows each existing trait's description under its
label. BUILT.

**2. The current profile went stale mid-review.** Add a proposal as its own
trait, then meet a second proposal that belongs with the one just added -- and
it was not in the fold-into list, because the column was fetched once when the
entry opened:

> "The WHAT YOU HAVE NOW list should be refreshed to list the latest entry."

A plain bug, and a nasty one: it made the correct action unavailable at exactly
the moment the writer wanted it, so the only way to fold was to reload the
screen. BUILT.

**3. "Add to character" is the wrong words.** It CREATES the entry:

> "which btw doesn't make sense because we are technically Creating the
> character, not adding TO the character"

BUILT: it reads "Create this character" / "Create this location", and the button
that attaches to something existing is separate and says so.

**4. THE ONE THAT NEEDS DESIGN: a described character may already exist.**

The Man in the Alley is the hulking man from chapter 5 scene 3, who is later
revealed to be Altas. Creating a second entry for him is wrong. But the writer
named a second case in the same breath, and it is the one that makes this
subtle:

> "We also want to be careful about TAGGING a character literally playing
> someone else, Example: Tom the Barkeep in chapter 2 was really Donald Morgan
> the arch wizard in disguise. But Tom the Barkeep is an established character
> with a profile."

Those are NOT the same relationship, and an app that treated them the same would
destroy work:

  - **Another name for the same entry.** "The Man in the Alley" is a phrase the
    prose uses for Altas. There is one person and one entry; the phrase becomes
    an ALIAS, and the proposal's content belongs on Altas. `POST /alias` already
    does exactly this and is already the answer WordFix reaches for.

  - **A separate identity worn by someone else.** Tom the Barkeep is a person in
    the story with his own profile, his own scenes and his own connections. That
    he is Donald Morgan in disguise is a FACT ABOUT THE WORLD, not a spelling.
    Folding Tom into Donald would delete a character the writer wrote, and no
    undo would bring back the connections that went with him.

So the screen must ask which, and never guess. The second case is a CONNECTION
between two entries (the Weave already models this, with a reason line), plus
optionally a fact anchored to where the disguise holds -- which is exactly what
the Run editor exists for.

**RULED 2026-08-15: the disguise case deep-links into the Tie editor** with
both ends pre-filled, rather than telling the writer to go and record it
themselves. It is the Weave's OWN editor opened from here, not a second way of
making a connection -- the relation and the required reason line stay exactly
where they were, and only the two facts this screen was just told are filled in.

Two consequences worth keeping:

- **The described character is CREATED first**, base-level, because a tie needs
  two entries and "The Man in the Alley" has none. That is not a back door
  around how new entries arrive; it is that rule applied on the way to what the
  writer asked for. Still a Side character, still empty.
- **The closed-world rule does not forbid this.** It governs the WALKTHROUGH,
  where leaving a stop gives up your place. This is a review screen (decision
  10), and a writer who says "these are two people" has asked for the connection
  editor -- refusing to open it would be the rule cited against its own purpose.

**The rule that falls out of it, worth stating on its own:** an alias is about
WORDS, a tie is about THINGS. Two names for one person is an alias. Two people
who are the same person is a story fact, and both of them keep their entries.

### The Guided Tour -- a layered walkthrough of the whole application

**NOT STARTED. Requested by the writer 2026-08-16.** Tier 2 by the versioning
rule: a whole new surface that does not disturb existing data or behaviour.

#### The problem

The app now has the Weave, Weaving, the Profile Extractor, the Profile Builder,
Smart Advisor, the Writing Companion with three modes, series and arcs, exports,
Model Roles across three providers, and an audiobook converter with its own
dashboard. Every one of those explains itself once you are looking at it. None
of them tells a writer who just installed the app **which of them to open
first**, or that most of them are optional.

That is a different question from the two kinds of help already built, and it
needs a third kind:

| Existing | Answers | Triggered by |
|---|---|---|
| `<Explain of="..." />` | "what is this thing I am looking at?" | the writer asking |
| `GuidedWalk` | "how do I do this task?" | the writer asking, inside one feature |
| **The Guided Tour** | **"what is all this, and in what order?"** | **offered on first run** |

The first two are useless to someone who does not yet know what to ask. A new
writer's screen is almost entirely empty state, which is exactly the condition
under which this app has already shipped one invisible guide (see R2.12f in
`CLAUDE.md`: a walkthrough hung off a panel that hides itself when there is
nothing to list).

#### The shape

**An overlay over the real application, not a slideshow.** The writer sees the
actual screen, with the actual buttons in their actual positions, dimmed except
for what the current step is talking about. Screenshots go stale; a rebuilt
mock of the UI is a second implementation of the UI. Neither is acceptable here.

**It reveals a few things at a time.** The first step is a nearly bare
interface: where a project comes from, where chapters live, where you type. As
the process of writing a book becomes clearer, more of the interface is
un-dimmed and explained. A writer meets the Weave when they have chapters for it
to compare against, not on the screen where they name their project.

**Two depths per step.** A large, brief description of what the highlighted
thing is -- one or two sentences, in the writer's terms -- and an expandable
**[> Know more]** that goes into why it exists, when it is worth using, and what
it costs. The short form is the tour; the long form is there for the writer who
stops on a step because it matters to them.

**Exitable at any point, and resumable.** A named exit that says what it does,
per the continuous-flow rule. The writer's position is remembered, so leaving to
try something is not a punishment. It never blocks the app.

#### The running order

The order IS the content. This is the app's opinion about how a book gets
written, and each step says whether the feature is required, recommended, or
optional -- and most of them are optional, which is the thing a new writer most
needs to hear.

1. **A project is a folder.** Creating one, what lands in it, the fact that it is
   plain Markdown and yours. Where chapters live and how one is opened.
2. **Writing.** The editor, manual save and what the unsaved marker means, one
   chapter at a time and why. The Passage Check, because it is free, offline, and
   useful on day one.
3. **Notes and the outline.** Optional, and the first place the tour should say
   so plainly.
4. **Getting AI working at all.** Settings, the three providers, that a local
   model needs no key and no account, and the Default Model. Nothing above this
   step needs it.
5. **The Writing Companion.** Chat first, then Draft, then Enhance. Context chips
   -- attaching something by hand, which is the mental model everything later
   builds on.
6. **Smart Advisor.** The three passes, what an inline highlight is, and that
   accepting a suggestion is always the writer's click.
7. **Profiles.** What a trait block is, importance versus subtext, the two
   character templates, and why a background character should not cost a full
   page.
8. **The Weave.** The step that most needs the "why" before the "how": a profile
   is one unchanging paragraph, and a story is not. Threads, facts anchored in
   time, connections that state a reason, traits true for only part of the book.
9. **Weaving.** The free scan first -- it costs nothing and produces a real
   count -- then what each stop kind is asking and the four ways to answer.
10. **The Profile Extractor.** What it proposes, why it carries no evidence, and
    why there is no accept-all. Requires Weaving to have run first, and the tour
    should say so rather than let the writer find the refusal.
11. **World context.** The bar, Inspect, dropping a Thread, and which surfaces
    the brief reaches. This is where a writer learns they can stop pasting.
12. **Summaries, exports and series.** Optional, grouped, brief.
13. **The Audiobook Converter.** Its own dashboard and its own order: import,
    markers, pronunciation, cast, narration, assembly, export. Free and offline
    first, paid voices as a final pass with the cost quoted before anything is
    spent.
14. **Settings in full.** Model Roles and what each role covers, prompt caching,
    content modes, what is worth changing and what is worth leaving alone.

#### Design constraints, most of them learned the hard way

- **Every step answers the four questions** the `Explain` registry already
  requires: what it is, why it exists, whether it is necessary
  (required / recommended / optional), and what it spends. A tour step that
  cannot answer "do I need this?" is an advertisement.
- **It must work on an empty project.** The commonest state for its audience, and
  the one that hides half the interface. A step whose anchor does not exist yet
  must say what would be there and why it is not, rather than pointing at
  nothing. This is the single most likely way for this feature to ship broken.
- **Anchors need a stable contract.** Highlighting a real button means naming it,
  and a renamed or removed element would leave the tour pointing at empty space
  with no error. A registry of tour anchor ids, plus a source-read test that
  fails the build when a step names an anchor no component renders -- the same
  pattern as `test_codex_icon_keywords.py` and the Explain contract test.
- **Reuse the existing components.** `components/learn/` already holds
  `GuidedWalk`, `Explain`, and `useAttemptClose`. The tour is a new shell around
  them, not a fourth vocabulary for the same ideas.
- **Never mutate the writer's project.** No demo project, no sample chapter
  written into their folder, nothing created to have something to point at.
- **Progress is per install, not per project**, since it is about learning the
  app rather than about one book. Offered on first run; findable afterwards from
  Help, because the writer who skipped it on day one is exactly the writer who
  wants it in week two.

#### Relationship to the existing per-feature guides

This does not replace them, and the split is worth stating so a future session
does not collapse the two. The tour gives ORIENTATION -- what exists, in what
order, and whether you need it. `GuidedWalk` gives PROCEDURE -- the numbered
steps for one task, read while doing it. A step in the tour should be able to
hand off to the matching walkthrough rather than restating it, which also keeps
the tour short enough to finish.

### Audiobook Converter -- SHIPPED as v1.1.0 (2026-08-03)

*Kept in this section for its open follow-ups only. The feature itself is
described in [`features.md`](features.md); stages A-G are built and released.*

A standalone workspace inside Storythread Studio that converts a manuscript (DOCX / EPUB / Markdown / TXT, or an existing Storythread project) into chapter MP3s, a combined MP3, and an M4B audiobook. Full specification: [`audiobook-converter-spec.md`](audiobook-converter-spec.md) (reviewed and revised 2026-07-28).

The headline workflow is **"draft locally, print premium"**: generate the whole book free with the local Kokoro narrator to listen, catch awkward prose, and fix pronunciations -- then, when the book is final, switch to a premium hosted voice (OpenRouter TTS or NanoGPT, which hosts the identical Kokoro voices plus ElevenLabs tiers) and regenerate once, cost-confirmed, as the "print" pass.

This is the fundamental change the 1.1.0 version slot has been reserved for. Delivery is staged across multiple releases; the first release that includes a usable free local audiobook pipeline becomes **v1.1.0**, and later stages ship as 1.1.1, 1.1.2, and so on. Normal 1.0.x releases can continue in parallel while the converter is built on its own branch.

Build stages (spec phases in parentheses; estimates in working sessions, the unit this project actually ships in):

| Stage | Contents | Est. sessions | Release |
|---|---|---|---|
| A. Foundation + import (1-2) | Dashboard, workspace + manifest, recent-activity index, DOCX/EPUB/MD/TXT + Storythread-project import, chapter detection, narration editor with markers + pronunciation dictionary | 2-3 | dev branch |
| B. Local narration (3) | kokoro-worker.exe companion artifact (build/sign/host/download/verify), worker lifecycle, CPU synthesis, voice previews, chapter queue, progress persistence, restart recovery, sleep inhibit | 3-4 | dev branch |
| C. Audio assembly (4) | FFmpeg integration, silence-at-assembly, chapter MP3 / combined MP3 / M4B, metadata + cover art | 2 | **v1.1.0** |
| D. Cloud providers + print pass (5) | OpenRouter TTS + NanoGPT speech providers, model discovery, cost estimator, the premium print flow | 1-2 | v1.1.1 |
| E. Revision + recovery (6) | Segment hashing, stale-audio detection, regenerate-changed-sections, revision retention, cleanup, export-only state | 1-2 | v1.1.2 |
| F. PDF import (7) | Text-based PDF extraction, scanned-PDF rejection, PDF artifact cleanup | 1 | 1.1.x |
| G. Multi-character foundation (8) | Speaker management UI, speaker-to-voice mapping, AI annotation review framework | 2-3 | 1.1.x |

Total: roughly 12 to 17 working sessions to complete all stages, with a usable v1.1.0 at the 7-to-9 session mark. Highest-risk items (watch these first): the kokoro-worker packaging pipeline, EPUB extraction variability, and M4B assembly.

**Status (2026-08-01): all seven stages (A through G) are built and awaiting review as a stacked set of PRs into the converter branch.** Two notes against the estimates above: Stage E came in well under its 1-2 sessions because segment hashing and stale detection had already shipped in Stage B (stable IDs were needed to make generation resumable at all), and the Standard price tier ships EMPTY -- all three candidate engines were auditioned and demoted, with the search pinned rather than closed. See the spec for both.

#### Follow-ups from live testing (2026-08-03)

Two open items on the Formatting Walkthrough, both raised by walking a real 22,000-word chapter. Neither blocks v1.1.0.

**1. Rare word senses need an ear pass.** Word readings (spec 18.6) landed well on the 16 main entries. The 6 rare ones are weaker and need their own session -- the audition proved the respellings are *mechanically* correct, which is not the same as *audibly* right:

- **`use` may not be worth offering at all.** Noun and verb differ only by `/s/` against `/z/`, and to the ear the two clips are nearly identical. If the distinction is inaudible the choice is noise; drop the entry rather than ship a decision that changes nothing.
- **`minute` has the stress in the wrong place.** `mynoot` renders as "MY-noot"; the real word is "my-NOOT". This is the same problem as the deferred noun/verb stress family, so it wants the same tool: the weak-first-syllable trick (spec 18.5) found by scripted search.
- **Every `sounds` label needs checking against the audio it actually produces.** The label is a plain-English description written by hand. Where it does not match what the Play button plays, it actively misleads -- worse than having no label, because the writer trusts it.
- **Then decide whether rare senses earn a stop at all**, or belong in the say popout's tips as documentation. The capability is cheap to keep; the credibility cost of a stop that offers a bad reading is not.

**1b. Interjection beats may not earn their place.** Reviewed 2026-08-03: the tutorial demo was rebuilt around a harder word ("Enough!") at 0.8 seconds rather than 0.4, because the first attempt was inaudible even to the person who asked for it. It is better, still the quietest of the four beat types. The tutorial now says so and tells the writer to skip these if they cannot hear the difference on their voice. If a second listening pass says the effect is still marginal, the honest move is to drop the trigger rather than keep a stop nobody can justify -- it fires roughly once per chapter, so nothing is lost.

**2. The dialogue hand-off defaults were reviewed and kept.** The question was whether `paragraph_gap_ms` (550ms) had made them redundant. Answer: partly. The across-a-paragraph-break variant *was* redundant and has been removed. The same-paragraph variants were kept, because dialogue is detected per PARAGRAPH in the segmenter -- a quote opening mid-paragraph gets no seam and no pace change from any setting, so the walk is the only thing that can put a beat there. On the test chapter they fire 283 + 111 times and every sample inspected was a real hand-off.

---

## Proposed

Worth building, prioritization not yet committed.

> **AUDIT 2026-08-23 -- nine places in this file were wrong, and they are
> corrected inline below rather than quietly rewritten.** Every correction says
> what the line used to claim, because the drift is the useful part: this file
> is the only place some of these decisions are recorded, and a roadmap nothing
> is compared against goes stale exactly the way the Weave's spec did.
>
> The dangerous one was **per-book role overrides**, which claimed the resolver
> "already implements and tests precedence level 1" -- R8.6 *deleted* that level
> on the writer's ruling, so a session reading that line would have gone hunting
> for the dead code and might have put it back. Two more were the same class in
> both directions: **declared presence** was listed as unscoped four months after
> it shipped, and **stable scene IDs** was listed as unbuilt while its consumer
> is already built and reading a `manuscript/scenes.json` that nothing writes.
>
> The rest: the GuidedWalk path and consumer count, three of the character-
> creation follow-ups, the Book Details receiving end, long-context budgeting
> (a working reference implementation with one caller), the series rollup being
> an N-database fan-out rather than one query, and four undocumented defects in
> the local-model provider.
>
> Verified by reading the code, not this file. Sizings and line numbers below
> are from that pass.

### Local model providers -- MOSTLY SHIPPED (v1.1.1)

Shipped: the `local` provider entry, address + API-style settings restricted to loopback / private / `.local` destinations (`backend/app/ai/local_endpoint.py`), Ollama's native `GET /api/tags` via `model_list_style`, `<think>` stripping in the sanitizer, and a Test Connection that tells a bad address, a dead server, and a wrong-API-style server apart. See `docs/research-multi-provider.md` for the original research.

Still open:

- **A live-reply connection test.** Today's test proves the server is reachable and lists models; it does not prove generation works. The stronger check is a deterministic tiny prompt ("Reply with exactly this text: ...") at temperature 0 with a timeout, showing the model's actual reply.
- **Feed the stripped `<think>` trace to the Reasoning toggle** as the local analogue of OpenRouter's `reasoning` field. Currently the trace is discarded.
- **Strip the `:latest` suffix for display** in the model picker.
- **A `custom` provider** for arbitrary OpenAI-compatible URLs. Deliberately separate from `local`, which refuses non-local addresses on purpose -- see the note in `providerMeta.ts`.

**Two DEFECTS this list did not mention, found 2026-08-23 by reading the code
against it.** Both fail quietly, which is why neither was ever reported.

**D1 -- the `ollama` API style cannot generate at all.** `normalize_base_url`
keeps the bare root for that style (`ai/local_endpoint.py:140-145`), but
`run_completion` and `run_chat` both POST to a hardcoded
`f"{provider.base_url}/chat/completions"` (`ai/openrouter.py:362,525`). For
ollama style that resolves to `http://localhost:11434/chat/completions`, which
Ollama does not serve -- it serves `/api/chat` natively and
`/v1/chat/completions` through its compatibility layer. So every AI action 404s.
The reason it looks fine right up to the failure: `model_list_style` is patched
in only on the two LISTING paths (`routers/ai.py:326`,
`routers/settings.py:316`), never by `_resolve_model_and_key`, because listing
is the only thing that needed it. Test Connection **passes**, the model dropdown
**fills**, and then Draft, Advisor and every summary fail. No test has ever
POSTed a completion as the local provider.

**D2 -- a local model is invisible to the Profile Extractor's own picker.**
Local catalogs carry no `context_length` (`/api/tags` does not return one and
`_normalize_generic_models` defaults it to 0). The backend is honest about that
-- `routers/extractor.py:170-185` treats 0 as "could not find out", and the
oversize refusal is gated `if context_tokens and ...` so 0 never refuses. The
frontend is **stricter than the backend** and hides them:
`ExtractorModelPicker.tsx:84` filters on `m.context_length >= needed / 0.8`, so
with `needed > 0` every local model drops out of the list and can only be
reached by typing into the search box. A local model assigned to Long-context
analysis cannot be chosen on the screen that chooses it.

**D3 -- `suggested_style` is computed and rendered nowhere.**
`_test_local_connection` works out which dialect the server actually speaks and
returns `suggested_style` (`routers/settings.py:344`), and the string appears
nowhere in `app/src/` -- `ProviderPanel.tsx:101-106` renders only `{ok,
message}`. Same shape as R8.1 and R8.7: the backend computed the right answer
and no screen read it.

**D4 -- a hazard rather than a bug yet.** The character caps are sized for
hosted context windows: a "full chapter" may be 100,000 characters
(`routers/ai.py:1922`) plus up to 60k of Weave brief. Sent to an 8k-window local
model, Ollama's default is to **trim the prompt silently and answer anyway** --
a plausible reply about a third of the chapter, with nothing in a position to
notice. This is why long-context budgeting is the right companion work.

Also worth a spec line: `run_completion` sends `response_format: {"type":
"json_object"}` unconditionally (`ai/openrouter.py:329`). Ollama's compat layer
and LM Studio accept it; older llama.cpp builds 400 on it. The app already has
the pattern for that -- the audiobook's self-healing 400 retry.

**And the data for "basic level descriptions" is already arriving and being
discarded.** Ollama's `/api/tags` returns a `details` object per model carrying
`family`, `parameter_size` ("8B") and `quantization_level` ("Q4_K_M"), plus an
on-disk `size`. `_normalize_generic_models` (`ai/openrouter.py:240-258`) reads
only id / name / model / context_length and drops `details` on the floor.
Surfacing size, quantization and family is enough for an honest description
without a curated list -- and the app must not RANK local models, because
recommending one over another on the writer's own disk is a claim about their
hardware, not about the model. `recommendedPicks` (`modelFiltering.ts:199-225`)
matches OpenRouter slugs and buckets by price tier, so for a local catalog
nothing matches and the Recommended group does not render at all -- which is the
correct outcome, not a gap to fill.

The spec for this work is `docs/local-model-spec.md`.

### User-editable prompt templates (Default + Custom)

Long-planned. Storythread Studio is aimed at beginning writers, and editing your own prompts is an advanced skill in itself — so the design keeps beginners safe by default:

- **DEFAULT is a locked, uneditable prompt** — exactly what the backend uses today. It always exists and cannot be broken.
- An **Advanced** option unlocks custom prompts. Each promptable feature gets its own section in Settings with a pull-down: **DEFAULT** (default), then **Custom <edited name>**, **Custom <edited name 2>**, etc.
- Custom prompts are named, per-feature, and swappable at any time; picking DEFAULT always restores stock behavior.
- Scope ideas for the Advanced side: `{{variable}}` placeholders, per-prompt sampling settings, and JSON import/export packs (see [`research-multi-provider.md`](research-multi-provider.md)).

### "Show me how this works" everywhere

Built first for the audiobook Cast panel (Stage G) and now the standard for every feature in this app, new and old.

**The rule going forward:** any new feature or add-on ships with one. Not a tooltip and not a wall of text at the top of the screen -- a numbered, step-by-step walk through the actual order of operations, with an example of what each step looks like on screen, sitting in the panel so the writer can read step 3, *do* step 3, and come back. Reference answers ("what's this?") are the other half: good when somebody has a question, useless when they do not yet know what to ask.

**Retroactive work, roughly in order of how much it would help a new writer.** Each one needs to answer four questions, in this order:

1. **What is this section?** In one line, in the writer's terms.
2. **Do I need it?** Usually the honest answer is *no*, and saying so first is what makes the rest safe to read. The Cast panel leads with "No -- a book read entirely by one narrator is a finished audiobook", and that is the model.
3. **How does it connect to writing the book?** Where it sits in the process, and what it daisy-chains into. Character profiles feed AI context; scene summaries feed the outline; the cast feeds narration. A feature nobody can place in the workflow gets skipped.
4. **What does it get me if I do use it?** Concrete benefit, not a feature list.

Sections that need one: **Character profiles** (needed? no -- but here is what the AI can do with one that it cannot do without), **Relationships**, **Locations**, **Lore**, **Chapter and scene summaries**, **the Outline**, **Smart Advisor**, **Writing Companion** (Draft and Enhance especially), **Series/arcs**, **Export**, and the **audiobook** sections beyond Cast (markers, pronunciation, generation, print pass).

**Done: the shared component exists.** `app/src/components/learn/GuidedWalk.tsx`
renders the numbered card (steps, examples, Back/Next, tone), so a new one is a
list of steps and nothing else. **THREE** use it today -- the Cast workbench
(`CastTutorial.tsx`), the Formatting Walkthrough (`InsertWalkthroughHelp.tsx`)
and the Weave's Run editor (`RunWalk.tsx`). Copy `InsertWalkthroughHelp.tsx` as
the template. (Path and count corrected 2026-08-23; R8.8 moved the file out of
`features/audiobook/` and this line was never updated.)

**More is built than this section implies, and some of it duplicates the
component.** Four bespoke paged walkthroughs do GuidedWalk's job with their own
code and could be absorbed into it: `screens/ProfilePageGuide.tsx`,
`screens/SubtextGuide.tsx`, `features/codex/ExtractorGuide.tsx` and
`UnwovenGuide.tsx` (+ `GuideBody.tsx`), plus `audiobook/MarkerHelpPanel.tsx`.

**The reference half is further along than the walkthrough half.**
`components/learn/explanations.ts` holds 46 entries, but the coverage is lopsided:
Character profiles (9 keys), Relationships (5) and Smart Advisor (5) are done;
the Outline and Export have one key each; and there are **ZERO** keys for
Locations, Lore, chapter/scene summaries, Writing Companion Draft/Enhance,
Series/arcs, and the whole audiobook -- audiobook panels pass inline JSX to
`WhatsThis` instead of using the registry. `components/learn/registries.test.ts`
is the binding contract any new key must satisfy.

### Book Details: Author + Publication Year fields

Requested during audiobook metadata testing (2026-07-30). The writing
app's Book Details never asks for the author's name or a publication
year, so the audiobook converter's "never ask twice" prefill has nothing
to pull for those two fields (it already pulls genre, description, and
series name from project.json / series.json). Add both to Book Details
in `project.json` and the Book Details settings UI, include them in
`_build_story_context()` where sensible, and extend the audiobook
`project_prefill()` (`backend/app/audiobook/workspace.py`) to read them
-- the prefill side is already built and one dict entry per field.

**Noted 2026-08-23: the receiving end is built ENTIRELY, and further than this
section says.** `METADATA_TEXT_FIELDS` carries both fields
(`audiobook/workspace.py:267-271`), `MetadataRequest` carries both
(`routers/audiobook.py:362,367`), `BookDetailsPanel.tsx` renders both, and
`audiobook/assembly.py` already writes them into ID3 tags and M4B metadata. The
import extractor even reads `data.get("author")` from `project.json` already
(`audiobook/extraction/storythread_project_extractor.py:35-46`), so an `author`
key is picked up the moment one exists, with no backend change.

**One thing to change in the same commit:** the docstring at
`audiobook/workspace.py:330-332` states that Book Details has nothing to give
for these two fields. It becomes false with this work, and per the spec-
discipline rule it changes alongside rather than being left as a quiet lie.

### Character creation follow-ups

Polish on the v1.0.10 character overhaul, deferred deliberately:

- **Build-speed selection at creation time** -- the "+ New" character form offers Main / Supporting / Background, pre-expanding the right tool (spine dropdowns, Quick Build, or a single-roll minimal template). Today all tools are available on every character profile; the speed choice is a flow refinement, not a capability gap.
- **Structured "apply" from Interview/Extract output** -- a one-click path from the interview's copy/paste block into real trait blocks (today the writer pastes by hand, per the review-before-use rule; an explicit per-section Apply button would stay inside the write boundary).
  **HALF BUILT, on a different surface (noted 2026-08-23).** The Profile
  Extractor already ships exactly the per-item Apply described here, with a
  four-verb action vocabulary -- `overwrite` / `merge` / `add` / `merge_trait`
  (`backend/app/routers/extractor.py:746-855`, UI
  `features/codex/ExtractorReview.tsx`). **Reuse those verbs; do not invent a
  second vocabulary** -- one idea with two vocabularies is the failure the Weave
  recovery kept finding. The remaining gap is only the Profile Builder
  **Interview** block, where `ai/prompts.py:1078-1085` still tells the model to
  emit a copy/paste block and no parser exists.
- **Big Five (OCEAN) sliders** as a third, dimensional spine option for writers who want flaw-first variety beyond the 9 + 15 discrete types.
  **NOT built**, confirmed 2026-08-23. Existing spines are
  `characterSpines.ts:28` (Enneagram) and `:153` (Jungian + story roles).
  `SpineOption` is text-only, so numeric sliders need a shape change, and the
  header comment at `:13-15` forbids MBTI-style naming.

### Stable scene IDs + scene move between chapters

Follow-up to the acts/beats release. Today scene identity is positional (scene 2 = the second `---` section; sidecars are `scene-NN.md`), so inserting a scene break mid-chapter re-pairs every later sidecar, and moving a scene between chapters would be destructive text surgery with positional renumbering on both sides.

**Cheaper than it looks, and noted 2026-08-23: the CONSUMER is already built.**
The Weave already parses and formats `c-xxx/s-yyy` scene anchors, and already
reads scene order from `manuscript/scenes.json`
(`backend/app/codex/anchors.py:91-115`) -- **and nothing in the repo writes that
file.** So every scene-level anchor silently degrades to chapter level today:
this programme's own recurring shape, a capability whose condition can never be
true, raising nothing. The minting toolkit exists as well
(`backend/app/utils/stable_ids.py`, template at
`utils/structure_store.py:275-327`), and `backend/app/db.py:181` already carries
a `scene_id` column. Step 1 is smaller than this section implies; step 2 is
where the real risk lives.

The safe order of work:

1. **Stable scene IDs first** -- a short anchor comment at each scene top (e.g. `<!-- scene:ab12cd -->`) that sidecars key on instead of position. Auto-inserted on first summarize; tolerated absent everywhere.
2. **Then scene move** -- cut the `---` section from the source chapter, splice into the target, move the sidecar by ID, with a pre-move snapshot of both chapter files so a partial failure can never lose prose.
3. Beat moves between scenes ride along for free once sidecars are ID-keyed.

### Drag-and-drop manuscript tree

v1 of the acts tree ships menu-based moves (hover "..." > Move up / Move down / Move to Act) because native HTML5 drag is unreliable in WebView2 and nested-tree DnD needs @dnd-kit plus substantial collision/projection code. Once the tree structure has settled, add drag-and-drop as a polish layer over the same PUT /api/structure calls -- the menu stays as the accessible fallback.

### Renumber files to match act order (bulk action)

With `manuscript/structure.json` as the ordering authority, the numeric `NN-` filename prefixes can drift from true reading order after reorders (e.g. `05-finale.md` reading second). Harmless inside the app, but confusing when browsing the folder in Explorer. A one-click "Renumber files to match order" action would run N rename-cascades (the same machinery as chapter rename) to realign prefixes on demand. Deliberately manual -- automatic renumbering on every move would churn git history and file identity.

### Smart Advisor: Style Controls category

A fourth top-level Advisor category alongside Readability / Structure / Context. Subcategories: Readability Level, Formality, Descriptive Intensity, Dialogue Compression, Narrative Distance. Same overlay + popover + modifier UI as the existing categories.

### Smart Advisor: Advanced category

A fifth top-level category for cross-passage critique passes that do not fit Readability / Structure / Context. Subcategories: Theme & Message, Transitional Coherence, Strengthen Conclusions.

### Task-aware model auto-selection

**Partly delivered by Model Roles (v1.1.1)**, which routes by *assistant type* -- every AI call site declares its role and the writer assigns a model per role. What remains is the automatic half: choosing an eligible model based on **content size** and **content mode** rather than only on the kind of job, falling back on ambiguity. That classifier would sit between `resolve_role_model()` and the existing allowlist / content-mode validation.

**CORRECTED 2026-08-23.** This section used to say the resolver "already
implements and tests precedence level 1 (`project.json` -> `model_roles[role]`)"
and only wanted a UI. That is not true and has not been since **R8.6 deleted
that level on the writer's ruling**. `resolve_role_model` has exactly two
levels, and level 1 reads SETTINGS, not `project.json`
(`backend/app/ai/roles.py:229-256`). The old line was the dangerous kind of
drift: a session reading it would go hunting for dead code and might reinstate
it. `test_model_roles.py:135-151` now pins the opposite.

So **per-book role overrides are NOT partly built -- they are not built at
all**, and the roles docstring argues against a half-measure: `_resolve_model_
and_key` never opens `project.json`, it synthesises `{"default_model":
override}` from one frontend field, so a per-book assignment could not arrive
however faithfully `projects.py` stored one. Building it properly means
threading `project_path` through about thirteen request models across ~34 call
sites, every frontend caller, and a new per-book screen. Roles are app-wide.

**On the automatic half:** the two functions named above are **validators that
reject, never selectors that choose** -- `_validate_model_content_mode`
(`routers/ai.py:475`, raises 400) and `_validate_model_allowed` (`:519`), both
running AFTER `_resolve_model_and_key`. That empty seam is real, and the data a
classifier needs is already plumbed (`context_length` at `openrouter.py:157`).
Content-size awareness exists in exactly one place and **refuses rather than
routes**: `routers/extractor.py:515-536`.

### Long-context handling: priority pinning + summary swap

When a request would exceed the model's context window, the materials builder pins Outline + Style Guide first and swaps full chapter prose for chapter summaries before truncating older scene text. Engages automatically; no user toggle.

**PARTLY BUILT, and the built half is a working reference implementation
(noted 2026-08-23).** Everything this section describes exists for the Weave's
brief and nowhere else: a `Budget` dataclass reserving output / system / user /
overhead / pinned (`backend/app/codex/context.py:86-120`), a four-rung relevance
ladder that doubles as prune order (`:60-64`), and `_fit()` splitting required
from optional and **refusing rather than truncating** when the pinned content
alone will not fit (`:370-410`), with first-class `refused` / `refusal` /
`budget` reporting. It has exactly one caller (`routers/codex.py:2522-2534`).

What does not exist is any budgeting in the builder that carries the writer's
actual prose: `_build_materials_message` (`routers/ai.py:1807-1908`) simply
concatenates chips, surrounding context, brief and passage. In its place are
flat character caps that 400 the request (`:1922` 100k/30k, `:1936` 30k, `:1946`
60k, `:2239`, `:1542`) plus one **silent** truncation --
`_RELATIONSHIP_SNIPPET_CAP = 400` (`:631,745-751`), which should come under the
budget while anyone is in there.

So this is largely extending a proven mechanism to a second caller rather than
greenfield work. Two hazards: every cap replaced is currently load-bearing as a
400, so removing one before the budget is in place lets an oversize request
through; and this is where a small-window LOCAL model stops being silently
truncated by the runtime (see the local-provider section -- a local catalog
reports `context_length` 0, and Ollama's default is to trim the prompt and
answer anyway).

### Cloud-sync path detection

Detect when a project lives under a known cloud-sync folder (Google Drive, OneDrive, Dropbox, iCloud Drive) and show a warning banner at project open: "This project is in a cloud-sync folder. Mirror sync can silently roll back your saved files. Consider moving the project to a local-only folder." Path-pattern check; no API calls. Dismissable, with a "Don't warn me again for this project" option that writes a flag into `project.json`. Motivated by a confirmed Google Drive incident that restored an older version of a chapter file hours after a successful local save.

### Local snapshot trail

Keep a per-save shadow copy of every chapter inside `.storythread/snapshots/<chapter-stem>/<ISO-timestamp>.md`, capped at the last N saves per chapter (default 50). The `.storythread/` directory is already cache, and users can exclude it from cloud sync. Provides a recovery path even when external forces (cloud sync rollback, antivirus restore, disk corruption) eat a chapter file. A simple "Recover from snapshot" UI in the chapter context menu lets the writer pick a prior version. Companion to the cloud-sync detection above.

### Serial fiction progress model

The Project Completion gauge shipped in v1.0.3 does not apply to serial fiction. Serials are profile-heavy (heavy character/location/lore/relationship reuse across episodes) and each chapter is a self-contained finished work rather than a percentage of an overall target. Design a profile-reuse-weighted progress model once feedback from serial-fiction writers clarifies what "progress" means for them. v1.0.3 shipped a placeholder card on the gauge for `serial_fiction` projects.

### Cross-book series progress rollup

Aggregate Project Completion and Daily Goal tracking across all books in a series at the series-home level. The `progress_event` table from v1.0.3 already stores `project_path` per row so each book's data is identifiable; the rollup query and the series-home UI are the main remaining work.

**Corrected 2026-08-23: it is not one query.** `app.db` lives **per project**
(`backend/app/db.py:44` -- `Path(project_path)/".storythread"/"app.db"`), and
every progress read is scoped `async with open_db(project_path)`. So a
cross-book rollup is an N-database fan-out in Python, not a single SQL statement;
the `project_path` column distinguishes rows *within* one book's database, which
is a different job from telling books apart. `list_books`
(`routers/series.py:240`) is the natural iterator and `_daily_totals` /
`get_summary` (`routers/progress.py:377,585-627`) are reusable per book.
`routers/series.py` has three routes and no progress endpoint at all.

---

## Nice-to-Have

Lower priority. May ship eventually, may never; no harm if they don't.

### Streaming responses (SSE) — backburner

Replace blocking AI calls with server-sent events so chat replies and Smart Advisor passes render character-by-character. Affects the Writing Companion chat, Profile Builder chat, and the editor-pass endpoint. OpenRouter supports SSE natively; the work is on the FastAPI streaming layer and the React reader. **Deliberately parked (2026-07-13): not convinced streaming is more efficient, more effective, or a good use of tokens. Needs a fully convincing case before any implementation starts.** Note: provider work (NanoGPT, local models) does not depend on this.

### Interaction log table

SQLite-backed log of AI requests for the writer's own self-review (which assistant, which model, which chapter, how long, optional response gist). No analytics or telemetry — local only.

### Level 4: Proactive Observer

A background AI mode that surfaces drift or contradictions without being asked. Lowest priority because it conflicts with the locked rule that AI assists on demand only. Would require a careful redesign of consent and surface-area before being viable.

---

## Dropped

These appeared in older specs and were never built. They are not Nice-to-Haves — they have no real consumer and should not be carried forward as TODOs.

- `POST /api/ai/route-preview` — preview UI never designed
- `assistant_registry` SQLite table — assistants live in code (`assistants.py`); a registry adds nothing
- `interaction_log` table as originally specced — superseded by the Nice-to-Have entry above
- Structured-output support filter — every shipping model supports JSON mode now
- Context-size filter — task-aware auto-selection covers it implicitly
