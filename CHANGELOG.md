# Changelog

All notable changes to Storythread Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is simple release counting, not semver: the last number bumps by
one each release (and keeps counting past 9). A middle-number bump is
reserved for a fundamental change.

The release script reads entries under `## [Unreleased]` and moves them
into a new tagged section when cutting a release. To add a changelog
entry while working on a feature, append it under Unreleased.

---

## [Unreleased]

### Added

- **Smart Advisor: Timeline and Scene Goal checks.** Two new subcategories under the Context pass: Timeline flags event-order, elapsed-time, time-of-day, and season continuity slips; Scene Goal flags passages that drift from the scene's apparent purpose or stall without advancing anything.
- **Per-chapter word targets in Writing Progress.** When the outline frontmatter assigns `chapters[].word_target` values, the Progress slide-over now shows a per-chapter breakdown with a mini progress bar for each targeted chapter (green at 100%). Chapters without a target show their word count as an info row.
- **Reasoning toggle in the Writing Companion.** When the active model can return a reasoning trace, a Reasoning toggle appears next to Draft and Enhance. With it on, each AI reply includes a collapsible "Reasoning" block showing how the model thought through its answer. Hidden entirely for models that don't support it.
- **"What's this?" help for chat modes.** A help button beside the Draft / Enhance / Reasoning toggles expands a plain-language panel explaining what each mode does and when a writer would use it -- including default Chat, and a note on why the Reasoning toggle is sometimes absent.

### Changed

- **Cost tier slider: four explicit stops.** The tier control in Settings and Project Settings now reads Free / Lowest / Pricier / Priority Best. At Priority Best, flagship-class picks are pinned in their own group at the top of the model list for one-click access. Stored values are unchanged, so existing settings carry over.
- **Project cost tier now filters the project model picker.** The per-project tier (previously guidance-only) caps which models the Project Settings picker offers, alongside the existing content-mode filter.
- **Text-only model filter now applies everywhere.** The "hide models that output images, audio, or video" preference from Settings now also filters the per-project model picker, not just the global one.

### Fixed

---

## [1.0.7] - 2026-07-01

### New

- **Enhance** -- a new mode in the Writing Companion. Highlight any passage and tell the AI how you want it improved: add sensory detail, deepen the mood, adjust how a character comes across, tighten the pacing, or work in a description. Choose how far it goes, Restate (reword at the same length), Default (a richer pass), or Expanded (a fuller rewrite), and it draws on the surrounding scene for continuity. Nothing changes automatically; the rewrite appears in the chat for you to place where you want it.
- **Scene break suggestions** -- click "Suggest Breaks" and the AI reads your chapter and points out where a scene break would strengthen the pacing, with a short reason for each. You decide what to use.
- **Canon or Reference for your attachments** -- when you attach character profiles, an outline, or locations, you can now choose how the AI uses them: Canon keeps your writing consistent with them, or Reference lets your in-the-moment instructions lead. A built-in tip explains when to use each.
- **"New ask"** -- start a fresh request in the Writing Companion any time, without clearing the conversation you want to keep.

### Refinements

- Friendlier guidance if an AI model you used in a past session is no longer available, and model changes now take effect right away.
- And to make picking a replacement easy, a refreshed, up-to-date list of recommended models in Settings, tailored to your project's content mode, for example: **DeepSeek V3** (best budget quality) · **xAI Grok 4.3** (vivid drafts, unmoderated) · **Sao10K Llama 3.3 Euryale 70B** (tuned for immersive fiction).
- Smoother, steadier typing in the Outline and Profile editors.

---

## [1.0.6] - 2026-06-18

### Added

- **Draft mode in the Writing Companion.** A new Draft mode toggle next to the chat input turns the AI from a discussion partner into a drafting partner: with it on, your message is treated as a premise and the AI writes actual scene prose from it, using your attached context chips (outline, character, location profiles) as canon. Output is plain manuscript-style paragraphs with no preamble or editorial sign-off, runs about 800 to 1200 words per segment, and stops at a natural beat rather than forcing a scene ending. A **Continue** button appears under the AI's reply: click it and the next segment is written from where the prose left off, so a scene or chapter can be built up indefinitely one segment at a time. Draft mode is off by default, so normal discussion chat is unchanged. Drafted prose keeps the approved `--` punctuation (only the conversational chat path folds it to commas), and a one-time, dismissible nudge suggests switching to a stronger model when drafting on a budget tier that tends to produce generic prose.

### Fixed

