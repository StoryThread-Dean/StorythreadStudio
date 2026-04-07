# ai/openrouter.py -- OpenRouter API Client
# ===========================================
# A thin async wrapper around the OpenRouter API.
# OpenRouter speaks the OpenAI API format, so the request/response shapes
# are identical to what you'd send to api.openai.com -- just a different URL
# and API key header.
#
# Why OpenRouter?
# One API key gives access to many models from different providers
# (OpenAI, Anthropic, Mistral, etc.). This lets StoryForge route requests
# to different models based on task type and content mode without requiring
# the user to hold multiple API keys.
#
# API docs: https://openrouter.ai/docs

import json
import httpx
from app.ai.sanitizer import sanitize_dict, contains_em_dash

# OpenRouter's base URL and model list endpoint
OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# HTTP timeout for AI calls -- 60s to allow for slow/large model responses
REQUEST_TIMEOUT = 60.0


async def list_models(api_key: str) -> list[dict]:
    """
    Fetch the current list of available models from OpenRouter.
    Returns a simplified list with just the fields the UI needs.

    The full OpenRouter response has many fields; we extract only what
    StoryForge needs to display in the model picker and do routing.
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
        pricing = m.get("pricing", {})
        models.append({
            "id":                      m.get("id", ""),
            "name":                    m.get("name", m.get("id", "")),
            "context_length":          m.get("context_length", 0),
            # Pricing is per token; we convert to per million for readability
            "cost_input_per_million":  _per_million(pricing.get("prompt", "0")),
            "cost_output_per_million": _per_million(pricing.get("completion", "0")),
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

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.post(
            f"{OPENROUTER_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type":  "application/json",
                # OpenRouter recommends these headers for tracking
                "HTTP-Referer":  "http://localhost:1420",
                "X-Title":       "StoryForge",
            },
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

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

    # Ensure the schema has all required keys (fill in defaults if missing)
    result = {
        "summary":       parsed.get("summary", ""),
        "suggestions":   parsed.get("suggestions", []),
        "notes":         parsed.get("notes", []),
        "model_used":    model_id,
        "had_em_dashes": had_em_dashes,
    }

    return result


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
