# tests/test_codex_snags.py -- the contradictions arithmetic can find
# ====================================================================
# Everything in here is deterministic, free, and the same answer every time.
# That is the whole reason the structural and semantic halves are separated:
# a checker that charges for what arithmetic can answer, or that claims
# certainty about what is genuinely a reading, is untrustworthy in opposite
# directions.
#
# The most important test in this file is the one that DOESN'T fire.
# "Believed her father died" then "knows he lives" is the entire feature, not
# a contradiction, and a checker that flagged every changed value would fire
# on every Thread in the book while contradicting resolve.py rule 5.

from app.codex.anchors import AnchorIndex
from app.codex.snags import (
    SNAG_AMBIGUOUS_ORDER, SNAG_AXIS_CONFLICT, SNAG_BAD_SUPERSEDE,
    SNAG_CARDINALITY, SNAG_EXCLUSIVE, SNAG_UNPLACED,
    check_facts, check_ties, group_tangles,
)

CHAPTERS = ["c-1", "c-2", "c-3"]
INDEX = AnchorIndex(CHAPTERS, {"c-1": ["s-a", "s-b"]})


def _fact(fact_id, at, axis, value, **kw):
    return {"id": fact_id, "at": at, "axis": axis, "value": value, **kw}


def _kinds(snags):
    return sorted(s.kind for s in snags)


# ── What a Run is SUPPOSED to do ─────────────────────────────────────────────

def test_a_value_changing_over_the_book_is_not_a_contradiction():
    # THE test. resolve.py rule 5 says a later fact on the same (axis, frame)
    # supersedes the earlier one, and the derivation is deterministic. A
    # checker that disagreed would be fighting the resolver it shares a
    # folder with -- and would fire on every Thread with a normal Run.
    run = [
        _fact("f-1", "c-1", "belief.father", "Believes he died in the raid."),
        _fact("f-2", "c-3", "belief.father", "Knows he is alive."),
    ]
    assert check_facts("e-elara", run, INDEX) == []


def test_the_same_axis_in_two_frames_is_not_a_contradiction():
    # Elara believing her father is dead while the truth is that he lives is
    # not a contradiction. It is the reason this whole system exists.
    run = [
        _fact("f-1", "c-1", "father.fate", "Dead.", frame="e-elara"),
        _fact("f-2", "c-1", "father.fate", "Alive, in hiding.", frame="truth"),
    ]
    assert check_facts("e-elara", run, INDEX) == []


def test_the_same_value_twice_is_a_duplicate_not_a_disagreement():
    # Annoying, but nothing about the world is in doubt.
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Green."),
    ]
    assert check_facts("e-x", run, INDEX) == []


# ── Two facts at one point with nothing to order them ────────────────────────

def test_two_values_at_the_same_point_are_ambiguous():
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Blue."),
    ]
    snags = check_facts("e-x", run, INDEX)
    assert _kinds(snags) == [SNAG_AMBIGUOUS_ORDER]
    assert len(snags[0].sides) == 2


def test_saying_which_one_stands_resolves_it():
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Blue.", supersedes="f-1"),
    ]
    assert check_facts("e-x", run, INDEX) == []


def test_both_sides_are_shown_not_one():
    # Showing one side and calling it wrong would be the app taking a
    # position on the writer's book.
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Blue."),
    ]
    values = {s["value"] for s in check_facts("e-x", run, INDEX)[0].sides}
    assert values == {"Green.", "Blue."}


def test_a_scene_anchor_and_its_chapter_are_not_the_same_point():
    # c-1 sits at the START of chapter one, before s-b. Treating them as one
    # point would invent an ambiguity out of correct dating.
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1/s-b", "eyes", "Blue."),
    ]
    assert check_facts("e-x", run, INDEX) == []


# ── supersedes that cannot be right ──────────────────────────────────────────

def test_replacing_a_fact_that_is_not_there():
    run = [_fact("f-2", "c-2", "eyes", "Blue.", supersedes="f-gone")]
    assert _kinds(check_facts("e-x", run, INDEX)) == [SNAG_BAD_SUPERSEDE]


def test_replacing_something_that_happens_later_is_backwards():
    run = [
        _fact("f-1", "c-3", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Blue.", supersedes="f-1"),
    ]
    assert SNAG_BAD_SUPERSEDE in _kinds(check_facts("e-x", run, INDEX))


def test_two_facts_cannot_both_have_replaced_the_same_one():
    # The writer wrote both lines themselves and only one can be the
    # successor. There is no reading of the book under which this is meant.
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-2", "eyes", "Blue.", supersedes="f-1"),
        _fact("f-3", "c-3", "eyes", "Grey.", supersedes="f-1"),
    ]
    assert SNAG_AXIS_CONFLICT in _kinds(check_facts("e-x", run, INDEX))


# ── A fact with nowhere in the story ─────────────────────────────────────────

def test_a_fact_anchored_to_a_deleted_chapter_is_reported():
    # It looks perfectly fine in the file and is invisible to everything
    # downstream, which is the worst combination.
    run = [_fact("f-1", "c-gone", "eyes", "Green.")]
    assert _kinds(check_facts("e-x", run, INDEX)) == [SNAG_UNPLACED]


def test_an_unanchored_fact_is_reported():
    run = [_fact("f-1", "", "eyes", "Green.")]
    assert _kinds(check_facts("e-x", run, INDEX)) == [SNAG_UNPLACED]


# ── Marked as deliberate ─────────────────────────────────────────────────────

