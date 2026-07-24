# Features

This is a snapshot of what Storythread Studio does today. For where it is going next, see [`roadmap.md`](roadmap.md).

## Editor

- CodeMirror 6 Markdown editor with a serif typeface optimized for long reading
- Manual save (`Ctrl+S` or Save button); unsaved-change indicator with a confirm-before-close prompt; saving refreshes the sidebar title from the chapter's `# Heading`
- Session undo and redo
- Formatting toolbar, font selector, find and replace
- A **Tools** pulldown in the title bar collects the one-off actions: Generate Scene Summaries, Suggest Scene Breaks, Chapter Summary, Reader Mode, and Export
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
- **Side / Background** — every section is a single free-text field; Quick Build appends lines into them. Trait-section headings are shared between templates, and the parser round-trips plain paragraphs under a trait heading instead of dropping them.

The Profile Builder's character list splits into collapsible **Main** and **Side / Background** groups; the chat attachment picker mirrors the same grouping.

### Personality spine dropdowns (characters)

Two cheat-sheet dropdowns in the profile header, under Status/Tags, each with per-option "What's this?" help: **Personality (Enneagram)** — 9 types, each summary carrying the type's core desire, core fear, and stress behavior — and **Story Role (Archetype)** — the 12 Jungian archetypes plus Comic Relief, Confidant, and Rival. Picking one inserts a fiction-first starting paragraph (behavior + speech pattern + how they crack under pressure, ending in a trigger/origin fill-in hook) into Personality Traits — a `[core]` trait block on Main, appended text on Side — with a confirmation note showing where it went. A Story Role pick also fills the Role field and merges its key-aspect Tags; the Role field additionally has a quick-pick list grouped Popular / Less Common / Niche. All canned text shipped in code — writer-initiated insertion, zero AI calls.

### Quick Build (side/background profiles)

Opens at the top of Side/Background character profiles. Pick a Story Role (weights the rolls), then reroll curated sentence-length options per section — Physical, Mannerism, Voice, Want/Motivation — and click any option to append it to the matching section as a new line. Pools run 50+ options per section and rerolls page through the whole pool before anything repeats. An opt-in **NSFW toggle** (red, per character, never automatic) swaps the pools: off = normal options with the Explicit box greyed out; on = NSFW pools replace normal; the Explicit checkbox swaps in a third fill-in-the-blank tier ("secretly wants to be ____") the writer completes.

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

## Settings

A modal accessible from the sidebar. Sections:

- **AI Provider** — selector cards, one per connection, each with its own dedicated panel: tailored "How to connect" steps, its own masked API key, and a Test Connection button. Shipped connections: **OpenRouter** (recommended default; hosts the Prompt Caching toggle and the cost-tier slider) and **NanoGPT** (pay-per-prompt, many unmoderated models; no published pricing, so the cost-tier filter is hidden). Both keys stay stored — switching never loses one, and the switch only takes effect on Save, which reloads the model list from the new provider and warns if the saved default model isn't in its catalog. Panels are registry-driven (`providerMeta.ts` + `backend/app/ai/providers.py`), so a future connection (Ollama, LM Studio, llama.cpp, custom URL) is one entry on each side.
- **Prompt Caching** (inside the OpenRouter panel, default on) — marks the unchanged part of each request (instructions + story context) as cacheable so supported models charge less and respond faster on repeats. Never sent to other providers.
- **Default model** — model picker populated from the active provider's catalog, with a cost-tier slider on providers that publish pricing
- **Content mode** — project-level default (`general`, `mature`, `explicit`) overridable per request
- **Model Routing** — allowlist, blocklist, and per-model content-mode declarations enforced at request time
- **Theme** — light / dark
- **Debug options**

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
