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

**Writing Progress Tracking** — Project-completion gauge + daily-goal tracker, backed by shared SQLite stats. Two surfaces (project gauge in left panel; daily tracker inside its slide-over). See **Writing Progress Tracking — Detailed Spec** below.

**Global Search + Replace** — Modal-overlay search across project Markdown with grouped results, per-match selection, snapshot-before-replace safety, and session undo. Triggered by Ctrl+Shift+F. See **Global Search + Replace — Detailed Spec** below.

---

#### Global Search + Replace — Detailed Spec (locked 2026-05-15)

##### Surface

Modal overlay triggered by **Ctrl+Shift+F**. Centered, dismissible with Esc. Search-as-you-type with debounce. Two text inputs (Find / Replace), three toggle pills (Case-sensitive / Whole-word / *Literal is implicit; no regex*), and the results tree.

##### Search scope

Walked folders (relative to project root): `manuscript/`, `notes/` (includes `outline.md`), `profiles/` (all subfolders: characters, locations, lore, relationships, summaries), `summaries/` (chapter + scene), `arcs/` (series projects only).

Hard-excluded paths: `exports/`, `.storythread/`.

AI-write-only fields (`ai_profile_summary`, `ai_section_summary`, `chapter_summary`, `scene_summary`) are **included** in search and replace. Rationale: writers may need to find/replace through generated content as readily as through prose, and they can always regenerate the field afterward. The em-dash rule still applies to anything the writer types into the Replace input.

##### Match modes

- Literal substring (default, always on)
- Case-sensitive toggle (default off → case-insensitive)
- Whole-word toggle (default off; uses Python regex word boundaries)
- No regex toggle in v1.

##### Results tree

Grouped by file. Each file row shows: relative path, match count badge, expand/collapse toggle. Expanded rows show one row per match with three lines of surrounding context (line before / match line with highlight / line after). Each match row has a checkbox (default checked).

Three replace affordances:

- **Replace** button per individual match — replaces only that match
- **Replace all in file** button per file row — replaces all checked matches in that file
- **Replace all** button at modal footer — replaces all checked matches across all files

##### Replace safety

1. **Unsaved editor changes** — if the currently-open chapter has unsaved edits and is in the replace set, warn and offer to save (Save & Continue / Cancel). No silent overwrite of in-memory edits.
2. **Snapshot before write** — every replace operation writes shadow copies of all files about to be modified to `.storythread/snapshots/global-replace/<ISO-timestamp>/` preserving relative paths, plus a `manifest.json` recording the search term, replacement string, match modes, and the list of files touched. Precursor to the Proposed "Local snapshot trail" feature.
3. **Session-only undo** — after a replace runs, an Undo button appears in the modal footer. Clicking it reads the most recent snapshot's manifest and restores all touched files. Closing the modal or restarting the session loses the in-modal Undo affordance but the snapshot directory persists for manual recovery.
4. **Open-file reload** — if a file currently open in the editor is modified by the replace, re-fetch and re-render it; show a brief banner ("File updated by Global Replace") so the writer is not confused by changed text.

##### Backend

Pure Python `os.walk` + regex scan. No ripgrep dependency. Project sizes are small enough that streaming is unnecessary; results return as a single JSON payload.

Endpoints:

- `POST /api/search/find` — body: `{ query, case_sensitive, whole_word }`. Returns: `{ matches: [{ file_relpath, count, hits: [{ line, col, context_before, context_match, context_after }] }] }`.
- `POST /api/search/replace` — body: `{ query, replacement, case_sensitive, whole_word, selections: [{ file_relpath, hit_indices: [...] }] }`. Snapshots first, then writes. Returns `{ snapshot_dir, files_modified, replacements_made }`.

##### Build order

