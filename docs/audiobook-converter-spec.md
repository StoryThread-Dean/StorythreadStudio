# Storythread Studio Audiobook Converter

## Feature Assessment and Technical Specification

**Project:** Storythread Studio  
**Feature:** Convert to Audiobook  
**Status:** Proposed  
**Platform:** Windows  
**Application model:** Free and open source  
**Initial language focus:** English  

---

## 1. Executive Summary

The Audiobook Converter will be a standalone workspace inside Storythread Studio that allows a writer to import an external manuscript, prepare the text for narration, select a text-to-speech voice, preview the result, generate audiobook audio in the background, and export the finished work as chapter MP3 files, a combined MP3 file, an M4B audiobook, or all supported formats.

The feature will remain separate from Storythread Studio's existing writing-project workflow. A manuscript does not need to be created in Storythread Studio or linked to a Storythread project. As a convenience, the Import step will also offer an "Import from a Storythread project" picker that pulls the manuscript chapters of an existing writing project as the source; the resulting audiobook workspace is still fully standalone.

This feature is the fundamental change reserved for version 1.1.0 under the project's versioning convention.

The initial release will support one narrator voice per audiobook generation run, while the internal data model will be designed from the beginning to support multiple character voices in a future release.

The feature will support:

- DOCX
- EPUB
- Markdown
- TXT
- Import from an existing Storythread writing project
- Local text-to-speech through an optional Kokoro installation
- Cloud text-to-speech through OpenRouter and NanoGPT
- Voice previews
- Chapter selection
- Background generation
- Pause, resume, cancel, and restart recovery
- Regeneration of individual chapters or smaller changed sections
- Automatic detection of narration text that has changed since audio generation
- Chapter MP3 files
- Combined MP3 output
- M4B output with audiobook metadata

The feature will not initially include:

- PDF import (deferred to a later phase; it is the only format requiring a new extraction dependency and carries the highest extraction-quality risk)
- Full audiobook playback (basic play/pause/seek of previews and generated chapters IS included; what is deferred is a dedicated player with listening-position memory)
- Read-along playback
- Scanned-PDF OCR
- GPU acceleration (CPU synthesis runs about five times faster than realtime, so an 8-hour book generates in under 2 hours; see Section 15)
- Voice cloning
- Multiple voices within the same audiobook
- Automatic dialogue attribution
- Official multilingual support guarantees
- Pitch, bass, or advanced audio equalization controls

---

## 2. Product Goals

The Audiobook Converter is intended to support several writer workflows:

- Proofreading by listening to a manuscript
- Finding inconsistencies, awkward phrasing, pacing problems, or repeated words
- Generating private listening copies
- Creating chapter-based audio for review
- Producing audiobook content for platforms such as YouTube, subject to copyright, provider, platform, and voice-license requirements
- Generating final audiobook output for personal or potentially commercial use, depending on the user's rights and the selected provider's terms

The application will not determine whether a user has the legal right to publish or monetize generated audio. It will provide clear ownership, consent, AI-generation, and provider-disclosure notices.

### 2.1 The Core Workflow: Draft Locally, Print Premium

The converter is designed around a two-pass workflow:

1. **Draft pass (free).** The writer generates the book with the free local Kokoro narrator. Kokoro is a modern neural voice: natural and clearly human, but an even reader rather than a performer. The draft pass is for listening: catching awkward prose, repeated words, pacing problems, and dialogue that does not land. It is also where the writer fixes pronunciations of invented names in the pronunciation dictionary, so the final pass is right the first time.
2. **Print pass (paid, optional).** When the book is final, the writer switches to a premium hosted voice and regenerates the entire book in one deliberate, fully-costed pass. Premium voices buy narration performance: emotional range, dramatic pacing, character energy.

Because the voice and provider are part of every segment's generated-state hash (Section 24), switching voices correctly marks the whole book for regeneration; the cost estimator (Section 20) gates the print pass with an explicit confirmation, for example "Printing with ElevenLabs Turbo: about $29. Proceed?" All narration preparation carries over untouched between passes: narration edits, pronunciation rules, pause markers, chapter selection, and exclusions. Only the audio is re-rendered.

Writers who skip the local install can draft with the SAME Kokoro voices hosted by NanoGPT for roughly $0.50 per full-length book; hosted and local Kokoro produce identical narration, so nothing regenerates when switching between them with the same voice.

---

## 3. Product Boundaries

### 3.1 Included in the MVP

- Separate Audiobook Converter dashboard
- Separate Audiobook recent activity
- Guided wizard
- One active audiobook generation process at a time
- Chapter-level generation queue
- User-selectable chapters
- User-selected audiobook workspace folder
- Imported source copied into the workspace
- Editable narration copy
- DOCX, EPUB, Markdown, and TXT import
- Import from an existing Storythread writing project
- English as the default language
- Multiple narrator voices to choose from
- One narrator voice per generation run
- Future-ready speaker assignment schema
- Optional local Kokoro installation (all voices included in one download)
- OpenRouter provider support
- NanoGPT provider support
- Dynamic speech-model discovery
- Voice previews
- Pronunciation dictionary
- Structured narration markers
- Background generation
- Global progress indicator
- Estimated time remaining
- Pause, resume, cancel, and restart recovery
- Chapter regeneration
- Segment regeneration
- Automatic stale-audio detection
- Manual regeneration approval
- Chapter MP3 output
- Combined MP3 output
- M4B output
- Metadata editor
- Retained intermediate audio files
- User-controlled cleanup

### 3.2 Deferred Features

- PDF import (text-based PDF first when it lands; scanned-PDF OCR remains out of scope beyond that)
- GPU-accelerated local synthesis
- Multiple character voices in one audiobook
- Automatic speaker detection
- AI-generated narration scripts
- AI-generated pause and scene-break suggestions
- Full audiobook player
- Read-along highlighting
- Scanned-document OCR
- Voice cloning
- Celebrity or public-figure voice imitation
- Pitch controls
- Bass controls
- Audio equalization controls
- Automatic synchronization with Storythread writing projects
- Automatic monitoring of source manuscript changes
- Official multilingual support
- Multiple simultaneous audiobook projects
- Parallel generation of multiple chapters

---

## 4. Application Navigation

The Storythread Studio main dashboard will contain a dedicated Audiobook Converter entry.

Example:

```text
Audiobook Converter
Convert manuscripts into MP3 and M4B audiobooks.

[Open Converter]
```

Opening the converter will navigate to a separate audiobook dashboard.

The audiobook dashboard will not share recent activity with Storythread writing projects.

---

## 5. Audiobook Dashboard

### 5.0 Visual Identity: Jewel Tones on Charcoal

The Audiobook Converter uses its OWN color scheme, distinct from the
writing app's Light and Dark modes, so the writer always knows which side
of the app they are in.

Dark (primary design target): deep jewel tones on dark charcoal
backgrounds, with each jewel carrying a consistent meaning:

- **Emerald green** -- primary actions, success, completed states
- **Sapphire blue** -- information, progress, generation activity
- **Ruby red** -- costs, warnings, destructive actions, failed states

Implementation: a scoped theme class on the audiobook root element (for
example `.audiobook-theme`) overriding the design tokens, so the writing
app's palette is untouched and both themes coexist in one window. The
light variant keeps the same jewel accent meanings on light surfaces; its
exact values are decided when the dashboard UI is built.

### 5.1 Primary Actions

- New Audiobook
- Open Existing Audiobook Workspace
- Resume Active Generation
- Manage Local Voices
- Configure Providers
- Open Audiobook Settings

### 5.1.1 Dashboard Redesign (user-designed 2026-07-30, scheduled with Stage D)

The plain button dashboard educates nobody. The redesign makes the FIRST
look at this screen teach what the tool is and how the workflow runs:

- **Headline + one-line pitch**: "Audiobook Generator" with a plain-terms
  subtitle in the spirit of "turns your written book into AI-narrated
  audio" (final wording at build time; no em dashes).
- **The five-step workflow strip**, each step hover-animated with a
  short, plainly worded expansion:
    1. Load your book
    2. Set up your workspace
    3. Prepare your manuscript
    4. Generate the free local version
    5. (Optional) Print a professional HQ version with premium AI voices
  Step 5's expansion includes basic pricing honesty (hosted Kokoro
  around half a dollar a book; premium tiers meaningfully more; real
  numbers wired when Stage D lands providers).
- **[Let's Get Started]** replaces [New Audiobook] as the single primary
  action, clearly signaled as a guided walkthrough that creates the
  workspace for you.
- **[Open Existing Workspace] demoted**: tucked under a small pulldown /
  secondary menu, never competing with the primary flow. Recents on the
  right stays -- returning users just click their book.

### 5.1.2 Default Workspace Locations (locked rule, with Stage D)

The Get Started flow suggests the workspace location; the writer can
override, but the default is ALWAYS:

- **Storythread book source**: `<book folder>/audiobook/` inside the
  book project itself (example:
  `curse-of-the-tomb-raider/audiobook`). The audiobook lives with its
  book.
- **External manuscript** (DOCX/EPUB/TXT/MD from any other tool):
  `Documents/Storythread Audiobooks/<Book Title>/` (title run through
  the 8.1 filename sanitizer).
- Collision handling: if the default folder exists and is not empty,
  suggest `audiobook-2` / `<Book Title>-2` rather than erroring the
  writer into folder-picking.

### 5.2 Recent Activity

Example:

```text
Audiobook Converter

[New Audiobook]

Recent Activity
------------------------------------------------------------
The Hollow Road       Generating       43%
Ashes of Morning      Completed        July 26, 2026
Test Narration        Paused           July 24, 2026
Winter Manuscript     Extraction Error July 20, 2026
```

### 5.3 Recent Activity Data

Each audiobook record should track:

- Audiobook title
- Author
- Imported source filename
- Audiobook workspace path
- Import date
- Last opened date
- Current project status
- Selected provider
- Selected model
- Selected voice
- Selected language
- Output formats
- Total chapters
- Selected chapters
- Completed chapters
- Queued chapters
- Failed chapters
- Estimated provider cost
- Actual provider usage when available
- Output folder
- Last error or warning

### 5.4 Recent Activity Actions

- Open
- Resume
- Open Output Folder
- Duplicate as New Audiobook
- Remove from Recents
- Delete Working Files

`Remove from Recents` must not delete project files.

`Delete Working Files` must show an explicit cleanup dialog and must not select final exports by default.

---

## 6. Guided Wizard

The Audiobook Converter will use a guided wizard with full backward navigation before generation begins.

### 6.1 Wizard Steps

```text
1. Import
2. Review & Edit
3. Chapters
4. Voice
5. Metadata
6. Preview
7. Generate
```

The user can freely move backward and forward between completed steps until selecting `Generate Audiobook`.

Once generation begins, the current imported snapshot, narration text, selected chapters, and generation settings become a versioned generation run.

### 6.2 After the Wizard: the Workspace View

The wizard runs once per import. After the first generation begins (or the wizard is completed), the user lands in a persistent workspace view with tabs:

```text
Narration | Chapters | Voice | Output
```

The dominant long-term loop is edit, regenerate changed sections, and re-export -- so the workspace view is the steady-state screen. `Open` on the audiobook dashboard goes directly to the workspace view. Re-exporting, changing metadata, or switching voice for a print pass must never require re-entering the seven-step wizard.

---

## 7. Step 1: Import

### 7.1 Supported Formats

- DOCX
- EPUB
- Markdown
- TXT
- An existing Storythread writing project (manuscript chapters imported as the source; chapter boundaries come directly from the chapter files, so chapter detection is exact)

DOCX and EPUB extraction reuse libraries already shipped with the backend (`python-docx` and `ebooklib`, used today by the export feature), so no new dependencies are required for the MVP format set.

### 7.2 Deferred Format Behavior

PDF import is deferred to a later phase. It is the only format that requires a new extraction dependency and it carries the highest extraction-quality risk in the project.

When PDF support lands, it will cover text-based PDFs only. Scanned or image-only PDF documents will not use OCR.

Suggested error (for the PDF phase):

> This PDF appears to contain scanned pages rather than selectable text. Scanned-document OCR is not currently supported. Convert it to a text-searchable PDF, DOCX, EPUB, Markdown, or TXT file and try again.

Until PDF lands, selecting a PDF should produce:

> PDF import is not supported yet. Export the manuscript as DOCX, EPUB, Markdown, or TXT and try again.

### 7.3 Import Workflow

1. User selects a manuscript.
2. User selects an audiobook workspace folder.
3. Storythread creates the audiobook workspace.
4. Storythread copies the original manuscript into the workspace.
5. Storythread extracts and normalizes the text.
6. Storythread attempts to detect chapters.
7. Storythread creates an immutable extracted-original copy.
8. Storythread creates an editable narration copy.

### 7.4 Source File Rule

The original manuscript will always be copied into the audiobook workspace in the MVP.

The source file outside Storythread will never be modified.

Suggested notice:

> The original manuscript will be copied into the audiobook workspace. Your original file will not be modified.

### 7.5 Source Locking

The original external source file should not be locked.

Generation should use a copied and versioned snapshot inside the audiobook workspace.

Suggested notice:

> Audiobook generation uses a saved snapshot of this manuscript. Later changes to the original file will not affect the current generation.

---

## 8. Audiobook Workspace Storage

The user selects a workspace location for each audiobook.

Example:

```text
C:\Users\User\Documents\Audiobooks\The Hollow Road
```

Recommended structure:

```text
The Hollow Road/
├── audiobook-project.json
├── source/
│   ├── original-manuscript.docx
│   └── source-metadata.json
├── manuscript/
│   ├── extracted-original.md
│   ├── narration-copy.md
│   ├── narration-structure.json
│   └── pronunciation-dictionary.json
├── chapters/
│   ├── chapter-001.json
│   └── chapter-002.json
├── generated-segments/
│   ├── chapter-001/
│   └── chapter-002/
├── previews/
├── revisions/
├── output/
│   ├── chapters/
│   ├── The Hollow Road.mp3
│   └── The Hollow Road.m4b
└── logs/
```

Storythread's application-data directory should only maintain a lightweight recent-activity index and provider settings.

### 8.1 Windows Filename and Path Hygiene

Book titles become folder and file names, and titles like "The Hollow
Road: Book 2?" contain characters Windows forbids. One sanitization rule,
applied everywhere a title becomes a path component:

- Strip the illegal characters `< > : " / \ | ? *` and control characters
- Strip trailing dots and spaces (Windows silently rejects them)
- Refuse reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) by
  appending a suffix
