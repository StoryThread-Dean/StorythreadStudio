# tests/test_editor_chat_materials_flow.py -- Chat-consistency guardrails
# =========================================================================
# Locks in the fixes for "the AI forgot my character's voice after turn one":
#
#   1. The materials message (chips + chapter text) is echoed back as
#      materials_content so the frontend can persist it into history -- and
#      is inserted just BEFORE the newest user message on the wire, keeping
#      earlier turns byte-stable for prompt caching.
#   2. The ATTACHMENT STANCE instruction stays in the system prompt for the
#      whole life of an attachment (has_attached_context), not only on the
#      turn chips are newly sent.
#   3. The temperature split: open chat 0.7, draft/enhance 0.6 (draft_prose),
#      structured categories 0.3.
#
# Endpoint tested hermetically: run_chat is monkeypatched and captures its
# kwargs (same pattern as test_enhance_mode.py).

from app.ai.prompts import TEMPERATURE_DEFAULTS
from app.routers import ai


def _patch_auth(monkeypatch):
    """Make auth/validation permissive so we reach the endpoint body hermetically."""
    monkeypatch.setattr(ai, "_resolve_model_and_key",
                        lambda role, mid=None: (ai.OPENROUTER, "fake-key", mid or "test/model"))
    monkeypatch.setattr(ai, "_validate_model_content_mode", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_validate_model_allowed", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_build_story_context", lambda *a, **k: "")


def _capture_run_chat(monkeypatch):
    """Replace run_chat with a fake that records its kwargs."""
    captured = {}

    async def fake_run_chat(**kwargs):
        captured.update(kwargs)
        return "ok reply"

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)
    return captured


_CHIP = {"type": "character", "name": "Alexandra", "content": "Voice: animated, awkward, clumsy."}


# ── Stance persistence ───────────────────────────────────────────────────────

def test_stance_present_with_has_attached_context_and_no_new_chips(client, monkeypatch):
    # Turn 2+ shape: chips already established (context_chips empty), but the
    # writer still has them attached -- the stance must stay in the prompt.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "u1"},
                     {"role": "assistant", "content": "a1"},
                     {"role": "user", "content": "is she in character here?"}],
        "context_chips": [],
        "has_attached_context": True,
    })
    assert resp.status_code == 200, resp.text
    assert "ATTACHMENT STANCE" in captured["system_prompt"]


def test_stance_absent_when_nothing_attached(client, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "hello"}],
        "context_chips": [],
    })
    assert resp.status_code == 200, resp.text
    assert "ATTACHMENT STANCE" not in captured["system_prompt"]


# ── Materials placement + echo ───────────────────────────────────────────────

def test_materials_inserted_before_newest_user_message(client, monkeypatch):
    # Chips attached mid-conversation must land chronologically -- right
    # before the message that carried them -- so the earlier history prefix
    # stays byte-identical (prompt caching keeps matching it).
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "u1"},
                     {"role": "assistant", "content": "a1"},
                     {"role": "user", "content": "u2 with new chip"}],
        "context_chips": [_CHIP],
        "has_attached_context": True,
    })
    assert resp.status_code == 200, resp.text
    sent = captured["messages"]
    # Prefix unchanged, materials third, the triggering user message last.
    assert [m["content"] for m in sent[:2]] == ["u1", "a1"]
    assert "Alexandra" in sent[2]["content"]
    assert sent[3]["content"] == "u2 with new chip"


def test_materials_content_echoed_for_chat_and_draft(client, monkeypatch):
    _patch_auth(monkeypatch)
    for category in ("chat", "draft"):
        _capture_run_chat(monkeypatch)
        resp = client.post("/api/ai/editor-chat", json={
            "category": category,
            "text_content": "",
            "messages": [{"role": "user", "content": "go"}],
            "context_chips": [_CHIP],
            "has_attached_context": True,
        })
        assert resp.status_code == 200, resp.text
        echo = resp.json()["materials_content"]
        # The frontend persists exactly this into history as a hidden message.
        assert echo and "Alexandra" in echo


def test_materials_content_none_without_new_materials(client, monkeypatch):
    _patch_auth(monkeypatch)
    _capture_run_chat(monkeypatch)
    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "follow-up turn"}],
        "context_chips": [],
        "has_attached_context": True,
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["materials_content"] is None


