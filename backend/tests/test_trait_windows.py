# tests/test_trait_windows.py -- a trait that is only true for part of the book
# ==============================================================================
# The reported case, and it is the one worth keeping in front of you while
# reading any of this:
#
#   "Serena in Chapter 1 of Becoming a Hero is a scrawny, average looking young
#    woman ... But after her transformation, she's physically taller, built like
#    a fitness supermodel and different features and proportions. Those physical
#    description traits are not true in Chapter 1 but are true in the rest of the
#    chapters."
#
# Two honest descriptions of one person, neither true of the book. Before this,
# a profile could hold one of them or hold both with nothing to tell them apart
# -- and a model given both does not write a character who changed. It writes a
# scrawny woman with an athlete's shoulders, in the same paragraph, and there is
# nothing in the output that looks like an error.
#
# THE FAILURE THIS FILE IS REALLY GUARDING is the default. `true_in` absent
# means always true, and that has to hold for every trait ever written, because
# the alternative -- a project that silently loses traits after an upgrade --
# is exactly the class of bug the recovery this feature sits inside was for.

import json
import os

import pytest

from app.codex.anchors import AnchorIndex
from app.codex.context import Budget, assemble, render_thread_brief
from app.codex.normalize import TRAIT_WINDOW_MARK, normalize_trait_window
from app.codex.resolve import resolve_thread, window_label
from app.codex.threads import parse_thread, render_thread

CH1, CH2, CH3 = "c-aaa", "c-bbb", "c-ccc"
INDEX = AnchorIndex([CH1, CH2, CH3], {CH1: ["s-a1", "s-a2"]})


def _thread(*blocks) -> dict:
    return {
        "entity_id": "e-serena", "type": "character", "name": "Serena",
        "run": [],
        "sections": {"physical": {
            "heading": "Physical", "content": "", "ai_summary": "",
            "trait_blocks": list(blocks),
        }},
    }


def _trait(name, **extra) -> dict:
    block = {"trait": name, "description": f"{name}.", "importance": "present"}
    block.update(extra)
    return block


def _traits_of(resolved) -> list[str]:
    return [b["trait"]
            for b in resolved["sections"]["physical"]["trait_blocks"]]


# ── The default: nothing changes for anyone who never uses this ──────────────

def test_A_TRAIT_WITH_NO_WINDOW_IS_TRUE_EVERYWHERE():
    """
    Silence means "always", not "nowhere".

    Every trait in every existing project is in this state. If this test ever
    fails, an upgrade has quietly emptied every character in the app.
    """
    thread = _thread(_trait("stubborn"))
    for at in (CH1, CH2, CH3, None):
        resolved = resolve_thread(thread, INDEX, at)
        assert _traits_of(resolved) == ["stubborn"], f"lost at {at}"
        assert resolved["withheld_traits"] == 0


def test_a_trait_with_no_window_gains_nothing_in_the_file():
    # A resave of an ordinary profile must produce no diff. The moment this
    # writes `true_in: []` onto untouched traits, every one of them reads as
    # true nowhere on the next load.
    text = render_thread(_thread(_trait("stubborn")))
    assert "true_in" not in text


# ── The three states, and why the third one has to survive ──────────────────

def test_the_window_round_trips_through_markdown():
    thread = _thread(_trait("scrawny", true_in=[CH1]))
    back = parse_thread(render_thread(thread))
    block = back["sections"]["physical"]["trait_blocks"][0]
    assert block["true_in"] == [CH1]


def test_AN_EMPTY_WINDOW_IS_NOT_THE_SAME_AS_NO_WINDOW():
    """
    The one a `.get("true_in") or []` would destroy.

    A writer who switches "true all the way through" off and has not yet said
    where has said something: not always. Reading that back as "always" would
    switch the trait on again -- and it would do it on the save AFTER the one
    they were watching, which is the worst possible moment for it.
    """
    thread = _thread(_trait("shelved", true_in=[]))
    text = render_thread(thread)
    assert "true_in: []" in text

    back = parse_thread(text)
    block = back["sections"]["physical"]["trait_blocks"][0]
    assert block["true_in"] == []
    assert "true_in" in block


