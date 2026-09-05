# tests/test_codex_context.py -- what the AI is told, and what it is not
# =======================================================================
# This is the module that changes a product rule, so these tests are the
# rule's enforcement:
#
#     EXPLICITLY INSPECTABLE AND CONTROLLABLE CONTEXT. AI may automatically
#     receive story context relevant to the current anchor, but the writer
#     must be able to inspect what will be sent, remove individual Threads,
#     exclude categories, and disable automatic Weave context entirely.
#
# One test per obligation, plus the two that keep a brief honest: nothing is
# ever silently truncated, and everything dropped is reported.

from app.codex.anchors import AnchorIndex
from app.codex.context import (
    RELEVANCE_BACKGROUND, RELEVANCE_CONNECTED, RELEVANCE_MENTIONED,
    RELEVANCE_PINNED, Budget, assemble, estimate_tokens,
)

CHAPTERS = ["c-1", "c-2", "c-3"]
INDEX = AnchorIndex(CHAPTERS)


def _thread(entity_id, name, overview="Someone in the world.", **kw):
    thread = {
        "entity_id": entity_id, "name": name, "type": "character",
        "aliases": [], "ties": [], "run": [],
        "sections": {"overview": {"heading": "Overview", "content": overview,
                                  "trait_blocks": []}},
    }
    thread.update(kw)
    return thread


def _budget(limit=100_000, **kw):
    return Budget(model_context_limit=limit, **kw)


def _names(brief):
    return [p.name for p in brief.pieces]


# ── Inspectable ──────────────────────────────────────────────────────────────

def test_the_brief_lists_every_thread_going_into_it():
    # "Inspect what will be sent" is not a nice-to-have here; it is the
    # replacement for the rule that AI never had implicit access.
    brief = assemble([_thread("e-1", "Elara"), _thread("e-2", "Garrick")],
                     INDEX, at="c-1", budget=_budget())
    assert sorted(_names(brief)) == ["Elara", "Garrick"]
    assert all(p.tokens > 0 for p in brief.pieces)


def test_every_thread_says_why_it_is_there():
    # "Why is this here?" is the question that makes the panel worth opening.
    brief = assemble([_thread("e-1", "Elara")], INDEX, at="c-1",
                     budget=_budget(), mentioned={"e-1"})
    assert brief.pieces[0].reason() == "named in what you are writing"


def test_the_budget_shows_where_the_window_went():
    # An unexplained "context full" teaches nothing.
    brief = assemble([_thread("e-1", "Elara")], INDEX, at="c-1",
                     budget=_budget(20_000, system_prompt_tokens=800,
                                    user_text_tokens=5_000))
    assert brief.budget["your_text"] == 5_000
    assert brief.budget["for_the_weave"] == 20_000 - 4_000 - 800 - 5_000


# ── Controllable ─────────────────────────────────────────────────────────────

def test_one_thread_can_be_removed():
    brief = assemble([_thread("e-1", "Elara"), _thread("e-2", "Garrick")],
                     INDEX, at="c-1", budget=_budget(), exclude_ids={"e-2"})
    assert _names(brief) == ["Elara"]
    assert "Garrick" not in brief.text


def test_a_whole_category_can_be_excluded():
    threads = [_thread("e-1", "Elara"),
               _thread("e-2", "Ashfall", type="location")]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget(),
                     exclude_types={"location"})
    assert _names(brief) == ["Elara"]


def test_pinning_beats_excluding_its_category():
    # The writer said "not locations" and then attached this one by hand. The
    # more specific instruction wins.
    threads = [_thread("e-1", "Elara"),
               _thread("e-2", "Ashfall", type="location")]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget(),
                     exclude_types={"location"}, pinned={"e-2"})
    assert sorted(_names(brief)) == ["Ashfall", "Elara"]


def test_turning_it_off_sends_nothing_at_all():
    # The global switch returns the app to exactly how it behaved before the
    # Weave existed: manual chips only.
    brief = assemble([_thread("e-1", "Elara")], INDEX, at="c-1",
                     budget=_budget(), enabled=False)
    assert (brief.enabled, brief.text, brief.pieces) == (False, "", [])


# ── Relevance, and the order things are dropped in ───────────────────────────

def test_a_named_thread_outranks_a_background_one():
    threads = [_thread("e-1", "Elara"), _thread("e-2", "Garrick")]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget(),
                     mentioned={"e-2"})
    ranks = {p.name: p.relevance for p in brief.pieces}
    assert ranks == {"Garrick": RELEVANCE_MENTIONED,
                     "Elara": RELEVANCE_BACKGROUND}


