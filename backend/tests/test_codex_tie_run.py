"""
A connection that changes across the book.

These tests are the writer's own three scenarios, given as the check on whether
the model could express real relationships. Only the second one worked before:

    Example 1  Chapter 2 Alexandra meets Dean through Lara = acquaintances.
               Chapter 4 Alexandra and Dean are friends. Chapter 8 Alexandra
               saves Dean's life becoming real friends.
    Example 2  Chapter 1 Lara Croft is daughter to Lord Benjamin Croft =
               Family/Daughter and father. Rest of book never changes.
    Example 3  Chapter 7 Alexandra meets Oliver and is disgusted by him =
               animosity. Chapter 8 they work together = acquaintances.
               Chapter 11 (1 year later) they are passionate lovers = a couple.

Examples 1 and 3 failed because connections had a validity window and no axis,
so each new state needed the previous one closed by hand -- and forgetting once
made the brief report all three states at once. The fix is that the PAIR is the
axis, which hands connections the supersession the fact engine already had.
"""

from app.codex.anchors import AnchorIndex
from app.codex.tie_run import resolve_ties, tie_axis

# Eleven chapters, so the examples can be written with the numbers they use.
CHAPTERS = [f"c-{n:02d}" for n in range(1, 12)]
INDEX = AnchorIndex(CHAPTERS)


def _tie(target, rel, reason, **kw):
    return {"target": target, "rel": rel, "reason": reason, **kw}


def _ch(n: int) -> str:
    return f"c-{n:02d}"


# ── Example 1: a friendship that deepens ─────────────────────────────────────

ALEXANDRA_DEAN = [
    _tie("e-dean", "connected_to", "Met through Lara; acquaintances", at=_ch(2)),
    _tie("e-dean", "friend_of", "Friends now", at=_ch(4)),
    _tie("e-dean", "close_friend_of", "She saved his life", at=_ch(8)),
]


def test_chapter_three_reads_the_first_state():
    state = resolve_ties(ALEXANDRA_DEAN, INDEX, _ch(3)).for_target("e-dean")
    assert state.reason == "Met through Lara; acquaintances"


def test_chapter_five_reads_the_second_and_the_first_is_gone():
    resolution = resolve_ties(ALEXANDRA_DEAN, INDEX, _ch(5))
    assert len(resolution.states) == 1
    assert resolution.for_target("e-dean").reason == "Friends now"


def test_chapter_nine_reads_the_last():
    state = resolve_ties(ALEXANDRA_DEAN, INDEX, _ch(9)).for_target("e-dean")
    assert state.reason == "She saved his life"
    assert state.rel == "close_friend_of"


def test_the_writer_closes_NOTHING_by_hand():
    # The failure this whole module exists to prevent. No `until` anywhere in
    # example 1, and still exactly one state in force at chapter 9 -- not three
    # overlapping ones reporting her as his acquaintance AND friend AND close
    # friend at once.
    assert not any(t.get("until") for t in ALEXANDRA_DEAN)
    assert len(resolve_ties(ALEXANDRA_DEAN, INDEX, _ch(9)).states) == 1


def test_before_the_first_state_they_are_not_connected_at_all():
    # They had not met. A connection is not retroactive.
    assert resolve_ties(ALEXANDRA_DEAN, INDEX, _ch(1)).states == []


def test_what_it_replaced_is_kept_rather_than_dropped():
    # "Friends, and before that acquaintances" is worth being able to show, and
    # a connection that quietly lost its earlier states would look like the app
    # forgot them.
    resolution = resolve_ties(ALEXANDRA_DEAN, INDEX, _ch(9))
    assert [h.reason for h in resolution.history] == [
        "Met through Lara; acquaintances", "Friends now"]


def test_a_replaced_state_says_it_replaced_something():
    # So the walk can show that friends REPLACED acquaintances, instead of the
    # writer wondering where the earlier one went.
    state = resolve_ties(ALEXANDRA_DEAN, INDEX, _ch(9)).for_target("e-dean")
    assert state.supersedes_earlier is True


def test_reading_the_end_of_the_book_reads_the_latest():
    state = resolve_ties(ALEXANDRA_DEAN, INDEX, None).for_target("e-dean")
    assert state.reason == "She saved his life"


# ── Example 2: a fact of the premise, never dated, never changed ─────────────

LARA_FATHER = [_tie("e-benjamin", "daughter_of", "His only daughter")]


def test_an_undated_connection_is_true_from_the_start():
    # THE ONE PLACE FACTS AND CONNECTIONS DIFFER. An undated FACT is unplaced,
    # because a change with no point in the story is meaningless. An undated
    # CONNECTION is the premise -- asking a writer to date "Lara is his
    # daughter" is asking them to date the book existing.
    for chapter in (1, 6, 11):
        state = resolve_ties(LARA_FATHER, INDEX, _ch(chapter)).for_target("e-benjamin")
        assert state is not None, chapter
        assert state.reason == "His only daughter"