def test_an_unreadable_window_reads_as_always_rather_than_never():
    # A hand-edited `true_in: yes` is somebody trying to say "always". Guessing
    # in the restrictive direction would hide a trait they never meant to hide,
    # and they would have no way to tell it had happened.
    assert normalize_trait_window("yes") is None
    assert normalize_trait_window(None) is None
    assert normalize_trait_window(["c-a", "", None, " c-b "]) == ["c-a", "c-b"]


# ── Resolving at a point in the story ────────────────────────────────────────

def test_the_two_serenas_do_not_meet():
    """The whole feature, in one assertion per chapter."""
    thread = _thread(
        _trait("slight", true_in=[CH1]),
        _trait("powerfully built", true_in=[CH2, CH3]),
    )
    assert _traits_of(resolve_thread(thread, INDEX, CH1)) == ["slight"]
    assert _traits_of(resolve_thread(thread, INDEX, CH2)) == ["powerfully built"]
    assert _traits_of(resolve_thread(thread, INDEX, CH3)) == ["powerfully built"]


def test_what_was_dropped_is_counted():
    # Never silent. A character who arrives thinner than their profile must say
    # why, or the writer reasonably concludes the brief is broken -- which is
    # the rule this app applies to spoilers, scope and placement already.
    thread = _thread(_trait("slight", true_in=[CH1]),
                     _trait("powerfully built", true_in=[CH2]))
    assert resolve_thread(thread, INDEX, CH1)["withheld_traits"] == 1


def test_a_scene_anchor_answers_for_its_chapter():
    # Windows are stored as anchors so scenes can extend this later, and
    # compared by CHAPTER so a writer asking about a scene is not excluded from
    # everything they said at chapter level.
    thread = _thread(_trait("slight", true_in=[CH1]))
    assert _traits_of(resolve_thread(thread, INDEX, f"{CH1}/s-a2")) == ["slight"]


def test_an_empty_window_is_dropped_everywhere_including_the_whole_book():
    # "True nowhere" has the same answer at every anchor, and spending tokens
    # to tell a model about a trait and then to disregard it is worse than
    # silence.
    thread = _thread(_trait("shelved", true_in=[]))
    for at in (CH1, CH3, None):
        resolved = resolve_thread(thread, INDEX, at)
        assert _traits_of(resolved) == []
        assert resolved["withheld_traits"] == 1


def test_THE_CALLERS_OWN_THREAD_IS_NOT_EDITED():
    # Resolving is a question, not a change. This is a shallow copy away from
    # deleting the writer's traits out of the object the caller is holding --
    # and the caller here is a route that may go on to save it.
    thread = _thread(_trait("slight", true_in=[CH1]))
    resolve_thread(thread, INDEX, CH3)
    assert len(thread["sections"]["physical"]["trait_blocks"]) == 1


def test_prose_sections_are_never_touched():
    thread = _thread()
    thread["sections"]["overview"] = {"heading": "Overview",
                                      "content": "A tall woman.",
                                      "ai_summary": "", "trait_blocks": []}
    resolved = resolve_thread(thread, INDEX, CH1)
    assert resolved["sections"]["overview"]["content"] == "A tall woman."


# ── With no point in the story, it labels rather than filters ────────────────

def test_with_no_anchor_a_windowed_trait_is_labelled_not_dropped():
    thread = _thread(_trait("slight", true_in=[CH1]))
    resolved = resolve_thread(thread, INDEX, None)
    block = resolved["sections"]["physical"]["trait_blocks"][0]
    assert block["window_label"] == "only in chapter 1"
    assert resolved["withheld_traits"] == 0


@pytest.mark.parametrize("window,expected", [
    ([CH1], "only in chapter 1"),
    ([CH2, CH3], "only in chapters 2-3"),
    ([CH1, CH3], "only in chapters 1, 3"),
    ([CH3, CH1, CH2], "only in chapters 1-3"),
    (["c-deleted"], "only in some chapters"),
])
def test_window_label_reads_like_a_writer_would_say_it(window, expected):
    # Chapter NUMBERS, and consecutive ones collapsed: "chapters 2-9" is one
    # fact and "chapters 2, 3, 4, 5, 6, 7, 8, 9" is eight things to read, at
    # eight times the tokens.
    assert window_label(window, INDEX) == expected