def test_someone_tied_to_a_named_thread_ranks_above_background():
    elara = _thread("e-1", "Elara", ties=[{"rel": "mentored_by",
                                           "target": "e-2"}])
    threads = [elara, _thread("e-2", "Garrick"), _thread("e-3", "Someone")]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget(),
                     mentioned={"e-1"})
    ranks = {p.name: p.relevance for p in brief.pieces}
    assert ranks["Garrick"] == RELEVANCE_CONNECTED
    assert ranks["Someone"] == RELEVANCE_BACKGROUND


def test_connection_is_read_in_both_directions():
    # Only one direction is stored. A mentor is connected to their student
    # whether or not the student's file happens to carry the Tie.
    garrick = _thread("e-2", "Garrick", ties=[{"rel": "mentor_of",
                                               "target": "e-1"}])
    brief = assemble([_thread("e-1", "Elara"), garrick], INDEX, at="c-1",
                     budget=_budget(), mentioned={"e-1"})
    ranks = {p.name: p.relevance for p in brief.pieces}
    assert ranks["Garrick"] == RELEVANCE_CONNECTED


def test_pinned_outranks_everything():
    brief = assemble([_thread("e-1", "Elara")], INDEX, at="c-1",
                     budget=_budget(), pinned={"e-1"}, mentioned={"e-1"})
    assert brief.pieces[0].relevance == RELEVANCE_PINNED


# ── Pruning, and saying what was pruned ──────────────────────────────────────

def _fat(entity_id, name, size=4000):
    return _thread(entity_id, name, overview="word " * size)


def test_the_least_relevant_goes_first():
    threads = [_fat("e-1", "Background"), _fat("e-2", "Named")]
    brief = assemble(threads, INDEX, at="c-1",
                     budget=_budget(10_000), mentioned={"e-2"})
    assert _names(brief) == ["Named"]


def test_what_was_dropped_is_reported():
    # A brief that quietly omitted half the world would be worse than one
    # never assembled, because the writer would trust it.
    threads = [_fat("e-1", "Background"), _fat("e-2", "Named")]
    brief = assemble(threads, INDEX, at="c-1",
                     budget=_budget(10_000), mentioned={"e-2"})
    assert [o["name"] for o in brief.omitted] == ["Background"]
    assert brief.omitted[0]["reason"]


def test_pinned_content_is_never_the_thing_that_gets_dropped():
    # A chip the writer attached is an instruction, not a suggestion.
    threads = [_fat("e-1", "Pinned"), _fat("e-2", "Named")]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget(10_000),
                     pinned={"e-1"}, mentioned={"e-2"})
    assert "Pinned" in _names(brief)


def test_pinned_content_that_cannot_fit_is_refused_not_truncated():
    # Half a character profile reads as a whole one, and the model has no way
    # to know it was handed a fragment.
    brief = assemble([_fat("e-1", "Enormous", 20_000)], INDEX, at="c-1",
                     budget=_budget(10_000), pinned={"e-1"})
    assert brief.refused
    assert brief.pieces == [] and brief.text == ""
    assert "Unpin something" in brief.refusal


def test_the_refusal_states_both_numbers():
    brief = assemble([_fat("e-1", "Enormous", 20_000)], INDEX, at="c-1",
                     budget=_budget(10_000), pinned={"e-1"})
    assert "room for about" in brief.refusal


def test_the_same_world_assembles_the_same_brief_twice():
    # A brief that shuffled between runs would make every difference in the
    # model's answer impossible to attribute.
    threads = [_thread(f"e-{i}", f"Person {i}") for i in range(6)]
    first = assemble(threads, INDEX, at="c-1", budget=_budget()).text
    second = assemble(list(reversed(threads)), INDEX, at="c-1",
                      budget=_budget()).text
    assert first == second


# ── The temporal point of the whole feature ──────────────────────────────────

def test_the_brief_says_what_is_true_now_before_the_static_description():
    # A model given "a grieving daughter" followed by "she knows he is alive"
    # weights whichever it read as authoritative. The time-varying part goes
    # first and says plainly that it is current.
    elara = _thread("e-1", "Elara", overview="A grieving daughter.", run=[
        {"id": "f-1", "at": "c-1", "axis": "belief.father",
         "value": "Believes he died."}])
    brief = assemble([elara], INDEX, at="c-2", budget=_budget())
    text = brief.text
    assert text.index("True at this point") < text.index("A grieving daughter")


