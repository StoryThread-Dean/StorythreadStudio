# Storythread Studio

A local-first Markdown writing app for fiction writers. The writer does the drafting; the AI works as a reviewer, editor, and brainstorming partner -- never a ghostwriter.

> Storythread Studio runs entirely on your machine. Your manuscript, profiles, and notes are plain Markdown files in a folder you control. Nothing is uploaded anywhere except the AI requests you explicitly trigger, and those go directly from your computer to the AI provider you chose -- or to a model on your own machine, if that is what you set up.

---

## What it does

- **Markdown editor** with focused, distraction-free writing in a serif typeface (Tauri + CodeMirror 6)
- **The Outline** -- a second editor for planning the book, on the same typing surface you draft chapters in. It opens as a short worksheet -- title, genre, tone, word and chapter targets -- and everything past that is opt-in: a drawer of nineteen ready-made sections (Premise, Central Conflict, Crisis, Climax, act beats, world rules, a chapter plan) added one at a time, each with a prompt and an example to delete. A section you already have is greyed out. **Show me how** walks all twenty-one pages with The Lord of the Rings, Harry Potter and Dungeon Crawler Carl answering each one
- **The Weave** -- your story world as a linked, time-aware model rather than a folder of static profiles. It is the centre of the app; see below
- **Smart Advisor** runs Readability, Structure, and Context passes directly over your chapter. Findings appear as coloured inline highlights anchored to the exact passages the AI quoted; click any highlight for an explanation, a word-level diff against the suggested rewrite, and accept / ignore / re-cast controls (Rewrite, Expand, Shorten, Describe, Rephrase, Add Sensory Detail, Change Tone). Subcategory toggles let you scope a pass, for example Readability to Grammar and Clarity only
- **Writing Companion** chat panel for open conversational help, plus **Draft** mode for writing scene prose from a premise you give it, and **Enhance** mode for reworking a passage you highlight
- **Profile Builder** for characters and everything else in your world: structured trait blocks with importance levels, a fantasy and real-world name generator, and two character templates so a background character does not cost you a full page. Personality types are taken a line at a time rather than as one paragraph, a character can hold several story roles at once from a list of around sixty, and every entry can record the other names it answers to -- James is Jim, Ashfall is the burned city -- so all of them resolve to one profile
- **Series support** -- multi-book projects with shared canonical profiles and per-book character arcs
- **Export** -- full manuscript, dated snapshots, optional inclusion of summaries, notes, and profiles, and the Weave itself as Markdown for a person, JSON for a program, or CSV for a spreadsheet
- **Audiobook Converter** -- turn a finished manuscript into a real audiobook: per-chapter MP3s, a combined MP3, and an M4B with navigable chapter marks. Import from DOCX, EPUB, PDF, Markdown, TXT, or a Storythread project. Narrate the whole book **free and offline** with a local voice engine (54 voices, downloaded on demand), then optionally regenerate once with a paid premium voice when the book is final, with the exact cost quoted before anything is spent. Guided walkthroughs help place pauses, fix the words the narrator would mispronounce, and give individual characters their own voices
- **Passage / Dialogue Check** -- hear any passage read aloud while you write. Free, offline, and often the fastest way to catch a repeated word or a sentence that only parses on the second read
- **Themes and text size** -- a charcoal workspace, a warm paper one, or **your own colours**: a Custom theme lets you set every one of the fifty-six colours the app is built from, with a colour wheel, your system colour picker, and a live readability check on the text shades. Size the app and your manuscript separately -- **Interface size** for menus and panels, **Editor text size** for your prose (in points, plus `Ctrl +` / `Ctrl -` while you write) -- alongside your own line spacing and paragraph spacing. The Audiobook Converter carries its own Charcoal / Paper / Custom theme, independent of the writing side

---

## The Weave

Most writing apps store a character as a description: one unchanging paragraph, true from page one to the last page. That is wrong for any story where something happens.

The Weave replaces it. Your world is a set of **Threads** -- fourteen kinds ship (characters, relationships, locations, lore, factions, religions, ruling authorities, deities, creatures, cultures, objects, concepts, events, languages) and any kind you invent behaves exactly like the ones we ship. Everything lives as Markdown in a `codex/` folder you can read, edit, and back up without the app.

