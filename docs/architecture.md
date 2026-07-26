# Architecture

## High-level shape

Storythread Studio is a three-layer local application. Nothing leaves the user's machine except AI requests, which go directly from the local backend to the selected AI provider (OpenRouter by default, or NanoGPT).

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

A local-only HTTP server bound to `127.0.0.1:8000`. Handles file I/O, parses Markdown profiles into structured data, builds AI prompts, calls the active AI provider, runs the em-dash sanitizer over every response, and returns results to the frontend. In packaged builds the backend is frozen into a single `.exe` via PyInstaller and bundled as a Tauri sidecar.

**AI provider dispatch** (v1.0.10): `backend/app/ai/providers.py` holds a frozen `ProviderConfig` per connection (base URL, key storage field, capability flags). `backend/app/ai/openrouter.py` -- historically named for the first provider -- is a generic OpenAI-compatible client parameterized by that config, and `_resolve_model_and_key()` in `routers/ai.py` is the single seam that resolves `(provider, api_key, model_id)` for all AI endpoints, so switching providers in Settings reroutes every AI feature at once. Adding a provider is one `ProviderConfig` plus one panel entry in `app/src/components/settings/providerMeta.ts`. API keys never reach the WebView; each provider's key is stored (and masked) independently in global settings. Prompt caching (OpenRouter only, gated by `supports_cache_control`) marks the system prompt with an Anthropic-style `cache_control` block when the setting is on.

## Dual storage model

Two storage systems work together:

- **Markdown files** are the permanent source of truth. Chapters, profiles, notes, and summaries live as `.md` files in the project folder. They are human-readable and can be version-controlled or backed up as plain text.
- **SQLite** (`<project>/.storythread/app.db`) is a fast local cache. It stores parsed profile data, app settings, and the model registry cache. The cache can be rebuilt from Markdown if it is corrupted or deleted.
- **SQLite, app-level** (`~/.storythread/names.db`) holds the Name Generator's pools (20 cultures x 5 eras of given names + surnames), seeded at backend startup from JSON shipped inside the app (`backend/app/data/names/`, bundled into the frozen sidecar via `backend.spec` datas). A version stamp triggers reseeding on app updates; deleting the file rebuilds it. Served by `GET /api/names/*`.

Markdown is the filing cabinet; SQLite is the index card on the desk.

## Project folder layout

Every project is a folder the user owns. Storythread does not touch anything outside of it.

```text
MyNovel/
  project.json                     project settings
  manuscript/                      chapter .md files (one chapter per file)
    structure.json                 acts + chapter reading order (only once acts are used)
    01-chapter-1.md
    02-the-storm.md
  notes/                           outline, style guide, themes
    outline.md
    style-guide.md
    themes.md
  profiles/                        canonical profiles for this book
    characters/
    relationships/
    locations/
    lore/
    chapters/                      legacy (Phase 2 profile-based summaries); still scaffolded
    scenes/                        legacy; current summaries live in summaries/ below
    arcs/                          (series projects only) per-book overrides
      characters/
      relationships/
  summaries/
    chapters/                      one summary per chapter
    scenes/<chapter-stem>/         per-scene summaries (+ optional ## Beats section)
      scene-01.md
      scene-02.md
  exports/                         full-manuscript and dated snapshots
  .storythread/                    app cache; safe to delete and rebuild
    app.db
    ui-state.json                  per-book remembered UI state (sidebar collapse etc.)
    cache/
    logs/
```

### Acts and chapter order (`manuscript/structure.json`)

The manuscript hierarchy is Story > Act > Chapter > Scene > Beat:

- **Acts** and chapter **reading order** live in one small manifest,
  `manuscript/structure.json` (`{version, acts: [{id, title, chapters: [filenames]}], unassigned: [filenames]}`).
  Moving or reordering chapters edits the manifest only -- files are never
  renamed or renumbered by a move. Projects that never use acts have no
  manifest and fall back to plain filename order everywhere.
- The manifest **self-heals** on every load: files deleted by hand are
  dropped, files added by hand are appended to `unassigned`, and a corrupt
  manifest is treated as absent rather than crashing the chapter list.
- **Scenes** stay embedded in the chapter as `---` horizontal-rule sections
  (parsed by `scene_parser.py`); their summaries live in the per-scene
  sidecar files.
