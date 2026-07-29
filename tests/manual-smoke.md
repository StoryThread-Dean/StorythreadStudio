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
- Window opens; no "Backend not responding" banner appears.
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
- `profiles/chapters/` — legacy dir, still scaffolded; current chapter
  summaries write to `summaries/chapters/`
- `profiles/scenes/` — legacy dir, still scaffolded; current scene
  summaries write to `summaries/scenes/<chapter-stem>/`
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
  profile file with reason "save". (Per-file-per-day credit idempotency
  is covered by `test_progress_store.py` — no need to re-save here.)

---

## 5. Export full manuscript — all four formats

**Touches:** export endpoint, native save dialog, `python-docx` /
`ebooklib` / Markdown serializers.

Steps:
1. Open the Export modal (Tools menu in the editor title bar > Export Manuscript).
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

**Touches:** Writing Progress gauge, daily tracker, slide-over layout,
Skill Level + Night Owl wiring. (Settings persistence itself — save,
reload, backup, corruption recovery — is covered by
`test_settings_store.py`; no relaunch round-trip needed here.)

Steps:
1. Open Settings → Writing Progress.
2. Change Skill Level to "Amateur" (2,500 words / 2 tasks per day).
3. Toggle Night Owl on (4 AM rollover).
4. Save and close Settings.
5. With a project open, click the Writing Progress gauge.

Expected:
- The daily tracker reads "X / 2,500 words" and "X / 2 tasks".
- The slide-over fits inside the left panel (no overflow into the
  editor area).
- The 7-day sparkline renders 7 cells with today border-highlighted.

---

## 7. Deprecated project model — error message + picker + live save

**Touches:** OpenRouter error translation (`_openrouter_exc`), per-project
model resolution (`project.json` `default_model`), the Project Settings
model picker, and the in-memory project update after save.

This covers the failure where a project pinned to a model the provider
later deprecated produced a cryptic `HTTP 404` that looked like an
OpenRouter outage, and the picker/save flow made it hard to recover.
Run it whenever the OpenRouter integration or the model picker changes.

Steps:
1. With the app closed, edit a throwaway project's `project.json` and set
   `"default_model": "x-ai/grok-3-mini"` (a known-deprecated slug). Launch
   the app and open that project.
2. Run any AI feature (Writing Companion chat, a Smart Advisor pass, or a
   chapter summary).
3. Open Project Settings for the same project and look at the model picker.
4. Pick a current model (e.g. Grok 4.3 / `x-ai/grok-4.3`) and click Save.
   Do NOT reopen the project.
5. Run the same AI feature again.

Expected:
- Step 2: a clear model-unavailable error surfaces in the UI (not a
  silent failure). The exact error translation — provider message
  quoted, no bare "HTTP 404" — is covered by `test_openrouter_errors.py`.
- Step 3: the dropdown shows the stored model flagged
  `x-ai/grok-3-mini (unavailable -- select a current model)` plus an amber
  warning, instead of silently displaying a different model.
- Step 5: the AI feature works immediately after Save, with no project
  reopen required.

---

## 8. AI provider switch (OpenRouter <-> NanoGPT)

**Touches:** the provider selector cards + per-provider panels in Settings,
per-provider key storage, live model-list fetch from each provider, and the
cross-provider default-model warning. Needs real API keys for both
providers; skip the NanoGPT half if you have no funded NanoGPT account.

Steps:
1. Open Settings. Confirm two provider cards render (OpenRouter / NanoGPT)
   with correct status badges, and that each card's panel shows its own
   connect instructions (openrouter.ai steps vs nano-gpt.com steps).
2. Select the NanoGPT card, paste a NanoGPT key, click Test.
3. Click Save. The model picker should reload with NanoGPT's catalog; the
   cost-tier slider should be hidden; if your old default model isn't in
   the list, an amber warning should say so.
4. Pick a NanoGPT model, Save, and run a Writing Companion chat turn --
   it should answer normally.
5. Switch back to the OpenRouter card and Save. The OpenRouter key should
   still be stored (masked), the tier slider returns, the Prompt Caching
   toggle is visible inside the panel, and a chat turn works again.

Expected: both keys survive round-trip switching; no request ever fails
silently -- a stale cross-provider model produces a clear, provider-named
error, not a bare HTTP code.

---

## 9. Character creation tools (spine dropdowns, Quick Build, Interview Me)

