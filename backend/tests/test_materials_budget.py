"""
tests/test_materials_budget.py -- making a request fit, honestly.

The Weave has refused-rather-than-truncated since v2.0.0. The path that
carries the writer's actual prose has had nothing but flat character caps.
This is that idea for documents, and the tests are the rules:

  1. Pinned content is never dropped, and never trimmed to fit. If it will
     not fit, the request is REFUSED -- half a chapter reads to a model
     exactly like a whole one, and it answers confidently about a book that
     stops mid-sentence.
  2. Everything dropped is NAMED. A brief that quietly omitted half the world
     is worse than no brief, because the writer would trust it.
  3. A request that fits says NOTHING. A note on every turn is a note the
     writer learns to stop reading.
"""

from app.ai.materials_budget import Material, fit_materials
from app.codex.context import Budget


def _budget(limit: int, **over) -> Budget:
    return Budget(model_context_limit=limit, output_reserve=0, **over)


def _mat(key: str, chars: int, **over) -> Material:
    return Material(key=key, label=over.pop("label", key),
                    text="x" * chars, **over)


# ── When it all fits ─────────────────────────────────────────────────────────

def test_everything_fits_and_nothing_is_said(project=None):
    res = fit_materials([_mat("a", 400), _mat("b", 400)], _budget(100_000))
    assert set(res.kept) == {"a", "b"}
    assert res.engaged is False
    assert res.note() == ""


def test_a_fitting_request_is_untouched():
    original = _mat("chapter", 4_000)
    res = fit_materials([original], _budget(100_000))
    assert res.kept["chapter"] == original.text
    assert res.dropped == []
    assert res.swapped == []


# ── Drop order is the caller's ───────────────────────────────────────────────

def test_the_first_in_the_list_is_the_first_to_go():
    # The caller hands them over least-missed-first, because only it knows
    # what the writer is doing.
    res = fit_materials(
        [_mat("grounding", 40_000, label="the text around your passage"),
         _mat("passage", 40_000, label="your passage")],
        _budget(12_000),                       # room for about one of them
    )
    assert "passage" in res.kept
    assert "grounding" not in res.kept
    assert res.dropped == ["the text around your passage"]


def test_what_was_dropped_is_named_in_the_writers_words():
    res = fit_materials(
        [_mat("brief", 80_000, label="your world context"),
         _mat("passage", 400)],
        _budget(1_000),
    )
    assert "your world context" in res.note()
    assert res.engaged is True


def test_several_drops_are_all_reported():
    res = fit_materials(
        [_mat("a", 40_000, label="one"),
         _mat("b", 40_000, label="two"),
         _mat("passage", 400)],
        _budget(1_000),
    )
    assert set(res.dropped) == {"one", "two"}


# ── The swap ─────────────────────────────────────────────────────────────────

def test_a_chapter_too_big_to_send_goes_as_its_summary():
    """
    The roadmap's actual sentence: "swaps full chapter prose for chapter
    summaries before truncating older scene text". Cheaper than dropping the
    chapter entirely, and far better than sending a piece of it.
    """
    res = fit_materials(
        [Material(key="chapter", label="your chapter",
                  text="x" * 200_000,
                  swap_text="A summary of the chapter.",
                  swap_label="its summary")],
        _budget(2_000),
    )
    assert res.kept["chapter"] == "A summary of the chapter."
    assert res.swapped == [("chapter", "its summary")]
    assert "its summary" in res.note()


def test_the_swap_is_only_used_when_the_original_does_not_fit():
    res = fit_materials(
        [Material(key="chapter", label="your chapter", text="short",
                  swap_text="summary", swap_label="its summary")],
        _budget(100_000),
    )
    assert res.kept["chapter"] == "short"
    assert res.swapped == []
    assert res.engaged is False


def test_a_swap_that_still_does_not_fit_is_dropped_and_named():
    res = fit_materials(
        [Material(key="chapter", label="your chapter", text="x" * 200_000,
                  swap_text="y" * 100_000, swap_label="its summary")],
        _budget(1_000),
    )
    assert "chapter" not in res.kept
    assert res.dropped == ["your chapter"]


# ── Pinned content ───────────────────────────────────────────────────────────

def test_pinned_content_is_kept_while_others_are_dropped():
    res = fit_materials(
        [_mat("brief", 40_000, label="your world"),
         _mat("notes", 400, pinned=True)],
        _budget(1_000),
    )
    assert "notes" in res.kept
    assert "brief" not in res.kept


def test_pinned_content_that_will_not_fit_is_refused_not_trimmed():
    """
    THE ONE THAT MATTERS MOST. A model handed half a chapter cannot tell, and
    answers as though it had read the whole thing. Refusing is the only
    honest option, and it is what the Weave already does.
    """
    res = fit_materials([_mat("passage", 200_000, pinned=True)], _budget(2_000))
    assert res.refused is True
    assert res.kept == {}
    assert res.engaged is True


def test_the_refusal_states_both_numbers_and_a_way_out():
    # A limit with no way out is a dead end, which this app treats as a bug.
    res = fit_materials([_mat("passage", 200_000, pinned=True)], _budget(2_000))
    assert "50,000" in res.refusal or "tokens" in res.refusal
    assert "smaller selection" in res.refusal


def test_a_refusal_sends_nothing_at_all():
    # Not "everything except the passage" -- there is no useful request to
    # make without the thing being asked about.
    res = fit_materials(
        [_mat("brief", 400), _mat("passage", 200_000, pinned=True)],
        _budget(2_000),
    )
    assert res.kept == {}


# ── The budget's own arithmetic is respected ─────────────────────────────────

def test_room_already_spent_elsewhere_is_not_available():
    # The reply, the system prompt and the writer's own text are reserved
    # before any of this is asked to fit.
    tight = Budget(model_context_limit=10_000, output_reserve=4_000,
                   system_prompt_tokens=1_000, user_text_tokens=4_000)
    res = fit_materials([_mat("brief", 40_000, label="your world")], tight)
    assert "brief" not in res.kept
    assert res.dropped == ["your world"]


def test_nothing_at_all_is_a_quiet_success():
    res = fit_materials([], _budget(100_000))
    assert res.kept == {}
    assert res.engaged is False
    assert res.refused is False