- **Beats** are a `## Beats` checklist (`- [ ] text` / `- [x] text`) stored
  as the last section of a scene's sidecar summary file -- planning data
  never touches the manuscript prose. Saving a scene summary without a
  beats payload preserves the section, so AI regeneration cannot wipe beats.

### Chapter renames

Renaming a chapter rewrites its `# Heading` AND renames the file so the slug
matches the title (the numeric `NN-` prefix is preserved). The backend
cascades everything keyed to the old filename stem: the chapter summary
file, the scene-summary folder, the structure.json entry (in place, so act
membership and position survive), and writing-progress history rows. Steps
after the file rename are fail-soft with per-step flags in the response.

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

Book Details fields (`genre`, `tone`, `theme`, `setting`, `point_of_view`,
`tense`, `target_audience`) are added to `project.json` the first time the
writer fills them in the sidebar's Book Details panel; all of them are
auto-injected into AI prompts as the STORY CONTEXT block (book values
override series values). The Word Count target is deliberately NOT stored
here -- it lives in `notes/outline.md` frontmatter (`target_word_count`),
the Writing Progress gauge's single source of truth; the Book Details panel
reads and writes it through the settings endpoints.

## Editor behavior

- One chapter open at a time
- Manual save (`Ctrl+S` or the Save button); unsaved changes show an indicator and prompt before close
- Session-only undo and redo via CodeMirror history
- Find and replace, formatting toolbar, font selector, light/dark theme
- Smart Advisor inline overlays decorate the document but never modify it; the document is only changed when the writer accepts a suggestion or types

## API surface

Routes are grouped by router. Each router carries its own prefix (shown in the heading); the health check is unprefixed.

### Health
```
GET    /health
```

### Projects — `/api/projects`
```
POST   /create
POST   /open
POST   /create-in-series
GET    /recent
DELETE /recent/{project_id}
GET    /settings
PUT    /settings
GET    /ui-state               PUT    /ui-state    (per-book sidebar memory)
GET    /inspect-folder
POST   /apply-outline-template
```

### Series — `/api/series`
```
POST   /create
POST   /open
POST   /list-books
```

### Documents — `/api/documents`
```
GET    /chapters
GET    /chapter                POST   /chapter                DELETE /chapter
POST   /create-chapter
POST   /rename-chapter         (renames the file + cascades summaries/structure/progress)
GET    /manuscript-content
GET    /note                   POST   /note
GET    /outline                POST   /outline
GET    /chapter-summary        POST   /chapter-summary        DELETE /chapter-summary
GET    /chapter-summaries
GET    /scene-summary          POST   /scene-summary          DELETE /scene-summary
GET    /scene-summaries        DELETE /scene-summaries
GET    /all-scene-summaries
POST   /scene-beats            (rewrites only a scene's ## Beats section)
```

### Structure — `/api/structure`
```
GET    /                       (acts + chapter order; synthesized when no manifest)
PUT    /                       (full replacement; validated, healed, echoed)
```

### Profiles — `/api/profiles`
```
GET    /list
GET    /profile
POST   /create
POST   /save
DELETE /profile
POST   /import
GET    /merged                 (series: canonical + arc overlay)
GET    /arc/list
GET    /arc/profile
POST   /arc/create
POST   /arc/save
```

### AI — `/api/ai`
```
GET    /models
POST   /editor-chat            (Writing Companion: chat / Draft / Enhance)
POST   /editor-pass            (Smart Advisor category passes)
POST   /revise-suggestion
POST   /suggest-scene-breaks
POST   /profile-chat           (Profile Builder companion)
POST   /generate-usage-preview
POST   /trim-trait
POST   /audit-importance
POST   /generate-section-summary
POST   /generate-full-summary
POST   /generate-chapter-summary
POST   /split-chapter-scenes
POST   /generate-scene-summary
```

### Settings — `/api/settings`
```
GET    /
PUT    /
POST   /test-connection
```

### Progress — `/api/progress`
```
GET    /summary                (project completion gauge)
GET    /daily                  (daily tracker + 7-day sparkline)
```

### Search — `/api/search`
```
POST   /find
POST   /replace                (snapshots touched files first)
POST   /restore                (undo from the most recent snapshot)
```

### Export — `/api/export`
```
POST   /full-manuscript        (markdown / txt / docx / epub; optional appendix flags)
POST   /snapshot
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
