# tests/test_codex_resolve.py -- who a Thread IS at a point in the story
# =======================================================================
# The heart of the Weave. A profile today reads as one unchanging person
# from page one to the last page; this is the code that makes a character
# different in chapter fifteen than she was in chapter three, because of
# what happened in between.
#
# The worked example that drove the whole design, and which
# test_the_father_example_end_to_end pins:
#
#   Elara believes, from chapter 3, that her father died in a raid.
#   In truth he has been alive and hiding since chapter 1.
#   The reader does not learn that until chapter 14.
#
#   Drafting chapter 7 she must read as a grieving daughter, and the AI must
#   not be able to spoil the reveal -- because it has not been told.
#   Drafting chapter 15 she knows.
#
# Most of what follows is about what the resolver REFUSES to do. Guessing an
# order, guessing a position, or leaking a secret are all failures nobody
# would notice from the output.

from app.codex.anchors import Anchor, AnchorIndex, format_anchor, parse_anchor
from app.codex.resolve import (
    AI_SCOPE_NEVER,
    AI_SCOPE_ON_REQUEST,
    TRUTH,
    frames_for,
    resolve_facts,
    resolve_thread,
)

# Three chapters, two scenes each -- enough to test ordering within and
# across chapters without the fixtures becoming their own puzzle.
CH1, CH2, CH3 = "c-aaa", "c-bbb", "c-ccc"
INDEX = AnchorIndex(
    [CH1, CH2, CH3],
    {
        CH1: ["s-a1", "s-a2"],
        CH2: ["s-b1", "s-b2"],
        CH3: ["s-c1", "s-c2"],
    },
)

ELARA = "e-elara"


def fact(fid, at, axis, value, **kw):
    return {
        "id": fid, "at": at, "axis": axis, "value": value,
        "frame": kw.get("frame", TRUTH),
        "revealed_at": kw.get("revealed_at", at),
        "ai_scope": kw.get("ai_scope", "always"),
        "supersedes": kw.get("supersedes"),
    }


def values(resolution):
    return sorted(f["value"] for f in resolution.facts)


# ── Anchors ──────────────────────────────────────────────────────────────────

def test_an_anchor_round_trips():
    assert parse_anchor("c-aaa/s-a1") == Anchor("c-aaa", "s-a1")
    assert parse_anchor("c-aaa") == Anchor("c-aaa", None)
    assert format_anchor("c-aaa", "s-a1") == "c-aaa/s-a1"
    assert format_anchor("c-aaa") == "c-aaa"


def test_a_human_comment_after_the_anchor_is_ignored():
    # The Markdown carries "c-aaa/s-a1  # Chapter 1, Scene 1" for readers.
    assert parse_anchor("c-aaa/s-a1  # Chapter 1, Scene 1") == Anchor("c-aaa", "s-a1")


def test_malformed_anchors_degrade_rather_than_raise():
    # Writer-editable text: one bad line must spoil one fact, not the Thread.
    for bad in ["", "   ", "#only a comment", None]:
        assert parse_anchor(bad) is None


def test_anchors_order_within_and_across_chapters():
    assert INDEX.ordinal("c-aaa/s-a1") < INDEX.ordinal("c-aaa/s-a2")
    assert INDEX.ordinal("c-aaa/s-a2") < INDEX.ordinal("c-bbb/s-b1")


def test_a_chapter_anchor_sits_at_the_start_of_its_chapter():
    # "As of chapter 2" reads as "by the time chapter 2 begins".
    assert INDEX.ordinal("c-bbb") < INDEX.ordinal("c-bbb/s-b1")
    assert INDEX.ordinal("c-aaa/s-a2") < INDEX.ordinal("c-bbb")


def test_a_deleted_scene_degrades_to_its_chapter_rather_than_vanishing():
    # The design's stated fallback: unreliable scene matching must weaken the
    # anchor, never break the feature.
    assert INDEX.ordinal("c-bbb/s-GONE") == INDEX.ordinal("c-bbb")


