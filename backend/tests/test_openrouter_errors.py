# tests/test_openrouter_errors.py
# =================================
# Tests for the OpenRouter error-translation helpers in app/routers/ai.py.
#
# Why these exist: a real-world incident had a project pinned to a model
# (x-ai/grok-3-mini) that xAI later deprecated. OpenRouter returned HTTP 404
# with the body {"error": {"message": "Grok 3 Mini is deprecated. xAI
# recommends switching to Grok 4.3", "code": 404}} -- but the old handler
# discarded that body and showed only "HTTP 404", which read like an outage.
# These tests lock in that the provider's actual message now reaches the user
# and that a 404 produces an actionable, model-focused error.

import httpx

from app.routers.ai import _openrouter_msg, _openrouter_exc


def _status_error(status: int, body) -> httpx.HTTPStatusError:
    """
    Build a real httpx.HTTPStatusError carrying a buffered JSON response,
    mirroring what `response.raise_for_status()` raises after a non-streaming
    OpenRouter call. `body` may be a dict (serialized to JSON) or raw bytes
    (to simulate a non-JSON error body).
    """
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    if isinstance(body, (bytes, bytearray)):
        response = httpx.Response(status, content=body, request=request)
    else:
        response = httpx.Response(status, json=body, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


def test_openrouter_msg_extracts_nested_error_message():
    err = _status_error(404, {"error": {"message": "Grok 3 Mini is deprecated.", "code": 404}})
    assert _openrouter_msg(err) == "Grok 3 Mini is deprecated."


def test_openrouter_msg_extracts_top_level_message():
    err = _status_error(400, {"message": "Bad request."})
    assert _openrouter_msg(err) == "Bad request."


def test_openrouter_msg_returns_empty_on_non_json_body():
    err = _status_error(404, b"<html>Not Found</html>")
    assert _openrouter_msg(err) == ""


def test_404_surfaces_provider_message_and_guidance():
    err = _status_error(
        404,
        {"error": {"message": "Grok 3 Mini is deprecated. xAI recommends switching to Grok 4.3", "code": 404}},
    )
    exc = _openrouter_exc(err)
    # We map provider 404s to a 502 (the failure is upstream, not in our app).
    assert exc.status_code == 502
    # The writer must see BOTH our actionable guidance and OpenRouter's words.
    assert "Project Settings" in exc.detail
    assert "Grok 3 Mini is deprecated" in exc.detail


def test_404_without_body_still_gives_actionable_guidance():
    err = _status_error(404, b"")
    exc = _openrouter_exc(err)
    assert exc.status_code == 502
    assert "unavailable on OpenRouter" in exc.detail
    # No "OpenRouter says:" tail when there was nothing to quote.
    assert "OpenRouter says:" not in exc.detail


def test_catch_all_appends_provider_message():
    err = _status_error(418, {"error": {"message": "I am a teapot."}})
    exc = _openrouter_exc(err)
    assert exc.status_code == 502
    assert "HTTP 418" in exc.detail
    assert "I am a teapot." in exc.detail
