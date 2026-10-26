"""
tests/test_chat_budget.py -- the budget on the path that carries real prose.

`_build_materials_message` concatenated. Whatever it was handed went to the
provider, and the only protection was six flat character caps that answer 400.
This is the roadmap item finally reaching the builder it was written about.

THE TWO RULES THAT MATTER MOST, and both are about not lying to the writer:

  1. IT ENGAGES ONLY WHEN THE WINDOW IS KNOWN. An unknown window -- which is
     every local model -- leaves the old behaviour untouched. Acting on a
     number we do not have would be guessing with somebody's manuscript.
  2. NOTHING IS QUIETLY DIFFERENT. A swap or a drop comes back in
     `materials_note`, and a request that fits says nothing at all.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.ai.context_window import forget_cached_windows
from app.main import app
from app.routers import ai

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    forget_cached_windows()
    yield
    forget_cached_windows()


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "summaries" / "chapters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    return str(root)


def _model(monkeypatch, window, model_id="test/model"):
    monkeypatch.setattr(ai, "_resolve_model_and_key",
                        lambda role, mid=None: (ai.OPENROUTER, "k", model_id))
    monkeypatch.setattr(ai, "_validate_model_content_mode", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_validate_model_allowed", lambda *a, **k: None)
    monkeypatch.setattr(ai, "_build_story_context", lambda *a, **k: "")

    async def fake_list_models(api_key, provider):
        entry = {"id": model_id}
        if window is not None:
            entry["context_length"] = window
        return [entry]

    import app.ai.openrouter as openrouter
    monkeypatch.setattr(openrouter, "list_models", fake_list_models)


def _capture(monkeypatch):
    captured = {}

    async def fake_run_chat(**kwargs):
        captured.update(kwargs)
        return "ok"

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)
    return captured


def _sent(captured) -> str:
    return "\n".join([captured.get("system_prompt", "")]
                     + [m.get("content", "") for m in captured.get("messages", [])])


def _chat(project, **over):
    body = {
        "category": "chat",
        "text_content": "",
        "messages": [{"role": "user", "content": "what do you think?"}],
        "project_path": project,
    }
    body.update(over)
    return client.post("/api/ai/editor-chat", json=body)


# Big enough to blow a small window, small enough to stay UNDER the flat
# 60,000-char backstop -- otherwise the cap 400s first and the budget never
# gets a turn, which is what the first version of this file actually tested.
BIG_BRIEF = "The Guild of Ashfall. " * 2_000          # ~44k chars, ~11k tokens


# ── The ordinary case says nothing ───────────────────────────────────────────

def test_a_request_that_fits_is_untouched_and_silent(project, monkeypatch):
    _model(monkeypatch, 200_000)
    captured = _capture(monkeypatch)

    res = _chat(project, weave_brief="Kipling (Character)")
    assert res.status_code == 200
    assert res.json()["materials_note"] == ""
    assert "Kipling" in _sent(captured)


def test_an_unknown_window_changes_nothing(project, monkeypatch):
    """
    THE LOCAL-MODEL CASE, and the reason this is safe to ship. Ollama publishes
    no window, so every local model lands here -- and the budget declines to
    act rather than guessing. The flat caps are still underneath.
    """
    _model(monkeypatch, None)
    captured = _capture(monkeypatch)

    res = _chat(project, weave_brief=BIG_BRIEF)
    assert res.status_code == 200
    assert res.json()["materials_note"] == ""
    # Sent in full, exactly as it would have been before any of this existed.
    assert "Ashfall" in _sent(captured)


# ── Dropping, in order, out loud ─────────────────────────────────────────────

def test_the_world_goes_before_the_writers_passage(project, monkeypatch):
    # The brief is already inspectable and prunable on the context bar, so it
    # is the thing the writer has already been given tools for.
    _model(monkeypatch, 10_000)
    captured = _capture(monkeypatch)

    res = _chat(project, category="draft",
                text_content="The column crested the ridge.",
                weave_brief=BIG_BRIEF)
    assert res.status_code == 200
    body = _sent(captured)
    assert "The column crested the ridge" in body
    assert "Ashfall" not in body


def test_it_says_what_it_left_out(project, monkeypatch):
    _model(monkeypatch, 10_000)
    _capture(monkeypatch)

    note = _chat(project, category="draft",
                 text_content="The column crested the ridge.",
                 weave_brief=BIG_BRIEF).json()["materials_note"]
    assert "your world context" in note
    assert "did not all fit" in note


def test_standing_notes_are_never_the_thing_that_goes(project, monkeypatch):
    # Dropping them would silently revoke guidance the writer believes is in
    # force -- and they are small, so there is never a good reason to.
    _model(monkeypatch, 10_000)
    captured = _capture(monkeypatch)

    _chat(project, category="draft",
          text_content="The column crested the ridge.",
          weave_brief=BIG_BRIEF,
          ai_notes="- Vance is the traitor.")
    assert "Vance is the traitor" in _sent(captured)


def test_the_chapters_plan_is_never_the_thing_that_goes(project, monkeypatch):
    _model(monkeypatch, 10_000)
    captured = _capture(monkeypatch)

    _chat(project, category="draft",
          text_content="The column crested the ridge.",
          weave_brief=BIG_BRIEF,
          chapter_outline="1. They are spotted at dusk.")
    assert "They are spotted at dusk" in _sent(captured)


# ── The swap ─────────────────────────────────────────────────────────────────

def test_a_chapter_too_big_to_send_goes_as_its_summary(project, monkeypatch):
    """
    The roadmap's own sentence, finally true: "swaps full chapter prose for
    chapter summaries".
    """
    import os
    with open(os.path.join(project, "summaries", "chapters", "07.md"),
              "w", encoding="utf-8") as f:
        f.write("Kipling counts the column and says so. Vance argues.")

    _model(monkeypatch, 20_000)
    captured = _capture(monkeypatch)

    res = _chat(project, category="draft",
                text_content="The column crested the ridge. " * 2_000,
                is_full_chapter=True, chapter_filename="07.md")
    assert res.status_code == 200

    body = _sent(captured)
    assert "Kipling counts the column" in body
    assert "its summary" in res.json()["materials_note"]


def test_a_chapter_with_no_summary_is_dropped_and_named(project, monkeypatch):
    # NOT generated on the fly. That would turn a chat message into a second
    # AI call the writer did not ask for -- and generate-chapter-summary
    # writes to disk, so it would also leave a file in their project.
    _model(monkeypatch, 20_000)
    _capture(monkeypatch)

    res = _chat(project, category="draft",
                text_content="The column crested the ridge. " * 2_000,
                is_full_chapter=True, chapter_filename="07.md")
    assert res.status_code == 200
    assert "your chapter" in res.json()["materials_note"]


# ── The refusal is a real status code ────────────────────────────────────────

def test_pinned_content_that_cannot_fit_refuses_rather_than_truncating(
        project, monkeypatch):
    """
    A model handed half a chapter has no way to tell, and answers confidently
    about a book that stops mid-sentence. And this is a REAL 400 rather than a
    frontend convention -- the Weave's refusal is enforced by one line in one
    component, and editor-pass has no UI in front of it at all.
    """
    _model(monkeypatch, 2_000)
    _capture(monkeypatch)

    res = _chat(project, category="draft",
                ai_notes="x" * 19_000,             # under its own cap, over the window
                text_content="short")
    assert res.status_code == 400
    assert "Nothing has been sent" in res.json()["detail"]


def test_the_refusal_offers_a_way_out(project, monkeypatch):
    # A limit with no way out is a dead end, which this app treats as a bug.
    _model(monkeypatch, 2_000)
    _capture(monkeypatch)

    res = _chat(project, category="draft",
                ai_notes="x" * 19_000, text_content="short")
    detail = res.json()["detail"]
    assert "smaller selection" in detail or "holds more" in detail


# ── The caps are still there underneath ──────────────────────────────────────

def test_the_flat_caps_still_bite(project, monkeypatch):
    # They are the only thing between an oversize request and the provider --
    # nothing downstream checks size. The budget is an addition, not a
    # replacement.
    _model(monkeypatch, 1_000_000)
    _capture(monkeypatch)

    res = _chat(project, text_content="x" * 120_000, is_full_chapter=True)
    assert res.status_code == 400
    assert "100,000" in res.json()["detail"]
