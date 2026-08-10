# Features

This is a snapshot of what Storythread Studio does today. For where it is going next, see [`roadmap.md`](roadmap.md).

## Editor

- CodeMirror 6 Markdown editor with a serif typeface optimized for long reading
- Manual save (`Ctrl+S` or Save button); unsaved-change indicator with a confirm-before-close prompt; saving refreshes the sidebar title from the chapter's `# Heading`
- Session undo and redo
- Formatting toolbar, font selector, find and replace
- A **Tools** pulldown in the title bar collects the one-off actions: Generate Scene Summaries, Suggest Scene Breaks, Chapter Summary, Reader Mode, Passage / Dialogue Check, and Export
- **Passage / Dialogue Check** reads the selected passage aloud. Reading silently hides a passage's rhythm -- the writer supplies the pauses and emphasis without noticing, and an indifferent voice does not. It catches repeated words, sentences that only parse on the second read, and right-word-wrong-word errors no checker flags ("walked through the dessert" is perfectly spelled). Four voices, remembered per book, entirely local and free using the same engine as the Audiobook Converter; it saves nothing and applies no markers
- Light and dark themes (app-wide, persisted)
- Selection highlight persists when the writer moves focus into the chat or Smart Advisor panels

## Project structure

Each project is a folder the user owns. The app reads and writes Markdown files inside that folder; it never touches anything outside it.

- `manuscript/` — one chapter per Markdown file; `structure.json` holds acts + reading order once the writer uses acts
- `notes/` — outline, style guide, themes, plus any free notes the writer adds
- `profiles/` — character, relationship, location, lore profiles
- `profiles/arcs/` — for series projects, per-book overrides on canonical profiles
- `summaries/chapters/` — one summary file per chapter
- `summaries/scenes/<chapter-stem>/scene-NN.md` — per-scene summaries (with an optional `## Beats` checklist)
- `exports/` — combined manuscript file plus dated snapshot folders
- `.storythread/` — local cache (safe to delete; rebuilt from Markdown) + per-book remembered UI state

## Sidebar and manuscript hierarchy

The left panel presents Story > Act > Chapter > Scene > Beat:

- **Book Details** — a section header at the top that opens the Book Details popout (formerly "Project Settings" behind a gear icon, now the single home for everything book-level): Title, Description, Genre, Tone, Theme, Setting, Word Count target, Point of View, Tense, Target Audience, plus outline template, content mode, and the model picker. All story fields but the word target flow into AI prompts as STORY CONTEXT.
- **Acts** — created with "+ New Act"; chapters move between acts and reorder via each row's hover "..." menu (Move up / Move down / Move to Act). Acts collapse, and the collapsed state is remembered per book. Moves never rename chapter files.
- **Chapters** — double-click to rename. A rename updates the heading AND the filename (slug follows the title, `NN-` prefix kept), and carries the chapter's summary, scene summaries, act slot, and progress history along.
- **Scenes** — expandable under each chapter (from scene summaries); each scene with beats shows a done/total badge and expandable read-only beat rows.
- **Notes / Profiles** — collapsible sections; collapse state remembered per book across restarts and updates.
- **Writing Progress** — pinned at the bottom of the panel, always visible no matter how much of the tree is expanded; the breakdown slide-over opens upward.

## Profile Builder

A guided workspace for authoring structured project context.

### Profile types

Character, Relationship, Location, Lore. Each type has its own section template (Overview, Personality Traits, History, Tone and Atmosphere, Rule or Concept, etc.) defined in code, not user-edited.

### Trait blocks

Profile sections are made of trait blocks. A trait block is a single trait or a small group of related traits with a description and an importance level.

```md
- trait: observant, punctual, eloquent
  description: "She is the textbook example of someone always on time and has her things together."
  importance: core
```

### Importance levels

Replace an older "influence" scale. Importance controls when (and whether) a trait is sent to the AI.

