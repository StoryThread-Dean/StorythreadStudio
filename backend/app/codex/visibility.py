# codex/visibility.py -- what may be shown, and what may be told
# ===============================================================
# Three switches decide whether something can be seen: whose truth it is,
# when the reader learns it, and whether AI may see it at all. Those rules
# were being applied in two places -- resolve.py for facts, the graph route
# for edges -- and the two disagreed, which is how a secret connection came
# to be drawn on a map that was correctly hiding the secret fact behind it.
#
# So the rules live here, once, and both callers use them.
#
# ---------------------------------------------------------------------------
# A CONNECTION IS ONLY AS VISIBLE AS THE LEAST VISIBLE THING IT TOUCHES
# ---------------------------------------------------------------------------
# An edge is not an independent object. Drawing "Elara --married_to--> Garrick"
# reveals three things at once: that Elara exists, that Garrick exists, and
# that they are married. Judging only the middle one leaks the other two.
#
# Concretely, all of these must hide the edge:
#   - the marriage is a secret the reader learns in chapter 20
#   - Garrick is an author-only entry the reader never meets
#   - Garrick has not been introduced yet at the point being written
#
# The third is the one that is easy to miss: a perfectly public connection to
# a character who does not appear until chapter 30 still tells the reader
# that a character called Garrick is coming.
#
# ---------------------------------------------------------------------------
# THE ASYMMETRY, WHICH IS DELIBERATE
# ---------------------------------------------------------------------------
# Two kinds of "we do not know" resolve in OPPOSITE directions:
#
#   unknown REVEAL point   -> HIDE. A leaked reveal cannot be un-leaked.
#   unknown INTRODUCTION   -> SHOW. This is the writer's own map of their own
#                             world; hiding entries they never dated would
#                             make it useless for the ordinary case where
#                             nothing has been anchored yet.
#
# Both defaults protect the writer. They just protect them from different
# things: one from spoiling their book, the other from an empty screen.

from dataclasses import dataclass

from app.codex.anchors import AnchorIndex
from app.codex.normalize import AI_SCOPE_NEVER, AI_SCOPE_ON_REQUEST, TRUTH


@dataclass(frozen=True)
class Lens:
    """How someone is looking at the world right now."""
    at: str | None = None                 # None = the end of the book
    frames: frozenset[str] = frozenset({TRUTH})
    hide_spoilers: bool = True
    include_on_request: bool = False
    # R8.6b. Let a record that is not true YET through, so the caller can draw
    # it as coming rather than pretend it does not exist.
    #
    # OFF EVERYWHERE EXCEPT THE MAP, and that is the whole point of it being a
    # flag rather than a change to the rule. The resolver and the brief must
    # never treat a future fact as in force -- that is the single thing anchors
    # exist to prevent. The map is different: the writer is looking at their own
    # finished book through a scrubber, and a dashed line saying "they marry in
    # chapter nine" is more use to them than an absence.
    #
    # It skips the not-yet check ONLY. The spoiler check still runs, which is
    # what keeps this honest: a future connection the reader has not been
    # foreshadowed is still withheld outright, and one the reader HAS been told
    # about is drawn as coming. That is what the graph route always claimed to
    # do and could not, because this check ran first and hid it.
    show_future: bool = False

    @staticmethod
    def for_pov(at: str | None, pov: str | None = None, **kw) -> "Lens":
        frames = frozenset({TRUTH, pov} if pov else {TRUTH})
        return Lens(at=at, frames=frames, **kw)


# Why something was withheld. Returned rather than logged so a brief can say
# "3 things held back" instead of quietly presenting part as the whole.
VISIBLE = ""
HIDDEN_SCOPE = "ai_scope"
HIDDEN_SPOILER = "spoiler"
HIDDEN_FRAME = "frame"
HIDDEN_FUTURE = "not_yet"
HIDDEN_UNPLACED = "unplaced"