def test_a_later_fact_is_not_in_an_earlier_brief():
    elara = _thread("e-1", "Elara", run=[
        {"id": "f-1", "at": "c-1", "axis": "father", "value": "Believes dead."},
        {"id": "f-2", "at": "c-3", "axis": "father", "value": "Knows alive."},
    ])
    early = assemble([elara], INDEX, at="c-1", budget=_budget()).text
    assert "Believes dead." in early and "Knows alive." not in early


def test_a_spoiler_is_withheld_and_counted():
    elara = _thread("e-1", "Elara", run=[
        {"id": "f-1", "at": "c-1", "axis": "father", "value": "He lives.",
         "revealed_at": "c-3"}])
    brief = assemble([elara], INDEX, at="c-1", budget=_budget())
    assert "He lives." not in brief.text
    assert brief.withheld_spoilers == 1


def test_never_is_unreachable_by_any_argument():
    # The point of that setting. No combination of flags reaches it.
    elara = _thread("e-1", "Elara", run=[
        {"id": "f-1", "at": "c-1", "axis": "secret", "value": "Author only.",
         "ai_scope": "never"}])
    brief = assemble([elara], INDEX, at="c-3", budget=_budget(),
                     include_on_request=True)
    assert "Author only." not in brief.text


def test_a_believed_fact_is_labelled_as_believed():
    # An unlabelled belief presented beside objective truth is how a model
    # ends up writing a character who knows what she does not know.
    elara = _thread("e-1", "Elara", run=[
        {"id": "f-1", "at": "c-1", "axis": "father", "value": "He died.",
         "frame": "e-1"}])
    brief = assemble([elara], INDEX, at="c-2", budget=_budget(), pov="e-1")
    assert "(believed) He died." in brief.text


# ── The estimate ─────────────────────────────────────────────────────────────

def test_the_estimate_grows_with_the_text():
    assert estimate_tokens("word " * 100) > estimate_tokens("word " * 10)


# -- WHO IS ACTUALLY IN THIS CHAPTER ----------------------------------------
#
# Declared presence. The writer's reason, which decides the design: "An epic
# adventure story may have 30-60 character profiles with dozens of creatures,
# 20-40 locations. Having to check and uncheck what the writer wants to attach
# as context can be tedious."
#
# AUTHORED, NEVER DERIVED. R8.5 deleted `codex_mention` because presence worked
# out from the manuscript and cached against a fingerprint of codex/ goes
# silently wrong the moment a chapter is edited, while the freshness gate says
# everything is current. This is a statement the writer makes, in their own
# Markdown, with nothing to rebuild.

def _placed(entity_id, name, appears_in, **kw):
    thread = _thread(entity_id, name, **kw)
    thread["appears_in"] = list(appears_in)
    return thread


def test_an_entry_placed_elsewhere_is_left_out():
    threads = [_placed("e-lou", "Lou", ["c-2"])]
    index = INDEX
    brief = assemble(threads, index, at="c-1", budget=_budget())
    assert brief.pieces == []


def test_an_entry_placed_here_goes_in():
    threads = [_placed("e-lou", "Lou", ["c-1", "c-2"])]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget())
    assert [p.entity_id for p in brief.pieces] == ["e-lou"]


def test_WHAT_WAS_LEFT_OUT_IS_COUNTED():
    """
    The rule this app applies to every omission it makes.

    A brief that is quietly shorter is indistinguishable from a smaller world.
    The writer has to be able to see that four entries were held back, or the
    feature becomes a silent editor of their context.
    """
    threads = [_placed("e-lou", "Lou", ["c-2"]),
               _placed("e-rosie", "Rosie", ["c-2"])]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget())
    assert brief.withheld_not_present == 2


def test_AN_ENTRY_NOBODY_HAS_PLACED_IS_NOT_FILTERED():
    """
    Silence means "I have not said", not "nowhere".

    Otherwise turning this on would empty the brief for every project that has
    never used it -- the feature would look like it had broken context
    assembly, on a book where the writer had done nothing wrong.
    """
    threads = [_thread("e-anyone", "Anyone")]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget())
    assert [p.entity_id for p in brief.pieces] == ["e-anyone"]
    assert brief.withheld_not_present == 0


