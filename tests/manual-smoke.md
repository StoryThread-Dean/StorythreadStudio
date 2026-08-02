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

## 11. Audiobook Converter -- local narrator install and generation (Stage B)

**Touches:** the kokoro-worker download/verify/install flow, worker
spawn + version gate, voice previews, selection preview with render
trace, marker audio demos, narration settings, and the generation run
lifecycle (pause/resume/restart recovery).

Dev-machine note: the repo's `kokoro-worker/` checkout acts as a built-in
engine. To rehearse a real user's machine, start the backend with
`$env:STORYTHREAD_DISABLE_DEV_WORKER = "1"` in that terminal, and delete
`~/.storythread/kokoro-worker` for a truly fresh install.

Steps:
1. Fresh state (no engine): open an audiobook workspace. The Narration
   rail offers **Install Free Local Narrator (~372 MB)**. Click it:
   download percentage climbs, then verifying, then installing, then the
   voice list loads BY ITSELF (54 voices). Files land in
   `~/.storythread/kokoro-worker/`.
2. **Preview voice** plays a sample sentence in the chosen voice.
   **Preview selection** on a highlighted passage plays exactly what
   generation would produce -- inserted [pause] markers audible as real
   silence, pronunciation rules applied -- with a per-piece speed trace
   under the player (dialogue lines tagged, [pace] spans shown).
3. Open **What's this?** on the marker toolbar and play all six Hear-it
   demos (each marked local/free; click again pauses, click resumes).
   First play per demo renders live; replays are instant (cached).
4. **Narration Settings**: set Dialogue pace to 0.9, Save (the amber
   "unsaved" tag must clear). Generate: only dialogue segments re-queue
   if the book was already generated.
5. **Generate Audiobook**: progress bar counts segments. Pause mid-run --
   it finishes the current segment, then stops with the lock released.
   Resume completes only what remains. Kill the backend mid-run (Ctrl+C),
   restart, reopen: the run shows as interrupted with a Resume that picks
   up from the last completed segment.
6. Segment WAVs exist under `generated-segments/<chapter>/` and play in
   any audio player, in the selected voice.
7. Close the app entirely, then check Task Manager: NO `kokoro-worker`
   or stray worker `python` processes remain (the parent watchdog).
8. Version gate (optional): edit `installed.json` in the install dir to
   an older version, restart the backend, open the workspace -- expect a
   clear "needs an update" message with an Update button, never a crash
   loop.

Expected: the SHA256 of a download is always verified before install; a
failed install leaves NOTHING half-installed; pace values speak for
themselves in the pace demo.

---

## 12. Audiobook Converter -- export, metadata, and audio quality (Stage C)

**Touches:** the ffmpeg component install, chapter mastering + the three
export formats, Book Details metadata + cover embedding, flow synthesis
(the pre-pause slur fix), step-form pace markers, per-book voice memory,
and chapter add/remove on an existing audiobook.

Steps:
1. Fresh assembler: with no `~/.storythread/ffmpeg`, the Export block
   offers **Install Audio Assembler (~139 MB)**. Install; the format
   checkboxes appear by themselves when it lands.
2. **Book Details** (above Export): for a project-sourced audiobook,
   Genre / Description / Series arrive pre-filled from the writing
   project; edits save manually (amber "unsaved" tag) and survive
   reopen. The **Use current voice** link fills Narrator with the
   picked voice's name. Pick a cover image -- a non-square one shows
   the square-format hint but still sticks; the thumbnail previews it.
3. **Export** with all three formats. In the output folder:
   `chapters/NN - Title.mp3` per chapter, one combined MP3, one `.m4b`.
   Check file properties / an audiobook player: tags carry your Book
   Details, the cover shows as album art, and the M4B has named chapter
   markers (or "Chapter N" if you unchecked chapter names).
4. **Listen at a pause-heavy passage** (pauses mid-paragraph): no slur,
   lisp, or garble on the words directly before pauses -- the speech
   should sound like one continuous read with silences opened up inside
   it. Retime one [pause] longer, save, export again WITHOUT
   regenerating: the new length is audible (pause timing never costs a
   regeneration).
5. **Pace steps**: wrap a passage with Slow (inserts `[pace:-2]`) and
   preview -- the trace under the player shows the base pace stepped
   down by exactly 0.10, and no stack of hand-edited steps can push a
   preview past 0.8-1.2.
6. **Voice memory**: switch the narrator voice, close the app entirely,
   reopen the workspace -- the voice is still yours. A brand-new
   audiobook defaults to Michael (American male).
7. **Chapters on an existing audiobook**: add a chapter to the ORIGINAL
   source file/project, then **+ Add chapters** -- it lists exactly the
   new one; adding it appends without touching your narration edits.
   Hover-**x** a chapter in the rail: it leaves the buffer (unsaved dot
   on), and leaving without saving restores it.