def test_an_undated_connection_is_not_reported_as_unplaced():
    assert resolve_ties(LARA_FATHER, INDEX, _ch(1)).unplaced == []


def test_it_knows_it_was_never_dated():
    assert resolve_ties(LARA_FATHER, INDEX, None).for_target("e-benjamin").always


def test_it_replaced_nothing_so_it_does_not_claim_to():
    assert resolve_ties(LARA_FATHER, INDEX,
                        _ch(5)).for_target("e-benjamin").supersedes_earlier is False


def test_a_dated_state_still_beats_an_undated_one_from_its_own_anchor():
    # Otherwise "always true" would mean "unchangeable", and a relationship
    # that starts as the premise could never develop.
    ties = LARA_FATHER + [
        _tie("e-benjamin", "estranged_from", "She has not spoken to him since the will",
             at=_ch(6))]
    assert resolve_ties(ties, INDEX, _ch(5)).for_target("e-benjamin").reason \
        == "His only daughter"
    assert resolve_ties(ties, INDEX, _ch(7)).for_target("e-benjamin").reason \
        == "She has not spoken to him since the will"


def test_a_connection_pointing_at_a_DELETED_chapter_is_still_unplaced():
    # Undated is fine. An anchor that was written and no longer resolves is a
    # real problem, and quietly treating it as always-true would hide a chapter
    # the writer deleted.
    ties = [_tie("e-dean", "friend_of", "Friends", at="c-gone")]
    resolution = resolve_ties(ties, INDEX, _ch(5))
    assert resolution.states == []
    assert [u.target for u in resolution.unplaced] == ["e-dean"]


# ── Example 3: animosity to lovers ───────────────────────────────────────────

ALEXANDRA_OLIVER = [
    _tie("e-oliver", "connected_to", "Disgusted by him on sight", at=_ch(7)),
    _tie("e-oliver", "colleague_of", "Working the same case, civilly", at=_ch(8)),
    _tie("e-oliver", "lover_of", "A year on, and they cannot be apart", at=_ch(11)),
]


def test_one_relationship_changing_not_three_relationships():
    # The thing the old model got wrong in kind rather than degree. Enmity to
    # acquaintance to lovers is unmistakably ONE relationship developing, and
    # three separate edges would be wrong in the data and wrong on the map.
    for chapter in (7, 9, 11):
        assert len(resolve_ties(ALEXANDRA_OLIVER, INDEX, _ch(chapter)).states) == 1


def test_each_stage_reads_correctly():
    reads = {c: resolve_ties(ALEXANDRA_OLIVER, INDEX,
                             _ch(c)).for_target("e-oliver").rel
             for c in (7, 8, 9, 10, 11)}
    assert reads == {7: "connected_to", 8: "colleague_of", 9: "colleague_of",
                     10: "colleague_of", 11: "lover_of"}


def test_the_year_between_lives_in_the_writers_own_words():
    # Anchors are narrative position, not in-world dates -- the app knows
    # chapter 11 follows chapter 8 and nothing about a year passing. Recorded
    # rather than computed, and honestly so.
    state = resolve_ties(ALEXANDRA_OLIVER, INDEX, _ch(11)).for_target("e-oliver")
    assert "A year on" in state.reason


# ── Whose truth, on a connection ─────────────────────────────────────────────

def test_two_people_can_read_the_same_connection_differently():
    # What makes the hard version of example 3 expressible: she thinks they are
    # friends while he is using her. Two states on one pair, both in force,
    # and not a contradiction.
    ties = [
        _tie("e-dean", "friend_of", "Her closest friend", at=_ch(4),
             frame="e-alexandra"),
        _tie("e-dean", "connected_to", "He is using her for the keys", at=_ch(4),
             frame="truth"),
    ]
    resolution = resolve_ties(ties, INDEX, _ch(5),
                              frames={"truth", "e-alexandra"})
    assert len(resolution.states) == 2
    assert {s.reason for s in resolution.states} == {
        "Her closest friend", "He is using her for the keys"}


def test_a_belief_is_not_returned_to_someone_who_does_not_hold_it():
    ties = [_tie("e-dean", "friend_of", "Her closest friend", at=_ch(4),
                 frame="e-alexandra")]
    assert resolve_ties(ties, INDEX, _ch(5), frames={"truth"}).states == []


def test_a_belief_and_the_truth_supersede_SEPARATELY():
    # Her view changing must not silently overwrite what is actually true, or a
    # character learning something would rewrite the world.
    ties = [
        _tie("e-dean", "friend_of", "Her closest friend", at=_ch(4),
             frame="e-alexandra"),
        _tie("e-dean", "connected_to", "He is using her", at=_ch(4), frame="truth"),
        _tie("e-dean", "enemy_of", "She knows now", at=_ch(9), frame="e-alexandra"),
    ]
    resolution = resolve_ties(ties, INDEX, _ch(10), frames={"truth", "e-alexandra"})
    by_frame = {s.frame: s.reason for s in resolution.states}
    assert by_frame == {"e-alexandra": "She knows now", "truth": "He is using her"}


