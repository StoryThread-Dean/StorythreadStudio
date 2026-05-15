# Changelog

All notable changes to Storythread Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release script reads entries under `## [Unreleased]` and moves them
into a new tagged section when cutting a release. To add a changelog
entry while working on a feature, append it under Unreleased.

---

## [Unreleased]

### Added

### Changed

### Fixed

---

## [1.0.1] - 2026-05-14

A focused tuning release. Smart Advisor produces noticeably more usable feedback on raw drafts, the chat-and-context workflow gains chapter and scene summaries, and the interface gets a font-size control for writers who want larger text. Plus a Markdown-aware copy from AI replies that lands ready-to-paste in the editor.

### Added

- **Context Smart Advisor: Attach Profiles button and info hint.** The Context category button in the Smart Advisor bar now includes an "Attach Profiles" button that opens the chip picker directly from the toolbar. An (i) info popover explains that Context requires attached character, relationship, location, or lore profiles to find inconsistencies. Both elements disappear once at least one profile is attached.

- **Smart Advisor: selection-scoped passes.** Highlight a paragraph or scene before clicking Readability / Structure / Context and the pass runs only on that selection instead of the whole chapter. A scope pill on the toolbar shows "full chapter" (default) or "selection (N words)" (amber) live as you change selection. A 5-word floor prevents accidental single-word selections from narrowing the pass.
- **Chapter and Scene summaries as context chips.** The Attach Context panel now exposes Chapter Summary and Scene Summary tabs. The Scene Summary tab is a collapsible tree grouped by chapter with the current chapter's group auto-expanded. Two new backend endpoints — `GET /api/documents/chapter-summaries` and `GET /api/documents/all-scene-summaries` — make the lists load in a single round trip.
- **UI font scale.** New "Interface size" control in Settings → Appearance with four steps (Default / Larger / Larger+ / Largest). Drives the root `<html>` font-size so every Tailwind rem-based utility scales proportionally — menus, sidebars, Settings, About, profile labels, and so on.
- **Separate text-entry sizing.** Writer-facing text input surfaces (chat boxes, profile description and notes fields, scene-summary editing) scale on a more aggressive ladder than chrome (16 / 17 / 19 / 22 px) because +1 px increments past 17 px were imperceptible in those surfaces in practice. Driven by a `--text-entry-size` CSS variable applied via a new `.text-entry` class.
- **Markdown-preserving copy from AI chat.** Selecting text in a chat bubble and copying now writes Markdown to the clipboard instead of plain text. Bold becomes `**bold**`, italics become `*italic*`, underline becomes `<u>underline</u>`, lists keep their `-` / `1.` prefixes, blockquotes keep their `>` prefixes, inline code keeps its backticks. Color and other purely-visual styling are stripped. Both the Writing Companion and Profile Builder chats are covered through the shared `ChatMarkdown` component.

### Changed

- **Smart Advisor: issue ceiling raised.** The "3 to 12 issues per pass" cap that suited revision-stage prose was suppressing useful feedback on raw drafts. The system prompt now calibrates the expected count by draft stage (polished: 0-5; revision-stage: 10-25; raw first draft: 30-50) and explicitly tells the model not to artificially cap the list. Quality remains a tiebreaker on minor cosmetic flags, not a numeric cap.
- **Smart Advisor: in-context suggestions.** Every suggestion now has to improve the passage in the actual context where the quote appears, not in isolation. The prompt instructs the model to re-read the sentences immediately before and after each flagged quote and reject suggestions that create new repetition, restate adjacent content, break a metaphor or callback, or clash with surrounding tone or pacing. Includes a worked example illustrating the failure mode.
- **AI continuation prompt rewritten.** The "WHEN THE WRITER ASKS TO CONTINUE" rules used to be a 7-bullet list. They've been replaced with explicit How-to-start and How-to-stop sections that forbid the specific failures writers were hitting: preambles like "Here's the continuation,", recap or restatement of the last paragraph, unrequested time jumps or scene breaks, premature closing beats that artificially end the scene, and editorial sign-offs after the prose. The frame is now "this is a JOIN, not a new scene" — the first word of the output is the next word of the story, and the chunk ends mid-flow by default.

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

[Unreleased]: https://github.com/dataguydpeterson-cmyk/StorythreadStudio/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/dataguydpeterson-cmyk/StorythreadStudio/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/dataguydpeterson-cmyk/StorythreadStudio/releases/tag/v1.0.0