def test_a_deleted_chapter_has_no_position_at_all():
    # None, not a guess. A fact placed in a chapter that no longer exists
    # must not be silently treated as true from the beginning.
    assert INDEX.ordinal("c-DELETED/s-x") is None


# ── Rule 1 and 3: latest fact wins, and stays in force ───────────────────────

def test_a_fact_holds_from_its_anchor_onward():
    run = [fact("f1", "c-aaa/s-a1", "status", "alive")]
    assert values(resolve_facts(run, INDEX, "c-ccc/s-c2")) == ["alive"]


def test_a_fact_is_not_yet_true_before_its_anchor():
    run = [fact("f1", "c-bbb/s-b1", "status", "wounded")]
    assert resolve_facts(run, INDEX, "c-aaa/s-a2").facts == []


def test_the_latest_fact_on_an_axis_supersedes_the_earlier_one():
    run = [
        fact("f1", "c-aaa/s-a1", "status", "alive"),
        fact("f2", "c-bbb/s-b1", "status", "wounded"),
        fact("f3", "c-ccc/s-c1", "status", "dead"),
    ]
    assert values(resolve_facts(run, INDEX, "c-aaa/s-a2")) == ["alive"]
    assert values(resolve_facts(run, INDEX, "c-bbb/s-b2")) == ["wounded"]
    assert values(resolve_facts(run, INDEX, "c-ccc/s-c2")) == ["dead"]


def test_different_axes_do_not_supersede_each_other():
    run = [
        fact("f1", "c-aaa/s-a1", "status", "alive"),
        fact("f2", "c-bbb/s-b1", "location", "the tower"),
    ]
    assert values(resolve_facts(run, INDEX, "c-ccc/s-c1")) == ["alive", "the tower"]


def test_no_anchor_means_the_end_of_the_book():
    run = [
        fact("f1", "c-aaa/s-a1", "status", "alive"),
        fact("f2", "c-ccc/s-c1", "status", "dead"),
    ]
    assert values(resolve_facts(run, INDEX, None)) == ["dead"]


# ── Rule 4: ambiguity is reported, never resolved by guessing ────────────────

def test_two_facts_at_the_same_point_are_ambiguous_not_ordered():
    run = [
        fact("f1", "c-bbb/s-b1", "status", "wounded"),
        fact("f2", "c-bbb/s-b1", "status", "unhurt"),
    ]
    resolution = resolve_facts(run, INDEX, "c-ccc/s-c1")
    # Neither takes effect: a quietly-picked winner would be a fact the book
    # never actually establishes.
    assert resolution.facts == []
    assert len(resolution.ambiguities) == 1
    assert set(resolution.ambiguities[0].fact_ids) == {"f1", "f2"}
    assert "same point" in resolution.ambiguities[0].describe()


def test_an_explicit_supersedes_breaks_the_tie():
    run = [
        fact("f1", "c-bbb/s-b1", "status", "wounded"),
        fact("f2", "c-bbb/s-b1", "status", "unhurt", supersedes="f1"),
    ]
    resolution = resolve_facts(run, INDEX, "c-ccc/s-c1")
    assert values(resolution) == ["unhurt"]
    assert resolution.ambiguities == []


def test_a_supersedes_cycle_is_ambiguous_rather_than_arbitrary():
    run = [
        fact("f1", "c-bbb/s-b1", "status", "a", supersedes="f2"),
        fact("f2", "c-bbb/s-b1", "status", "b", supersedes="f1"),
    ]
    resolution = resolve_facts(run, INDEX, "c-ccc/s-c1")
    assert resolution.facts == []
    assert len(resolution.ambiguities) == 1