def scope_allows(scope: str, include_on_request: bool) -> bool:
    if scope == AI_SCOPE_NEVER:
        return False                      # no path reaches these, ever
    if scope == AI_SCOPE_ON_REQUEST:
        return include_on_request
    return True


def reveal_ordinal(index: AnchorIndex, record: dict):
    """
    When the reader learns of this, as a position.

    Falls back to where it HAPPENS when no reveal point is written -- the
    ordinary case, where a thing becomes known as it occurs. Returns None
    when neither resolves, which callers must treat as "unknown" and
    therefore hidden.
    """
    anchor = record.get("revealed_at") or record.get("at")
    if not anchor:
        # Nothing anchored at all: it is background, true from the start,
        # and there is nothing to spoil.
        return "always"
    return index.ordinal(anchor)


def record_visibility(record: dict, index: AnchorIndex, lens: Lens) -> str:
    """
    VISIBLE, or the reason this fact/tie is withheld.

    Shared by facts and Ties because they carry the same three switches and
    must answer the same way -- the divergence between them is exactly the
    bug this module was written to close.
    """
    if not scope_allows(record.get("ai_scope", ""), lens.include_on_request):
        return HIDDEN_SCOPE
    if record.get("frame", TRUTH) not in lens.frames:
        return HIDDEN_FRAME

    now = index.ordinal(lens.at) if lens.at else None

    started = index.ordinal(record["at"]) if record.get("at") else None
    if record.get("at") and started is None:
        return HIDDEN_UNPLACED           # anchored somewhere that no longer exists
    if (not lens.show_future
            and now is not None and started is not None and started > now):
        return HIDDEN_FUTURE

    if lens.hide_spoilers and now is not None:
        revealed = reveal_ordinal(index, record)
        if revealed is None:
            # We do not know when the reader finds out. Hiding is the only
            # safe answer: a leak cannot be taken back.
            return HIDDEN_SPOILER
        if revealed != "always" and revealed > now:
            return HIDDEN_SPOILER

    return VISIBLE


def thread_visibility(thread: dict, index: AnchorIndex, lens: Lens) -> str:
    """
    VISIBLE, or the reason a whole Thread is withheld.

    A Thread has no anchor of its own, so INTRODUCTION is derived: the
    earliest point anything about it is anchored. A Thread with nothing
    anchored is treated as always present -- see the asymmetry note at the
    top. Being unhelpful is a bug; leaking is a disaster, and an
    un-introduced entry is not a leak of anything the writer did not write.
    """
    if not scope_allows(thread.get("ai_scope", ""), lens.include_on_request):
        return HIDDEN_SCOPE

    now = index.ordinal(lens.at) if lens.at else None
    if now is None:
        return VISIBLE

    anchors = [f["at"] for f in (thread.get("run") or []) if f.get("at")]
    anchors += [t["at"] for t in (thread.get("ties") or []) if t.get("at")]
    ordinals = [o for o in (index.ordinal(a) for a in anchors) if o is not None]
    if not ordinals:
        return VISIBLE                   # nothing dated: assume it is around

    if min(ordinals) > now:
        return HIDDEN_FUTURE
    return VISIBLE


def connection_visibility(
    tie: dict,
    source: dict,
    target: dict,
    index: AnchorIndex,
    lens: Lens,
) -> str:
    """
    Whether an EDGE may be drawn, judging the whole connection at once.

    This is the fix for the secret-Tie leak, generalised. An edge asserts
    three things -- that both endpoints exist and that they are related -- so
    the least visible of the three governs. Checking the Tie alone would
    happily draw a public marriage to a character the reader has never met.

    Endpoints are judged WITHOUT their own spoiler rules relaxed: a target
    the reader has not met yet hides the edge even when the connection
    itself is public knowledge.
    """
    for record, verdict in (
        (source, thread_visibility(source, index, lens)),
        (target, thread_visibility(target, index, lens)),
    ):
        if verdict != VISIBLE:
            return verdict

    return record_visibility(tie, index, lens)
