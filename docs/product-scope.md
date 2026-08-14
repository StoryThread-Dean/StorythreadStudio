# Product Scope

## Product

**Storythread Studio** is a Windows desktop, local-first Markdown writing application for fiction and worldbuilding. The writer drafts the prose; AI provides context-aware review, refinement, summarization, and brainstorming on demand.

## Core goals

- Help the writer improve prose, structure, pacing, consistency, and characterization.
- Use AI as a reviewer and contextual assistant, not a ghostwriter.
- Keep every file local and human-readable.
- Treat each chapter as its own file during drafting; combine into a manuscript at export.
- Build reusable project context through profiles, summaries, notes, and scene context.
- Support adult content via task- and content-aware model selection through OpenRouter.
- Forbid em dashes in any AI output, project-wide.

## Writing philosophy

- The writer produces the draft.
- AI suggests, critiques, compares, summarizes, or restructures.
- AI only writes larger story content when explicitly requested.
- AI does not auto-update canon or profile memory.
- AI output is always editable before the writer chooses to keep it.

## Locked product rules

- Windows desktop app
- Local-first; no cloud sync, no telemetry, no required account
- Markdown editor only
- One chapter open at a time
- Manual save only (no autosave)
- Session-only undo and redo; no archival draft history for prose
- **Explicitly inspectable and controllable context.** AI may automatically receive story context relevant to the current anchor, but the writer must be able to inspect what will be sent, remove individual Threads, exclude categories, and disable automatic Weave context entirely. **No context is transmitted until the writer initiates an AI action.**
  - This REPLACES the earlier rule ("explicit context attachment; AI never has implicit project access"), which the Weave makes untrue: the app now assembles a brief on the writer's behalf. What is non-negotiable is not that the writer assembles it, but that they can see it, cut it, and switch it off. Nothing is sent on typing, on open, or on save.
  - Enforced in `backend/app/codex/context.py`, where each of the four capabilities is a function argument rather than a promise, and pinned by `backend/tests/test_codex_context.py`.
- AI output is reviewed by the writer before use; auto-apply is reserved for designated AI-generated fields
- AI may write directly only to designated fields: `ai_profile_summary`, `ai_section_summary`, `chapter_summary`, `scene_summary`
- No em dash or en dash characters in any AI output, ever — enforced at the prompt, sanitizer, and style guide layers. `--` (double hyphen) is the approved substitute; conversational chat replies additionally fold `--` into commas, while drafted prose keeps it

## What the app helps with

### Drafting and revision
Grammar and punctuation, clarity and consistency, eliminating redundancy, rephrasing, descriptive enhancement, readability shifts, structure and tone support.

### Story support
Brainstorming, writer's block help, next-beat suggestions, dialogue authenticity, pacing, strengthening endings and key scenes.

### Context and continuity
Character consistency, relationship continuity, location consistency, lore consistency, timeline continuity, scene-goal alignment.

### Project memory
Character profiles, relationship profiles, location profiles, lore profiles, chapter summaries, scene summaries, style guide, outline and theme notes.

## Out of scope

These are intentional non-goals. Items here will not be added without revisiting the product's identity:

- Collaborative editing or multi-writer sessions
- Cloud sync of project files
- Long-term draft history for prose
- Auto-generated canon updates from drafts
- Auto-applied AI rewrites
- Autonomous, multi-step agent workflows
- Persistent AI memory across Profile Builder chat sessions
- Semantic search across the whole project
- Client-side AI calls (API keys held in the WebView) — every AI request stays backend-mediated, permanently

## Success criteria

The writer can:

1. Create and open a local project.
2. Write chapters in Markdown, with manual save and session undo.
3. Build structured profiles for characters, relationships, locations, and lore.
4. Ask AI for targeted help on selected text.
5. Attach context explicitly via context chips.
6. Generate AI-facing summaries into dedicated Markdown sections.
7. Import character profiles from other projects as independent forks.
8. Export a combined manuscript with optional summaries, notes, and profiles.