def test_ambiguity_at_an_earlier_point_does_not_block_a_later_fact():
    run = [
        fact("f1", "c-aaa/s-a1", "status", "a"),
        fact("f2", "c-aaa/s-a1", "status", "b"),
        fact("f3", "c-ccc/s-c1", "status", "settled"),
    ]
    resolution = resolve_facts(run, INDEX, "c-ccc/s-c2")
    assert values(resolution) == ["settled"]
    assert resolution.ambiguities == []


# ── Frames: whose truth is this ──────────────────────────────────────────────

def test_a_belief_is_not_returned_unless_that_viewpoint_is_asked_for():
    run = [fact("f1", "c-aaa/s-a1", "belief.father", "died in the raid", frame=ELARA)]
    assert resolve_facts(run, INDEX, "c-ccc", frames=frames_for()).facts == []
    assert values(resolve_facts(run, INDEX, "c-ccc", frames=frames_for(ELARA))) \
        == ["died in the raid"]


def test_truth_and_a_belief_can_disagree_at_the_same_moment():
    # The premise of the whole frame system: what is so, and what she thinks.
    run = [
        fact("f1", "c-aaa/s-a1", "fact.father", "alive, in hiding"),
        fact("f2", "c-aaa/s-a1", "belief.father", "died in the raid", frame=ELARA),
    ]
    resolution = resolve_facts(run, INDEX, "c-ccc", frames=frames_for(ELARA))
    assert values(resolution) == ["alive, in hiding", "died in the raid"]
    assert resolution.ambiguities == []      # different frames never collide


def test_a_fact_with_no_frame_written_is_objective_truth():
    # REGRESSION. A fact read from a file or posted by the API carries
    # frame=None explicitly when none was given, and .get("frame", TRUTH)
    # returns None for that -- which matched no frame and silently dropped
    # the fact. Every fact added through the API vanished on resolve.
    run = [{"id": "f1", "at": "c-aaa/s-a1", "axis": "status", "value": "alive",
            "frame": None, "revealed_at": None, "ai_scope": None}]
    assert values(resolve_facts(run, INDEX, "c-ccc")) == ["alive"]


def test_a_fact_with_no_ai_scope_written_is_visible():
    # Same shape of bug on the other switch: an absent ai_scope must read as
    # "always", not as an unrecognised value to be withheld.
    run = [{"id": "f1", "at": "c-aaa/s-a1", "axis": "status", "value": "alive",
            "frame": "truth", "revealed_at": None, "ai_scope": None}]
    resolution = resolve_facts(run, INDEX, "c-ccc")
    assert values(resolution) == ["alive"]
    assert resolution.withheld_by_scope == 0


def test_frames_are_entity_ids_so_a_rename_cannot_break_them():
    # Nothing here matches on a display name -- the point of storing the id.
    run = [fact("f1", "c-aaa/s-a1", "belief.x", "v", frame=ELARA)]
    assert values(resolve_facts(run, INDEX, "c-ccc", frames={TRUTH, ELARA})) == ["v"]
    assert resolve_facts(run, INDEX, "c-ccc", frames={TRUTH, "e-renamed"}).facts == []


# ── Spoilers: what the reader knows yet ──────────────────────────────────────

def test_a_fact_revealed_later_is_withheld_and_counted():
    run = [fact("f1", "c-aaa/s-a1", "fact.father", "alive", revealed_at="c-ccc/s-c1")]
    early = resolve_facts(run, INDEX, "c-bbb/s-b1")
    assert early.facts == []
    # Counted, so a brief can say it is holding something back rather than
    # presenting a partial picture as the whole one.
    assert early.withheld_spoilers == 1

    later = resolve_facts(run, INDEX, "c-ccc/s-c2")
    assert values(later) == ["alive"]


def test_spoiler_hiding_can_be_turned_off_for_the_author():
    run = [fact("f1", "c-aaa/s-a1", "fact.father", "alive", revealed_at="c-ccc/s-c1")]
    assert values(resolve_facts(run, INDEX, "c-bbb", hide_spoilers=False)) == ["alive"]