Three things make it more than a folder of profiles:

**Facts are anchored in time.** A Thread holds facts pinned to points in the story, each with three switches: *from when* it is true, *whose* truth it is, and *when the reader learns it*. That third switch is what makes this app's founding example recordable -- a heroine who believes her father died until chapter fifteen. Ask for help with a chapter three scene and the AI is told her mistake. Ask about chapter sixteen and it is told what she now knows. It cannot spoil the reveal early, because it was never given it.

**Traits can be true for only part of the book.** A protagonist who is slight and unremarkable in chapter one and powerfully built after her transformation has two honest physical descriptions, and neither is true of the whole book. Tick the chapters each one holds in, and the AI gets the version that matches the chapter you are writing rather than both at once.

**Connections have to say why.** Two Threads can be tied with one of about seventy relations, and a connection can never be saved without a reason in your own words. `A -- connected to -- B` spends prompt budget to say nothing your prose did not already show; "she is hiding the theft from him" is the scene.

### What you actually do with it

- **Weaving** is a guided walkthrough that compares your manuscript against your world and asks about what it finds: names with no entry, entries with nothing written in them, two facts that contradict each other, connections you have not described. It counts everything first using arithmetic rather than a model, so the number you are shown is real and the pass itself costs nothing.
- **The Profile Extractor** reads your manuscript and proposes what each entry should say. It is a draft to rewrite, not an answer: nothing is pre-ticked, there is no accept-all, and every proposal sits beside what that entry currently says. Adding never rewrites your words; replacing is a separate button because it is the only one that can lose them.
- **The map** draws your world at any point in the story. Scrub to chapter four and you see chapter four: entries not yet introduced are hidden, entries elsewhere in the book are greyed out, and connections the reader has not learned about are withheld. You can work from it too -- open an entry, say which chapters it appears in, edit its facts, connect it to something else.
- **World context** is what stops you pasting profiles into the chat. The app assembles a brief from your world as of the chapter you are in, and shows the count and the rough cost before you send anything. **Inspect** shows every word of it, an x drops any Thread, a whole category can be excluded, and one switch turns it off entirely. Nothing is transmitted until you start an AI action.

---

## AI providers

Storythread is not tied to one service, and one of the three options costs nothing and sends nothing off your machine.

| Provider | What it is |
|---|---|
| **OpenRouter** | One API key, hundreds of models, content-mode routing for mature and explicit work. The recommended starting point |
| **NanoGPT** | An alternative pay-as-you-go service with its own model catalogue |
| **Local model** | A model running on your own computer, through LM Studio, Ollama, or anything else that speaks the OpenAI API. No key, no account, and no request ever leaves the machine. Restricted to loopback and private addresses on purpose |

**Model Roles** let you send different jobs to different models, because they are not the same job. Drafting prose wants a strong and expensive model; summarising a chapter does not; the Profile Extractor mostly needs a large context window. Eight roles, each assignable to any provider and model, each falling back to your Default Model when you have not set one. A role you configure that cannot run **refuses and says so** rather than quietly substituting a model you did not choose.

Prompt caching is used where the provider supports it, and the Model Roles screen tells you which of your assignments actually benefit. That is a claim about your money, so a test checks it against the code rather than trusting the label.

---

## Requirements

