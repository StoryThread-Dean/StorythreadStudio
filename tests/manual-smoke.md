# Manual Smoke Checklist

Walk through these scenarios before cutting a release. Each one tests
something pytest and vitest cannot reach: the Tauri shell, native
dialogs, the embedded sidecar, the auto-updater, and OpenRouter calls
with a real API key.

**Environment:** a built release `.msi`, or `npm run tauri dev` from
`app/` for a dev-mode pre-flight. Do NOT run against a non-local
environment -- there isn't one.

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
   Expect no output -- port 8000 should be free. If a row comes back,
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
- After step 5's port check, port 8000 is free -- clean shutdown.

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

Expected -- a native folder-picker dialog opens (NOT a browser file
input), and the new project folder contains all of:
- `manuscript/` -- with at least one starter chapter `.md`
- `notes/` -- containing `outline.md`
- `profiles/characters/`
- `profiles/relationships/`
- `profiles/locations/`
- `profiles/lore/`
- `profiles/chapters/` -- legacy dir, still scaffolded; current chapter
  summaries write to `summaries/chapters/`
- `profiles/scenes/` -- legacy dir, still scaffolded; current scene
  summaries write to `summaries/scenes/<chapter-stem>/`
- `exports/`
- `.storythread/` -- cache; `app.db` will appear here after the first
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
- Click the Writing Progress gauge -- today's task list shows the new
  profile file with reason "save". (Per-file-per-day credit idempotency
  is covered by `test_progress_store.py` -- no need to re-save here.)

---

## 5. Export full manuscript -- all four formats

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
Skill Level + Night Owl wiring. (Settings persistence itself -- save,
reload, backup, corruption recovery -- is covered by
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

## 7. Deprecated project model -- error message + picker + live save

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
  silent failure). The exact error translation -- provider message
  quoted, no bare "HTTP 404" -- is covered by `test_openrouter_errors.py`.
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

## 13. Audiobook Converter -- Formatting Walkthrough, word readings, say popout

**Touches:** the Formatting Walkthrough as a pop-out window (the rail,
the paragraph surface, beats, marker fixes, word readings, add-all-at-
once), its guided tutorial with before/after audio, the [say] popout
(structured input, editing an existing override, the render trace), the
Draft pass, the generation reset escape hatch, and Open Output Folder.

Needs a chapter with dialogue in it, and at least one of *read*, *wound*,
*close*, *lead*, *bow* or *dove* somewhere in the prose.

Steps:
1. **The window**: click into a chapter, press [Formatting Walkthrough]
   in the toolbar. It opens as a pop-out over the editor (NOT a strip
   above it). Check all of: the left rail lists seven types, each with a
   count AND a line saying what it is for; "Rare word readings" is
   unticked to begin with; the panel shows the WHOLE paragraph you are
   deciding about, not a clipped fragment; the keyboard shortcuts sit as
   grey text under the buttons. Clicking the dark backdrop closes it;
   clicking inside does not.
2. **Beats**: walk a few stops. Apply inserts with correct spacing and
   the unsaved dot lights; Skip moves on; Ctrl+Enter and Ctrl+Right
   work. Short-sentence beats should feel RARE -- roughly one suggestion
   per 130 words, and every one landing on a genuine run of three or
   more clipped sentences. If it is firing on ordinary prose, that is a
   regression in the burst rule.
3. **Word readings**: reach a stop for a word like *read* or *wound*.
   Nothing is pre-selected and there is no green Apply button. Each
   reading has its own [Play], speaking YOUR sentence in the book's
   voice; the engine's own reading is labelled "already how it reads --
   Skip keeps it" and offers no button. Press Play on both, then [Use
   this] on the other one: it wraps that word only, in place, with your
   capitalization kept. Replaying a clip is instant the second time.
   Re-walking the chapter must NOT stop on a word you already set.
