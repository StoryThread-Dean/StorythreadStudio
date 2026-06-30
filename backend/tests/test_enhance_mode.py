# tests/test_enhance_mode.py
# ==========================
# Tests for the Writing Companion "enhance" mode: expand a highlighted passage
# into richer prose without inventing plot. Covers the prompt addendum, the
# materials-message shape (grounding vs target vs level directive), and the
# editor-chat endpoint behavior (prose sanitizer keeps ' -- '; oversized
# surrounding context is rejected). HTTP tests monkeypatch the model call and
# auth so nothing touches the network or the user's real settings.

import httpx

from app.ai.prompts import (
    _editor_chat_addendum,
    build_editor_chat_system_prompt,
    BASE_WRITING_ASSISTANT_CONTRACT,
    PUNCTUATION_RULE,
    _GENERAL_RESPONSE_RULES,
)
from app.routers import ai
from app.routers.ai import _build_materials_message, _ENHANCE_LEVEL_DIRECTIVES, ContextChip


# ── The enhance addendum + system prompt (pure functions) ────────────────────

def test_enhance_addendum_sets_enrichment_contract():
    text = _editor_chat_addendum("enhance")
    assert "Enhancing an existing passage" in text
    assert "KEEP every event, fact, action, and outcome" in text
    assert "DO NOT add new plot" in text
    assert "DO NOT introduce new named characters" in text


def test_enhance_addendum_drops_conversational_chat_rules():
    # Like draft, enhance outputs bare prose -- the chat rules would dilute it.
    text = _editor_chat_addendum("enhance")
    assert _GENERAL_RESPONSE_RULES not in text
    assert "This is a chat, not a report" not in text


def test_enhance_system_prompt_includes_contract_and_punctuation_rule():
    prompt = build_editor_chat_system_prompt("enhance", "general")
    assert BASE_WRITING_ASSISTANT_CONTRACT in prompt
    assert PUNCTUATION_RULE in prompt          # em-dash ban survives
    assert "Enhancing an existing passage" in prompt


# ── The materials message shape ──────────────────────────────────────────────

def test_materials_message_marks_target_and_grounding_for_enhance():
    msg = _build_materials_message(
        text_content="They walked to the bar.",
        is_full_chapter=False,
        context_chips=[],
        surrounding_context="Earlier, they had left the safehouse.",
        enhance_level="expanded",
        is_enhance=True,
    )
    body = msg["content"]
    # Target passage is explicitly delimited so it can't be confused with grounding.
    assert "=== BEGIN PASSAGE TO ENHANCE ===" in body
    assert "=== END PASSAGE TO ENHANCE ===" in body
    assert "They walked to the bar." in body
    # Grounding window is present and labelled do-not-rewrite.
    assert "=== BEGIN SURROUNDING CONTEXT ===" in body
    assert "do NOT rewrite" in body
    assert "Earlier, they had left the safehouse." in body
    # The active level directive is appended.
    assert _ENHANCE_LEVEL_DIRECTIVES["expanded"] in body


def test_materials_message_level_directive_varies():
    for level in ("prompt", "minimum", "expanded"):
        msg = _build_materials_message(
            text_content="A line.", is_full_chapter=False, context_chips=[],
            surrounding_context="", enhance_level=level, is_enhance=True,
        )
        assert _ENHANCE_LEVEL_DIRECTIVES[level] in msg["content"]


def test_materials_message_non_enhance_unchanged():
    # Regression: a normal selection must still use the plain "SELECTED PASSAGE"
    # label and carry no enhance markers.
    msg = _build_materials_message(
        text_content="Some prose.", is_full_chapter=False, context_chips=[],
    )
    body = msg["content"]
    assert "SELECTED PASSAGE:" in body
    assert "PASSAGE TO ENHANCE" not in body
    assert "SURROUNDING CONTEXT" not in body


# ── The endpoint (monkeypatched: no network, no real settings) ───────────────

def _patch_auth(monkeypatch):
    """Make auth/validation permissive so we reach the endpoint body hermetically."""
    monkeypatch.setattr(ai, "_resolve_model_and_key", lambda mid: ("fake-key", mid or "test/model"))
    monkeypatch.setattr(ai, "_validate_model_content_mode", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_validate_model_allowed", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_build_story_context", lambda *a, **k: "")


def test_enhance_endpoint_keeps_double_hyphen(client, monkeypatch):
    _patch_auth(monkeypatch)

    captured = {}

    async def fake_run_chat(**kwargs):
        # Capture what the endpoint chose so we can assert prose mode.
        captured.update(kwargs)
        # run_chat normally sanitizes; here we return the already-sanitized prose
        # the prose path would yield (em dash gone, ' -- ' kept).
        return "She paused -- then ran."

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "enhance",
        "text_content": "She paused, then ran.",
        "messages": [{"role": "user", "content": "make it vivid"}],
        "surrounding_context": "The corridor was dark.",
        "enhance_level": "minimum",
        "content_mode": "general",
    })
    assert resp.status_code == 200, resp.text
    assert "--" in resp.json()["reply"]
    # Enhance must run through the prose sanitizer (keeps ' -- '), like draft.
    assert captured["sanitize_mode"] == "prose"


def test_enhance_endpoint_rejects_oversized_surrounding_context(client, monkeypatch):
    _patch_auth(monkeypatch)
    monkeypatch.setattr(ai, "run_chat", lambda **k: None)  # should never be called

    resp = client.post("/api/ai/editor-chat", json={
        "category": "enhance",
        "text_content": "short passage",
        "messages": [{"role": "user", "content": "enhance"}],
        "surrounding_context": "x" * 30_001,
        "content_mode": "general",
    })
    assert resp.status_code == 400
    assert "surrounding context is too long" in resp.json()["detail"].lower()
