# Changelog

All notable changes to Storythread Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is not semver. It is a three-tier rule:

- **Tier 3 (`v1.1.x`)** -- enhancements to existing features. No new surface,
  no migration, reversible.
- **Tier 2 (`v1.x.0`)** -- additions, like the Audiobook Converter (v1.1.0):
  a whole new feature area that does not disturb existing data or behaviour.
- **Tier 1 (`vX.0.0`)** -- major restructuring: a change needing its own
  dashboard, or one that alters multiple existing features at once.

The release script reads entries under `## [Unreleased]` and moves them
into a new tagged section when cutting a release. To add a changelog
entry while working on a feature, append it under Unreleased.

---

## [Unreleased]

### Added

### Changed

- **Governments are called Ruling Authorities now.** "A leader of a party isn't a government" -- and neither is a crown, a corporate board or an occupying army, but all of them rule. Only the words on screen changed: your files, folders and connections are untouched, and if you had renamed the kind yourself your own name is kept.
### Fixed

---

## [2.0.1] - UNRELEASED

### Added

- **The Profile Extractor.** `The Weave > Profile Extractor`. It reads your manuscript and proposes what each entry should say: an overview, physical and personality traits, motivations, notes. Filling in a story bible by hand means re-reading your own book and writing down what is already in it, which for a long novel can take longer than writing a chapter. This does the reading and hands you a draft.
- **It is a draft to rewrite, and the screen says so.** Nothing it proposes is checked against anything, because an overview is a summary rather than a quote and there is no source sentence to check it against. So your eye on each individual piece is the only check there is, and the app is built around that: no accept-all, nothing ticked when the list arrives, and every proposal shown beside what that entry currently says so you are never judging one in the abstract.
- **Add to what you wrote, or replace it.** Adding keeps your paragraphs exactly as they are and puts the new one after them -- nothing of yours is rewritten, reordered or blended in. Replacing is a separate button because it is a separate decision and the only one that can lose your words. A proposed trait either stands on its own or folds into one of your traits that **you** pick; the app never guesses which, because a wrongly folded trait still carries your own label and is easy to miss later.
- **It finds two kinds of character Weaving structurally cannot.** People your prose describes without naming ("the tall man", "the hulking figure") come through with the description kept AS the name and never replaced by an invented one, and an unnamed character stays unnamed rather than being nagged into a decision you have not made. So do names that only ever appear as somebody being spoken to, like `"Duncan," he said`, which sit where a capital letter was required anyway and are invisible to a scan. Where the book reveals one of these to be somebody you already have, that arrives as an offer to fold them together, never as a merge.
- **A long book is read in parts, and you get one list.** A novel's worth of proposals cannot come back in a single reply from any model, so the book is split into requests that can actually be answered, and the results are combined. A character who appears in chapters one and six is one entry with two proposals against it, not two entries. The screen says how many requests it will take before you commit, says which part it is reading while it works, and saves each part as it finishes -- so a failure at part four of five keeps the first three.
- **It works over as many sittings as you need.** A whole-novel pass is a job rather than a sitting, so the result is saved: close the app, come back next week, and the same list is there with everything you have dealt with ticked off. There is one saved read at a time and a new one replaces it -- and if you still have proposals you have not looked at, it says how many before it does anything, because you paid for those.
- **Every kind, not just characters.** Whatever your project's types file holds, including kinds you invented yourself: locations, factions, creatures, religions, ruling authorities, deities, cultures, objects, events, languages.
- **Long-context analysis is a role you can now use.** It has been in Settings since Model Roles shipped, marked as reserved with a note saying it arrived with the Weave's AI passes. This is that pass, and it is what the role exists to buy.


### Fixed

- **The AI Importance Audit has never returned a single flag, and now does.** It asks a model which of your traits are weighted wrongly, and the answer was being read from the wrong place -- so it reported "nothing to flag" on every profile since it shipped, whatever the model said. There was no error and no way to tell it apart from a model that had looked carefully and found nothing.
- **The audiobook's AI speaker pass had the same fault**, since v1.1.0. It proposes who speaks each line of dialogue; it was proposing nothing, and reporting nothing discarded, so it looked like a model that could not find any dialogue.

### Changed

- The setup screen states what the run will cost, how many chapters and entries it covers, and which model does the work, before the button. Entries you have already written up are ticked to be left alone, as a suggestion you can undo -- nothing here can know that a character who appeared once in chapter two has come back for the rest of the book.

---

## [2.0.0] - 2026-08-14

### Added

