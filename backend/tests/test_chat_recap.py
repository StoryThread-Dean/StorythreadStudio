"""
tests/test_chat_recap.py -- the summary that stands in for older turns.

This is the roadmap's "summary swap" applied to a conversation rather than to
a chapter, and the money rules are the interesting part:

  BOUGHT ONCE, at the first moment it is needed. Not when the conversation is
  put away (most are never reopened, so that buys recaps nobody reads), and not
  on every resume (that re-buys what the writer already paid for -- a rule in
  this codebase, not a preference; see codex/findings.py).

  EXTENDED, NEVER REBUILT. A second resume compresses only the turns added
  since the last one and folds the old recap in as context, so older material
  is never re-read and never re-charged.

  AND IT MUST NOT LOSE A DECISION. Everything before the cut is replaced by the
  recap. Whatever is not in it is gone from the assistant's view with nothing
  on screen to say so, which is why an empty answer is refused rather than
  stored.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.chat_sessions import load_chat, new_chat, save_chat
from app.main import app
from app.routers import ai

client = TestClient(app)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / ".storythread").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    return str(root)


def _patch_auth(monkeypatch):
    monkeypatch.setattr(ai, "_resolve_model_and_key",
                        lambda role, mid=None: (ai.OPENROUTER, "k", mid or "test/model"))


def _capture(monkeypatch, reply="- Vance is the traitor.\n- Cut the prologue."):
    captured = {}

    async def fake_run_chat(**kwargs):
        captured.update(kwargs)
        return reply

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)
    return captured


def _conversation(project: str, pairs: int) -> str:
    """A session with `pairs` exchanges -- 2 * pairs visible messages."""
    chat = new_chat("companion")
    for i in range(pairs):
        chat["messages"].append({"role": "user", "content": f"question {i}"})
        chat["messages"].append({"role": "assistant", "content": f"answer {i}"})
    save_chat(project, chat)
    return chat["chat_id"]


def _recap(project: str, chat_id: str):
    return client.post("/api/ai/chat-recap", json={
        "project_path": project, "chat_id": chat_id})


# ── When it is worth buying ──────────────────────────────────────────────────

def test_a_short_conversation_buys_nothing(project, monkeypatch):
    # Finding out from the model that there was nothing to compress would cost
    # the writer a request to be told so.
    _patch_auth(monkeypatch)
    captured = _capture(monkeypatch)
    chat_id = _conversation(project, 3)          # 6 messages

    body = _recap(project, chat_id).json()
    assert body["reused"] is True
    assert body["recap"] == ""
    assert captured == {}                        # no model call at all


def test_a_long_one_is_compressed(project, monkeypatch):
    _patch_auth(monkeypatch)
    _capture(monkeypatch)
    chat_id = _conversation(project, 8)          # 16 messages

    body = _recap(project, chat_id).json()
    assert body["reused"] is False
    assert "Vance is the traitor" in body["recap"]
    assert body["recap_through"] > 0


def test_the_recent_exchanges_are_left_alone(project, monkeypatch):
    """
    The last few messages go word for word, because a follow-up like "no, the
    other one" points at them. Only what is older is compressed.
    """
    _patch_auth(monkeypatch)
    captured = _capture(monkeypatch)
    chat_id = _conversation(project, 8)
    _recap(project, chat_id)

    sent = captured["messages"][0]["content"]
    assert "question 0" in sent                  # old: summarised
    assert "question 7" not in sent              # recent: sent verbatim later
    assert "answer 7" not in sent


def test_the_cut_is_an_index_the_caller_can_slice_by(project, monkeypatch):
    # recap_through indexes the STORED array. If it were an index into the
    # visible-only list, the caller slicing by it would silently send the
    # wrong half of the conversation.
    _patch_auth(monkeypatch)
    _capture(monkeypatch)
    chat_id = _conversation(project, 8)

    through = _recap(project, chat_id).json()["recap_through"]
    stored = load_chat(project, chat_id)["messages"]
    remaining = [m for m in stored[through:] if not m.get("hidden")]
    assert len(remaining) == 6                   # _RECAP_KEEP_VERBATIM


# ── Bought once ──────────────────────────────────────────────────────────────

def test_it_is_stored_on_the_session(project, monkeypatch):
    _patch_auth(monkeypatch)
    _capture(monkeypatch)
    chat_id = _conversation(project, 8)
    _recap(project, chat_id)

    chat = load_chat(project, chat_id)
    assert "Vance is the traitor" in chat["recap"]
    assert chat["recap_through"] > 0


def test_asking_again_with_nothing_new_does_not_re_buy_it(project, monkeypatch):
    """
    THE RULE, AS AN ASSERTION. What the writer paid for is never re-bought.
    A second resume of an unchanged conversation must cost nothing.
    """
    _patch_auth(monkeypatch)
    _capture(monkeypatch)
    chat_id = _conversation(project, 8)
    first = _recap(project, chat_id).json()

    captured = _capture(monkeypatch)             # a fresh spy
    again = _recap(project, chat_id).json()

    assert again["reused"] is True
    assert again["recap"] == first["recap"]
    assert captured == {}                        # no second request


def test_more_conversation_extends_it_rather_than_rebuilding(project, monkeypatch):
    """
    The old recap is folded in as context and the turns it covers are NOT sent
    again. Re-reading them would charge the writer twice for the same messages.
    """
    _patch_auth(monkeypatch)
    _capture(monkeypatch)
    chat_id = _conversation(project, 8)
    _recap(project, chat_id)

    chat = load_chat(project, chat_id)
    for i in range(8, 14):
        chat["messages"].append({"role": "user", "content": f"question {i}"})
        chat["messages"].append({"role": "assistant", "content": f"answer {i}"})
    save_chat(project, chat)

    captured = _capture(monkeypatch, reply="- Vance is the traitor.\n- New thing.")
    body = _recap(project, chat_id).json()
    assert body["reused"] is False

    sent = captured["messages"][0]["content"]
    assert "already summarised once" in sent     # the old recap, folded in
    assert "Vance is the traitor" in sent
    assert "question 0" not in sent              # NOT re-read, NOT re-charged
    assert "question 9" in sent                  # the new material is


# ── What it must never do ────────────────────────────────────────────────────

def test_an_empty_answer_is_refused_rather_than_stored(project, monkeypatch):
    """
    THE WORST FAILURE AVAILABLE HERE. Storing "" as the recap would mean the
    older half of the conversation is replaced by nothing on the next turn --
    silently, with the panel still showing every message on screen.
    """
    _patch_auth(monkeypatch)
    _capture(monkeypatch, reply="   ")
    chat_id = _conversation(project, 8)

    res = _recap(project, chat_id)
    assert res.status_code == 502
    assert "whole" in res.json()["detail"]       # says what happens instead
    assert load_chat(project, chat_id)["recap"] == ""


def test_it_is_told_not_to_invent(project, monkeypatch):
    # A recap that turns "we were unsure" into a decision puts words in the
    # writer's mouth that the assistant then treats as canon.
    _patch_auth(monkeypatch)
    captured = _capture(monkeypatch)
    _recap(project, _conversation(project, 8))
    assert "NEVER INVENT" in captured["system_prompt"]


def test_it_is_told_to_keep_what_was_rejected(project, monkeypatch):
    # Without this the assistant cheerfully suggests the same thing again,
    # which is the most annoying way a resumed conversation can fail.
    _patch_auth(monkeypatch)
    captured = _capture(monkeypatch)
    _recap(project, _conversation(project, 8))
    assert "REJECTED" in captured["system_prompt"]


def test_it_uses_the_long_context_role(project, monkeypatch):
    # A small window would drop material from the middle of a long
    # conversation without saying so, which is exactly what this must not do.
    seen = {}

    def fake_resolve(role, mid=None):
        seen["role"] = role
        return (ai.OPENROUTER, "k", "test/model")

    monkeypatch.setattr(ai, "_resolve_model_and_key", fake_resolve)
    _capture(monkeypatch)
    _recap(project, _conversation(project, 8))
    assert seen["role"] == "long_context"


def test_it_is_a_faithful_compression_not_a_piece_of_writing(project, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture(monkeypatch)
    _recap(project, _conversation(project, 8))
    from app.ai.prompts import TEMPERATURE_DEFAULTS
    assert captured["temperature"] == TEMPERATURE_DEFAULTS["critique"]


def test_it_writes_nothing_but_the_session(project, monkeypatch):
    # Not the manuscript, not the Weave, not one of the four AI-writable
    # fields. A recap is bookkeeping about a conversation.
    _patch_auth(monkeypatch)
    _capture(monkeypatch)
    import os
    chat_id = _conversation(project, 8)
    before = sorted(os.listdir(project))
    _recap(project, chat_id)
    assert sorted(os.listdir(project)) == before


def test_a_missing_conversation_is_a_404(project, monkeypatch):
    _patch_auth(monkeypatch)
    _capture(monkeypatch)
    res = client.post("/api/ai/chat-recap", json={
        "project_path": project, "chat_id": "chat-000000000000"})
    assert res.status_code == 404


def test_the_visible_cut_matches_what_a_reopened_panel_holds(project, monkeypatch):
    """
    THE INDEX THAT WOULD BE OFF BY A SILENT AMOUNT.

    `recap_through` counts STORED messages, which include the hidden materials
    descriptors. A reopened panel drops those, so slicing its array by that
    number would cut in the wrong place -- resending messages the recap
    already covers, or worse, silently dropping ones it does not.

    The endpoint returns both. This asserts they disagree exactly as much as
    the hidden messages account for, which is the whole reason for the second
    number.
    """
    _patch_auth(monkeypatch)
    _capture(monkeypatch)

    chat = new_chat("companion")
    for i in range(8):
        # A hidden materials turn before each exchange, which is what a real
        # conversation with attachments looks like.
        chat["messages"].append({"role": "user", "hidden": True,
                                 "content": f"=== BEGIN NOTE: n{i} ==="})
        chat["messages"].append({"role": "user", "content": f"question {i}"})
        chat["messages"].append({"role": "assistant", "content": f"answer {i}"})
    save_chat(project, chat)

    body = _recap(project, chat["chat_id"]).json()
    stored = load_chat(project, chat["chat_id"])["messages"]
    visible = [m for m in stored if not m.get("hidden")]

    # Both cuts leave exactly the same six messages to send verbatim.
    assert len(visible[body["recap_visible_through"]:]) == 6
    assert len([m for m in stored[body["recap_through"]:]
                if not m.get("hidden")]) == 6
    # And they are genuinely different numbers, or this test proves nothing.
    assert body["recap_through"] != body["recap_visible_through"]
