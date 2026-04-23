# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Status

**Current phase: Phase 6 (Export and Polish) -- complete. Post-MVP polish next.**

Phases 0-4, 5A-5E, and 6 are complete and merged into `main`. Phase 5 was redesigned into an AI Respec with 5 sub-phases (5A-5E). Phase 6 delivered full-manuscript export (with opt-in chapter summaries / scene summaries / notes / profiles), manual snapshot export, scene summaries (per-scene files with auto-split and selection-based preview), summary quality tuning (cliff-notes reframing + preamble filter), relationship-aware full profile summaries, and a backend-health banner for uniform error handling.

### Phases 1-3 -- Complete
Core app: Tauri shell + React scaffold, FastAPI backend, project create/open, CodeMirror Markdown editor, file save, profiles (character/relationship/location/lore/summaries), OpenRouter integration, 9 writing assistants, Settings modal, em dash enforcement.

### Phase 4 + Polish -- Complete
Context chips, ai_usage_example generation, section/full summaries, Profile Builder chat with 7 behavior modes, ToolKit context selector, visual polish pass.

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

## What StoryForge Is

A **Windows desktop, local-first Markdown writing app** for fiction writers. The writer does all the drafting. AI acts as reviewer, editor, and brainstorming partner -- never a ghostwriter. AI assists on demand; it never auto-applies changes or autonomously updates story content.

---

## Planned Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Desktop shell | Tauri v2 | Packages the app as a native Windows `.exe`; bridges OS features (file dialogs, window management) to the web UI |
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
StoryForge/               <- repo root (spec docs + config live here)
  app/                    <- Tauri + React frontend (run npm commands from here)
    src/                  <- React/TypeScript source files
    src-tauri/            <- Tauri/Rust shell
    public/               <- static assets
  backend/                <- Python FastAPI backend (run uv commands from here)
    app/
      main.py             <- FastAPI entry point and route registration
      __init__.py         <- marks app/ as a Python package
    pyproject.toml        <- Python dependencies managed by uv
  01-product-scope.md     <- spec docs
  ...
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

## Architecture Overview

StoryForge uses a **three-layer local architecture**. No cloud. No sync. Everything runs on the user's machine.

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
- **SQLite** (`<project>/.storyforge/app.db`) -- a fast local cache. Stores parsed profile data, settings, model registry, and the assistant registry. Can be rebuilt from Markdown if corrupted or deleted.

Think of Markdown as the filing cabinet and SQLite as the index cards on your desk -- the cabinet is what matters; the index cards just make lookup faster.

### Project Folder Layout

Each writing project the user creates gets its own folder:

```
MyNovel/
  project.json          <- project settings (model, content mode, etc.)
  manuscript/           <- chapter .md files
  notes/                <- outline, style guide, themes
  profiles/             <- characters, relationships, locations, lore, summaries
  exports/              <- combined manuscripts and dated snapshots
  .storyforge/          <- app.db, cache, logs (NOT source code)
```

Full folder schema is in `02-architecture-and-storage.md`.

---

## AI Boundaries (Critical -- Never Violate)

### The Write Boundary

AI output may only be written directly to these **designated generated-content fields** in Markdown:

- `ai_profile_summary`
- `ai_section_summary`
- `chapter_summary`
- `scene_summary`

AI must **never silently overwrite** human-authored prose, profile descriptions, notes, or story drafts. All other AI output goes to the side panel only, where the writer copies it manually.

### The Em Dash Rule

**AI must never output em dashes (`,;:` is fine; `--` is not).** This is a locked product rule enforced at three layers:

1. **Prompt layer** -- every system prompt explicitly bans em dashes
2. **Sanitizer layer** -- post-process all model output to detect and replace em dashes before displaying
3. **Style guide layer** -- the project's style guide Markdown file records this rule

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

## Development Phases (Reference)

| Phase | Goal |
|---|---|
| 0 | Design freeze: schemas, wireframes, routing rules |
| 1 | Tauri shell + React scaffold + FastAPI + Markdown editor (no AI) |
| 2 | Profile system: character, relationship, location, lore, summaries |
| 3 | OpenRouter integration + first AI assistants |
| 4 | Profile-aware AI: context attachment, summaries, Profile Builder chat |
| 5A | AI Respec: Profile Builder rebuild (importance levels, word gauge, simplified modes) |
| 5B | AI tools: trim, audit, usage preview, series context injection |
| 5C | Series/Book structure: series.json, canonical profiles, arc files |
| 5D | Toolkit & routing: auto-suggest, content mode routing, allowlist/blocklist |
| 5E | Writing Companion: unified editor right panel, chat in main editor |
| 6 | Export, polish, summary quality tuning |

Full phase details and the MVP acceptance checklist are in `06-roadmap-and-mvp-plan.md`.

---

## Key Reference Files

| File | Contains |
|---|---|
| `01-product-scope.md` | Core goals, writing philosophy, locked rules, non-goals |
| `02-architecture-and-storage.md` | Folder structure, editor behavior, storage responsibilities |
| `03-profile-builder-spec.md` | Profile types, sections, trait block format, importance levels |
| `04-ai-assistants-and-routing.md` | Assistant categories, output schemas, routing architecture, em dash enforcement |
| `05-api-ui-and-data-models.md` | FastAPI endpoints, SQLite schema, screen layout plan |
| `06-roadmap-and-mvp-plan.md` | Build phases, first 10 tasks, MVP acceptance checklist |