def test_deliberate_contradictions_are_never_raised_again():
    # Much good fiction contradicts itself on purpose. A checker that cannot
    # be told so becomes noise the writer stops reading, and a checker nobody
    # reads catches nothing at all.
    run = [
        _fact("f-1", "c-1", "eyes", "Green.", intentional=True),
        _fact("f-2", "c-1", "eyes", "Blue.", intentional=True),
    ]
    assert check_facts("e-x", run, INDEX) == []


def test_marking_one_side_deliberate_silences_the_pair():
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Blue.", intentional=True),
    ]
    assert check_facts("e-x", run, INDEX) == []


# ── Ties ─────────────────────────────────────────────────────────────────────

def _registry(**relation):
    base = {"id": "married_to", "label": "married to", "inverse": None,
            "symmetric": True, "source_types": ["character"],
            "target_types": ["character"], "cardinality": "many",
            "exclusive_group": None}
    base.update(relation)
    return {"types": [], "relations": [base]}


def test_a_relation_that_permits_one_and_has_three():
    registry = _registry(cardinality="one")
    ties = [{"rel": "married_to", "target": f"e-{i}", "at": "c-1"}
            for i in range(3)]
    snags = check_ties("e-x", ties, registry, INDEX)
    assert _kinds(snags) == [SNAG_CARDINALITY]
    assert len(snags[0].sides) == 3


def test_marriage_ships_with_no_exclusivity():
    # Polygamous, political and invented-culture marriages are not
    # contradictions. A checker that encoded one culture's assumption would
    # be telling a fantasy novelist their world is wrong.
    ties = [{"rel": "married_to", "target": "e-a", "at": "c-1"},
            {"rel": "married_to", "target": "e-b", "at": "c-1"}]
    assert check_ties("e-x", ties, _registry(), INDEX) == []


def test_a_writer_can_opt_their_world_in():
    ties = [{"rel": "married_to", "target": "e-a", "at": "c-1"},
            {"rel": "married_to", "target": "e-b", "at": "c-1"}]
    assert _kinds(check_ties("e-x", ties, _registry(cardinality="one"), INDEX)) \
        == [SNAG_CARDINALITY]


def test_a_tie_that_has_ended_does_not_count_against_the_limit():
    registry = _registry(cardinality="one")
    ties = [{"rel": "married_to", "target": "e-a", "at": "c-1", "until": "c-2"},
            {"rel": "married_to", "target": "e-b", "at": "c-2"}]
    assert check_ties("e-x", ties, registry, INDEX, at="c-3") == []


def test_a_tie_that_has_not_begun_does_not_count_either():
    registry = _registry(cardinality="one")
    ties = [{"rel": "married_to", "target": "e-a", "at": "c-1"},
            {"rel": "married_to", "target": "e-b", "at": "c-3"}]
    assert check_ties("e-x", ties, registry, INDEX, at="c-1") == []


def test_two_relations_that_cannot_both_be_live():
    registry = {"types": [], "relations": [
        {"id": "serves", "label": "serves", "cardinality": "many",
         "exclusive_group": "allegiance", "inverse": None, "symmetric": False,
         "source_types": [], "target_types": []},
        {"id": "betrays", "label": "betrays", "cardinality": "many",
         "exclusive_group": "allegiance", "inverse": None, "symmetric": False,
         "source_types": [], "target_types": []},
    ]}
    ties = [{"rel": "serves", "target": "e-a", "at": "c-1"},
            {"rel": "betrays", "target": "e-a", "at": "c-1"}]
    assert _kinds(check_ties("e-x", ties, registry, INDEX)) == [SNAG_EXCLUSIVE]


def test_the_same_relation_twice_is_not_an_exclusive_clash():
    registry = {"types": [], "relations": [
        {"id": "serves", "label": "serves", "cardinality": "many",
         "exclusive_group": "allegiance", "inverse": None, "symmetric": False,
         "source_types": [], "target_types": []},
    ]}
    ties = [{"rel": "serves", "target": "e-a", "at": "c-1"},
            {"rel": "serves", "target": "e-b", "at": "c-1"}]
    assert check_ties("e-x", ties, registry, INDEX) == []


def test_an_unknown_relation_is_left_alone():
    # The registry is the world model. Inventing rules for a relation it does
    # not describe would be guessing at the writer's intent.
    ties = [{"rel": "invented_by_the_writer", "target": "e-a", "at": "c-1"}]
    assert check_ties("e-x", ties, _registry(), INDEX) == []


# ── Tangles ──────────────────────────────────────────────────────────────────

def test_snags_sharing_a_cause_become_one_stop():
    # Moving one date can produce eleven Snags. Asking the writer the same
    # thing eleven times teaches them the checker does not understand their
    # book.
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Blue."),
        _fact("f-3", "c-2", "hair", "Dark."),
        _fact("f-4", "c-2", "hair", "Fair."),
    ]
    groups = group_tangles(check_facts("e-x", run, INDEX))
    assert [len(g) for g in groups] == [1, 1]
    assert {g[0].axis for g in groups} == {"eyes", "hair"}


def test_a_snag_keeps_its_identity_across_runs():
    # A "not yet" has to still be remembered next session, which means the
    # same problem must produce the same key.
    run = [
        _fact("f-1", "c-1", "eyes", "Green."),
        _fact("f-2", "c-1", "eyes", "Blue."),
    ]
    first = check_facts("e-x", run, INDEX)[0].key()
    second = check_facts("e-x", list(reversed(run)), INDEX)[0].key()
    assert first == second
