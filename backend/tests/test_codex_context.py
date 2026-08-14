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