| Level | Meaning |
|---|---|
| **Core** | Central to identity or narrative role. Always sent to AI at top prompt position |
| **Present** | Regularly relevant. Sent when the character is in the scene |
| **Background** | Exists in canon but rarely surfaced. Sent only when directly relevant |
| **Contextual** | Situational. Sent only when the writer explicitly attaches it |
| **Hidden** | Writer-only reference. Never sent to the AI; AI may not name a hidden trait, only express it as subtext |

### Adaptive word-count gauge

Each trait block shows a word count gauge tuned to its importance level. Higher-importance traits tolerate more words because they need detail to be useful in prompts. Hidden traits have no gauge.

### Two character templates (Main vs Side/Background)

Character creation offers a template choice, stored as `character_kind` in frontmatter (absent = main, so pre-v1.0.10 files are untouched):

- **Main** — the full trait-block template: importance levels, word gauges, the Importance Audit.
- **Side / Background** — every section is a single free-text field; Quick Build appends lines into them. Per-section AI Summary tiles are dropped (only the Full AI Summary at the bottom remains; existing summaries survive a resave). Trait-section headings are shared between templates, and the parser round-trips plain paragraphs under a trait heading instead of dropping them.

The Profile Builder's character list splits into collapsible **Main** and **Side / Background** groups; the chat attachment picker mirrors the same grouping.

### Name generator (characters)

