# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Status

**Status: shipped.** The current release is **v1.0.8** -- see `CHANGELOG.md` for the full release history and `docs/features.md` for what the product does today.

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

# Verify the backend imports cleanly without starting the server
uv run python -c "from app.main import app; print('OK')"

# Run backend tests
uv run pytest

# Check code for problems and auto-format
uv run ruff check .
uv run ruff format .
```

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

# Check TypeScript and lint frontend code
npm run lint
```

---

## Testing

Two automated test suites plus a manual checklist. All three are wired into `/pre-release` (see `.claude/commands/pre-release.md`).

### Test layout

- `backend/tests/` -- pytest + pytest-asyncio. Uses FastAPI's `TestClient` for HTTP-level tests and `async with open_db(tmp_path)` for store-level tests. Test files named `test_*.py`. Current files:
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
  - `test_audiobook_workspace_routes.py` -- /api/audiobook import/project/narration/pronunciations/recents/segments end to end
  - `test_audiobook_segmenter.py` -- segment sizing (paragraph grouping, sentence fallback, marker cuts) + stable-ID identity across inserts/edits/chapter renumbering
  - `test_audiobook_generation.py` -- generation engine: run lifecycle, per-segment persistence, pause/cancel between segments, retry cap + pessimistic attempts, truncation validation, restart recovery, workspace lockfile, narration-settings/dialogue/marker pace flow + staleness
  - `test_audiobook_local_worker.py` -- kokoro-worker manager: KokoroBackend transport errors, spawn command + version gate, install flow (SHA256 integrity, polluted-dir replace, locked-file loud failure), voices/preview/preview-selection endpoints
  - `test_audiobook_marker_demos.py` -- WAV stitcher (exact silence, format guards), audible marker demos (scripts render clean, speeds match narrated values), render_marked_text (rules, silence, pace spans, cut-into-span warnings, trace)
- `app/src/**/*.test.{ts,tsx}` -- vitest + `@testing-library/react`, runs in jsdom. Current files:
  - `src/components/progress/ProjectCompletionGauge.test.tsx` -- compact bar, slide-over, serial mode
  - `src/components/editor/ThesaurusPopover.test.tsx` -- thesaurus popover
  - `src/components/sidebar/ActGroup.test.tsx` -- acts tree pieces (ActGroup + RowMenu)
  - `src/hooks/useProjectUiState.test.ts` -- per-book UI-state hook (load guard, debounce)
  - `src/utils/spellcheck.test.ts` -- spellcheck suggestions
  - `src/utils/buildEditorChatPayload.test.ts` -- Writing Companion payload builder + history persistence (appendTurnToHistory)
  - `src/utils/modelFiltering.test.ts` -- model list filtering + recommended models (provider-aware)
  - `src/components/settings/ProviderPanel.test.tsx` -- per-provider Settings panels + PROVIDER_META registry
  - `src/data/characterSpines.test.ts` -- Enneagram/archetype canned-content contracts (fiction-first, fill-in hooks, no em dashes)
  - `src/data/traitPools.test.ts` -- trait randomizer: tier replacement semantics, archetype flavor bias, deterministic rolls
  - `src/data/names/fantasyNames.test.ts` -- fantasy name assembly: 12-race roster, deterministic rng, speakability fuzz, phonology disjointness
  - `src/components/profiles/NameGeneratorPanel.test.tsx` -- generator panel: optgroups, era hiding for races, 6+6 deals, partial accept, fallback note
  - `src/features/audiobook/AudiobookDashboard.test.tsx` -- audiobook dashboard: recents render, empty state, open flow, remove-keeps-files endpoint
  - `src/features/audiobook/WorkspaceView.test.tsx` -- narration editor: inline pause insertion (scroll preserved), [say]/[exclude]/pace wraps, Remove marker stripping, manual save PUT + chapter re-derive, marker help panel, pronunciation dialog
  - `src/features/audiobook/GenerationPanel.test.tsx` -- narration rail: voices load, generate posts + live progress, paused-run resume, failed-segment surfacing, up-to-date force flow, engine-unavailable message
  - `src/features/audiobook/markers.test.ts` -- stripAudioMarkers (wrappers dissolve, words never deleted) + paragraphBoundsAt
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
- **SQLite** (`<project>/.storythread/app.db`) -- a fast local cache. Stores parsed profile data, app settings, and the model registry cache. Can be rebuilt from Markdown if corrupted or deleted.

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
- **Explicit context attachment** -- AI never has implicit access to the full project. The writer attaches profiles and summaries deliberately as context chips.
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

| File | Contains |
|---|---|
| `docs/product-scope.md` | Core goals, writing philosophy, locked product rules, in/out-of-scope |
| `docs/architecture.md` | Three-layer architecture, dual storage model, folder layout, current API surface |
| `docs/features.md` | What the product does today: editor, Profile Builder, Smart Advisor, Writing Companion, series, exports, settings |
| `docs/roadmap.md` | Scheduled / Proposed / Nice-to-Have features, plus dropped items |
| `docs/RELEASING.md` | Release runbook (signing key setup, per-release checklist) |
| `CHANGELOG.md` | Shipped changes per version |
| `README.md` | Public-facing project description, install instructions, donation links |
