# Manual Smoke Checklist

Walk through these scenarios before cutting a release. Each one tests
something pytest and vitest cannot reach: the Tauri shell, native
dialogs, the embedded sidecar, the auto-updater, and OpenRouter calls
with a real API key.

**Environment:** a built release `.msi`, or `npm run tauri dev` from
`app/` for a dev-mode pre-flight. Do NOT run against a non-local
environment — there isn't one.

**Before starting:** create a throwaway project at a known location
(e.g. `~/Documents/Storythread Studio/smoke-<date>/`) so each scenario
runs against a clean slate.

---

## 1. Cold launch, project open, clean shutdown

**Touches:** Tauri shell startup, FastAPI sidecar lifecycle, port 8000
cleanup, recent projects list, backend health banner.

The canonical symptom of a sidecar leak (the regression the v1.0.1
fixes `58388d0` and `d61934a` were meant to close) is port 8000 still
being held by `storythread-backend.exe` after the app window is gone.
We check that explicitly.

Steps:
1. If the app is open, close it. Wait ~5 seconds.
2. In PowerShell, run:
   ```powershell
   Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
   ```
   Expect no output — port 8000 should be free. If a row comes back,
   the sidecar leaked; capture the `OwningProcess` and file the
   regression before proceeding.
3. Launch Storythread Studio.
4. From the Project Home, click a project in the Recent list (or open
   the throwaway project created above).
5. Close the app again. Re-run the port check from step 2.

Expected:
- Window opens; no "Backend unreachable" banner appears.
- Left panel shows the project title, the Writing Progress gauge, and
  the Manuscript / Notes / Profiles navigation.
- After step 5's port check, port 8000 is free — clean shutdown.

---

## 2. Create new project from scratch

**Touches:** native folder picker (Tauri `plugin-dialog`), story-type
selection, outline-template injection, `project.json` write, full
project-folder scaffold.

Steps:
1. From the project switcher (or Project Home), click "New Project".
2. Choose story type "Novel".
3. Enter title "Smoke Test Novel".
4. When prompted, pick an empty subfolder of your vault root.
5. Confirm creation.

Expected — a native folder-picker dialog opens (NOT a browser file
input), and the new project folder contains all of:
- `manuscript/` — with at least one starter chapter `.md`
- `notes/` — containing `outline.md`
- `profiles/characters/`
- `profiles/relationships/`
- `profiles/locations/`
- `profiles/lore/`
- `profiles/chapters/` — destination for AI chapter summaries
- `profiles/scenes/` — destination for AI scene summaries
- `exports/`
- `.storythread/` — cache; `app.db` will appear here after the first
  save event

`notes/outline.md` begins with a YAML frontmatter block: starts with
`---` followed by `# OUTLINE TRACKING DATA`, then `target_word_count`,
`expected_characters: []`, etc.

The app navigates into the new project.

---

## 3. Edit and save a chapter

**Touches:** CodeMirror editor, manual save (no autosave), unsaved-
changes indicator, Writing Progress word-delta logging.

Steps:
1. Open the first chapter from the left panel.
2. Type a sentence or two of dummy prose.
3. Note the unsaved-changes indicator appears.
4. Save with Ctrl+S.

Expected:
- Unsaved-changes indicator disappears.
- Navigating away from the chapter does NOT prompt to save.
- The chapter `.md` on disk contains the new content.
- The Writing Progress gauge bar updates to reflect the new word count
  (may take clicking the gauge to refresh, depending on polling).

---

## 4. Create and save a character profile

**Touches:** Profile Builder UI, trait blocks, importance levels,
profile YAML frontmatter, save endpoint, Writing Progress task-credit
logging.

Steps:
1. With a project open, create a new character (the "+" or "New
   Character" action under Profiles → Characters in the left panel).
2. Enter name "Smoke Test Character".
3. Pick an importance level (e.g. "Core").
4. Add a one-line description in the first trait block.
5. Click Save.

Expected:
- The new character appears in the left panel under Profiles →
  Characters.
- A file exists on disk at `profiles/characters/<slug>-<short-id>.md`
  with YAML frontmatter (`id`, `name`, `type: character`, `importance`,
  `updated_at`).
- Click the Writing Progress gauge — today's task list shows the new
  profile file with reason "save".
- Edit and re-save the same profile the same day. The task list should
  still show the file exactly once (credit is idempotent per file per
  day).

---

## 5. Export full manuscript — all four formats

**Touches:** export endpoint, native save dialog, `python-docx` /
`ebooklib` / Markdown serializers.

Steps:
1. Open the Export modal from project actions.
2. Select "Full Manuscript".
3. Check all four format options (Markdown, TXT, DOCX, EPUB).
4. Confirm export and pick a destination folder.

Expected:
- A native folder-picker / save dialog opens.
- Four files land in the chosen location with the correct extensions.
- DOCX opens in Word or LibreOffice with chapter headings and
  paragraphs intact.
- EPUB opens in a reader, or `epubcheck` validates with no errors.
- TXT contains no Markdown markup characters in the prose.

---

## 6. Writing Progress + Settings round-trip

**Touches:** settings persistence, Writing Progress gauge, daily
tracker, slide-over layout, Skill Level + Night Owl wiring.

Steps:
1. Open Settings → Writing Progress.
2. Change Skill Level to "Amateur" (2,500 words / 2 tasks per day).
3. Toggle Night Owl on (4 AM rollover).
4. Save and close Settings.
5. Quit and relaunch the app.
6. Open Settings again — verify the values stuck.
7. With a project open, click the Writing Progress gauge.

Expected:
- After relaunch, Skill Level shows "Amateur" and Night Owl is on.
- The daily tracker reads "X / 2,500 words" and "X / 2 tasks".
- The slide-over fits inside the left panel (no overflow into the
  editor area).
- The 7-day sparkline renders 7 cells with today border-highlighted.

---

## What this checklist does NOT cover

- **Auto-updater** — verified separately by bumping a version and
  confirming the update prompt + restart cycle.
- **SmartScreen warning** — only visible on a machine without prior
  trust on this installer.
- **Series and book-in-series flows** — add a scenario when actively
  changing series code.
- **Thesaurus right-click popover** — low-risk; add a scenario if it
  breaks repeatedly.
- **Reader Mode** — visual; add a scenario if its layout changes.
- **Smart Advisor passes** — require a real OpenRouter key and an
  active model. Worth keeping out of routine smoke runs; verify by
  hand when changing advisor prompts or the OpenRouter integration.

---

## After the walkthrough

- All scenarios passed: confirm completion when `/pre-release` prompts
  for the manual smoke acknowledgment.
- Any scenario failed: file a `qa-automation` GitHub issue (the
  `github` MCP can do this) with the scenario number, the failing
  step, and what diverged from "Expected". Do NOT proceed with the
  release.