def test_A_PINNED_ENTRY_SURVIVES_ITS_OWN_PLACEMENT():
    # "This one, now" is more specific than a list the writer wrote last week,
    # and it is one of the two things that make filtering safe rather than
    # merely tight.
    threads = [_placed("e-lou", "Lou", ["c-2"])]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget(),
                     pinned={"e-lou"})
    assert [p.entity_id for p in brief.pieces] == ["e-lou"]


def test_A_NAME_IN_THE_PROSE_BEATS_ANY_PLACEMENT():
    """
    The other override, and the more important one.

    If the paragraph being written says Lou, Lou goes -- whatever a placement
    says. A tag set weeks ago must never hide the character the writer is
    literally writing about, because that failure would be invisible: the model
    would answer about a scene without knowing who is in it.
    """
    threads = [_placed("e-lou", "Lou", ["c-2"])]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget(),
                     mentioned={"e-lou"})
    assert [p.entity_id for p in brief.pieces] == ["e-lou"]


def test_a_placement_at_a_scene_still_answers_for_its_chapter():
    # Placements are ANCHORS so scenes can extend this later. A writer who
    # places something at a scene must not be excluded from every request made
    # about the chapter around it.
    threads = [_placed("e-lou", "Lou", ["c-1/s-3"])]
    brief = assemble(threads, INDEX, at="c-1", budget=_budget())
    assert [p.entity_id for p in brief.pieces] == ["e-lou"]


def test_nothing_is_filtered_when_there_is_no_point_in_the_story():
    # A request with no `at` is not about anywhere, so "is it here?" has no
    # answer and filtering on it would be inventing one.
    threads = [_placed("e-lou", "Lou", ["c-2"])]
    brief = assemble(threads, INDEX, at=None, budget=_budget())
    assert [p.entity_id for p in brief.pieces] == ["e-lou"]


def test_presence_is_authored_and_survives_a_round_trip(tmp_path):
    # The whole reason it is a field in the writer's Markdown rather than a
    # table: there is nothing to rebuild and nothing that can go stale.
    from app.codex.threads import parse_thread, render_thread
    from app.codex.types_registry import default_registry

    registry = default_registry()
    source = ("---" + chr(10) + "type: character" + chr(10)
              + "entity_id: e-serena" + chr(10) + "name: Serena" + chr(10)
              + "appears_in:" + chr(10) + "  - c-1" + chr(10)
              + "  - c-2" + chr(10) + "---" + chr(10) + chr(10)
              + "# Overview" + chr(10) + "The protagonist." + chr(10))
    thread = parse_thread(source, registry)
    assert thread["appears_in"] == ["c-1", "c-2"]
    again = parse_thread(render_thread(thread, registry), registry)
    assert again["appears_in"] == ["c-1", "c-2"]


def test_an_unplaced_entry_writes_nothing_to_its_file():
    # An entry nobody has placed must gain nothing in its file, or every
    # existing project would show a diff on its next save for a feature the
    # writer has not used.
    from app.codex.threads import parse_thread, render_thread
    from app.codex.types_registry import default_registry

    registry = default_registry()
    source = ("---" + chr(10) + "type: character" + chr(10)
              + "entity_id: e-x" + chr(10) + "name: X" + chr(10)
              + "---" + chr(10) + chr(10) + "# Overview" + chr(10) + "A." + chr(10))
    rendered = render_thread(parse_thread(source, registry), registry)
    assert "appears_in" not in rendered


# ── Connections in the brief ─────────────────────────────────────────────────
# THE BUG THESE TESTS EXIST FOR. render_thread_brief never read `ties`, so a
# connection's reason line -- the ONE field post_tie refuses to save without,
# capped at 140 characters BECAUSE of brief budget -- reached no model on any
# path. The refusal even told the writer "this is what gets sent to AI when you
# ask for help", which was not true. A writer who spent twenty minutes
# recording six connections got nothing for it.
#
# Same shape as R8.1 and withheld_not_present: computed, correct, connected to
# nothing, and raising no error because an absent line looks like an ordinary
# brief.


def test_a_connection_reaches_the_model():
    elara = _thread("e-1", "Elara", ties=[
        {"rel": "mentored_by", "target": "e-2",
         "reason": "he taught her everything she knows"},
    ])
    brief = assemble([elara, _thread("e-2", "Garrick")], INDEX, at="c-1",
                     budget=_budget())
    text = next(p.text for p in brief.pieces if p.name == "Elara")
    assert "he taught her everything she knows" in text


