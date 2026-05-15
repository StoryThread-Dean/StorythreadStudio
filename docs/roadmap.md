# Roadmap

This is a living document. Items move between buckets as priorities change. Anything that ships drops off this list and lives in [`features.md`](features.md). Anything intentionally not built lives in [`product-scope.md`](product-scope.md) under "Out of scope."

For shipped releases see [`../CHANGELOG.md`](../CHANGELOG.md).

---

## Scheduled

Committed work for the near-term roadmap.

### v1.0.2 Release

Planned features for the next release, in implementation order:

**Thesaurus** — Right-click (or select + right-click) a word in the editor to open a thesaurus popover. Fetches synonyms from the Datamuse API (free, no key). Click a synonym to replace the word in place. CodeMirror context-menu extension + React popover.

**Export: TXT, DOCX, EPUB** — Expand the existing export system beyond Markdown. TXT strips Markdown formatting. DOCX uses `python-docx` and preserves headings/paragraphs. EPUB uses `ebooklib` with chapter structure. All three surface in the existing Export modal alongside the current Markdown option.

**Reader Mode** — A clean full-screen (or panel) view of the current chapter rendered as formatted prose. No editor chrome, no toolbars. Tuned typography (line height, margins, readable font size) for proofreading and enjoyment. Keyboard shortcut to enter/exit. Pure frontend — no backend changes.

**Writing Progress Tracking** — Word count per chapter aggregated to a project total, measured against a target derived from the project's `story_type` (short story / novelette / novella / novel / series). Progress bar on the project home or a persistent footer indicator. Optional chapter-level word-count targets from the Outline. Includes daily word count tracking.

**Global Search + Replace** — Search across all Markdown files in `manuscript/`, `notes/`, and `profiles/`. Results grouped by file with line context. Replace is per-match or replace-all within a file. Backend scans files; frontend shows results with confirm step before writing.

---

### Level 3: Collaborative Draft

A new AI mode where the writer and AI co-draft a passage turn-by-turn from an outline beat. Distinct from today's copy-and-paste assistance pattern. Surface to be designed — likely a dedicated panel mode, not an inline overlay. Keeps the locked rule that AI never writes story prose unless the writer explicitly asked.

### Streaming responses (SSE)

Replace blocking AI calls with server-sent events so chat replies and Smart Advisor passes render character-by-character. Affects the Writing Companion chat, Profile Builder chat, and the editor-pass endpoint. OpenRouter supports SSE natively; the work is on the FastAPI streaming layer and the React reader.

### Prompt caching toggle

Wire OpenRouter's cache headers for static context (profile chips, lore, style guide) so repeated requests in a session do not re-bill the same tokens. Settings toggle, default on.

---

## Proposed

Worth building, prioritization not yet committed.

### Smart Advisor: Style Controls category

A fourth top-level Advisor category alongside Readability / Structure / Context. Subcategories: Readability Level, Formality, Descriptive Intensity, Dialogue Compression, Narrative Distance. Same overlay + popover + modifier UI as the existing categories.

### Smart Advisor: Advanced category

A fifth top-level category for cross-passage critique passes that do not fit Readability / Structure / Context. Subcategories: Theme & Message, Transitional Coherence, Strengthen Conclusions.

### Smart Advisor: Timeline + Scene Goal subcategories

Two new subcategories under the existing Context category. No new endpoint or UI shell — purely additive content for the existing pass.

### Scene break insertion suggestions

Optional Smart Advisor mode (or separate toolbar action) that proposes `---` scene-break locations within a chapter. Applied via the same accept / ignore popover flow as other Advisor issues.

### Task-aware model auto-selection

Routing classifier that picks an eligible model based on assistant type, content size, and content mode rather than always using the project default. Falls back to the default on ambiguity. The classifier sits in front of the existing allowlist and content-mode validation.

### Long-context handling: priority pinning + summary swap

When a request would exceed the model's context window, the materials builder pins Outline + Style Guide first and swaps full chapter prose for chapter summaries before truncating older scene text. Engages automatically; no user toggle.

### Settings: Recommended Writing Models pinned section

A pinned block at the top of the model picker highlighting models known to be strong for prose. Curated list, updated with each release.

### Settings: 4-step pricing tier slider

Replace the current cost-tier slider with explicit Free / Lowest / Pricier / Priority Best stops. The top stop preselects flagship-class models for one-click access.

### Cloud-sync path detection

Detect when a project lives under a known cloud-sync folder (Google Drive, OneDrive, Dropbox, iCloud Drive) and show a warning banner at project open: "This project is in a cloud-sync folder. Mirror sync can silently roll back your saved files. Consider moving the project to a local-only folder." Path-pattern check; no API calls. Dismissable, with a "Don't warn me again for this project" option that writes a flag into `project.json`. Motivated by a confirmed Google Drive incident that restored an older version of a chapter file hours after a successful local save.

### Local snapshot trail

Keep a per-save shadow copy of every chapter inside `.storythread/snapshots/<chapter-stem>/<ISO-timestamp>.md`, capped at the last N saves per chapter (default 50). The `.storythread/` directory is already cache, and users can exclude it from cloud sync. Provides a recovery path even when external forces (cloud sync rollback, antivirus restore, disk corruption) eat a chapter file. A simple "Recover from snapshot" UI in the chapter context menu lets the writer pick a prior version. Companion to the cloud-sync detection above.

---

## Nice-to-Have

Lower priority. May ship eventually, may never; no harm if they don't.

### Reasoning-mode toggle

Per-request toggle that surfaces the model's reasoning trace alongside the answer for reasoning-capable models (DeepSeek-R1, o1-class, etc.). Hidden when the active model does not support it.

### Settings: media-capability filter

Programmatically hide image and video output models from the picker so the list stays text-focused.

### Cost tier as routing input

Make the existing project cost-tier setting actually filter candidate models. Today it is documented but not enforced.

### Interaction log table

SQLite-backed log of AI requests for the writer's own self-review (which assistant, which model, which chapter, how long, optional response gist). No analytics or telemetry — local only.

### Level 4: Proactive Observer

A background AI mode that surfaces drift or contradictions without being asked. Lowest priority because it conflicts with the locked rule that AI assists on demand only. Would require a careful redesign of consent and surface-area before being viable.

---

## Dropped

These appeared in older specs and were never built. They are not Nice-to-Haves — they have no real consumer and should not be carried forward as TODOs.

- `POST /api/ai/route-preview` — preview UI never designed
- `assistant_registry` SQLite table — assistants live in code (`assistants.py`); a registry adds nothing
- `interaction_log` table as originally specced — superseded by the Nice-to-Have entry above
- Structured-output support filter — every shipping model supports JSON mode now
- Context-size filter — task-aware auto-selection covers it implicitly
