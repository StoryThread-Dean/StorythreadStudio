# ai/openrouter.py -- OpenAI-Compatible Chat Client
# ==================================================
# A thin async wrapper around any OpenAI-compatible chat API. Historically
# named for OpenRouter (the first and default provider), but every function
# here now takes a ProviderConfig (see ai/providers.py) that supplies the
# base URL, headers, and capability flags -- so the same client talks to
# OpenRouter, NanoGPT, and (later) local runtimes without new request code.
# A rename to something like client.py is deferred to the local-providers
# milestone to keep this diff reviewable.
#
# Why OpenRouter as the default?
# One API key gives access to many models from different providers
# (OpenAI, Anthropic, Mistral, etc.). This lets Storythread Studio route requests
# to different models based on task type and content mode without requiring
# the user to hold multiple API keys.
#
# API docs: https://openrouter.ai/docs

import json
import logging
import time
import httpx
from app.ai.providers import ProviderConfig, OPENROUTER
from app.ai.sanitizer import sanitize_dict, contains_em_dash, strip_think_blocks

# Kept as an alias for any code/tests that still import the old constant.
# The live value used per request is provider.base_url.
OPENROUTER_BASE = OPENROUTER.base_url

# HTTP timeout for AI calls -- 300s gives heavy requests (multi-profile
# consistency checks, drafting turns on slow reasoning models) room to
# finish on slower or busier model providers. Raised from 180s after the
# v1.0.10 context-persistence fix: follow-up turns now carry the attached
# materials in history, and models that don't prompt-cache (AionLabs
# Aion-3.0 in live testing) re-read the whole payload every turn, so
# drafting turns legitimately run longer than before. The frontend uses a
# matching 300s abort timer, and shows a [Cancel] button after 20s so
# nobody is stuck waiting on a request they've given up on.
REQUEST_TIMEOUT = 300.0

# Logger for AI-call observability. Every call records prompt size and
# elapsed time so timeouts can be correlated with payload bulk or specific
# models. Logs land in the backend console (uvicorn captures stdout/stderr).
log = logging.getLogger(__name__)


# Model families that actually USE cache_control on OpenRouter. Everyone
# else either caches automatically without it (OpenAI, DeepSeek, Grok) or
# doesn't cache at all -- and some exotic provider routes mishandle the
# structured content-array shape entirely (a live incident: AionLabs
# Aion-3.0 stalling to the 180s timeout on requests that carried it).
# Restricting the marker to families that benefit keeps every saving and
# removes the risk for everyone else.
CACHE_CONTROL_MODEL_PREFIXES = ("anthropic/", "google/")


