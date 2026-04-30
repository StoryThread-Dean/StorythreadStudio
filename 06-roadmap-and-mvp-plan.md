# 06. Roadmap and MVP Plan

## Phase 0: Design Freeze -- COMPLETE
Deliverables:
- final folder structure
- Markdown schemas
- SQLite schema
- assistant registry spec
- routing rules
- prompt rules
- wireframes

## Phase 1: Local Desktop Foundation -- COMPLETE
Built:
- Tauri shell
- React frontend scaffold (three-panel layout)
- FastAPI local backend with CORS, health check, projects and documents routers
- project create and open (OS folder picker, project.json, full folder structure)
- dynamic chapter list (reads manuscript/ from disk)
- CodeMirror Markdown editor with formatting toolbar and font selector
- real file save -- Ctrl+S and Save button write to disk
- unsaved-changes indicator
- session undo and redo

Deliverable:
- usable local writing app without AI -- DELIVERED

## Phase 2: Profile System -- COMPLETE
Built:
- character, relationship, location, lore profiles
- chapter summary and scene summary files
- Profile Builder UI (3-panel: type/list, editor, Phase 4 chat placeholder)
- structured trait blocks with influence scale
- AI summary placeholder fields in every section
- import and fork character profiles (independent copy, new profile_id)
- backend parse/generate Markdown with YAML frontmatter
- config-driven section layout per profile type

Deliverable:
- usable context and profile system -- DELIVERED

## Phase 3: OpenRouter Integration -- COMPLETE
Built:
- API key storage in ~/.storythread/settings.json
- model listing from OpenRouter (populates Settings model picker)
- connection test endpoint
- assistant execution pipeline (run-assistant, sanitize, return structured JSON)
- live AI response panel with text selection indicator, loading state, copy buttons
- no-em-dash sanitizer at all 3 layers (prompt, sanitizer.py, style guide)
- Settings modal (API key with masking, model picker, test connection)

First-wave assistants shipped:
- Grammar and Punctuation
- Clarity and Consistency
- Eliminate Redundancy
- Descriptive Enhancement

Deliverable:
- first end-to-end AI workflow -- DELIVERED

## Phase 4: Profile Aware AI -- COMPLETE
Built:
- explicit context attachment (context chips)
- generate AI usage example into trait blocks
- generate section summaries into Markdown
- generate full profile summaries into Markdown
- Profile Builder chat with 7 behavior modes
- ToolKit context selector
- react-markdown chat rendering, chat textarea auto-expand
- Settings expansion (tier slider, starred models, content mode)
- Phase 4 Polish: conversational rules, context chip UX, focused section indicator, right panel collapse, visual pass

Second-wave assistants shipped:
- Dialogue Authenticity
- POV Consistency
- Tone and Voice Consistency
- Character Development
- Character Consistency

Deliverable:
- context-aware AI help across writing and profiles -- DELIVERED

## Phase 5: AI Respec (redesigned from original Phase 5)

The original Phase 5 scope (content mode routing) was expanded into a full AI integration redesign. Broken into 5 sub-phases:

### Phase 5A: Profile Builder Rebuild -- COMPLETE
Built:
- importance levels replace influence scale (core/present/background/contextual/hidden)
- description-only trait blocks (ai_usage_example and notes removed)
- adaptive word count gauge per importance level
- 4 simplified behavior modes (chat/refine/extract_traits/check_consistency)
- ProfileBuilder.tsx rebuilt from scratch
- backend backward-compatible read (old influence auto-migrated)
- generate-usage-preview endpoint replaces generate-usage-example

Deliverable:
- cleaner, simpler profile editing with importance-aware word guidance -- DELIVERED

### Phase 5B: AI Tools -- COMPLETE
Built:
- "How AI uses this" preview (Sparkles button, on-demand prose explanation via /generate-usage-preview)
- AI Trim tool (Scissors button at Wordy/Bloated gauge, /trim-trait endpoint, Apply replaces description)
- AI Importance Audit (profile-level audit button, /audit-importance flags importance mismatches)

Deliverable:
- on-demand AI tools for profile quality improvement -- DELIVERED

