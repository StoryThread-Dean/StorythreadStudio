# tests/test_codex_visibility.py -- what may be shown, and what may be told
# ==========================================================================
# Two bugs prompted this module, and both were the same shape: output that
# was confidently wrong and looked like a working feature.
#
#   1. A fact with no frame written vanished. "absent means truth" was
#      applied at each consumer with .get("frame", TRUTH), but a fact never
#      arrives with the key MISSING -- it arrives with the key set to None,
#      and .get returns None for that. Every fact added through the API was
#      invisible, and the unit tests passed because their fixtures set
#      frames by hand.
#
#   2. A secret connection was drawn on a map that was correctly hiding the
#      secret behind it, because facts and edges judged visibility in two
#      places and the two disagreed.
#
# So: one normalizer wherever data enters, and one visibility rule shared by
# both. These tests are the fence around that.

from app.codex.anchors import AnchorIndex
from app.codex.normalize import (
    AI_SCOPE_NEVER,
    AI_SCOPE_ON_REQUEST,
    normalize_ai_scope,
    normalize_fact,
    normalize_tie,
)
from app.codex.visibility import (
    HIDDEN_FUTURE,
    HIDDEN_SCOPE,
    HIDDEN_SPOILER,
    VISIBLE,
    Lens,
    connection_visibility,
    record_visibility,
    thread_visibility,
)

CH1, CH2, CH3 = "c-aaa", "c-bbb", "c-ccc"
INDEX = AnchorIndex(
    [CH1, CH2, CH3],
    {CH1: ["s-a1", "s-a2"], CH2: ["s-b1"], CH3: ["s-c1"]},
)


# ── Normalizing: "absent" means one thing, in one place ──────────────────────

def test_a_field_set_to_none_gets_its_default_not_none():
    # THE bug. A dict default never fires for an explicit None, which is
    # exactly how facts arrive from the parser, the API and the index.
    fact = normalize_fact({"axis": "x", "value": "y", "frame": None, "ai_scope": None})
    assert fact["frame"] == "truth"
    assert fact["ai_scope"] == "always"


def test_a_blank_field_is_treated_as_absent():
    # A hand-edited file with "frame:" and nothing after it means the writer
    # left it out, not that they meant the empty string.
    assert normalize_fact({"frame": "   "})["frame"] == "truth"
    assert normalize_tie({"ai_scope": ""})["ai_scope"] == "always"


def test_an_unrecognised_scope_errs_towards_hiding():
    # A typo must not quietly become "always" and start volunteering a
    # secret. Erring this way costs a click; erring the other way costs the
    # reveal.
    assert normalize_ai_scope("on request") == AI_SCOPE_ON_REQUEST
    assert normalize_ai_scope("nonsense") == AI_SCOPE_ON_REQUEST
    assert normalize_ai_scope(None) == "always"


def test_normalizing_keeps_keys_it_did_not_expect():
    # Filling blanks, never discarding. A writer's own field survives.
    assert normalize_fact({"axis": "x", "confidence": 0.8})["confidence"] == 0.8


def test_revealed_at_is_left_alone_when_unwritten():
    # "The reader learns this where it happens" is a RESOLUTION rule applied
    # at read time. Baking it in here would write a reveal point into every
    # file that never had one.
    assert normalize_fact({"at": "c-aaa"})["revealed_at"] is None


# ── One rule for facts and Ties ──────────────────────────────────────────────

def _tie(**kw):
    return normalize_tie({"rel": "married_to", "target": "e-b", **kw})


def test_a_public_record_is_visible():
    assert record_visibility(_tie(at="c-aaa"), INDEX, Lens(at="c-ccc")) == VISIBLE


def test_a_record_that_has_not_happened_yet_is_withheld():
    assert record_visibility(_tie(at="c-ccc"), INDEX, Lens(at="c-aaa")) == HIDDEN_FUTURE


# ── R8.6b: the one caller that may look ahead ────────────────────────────────
#
# The map, and nothing else. A writer scrubbing to chapter one is looking at
# their own finished book, and a dashed line saying "they marry in chapter nine"
# is more use to them than an absence -- which the graph route's docstring has
# claimed since it was written and could not do, because the check above ran
# first. What must NOT change is the default: a brief that carried a fact which
# is not true yet would break the one guarantee anchors exist to give.

def test_looking_ahead_is_off_unless_asked_for():
    # The default Lens is what the resolver and the brief use.
    assert Lens().show_future is False
    assert Lens.for_pov("c-aaa").show_future is False


def test_a_caller_that_asks_can_see_what_is_coming():
    assert record_visibility(_tie(at="c-ccc"), INDEX,
                             Lens(at="c-aaa", show_future=True,
                                  hide_spoilers=False)) == VISIBLE


def test_looking_ahead_does_not_switch_off_the_spoiler_rule():
    # The half that keeps it honest. A future connection nothing has
    # foreshadowed is still a spoiler, and a reader at chapter one has not been
    # told these two will marry.
    assert record_visibility(_tie(at="c-ccc"), INDEX,
                             Lens(at="c-aaa", show_future=True)) == HIDDEN_SPOILER
    # Foreshadowed, so it is not a spoiler and may be drawn as coming.
    told_early = _tie(at="c-ccc", revealed_at="c-aaa")
    assert record_visibility(told_early, INDEX,
                             Lens(at="c-aaa", show_future=True)) == VISIBLE


