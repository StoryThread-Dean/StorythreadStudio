# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Status

**Status: shipped.** The current release is **v1.1.0** -- see `CHANGELOG.md` for the full release history and `docs/features.md` for what the product does today.

**Versioning is a three-tier rule, not semver.** Tier 3 (`v1.1.x`) = enhancements to existing features. Tier 2 (`v1.x.0`) = additions, like the Audiobook Converter. Tier 1 (`vX.0.0`) = major restructuring -- a change needing its own dashboard, or one that alters multiple existing features at once. Judge the tier by what the RELEASE delivers, not by the size of the programme it belongs to.

The phase history below is the pre-1.0 build record, kept for context. Some items it names were later replaced -- those are marked inline. The biggest post-phase change: structured feedback moved out of the chat panel into the **Smart Advisor** toolbar (inline issue overlays via `POST /api/ai/editor-pass`), and the Writing Companion chat gained **Draft mode** (v1.0.6) and **Enhance mode** (v1.0.7).

Phases 0-4, 5A-5E, and 6 are complete and merged into `main`. Phase 5 was redesigned into an AI Respec with 5 sub-phases (5A-5E). Phase 6 delivered full-manuscript export (with opt-in chapter summaries / scene summaries / notes / profiles), manual snapshot export, scene summaries (per-scene files with auto-split and selection-based preview), summary quality tuning (cliff-notes reframing + preamble filter), relationship-aware full profile summaries, and a backend-health banner for uniform error handling.

### Phases 1-3 -- Complete
Core app: Tauri shell + React scaffold, FastAPI backend, project create/open, CodeMirror Markdown editor, file save, profiles (character/relationship/location/lore/summaries), OpenRouter integration, 9 writing assistants (later replaced by Smart Advisor + Writing Companion), Settings modal, em dash enforcement.

### Phase 4 + Polish -- Complete
Context chips, ai_usage_example generation (removed in 5A), section/full summaries, Profile Builder chat with 7 behavior modes (reduced to 4 in 5A), ToolKit context selector (replaced by the auto-suggest ChipPicker in 5D), visual polish pass.

### Phase 5A -- Profile Builder Rebuild -- Complete
- **Importance levels** replace influence scale: Core / Present / Background / Contextual / Hidden
- **Description-only trait blocks**: ai_usage_example and notes fields removed from TraitBlock
- **Adaptive word count gauge**: per-importance thresholds with visual color-coded bar
- **4 simplified behavior modes** replace 7: Chat, Refine, Extract Traits, Check Consistency
- **ProfileBuilder.tsx rebuilt from scratch**, backend backward-compatible (old influence auto-migrated)

### Phase 5B -- AI Tools -- Complete
- **"How AI uses this" preview**: Sparkles button on TraitBlockCard, expandable prose explanation via `/generate-usage-preview`
- **AI Trim tool**: Scissors button at Wordy/Bloated gauge, `/trim-trait` endpoint, Apply button replaces description
- **AI Importance Audit**: profile-level audit button, `/audit-importance` endpoint flags importance mismatches

### Phase 5C -- Series/Book Structure -- Complete
- **series.py router**: `/api/series/create`, `/open`, `/list-books` for managing book series
- **Book-in-series creation**: `/api/projects/create-in-series` with arcs/ subfolder, series_id/series_path in project.json
- **Arc files**: `/api/profiles/arc/list`, `/arc/profile`, `/arc/create`, `/arc/save` for per-book character arcs
- **Profile merge**: `merge_profile_with_arc()` overlays book arc on canonical profile, `/api/profiles/merged` endpoint
- **Story context injection**: `_build_story_context()` reads series.json + project.json, auto-injects into AI system prompts
- **ProjectHome.tsx rebuilt**: series creation, browsing, book-in-series flows

### Phase 5D -- Toolkit & Routing -- Complete
- **Auto-suggest ChipPicker**: character profiles shown as ghost chips on mount, one-click attach
- **Series source toggle**: "This Book" vs "Series Profiles" in ChipPicker for series projects
- **Content mode routing**: `_validate_model_content_mode()` validates model supports requested mode
- **Model allowlist/blocklist**: `_validate_model_allowed()` enforced in run-assistant, stored in settings
- **Settings UI: Model Routing section**: allowlist, blocklist, per-model content modes configuration
- **Expanded chip types**: series_character, series_relationship, series_location, series_lore

### Phase 5E -- Writing Companion -- Complete
- Chat-based editor right panel replaces button-based assistant UI
- 3 category tabs (Readability / Structure / Context) **toggleable**: click to activate structured feedback, click again to return to general chat
- No selection = full chapter context; text selected = only that text
- ChatMarkdown extracted to shared component (used by both editor and Profile Builder)
- POST /api/ai/editor-chat endpoint with category-specific system prompts
- Context chips always visible on all tabs
- Multi-turn conversation with session history
- Character limits: 30K selected text, 100K full chapter
- Structured feedback: AI quotes specific passages, labels as Praise/Issue/Suggestion, provides before/after rewrites
- General chat mode (no tab selected): open conversational, no structured format
- Selection highlight persists when clicking into chat panel (drawSelection: true, transparent line backgrounds)
- **Superseded since:** the category tabs moved out of the chat into the Smart Advisor toolbar (inline overlays, `POST /api/ai/editor-pass` + `/api/ai/revise-suggestion`). The Writing Companion is now general chat plus Draft and Enhance modes -- see `docs/features.md`.