- **The Weave -- one linked, time-aware world model.** The release's headline, and it replaces the four hardcoded profile folders. Instead of Characters / Relationships / Locations / Lore, your world is a set of **Threads**: fourteen kinds shipped (characters, relationships, locations, lore, factions, religions, governments, deities, creatures, cultures, objects, concepts, events, languages) plus any kind you invent yourself, which behaves exactly like the ones we ship. Everything lives as Markdown in `codex/`, readable and editable without the app, so copying the project folder still takes the whole world with it.
- **Connections that say WHY.** Two Threads can be tied with one of about seventy relations, grouped so you choose in the same terms twice rather than reading one flat list of seventy. A connection is allowed to be untyped -- "just connect them, I will say how later" is the default -- but it can never be saved without a **reason in your own words**. `A -- connected to -- B` spends prompt budget to say nothing your prose did not already show; "she is hiding one thing from him: the theft" is the scene.
- **Facts that change across the book.** A Thread holds facts anchored to a point in the story, each with three switches: *from when* it becomes true, *whose truth* it is, and *when the reader learns it*. That third switch is what makes this app's founding example recordable -- a heroine who believes her father died until chapter fifteen. Ask for help with a chapter three scene and your AI is told her mistake; ask about chapter sixteen and it is told what she now knows.
- **The Weave map and the story scrubber.** Your world drawn as a graph, with a chapter slider along the bottom. Drag it and Threads appear when they are introduced, connections light up when they become true, and a developing relationship stays one line whose label changes rather than three lines stacked on each other. A spoiler toggle hides anything the reader has not learned yet. A list view sits beside the map as a peer, not a fallback.
- **Weaving -- a guided walk through what the app found.** Four passes, each a different question: **Dress the Loom** (what is here, and what relates to what), **Weave the Chapters** (did anything change as you wrote), **Read the Cloth** (where the book contradicts itself), and **Unwoven** (the ground rules of your world). The scan is free -- no model, no cost -- so the count it quotes before you start is a real number rather than an estimate that turns out wrong two hours in. Every stop shows the text that triggered it and can answer "why am I seeing this?", and every stop resolves **inside** the walk: you are never sent to another screen and abandoned there.
- **Unwoven -- a hundred questions about the ground your story stands on.** Ten parts of a world, ten questions each, every one answerable in a sentence: how power passes, what magic costs, what happens to somebody who cannot pay a debt. None of it is findable in a manuscript, because a manuscript shows the consequences of those rules rather than the rules themselves. Answering one opens the questions it implies; a board shows every part of your world with how much is still undecided; and a ten-page walkthrough argues from a cost rather than from tidiness.
- **Contradiction checks that cost nothing.** Seven structural checks, all arithmetic on anchors you wrote yourself, all instant and the same answer every time: one thing set twice at the same moment with nothing to order it, two facts each claiming to replace the same earlier one, a fact the reader is told before it becomes true, a correction that reaches the reader before the thing it corrects, a connection that ends at or before it starts, and two connections your world says cannot both be live. Several findings about one thing arrive as **one** question rather than eleven. Any of them can be marked deliberate and never raised again -- much good fiction contradicts itself on purpose.
- **Automatic context, fully inspectable.** When you ask for AI help, the app can assemble a brief about the relevant corner of your world as of the point in the story you are writing. You can see exactly what would be sent, remove individual Threads, exclude whole categories, or switch it off entirely -- and nothing is transmitted until you start an AI action. **Author Notes is never read.** That is enforced in code rather than by convention, with a test that fails the build if a new reader is ever added.
- **Export the Weave.** Markdown for a person (chapter names, every connection carrying its reason), JSON for a program (ids intact), and CSV as three tables, because a nested CSV is not a CSV. Every anchor travels as an id **and** a label: drop the id and a program cannot follow a renamed chapter, drop the label and a person cannot read the file. The manuscript export and the dated snapshot can include the Weave too.
- **Model Roles -- one model per KIND of job.** Storythread Studio asks an AI to do very different things, and the models available today are not equally good at all of them. Settings now has a Model Roles section with eight kinds of work -- Critique, Character reasoning, Long-context analysis, Brainstorming, Structural analysis, Research transformation, Prose, and Extraction -- and every AI feature declares which kind it is. Assign Claude to Critique and every review pass, chapter summary and importance audit uses it; assign a local model to Prose and Draft, Enhance and Revise use that instead. Each role lists exactly which features it covers. Roles no feature uses yet say so plainly rather than presenting a picker that silently does nothing. **Leaving everything unassigned behaves exactly as before.**
- **Local models (Ollama, LM Studio, llama.cpp).** A third AI connection that runs on your own machine: no API key, no per-token cost, nothing leaving the room. Enter the address, pick the API style, and Test Connection loads the models you have downloaded -- telling a bad address, nothing listening, and a server answering in the other dialect apart, and in the last case naming the setting to flip. Reasoning models that write their thinking inline have it stripped before it reaches you or the conversation history. Local addresses only; a public address is refused with the reason, so "Local model" cannot quietly become an undocumented way to reach an arbitrary remote service.
- **Weight and secrecy are separate questions now.** A trait's importance used to say two unrelated things at once: how much it matters, and whether it may be said out loud. A villain who avoids hospitals because he watched his parents die in one is *core* by weight and secret by disclosure, and one scale could only hold one of those -- with `hidden` sorting **lowest**, so the trait driving the most scenes was the faintest signal in the prompt. Importance now means weight, and a per-trait **subtext** switch says whether it may be named out loud. An eleven-page walkthrough takes one secret through three weights and shows the same scene written at each.
- **Converting an existing project is offered, never forced.** A dry run comes first, itemised rather than summed, with the backup named before the button and the count repeated on a second click. Afterwards you get a full account: every entry listed and grouped by kind, each openable field by field as original-versus-converted, with "changed" and "missing" kept distinct, and the raw files offered because a table is an interpretation. An interrupted conversion offers resume or restore rather than guessing. Projects you have not converted keep working exactly as before.

### Changed

- **Profiles are the Weave now.** The Profile Builder reads and writes the same entries the Weave does, so an edit on either screen is the same edit. It no longer decides for itself which folder to read: it asks the backend, and the one function that decides answers -- which is why the sidebar count and the editor list can no longer disagree with each other.
- A role you have explicitly assigned **never silently falls back to a different model.** If it cannot run -- no API key for that service, an unreachable local server, a model the provider does not offer -- the feature refuses and says why, rather than quietly producing work from a model you did not choose. Roles you have *not* assigned still fall through to your Default Model as before; the distinction is deliberate.
- **"Never ask" now asks how widely.** It used to mute a kind of question for your whole book without saying so, which meant leaving one deliberately contradictory character alone required turning contradiction checking off for an entire novel. It offers "about this one only" and "anywhere in the book", and writes nothing until you choose.
- **Model Roles are app-wide.** A per-book role assignment was documented and never worked; it is removed rather than left as a control that does nothing. The per-book **Default Model** is untouched and still works.
- **Weaving no longer treats the outline template as your world.** It was offering the template's own words -- Protagonist, Logline, Premise, Genre, Inciting Incident -- as characters to create. On one real outline that was 53 suggestions of which about six were real.
- `GET /api/ai/models` accepts an optional `provider` parameter, so a role pointed at a service other than the active one can list that service's catalog.

### Fixed

- **A colon in a trait name silently turned a whole section into prose.** The Story Role picker inserts a trait called "Story role: Comic Relief", and that colon made the entire trait list unreadable -- so every trait card in that section came back as a single paragraph on the next load, with nothing anywhere reporting an error. Fixed on both sides: values are quoted when they need it, and files already written this way are repaired when opened.
- **Three prompts claimed hidden traits were never sent to AI.** They were sent like any other; only their position in the prompt differed. The worst of them told the model to advise **demoting** a hidden trait to gain accuracy you already had, paid for with the secret. A test now reads the real prompt text, because a false promise about privacy raises no error on its own.
- **The profiles appendix in exports had never worked.** Ticking "include profiles" produced an export with no profiles in it and said nothing: it looked in a folder named in the singular while the folders are plural. Older than the Weave, and found only by testing export against a converted project.
- **Editing one part of an entry could delete its connections.** The Profile Builder now carries the whole entry through and hands it back, so saving an overview cannot drop the facts and ties it never displayed.
- **A save no longer fails at random on Windows.** A file rename fails while a virus scanner, the search indexer or a cloud-sync client holds the file for a moment -- a failure with no cause you could diagnose. Every store now retries briefly and then reports honestly.
- **The Weave walkthrough asks before losing your work.** A click landing outside a dialog used to close it instantly and discard whatever you had typed, including a connection's reason line and prose written into a thin entry. Every way out -- the X, Escape, and a click on the backdrop -- now goes through one guard that asks only when something would actually be lost.
- **Renaming a built-in note is refused with the reason** rather than silently breaking the outline the Planner reads.
- The map draws a connection that becomes true later as a dashed line, which it was documented to do and could not.
- **Your book moves between computers.** Copy the project folder to a drive and open it on another machine: entries, connections with their reasons, facts and their chapter anchors, and your Weaving history all arrive identical, so you carry on where you stopped. Exports are for leaving the app and deliberately do not carry Weaving answers, which mean nothing outside Storythread Studio.

---

## [1.1.0] - 2026-08-03

### Added

