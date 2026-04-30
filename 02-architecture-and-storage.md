# 02. Architecture and Storage

## High Level Architecture

### Desktop Shell
- **Tauri**
- Windows-first
- lightweight local desktop packaging

### Frontend
- **React + TypeScript**
- Markdown editor UI
- project navigation
- profile builder
- AI side panel

### Backend
- **Python + FastAPI**
- local service
- handles file IO, parsing, AI routing, OpenRouter calls, and validation

### Storage
Use both:
- local Markdown files as source of truth
- SQLite for metadata, cache, settings, assistant registry, and parsed profile data

## Why This Architecture

This architecture fits the project because it:
- keeps files local and human readable
- supports Python learning and maintainability for the user
- allows structured parsing and prompt optimization
- makes GitHub publication possible later
- avoids heavy Electron overhead

## Project Folder Structure

```text
StorythreadStudio/
  project.json
  manuscript/
    01-chapter-one.md
    02-chapter-two.md
  notes/
    outline.md
    style-guide.md
    themes.md
  profiles/
    characters/
      elara-voss.md
      rowan-hale.md
    relationships/
      elara-rowan.md
    locations/
      northwatch-harbor.md
    lore/
      empire-history.md
      magic-rules.md
    chapters/
      chapter-01-summary.md
    scenes/
      chapter-01-scene-02.md
  exports/
    manuscript-full.md
    snapshot-YYYY-MM-DD.md
  .storythread/
    app.db
    cache/
    logs/
```

## Project Level Settings File

### `project.json`

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
  "created_at": "ISO_DATETIME",
  "updated_at": "ISO_DATETIME"
}
```

## Editor Behavior

### Writing Editor Rules
- one chapter open at a time
- Markdown only
- manual save only
- session-only undo and redo
- unsaved changes indicator
- confirm before close if there are unsaved changes
- manual export snapshot command

### History Decision
The app should **not** implement long-term draft history for story prose in MVP.

This is intentional because:
- the writer works on the current draft only
- the writer does not rely on old overwritten prose states
- backup exists externally
- editor undo and redo is sufficient for active drafting safety

## Export Behavior

### Manual Snapshot Export
A command that writes the current state of the draft or selected project files to `exports/`.

### Full Manuscript Export
Combines chapters in order into a single Markdown manuscript file.

## Local Data Responsibilities

### Markdown Files
Source of truth for:
- chapters
- notes
- profiles
- summaries

### SQLite
Used for:
- app settings
- cached parsed profiles
- trait block indexing
- model metadata cache
- assistant registry
- optional lightweight interaction logging

## Important Storage Rule

AI may write only to fields intended for generated AI content, such as:
- `ai_usage_example`
- `ai_profile_summary`
- `ai_section_summary`
- `chapter_summary`
- `scene_summary`

AI must not silently overwrite human-authored core profile fields or prose draft text.