### Post-5E Polish
- Fixed AI copying instruction template into output (prompt used example-based format instead of numbered template)
- Fixed numbered list resets in AI responses (--- separators replace numbered lists)
- Fixed selection highlight only showing on paragraph edges (transparent .cm-line backgrounds, semi-transparent .cm-activeLine)

### Phase 6 -- Export and Polish -- Complete
- **Scene summaries**: per-scene `summaries/scenes/<stem>/scene-NN.md` files. Auto-split flow (chapter `---` separators drive a sequential per-scene generator with yes/no/cancel overwrite prompts) and selection-based preview modal with slot picker. Expandable sidebar grandchildren under each chapter (Chapter -> Chapter Summary + Scene Summaries -> Scene 1, 2, 3...). `scene_parser.py` drops cosmetic preambles (chapter title + epigraph) under 50 words when an HR follows.
- **Summary quality tuning**: both chapter and scene summary prompts rewritten as "cliff notes" (primary directive = gist, grounding rules secondary). Temperature switched from `extraction` to `critique` (same 0.3 value, clearer semantics). User messages wrap source text in `--- BEGIN/END ---` markers with explicit "Summarize, do not extend" framing.
- **Expanded export**: `POST /api/export/full-manuscript` and `POST /api/export/snapshot` accept `include_chapter_summaries` / `include_scene_summaries` / `include_notes` / `include_profiles` flags. Full-manuscript appends each as a `#` appendix; snapshot mirrors the folder layout.
- **Relationship-aware full profile summaries**: `generate-full-summary` accepts `project_path`; for character profiles it scans `profiles/relationships/*.md` for the character's name and passes Overview / Current Dynamic snippets as "RELATED RELATIONSHIPS" context so the summary weaves in who the character is to others.
- **Backend-health banner**: `useBackendHealth` hook polls `/health` every 10s; a single fixed-position banner shows when the backend is unreachable, replacing per-feature cryptic fetch errors. Dismiss-until-state-changes behavior.

---

## What Storythread Studio Is

A **Windows desktop, local-first Markdown writing app** for fiction writers. The writer does all the drafting. AI acts as reviewer, editor, and brainstorming partner -- never a ghostwriter. AI assists on demand; it never auto-applies changes or autonomously updates story content.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Desktop shell | Tauri v2 | Packages the app as a Windows `.msi` installer; bridges OS features (file dialogs, window management) to the web UI |
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
StorythreadStudio/        <- repo root
  app/                    <- Tauri + React frontend (run npm commands from here)
    src/                  <- React/TypeScript source files
    src-tauri/            <- Tauri/Rust shell
    public/               <- static assets
  backend/                <- Python FastAPI backend (run uv commands from here)
    app/
      main.py             <- FastAPI entry point and route registration
      __init__.py         <- marks app/ as a Python package
    pyproject.toml        <- Python dependencies managed by uv
    tests/                <- pytest suite
  docs/                   <- product docs (scope, architecture, features, roadmap, releasing)
  tests/                  <- manual-smoke.md release checklist
  scripts/                <- release.ps1 and helper scripts
  CHANGELOG.md
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

