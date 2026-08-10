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

### Two on-demand companion processes (Audiobook Converter)

Neither ships inside the installer, because together they would roughly quadruple its size for a feature not every writer uses. Both are downloaded from inside the app, SHA256-verified before extraction, and installed under the user's app data.

**`kokoro-worker.exe`** -- the local narrator (~372 MB), a tiny FastAPI service wrapping `kokoro-onnx`, versioned and released independently of the app as a GitHub *prerelease* (a normal release would become `releases/latest` and break the updater's `latest.json` lookup). The backend spawns it on demand, talks to it over `127.0.0.1`, and gates on version: an installed worker from a different release is refused with a one-click Update rather than being spoken to and misunderstood. The worker watches its parent process and exits if the backend dies, so no orphan survives a crash. It lives in `kokoro-worker/` in the repo and is built by `scripts/build-worker.ps1`; the built artifact's hash is pinned in `backend/app/audiobook/local_worker.py`, and publish-and-pin always travel together.

**FFmpeg** (~139 MB, LGPL build) -- assembly only: loudness normalization, MP3 encoding, and M4B chapter marks. Invoked as a subprocess; the backend never links it.

A third thing that is *not* a process: `espeak-ng` ships inside the worker's environment as `kokoro-onnx`'s grapheme-to-phoneme step. It is deliberately absent from the backend, which has no phonemizer at all -- adding one would drag native libraries into the frozen sidecar. `scripts/audition-heteronyms.py` reaches into the worker's environment to use it, which is how pronunciation claims get verified without listening to anything.

## Dual storage model

Two storage systems work together:

- **Markdown files** are the permanent source of truth. Chapters, profiles, notes, and summaries live as `.md` files in the project folder. They are human-readable and can be version-controlled or backed up as plain text.
- **SQLite** (`<project>/.storythread/app.db`) is a fast local cache. It holds the writing-progress log, the model registry cache, and the Weave's graph index (Threads, Ties, facts and mentions). Every row in it is derivable from Markdown, and deleting the file rebuilds it. It does **not** hold app settings -- those live in `~/.storythread/settings.json`.
- **Weaving sessions** (`<project>/.storythread/weave/runs/<run-id>.json`) are the one thing under `.storythread/` that is **not** a cache. They record what the writer answered -- applied, deferred, retired, muted -- which is not derivable from anything, and deleting `app.db` must never lose it. Written atomically (tmp + `os.replace`), the same pattern `settings_store` and `structure_store` use.

### The Weave's index, and why it can never serve stale data

"An index failure must never block a save" is right on its own and creates a worse
bug on its own: the Markdown write succeeds, the index write fails, and the graph
then answers questions with stale information, confidently. So any write that
fails to update the index sets `codex_meta.dirty`, and **no read is served while
that flag is set** -- the next reader rebuilds first. A second mechanism catches
what no flag could: `indexed_source_revision` fingerprints the `codex/` folder, so
an out-of-band edit (the writer opening a Thread in another editor, or restoring a
backup) is detected on the next read whatever the flag says.
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
  codex/                           the Weave: one linked, time-aware world model
    types.json                     which kinds of thing this world has, and which
                                   connections are meaningful between them
    characters/  relationships/  locations/  lore/
    factions/  religions/  governments/  deities/  creatures/  cultures/
    objects/  concepts/  events/
  exports/                         full-manuscript and dated snapshots
  .storythread/                    app cache; safe to delete and rebuild
    app.db
    ui-state.json                  per-book remembered UI state (sidebar collapse etc.)
    weave/runs/<run-id>.json       Weaving sessions -- NOT a cache, see below
    cache/
    logs/
```

### The Weave (`codex/`)

A Thread is one entry -- a character, a place, a faction, an idea -- and it is an
ordinary Markdown file, so copying the project folder takes the whole world model
with it. What makes it more than a folder of profiles is that a Thread carries a
**Run**: a list of facts, each anchored to a point in the story, so the app can
answer "who was she in chapter seven?" rather than describing one unchanging
person from page one to the last page.

Three switches sit on every fact and every Tie, and they answer different
questions:

| Switch | Question |
|---|---|
| `frame` | Whose truth is this? `truth`, or an entity id for something a character believes |
| `revealed_at` | When does the READER learn it? Anything later than the point being written is a spoiler |
| `ai_scope` | May AI see it at all? `never` / `on-request` / `always` |

Frames are stored as **entity ids, never names**, so renaming a character cannot
invalidate the epistemic state of the book. The trailing `# Garrick Vale` comment
beside an id is regenerated on save and carries no authority.

**Anchors** are `c-<chapter id>` or `c-<chapter id>/s-<scene id>`. Ordinals are
computed on demand and never stored -- the ordering authority stays
`structure_store.ordered_chapter_filenames()`, so inserting a prologue does not
silently move every fact in the book one chapter later.

**`types.json` is writer-owned data, not a cache.** An invalid one is reported and
left byte-for-byte alone, and the Weave opens read-only until it is fixed. This is
the deliberate OPPOSITE of `structure.json`, which is treated as absent when
corrupt -- and both are right for their file, because structure.json is derivable
from the folder and types.json is not.

### Audiobook workspace layout

An audiobook lives in its own folder, outside the project folder. It is not a project and holds no Markdown source of truth -- it is a derived workspace built from one, and deleting it loses nothing but rendered audio.

```
MyNovel-audiobook/
  audiobook-project.json         the manifest: title, metadata, voice, cast,
                                 narration settings, source linkage
  source/                        the imported file, copied in and never modified
  manuscript/
    extracted-original.md        what the extractor produced, kept for reference
    narration-copy.md            THE editable narration text, markers and all
    narration-structure.json     derived chapter boundaries
    pronunciation-dictionary.json
  chapters/                      per-chapter derived data (segments, hashes)
  generated-segments/            rendered segment audio -- the expensive artifact
  previews/                      throwaway audition clips
  revisions/                     superseded segment audio
  output/
    chapters/                    per-chapter MP3s
                                 combined MP3 and M4B sit in output/
  logs/
```

Storage cleanup is built on that separation: `previews/` and failed takes cost nothing to remake and are pre-ticked for deletion, while `generated-segments/` and `output/` are never pre-ticked because they cost either hours of CPU or real money. Deleting `generated-segments/` while `output/` remains puts the book in an honest **Export Only** state -- the audiobook still exists, but no individual section can be regenerated or reassembled without narrating again.

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
GET    /models?provider=       (provider optional; defaults to the active one)
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
GET    /roles                  (the role catalog the Settings screen renders)
POST   /test-connection
```

### Model resolution — which model runs a request

Every AI endpoint goes through one seam, `_resolve_model_and_key(role, model_id_override)`
in `backend/app/routers/ai.py`, and every call site declares **which kind of job**
it is doing. The roles and the resolver live in `backend/app/ai/roles.py`.

Precedence, highest first:

1. `project.json` → `model_roles[role]` (supported by the resolver; no UI yet)
2. settings → `model_roles[role]`
3. `project.default_model` → settings `default_model` → `provider.fallback_model`

A role assignment is `{provider, model}` rather than a bare model id, because
different roles may live on different services. That makes the provider a
**per-request** resolution rather than a global one -- the single structural
change from the pre-roles design.

`resolve_role_model()` returns one flat, fully-populated payload (the same shape
whatever the source), modelled on the audiobook's `resolve_narration_selection()`
for the same stated reason: several surfaces ask this question, and duplicating
the precedence in TypeScript would let them disagree.

The distinction the payload exists to carry:

- an **unconfigured** role walks the chain above quietly and reports a
  `fallback_note` saying which Default Model stood in;
- a **configured** role that cannot run returns `usable: false` with a reason and
  **is never substituted**. Callers refuse rather than quietly using a different
  model than the writer chose.

The local provider's address is not in its `ProviderConfig` (it belongs to the
writer's machine); `base_url_for()` resolves it from settings at request time,
and `ai/local_endpoint.py` restricts it to loopback / private / `.local`
destinations.

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

### Codex (the Weave) — `/api/codex`

Writers see "the Weave"; the code says "codex". Every refusal on this router
travels as `{code, message, detail}` with a code from a closed set
(`app/codex/errors.py`), so the frontend branches on a stable identifier rather
than on message text.

```
The world
GET    /types                  the type registry + Tie vocabulary (validated, never repaired)
GET    /sections               the sidebar tree: what to show, what can be added
POST   /type  /type/show  /note        add a kind, reveal a shipped kind, add a note
PATCH  /section                rename a kind or a note (entries move with it)
DELETE /section                remove one (a kind holding entries is REFUSED with a count)
GET    /health                 index freshness, migration state, registry validity
POST   /reindex

Threads and Ties
GET    /list  /entity  /ties
POST   /entity  /thread/new    save; create an empty Thread from a name
DELETE /entity
POST   /tie                    DELETE /tie
POST   /fact                   PATCH /fact   DELETE /fact

Time
GET    /anchors                chapters + scenes with ids, in reading order
GET    /resolve                a Thread AS OF an anchor
GET    /graph                  nodes + edges at an anchor, spoiler-aware

Weaving
POST   /scan                   the free deterministic pass -- no role, no model, no cost
POST   /context                assembles the brief and RETURNS it; sends nothing
GET    /runs   POST /run   GET /run   POST /run/answer

Migration
POST   /migrate                dry_run DEFAULTS TO TRUE
POST   /migrate/restore
```

Two properties worth knowing before reading the code:

- **`/scan` is free and always runs first.** It compares the manuscript against
  the Weave using only arithmetic, so the walkthrough can quote a real count
  before offering anything that spends. Its findings are **never stored** -- they
  are re-derived from source and destination state every run, so a Thread that
  gets its Overview filled in stops being Frayed because the condition ended, not
  because a record says it was handled.
- **`/context` transmits nothing.** It builds the brief and hands it back so the
  writer can inspect it, remove Threads from it, exclude categories, or turn it
  off entirely. A writer-initiated action does the sending, later and elsewhere.
  See the context rule in `docs/product-scope.md`.

### Export — `/api/export`
```
POST   /full-manuscript        (markdown / txt / docx / epub; optional appendix flags)
POST   /snapshot
```

### Audiobook — `/api/audiobook`

The largest single router. Grouped by what it serves:

```
Workspace and import
POST   /import                 (docx / epub / md / txt / pdf / storythread project)
POST   /suggest-workspace
GET    /project
GET    /recents                POST /recents/remove
GET    /chapters/available     POST /chapters/add

Narration copy
GET    /narration              PUT  /narration
GET    /pronunciations         PUT  /pronunciations
GET    /segments
GET    /speakers               PUT  /speakers
POST   /analyze-speakers       POST /speaker-pass-estimate

Local engine (the kokoro-worker sidecar)
GET    /local-engine/status    POST /local-engine/install    POST /local-engine/remove
GET    /voices                 GET  /voice-options
POST   /preview                POST /preview-selection       POST /marker-demo
POST   /dialogue-check         GET  /dialogue-check/voices

Generation
POST   /generate               GET  /generation/status
POST   /generation/pause       POST /generation/resume
POST   /generation/cancel      POST /generation/reset
GET    /audio-status
GET/PUT /voice                 GET/PUT /narration-settings

Hosted narration
GET    /tts-catalog            GET  /narration-selection
GET/PUT /settings              PUT  /narration-choice
POST   /print-estimate         POST /print-preview

Assembly and output
GET    /ffmpeg/status          POST /ffmpeg/install
POST   /assemble               GET  /assemble/status
GET/PUT /metadata              PUT/DELETE /metadata/cover    GET /metadata/cover-image

Storage
GET    /storage                POST /storage/cleanup         PUT /storage/retention
```

Two conventions worth knowing. Endpoints that accept an API key follow the writing side's rules exactly: a GET returns a masked value plus a `*_set` boolean, and a PUT treats `null` as "leave alone" and `""` as "clear", so the frontend never echoes a mask back. And `/preview`, `/preview-selection`, `/marker-demo` and `/dialogue-check` are hardcoded to the local engine, so nothing in the rehearsal loop can ever spend money.

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
| Weave graph index, progress log, model registry | Per-project `.storythread/app.db` (rebuildable) |
| Weaving answers (applied / deferred / retired / muted) | `.storythread/weave/runs/*.json` -- NOT rebuildable, never in app.db |
| Project state (current chapter, scroll, etc.) | In-memory only; no autosave |

## AI write boundary

AI may only write directly to these designated fields in Markdown:

- `ai_profile_summary`
- `ai_section_summary`
- `chapter_summary`
- `scene_summary`

All other AI output is shown to the writer for explicit copy-paste. This is a hard product rule, enforced in code.
