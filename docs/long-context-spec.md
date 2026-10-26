# Long-context handling

**Status:** SHIPPED COMPLETE in v2.0.6 -- AI Notes, saved conversations, the
recap that stands in for older turns on resume, and the budget over the
materials builder.

**Source of truth for:** `notes/ai-notes.md`, durable chat sessions, the recap
on resume, and budgeting the materials builder.

---

## 1. Why this exists

Two problems share one cause, and the writer named it: *"partial purpose is to
use tokens to get less likelihood of bad return information."*

**The writer repeats themselves.** Everything the app can attach is about one
thing -- a character, a chapter, a place. There has never been anywhere to put
the standing stuff: a decision changed in chapter twelve, a habit not to copy,
a rule the world runs on. So it gets retyped into every conversation, and
forgotten in the ones where it mattered.

**Nothing is remembered.** Both chats are `useState` arrays. Close the app and
every reply the writer paid for is gone, along with the setup that produced it.

**And nothing knows how big a request may be.** `_build_materials_message`
concatenates. In place of a budget are six flat character caps that answer 400,
two silent truncations, and -- for a local model, which reports a context length
of 0 -- no check at all, because 0 currently reads as unlimited.

Fixing the first two makes every request bigger, which is why the third is in
the same programme rather than a later one.

---

## 2. AI Notes (shipped)

### 2.1 What it is

`notes/ai-notes.md`. Ordinary Markdown in the writer's own folder, listed in
the sidebar beside the other notes, exported with them, editable outside the
app.

**Its name is the design.** `notes/author-notes.md` is already the writer's own
room, excluded from AI by name (`PRIVATE_NOTES`, `codex/scan.py`). AI Notes is
its opposite and sits next to it: the room they share. Two files, adjacent,
opposite promises, and one sentence teaches both.

### 2.2 It arrives as a field, and is never read off disk by a route

`ai_notes` is a request field on `editor-chat`, `editor-pass`,
`revise-suggestion` and `profile-chat`.

**This is the whole reason the locked context rule can be kept.** If a route
opened the file itself, every endpoint would send it whether or not it had any
way of telling the writer -- and the rule
(`docs/product-scope.md`) is that they can inspect it, remove it, and switch it
off. A field can only be filled by a surface that has a control.

Pinned by `test_no_route_reads_the_notes_file_itself`, a source read over
`routers/ai.py` with comments stripped.

### 2.3 Where it sits in the prompt: first

Everything else in the materials block is ordered narrowest-first, because it
is all **material** -- chips, then the chapter's plan, then the world, then the
passage. AI Notes is not material. It is **instruction**: how to read the
material and how to help with this book. Guidance that arrives after the thing
it governs has already been read arrived too late.

For the same reason it is **not gated to Draft and Enhance** the way the
chapter outline is. The outline describes one chapter, so it is meaningless to
a readability pass. Standing guidance is standing.

### 2.4 The Smart Advisor gets it too

The Advisor reports what it believes is wrong, so the single most useful thing
a writer can tell it is which of those things they meant -- an unreliable
narrator, fragments on purpose, a character written to sound stilted. Sending
the notes everywhere except the check that raises the finding would withhold
them from the one place they prevent a wrong answer.

### 2.5 The controls

| Surface | Control |
|---|---|
| Editor | A row on the Weave context bar: icon, "about N tokens", On switch, and a compact **What's this?** |
| Profile Builder | A compact `AI Notes on` / `AI Notes off` button in the chat header |

The off state is remembered per book (`weaveContext.aiNotesOff` in
`.storythread/ui-state.json`), independently of the world switch and the
chapter-outline switch -- three things are sent automatically and they are
wanted independently.

Neither row appears when the file is empty. A switch for a document that does
not exist does nothing, and a writer cannot tell that from one that is broken.

**The switch is what decides.** `aiNotesToSend` is computed in `App.tsx` from
the pref and is what the payload carries; the bar is handed the raw file so the
row keeps rendering while the notes are off, which is how the writer finds the
switch to turn them back on. Filtering on the backend instead would be the
promise kept in the wrong place.

Its tokens join `pinnedTokens`, so the Weave's share of the window shrinks
honestly rather than the request growing quietly.