**Touches:** the personality-spine dropdowns, the Quick Build randomizer +
NSFW tier toggles, trait-block insertion + save round-trip, and the
Interview Me chat mode (needs a real API key).

Steps:
1. Create a MAIN character (template radio in the + New form). In the
   header under Status/Tags, pick an Enneagram type -- a [core] trait
   block appears in Personality Traits and a note confirms it; pick a
   Story Role -- a second block stacks, the Role field fills, and its
   key-aspect Tags merge in. The Role field's own Pick... list (Popular /
   Less Common / Niche) also fills the field.
2. Create a SIDE character. Every section is a single text field (no
   trait blocks, no Importance Audit). Quick Build opens on top: reroll a
   row twice -- no repeats -- and click options; each lands in the
   matching section as a new line. Pick a Story Role and confirm rolls
   lean toward it.
3. NSFW semantics: Explicit checkbox starts greyed out. Toggle NSFW on --
   options go red and adult, Explicit becomes clickable. Check Explicit --
   options become fill-in-the-blank. Toggle NSFW off -- back to normal AND
   Explicit unchecks itself.
4. Save (Ctrl+S) both profiles, reopen -- main's blocks keep importance
   levels; side's plain-text sections survive the markdown round-trip.
   The left list shows Main and Side / Background groups (collapsible);
   the chat attachment picker shows the same grouping.
5. Switch the chat to Interview Me, send "Start the interview." Expect
   5-8 numbered basics, NOT invented character facts. Answer briefly;
   expect a full copy/paste skeleton. Check two section chips above the
   input, send -- expect 2-4 questions per checked section, ending in the
   full updated block.
6. Name generator: in + New, click "Need a name?" -- pick British /
   Medieval / Female, deal, select a given name only, Use -- the Name
   field fills with just the given name. On an open character, click the
   dice by Name -- pick American South + Medieval/Renaissance and confirm
   the "closest available" note appears; pick Dark Elf and confirm the
   era dropdown hides and names stay elf-flavored across rerolls.
   IMPORTANT in the PACKAGED build: confirm the culture dropdown populates
   at all -- it proves the name JSON was bundled into the frozen sidecar.

Expected: no em dashes anywhere in inserted text; the AI never invents
character details unlabeled; every interview round ends with the full
copy/paste block.

---

## 10. Audiobook Converter -- import and narration editing (Stage A)

**Touches:** the audiobook dashboard entry on Project Home, native file and
folder pickers for the import flow, workspace creation on disk, the
narration editor + marker toolbar, manual save, and the recents index.

Steps:
1. From Project Home (no project open), click **Audiobook Converter** under
   the "tools" divider. Expect the jewel-tone charcoal dashboard -- clearly
   NOT the writing app's palette -- with New Audiobook and Open Existing
   Workspace.
2. Click New Audiobook. Choose a small DOCX or TXT manuscript via the
   native file picker (PDF should not be offered), choose a NEW empty
   folder as the workspace, and Import. Expect to land in the workspace
   view with a chapter rail matching the manuscript's chapters.
3. Check the workspace folder on disk: `audiobook-project.json`,
   `source/original-<name>`, `manuscript/extracted-original.md`,
   `manuscript/narration-copy.md`, and `chapters/*.json` all exist, and
   your ORIGINAL manuscript file outside the workspace is untouched.
4. In the editor: click into a paragraph, press **Pause 0.8s** -- the
   marker text appears at the caret and the unsaved dot lights. Select a
   word, press **[say]** -- it wraps as `[say:]word[/say]` with the caret
   after `say:`. Ctrl+S saves; the dot clears. Reopen the file in Notepad
   and confirm the markers are plain readable text.
5. Add a `# New Chapter` heading at the bottom, save, and confirm the
   chapter rail gains it.
6. Open **Pronunciations**, add a rule (Kaelith -> KAY-lith) under This
   Audiobook, save, reopen the dialog -- the rule survived.
7. Back on the dashboard: the audiobook is in Recent Activity. Remove it
   from Recents, confirm the workspace folder on disk is fully intact,
   then Open Existing Workspace on that folder -- it reappears in Recents.
8. Import error honesty: try importing into the SAME (now non-empty)
   folder -- expect the clear "not empty" error, and confirm nothing in
   the folder was altered.

Expected: no em dashes inserted by any toolbar action; the original
manuscript is never modified; Remove from Recents never deletes files.

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