4. **Fixes**: plant a broken marker ([pace:=2] and an unclosed
   [pause:0.4 ). Both surface under "Fixes" with one-click corrections,
   and the pace one offers BOTH directions rather than guessing.
5. **The tutorial**: press [Show me how this works]. Ten steps. Step 1
   says none of this is required and names Kokoro's faults. Step 3
   plays one sentence three ways (no pause / 0.4 / 1.5). Steps 4 to 7
   each have two [Play] buttons and run one continuous scene (Elena's
   argument). Step 6 carries an amber warning that packed pauses make
   the narrator slur -- play its second clip and confirm you can hear a
   slight slur, because that demo is deliberately not cleaned up. Step 8
   plays the narrator getting *read* wrong, then right. There is no
   keyboard step.
6. **Add all at once**: the rail button reads [Add all N pauses at once]
   with a real number. Confirming inserts every suggested pause but
   leaves marker fixes AND word readings in the walk. Leave WITHOUT
   saving -- reload the workspace and confirm the whole batch is gone.
7. **[say] popout**: select a word, click [say]. Only the spoken form is
   typeable. The word stays visibly selected while the popout has focus.
   Preview plays it in a carrier phrase with no garble at the word's
   edges, and "engine heard: ..." appears underneath. Type a caps
   respelling (LAR-ah) -- preview says the NAME, never spelled letters.
   Accept hops to the next occurrence with the counter. Now click into a
   word you ALREADY set: it must re-open that override for editing with
   the spoken form filled in, and accepting replaces it rather than
   nesting a second one. The popout must open NEAR the word, never at
   the bottom of the screen, including deep in a long chapter.
8. **Draft pass**: turn on the Draft/Testing switch, Generate -- roughly
   half the time on pause-heavy chapters; the amber regenerate-before-
   export notice shows. Turn it off and Generate: every draft segment
   re-queues automatically.
9. **Reset hatch**: pause a run, then click "Cancel generation and
   start over" under Resume -- after the confirm, Generate is available
   fresh and completed segments are NOT redone.
10. **Open Output Folder** (after an export): Explorer opens directly in
    the workspace's output folder.

Expected: walkthrough and [say] edits are buffer-only until Save; no
marker is ever audible in any preview; a word reading is never applied
without a click; a draft can never ship silently (staleness re-queues
it); the reset hatch never deletes audio.

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

## 17. Audiobook Converter -- cast and multiple voices (Stage G)

**Touches:** the Cast panel, `[voice:...]` spans, per-speaker generation,
and the AI speaker pass. Needs a chapter with some dialogue and a working
AI provider key for step 5 onward.

Steps:
1. **Mark a line by hand**: select a line of dialogue, click [Voice] on
   the toolbar. The wrapper is typed with the caret between the colon and
   the bracket -- type `Elena`. Save. The warnings band says Elena is not
   in your cast yet.
2. **Cast panel**: click [Cast] at the bottom of the chapter rail. Elena
   is offered as a one-click add under "your narration already asks
   for...". Add her, give her a different voice, Save Cast.
3. **Hear the difference**: select the marked paragraph plus a
   surrounding one and press [Sample selection]. The narrator's paragraph
   and Elena's line come back in different voices, with the beat between
   them intact.
4. **Recasting re-narrates only her**: generate the chapter, then change
   Elena's voice in the Cast panel. The chapter dot turns amber, not red,
   and pressing Generate re-does only her lines.
5. **The AI pass**: select a passage of dialogue and click
   [Find speakers]. Proposals walk one at a time with a confidence and a
   reason. Correct one name in the box before accepting it, use
   [Keep narrator] on another.
6. **Nothing is saved**: after accepting a proposal or two, close the
   workspace WITHOUT saving and reopen it. The markers are gone -- the
   pass only ever edited the buffer.
7. **The AI cannot rewrite you**: with the pass open, check that every
   quoted line shown matches your text exactly, punctuation included. If
   a proposal is discarded the panel says how many, rather than pretending
   it found nothing.

Expected: a passage never plays in a voice you did not assign; an unknown
name reads as the narrator and says so at save time rather than at listen
time; and no AI proposal can put words in your manuscript that you did
not write.

---

## 18. The Weave -- converting an existing project (THE DANGEROUS ONE)

**Touches:** the migration dry run, the on-disk backup, `codex/` creation, the
resume/restore path after an interruption, and the per-file report. This rewrites
the writer's own files and is the single most destructive button in the app, which
is why it is first of the Weave scenarios.

**Set up:** take a COPY of a real project that still has `profiles/` with several
characters, relationships and locations in it. Do not use a project you care
about, even though the backup exists. Note the file count in each `profiles/`
subfolder before you start.

Steps:
1. Open the copy. In the Weave screen, find the conversion offer. Expect it to be
   an OFFER: nothing should have converted on open, and the project should be
   fully usable unconverted.
2. Run the **dry run** first and confirm you cannot skip it. Expect a plan broken
   down PER FOLDER ("7 from profiles/characters/", "3 from profiles/locations/")
   rather than one total, and expect anything being LEFT ALONE to be named with a
   reason. Confirm the backup location is named BEFORE the button that writes
   anything, along with what happens to your existing profiles/ folder.
   Entry NAMES are not shown here and are not meant to be -- they belong to the
   report at step 6, which lists all of them. (Written the other way round first
   and walked that way once: it reads as a missing feature when it is the wrong
   screen.)
3. Check the dry run wrote nothing: `codex/` does not exist, and every
   `profiles/` file has its original modified time.
4. Convert. Expect the count repeated on a second click before it proceeds.
5. On disk: the backup folder exists and contains the original `profiles/` tree;
   `codex/` now has one folder per kind; the file count per kind matches what you
   noted. Open two or three converted `.md` files in Notepad -- frontmatter intact,
   the writer's prose unchanged, trait blocks still readable as trait blocks.
6. Read the report. Every entry listed and grouped, each openable field by field
   as original-versus-converted. Confirm "changed" and "missing" are shown as
   DIFFERENT things, and that the raw files are offered.
7. **Interruption.** Convert a second copy and kill the app mid-conversion (close
   the window, or end the backend process). Reopen. Expect to be offered
   **resume** or **restore** rather than the app guessing, and expect it NOT to
   present a half-converted project as finished.
8. Take the resume branch on that copy and confirm it completes. On a third copy,
   take **restore** and confirm `profiles/` comes back intact and `codex/` is gone.

Expected: your original manuscript is never touched by any of this. No entry is
silently dropped. If anything at all is unclear about what was changed, that is a
failure -- the report exists because a table is an interpretation.

---

## 19. The Weave -- the map, the scrubber, and spoilers

**Touches:** the graph route, the deterministic layout, the chapter scrubber, the
spoiler toggle, and the list view.

Steps:
1. Open the Weave on a converted project with several connected entries. Expect a
   graph, a legend rendered from the app's own vocabulary, and a chapter slider
   along the bottom.
2. Close and reopen the Weave. **The layout must not reshuffle.** Spatial memory is
   most of a graph's value; a map that rearranges itself on every open is a map you
   cannot learn.
3. Record a fact on one entry anchored to a late chapter (see scenario 20 if you
   have none). Drag the scrubber to a chapter BEFORE it: expect that entry to
   disappear if everything about it happens later, and reappear as you pass its
   first anchor.
4. Give a connection a reveal point in a late chapter. With **spoilers hidden**,
   scrub to before it: the line is absent. Scrub past the reveal: it appears.
   Switch spoilers OFF and it appears early, drawn as a coming connection rather
   than a live one.
5. Confirm the scrubber announces something readable ("Chapter 3, Caught in the
   Rain"), not a bare number, and that the chapter you are resting on is legible
   while its neighbours truncate.
6. Anything hidden must be COUNTED on screen. A map that quietly omits looks like
   a world with less in it than you built.
7. Switch to the list view. Expect a peer view of the same world, not a degraded
   one, and the same spoiler behaviour.

Expected: no dialogs, no writes. This scenario should be entirely read-only.

---

## 20. The Weave -- recording a fact that changes (the three-fact belief)

**Touches:** the Run editor on both screens, the three switches, the chapter
pickers, manual save, and the conflict refusal.

This is the app's founding example and the reason the Weave exists, so it is worth
walking by hand: a heroine who believes her father died until chapter fifteen.

Steps:
1. Open a character in the Profile Builder. Find "How this changes through the
   story" and press **Show me how this works** -- confirm the guided card appears
   and says a belief needs THREE facts.
2. Add fact one: her belief, on HER frame, from an early chapter. Confirm "whose
   truth" is a PICKER of your own entries rather than a text box -- a typed name
   would save, look right, and never resolve.
3. Add fact two: the truth, on the truth frame, with **the reader learns it** set
   to a late chapter.
4. Add fact three: her change of mind, on her frame, from that late chapter,
   marked as replacing fact one.
5. Confirm the collapsed lines read as sentences you can scan, and that only one
   fact is expanded at a time.
6. Press **What does this do?** on a fact. Expect a read-only view: where it is in
   force as a bar, what replaced it, and what a model would actually receive.
   Confirm there is NOTHING to edit there.
7. Ctrl+S. Reopen the file in Notepad: all three facts present, anchors readable.
8. **Conflict:** open the same character in a second window, save from one, then
   save from the other. Expect the second save to be REFUSED with your text still
   in the buffer -- never a silent overwrite.

Expected: nothing is written until you save. Leaving with unsaved work asks first.

---

## 21. The Weave -- Weaving, the guided walk

**Touches:** all four passes, the free scan, the closed-world rule, the inline
resolutions, and the answer ledger across sessions.

Steps:
1. Open Weaving. Before starting, confirm the count is a REAL number and that
   nothing has been spent -- this pass calls no model.
2. Run **Dress the Loom**. Work at least one of each stop you are offered:
   a name with no entry, a thin entry, and an entry nothing connects to.
3. **The closed-world rule is the thing to watch.** At no point should any button
   close Weaving and drop you somewhere else. Creating an entry, filling one in,
   and recording a connection all happen inside the popup, and finishing a stop
   moves you FORWARD rather than back onto the same question.
4. On a flagged name that is wrong (part of another name, a title, a mis-split
   phrase), use **Not right?** -- correct the word, then attach it to an entry you
   already have. Confirm the corrected word is what gets recorded, and that the
   original phrase says it will not be raised again.
5. Record a connection and confirm you cannot save it without a REASON in your own
   words.
6. Use each of the three noes: **not yet**, the permanent no in that stop's own
   wording, and **Never ask** -- which must ask HOW WIDELY before writing anything.
7. Where a kind offers "work through all N at once", take it. Confirm nothing is
   pre-ticked, that choosing a chapter ticks its own row, and that a ticked row
   with no chapter is counted out loud rather than skipped.
8. X out mid-walk. Expect to be asked, and told where you were. Reopen Weaving and
   take **Carry on where you left off** -- expect what you put off to still be put
   off, and what you answered for good to be gone.
9. Run **Read the Cloth** on a project with a contradiction (record two facts
   about the same thing at the same chapter). Settle one by editing a side, and
   mark a second **deliberate**. Rescan and confirm the deliberate one does not
   return.
10. Run **Unwoven**. Confirm the board shows every part of your world with real
    counts, that picking a part narrows the sitting, and that answering a question
    creates a real entry in the right section. Confirm a finished part still
    appears, marked finished.

Expected: no AI call anywhere in this scenario. Every answer survives a restart.

---

## 22. The Weave -- context, and what is sent to AI

**Touches:** the automatic brief, the inspect panel, the exclusions, the off
switch, and the Author Notes guarantee.

This is the scenario that checks a promise rather than a feature, so read the
screen carefully rather than clicking through.

Steps:
1. Put something distinctive in `notes/author-notes.md` -- an invented name you
   use nowhere else.
2. Open a chapter and inspect what would be sent. Expect a small map above the
   list, and a reason beside each Thread.
3. **Confirm the author-notes name is absent.** It must never appear, in any
   brief, on any screen.
4. Remove one Thread from the brief and confirm the estimate changes. Exclude a
   whole category and confirm the same.
5. Switch automatic context OFF entirely and confirm the brief is empty and says
   so.
6. Confirm nothing was transmitted at any point in steps 2 to 5 -- inspecting is
   not sending.
7. Now run one real AI action with context on. Confirm what arrives is consistent
   with what the panel showed.
8. Set a fact's reveal point to a late chapter, then inspect from an early
   chapter: the fact must be absent, and the panel must say something was
   withheld rather than silently shortening the list.

Expected: the author-notes name appears nowhere. Anything withheld is counted.

---

## 23. The Weave -- export

**Touches:** `POST /api/codex/export/weave`, the three shapes, and the
include-the-Weave flags on the manuscript export and the snapshot.

Steps:
1. Export the Weave as **Markdown**. Open it: chapter NAMES readable, every
   connection carrying its reason, no raw ids where a person has to read.
2. Export as **JSON**. Confirm ids are intact and that every anchor carries BOTH
   an id and a label -- drop the id and a program cannot follow a renamed chapter;
   drop the label and a person cannot read the file.
3. Export as **CSV**. Expect THREE files rather than one nested one.
4. Rename a chapter, re-export the JSON, and confirm the anchors still resolve.
5. Run the full-manuscript export with **include the Weave** ticked, and confirm
   the appendix actually contains entries. (Ticking "include profiles" produced an
   empty appendix silently for most of this app's life -- worth a second look.)
6. Run a dated snapshot with the Weave included and confirm the folder layout is
   mirrored.

Expected: every export is written from the FILES, so a stale index cannot make an
export wrong in a way a reindex would quietly fix.

---

## 24. Moving a book to another computer

**Touches:** everything at once, from the writer's side. Automated tests cover
this at the API level (`test_project_portability.py`), but only a human can
check that the app OPENS a moved project, that the Weave screen looks the same
as it did, and that nothing asks to be redone.

**Why this is here:** asked by the writer during the v2.0.0 build -- "Authors
work from multiple computers or need to transfer their project from one
computer to another at some point." Nothing in the app says a word about it, so
the behaviour has to be right without instructions.

Steps:
1. On computer one, open a project with real Weave work in it: several entries,
   some connections carrying reasons, at least one fact with a reveal point, and
   a Weaving session where you answered some things and put others off. Note the
   count on the Weaving screen before you start.
2. Close the app. Copy the WHOLE project folder to a USB stick or a network
   share. Confirm the hidden `.storythread` folder came with it -- in Explorer,
   turn on hidden items and look. This is the step to be fussy about.
3. On computer two, install the app, then open the copied folder. Expect it to
   open with no complaint about paths.
4. Compare against computer one: same entries, same connections WITH their
   reasons, same facts anchored to the same chapters, the map laid out the same
   way (the layout is deterministic, so it should not have reshuffled).
5. Open Weaving. **Expect the same count as step 1**, and expect
   "Carry on where you left off" to be offered with your earlier session still
   there. Anything you retired must still be retired; anything you muted must
   still be muted.
6. Delete `.storythread/app.db` on computer two and reopen. Expect no loss at
   all -- it is a cache and rebuilds. This is worth doing once because it is the
   difference between a cache and a store, and the app claims the former.
7. **The lossy case, done deliberately so you know what it looks like.** Copy the
   folder again, this time WITHOUT `.storythread`. Open it and go to Weaving.
   Expect your world intact (entries, connections, facts are all Markdown) but
   the walk to ask about things you already retired, with no earlier session to
   carry on from. Nothing warns about this today.

Expected: steps 3 to 6 lose nothing. Step 7 loses your Weaving ANSWERS and only
those. If any of steps 3 to 6 loses anything, that is a release blocker -- it
means machine-specific state is being stored where it should not be.

---


## 25. The Profile Extractor (v2.0.1) -- THE ONE THAT SPENDS REAL MONEY

**Touches:** `POST /api/extractor/run`, the Long-context role, the saved run,
and the only write path in the feature. This sends your whole manuscript to a
paid model, so walk the free half first and stop before the button if anything
is wrong.

**Set up:** a project that has been through Weaving and has real entries.

Steps:
1. Open `The Weave > Profile Extractor` from the sidebar. Confirm it sits BESIDE
   Weaving rather than inside it, and that it is a screen rather than a popup.
2. Read the setup screen before spending. It must state: how many chapters and
   entries the run covers, that this is the most expensive request the app
   makes, and WHICH ROLE does the work. Press "Show me how this works" and
   confirm page two is about running Weaving first.
3. Check the "leave alone" ticks. Entries you have written up should be ticked
   already; thin ones should not. Untick one and confirm it stays unticked.
4. **On a project with no entries at all**, confirm the screen tells you to run
   Weaving first and explains why. This is the failure that makes people think
   the feature is bad, so the wording matters more than it looks.
5. Now run it on a real book. Expect minutes, not seconds.
6. **The result.** Every proposal must appear BESIDE what that entry currently
   says. Confirm there is no accept-all, no "apply everything", and nothing
   ticked when the list arrives.
7. Take one section proposal and press **Add to what I wrote**. Open the entry's
   `.md` file in Notepad: your original text must be there, unchanged, FIRST,
   with the proposal after it. This is the button that must never lose a word.
8. Take a trait proposal. Confirm "Fold in" is dead until you choose which of
   your own traits it folds into, then fold one and check the file: your trait
   keeps its name and gains the description.
9. Find a character your book describes but never names, if the pass found one.
   Confirm the description IS the name, that nothing invented one, and that its
   pieces cannot be applied until you create the entry. Create it and confirm it
   arrives as a Side character with nothing but a name.
10. **Come back tomorrow.** Close the app entirely, reopen, and return to the
    screen. The same list must be there with everything you dealt with still
    ticked off.
11. **The guard.** With proposals still unreviewed, run the pass again. It must
    refuse, say HOW MANY you are about to lose, and offer a way back. Cancel and
    confirm the saved run is untouched.

Expected: nothing reaches a profile except by a button on that exact piece.
The manuscript is never modified. If any single click writes more than one
proposal, that is a release blocker -- with no evidence carried, the per-item
click is the entire safeguard.

---


## 26. The look, in both themes

Automated tests can prove a token exists in both themes. They cannot see a
button that has become invisible against the surface behind it.

1. Open a project. Sidebar > **Settings** > Appearance.
2. Switch to **Light**, then back to **Dark**. Both should apply instantly,
   with no flash of the other one.
3. In LIGHT mode, walk: ProjectHome, the editor, Book Details, Weaving, the
   Profile Extractor, Concepts, Profiles, Global Search, Export.
   - [ ] No text that is too pale to read. Muted labels especially.
   - [ ] No leftover dark-mode panel on a cream page.
   - [ ] Scrollbars and any `<select>` dropdown are light, not dark.
4. Repeat the same walk in DARK.
   - [ ] Cards read as raised off the window; inputs read as sunk into the
         card holding them.
   - [ ] Hovering a sidebar row lightens it.
5. **The audiobook side must look UNCHANGED.** Open the Audiobook Converter
   in both themes.
   - [ ] Still charcoal with jewel accents in both. It does not follow the
         light theme, on purpose.
   - [ ] Compare against a screenshot from the previous release if there is
         any doubt.

## 27. Text sizing and spacing

1. Settings > Appearance > **Interface size**. Step through all four.
   - [ ] EVERY label grows, including the smallest ones. Roughly half of the
         app ignored this before v2.0.2, so this is the check that matters.
2. **Line spacing**: set Single, then Double, with a chapter open.
   - [ ] The gap between wrapped lines inside a paragraph changes visibly.
   - [ ] The number shown beside each option matches what you see.
3. **Multiple**: type 2.5, click away.
   - [ ] Applies on blur, not per keystroke.
   - [ ] Typing something silly (0.1, 900, "abc") does not break the editor.
4. **Paragraph spacing**: set After to 24pt.
   - [ ] The gap BETWEEN paragraphs opens up, while the lines inside a
         paragraph stay where they were. These are separate measurements and
         this is the check that they are.
5. Restart the app.
   - [ ] All three settings survived.

## 28. Converting an existing outline -- THE OTHER DANGEROUS ONE

Like scenario 18, this rewrites a file the writer owns. Use a REAL project
made before v2.0.2, and copy the folder first.

1. Note what `notes/outline.md` contains before you start. Keep a copy
   outside the project.
2. Open the project and click **Outline**.
   - [ ] It opens the ordinary editor, not a form.
   - [ ] A notice says the outline was converted and names where the backup
         went.
3. Compare the file against your copy.
   - [ ] The YAML block at the top is gone, replaced by plain `Label:` lines.
   - [ ] **Every line of your own outline body is still there.** This is the
         one that matters; the healer aborts rather than write a shorter
         file, so a missing line is a real failure.
   - [ ] If the old file had expected-characters or chapter lists with
         anything in them, they are preserved in a "Kept from your old
         outline" section at the end.
4. Check the backup exists at the path the notice gave, and matches your copy.
5. Close and reopen the Outline.
   - [ ] No second conversion notice. Converting twice is a no-op.
6. On a project with a HAND-WRITTEN outline that never had a tracking block:
   - [ ] Opening it changes nothing at all and shows no notice.

## 29. The Outline as an editor

1. Open Outline on any project. **Add a section** > Premise.
   - [ ] A horizontal rule and a `## Premise` section appear at the end.
   - [ ] The example line says "delete this" in the example itself.
   - [ ] The unsaved indicator appears. Nothing has been written to disk yet.
2. Ctrl+Z once.
   - [ ] The whole section goes, not part of it.
   - [ ] Reopen the menu: Premise is selectable again.
3. Add Premise again, then rename the heading to `## My Premise`.
   - [ ] Reopen the menu: Premise is selectable again, because the list reads
         your outline rather than remembering what it gave you.
4. Add **Identity** twice.
   - [ ] It never greys out. Character sections are per-person.
5. Add a section you already have.
   - [ ] It is greyed, says so, and clicking it scrolls you to that heading.
6. **Fill from Book Details**, on an outline with some header lines filled and
   some blank.
   - [ ] Blank lines get values; lines you had written are untouched.
   - [ ] It says how many it filled. If there was nothing to do it explains
         why rather than just reporting success.
7. **Show me how**.
   - [ ] Opens as its own window, Page 1 of 21.
   - [ ] Every page after the first names a section and shows three examples.
   - [ ] Back works, Done closes.
8. Save, close the project, reopen.
   - [ ] Everything you added is on disk.
9. Writing Progress gauge.
   - [ ] The Outline row shows a count like "4 of 10", not a yes/no.
   - [ ] Filling in another header line moves it.

## What this checklist does NOT cover

- **Auto-updater** -- verified separately by bumping a version and
  confirming the update prompt + restart cycle.
- **SmartScreen warning** -- only visible on a machine without prior
  trust on this installer.
- **Series and book-in-series flows** -- add a scenario when actively
  changing series code.
- **Thesaurus right-click popover** -- low-risk; add a scenario if it
  breaks repeatedly.
- **Reader Mode** -- visual; add a scenario if its layout changes.
- **Smart Advisor passes** -- require a real OpenRouter key and an
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
