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

from app.codex.anchors import ALWAYS, AnchorIndex
from app.codex.normalize import (
    AI_SCOPE_ALWAYS,
    AI_SCOPE_NEVER,
    AI_SCOPE_ON_REQUEST,
    TRAIT_WINDOW_MARK,
    TRUTH,
    normalize_fact,
    normalize_trait_window,
    trait_is_true_at,
)

__all__ = [
    "TRUTH", "AI_SCOPE_ALWAYS", "AI_SCOPE_NEVER", "AI_SCOPE_ON_REQUEST",
    "Ambiguity", "Resolution", "frames_for", "resolve_facts", "resolve_thread",
    "window_label",
]


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


# A position below every real one, for something that has always been true.
#
# THE ONE PLACE FACTS AND CONNECTIONS DIFFER, and the asymmetry is real rather
# than convenient:
#
#   A fact records a CHANGE -- "she learned her father is alive". A change with
#   no point in the story is meaningless, so an undated fact is `unplaced` and
#   never takes effect. That is the Unplaced stop, and it is correct.
#
#   A connection records that two things RELATE. "Lara is Lord Benjamin's
#   daughter" is simply true, for the whole book, and asking a writer to date it
#   would be asking them to date the premise. So an undated connection is in
#   force from before the first page -- and any dated state on the same pair
#   still supersedes it from its own anchor onward, which is how
#   "acquaintances, then friends at chapter 4" works.
#
# It is also every connection that already exists. Treating them as unplaced
# would empty the map of every project made before states existed.
# Imported rather than redefined -- see anchors.ALWAYS. Two definitions of
# where the book begins is two answers to whether a fact is in force.
_ALWAYS = ALWAYS


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
    undated_is_always: bool = False,
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

    `undated_is_always` is for CONNECTIONS, which resolve through this same
    function with the other end as their axis. It says an undated record has
    always been true instead of being unplaced -- see _ALWAYS for why the two
    kinds of record honestly want different answers. Facts leave it off.
    """
    frames = frames or {TRUTH}
    now = index.ordinal(at) if at else None
    result = Resolution()

    # ── Gather candidates ────────────────────────────────────────────────
    # Normalized here as well as at parse time, because resolve_facts is also
    # called with hand-built dicts (tests, AI proposals, the walkthrough).
    # ONE definition of what an unwritten switch means, applied wherever
    # facts enter -- see codex/normalize.py for the bug that caused.
    facts = [normalize_fact(f) for f in facts]

    candidates: list[tuple[tuple[int, int], dict, str]] = []
    for fact in facts:
        frame = fact["frame"]
        if frame not in frames:
            continue
        if not _scope_allowed(fact["ai_scope"], include_on_request):
            result.withheld_by_scope += 1
            continue

        ordinal = index.ordinal(fact.get("at"))
        if ordinal is None:
            if undated_is_always and not fact.get("at"):
                # A connection nobody dated. True for the whole book -- and a
                # dated state on the same pair still wins from its own anchor.
                ordinal = _ALWAYS
            else:
                # No position we can trust. Report it rather than assuming it
                # happened at the start (which would make it true everywhere).
                # Note this also catches an anchor that was WRITTEN and no
                # longer resolves -- a deleted chapter -- which is a real
                # problem even for a connection.
                result.unplaced.append(fact)
                continue
        if now is not None and ordinal > now:
            continue        # has not happened yet at the point being written

        if hide_spoilers:
            revealed = fact.get("revealed_at") or fact.get("at")
            revealed_ordinal = index.ordinal(revealed)
            if revealed_ordinal is None and undated_is_always and not revealed:
                # An always-true connection with no stated reveal point is not a
                # secret. Counting it as one would hide every ordinary
                # connection in the book from every brief.
                revealed_ordinal = _ALWAYS
            if revealed_ordinal is None or (now is not None and revealed_ordinal > now):
                result.withheld_spoilers += 1
                continue

        candidates.append((ordinal, fact, frame))

    # ── Latest per (axis, frame), with rule 4 for ties ───────────────────
    grouped: dict[tuple[str, str], list[tuple[tuple[int, int], dict]]] = {}
    for ordinal, fact, frame in candidates:
        key = (str(fact.get("axis", "")), frame)
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
    plus what was withheld.

    THE SECTIONS USED TO PASS THROUGH UNTOUCHED, and this docstring used to
    explain why: they were "the writer's own prose about someone, not
    time-varying claims". That was true of prose and never true of traits, and
    the writer's own book is the counter-example -- Serena is scrawny before
    her transformation and built like an athlete after it, and both of those
    are trait blocks in the same section of the same profile.

    So a trait may now carry `true_in`, and one that names chapters is dropped
    where it does not hold. Prose sections still pass through: a paragraph has
    no place to hang a window off, and inventing one would mean guessing which
    sentence stopped being true.
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
    resolved["sections"], dropped = _sections_in_force(
        thread.get("sections") or {}, index, at)
    resolved["withheld_traits"] = dropped
    return resolved


def _sections_in_force(sections: dict, index: AnchorIndex,
                       at: str | None) -> tuple[dict, int]:
    """
    The sections, with out-of-window traits removed -- and counted.

    Two jobs, decided by whether there is a point in the story to stand at:

      AT AN ANCHOR, a trait that names chapters and does not name this one is
      dropped, and the number dropped comes back so the brief can say so. A
      shorter answer with no explanation is indistinguishable from a thinner
      character, which is the rule this app applies to every other omission.

      WITH NO ANCHOR -- the whole-book view, and every path that has no
      "where" to work from -- nothing is dropped, because the question has no
      answer here. Instead each windowed trait is LABELLED, so a reader (human
      or model) getting both of Serena's builds at once is told that neither is
      the whole book rather than being left to reconcile them.

    Copied rather than edited in place: the caller handed us their Thread and
    is entitled to get it back with its own traits still in it.
    """
    out: dict = {}
    dropped = 0
    for section_id, section in sections.items():
        # A section that is not a mapping is a hand-edited file, an older
        # shape, or a test fixture taking a shortcut. Whatever it is, it has no
        # traits to window and this module must never be the thing that takes a
        # writer's entry down -- it is on the read path for every AI request.
        if not isinstance(section, dict):
            out[section_id] = section
            continue
        blocks = section.get("trait_blocks") or []
        if not blocks:
            out[section_id] = section
            continue

        kept: list[dict] = []
        for block in blocks:
            window = normalize_trait_window(block.get("true_in"))
            if window is None:
                kept.append(block)
                continue
            if not window:
                # SWITCHED OFF EVERYWHERE. Dropped whether or not there is a
                # point in the story to stand at, because "true nowhere" has
                # the same answer everywhere. Spending tokens to tell a model
                # about a trait and then to disregard it is worse than silence,
                # and it is still counted, so the brief can say it happened.
                dropped += 1
                continue
            if at:
                if trait_is_true_at(block, at):
                    kept.append(block)
                else:
                    dropped += 1
                continue
            labelled = dict(block)
            labelled["window_label"] = window_label(window, index)
            kept.append(labelled)

        copy = dict(section)
        copy["trait_blocks"] = kept
        out[section_id] = copy
    return out, dropped


def window_label(window: list[str], index: AnchorIndex) -> str:
    """
    A trait's window as a writer would say it: "chapter 1", "chapters 2-9".

    Chapter NUMBERS rather than titles, because the number is what the index
    already knows and a title is a second lookup that can disagree with it. A
    run of consecutive chapters collapses into a range, since "chapters 2-9" is
    one fact and "chapters 2, 3, 4, 5, 6, 7, 8, 9" is eight things to read.

    An anchor that no longer resolves -- its chapter deleted, the commonest way
    this goes stale -- is left out of the label rather than guessed at. If none
    of them resolve the trait still says it is limited, because the limit is
    real even when we can no longer name where.
    """
    numbers = sorted({
        ordinal[0] + 1
        for ordinal in (index.ordinal(anchor) for anchor in window)
        if ordinal is not None
    })
    mark = TRAIT_WINDOW_MARK.lower()
    if not numbers:
        return f"{mark} some chapters"

    runs: list[tuple[int, int]] = []
    for number in numbers:
        if runs and number == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], number)
        else:
            runs.append((number, number))

    parts = [str(lo) if lo == hi else f"{lo}-{hi}" for lo, hi in runs]
    word = "chapter" if len(numbers) == 1 else "chapters"
    return f"{mark} {word} {', '.join(parts)}"
