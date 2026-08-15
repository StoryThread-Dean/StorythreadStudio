# tests/test_audit_importance.py -- the audit that never returned anything
# =========================================================================
# The AI Importance Audit has shipped since Phase 5B. It sends a profile's
# traits to a model, which flags the ones whose weight looks wrong -- a
# "background" trait that reads like it drives the whole book.
#
# IT HAD NEVER ONCE RETURNED A FLAG.
#
# The route read `result["choices"][0]["message"]["content"]`, which is the
# provider's transport shape. `run_completion` does not return that: it parses
# the model's JSON and hands back the parsed object. So the lookup produced an
# empty string from every model on every request, `flags` was always [], and
# the audit reported "nothing to flag" for its entire life.
#
# No error. No log line. No test -- this file is the first one, which is the
# whole reason it survived: the feature is INDISTINGUISHABLE, from outside,
# from a model that looked carefully and found nothing wrong.
#
# Found in v2.0.1 when the Profile Extractor hit the identical bug three times
# in live testing against three different models.

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

TRAITS = [
    {"trait": "Watched his parents die", "description": "In a hospital fire.",
     "importance": "background", "section_heading": "Hidden"},
    {"trait": "Likes tea", "description": "Prefers it strong.",
     "importance": "core", "section_heading": "Personality"},
]

FLAGS = [
    {"trait": "Watched his parents die", "current_importance": "background",
     "suggested_importance": "core",
     "reason": "It shapes every scene he avoids a hospital in."},
]


def _completion(payload: dict | str):
    """
    A double that answers the way `run_completion` really answers.

    Which is the point of this whole file: the double that would have caught
    the bug is one that returns the PARSED object, because that is what the
    real function returns. A double answering with {"choices": ...} tests the
    caller against a world that does not exist -- and that is exactly what the
    audiobook speaker pass's double did, which is how it shipped broken too.
    """
    text = payload if isinstance(payload, str) else json.dumps(payload)
    parsed = payload if isinstance(payload, dict) else {}

    async def _run(**_kwargs):
        return {
            **parsed,
            "raw_text": text,
            "finish_reason": "stop",
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
            "summary": "", "suggestions": [], "notes": [],
            "model_used": "test/model", "had_em_dashes": False,
        }
    return _run


@pytest.fixture
def no_key(monkeypatch):
    """Skip the provider resolution; this file is about the response half."""
    from app.ai.providers import OPENROUTER
    monkeypatch.setattr("app.routers.ai._resolve_model_and_key",
                        lambda *_a, **_k: (OPENROUTER, "key", "test/model"))


def _audit():
    return client.post("/api/ai/audit-importance", json={
        "profile_name": "Villain", "profile_type": "character",
        "trait_blocks": TRAITS,
    })


def test_A_FLAG_THE_MODEL_RETURNS_ACTUALLY_REACHES_THE_WRITER(no_key, monkeypatch):
    """The test that did not exist, and would have caught this on day one."""
    monkeypatch.setattr("app.routers.ai.run_completion",
                        _completion({"flags": FLAGS}))
    response = _audit()
    assert response.status_code == 200
    flags = response.json()["flags"]
    assert len(flags) == 1
    assert flags[0]["trait"] == "Watched his parents die"
    assert flags[0]["suggested_importance"] == "core"


def test_it_still_reads_flags_when_the_model_wraps_them_in_text(no_key, monkeypatch):
    # A model that answers in JSON but not in our shape: run_completion cannot
    # find "flags", falls back to its own schema, and the answer has to be
    # recovered from the raw text. Both doors, because models use both.
    monkeypatch.setattr("app.routers.ai.run_completion",
                        _completion(json.dumps({"flags": FLAGS})))
    response = _audit()
    assert len(response.json()["flags"]) == 1


def test_an_answer_with_nothing_to_flag_is_an_empty_list_not_an_error(no_key, monkeypatch):
    # The honest empty. This is what the writer SHOULD have been seeing only
    # when the model really had no objection.
    monkeypatch.setattr("app.routers.ai.run_completion",
                        _completion({"flags": []}))
    response = _audit()
    assert response.status_code == 200
    assert response.json()["flags"] == []


def test_an_unreadable_answer_degrades_to_no_flags_rather_than_a_crash(no_key, monkeypatch):
    # An audit is advisory. A model that answers badly should cost the writer a
    # suggestion, never the screen.
    monkeypatch.setattr("app.routers.ai.run_completion",
                        _completion("I could not do that."))
    response = _audit()
    assert response.status_code == 200
    assert response.json()["flags"] == []


def test_the_em_dash_rule_reaches_the_flags(no_key, monkeypatch):
    # The app's locked punctuation rule applies to anything a writer reads, and
    # a flag's reason is prose shown on screen.
    monkeypatch.setattr("app.routers.ai.run_completion", _completion({
        "flags": [{"trait": "T", "current_importance": "background",
                   "suggested_importance": "core",
                   "reason": "It matters — a great deal."}],
    }))
    reason = _audit().json()["flags"][0]["reason"]
    assert "—" not in reason
    assert "--" in reason
