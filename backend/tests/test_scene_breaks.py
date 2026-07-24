# tests/test_scene_breaks.py
# ==========================
# Tests for POST /api/ai/suggest-scene-breaks. The model call and auth are
# monkeypatched so nothing touches the network or the user's real settings.
# Covers: happy-path parsing + sanitizing, malformed model output (no crash),
# severity normalization, dropping entries missing a quote/explanation, and the
# empty / oversized chapter guards.

import json

from app.routers import ai
from app.ai.prompts import generate_scene_break_suggestions_prompt, PUNCTUATION_RULE


def _patch_auth(monkeypatch):
    monkeypatch.setattr(ai, "_resolve_model_and_key",
                        lambda mid: (ai.OPENROUTER, "fake-key", mid or "test/model"))
    monkeypatch.setattr(ai, "_validate_model_content_mode", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_validate_model_allowed", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_build_story_context", lambda *a, **k: "")


def _patch_model(monkeypatch, reply: str):
    async def fake_run_chat(**kwargs):
        return reply
    monkeypatch.setattr(ai, "run_chat", fake_run_chat)


# ── The prompt (pure) ─────────────────────────────────────────────────────────

def test_prompt_includes_instructions_and_punctuation_rule():
    p = generate_scene_break_suggestions_prompt("general")
    assert "scene break" in p.lower()
    assert "verbatim" in p.lower()
    assert PUNCTUATION_RULE in p


# ── The endpoint ──────────────────────────────────────────────────────────────

def test_suggest_scene_breaks_happy_path(client, monkeypatch):
    _patch_auth(monkeypatch)
    _patch_model(monkeypatch, json.dumps({
        "analysis": "The chapter runs two distinct beats together.",
        "suggestions": [
            {"quote": "She stepped back into the evening air.", "explanation": "POV shifts to Marcus.", "severity": "strong"},
            {"quote": "The door slammed behind him.", "explanation": "Location changes to the street.", "severity": "moderate"},
        ],
    }))

    resp = client.post("/api/ai/suggest-scene-breaks", json={
        "chapter_text": "A chapter with enough text to analyze.",
        "content_mode": "general",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["suggestions"]) == 2
    assert body["suggestions"][0]["quote"] == "She stepped back into the evening air."
    assert body["suggestions"][0]["severity"] == "strong"
    assert "two distinct beats" in body["analysis"]


def test_suggest_scene_breaks_drops_incomplete_and_normalizes_severity(client, monkeypatch):
    _patch_auth(monkeypatch)
    _patch_model(monkeypatch, json.dumps({
        "analysis": "ok",
        "suggestions": [
            {"quote": "valid quote here", "explanation": "good reason", "severity": "WILD"},  # bad severity -> moderate
            {"quote": "", "explanation": "no quote so dropped", "severity": "strong"},          # dropped
            {"quote": "another good quote", "explanation": "", "severity": "subtle"},            # dropped (no explanation)
        ],
    }))

    resp = client.post("/api/ai/suggest-scene-breaks", json={"chapter_text": "text"})
    assert resp.status_code == 200, resp.text
    suggestions = resp.json()["suggestions"]
    assert len(suggestions) == 1
    assert suggestions[0]["severity"] == "moderate"  # unknown value normalized


def test_suggest_scene_breaks_malformed_json_yields_no_suggestions(client, monkeypatch):
    _patch_auth(monkeypatch)
    _patch_model(monkeypatch, "I think a break would be nice somewhere, honestly.")  # not JSON

    resp = client.post("/api/ai/suggest-scene-breaks", json={"chapter_text": "text"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["suggestions"] == []


def test_suggest_scene_breaks_empty_chapter_rejected(client, monkeypatch):
    _patch_auth(monkeypatch)
    _patch_model(monkeypatch, "{}")
    resp = client.post("/api/ai/suggest-scene-breaks", json={"chapter_text": "   "})
    assert resp.status_code == 400
    assert "empty" in resp.json()["detail"].lower()


def test_suggest_scene_breaks_oversized_chapter_rejected(client, monkeypatch):
    _patch_auth(monkeypatch)
    _patch_model(monkeypatch, "{}")
    resp = client.post("/api/ai/suggest-scene-breaks", json={"chapter_text": "x" * 100_001})
    assert resp.status_code == 400
    assert "too long" in resp.json()["detail"].lower()