Opened from the dice button beside the Name field, or "Need a name?" in the + New form. Pick a culture (20, grouped by region) plus one of five era buckets (Medieval/Renaissance through Current, with an honest closest-available fallback when a culture doesn't reach that far back), or one of 12 fantasy races (assembled from race-true syllable components -- endless output). Deals 6 given names + 6 surnames per roll with no-repeat paging; given and surname select independently and either alone is a valid pick. Real-world pools are served by the backend from an app-level `~/.storythread/names.db`, seeded at startup from JSON shipped with the app (versioned reseed; delete the DB and it rebuilds) -- built to expand with more cultures and, later, writer-added names.

### Personality spine dropdowns (characters)

Two cheat-sheet dropdowns in the profile header, under Status/Tags, each with per-option "What's this?" help: **Personality (Enneagram)** — 9 types, each summary carrying the type's core desire, core fear, and stress behavior — and **Story Role (Archetype)** — the 12 Jungian archetypes plus Comic Relief, Confidant, and Rival. Picking one inserts a fiction-first starting paragraph (behavior + speech pattern + how they crack under pressure, ending in a trigger/origin fill-in hook) into Personality Traits — a `[core]` trait block on Main, appended text on Side — with a confirmation note showing where it went. A Story Role pick also fills the Role field and merges its key-aspect Tags; the Role field additionally has a quick-pick list grouped Popular / Less Common / Niche. All canned text shipped in code — writer-initiated insertion, zero AI calls.

### Quick Build (side/background profiles)

Opens at the top of Side/Background character profiles. Pick a Story Role (weights the rolls; re-derived from the profile's Role field on reopen, so "Villain" finds Shadow / Villain), then reroll curated sentence-length options per section — Physical, Mannerism, Voice, Want/Motivation, and Hidden/Foreshadowing (secrets, tells, and planted details built to pay off later) — and click any option to append it to the matching section as a new line.

A **[Generate Overview]** button on the Overview section spins the filled-in fields (Name, Role, Tags, trait lines, relationships, notes) into a compact mini-story of the character: grounded in the writer's own entries, lightly embellished to connect them, hidden details expressed as subtext only, and a varied angle on each click. Output lands in the editable Overview field and saves nothing until the writer saves. This is a deliberate, documented exception to the write boundary, scoped to side characters only (see `CLAUDE.md` AI Boundaries). Pools run 50+ options per section and rerolls page through the whole pool before anything repeats. An opt-in **NSFW toggle** (red, per character, never automatic) swaps the pools: off = normal options with the Explicit box greyed out; on = NSFW pools replace normal; the Explicit checkbox swaps in a third fill-in-the-blank tier ("secretly wants to be ____") the writer completes.

### Profile-level AI tools

| Tool | What it does |
|---|---|
| **Section summary** | Generates a compact `## AI Summary: Section` summary into Markdown |
| **Full profile summary** | Generates a multi-paragraph `# Full AI Summary` synthesizing all sections, weighted by importance. For characters, also reads `profiles/relationships/` and weaves in connected dynamics |
| **"How AI uses this" preview** | Sparkles button on a trait block; on-demand prose explanation of how that trait's importance level shapes AI behavior. Shown in a popover, not stored |
| **AI Trim** | Scissors button that appears when a trait is in the Wordy/Bloated range; rewrites the description to a tighter target length |
| **AI Importance Audit** | Profile-level pass that flags importance-level mismatches across all trait blocks |

### Profile Builder chat

A right-side panel for refining a profile in conversation. Five behavior modes: **Chat**, **Refine**, **Extract Traits**, **Check Consistency**, and **Interview Me**. Chat does not auto-write back to the profile; the writer accepts suggestions manually.

**Interview Me** (v1.0.10) flips the direction: the AI interviews the writer about the character and organizes THEIR answers — interviewer and organizer, never the inventor (invented details are always labeled take-or-discard). The first pass asks 5–8 basics; section checkboxes above the chat input pick what to expand next, and each round asks 2–4 questions that dig for triggers and origins ("untrusting — of whom? what happened?") rather than adjectives. Every round ends with the full updated copy/paste profile block, so the writer can stop at any point with something usable. Book Details (genre, tone, theme, setting, audience) shade the questions when filled in — shade, never straitjacket.

### Profile import and fork

Import a character profile from another project as a fully independent copy. The fork gets a new profile ID and is editable in the new story; there is no sync back to the source.

## Smart Advisor

Inline editor overlays for structured feedback. Three top-level categories trigger from the editor toolbar:

- **Readability** — Grammar, Clarity, Redundancy, Descriptive (subcategory toggles)
- **Structure** — Dialogue, POV, Tone, Character, Pacing
- **Context** — Character Consistency, Relationships, Setting, Lore

### How a pass works

1. Writer clicks a category button. Subcategory checkboxes scope the pass.
2. The chapter (or selected passage) is sent to `/api/ai/editor-pass` with attached context chips.
3. The AI returns structured JSON: a list of issues, each with a verbatim quote, severity (praise / issue / suggestion), category label, explanation, and suggested rewrite.
4. The frontend anchors each issue to its quote and decorates the manuscript with colored underlines (amber / violet / teal). Multi-issue overlaps show a numeric stack badge.

### The popover

Click any highlight to open a popover anchored below the issue:

- Severity badge, category label, explanation
- The original passage and the suggested rewrite, rendered as a word-level diff (additions in green, removals struck through)
- Eight modifier buttons that re-cast the suggestion: **Default** (revert to AI's first take), **Rewrite**, **Expand**, **Shorten**, **Describe**, **Rephrase**, **Add Sensory Detail**, **Change Tone**
- **Accept** / **Ignore** actions

Default is a client-side revert. The other seven call `/api/ai/revise-suggestion` with that single issue and modifier name and replace the suggestion in place.

### Stable anchoring

Issue ranges are managed through a CodeMirror `StateField` that auto-maps positions through every transaction. Accepting one suggestion (which can replace many words) shifts every other issue's anchor to its new correct position automatically. If a future edit collapses an issue's range to zero length, that issue silently drops off — no stale highlights linger.

### Subcategory persistence

Subcategory checkboxes per category persist in `localStorage`, so the writer's preferences survive reloads.

### Scene break suggestions

A **Suggest Breaks** action (v1.0.7): the AI reads the chapter and proposes where a `---` scene break would strengthen the pacing, with a short reason for each. The writer decides what to apply.

## Writing Companion

The right-side chat panel beside the editor. Structured feedback passes are handled by Smart Advisor; the Companion covers conversational and generative help:

- **Chat (default)** — open conversational AI help: brainstorming, voice work, ad-hoc questions.
- **Draft mode** (v1.0.6) — a toggle next to the chat input turns the AI into a drafting partner: the message is treated as a premise and the AI writes manuscript-style prose from it (roughly 800–1200 words per segment), using attached context chips as canon. A **Continue** button extends the scene segment by segment. Off by default; drafted prose keeps the approved `--` punctuation.
- **Enhance mode** (v1.0.7) — highlight a passage and describe how it should be improved (sensory detail, mood, pacing, how a character comes across). Three reach levels: **Restate** (reword at the same length), **Default** (a richer pass), **Expanded** (a fuller rewrite). The rewrite appears in the chat for the writer to place manually; nothing changes automatically.

Two supporting controls (v1.0.7): **"New ask"** starts a fresh request without clearing the conversation, and attached chips can be marked **Canon** (writing stays consistent with them) or **Reference** (in-the-moment instructions lead).

### Context chips

The writer attaches profiles, summaries, and notes as chips. Each chip has include flags so the writer can choose what part of the profile actually goes into the prompt:

- **Summary** — the profile's `# Full AI Summary` section
- **Traits** — structured trait blocks
- **Overview** — the human-written `# Overview` section
- **Details** — the rest of the body

Defaults are Summary + Traits on. The Profile Builder chat uses a more permissive default that includes the entire profile.

Attached materials **persist for the whole conversation** (v1.0.10): the backend echoes the materials block it sent and the frontend stores it in the chat history as a hidden message, so profiles and the included chapter genuinely stay in front of the model on every later turn (they are sent over the wire once, then ride in history). The Canon/Reference stance stays active for as long as chips are attached. A VOICE FIDELITY rule in the base prompt keeps `[core]` voice and mannerism traits constant across turns and modes -- vary the expression, never drop the trait. The persisted chapter text is a snapshot from when it was attached; **New ask** refreshes it.

### Multi-character handling

When multiple character chips are attached, each profile's body is wrapped with explicit `=== BEGIN <TYPE>: <NAME> ===` / `=== END ===` delimiters in the prompt so the AI does not conflate traits across characters.

### Selection vs. full chapter

With nothing selected, the chat treats the whole chapter as context (capped at 100K characters). With a passage selected, only that passage is sent (capped at 30K). Selection highlight persists while the chat is focused.

## Series structure

A series is a parent folder that contains multiple book projects plus a shared `series-profiles/` directory.

- **Canonical profiles** live at the series level and stay consistent across books.
- **Arc files** live in each book's `profiles/arcs/` folder and overlay book-specific changes onto the canonical profile (different relationship status, new injuries, evolving motivations).
- **Profile merge** combines canonical + arc at request time so AI sees the right state for the book the writer is in.
- The **ChipPicker** offers a "This Book" / "Series Profiles" toggle so the writer can attach either source.
- **Story context** (`series.json` + `project.json`) is automatically prepended to every AI system prompt so the model knows the project's tone, genre, content mode, and POV defaults.

## Summaries

### Chapter summaries

One file per chapter under `summaries/chapters/`. Generated on demand from the chapter prose. Prompt is tuned to "cliff notes" framing: gist as primary directive, grounding rules secondary, no rewriting in polished prose.

### Scene summaries

Per-scene files at `summaries/scenes/<chapter-stem>/scene-NN.md`. Two ways to create them:

- **Auto-split** — the chapter's `---` horizontal rule scene breaks drive a sequential generator; each scene gets its own summary file with a yes / no / cancel overwrite prompt
- **Selection-based** — a modal lets the writer preview a summary of the selected text and pick the slot it belongs in

The sidebar shows scene summaries as expandable grandchildren under each chapter.

### Scene beats

Each scene summary can carry a **Beats** checklist — planning checkpoints like "MC finds the letter" — edited in the scene summary view (check off, edit in place, reorder, delete, add). Beats are stored as a `## Beats` section at the end of the scene's summary file, never in the manuscript prose, and regenerating the summary with AI leaves them untouched. The sidebar shows each scene's beats as read-only children with a done/total badge.

## Export

Two export modes, both run from `POST /api/export/full-manuscript` and `POST /api/export/snapshot`:

- **Full manuscript** — combines chapters in order into a single file in `exports/`. Optional flags append chapter summaries, scene summaries, notes, and profiles as `#` appendices.
- **Manual snapshot** — dated folder under `exports/snapshot-YYYY-MM-DD/` mirroring the project layout, with the same opt-in toggles for summaries, notes, and profiles.

## Audiobook Converter

A standalone workspace that turns a finished manuscript into an audiobook: per-chapter MP3s, a combined MP3, and an M4B with chapter marks. Reached from Project Home. Each audiobook is its own folder; the source manuscript is copied in and never modified.

The headline workflow is **draft locally, print premium** -- narrate the whole book free with the local narrator to hear awkward prose and fix pronunciations, then regenerate once with a paid voice when the book is final. Full specification: [`audiobook-converter-spec.md`](audiobook-converter-spec.md).

### Import

- DOCX, EPUB, Markdown, TXT, PDF, or an existing Storythread project
- Chapters detected per format (headings, EPUB spine, Markdown `#`, project manifest)
- Text-based PDFs only. A scanned book is refused rather than guessed at, because OCR errors would be spoken aloud. PDF import reconstructs what page layout removed: repeated headers and footers, page numbers, hyphens split across lines, and paragraph breaks. Every step reports what it did.
- Chapters can be added or removed from the workspace afterward

### The narration copy and its markers

The workspace edits a *copy* of the manuscript, so nothing here touches the book. Manual save only, same as the writing app.

| Marker | Effect |
|---|---|
| `[pause:0.8]` | Exactly that many seconds of silence |
| `[scene-break]` / `[chapter-break]` | Longer silence, lengths set per book |
| `[exclude]...[/exclude]` | Present on screen, never spoken |
| `[say:Hay-SOOS]Jesus[/say]` | One-spot pronunciation override |
| `[pace:+2]...[/pace]` | Faster or slower in steps, capped to the band the engine renders cleanly |
| `[voice:Elena]...[/voice]` | Narrated in that character's voice |

Plus a **pronunciation dictionary** for book-wide and app-wide rules, and **Preview selection** -- select any passage and hear exactly how it will sound, markers and all, free. Every marker has a "What's this?" card with a live-rendered audio example.

### The Formatting Walkthrough

A pop-out that walks the chapter from the cursor and stops wherever narration could be improved, one decision at a time. Edits land in the editor; Save still commits.

- **Beats** before and after mid-paragraph dialogue, between runs of three or more clipped sentences, and after interjections
- **Fixes** for markers typed wrong (`[pace:=2]`, an unclosed `[pause:0.4`), which the parser can otherwise only warn about
- **Word readings** for the 22 words where the narrator reliably guesses wrong (*read*, *wound*, *close*, *lead*, *bow*). Each pronunciation is offered as audio in the writer's own sentence; nothing is applied automatically, because which reading is right depends on what the writer meant
- Each suggestion type can be switched off, and one button adds every remaining pause at once behind a confirm. Marker fixes and word readings are never batched
- **[Show me how this works]** is a ten-step tutorial with before/after audio on every audible claim

### Narration engines

One engine per book; only the voice varies within it.

- **Free** -- local Kokoro-82M, 54 voices, an on-demand ~372 MB download (SHA256-verified, installed from inside the app, version-gated)
- **Budget** -- hosted Kokoro, the same 54 voices, roughly 35 cents for a novel
- **Standard** -- deliberately empty. Three candidates were auditioned and demoted; the app says so rather than recommending one it does not trust
- **Pro** -- Deepgram Aura-2, ElevenLabs Turbo

Demoted engines stay visible in a labelled drawer with the reason each was rejected. Narration borrows the writing API key by default or takes its own; keys are masked and never echoed back. Any voice or passage can be auditioned for a fraction of a cent, and a print pass quotes the exact dollar cost before spending, with the number repeated in the confirm.

### Cast and multiple voices

A **Cast** panel names the narrator and any characters and gives each a voice (a draft voice from the local narrator, a print voice from the paid engine). Manuscript names are offered as one-click additions. A **Find speakers** pass asks the AI who speaks each line and walks the proposals one at a time -- accept, correct the name, or keep the narrator. The AI proposes and never applies, and any suggestion it cannot quote from the text word for word is discarded. Recasting a character re-narrates only that character's lines.

### Generation, freshness, and storage

- Background generation with pause, resume, cancel, per-segment progress, and restart recovery
- Segments keep stable identities across edits, so inserting a paragraph regenerates one segment rather than the chapter
- A freshness dot per chapter: green matches, amber partly edited, red fully edited, hollow not yet narrated. Nothing regenerates on its own
- **Draft pass** trades seam quality for roughly half the time while testing; draft audio re-queues automatically before an export so it can never ship by accident
- A **Storage** screen measures the workspace by category and deletes only what is ticked. Free-to-rebuild categories start ticked; segment audio and finished exports never do
- Deleting segment audio while exports remain marks the book **Export Only**, honestly, since sections can no longer be regenerated without narrating again

### Output

Per-chapter MP3s with real ID3 titles, one combined MP3, and an M4B with navigable chapter marks, all mastered to the same broadcast-safe loudness. Book metadata and cover art are embedded. The audio assembler (~139 MB, LGPL FFmpeg) installs on demand from inside the app.

## Settings

A modal accessible from the sidebar. Sections:

- **AI Provider** — selector cards, one per connection, each with its own dedicated panel: tailored "How to connect" steps, its own masked API key, and a Test Connection button. Shipped connections: **OpenRouter** (recommended default; hosts the Prompt Caching toggle and the cost-tier slider), **NanoGPT** (pay-per-prompt, many unmoderated models; no published pricing, so the cost-tier filter is hidden), and **Local model** (below). Keys stay stored per provider — switching never loses one, and the switch only takes effect on Save, which reloads the model list from the new provider and warns if the saved default model isn't in its catalog. Panels are registry-driven (`providerMeta.ts` + `backend/app/ai/providers.py`), so a future connection is one entry on each side.
- **Local model** — a runtime on the writer's own machine (Ollama, LM Studio, llama.cpp). No API key and no per-token cost. The panel takes a server address and an **API style** (OpenAI-compatible or Ollama's native one, chosen explicitly rather than guessed); Test Connection distinguishes a bad address, nothing listening, and a server answering in the *other* style — naming the setting to flip in that last case. Replies from local reasoning models have inline `<think>...</think>` traces stripped before the writer or the conversation history sees them. **Only local destinations are accepted**: loopback, private-network addresses, or a `.local` name. A public address is refused with the rule explained, because every local runtime speaks the same API as a hosted one and without that line "Local model" would quietly become an undocumented way to connect any remote service.
- **Prompt Caching** (inside the OpenRouter panel, default on) — marks the unchanged part of each request (instructions + story context) as cacheable so supported models charge less and respond faster on repeats. Never sent to other providers.
- **Default model** — model picker populated from the active provider's catalog, with a cost-tier slider on providers that publish pricing. This is what any unassigned role uses.
- **Model Roles** — one model per KIND of job (see below)
- **Content mode** — project-level default (`general`, `mature`, `explicit`) overridable per request
- **Model Routing** — allowlist, blocklist, and per-model content-mode declarations enforced at request time
- **Theme** — light / dark
- **Debug options**

## Model Roles

The app asks an AI to do very different things, and the models available today are not equally good at all of them. A **role** is a kind of job. The writer assigns one model to each role, and every AI feature declares which role it belongs to — so assigning a model to Critique points the Smart Advisor, chapter summaries, scene summaries, AI Trim and the importance audit at it in one move.

Eight roles, each listing on screen exactly which features use it:

| Role | Used by |
|---|---|
| **Critique** | Smart Advisor pass, Writing Companion review categories, chapter and scene summaries, importance audit, AI Trim |
| **Character reasoning** | Profile Builder chat, Interview mode, full profile summaries, dialogue speaker analysis |
| **Brainstorming** | Writing Companion chat |
| **Structural analysis** | Scene break suggestions |
| **Prose** | Draft mode, Enhance mode, Revise suggestion |
| **Extraction** (cheap work) | Usage previews, Generate Overview, section summaries |
| **Long-context analysis** | *nothing yet* — arrives with the Weave |
| **Research transformation** | *nothing yet* |

The last two are marked "not used yet" on screen with the reason, rather than presenting a control that silently does nothing.

**The list is collapsed by default** — one line per role: name, the model currently chosen (or "Use Default Model"), and a one-line description that truncates rather than wrapping, so all eight fit on screen at once. Opening a row reveals the full explanation behind "What's this?" (what the job is, why it matters, and what a better model actually buys you there), the features it covers, and the two pickers. Only one row opens at a time, so the list never scrolls itself away. A broken assignment shows a warning icon on the collapsed row, so it is visible without opening anything.

The **From Source** picker greys out services that are not connected yet — no API key, or for a local model no address — and labels them "not connected" rather than hiding them, so what exists and what is merely unconfigured are distinguishable.

The **Model** picker opens with a short **Recommended** group of four to seven models drawn from the curated list and spread across price buckets, each labelled by bucket (Free / Lowest / Pricier / Priority Best) and ordered cheapest first. The bucket name is the whole recommendation — there is nothing further to read. The full catalog follows underneath, with the recommended entries not repeated. Recommendations only appear for providers whose catalog matches the curated ids; elsewhere the group is simply absent.

A role assignment is a **provider and a model together**, not just a model id, so different roles can live on different services — critique on OpenRouter while prose runs on a local model.

Two behaviours matter more than the rest:

- **Leaving a role unassigned is the supported default.** It falls through to the Default Model, exactly as the app behaved before roles existed. An upgrading install changes nothing until the writer changes something.
- **An assigned role never silently substitutes.** If it cannot run — no key for that service, an unreachable local server, a model the provider does not offer — the feature refuses and says why. Without this, a writer could assign Claude to prose, hit a missing key, and unknowingly have their book drafted by a different model.

Per-book role overrides are supported by the resolver but have no UI yet; today roles are app-wide.

## Content mode and routing

Three content modes: `general`, `mature`, `explicit`. Project-level default lives in `project.json`; individual requests may override.

Routing enforces two filters today:

- **Content compatibility** — `_validate_model_content_mode()` checks the model's declared `model_content_modes` in settings and rejects the request if the active mode is not allowed for that model
- **Allowlist / blocklist** — `_validate_model_allowed()` enforces per-project model lists

If no eligible model exists for a request, the app shows a clear error rather than silently degrading.

## Em dash enforcement

Three layers, all required:

1. **Prompt layer** — every AI system prompt explicitly bans em dashes
2. **Sanitizer layer** — `backend/app/ai/sanitizer.py` rewrites any em or en dash in the response to the approved `--` substitute before the frontend sees it. The conversational chat path additionally folds `--` into commas/colons; prose-producing paths (Draft mode, revise suggestions) keep `--`
3. **Style guide layer** — the project's `notes/style-guide.md` records the rule for the writer's reference

## Auto-update

The packaged app checks GitHub Releases on launch (production builds only; dev builds skip the check). When a new version is available:

1. A slim banner appears at the top of the app.
2. **View details** opens a modal with the release notes (rendered Markdown), a download progress bar, and an explicit **Download & Install** button.
3. After install completes, the writer clicks **Relaunch** to load the new version.

Updates never download or install automatically.

A first-launch-after-update banner highlights the new version with a changelog link and a donation nudge.

## Backend health monitor

A `useBackendHealth` hook polls `/health` every ten seconds. If the backend is unreachable, a single fixed-position banner replaces all the per-feature "Failed to fetch" errors that would otherwise clutter the UI. The banner dismisses itself when the backend returns.

## Donation infrastructure

- **About panel** with current version, license, donor self-attest flag, and links to GitHub Sponsors and Ko-fi
- **Periodic donation prompt** every 30–50 launches when the user has not marked themselves a donor (24-hour anti-nag dismiss)
- **Donor flag** is honor-system; checking it stops the prompts and shows a "Thank you for donating!" badge in the sidebar

## Packaging and distribution

- Tauri v2 bundle on Windows, distributed as a signed `.msi` from GitHub Releases
- FastAPI backend frozen via PyInstaller and shipped as a Tauri sidecar so end users do not need Python
- Update bundles are signed with a minisign key; the public key is embedded in the v1.0.0 binary and verified on every update download
- Apache 2.0 license