### Phase 5C: Series/Book Structure -- COMPLETE
Built:
- series.py router: /api/series/create, /open, /list-books
- book-within-series creation: /api/projects/create-in-series with arcs/ subfolder
- canonical series-level profiles + per-book arc file CRUD (/arc/list, /arc/profile, /arc/create, /arc/save)
- profile merge logic: merge_profile_with_arc() overlays book arc on canonical, /api/profiles/merged endpoint
- series settings with book-level IsNull overrides
- story context injection: _build_story_context() reads series.json + project.json, auto-injects into AI system prompts
- ProjectHome.tsx rebuilt with series creation, browsing, and book-in-series flows

Deliverable:
- multi-book series with shared canonical profiles and per-book arcs -- DELIVERED

### Phase 5D: Toolkit and Routing -- COMPLETE
Built:
- auto-suggest ChipPicker: character profiles shown as ghost chips on mount, one-click attach
- series source toggle: "This Book" vs "Series Profiles" in ChipPicker for series projects
- content mode routing: _validate_model_content_mode() checks model supports requested mode
- model allowlist/blocklist: _validate_model_allowed() enforced in run-assistant, stored in settings
- Settings UI: Model Routing section with allowlist, blocklist, per-model content modes
- expanded context chip types: series_character, series_relationship, series_location, series_lore
- content_mode and project_path passed from frontend to run-assistant

Deliverable:
- smart context suggestions and content-aware model routing -- DELIVERED

### Phase 5E: Writing Companion
Build:
- unified design language for editor and profile right panels
- chat interface in main editor
- Level 1-2 AI capabilities wired up

## Phase 6: Export and Polish
Build:
- full manuscript export -- COMPLETE (exports/ plain-Markdown output; overwrites in place for a single canonical combined file)
- manual snapshot export -- COMPLETE (timestamped folder with full project state)
- scene summaries -- COMPLETE (per-scene `summaries/scenes/<stem>/scene-NN.md`, auto-split on `---`, selection-based preview modal, expandable sidebar grandchildren)
- summary quality tuning -- COMPLETE (chapter and scene summary prompts rewritten as "cliff notes" with absolute grounding rules; temperature switched to critique; preamble filter drops cosmetic HRs after chapter title)
- expanded export options -- COMPLETE (opt-in toggles for chapter summaries, scene summaries, notes, and profiles on both export types)
- relationship-aware full profile summaries -- COMPLETE (generate-full-summary scans profiles/relationships/ for the character and supplies Overview/Current Dynamic snippets to the AI)
- backend-down error boundary -- COMPLETE (useBackendHealth polls /health; single actionable banner replaces per-feature fetch errors)

Remaining (post-MVP polish -- tracked but not blocking the MVP box):
- Level 3 Collaborative Draft capabilities
- AI-suggested scene break insertion (deferred from scene summary phase)

Deliverable:
- coherent private-use MVP ready for later public GitHub packaging -- DELIVERED

## Suggested First 10 Build Tasks (historical -- all complete)

1. Create repository and base project structure.
2. Stand up Tauri shell and React UI.
3. Stand up FastAPI backend.
4. Implement local project create and open.
5. Implement chapter Markdown editor.
6. Add unsaved changes and session undo and redo.
7. Implement profile file creation and parsing.
8. Build character Profile Builder UI first.
9. Add trait blocks and importance levels (originally influence scale, migrated in 5A).
10. Add AI generation for section summaries.

## Key MVP Acceptance Checklist

- [x] Can create and open a local project
- [x] Can edit and save a chapter in Markdown
- [x] Can create a character profile
- [x] Can generate AI section summaries into Markdown
- [x] Can use profile calibration chat without persistent memory
- [x] Can run selected-text assistants from the writing screen
- [x] Can attach context explicitly
- [x] Can import and fork a character profile from another project
- [x] AI output never contains em dashes
- [x] Can create a book series with shared profiles
- [x] Can export full manuscript
- [x] Content mode routing functional

## Final MVP Boundaries

### In Scope
- local-first fiction writing
- Markdown drafts
- structured profiles
- generated AI interpretation fields
- selected-text AI review tools
- content-aware model routing groundwork

### Out of Scope
- draft history browser
- collaboration
- cloud sync
- autonomous agents
- auto-apply prose rewriting
- persistent profile chat memory
- semantic project search
