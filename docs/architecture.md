# Architecture

## High-level shape

Storythread Studio is a three-layer local application. Nothing leaves the user's machine except AI requests, which go directly from the local backend to OpenRouter.

```
[ Tauri window ]
       |
[ React + TypeScript UI ]    panels, editor, chat, overlays
       |  HTTP on 127.0.0.1:8000
[ FastAPI backend (Python) ] file I/O, parsing, AI routing, validation
       |
[ Markdown files + SQLite ]  dual storage
```

The frontend never reads files directly; every read and write goes through the backend.

## Layers

### Desktop shell — Tauri v2

Tauri provides the native window, OS integration (file dialogs, opener), and packaging into a single Windows `.msi`. The shell also spawns the Python backend as a sidecar process at app launch and tears it down at exit. Auto-update support is wired through Tauri's updater plugin against a `latest.json` manifest hosted on GitHub Releases.

### Frontend — React + TypeScript (Vite)

Renders the entire UI. Communicates with the backend over `fetch` to `http://127.0.0.1:8000`. Uses CodeMirror 6 for the Markdown editor, Zustand for shared state, and shadcn/ui + Tailwind CSS v4 for components. Theme support (light + dark) is application-wide.

### Backend — Python + FastAPI (managed by uv)

A local-only HTTP server bound to `127.0.0.1:8000`. Handles file I/O, parses Markdown profiles into structured data, builds AI prompts, calls OpenRouter, runs the em-dash sanitizer over every response, and returns results to the frontend. In packaged builds the backend is frozen into a single `.exe` via PyInstaller and bundled as a Tauri sidecar.

## Dual storage model

Two storage systems work together:

- **Markdown files** are the permanent source of truth. Chapters, profiles, notes, and summaries live as `.md` files in the project folder. They are human-readable and can be version-controlled or backed up as plain text.
- **SQLite** (`<project>/.storythread/app.db`) is a fast local cache. It stores parsed profile data, app settings, and the model registry cache. The cache can be rebuilt from Markdown if it is corrupted or deleted.

Markdown is the filing cabinet; SQLite is the index card on the desk.

## Project folder layout

Every project is a folder the user owns. Storythread does not touch anything outside of it.

```text
MyNovel/
  project.json                     project settings
  manuscript/                      chapter .md files (one chapter per file)
    01-chapter-one.md
    02-chapter-two.md
  notes/                           outline, style guide, themes
    outline.md
    style-guide.md
    themes.md
  profiles/                        canonical profiles for this book
    characters/
    relationships/
    locations/
    lore/
  arcs/                            (series projects only) per-book overrides
    characters/
    relationships/
  summaries/
    chapters/                      one summary per chapter
    scenes/<chapter-stem>/         per-scene summaries
      scene-01.md
      scene-02.md
  exports/                         full-manuscript and dated snapshots
  .storythread/                    app cache; safe to delete and rebuild
    app.db
    cache/
    logs/
```

For a multi-book series, an additional `series.json` and shared `series-profiles/` folder live one level above each book.

## project.json

```json
{
  "project_id": "uuid",
  "title": "Project Title",
  "description": "Optional description",
  "content_mode_default": "general",
  "default_model": "openrouter/model-name",
  "model_routing_enabled": true,
  "allow_explicit_routing": true,
  "cost_tier": "balanced",
  "active_style_guide": "notes/style-guide.md",
  "series_id": "uuid-or-null",
  "series_path": "absolute-path-or-null",
  "created_at": "ISO_DATETIME",
  "updated_at": "ISO_DATETIME"
}
```

## Editor behavior

- One chapter open at a time
- Manual save (`Ctrl+S` or the Save button); unsaved changes show an indicator and prompt before close
- Session-only undo and redo via CodeMirror history
- Find and replace, formatting toolbar, font selector, light/dark theme
- Smart Advisor inline overlays decorate the document but never modify it; the document is only changed when the writer accepts a suggestion or types

## API surface

Routes are grouped by router. All paths are prefixed with `/api` unless noted.

### Health
```
GET    /health
```

### Projects
```
POST   /projects/create
POST   /projects/open
POST   /projects/create-in-series
GET    /projects/{project_id}
POST   /projects/{project_id}/snapshot
```

### Series
```
POST   /series/create
POST   /series/open
GET    /series/list-books
```

### Documents
```
GET    /projects/{project_id}/documents
GET    /documents/{document_id}
PUT    /documents/{document_id}
POST   /projects/{project_id}/documents/create
DELETE /documents/{document_id}
```

### Profiles
```
GET    /projects/{project_id}/profiles
GET    /profiles/{profile_id}
PUT    /profiles/{profile_id}
POST   /projects/{project_id}/profiles/create
POST   /projects/{project_id}/profiles/import-fork
DELETE /profiles/{profile_id}
GET    /profiles/merged                          (series: canonical + arc overlay)
GET    /profiles/arc/list
GET    /profiles/arc/profile
POST   /profiles/arc/create
PUT    /profiles/arc/save
POST   /profiles/{profile_id}/generate-section-summary
POST   /profiles/{profile_id}/generate-full-summary
POST   /profiles/{profile_id}/generate-usage-preview
POST   /profiles/{profile_id}/trim-trait
POST   /profiles/{profile_id}/audit-importance
POST   /profiles/{profile_id}/builder-chat
```

### AI
```
POST   /ai/run-assistant
POST   /ai/editor-chat
POST   /ai/editor-pass
POST   /ai/revise-suggestion
POST   /ai/test-connection
GET    /ai/models
```

### Settings
```
GET    /settings
PUT    /settings
POST   /settings/openrouter-key
```

### Export
```
POST   /export/full-manuscript
POST   /export/snapshot
```

## CORS

The backend accepts requests from these origins:

- `http://localhost:1420` and `http://127.0.0.1:1420` (Vite dev server)
- `tauri://localhost` (Tauri v1 production scheme)
- `http://tauri.localhost` and `https://tauri.localhost` (Tauri v2 production scheme on Windows WebView2)

Adding a new browser-style runtime requires updating this allowlist.

## What goes where

| Concern | Owner |
|---|---|
| User-authored prose, profiles, notes | Markdown files in the project folder |
| Generated AI summaries, examples | Designated Markdown fields only |
| App settings (API key, model picks, allowlists) | `~/.storythread/settings.json` |
| Parsed profile cache, model registry | Per-project `.storythread/app.db` |
| Project state (current chapter, scroll, etc.) | In-memory only; no autosave |

## AI write boundary

AI may only write directly to these designated fields in Markdown:

- `ai_profile_summary`
- `ai_section_summary`
- `chapter_summary`
- `scene_summary`

All other AI output is shown to the writer for explicit copy-paste. This is a hard product rule, enforced in code.
