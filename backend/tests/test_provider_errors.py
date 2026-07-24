# tests/test_provider_errors.py -- Provider-aware error translation
# ===================================================================
# _provider_exc() templates every user-facing error message on the provider
# that actually failed, so a NanoGPT failure says "NanoGPT", never
# "OpenRouter". The OpenRouter-flavored behavior itself is locked in by
# test_openrouter_errors.py (which now exercises the backward-compatible
# aliases) -- this file covers the NanoGPT side of the template.

import httpx

from app.ai.providers import NANOGPT
from app.routers.ai import _provider_exc


def _status_error(status: int, body) -> httpx.HTTPStatusError:
    """Same builder as test_openrouter_errors.py, aimed at NanoGPT's URL."""
    request = httpx.Request("POST", "https://nano-gpt.com/api/v1/chat/completions")
    if isinstance(body, (bytes, bytearray)):
        response = httpx.Response(status, content=body, request=request)
    else:
        response = httpx.Response(status, json=body, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


def test_401_names_nanogpt():
    exc = _provider_exc(_status_error(401, b""), NANOGPT)
    assert exc.status_code == 401
    assert "NanoGPT" in exc.detail
    assert "OpenRouter" not in exc.detail


def test_402_points_at_nanogpt_funding():
    exc = _provider_exc(_status_error(402, b""), NANOGPT)
    assert exc.status_code == 402
    assert "nano-gpt.com" in exc.detail


def test_404_keeps_project_settings_guidance_and_quotes_provider():
    exc = _provider_exc(
        _status_error(404, {"error": {"message": "model xyz was removed"}}),
        NANOGPT,
    )
    assert exc.status_code == 502
    # The actionable guidance must survive the provider templating.
    assert "Project Settings" in exc.detail
    assert "unavailable on NanoGPT" in exc.detail
    assert "NanoGPT says: model xyz was removed" in exc.detail


def test_5xx_names_nanogpt():
    exc = _provider_exc(_status_error(503, b""), NANOGPT)
    assert exc.status_code == 502
    assert "NanoGPT service error" in exc.detail


def test_catch_all_names_nanogpt():
    exc = _provider_exc(_status_error(418, {"error": {"message": "teapot"}}), NANOGPT)
    assert exc.status_code == 502
    assert "NanoGPT returned an unexpected error" in exc.detail
    assert "NanoGPT says: teapot" in exc.detail