- **Audiobook Converter -- Stage A foundation** (first slice of the v1.1.0 feature; see `docs/audiobook-converter-spec.md`). A standalone tool reached from the Project Home: import a manuscript (DOCX, EPUB, Markdown, TXT, or an existing Storythread project -- chapters detected per format, PDF honestly deferred) into its own audiobook workspace, where the original file is copied and never touched. A jewel-tone dashboard (emerald actions, sapphire progress, ruby warnings on charcoal) lists recent audiobooks; the narration workspace offers a focused editor over the narration copy with a chapter rail, marker quick-actions ([pause], [scene-break], [chapter-break] as timed silence, [exclude], and one-spot [say:Hay-SOOS]Jesus[/say] pronunciation overrides), plus a pronunciation dictionary for this-audiobook and all-audiobooks rules. Manual save only, exactly like the writing app.
- **Audiobook Converter -- Stage B local narration.** The free local narrator is real: Kokoro-82M (54 voices) ships as a separate on-demand download (~372 MB, SHA256-verified, installed from inside the app with live progress; a version-mismatched engine offers a one-click Update). Pick a voice, preview it free, or select any passage and hear EXACTLY how it will sound -- pauses as real silence, pronunciations applied, excluded text skipped -- with a render trace under the player showing the exact speed used per piece. Generate the audiobook in the background with pause/resume/cancel, per-segment progress, and restart recovery; segments keep stable identities across edits, so inserting a paragraph regenerates one segment, not the chapter, and changing a pronunciation re-does only the segments containing that word. Pace control at two levels: book-wide Narration Settings (narrator pace, a separate dialogue pace, break silence lengths) and [pace:0.8]-style spans for specific moments (Slow/Fast toolbar presets; most natural between 0.8x and 1.2x). Every marker has a "What's this?" card with a live-rendered audio example (local -- no tokens spent), click-to-pause. Spoken pronunciation forms are engine-proofed automatically (caps flattened, syllables fused -- LAR-uh reads as one word, never letter by letter).

