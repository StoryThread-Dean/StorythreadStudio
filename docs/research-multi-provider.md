# Research: Alternative AI Providers (local models + NanoGPT)

Provider research notes (2026-07-13). Companion to the "NanoGPT provider"
(Scheduled) and "Local model providers" (Proposed) entries in
[`roadmap.md`](roadmap.md).

## The good news: everything is OpenAI-compatible

Every provider worth adding speaks the exact chat-completions dialect that
`backend/app/ai/openrouter.py` already speaks via httpx. The entire feature
reduces to parameterizing our existing client with
`(base_url, api_key, default_headers)` per provider:

| Provider | Base URL | Auth | Model listing |
|---|---|---|---|
| OpenRouter (today) | `https://openrouter.ai/api/v1` | Bearer key | `GET /models` |
| **NanoGPT** | `https://nano-gpt.com/api/v1` | Bearer key | `GET /models` -> `{data:[{id,name,context_length}]}` |
| **Ollama** | `http://localhost:11434/v1` | **none** | native `GET /api/tags` -> `{models:[{name,...}]}` |
| **LM Studio** | `http://localhost:1234/v1` | none | `GET /v1/models` |
| **llama.cpp / LocalAI** | `http://localhost:8080/v1` | none | `GET /v1/models` |
| Custom OpenAI-compatible | user-supplied | optional Bearer | `GET /v1/models` (path overridable) |

Implementation notes:

- **One dispatch point.** Tag every model with its provider in a single flat
  model list and switch on the provider at request time. Our equivalent: a
  `provider` field in settings + a client factory keyed by provider, sitting
  *below* the existing content-mode / allowlist validators (they stay
  provider-agnostic).
- **Ollama's two quirks:** model listing is native `/api/tags` (not
  `/v1/models`), and model names carry a `:latest` suffix worth stripping
  for display. If the user overrides the base URL, derive the tags URL by
  stripping `/v1`.
- **Tolerant model-list normalization:** accept `{data:[...]}`, `{models:[...]}`,
  or a bare array; take the id from `id || name || model`. Local servers are
  inconsistent.
- **Reasoning-model cleanup:** local DeepSeek-R1-style models emit
  `<think>...</think>` blocks inline. Strip them before display -- fits
  naturally next to our em-dash sanitizer layer. See the full breakdown below.
- **Fallback model:** if a local model list fetch fails, offer a single dummy
  "Local Model" entry so the provider stays usable.
- **Connection-test UX:** for local servers, send
  `"Reply with exactly this text: local test ok"` at temperature 0 with a
  60s timeout and show the model's actual reply (or the HTTP error body)
  in a callout. Much more convincing than a bare status code. Saving a key
  triggers an immediate model fetch, which doubles as a connection test for
  hosted providers.
- **Streaming not required.** NanoGPT / Ollama / LM Studio all accept
  `stream: false`, so provider support does NOT depend on the (parked) SSE
  roadmap item.

Architecture rule (locked in product-scope.md): all AI calls stay
backend-mediated. API keys never live in the WebView.

## Sketch of our implementation

1. Settings: `ai_provider` (`openrouter` default | `nanogpt` | `local` |
   `custom`), plus per-provider key/base-URL fields. Local adds a runtime
   preset dropdown (Ollama / LM Studio / llama.cpp / custom URL).
2. `openrouter.py` -> generalize into a provider-aware client module: same
   `run_chat` / `run_completion` / `list_models`, parameterized by a provider
   config resolved from settings. No auth header for local providers.
3. `list_models` per provider; local models get `is_free=True`,
   `is_moderated=False`, price 0 (tier/content filters then behave sanely).
4. Routing guardrails: content-mode provider lists in `modelFiltering.ts` are
   OpenRouter-slug based -- local/NanoGPT models need a bypass or their own
   rule (a local model is by definition unmoderated).
5. Sanitizer: add `<think>` block stripping.
6. Settings UI: per-provider sections + the test-message connection check.

Estimated effort: the backend client generalization is the bulk; the request
paths are unchanged. Medium complexity, roughly 3-5 days. NanoGPT first (it
builds the provider plumbing), local runtimes second.

## Local reasoning models -- full breakdown

### What they are

