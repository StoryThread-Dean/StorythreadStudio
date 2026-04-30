# ai/openrouter.py -- OpenRouter API Client
# ===========================================
# A thin async wrapper around the OpenRouter API.
# OpenRouter speaks the OpenAI API format, so the request/response shapes
# are identical to what you'd send to api.openai.com -- just a different URL
# and API key header.
#
# Why OpenRouter?
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
from app.ai.sanitizer import sanitize_dict, contains_em_dash

# OpenRouter's base URL and model list endpoint
OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# HTTP timeout for AI calls -- 180s gives heavy requests (multi-profile
# consistency checks, outline-vs-profiles comparisons) room to finish on
# slower or busier model providers. The frontend uses a matching 180s
# abort timer, and shows a [Cancel] button after 20s for impatient users.
REQUEST_TIMEOUT = 180.0

# Logger for AI-call observability. Every call records prompt size and
# elapsed time so timeouts can be correlated with payload bulk or specific
# models. Logs land in the backend console (uvicorn captures stdout/stderr).
log = logging.getLogger(__name__)


async def list_models(api_key: str) -> list[dict]:
    """
    Fetch the current list of available models from OpenRouter.
    Returns a simplified list with just the fields the UI needs.

    The full OpenRouter response has many fields; we extract only what
    Storythread Studio needs to display in the model picker and do routing.
    """
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(
            f"{OPENROUTER_BASE}/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        data = response.json()

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

        models.append({
            "id":                      model_id,
            "name":                    m.get("name", model_id),
            "context_length":          m.get("context_length", 0),
            "cost_input_per_million":  cost_in,
            "cost_output_per_million": _per_million(pricing.get("completion", "0")),
            "output_modalities":       output_modalities,
            "is_free":                 is_free,
            "is_moderated":            is_moderated,
        })

    # Sort by name for a clean UI list
    models.sort(key=lambda m: m["name"].lower())
    return models


async def test_connection(api_key: str) -> dict:
    """
    Verify that the API key is valid by fetching the model list.
    Returns {"ok": True, "model_count": N} on success.
    Returns {"ok": False, "error": "..."} on failure.
    """
    try:
        models = await list_models(api_key)
        return {"ok": True, "model_count": len(models)}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return {"ok": False, "error": "Invalid API key. Check your OpenRouter key in Settings."}
        return {"ok": False, "error": f"OpenRouter returned HTTP {e.response.status_code}."}
    except httpx.RequestError as e:
        return {"ok": False, "error": f"Could not reach OpenRouter: {e}"}


async def run_completion(
    api_key: str,
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float | None = None,
) -> dict:
    """
    Send a chat completion request to OpenRouter and return the parsed result.

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
            {"role": "system",  "content": system_prompt},
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
                f"{OPENROUTER_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                    # OpenRouter recommends these headers for tracking
                    "HTTP-Referer":  "http://localhost:1420",
                    "X-Title":       "Storythread Studio",
                },
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
            "run_completion model=%s prompt_chars=%d elapsed=%.2fs status=%s",
            model_id, prompt_chars, elapsed, call_status,
        )

    # Extract the text content from the first choice
    raw_content = data["choices"][0]["message"]["content"]

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
) -> str:
    """
    Send a multi-turn chat completion request to OpenRouter and return
    the assistant's reply as a plain string.

    Used by the Profile Builder chat panel, where the writer has a
    back-and-forth conversation about a profile.

    `messages` is a list of {"role": "user"|"assistant", "content": str}
    dicts in chronological order. The system prompt is always prepended.

    Unlike run_completion(), we return the raw text (not parsed JSON)
    because profile chat replies are conversational, not structured data.
    """
    from app.ai.sanitizer import sanitize_chat

    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            *messages,
        ],
    }

    # Include temperature only when explicitly provided.
    if temperature is not None:
        payload["temperature"] = temperature

    # --- Observability: same pattern as run_completion ---
    # Sum all message lengths (system + every turn) for a true payload size
    # since chat conversations grow each turn.
    prompt_chars = len(system_prompt) + sum(len(m.get("content", "")) for m in messages)
    start_time   = time.monotonic()
    call_status  = "ok"

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(
                f"{OPENROUTER_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                    "HTTP-Referer":  "http://localhost:1420",
                    "X-Title":       "Storythread Studio",
                },
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
            "run_chat model=%s prompt_chars=%d turns=%d elapsed=%.2fs status=%s",
            model_id, prompt_chars, len(messages), elapsed, call_status,
        )

    raw_reply = data["choices"][0]["message"]["content"]

    # Apply the chat sanitizer: removes em/en dashes AND double-hyphen dashes
    return sanitize_chat(raw_reply)


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