8. Generation staleness honesty: after changing a pace span or moving a
   pause to a different sentence, Generate re-queues ONLY the affected
   segments; a pause DURATION change alone re-queues nothing.

Expected: exports never run with half-generated chapters (clear error
naming them); the original book is untouched by chapter add/remove; no
em dashes anywhere in tags or filenames.

---

## 13. Audiobook Converter -- walkthrough, say popout, draft pass (post-C)

**Touches:** the Formatting Walkthrough (scan, apply/skip, auto-apply),
the [say] popout (structured input, carrier preview, tips accordion),
the Draft pass, the generation reset escape hatch, and Open Output
Folder.

Steps:
1. **Formatting Walkthrough**: click into a chapter, press the blue
   [Formatting Walkthrough] button. The strip (same blue wash) walks
   stop by stop -- Apply inserts with smart spacing and the unsaved dot
   lights; Skip moves on; Ctrl+Enter / Ctrl+Right work while typing in
   the editor stays normal. Plant a broken marker ([pace:=2] and an
   unclosed [pause:0.4 ) -- the walkthrough offers one-click fixes.
2. **Auto-apply**: reopen the walkthrough, press [Auto-apply N beats].
   The warning strip is readable (13px); confirming inserts every
   default beat but leaves marker repairs in the walk. Leave WITHOUT
   saving -- reload the workspace and confirm the batch is gone.
3. **[say] popout**: select a word, click [say]. Only the spoken form
   is typeable. Preview speaks "You will hear <word> in the narration"
   with no garble at the word's edges. Type a caps respelling
   (LAR-ah) -- preview says the NAME, never letters. Accept hops to the
   next occurrence with the counter; occurrences already wrapped are
   skipped. Tips: two groups (Most Useful blue, Additional gray), one
   section open at a time.
4. **Draft pass**: check "Draft pass", Generate Draft (fast) -- roughly
   half the time on pause-heavy chapters; the amber regenerate-before-
   export notice shows. Uncheck and Generate: every draft segment
   re-queues automatically.
5. **Reset hatch**: pause a run, then click "Cancel generation and
   start over" under Resume -- after the confirm, Generate is available
   fresh and completed segments are NOT redone.
6. **Open Output Folder** (after an export): Explorer opens directly in
   the workspace's output folder.

Expected: walkthrough/say edits are buffer-only until Save; a draft can
never ship silently (staleness re-queues it); the reset hatch never
deletes audio.

---

## 14. Audiobook Converter -- premium narration, the print pass (Stage D)

**Touches:** Audiobook Settings (engine shelf, narration keys, narration
settings), the Premium Narration panel, hosted auditions, and the
cost-confirmed print pass. **This scenario spends real money** -- a few
cents if you follow it as written. Budget-tier auditions cost about a
hundredth of a cent; do the expensive checks by DECLINING the confirm.

Requires: an OpenRouter key with credit.

Steps:
1. **Settings, engine shelf**: gear at the bottom of the chapter rail
   opens Audiobook Settings. The shelf reads Free, Budget, Pro -- and a
   line saying no Standard engine has earned a recommendation, with
   "Other engines we tested but do not recommend (3)" below it. Open it:
   Grok, Voxtral and MAI-Voice-2 each show their reason in amber, and
   MAI additionally says its pace is re-scaled.
2. **Missing key is amber, never silent**: pick the Pro tier with no
   NanoGPT key connected. The card turns amber with numbered sign-up
   steps. Nothing later in the flow should ever fail cryptically because
   of a missing key.
3. **Keys stay masked**: turn off "Use my writing API keys". The key
   field is BLANK with "Current key: sk-o...abcd" beside it. Save without
   typing -- reopen and confirm the stored key survived (a masked value
   must never be echoed back as the new key).
4. **Budget audition = voice parity**: choose Budget (hosted Kokoro),
   pick the same voice you drafted with, and [Sample]. It should sound
   like your local narrator, because it is the same engine. Cost: about
   a hundredth of a cent.
5. **Per-book override**: in Premium Narration, change the voice for
   this book only. It shows the engine as read-only ("chosen in Audiobook
   Settings") with a button back to the dialog. Reopen the workspace --
   the override persisted; the global default in Settings did not change.
6. **Sample selection keeps its selection**: select two paragraphs in the
   editor, click [Sample selection], then click it AGAIN without
   re-selecting. The second sample must use the same text, not the
   default demo passage.
7. **Level holds across paragraphs**: in that two-paragraph sample, the
   second paragraph must not jump louder than the first, and a beat of
   silence must separate them even with no [pause] typed.
8. **The estimate, then decline**: press the print button. The estimate
   names a dollar figure BEFORE anything is spent, and the confirm
   repeats the number. **Decline it.** Nothing is spent and nothing is
   queued.
9. **A demoted engine still spends**: select Grok or MAI in Settings,
   return to Premium Narration -- its caveat is repeated beside the
   price, and the print flow is still available. A demotion is a warning
   the writer overrules, not a block.
10. **A chat model is a block**: with no narration engine chosen at all,
    Premium Narration names the writing-side fallback in a different
    color with a red note that it is not a narration model. Spending is
    refused here -- this is the one case that stops rather than warns.

Expected: no cryptic provider errors (every refusal names the provider
and what it said); no spend without a quoted number first; the voice you
drafted with survives into the Budget tier and only there.

---

## 15. Audiobook Converter -- freshness and cleanup (Stage E)

**Touches:** the chapter freshness dots, the outdated-sections notice,
the Storage screen, the Intermediate Audio setting, the post-export
prompt, and Export Only. **This scenario deletes files on purpose** --
run it on a throwaway audiobook, or on one you are willing to re-narrate.

Steps:
1. **Freshness after a run**: generate a short book on the local
   narrator. Every chapter dot goes green ("Audio matches..." on hover)
   and the rail shows no outdated notice.
2. **One edit, one stale section**: change a single paragraph and save.
   That chapter's dot turns amber, the others stay green, and the rail
   says how many sections no longer match. Press Generate -- only the
   changed section re-narrates.
3. **A voice change is named as such**: switch the narrator voice. The
   notice now says "the voice changed" and every chapter turns red.
   **Do not generate** -- just confirm nothing regenerated on its own,
   then switch the voice back.
4. **Storage measures honestly**: open Storage from the bottom of the
   chapter rail. Sizes are plausible; Preview files and Failed
   generation attempts are ticked; Current segment files, the manuscript
   snapshots, and Final MP3 and M4B exports are NOT. Each of those three
   states what is lost.
5. **Cancel deletes nothing**: tick Current segment files, press Delete
   selected, read the confirm (it should name the categories, the book,
   the size, and the consequence), then **Cancel**. Sizes are unchanged.
6. **Delete the disposable**: with only previews + failed attempts
   ticked, delete. The freed size is reported and the segment audio is
   untouched -- generation still says everything is up to date.
7. **Ask after export**: set Intermediate Audio to "Ask me after each
   export", close Storage, and export. When it finishes, the prompt
   names the size and offers Keep Files / Delete Segment Files / Review
   Storage. Choose **Keep Files** and confirm nothing was deleted.
8. **Export Only**: export again, then in Storage delete Current segment
   files. The Export Only warning appears with its explanation, the
   chapter dots go hollow, and the exported MP3/M4B files are still in
   the output folder and still play.
9. **Delete Working Files from the dashboard**: go back to the
   dashboard. The book's row has both a storage icon and an X -- the X
   only forgets the row, the storage icon opens this same dialog for
   that book without opening the workspace.

Expected: nothing is ever deleted without either a tick plus a confirm,
or the writer's own standing "delete after export" choice (which reports
what it freed); the exported audiobook is never deleted by any automatic
path; and a workspace whose audio is gone says so instead of offering an
export it cannot make.

---

## 16. Audiobook Converter -- PDF import (Stage F)

**Touches:** PDF extraction, scanned-PDF rejection, and the artifact
cleanup. Needs two real PDFs of your own: one exported from Word or
similar (**text-based**), and one scanned or photographed (**image
only**). A PDF from a phone scanner app works for the second.

Steps:
1. **A real PDF imports**: Let's Get Started, Choose Manuscript File.
   PDF now appears in the file-type filter. Pick the text-based PDF and
   create the workspace.
2. **Read the warnings band** at the top of the narration editor. It
   should name what was removed (running headers, page numbers,
   rejoined hyphens) and always end with the note that paragraph breaks
   are a best guess.
3. **Check the reconstruction** -- this is the step that matters, and no
   automated test can do it for you. Scroll the narration copy:
   - Paragraphs are paragraphs, not one line per printed line.
   - The running header / book title is not repeated through the text.
   - Page numbers are gone, but numbers that were part of the prose
     (a year, an address, a list) are still there.
   - No sentence is missing its first or last word where a page broke.
4. **Chapters**: the chapter rail matches the book's real chapters. If
   the PDF used a heading style the detector missed, everything lands as
   one chapter and the warning says so -- that is the honest fallback,
   not a bug.
5. **A scanned PDF is refused**: import the image-only PDF. It fails
   with the scanned-pages message naming the workaround, and **no
   workspace folder is left behind**.
6. **A damaged file is refused cleanly**: rename any .txt to .pdf and
   import it. Clear message, no stack trace, no half-built workspace.

Expected: no PDF import ever loses a word of prose; anything the app
reconstructed is stated in the warnings band; and the two failure cases
(scanned, damaged) both stop before scaffolding anything.

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