### 2.6 Save to AI Notes

Under any AI reply. Opens a composer prefilled with the reply for the writer to
cut down, dates the entry, and appends it.

- **It never writes on click.** An AI reply written verbatim into a
  human-authored file with one click is outside the write boundary. The writer
  edits and confirms; nothing reaches disk until they do. No new exception to a
  locked rule is needed, and none is taken.
- **Free.** No model call -- it is the reply text handed back to them.
- **Read-then-write, and a failed read aborts.** `POST /note` is a whole-file
  overwrite, so falling through a failed read to the write would replace the
  writer's entire guidance file with the single line they just typed. A 404 is
  the exception: no file yet is the first note, not a failure.
- The file is re-read afterwards, or the next request still carries the version
  from when the book was opened and the new guidance is on disk but not in
  force, with nothing on screen to say so.

### 2.7 The cap is 20,000 characters, and it refuses

Every other material is sent once for one request. These are sent on **every**
request, so an oversize file is not one expensive call -- it is every call from
now on. Refused rather than trimmed: a trim would leave the writer believing
guidance is in force that was cut off mid-sentence. The message says what to do
instead.

### 2.8 Deliberately not done

**AI Notes is not excluded from the Weaving scan's vocabulary.** It names real
entities in the writer's own words, which is exactly what that corpus is for.
Recorded here so a later session does not "fix" it.

---

## 3. Chat sessions (shipped)

### 3.1 The store

`.storythread/chats/<chat-id>.json`, in `app/chat_sessions.py`, copying
`codex/findings.py` almost verbatim: `SCHEMA_VERSION`, a `^chat-[0-9a-f]{12}$`
id guard, `replace_atomic`, corrupt-reads-as-absent, refusal to load a NEWER
schema, and `list_chats()` newest-first with an id tiebreak because the Windows
clock moves in ~15ms steps.

**Not `app.db`.** That file is documented as a rebuildable cache -- *"nothing a
writer typed lives here and nowhere else"* -- and a transcript is neither
derivable nor cheap. Same argument as the Weaving ledger.

**The id is a path, and the guard has to be tested with the extension left
off.** The file is `f"{chat_id}.json"`, so `../../project.json` escapes to
`project.json.json`, which never exists -- the first version of that test went
green with the guard removed. `../../project` is the real attack.

### 3.2 Hidden materials are a descriptor, never the payload

One materials turn can carry a 100,000-character chapter plus a
60,000-character brief. `describe_materials` keeps what was attached -- which
chips, whether there was a chapter, a world, an outline, standing notes, and
roughly the token cost -- and drops the text. One decision, two problems:

- **Size.** Session files stay in the low kilobytes instead of megabytes of
  duplicated manuscript.
- **Staleness.** A materials block is a SNAPSHOT. Replaying a four-day-old one
  would hand the model the chapter as it stood then and present it as current,
  with nothing on screen to say so.

On resume the descriptors are dropped and `chapterEstablished`,
`establishedChipKeys` and `establishedSelection` come back EMPTY, so materials
rebuild from today's files.

### 3.3 What a session restores

`clearWritingCompanionChat` in `App.tsx` is the checklist: whatever that
function has to reset is, by definition, part of the session. Stored in
`setup`: `contextChips`, `treatAsCanon`, `askBoundaries`, `draftMode`,
`enhanceMode`, `enhanceLevel`. The Profile Builder stores `behaviorMode`.

`treatAsCanon` is read as `!== false`, so a session saved before the field
existed does not silently flip the writer into Reference mode.

### 3.4 When it is written

After each completed turn, append-only, never before the reply arrives. **Not a
breach of manual-save-only**: that rule protects the writer's prose from
changing underneath them. A reply is an artifact they already paid for, and
losing it to a crash is what the rule is trying to prevent.
`POST /api/codex/run` is the precedent.

A save failure is deliberately silent -- the reply is on screen, and an error
about bookkeeping reads as the request having failed.

### 3.5 Titles, and the picker

Derived from the writer's first message, prefixed by subject for profile
sessions ("Frodo Baggins -- relationships buildout"), editable, and never
re-derived once set. **Free** -- a model could write better ones, but that is
one AI call per conversation for a label.