def test_a_fact_with_no_reveal_point_is_revealed_where_it_happens():
    run = [fact("f1", "c-aaa/s-a1", "status", "alive")]
    run[0]["revealed_at"] = None
    assert values(resolve_facts(run, INDEX, "c-bbb")) == ["alive"]


# ── ai_scope: what AI may see at all ─────────────────────────────────────────

def test_ai_scope_never_is_unreachable_by_any_combination_of_arguments():
    # The strongest guarantee on this screen. If a writer marks something
    # author-only, no argument here may surface it.
    run = [fact("f1", "c-aaa/s-a1", "secret", "the twist", ai_scope=AI_SCOPE_NEVER)]
    for hide in (True, False):
        for on_request in (True, False):
            resolution = resolve_facts(
                run, INDEX, None, frames={TRUTH},
                hide_spoilers=hide, include_on_request=on_request,
            )
            assert resolution.facts == []
            assert resolution.withheld_by_scope == 1


def test_on_request_facts_are_withheld_until_asked_for():
    run = [fact("f1", "c-aaa/s-a1", "secret", "the twist", ai_scope=AI_SCOPE_ON_REQUEST)]
    assert resolve_facts(run, INDEX, None).facts == []
    assert values(resolve_facts(run, INDEX, None, include_on_request=True)) == ["the twist"]


# ── Unplaced facts ───────────────────────────────────────────────────────────

def test_a_fact_in_a_deleted_chapter_is_reported_not_guessed():
    # Assuming it happened at the start would make it true everywhere --
    # exactly the silent wrongness this design exists to avoid.
    run = [fact("f1", "c-GONE/s-x", "status", "who knows")]
    resolution = resolve_facts(run, INDEX, "c-ccc")
    assert resolution.facts == []
    assert len(resolution.unplaced) == 1


# ── The example that drove the design ────────────────────────────────────────

def test_the_father_example_end_to_end():
    run = [
        # Objectively true from chapter 1, but the reader learns it in ch.3
        # of this fixture, and it is author-only until then.
        fact("f-truth", "c-aaa/s-a1", "fact.father", "Garrick is alive, in hiding",
             revealed_at="c-ccc/s-c1", ai_scope=AI_SCOPE_ON_REQUEST),
        # What she believes, from the raid onward.
        fact("f-belief", "c-aaa/s-a2", "belief.father", "Her father died in the raid",
             frame=ELARA),
        # What she learns, and when.
        fact("f-learns", "c-ccc/s-c1", "belief.father", "Her father is alive",
             frame=ELARA, supersedes="f-belief"),
    ]

    # Drafting the middle of the book: a grieving daughter, and the reveal
    # is not merely hidden from the reader -- it is not in the payload at all.
    middle = resolve_thread({"name": "Elara", "run": run}, INDEX, "c-bbb/s-b2", pov=ELARA)
    assert [f["value"] for f in middle["run"]] == ["Her father died in the raid"]
    assert middle["withheld_spoilers"] + middle["withheld_by_scope"] == 1
    assert all("alive" not in f["value"] for f in middle["run"])

    # After the reveal: she knows, and the truth is tellable.
    after = resolve_thread({"name": "Elara", "run": run}, INDEX, "c-ccc/s-c2",
                           pov=ELARA, include_on_request=True)
    assert sorted(f["value"] for f in after["run"]) == [
        "Garrick is alive, in hiding", "Her father is alive",
    ]


def test_resolve_thread_leaves_the_writers_own_prose_alone():
    # Base sections are the writer's description of someone, not
    # time-varying claims -- they pass through untouched.
    thread = {"name": "Elara", "sections": {"overview": "A tall woman."}, "run": []}
    resolved = resolve_thread(thread, INDEX, "c-bbb")
    assert resolved["sections"] == {"overview": "A tall woman."}
    assert resolved["as_of"] == "c-bbb"