def test_materials_content_none_for_enhance(client, monkeypatch):
    # Enhance resends its passage fresh every turn -- persisting each copy
    # would bloat the history, so enhance stays transient by design.
    _patch_auth(monkeypatch)
    _capture_run_chat(monkeypatch)
    resp = client.post("/api/ai/editor-chat", json={
        "category": "enhance",
        "text_content": "She paused.",
        "messages": [{"role": "user", "content": "make it vivid"}],
        "surrounding_context": "The corridor was dark.",
        "enhance_level": "restate",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["materials_content"] is None


# ── Temperature split ────────────────────────────────────────────────────────

def test_temperature_split_per_category(client, monkeypatch):
    _patch_auth(monkeypatch)
    expected = {
        "chat":    TEMPERATURE_DEFAULTS["generation"],   # 0.7
        "draft":   TEMPERATURE_DEFAULTS["draft_prose"],  # 0.6
        "enhance": TEMPERATURE_DEFAULTS["draft_prose"],  # 0.6
    }
    for category, temp in expected.items():
        captured = _capture_run_chat(monkeypatch)
        body = {
            "category": category,
            "text_content": "Some prose.",
            "messages": [{"role": "user", "content": "go"}],
        }
        if category == "enhance":
            body["enhance_level"] = "restate"
        resp = client.post("/api/ai/editor-chat", json=body)
        assert resp.status_code == 200, resp.text
        assert captured["temperature"] == temp, category

    # draft_prose must actually sit below generation, or the split is a no-op.
    assert TEMPERATURE_DEFAULTS["draft_prose"] < TEMPERATURE_DEFAULTS["generation"]


# ── The Weave brief on the wire ─────────────────────────────────────────────
#
# The locked context rule says AI may automatically receive story context, and
# that nothing is transmitted until the writer initiates an AI action. This is
# that moment: the brief was assembled locally by /api/codex/context (which
# sends nothing anywhere) and inspected in the companion; it rides here
# because the writer pressed send.

_BRIEF = "Alexandra Langford (Character)\nis hiding her theft from Dean."


def test_the_brief_reaches_the_model_when_the_writer_sends(client, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "what is she risking here?"}],
        "weave_brief": _BRIEF,
    })
    assert resp.status_code == 200, resp.text
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "is hiding her theft from Dean" in sent


def test_it_is_framed_as_of_this_point_in_the_story(client, monkeypatch):
    # A brief assembled at chapter four does not know chapter nineteen -- that
    # is the whole reason the Weave is time-aware. A model told "this is the
    # world" would reason happily about things the story has not revealed.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "?"}],
        "weave_brief": _BRIEF,
    })
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "as of this point in the story" in sent
    assert "do not assume anything beyond it has happened yet" in sent


def test_the_writers_own_attachments_come_first(client, monkeypatch):
    # Order is priority: a chip is something they chose for THIS turn; the
    # Weave is standing context about the world.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "?"}],
        "context_chips": [_CHIP],
        "weave_brief": _BRIEF,
    })
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert sent.index("ATTACHED CONTEXT") < sent.index("FROM YOUR WORLD")


def test_a_brief_alone_is_enough_to_build_materials(client, monkeypatch):
    # Turn 2+ with nothing new but the world: no selection, no fresh chips.
    # Without the brief counting as materials, it would be silently dropped.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "?"}],
        "context_chips": [],
        "weave_brief": _BRIEF,
    })
    assert "FROM YOUR WORLD" in "\n".join(
        m["content"] for m in captured["messages"])
    # And it is echoed, so it stays in front of the model on later turns
    # rather than vanishing after one -- the same fix chips needed.
    assert "FROM YOUR WORLD" in resp.json()["materials_content"]


def test_nothing_is_added_when_the_writer_switched_it_off(client, monkeypatch):
    # Off means off: an empty brief must not leave a header behind claiming
    # the world said something.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "some selected prose",
        "messages": [{"role": "user", "content": "?"}],
        "weave_brief": "",
    })
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "FROM YOUR WORLD" not in sent
    assert "WORLD CONTEXT" not in sent


def test_an_oversized_brief_is_refused_with_the_control_that_fixes_it(client,
                                                                     monkeypatch):
    _patch_auth(monkeypatch)
    _capture_run_chat(monkeypatch)

    resp = client.post("/api/ai/editor-chat", json={
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "?"}],
        "weave_brief": "x" * 60_001,
    })
    assert resp.status_code == 400
    assert "Remove some Threads" in resp.json()["detail"]
