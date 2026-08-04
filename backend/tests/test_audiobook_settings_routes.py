# tests/test_audiobook_settings_routes.py
# ========================================
# The audiobook's own settings surface: which engine narrates, and which
# API keys it may spend. Two things are tested harder than the rest,
# because getting either wrong costs the writer money or their key:
#
#   1. KEY HANDLING. A key is masked on the way out, never echoed back on
#      the way in, an omitted field leaves the stored key alone (so the
#      engine can be changed without retyping), and "" clears it.
#   2. ENGINE VALIDATION. A pair that cannot resolve is refused OUT LOUD.
#      Silently storing it would leave the writer believing an engine was
#      saved while narration quietly fell back to their chat model.

import pytest
from fastapi.testclient import TestClient

from app import settings_store
from app.audiobook import pronunciation, recents_store
from app.main import app

client = TestClient(app)

REAL_KEY = "sk-or-v1-abcdefghijklmnopqrstuvwxyz"
MASKED_KEY = "sk-or-...wxyz"


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH", tmp_path / "gp.json")
    # Never read or write the real settings file (house rule).
    monkeypatch.setattr(settings_store, "SETTINGS_DIR", tmp_path / "st")
    monkeypatch.setattr(settings_store, "SETTINGS_FILE", tmp_path / "st" / "settings.json")
    monkeypatch.setattr(settings_store, "SETTINGS_BACKUP", tmp_path / "st" / "settings.json.bak")
    monkeypatch.setattr(settings_store, "SETTINGS_TMP", tmp_path / "st" / "settings.json.tmp")


def _get() -> dict:
    response = client.get("/api/audiobook/settings")
    assert response.status_code == 200, response.text
    return response.json()


def _put(**fields) -> dict:
    response = client.put("/api/audiobook/settings", json=fields)
    assert response.status_code == 200, response.text
    return response.json()


# ── Defaults ──────────────────────────────────────────────────────────────────

def test_defaults_borrow_the_writing_keys_and_choose_nothing():
    body = _get()
    assert body["use_writing_keys"] is True
    assert body["narration_provider"] == ""
    assert body["narration_model"] == ""
    assert body["openrouter_api_key"] == ""
    assert body["openrouter_api_key_set"] is False


def test_the_new_settings_survive_the_save_whitelist():
    # save_settings whitelists against DEFAULT_SETTINGS, so a setting that
    # is not declared there is silently dropped. This is the regression
    # guard for that trap.
    _put(narration_provider="openrouter", narration_model="hexgrad/kokoro-82m",
         premium_voice="bf_lily", use_writing_keys=False)
    stored = settings_store.load_settings()
    assert stored["audiobook_tts_provider"] == "openrouter"
    assert stored["audiobook_tts_model"] == "hexgrad/kokoro-82m"
    assert stored["audiobook_tts_voice"] == "bf_lily"
    assert stored["audiobook_use_writing_keys"] is False


# ── Keys ──────────────────────────────────────────────────────────────────────

def test_keys_are_masked_out_and_never_echoed_back_in():
    saved = _put(openrouter_api_key=REAL_KEY)
    # The response shows enough to recognize, never enough to use.
    assert saved["openrouter_api_key"] == MASKED_KEY
    assert saved["openrouter_api_key_set"] is True
    assert REAL_KEY not in str(saved)
    assert _get()["openrouter_api_key"] == MASKED_KEY
    # The real key is intact on disk.
    assert settings_store.load_settings()["audiobook_openrouter_api_key"] == REAL_KEY


def test_an_omitted_key_field_leaves_the_stored_key_alone():
    _put(nanogpt_api_key=REAL_KEY)
    # Saving an engine choice must not wipe a key the writer did not retype.
    _put(narration_provider="nanogpt", narration_model="Kokoro-82m")
    assert settings_store.load_settings()["audiobook_nanogpt_api_key"] == REAL_KEY
    assert _get()["nanogpt_api_key_set"] is True


def test_an_empty_string_clears_a_key():
    _put(nanogpt_api_key=REAL_KEY)
    cleared = _put(nanogpt_api_key="")
    assert cleared["nanogpt_api_key"] == ""
    assert cleared["nanogpt_api_key_set"] is False
    assert settings_store.load_settings()["audiobook_nanogpt_api_key"] == ""


def test_writing_keys_are_reported_as_booleans_only():
    settings = settings_store.load_settings()
    settings["openrouter_api_key"] = REAL_KEY
    settings_store.save_settings(settings)

    body = _get()
    assert body["writing_openrouter_key_set"] is True
    assert body["writing_nanogpt_key_set"] is False
    # The writing key belongs to the other screen: not even masked here.
    assert REAL_KEY not in str(body)
    assert MASKED_KEY not in str(body)


# ── The engine pair ───────────────────────────────────────────────────────────

def test_a_bogus_model_is_refused_out_loud():
    response = client.put("/api/audiobook/settings", json={
        "narration_provider": "openrouter", "narration_model": "not-a-model"})
    assert response.status_code == 400
    assert "Available:" in response.json()["detail"]
    # And nothing was stored -- the writer is not left believing it saved.
    assert settings_store.load_settings()["audiobook_tts_model"] == ""


def test_an_unknown_provider_is_refused_too():
    response = client.put("/api/audiobook/settings", json={
        "narration_provider": "madeup", "narration_model": "whatever"})
    assert response.status_code == 400


def test_clearing_the_engine_choice_is_allowed():
    _put(narration_provider="openrouter", narration_model="hexgrad/kokoro-82m")
    cleared = _put(narration_provider="", narration_model="")
    assert cleared["narration_provider"] == ""
    assert cleared["narration_model"] == ""