- **Outline Planner: sections missing or silently deleted after Raw view edits.** A corruption bug caused the YAML frontmatter closing `---` to fuse with the first `## ` section heading onto one line (e.g. `---## Setting in One Paragraph`). This caused three cascading failures: the frontmatter parser mis-fired and absorbed section content into the YAML body (silently losing YAML field values like word targets and expected characters); the section parser never saw the fused heading; and if the user then saved anything from the Planner (even just editing Project Targets), the Planner wrote back its incomplete section list and permanently deleted the un-parsed sections from disk. Fixed at three layers: (1) `GET /api/documents/outline` now heals `---## ` fusions in the raw file *before* any parsing and writes the repaired content back to disk immediately, so YAML values are always read correctly and the file is safe before any subsequent Planner save; (2) `_reconstruct_outline` always inserts a newline between the YAML block and preamble so the fusion cannot be created again; (3) `_parse_outline_sections` normalizes bodies that start with `## ` so sections at position zero are never silently absorbed into the invisible preamble. Eleven regression tests added.

---

## [1.0.5] - 2026-05-27

### Added

- **Spelling corrections in the right-click menu.** Right-clicking a word in the editor now leads with a **Spellcheck** section when the word is misspelled, listing dictionary-backed corrections above the Thesaurus synonyms. Previously the thesaurus popover suppressed the browser's native right-click menu, so a misspelled word showed "No synonyms found" with no way to fix the spelling. Corrections come from a bundled offline dictionary (Hunspell `en` via `nspell`), click a suggestion to replace the word with its capitalization preserved. The red squiggle still comes from the system spell checker; the Spellcheck section only appears when the dictionary has suggestions, so it stays out of the way for invented character and place names.

### Fixed

- **OpenRouter API key no longer lost when installing an update.** Settings were written with a plain truncate-then-write, so if the backend was force-killed mid-write during a patch install, `settings.json` could be left empty and the saved API key silently wiped (falling back to blank defaults). Saves are now atomic (write to a temp file, then `os.replace`), a one-generation `settings.json.bak` is kept, and on startup a corrupt or empty `settings.json` is automatically recovered from the backup before falling back to defaults. A fresh install on a new machine still starts with no key, as intended.

---

## [1.0.4] - 2026-05-20

### Quick Fix

- **Per User feedback: OpenRouter error messages are now actionable.** Rate-limit (429), insufficient-credits (402), invalid-key (401), and service errors (5xx) from OpenRouter now show a plain-English message explaining what happened and what to do, instead of a raw HTTP status code or generic "AI request failed" text. Affects all AI features (Smart Advisor, Writing Companion, Profile Builder, scene/chapter summaries, and all editor-pass tools).

---

## [1.0.3] - 2026-05-15

### Added

- **Global Search + Replace (Ctrl+Shift+F).** Find any word or phrase across every file in the project -- manuscript chapters, notes, profiles, summaries, and arcs -- in a single modal. Results are grouped by file with three lines of context per match; each hit is individually checkboxable so you can replace selectively. Three replace modes: Replace (one hit), Replace in File (all checked hits in that file), Replace All (everything checked). Every replace operation first snapshots the touched files to `.storythread/snapshots/global-replace/<timestamp>/` so the in-modal Undo button can restore them. If the currently open chapter is modified, the editor reloads it automatically and shows a brief banner. Toggles for case-sensitive and whole-word matching.

- **Thesaurus.** Right-click (or select + right-click) a word in the editor to open a thesaurus popover. Synonyms come from the Datamuse API (free, no key required). Click a synonym to replace the word in place. Built as a CodeMirror context-menu extension paired with a React popover.

- **Export: TXT, DOCX, and EPUB.** The full-manuscript and snapshot exports now write to four formats. TXT strips Markdown formatting and writes plain text. DOCX uses `python-docx` and preserves headings and paragraphs. EPUB uses `ebooklib` with proper chapter structure. All three appear in the existing Export modal alongside the original Markdown option.

- **Reader Mode.** A clean two-page spread view of the full manuscript rendered as formatted prose. No editor chrome, no toolbars -- just typography tuned for proofreading and enjoyment (line height, margins, readable font size). Keyboard shortcut to enter and exit; pure frontend, no backend changes.

- **Writing Progress tracking.** A project-completion gauge in the left panel (below the project title, above the navigation) shows overall progress as a `[==== ] N%` bar against a target derived from the project's `story_type` or, when present, from the Outline's new YAML frontmatter block. Clicking the gauge expands a slide-over panel (constrained to the left panel) with the per-segment breakdown: Manuscript 50% / Outline 10% / Profiles bucket 30% / Notes 10%, with manuscript-heavy fallback when no Outline frontmatter exists. Loose name matching against `expected_characters`, `expected_locations`, `expected_lore`, and `expected_relationships` lists in the outline drives the profiles bucket and surfaces unresolved Outline names so the writer can spot typos. Serial fiction projects show a placeholder card instead of the gauge -- the percentage model doesn't apply to chapter-self-contained serial work yet.