- **Audiobook Converter -- Stage C export.** The finished audio becomes an actual audiobook: per-chapter MP3s (`01 - Chapter Title.mp3`, real titles in the ID3 tags), one combined MP3, and an M4B with chapter marks that a phone or car stereo can navigate. Every format is mastered to the same broadcast-safe loudness first. The audio assembler (~139 MB, LGPL FFmpeg) installs on demand from inside the app with live progress, and [Open Output Folder] drops you straight into the results. Book metadata and cover art (spec 17) are edited in the workspace and embedded in the M4B and the chapter MP3s -- prefilled from the source project so nothing is asked twice, with the chosen voice remembered per book. Audio quality got its own pass along the way: mid-paragraph pauses no longer cut a sentence into pieces (flow synthesis renders the paragraph whole and inserts the silence into its natural gaps), pause seams no longer clip consonants, bare punctuation is never sent to the engine, dialogue pace survives a pause inside a quotation, and compound pace values snap to a grid that avoids a lisp artifact at 1.08x.
- **Audiobook Converter -- the Formatting Walkthrough.** A guided pass over a chapter that stops at each place a narration marker probably belongs -- paragraph beats, scene breaks, a name the engine will mispronounce -- and offers Apply, Skip, or a one-click repair for markers you typed wrong ([pace:=2], an unclosed [pause:0.4). [Auto-apply N beats] does the obvious ones in a batch behind a confirm, and leaves the judgement calls in the walk. Everything stays in the buffer until you save. The [say] pronunciation editor became a proper popout: type only the spoken form, hear it inside a carrier phrase so the word's edges are audible, hop occurrence to occurrence with a counter, and read a tips accordion that teaches respelling by example. A **Draft pass** toggle trades seam quality for roughly half the generation time while you are still testing -- and any draft audio automatically re-queues before an export, so a draft can never ship by accident.
- **Audiobook Converter -- Stage D premium narration.** The "print premium" half of the headline workflow. A new Audiobook Settings dialog (gear at the bottom of the chapter rail) holds the engine shelf, the narration API keys, and the book-wide narration settings. Engines are grouped by budget with real per-character prices: **Free** (the local narrator), **Budget** -- hosted Kokoro at about 35 cents for a whole novel, in the same 54 voices you drafted with -- and **Pro** (Deepgram Aura-2, ElevenLabs Turbo). Narration borrows your writing API key by default or takes its own; keys are masked and never echoed back. The Premium Narration panel shows the chosen engine read-only, lets a single book override the voice, auditions any voice or any selected passage for a fraction of a cent, and quotes the exact dollar cost before a print pass -- with the number repeated in the confirm. Engines we auditioned and would not steer you toward are demoted into a labelled drawer rather than hidden, each carrying the reason we heard it: Grok re-improvises pitch and tone between sentences, Voxtral welds a fixed mood onto every voice, and MAI-Voice-2 re-reads your inserted pauses and pace marks its own way. That leaves the Standard tier empty on the recommended shelf, and the app says so rather than papering over it with a reluctant pick.

- **Audiobook Converter -- Stage E storage and freshness.** Two questions the workspace could not answer before: *what is still up to date?* and *what can I safely delete?* Each chapter in the rail now carries a freshness dot -- green when the audio matches the narration, amber when part of it has been edited since, red when the whole chapter has, hollow when nothing is narrated yet -- and the rail says how many sections no longer match, naming a voice change when that is the cause. Nothing regenerates on its own; Generate re-does exactly the changed sections and leaves the rest alone. A new **Storage** screen (from the chapter rail, or from any book on the dashboard) measures the workspace by category -- previews, failed takes, superseded revisions, current segment audio, the imported original, finished exports -- and deletes only what is ticked. Previews and failed takes start ticked because they cost nothing to remake; the segment audio and the exported audiobook never do, and every row that loses something says what before you click. An **Intermediate Audio** setting decides what happens after a successful export: keep the segment files (the default), delete them automatically, or be asked with the size in front of you. Delete the segment audio while the exports remain and the book is honestly marked **Export Only** -- individual sections can no longer be regenerated or reassembled without narrating again.

- **Audiobook Converter -- Stage F PDF import.** PDFs can now be imported directly, alongside DOCX, EPUB, Markdown, TXT, and Storythread projects. Text-based PDFs only: a scanned book says so and stops rather than guessing at the words, because OCR mistakes would end up spoken aloud in your audiobook. A PDF is a picture of a manuscript rather than a manuscript, so the import rebuilds what the page layout took away -- running headers, running footers and page numbers are recognized by their repetition across pages and removed, words hyphenated across a line break are rejoined, and typographic line breaks are turned back into real paragraphs (using the indent on a paragraph's first line where the book has one, and the short last line where it does not). Every one of those steps reports itself when the import finishes, along with a standing note that paragraph breaks in a PDF are a best guess and the narration copy is worth reading before you generate.

- **Audiobook Converter -- Stage G multiple voices.** An audiobook can now be read by more than one voice. A new **Cast** panel names the narrator and any characters, giving each one a voice; mark a character's lines in the narration editor with `[voice:Elena]...[/voice]` (there is a toolbar button) and those passages are narrated in that voice while everything else stays with the narrator. The manuscript's own names are offered as one-click additions to the cast, so a name you have already typed never has to be typed again, and recasting a character re-narrates exactly her lines -- the narration copy holds names, not voice ids, so nothing in your text changes. All voices come from the one narration engine you chose; only the voice varies. A **Find speakers** button asks the AI who speaks each line of dialogue in the selection (or the chapter) and walks you through its proposals one at a time, with its confidence shown honestly and three answers each: accept, correct the name first, or keep the narrator. The AI proposes and never applies: accepted markers go into the editor only, nothing is saved until you press Save, and any suggestion the AI could not quote from your text word for word is discarded rather than wrapped around words you did not write.

- **Passage / Dialogue Check.** A new item under **Tools** in the writing editor: hear the passage you have selected read aloud. Reading your own words silently hides their rhythm -- you supply the pauses and the emphasis without noticing, and an indifferent voice does not. Dialogue is the obvious use, but the ear catches a different class of problem than the eye anywhere in your prose: a word repeated three times in a paragraph, a sentence that only parses on the second read, and the right-word-wrong-word errors no checker flags -- "Lara walked through the dessert" is perfect spelling and perfect grammar. Four voices (American and British, one of each), a Sample button, your pick remembered per book, and a plain estimate of how long a long passage takes to prepare. It runs entirely on your computer using the same free voice engine as the Audiobook Converter, offers to install it if you have not already, saves nothing, and applies no pacing or markers -- it is for listening, not producing.

- **Audiobook Converter -- word readings.** Some words do not have one sound, and the narrator has to guess: *read* is "reed" or "red", *wound* is "woond" or "wow-nd", *lead* is the metal or the verb. It guesses from grammar it only half understands and gets these wrong often enough to break a sentence, and until now the only way to find them was to listen to the whole book. The Formatting Walkthrough now stops at each one and offers every pronunciation as **audio, in your own sentence, in your book's voice** -- press Play on both, click the one you meant, and the override is written for you. Nothing is picked for you, because which reading is right depends on what you meant, and skipping is the correct answer whenever the narrator already says it properly. Every word that ships was verified against the real speech engine first, and most candidates did not survive it: of 214 respellings auditioned, the majority arrive at the engine as two words or leak a stray sound and were rejected; 12 words the narrator already reads correctly in both senses were dropped rather than turned into busywork; and 6 whose wrong reading is real but rare in a novel (a pair of *does* in a field, rather than the verb) ship switched off, one tick away. What is left is 22 words where the narrator is reliably wrong and a fix is proven to work.

- **The Formatting Walkthrough now teaches itself out loud.** [Show me how this works] is a ten-step tutorial, and every step that describes something audible lets you hear it instead of taking the app's word for it. Each kind of pause gets two Play buttons -- the same sentence without the beat, then with it -- and the four kinds run one continuous scene, so by the third clip you are judging the pause rather than reading new prose. It opens by saying plainly that none of this is required, names the local narrator and owns its faults rather than implying your text is the problem, and one step carries a warning that pauses packed close together can make the narrator slur, with a clip where you can hear it happening. That clip is deliberately not cleaned up: a tutorial that only ever plays the narrator at its best leaves you thinking the first garbled run in your own chapter is something you did.

### Changed

- **The audiobook Cast panel now teaches instead of lecturing.** It opens with one line -- give a character their own voice, free on your local narrator -- and one example of the marker, with the depth behind three "What's this?" pulldowns: how to mark lines, what the limits are (a voice is consistent, but the engine does not act), and whether casting costs more (it does not; re-casting does). Each speaker now holds two voices, because the app has two narration passes: a **Draft voice** from your free local narrator, and a **Print voice** from your paid engine, shown only when one is chosen and connected. Every draft voice has a **[> Sample]** button. The tools for marking who speaks -- the Cast Walkthrough and Mark selection -- moved inside this panel, since they exist only for writers who chose to use a cast; the main toolbar is unchanged for everyone else.

- **The Formatting Walkthrough is a window now, not a strip above the editor.** It had outgrown the strip -- seven suggestion types, per-pronunciation Play buttons, a tutorial with audio and a confirmation banner do not fit in a horizontal band. It now opens as its own panel, the same shape as the Cast workbench, because it is the same job: walk the chapter, decide one thing at a time, every change landing in the editor with Save still the only thing that commits. The left side lists what it looks for with a count and a line saying what each one is for, rather than a label you have to already understand. The panel shows the whole paragraph you are deciding about, since it now covers the editor and has to carry its own context. Keyboard shortcuts moved out of the tutorial and sit as quiet grey text under the buttons they belong to. What this trades away, deliberately: you can no longer hand-edit a sentence in the middle of a walk. Close and reopen and it picks up from your cursor.

- **Short-sentence beats stopped over-suggesting.** Measured against a real 22,000-word chapter, the rule fired 394 times -- one suggestion every 56 words, which is not a pass anyone finishes. Two causes: it counted any sentence under 35 characters as clipped, which is ordinary prose ("I don't know their names." is 25), and two of them in a row was enough to trigger it, which is what ordinary prose looks like. It now wants three or more in a row at 22 characters or fewer, and never runs a rhythm across a paragraph break. Same chapter: 166 suggestions, and each one a deliberate run. Sentence length is also measured on what is actually spoken now, so a line carrying a pronunciation override is not counted as longer than it sounds.

- **Plain-language pass over the Formatting Walkthrough.** Two labels were the app talking to itself. **Marker problems** is now **Fixes** -- they are already found and the correction is in hand, so the label says what you get rather than what is wrong with your file. **[Auto-apply N beats]** is now **[Add all 41 pauses at once]**, with the real number: to a first-time writer the old one offered a letter and a musical term. The tutorial step explaining the batch was rewritten from scratch, along with the confirmation that follows it.

- **Dialogue that starts its own paragraph is no longer suggested for a pause.** The paragraph beat (550ms by default, in Audiobook Settings) already puts a real gap at every paragraph boundary, so offering one there asked you to place by hand something the app inserts for you. Speech that opens partway through a paragraph is still offered, because nothing else covers it -- the narrator treats a whole paragraph as one breath.

- **A [say] pronunciation override can be edited.** Setting one and then opening the tool on that word used to answer "no more occurrences from here", which was a dead end on the most ordinary reason to open it a second time. Opening inside an existing override now re-opens it with the spoken form filled in, and accepting replaces it rather than wrapping a second one around the first. The word being worked on is also visible now -- it is selected rather than merely scrolled to, in a colour that holds while the popout has focus -- and a line under the Preview button prints what the engine was actually handed, so a respelling that sounds wrong stops being an argument between ears and becomes a fact you can read.

### Fixed

- **Find speakers could hang indefinitely.** The first build asked an AI where the dialogue was before it could show anything, sent the entire book when no text was selected, and offered no way to stop -- one chapter could sit on "working out who speaks" for fifteen minutes. Finding dialogue is now local, instant, and free (it is quotation marks), and most lines are attributed from the writer's own dialogue tags. The AI is an optional pass over one window of text, with a Cancel button, a 90-second client timeout, and a matching server-side ceiling. If it never answers, the walkthrough still works.
- **The Paragraph beat setting could never be saved.** The narration-settings save rewrote the whole pacing block from four fields, so the paragraph-gap control in Audiobook Settings did nothing -- and any value already stored was silently reset whenever another pacing setting was touched.

- **A long generation run could report itself idle.** A 197-segment run was started, the writer switched windows for five minutes, and came back to an inactive [Generate Audiobook] button that answered "an audiobook is already generating" when pressed. The worker had been fine the whole time. The run record was rewritten from scratch after every completed segment while the screen polled it every 1.5 seconds, so a torn read was not a risk but a schedule, and an unreadable record was reported as "nothing is generating". Run records and the segment index are now written atomically -- the same protection the settings store has had since 1.0.x -- and whether a run is live is answered by the process itself in every case rather than inferred from a file.

- **Resume could be blocked forever after a reboot.** The workspace lock reported "in use by another Storythread instance" pointing at a process id that a rebooted machine had since handed to something else. The lock now records which program holds it, so a reused id wearing the wrong program is recognised as stale. The liveness check was also replaced with a read-only query: the previous one could, on Windows, terminate an unrelated process that happened to inherit the id. And there is now an escape hatch either way -- **Cancel generation and start over**, under Resume, forgets the interrupted run and releases the lock. Finished segment audio is kept and never re-narrated.

- **The narrator's voice could disagree with itself.** Changing the narrator in the Cast panel and saving left the narration rail still showing the old voice. Both screens write the same setting, so the data was right and the displays disagreed, which is worse than either being wrong -- nothing told you which voice the audio would actually use. One value, two editors, and both screens now agree at all times.

- **"16 sections no longer match their audio" stayed on screen after the run that fixed them.** The freshness marks are worked out from the audio on disk, so they go stale the moment a run finishes, and nothing was refreshing them. Related: when several pauses sit close together in one paragraph, the narrator can slur at the seams, and there was no way to know it had happened. The rail now reports how many pause groups had to be rendered as separate pieces, says that is where a seam may be audible, and suggests what actually helps.

- **No marker is ever spoken aloud.** A preview came back saying "you will hear laruh slash in the narration": a selection that clipped the tail of an existing override carried half a marker into the word. The payload now ends with a guard that removes any marker-shaped leftover before it reaches the engine, on every path -- preview, audible example and full generation. Your own square brackets are untouched, which is tested, because a guard that ate prose would be worse than the bug.

- **The [say] popout opened at the bottom of the screen.** The card that points at a word appeared at the bottom of the editor no matter where the word was, and since it grows after opening its controls expanded off-screen. The placement was mixing two coordinate systems, so the error grew with how far into a chapter you were -- deep in a long chapter it landed at the bottom every time. It is also no longer possible to reach the end of the pronunciation walk and be left with a card that only Escape could dismiss.

- **Dropdown lists were unreadable, app-wide.** Every `<select>` menu drew white text on light grey, readable only while an item was hovered. A dropdown's popup is drawn by the operating system rather than the page, so it followed the Windows light palette and ignored the app's styling. One declaration switches every dropdown, scrollbar and context menu in the app to the dark palette.

- **Passage / Dialogue Check reported a playback error over audio that played perfectly.** Two audio players had been pointed at the same clip, and the cleanup that frees a finished clip ran when a new one arrived rather than on close, tearing down playback a moment after it was told to start.

---

## [1.0.11] - 2026-07-28

### Added

- **Audiobook Converter: specification and staged plan.** The next major feature is now fully specified and scheduled: a standalone converter that turns a manuscript (DOCX / EPUB / Markdown / TXT, or an existing Storythread project) into chapter MP3s, a combined MP3, and an M4B audiobook -- draft the whole book free with the local Kokoro narrator, then "print" once with a premium hosted voice when the book is final. See `docs/audiobook-converter-spec.md` and the roadmap's Scheduled section for the stage-by-stage plan. This is the feature the reserved v1.1.0 version slot will ship under; no converter code is in this release.

### Changed

- **AI request timeout raised from 180 to 300 seconds** (backend and frontend together). Slow reasoning models now legitimately need the headroom on drafting turns, because attached profiles stay in the conversation (the v1.0.10 context fix) and non-caching models re-read everything every turn. The Cancel button still appears after 20 seconds, so nobody is stuck waiting.

### Fixed

- **Writing Companion follow-up turns no longer time out on slow reasoning models** (AionLabs Aion-3.0 and 3.0-mini in live testing -- every Draft-mode reply after the AI's clarifying questions hit the 180-second wall). Two causes fixed: a text selection that stayed highlighted was resent every turn AND re-saved into the conversation each time, growing the payload by a full duplicate copy of the selection per turn; and the old 180-second ceiling no longer fit a slow model doing its heaviest turn. An unchanged selection now rides along from history instead of being resent (the context line shows "Selection (already sent)"), a changed selection still sends, and Enhance mode is unaffected.

---

## [1.0.10] - 2026-07-25

### Added

- **NanoGPT as a second AI provider.** Settings gains an AI Provider section with a card per connection -- OpenRouter (the recommended default) and NanoGPT (pay-per-prompt, many unmoderated models) -- each with its own tailored connect instructions, its own stored API key, and its own Test Connection. Switching takes effect on Save: the model picker reloads from the new provider, and a warning flags a default model the new provider doesn't carry. NanoGPT publishes no pricing data, so the cost-tier filter is hidden for it and content-mode filtering uses a name-based heuristic instead of provider prefixes. Future local providers (Ollama, LM Studio, llama.cpp) plug into the same seams.
- **Prompt Caching toggle (OpenRouter).** On by default, inside the OpenRouter panel: the unchanged part of each request (instructions plus story context) is marked cacheable, so supported models charge a fraction for it and respond faster on repeat requests. Never sent to other providers.
- **Two character templates.** Creating a character now offers a choice: **Main character** (the full trait-block template with importance levels) or **Side / background character** (a simplified template where every section is a single free-text field). The character list in the Profile Builder splits into collapsible **Main** and **Side / Background** groups, and the chat attachment picker mirrors the same grouping. Older profiles are untouched -- they load as Main.
- **Personality spine dropdowns.** Character profiles gain two cheat-sheet dropdowns in the header, right under Status and Tags -- Personality (Enneagram, 9 types) and Story Role (the 12 Jungian archetypes plus Comic Relief, Confidant, and Rival). Picking one inserts a fiction-first starting paragraph (behavior, speech pattern, how they crack under pressure, with fill-in blanks for your character's specific triggers) into Personality Traits, with a note confirming where it went. Picking a Story Role also fills the Role field and adds its key-aspect Tags, and the Role field gets its own quick-pick list (Popular / Less Common / Niche story roles). Every option has a "What's this?" definition. No AI calls -- instant, free, yours to rewrite.
- **Quick Build for side characters.** Side/background profiles open with a trait roller: reroll curated options per section (Physical / Mannerism / Voice / Want / Hidden-Foreshadowing) and click one to add it to the matching section as a new line -- no trait titles, no forms, just editable text. Options are sentence-length with real texture, the pools run deep (50+ per section), rerolls page through the whole pool before anything repeats, and picking a Story Role weights the rolls toward fitting traits. The Hidden / Foreshadowing row rolls secrets, tells, and planted details built to pay off later. An opt-in NSFW toggle swaps in adult option pools, with an Explicit checkbox for a third fill-in-the-blank tier; always per character, never switched on automatically. Side profiles also drop the per-section AI Summary tiles -- only the Full AI Summary at the bottom remains. The Story Role pick survives reopening the profile (it re-derives from the Role field -- "Villain" finds Shadow / Villain), and a **[Generate Overview]** button spins the filled-in fields (Role, Tags, traits, relationships, notes) into a mini encapsulated story of the character -- grounded in what you wrote, lightly embellished to connect it, hidden details kept as subtext, and a different angle on every click. It fills the editable Overview field and saves nothing until you save -- a deliberate side-character-only exception to the no-ghostwriting rule.
- **"Interview Me" mode in the Profile Builder chat.** The AI interviews YOU about your character -- 5-8 quick basics first, then pick which sections to expand (checkboxes above the chat input) and answer 2-4 pointed questions per round that dig for triggers and origins, not adjectives. Every round ends with the full copy/paste profile block, so you can stop anytime with something usable. The AI organizes your answers; it never invents your character -- suggestions are always labeled as take-or-discard. Book Details (genre, tone, theme, setting) shade the questions when filled in.

- **Character name generator.** A dice button beside the Name field (and a "Need a name?" panel in the + New character form) rolls given names and surnames from 20 real-world cultures across five time periods -- Medieval/Renaissance back through Current -- grouped by region (Europe, Middle East & Africa, Asia, The Americas), roughly 5,700 period-accurate given names and 800 surnames in all. Pick an era and the closest available is served honestly (no faked pre-1700 American names). Twelve fantasy races (five elf kinds, orcs, dwarves, gnomes, hobbits, goblins, dragonkin, fae) assemble endless names from race-true sounds, with surnames to match (Moonwhisper, Ironbeard, Skullcrusher, the Sneak). Given name and surname select independently -- a character can go by just "Arty" or just "Smith". Name data lives in an app-level SQLite database seeded from shipped files, ready to grow.

### Changed

- **Attached context now stays with the conversation.** Previously an attached character profile (and the included chapter text) reached the AI on exactly one turn -- the turn it was attached -- and silently vanished from every later turn, which is why characters with a distinct Voice drifted into generic dialogue mid-conversation and Draft mode could write a character "blind" after a planning chat. The materials now persist in the conversation history (hidden from the transcript), the Canon/Reference stance stays active for as long as chips are attached, and a new VOICE FIDELITY rule instructs the AI that [core] voice and mannerism traits are constants -- vary the expression, never drop the trait. Draft and Enhance also run slightly cooler (0.6 instead of 0.7) to keep prose anchored to the profiles.

### Fixed

- **Slow reasoning models no longer time out from prompt caching.** The cache marker (and the structured message shape carrying it) is now sent only to model families that use it (Anthropic, Google). Exotic provider routes -- AionLabs Aion-3.0 in live testing -- could stall on the shape until the 180-second timeout; they now receive the classic plain request and work as before.

---

## [1.0.9] - 2026-07-20

### Added

- **Acts in the manuscript tree.** The sidebar now shows Story > Act > Chapter: create acts with "+ New Act", collapse them (remembered per book), and move chapters between acts or reorder them from each row's hover "..." menu. Acts live in a small `manuscript/structure.json` manifest -- chapter files are never renamed or renumbered by a move, and projects that never use acts look exactly as before.
- **Scene beats.** Each scene summary can now hold a Beats checklist -- planning checkpoints like "MC finds the letter" -- edited in the scene summary view (check off, reorder, edit in place) and shown as expandable children under each scene in the sidebar with a done/total badge. Beats are stored in the scene's summary file, never in the manuscript prose, and AI summary regeneration leaves them untouched.
- **Book Details popout.** The old Project Settings modal (previously hidden behind a tiny gear icon) is now "Book Details", opened from a section header at the top of the left nav, and gains the full set of story fields: Theme, Setting, Word Count target, Point of View, Tense, and Target Audience alongside Title, Description, Genre, and Tone. Everything except the word target is auto-injected into AI prompts as story context; the word target feeds the Writing Progress gauge via the outline. The gear icon is gone.
- **Guided suggestions in Book Details.** Genre, Tone, and Target Audience each offer a collapsible list of common choices, grouped most-popular-first -- click to add or remove them, or keep hand-typing your own. Every group has a "What's this?" explainer defining each option, and there is a separate (red) NSFW list of adult / erotica classification labels. Point of View has its own "What's this?" guide with recommendations for which to pick.
- **Tools menu.** Generate Scene Summaries, Suggest Scene Breaks, Chapter Summary, Reader Mode, and Export now live in one "Tools" pulldown in the editor title bar, freeing toolbar space around the writing area.
- **Per-book sidebar memory.** Collapsing Profiles, Notes, or an act is remembered for that book -- across restarts and app updates -- via a small UI-state file stored inside the project folder.

### Changed

- **Renaming a chapter now renames its file too.** The filename slug follows the new title (numeric prefix kept for on-disk reading order), and everything keyed to the old name moves along: chapter summary, scene summaries, act assignment, and writing-progress history. Unsaved editor text survives renaming the open chapter.
- **Chapter titles update on save.** Editing the `# Heading` line and saving now refreshes the sidebar immediately -- no more restart or project switch to see the new name.
- **Default chapter naming unified.** New projects start with `01-chapter-1.md` ("Chapter 1"), matching the "Chapter N" default of the new-chapter dialog. Creating after a delete no longer collides with existing chapter numbers.
- **Writing Progress tile pinned at the bottom.** The progress tile moved from the top of the left panel to below the navigation, where it stays visible no matter how many chapters or acts are expanded; its breakdown now opens upward.
- **Removed the leftover "Summaries > Scene Summaries" nav section.** Scene summaries live in the Manuscript tree under each chapter; the old legacy link did nothing useful.

---

## [1.0.8] - 2026-07-14

### Added

- **Smart Advisor: Timeline and Scene Goal checks.** Two new subcategories under the Context pass: Timeline flags event-order, elapsed-time, time-of-day, and season continuity slips; Scene Goal flags passages that drift from the scene's apparent purpose or stall without advancing anything.
- **Per-chapter word targets in Writing Progress.** When the outline frontmatter assigns `chapters[].word_target` values, the Progress slide-over now shows a per-chapter breakdown with a mini progress bar for each targeted chapter (green at 100%). Chapters without a target show their word count as an info row.
- **Reasoning toggle in the Writing Companion.** When the active model can return a reasoning trace, a Reasoning toggle appears next to Draft and Enhance. With it on, each AI reply includes a collapsible "Reasoning" block showing how the model thought through its answer. Hidden entirely for models that don't support it.
- **"What's this?" help for chat modes.** A help button beside the Draft / Enhance / Reasoning toggles expands a plain-language panel explaining what each mode does and when a writer would use it -- including default Chat, and a note on why the Reasoning toggle is sometimes absent.

### Changed

- **Cost tier slider: four explicit stops.** The tier control in Settings and Project Settings now reads Free / Lowest / Pricier / Priority Best. At Priority Best, flagship-class picks are pinned in their own group at the top of the model list for one-click access. Stored values are unchanged, so existing settings carry over.
- **Project cost tier now filters the project model picker.** The per-project tier (previously guidance-only) caps which models the Project Settings picker offers, alongside the existing content-mode filter.
- **Text-only model filter now applies everywhere.** The "hide models that output images, audio, or video" preference from Settings now also filters the per-project model picker, not just the global one.

---

## [1.0.7] - 2026-07-01

### New

- **Enhance** -- a new mode in the Writing Companion. Highlight any passage and tell the AI how you want it improved: add sensory detail, deepen the mood, adjust how a character comes across, tighten the pacing, or work in a description. Choose how far it goes, Restate (reword at the same length), Default (a richer pass), or Expanded (a fuller rewrite), and it draws on the surrounding scene for continuity. Nothing changes automatically; the rewrite appears in the chat for you to place where you want it.
- **Scene break suggestions** -- click "Suggest Breaks" and the AI reads your chapter and points out where a scene break would strengthen the pacing, with a short reason for each. You decide what to use.
- **Canon or Reference for your attachments** -- when you attach character profiles, an outline, or locations, you can now choose how the AI uses them: Canon keeps your writing consistent with them, or Reference lets your in-the-moment instructions lead. A built-in tip explains when to use each.
- **"New ask"** -- start a fresh request in the Writing Companion any time, without clearing the conversation you want to keep.

### Refinements

- Friendlier guidance if an AI model you used in a past session is no longer available, and model changes now take effect right away.
- And to make picking a replacement easy, a refreshed, up-to-date list of recommended models in Settings, tailored to your project's content mode, for example: **DeepSeek V3** (best budget quality) · **xAI Grok 4.3** (vivid drafts, unmoderated) · **Sao10K Llama 3.3 Euryale 70B** (tuned for immersive fiction).
- Smoother, steadier typing in the Outline and Profile editors.

---

## [1.0.6] - 2026-06-18

### Added

- **Draft mode in the Writing Companion.** A new Draft mode toggle next to the chat input turns the AI from a discussion partner into a drafting partner: with it on, your message is treated as a premise and the AI writes actual scene prose from it, using your attached context chips (outline, character, location profiles) as canon. Output is plain manuscript-style paragraphs with no preamble or editorial sign-off, runs about 800 to 1200 words per segment, and stops at a natural beat rather than forcing a scene ending. A **Continue** button appears under the AI's reply: click it and the next segment is written from where the prose left off, so a scene or chapter can be built up indefinitely one segment at a time. Draft mode is off by default, so normal discussion chat is unchanged. Drafted prose keeps the approved `--` punctuation (only the conversational chat path folds it to commas), and a one-time, dismissible nudge suggests switching to a stronger model when drafting on a budget tier that tends to produce generic prose.

### Fixed

- **Outline Planner: sections missing or silently deleted after Raw view edits.** A corruption bug caused the YAML frontmatter closing `---` to fuse with the first `## ` section heading onto one line (e.g. `---## Setting in One Paragraph`). This caused three cascading failures: the frontmatter parser mis-fired and absorbed section content into the YAML body (silently losing YAML field values like word targets and expected characters); the section parser never saw the fused heading; and if the user then saved anything from the Planner (even just editing Project Targets), the Planner wrote back its incomplete section list and permanently deleted the un-parsed sections from disk. Fixed at three layers: (1) `GET /api/documents/outline` now heals `---## ` fusions in the raw file *before* any parsing and writes the repaired content back to disk immediately, so YAML values are always read correctly and the file is safe before any subsequent Planner save; (2) `_reconstruct_outline` always inserts a newline between the YAML block and preamble so the fusion cannot be created again; (3) `_parse_outline_sections` normalizes bodies that start with `## ` so sections at position zero are never silently absorbed into the invisible preamble. Eleven regression tests added.

---

## [1.0.5] - 2026-05-27

### Added

- **Spelling corrections in the right-click menu.** Right-clicking a word in the editor now leads with a **Spellcheck** section when the word is misspelled, listing dictionary-backed corrections above the Thesaurus synonyms. Previously the thesaurus popover suppressed the browser's native right-click menu, so a misspelled word showed "No synonyms found" with no way to fix the spelling. Corrections come from a bundled offline dictionary (Hunspell `en` via `nspell`), click a suggestion to replace the word with its capitalization preserved. The red squiggle still comes from the system spell checker; the Spellcheck section only appears when the dictionary has suggestions, so it stays out of the way for invented character and place names.

### Fixed

- **OpenRouter API key no longer lost when installing an update.** Settings were written with a plain truncate-then-write, so if the backend was force-killed mid-write during a patch install, `settings.json` could be left empty and the saved API key silently wiped (falling back to blank defaults). Saves are now atomic (write to a temp file, then `os.replace`), a one-generation `settings.json.bak` is kept, and on startup a corrupt or empty `settings.json` is automatically recovered from the backup before falling back to defaults. A fresh install on a new machine still starts with no key, as intended.

---

## [1.0.4] - 2026-05-20

### Quick Fix

- **Per User feedback: OpenRouter error messages are now actionable.** Rate-limit (429), insufficient-credits (402), invalid-key (401), and service errors (5xx) from OpenRouter now show a plain-English message explaining what happened and what to do, instead of a raw HTTP status code or generic "AI request failed" text. Affects all AI features (Smart Advisor, Writing Companion, Profile Builder, scene/chapter summaries, and all editor-pass tools).

---

## [1.0.3] - 2026-05-15

### Added

- **Global Search + Replace (Ctrl+Shift+F).** Find any word or phrase across every file in the project -- manuscript chapters, notes, profiles, summaries, and arcs -- in a single modal. Results are grouped by file with three lines of context per match; each hit is individually checkboxable so you can replace selectively. Three replace modes: Replace (one hit), Replace in File (all checked hits in that file), Replace All (everything checked). Every replace operation first snapshots the touched files to `.storythread/snapshots/global-replace/<timestamp>/` so the in-modal Undo button can restore them. If the currently open chapter is modified, the editor reloads it automatically and shows a brief banner. Toggles for case-sensitive and whole-word matching.

- **Thesaurus.** Right-click (or select + right-click) a word in the editor to open a thesaurus popover. Synonyms come from the Datamuse API (free, no key required). Click a synonym to replace the word in place. Built as a CodeMirror context-menu extension paired with a React popover.

- **Export: TXT, DOCX, and EPUB.** The full-manuscript and snapshot exports now write to four formats. TXT strips Markdown formatting and writes plain text. DOCX uses `python-docx` and preserves headings and paragraphs. EPUB uses `ebooklib` with proper chapter structure. All three appear in the existing Export modal alongside the original Markdown option.

- **Reader Mode.** A clean two-page spread view of the full manuscript rendered as formatted prose. No editor chrome, no toolbars -- just typography tuned for proofreading and enjoyment (line height, margins, readable font size). Keyboard shortcut to enter and exit; pure frontend, no backend changes.

- **Writing Progress tracking.** A project-completion gauge in the left panel (below the project title, above the navigation) shows overall progress as a `[==== ] N%` bar against a target derived from the project's `story_type` or, when present, from the Outline's new YAML frontmatter block. Clicking the gauge expands a slide-over panel (constrained to the left panel) with the per-segment breakdown: Manuscript 50% / Outline 10% / Profiles bucket 30% / Notes 10%, with manuscript-heavy fallback when no Outline frontmatter exists. Loose name matching against `expected_characters`, `expected_locations`, `expected_lore`, and `expected_relationships` lists in the outline drives the profiles bucket and surfaces unresolved Outline names so the writer can spot typos. Serial fiction projects show a placeholder card instead of the gauge -- the percentage model doesn't apply to chapter-self-contained serial work yet.

- **Daily goal tracker.** Inside the gauge's slide-over, a "Today" section shows words written and task credits earned against a target chosen in Settings (Newbie 500 / Beginner 750 / Novice 1,250 / Amateur 2,500 / Experienced 4,000 / Full-time 7,500 / Professional 10,000 words per day, with matching task quotas). A 7-day sparkline shows hit/miss per day with tooltips for word and task totals. A "task" is one tracked file edited per day; running a Smart Advisor Default pass on a chapter also earns it a task credit, as does running all three category passes (Readability + Structure + Context) separately on the same chapter the same day.

- **Outline Planning view.** Clicking "Outline" in the left nav now opens a dedicated planning screen instead of the raw Markdown editor. The top card shows project targets (word count, expected characters / locations / lore / relationships) as editable chip-tag inputs. Each `## Heading` section in the outline is rendered as a collapsible card with an auto-resizing textarea. Ctrl+S saves; a dirty indicator tracks unsaved changes. A "Raw view" button escapes to the Markdown editor for freeform editing.

- **Outline YAML frontmatter.** New outlines now start with a YAML frontmatter block at the top recording `target_word_count`, `expected_characters`, `expected_locations`, `expected_lore`, `expected_relationships`, and a `chapters` list for optional per-chapter word targets. Older outlines without frontmatter keep working -- the gauge falls back to per-story-type defaults (novel 90k, novella 30k, novelette 13k, short story 6k).

- **Settings: Writing Progress section.** New "Writing Skill Level" dropdown drives the daily word and task targets. New "Day Rollover" toggle: Midnight (default) or Night Owl (4 AM) for writers who work past midnight.

### Changed

### Fixed

- **Backend sidecar not killed on app close.** Closing the app window left `storythread-backend.exe` running and holding port 8000. The root cause was that `CommandChild::kill()` in tauri-plugin-shell v2 queues the kill through the async runtime -- by the time the window-destroyed event handler returns, the runtime has begun shutting down and the kill task never executes. The fix replaces the async kill with a synchronous `taskkill /F /IM` call that blocks until the process is dead before the handler returns. The app now reliably terminates the backend on every clean close.

- **Stale sidecar port conflict on app start.** On startup, the app now kills any orphan sidecar holding port 8000 from a previous unclean exit before spawning its own, instead of failing to bind and erroring out.

- **Ko-fi button and close button displayed garbled characters.** The ☕ and ✕ characters in the About panel were stored as UTF-8 bytes but read by the editor as Latin-1, producing `â˜•` and `âœ•`. Replaced with a lucide `Coffee` icon and the literal `✕` character.

---

## [1.0.1] - 2026-05-14

A focused tuning release. Smart Advisor produces noticeably more usable feedback on raw drafts, the chat-and-context workflow gains chapter and scene summaries, and the interface gets a font-size control for writers who want larger text. Plus a Markdown-aware copy from AI replies that lands ready-to-paste in the editor.

### Added

- **Context Smart Advisor: Attach Profiles button and info hint.** The Context category button in the Smart Advisor bar now includes an "Attach Profiles" button that opens the chip picker directly from the toolbar. An (i) info popover explains that Context requires attached character, relationship, location, or lore profiles to find inconsistencies. Both elements disappear once at least one profile is attached.

- **Smart Advisor: selection-scoped passes.** Highlight a paragraph or scene before clicking Readability / Structure / Context and the pass runs only on that selection instead of the whole chapter. A scope pill on the toolbar shows "full chapter" (default) or "selection (N words)" (amber) live as you change selection. A 5-word floor prevents accidental single-word selections from narrowing the pass.
- **Chapter and Scene summaries as context chips.** The Attach Context panel now exposes Chapter Summary and Scene Summary tabs. The Scene Summary tab is a collapsible tree grouped by chapter with the current chapter's group auto-expanded. Two new backend endpoints â€” `GET /api/documents/chapter-summaries` and `GET /api/documents/all-scene-summaries` â€” make the lists load in a single round trip.
- **UI font scale.** New "Interface size" control in Settings â†’ Appearance with four steps (Default / Larger / Larger+ / Largest). Drives the root `<html>` font-size so every Tailwind rem-based utility scales proportionally â€” menus, sidebars, Settings, About, profile labels, and so on.
- **Separate text-entry sizing.** Writer-facing text input surfaces (chat boxes, profile description and notes fields, scene-summary editing) scale on a more aggressive ladder than chrome (16 / 17 / 19 / 22 px) because +1 px increments past 17 px were imperceptible in those surfaces in practice. Driven by a `--text-entry-size` CSS variable applied via a new `.text-entry` class.
- **Markdown-preserving copy from AI chat.** Selecting text in a chat bubble and copying now writes Markdown to the clipboard instead of plain text. Bold becomes `**bold**`, italics become `*italic*`, underline becomes `<u>underline</u>`, lists keep their `-` / `1.` prefixes, blockquotes keep their `>` prefixes, inline code keeps its backticks. Color and other purely-visual styling are stripped. Both the Writing Companion and Profile Builder chats are covered through the shared `ChatMarkdown` component.

### Changed

- **Smart Advisor: issue ceiling raised.** The "3 to 12 issues per pass" cap that suited revision-stage prose was suppressing useful feedback on raw drafts. The system prompt now calibrates the expected count by draft stage (polished: 0-5; revision-stage: 10-25; raw first draft: 30-50) and explicitly tells the model not to artificially cap the list. Quality remains a tiebreaker on minor cosmetic flags, not a numeric cap.
- **Smart Advisor: in-context suggestions.** Every suggestion now has to improve the passage in the actual context where the quote appears, not in isolation. The prompt instructs the model to re-read the sentences immediately before and after each flagged quote and reject suggestions that create new repetition, restate adjacent content, break a metaphor or callback, or clash with surrounding tone or pacing. Includes a worked example illustrating the failure mode.
- **AI continuation prompt rewritten.** The "WHEN THE WRITER ASKS TO CONTINUE" rules used to be a 7-bullet list. They've been replaced with explicit How-to-start and How-to-stop sections that forbid the specific failures writers were hitting: preambles like "Here's the continuation,", recap or restatement of the last paragraph, unrequested time jumps or scene breaks, premature closing beats that artificially end the scene, and editorial sign-offs after the prose. The frame is now "this is a JOIN, not a new scene" â€” the first word of the output is the next word of the story, and the chunk ends mid-flow by default.

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

[Unreleased]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.11...v1.1.0
[1.0.11]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.1...v1.0.3
[1.0.1]: https://github.com/StoryThread-Dean/StorythreadStudio/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/StoryThread-Dean/StorythreadStudio/releases/tag/v1.0.0