def test_looking_ahead_does_not_reach_an_unintroduced_thread():
    # thread_visibility is a separate rule and takes no notice of the flag.
    # Otherwise the map would announce a character who has not appeared.
    thread = {"run": [{"at": "c-ccc"}]}
    assert thread_visibility(thread, INDEX,
                             Lens(at="c-aaa", show_future=True,
                                  hide_spoilers=False)) == HIDDEN_FUTURE


def test_a_secret_is_withheld_until_the_reader_learns_it():
    tie = _tie(at="c-aaa", revealed_at="c-ccc")
    assert record_visibility(tie, INDEX, Lens(at="c-bbb")) == HIDDEN_SPOILER
    assert record_visibility(tie, INDEX, Lens(at="c-ccc")) == VISIBLE


def test_an_unresolvable_reveal_point_hides_rather_than_shows():
    # We do not know when the reader finds out. A leak cannot be taken back,
    # so unknown means hidden.
    tie = _tie(at="c-aaa", revealed_at="c-DELETED")
    assert record_visibility(tie, INDEX, Lens(at="c-ccc")) == HIDDEN_SPOILER


def test_author_only_is_unreachable_however_you_look():
    tie = _tie(at="c-aaa", ai_scope=AI_SCOPE_NEVER)
    for hide in (True, False):
        for on_request in (True, False):
            lens = Lens(at=None, hide_spoilers=hide, include_on_request=on_request)
            assert record_visibility(tie, INDEX, lens) == HIDDEN_SCOPE


def test_on_request_is_withheld_until_asked_for():
    tie = _tie(at="c-aaa", ai_scope=AI_SCOPE_ON_REQUEST)
    assert record_visibility(tie, INDEX, Lens(at=None)) == HIDDEN_SCOPE
    assert record_visibility(tie, INDEX, Lens(at=None, include_on_request=True)) == VISIBLE


# ── Threads: introduction is derived, and unknown means SHOW ─────────────────

def _thread(**kw):
    return {"entity_id": "e-a", "name": "A", "ai_scope": "always",
            "run": [], "ties": [], **kw}


def test_a_thread_with_nothing_anchored_is_always_present():
    # The deliberate asymmetry: unknown REVEAL hides (a leak is
    # unrecoverable), unknown INTRODUCTION shows (this is the writer's own
    # map, and hiding undated entries would make it useless).
    assert thread_visibility(_thread(), INDEX, Lens(at="c-aaa")) == VISIBLE


def test_a_thread_first_anchored_later_has_not_been_introduced_yet():
    thread = _thread(run=[normalize_fact({"at": "c-ccc", "axis": "x", "value": "y"})])
    assert thread_visibility(thread, INDEX, Lens(at="c-aaa")) == HIDDEN_FUTURE
    assert thread_visibility(thread, INDEX, Lens(at="c-ccc")) == VISIBLE


def test_an_author_only_thread_is_never_shown():
    assert thread_visibility(_thread(ai_scope=AI_SCOPE_NEVER), INDEX,
                             Lens(at=None)) == HIDDEN_SCOPE


def test_introduction_uses_the_earliest_anchor_of_anything_about_it():
    thread = _thread(
        run=[normalize_fact({"at": "c-ccc", "axis": "x", "value": "y"})],
        ties=[_tie(at="c-aaa")],
    )
    assert thread_visibility(thread, INDEX, Lens(at="c-bbb")) == VISIBLE


# ── A connection is only as visible as the least visible thing it touches ────

def test_a_public_connection_between_two_present_threads_is_drawn():
    tie = _tie(at="c-aaa")
    source = _thread(ties=[tie])
    target = _thread(entity_id="e-b")
    assert connection_visibility(tie, source, target, INDEX, Lens(at="c-ccc")) == VISIBLE


def test_a_secret_connection_is_not_drawn():
    # The original bug: hiding the secret FACT while drawing a labelled edge
    # that announces it leaks exactly what spoiler mode protects.
    tie = _tie(at="c-aaa", revealed_at="c-ccc")
    source, target = _thread(ties=[tie]), _thread(entity_id="e-b")
    assert connection_visibility(tie, source, target, INDEX,
                                 Lens(at="c-bbb")) == HIDDEN_SPOILER


def test_a_public_connection_to_an_author_only_thread_is_not_drawn():
    # The generalisation. Judging the Tie alone would happily draw an edge to
    # a character the reader is never meant to meet.
    tie = _tie(at="c-aaa")
    source = _thread(ties=[tie])
    secret_target = _thread(entity_id="e-b", ai_scope=AI_SCOPE_NEVER)
    assert connection_visibility(tie, source, secret_target, INDEX,
                                 Lens(at="c-ccc")) == HIDDEN_SCOPE


def test_a_public_connection_to_a_character_not_yet_introduced_is_not_drawn():
    # Even a perfectly public marriage tells the reader that a character
    # called Garrick is coming.
    tie = _tie(at="c-aaa")
    source = _thread(ties=[tie])
    later = _thread(entity_id="e-b",
                    run=[normalize_fact({"at": "c-ccc", "axis": "x", "value": "y"})])
    assert connection_visibility(tie, source, later, INDEX,
                                 Lens(at="c-aaa")) == HIDDEN_FUTURE


def test_the_source_end_is_checked_too():
    tie = _tie(at="c-aaa")
    hidden_source = _thread(ai_scope=AI_SCOPE_NEVER, ties=[tie])
    target = _thread(entity_id="e-b")
    assert connection_visibility(tie, hidden_source, target, INDEX,
                                 Lens(at=None)) == HIDDEN_SCOPE
