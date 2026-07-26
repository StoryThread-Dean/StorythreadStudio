# tests/test_providers.py -- Provider registry + request-time dispatch
# =====================================================================
# The AI provider registry (app/ai/providers.py) is the seam that lets the
# whole app switch between OpenRouter and NanoGPT with one settings value.
# These tests lock in:
#   1. The registry contents and safe fallback for unknown values.
#   2. _resolve_model_and_key() -- the single dispatch point every AI
#      endpoint uses -- behaving correctly per provider, especially the
#      NanoGPT rules (own key, NO fallback model).

import pytest
from fastapi import HTTPException

from app.ai.providers import OPENROUTER, NANOGPT, PROVIDERS, active_provider
from app.routers import ai


# ── Registry ──────────────────────────────────────────────────────────────────

def test_registry_contains_both_providers():
    assert PROVIDERS["openrouter"] is OPENROUTER
    assert PROVIDERS["nanogpt"] is NANOGPT


def test_openrouter_config_capabilities():
    # OpenRouter is the full-featured provider: attribution headers,
    # reasoning param, cache_control, and a safe fallback model.
    assert OPENROUTER.supports_reasoning_param
    assert OPENROUTER.supports_cache_control
    assert OPENROUTER.fallback_model
    assert "HTTP-Referer" in OPENROUTER.extra_headers


def test_nanogpt_config_is_plain():
    # NanoGPT is a plain OpenAI-compatible endpoint: no extras, and no
    # fallback model (its catalog differs from OpenRouter's).
    assert NANOGPT.base_url == "https://nano-gpt.com/api/v1"
    assert NANOGPT.extra_headers == {}
    assert not NANOGPT.supports_reasoning_param
    assert not NANOGPT.supports_cache_control
    assert NANOGPT.fallback_model is None
    assert NANOGPT.api_key_setting == "nanogpt_api_key"


def test_active_provider_defaults_to_openrouter():
    # Missing key (pre-upgrade settings file) and unknown values both fall
    # back to OpenRouter -- the provider every existing install was using.
    assert active_provider({}) is OPENROUTER
    assert active_provider({"ai_provider": "something-new"}) is OPENROUTER
    assert active_provider({"ai_provider": "nanogpt"}) is NANOGPT


# ── _resolve_model_and_key dispatch ──────────────────────────────────────────

def _patch_settings(monkeypatch, settings: dict):
    """Point ai.load_settings at a fixed dict so no real file is read."""
    monkeypatch.setattr(ai, "load_settings", lambda: settings)


def test_resolve_openrouter_uses_its_key_and_fallback(monkeypatch):
    _patch_settings(monkeypatch, {
        "ai_provider": "openrouter",
        "openrouter_api_key": "sk-or-real",
        "nanogpt_api_key": "nano-real",
        "default_model": "",
    })
    provider, api_key, model_id = ai._resolve_model_and_key(None)
    assert provider is OPENROUTER
    assert api_key == "sk-or-real"
    assert model_id == OPENROUTER.fallback_model


def test_resolve_nanogpt_uses_its_own_key(monkeypatch):
    _patch_settings(monkeypatch, {
        "ai_provider": "nanogpt",
        "openrouter_api_key": "sk-or-real",
        "nanogpt_api_key": "nano-real",
        "default_model": "some/nano-model",
    })
    provider, api_key, model_id = ai._resolve_model_and_key(None)
    assert provider is NANOGPT
    assert api_key == "nano-real"          # NOT the OpenRouter key
    assert model_id == "some/nano-model"


def test_resolve_nanogpt_missing_key_names_nanogpt(monkeypatch):
    _patch_settings(monkeypatch, {
        "ai_provider": "nanogpt",
        "openrouter_api_key": "sk-or-real",  # present but must NOT be used
        "nanogpt_api_key": "",
        "default_model": "some/model",
    })
    with pytest.raises(HTTPException) as exc_info:
        ai._resolve_model_and_key(None)
    assert exc_info.value.status_code == 400
    assert "NanoGPT" in exc_info.value.detail


def test_resolve_nanogpt_no_model_is_400_not_fallback(monkeypatch):
    # NanoGPT has no fallback model: with nothing picked, the writer gets a
    # clear 400 telling them to choose one -- never a guessed slug that 404s.
    _patch_settings(monkeypatch, {
        "ai_provider": "nanogpt",
        "nanogpt_api_key": "nano-real",
        "default_model": "",
    })
    with pytest.raises(HTTPException) as exc_info:
        ai._resolve_model_and_key(None)
    assert exc_info.value.status_code == 400
    assert "No model selected" in exc_info.value.detail
    assert "NanoGPT" in exc_info.value.detail


def test_resolve_request_override_wins(monkeypatch):
    _patch_settings(monkeypatch, {
        "ai_provider": "openrouter",
        "openrouter_api_key": "sk-or-real",
        "default_model": "global/model",
    })
    provider, _, model_id = ai._resolve_model_and_key("project/override")
    assert model_id == "project/override"