The picker (`components/chat/ChatSessions.tsx`) is shared by both surfaces and
reuses Weaving's "Carry on" / "Start fresh" language, which the writer has
already learned. It says how many past chats there are before it is opened,
warns that a long one may be summarised BEFORE it is opened, needs two clicks
to delete, and distinguishes an empty list from a failed read -- "you have
none" and "I could not read them" look identical and mean opposite things.

**A profile conversation is about somebody.** Opening Gandalf's while looking at
Frodo would put Gandalf's transcript beside Frodo's profile and send both, so
those rows are shown (seeing the history is the point) but say *open Gandalf the
White to carry on* instead.

### 3.6 "4 days ago"

`relativeDay` in `utils/chatSessions.ts`. **Calendar days, not elapsed hours**:
a conversation at 11pm is "yesterday" to the writer at 9am, and a duration
divided by 86,400,000 would say "today". Compared at LOCAL midnight, or an
evening conversation lands on the wrong side of the boundary west of Greenwich.

**Plain day counts well past a week**, to 90 days, because that is what was
asked for -- "4 days ago", "23 days ago". A date library would say "3 weeks
ago", which rounds away the thing that makes a conversation recognisable. A
future timestamp returns "" rather than "in -3 days": clocks do go backwards.

---

## 4. The recap on resume (shipped)

`POST /api/ai/chat-recap`. The roadmap's "summary swap", applied to a
conversation instead of a chapter.

**Bought once, at the first moment it is needed.** Not when the session is put
away (most are never reopened, so that buys recaps nobody reads) and not on
every resume (that re-buys what the writer already paid for). Stored on the
session from then on.

**Extended, never rebuilt.** A later resume compresses only the turns added
since, folding the previous recap in as opening context, so older material is
never re-read and never re-charged.

**Six visible messages always go verbatim** (`_RECAP_KEEP_VERBATIM`) -- about as
far back as "no, the other one" can point. Below ten messages nothing is bought
at all, and the endpoint says so without calling a model.

**Two indices, and both are returned.** `recap_through` counts STORED messages
including the hidden descriptors; `recap_visible_through` counts what a reopened
panel actually holds. Re-deriving the second on the frontend would mean copying
`_RECAP_KEEP_VERBATIM` into a second language and slicing the wrong half the day
one of them moved.

**An empty answer is refused (502), never stored.** Storing `""` would replace
the older half of the conversation with nothing on the next turn -- silently,
with every message still on screen.

**Role: `long_context`**, its second consumer after the Profile Extractor. A
small window would drop material from the middle of a long conversation without
saying so, which is the one thing this must not do. Temperature `critique`
(0.3): a faithful compression, not a piece of writing.

**The prompt is ordered by what must survive**: decisions the writer made,
things they REJECTED (without these the assistant suggests the same thing
again), what they were working on, and story facts recorded nowhere else. It is
told never to turn an undecided question into a decision.

**Nothing is hidden.** The whole transcript stays on screen; a notice says older
messages are being sent as a summary, offers to show that summary, and offers
"Send everything instead". Two cuts exist -- a New ask boundary and the recap --
and the LATER one wins, so a fresh ask inside a resumed conversation does not
drag the recap back in.

---

## 5. The budget (shipped)

### 5.1 The window is real now

`app/ai/context_window.py`, lifted out of the extractor where it had been the
app's *only* context-window reasoning.

**`weavingApi.ts` defaulted `model_context_limit` to 32,000 and no caller ever
passed one.** So every refusal the writer has seen, and every "where the room
went" breakdown they have read, was computed against a number nobody chose,
whatever model was selected. The comment on the field said "the caller knows
its own model", and that was the mistaken premise: roles resolve on the
BACKEND, so the frontend cannot know which model will answer.

`POST /api/codex/context` now resolves it server-side from the role for the
`category` it is told about, and returns `budget_model` and `budget_assumed`.
The panel names the model it measured, and says out loud when the limit is an
assumption rather than a measurement.

### 5.2 Zero means unknown, not unlimited

`fits()` returns three verdicts, not two: `FITS`, `TOO_BIG`, `UNKNOWN`.