# Type check (there is NO `npm run lint` script -- tsc is the frontend gate)
npx tsc --noEmit
```

---

## Testing

Two automated test suites plus a manual checklist. All three are wired into `/pre-release` (see `.claude/commands/pre-release.md`).

### Test layout

- `backend/tests/` -- pytest + pytest-asyncio. Uses FastAPI's `TestClient` for HTTP-level tests and `async with open_db(tmp_path)` for store-level tests. Test files named `test_*.py`. Current files:
  - `test_db_migrations.py` -- the app.db migration ladder, and the only thing that finds this class of bug: an UPGRADE. Every other test builds its database from scratch, where an ALTER smuggled into an already-applied migration looks perfectly correct -- which is how a real project came to die on `no such column`. Pins that a v2 or v3 database ends up byte-identical to a fresh one, and that each rung runs on the one before it
  - `test_explain_costs.py` -- does the help text tell the truth about MONEY: Python reads the TypeScript explanation registry, finds each named route's handler, and fails if one that calls `_resolve_model_and_key` is described as free (or the reverse). A "free" claim is a promise about the writer's credit, and the `universal` incident proved a frontend claim about the backend is only as good as something checking it
  - `test_outline_frontmatter.py` -- outline YAML frontmatter parser
  - `test_outline_sections.py` -- outline section parsing / reconstruction (Planner corruption regressions)
  - `test_progress_store.py` -- word counting, night-owl rollover, event recording
  - `test_progress_routes.py` -- `/api/progress/summary` and `/api/progress/daily` HTTP endpoints
  - `test_settings_store.py` -- settings persistence, atomic writes, backup/corruption recovery
  - `test_editor_chat_prompts.py` -- Writing Companion prompt construction
  - `test_enhance_mode.py` -- Enhance mode payloads and prompts
  - `test_sanitizer_routing.py` -- em-dash sanitizer routing per AI path
  - `test_openrouter_errors.py` -- OpenRouter error translation (401/402/404/429/5xx)
  - `test_scene_breaks.py` -- scene break suggestions
  - `test_chapter_progress.py` -- per-chapter word-target matching
  - `test_structure_manifest.py` -- acts/order manifest: synthesis, healing, PUT, ordering consumers
  - `test_rename_chapter_cascade.py` -- file-renaming chapter rename + cascade (summaries, structure, progress)
  - `test_scene_beats.py` -- `## Beats` parsing, preservation on AI regen, /scene-beats
  - `test_story_context_fields.py` -- Book Details fields in _build_story_context
  - `test_project_settings_fields.py` -- Book Details persistence, outline word target, ui-state, numeric starter
  - `test_providers.py` -- provider registry + _resolve_model_and_key dispatch (NanoGPT key/model rules)
  - `test_model_roles.py` -- Model Roles: the eight roles, precedence at all three levels, an unconfigured install resolving identically to before roles existed, and the rule that matters most -- **a configured-but-unusable role reports itself unusable and NEVER substitutes another model**
  - `test_role_call_sites.py` -- reads the real router source: every AI call site names a known role, none uses the pre-roles signature, and ROLE_INFO's feature lists match what the call sites actually do (a role marked in use with no consumer fails the build)
  - `test_role_settings_routes.py` -- the roles catalog endpoint + saving assignments (unknown roles/providers dropped, and the response echoes what was really stored)
  - `test_local_endpoint.py` -- what "Local model" is allowed to mean: loopback/private/.local accepted, public addresses refused with the rule explained, `/v1` normalization per API style
  - `test_think_blocks.py` -- inline `<think>` reasoning traces stripped from local-model replies before the writer or the conversation history sees them
  - `test_nanogpt_models.py` -- tolerant /models normalization for thin catalogs
  - `test_provider_errors.py` -- provider-templated error translation (NanoGPT messages)
  - `test_settings_routes.py` -- ai_provider / NanoGPT key / prompt_caching over the Settings API
  - `test_prompt_caching.py` -- cache_control payload shapes, provider gating, NanoGPT headers
  - `test_editor_chat_materials_flow.py` -- materials echo + placement, stance persistence, temperature split
  - `test_profile_chat_prompts.py` -- profile-chat prompt builder incl. Interview mode contract (interviewer-not-inventor, triggers/origins, full-block rounds)
  - `test_character_kinds.py` -- Main vs Side character templates: kind frontmatter, tolerant trait-section parsing, plain-text round trip
  - `test_quick_overview.py` -- side-character Generate Overview: prompt guardrails (grounding, subtext, vary-angle) + endpoint payload
  - `test_names_store.py` -- name-generator seed data contracts (counts, era honesty, no em dashes) + names.db seed/fallback/reseed
  - `test_names_routes.py` -- /api/names/cultures + /pool endpoints incl. fallback used_era and 400s
  - `test_audiobook_extraction.py` -- audiobook import extractors (TXT/MD/DOCX/EPUB/Storythread-project) incl. real DOCX+EPUB round trips, chapter detection, PDF rejection
  - `test_audiobook_markers.py` -- narration marker grammar ([pause]/[scene-break]/[chapter-break]/[exclude]), derived structure, warnings
  - `test_audiobook_pronunciation.py` -- pronunciation rules, [say] inline overrides, TTS payload prep (`--` to em dash, payload only)
  - `test_audiobook_workspace_routes.py` -- (also covers Dialogue Check: four voices not fifty-four, markers stripped rather than honoured, oversize refusal, no workspace required) -- /api/audiobook import/project/narration/pronunciations/recents/segments end to end
  - `test_audiobook_segmenter.py` -- segment sizing (paragraph grouping, sentence fallback, marker cuts) + stable-ID identity across inserts/edits/chapter renumbering
  - `test_audiobook_generation.py` -- generation engine: run lifecycle, per-segment persistence, pause/cancel between segments, retry cap + pessimistic attempts, truncation validation, restart recovery, workspace lockfile, narration-settings/dialogue/marker pace flow + staleness
  - `test_audiobook_local_worker.py` -- kokoro-worker manager: KokoroBackend transport errors, spawn command + version gate, install flow (SHA256 integrity, polluted-dir replace, locked-file loud failure), voices/preview/preview-selection endpoints
  - `test_audiobook_marker_demos.py` -- WAV stitcher (exact silence, format guards), audible marker demos (scripts render clean, speeds match narrated values), render_marked_text (rules, silence, pace spans, cut-into-span warnings, trace)
  - `test_audiobook_flow.py` -- flow synthesis: mid-paragraph pauses cut the AUDIO of a continuous render (never the text), gap located by the duration-calibrated matcher -- pins the pre-pause slur fix
  - `test_audiobook_assembly.py` -- the assembler against REAL ffmpeg: stitch -> loudnorm -> encode, ffprobe verifies durations, ID3 tags, M4B chapter markers (a missing ffmpeg fails loudly, never skips)
  - `test_audiobook_metadata.py` -- book metadata + cover art (spec 17): manifest store, HTTP surface, cover validators
  - `test_audiobook_tts_providers.py` -- hosted catalog + prices, the print-pass estimator, cloud synthesis behind the local seam, and error classification (a retryable verdict on a billing error would charge twice)
  - `test_audiobook_settings_routes.py` -- the audiobook settings surface: key masking (never echoed back, omitted = leave alone, "" = clear) and engine-pair validation refused out loud
  - `test_audiobook_narration_selection.py` -- three-level engine resolution (book -> settings -> writing fallback), `can_spend` vs `fallback_note` vs `caveat`, and each demoted engine's recorded reason
  - `test_audiobook_mp3_transport.py` -- per-model `response_format`, mp3 byte sniffing + decode, and the self-healing 400 retry (provider names a format, or the field is dropped)
  - `test_audiobook_level_matching.py` -- loudness matching at assembly (-20 dBFS RMS, -1 dBFS ceiling, clamped gain), including that flow dynamics survive it
  - `test_audiobook_pdf.py` -- PDF import against REAL PDFs built by `tests/pdf_builder.py`: scanned rejection, running-header/page-number removal that never eats prose or headings, hyphen rejoining, paragraph reconstruction by indent and by line length
  - `test_audiobook_speakers.py` -- the cast + [voice:NAME] spans (spec 27): span parsing and its three failure modes, voice change as a hard segment boundary, name-to-voice resolution, recasting requeues only that character
  - `test_audiobook_speaker_analysis.py` -- the AI speaker pass (spec 27.3): a proposal that does not quote the source character for character is DROPPED, overlap/ordering rules, prompt guardrails, and the endpoint writing nothing
  - `test_audiobook_storage.py` -- storage measurement + cleanup (spec 25): per-category sizes, orphan detection by leftover, nothing irreversible pre-checked, deleted audio resets its segment records, export-only state, retention migration
  - **The Weave** (`feature/the-weave`, for v2.0.0):
  - `test_codex_types.py` -- the type registry: validation, and that an invalid `types.json` is NEVER silently repaired over the writer's customization
  - `test_codex_anchors.py` -- anchors as ids, ordinals computed never stored, a scene-less anchor valid everywhere
  - `test_codex_resolve.py` -- the heart: effective sets, derived supersession, same-anchor ambiguity is a Snag rather than an ordering, frames survive a rename, `ai_scope: never` unreachable
  - `test_codex_tie_run.py` -- a connection that CHANGES: the writer's own three scenarios (a friendship deepening, a parentage that never changes, animosity turning to love), the pair as the axis so nothing is closed by hand, and the one place connections differ from facts -- an undated connection is true of the whole book while an undated fact is Unplaced, though a WRITTEN anchor that no longer resolves is still Unplaced for both
  - `test_codex_visibility.py` -- one set of rules for facts AND Ties; an edge is only as visible as the least visible thing it touches
  - `test_codex_threads.py` -- Thread round trip; nothing a hand-edited file contains is ever dropped
  - `test_codex_store.py` -- index health: a failed write marks dirty, a dirty index rebuilds before serving, an out-of-band edit is caught by the revision fingerprint
  - `test_codex_sections.py` / `test_codex_edit_delete.py` -- the sidebar growth rule; renaming a kind brings its entries, deleting one that holds entries is REFUSED with a count, a deleted note goes to trash
  - `test_codex_migration.py` -- dry run writes nothing, idempotent, marker only on success, an interrupted run offers resume or restore
  - `test_codex_world_walkthrough.py` -- a REAL densely connected world end to end (Drizzt Do'Urden's, given as the worked example): every relation in it expressible, a custom kind connectable once the writer names the relation, and the world navigable from any point -- standing on the Drow entry finds all five drow. Writing it found four things a writer could not say, none of which any single-rule test could show
  - `test_codex_tie_editor.py` -- recording a connection by hand, and what a BIGGER vocabulary costs: about seventy grouped relations ship now, so a hand-typed label collides constantly and is interpreted rather than refused (already yours, use it; shipped but unadopted, adopt it; covers the wrong pair, widen it -- and a no-op never writes a types.json the project never had); the reported world (faction worships deity, faction part of religion, religion worships deity) is now expressible, a writer can NAME a connection the app never thought of, an older project is OFFERED shipped relations rather than having types.json rewritten behind it, and cardinality WARNS rather than refusing
  - `test_codex_absorb.py` -- taking a WORD into an entry, which is deliberately not a merge: a placeholder is derived (no prose, no ties, no facts) and one holding writing is REFUSED, every absorbed word then resolves to the survivor everywhere, and `display_name` (what the story calls it) is kept separate from `name` (what it is) so Alexandra Langford can be labelled Lexa
  - `test_codex_pins.py` -- marking a connection by hand: the action MARKS rather than connects (no relation to get wrong, and "nothing to connect it to yet" is a good reason to mark), nothing is written into the manuscript, a pin is raised until ANSWERED rather than until a rule stops, and answering it for good removes the mark so the count stays believable
  - `test_codex_migration_report.py` -- what a conversion can SAY it did: a per-file manifest that outlives the HTTP response, and a before/after comparison read from the BACKUP (profiles/ may have been edited since), with the one content change it makes surfaced rather than hidden inside a "same" verdict
  - `test_codex_routes.py` -- the HTTP surface, including that every refusal the router raises comes from the closed set of codes in `app/codex/errors.py`, and that a connection with no REASON is refused: the Weave exists so a writer need not paste context, and `A -- connected to -- B` spends brief budget to say nothing the prose did not already show
  - `test_codex_icon_keywords.py` -- TWO cross-language contracts, both read `lexicon.ts` from Python: every icon name the app can store is bundled, and every stop kind `scan.py` can send has words on screen
  - `test_codex_mentions.py` -- an ambiguous mention NEVER silently binds (a bound mention pulls a Thread into AI context, so a wrong bind is invisible); the two things allowed to settle one
  - `test_codex_snags.py` -- the structural checks, and the one deliberately NOT made: a value changing across the book is the feature, not a contradiction
  - `test_codex_together.py` -- who shares a SCENE with whom: why the unit is the scene and not the chapter (a chapter that cuts between locations must not pair up strangers), an ambiguous name never counted as present, and the floor that keeps Untied from becoming the next 177-entry noise problem
  - `test_codex_scan.py` -- the free pass; stops re-derived and never stored; a non-UTF-8 chapter skipped and named rather than taking the scan down; and the Loose thread wording, which is a question about how an entry relates to OTHER entries and says up front (with a count) that the prose already finding the name is a separate thing that works
  - `test_codex_findings.py` -- a run survives deleting `app.db`; staged-then-discarded comes back; applied and dismissed never do; staleness checked locally with no AI call
  - `test_codex_context.py` -- the amended context rule, one test per obligation; pinned content never pruned and refused rather than truncated
  - `test_codex_weaving_routes.py` -- scan / run ledger / brief end to end; a run id off the wire is not trusted as a path
  - `test_world_rules.py` -- the Unwoven corpus: every unlock and crosslink resolves, a crosslink always leaves its domain, every answer lands somewhere the app understands
