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

- Backend sidecar hung at startup in installed builds, causing "Failed to fetch" errors on first project open. The Tauri shell plugin pipes the child process's stdout and stderr through a Receiver that the setup hook was dropping; uvicorn's startup log lines filled the OS pipe buffer and blocked the backend from binding to port 8000. The setup hook now drains the receiver in a detached task so the backend can start cleanly.
- API requests from the installed app were blocked by CORS even after the backend started, because the allowlist only included Tauri v1's `tauri://localhost` origin. Tauri v2 on Windows uses `http://tauri.localhost`; both Tauri v2 origins are now on the allowlist.

---

## [1.0.0] - TBD

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

[Unreleased]: https://github.com/dataguydpeterson-cmyk/StorythreadStudio/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/dataguydpeterson-cmyk/StorythreadStudio/releases/tag/v1.0.0
