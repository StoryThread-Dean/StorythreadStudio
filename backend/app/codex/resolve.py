# codex/resolve.py -- who a Thread IS at a point in the story
# ============================================================
# The reason this whole program exists. A profile today describes one
# unchanging person from page one to the last page, which is wrong: a
# heroine who spends fourteen chapters believing her father died in a raid
# is a different person in chapter fifteen, and everything she thinks and
# does after the reveal should follow from the new fact.
#
# So a Thread is not a description. It is a base plus a RUN: a list of facts,
# each anchored to a point in the story. Resolving the Thread at an anchor
# means working out which of those facts are in force there.
#
# ---------------------------------------------------------------------------
# THE TEMPORAL RULES, stated once so nothing has to infer them
# ---------------------------------------------------------------------------
# 1. A fact takes effect at its anchor and remains effective INDEFINITELY.
# 2. It stops being effective only when a later fact on the same
#    (axis, frame) pair supersedes it.
# 3. The effective set at anchor X is, for each (axis, frame), the fact with
#    the greatest anchor <= X that nothing else supersedes.
# 4. Two facts sharing (axis, frame, anchor) with no ordering between them
#    are AMBIGUOUS. They are not silently ordered and neither takes effect;
#    both are reported as a structural Snag for the writer to resolve.
# 5. `supersedes` is authoritative when written. When absent it is DERIVED:
#    a later fact on the same (axis, frame) supersedes the earlier one, which
#    is just rule 3 restated. The derivation is deterministic, so the index
#    adds no information the Markdown does not already determine -- which is
#    what keeps Markdown the source of truth.
#
# ---------------------------------------------------------------------------
# THE THREE SWITCHES
# ---------------------------------------------------------------------------
# Every fact carries three, and they answer different questions:
#
#   frame        WHOSE truth is this? "truth" for objective fact, or an
#                entity_id for something a particular character believes.
#                Stored as an ID, never a name, so renaming a character
#                cannot invalidate the epistemic state of the book.
#   revealed_at  when does the READER learn it? Anything revealed later than
#                the point being written is a spoiler and is withheld.
#   ai_scope     may AI see it at all? never / on-request / always.
#
# Together they cover author-only secrets, hidden motives, misinformation,
# unreliable narration and layered-world premises with one mechanism.

from dataclasses import dataclass, field
from typing import Any

from app.codex.anchors import AnchorIndex

TRUTH = "truth"

AI_SCOPE_NEVER = "never"
AI_SCOPE_ON_REQUEST = "on-request"
AI_SCOPE_ALWAYS = "always"


@dataclass
class Ambiguity:
    """Two or more facts claiming the same axis at the same point, with no
    ordering between them. Surfaced to the writer as a structural Snag."""
    axis: str
    frame: str
    anchor: str
    fact_ids: list[str]

    def describe(self) -> str:
        return (
            f"{len(self.fact_ids)} facts set '{self.axis}' at the same point "
            f"({self.anchor}) with nothing to say which came last."
        )


@dataclass
class Resolution:
    """What is true, and what could not be decided."""
    facts: list[dict] = field(default_factory=list)
    ambiguities: list[Ambiguity] = field(default_factory=list)
    # Facts withheld and why -- so a brief can report what it is not saying
    # rather than silently presenting a partial picture as the whole one.
    withheld_spoilers: int = 0
    withheld_by_scope: int = 0
    unplaced: list[dict] = field(default_factory=list)

    def by_axis(self) -> dict[tuple[str, str], dict]:
        return {(f["axis"], f["frame"]): f for f in self.facts}


def frames_for(pov: str | None = None) -> set[str]:
    """
    Which viewpoints to draw on.

    Objective truth always, plus one character's beliefs when writing from
    inside their head. Drafting a scene from Elara's POV should reach her
    understanding of her father, not the author's.
    """
    return {TRUTH, pov} if pov else {TRUTH}


def _scope_allowed(scope: str, include_on_request: bool) -> bool:
    if scope == AI_SCOPE_NEVER:
        return False        # no path reaches these, ever
    if scope == AI_SCOPE_ON_REQUEST:
        return include_on_request
    return True


def _supersedes_within(group: list[dict]) -> dict | None:
    """
    Of several facts at the same point, which one stands?

    Exactly one must be superseded by nothing else in the group. Anything
    else -- a tie, or a cycle -- is ambiguous, and rule 4 says do not guess.
    """
    ids = {f.get("id") for f in group if f.get("id")}
    superseded = {
        f.get("supersedes") for f in group
        if f.get("supersedes") and f.get("supersedes") in ids
    }
    survivors = [f for f in group if f.get("id") not in superseded]
    return survivors[0] if len(survivors) == 1 else None