- Windows 10 or 11
- For AI features, **one** of:
  - an [OpenRouter](https://openrouter.ai/) API key ([fairly easy to set up](https://www.youtube.com/watch?v=nhwWwVN22nk))
  - a [NanoGPT](https://nano-gpt.com/) API key
  - a model running locally, through LM Studio, Ollama, or any other OpenAI-compatible endpoint -- no key and no account at all
- No key is needed for the audiobook converter's local narration, the Passage Check, or the Weaving walkthrough's scan. All three run entirely on your machine
- ~60 MB free disk space for the installer
- For audiobooks, two extra components download from inside the app the first time you need them: the local voice engine (~372 MB) and the audio assembler (~139 MB). Neither ships in the installer, so writers who never make an audiobook never download them

## Install

Download the latest installer from the [Releases page](https://github.com/StoryThread-Dean/StorythreadStudio/releases) and run the `.msi` file.

### About the SmartScreen warning

Storythread Studio is an independent open-source project and **is not yet code-signed**. When you run the installer, Windows SmartScreen will show a warning that says "Windows protected your PC" or similar. This is normal for indie software without a paid signing certificate.

To proceed:

1. Click **More info** in the SmartScreen dialog
2. Click **Run anyway**

A code-signing certificate costs $100-300 per year. If donations exceed that monthly threshold, a certificate will be purchased so the warning goes away for everyone.

You can verify the installer's integrity by checking the SHA-256 hash listed on the Releases page against the file you downloaded.

## First run

1. Launch Storythread Studio
2. Open Settings (gear icon) and either paste an API key or point the app at a model running on your machine
3. Pick a default model. Start with something cheap like `deepseek/deepseek-chat` and upgrade if you want richer prose. You can assign specific models to specific jobs later under **Model Roles**
4. Click **New Project** on the home screen and choose a folder
5. Write a chapter or two before opening the Weave. It compares your world against your manuscript, so it has the most to say once there is a manuscript, and you can ignore it entirely until then

Your project is just a folder. You can back it up, sync it to a private cloud drive, or commit it to a personal git repo -- Storythread won't touch any of that.

## Updates

The app checks for updates on launch. If a new version is available, you'll see a banner with a summary of what changed and an explicit **Download & Install** button. Updates never download or install automatically -- your call, every time.

## Donations

Storythread Studio is free and will stay free. Donations cover the Claude API costs of ongoing development and let me keep adding features without putting them behind a paywall.

- [GitHub Sponsors](https://github.com/sponsors/StoryThread-Dean) -- recurring or one-time
- [Ko-fi](https://ko-fi.com/storythreadstudio) -- one-time tips, no platform cut

If you've donated, you can let the app know in the About panel and the donation reminders will stop. There's no verification -- it's an honor-system flag for your own UX.

## License

Apache License 2.0. See [LICENSE](LICENSE) for the full text.

You can use, modify, and redistribute Storythread Studio. If you redistribute a modified version, please change the name and bundle identifier so users don't confuse your fork with the upstream project.

## Project documentation

The design docs and roadmap live in this repo for transparency:

- [`docs/product-scope.md`](docs/product-scope.md) -- core goals, writing philosophy, locked product rules, in/out-of-scope
- [`docs/architecture.md`](docs/architecture.md) -- three-layer architecture, dual storage model, folder layout, API surface
- [`docs/features.md`](docs/features.md) -- what the product does today, in detail
- [`docs/roadmap.md`](docs/roadmap.md) -- Scheduled, Proposed, and Nice-to-Have features
- [`docs/weave-spec.md`](docs/weave-spec.md) -- the full Weave specification: the world model, anchors, connections, Weaving, context assembly, Model Roles
- [`docs/audiobook-converter-spec.md`](docs/audiobook-converter-spec.md) -- the full audiobook converter specification, including the live listening findings behind its pacing and pronunciation rules
- [`docs/RELEASING.md`](docs/RELEASING.md) -- release runbook for maintainers
- [`CHANGELOG.md`](CHANGELOG.md) -- shipped changes per version
- [`CLAUDE.md`](CLAUDE.md) -- guidance for AI coding assistants working on this codebase

## Contributing

Issues and pull requests are welcome. The codebase is intentionally written for a learning audience: heavily commented, no clever one-liners, no exotic build chains. If you're a beginner reading the source to learn how a Tauri + React + FastAPI app fits together, that's by design.

For larger changes, please open an issue first to discuss direction.

## Acknowledgements

Built with [Tauri](https://tauri.app/), [React](https://react.dev/), [CodeMirror](https://codemirror.net/), [FastAPI](https://fastapi.tiangolo.com/), [OpenRouter](https://openrouter.ai/), and [Kokoro](https://github.com/hexgrad/kokoro) for offline narration.