1. Backend — `os.walk` scanner + regex find endpoint; allowlist/blocklist of folders enforced.
2. Backend — replace endpoint with snapshot-before-write + manifest writer.
3. Frontend — modal shell, Ctrl+Shift+F binding, Find/Replace inputs, match-mode toggles.
4. Frontend — debounced search-as-you-type calling `/find`.
5. Frontend — grouped results tree with expand/collapse + per-match checkboxes.
6. Frontend — three replace buttons (per-match / per-file / all) wired to `/replace`.
7. Frontend — unsaved-editor warn-and-save flow + open-file reload banner.
8. Frontend — session Undo button restoring from most recent snapshot manifest.
9. CHANGELOG entry.

---

#### Writing Progress Tracking — Detailed Spec (locked 2026-05-15)

Captured in full so the design can be rebuilt from scratch if context is lost between locking and shipping.

##### Surfaces

1. **Project Completion gauge** — `[====    ] 38%` bar in the left panel, below project title and above Chapters/Profiles. Clicking expands a slide-over panel **constrained to the left panel bounds** (does not cross into the editor area).
2. **Daily Goal tracker** — lives inside the gauge slide-over. Shows today's word count, today's task credits, and a 7-day hit/miss sparkline.
3. **Serial fiction** — instead of the gauge, render a placeholder card: "Writing Progress for serial fiction is being designed — feedback welcome." Serials are profile-heavy and chapter-self-contained; the % model from other story types does not apply. Revisit in a later release once writer feedback informs the design.

##### Outline frontmatter schema

YAML frontmatter block is added above the existing HTML seed-metadata comment in `notes/outline.md`. Backward compatible: outlines without frontmatter fall back to story_type defaults.

```yaml
---
target_word_count: 90000
expected_characters: [Kael, Vire, Empress Asha]
expected_locations: [Ironhold, The Hollow Crown]
expected_lore: [The Ashen Pact]
expected_relationships: [Kael & Vire]
chapters:
  - title: "Return to Ash"
    word_target: 3000
---
```

`chapters[].word_target` is in the schema but per-chapter progress UI is deferred (see Proposed bucket). Per-template default `target_word_count` is populated at outline render time:

| story_type | target_word_count |
|---|---|
| short_story | 6000 |
| novelette | 13000 |
| novella | 30000 |
| novel | 90000 |
| serial_fiction | — (no gauge; placeholder card) |

##### Project Completion math (with full Outline)

| Segment | Weight | Expected | Actual |
|---|---|---|---|
| Manuscript | 50% | `target_word_count` | Sum of chapter file word counts |
| Outline | 10% | binary: exists & non-template | exists & non-template |
| Profiles bucket | 30% | counts of `expected_*` arrays | profile files matching by loose name |
| Notes | 10% | binary: any non-template note file | files exist |

Profiles bucket divides its 30% across `characters / locations / lore / relationships`. Sub-segments with no Outline expectation drop out and the remaining ones rebalance to equal shares within the 30%.

**Without Outline:** manuscript-heavy fallback. Manuscript = 100% of the gauge, target from story_type default. Other segments appear in the expanded breakdown as `—no entry—` informational rows but do not contribute.

**Outline-as-empty detection:** treat the outline as missing if its word count is below 200 OR no frontmatter is populated. Prevents giving 10% credit for an untouched scaffold.

**Name matching (Outline → profile files):** case-insensitive substring (loose). The expanded breakdown lists unresolved Outline names (e.g. *"Outline mentions 'Daven' — no character profile matches"*) so the writer can spot typos or nickname mismatches.

##### Daily tracking semantics

**Settings additions:**

- **Writing Skill Level** dropdown:

  | Level | Words/day | Tasks/day |
  |---|---|---|
  | Newbie | 500 | 1 |
  | Beginner | 750 | 1 |
  | Novice | 1,250 | 2 |
  | Amateur | 2,500 | 2 |
  | Experienced | 4,000 | 3 |
  | Full-time | 7,500 | 3 |
  | Professional | 10,000 | 4 |

- **Day rollover** toggle: Midnight (default) / Night Owl (4am rollover).

**Task credit rule:** one credit per tracked file per local-day regardless of save count. Tracked files: `manuscript/**/*.md`, `notes/**/*.md`, `outline.md`, `profiles/**/*.md`. AI-touched files count toward task credits.

