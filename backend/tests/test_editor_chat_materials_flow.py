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


# ── The plan for the chapter being written ───────────────────────────────────
#
# The one material both Draft and Enhance have always ASSUMED was here.
# _DRAFT_RESPONSE_RULES and _ENHANCE_RESPONSE_RULES have told the model for
# releases to treat "the attached profiles, outline, and location notes as
# canon" -- and nothing delivered an outline unless the writer hand-attached
# the BOOK outline as a note chip.
#
# It is its own field rather than a chip (a chip is what the writer chose for
# one turn; this is standing context for the chapter) and rather than part of
# weave_brief (the brief is Thread-shaped end to end -- every piece has an
# entity_id and a relevance score, and a document has neither).

_OUTLINE = ("1. The column is spotted at dusk.\n"
            "2. Vance argues for withdrawal, and is overruled.")


def _send(client, **body):
    base = {"category": "draft", "text_content": "",
            "messages": [{"role": "user", "content": "write the opening"}]}
    return client.post("/api/ai/editor-chat", json={**base, **body})


def test_the_plan_reaches_the_model_when_drafting(client, monkeypatch):
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    assert _send(client, chapter_outline=_OUTLINE).status_code == 200
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "Vance argues for withdrawal" in sent
    assert "BEGIN CHAPTER OUTLINE" in sent


def test_it_is_framed_as_intent_rather_than_as_something_written(client, monkeypatch):
    # It describes what has NOT been written yet. A model told to treat it as
    # established fact would draft as though the chapter were already done, or
    # summarise the plan back instead of writing the scene.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    _send(client, chapter_outline=_OUTLINE)
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "what the writer intends to happen" in sent
    assert "rather than finished prose" in sent


def test_it_sits_between_the_writers_chips_and_the_world(client, monkeypatch):
    # The order is the honest description of what each thing is: a chip is
    # what they chose for this turn, the outline is what this chapter is meant
    # to do, the brief is the world it happens in.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    _send(client, context_chips=[_CHIP], weave_brief=_BRIEF,
          chapter_outline=_OUTLINE)
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert (sent.index("ATTACHED CONTEXT")
            < sent.index("THE PLAN FOR THIS CHAPTER")
            < sent.index("FROM YOUR WORLD"))


def test_a_plan_alone_is_enough_to_build_materials(client, monkeypatch):
    # Turn 2+ with nothing new but the plan: no selection, no fresh chips, no
    # brief. Without the outline counting as materials it would be silently
    # dropped -- the same bug the brief had, which is why that test exists.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    _send(client, messages=[
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": "carry on"},
    ], chapter_outline=_OUTLINE)
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "Vance argues for withdrawal" in sent


def test_enhance_gets_it_too(client, monkeypatch):
    # Enhance rewrites one passage, and knowing where that passage sits in the
    # chapter is exactly what stops it drifting off the plan.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    _send(client, category="enhance", text_content="He waited.",
          chapter_outline=_OUTLINE)
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "BEGIN CHAPTER OUTLINE" in sent


def test_the_reviewing_passes_do_not_get_it(client, monkeypatch):
    # Readability, Structure and Context are reading prose that EXISTS. A plan
    # is not evidence about how what was written reads, so sending it would
    # charge the writer tokens on every pass to tell the model something it
    # has no use for. Same rule as WEAVE_BRIEF_PASS.
    #
    # OPEN CHAT IS NO LONGER IN THIS LIST (v2.0.6) -- see the test below.
    _patch_auth(monkeypatch)

    for category in ("readability", "structure", "context"):
        captured = _capture_run_chat(monkeypatch)
        _send(client, category=category, text_content="Some prose.",
              chapter_outline=_OUTLINE)
        sent = "\n".join(m["content"] for m in captured["messages"])
        assert "CHAPTER OUTLINE" not in sent, category
        assert "Vance argues" not in sent, category


def test_open_chat_does_get_it(client, monkeypatch):
    """
    The Chapter Outline screen has the chat panel beside it now, so a writer
    looking at their plan and asking whether it holds together is the most
    likely question there is to ask. A chat that could not see the document
    on screen would be a chat panel-shaped disappointment.

    Still inspectable: the context bar shows the row, its token cost and an
    off switch remembered per book.
    """
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)
    _send(client, category="chat", text_content="",
          chapter_outline=_OUTLINE)
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "BEGIN CHAPTER OUTLINE" in sent
    assert "Vance argues" in sent


def test_no_plan_means_no_block_at_all(client, monkeypatch):
    # An empty header would tell the model the context failed to load, which
    # is worse than saying nothing.
    _patch_auth(monkeypatch)
    captured = _capture_run_chat(monkeypatch)

    _send(client, text_content="Write something.", chapter_outline="")
    sent = "\n".join(m["content"] for m in captured["messages"])
    assert "CHAPTER OUTLINE" not in sent
    assert "THE PLAN FOR THIS CHAPTER" not in sent


def test_the_two_outlines_are_told_apart_in_the_instructions(client, monkeypatch):
    # Both prompt rule sets said "outline" and meant the book one. With two in
    # play, one word for both is how a model comes to draft the wrong scale --
    # a chapter's worth of plot in one scene, or the book's shape restated.
    from app.ai.prompts import _DRAFT_RESPONSE_RULES, _ENHANCE_RESPONSE_RULES

    assert "THE PLAN FOR THIS CHAPTER" in _DRAFT_RESPONSE_RULES
    assert "shape of the whole story" in _DRAFT_RESPONSE_RULES
    assert "THE PLAN FOR THIS CHAPTER" in _ENHANCE_RESPONSE_RULES
