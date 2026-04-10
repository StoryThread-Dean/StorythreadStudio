# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Status

**Current phase: Phase 5A (AI Respec -- Profile Builder Rebuild) -- in progress.**

Phases 0-4 are complete and merged into `main`. Phase 5 was redesigned into an AI Respec with 5 sub-phases (5A-5E). Full plan in `.claude/plans/polished-moseying-shannon.md`.

### Phases 1-3 -- Complete
Core app: Tauri shell + React scaffold, FastAPI backend, project create/open, CodeMirror Markdown editor, file save, profiles (character/relationship/location/lore/summaries), OpenRouter integration, 9 writing assistants, Settings modal, em dash enforcement.

### Phase 4 + Polish -- Complete
Context chips, ai_usage_example generation, section/full summaries, Profile Builder chat with 7 behavior modes, ToolKit context selector, visual polish pass. All merged to main.

### Phase 5A -- Profile Builder Rebuild -- Complete
Major respec of how AI integrates with StoryForge. Key changes shipped:
- **Importance levels** replace influence scale: Core / Present / Background / Contextual / Hidden
- **Description-only trait blocks**: ai_usage_example and notes fields removed from TraitBlock
- **Adaptive word count gauge**: per-importance thresholds with visual color-coded bar (Sparse/Basic/Good/Detailed/Wordy/Bloated)
- **4 simplified behavior modes** replace 7: Chat, Refine, Extract Traits, Check Consistency
- **ProfileBuilder.tsx rebuilt from scratch**: cleaner code, new trait block cards, word gauge component
- **Backend updated**: profiles.py reads old `influence` format + writes new `importance` format, ai.py endpoint renamed to `generate-usage-preview`, behavior prompts updated for importance terminology
- **TypeScript types updated**: ImportanceLevel, ProfileBehaviorMode, GenerateUsagePreviewPayload replace old types
- **Backward compatible**: old profiles load correctly, importance auto-migrated from influence on read

### Phase 5B -- Next
AI tools: Trim tool, Importance Audit, "How AI uses this" preview, series settings injection.

### Remaining Sub-phases
- **5C:** Series/Book directory structure (series.json, canonical profiles, arc files, merge logic)
- **5D:** Toolkit & Routing (auto-suggest, content mode routing, allowlist/blocklist)
- **5E:** Writing Companion (unified design for editor right panel, chat in main editor)

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

Note: `ai_usage_example` was removed in Phase 5A. The "How AI uses this" preview is now generated on demand and shown in a popover -- not stored in Markdown.

AI must **never silently overwrite** human-authored prose, profile descriptions, notes, or story drafts. All other AI output goes to the side panel only, where the writer copies it manually.

### The Em Dash Rule

**AI must never output em dashes (`--` is fine; `--` is not).** This is a locked product rule enforced at three layers:

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

- **Dark mode only** -- deep navy-black background (inspired by Quarkle.ai, approximately `#070724`), white/light text, high contrast. No light mode in MVP.
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
