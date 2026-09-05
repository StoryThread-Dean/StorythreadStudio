"""
A connection that changes across the book.

The hole this fills, found by testing three ordinary scenarios against what was
built:

    1. Chapter 2 Alexandra meets Dean through Lara -- acquaintances.
       Chapter 4 they are friends. Chapter 8 she saves his life.
    2. Chapter 1 Lara is Lord Benjamin's daughter. Never changes.
    3. Chapter 7 Alexandra is disgusted by Oliver. Chapter 8 they work
       together. Chapter 11 they are lovers.

Only the second one worked. Facts already superseded each other automatically --
the latest one on an `(axis, frame)` pair wins and the writer closes nothing by
hand -- but connections had only a validity window, `at` and `until`, with no
axis to group successive states of one relationship. Recording example 1 meant
going back to close the previous connection every time, and forgetting once made
the brief report Alexandra as Dean's acquaintance AND friend AND close friend at
the same time.

THE FIX IS A SENTENCE: the pair IS the axis.

`(Alexandra, Dean)` is the axis and its states are a run on it, so everything
the fact engine already does works with no second rule invented:

    read at chapter 3    acquaintances, met through Lara
    read at chapter 5    friends -- the chapter 2 state superseded, nothing
                         closed by hand
    read at chapter 9    real friends since she saved his life
    two states at one
    anchor, unordered    a Snag, reported, never a silent guess

`frame` comes along free, which is what makes example 3's harder cousin
expressible: Alexandra thinks they are friends while Dean is using her -- two
states on the same pair, both in force, no contradiction. So does `revealed_at`,
so a secret marriage does not leak through a labelled edge.

Storage stays FLAT. Each state is an ordinary entry under `ties:` and three
states on one pair are three entries, resolved by anchor:

    ties:
      - rel: connected_to
        target: e-dean
        reason: "Met through Lara"
        at: c-two
      - rel: friend_of
        target: e-dean
        reason: "Friends now, and she trusts him with the shop keys"
        at: c-four

Nested runs would read worse in a file the writer hand-edits, and every existing
parser, index and screen keeps working unchanged.

`until` survives, for the one case supersession cannot express: a connection that
ENDED with nothing replacing it. They stopped being friends and became nothing is
a different statement from they became enemies. Replacement is derived; ending is
declared.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.codex.anchors import AnchorIndex
from app.codex.normalize import normalize_tie
from app.codex.resolve import Ambiguity, resolve_facts

__all__ = ["TieState", "TieResolution", "resolve_ties", "tie_axis"]


def tie_axis(target: str) -> str:
    """
    The axis a connection's states share: the other end.

    Prefixed so it can never collide with a writer's own fact axis. Somebody
    tracking `belief.father` should not be able to accidentally name the axis
    that carries their connection to a character.
    """
    return f"tie:{target}"


@dataclass
class TieState:
    """One state of one connection, as it stands at some point in the story."""

    target: str
    rel: str
    reason: str
    reason_inverse: str = ""
    frame: str = "truth"
    at: str | None = None
    until: str | None = None
    revealed_at: str | None = None
    ai_scope: str = "always"
    # True when an earlier state on this pair was replaced by this one. Shown so
    # a writer can see that "friends" REPLACED "acquaintances" rather than
    # wondering why the earlier one vanished.
    supersedes_earlier: bool = False
    # The normalized tie this state came from, carried through so a caller can
    # get back to the whole record rather than only the fields a state has room
    # for. `check_ties` needs it: it reports on the writer's own connections and
    # reads keys (`intentional`, `rel_inverse`) that mean nothing to resolution.
    # Kept out of the equality-relevant fields above by being last and defaulted.
    record: dict = field(default_factory=dict)

    @property
    def always(self) -> bool:
        """Nobody dated it, so it is simply true of the whole book."""
        return not self.at


@dataclass
class TieResolution:
    """Which connections are in force, and what could not be decided."""

    states: list[TieState] = field(default_factory=list)
    ambiguities: list[Ambiguity] = field(default_factory=list)
    # Superseded states, kept so the walk can show a connection's history rather
    # than only its present.
    history: list[TieState] = field(default_factory=list)
    withheld_spoilers: int = 0
    withheld_by_scope: int = 0
    # A connection whose anchor was WRITTEN and no longer resolves -- a deleted
    # chapter. Distinct from an undated one, which is fine.
    unplaced: list[TieState] = field(default_factory=list)
    # The states behind `ambiguities`, as states rather than as ids.
    #
    # None of these is in force -- two claims on one pair at one anchor with
    # nothing to order them are not silently ordered, which is the right answer
    # for a brief and for a map. But a CONTRADICTION check wants them: two
    # mutually exclusive connections asserted at the same moment is precisely
    # when they clash. Offered here so `check_ties` does not have to know that
    # tie ids are `tie-<position>` to find them again.
    ambiguous: list[TieState] = field(default_factory=list)

    def for_target(self, target: str) -> TieState | None:
        for state in self.states:
            if state.target == target:
                return state
        return None


def _as_fact(tie: dict, position: int) -> dict:
    """
    One connection state, shaped as a fact so it resolves by the same rule.

    This mapping is the whole trick. Nothing about supersession, framing,
    spoilers or ambiguity is reimplemented here -- the pair becomes the axis and
    `resolve_facts` does the rest, which is what stops connections and facts from
    drifting into two subtly different notions of "what is true now".
    """
    clean = normalize_tie(tie)
    return {
        # A stable identity for the ambiguity report. Ties carry no id of their
        # own in Markdown, so position stands in -- unique within one Thread,
        # which is the only scope that matters here.
        "id": clean.get("id") or f"tie-{position}",
        "axis": tie_axis(str(clean.get("target") or "")),
        "value": clean.get("reason") or "",
        "frame": clean.get("frame") or "truth",
        "at": clean.get("at"),
        "revealed_at": clean.get("revealed_at"),
        "ai_scope": clean.get("ai_scope") or "always",
        "supersedes": clean.get("supersedes"),
        # Carried through untouched so the state can be rebuilt with everything
        # a fact has no room for -- the relation, the other end's wording, until.
        "_tie": clean,
    }


def _as_state(fact: dict, superseded: bool = False) -> TieState:
    tie = fact.get("_tie") or {}
    return TieState(
        target=str(tie.get("target") or ""),
        rel=str(tie.get("rel") or ""),
        reason=str(tie.get("reason") or ""),
        reason_inverse=str(tie.get("reason_inverse") or ""),
        frame=str(tie.get("frame") or "truth"),
        at=tie.get("at"),
        until=tie.get("until"),
        revealed_at=tie.get("revealed_at"),
        ai_scope=str(tie.get("ai_scope") or "always"),
        supersedes_earlier=superseded,
        record=dict(tie),
    )


def resolve_ties(
    ties: list[dict],
    index: AnchorIndex,
    at: str | None = None,
    frames: set[str] | None = None,
    hide_spoilers: bool = True,
    include_on_request: bool = False,
) -> TieResolution:
    """
    How these connections stand at `at`.

    `ties` are raw records off one Thread. `at` is the point being written; None
    means the end of the book, which is how a writer looking at the finished
    story sees it.

    One state per (other end, frame) comes back. Everything replaced goes to
    `history` rather than being dropped, because "friends, and before that
    acquaintances" is worth being able to show -- and a connection that quietly
    lost its earlier states would look like the app forgot them.
    """
    if not ties:
        return TieResolution()

    as_facts = [_as_fact(tie, i) for i, tie in enumerate(ties)]

    resolution = resolve_facts(
        as_facts, index, at, frames=frames, hide_spoilers=hide_spoilers,
        include_on_request=include_on_request,
        # The one difference between a fact and a connection -- an undated
        # connection is true of the whole book rather than unplaced. See the
        # comment on _ALWAYS in resolve.py.
        undated_is_always=True,
    )

    effective_ids = {f.get("id") for f in resolution.facts}
    out = TieResolution(
        ambiguities=resolution.ambiguities,
        withheld_spoilers=resolution.withheld_spoilers,
        withheld_by_scope=resolution.withheld_by_scope,
        unplaced=[_as_state(f) for f in resolution.unplaced],
    )

    # Which effective states replaced something. An axis with more than one
    # candidate in scope means the survivor won by being later.
    per_axis: dict[tuple[str, str], int] = {}
    for fact in as_facts:
        key = (fact["axis"], fact["frame"])
        per_axis[key] = per_axis.get(key, 0) + 1

    for fact in resolution.facts:
        replaced = per_axis.get((fact["axis"], fact["frame"]), 1) > 1
        out.states.append(_as_state(fact, superseded=replaced))

    # Anything in scope that did not survive is history rather than gone. An
    # unplaced or withheld record is NOT history -- it never took effect at all,
    # and calling it history would say the story moved past something it never
    # established.
    unplaced_ids = {f.get("id") for f in resolution.unplaced}
    for fact in as_facts:
        if fact["id"] in effective_ids or fact["id"] in unplaced_ids:
            continue
        state = _as_state(fact)
        # Only states of a pair that IS in force -- a connection withheld as a
        # spoiler must not leak its earlier wording through the history list.
        if out.for_target(state.target) is not None:
            out.history.append(state)

    ambiguous_ids = {fid for amb in resolution.ambiguities
                     for fid in amb.fact_ids}
    out.ambiguous = [_as_state(f) for f in as_facts
                     if f["id"] in ambiguous_ids]

    out.states.sort(key=lambda s: (s.target, s.frame))
    return out
