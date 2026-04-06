# 06. Roadmap and MVP Plan

## Phase 0: Design Freeze
Deliverables:
- final folder structure
- Markdown schemas
- SQLite schema
- assistant registry spec
- routing rules
- prompt rules
- wireframes

## Phase 1: Local Desktop Foundation
Build:
- Tauri shell
- React frontend scaffold
- FastAPI local backend
- project create and open
- chapter list
- Markdown editor
- manual save
- unsaved-changes warning
- session undo and redo

Deliverable:
- usable local writing app without AI

## Phase 2: Profile System
Build:
- character profiles
- relationship profiles
- location profiles
- lore profiles
- chapter summary files
- scene summary files
- Profile Builder UI
- structured trait blocks
- influence scale for character and relationship profiles
- import and fork character profiles
- generated AI content sections in Markdown

Deliverable:
- usable context and profile system

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

- [ ] Can create and open a local project
- [ ] Can edit and save a chapter in Markdown
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
