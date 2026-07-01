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
    context_stance_instruction,
    BASE_WRITING_ASSISTANT_CONTRACT,
    PUNCTUATION_RULE,
    _GENERAL_RESPONSE_RULES,
)
from app.routers import ai
from app.routers.ai import _build_materials_message, _enhance_length_directive, _ENHANCE_MAX_WORDS, ContextChip


# ── The enhance addendum + system prompt (pure functions) ────────────────────

def test_enhance_addendum_is_direction_led_with_level_budget():
    text = _editor_chat_addendum("enhance")
    # Writer's message is the direction; the level governs length.
    assert "DIRECTION" in text
    assert "ENHANCEMENT LEVEL" in text
    assert "HARD budget" in text
    # The three length bands are described.
    assert "Restate" in text and "Default" in text and "Expanded" in text


def test_enhance_addendum_drops_conversational_chat_rules():
    # Like draft, enhance outputs bare prose -- the chat rules would dilute it.
    text = _editor_chat_addendum("enhance")
    assert _GENERAL_RESPONSE_RULES not in text
    assert "This is a chat, not a report" not in text


def test_enhance_system_prompt_includes_contract_and_punctuation_rule():
    prompt = build_editor_chat_system_prompt("enhance", "general")
    assert BASE_WRITING_ASSISTANT_CONTRACT in prompt
    assert PUNCTUATION_RULE in prompt          # em-dash ban survives
    assert "Revising a highlighted passage" in prompt


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
    # The active level directive is appended (label + a concrete word target).
    assert "ENHANCEMENT LEVEL: Expanded" in body
    assert "words" in body


def test_materials_message_level_directive_varies():
    for level, label in [("restate", "Restate"), ("default", "Default"), ("expanded", "Expanded")]:
        msg = _build_materials_message(
            text_content="A line.", is_full_chapter=False, context_chips=[],
            surrounding_context="", enhance_level=level, is_enhance=True,
        )
        assert f"ENHANCEMENT LEVEL: {label}" in msg["content"]


def test_materials_message_unknown_level_falls_back_to_default_band():
    msg = _build_materials_message(
        text_content="A line.", is_full_chapter=False, context_chips=[],
        surrounding_context="", enhance_level="bogus", is_enhance=True,
    )
    assert "ENHANCEMENT LEVEL: Default" in msg["content"]


# ── Adaptive length directive ────────────────────────────────────────────────

def test_length_directive_scales_with_selection():
    # ~120 words of selection at "default" (1.5-2.2x) -> ~180 to 264 words.
    selection = "word " * 120
    d = _enhance_length_directive("default", selection)
    assert "about 100 words" in d or "about 120 words" in d  # ~120 words estimated
    assert "words total" in d


def test_length_directive_caps_large_selections():
    # A very large selection at "expanded" must be clamped to the absolute cap,
    # not 4x (which would be a runaway rewrite). This is the adaptive behavior.
    selection = "word " * 4000        # ~3300 words
    d = _enhance_length_directive("expanded", selection)
    assert str(_ENHANCE_MAX_WORDS) in d          # high end clamped to the cap
    assert "large passage" in d                  # the focus reminder kicks in


def test_length_directive_restate_stays_same_length():
    d = _enhance_length_directive("restate", "word " * 100)
    assert "about the same length" in d
    assert "do not pad" in d


# ── Attachment stance (Canon/Reference toggle) ───────────────────────────────

def test_canon_stance_enforces_attachments():
    s = context_stance_instruction(True)
    assert "CANON" in s
    assert "consistent" in s


def test_reference_stance_lets_direction_win():
    s = context_stance_instruction(False)
    assert "REFERENCE" in s
    assert "DIRECTION" in s and "PRECEDENCE" in s


def test_materials_chip_header_reflects_canon_toggle():
    chip = ContextChip(type="character", name="Lara", content="brave")
    canon = _build_materials_message("", False, [chip], treat_as_canon=True)["content"]
    ref = _build_materials_message("", False, [chip], treat_as_canon=False)["content"]
    assert "treat as canon" in canon
    assert "ATTACHED REFERENCE" in ref and "direction takes precedence" in ref


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
        "enhance_level": "restate",
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