"Reasoning" (or "thinking") models are trained to produce an explicit
chain-of-thought BEFORE the final answer: the model first writes out its
working ("the writer asked X, the profile says Y, so the inconsistency
is..."), then writes the actual reply. Examples runnable locally: the
DeepSeek-R1 distills (1.5B-70B, popular on Ollama), Qwen's QwQ / Qwen3
"thinking" variants, and various fine-tunes of both.

### How the trace reaches us -- hosted vs. local

- **Hosted (OpenRouter)**: the trace arrives OUT-OF-BAND in a separate
  `message.reasoning` response field, only when requested via the `reasoning`
  request parameter. This is what our Reasoning toggle already consumes.
  The reply text stays clean.
- **Local (Ollama / LM Studio / llama.cpp)**: the server passes the raw model
  output through, so the trace arrives INLINE in the content itself, wrapped
  in `<think> ... </think>` tags, followed by the real answer. (Newer Ollama
  versions can separate it into a `thinking` field when asked, but the inline
  form is the reliable common denominator across runtimes and quantized
  fine-tunes.)

### Why this matters for Storythread specifically

1. **Chat display**: unstripped, the writer sees a wall of internal monologue
   before every reply.
2. **JSON endpoints break**: editor-pass, audit-importance, extract-traits
   etc. parse the response as JSON. A `<think>` preamble before the `{`
   makes parsing fail -- the pass would silently return zero issues.
3. **History pollution**: think blocks must not be sent back as conversation
   history (they bloat context and confuse subsequent turns).

So the non-negotiable piece is a sanitizer-layer strip: remove
`<think>...</think>` (multiline, and tolerate an unclosed tag from a
truncated response) before any parsing or display. Sits naturally next to
the em-dash sanitizer.

### How we can USE it (beyond just stripping)

- **Feed the Reasoning toggle**: instead of discarding the stripped trace,
  return it in the existing `reasoning` response field. The collapsible
  "Reasoning" block we shipped for OpenRouter then works identically for
  local models -- one UI, two sources.
- **Route analysis tasks to them**: reasoning models trade tokens and time
  for materially better instruction-following on analytical work. Best
  Storythread fits: Check Consistency, Importance Audit, Context passes
  (timeline, scene goal). Poor fits: chat and Draft/Enhance prose, where the
  thinking time hurts and prose quality doesn't improve much.
- **Cost model is different locally**: tokens are free but TIME is not --
  think blocks commonly run hundreds to thousands of tokens, which on
  consumer hardware means noticeable extra seconds per request. Worth a UI
  hint ("reasoning models respond slower") rather than any hard limit.

### Implementation checklist (when local providers land)

1. Sanitizer: `strip_think_blocks()` applied to every local-provider
   response before sanitize()/JSON parsing; tolerate unclosed tags.
2. Optionally capture the stripped trace and surface it via the existing
   `reasoning` field + toggle.
3. Never include think content in outgoing conversation history.
4. Capability detection: local model lists don't declare reasoning support
   (no `supported_parameters` like OpenRouter) -- detect by presence of a
   `<think>` block in the response instead of gating the toggle upfront.

## Related feature ideas surfaced during this research

Worth considering (fits our philosophy):

- **User-editable prompt templates** with `{{variable}}` placeholders,
  per-prompt sampling settings, and JSON import/export packs. The most
  requested power-user feature class in AI writing tools. **Now on the
  roadmap (Proposed)** with a beginner-safe design: locked DEFAULT prompt +
  Advanced mode with named Custom prompts per feature.
- **Multi-model comparison**: run the same request against several models
  side-by-side and pick the best output. Natural fit for Draft/Enhance.
- **Per-chapter POV metadata** injected into prompts (we track POV only as
  advisor feedback today).
- **Drafts holding area**: saved alternate AI generations per chapter.
- **One-file backup/export-import** of app-level content (prompts, settings)
  excluding API keys.
- **Reasoning-effort control per request** (none/medium) -- a natural
  extension of the Reasoning toggle.
- **Theme presets / custom palette editor.**

Rejected -- conflicts with our locked rules:

- **Lorebook-style auto-matching** -- implicit context injection from tags
  matched near the cursor. Violates our explicit-context-attachment rule.
- **Inline AI blocks / agent pipelines that write prose into the document** --
  violates our write boundary (AI output goes to the side panel; the writer
  places it).
- **Autosave** -- locked out by product rules.
- **Client-side AI calls** -- keys in the WebView; permanently out of scope.