def _system_message(system_prompt: str, cache_prompts: bool, model_id: str = "") -> dict:
    """Build the system message, optionally marked for prompt caching.

    Anthropic-style prompt caching via OpenRouter: the system content becomes
    a structured content block carrying cache_control, telling the model
    provider "this prefix repeats -- store it and charge a fraction next
    time". The system prompt is the right (and only) cache target here: it
    already contains the static story context, while the user messages mix
    in per-request text that would never re-match.

    The marker (and the content-array shape that carries it) is only sent
    to model families that support it -- see CACHE_CONTROL_MODEL_PREFIXES.
    Prompts under a model's minimum cacheable size (1024-4096 tokens
    depending on model) simply don't cache -- harmless, so no size
    threshold is applied here.
    """
    if not cache_prompts or not model_id.startswith(CACHE_CONTROL_MODEL_PREFIXES):
        return {"role": "system", "content": system_prompt}
    return {"role": "system", "content": [
        {"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}
    ]}


def _request_headers(api_key: str, provider: ProviderConfig) -> dict[str, str]:
    """Build the HTTP headers for one provider.

    Every provider today authenticates with a Bearer key; the config's
    extra_headers add anything provider-specific on top (OpenRouter's
    attribution headers). Future local providers set requires_api_key=False
    and simply get no Authorization header.
    """
    headers = {"Content-Type": "application/json"}
    if provider.requires_api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    headers.update(provider.extra_headers)
    return headers


async def list_models(api_key: str, provider: ProviderConfig = OPENROUTER) -> list[dict]:
    """
    Fetch the current list of available models from the provider.
    Returns a simplified list with just the fields the UI needs.

    OpenRouter's response is rich (pricing, moderation, modalities), so it
    gets the detailed mapping below. Every other provider returns some
    variation of a bare model list, handled by _normalize_generic_models().
    """
    # Ollama's native API does not implement /models at all -- its catalog
    # lives at /api/tags in a different shape. Everything else, local or
    # hosted, speaks the OpenAI-compatible /models.
    if provider.model_list_style == "ollama_tags":
        return _mark_free_if_local(await _list_ollama_models(provider), provider)

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(
            f"{provider.base_url}/models",
            headers=_request_headers(api_key, provider),
        )
        response.raise_for_status()
        data = response.json()

    if provider.key != "openrouter":
        return _mark_free_if_local(_normalize_generic_models(data), provider)

    models = []
    for m in data.get("data", []):
        pricing      = m.get("pricing", {})
        architecture = m.get("architecture", {})
        model_id     = m.get("id", "")

        # Output modalities tell us whether this model produces text only or
        # also image/audio/video output. We use this for the text-only filter
        # in Settings. Default to ["text"] if the field is absent.
        output_modalities: list[str] = architecture.get("output_modalities", ["text"])

        cost_in = _per_million(pricing.get("prompt", "0"))

        # Free models: ":free" suffix in ID or zero input cost.
        is_free = model_id.endswith(":free") or cost_in == 0.0

        # Moderation: top_provider.is_moderated tells us if the model has
        # content filters. Moderated models refuse or heavily soften explicit
        # content. We use this to auto-filter the model list by content mode.
        # Default to False (unmoderated) if the field is absent.
        top_provider = m.get("top_provider", {}) or {}
        is_moderated = bool(top_provider.get("is_moderated", False))

        # Reasoning support: OpenRouter lists each model's accepted request
        # parameters. Models that accept "reasoning" (or the legacy
        # "include_reasoning") can return a reasoning trace alongside the
        # answer. Drives the Writing Companion's Reasoning toggle -- the
        # toggle is hidden for models that can't honor it.
        supported_params = m.get("supported_parameters", []) or []
        supports_reasoning = (
            "reasoning" in supported_params or "include_reasoning" in supported_params
        )

        models.append({
            "id":                      model_id,
            "name":                    m.get("name", model_id),
            "context_length":          m.get("context_length", 0),
            "cost_input_per_million":  cost_in,
            "cost_output_per_million": _per_million(pricing.get("completion", "0")),
            "output_modalities":       output_modalities,
            "is_free":                 is_free,
            "is_moderated":            is_moderated,
            "supports_reasoning":      supports_reasoning,
        })

    # Sort by name for a clean UI list
    models.sort(key=lambda m: m["name"].lower())
    return models


def _mark_free_if_local(models: list[dict], provider: ProviderConfig) -> list[dict]:
    """
    A model running on the writer's own machine costs nothing per token.

    _normalize_generic_models deliberately leaves is_free False, because for
    a hosted provider "no pricing data" is not the same as free and saying
    otherwise would mislead. For a local runtime it IS the same: there is no
    account and nothing to bill. Marking it here keeps that judgement in one
    obvious place rather than teaching the generic normalizer about it.
    """
    if not provider.endpoint_from_settings:
        return models
    for model in models:
        model["is_free"] = True
    return models


async def _list_ollama_models(provider: ProviderConfig) -> list[dict]:
    """
    Fetch a model list from Ollama's own API instead of /models.

    Ollama answers at /api/tags with {"models": [{"name", "model", ...}]}.
    That shape is already covered by _normalize_generic_models below (it
    looks under "models" and accepts an id under "name" or "model"), so the
    only thing that actually differs is the URL -- which is exactly why the
    provider carries model_list_style rather than this being special-cased
    at the call site.

    No API key and no auth header: it is the writer's own machine. The
    short timeout is deliberate too -- a local server either answers at once
    or is not running, and a long wait would read as the app hanging.
    """
    from app.ai.local_endpoint import LOCAL_LIST_TIMEOUT

    async with httpx.AsyncClient(timeout=LOCAL_LIST_TIMEOUT) as client:
        response = await client.get(f"{provider.base_url}/api/tags")
        response.raise_for_status()
        data = response.json()
    return _normalize_generic_models(data)


def _normalize_generic_models(data) -> list[dict]:
    """Map a non-OpenRouter /models response into our simplified model shape.

    Providers other than OpenRouter publish much thinner catalogs -- NanoGPT
    returns {data: [{id, name, context_length}]} with no pricing, moderation,
    or modality info, and local runtimes are even more inconsistent. So this
    is deliberately tolerant (per docs/research-multi-provider.md):
      - the list may live under "data", "models", or be the bare response
      - the id may be under "id", "name", or "model"
      - entries with no usable id are skipped, never raised on

    Defaults for the missing fields are chosen so the UI stays honest:
      - costs 0.0 because ModelInfo requires floats, but is_free stays False:
        unknown pricing is NOT the same as free, and labeling it free would
        mislead the writer. The frontend hides the cost-tier filter for
        providers without pricing data instead.
      - output_modalities ["text"] so the text-only filter passes.
      - is_moderated False (no data -- the frontend applies its own
        provider-specific content-mode rule).
      - supports_reasoning False, which hides the Reasoning toggle rather
        than offering a switch that silently does nothing.
    """
    if isinstance(data, dict):
        raw = data.get("data") or data.get("models") or []
    elif isinstance(data, list):
        raw = data
    else:
        raw = []

    models = []
    for m in raw:
        if not isinstance(m, dict):
            continue
        model_id = m.get("id") or m.get("name") or m.get("model") or ""
        if not model_id:
            continue
        models.append({
            "id":                      model_id,
            "name":                    m.get("name") or model_id,
            "context_length":          m.get("context_length", 0) or 0,
            "cost_input_per_million":  0.0,
            "cost_output_per_million": 0.0,
            "output_modalities":       ["text"],
            "is_free":                 False,
            "is_moderated":            False,
            "supports_reasoning":      False,
        })

    models.sort(key=lambda m: m["name"].lower())
    return models


async def test_connection(api_key: str, provider: ProviderConfig = OPENROUTER) -> dict:
    """
    Verify that the API key is valid by fetching the model list.
    Returns {"ok": True, "model_count": N} on success.
    Returns {"ok": False, "error": "..."} on failure.
    """
    try:
        models = await list_models(api_key, provider=provider)
        return {"ok": True, "model_count": len(models)}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return {"ok": False, "error": f"Invalid API key. Check your {provider.label} key in Settings."}
        return {"ok": False, "error": f"{provider.label} returned HTTP {e.response.status_code}."}
    except httpx.RequestError as e:
        return {"ok": False, "error": f"Could not reach {provider.label}: {e}"}
    except Exception as e:
        # Catches SSL errors (missing cert bundle in frozen binary), JSON
        # decode errors from malformed provider responses, and any other
        # unexpected failure. Returns a user-facing message instead of
        # letting FastAPI turn the exception into a 500 with no detail.
        return {"ok": False, "error": f"Connection check failed: {type(e).__name__}: {e}"}


async def run_completion(
    api_key: str,
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float | None = None,
    provider: ProviderConfig = OPENROUTER,
    cache_prompts: bool = False,
) -> dict:
    """
    Send a chat completion request to the provider and return the parsed result.

    `cache_prompts` marks the system prompt as cacheable (see _system_message).
    Callers gate it on the user's Prompt Caching setting AND the provider's
    support flag; this function double-checks the flag so a stray True can
    never send cache_control to a provider that might reject it.

    The response is expected to be JSON (our system prompts request it).
    If the model doesn't return valid JSON, we wrap the raw text in a
    fallback structure so the UI still displays something useful.

    The sanitizer is applied AFTER parsing so em dashes in any string
    field are caught and replaced with ' -- '.

    Returns a dict with the standard revision schema:
      {
        "summary": str,
        "suggestions": [{"label": str, "content": str}],
        "notes": [str],
        "model_used": str,
        "had_em_dashes": bool   <- True if sanitizer had to fix something
      }
    """
    payload = {
        "model": model_id,
        "messages": [
            _system_message(system_prompt, cache_prompts and provider.supports_cache_control, model_id),
            {"role": "user",    "content": user_message},
        ],
        # Ask the model to respond in JSON format where supported.
        # Not all OpenRouter models support this; we fall back gracefully.
        "response_format": {"type": "json_object"},
    }

    # Include temperature only when explicitly provided.
    # Omitting it lets OpenRouter use the model's default.
    if temperature is not None:
        payload["temperature"] = temperature

    # --- Observability: measure payload size + elapsed time ---
    # Logged no matter what happens (success, timeout, HTTP error) so we
    # can correlate slow/failing calls with payload bulk or specific models.
    # Character count is a cheap proxy for token count (~4 chars/token).
    prompt_chars = len(system_prompt) + len(user_message)
    start_time   = time.monotonic()
    call_status  = "ok"  # overridden in except blocks below

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(
                f"{provider.base_url}/chat/completions",
                headers=_request_headers(api_key, provider),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        call_status = "timeout"
        raise
    except httpx.HTTPStatusError as e:
        call_status = f"http_{e.response.status_code}"
        raise
    finally:
        elapsed = time.monotonic() - start_time
        log.info(
            "run_completion provider=%s model=%s prompt_chars=%d elapsed=%.2fs status=%s",
            provider.key, model_id, prompt_chars, elapsed, call_status,
        )

    # Extract the text content from the first choice
    raw_content = data["choices"][0]["message"]["content"]

    # Local reasoning models put their working out in the reply body. Strip
    # it FIRST: a <think> block ahead of the JSON would make json.loads()
    # fail below, and the reply would be misreported as "not in the
    # expected format" when the model actually answered correctly.
    if provider.strip_think_blocks:
        raw_content = strip_think_blocks(raw_content)

    # Check for em dashes BEFORE sanitizing (for the had_em_dashes flag)
    had_em_dashes = contains_em_dash(raw_content)

    # Parse the JSON response from the model
    try:
        parsed = json.loads(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError("Response is not a JSON object.")
    except (json.JSONDecodeError, ValueError):
        # Model didn't return valid JSON -- wrap the raw text in our schema
        parsed = {
            "summary": "The assistant returned a response but not in the expected format.",
            "suggestions": [{"label": "Raw response", "content": raw_content}],
            "notes": ["The model did not return structured JSON. You may still find the content above useful."],
        }

    # Apply sanitizer to all string fields in the parsed response
    parsed = sanitize_dict(parsed)

    # Build the result with all required keys filled in, but also keep
    # every key from the model's original parsed JSON. Generation endpoints
    # ask for specific keys like "section_summary" or "full_summary" that
    # don't match the standard revision schema ("summary", "suggestions").
    # By spreading **parsed first, then overlaying the schema defaults,
    # we preserve those extra keys so _extract_text_field() in ai.py can
    # find them directly.
    result = {
        **parsed,                                          # Keep ALL original keys
        "summary":       parsed.get("summary", ""),        # Default if not present
        "suggestions":   parsed.get("suggestions", []),
        "notes":         parsed.get("notes", []),
        "model_used":    model_id,
        "had_em_dashes": had_em_dashes,
    }

    return result


async def run_chat(
    api_key: str,
    model_id: str,
    system_prompt: str,
    messages: list[dict],
    temperature: float | None = None,
    sanitize_mode: str = "chat",
    include_reasoning: bool = False,
    provider: ProviderConfig = OPENROUTER,
    cache_prompts: bool = False,
) -> str | tuple[str, str | None]:
    """
    Send a multi-turn chat completion request to the provider and return
    the assistant's reply as a plain string.

    Used by the Profile Builder chat panel, where the writer has a
    back-and-forth conversation about a profile.

    `messages` is a list of {"role": "user"|"assistant", "content": str}
    dicts in chronological order. The system prompt is always prepended.

    Unlike run_completion(), we return the raw text (not parsed JSON)
    because profile chat replies are conversational, not structured data.

    `sanitize_mode` controls how the reply is cleaned before returning:
      - "chat" (default): sanitize_chat() -- strips em/en dashes AND folds
        an approved ' -- ' down to a comma. Right for conversational replies.
      - "prose": sanitize() -- strips em/en dashes only and KEEPS ' -- '.
        Right for drafted story prose, where ' -- ' is legitimate punctuation
        and turning it into commas would damage the writing.

    `include_reasoning` changes the RETURN SHAPE (deliberately, so the seven
    existing call sites stay untouched):
      - False (default): returns the reply string, exactly as before.
      - True: asks OpenRouter for the model's reasoning trace and returns a
        (reply, reasoning) tuple. `reasoning` is None when the model didn't
        emit a trace despite the request. Only reasoning-capable models
        honor the request; others simply ignore the extra parameter.
    """
    from app.ai.sanitizer import sanitize, sanitize_chat

    payload = {
        "model": model_id,
        "messages": [
            # Optionally cache-marked -- see _system_message. Gated on the
            # provider's support flag so only OpenRouter ever sees it.
            _system_message(system_prompt, cache_prompts and provider.supports_cache_control, model_id),
            *messages,
        ],
    }

    # Include temperature only when explicitly provided.
    if temperature is not None:
        payload["temperature"] = temperature

    # Ask for the reasoning trace. "medium" effort is OpenRouter's balanced
    # default; the trace comes back on message.reasoning in the response.
    # Only sent to providers that understand the parameter -- others would
    # either reject the unknown field or silently drop it, so we don't ask.
    if include_reasoning and provider.supports_reasoning_param:
        payload["reasoning"] = {"effort": "medium"}

    # --- Observability: same pattern as run_completion ---
    # Sum all message lengths (system + every turn) for a true payload size
    # since chat conversations grow each turn.
    prompt_chars = len(system_prompt) + sum(len(m.get("content", "")) for m in messages)
    start_time   = time.monotonic()
    call_status  = "ok"

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(
                f"{provider.base_url}/chat/completions",
                headers=_request_headers(api_key, provider),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        call_status = "timeout"
        raise
    except httpx.HTTPStatusError as e:
        call_status = f"http_{e.response.status_code}"
        raise
    finally:
        elapsed = time.monotonic() - start_time
        log.info(
            "run_chat provider=%s model=%s prompt_chars=%d turns=%d elapsed=%.2fs status=%s",
            provider.key, model_id, prompt_chars, len(messages), elapsed, call_status,
        )

    message = data["choices"][0]["message"]
    raw_reply = message["content"]

    # Strip inline reasoning traces before anything else looks at the text.
    # This runs ahead of the sanitizer so the writer never sees the model
    # thinking out loud, and ahead of the caller storing the reply in the
    # conversation history, where it would be fed back on every later turn.
    if provider.strip_think_blocks:
        raw_reply = strip_think_blocks(raw_reply)

    # Apply the sanitizer chosen by the caller. Prose drafting keeps ' -- ';
    # everything else folds it to a comma (see sanitize_mode docstring above).
    clean = sanitize(raw_reply) if sanitize_mode == "prose" else sanitize_chat(raw_reply)

    if not include_reasoning:
        return clean

    # Reasoning trace: present only when requested AND the model emitted one.
    # It's displayed in the UI, so the em dash rule applies to it too.
    raw_reasoning = message.get("reasoning")
    reasoning = sanitize_chat(raw_reasoning) if isinstance(raw_reasoning, str) and raw_reasoning.strip() else None
    return clean, reasoning


def _per_million(price_str: str) -> float:
    """
    Convert an OpenRouter price string (cost per token as a string like "0.000002")
    to cost per million tokens as a float.
    Returns 0.0 if the value is unparseable.
    """
    try:
        return float(price_str) * 1_000_000
    except (ValueError, TypeError):
        return 0.0