- **Daily goal tracker.** Inside the gauge's slide-over, a "Today" section shows words written and task credits earned against a target chosen in Settings (Newbie 500 / Beginner 750 / Novice 1,250 / Amateur 2,500 / Experienced 4,000 / Full-time 7,500 / Professional 10,000 words per day, with matching task quotas). A 7-day sparkline shows hit/miss per day with tooltips for word and task totals. A "task" is one tracked file edited per day; running a Smart Advisor Default pass on a chapter also earns it a task credit, as does running all three category passes (Readability + Structure + Context) separately on the same chapter the same day.

- **Outline Planning view.** Clicking "Outline" in the left nav now opens a dedicated planning screen instead of the raw Markdown editor. The top card shows project targets (word count, expected characters / locations / lore / relationships) as editable chip-tag inputs. Each `## Heading` section in the outline is rendered as a collapsible card with an auto-resizing textarea. Ctrl+S saves; a dirty indicator tracks unsaved changes. A "Raw view" button escapes to the Markdown editor for freeform editing.

- **Outline YAML frontmatter.** New outlines now start with a YAML frontmatter block at the top recording `target_word_count`, `expected_characters`, `expected_locations`, `expected_lore`, `expected_relationships`, and a `chapters` list for optional per-chapter word targets. Older outlines without frontmatter keep working -- the gauge falls back to per-story-type defaults (novel 90k, novella 30k, novelette 13k, short story 6k).

- **Settings: Writing Progress section.** New "Writing Skill Level" dropdown drives the daily word and task targets. New "Day Rollover" toggle: Midnight (default) or Night Owl (4 AM) for writers who work past midnight.

### Changed

### Fixed

- **Backend sidecar not killed on app close.** Closing the app window left `storythread-backend.exe` running and holding port 8000. The root cause was that `CommandChild::kill()` in tauri-plugin-shell v2 queues the kill through the async runtime -- by the time the window-destroyed event handler returns, the runtime has begun shutting down and the kill task never executes. The fix replaces the async kill with a synchronous `taskkill /F /IM` call that blocks until the process is dead before the handler returns. The app now reliably terminates the backend on every clean close.

- **Stale sidecar port conflict on app start.** On startup, the app now kills any orphan sidecar holding port 8000 from a previous unclean exit before spawning its own, instead of failing to bind and erroring out.

- **Ko-fi button and close button displayed garbled characters.** The ☕ and ✕ characters in the About panel were stored as UTF-8 bytes but read by the editor as Latin-1, producing `â˜•` and `âœ•`. Replaced with a lucide `Coffee` icon and the literal `✕` character.

---

## [1.0.1] - 2026-05-14

A focused tuning release. Smart Advisor produces noticeably more usable feedback on raw drafts, the chat-and-context workflow gains chapter and scene summaries, and the interface gets a font-size control for writers who want larger text. Plus a Markdown-aware copy from AI replies that lands ready-to-paste in the editor.

### Added

- **Context Smart Advisor: Attach Profiles button and info hint.** The Context category button in the Smart Advisor bar now includes an "Attach Profiles" button that opens the chip picker directly from the toolbar. An (i) info popover explains that Context requires attached character, relationship, location, or lore profiles to find inconsistencies. Both elements disappear once at least one profile is attached.

- **Smart Advisor: selection-scoped passes.** Highlight a paragraph or scene before clicking Readability / Structure / Context and the pass runs only on that selection instead of the whole chapter. A scope pill on the toolbar shows "full chapter" (default) or "selection (N words)" (amber) live as you change selection. A 5-word floor prevents accidental single-word selections from narrowing the pass.
- **Chapter and Scene summaries as context chips.** The Attach Context panel now exposes Chapter Summary and Scene Summary tabs. The Scene Summary tab is a collapsible tree grouped by chapter with the current chapter's group auto-expanded. Two new backend endpoints â€” `GET /api/documents/chapter-summaries` and `GET /api/documents/all-scene-summaries` â€” make the lists load in a single round trip.
- **UI font scale.** New "Interface size" control in Settings â†’ Appearance with four steps (Default / Larger / Larger+ / Largest). Drives the root `<html>` font-size so every Tailwind rem-based utility scales proportionally â€” menus, sidebars, Settings, About, profile labels, and so on.
- **Separate text-entry sizing.** Writer-facing text input surfaces (chat boxes, profile description and notes fields, scene-summary editing) scale on a more aggressive ladder than chrome (16 / 17 / 19 / 22 px) because +1 px increments past 17 px were imperceptible in those surfaces in practice. Driven by a `--text-entry-size` CSS variable applied via a new `.text-entry` class.
- **Markdown-preserving copy from AI chat.** Selecting text in a chat bubble and copying now writes Markdown to the clipboard instead of plain text. Bold becomes `**bold**`, italics become `*italic*`, underline becomes `<u>underline</u>`, lists keep their `-` / `1.` prefixes, blockquotes keep their `>` prefixes, inline code keeps its backticks. Color and other purely-visual styling are stripped. Both the Writing Companion and Profile Builder chats are covered through the shared `ChatMarkdown` component.