The old check was `if context_tokens and estimated > context_tokens * 0.8`,
which short-circuits on 0 — making a model with an unknown window the one model
that could never be refused. That is **every local model**: Ollama's
`/api/tags` publishes no window, and Ollama's default on an oversize prompt is
to trim it and answer anyway. The writer gets a confident reply built on half
their book, from the one provider where nothing bills them and so nothing else
would ever make them look.

The extractor now refuses an unknown window over 30,000 tokens and says why.
Folding UNKNOWN into TOO_BIG instead would refuse every local model outright,
which is worse than useless for a writer who chose one deliberately.

**The cache also stored a failed lookup forever**, so one flaky call at startup
left a model "unknown" for the life of the process. A real window is cached for
an hour; an unknown one is retried after a minute, and the TTL is applied at
READ time so it can change without a restart.

### 5.3 The materials budget

`app/ai/materials_budget.py`. It reuses `codex/context.py`'s `Budget` — pure
arithmetic, nothing Thread-shaped — and deliberately does **not** reuse `_fit`.

`_fit` sorts `Piece`s, and a `Piece` needs an `entity_id`, a `name`, a `type`
and a rung on a ladder about how a Thread relates to the scene. A chapter, a
style guide and the writer's own selection have none of those and never will.
The choice was: give `Piece` a document variant, or write the document version
of the same idea. **This is the second**, because the first would put two
unrelated kinds of thing behind one sort order and the ladder would stop
meaning what it says.

Drop order, least missed first:

| | why it goes in this position |
|---|---|
| `surrounding` | the window around an Enhance selection, labelled grounding-only and not-to-be-rewritten. Its absence changes the answer least |
| `brief` | the world. Already budgeted where assembled, and already inspectable and prunable on the context bar — the one thing the writer has tools for |
| `passage` | not dropped, **swapped**: a full chapter goes as its summary |

Pinned, never dropped: `ai_notes` (small, and dropping it silently revokes
guidance the writer believes is in force) and `outline` (Draft and Enhance
cannot do their job without it).

**Chips are deliberately not in the list.** The writer attached them by hand for
this turn. Dropping something they chose, on a request they are watching, is
worse than a request that is refused and says why. They are counted as spent,
so the droppable material shrinks around them.

### 5.4 `ran` is not `engaged`

`FitResult.ran` says the budget evaluated; `engaged` says something changed.
Conflating them is a real bug and it was written first: `kept.get(key,
original)` reads fine and makes a **dropped** material fall straight back to
the thing that did not fit. `_survived()` is the two-line function that gets
it right, and the drop-order test is what caught it.

### 5.5 When it engages, and what it says

**Only when the window is KNOWN and the request would overflow it.** An unknown
window leaves the old behaviour exactly as it was — acting on a number we do not
have would be guessing with the writer's prose. The six flat caps stay
underneath as backstops; they are the only thing between an oversize request
and the provider, and nothing downstream checks size at all.

A swap or a drop comes back as `materials_note` and is shown above the
conversation. **A request that fits says nothing** — a note on every turn is a
note the writer learns to skip, and then misses the one that mattered. The note
is cleared on every turn, or one request's note lingers over the next and makes
a specific false claim about what the model saw.

**A refusal is a real 400 from the endpoint**, not a frontend convention. The
Weave's refusal is enforced by one line in one component, and `editor-pass` and
`revise-suggestion` have no UI in front of them at all.

**The swap reads a summary; it never generates one.** Generating it would turn a
chat message into a second AI call the writer did not ask for — and
`generate-chapter-summary` writes to disk, so it would also leave a file in
their project as a side effect. With no summary the chapter is dropped and
named instead: worse for the answer, correct about the money.

### 5.6 Both silent truncations are gone

`_clip()` cuts and says so in the text itself: `[...trimmed, N more
characters]`. A bare `text[:400]` reads to a model as a sentence that simply
stops, and it has no way to tell a truncation from a writer who trailed off — so
it fills the gap, confidently, from nothing. Applied to
`_RELATIONSHIP_SNIPPET_CAP` and to the chapter-outline builder's
12,000-character slice.