- `app/src/**/*.test.{ts,tsx}` -- vitest + `@testing-library/react`, runs in jsdom. Current files:
  - `src/components/progress/ProjectCompletionGauge.test.tsx` -- compact bar, slide-over, serial mode
  - `src/components/editor/ThesaurusPopover.test.tsx` -- thesaurus popover
  - `src/components/sidebar/ActGroup.test.tsx` -- acts tree pieces (ActGroup + RowMenu)
  - `src/hooks/useProjectUiState.test.ts` -- per-book UI-state hook (load guard, debounce)
  - `src/components/learn/Explain.test.tsx` -- the self-explanation contract: every entry answers what / why / necessary / what-it-spends, uses the app's own words rather than the code's, and the screens a writer can get stuck on are read as SOURCE to prove they actually render it (a registry nothing renders is documentation, not help)
  - `src/utils/spellcheck.test.ts` -- spellcheck suggestions
  - `src/utils/buildEditorChatPayload.test.ts` -- Writing Companion payload builder + history persistence (appendTurnToHistory)
  - `src/utils/modelFiltering.test.ts` -- model list filtering + recommended models (provider-aware)
  - `src/components/settings/ProviderPanel.test.tsx` -- per-provider Settings panels + PROVIDER_META registry (incl. the local entry: no key field, and the note stating the local-only restriction)
  - `src/components/settings/ModelRolesSection.test.tsx` -- the Model Roles screen: each role names the features it covers, roles nothing uses yet say so, unassigned roles name the Default Model they fall back to, and an assignment that cannot run warns that it will REFUSE rather than substitute
  - `src/data/characterSpines.test.ts` -- Enneagram/archetype canned-content contracts (fiction-first, fill-in hooks, no em dashes)
  - `src/data/traitPools.test.ts` -- trait randomizer: tier replacement semantics, archetype flavor bias, deterministic rolls
  - `src/data/names/fantasyNames.test.ts` -- fantasy name assembly: 12-race roster, deterministic rng, speakability fuzz, phonology disjointness
  - `src/components/profiles/NameGeneratorPanel.test.tsx` -- generator panel: optgroups, era hiding for races, 6+6 deals, partial accept, fallback note
  - `src/features/audiobook/AudiobookDashboard.test.tsx` -- audiobook dashboard: recents render, empty state, open flow, remove-keeps-files endpoint
  - `src/features/audiobook/WorkspaceView.test.tsx` -- narration editor: inline pause insertion (scroll preserved), [say]/[exclude]/pace wraps, Remove marker stripping, manual save PUT + chapter re-derive, marker help panel, pronunciation dialog
  - `src/features/audiobook/GenerationPanel.test.tsx` -- narration rail: voices load, generate posts + live progress, paused-run resume, failed-segment surfacing, up-to-date force flow, engine-unavailable message
  - `src/features/audiobook/anchorPlacement.test.ts` -- the [say] popout is never placed below the halfway line (it expands after opening) and never hangs off an edge
  - `src/features/audiobook/markers.test.ts` -- stripAudioMarkers (wrappers dissolve, words never deleted) + paragraphBoundsAt
  - `src/features/audiobook/ImportPanel.test.tsx` -- Get Started flow (spec 5.1.2): workspace location auto-chosen and explained, override sticks, Create posts source + workspace + title
  - `src/features/audiobook/BookDetailsPanel.test.tsx` -- metadata form: loads on mount, dirty tracking (manual save), full-field PUT, cover pick/validate/preview/remove
  - `src/features/audiobook/SayEditor.test.tsx` -- the [say] popout: brackets are chrome, Accept wraps and hops, already-overridden occurrences skipped, Preview sends the word's sentence
  - `src/features/audiobook/insertScan.test.ts` -- walkthrough scanner contract, pinned with the user's real manuscript examples incl. broken-marker repairs, plus the word-reading axis (whole words only, never inside a say span, never collapsed against a beat on the same spot) and the marker-aware `sentenceAround`
  - `src/features/audiobook/heteronyms.test.ts` -- the shipped word-reading table's contracts: every rule here is a way the ENGINE was measured to fail (no mid-word capital -- espeak splits the word; no `ih` before a consonant -- the h is spoken; the already-correct words and the deferred stress family stay out)
  - `src/features/audiobook/InsertWalkthrough.test.tsx` -- walkthrough panel: stops walk in order, Apply is a buffer edit (never a save), Skip advances, per-kind muting, Ctrl+Enter fast path; the pop-out shell (a dialog, backdrop closes it, kinds say what they are FOR, the whole paragraph is shown and never spills into the next, an empty walk offers a way out); the guided walk explains SOUND rather than buttons, gives every beat kind before/after audio, and frames marker repairs as repairs; word readings offer each candidate as AUDIO with nothing pre-selected, play the writer's own sentence, cache replays, count the same word ahead instead of applying in bulk, and are excluded from Auto-apply
  - the tutorial's own contracts: opens by saying it is optional and naming the engine's faults, teaches what a pause IS before naming a place to put one, runs one continuous scene through the beat steps, admits the short-burst suggestion is a matter of taste, gives word readings their own two Play buttons, and has no keyboard step (those moved under the buttons)
  - tutorial navigation in that file goes by step TITLE, never a click count -- a count breaks whenever a step is inserted, and matching a bare title silently matches the mute-checkbox labels behind the card
  - `src/features/audiobook/AudiobookSettingsDialog.test.tsx` -- settings surface: a masked key is never sent back, engine shelf + demoted drawer with reasons, empty-tier admission, pace re-scale notice
  - `src/features/audiobook/PremiumNarrationPanel.test.tsx` -- the money gate: engine reported not chosen, unusable engine offers no buttons, estimate precedes any confirm, a stale estimate cannot survive an engine change
  - `src/features/audiobook/VoicePicker.test.tsx` -- one picker, three shapes (two dropdowns / one / free text), value stays a single composed id in all of them
  - `src/features/audiobook/ToggleSwitch.test.tsx` -- a switch, not a checkbox: its look carries the state
  - `src/features/audiobook/SpokenLine.test.tsx` -- the read-aloud flourish never costs readability (every word present as text, spaces survive, staggered delays)
  - `src/features/audiobook/CastPanel.test.tsx` -- the cast screen: manuscript names offered as one-click adds, duplicate names block the save, one-book-one-engine explained
  - `src/features/audiobook/speakerScan.test.ts` -- the Cast workbench's scanner: chapter ranges, one stop per PARAGRAPH, tags read both ways, pronouns rejected, a tag never leaks across a paragraph break, assign/reassign/clear round trips, character removal counts usage and keeps every word
  - `src/features/audiobook/CastPanel.test.tsx` -- the workbench: help stays closed until asked, voices fold once a cast exists, Pro column only when connected, only this chapter's characters shown, a click lands on the buffer immediately, removal warns with real counts
  - `src/features/audiobook/StorageDialog.test.tsx` -- the delete screen: only free-to-rebuild categories pre-checked, losses stated on the row, the confirm repeats categories + size, cancelling deletes nothing, locked files surfaced
  - `src/features/audiobook/ExportPanel.test.tsx` -- retention after export: keep says nothing, ask shows the size, auto-delete acts and reports it, and only intermediate audio is ever removed
  - **The Weave**:
  - `src/features/codex/lexicon.test.ts` -- one vocabulary: every term has an icon, a line and a longer answer, keyed by the WIRE CODE the backend sends
  - `src/features/codex/layout.test.ts` -- deterministic graph layout: adding a node never moves the others
  - `src/features/codex/Scrubber.test.tsx` -- the story timeline: a stop per chapter, act bands sized by how much book each act is, and the resting chapter's title EXPANDED and wrapped while neighbours truncate (the cause and effect the first version had none of); still a real range input, announcing "Chapter 3, Caught in the Rain" rather than "3"
  - `src/features/codex/WeaveMap.test.tsx` / `WeaveList.test.tsx` -- scrubbing an anchor, spoiler mode hiding an unrevealed Tie's EDGE, and the list as a peer view rather than a degraded one
  - `src/features/codex/ThreadEditor.test.tsx` -- writing an entry that is not a profile: sections come from the REGISTRY (so a kind added this morning works), manual save means unsaved work looks unsaved and leaving is confirmed, a conflicting save is REFUSED with the writer's text still in the buffer, and an unplaced fact can be seen as unplaced and placed against the writer's own chapters
  - `src/features/codex/TieEditor.test.tsx` -- saying how two things relate: a connection is allowed to be UNTYPED and that is the default ("just connect them", say how later), the other end before the relation, only what means something between those two kinds, "nothing else fits" answered three ways, a flipped relation stored from the OTHER end, and connections read from the end being looked at