- Collapse runs of whitespace; cap the component at 60 characters
- Never sanitize into an empty string -- fall back to "Untitled"

Deep workspaces plus long titles can also brush against MAX_PATH:

- Enable `longPathAware` in the application manifest at build time.
- Keep generated inner paths short by construction -- stable short segment
  IDs (Section 23.1) exist partly for this reason.
- Warn at import time when the chosen workspace path is already longer
  than 180 characters.

### 8.2 Workspace Locking

A workspace is a folder full of state that is expensive to regenerate;
two writers (or two app instances, or one instance twice via a bug) must
not mutate it concurrently. Cheap insurance: a lockfile.

- `<workspace>/.storythread-audiobook.lock` containing PID, hostname, and
  an ISO timestamp, refreshed periodically while held.
- MANDATORY around generation runs: acquiring the lock is part of
  starting or resuming a run; failure to acquire shows who holds it.
- Advisory on plain open-for-editing: a second opener gets a clear
  warning rather than a hard block.
- Staleness: a lock whose PID no longer exists (same host) or whose
  timestamp is old with no refresh is stale and may be broken with an
  explicit user confirmation.

---

## 9. Step 2: Review and Edit

The Audiobook Converter will include a focused narration preparation editor.

It should not duplicate Storythread Studio's full writing interface.

### 9.1 Manuscript Layers

```text
Imported source
      ↓
Extracted original
      ↓
Editable narration copy
      ↓
Structured narration segments
      ↓
Generated audio
```

### 9.2 Imported Source

- Immutable from inside Storythread
- Retained for reference
- Used to recreate extraction if needed

### 9.3 Extracted Original

- First normalized extraction
- Read-only recovery point
- Used to compare against narration edits

### 9.4 Narration Copy

- Editable
- Auto-saved
- Used for all speech generation
- May differ from the original manuscript
- Can contain narration markers and exclusions

### 9.5 Editor Capabilities

- Edit text
- Correct chapter headings
- Remove unwanted front matter
- Remove unwanted back matter
- Remove page headers and footers
- Repair extraction errors
- Search and replace
- Undo and redo
- Insert pauses
- Insert scene breaks
- Insert chapter breaks
- Add pronunciation rules
- Exclude selected text from narration
- Restore text from extracted original
- Display stale-audio status
- Show generated versus changed text

---

## 10. Narration Editor Quick Actions

The narration editor will include a quick-action toolbar.

Suggested controls:

```text
Short Pause
Medium Pause
Long Pause
Custom Pause
Scene Break
Chapter Break
Pronunciation
Exclude from Audio
Restore Text
```

### 10.1 Suggested Pause Defaults

```text
Short Pause       0.4 seconds
Medium Pause      0.8 seconds
Long Pause        1.5 seconds
Scene Break       2.0 seconds
Chapter Break     3.0 seconds
```

These values should be configurable.

### 10.2 Marker Storage: Text Is the Source of Truth

Markers live INSIDE the narration copy (`narration-copy.md`) as a strict inline syntax, following the same principle as the rest of Storythread: Markdown files are the filing cabinet, derived data is the index cards.

```text
The door closed behind him.

[pause:0.4]

She looked toward the window.

[scene-break]
```

Suggested syntax:

```text
[pause:0.8]                explicit duration in seconds
[scene-break]              uses the configured scene-break duration
[chapter-break]            uses the configured chapter-break duration
[exclude] ... [/exclude]   text kept in the file but never narrated
[say:KAY-lith]Kaelith[/say]   one-spot pronunciation override (see 11.1)
```

Semantics locked (decided 2026-07-28):

- **`[chapter-break]` is timed silence ONLY** -- a configurable pause
  (default 3.0 seconds) for mid-file transitions. It never creates a new
  chapter. Chapter STRUCTURE comes exclusively from `# ` headings in the
  narration copy; the marker and the heading are independent tools.

The structured form (`narration-structure.json`) is DERIVED by parsing the narration copy, never hand-maintained. This means a writer can repair a narration copy in any text editor and nothing breaks; the parser simply re-derives the structure. The editor renders the markers as friendly visual chips.

Derived structure example:

```json
{
  "type": "pause",
  "duration_ms": 800
}
```

Structured markers (as the derived layer) will simplify future support for multiple speakers, emotional direction, and provider-specific speech markup.

### 10.3 Silence Is an Assembly Concern, Not a Synthesis Concern

Pauses, scene breaks, and chapter breaks are never sent to the speech engine. Markers act only as segment CUT POINTS; the silence itself is generated at assembly time by FFmpeg.

Why this matters:

- Silence is free and exact to the millisecond on every provider.
- It is provider-independent -- no reliance on any engine's pause markup.
- Retiming is free: changing the scene-break duration from 2.0 to 2.5 seconds re-runs only assembly. No speech is regenerated and no provider cost is incurred.

For the same reason, pause and break DURATIONS are excluded from the segment generated-state hash (Section 24); marker POSITIONS still affect segmentation and therefore still participate.

---

## 11. Pronunciation Dictionary

The user can define custom pronunciations.

Example:

```text
Displayed text: Kaelith
Spoken as: KAY-lith
```

### 11.1 Pronunciation Scopes

Two scopes live in dictionary files; the third is an inline marker:

- **This audiobook** (`scope: "audiobook"`) -- the workspace dictionary file
- **All audiobooks** (`scope: "all"`) -- the app-level dictionary file
- **This occurrence** -- NOT a dictionary entry. A position-anchored rule
  would break the moment the writer edits upstream text. Because text is
  the source of truth, a one-spot override is an inline marker instead:

  ```text
  [say:KAY-lith]Kaelith[/say]
  ```

  The display always shows "Kaelith"; the provider payload gets
  "KAY-lith". The marker travels with the text, survives editing in any
  external editor, and participates in segment hashing naturally (editing
  a [say] changes the audio, so the hash SHOULD change). Inline [say]
  wins over dictionary rules for its span. (Decided 2026-07-28,
  replacing the earlier position-anchored occurrence scope.)

### 11.2 Pronunciation Data

Suggested structure (dictionary files carry only the two file scopes):

```json
{
  "display_text": "Kaelith",
  "spoken_text": "KAY-lith",
  "scope": "audiobook",
  "case_sensitive": false
}
```

The displayed narration text should remain unchanged. Pronunciation substitutions should be applied only when preparing text for a speech provider.

### 11.3 Text Normalization and Storythread House Rules

The narration pipeline interacts with two established Storythread rules, in both directions:

- **The sanitizer never touches imported manuscripts.** The em dash ban applies to AI-GENERATED text shown to the writer. A narration copy is the writer's own text; it must pass through untouched, em dashes included. Em dashes are also useful prosody cues for speech engines.
- **Storythread-authored `--` is normalized in the provider payload only.** Manuscripts written inside Storythread use `--` per the house style. A speech engine may read `--` literally or pause oddly, so the same payload-preparation layer that applies pronunciation substitutions converts `--` to natural punctuation (em dash or comma) in the text sent to the provider. The displayed narration copy is never rewritten.

Both transformations live in the same place: the provider payload preparation step, alongside pronunciation substitution. Displayed text is always the writer's text.

### 11.4 Text Verbalization (Payload-Prep Pipeline)

Numbers, dates, ordinals, roman numerals ("Chapter XII", "Henry VIII"),
abbreviations ("Dr.", "St.", "etc."), and URLs are read differently by
every engine -- Kokoro/misaki's normalization is limited and hosted models
vary. Verbalization has a defined home: a step in the payload-prep
pipeline, which runs in this fixed order for every piece of narration
text sent to a provider:

```text
1. [say:...] inline overrides        (writer's explicit word wins)
2. Pronunciation dictionary rules    (audiobook scope, then all scope)
3. Verbalization                     (numbers, romans, abbreviations)
4. Punctuation normalization         ('--' to em dash)
```

MVP scope is deliberately thin -- expand the constructs engines reliably
get wrong, pass everything else through and LEARN from the draft passes
while the stakes are low:

- Roman numerals in headings and honorifics ("Chapter XII" -> "Chapter
  Twelve", "Henry VIII" -> "Henry the Eighth")
- Common abbreviations (Dr., Mr., Mrs., Ms., St., etc., vs., e.g., i.e.)
- Simple integers and ordinals ("Chapter 3" -> "Chapter Three", "21st" ->
  "twenty-first")
- URLs read as words ("example.com" -> "example dot com")

Rules:

- Verbalization applies to the PAYLOAD only; displayed text never changes.
- A `verbalizer_version` is part of the generated-state hash (Section
  24.1) -- improving the verbalizer marks affected audio stale, which is
  correct.
- A [say] marker always beats the verbalizer for its span, so any wrong
  expansion has an immediate writer-side escape hatch.

---

## 12. Step 3: Chapter Selection

The user can select which chapters to generate.

Example:

```text
☑ Chapter 1     Ready
☑ Chapter 2     Ready
☐ Chapter 3     Editing
☑ Chapter 4     Ready
☐ Chapter 7     Editing
```

This allows the writer to generate completed chapters while continuing to edit other chapters.

### 12.1 Chapter Queue Rules

- Only one audiobook project may actively generate at a time.
- One chapter should generate at a time in the MVP.
- Selected chapters are queued.
- Unselected chapters remain editable.
- The user may remove a queued chapter before it starts.
- The user may add a newly finished chapter to the queue.
- Completed chapters are available immediately.
- Generation should pause after the current segment, not in the middle of a provider request.

Example:

```text
Chapter 1    Generating    73%
Chapter 2    Queued
Chapter 3    Excluded
Chapter 4    Queued
Chapter 5    Completed
Chapter 6    Failed        Retry
Chapter 7    Excluded
```

### 12.2 Future Concurrency

Parallel chapter generation may be added later, but sequential generation is preferred initially because it:

- Reduces provider throttling risk
- Reduces API rate-limit complexity
- Reduces local CPU contention
- Simplifies cost estimates
- Simplifies recovery
- Simplifies progress reporting

---

## 13. Step 4: Voice Selection

### 13.1 Providers

Initial providers:

- Local Kokoro
- OpenRouter
- NanoGPT

Provider landscape facts (verified July 2026):

- OpenRouter now offers a real TTS endpoint (`/api/v1/audio/speech`, OpenAI-compatible) carrying dedicated speech models such as GPT-4o Mini TTS, Gemini Flash TTS, Voxtral Mini TTS, and Deepgram Aura-2, priced per input character. Per-character pricing makes the cost estimator (Section 20) nearly exact, since character counts are known before generation.
- NanoGPT hosts Kokoro-82m -- the SAME model and voice set as the local engine -- at roughly $0.001 per 1,000 characters, plus premium tiers such as ElevenLabs Turbo at roughly $0.06 per 1,000 characters. NanoGPT also provides an asynchronous TTS endpoint (submit a ticket, poll for status) that maps directly onto the remote-job methods in Section 16.1.

The speech models are NOT the chat models: same provider accounts and API keys, separate model catalog reached through a separate audio endpoint. This is the "Writing Models vs Audio Models" split in Section 16.

#### 13.1.1 Engines tested by ear (findings, not plans)

A catalog entry is a recommendation, so an engine earns its place on the shelf by being listened to. What that produced:

- **Grok Voice TTS (`x-ai/grok-voice-tts-1.0`, OpenRouter, $15/M) -- DEMOTED.** Two separate problems, both found live.
  - *Roster:* xAI publishes 26 voices, each able to speak American, British, or Australian via an id suffix (`ara-en-GB`). OpenRouter answers to five bare names only -- `Ara`, `Eve`, `Leo`, `Rex`, `Sal`. Three 404s established this: `iris-en-US`, `iris-en-GB`, and then `ara-en-GB`, that last one a documented voice, which proves it is the SUFFIX being rejected and not just the wider roster. An accent dropdown was built and removed within two commits as a result.
  - *Prosody drift:* it narrates well sentence by sentence, but pitch and tone reset between sentences, so a chapter arrives sounding like several narrators spliced together. The cause is structural: Storythread sends each segment as its own request and this model re-improvises delivery every time. Nothing on our side can steady it -- flow synthesis (Section 15) fixes seams WITHIN a segment, not identity drift across them. An expressive model without a seed or continuation parameter cannot hold a book together.
  - Kept selectable behind a "tested but not recommended" disclosure, carrying its reason. Demoting is the honest move; deleting would strand any book already pointed at it and teach nobody anything.

The general lesson, worth applying to every future premium engine: **expressiveness and consistency trade against each other under per-segment synthesis.** The flatter model (Kokoro) stitches invisibly; the performer does not. Any engine considered for the Standard or Pro tier must be auditioned across at least a full chapter, not a sample sentence, because a single sentence is exactly the length at which this defect is inaudible.

- **Voxtral Mini TTS (`mistralai/voxtral-mini-tts-2603`, OpenRouter, $16/M) -- DEMOTED after four tests.** Inside a paragraph it is genuinely good: even, professional, zero slurs or mangled words -- better than Grok on every count that broke Grok. It came off the shelf for the cast. Every voice has a **mood welded into the id**, the same id reads the entire book, and it turns monotonous in roughly twenty seconds; four moods were tried by ear (curious, neutral, sarcastic, confident) and none felt right for narration. There is no mood-free variant -- `neutral` is the plainest available, and it is average. Its other complaint, paragraphs running together, turned out to be **our bug**, not the engine's, and is fixed above. Kept selectable: if one of the moods happens to suit a particular book, it works.

  The general lesson to carry forward: **a fixed emotion is not a narration voice.** It solved the drift problem exactly as predicted -- telling the model "be Oliver, neutral" every time does stop it re-improvising -- and then failed on the thing that prediction did not cover. A narrator varies; a model pinned to one mood cannot.

  Original rationale, kept because the reasoning was sound even though the verdict went against it: Chosen for one structural reason: **the mood is part of the voice id, not a parameter.** Three English narrators ship as one id per emotion (`gb_oliver_neutral`, `en_paul_confident`, `gb_jane_curious`...), so every segment is told "be Oliver, neutral" rather than being asked to interpret the text afresh. That is directly the latitude Grok used to drift. 24 English ids in all -- Paul (American male, 8 moods), Jane (British female, 9), Oliver (British male, 7) -- plus six French not offered. Deliberately NOT modelled as speaker x emotion axes: the mood sets differ per speaker, so two dropdowns would offer combinations that do not exist. Unproven by ear at time of writing; the full-chapter audition above applies to it too.

##### Audio format is per MODEL, not per provider (live 400)

A Voxtral audition came back `400 -- Mistral TTS only supports response_format="mp3". Got "pcm"`. The OpenAI-speech transport had `pcm` hard-coded, on the reasonable-sounding assumption that a format is a property of the endpoint. It is not: OpenRouter forwards to whatever the upstream vendor supports, and that varies model by model within one provider.

`response_format` now lives on `HostedModel` (default `pcm`). mp3 answers are **decoded**, never header-wrapped -- wrapping mp3 bytes in a WAV header produces a file that plays as noise, costs a full book's spend, and fails no automated check. Decoding uses **miniaudio**: a single 268 KB wheel with no transitive dependencies, chosen over `soundfile` because soundfile drags numpy in and the whole backend is frozen into a PyInstaller sidecar. Byte-identical output to soundfile was verified before adopting it. It is named explicitly in `backend.spec` hiddenimports, because the import is inside a `try/except ImportError` -- a miss there would not fail the build, it would quietly ship a backend that refuses mp3 engines at narration time.

Two rules that fell out of it, both about money:

- **Sniff the bytes, not the content-type.** mp3 is detected from an ID3 tag or an MPEG frame sync, so a mislabelled answer still reaches the decoder. This also covers audio fetched from a JSON URL (NanoGPT's async shape), which was the one branch a compressed answer could have slipped through.
- **A decode failure is NOT retryable.** Bytes that will not decode are a format incompatibility, not a hiccup, and each retry bills again for the identical failure. An EMPTY answer stays retryable -- that one is a hiccup.

##### The paragraph beat (live finding, fixed -- and it was ours)

Four structured tests on Voxtral isolated it cleanly: two selections **without** a trailing `[pause]` both ran the next paragraph in milliseconds later; the same selection **with** `[pause:0.8]` was flawless; a fourth test full of short sentences and pauses was flawless too. So the engine was never the problem. Two of our own decisions were:

1. **Paragraphs grouped into one segment**, joined by a blank line, and the engine decided what that blank line meant. Some ignore it entirely. A boundary the pipeline cannot see is a boundary it cannot time.
2. **Separate segments were butted together with zero silence** -- and `_condition_edges` had already trimmed away up to 250 ms of the engine's own trailing breath, deliberately, so that writer-placed pauses would not stack. Correct in isolation, wrong in combination.

Fixed by making a paragraph a first-class unit: **one paragraph, one segment** (`SEGMENTS_VERSION` bumped to 2), each stamped `paragraph_start`, with `paragraph_gap_ms` (default **550**) inserted at assembly between two spoken pieces. Four details worth keeping:

- The flag is **layout, not content**: it stays out of `content_hash`, so re-flowing paragraphs never forces a paid re-render of identical speech. Retiming the beat costs nothing either -- it is applied at assembly, not baked into audio.
- **A writer's own `[pause]` wins.** The automatic beat only lands between two spoken pieces, never stacked on a pause, scene break, or chapter break.
- **Continuation pieces of an oversize paragraph are not paragraph starts.** Inserting a beat mid-paragraph would be a worse artifact than the one being fixed.
- **Flow groups still span mid-paragraph pauses.** A paragraph at index 0 with work already open is a continuation, not a new paragraph -- flushing there would break the continuous-render trick that exists to stop consonant slurs.

Cost is unchanged: hosted engines bill per character, not per request.

##### Loudness matching (live finding, fixed)

A two-paragraph Voxtral preview came back with the second paragraph noticeably louder than the first, and it stayed loud for the rest of the clip. Two paragraphs are two requests, and an expressive hosted model picks its own **level** per request just as it picks its own pitch. Kokoro never did this.

Unlike pitch, loudness is fixable from our side. `wav_assembly.match_level()` normalizes to **-20 dBFS RMS** -- the middle of Audible's ACX window (-23 to -18 dB RMS) -- with a -1 dBFS peak ceiling, a hard +/-8 dB clamp so room tone is never amplified into the foreground, and a deadband so a clip already on target is returned byte-identical rather than silently rewritten.

Two decisions inside it matter more than the numbers:

- **The unit is one SYNTHESIS CALL, never one clip.** Flow synthesis renders a run of sentences as one continuous clip and splits it afterwards. Those splits must share a single gain -- level them against each other and the natural rise and fall inside a sentence flattens into mush, destroying precisely what flow synthesis exists to protect. Both callers therefore normalize the whole clip and split second. A test pins a 3:1 dynamic surviving the round trip.
- **It runs at ASSEMBLY, not at synthesis.** Stored segment `.wav` files stay exactly as the engine made them, so this costs nobody a re-render on a paid engine, and a book generated before the feature existed comes out even on its next assembly.

Residual, and honest: this fixes level jumps. It does NOT fix pitch or timbre drift between segments, which remains an engine property (see Grok above). Voxtral's pitch/tone did shift between paragraphs in the same test, and no amount of gain fixes that.

##### The paid preview must never quietly change what it reads

Same session, second finding: previewing a selection worked, then clicking Sample again played the canned demo sentence instead. A textarea's selection does not reliably survive a round trip through a button in the rail, and `[Sample This Voice]` falls back to a demo sentence when nothing is highlighted -- so it billed for words the writer did not ask to hear.

Two fixes, because either alone leaves a hole: the workspace now remembers the last real highlight **as text** (not offsets, which later edits invalidate) and prefers a live selection over it; and the panel states which was used -- "Read your highlighted passage" or "Read the demo sentence -- highlight a passage to hear your own words". The fallback was never wrong; being silent about it was.

##### Voice ids: there is no authoritative source but a live call

Three engines, three different disagreements between the gateway's metadata and the vendor's own documentation:

| Engine | Gateway metadata | Vendor page | Truth |
|---|---|---|---|
| Grok | 5 bare names | 26 voices x 3 dialect suffixes | Gateway. The vendor's extra voices and every suffix 404'd. |
| Voxtral | 30 ids | -- | Gateway, complete and correct. |
| MAI-Voice-2 | 4 ids, English stem `en-US-Harper` | 45+ ids, English ShortName `en-US-Harper:MAI-Voice-2` | **Vendor.** The gateway's list was both partial (7 English voices, not 1) and truncated -- an Azure ShortName carries the MODEL as a suffix, and the bare stem looks like a finished id but is not. |

So the earlier rule ("trust the gateway, not the vendor page") was overfitted to Grok. The real rule: **cross-read both, ship the best-documented form, and keep the typed-voice box** -- the only ground truth is a live call.

The failure mode is worth noting too, because it cost two auditions. Sending a bad voice id produced an **opaque** `Provider returned 400`. Sending NO voice produced the useful one: `An explicit voice is required for this TTS provider.` Deliberately removing a parameter to make an error legible is a debugging move worth remembering -- the blank-voice box exists partly for that.

##### Pace is engine-relative (live finding, fixed)

Narrator Pace 0.85 / Dialogue Pace 0.9, tuned by ear on the local narrator and sounding normal there, came out **dramatically slower** on MAI-Voice-2 -- and slurred, because every engine garbles when pushed well below its natural rate. The second symptom was a consequence of the first, not a separate defect.

The cause is a category error in the original design: `speed` was treated as an absolute the way `scene_break_ms` is. It is not. Narration Settings are per BOOK, so switching engines silently changed what 0.85 *meant*, and MAI-Voice-2 at 1.0 already reads about where Kokoro sits at 0.85 -- the two slowdowns compounded.

`HostedModel.pace_baseline` now records how fast an engine is at `speed=1.0` on the reference scale (Kokoro, which every pace number in this app was tuned against). The backend divides by it, so each engine is asked for the same PERCEIVED rate, still snapped to the 0.05 grid that avoids the 1.08x lisp. MAI-Voice-2 is 0.85; everything else is 1.0 and passes through untouched, which is what keeps this from quietly retiming the engines that were already right.

The writer's pace setting is an **intent**. Turning that intent into a number a particular engine understands is the engine's job, not the writer's.

It is an ear estimate, not a measurement -- one float, easy to retune. And the re-scaling is stated on the engine card, because a silent change to speech rate is exactly the kind of invisible transform that reads as a bug when someone hears it.

##### MAI-Voice-2: demoted for not taking direction (live verdict)

Re-auditioned with the pace calibration in place, and the slurs went with it -- confirming they were a symptom of the pace bug rather than a defect. This is the one Standard candidate with **nothing wrong with the voice**. It came off the shelf for a different reason.

The verdict: MAI builds speech on its own engine and voice structure, so every `[pause]`, scene break and pace mark renders differently here than it did on the free narrator the writer formatted against. The markers are not ignored -- they are re-interpreted. Which is worse in a specific way: the writer hand-tuned those beats by ear on Kokoro, and MAI silently gives them a different reading. **Viable at the default narration settings with no inserts; misleading on a hand-formatted book.**

That is a genuinely different failure from the other two, and it names the third property a narration engine needs. The full list is now: **varying** delivery (Voxtral's welded mood went monotonous), **identity held across separate requests** (Grok re-improvises per segment), and **obedience to the writer's markup** (MAI re-interprets it). Only the third is invisible in a short audition, which is why it took a full chapter to surface.

All three Standard candidates are now demoted, so that tier is **empty on the recommended shelf**. The settings screen says so in as many words rather than leaving a silent gap between Budget and Pro -- an unexplained hole reads as a failed load, and papering over it with a reluctant pick would be worse than admitting the shortfall.

##### The seed question (PINNED 2026-08-01)

**Pinned by user direction at the close of Stage D.** The Standard tier ships empty and the hunt stops here -- everything below is the note to pick up from, not work in flight. Reopen it when there is a reason to (a new engine, a cheaper Pro option, or a writer asking for the tier); do not spend more auditions on it in passing.


OpenRouter's model metadata lists a `seed` parameter for Grok, Voxtral, Qwen and Kokoro, and NOT for MAI-Voice-2 or Aura-2. A seed held constant across every segment of a book is the obvious candidate cure for identity drift, since it pins the sampling draw that a performer model otherwise re-rolls per request.

It is unverified and was not built. Two reasons for caution: `supported_parameters` describes a model's chat-completions surface, and the OpenAI speech schema this endpoint imitates has no `seed` field at all -- so the gateway may drop it silently, or 400 on it mid-book. The test is cheap (one audition) and worth doing before anyone concludes a performer model cannot narrate long-form. If it works, it likely rehabilitates Grok and hardens Voxtral at the same time.

##### The Standard shortlist (researched July 2026, mostly unauditioned)

Three Standard candidates have now been auditioned and all three came off the shelf, so the remaining field is worth writing down rather than rediscovering. **NanoGPT has nothing in this band at all** -- its TTS catalog is Kokoro at $1/M and ElevenLabs Turbo at $60/M, so every candidate below is OpenRouter.

Ranked by what the three failures taught us: an engine needs a **varying** delivery (Voxtral's welded mood went monotonous) that nonetheless **holds identity across separate requests** (Grok's did not) and **reads the writer's markup the way the free narrator does** (MAI re-interprets it), plus enough voices to cast more than one book.

| Slug | $/M | Voices | Seed | Why it might work |
|---|---|---|---|---|
| `microsoft/mai-voice-2` | 22 | 4 (**1 English**) | no | **Being tested.** The only engine advertising stable speaker identity across long-form, and the fidelity variant rather than the latency one. |
| `qwen/qwen-audio-3.0-tts-plus` | 20 | 2 | yes | The vendor's stated narration-grade tier ("naturalness and timbre fidelity"), as against the Flash variant built for real-time agents. |
| `fish-audio/s2.1-pro` | 15 | not published | no | Well-regarded voice-cloning house; roster would need discovery. A free `:free` tier exists for zero-cost auditioning. |
| `sesame/csm-1b` | 7 | 7 | yes | A third of the price. Built for natural conversational speech, which may or may not survive as narration. |
| `canopylabs/orpheus-3b-0.1-ft` | 7 | 7 | yes | Same band, expressive-speech focus. |
| `zyphra/zonos-v0.1-hybrid` | 7 | 5 | yes | Same band; the hybrid is the more natural of the two Zonos builds. |
| `google/gemini-3.1-flash-tts-preview` | $1/M in + **$20/M out tokens** | 30 | yes | 30 voices and inline audio tags, but priced per TOKEN, so the estimator (Section 20) cannot quote a book exactly -- the one hard blocker, since quoting before spending is a locked rule. |

Note how many of these expose `seed` -- Grok, Qwen, Zonos, Orpheus, Sesame, Kokoro, Voxtral -- and how few do not (MAI-Voice-2, Aura-2). That makes the open seed question below worth settling: it would apply to most of this table at once.

##### Verified OpenRouter TTS catalog (July 2026, per million characters)

| Slug | $/M | Notes |
|---|---|---|
| `hexgrad/kokoro-82m` | 0.62 | 54 voices; identical to the local narrator. Budget tier. |
| `x-ai/grok-voice-tts-1.0` | 15 | 5 bare-name voices. Demoted -- prosody drift. |
| `microsoft/mai-voice-2-flash` | 15 | Microsoft's latency variant; positioned for IVR, not narration. |
| `qwen/qwen-audio-3.0-tts-flash` | 15 | Only 2 voices exposed by the gateway. The narration-grade "Plus" variant is not on OpenRouter. |
| `mistralai/voxtral-mini-tts-2603` | 16 | 30 voices, mood baked into the id. **Standard tier.** |
| `microsoft/mai-voice-2` | 22 | Advertises long-form speaker consistency, but the gateway exposes only ONE English voice (`en-US-Harper`) and no seed. Runner-up. |
| `deepgram/aura-2` | 30 | 86 voices, no tunable parameters at all. Pro tier. |
| `minimax/speech-2.8-turbo` | 60 | Not evaluated. |
| `minimax/speech-2.8-hd` | 100 | Not evaluated. |
| `google/gemini-3.1-flash-tts-preview` | $1/M in + $20/M out **tokens** | Priced per token, not per character, so the estimator (Section 20) cannot quote it exactly. Excluded on that basis alone. |

MAI-Voice-2 was written up here as the near-miss and has since been auditioned -- see the verdict above. Microsoft's claim of "stable, high-fidelity output that preserves speaker consistency across audiobooks" held up; it is the one candidate that does not fall apart between requests. It lost on markup fidelity instead, which no datasheet would have predicted. Two working voices (Harper, Olivia), both American female, is also thin for casting -- the concern this paragraph originally raised, just smaller than feared.

The provider abstraction must allow future providers without rewriting job logic.

### 13.2 Voice Selection Requirements

Quality framing: Kokoro is a modern neural voice -- natural and clearly human, not robotic. The difference premium hosted voices buy is NARRATION PERFORMANCE (emotional range, dramatic pacing, character energy), not basic humanness. Voice descriptions in the UI should reflect this honestly: "Free local narrator: natural, even read. Premium voices: performance narration."

The MVP should offer several male and female narrator choices. Kokoro ships with roughly 44 voices, so the floor below is a CURATION decision (which voices to feature), not an engineering constraint:

- 3 to 5 featured female voices
- 3 to 5 featured male voices
- A "show all voices" option for the full catalog

Where supported, voice metadata should include:

- Language
- Region
- Accent
- Gender presentation
- Age range
- Narration style
- Warmth
- Energy
- Dramatic versus neutral presentation

Not all providers or models will support all controls.

Unsupported controls should be disabled with a visible explanation.

### 13.3 Voice Capability Model

Suggested structure:

```json
{
  "voice_id": "af_heart",
  "display_name": "Heart",
  "provider": "local-kokoro",
  "model_id": "kokoro-82m",
  "language": "en-US",
  "accent": "American",
  "gender_presentation": "female",
  "age_range": null,
  "style": "neutral",
  "supports_speed": true,
  "supports_pitch": false,
  "supports_emotion": false
}
```

### 13.4 English-First Design

English should be the default language.

Do not hard-code the system in a way that prevents additional languages later.

Suggested project data:

```json
{
  "language": {
    "code": "en-US",
    "status": "supported"
  }
}
```

Future language states may include:

- Supported
- Experimental
- Unsupported

---

## 14. Local Kokoro Installation

Kokoro should be an optional download rather than part of the base installer.

### 14.1 Packaging Reality: a Separate Worker Executable

The Storythread backend ships as a frozen PyInstaller executable. A frozen executable CANNOT install Python packages into itself at runtime, so "optional local install" cannot mean downloading components into the existing backend.

The local engine is therefore a second, self-contained artifact:

- **`kokoro-worker.exe`** -- a small standalone frozen program bundling the ONNX inference runtime, the Kokoro model, and the English G2P components. Published as a GitHub release asset alongside the installer.
- Downloaded on demand by the component manager, with SHA256 verification against a checksum shipped in the app.
- Spawned and supervised as a subprocess by the backend sidecar, exposing a tiny local synthesis interface with a health check.
- Versioned independently; the release pipeline (`scripts/release.ps1`) gains a second artifact to build and sign.

### 14.2 What Ships in the Worker

There is no per-voice-pack selection. Kokoro voices are kilobyte-scale style vectors; ALL of them ship with the model at negligible cost. The heavy pieces are the model (roughly 80-350 MB) and the inference runtime. The install decision is a single action:

```text
[Install Free Local Narrator]  (~XXX MB, one download, all voices included)
```

Language packs remain the future splitting axis (additional languages may need additional G2P data and model variants).

Licensing note for Section 26's checklist: Kokoro's English G2P library (misaki) can fall back to espeak-ng, which is GPL-licensed -- a problem for a bundled proprietary-friendly distribution. The English-only MVP should use the misaki lexicon WITHOUT the espeak-ng fallback and log out-of-dictionary words instead.

### 14.3 First-Use Prompting

Prompt for local installation at meaningful moments:

1. First opening of Audiobook Converter
2. Opening voice selection with no configured provider
3. Requesting a preview without an available provider
4. Viewing a hosted cost estimate

Suggested prompt:

> No narration provider is currently available. Install the free local narrator or configure OpenRouter or NanoGPT.

Actions:

```text
[Install Free Local Narrator]
[Configure Cloud Provider]
[Not Now]
```

After the user chooses `Not Now`, do not display the same prompt every time the Audiobook Converter opens.

### 14.4 Local Component Manager

Example:

```text
Free Local Narration

☑ Kokoro English Engine (all voices included)

Status: Installed -- version 1.2
[Check for Engine Updates]
[Remove Local Engine]

Estimated Installed Size: Calculated Before Download
```

Exact sizes must be measured from the final Windows package. Because the hosted NanoGPT Kokoro voices are identical to the local ones, the voice-preview flow works BEFORE any local install: preview hosted for a fraction of a cent, then install locally to make generation free.

---

## 15. Local Processing: CPU Only

Kokoro-82M synthesizes roughly five times faster than realtime on a modern CPU. An 8-hour audiobook generates in under 2 hours with no GPU involved. GPU modes, hardware detection, and vendor-specific runtimes are therefore CUT from this feature -- they would add the project's worst risk category (driver compatibility, per-vendor runtimes, larger optional packages) to save time the CPU path does not meaningfully lose.

User-facing framing:

> Local generation runs on your CPU, faster than the audiobook plays. You may continue using Storythread while it runs.

### 15.1 Engine Prosody and the Usable Pace Band (live-testing findings, 2026-07-29)

Findings from extended listening tests, recorded so nobody re-litigates
them by ear later:

- **Engine prosody is out of scope.** Kokoro infers its own delivery
  (pace, inflection, emphasis) within each synthesized piece from the
  text's shape -- punctuation, sentence length, quoting. It sometimes
  races or drags passages on its own judgment, most visibly in dialogue.
  The pipeline's speeds were VERIFIED correct end to end (the preview
  render trace shows the exact speed per piece); the remaining variation
  lives inside the model and is not correctable from outside. Mitigations
  that exist: book-level narrator/dialogue pace, [pace] spans, and a
  [pause] before a racing stretch (segment boundaries reset prosody).
  Deeper correction is PINNED -- revisit only if a future engine build
  changes the behavior.
- **The usable pace band is roughly 0.8 to 1.2.** Outside it, the voice
  develops audibly robotic inflections (occasionally already at 0.85).
- **The engine wants 0.05-grid speeds.** A second round of listening
  tests (2026-07-30) isolated a faint sibilant slur ("lisp") to pieces
  synthesized at 1.08x -- the product of the old multiplier pace form
  (dialogue base 0.9 times a [pace:1.2] span). The same words were
  clean at 0.9, 1.0, 1.1, and 1.2. Every speed handed to the engine is
  therefore snapped to the nearest 0.05.
- **Mid-paragraph pauses use FLOW synthesis (2026-07-30).** Cutting text
  at a [pause] and synthesizing each fragment alone manufactures
  utterance endings: cold onset, stretched delivery ("A cult." became
  "Aahh Cuult"), and a breathy final release -- the audible pre-pause
  slur. No post-processing can fix it; the artifact is performed, not
  padded. The cure (verified by ear on real passages): a paragraph's
  pause-split fragment run synthesizes as ONE continuous render, and
  the writer's pauses are inserted INTO its natural sentence gaps at
  stitch time. Boundaries are located by a duration-calibrated matcher
  (each fragment's isolated duration bounds where its boundary can be;
  longest gap in the band wins; any doubt = fall back to per-fragment
  audio). Pause DURATIONS stay out of the audio and the payload hash,
  so retiming a pause never regenerates speech. Paragraph-boundary
  pauses still cut normally -- a real utterance ending is correct
  there. Implementation: `flow.py`, flow segments carry `fragments` /
  `internal_pauses` / `flow_cuts_ms`.
- **Pace markers use the STEP form: `[pace:+2]` / `[pace:-1]`.** Each
  step is 0.05 up or down from the book's base pace (Narrator or
  Dialogue pace, whichever applies to the segment), so a marked span
  always lands on a confirmed-clean speed. Results are capped to the
  0.8-1.2 band: a 1.2 base with `[pace:+5]` stays 1.2, and no stack of
  steps can reach crawl or chipmunk territory. A base deliberately set
  outside the band is respected but never exceeded by a marker. The
  toolbar presets Slow/Fast insert -2/+2 (a 0.10 swing); writers
  hand-edit to other step counts for finer or stronger moves. The
  legacy multiplier form (`[pace:0.8]`) still parses, snapped to the
  grid, so older narration files keep their meaning.

### 15.1.1 Worker 0.2 Candidate: Word-Level Timestamps (researched 2026-07-30)

Kokoro-FastAPI (remsky) demonstrates that the PYTORCH Kokoro pipeline
exposes per-word timestamps (its /dev/captioned_speech endpoint); the
ONNX build our worker wraps does not. Assessment against our needs:

- Its acclaimed "pause fixes" are silence-between-chunks plus
  aggressive whitespace stripping -- we already do both, and our flow
  synthesis goes further (it still cuts text at pause tags and
  synthesizes chunks in isolation, the exact manufactured-utterance-
  ending defect flow synthesis eliminates). Not worth adopting as a
  server; it would replace our worker with a heavier one we control
  less.
- The timestamps ARE valuable: they would replace flow synthesis's
  duration-band gap matcher with EXACT word boundaries, and make
  short-utterance previews cuttable out of carrier phrases precisely.
- Cost: switching the worker from kokoro-onnx to PyTorch kokoro
  roughly doubles-to-triples the installed artifact (torch CPU). A
  worker 0.2 decision to weigh alongside Stage D, not before.

### 15.2 Future Note

If GPU acceleration is ever revisited, `onnxruntime-directml` is the single Windows-native path covering NVIDIA, AMD, and Intel hardware together -- not three separate vendor runtimes. Keep the synthesis interface device-agnostic so that door stays open:

```python
class LocalSpeechBackend:
    async def synthesize(
        self,
        text: str,
        voice_id: str,
        speed: float,
    ) -> bytes:
        ...
```

---

## 16. Cloud Provider Architecture

OpenRouter and NanoGPT should be handled as speech providers rather than ordinary writing models.

The application should have separate categories:

```text
Writing Models
Audio Models
```

### 16.1 Provider Interface

Suggested normalized interface:

```python
class AudiobookTTSProvider:
    async def discover_models(self) -> list["SpeechModel"]:
        ...

    async def discover_voices(
        self,
        model_id: str,
        language: str,
    ) -> list["SpeechVoice"]:
        ...

    async def generate_preview(
        self,
        request: "PreviewRequest",
    ) -> "GeneratedAudio":
        ...

    async def generate_segment(
        self,
        request: "SegmentRequest",
    ) -> "GeneratedAudio":
        ...

    async def get_remote_job_status(
        self,
        remote_job_id: str,
    ) -> "RemoteJobStatus":
        ...

    async def cancel_remote_job(
        self,
        remote_job_id: str,
    ) -> None:
        ...
```

The remote-job methods map directly onto NanoGPT's asynchronous TTS endpoint (submit a ticket, poll status, cancel). Providers with synchronous-only endpoints (including the local engine) simply no-op them.

Implementation note: the audiobook provider registry should reuse the existing per-provider plumbing from the writing side -- stored API keys, the per-provider Settings panels, and the provider-templated error translation -- rather than duplicating any of it. The same OpenRouter or NanoGPT key serves both the writing models and the audio models.

### 16.2 Dynamic Discovery: Models Yes, Voices Mostly No

Hosted audio MODEL lists, capabilities, and pricing should be retrieved dynamically whenever the provider supports it, cached locally, and refreshed periodically.

VOICE catalogs are a different story: TTS providers generally do not expose a voice-discovery API -- voice lists are static per model. Plan for curated static voice catalogs shipped with the app (feeding the Section 13.3 capability records), updated with app releases, with dynamic discovery layered on wherever a provider actually offers it.

### 16.3 API Key Security

- Store API keys using the application's existing secure settings mechanism.
- Never write API keys to project manifests.
- Never write API keys to logs.
- Never include API keys in exported project folders.

---

## 17. Step 5: Metadata

Provide a dedicated metadata dialog or wizard step.

### 17.1 Metadata Fields

- Title
- Subtitle
- Author
- Narrator
- Series
- Series Number
- Description
- Genre
- Publication Year
- Publisher
- Copyright
- Language
- Cover Image

### 17.2 Metadata Options

```text
☑ Use chapter names as chapter markers
☑ Embed cover image
☑ Apply metadata to chapter MP3 files
```

### 17.3 Cover Image Validation

- JPG or PNG
- Square image recommended
- Reasonable file-size limit
- Preview before export
- Center-fit or crop option

---

## 18. Step 6: Voice Preview

The user should be able to generate short previews before full generation.

### 18.1 Preview Sources

- Standard sample text supplied by Storythread
- Selected manuscript passage
- User-entered sample
- Pronunciation test passage

### 18.2 Preview Requirements

- Show provider
- Show model
- Show voice
- Show estimated hosted cost before generation
- Show character count
- Show generated duration
- Allow regeneration
- Allow side-by-side voice comparison

Example:

```text
Voice A    [Play]
Voice B    [Play]
Voice C    [Play]
```

Local previews are free.

Hosted previews should require confirmation when they have a cost.

Playback scope note: previews (and spot-checking generated chapters) require basic audio playback -- play, pause, seek -- inside the app. That is IN scope for the MVP. The deferred item in Section 3.2 is a full audiobook player with listening-position memory, not basic playback.

### 18.3 The Audible Help Standard

Established during Stage B live testing (2026-07-29) and now the rule for
every feature that changes how audio SOUNDS: explain it with a "Hear it"
demo, not just prose.

- Demos are RENDERED LIVE through the real pipeline (parse -> synthesize
  -> stitch), never shipped as recordings -- when defaults or the engine
  change, the demos change with them.
- Demos use the default reference voice so every writer hears the same
  thing, run on the local engine, and carry a faded "local / free" hint
  (writers trained by metered AI need to know sampling costs nothing).
- Demo scripts NARRATE what the listener is experiencing ("that gap was a
  pause marker set to one and a half seconds") so no reading is required.
- Script respellings and examples are tuned BY LISTENING against the live
  engine, never by what reads best on paper (live lesson: HEY-zeus read
  as "Zeheus"; Hay-SOOS is correct). Demo words must produce a contrast
  the engine cannot out-improve -- prefer names where several readings
  are RIGHT and the story picks one (Jesus/Hay-SOOS, the regional Laras)
  over words the engine merely fails today.
- Demo playback is click-to-pause/resume; rendered demos are cached
  backend-side per engine version so the first play is the only slow one.
- Future candidates: voice-picker comparisons, mastering/loudness
  settings, pause-default changes.

Noted for later (not a redesign now): streaming demo/preview audio --
begin playback while later pieces are still synthesizing. Requires
chunked WAV streaming from the worker through the backend to the player;
backend-side demo caching covers most of the pain meanwhile.

### 18.4 Guided Insert Walkthrough (user-designed 2026-07-30; first build shipped)

Shipped in the first build (`insertScan.ts` + `InsertWalkthrough.tsx`):
the [Walkthrough] toolbar button walks from the cursor with five trigger
kinds -- narration-to-dialogue (inline and paragraph hand-offs),
dialogue-to-narration, short-sentence beats, interjections, and
malformed-marker repair (the [pace:=2] / unclosed-[pause linter) -- each
kind muteable, Apply/Skip/Back with Ctrl+Enter / Ctrl+Right / Ctrl+Left /
Esc, edits landing in the buffer like typing (manual save owns
persistence), and stops suppressed wherever the writer already placed a
pause. Remaining catalog below stays open for follow-up builds
(paragraph endings, speaker alternation, scene-transition prose,
emphasis candidates, per-stop audible demo links).

An advanced find/insert overlay for the narration editor: the writer
opens it at the cursor and it WALKS the manuscript downward, stopping at
each spot where a marker insert could improve the narration. At every
stop the writer picks an insert type, adjusts it, or skips. Rationale:
Kokoro transitions instantly from scene narration into dialogue and
misses the small intentional beats a human reader adds ("From Ruins to
Relics. I read it. The Cambodia chapter. My god! That tomb door.").

Trigger points (initial catalog; each individually toggleable):

- Narration-to-dialogue transitions (a paragraph or sentence run ends
  and a quoted speech begins) -- offer [pause] before the dialogue.
- Dialogue-to-narration returns -- offer [pause] after the closing quote.
- Short-sentence bursts (2+ consecutive sentences under ~25 characters)
  -- offer small [pause] beats between them.
- Paragraph endings without any trailing marker -- offer [pause].
- Interjections and exclamations ("My god!", "No.") -- offer a beat
  before, after, or both.
- Speaker alternation in dialogue runs (quote paragraph following a
  quote paragraph) -- offer a beat for the turn-taking rhythm.
- Scene-transition prose (blank-line clusters, time-skip phrases like
  "Later that night") -- offer [scene-break] instead of a plain pause.
- Emphasis candidates inside dialogue (italics in the source, ALL CAPS
  words) -- offer a [pace] step span or a [say] override.
- Malformed-marker repair: anything the parser warns about ([pace:=2],
  an unclosed [pause:0.4 ...) surfaces as a stop with a one-click fix --
  the walkthrough doubles as the marker linter.

UX contract: modeless overlay pinned above the editor; Next/Skip/Apply
keyboard-first; each stop shows the sentence in context with the
proposed insert rendered inline; Apply edits the narration copy exactly
like typing (manual save still owns persistence); a per-session "don't
suggest this trigger again" mute; progress indicator (stop N of M in
this chapter). Every insert type links its audible demo (18.3).

### 18.5 Respelling Doctrine (ear-tested by the user, 2026-07-30)

The vetted rules for [say] and Pronunciation spoken forms, established
by live listening tests and encoded in the say popout's tips accordion
(one section open at a time). Preview is always the final judge.

- **Lowercase is the rule; a single capital is a dial.** One capital
  changes a word's inflection (Hey-soos, hey-soos, and hey-Soos all
  land differently). Runs of 2+ capitals are folded by the app -- the
  engine reads caps runs as letters (bare-word measurement: LARah
  0.92s beside the "L A R ah" letter baseline 0.98s vs larah 0.72s).
- **Separation strength, strongest to softest:** SPACE (near two
  words), HYPHEN (syllable-like units of one word; the app fuses them
  so no hesitation gap), APOSTROPHE (the softest internal break --
  Hey'soos lands gentler than Hey-soos; works on most voices, not all).
- **The vowel-sound alphabet (silent h):** ah = father, eh = bed,
  ih = sit, oh = go, uh = unstressed, oo = food. Three Laras from
  three vowel choices: lah-rah / lah-ruh / lar-uh.
- **Double vowels lengthen:** laa-rah, lee-ah, koo-per, ree-na.
- **Characters to avoid:** underscores, asterisks, quotes, slashes,
  parentheses (letters pronounce separately, symbols get spoken,
  unnatural pauses, engine chunk-splits, markdown stripping
  downstream). Accented characters: a few work, most do not.

---

## 19. Step 7: Generation Review

Before generation begins, display a complete summary.

Example:

```text
Selected Chapters: 18 of 21
Provider: Local Kokoro
Voice: American Female -- Heart
Output: Chapter MP3 + Combined MP3 + M4B
Estimated Audio Duration: 8 hr 17 min
Estimated Generation Time: Calculated After Startup
Estimated Cloud Cost: $0.00
Intermediate Files: Keep Until Deleted
```

Actions:

```text
[Back]
[Generate Audiobook]
```

---

## 20. Cost and Duration Estimates

Before hosted generation, show:

- Manuscript word count
- Manuscript character count
- Selected chapter character count
- Estimated narration duration
- Estimated provider requests
- Estimated provider cost
- Estimated output size
- Existing generated segments
- Remaining estimated cost

Example:

```text
Selected Characters: 487,300
Estimated Duration: 9 hr 42 min
Estimated Requests: 430
Estimated Provider Cost: $X.XX
Estimated Output Storage: X.X GB
```

(Request count assumes paragraph-level segments averaging roughly 1,100 characters -- see Section 23. Reference price points, July 2026: this manuscript costs about $0.49 on NanoGPT-hosted Kokoro and about $29 on ElevenLabs Turbo. The estimator matters most for premium print passes.)

Include a warning:

> Regenerated sections may create additional provider charges.

Pricing should be retrieved from provider data when available.

### 20.1 Retries and Billing Pessimism

A hosted request that times out client-side may still have billed
server-side. Rules:

- Automatic retries are CAPPED: at most 2 automatic retries per segment
  for timeouts and 5xx errors, with backoff. Content refusals get ZERO
  automatic retries (Section 28.4). After the cap, the segment is Failed
  and waits for a manual retry.
- The cost tracker counts PESSIMISTICALLY: every attempt is assumed
  billed until actual provider usage data proves otherwise. The
  `attempts` counter on each segment record is the input.
- The completion report shows attempts alongside cost so surprise
  overruns are visible, not buried.

### 20.2 Disk Preflight

Estimating output storage is not enough -- check it. At Generate (and
again at every Resume), verify free space on the workspace drive covers
the estimated intermediates plus outputs plus a 20 percent margin. Block
with a clear message when it does not:

> This audiobook needs an estimated 3.4 GB free on drive D: and only
> 1.1 GB is available. Free up space or choose a different workspace
> drive before generating.

Running out of disk mid-run remains a handled error (Section 29), but
preflight makes it rare.

---

## 21. Background Generation

Generation should continue while the writer uses Storythread Studio's writing features.

Honest scope: the generation engine lives in the backend sidecar, and the sidecar shuts down with the app window (deliberate lifecycle behavior since v1.0.1). "Background" therefore means WHILE STORYTHREAD IS OPEN. Closing the app pauses generation; restart recovery (21.2) resumes it on next launch. Closing during an active run must show a confirmation:

> Audiobook generation is running. Closing Storythread will pause it; it will offer to resume next time you open the app.

While a run is active, the app should also inhibit Windows sleep (the standard execution-state request), releasing it when the run pauses, completes, or fails. A laptop lid-close is the most likely real-world interruption of a two-hour generation.

### 21.1 Global Progress Indicator

Example:

```text
Audiobook: Chapter 8 of 31 | 27% | About 1h 18m remaining
```

Actions:

- View Details
- Pause
- Resume
- Cancel After Current Segment
- Open Output Folder

### 21.2 Restart Recovery

Generation must resume after Storythread is closed and reopened.

The application should persist state after every completed segment.

### 21.3 ETA Calculation

Initial display:

```text
Calculating estimated time...
```

After sufficient completed segments:

```text
Approximately 47 minutes remaining
```

Use a rolling average based on:

- Recent provider request duration
- Recent local synthesis duration
- Segment character count
- Remaining segment count
- Estimated final assembly duration

Do not show false precision when the estimate is unstable.

---

## 22. Job and Chapter Statuses

### 22.1 Audiobook Project Statuses

- Draft
- Importing
- Needs Review
- Ready
- Generating
- Paused
- Partially Completed
- Completed
- Completed with Warnings
- Failed
- Export Only

### 22.2 Chapter Statuses

- Excluded
- Ready
- Queued
- Generating
- Completed
- Outdated
- Partially Outdated
- Failed
- Cancelled

### 22.3 Segment Statuses

- Pending
- Queued
- Generating
- Completed
- Outdated
- Failed
- Cancelled
- Superseded

---

## 23. Segmentation and Resume Design

A full manuscript should never be sent as one request.

The segmentation hierarchy should be:

```text
Audiobook
└── Chapter
    └── Scene
        └── Paragraph
            └── Segment
```

Segments should respect:

- Sentence boundaries
- Paragraph boundaries
- Scene boundaries
- Chapter boundaries
- Provider character limits
- Provider token limits
- Provider audio-duration limits

Segment sizing target: PARAGRAPH-LEVEL segments of roughly 800 to 1,500 characters, falling back to sentence splits only when a paragraph exceeds a provider limit. Compared to sentence-level segmentation this gives three to five times fewer requests, better prosody continuity within a paragraph, and fewer audible joins. A 487,300-character manuscript yields roughly 430 segments, not 1,600+.

Intermediate format note: segments may be stored as FLAC instead of WAV to halve disk usage losslessly (WAV at 24 kHz mono runs roughly 170 MB per audio hour).

### 23.1 Segment Identity Survives Editing

Segment IDs are STABLE RANDOM IDs, never positional. A positional scheme
(segment-0012 = the twelfth segment) breaks the moment a writer inserts
one paragraph mid-chapter: every downstream segment shifts, every
downstream hash mismatches, and audio that did not change gets flagged --
or worse, regenerated at cost. (Design decision 2026-07-28.)

Rules:

- `segment_id` is a short random ID assigned when a segment first exists
  (e.g. `seg-4f2a9c1e`). Audio files are named BY ID:
  `generated-segments/<chapter-id>/<segment_id>.flac`.
- Reading order lives in the chapter's ordered segment list, not in the
  ID or the filename.
- **Re-segmentation matches by content, not position.** When the narration
  text changes and the segmenter re-runs a chapter:
  1. Compute content hashes for the new segment texts.
  2. Match new segments to existing ones by longest common subsequence
     over content hashes (order-preserving; duplicate hashes resolve in
     order).
  3. Matched segments KEEP their segment_id, their generated audio, and
     their generated hash -- unchanged paragraphs stay current.
  4. Unmatched new segments get fresh IDs (status: not generated).
  5. Unmatched old segments are marked superseded; their audio is retained
     until cleanup.

Net effect: inserting one paragraph produces exactly ONE new segment to
generate, not a cascade to the end of the chapter.

Example:

```json
{
  "segment_id": "seg-4f2a9c1e",
  "chapter_id": "chapter-003",
  "speaker_id": "narrator",
  "text": "The road disappeared beneath the gathering snow.",
  "content_hash": "sha256-current",
  "generated_hash": "sha256-generated",
  "provider": "local-kokoro",
  "model": "kokoro-82m",
  "engine_version": "kokoro-worker 1.2",
  "voice_id": "af_heart",
  "status": "completed",
  "attempts": 1,
  "duration_seconds": 18.4,
  "output_file": "generated-segments/chapter-003/seg-4f2a9c1e.flac"
}
```

---

## 24. Detecting Outdated Audio

Use automatic outdated detection but never automatic paid regeneration.

### 24.1 Hash Inputs

The generated-state hash should include:

- Narration text
- Marker POSITIONS (they define segment boundaries)
- Pronunciation rules that apply to this segment's text
- Speaker assignment
- Voice
- Provider
- Model
- **Engine/worker version** (e.g. kokoro-worker 1.3) -- a retrained model
  in a new worker build produces different audio from identical text, so
  identical hashes must not claim identical audio. A worker upgrade
  marking local audio stale is correct behavior.
- **Verbalizer version** (Section 11.4) -- improved number/abbreviation
  expansion changes the payload, therefore the audio.
- Relevant speech settings, captured as the EFFECTIVE per-segment values at generation time

Two deliberate exclusions:

- Pause and break DURATIONS are excluded -- silence is inserted at assembly time (Section 10.3), so retiming pauses never marks audio stale.
- Global settings are never hashed directly. Hash the effective values that actually applied to the segment; otherwise changing a global default (for example the scene-break duration) would falsely mark the entire library outdated.

### 24.2 Status Behavior

Example:

```text
Chapter 1    Current
Chapter 2    Audio Outdated
Chapter 3    Partially Outdated
Chapter 4    Not Generated
```

Segment-level markers:

```text
✓ Matches generated audio
● Modified since generation
○ No audio generated
```

#### Build note (Stage E): reading freshness without an engine

The rail needs to say "Chapter 2 is outdated" on every workspace open, which rules out spawning the local worker or contacting a paid engine to compute it. The way out: a completed segment already records the engine that made it (`provider`, `model`, `engine_version`, `voice_id`), so its own basis can be recomputed from what is stored. That answers the question the writer actually asks -- *has anything changed since this was narrated?* -- with no engine present at all.

Two consequences worth knowing:
- A **voice change is checked first and separately**, because it is the print pass. Every segment is outdated at once, and "the voice changed" explains a whole-book requeue far better than "the text moved". The chapter rollup carries that reason up.
- **Draft audio is current for a draft and stale for a real pass.** The basis is recomputed both ways; matching the draft form reports `current` with a draft marker rather than a bare `current`, so a draft can be seen without being mistaken for finished.

Audio generated before `payload_hash` existed has nothing to compare against and is treated as current -- nagging a writer to re-narrate a book that is probably fine is the worse error.

### 24.3 User Reminder

> Chapter 2 contains 4 edited sections that are not reflected in the current audio.

Actions:

```text
[View Changes]
[Regenerate Changed Sections]
[Keep Existing Audio]
```

### 24.4 Regeneration Rule

- Never regenerate automatically.
- Never spend provider funds without explicit user action.
- Generate changed segments into a new revision.
- Verify successful chapter assembly.
- Replace the active chapter output only after verification.
- Retain or mark the previous output as superseded until cleanup.

---

## 25. Intermediate Audio Retention

Intermediate segment files should be retained by default.

Benefits:

- Resume support
- Retry support
- Changed-section regeneration
- Chapter reassembly
- Combined MP3 reassembly
- M4B reassembly
- Exporting at a different bitrate
- Recovery after assembly failure
- Avoiding duplicate hosted generation charges

### 25.1 Retention Options

```text
Intermediate Audio

● Keep until I delete it
○ Delete after successful final export
○ Ask after final export
```

Default:

```text
Keep until I delete it
```

### 25.2 Completion Prompt

```text
Audiobook export completed.

Intermediate generation files use 2.8 GB.
Keeping them allows fast repairs and re-exporting without generating speech again.

[Keep Files]
[Delete Segment Files]
[Review Storage]
```

#### Build notes (Stage E, 2026-08-01)

Three decisions the implementation settled that the section above leaves open.

**Superseded audio is found by LEFTOVER, not by the superseded list.** Any audio file under `generated-segments/` that no live segment claims and that is not a `.rejected` take is treated as superseded. Classifying by the manifest's list alone would make files orphaned by an older build -- or by a manifest that lost a record -- invisible forever and therefore unreclaimable.

**Deleting current segments resets those records to not-generated.** Otherwise `segments.json` keeps claiming `status: completed` for audio that no longer exists, and the app offers an export it cannot produce. Only the generated-state fields are cleared; `segment_id`, the text, and every formatting field survive, so identity (and the writer's markers) are untouched.

**`segments.json` is never a deletion candidate under any category.** Losing segment audio costs a re-render. Losing that file costs the writer their formatting -- a categorically different loss, and the reason the file is excluded from the walk rather than merely left unchecked.

Defaults follow from the asymmetry that deleting is instant and permanent while regenerating costs time and, on a hosted engine, money: only previews and failed attempts are pre-checked. The exports and the manuscript snapshot are additionally marked `protected`, which the UI renders in a stronger colour and which can never be pre-checked.

### 25.3 Cleanup Categories

```text
☐ Preview files
☐ Failed generation attempts
☐ Superseded audio revisions
☐ Current segment files
☐ Extracted manuscript snapshots
☐ Final MP3 and M4B exports
```

Final exports must not be selected by default.

If segment files are deleted while final output remains, set project status to:

```text
Export Only
```

Suggested explanation:

> Individual sections can no longer be regenerated or reassembled without generating the narration again.

---

## 26. Audio Assembly

FFmpeg or an equivalent audio-processing library will be required for final assembly.

Required operations:

- Concatenate segments
- Concatenate chapters
- Insert chapter silence
- Insert scene-break silence
- Normalize to the mastering targets below
- Create chapter MP3s
- Create combined MP3
- Create M4B
- Add chapter markers
- Add title and author metadata
- Add narrator metadata
- Embed cover art
- Re-export from retained segments

### 26.1 Canonical Intermediate Format

Mixed-provider audio inside one chapter is GUARANTEED, not an edge case:
Section 28.4 explicitly routes refused hosted segments to local
regeneration, so Kokoro 24 kHz mono output will legitimately sit next to
44.1 kHz premium output. The fix is decided once, at ingest:

Every generated segment -- regardless of provider -- is transcoded ON
RECEIPT to one canonical intermediate:

```text
44,100 Hz  |  mono  |  16-bit  |  FLAC
```

Assembly therefore only ever concatenates identical formats. FLAC keeps
the intermediate lossless at roughly half of WAV's disk cost; 44.1 kHz is
the distribution rate (upsampling Kokoro's 24 kHz on receipt is harmless
and done exactly once).

### 26.2 Mastering Targets (ACX-Safe)

Loudness normalization runs PER CHAPTER (two-pass FFmpeg loudnorm) so
chapters match each other and segment-level joins do not pump:

```text
Integrated loudness:  -20 LUFS
True peak ceiling:    -3.0 dBTP
```

These land inside ACX/Audible's requirements (-23 to -18 dB RMS, -3 dB
peak), so output is distribution-safe from day one even though ACX
submission is not itself an MVP feature.

Output encodes:

```text
Chapter MP3 / combined MP3:  192 kbps CBR, 44.1 kHz (the ACX spec)
M4B:                         AAC 128 kbps, 44.1 kHz, chapter markers
```

### 26.3 Segment Audio Validation

`audio/validation.py` has defined behavior, not just a name. Kokoro is
known to occasionally truncate long inputs SILENTLY -- a segment that
"succeeded" but contains half the text must become a Failed segment at
generation time, not a discovered-at-chapter-30 surprise.

Checks on every generated segment, local and hosted:

- Decodable at all; not zero bytes.
- **Duration-per-character sanity check**: expected duration is estimated
  from the payload character count at typical narration pace (roughly
  1,000 characters per minute). If actual duration is under 60 percent of
  expected (for segments whose expected duration exceeds 2 seconds), the
  segment is marked Failed with reason "audio shorter than expected
  (possible truncation)".
- Failed-validation audio is kept on disk for inspection but never enters
  assembly.

### 26.4 Chapter File Naming and Tags

Chapter MP3s follow one template -- unspecified naming means inconsistent
naming:

```text
NN - Chapter Title.mp3       (NN zero-padded to the book's chapter count width, minimum 2)
```

Chapter titles pass through the Section 8.1 filename sanitizer. ID3v2
tags on every chapter MP3:

- Track number / total tracks
- Title = chapter title
- Album = book title
- Artist = author
- Composer = narrator (the common audiobook convention)
- Cover art embedded when "Apply metadata to chapter MP3 files" is checked

FFmpeg packaging and license compliance must be reviewed before release.

Prefer an LGPL-compatible Windows build when technically suitable.

Document:

- Bundled version
- Source location
- License
- Included codecs
- Redistribution notices

License checklist additions beyond FFmpeg:

- Kokoro-82M model: Apache 2.0 (commercial use permitted).
- misaki (English G2P): usable, BUT its espeak-ng fallback is GPL. The English MVP must ship misaki's lexicon WITHOUT the espeak-ng fallback (log out-of-dictionary words instead) to avoid GPL obligations in the bundled worker.
- ONNX inference runtime: MIT (fine).
- All licenses and notices for the kokoro-worker artifact must be documented alongside the FFmpeg notices.

---

## 27. Future Multiple-Character Narration

The MVP will use one narrator per generation run, but every segment must reference a speaker from the beginning.

### 27.1 MVP Speaker Structure

```json
{
  "speakers": [
    {
      "speaker_id": "narrator",
      "display_name": "Narrator",
      "role": "narrator",
      "provider": "local-kokoro",
      "model": "kokoro-82m",
      "voice_id": "af_heart"
    }
  ]
}
```

Every MVP segment uses:

```json
{
  "speaker_id": "narrator"
}
```

### 27.2 Future Speaker Structure

```json
{
  "speakers": [
    {
      "speaker_id": "narrator",
      "display_name": "Narrator",
      "role": "narrator",
      "voice_id": "af_heart"
    },
    {
      "speaker_id": "character-elena",
      "display_name": "Elena",
      "role": "character",
      "voice_id": "bf_emma"
    },
    {
      "speaker_id": "character-marcus",
      "display_name": "Marcus",
      "role": "character",
      "voice_id": "am_adam"
    }
  ]
}
```

### 27.3 Future AI Narration Analysis

Future workflow:

```text
Original narration copy
        ↓
AI narration analysis
        ↓
Proposed speaker and pause annotations
        ↓
Writer review
        ↓
Approved narration script
        ↓
Speaker-to-voice assignment
        ↓
Audio generation
```

AI may propose:

- Dialogue speakers
- Narrator versus character passages
- Scene breaks
- Pause locations
- Emotional direction
- Pronunciation candidates
- Emphasis candidates

The AI pass must never silently overwrite the narration copy.

The writer must review proposed annotations.

Example:

```text
AI Detected Speaker: Elena
Confidence: 86%

“This cannot continue,” she said.

[Accept]
[Change Speaker]
[Keep Narrator]
```

Low-confidence speaker assignments should require explicit review.

---

## 28. Safety, Rights, and Misuse Controls

### 28.1 Required User Confirmations

Before generation, the user should confirm:

- They own the manuscript or have permission to convert it.
- They understand that hosted providers receive the selected manuscript text.
- They understand that AI-generated audio may require disclosure.
- They are responsible for commercial-use rights.
- They are responsible for platform-specific rules.
- They are responsible for selected voice-license terms.

### 28.2 Initial Restrictions

Exclude in the MVP:

- Celebrity voice presets
- Public-figure impersonation
- Arbitrary voice cloning
- Uploading another person's voice
- Voice labels that imply a real person's identity
- Automated ownership claims
- Automated commercial-use certification

### 28.3 AI Disclosure

Where required by the selected provider or platform, Storythread should make it easy to identify output as AI-generated narration.

Possible metadata field:

```text
Narration Type: AI-Generated Voice
```

### 28.4 Explicit and Mature Content Narration

Storythread supports mature and explicit content modes for writing. Narration adds a wrinkle: hosted TTS providers apply their own content moderation and may REFUSE explicit passages -- potentially partway through a paid run.

Rules:

- The local Kokoro engine applies no content moderation. For mature/explicit manuscripts, the UI should recommend the local narration path up front.
- A hosted provider content refusal must be handled at SEGMENT level: mark the segment failed with a clear reason, skip it, continue the run, and report all refused segments at the end. A refusal must never kill or silently corrupt a run.
- The cost side matters too: refused segments should not be retried automatically (each retry may bill), and the completion report should state what was refused so the writer can regenerate those sections locally.

### 28.5 YouTube and Publishing

Storythread may create the audio file, but the user remains responsible for:

- Copyright ownership
- Narration rights
- Provider commercial-use terms
- Voice-license terms
- AI-disclosure rules
- Platform rules
- Monetization eligibility

---

## 29. Error Handling

The system should handle:

- Unsupported document format
- Scanned PDF without extractable text
- Corrupt source document
- Failed chapter detection
- Missing provider key
- Invalid provider key
- Insufficient provider funds
- Provider rate limiting
- Provider timeout
- Provider outage
- Provider content refusal (explicit passages; segment-level skip-and-report, see 28.4)
- Invalid model response
- Empty audio response
- Audio failed validation (truncation suspected -- see 26.3)
- Automatic retry cap reached (see 20.1)
- Workspace locked by another instance (see 8.2)
- Local worker download failure or checksum mismatch
- Local worker installation failure
- Local worker startup or health-check failure
- Disk-space shortage
- Audio assembly failure
- Metadata write failure
- User cancellation
- Application shutdown
- Windows sleep or laptop lid-close during generation
- Windows restart

Timeout note: TTS segment requests need their own short per-request timeout with retry, tuned to segment size. Do not inherit the writing chat path's long request timeout; a stuck segment should fail fast and retry rather than stall the whole run.

Every recoverable failure should preserve completed segments.

---

## 30. Progress and Logging

### 30.1 Progress Data

Track:

- Current chapter
- Current segment
- Completed chapters
- Completed segments
- Queued chapters
- Failed segments
- Total selected characters
- Completed characters
- Elapsed time
- Estimated remaining time
- Current provider
- Current model
- Current voice
- Estimated cost
- Actual provider usage when available

### 30.2 Log Privacy

Logs must not contain:

- API keys
- Authentication headers
- Full manuscript text by default
- Full generated provider payloads by default

Logs may contain:

- Segment IDs
- Chapter IDs
- Character counts
- Provider status codes
- Sanitized error messages
- Timing information
- File paths where appropriate

---

## 31. Suggested Core Data Model

### 31.1 Audiobook Project

```json
{
  "project_id": "uuid",
  "schema_version": 1,
  "title": "The Hollow Road",
  "author": "Author Name",
  "workspace_path": "C:/Users/User/Documents/Audiobooks/The Hollow Road",
  "source_file": "source/original-manuscript.docx",
  "language": "en-US",
  "status": "ready",
  "created_at": "2026-07-28T12:00:00Z",
  "updated_at": "2026-07-28T12:00:00Z",
  "selected_provider": "local-kokoro",
  "selected_model": "kokoro-82m",
  "selected_voice": "af_heart",
  "output_formats": ["chapter_mp3", "combined_mp3", "m4b"],
  "retain_intermediate_audio": true
}
```

### 31.2 Chapter

```json
{
  "chapter_id": "chapter-003",
  "title": "Chapter Three",
  "order": 3,
  "selected_for_generation": true,
  "status": "partially_outdated",
  "current_hash": "sha256-current",
  "generated_hash": "sha256-generated",
  "segments": [
    "seg-4f2a9c1e",
    "seg-b81d0e77"
  ]
}
```

### 31.3 Segment

```json
{
  "segment_id": "seg-4f2a9c1e",
  "chapter_id": "chapter-003",
  "speaker_id": "narrator",
  "text": "The road disappeared beneath the gathering snow.",
  "content_hash": "sha256-current",
  "generated_hash": "sha256-generated",
  "provider": "local-kokoro",
  "model": "kokoro-82m",
  "engine_version": "kokoro-worker 1.2",
  "voice_id": "af_heart",
  "status": "completed",
  "attempts": 1,
  "duration_seconds": 18.4,
  "output_file": "generated-segments/chapter-003/seg-4f2a9c1e.flac"
}
```

### 31.4 Generation Run

```json
{
  "run_id": "uuid",
  "project_id": "uuid",
  "status": "generating",
  "selected_chapters": ["chapter-001", "chapter-002", "chapter-004"],
  "provider": "local-kokoro",
  "model": "kokoro-82m",
  "voice_id": "af_heart",
  "started_at": "2026-07-28T12:00:00Z",
  "paused_at": null,
  "completed_at": null,
  "estimated_cost_usd": 0.0,
  "actual_cost_usd": 0.0
}
```

---

## 32. Recommended Technical Modules

Suggested backend modules:

```text
backend/app/audiobook/
├── __init__.py
├── models.py
├── schemas.py
├── project_service.py
├── import_service.py
├── extraction/
│   ├── docx_extractor.py
│   ├── epub_extractor.py
│   ├── markdown_extractor.py
│   ├── text_extractor.py
│   ├── storythread_project_extractor.py
│   └── pdf_extractor.py          (deferred phase)
├── narration/
│   ├── segmenter.py
│   ├── marker_parser.py
│   ├── pronunciation.py
│   ├── hashing.py
│   └── stale_detection.py
├── providers/
│   ├── base.py
│   ├── openrouter.py
│   ├── nanogpt.py
│   └── local_kokoro.py
├── generation/
│   ├── job_manager.py
│   ├── chapter_queue.py
│   ├── progress.py
│   ├── recovery.py
│   └── cost_estimator.py
├── audio/
│   ├── assembler.py
│   ├── ffmpeg_service.py
│   ├── metadata.py
│   └── validation.py
└── routes.py
```

Suggested frontend modules (note: the repo's frontend root is `app/src/`, not `frontend/src/`):

```text
app/src/features/audiobook/
├── api/
├── components/
├── hooks/
├── pages/
│   ├── AudiobookDashboard.tsx
│   ├── AudiobookWizard.tsx
│   ├── AudiobookJobDetails.tsx
│   └── AudiobookSettings.tsx
├── wizard/
│   ├── ImportStep.tsx
│   ├── ReviewEditStep.tsx
│   ├── ChaptersStep.tsx
│   ├── VoiceStep.tsx
│   ├── MetadataStep.tsx
│   ├── PreviewStep.tsx
│   └── GenerateStep.tsx
├── editor/
│   ├── NarrationEditor.tsx
│   ├── NarrationToolbar.tsx
│   ├── PauseMarker.tsx
│   └── PronunciationDialog.tsx
├── generation/
│   ├── GlobalAudiobookProgress.tsx
│   ├── ChapterQueue.tsx
│   └── GenerationStatus.tsx
├── local-tts/
│   └── LocalVoiceManager.tsx
└── types.ts
```

### 32.1 Existing Code to Reuse

The converter should lean on infrastructure that already exists rather than duplicating it:

- `python-docx` and `ebooklib` are already backend dependencies (used by the export feature) -- DOCX and EPUB extraction need no new packages.
- Provider plumbing from v1.0.10: stored per-provider API keys, the per-provider Settings panels (`providerMeta.ts` + `ProviderPanel.tsx`), and provider-templated error translation (`_provider_exc`). Audio models become a second capability axis on the same provider accounts.
- `backend/app/utils/names_store.py` is the house template for an app-level SQLite store -- the recent-activity index follows the same pattern (seeded/rebuildable, monkeypatchable paths for tests).
- `scene_parser.py` and the manuscript `---` scene-separator convention transfer directly to chapter/scene detection for Markdown and Storythread-project imports.
- The frontend status polling should follow the `useBackendHealth` hook pattern (simple interval polling; no streaming/SSE, consistent with the parked streaming decision).
- The backend-health banner already provides uniform "backend unreachable" handling; audiobook screens inherit it for free.

---

## 33. Recommended Implementation Phases

### Phase 1: Foundation

- Audiobook dashboard
- Audiobook workspace creation
- Project manifest
- Recent activity index
- Import source copying
- TXT and Markdown import
- Basic chapter model
- Basic narration editor

### Phase 2: Document Import

- DOCX extraction
- EPUB extraction
- Import from a Storythread writing project
- Extraction review
- Chapter detection
- Front-matter and back-matter removal

### Phase 3: Local Narration

- kokoro-worker.exe build artifact (second frozen exe in release.ps1, signed)
- Component manager: download, SHA256 verify, install, remove
- Worker subprocess lifecycle: spawn, health check, supervise, shut down
- Kokoro CPU synthesis
- Voice catalog and preview
- Segment generation
- Chapter queue
- Progress persistence
- Restart recovery
- Windows sleep inhibit during active runs

### Phase 4: Audio Assembly

- FFmpeg integration
- Chapter MP3 export
- Combined MP3 export
- M4B export
- Metadata editor
- Cover image embedding

### Phase 5: Cloud Providers

- OpenRouter speech provider
- NanoGPT speech provider
- Dynamic model discovery
- Dynamic voice discovery
- Cost estimation
- Provider error handling

### Phase 6: Revision and Recovery

- Segment hashing
- Automatic stale-audio detection
- Regenerate changed segments
- Revision retention
- Storage cleanup
- Export-only state

### Phase 7: PDF Import

- Text-based PDF extraction (new dependency; the highest extraction-quality risk, deliberately last)
- Scanned-PDF detection with the clear rejection message
- Extraction review tuned for PDF artifacts (headers, footers, hyphenation)

### Phase 8: Future Multi-Character Foundation

- Speaker management UI
- Speaker-to-voice mapping
- Narration script schema
- AI annotation review framework
- No automatic dialogue generation until review tools are complete

---

## 34. Highest-Risk Areas

The highest-risk technical areas are:

1. Reliable document extraction -- EPUB variability in the MVP; PDF deliberately deferred to its own phase.
2. Accurate chapter and paragraph segmentation.
3. The kokoro-worker.exe companion artifact: building, signing, hosting, download/verify, and subprocess lifecycle. This is the single largest hidden engineering cost in the feature.
4. Provider capability differences.
5. Long-running job recovery.
6. Segment-level versioning.
7. Avoiding duplicate hosted charges.
8. M4B chapter and metadata assembly.
9. Disk-space management for intermediate audio.
10. Future multi-character compatibility.
11. Licensing and redistribution requirements for bundled components (FFmpeg, misaki/espeak-ng, ONNX runtime).

(GPU compatibility was removed as a risk by cutting GPU support entirely; CPU synthesis is faster than realtime.)

---

## 35. Final MVP Recommendation

The first production release should include:

- A standalone Audiobook Converter dashboard
- A guided seven-step wizard that lands in a persistent workspace view
- Import from files (DOCX, EPUB, Markdown, TXT) or from a Storythread writing project
- The draft-locally, print-premium two-pass workflow as the headline story
- One active audiobook at a time
- Selectable chapter generation
- One narrator per generation run
- Multiple narrator voices to choose from
- Editable narration preparation
- Structured pause and scene-break markers
- Pronunciation dictionaries
- Local Kokoro CPU generation
- Optional local component downloads
- OpenRouter and NanoGPT support
- Voice previews
- Background processing
- Chapter queue
- Pause, resume, cancel, and restart recovery
- Automatic stale-audio detection
- Manual regeneration
- Chapter MP3 files
- Combined MP3 output
- M4B output
- Metadata and cover art
- Retained intermediate files
- User-controlled cleanup
- Speaker-aware internal data structures

The architecture should deliberately prepare for multiple character voices, but automatic speaker detection and multi-character generation should remain outside the initial MVP.

