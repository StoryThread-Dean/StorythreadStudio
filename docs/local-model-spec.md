# Local Model Support -- Specification

**Status:** partly shipped (v1.1.1), completed in v2.0.3. Sections are numbered
so tests can cite them, in the style of `docs/audiobook-converter-spec.md`.

**What this is.** Storythread Studio can send its AI work to a model running on
the writer's own machine -- Ollama, LM Studio, or anything else speaking an
OpenAI-compatible HTTP API -- instead of to a hosted provider. No key, no
account, no request leaving the room. Any of the eight Model Roles can be
pointed at it, one role at a time, so a writer can draft locally and critique
with a hosted model, or run the whole app offline.

**How to read this.** Numbered sections are the CONTRACT. Where this document
and the code disagree, **the code is wrong** until the writer rules otherwise,
and a behaviour change belongs in the same commit as the change to this file.

**Why this document exists at all.** Local support was built across v1.1.1
without a spec, and the audit on 2026-08-23 found four defects in it, one of
which means an entire documented option cannot work (see 3.1). Every one of the
four fails silently. That is the same failure the Weave's missing spec produced,
and this file is the answer to it.

---

## 1. Scope

### 1.1 What this feature is

A **transport**. The writer runs a model server; the app talks to it. Everything
above the transport -- roles, prompts, the write boundary, the em dash rule, the
Weave's brief -- is unchanged and provider-blind by design.

### 1.2 What this feature is NOT, and the reason is worth keeping

**The app does not install, download, update, or manage a local LLM.** It does
not ship one, and it does not offer to fetch one.

This needs saying out loud because the repository contains a working, thoroughly
tested precedent that argues the other way.
`backend/app/audiobook/local_worker.py` is a complete component manager: a
pinned release verified by SHA256, a background install thread with
poll-friendly progress, verify-before-trust, a polluted-directory replace, an
`installed.json` version gate, a free-port spawn, a health wait, a lockfile, and
a clean `remove_worker`. It works. A future session will read it, see the shape,
and be tempted.

It is the wrong precedent here, and the difference is size and ownership.
`kokoro-worker` is a 20-30 MB frozen binary with bundled voice models that only
this app uses. A local LLM is hundreds of megabytes of runtime plus
multi-gigabyte weights that the writer chooses, updates on their own schedule,
shares with other applications, and very often already has installed. Managing
that would mean owning a model registry, disk-space negotiation, GPU and driver
detection, and a second updater -- an entire product, bolted to the side of a
writing app.

**What IS worth borrowing from `local_worker.py`:** the shape of
`installed_state()` (installed / mode / running / health / version) as the model
for a richer local-connection status than a boolean, and the discipline of
`WorkerUnavailableError` -- every message says what is wrong AND what fixes it.

### 1.3 Addresses are restricted, on purpose

`local` accepts `localhost`, `*.local`, and loopback / private / link-local IP
literals only. A public address is **refused with the rule explained**, never
silently accepted. This is not a security-theatre gesture: the provider's whole
promise to the writer is "nothing leaves the room", and a provider that would
happily post a manuscript to an arbitrary internet host cannot make it.

A separate `custom` provider for arbitrary OpenAI-compatible URLs is legitimate
future work (see 12.1). It must be a **different entry with its own warning**,
never a relaxation of this one.

---

## 2. What is already built

Recorded so nobody rebuilds it. Verified against the code on 2026-08-23.

| Piece | Where |
|---|---|
| `LOCAL` provider config: `endpoint_from_settings=True`, no key required, `strip_think_blocks=True`, no fallback model | `backend/app/ai/providers.py:106-132` |
| Address validation, the allowed-host rule, and its explanation | `backend/app/ai/local_endpoint.py:46-124` |
| `normalize_base_url` -- adds exactly one `/v1` for openai style, idempotent; keeps the bare root for ollama style | `local_endpoint.py:126-145` |
| Settings keys `local_base_url` / `local_api_style`, with a bad address raising 400 rather than being dropped | `settings_store.py:111-124`, `routers/settings.py:120-143` |
| Model discovery, provider-parameterised: `GET /api/ai/models?provider=local`, patching `base_url` and `model_list_style` at request time | `routers/ai.py:297-350` |
| Ollama native `GET /api/tags`, and the tolerant normaliser behind both styles | `ai/openrouter.py:96-108,188-260` |
| `is_free=True` for local models only, with the reasoning for why "no pricing" means something different here | `ai/openrouter.py:171-185` |
| Test Connection distinguishing a refused address, a dead server, and a server answering the OTHER dialect | `routers/settings.py:292-357` |
| Role resolution treating the ADDRESS as the equivalent of a key, and refusing rather than substituting | `ai/roles.py:229,349-404` |
| `<think>` stripping, before JSON parsing and before history storage | `ai/sanitizer.py:96-123`, `openrouter.py:401-403,546-548` |
| The `From Source:` dropdown and the `Model:` dropdown, with local greyed until connected | `ModelRolesSection.tsx:217-300` |