# ── Secrets ──────────────────────────────────────────────────────────────────

def test_a_connection_the_reader_has_not_learned_is_withheld():
    # A secret marriage. Without this the brief would hold the secret fact back
    # while the map drew a labelled edge announcing it.
    ties = [_tie("e-dean", "married_to", "Married in secret at the coast",
                 at=_ch(2), revealed_at=_ch(9))]
    early = resolve_ties(ties, INDEX, _ch(4))
    assert early.states == []
    assert early.withheld_spoilers == 1
    assert resolve_ties(ties, INDEX, _ch(10)).for_target("e-dean") is not None


def test_an_ordinary_connection_is_not_treated_as_a_secret():
    # An always-true connection has no reveal point and no `at` to fall back on.
    # Counting that as a spoiler would hide every ordinary connection in the
    # book from every brief.
    assert resolve_ties(LARA_FATHER, INDEX, _ch(5)).states != []


def test_an_author_only_connection_is_unreachable():
    ties = [_tie("e-dean", "friend_of", "Author's note to self", at=_ch(2),
                 ai_scope="never")]
    for spoilers in (True, False):
        for on_request in (True, False):
            resolution = resolve_ties(ties, INDEX, None, hide_spoilers=spoilers,
                                      include_on_request=on_request)
            assert resolution.states == []


def test_a_withheld_connection_does_not_leak_through_its_history():
    # Its earlier wording is as much a spoiler as its current one.
    ties = [
        _tie("e-dean", "connected_to", "Courting quietly", at=_ch(2),
             revealed_at=_ch(9)),
        _tie("e-dean", "married_to", "Married in secret", at=_ch(4),
             revealed_at=_ch(9)),
    ]
    resolution = resolve_ties(ties, INDEX, _ch(5))
    assert resolution.states == []
    assert resolution.history == []


# ── Two states at one point ──────────────────────────────────────────────────

def test_two_states_at_the_same_anchor_are_a_SNAG_not_an_ordering():
    # The same rule facts follow. Picking a winner here would report a
    # relationship the book never actually establishes.
    ties = [
        _tie("e-dean", "friend_of", "Friends", at=_ch(4)),
        _tie("e-dean", "enemy_of", "Enemies", at=_ch(4)),
    ]
    resolution = resolve_ties(ties, INDEX, _ch(5))
    assert resolution.states == []
    assert len(resolution.ambiguities) == 1
    assert resolution.ambiguities[0].axis == tie_axis("e-dean")


def test_the_same_state_can_recur_at_a_later_point():
    # They were friends, drifted, and were friends again. Not a duplicate -- the
    # same relation at a different anchor is a different thing being said.
    ties = [
        _tie("e-dean", "friend_of", "Friends", at=_ch(2)),
        _tie("e-dean", "connected_to", "Barely speaking", at=_ch(5)),
        _tie("e-dean", "friend_of", "Friends again, warier", at=_ch(9)),
    ]
    assert resolve_ties(ties, INDEX, _ch(10)).for_target("e-dean").reason \
        == "Friends again, warier"


# ── Ending, which supersession cannot express ───────────────────────────────

def test_a_connection_can_simply_END():
    # "They stopped being friends and became nothing" is a different statement
    # from "they became enemies". Replacement is derived; ending is declared,
    # which is the one job `until` still has.
    ties = [_tie("e-dean", "friend_of", "Friends", at=_ch(2), until=_ch(6))]
    assert resolve_ties(ties, INDEX, _ch(4)).for_target("e-dean") is not None
    assert resolve_ties(ties, INDEX, _ch(4)).for_target("e-dean").until == _ch(6)


# ── Several connections at once ──────────────────────────────────────────────

def test_different_pairs_do_not_supersede_each_other():
    # The pair is the axis, so Dean and Oliver are separate axes. Sharing one
    # would make her latest relationship erase all the others.
    ties = ALEXANDRA_DEAN + ALEXANDRA_OLIVER
    resolution = resolve_ties(ties, INDEX, _ch(11))
    assert {s.target for s in resolution.states} == {"e-dean", "e-oliver"}


def test_the_axis_cannot_collide_with_a_writers_own_fact_axis():
    # Somebody tracking `belief.father` must not be able to name the axis that
    # carries their connection to a character.
    assert tie_axis("e-dean").startswith("tie:")


def test_no_connections_resolves_to_nothing_rather_than_failing():
    assert resolve_ties([], INDEX, _ch(4)).states == []


def test_the_result_order_never_wobbles():
    # Spatial memory again: a list that reshuffles between identical reads
    # teaches the writer to distrust it.
    ties = ALEXANDRA_DEAN + ALEXANDRA_OLIVER + LARA_FATHER
    first = [(s.target, s.frame) for s in resolve_ties(ties, INDEX, None).states]
    for _ in range(3):
        assert [(s.target, s.frame)
                for s in resolve_ties(ties, INDEX, None).states] == first