: the other end before the relation, only what means something between those two kinds, "nothing fits" answered three ways (flip the pair, adopt a shipped relation, name your own), a flipped relation stored from the OTHER end, and connections read from the end being looked at
  - `src/features/codex/BindDot.test.tsx` -- saying what a bare dot is: the wording is load-bearing (a word MOVED, never merged or deleted), other placeholders are not offered as targets, standing alone is a real answer, and the label question says the entry keeps its own name
  - `src/features/codex/WeaveNav.test.tsx` -- the sidebar: three groups always, sections grow, and a typo'd section can be renamed or removed (a fixed one offers no menu at all)
  - `src/features/codex/GuideBody.test.tsx` / `customName.test.ts` -- the per-group guides, and the custom-name rules
  - `src/features/codex/WeavingPanel.test.tsx` -- the walkthrough: a real count rather than an estimate, every stop shows its evidence and can say why, four DIFFERENT ways to answer, and the one-click action creates an EMPTY entry that is immediately Frayed
  - `src/features/codex/MigrationPanel.test.tsx` -- consent for the most dangerous button in the programme: the dry run is not optional, the plan is itemised rather than summed, the backup is named BEFORE the button, two clicks with the count repeated, and an interrupted run offers resume or restore rather than guessing
  - `src/features/codex/MigrationResults.test.tsx` -- the account a conversion gives afterwards: every entry listed and grouped by kind (not counted), each one openable as original-vs-converted field by field, "changed" and "missing" kept distinct, and the raw files offered because a table is an interpretation