**The UI the writer asked for exists.** `From Source:` is a literal label at
`ModelRolesSection.tsx:217` and `Model:` is beside it. What is missing is behind
them, not in front: a second dialect that can actually generate (3), and
something honest to say about each model (5).

---

## 3. The transport

### 3.1 The defect this section exists to fix

`normalize_base_url(raw, "ollama")` returns the bare root, e.g.
`http://localhost:11434`. `run_completion` and `run_chat` both POST to a
hardcoded suffix:

```python
f"{provider.base_url}/chat/completions"   # ai/openrouter.py:362 and :525
```

For ollama style that is `http://localhost:11434/chat/completions`, which Ollama
does not serve. It serves `/api/chat` natively and `/v1/chat/completions`
through its compatibility layer. **So the ollama API style cannot generate at
all.**

The reason it looks healthy right up to the failure: `model_list_style` is
patched into the frozen config only on the two LISTING paths
(`routers/ai.py:326`, `routers/settings.py:316`), never by
`_resolve_model_and_key`, because listing was the only thing that needed it. So
Test Connection **passes**, the model dropdown **fills**, and then every Draft,
Advisor pass and summary fails. No test in the repository has ever POSTed a
completion as the local provider.

### 3.2 RULING (the writer's, 2026-08-23): the setting stays, and it chooses where MODELS ARE LISTED. Chat is always OpenAI-compatible.

Three options were put up: retire the dropdown, build a real `/api/chat`
transport, or keep the dropdown and have Test Connection correct it. **The
writer chose to keep it and correct it.**

Implementing that literally would not have fixed 3.1, and the reason is worth
recording. "Ollama native" had no working chat transport at all, so any
correction that verified generation would move every writer off it whatever
server they were running -- the option would exist only to be corrected away
from, which is the retire option with extra steps. And a writer who never
pressed Test Connection would still have hit the 404.

So the ruling is honoured by **narrowing what the setting means** rather than by
removing it. The dropdown chooses where the MODEL CATALOG is read from, which is
the only thing it ever controlled correctly: Ollama lists at `/api/tags` off the
bare root, everything else at `/v1/models`. That is a real difference and earns
a setting -- and `/api/tags` is also the sole source of the parameter size,
quantization and family in 5.2. **Chat always resolves to
`/v1/chat/completions`**, which Ollama's compatibility layer, LM Studio,
llama.cpp and vLLM all serve.

The consequence that makes the whole thing safe: the setting can no longer break
generation. Getting it wrong costs an empty model dropdown, never a wrong answer
and never a charge. That is also what makes the automatic correction in 4.2
acceptable rather than presumptuous.

This does **not** overrule `local_endpoint.py:37-41`, which argued that sniffing
is guesswork and the writer should declare the dialect. That argument stands and
the declaration stays. What changed is that the declaration no longer reaches
the transport.

**Mechanically:** `base_url_for()` answers "where do I send a prompt" and is
style-blind; `list_base_url_for()` answers "where do I read the catalog" and is
style-aware. Two names, because one function answering both questions is
precisely how 3.1 hid for a release.

### 3.3 What happens to a writer who already chose "Ollama native"

Nothing they must do, and nothing they retype. Their stored `local_api_style`
keeps working for the model list, and their generation starts resolving to
`/v1/chat/completions` where it previously 404'd on every AI action -- a silent
repair of a broken state, not a change to a working one.

The dropdown stays in `ProviderPanel.tsx`. Its LABEL changes, because "API
style" is no longer what it is: it reads "Where to read your model list", and
the help text says Test Connection will correct a wrong pick.

### 3.4 Timeouts

