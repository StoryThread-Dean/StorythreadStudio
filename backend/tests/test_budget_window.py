"""
tests/test_budget_window.py -- the Weave's budget measures a real model.

THE BUG, which shipped in v2.0.0 and survived three releases:

    `weavingApi.ts` defaulted `model_context_limit` to 32000, and NO CALLER
    ANYWHERE passed one.

So every refusal the writer has ever seen, and every "where the room went"
breakdown they have ever read, was computed against a number nobody chose --
regardless of which model was actually assigned. The mechanism was correct and
well tested throughout; it was measuring the wrong thing.

Nothing failed, because a budget cannot tell it is wrong. That is the shape of
almost every bug in this repo's history: a plausible declaration connected to
nothing, with no error available to raise.

The premise behind it was in the comment on the field -- "the caller knows its
own model" -- and it was simply untrue. Roles resolve on the BACKEND, so the
frontend cannot know which model will answer, let alone how big it is.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.ai.context_window import forget_cached_windows
from app.main import app
from app.routers import ai as ai_router
from app.routers import codex as codex_router

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    forget_cached_windows()
    yield
    forget_cached_windows()


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "manuscript").mkdir()
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    return str(root)


def _model(monkeypatch, window: int | None, model_id="test/model", boom=False):
    """Pretend a model is assigned, and say what the catalog knows about it."""
    def fake_resolve(role, mid=None):
        if boom:
            raise RuntimeError("no key")
        return (ai_router.OPENROUTER, "k", model_id)

    monkeypatch.setattr(ai_router, "_resolve_model_and_key", fake_resolve)

    async def fake_list_models(api_key, provider):
        entry = {"id": model_id}
        if window is not None:
            entry["context_length"] = window
        return [entry]

    import app.ai.openrouter as openrouter
    monkeypatch.setattr(openrouter, "list_models", fake_list_models)


def _context(project: str, **over):
    body = {"project_path": project, "text": "Alexandra counted the coins."}
    body.update(over)
    return client.post("/api/codex/context", json=body)


# ── It measures the model that will answer ───────────────────────────────────

def test_the_budget_uses_the_real_window(project, monkeypatch):
    _model(monkeypatch, 200_000)
    body = _context(project).json()
    assert body["budget"]["limit"] == 200_000
    assert body["budget_assumed"] is False


def test_a_different_model_gives_a_different_budget(project, monkeypatch):
    _model(monkeypatch, 8_000, model_id="small/model")
    assert _context(project).json()["budget"]["limit"] == 8_000

    forget_cached_windows()
    _model(monkeypatch, 1_000_000, model_id="huge/model")
    assert _context(project).json()["budget"]["limit"] == 1_000_000


def test_it_names_the_model_it_measured(project, monkeypatch):
    # A budget against an unnamed limit is a number the writer can only
    # believe or ignore.
    _model(monkeypatch, 128_000, model_id="anthropic/claude")
    assert _context(project).json()["budget_model"] == "anthropic/claude"


def test_the_job_decides_which_model_is_asked_about(project, monkeypatch):
    # Open chat and Draft can be assigned very differently sized models.
    seen: list[str] = []

    def fake_resolve(role, mid=None):
        seen.append(role)
        return (ai_router.OPENROUTER, "k", "m")

    monkeypatch.setattr(ai_router, "_resolve_model_and_key", fake_resolve)

    async def fake_list_models(api_key, provider):
        return [{"id": "m", "context_length": 50_000}]

    import app.ai.openrouter as openrouter
    monkeypatch.setattr(openrouter, "list_models", fake_list_models)

    _context(project, category="chat")
    _context(project, category="draft")
    assert seen == ["brainstorm", "prose"]


# ── When it cannot find out, it says so ──────────────────────────────────────

def test_an_unpublished_window_falls_back_and_admits_it(project, monkeypatch):
    """
    THE HONEST VERSION OF THE OLD BEHAVIOUR. The number is the same 32,000 it
    always was -- what changed is that the writer is now told it is a guess.
    Every local model lands here: Ollama's catalog carries no window at all.
    """
    _model(monkeypatch, None)                      # no context_length
    body = _context(project).json()
    assert body["budget"]["limit"] == codex_router._ASSUMED_WINDOW
    assert body["budget_assumed"] is True


def test_an_unreachable_catalog_still_assembles_a_brief(project, monkeypatch):
    # This endpoint transmits nothing and must never refuse to answer because
    # a lookup failed. The writer's world is not hostage to a network call.
    _model(monkeypatch, 128_000, boom=True)
    res = _context(project)
    assert res.status_code == 200
    assert res.json()["budget_assumed"] is True


# ── An explicit limit still wins ─────────────────────────────────────────────

def test_a_caller_that_knows_better_is_believed(project, monkeypatch):
    _model(monkeypatch, 200_000)
    body = _context(project, model_context_limit=20_000).json()
    assert body["budget"]["limit"] == 20_000
    # Not an assumption -- the caller asserted it.
    assert body["budget_assumed"] is False


def test_zero_means_work_it_out_rather_than_no_room(project, monkeypatch):
    """
    The field's default changed from 32,000 to 0, so 0 has to mean "look it
    up". Read literally it would mean a window of nothing, and every brief in
    the app would be refused for lack of room -- loudly, but for a reason
    nobody could act on.
    """
    _model(monkeypatch, 64_000)
    body = _context(project, model_context_limit=0).json()
    assert body["budget"]["limit"] == 64_000
    assert body["refused"] is False