- `tests/manual-smoke.md` -- human walks through this before cutting a release. Covers the Tauri-shell flows (file dialogs, the updater, native menus, sidecar lifecycle) that automated tests can't reach today.

### Test commands

Run these from the repo root (or the subdirectory noted):

```powershell
# ── Backend (run from backend/) ───────────────────────────────────────────────
cd backend

# Run all tests (verbose, shows each test name)
uv run pytest -v

# Run all tests (quiet summary, same as /pre-release Stage 1)
uv run pytest --no-header -q

# Run a single test file
uv run pytest tests/test_progress_store.py -v

# ── Frontend (run from app/) ──────────────────────────────────────────────────
cd app

# Single-run mode -- exits when done (same as /pre-release Stage 2)
npm run test -- --run

# Watch mode -- reruns on file changes (for active development)
npm run test

# ── Full pre-release gate ─────────────────────────────────────────────────────
# Run the /pre-release slash command in Claude Code.
# It runs pytest + vitest + GitHub blocker check + manual smoke acknowledgment
# and prints a RELEASE READY / DO NOT RELEASE verdict.
# See .claude/commands/pre-release.md for the full spec.
```

**Before every release, run `/pre-release` and get a `✅ RELEASE READY` verdict before cutting the build.**
The gate cannot pass with zero tests, open `pre-release-blocker` issues, or an unacknowledged manual smoke.

