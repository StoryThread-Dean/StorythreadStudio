# Storythread Studio

A local-first Markdown writing app for fiction writers. The writer does the drafting; the AI works as a reviewer, editor, and brainstorming partner — never a ghostwriter.

> Storythread Studio runs entirely on your machine. Your manuscript, profiles, and notes are plain Markdown files in a folder you control. Nothing is uploaded anywhere except the AI requests you explicitly trigger, and those go directly from your computer to your chosen AI provider.

---

## What it does

- **Markdown editor** with focused, distraction-free writing in a serif typeface (Tauri + CodeMirror 6)
- **Profile system** for characters, relationships, locations, and lore — with structured trait blocks and importance levels
- **Smart Advisor** runs Readability, Structure, and Context passes directly over your chapter. Findings appear as colored inline highlights anchored to the exact passages the AI quoted; click any highlight for an explanation, a word-level diff against the suggested rewrite, and accept / ignore / re-cast controls (Rewrite, Expand, Shorten, Describe, Rephrase, Add Sensory Detail, Change Tone). Subcategory toggles per category let you scope a pass (e.g. Readability → Grammar + Clarity only)
- **Writing Companion** chat panel for open conversational help — brainstorming, voice work, ad-hoc questions
- **Series support** — multi-book projects with shared canonical profiles and per-book character arcs
- **Export** — full manuscript, dated snapshots, optional inclusion of summaries, notes, and profiles
- **Light + dark themes**

## Requirements

- Windows 10 or 11
- An [OpenRouter](https://openrouter.ai/) API key for AI features ([It's fairly easy to set up](https://www.youtube.com/watch?v=nhwWwVN22nk))
- ~60 MB free disk space for the installer

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
2. Open Settings (gear icon) and paste your OpenRouter API key
3. Pick a default model — start with something cheap like `deepseek/deepseek-chat` and upgrade if you want richer prose
4. Click **New Project** on the home screen and choose a folder

Your project is just a folder. You can back it up, sync it to a private cloud drive, or commit it to a personal git repo — Storythread won't touch any of that.

## Updates

The app checks for updates on launch. If a new version is available, you'll see a banner with a summary of what changed and an explicit **Download & Install** button. Updates never download or install automatically — your call, every time.

## Donations

Storythread Studio is free and will stay free. Donations cover the Claude API costs of ongoing development and let me keep adding features without putting them behind a paywall.

- [GitHub Sponsors](https://github.com/sponsors/StoryThread-Dean) — recurring or one-time
- [Ko-fi](https://ko-fi.com/storythreadstudio) — one-time tips, no platform cut

If you've donated, you can let the app know in the About panel and the donation reminders will stop. There's no verification — it's an honor-system flag for your own UX.

## License

Apache License 2.0. See [LICENSE](LICENSE) for the full text.

You can use, modify, and redistribute Storythread Studio. If you redistribute a modified version, please change the name and bundle identifier so users don't confuse your fork with the upstream project.

## Project documentation

The design docs and roadmap live in this repo for transparency:

- [`docs/product-scope.md`](docs/product-scope.md) — core goals, writing philosophy, locked product rules, in/out-of-scope
- [`docs/architecture.md`](docs/architecture.md) — three-layer architecture, dual storage model, folder layout, API surface
- [`docs/features.md`](docs/features.md) — what the product does today, in detail
- [`docs/roadmap.md`](docs/roadmap.md) — Scheduled, Proposed, and Nice-to-Have features
- [`docs/RELEASING.md`](docs/RELEASING.md) — release runbook for maintainers
- [`CHANGELOG.md`](CHANGELOG.md) — shipped changes per version
- [`CLAUDE.md`](CLAUDE.md) — guidance for AI coding assistants working on this codebase

## Contributing

Issues and pull requests are welcome. The codebase is intentionally written for a learning audience: heavily commented, no clever one-liners, no exotic build chains. If you're a beginner reading the source to learn how a Tauri + React + FastAPI app fits together, that's by design.

For larger changes, please open an issue first to discuss direction.

## Acknowledgements

Built with [Tauri](https://tauri.app/), [React](https://react.dev/), [CodeMirror](https://codemirror.net/), [FastAPI](https://fastapi.tiangolo.com/), and [OpenRouter](https://openrouter.ai/).