def test_a_connection_names_the_other_end_and_the_relation():
    # A bare reason is not enough: "he taught her everything" without a name is
    # a sentence about nobody. The relation reads as words rather than an id,
    # because `mentored_by` is not English.
    elara = _thread("e-1", "Elara", ties=[
        {"rel": "mentored_by", "target": "e-2", "reason": "he taught her"},
    ])
    brief = assemble([elara, _thread("e-2", "Garrick")], INDEX, at="c-1",
                     budget=_budget())
    text = next(p.text for p in brief.pieces if p.name == "Elara")
    assert "Garrick" in text
    assert "mentored by" in text
    assert "mentored_by" not in text


def test_a_one_sided_relationship_reaches_only_its_own_pov():
    # THE ASYMMETRIC CASE, and the whole reason `frame` is the mechanism for
    # it. The writer's example: "Character A is infatuated with Character B,
    # adores them, buys them gifts, pays their bills... From Character B's
    # perspective, they don't even know Character A exists because character A
    # is stalking them."
    #
    # Two records on A, none on B. The truth of B's side is the ABSENCE, which
    # is why this cannot be expressed as one connection with a description for
    # each direction: an empty reverse description means "the same, backwards",
    # not "she has never heard of him".
    aldous = _thread("e-1", "Aldous", ties=[
        {"rel": "obsessed_with", "target": "e-2", "frame": "truth",
         "reason": "stalks her; pays her bills anonymously"},
        {"rel": "lover_of", "target": "e-2", "frame": "e-1",
         "reason": "believes they are together"},
    ])
    beatrix = _thread("e-2", "Beatrix")
    threads = [aldous, beatrix]

    # Writing from HIS eyes: the delusion is in force, and marked as a belief
    # so a model cannot report it as the world's truth.
    his = assemble(threads, INDEX, at="c-1", budget=_budget(), pov="e-1")
    his_text = next(p.text for p in his.pieces if p.name == "Aldous")
    assert "(believed)" in his_text
    assert "believes they are together" in his_text
    assert "pays her bills anonymously" in his_text

    # Writing from anyone else's: his belief is not a fact of the world and
    # must not be handed over as one.
    plain = assemble(threads, INDEX, at="c-1", budget=_budget())
    plain_text = next(p.text for p in plain.pieces if p.name == "Aldous")
    assert "believes they are together" not in plain_text
    assert "pays her bills anonymously" in plain_text

    # And HER page says nothing about him, from any POV, because she has
    # nothing recorded about him. This is the part no shared description could
    # express.
    for brief in (his, plain):
        hers = next(p.text for p in brief.pieces if p.name == "Beatrix")
        assert "Aldous" not in hers


def test_the_state_in_force_wins_and_the_earlier_one_is_not_sent():
    # The pair IS the axis (tie_run.py). Friends at c-1, rivals at c-3: read at
    # c-3 the model must be told rivals ONCE, not handed both and left to
    # decide which of the writer's own records to believe.
    kip = _thread("e-1", "Kipling", ties=[
        {"rel": "friend_of", "target": "e-2", "reason": "they trust each other",
         "at": "c-1"},
        {"rel": "rivals", "target": "e-2", "reason": "she cannot forgive him",
         "at": "c-3"},
    ])
    threads = [kip, _thread("e-2", "Milton")]

    early = assemble(threads, INDEX, at="c-1", budget=_budget())
    early_text = next(p.text for p in early.pieces if p.name == "Kipling")
    assert "they trust each other" in early_text
    assert "she cannot forgive him" not in early_text

    late = assemble(threads, INDEX, at="c-3", budget=_budget())
    late_text = next(p.text for p in late.pieces if p.name == "Kipling")
    assert "she cannot forgive him" in late_text
    assert "they trust each other" not in late_text


def test_a_connection_not_yet_true_is_not_sent():
    # The c-1 connection is here for a reason: thread_visibility derives a
    # Thread's INTRODUCTION from the earliest anchor across its facts AND its
    # ties, so a character whose only dated item is a c-3 tie is hidden
    # wholesale at c-1 -- and an UNDATED tie does not rescue her, because it
    # contributes no ordinal. See test_dating_a_connection_can_hide_its_own_owner.
    kip = _thread("e-1", "Kipling", ties=[
        {"rel": "friend_of", "target": "e-3", "reason": "her oldest friend",
         "at": "c-1"},
        {"rel": "rivals", "target": "e-2", "reason": "she cannot forgive him",
         "at": "c-3"},
    ])
    brief = assemble([kip, _thread("e-2", "Milton"), _thread("e-3", "Carina")],
                     INDEX, at="c-1", budget=_budget())
    text = next(p.text for p in brief.pieces if p.name == "Kipling")
    assert "her oldest friend" in text
    assert "cannot forgive" not in text


