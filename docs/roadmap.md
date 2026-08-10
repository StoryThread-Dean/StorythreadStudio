# Roadmap

This is a living document. Items move between buckets as priorities change. Anything that ships drops off this list and lives in [`features.md`](features.md). Anything intentionally not built lives in [`product-scope.md`](product-scope.md) under "Out of scope."

For shipped releases see [`../CHANGELOG.md`](../CHANGELOG.md).

---

## Scheduled

Committed work for the near-term roadmap.

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
an Unwoven answer), and wiring the assembled brief into the Writing Companion
with its inspect panel. Automatic Weave context is not reachable from any AI
feature yet -- `/api/codex/context` builds and returns a brief, and nothing calls
it -- so the amended context rule is not yet exercised in the running app.

The migration UI is now built: the Weave screen runs the dry run on open,
itemises it folder by folder, names the backup destination before the button,
and requires a second click that repeats the count and the destination. An
interrupted run offers resume or restore rather than guessing.

Also open before release: a Thread editor for the kinds the Profile Builder
does not cover (factions, governments, religions, concepts, events -- until
then Weaving says plainly that those stops have nowhere to send the writer),
and the manual-smoke additions for each milestone.

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

### Local model providers -- MOSTLY SHIPPED (v1.1.1)

Shipped: the `local` provider entry, address + API-style settings restricted to loopback / private / `.local` destinations (`backend/app/ai/local_endpoint.py`), Ollama's native `GET /api/tags` via `model_list_style`, `<think>` stripping in the sanitizer, and a Test Connection that tells a bad address, a dead server, and a wrong-API-style server apart. See `docs/research-multi-provider.md` for the original research.

Still open:

- **A live-reply connection test.** Today's test proves the server is reachable and lists models; it does not prove generation works. The stronger check is a deterministic tiny prompt ("Reply with exactly this text: ...") at temperature 0 with a timeout, showing the model's actual reply.
- **Feed the stripped `<think>` trace to the Reasoning toggle** as the local analogue of OpenRouter's `reasoning` field. Currently the trace is discarded.
- **Strip the `:latest` suffix for display** in the model picker.
- **A `custom` provider** for arbitrary OpenAI-compatible URLs. Deliberately separate from `local`, which refuses non-local addresses on purpose -- see the note in `providerMeta.ts`.

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

**Done: the shared component exists.** `app/src/features/audiobook/GuidedWalk.tsx` renders the numbered card (steps, examples, Back/Next, tone), so a new one is a list of steps and nothing else. Two use it today -- the Cast workbench and the Formatting Walkthrough. Copy `InsertWalkthroughHelp.tsx` as the template.

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

### Character creation follow-ups

Polish on the v1.0.10 character overhaul, deferred deliberately:

- **Build-speed selection at creation time** -- the "+ New" character form offers Main / Supporting / Background, pre-expanding the right tool (spine dropdowns, Quick Build, or a single-roll minimal template). Today all tools are available on every character profile; the speed choice is a flow refinement, not a capability gap.
- **Structured "apply" from Interview/Extract output** -- a one-click path from the interview's copy/paste block into real trait blocks (today the writer pastes by hand, per the review-before-use rule; an explicit per-section Apply button would stay inside the write boundary).
- **Big Five (OCEAN) sliders** as a third, dimensional spine option for writers who want flaw-first variety beyond the 9 + 15 discrete types.

### Stable scene IDs + scene move between chapters

Follow-up to the acts/beats release. Today scene identity is positional (scene 2 = the second `---` section; sidecars are `scene-NN.md`), so inserting a scene break mid-chapter re-pairs every later sidecar, and moving a scene between chapters would be destructive text surgery with positional renumbering on both sides. The safe order of work:

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

Also still open from the roles work: **per-book role overrides.** The resolver already implements and tests precedence level 1 (`project.json` → `model_roles[role]`); it has no UI, so today roles are app-wide.

### Long-context handling: priority pinning + summary swap

When a request would exceed the model's context window, the materials builder pins Outline + Style Guide first and swaps full chapter prose for chapter summaries before truncating older scene text. Engages automatically; no user toggle.

### Cloud-sync path detection

Detect when a project lives under a known cloud-sync folder (Google Drive, OneDrive, Dropbox, iCloud Drive) and show a warning banner at project open: "This project is in a cloud-sync folder. Mirror sync can silently roll back your saved files. Consider moving the project to a local-only folder." Path-pattern check; no API calls. Dismissable, with a "Don't warn me again for this project" option that writes a flag into `project.json`. Motivated by a confirmed Google Drive incident that restored an older version of a chapter file hours after a successful local save.

### Local snapshot trail

Keep a per-save shadow copy of every chapter inside `.storythread/snapshots/<chapter-stem>/<ISO-timestamp>.md`, capped at the last N saves per chapter (default 50). The `.storythread/` directory is already cache, and users can exclude it from cloud sync. Provides a recovery path even when external forces (cloud sync rollback, antivirus restore, disk corruption) eat a chapter file. A simple "Recover from snapshot" UI in the chapter context menu lets the writer pick a prior version. Companion to the cloud-sync detection above.

### Serial fiction progress model

The Project Completion gauge shipped in v1.0.3 does not apply to serial fiction. Serials are profile-heavy (heavy character/location/lore/relationship reuse across episodes) and each chapter is a self-contained finished work rather than a percentage of an overall target. Design a profile-reuse-weighted progress model once feedback from serial-fiction writers clarifies what "progress" means for them. v1.0.3 shipped a placeholder card on the gauge for `serial_fiction` projects.

### Cross-book series progress rollup

Aggregate Project Completion and Daily Goal tracking across all books in a series at the series-home level. The `progress_event` table from v1.0.3 already stores `project_path` per row so each book's data is identifiable; the rollup query and the series-home UI are the main remaining work.

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
