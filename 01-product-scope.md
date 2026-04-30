# 01. Product Scope

## Product Name

**Storythread Studio**

## Product Definition

A **Windows desktop, local-first Markdown writing application** for fiction and worldbuilding where the user writes the story and AI provides **context-aware review, refinement, summarization, and brainstorming support** on demand.

## Core Product Goals

- Help the writer improve prose, structure, pacing, consistency, and characterization.
- Use AI as a reviewer, refiner, and contextual assistant rather than a ghostwriter.
- Store all files locally in a readable project structure.
- Keep chapters separate while drafting, then export into a full manuscript later.
- Build reusable project context through profiles, summaries, notes, and scene context.
- Support adult content by allowing task and content aware model selection through OpenRouter.
- Enforce a global punctuation rule where AI never outputs em dashes.

## Writing Philosophy

The app is designed around this authoring model:

- The writer produces the draft.
- AI suggests, critiques, compares, summarizes, or restructures.
- AI only writes larger story content when explicitly requested.
- AI should not auto-update canon or profile memory.
- AI output should be editable before the writer decides to keep it.

## Locked Product Rules

- Windows desktop app
- local-first
- Markdown editor
- one chapter open at a time
- manual save only
- session-only undo and redo
- no archival draft history for prose in MVP
- explicit context attachment
- AI output is accepted manually, preferably via copy and paste
- generated AI summaries and examples may be written to Markdown fields dedicated to generated AI content
- no em dashes in any AI suggestions, summaries, examples, or refinements

## Main Usage Areas

### Drafting and Revision
- grammar and punctuation
- clarity and consistency
- eliminate redundancy
- rephrasing
- descriptive enhancement
- readability changes
- structure and tone support

### Story Support
- brainstorming
- writer's block help
- next beat suggestions
- dialogue authenticity
- pacing support
- strengthening endings and key scenes

### Context and Continuity
- character consistency
- relationship continuity
- location consistency
- lore consistency
- timeline continuity
- scene goal alignment

### Project Memory
- character profiles
- relationship profiles
- location profiles
- lore profiles
- chapter summaries
- scene summaries
- style guide
- outline and theme notes

## Non Goals for MVP

- collaborative editing
- cloud sync
- full manuscript version history
- auto-generated canon updates
- auto-apply AI edits
- autonomous agent workflows
- persistent AI memory from profile builder chat
- semantic search across the whole project

## Success Criteria for MVP

The MVP is successful if the writer can:

1. Create and open a local project.
2. Write chapters in Markdown.
3. Build structured profiles.
4. Ask AI for targeted help on selected text.
5. Attach context explicitly.
6. Generate and store AI-facing summaries in dedicated Markdown sections.
7. Import character profiles from other stories as independent forks.
8. Export a combined manuscript.