def test_a_deleted_chapter_does_not_take_the_limit_with_it():
    # The commonest way a window goes stale. We can no longer say WHERE, but
    # "not always true" is still true and is the half that matters.
    assert TRAIT_WINDOW_MARK.lower() in window_label(["c-gone"], INDEX)


# ── What the model actually receives ────────────────────────────────────────

def test_the_brief_marks_a_limited_trait_when_it_cannot_filter():
    resolved = resolve_thread(_thread(_trait("slight", true_in=[CH1])),
                              INDEX, None)
    text = render_thread_brief(resolved)
    assert TRAIT_WINDOW_MARK in text
    assert "CHAPTER 1" in text.upper()


def test_the_brief_does_not_mark_a_trait_that_holds_here():
    # At an anchor everything shown is true here, so a marker would be noise
    # the model has to reason past.
    resolved = resolve_thread(_thread(_trait("slight", true_in=[CH1])),
                              INDEX, CH1)
    assert TRAIT_WINDOW_MARK not in render_thread_brief(resolved)


def test_the_brief_reports_the_traits_it_left_out():
    brief = assemble(
        [_thread(_trait("slight", true_in=[CH1]),
                 _trait("powerfully built", true_in=[CH2]))],
        INDEX, at=CH2, budget=Budget(model_context_limit=40000),
    )
    assert brief.withheld_traits == 1
    assert brief.as_dict()["withheld_traits"] == 1


def test_THE_COUNTS_REACH_THE_WIRE():
    """
    `withheld_not_present` was computed, tested, and read by the screen -- and
    never serialised, so WeaveContextBar's "N you placed in other chapters"
    line sat inside a branch that could not be true. Nothing failed. The
    interface simply never said it.

    That is this programme's signature bug (see R8.1, R8.2, R8.7), and the
    cheapest guard against the next one is asserting the SHAPE of what goes
    out rather than the value of what was computed.
    """
    payload = assemble([], INDEX, at=CH1, budget=Budget(model_context_limit=40000)).as_dict()
    for key in ("withheld_spoilers", "withheld_by_scope",
                "withheld_not_present", "withheld_traits"):
        assert key in payload, f"{key} is computed but never sent"


# ── One marker, two languages ───────────────────────────────────────────────

def test_the_chip_path_uses_the_same_marker():
    """
    The frontend's serialiser and this one write the same token.

    Same contract as the SUBTEXT marker beside it, and for the same reason:
    R2.12g found a secret arriving protected through the chip picker and naked
    through the automatic brief, because two serialisers of one idea had
    drifted. A chip carries no anchor, so it cannot filter -- it can only mark,
    and a mark the prompt does not recognise is not a mark.
    """
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(root, "app", "src", "utils", "profileFormat.ts"),
              encoding="utf-8") as handle:
        source = handle.read()
    assert f'TRAIT_WINDOW_MARK = "{TRAIT_WINDOW_MARK}"' in source, \
        "the chip path's window marker no longer matches the backend's"

    with open(os.path.join(root, "backend", "app", "ai", "prompts.py"),
              encoding="utf-8") as handle:
        prompts = handle.read()
    assert TRAIT_WINDOW_MARK in prompts, \
        "nothing tells the model what the marker means"


# ── The other Markdown dialect ──────────────────────────────────────────────

def test_the_profile_writer_round_trips_a_window():
    # `profiles/` is still a live home for unconverted projects (R1.5b), so a
    # window written there has to survive too -- otherwise the feature works
    # or does not depending on whether the writer ever ran the conversion.
    from app.routers.profiles import (
        TraitBlock, _parse_trait_blocks, _yaml_scalar,
    )

    block = TraitBlock(id="x", trait="slight", description="Small.",
                       importance="present", true_in=[CH1])
    lines = [f"- trait: {_yaml_scalar(block.trait)}",
             f"  description: {json.dumps(block.description)}",
             f"  importance: {block.importance}",
             "  true_in:", f"    - {CH1}"]
    parsed = _parse_trait_blocks("\n".join(lines))
    assert parsed[0].true_in == [CH1]

    plain = _parse_trait_blocks("- trait: x\n  description: y\n  importance: core")
    assert plain[0].true_in is None