### Changed

- **Smart Advisor: issue ceiling raised.** The "3 to 12 issues per pass" cap that suited revision-stage prose was suppressing useful feedback on raw drafts. The system prompt now calibrates the expected count by draft stage (polished: 0-5; revision-stage: 10-25; raw first draft: 30-50) and explicitly tells the model not to artificially cap the list. Quality remains a tiebreaker on minor cosmetic flags, not a numeric cap.
- **Smart Advisor: in-context suggestions.** Every suggestion now has to improve the passage in the actual context where the quote appears, not in isolation. The prompt instructs the model to re-read the sentences immediately before and after each flagged quote and reject suggestions that create new repetition, restate adjacent content, break a metaphor or callback, or clash with surrounding tone or pacing. Includes a worked example illustrating the failure mode.
- **AI continuation prompt rewritten.** The "WHEN THE WRITER ASKS TO CONTINUE" rules used to be a 7-bullet list. They've been replaced with explicit How-to-start and How-to-stop sections that forbid the specific failures writers were hitting: preambles like "Here's the continuation,", recap or restatement of the last paragraph, unrequested time jumps or scene breaks, premature closing beats that artificially end the scene, and editorial sign-offs after the prose. The frame is now "this is a JOIN, not a new scene" â€” the first word of the output is the next word of the story, and the chunk ends mid-flow by default.

### Fixed

- **Backend sidecar port leak.** Closing the app left the bundled backend process (`storythread-backend.exe`) running as an orphan, holding port 8000. Subsequent launches (or dev sessions) would fail with a socket permission error until the process was killed manually. The `CommandChild` handle is now stored in Tauri managed state and explicitly killed via `on_window_event(Destroyed)` when the window closes.
- **Missing Tauri plugin npm packages.** `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` were listed in `package.json` but not installed, causing Vite import errors on `npm run tauri dev` and a TypeScript build failure on `npm run tauri build`.
- **Rust compile error in release builds.** `tauri::Manager` trait was not imported in `lib.rs`, causing the compiler to fail to resolve `manage`, `state`, and `app_handle` method calls needed by the sidecar lifecycle fix.

### Roadmap (not shipped)

- Cloud-sync path detection and local snapshot trail added to `docs/roadmap.md` as Proposed. Motivated by a confirmed Google Drive incident that silently restored an older chapter file hours after a successful local save in a writer's Drive-synced project folder.

---

## [1.0.0] - 2026-05-08

First public release.

### Added

- Local-first Markdown writing app for Windows, packaged as a Tauri desktop bundle
- Profile system: character, relationship, location, lore, and series-canonical profiles with structured trait blocks and importance levels (core, present, background, contextual, hidden)
- Smart Advisor with Readability, Structure, and Context passes; inline issue highlights with click-to-review popovers, eight creative-transformation revise modifiers (Default / Rewrite / Expand / Shorten / Describe / Rephrase / Add Sensory Detail / Change Tone), word-level diff display showing exactly what each suggestion changes
- Writing Companion chat panel for open conversational AI help with explicit context-chip attachment (Summary / Traits / Overview / Details checkboxes per chip)
- Series structure with shared canonical profiles and per-book arc files
- Full-manuscript export and dated snapshot export with optional inclusion of summaries, notes, and profiles
- Per-scene summaries with automatic chapter splitting on horizontal-rule scene breaks
- Light and dark themes
- Em dash sanitizer enforced at the prompt, post-process, and style guide layers
- Backend health monitor with a single actionable banner replacing per-feature fetch errors
- Auto-update infrastructure with launch-time check, summary of changes, and explicit download/install confirmation

### Fixed

- Backend sidecar hung at startup in installed builds, causing "Failed to fetch" errors on first project open. The Tauri shell plugin pipes the child process's stdout and stderr through a Receiver that the setup hook was dropping; uvicorn's startup log lines filled the OS pipe buffer and blocked the backend from binding to port 8000. The setup hook now drains the receiver in a detached task so the backend can start cleanly.
- API requests from the installed app were blocked by CORS even after the backend started, because the allowlist only included Tauri v1's `tauri://localhost` origin. Tauri v2 on Windows uses `http://tauri.localhost`; both Tauri v2 origins are now on the allowlist.

[Unreleased]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.7...HEAD
[1.0.7]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.1...v1.0.3
[1.0.1]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/StoryThread-Dean/StorythreadStudio/releases/tag/v1.0.0
