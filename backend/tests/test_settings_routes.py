# tests/test_settings_routes.py -- Settings API provider fields
# ===============================================================
# HTTP-level tests for the new provider-related settings fields:
# ai_provider (with silent-ignore of unknown values) and the NanoGPT key
# (set / mask / clear -- identical rules to the OpenRouter key). The
# prompt_caching toggle round-trip is added with the caching feature.
#
# Each test redirects settings_store's file paths into a tmp sandbox so
# the developer's real ~/.storythread/settings.json is never touched
# (same isolation pattern as test_settings_store.py, but exercised
# through the real FastAPI routes).

import pytest

from app import settings_store


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """Every test in this file gets a fresh settings sandbox."""
    sandbox = tmp_path / ".storythread"
    monkeypatch.setattr(settings_store, "SETTINGS_DIR",    sandbox)
    monkeypatch.setattr(settings_store, "SETTINGS_FILE",   sandbox / "settings.json")
    monkeypatch.setattr(settings_store, "SETTINGS_BACKUP", sandbox / "settings.json.bak")
    monkeypatch.setattr(settings_store, "SETTINGS_TMP",    sandbox / "settings.json.tmp")
    return sandbox


def test_get_settings_defaults_to_openrouter(client):
    data = client.get("/api/settings").json()
    assert data["ai_provider"] == "openrouter"
    assert data["nanogpt_api_key"] == ""
    assert data["nanogpt_api_key_set"] is False


def test_switch_provider_round_trip(client):
    resp = client.put("/api/settings", json={"ai_provider": "nanogpt"})
    assert resp.json()["ai_provider"] == "nanogpt"
    # Persisted, not just echoed:
    assert client.get("/api/settings").json()["ai_provider"] == "nanogpt"


def test_unknown_provider_silently_ignored(client):
    client.put("/api/settings", json={"ai_provider": "nanogpt"})
    resp = client.put("/api/settings", json={"ai_provider": "not-a-provider"})
    # Unknown value ignored -- the saved provider stays what it was.
    assert resp.json()["ai_provider"] == "nanogpt"


def test_nanogpt_key_set_mask_clear(client):
    # Set: full key stored, response masked.
    resp = client.put("/api/settings", json={"nanogpt_api_key": "nano-secret-key-12345"})
    data = resp.json()
    assert data["nanogpt_api_key_set"] is True
    assert "nano-secret-key-12345" not in data["nanogpt_api_key"]
    assert data["nanogpt_api_key"].endswith("2345")
    # The OTHER provider's key is untouched.
    assert data["openrouter_api_key_set"] is False

    # Clear: empty string wipes it.
    resp = client.put("/api/settings", json={"nanogpt_api_key": ""})
    data = resp.json()
    assert data["nanogpt_api_key_set"] is False
    assert data["nanogpt_api_key"] == ""


def test_both_keys_stored_independently(client):
    client.put("/api/settings", json={"openrouter_api_key": "sk-or-aaaa-bbbb-cccc"})
    client.put("/api/settings", json={"nanogpt_api_key": "nano-dddd-eeee-ffff"})
    data = client.get("/api/settings").json()
    # Switching between providers must never lose the other key.
    assert data["openrouter_api_key_set"] is True
    assert data["nanogpt_api_key_set"] is True


def test_test_connection_reports_missing_key_per_provider(client):
    # No keys saved at all: testing NanoGPT explicitly must name NanoGPT.
    resp = client.post("/api/settings/test-connection", json={"provider": "nanogpt"})
    data = resp.json()
    assert data["ok"] is False
    assert "NanoGPT" in data["error"]

    # Default (no body): active provider is OpenRouter.
    resp = client.post("/api/settings/test-connection")
    data = resp.json()
    assert data["ok"] is False
    assert "OpenRouter" in data["error"]