def resolve_facts(
    facts: list[dict],
    index: AnchorIndex,
    at: str | None,
    frames: set[str] | None = None,
    hide_spoilers: bool = True,
    include_on_request: bool = False,
) -> Resolution:
    """
    Which facts are in force at `at`?

    `facts` are raw records off a Thread's Run. `at` is the anchor being
    written; None means "the end of the book", which is how a writer looking
    at the whole finished story sees it.

    Everything about what is NOT returned is deliberate:
      - a fact whose anchor does not resolve is `unplaced`, never guessed
        into a position it may not belong;
      - a spoiler is counted, so a brief can say it is holding something back
        rather than presenting a partial picture as complete;
      - ai_scope "never" is unreachable through this function by any
        combination of arguments. That is the point of it.
    """
    frames = frames or {TRUTH}
    now = index.ordinal(at) if at else None
    result = Resolution()

    # ── Gather candidates ────────────────────────────────────────────────
    candidates: list[tuple[tuple[int, int], dict]] = []
    for fact in facts:
        if fact.get("frame", TRUTH) not in frames:
            continue
        if not _scope_allowed(str(fact.get("ai_scope", AI_SCOPE_ALWAYS)), include_on_request):
            result.withheld_by_scope += 1
            continue

        ordinal = index.ordinal(fact.get("at"))
        if ordinal is None:
            # No position we can trust. Report it rather than assuming it
            # happened at the start (which would make it true everywhere).
            result.unplaced.append(fact)
            continue
        if now is not None and ordinal > now:
            continue        # has not happened yet at the point being written

        if hide_spoilers:
            revealed = fact.get("revealed_at") or fact.get("at")
            revealed_ordinal = index.ordinal(revealed)
            if revealed_ordinal is None or (now is not None and revealed_ordinal > now):
                result.withheld_spoilers += 1
                continue

        candidates.append((ordinal, fact))

    # ── Latest per (axis, frame), with rule 4 for ties ───────────────────
    grouped: dict[tuple[str, str], list[tuple[tuple[int, int], dict]]] = {}
    for ordinal, fact in candidates:
        key = (str(fact.get("axis", "")), str(fact.get("frame", TRUTH)))
        grouped.setdefault(key, []).append((ordinal, fact))

    for (axis, frame), entries in grouped.items():
        latest = max(o for o, _ in entries)
        at_latest = [f for o, f in entries if o == latest]

        if len(at_latest) == 1:
            result.facts.append(at_latest[0])
            continue

        winner = _supersedes_within(at_latest)
        if winner is not None:
            result.facts.append(winner)
            continue

        # Rule 4: do not order them silently. Neither takes effect, and the
        # writer is told -- a quietly-picked winner here would be a fact the
        # book never actually establishes.
        result.ambiguities.append(Ambiguity(
            axis=axis,
            frame=frame,
            anchor=str(at_latest[0].get("at", "")),
            fact_ids=[str(f.get("id", "")) for f in at_latest],
        ))

    result.facts.sort(key=lambda f: (str(f.get("axis", "")), str(f.get("frame", ""))))
    return result


def resolve_thread(
    thread: dict[str, Any],
    index: AnchorIndex,
    at: str | None,
    pov: str | None = None,
    hide_spoilers: bool = True,
    include_on_request: bool = False,
) -> dict[str, Any]:
    """
    A Thread as it stands at one point in the story.

    Returns the base record with its Run replaced by only the facts in force,
    plus what was withheld. The base sections (Overview, Physical Traits...)
    pass through unchanged: they are the writer's own prose about someone,
    not time-varying claims.
    """
    resolution = resolve_facts(
        thread.get("run") or [],
        index,
        at,
        frames=frames_for(pov),
        hide_spoilers=hide_spoilers,
        include_on_request=include_on_request,
    )
    resolved = dict(thread)
    resolved["run"] = resolution.facts
    resolved["as_of"] = at
    resolved["ambiguities"] = resolution.ambiguities
    resolved["withheld_spoilers"] = resolution.withheld_spoilers
    resolved["withheld_by_scope"] = resolution.withheld_by_scope
    resolved["unplaced"] = resolution.unplaced
    return resolved