`REQUEST_TIMEOUT` is a flat 300s for every provider (`openrouter.py:39`). A
local model on CPU can exceed that on a long chapter and produce a failure the
writer reads as "the app is broken".

Local gets its own timeout, longer than hosted and settable, defaulting to 600s.
When it expires the message says what actually happened: the model is still
working, the machine is the constraint, and a smaller or more heavily quantized
model is the fix.

### 3.5 Output length

Local runtimes cap output low by default -- Ollama's `num_predict` is 128 unless
asked. A 128-token answer is indistinguishable from a model with little to say,
which is the same trap `run_completion` already documents for reasoning models.
Every local request therefore sends an explicit `max_tokens`.

### 3.6 Prompt-shape tolerance

`run_completion` sends `response_format: {"type": "json_object"}`
unconditionally (`openrouter.py:329`). Ollama's compat layer and LM Studio
accept it; older llama.cpp builds 400. On a 400 naming that field, the request
is retried once without it, following the pattern already proven by the
audiobook's self-healing mp3 `response_format` retry. A retry that silently
produced non-JSON would be worse than the 400, so the retry keeps the
instruction in the PROMPT and only drops the parameter.

---

## 4. Test Connection

### 4.1 It must prove generation, not reachability

Today's test lists models. 3.1 is precisely the class of bug that a listing test
cannot see: the server was there and generation was unreachable. So the test
sends a deterministic tiny prompt at temperature 0 with a short timeout and
**shows the model's actual reply**, verbatim, however odd it is.

A reply that arrives but is wrong is reported as a success with the reply shown.
The app is not grading the model; it is proving the pipe.

### 4.2 The three failures stay distinguishable, and the fix is now RENDERED

The existing test already tells a refused address, a dead server and a
wrong-dialect server apart, and computes `suggested_style` naming the fix. That
value appears **nowhere in `app/src/`** (`ProviderPanel.tsx:101-106` renders
only `{ok, message}`) -- the same shape as R8.1 and R8.7: the backend worked out
the right answer and no screen read it.

