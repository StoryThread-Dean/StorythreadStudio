# tests/test_weave_brief_reach.py -- which AI actions get the world
# ===================================================================
# Reported as a question, which is the part worth remembering:
#
#   "That same On/Off N Threads from your world, about N tokens. If its On and
#    I use any of the SMART ADVISOR buttons and features including Context,
#    does the N threads get sent as well?"
#
# It did not. And the reason nobody noticed is the interesting bit: attached
# PROFILES did reach Smart Advisor, through the same request, from the same
# panel -- so the chips arrived and the world did not, while the control above
# them described itself as "the part of your world the AI is told about, before
# you ask it anything". A writer had no way to find that out except by asking.
#
# The rule now: the chat panel in every mode, plus Smart Advisor's CONTEXT pass
# -- the one that checks the writing against the story rather than against the
# language. Readability and Structure do not read the world, so they are not
# charged for it.
#
# These tests assert the ROUTING, not the prose. A brief that reaches the wrong
# pass costs money silently; one that reaches no pass loses the feature
# silently. Neither raises anything on its own.

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.ai import WEAVE_BRIEF_PASS

client = TestClient(app)

BRIEF = "Serena is slight and unremarkable. She has not met Newton yet."


@pytest.fixture
def sent():
    """The messages actually handed to the model, per request."""
    captured: list[dict] = []

    async def fake_run_chat(**kwargs):
        captured.append(kwargs)
        # THE REAL SHAPE, INCLUDING THE ONE THAT DIFFERS. run_chat returns a
        # (reply, reasoning) tuple when asked for a reasoning trace and a bare
        # string otherwise. A mock that always returned a string would pass
        # here and prove nothing about the Reasoning path -- which is the same
        # mistake that let the audiobook speaker pass ship broken for two
        # releases, its test mocking a response shape the API never sends.
        if kwargs.get("include_reasoning"):
            return '{"issues": []}', "thinking"
        return '{"issues": []}'

    with patch("app.routers.ai.run_chat", new=AsyncMock(side_effect=fake_run_chat)), \
         patch("app.routers.ai._resolve_model_and_key",
               return_value=("openrouter", "key", "some/model")), \
         patch("app.routers.ai._validate_model_content_mode"), \
         patch("app.routers.ai._validate_model_allowed"), \
         patch("app.routers.ai._prompt_cache_enabled", return_value=False):
        yield captured


def _pass(category: str, captured, **extra) -> str:
    body = {
        "category": category,
        "subcategories": [],
        "chapter_text": "She walked into the alley.",
        "weave_brief": BRIEF,
    }
    body.update(extra)
    response = client.post("/api/ai/editor-pass", json=body)
    assert response.status_code == 200, response.text
    return "\n".join(str(m.get("content", ""))
                     for m in captured[-1]["messages"])


def test_THE_CONTEXT_PASS_GETS_THE_WORLD(sent):
    """
    The pass this whole change exists for.

    Context checks continuity, established facts and whether a character is
    behaving like themselves -- and it was doing that with no knowledge of the
    world the writer built for exactly that purpose.
    """
    assert BRIEF in _pass(WEAVE_BRIEF_PASS, sent)


@pytest.mark.parametrize("category", ["readability", "structure"])
def test_the_other_passes_are_not_charged_for_a_world_they_do_not_read(
        category, sent):
    # Refused at the ROUTE, not merely unsent by the screen. An older frontend,
    # or a future one that forgets, would otherwise spend a brief's worth of
    # tokens per run on a grammar check.
    assert BRIEF not in _pass(category, sent)


def test_an_oversized_brief_is_refused_with_a_way_out(sent):
    response = client.post("/api/ai/editor-pass", json={
        "category": WEAVE_BRIEF_PASS, "subcategories": [],
        "chapter_text": "Short.", "weave_brief": "x" * 60_001,
    })
    assert response.status_code == 400
    # Refusals in this app say what to DO, not just what went wrong.
    assert "Inspect" in response.json()["detail"]


def test_ATTACHED_PROFILES_STILL_REACH_EVERY_PASS(sent):
    """
    The thing that made the gap invisible, pinned so it stays true.

    Smart Advisor > Context > Attach Profiles uses the AI panel's own picker,
    so a chip attached there is the same chip. It goes to all three passes and
    always did -- which is precisely why assuming the Threads went too was the
    reasonable reading rather than a mistake.
    """
    for category in ("readability", "structure", "context"):
        text = _pass(category, sent, context_chips=[{
            "id": "c1", "type": "character", "name": "Serena",
            "content": "Serena: stubborn.",
        }])
        assert "Serena: stubborn." in text, f"{category} lost the chip"


def test_the_chat_panel_gets_the_world_in_every_mode(sent):
    """
    Draft, Enhance and Reasoning are flags on ONE request, so there is no
    fourth path to forget. Asserted rather than assumed, because "it is the
    same endpoint" is exactly the sort of thing that stops being true quietly.
    """
    # Draft, Enhance and ordinary chat are `category` values on one request;
    # Reasoning is a flag on the same one.
    modes = [
        {"category": "chat"},
        {"category": "draft"},
        {"category": "enhance"},
        {"category": "chat", "include_reasoning": True},
    ]
    for extra in modes:
        body = {
            "text_content": "She walked into the alley.",
            "messages": [{"role": "user", "content": "What is she like?"}],
            "weave_brief": BRIEF,
        }
        body.update(extra)
        response = client.post("/api/ai/editor-chat", json=body)
        assert response.status_code == 200, response.text
        text = "\n".join(str(m.get("content", ""))
                         for m in sent[-1]["messages"])
        assert BRIEF in text, f"lost with {extra}"


def test_BOTH_SIDES_NAME_THE_SAME_PASS():
    """
    The screen decides what to send and the route decides what to use. If they
    ever name different passes, the writer gets a world in a pass they were
    told does not read one, or loses it in the one that does -- and neither
    shows up as an error.
    """
    import os

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(root, "app", "src", "components", "editor",
                           "EditorAdvisorBar.tsx"), encoding="utf-8") as handle:
        source = handle.read()
    assert f'const WEAVE_BRIEF_PASS = "{WEAVE_BRIEF_PASS}"' in source
    assert "weave_brief:      category === WEAVE_BRIEF_PASS" in source, \
        "the advisor bar no longer scopes the brief to that pass"
