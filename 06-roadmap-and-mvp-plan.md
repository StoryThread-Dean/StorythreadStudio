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

## Phase 3: OpenRouter Integration
Build:
- API key storage
- model listing
- connection test
- assistant execution pipeline
- AI response panel
- no-em-dash sanitizer

Start with assistants:
- Grammar and Punctuation
- Clarity and Consistency
- Eliminate Redundancy
- Descriptive Enhancement

Deliverable:
- first end-to-end AI workflow

## Phase 4: Profile Aware AI
Build:
- explicit context attachment
- context chips
- generate AI usage example into trait blocks
- generate section summaries into Markdown
- generate full profile summaries into Markdown
- Profile Builder chat
- chapter summary generation
- scene summary generation

Add assistants:
- Dialogue Authenticity
- POV Consistency
- Tone and Voice Consistency
- Character Development
- Character Consistency

Deliverable:
- context-aware AI help across writing and profiles

## Phase 5: Content and Routing Awareness
Build:
- content mode settings
- route preview
- allowlist and blocklist
- explicit-content-aware filtering
- task-aware routing groundwork

Deliverable:
- first version of content and content-aware model selection

## Phase 6: Export and Polish
Build:
- full manuscript export
- manual snapshot export
- UI polish
- better error handling
- summary quality tuning
- relationship-aware full profile summaries

Deliverable:
- coherent private-use MVP ready for later public GitHub packaging

## Suggested First 10 Build Tasks

1. Create repository and base project structure.
2. Stand up Tauri shell and React UI.
3. Stand up FastAPI backend.
4. Implement local project create and open.
5. Implement chapter Markdown editor.
6. Add unsaved changes and session undo and redo.
7. Implement profile file creation and parsing.
8. Build character Profile Builder UI first.
9. Add trait blocks and influence scale.
10. Add AI generation for `ai_usage_example` and section summaries.

## Key MVP Acceptance Checklist

- [x] Can create and open a local project
- [x] Can edit and save a chapter in Markdown
- [ ] Can create a character profile
- [ ] Can generate AI usage examples into trait blocks
- [ ] Can generate AI section summaries into Markdown
- [ ] Can use profile calibration chat without persistent memory
- [ ] Can run selected-text assistants from the writing screen
- [ ] Can attach context explicitly
- [ ] Can import and fork a character profile from another project
- [ ] Can export full manuscript
- [ ] AI output never contains em dashes

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