So the probe now **applies the fix rather than describing it**: when the other
dialect answers, the setting is corrected, saved, and the correction is stated in
the same breath ("That address answers as Ollama native rather than
OpenAI-compatible, so the API style has been switched for you"). The dropdown on
screen moves with it, and the cached settings move too, or the screen would read
as edited-but-unsaved over a change the backend has already written.

Correcting silently is acceptable only because of 3.2: the value decides where
models are listed, so a wrong one costs an empty dropdown rather than a wrong
answer or a charge, and the probe has just established which value is right. It
is still said out loud, because **a setting that changes itself without
mentioning it is its own bug.**

Two bounds, both tested. A CORRECT setting is left alone and produces no notice
-- a "we fixed it for you" on a working setup teaches the writer to distrust the
message. And a dead server is never reported as a style problem, because "start
the server" and "flip a dropdown" are different instructions.

**A diagnosis the writer cannot see is not a diagnosis.**

---

## 5. Model discovery and what each model IS

### 5.1 Discovery needs no new code

`GET /api/ai/models?provider=local` already fills `base_url` from settings,
already branches on `model_list_style`, and already normalises tolerantly (the
list may be under `data`, `models`, or bare; the id may be `id`, `name`, or
`model`; an entry with no id is skipped rather than raised on). A dead server
gets a 503 naming the address. This all works and is not changed.

### 5.2 The descriptions the writer asked for, from data already being discarded

Ollama's `/api/tags` returns per model a `details` object carrying `family`,
`parameter_size` ("8B") and `quantization_level` ("Q4_K_M"), plus an on-disk
`size` in bytes. `_normalize_generic_models` (`openrouter.py:240-258`) reads
`id` / `name` / `model` / `context_length` and **discards `details` entirely**.

Those four facts are carried through and rendered beside each model. That is
enough for a writer to choose: a 3B Q4 is a different proposition from a 70B Q5,
and their own hardware decides which is usable.

### 5.3 The app describes local models. It does NOT rank them.

**A ruling, not an implementation detail.** Recommending one local model over
another is a claim about the writer's *hardware*, which the app cannot see.
Stating that a model is 8B and Q4_K_M and occupies 4.7 GB is a *fact*.

`recommendedPicks` (`modelFiltering.ts:199-225`) matches hardcoded OpenRouter
slugs and buckets by price tier, so for a local catalog nothing matches and the
Recommended group does not render. **That is the correct outcome and must not be
"fixed".** Price tiers are equally meaningless when every model is `is_free`;
tier labels are suppressed for local rather than shown reading "Free".

The `:latest` suffix is stripped for display only. The stored id keeps it.

### 5.4 An existing unchecked claim

`providerMeta.ts:87-89` already tells the writer local models are "a good
pairing for Prose or experimenting, less so for critique". That is a quality
claim about models the app has never seen, in prose, with nothing checking it.
It is softened to describe the *variance* rather than assign roles, and the same
sentence now carries 7.3's answer: no cost, but time and the writer's own GPU, so
replies can take minutes rather than seconds. If any capability hint survives, it
gets the `test_explain_costs.py` treatment -- a claim worth keeping is worth a
test that cites it.

---

## 6. The context window, and what zero means

### 6.1 The disagreement to settle

A local catalog carries no `context_length`: `/api/tags` does not return one and
the normaliser defaults it to `0`.

The backend is honest about that. `_context_window` returns 0 for "could not
find out" (`routers/extractor.py:170-185`), the oversize refusal is gated `if
context_tokens and ...` so 0 never refuses, and the plan endpoint comments that
"0 means we could not find out, which is different from 'it fits'".

The frontend is **stricter than the backend** and hides them.
`ExtractorModelPicker.tsx:84` filters on `m.context_length >= needed / 0.8`, so
with `needed > 0` every local model drops out of the list. A local model
assigned to Long-context analysis **cannot be chosen on the screen that chooses
it**.

### 6.2 RULING: unknown is shown, labelled unknown, and never hidden

The backend's reading wins; the frontend changes. A model with an unknown window
is listed, marked "window unknown", and separated from the models that are known
to fit -- so the count line stays true without the writer having to guess why
their model vanished.

### 6.3 Finding out for real, best-effort

Ollama's `/api/show` returns `model_info["<family>.context_length"]`. LM
Studio's native `/api/v0/models` carries `max_context_length` alongside `arch`,
`quantization` and `state`. Both are consulted where available, cached per
address, and **never blocking**: a discovery that cannot answer leaves the
window unknown, which 6.2 already renders honestly. The writer may also type a
window in, and a typed value wins over a discovered one.

### 6.4 The silent-truncation hazard

A "full chapter" may be 100,000 characters (`routers/ai.py:1922`), roughly 25k
tokens, plus up to 60k characters of Weave brief. Sent to an 8k-window local
model, **Ollama's default is to trim the prompt and answer anyway** -- a
plausible reply about a third of the chapter, with nothing in a position to
notice. Same class as R6.1 and R8.11.

Once a window is known and the request will not fit, the app **says so before
spending the time** rather than letting the runtime quietly decide which two
thirds of the chapter to ignore. Where it is unknown, no claim is made either
way. The real fix is the long-context budgeting work in `docs/roadmap.md`, whose
reference implementation is `backend/app/codex/context.py`; this section is the
honest interim.

---

## 7. Roles

### 7.1 What is already correct and must stay correct

An assigned-but-unusable local role reports itself unusable and **never
substitutes another model** (`ai/roles.py:28-42`). For local, "unusable" means
no address, or an address that fails the 1.3 rule. This is the single most
important rule in Model Roles and local does not get an exception: a writer who
assigned a local model and silently got a paid hosted one would be charged for a
promise the app broke.

### 7.2 Caching

`supports_cache_control` is false, so the caching caveat is always true for
local and always shown. `test_provider_caching_claims.py` already binds this in
both directions.

### 7.3 What a local role spends

The Explain contract asks what a feature spends, and every existing answer is
about money. **Here the honest answer is time and the writer's own GPU.**
`is_free: true` is true and, alone, misleading.

So the local answer to "what it spends" is stated in those terms: no money, and
minutes rather than seconds, more on a larger or less quantized model. This is
the one place the four-question contract needs an answer that is not a price,
and saying "free" and stopping would be the wrong kind of true.

---

## 8. Reasoning traces

`strip_think_blocks` removes a complete `<think>` block, removes an unclosed
opener onward, and leaves a stray closer alone. The trace is currently
discarded.

It is carried to the Reasoning toggle instead, as the local analogue of
OpenRouter's `reasoning` field. **Capability is detected by a block APPEARING,
never declared up front:** a local catalog cannot say whether a model reasons,
so gating on a declaration would mean the toggle never lights for the models it
is for.

`run_chat` already returns a `str | tuple` union gated on
`supports_reasoning_param`. Extending it for local means making that union
unconditional rather than adding a third shape -- two shapes are already one too
many.

---

## 9. Content mode

`modelFiltering.ts:57-68` keys moderation off OpenRouter slug prefixes and
`:76-80` uses a NanoGPT substring blocklist. Neither matches an Ollama tag.

**A local model is unmoderated as a matter of fact**, not of guesswork: there is
no provider between the writer and the weights. So it is asserted rather than
left unknown, the same way `_mark_free_if_local` asserts cost. Content mode
therefore never blocks a local model, and the request is never refused for a
reason that does not apply to it.

---

## 10. What must be tested

A claim worth keeping is worth a test that cites it.

1. **A completion is POSTed as the local provider, against the resolved URL.**
   The absence of this test is why 3.1 shipped. It is the most important item
   here. `tests/` currently contains `chat/completions` only in two hosted error
   fixtures.
2. Listing stays style-aware while chat does not: `list_base_url_for` keeps the
   bare root for ollama, `base_url_for` returns `/v1` for BOTH styles, and a
   stored `local_api_style: "ollama"` needs no retyping (3.2, 3.3). The public
   address rule must hold for both questions, or the narrowing has loosened
   what "local" means.
3. Test Connection fails when the address lists models but cannot generate
   (4.1) -- the exact shape of the shipped defect.
4. A wrong style is CORRECTED, persisted and said out loud in the writer's own
   words; a correct one is left alone with no notice; and a dead server is not
   reported as a style problem (4.2).
5. A model with `context_length: 0` is OFFERED by the Extractor picker and
   labelled unknown (6.2). Verified by reinstating the filter.
6. `parameter_size`, `quantization_level`, `family` and `size` survive
   normalisation and reach the screen (5.2).
7. No tier label and no Recommended group renders for a local catalog (5.3).
8. An unusable local role refuses and does not substitute (7.1). Already covered
   by `test_model_roles.py:232-263`; it must stay covered.
9. The `response_format` retry fires on a 400 naming the field, and only then
   (3.6).
10. Every address rule in `test_local_endpoint.py` still holds after 3.2. The
    `/v1` normalisation changes; **what counts as a local address does not.**

---

## 11. Deliberately not built

- **Bundling, downloading or updating a model or runtime** (1.2).
- **Sniffing the dialect up front.** The writer still declares it, and 3.2 takes
  the declaration out of the transport so a wrong one cannot break generation.
  Test Connection probes the alternative only AFTER the declared one has failed,
  which is checking rather than guessing.
- **A second chat transport.** `/api/chat` is not implemented and is not
  planned; 3.2 records why, and why "Ollama native" is a listing choice only.
- **Ranking local models against each other** (5.3).
- **Streaming.** Backburnered app-wide, and the editor-pass path structurally
  cannot stream because it must parse one complete JSON object.
- **Automatic model selection by size.** That is the roadmap's task-aware
  routing, and 6.4 is the honest interim.

---

## 12. Open questions

Recorded rather than resolved, so nothing here is decided by accident later.

1. **Does the writer want a `custom` provider in this release?** 1.3 keeps the
   door open and 3.2 makes it cheaper (one dialect). It is genuinely separate
   work and carries its own warning surface.
2. **Should a known-too-small window refuse, or warn and proceed?** 6.4 says the
   app speaks up; whether it *stops* is the writer's call. Refusing is safer and
   more annoying.
3. **Is a typed-in context window worth the control** (6.3), or is discovery
   plus "unknown" enough?
4. **Does anything in the app ever want to say a local model is good AT
   something** (5.4)? The recommendation here is no, and to describe rather than
   advise.

---

# Appendix -- the 2026-07-13 provider research

Folded in from `docs/research-multi-provider.md` on 2026-08-25, which had been a standalone note since before any provider work shipped. It is research rather than contract -- the numbered sections above are what the code is held to -- but it is cited from `providers.py`, `openrouter.py` and `providerMeta.ts` for the reasoning behind the tolerant catalog parsing and the one-config-per-provider shape, so it stays.

### The good news: everything is OpenAI-compatible

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

### Sketch of our implementation

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

### Local reasoning models -- full breakdown

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

### Related feature ideas surfaced during this research

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
