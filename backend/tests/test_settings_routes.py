# tests/test_settings_routes.py -- Settings API provider fields
# ===============================================================
# HTTP-level tests for the new provider-related settings fields:
# ai_provider (with silent-ignore of unknown values), the NanoGPT key
# (set / mask / clear -- identical rules to the OpenRouter key), and the
# prompt_caching toggle round-trip.
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
    # Prompt caching defaults ON (roadmap decision).
    assert data["prompt_caching"] is True


def test_prompt_caching_toggle_round_trip(client):
    resp = client.put("/api/settings", json={"prompt_caching": False})
    assert resp.json()["prompt_caching"] is False
    assert client.get("/api/settings").json()["prompt_caching"] is False
    resp = client.put("/api/settings", json={"prompt_caching": True})
    assert resp.json()["prompt_caching"] is True


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


# ── Test Connection APPLIES the fix instead of describing it ─────────────────
#
# Spec: docs/local-model-spec.md sections 4.2 and 10.4.
#
# _test_local_connection already worked out which dialect a server really
# speaks and returned it as `suggested_style`. That value appeared NOWHERE in
# app/src/, so the writer read a sentence naming the dropdown to change and
# changed it by hand. Same shape as R8.1 and R8.7: the backend computed the
# right answer and no screen rendered it.
#
# It is safe to apply silently only because the style now chooses where models
# are LISTED and nothing else (a wrong value costs an empty dropdown, never a
# wrong answer or a charge) -- and it is still said out loud, because a setting
# that changes itself without mentioning it is its own bug.

def _probe_answers_only(monkeypatch, working_style: str):
    """Make the model-list probe succeed for exactly one API style."""
    from app.routers import settings as settings_router

    dead = {"ok": False, "error": "Nothing answered at that address."}

    async def fake_test_connection(_key, provider=None):
        if working_style not in ("openai", "ollama"):
            return dead          # nothing is listening at all
        base = getattr(provider, "base_url", "")
        # The ollama catalog hangs off the bare root; everything else off /v1.
        shaped = "ollama" if not base.endswith("/v1") else "openai"
        return {"ok": True, "model_count": 3} if shaped == working_style else dead

    monkeypatch.setattr(settings_router, "test_connection", fake_test_connection)


def test_a_wrong_api_style_is_corrected_and_persisted(client, monkeypatch):
    # The writer says OpenAI-compatible; the server is really Ollama.
    client.put("/api/settings", json={
        "ai_provider": "local",
        "local_base_url": "http://localhost:11434",
        "local_api_style": "openai",
    })
    _probe_answers_only(monkeypatch, "ollama")

    data = client.post("/api/settings/test-connection",
                       json={"provider": "local"}).json()

    # It connected, rather than reporting a dead server it had just reached.
    assert data["ok"] is True
    assert data["corrected_style"] == "ollama"
    # PERSISTED. The whole point: the writer does not go and change a dropdown.
    assert client.get("/api/settings").json()["local_api_style"] == "ollama"


def test_the_correction_is_said_out_loud_in_the_writer_s_words(client, monkeypatch):
    client.put("/api/settings", json={
        "ai_provider": "local",
        "local_base_url": "http://localhost:11434",
        "local_api_style": "openai",
    })
    _probe_answers_only(monkeypatch, "ollama")

    notice = client.post("/api/settings/test-connection",
                         json={"provider": "local"}).json()["notice"]
    # The label the writer actually sees in the dropdown, not the wire value.
    assert "Ollama native" in notice
    assert "switched for you" in notice


def test_a_correct_api_style_is_left_alone(client, monkeypatch):
    # Nothing to correct: the setting must not be rewritten, and no notice
    # should appear. A "we fixed it for you" on a working setup teaches the
    # writer to distrust the message.
    client.put("/api/settings", json={
        "ai_provider": "local",
        "local_base_url": "http://localhost:11434",
        "local_api_style": "ollama",
    })
    _probe_answers_only(monkeypatch, "ollama")

    data = client.post("/api/settings/test-connection",
                       json={"provider": "local"}).json()
    assert data["ok"] is True
    assert "corrected_style" not in data
    assert "notice" not in data
    assert client.get("/api/settings").json()["local_api_style"] == "ollama"


def test_a_dead_server_is_not_reported_as_a_style_problem(client, monkeypatch):
    # Neither style answers. The writer needs "start the server", not "flip a
    # dropdown" -- and nothing may be written to settings on the way.
    client.put("/api/settings", json={
        "ai_provider": "local",
        "local_base_url": "http://localhost:11434",
        "local_api_style": "openai",
    })
    _probe_answers_only(monkeypatch, "neither")

    data = client.post("/api/settings/test-connection",
                       json={"provider": "local"}).json()
    assert data["ok"] is False
    assert "corrected_style" not in data
    assert client.get("/api/settings").json()["local_api_style"] == "openai"