def test_dating_a_connection_can_hide_its_own_owner():
    # PINNING EXISTING BEHAVIOUR, because it is surprising and it is about to
    # matter. thread_visibility (visibility.py:163-165) reads tie anchors when
    # deriving when a Thread is introduced. So a character whose ONLY dated
    # item is a relationship that starts in chapter 3 is treated as not yet
    # introduced in chapter 1 -- and vanishes from the brief entirely rather
    # than merely losing that one connection.
    #
    # That is defensible for a map and questionable for a brief: "they became
    # rivals in chapter 3" is a statement about the relationship, not about
    # when she first walks on. Recorded here rather than changed, because
    # changing it moves what every existing project sends. Flagged for the
    # editor work that will let writers date these for the first time.
    kip = _thread("e-1", "Kipling", ties=[
        {"rel": "rivals", "target": "e-2", "reason": "she cannot forgive him",
         "at": "c-3"},
    ])
    threads = [kip, _thread("e-2", "Milton")]

    assert "Kipling" not in _names(
        assemble(threads, INDEX, at="c-1", budget=_budget()))
    assert "Kipling" in _names(
        assemble(threads, INDEX, at="c-3", budget=_budget()))


def test_a_secret_connection_is_withheld_until_the_reader_learns_it():
    # revealed_at is the reader's clock. A connection the reader does not know
    # about must not reach a model that is drafting the chapter before it.
    spouse = _thread("e-1", "Elara", ties=[
        {"rel": "married_to", "target": "e-2", "reason": "married in secret",
         "at": "c-1", "revealed_at": "c-3"},
    ])
    brief = assemble([spouse, _thread("e-2", "Garrick")], INDEX, at="c-1",
                     budget=_budget())
    text = next(p.text for p in brief.pieces if p.name == "Elara")
    assert "married in secret" not in text


def test_a_connection_to_someone_not_yet_introduced_is_withheld():
    # visibility.py's rule, which the graph route already keeps: a connection is
    # only as visible as the least visible thing it touches. Sending it here
    # would announce a character the reader has not met, through the back door
    # of somebody else's connection list.
    elara = _thread("e-1", "Elara", ties=[
        {"rel": "mentored_by", "target": "e-2", "reason": "he taught her"},
    ])
    # Not yet INTRODUCED, which is a different thing from not being in this
    # chapter: his earliest anchored fact is in c-3, so at c-1 the reader has
    # not met him. (`appears_in` would NOT do this -- that scopes the brief to
    # who is in the chapter, and a connection to someone offstage is still
    # worth telling a model about.)
    garrick = _thread("e-2", "Garrick",
                      run=[{"id": "f-1", "axis": "arrival", "at": "c-3",
                            "value": "arrives in the valley"}])
    brief = assemble([elara, garrick], INDEX, at="c-1", budget=_budget())
    text = next(p.text for p in brief.pieces if p.name == "Elara")
    assert "he taught her" not in text
    assert "Garrick" not in text


def test_a_connection_costs_budget_and_is_counted():
    # The reason the 140-character cap exists. If ties reach the brief they must
    # reach the token count too, or the budget the cap was derived from is a
    # number nobody is keeping.
    plain = _thread("e-1", "Elara")
    tied = _thread("e-1", "Elara", ties=[
        {"rel": "mentored_by", "target": "e-2", "reason": "he taught her"},
    ])
    others = [_thread("e-2", "Garrick")]

    without = assemble([plain] + others, INDEX, at="c-1", budget=_budget())
    with_tie = assemble([tied] + others, INDEX, at="c-1", budget=_budget())

    a = next(p for p in without.pieces if p.name == "Elara")
    b = next(p for p in with_tie.pieces if p.name == "Elara")
    assert b.tokens > a.tokens
    assert b.tokens == estimate_tokens(b.text)


