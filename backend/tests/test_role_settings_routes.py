# tests/test_role_settings_routes.py -- Model Roles over the Settings API
# =======================================================================
# The Settings screen is the only way a writer assigns models to jobs, so
# these pin the round trip: what can be saved, what is refused, and what
# the screen is told about the roles themselves.
#
# The role catalog is served from the backend on purpose. If the frontend
# kept its own copy, the list of jobs on screen could drift from the roles
# the AI call sites actually use, and the writer would be configuring
# something that no longer exists.

import pytest
from fastapi.testclient import TestClient

from app.ai.roles import ROLES
from app.main import app
from app.routers import settings as settings_router

client = TestClient(app)


@pytest.fixture
def stored(monkeypatch):
    """An in-memory settings file, so no real one is touched."""
    data = {
        "ai_provider": "openrouter",
        "openrouter_api_key": "sk-or-test",
        "nanogpt_api_key": "",
        "default_model": "openai/gpt-4o-mini",
        "model_roles": {},
        "local_base_url": "",
        "local_api_style": "openai",
    }
    monkeypatch.setattr(settings_router, "load_settings", lambda: dict(data))
    monkeypatch.setattr(settings_router, "save_settings", lambda s: data.update(s))
    monkeypatch.setattr(settings_router, "get_vault_root", lambda: "C:/vault")
    return data


# ── The role catalog ─────────────────────────────────────────────────────────

def test_roles_endpoint_lists_every_role_with_an_explanation():
    body = client.get("/api/settings/roles").json()
    ids = [r["id"] for r in body["roles"]]
    assert ids == ROLES                      # order is what Settings renders
    assert "fallback" not in ids             # Default Model is not a role

    for role in body["roles"]:
        assert role["label"] and role["blurb"]
        # Either it lists what uses it, or it says plainly that nothing does.
        assert role["features"] or role["reserved_note"]


def test_reserved_roles_are_flagged_so_the_ui_can_say_so():
    body = client.get("/api/settings/roles").json()
    reserved = [r for r in body["roles"] if r["reserved"]]
    assert reserved, "expected at least one role with no consumers yet"
    for role in reserved:
        assert role["features"] == []
        assert role["reserved_note"].strip()


# ── Saving assignments ───────────────────────────────────────────────────────

def test_a_role_assignment_round_trips(stored):
    body = client.put("/api/settings", json={
        "model_roles": {"prose": {"provider": "openrouter", "model": "anthropic/claude-opus-4"}}
    }).json()
    assert body["model_roles"]["prose"] == {
        "provider": "openrouter", "model": "anthropic/claude-opus-4"
    }
    assert client.get("/api/settings").json()["model_roles"]["prose"]["model"] \
        == "anthropic/claude-opus-4"


def test_unknown_roles_and_providers_are_dropped_and_the_response_shows_it(stored):
    # The response echoes what was actually stored, so a dropped entry is
    # visible in the UI immediately rather than appearing to save and then
    # quietly not working.
    body = client.put("/api/settings", json={
        "model_roles": {
            "prose":       {"provider": "openrouter",  "model": "good/model"},
            "vibes":       {"provider": "openrouter",  "model": "x/y"},
            "critique":    {"provider": "dead-service", "model": "x/y"},
            "brainstorm":  {"provider": "openrouter",  "model": ""},
        }
    }).json()
    assert set(body["model_roles"]) == {"prose"}


def test_clearing_roles_returns_to_default_model_behaviour(stored):
    client.put("/api/settings", json={
        "model_roles": {"prose": {"provider": "openrouter", "model": "x/y"}}
    })
    body = client.put("/api/settings", json={"model_roles": {}}).json()
    assert body["model_roles"] == {}


# ── The local endpoint field ─────────────────────────────────────────────────

def test_a_local_address_round_trips(stored):
    body = client.put("/api/settings", json={
        "local_base_url": "http://localhost:11434", "local_api_style": "ollama"
    }).json()
    assert body["local_base_url"] == "http://localhost:11434"
    assert body["local_api_style"] == "ollama"


def test_a_public_address_is_refused_with_the_reason(stored):
    # Deliberately a 400 rather than the silent-ignore this file uses for
    # enum fields: the writer typed an address, and a value that vanishes
    # without explanation reads as a bug in saving.
    response = client.put("/api/settings", json={
        "local_base_url": "https://api.openai.com/v1"
    })
    assert response.status_code == 400
    assert "not a local address" in response.json()["detail"]


def test_an_empty_address_clears_it_without_complaint(stored):
    client.put("/api/settings", json={"local_base_url": "http://localhost:11434"})
    body = client.put("/api/settings", json={"local_base_url": ""}).json()
    assert body["local_base_url"] == ""


def test_an_unknown_api_style_is_ignored_not_stored(stored):
    body = client.put("/api/settings", json={"local_api_style": "telepathy"}).json()
    assert body["local_api_style"] == "openai"


# ── The keys must never leak ─────────────────────────────────────────────────

def test_saving_roles_does_not_expose_the_api_key(stored):
    body = client.put("/api/settings", json={
        "model_roles": {"prose": {"provider": "openrouter", "model": "x/y"}}
    }).json()
    assert body["openrouter_api_key"] != "sk-or-test"
    assert body["openrouter_api_key_set"] is True