### Why no automated end-to-end suite

Storythread Studio is a Tauri desktop app. File dialogs, native menus, the auto-updater, and the FastAPI sidecar live in the Rust shell, not the WebView. Playwright drives browsers, not Tauri binaries; pointing it at `localhost:1420` would give false coverage on every flow that needs the shell. Real desktop E2E (via `tauri-driver`) is a separate roadmap item. Until then, automated tests cover the React + Python layers and `tests/manual-smoke.md` covers shell-dependent paths.

There is **no staging URL.** This app is distributed as a `.msi` installer via GitHub Releases. The only "URL" is the local Vite dev server at `http://localhost:1420` during `npm run tauri dev`.

### When you find a regression

1. **Reproduce twice.** If it does not repro consistently, note that explicitly in the issue.
2. **Capture context.** Failing command output, snapshot if applicable, reproduction steps a human can follow without you.
3. **File a GitHub issue via the `github` MCP.** Title = short imperative ("Smart Advisor pass fails on chapters > 50k chars"). Body = repro / expected / actual / version / log excerpts. Labels = `qa-automation` plus an area label if obvious.
4. **Report to the user in chat** with the issue link.
5. **Do not silently fix.** Bug-fix work needs an explicit user request -- never as a side effect of test-running.

### Testing guardrails

- **Never run tests against any non-local environment.** No remote production exists. If "staging" is ever added, `/pre-release` must be updated to gate against it.
- **Never skip a failing test to make a suite pass.** No `pytest.skip`, no `xfail`, no commented-out assertions, no `it.skip(...)`. Fix the test or fix the code; do not hide the failure.
- **Never auto-merge.** All commits and PRs go through explicit human review. No `gh pr merge --auto`, no automated merge bots.

---

## Architecture Overview

Storythread Studio uses a **three-layer local architecture**. No cloud. No sync. Everything runs on the user's machine.

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
- **SQLite** (`<project>/.storythread/app.db`) -- a fast local cache. It holds Writing Progress events (`progress_event`) and, on `feature/the-weave`, the Weave's graph index (`codex_entity` / `codex_alias` / `codex_tie` / `codex_fact` / `codex_mention` / `codex_meta`). Settings live in `~/.storythread/settings.json`, NOT in this database. Anything stored here must be rebuildable from Markdown.
- **The ONE exception under `.storythread/`**: `weave/runs/<run-id>.json` holds what the writer answered during a Weaving session (applied / deferred / retired / muted). That is not derivable from anything, so it is deliberately not in `app.db` -- deleting the cache must never cost the writer answers they already gave.

Think of Markdown as the filing cabinet and SQLite as the index cards on your desk -- the cabinet is what matters; the index cards just make lookup faster.

### Project Folder Layout

Each writing project the user creates gets its own folder:

```
MyNovel/
  project.json          <- project settings (model, content mode, series linkage)
  manuscript/           <- chapter .md files
  notes/                <- outline, style guide, themes
  profiles/             <- characters, relationships, locations, lore
    arcs/               <- (series projects only) per-book character/relationship arcs
  summaries/            <- AI summaries: chapters/ + scenes/<chapter-stem>/scene-NN.md
  exports/              <- combined manuscripts and dated snapshots
  .storythread/         <- app.db, cache, logs (NOT source code)
```

Full folder schema is in `docs/architecture.md`.

---

## AI Boundaries (Critical -- Never Violate)

### The Write Boundary

AI output may only be written directly to these **designated generated-content fields** in Markdown:

- `ai_profile_summary`
- `ai_section_summary`
- `chapter_summary`
- `scene_summary`

One deliberate, user-approved exception (v1.0.10): the **[Generate Overview] button on SIDE/BACKGROUND character profiles** fills the Overview field from the writer's own filled-in fields. It is writer-clicked per use, lands in an editable field, and saves nothing until the writer saves. Scoped to fast side-character assembly only -- do NOT generalize this pattern to other human-authored fields without explicit user direction.

AI must **never silently overwrite** human-authored prose, profile descriptions, notes, or story drafts. All other AI output goes to the side panel only, where the writer copies it manually.

### The Em Dash Rule

**AI must never output em dash or en dash characters (U+2014 / U+2013).** The approved substitute is `--` (double hyphen). This is a locked product rule enforced at three layers:

1. **Prompt layer** -- every system prompt explicitly bans em dashes
2. **Sanitizer layer** -- `backend/app/ai/sanitizer.py` post-processes all model output, replacing any em/en dash with `--`
3. **Style guide layer** -- the project's style guide Markdown file records this rule

Path nuance (since v1.0.6): prose-producing paths (Draft mode, revise suggestions) keep the approved `--` punctuation; the conversational chat path additionally folds `--` into commas/colons so replies read naturally. Routing is covered by `backend/tests/test_sanitizer_routing.py`.

### Content Mode

The app supports three content modes: `general`, `mature`, `explicit`. The project `project.json` sets a default. Requests can override it. Model routing must respect content compatibility -- if no eligible model exists for a request, show a clear error rather than silently degrading.

---

## Non-Negotiable Product Rules

- **Manual save only** -- no autosave. Unsaved changes show a visual indicator. Confirm before closing.
- **One chapter open at a time** in the editor.
- **Session-only undo/redo** -- no archival draft history for prose in MVP.
- **Explicitly inspectable and controllable context** -- AI may automatically receive story context relevant to the current point in the story, but the writer must be able to inspect what will be sent, remove individual Threads, exclude categories, and turn automatic Weave context off entirely. **No context is transmitted until the writer initiates an AI action.**
  - This AMENDS the original rule ("explicit context attachment; AI never has implicit project access"), which the Weave makes untrue -- the app now assembles a brief on the writer's behalf. What is non-negotiable is that they can see it, cut it, and switch it off. Enforced in `backend/app/codex/context.py`; pinned by `backend/tests/test_codex_context.py`.
- **Every step in a walkthrough proposes the next one** -- after any completed action the screen states what happened and offers the next step, with a named exit that says what it does. Finishing a stop ADVANCES the walk; it never dismisses a panel back onto the same stop. Several separately-reported "dead ends" were all this one rule.
- **Every feature explains itself** -- each screen, panel and popup offers ONE **"What's this?"** (icon-only where a row is crowded), opening a panel that FLOATS rather than rearranging the layout, with any steps inside it under a "How to do this" heading. An explanation must answer four things or it is not one: what it is, **why** it exists or is happening now, whether it is **necessary** (required / recommended / optional), and **what it spends** -- stated even when the answer is nothing, because a model-shaped app trains people to expect a meter running. This is a TYPE, not a habit: `app/src/components/learn/explanations.ts`, rendered by `<Explain of="key" />`. The two rules above are halves of one thing -- flow makes the app ask what is next, this lets it answer how and why and at what cost.
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

- **Dark mode** -- Charcoal-black background #0F172A (approximately `#1A1A1A`), off-white `#F0F0F0`/light `#E0E0E0` text, secondary text `#60A5FA`, Accent: #22C55E, high contrast. 
- **shadcn/ui** with Tailwind CSS for all components -- clean, modern, fully customizable
- **Three-panel layout** on the main writing screen: left navigation panel, center Markdown editor, right AI assistant panel
- **Embedded UX hints** are a first-class design feature: tooltips, contextual help text, and onboarding cues built into the UI from the start -- both to help the fiction writer use the app and to help the developer understand what each UI piece does
- The **writer's text** is always the visual focus. UI chrome should be minimal and non-intrusive.

---

## Available MCP servers

Two MCP servers are configured for this project (see `.mcp.json`). Use them where they help; skip them where they would mislead.

### playwright (research / ad-hoc only)

**Use when:**
- Fetching content from external web pages when WebFetch is not enough (heavy JS, login-walled docs, complex SPAs).
- Capturing accessibility snapshots of external sites for debugging or comparison.
- Ad-hoc browser exploration on `http://localhost:1420` when WebFetch cannot reach the interaction you need.

**Do NOT use when:**
- Running `/pre-release`. Playwright cannot drive the Tauri shell; coverage would be misleading. The pre-release gate uses pytest + vitest + the manual smoke checklist.
- Testing any flow that depends on `@tauri-apps/api` (file dialogs, the updater, native menus, the embedded sidecar). Those simply do not exist when Playwright drives a plain browser.
- Replacing pytest or vitest for any automated-test purpose.

### github (issues + repo metadata only)

**Use when:**
- Filing a `qa-automation` issue for a regression (see "When you find a regression" under Testing).
- Listing open `pre-release-blocker` issues during `/pre-release`.
- Reading existing issues for context when debugging or understanding a feature's history.
- Adding labels or comments to existing issues with explicit user approval.

**Do NOT use when:**
- Creating or modifying releases. Use the workflow in `docs/RELEASING.md` and `scripts/release.ps1`.
- Force-pushing or rewriting git history.
- Merging pull requests. Never auto-merge -- see the testing guardrails above.
- Closing issues without explicit user direction.

---

## Key Reference Files

| File | Contains |
|---|---|
| `docs/product-scope.md` | Core goals, writing philosophy, locked product rules, in/out-of-scope |
| `docs/architecture.md` | Three-layer architecture, dual storage model, folder layout, current API surface |
| `docs/features.md` | What the product does today: editor, Profile Builder, Smart Advisor, Writing Companion, series, exports, settings |
| `docs/roadmap.md` | Scheduled / Proposed / Nice-to-Have features, plus dropped items |
| `docs/RELEASING.md` | Release runbook (signing key setup, per-release checklist) |
| `CHANGELOG.md` | Shipped changes per version |
| `README.md` | Public-facing project description, install instructions, donation links |