**Daily hit:** both the word target and task target must be met on that local-day. The 7-day sparkline shows hit/miss per day with tooltips revealing words and tasks for each cell.

##### Smart Advisor task-credit special case

The standard "save = credit" rule gets a no-save-required complement for Smart Advisor:

- **Default (all-categories) pass** on a chapter → chapter earns task credit immediately, no save required.
- **Individual category pass alone** (Readability OR Structure OR Context) → no credit on its own.
- **All three single-category passes** run separately on the same chapter on the same day → chapter earns task credit (equivalent to a Default).

Implementation: log every Smart Advisor invocation as a `progress_event` row with `event_type='advisor_run'` and the category. Credit eligibility queries for either a `default` row or the full set `{readability, structure, context}` on that chapter on that date.

##### SQLite schema

```sql
CREATE TABLE progress_event (
  id INTEGER PRIMARY KEY,
  project_path TEXT NOT NULL,         -- placeholder for cross-book series rollup later
  occurred_at TEXT NOT NULL,          -- ISO local datetime
  local_date TEXT NOT NULL,           -- YYYY-MM-DD after rollover offset applied
  event_type TEXT NOT NULL,           -- 'word_delta' | 'task_credit' | 'advisor_run'
  file_relpath TEXT,                  -- nullable for global word_delta events
  word_delta INTEGER DEFAULT 0,       -- can be negative (deletions)
  advisor_category TEXT               -- 'default'|'readability'|'structure'|'context' (NULL otherwise)
);
CREATE INDEX idx_progress_project_date ON progress_event(project_path, local_date);
```

Daily totals are derived from queries; no snapshot rows are stored.

##### Build order

1. Backend — Outline frontmatter parser + per-template default constants + frontmatter injection into new outline templates (`backend/app/outline_templates.py`).
2. Backend — SQLite `progress_event` table + migration + write hooks on document save endpoints (`backend/app/routers/documents.py`).
3. Backend — Smart Advisor run logging in existing advisor endpoints.
4. Backend — aggregation endpoints: `GET /api/progress/summary` (project gauge) and `GET /api/progress/daily` (today + 7-day sparkline).
5. Frontend — Settings additions: Skill Level dropdown + Night Owl rollover toggle.
6. Frontend — Left-panel gauge component + slide-over breakdown panel (constrained to left panel).
7. Frontend — Daily tracker section inside the slide-over (today's words, today's task list, 7-day sparkline).
8. Frontend — Serial fiction placeholder card in place of the gauge for `serial_fiction` projects.
9. CHANGELOG — catch up the three already-shipped v1.0.2 features and add the Writing Progress entry.

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

### Per-chapter word target progress breakdown

The `chapters[].word_target` field is already in the Outline frontmatter schema as of v1.0.2 (see Writing Progress Tracking detailed spec). Surfaces per-chapter progress bars (% toward each chapter's planned `word_target`) inside the Project Completion slide-over panel. Deferred from v1.0.2 to keep the initial gauge focused on project-level rollup and reduce visual density in the first cut.

### Outline frontmatter form widget

A dedicated UI block in the editor for editing Outline YAML frontmatter (target word count, expected character/location/lore/relationship lists, per-chapter word targets) without writing raw YAML. v1.0.2 ships with raw-YAML editing in the standard Markdown editor; this widget is the natural follow-up once writer feedback identifies friction with the raw-YAML approach.

### Serial fiction progress model

The Project Completion gauge shipped in v1.0.2 does not apply to serial fiction. Serials are profile-heavy (heavy character/location/lore/relationship reuse across episodes) and each chapter is a self-contained finished work rather than a percentage of an overall target. Design a profile-reuse-weighted progress model once feedback from serial-fiction writers clarifies what "progress" means for them. v1.0.2 ships a placeholder card on the gauge for `serial_fiction` projects.

### Cross-book series progress rollup

Aggregate Project Completion and Daily Goal tracking across all books in a series at the series-home level. The `progress_event` table from v1.0.2 already stores `project_path` per row so each book's data is identifiable; the rollup query and the series-home UI are the main remaining work.

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
