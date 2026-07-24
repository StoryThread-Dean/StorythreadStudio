# Roadmap

This is a living document. Items move between buckets as priorities change. Anything that ships drops off this list and lives in [`features.md`](features.md). Anything intentionally not built lives in [`product-scope.md`](product-scope.md) under "Out of scope."

For shipped releases see [`../CHANGELOG.md`](../CHANGELOG.md).

---

## Scheduled

Committed work for the near-term roadmap.

*(Nothing currently scheduled -- the NanoGPT provider and the prompt caching toggle shipped in v1.0.10. Next candidates live under Proposed below; "Local model providers" is the natural successor since the provider plumbing it needs now exists.)*

---

## Proposed

Worth building, prioritization not yet committed.

### Local model providers (Ollama / LM Studio / llama.cpp)

Second slice of "Alternative AI providers" — NanoGPT shipped (v1.0.10) and built the provider plumbing this reuses: adding a runtime is one backend `ProviderConfig` (`backend/app/ai/providers.py`) plus one frontend panel entry (`app/src/components/settings/providerMeta.ts`), with `requires_api_key=False` already supported end to end. Research complete: see [`research-multi-provider.md`](research-multi-provider.md). Key facts locked down so far:

- All local runtimes are OpenAI-compatible for chat, with **no auth header** (Ollama `:11434`, LM Studio `:1234`, llama.cpp `:8080`, plus a custom-URL option).
- **Ollama lists models via its native `GET /api/tags`, not `/v1/models`** — the one runtime-specific code path. Strip the `:latest` suffix for display; if the user overrides the base URL, derive the tags URL by stripping `/v1`.
- **Local reasoning models** (DeepSeek-R1 distills, Qwen thinking variants) emit their chain-of-thought inline as `<think>...</think>` blocks in the content itself. These MUST be stripped in the sanitizer layer (they'd otherwise show the writer a wall of internal monologue and break every JSON-output endpoint). Optionally, the stripped trace can feed the existing Reasoning toggle UI as the local analog of OpenRouter's `reasoning` field. Full breakdown in the research doc.
- Ship with a **local connection test**: a deterministic tiny prompt ("Reply with exactly this text: ...") at temperature 0 with a timeout, showing the model's actual reply or the HTTP error. Local servers have no API key to validate, so proving end-to-end generation is the only meaningful health check.

### User-editable prompt templates (Default + Custom)

Long-planned. Storythread Studio is aimed at beginning writers, and editing your own prompts is an advanced skill in itself — so the design keeps beginners safe by default:

- **DEFAULT is a locked, uneditable prompt** — exactly what the backend uses today. It always exists and cannot be broken.
- An **Advanced** option unlocks custom prompts. Each promptable feature gets its own section in Settings with a pull-down: **DEFAULT** (default), then **Custom <edited name>**, **Custom <edited name 2>**, etc.
- Custom prompts are named, per-feature, and swappable at any time; picking DEFAULT always restores stock behavior.
- Scope ideas for the Advanced side: `{{variable}}` placeholders, per-prompt sampling settings, and JSON import/export packs (see [`research-multi-provider.md`](research-multi-provider.md)).

### Stable scene IDs + scene move between chapters

Follow-up to the acts/beats release. Today scene identity is positional (scene 2 = the second `---` section; sidecars are `scene-NN.md`), so inserting a scene break mid-chapter re-pairs every later sidecar, and moving a scene between chapters would be destructive text surgery with positional renumbering on both sides. The safe order of work:

1. **Stable scene IDs first** -- a short anchor comment at each scene top (e.g. `<!-- scene:ab12cd -->`) that sidecars key on instead of position. Auto-inserted on first summarize; tolerated absent everywhere.
2. **Then scene move** -- cut the `---` section from the source chapter, splice into the target, move the sidecar by ID, with a pre-move snapshot of both chapter files so a partial failure can never lose prose.
3. Beat moves between scenes ride along for free once sidecars are ID-keyed.

### Drag-and-drop manuscript tree

v1 of the acts tree ships menu-based moves (hover "..." > Move up / Move down / Move to Act) because native HTML5 drag is unreliable in WebView2 and nested-tree DnD needs @dnd-kit plus substantial collision/projection code. Once the tree structure has settled, add drag-and-drop as a polish layer over the same PUT /api/structure calls -- the menu stays as the accessible fallback.

### Renumber files to match act order (bulk action)

With `manuscript/structure.json` as the ordering authority, the numeric `NN-` filename prefixes can drift from true reading order after reorders (e.g. `05-finale.md` reading second). Harmless inside the app, but confusing when browsing the folder in Explorer. A one-click "Renumber files to match order" action would run N rename-cascades (the same machinery as chapter rename) to realign prefixes on demand. Deliberately manual -- automatic renumbering on every move would churn git history and file identity.

### Smart Advisor: Style Controls category

A fourth top-level Advisor category alongside Readability / Structure / Context. Subcategories: Readability Level, Formality, Descriptive Intensity, Dialogue Compression, Narrative Distance. Same overlay + popover + modifier UI as the existing categories.

### Smart Advisor: Advanced category

A fifth top-level category for cross-passage critique passes that do not fit Readability / Structure / Context. Subcategories: Theme & Message, Transitional Coherence, Strengthen Conclusions.

### Task-aware model auto-selection

Routing classifier that picks an eligible model based on assistant type, content size, and content mode rather than always using the project default. Falls back to the default on ambiguity. The classifier sits in front of the existing allowlist and content-mode validation.

### Long-context handling: priority pinning + summary swap

When a request would exceed the model's context window, the materials builder pins Outline + Style Guide first and swaps full chapter prose for chapter summaries before truncating older scene text. Engages automatically; no user toggle.

### Cloud-sync path detection

Detect when a project lives under a known cloud-sync folder (Google Drive, OneDrive, Dropbox, iCloud Drive) and show a warning banner at project open: "This project is in a cloud-sync folder. Mirror sync can silently roll back your saved files. Consider moving the project to a local-only folder." Path-pattern check; no API calls. Dismissable, with a "Don't warn me again for this project" option that writes a flag into `project.json`. Motivated by a confirmed Google Drive incident that restored an older version of a chapter file hours after a successful local save.

### Local snapshot trail

Keep a per-save shadow copy of every chapter inside `.storythread/snapshots/<chapter-stem>/<ISO-timestamp>.md`, capped at the last N saves per chapter (default 50). The `.storythread/` directory is already cache, and users can exclude it from cloud sync. Provides a recovery path even when external forces (cloud sync rollback, antivirus restore, disk corruption) eat a chapter file. A simple "Recover from snapshot" UI in the chapter context menu lets the writer pick a prior version. Companion to the cloud-sync detection above.

### Serial fiction progress model

The Project Completion gauge shipped in v1.0.3 does not apply to serial fiction. Serials are profile-heavy (heavy character/location/lore/relationship reuse across episodes) and each chapter is a self-contained finished work rather than a percentage of an overall target. Design a profile-reuse-weighted progress model once feedback from serial-fiction writers clarifies what "progress" means for them. v1.0.3 shipped a placeholder card on the gauge for `serial_fiction` projects.

### Cross-book series progress rollup

Aggregate Project Completion and Daily Goal tracking across all books in a series at the series-home level. The `progress_event` table from v1.0.3 already stores `project_path` per row so each book's data is identifiable; the rollup query and the series-home UI are the main remaining work.

---

## Nice-to-Have

Lower priority. May ship eventually, may never; no harm if they don't.

### Streaming responses (SSE) — backburner

Replace blocking AI calls with server-sent events so chat replies and Smart Advisor passes render character-by-character. Affects the Writing Companion chat, Profile Builder chat, and the editor-pass endpoint. OpenRouter supports SSE natively; the work is on the FastAPI streaming layer and the React reader. **Deliberately parked (2026-07-13): not convinced streaming is more efficient, more effective, or a good use of tokens. Needs a fully convincing case before any implementation starts.** Note: provider work (NanoGPT, local models) does not depend on this.

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