def test_an_entry_with_only_connections_still_reaches_the_model():
    # A Quick Create entry has a name, a kind and nothing written in it. Before
    # ties were sent, such an entry rendered to almost nothing and was skipped
    # as empty -- so the connections the writer made FROM the walk were the one
    # thing that could not travel.
    bare = {
        "entity_id": "e-1", "name": "Kipling", "type": "character",
        "aliases": [], "run": [],
        "sections": {"overview": {"heading": "Overview", "content": "",
                                  "trait_blocks": []}},
        "ties": [{"rel": "mentored_by", "target": "e-2",
                  "reason": "he taught her everything"}],
    }
    brief = assemble([bare, _thread("e-2", "Garrick")], INDEX, at="c-1",
                     budget=_budget())
    assert "Kipling" in _names(brief)
    text = next(p.text for p in brief.pieces if p.name == "Kipling")
    assert "he taught her everything" in text


# ── The paragraph, and when it travels ───────────────────────────────────────
#
# THE ECONOMY THAT MAKES THE WHOLE THING AFFORDABLE. `reason` is capped at 140
# characters because every connection's line is sent every time. A relationship
# the writer has actually thought about runs several hundred -- their own
# paragraphs are 700-900 -- so the paragraph cannot ride along on every brief:
# eleven of them for one character is the 920-word blob this feature exists to
# replace.
#
# So the line always goes, and the paragraph goes when the OTHER END is
# something the writer is actively working with -- named in the text they are
# writing, or pinned by hand.
#
# Note why it is not "both ends are in the brief": nothing in this writer's
# 56-entry world sets `appears_in`, so every entry is a candidate in every
# brief and that rule would include every paragraph always, saving nothing.
# Being named is the signal that actually tracks what the writer is doing.

def _tied_pair(description="She has trusted him since the northern gate fell."):
    kip = _thread("e-1", "Kipling", ties=[
        {"rel": "mentored_by", "target": "e-2",
         "reason": "father-like mentor; she chafes at his control",
         "description": description},
    ])
    return [kip, _thread("e-2", "Milton")]


def test_the_line_always_travels():
    brief = assemble(_tied_pair(), INDEX, at="c-1", budget=_budget())
    text = next(p.text for p in brief.pieces if p.name == "Kipling")
    assert "father-like mentor" in text


def test_the_paragraph_stays_home_when_the_other_end_is_not_in_play():
    brief = assemble(_tied_pair(), INDEX, at="c-1", budget=_budget())
    text = next(p.text for p in brief.pieces if p.name == "Kipling")
    assert "northern gate" not in text


def test_the_paragraph_travels_when_the_other_end_is_named():
    brief = assemble(_tied_pair(), INDEX, at="c-1", budget=_budget(),
                     mentioned={"e-2"})
    text = next(p.text for p in brief.pieces if p.name == "Kipling")
    assert "northern gate" in text
    assert "father-like mentor" in text


def test_the_paragraph_travels_when_the_other_end_is_pinned():
    # The writer attaching Milton by hand is the same instruction as naming
    # him, said more deliberately.
    brief = assemble(_tied_pair(), INDEX, at="c-1", budget=_budget(),
                     pinned={"e-2"})
    text = next(p.text for p in brief.pieces if p.name == "Kipling")
    assert "northern gate" in text


def test_the_paragraph_costs_what_it_costs():
    without = assemble(_tied_pair(), INDEX, at="c-1", budget=_budget())
    with_it = assemble(_tied_pair(), INDEX, at="c-1", budget=_budget(),
                       mentioned={"e-2"})
    a = next(p for p in without.pieces if p.name == "Kipling")
    b = next(p for p in with_it.pieces if p.name == "Kipling")
    assert b.tokens > a.tokens
    assert b.tokens == estimate_tokens(b.text)


def test_a_withheld_connection_does_not_leak_its_paragraph():
    # The paragraph is the richest thing on a connection, so it is the worst
    # thing to leak. A secret marriage the reader learns of in chapter 3 must
    # not arrive in chapter 1 by way of being pinned.
    elara = _thread("e-1", "Elara", ties=[
        {"rel": "married_to", "target": "e-2", "at": "c-1", "revealed_at": "c-3",
         "reason": "married in secret",
         "description": "They were wed by a hedge priest before the siege."},
    ])
    brief = assemble([elara, _thread("e-2", "Garrick")], INDEX, at="c-1",
                     budget=_budget(), pinned={"e-2"})
    text = next(p.text for p in brief.pieces if p.name == "Elara")
    assert "hedge priest" not in text
    assert "married in secret" not in text
