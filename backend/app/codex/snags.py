# codex/snags.py -- two facts that disagree
# ==========================================
# A SNAG is a contradiction in the world model. This module finds the ones
# that can be found WITHOUT asking a model anything: they are free, they are
# instant, they are the same answer every time, and they run before a single
# token is spent.
#
# WHY THE SPLIT IS HONEST AND NOT JUST TIDY
# -----------------------------------------
# "Does this chapter contradict the world?" is not one question. Half of it
# is arithmetic:
#
#     the same axis holds two different values at the same moment
#     a fact is told to the reader before the point it becomes true
#     a relation that permits one target has three
#     two facts claim the same point with nothing to order them
#     a name appears in chapter four for something the reader learns in twelve
#     a correction reaches the reader before the thing it corrects
#     a connection ends at or before it starts
#
# None of that needs interpretation. The other half -- does this passage ACT
# ON knowledge this character should not have? -- is interpretation, and it
# lives in the AI pass, with quoted evidence and the freedom to be wrong.
# Mixing the two would mean either paying for what arithmetic can answer, or
# claiming certainty about what is genuinely a reading.
#
# MARKED AS DELIBERATE
# --------------------
# Much good fiction contradicts itself on purpose: an unreliable narrator, a
# lie a character tells consistently, a myth two cultures tell differently.
# A fact carrying `intentional: true` is never raised again. A checker that
# cannot be told "yes, I meant that" becomes noise the writer stops reading,
# and a checker nobody reads catches nothing at all.

from dataclasses import dataclass, field

from app.codex.anchors import AnchorIndex
from app.codex.normalize import TRUTH, normalize_fact

__all__ = [
    "Snag", "SNAG_AXIS_CONFLICT", "SNAG_AMBIGUOUS_ORDER", "SNAG_BAD_SUPERSEDE",
    "SNAG_EARLY_MENTION", "SNAG_CARDINALITY", "SNAG_EXCLUSIVE", "SNAG_UNPLACED",
    "SNAG_IMPOSSIBLE_ORDER", "SNAG_REVEAL_ORDER",
    "check_facts", "check_ties", "group_tangles",
]

# Every structural kind, named once. The frontend Lexicon carries the writer-
# facing wording; these are the codes the two sides agree on.
SNAG_AXIS_CONFLICT = "axis_conflict"
SNAG_AMBIGUOUS_ORDER = "ambiguous_order"
SNAG_BAD_SUPERSEDE = "bad_supersede"
SNAG_EARLY_MENTION = "early_mention"
SNAG_CARDINALITY = "cardinality"
SNAG_EXCLUSIVE = "exclusive_group"
SNAG_UNPLACED = "unplaced"
# R8.4. The two checks the spec named and nothing implemented.
SNAG_IMPOSSIBLE_ORDER = "impossible_order"   # anchors that cannot be ordered
SNAG_REVEAL_ORDER = "reveal_order"           # the book spoils itself


@dataclass
class Snag:
    """
    One contradiction, with both sides of it.

    `sides` is what the walkthrough shows: each entry carries the fact or tie
    id, its anchor, and the value that disagrees. Showing one side and
    calling it wrong would be the app taking a position on the writer's book.
    """
    kind: str
    entity_id: str
    summary: str
    sides: list[dict] = field(default_factory=list)
    axis: str = ""
    anchor: str = ""

    def key(self) -> str:
        """Stable identity, so a Snag that survives a rescan is the same Snag
        and its 'not yet' is still remembered."""
        parts = [self.kind, self.entity_id, self.axis, self.anchor]
        parts += sorted(str(s.get("id", "")) for s in self.sides)
        return "|".join(parts)


def _anchor_label(anchor: str | None, label_for) -> str:
    """'Chapter 7, Scene 3' where we can, the raw anchor where we cannot."""
    if not anchor:
        return "somewhere unplaced"
    if label_for is None:
        return str(anchor)
    return label_for(str(anchor)) or str(anchor)


# ── Facts ────────────────────────────────────────────────────────────────────

def check_facts(
    entity_id: str,
    facts: list[dict],
    index: AnchorIndex,
    *,
    label_for=None,
) -> list[Snag]:
    """
    Every structural problem in one Thread's Run.

    Deliberately takes the RAW run rather than a resolution: resolve_facts
    hides spoilers and filters by scope, and a contradiction the writer needs
    to see must not depend on which lens happens to be applied. A secret that
    contradicts another secret is still a contradiction.
    """
    facts = [normalize_fact(f) for f in facts]
    snags: list[Snag] = []

    # ── Unplaced: a fact with nowhere in the story ───────────────────────
    # Not a contradiction as such, but the same shape of problem: it cannot
    # take effect anywhere, so it is invisible to everything downstream while
    # looking perfectly fine in the file.
    for fact in facts:
        if fact.get("intentional"):
            continue
        if index.ordinal(fact.get("at")) is None:
            snags.append(Snag(
                kind=SNAG_UNPLACED,
                entity_id=entity_id,
                axis=str(fact.get("axis", "")),
                anchor=str(fact.get("at") or ""),
                summary=(f"'{fact.get('axis', '')}' has no point in the story, "
                         f"so it never takes effect."),
                sides=[{"id": fact.get("id"), "at": fact.get("at"),
                        "value": fact.get("value")}],
            ))

    placed = [f for f in facts if index.ordinal(f.get("at")) is not None]
    by_id = {f.get("id"): f for f in placed if f.get("id")}

    # ── supersedes pointing at nothing usable ────────────────────────────
    for fact in placed:
        target_id = fact.get("supersedes")
        if not target_id or fact.get("intentional"):
            continue
        target = by_id.get(target_id)
        if target is None:
            snags.append(Snag(
                kind=SNAG_BAD_SUPERSEDE, entity_id=entity_id,
                axis=str(fact.get("axis", "")), anchor=str(fact.get("at") or ""),
                summary=(f"This replaces a fact ({target_id}) that is not in "
                         f"the Run any more."),
                sides=[{"id": fact.get("id"), "at": fact.get("at"),
                        "value": fact.get("value")}],
            ))
            continue
        # Replacing something that has not happened yet is backwards, and it
        # makes the effective set depend on which one you read first.
        if index.ordinal(target.get("at")) > index.ordinal(fact.get("at")):
            snags.append(Snag(
                kind=SNAG_BAD_SUPERSEDE, entity_id=entity_id,
                axis=str(fact.get("axis", "")), anchor=str(fact.get("at") or ""),
                summary="This replaces a fact that comes later in the story.",
                sides=[
                    {"id": fact.get("id"), "at": fact.get("at"),
                     "value": fact.get("value"),
                     "where": _anchor_label(fact.get("at"), label_for)},
                    {"id": target.get("id"), "at": target.get("at"),
                     "value": target.get("value"),
                     "where": _anchor_label(target.get("at"), label_for)},
                ],
            ))

    # ── Two facts at one point, nothing to order them ────────────────────
    grouped: dict[tuple[str, str, tuple[int, int]], list[dict]] = {}
    for fact in placed:
        key = (str(fact.get("axis", "")), str(fact.get("frame") or TRUTH),
               index.ordinal(fact.get("at")))
        grouped.setdefault(key, []).append(fact)

    for (axis, frame, _ordinal), group in sorted(grouped.items(), key=lambda kv: str(kv[0])):
        if len(group) < 2 or any(f.get("intentional") for f in group):
            continue
        # Same value twice is a duplicate, not a disagreement -- annoying,
        # but nothing about the world is in doubt, so it is not a Snag.
        if len({str(f.get("value", "")).strip() for f in group}) < 2:
            continue
        ids = {f.get("id") for f in group if f.get("id")}
        superseded = {f.get("supersedes") for f in group
                      if f.get("supersedes") in ids}
        survivors = [f for f in group if f.get("id") not in superseded]
        if len(survivors) == 1:
            continue                    # the writer said which one stands
        snags.append(Snag(
            kind=SNAG_AMBIGUOUS_ORDER, entity_id=entity_id, axis=axis,
            anchor=str(group[0].get("at") or ""),
            summary=(f"{len(group)} facts set '{axis}' at "
                     f"{_anchor_label(group[0].get('at'), label_for)} with "
                     f"nothing to say which came last."),
            sides=[{"id": f.get("id"), "at": f.get("at"),
                    "value": f.get("value"), "frame": frame} for f in group],
        ))

    snags.extend(_forked_supersession(entity_id, placed, label_for))
    snags.extend(_impossible_order(entity_id, facts, index, label_for))
    snags.extend(_reveal_order(entity_id, placed, index, label_for))
    return snags


# ── R8.4: the two checks the spec named and nothing implemented ──────────────
#
# The spec lists five deterministic-first checks. Three existed (axis conflict,
# tie conflict, and the introduction half of reveal order as the Early mention
# stop); knowledge violation is the AI pass by design. These are the other two.
#
# BOTH ARE ARITHMETIC ON THE ANCHORS THE WRITER WROTE, and that is a deliberate
# narrowing of check 4, which the spec words as "prose references a fact before
# its revealed_at". Matching a sentence to a FACT is a reading -- there is no
# mechanical way to know that "she thought of her father, alive somewhere north"
# is the fact `father: alive`, and a checker that guessed would accuse the writer
# of spoilers they did not write. That is the same line this module's own header
# draws between arithmetic and interpretation, and the interpreting half lives in
# the AI pass with quoted evidence and the freedom to be wrong. The spec is
# amended to say so rather than left describing something the build does not do.
#
# What IS mechanical is the writer's own two anchors disagreeing with each other,
# which is what these read.

def _impossible_order(entity_id: str, facts: list[dict], index: AnchorIndex,
                      label_for) -> list[Snag]:
    """
    Anchors that cannot be ordered as written.

    One fact, two anchors, and the second before the first. There is no reading
    of a book under which the reader is told a thing is true before the point at
    which it becomes true -- a plan, a prophecy or a prediction is a different
    fact with its own anchor, not this one revealed early. That is the bar
    `_forked_supersession` sets for calling something structural, and this
    clears it.

    Deliberately NOT checked: a fact whose `at` is later than the chapter that
    NAMES the entry. That is the Early mention stop, which exists, is worded as a
    question rather than an error, and is right to be -- the mention may be the
    intended one and the anchor may be the mistake.
    """
    snags: list[Snag] = []
    for fact in facts:
        if fact.get("intentional"):
            continue
        at = fact.get("at")
        revealed = fact.get("revealed_at")
        if not at or not revealed:
            continue
        # Both have to resolve. An anchor pointing at a deleted chapter is the
        # Unplaced stop's business, and reporting it twice under two different
        # names is the noise problem this recovery keeps finding.
        start = index.ordinal(at)
        told = index.ordinal(revealed)
        if start is None or told is None or told >= start:
            continue
        snags.append(Snag(
            kind=SNAG_IMPOSSIBLE_ORDER, entity_id=entity_id,
            axis=str(fact.get("axis", "")), anchor=str(at),
            summary=(f"The reader is told this in "
                     f"{_anchor_label(revealed, label_for)}, before it becomes "
                     f"true in {_anchor_label(at, label_for)}."),
            sides=[{"id": fact.get("id"), "at": at, "value": fact.get("value"),
                    "revealed_at": revealed,
                    "where": _anchor_label(at, label_for)}],
        ))
    return snags


def _reveal_order(entity_id: str, placed: list[dict], index: AnchorIndex,
                  label_for) -> list[Snag]:
    """
    The book spoils itself: a correction reaches the reader before what it
    corrects.

    This is the spec's opening example read backwards, and it is the reason
    `revealed_at` exists as a separate switch from `at`. The heroine believes her
    father died; the truth supersedes that belief in chapter fifteen. If the
    TRUTH is marked as reaching the reader in chapter three, the belief the whole
    arc rests on is dead on arrival -- the reader knows better than she does from
    the moment they meet her, and every scene built on the misunderstanding plays
    as irony the writer did not choose.

    Purely arithmetic: two facts, two reveal points, one pointing at the other.
    Nothing is being interpreted, and either anchor could be the mistake, so the
    finding shows both sides and takes no position on which.
    """
    snags: list[Snag] = []
    by_id = {f.get("id"): f for f in placed if f.get("id")}
    for fact in placed:
        if fact.get("intentional"):
            continue
        earlier = by_id.get(fact.get("supersedes"))
        if earlier is None or earlier.get("intentional"):
            continue
        # reveal_ordinal's fallback is the right one here: a fact with no reveal
        # point of its own becomes known where it happens, which is the ordinary
        # case and needs no separate branch.
        told_new = _reveal_position(index, fact)
        told_old = _reveal_position(index, earlier)
        if told_new is None or told_old is None or told_new >= told_old:
            continue
        snags.append(Snag(
            kind=SNAG_REVEAL_ORDER, entity_id=entity_id,
            axis=str(fact.get("axis", "")), anchor=str(fact.get("at") or ""),
            summary=("The reader learns the correction before the thing it "
                     "corrects, so this spoils itself."),
            sides=[
                {"id": fact.get("id"), "at": fact.get("at"),
                 "value": fact.get("value"),
                 "revealed_at": fact.get("revealed_at"),
                 "where": _anchor_label(fact.get("revealed_at")
                                        or fact.get("at"), label_for)},
                {"id": earlier.get("id"), "at": earlier.get("at"),
                 "value": earlier.get("value"),
                 "revealed_at": earlier.get("revealed_at"),
                 "where": _anchor_label(earlier.get("revealed_at")
                                        or earlier.get("at"), label_for)},
            ],
        ))
    return snags


def _reveal_position(index: AnchorIndex, fact: dict):
    """
    Where the reader learns this, as a number, or None when it cannot be placed.

    Shares the fallback rule with visibility.reveal_ordinal -- no reveal point
    means it becomes known where it happens -- but returns a plain number rather
    than that function's "always" sentinel, because "always" cannot be compared
    with `>` and a checker that silently treated it as 0 would report every
    undated background fact as a spoiler.
    """
    anchor = fact.get("revealed_at") or fact.get("at")
    if not anchor:
        return None
    return index.ordinal(anchor)


# ---------------------------------------------------------------------------
# WHAT IS DELIBERATELY NOT CHECKED HERE
# ---------------------------------------------------------------------------
# "Her eyes are green in chapter two and blue in chapter nine" feels like the
# obvious structural check, and it is not one. A Run is SUPPOSED to change
# across a book -- "believes her father died" then "knows he lives" is the
# entire feature. resolve.py rule 5 says so explicitly: a later fact on the
# same (axis, frame) supersedes the earlier one, and the derivation is
# deterministic.
#
# So a checker that flagged every changed value would fire on every Thread
# with a normal Run, and would be contradicting the resolver it shares a
# folder with. The real question -- "did you MEAN this to change?" -- cannot
# be answered by arithmetic. It is a reading, and readings live in the
# semantic pass, where the evidence is quoted and the writer can disagree.
# ---------------------------------------------------------------------------

def _forked_supersession(entity_id: str, placed: list[dict], label_for) -> list[Snag]:
    """
    Two facts both claiming to replace the same earlier one.

    This IS structural, because the writer wrote both `supersedes` lines
    themselves and they cannot both be the successor. Unlike a changed value,
    there is no reading of the book under which this is intended -- the
    resolver would have to pick one, and picking silently is what rule 4
    forbids.
    """
    snags: list[Snag] = []
    claims: dict[str, list[dict]] = {}
    for fact in placed:
        if fact.get("intentional"):
            continue
        target = fact.get("supersedes")
        if target:
            claims.setdefault(str(target), []).append(fact)

    for target, group in sorted(claims.items()):
        if len(group) < 2:
            continue
        snags.append(Snag(
            kind=SNAG_AXIS_CONFLICT, entity_id=entity_id,
            axis=str(group[0].get("axis", "")), anchor=str(group[0].get("at") or ""),
            summary=(f"{len(group)} facts each say they replaced the same "
                     f"earlier one, and only one of them can have."),
            sides=[{"id": f.get("id"), "at": f.get("at"),
                    "value": f.get("value"), "supersedes": target,
                    "where": _anchor_label(f.get("at"), label_for)}
                   for f in group],
        ))
    return snags


# ── Ties ─────────────────────────────────────────────────────────────────────

def check_ties(
    entity_id: str,
    ties: list[dict],
    registry: dict,
    index: AnchorIndex,
    *,
    at: str | None = None,
    label_for=None,
) -> list[Snag]:
    """
    Relation rules, read from the world model rather than assumed.

    `cardinality: "one"` means one active target at a time. `exclusive_group`
    means two relations that cannot both be live for the same Thread.

    WHAT THIS DELIBERATELY DOES NOT ASSUME: `married_to` ships with no
    exclusivity. Polygamous, political and invented-culture marriages are not
    contradictions, and a checker that encoded one culture's assumption would
    be telling a fantasy novelist their world is wrong. The writer opts in
    per world by setting `cardinality` or `exclusive_group` themselves.
    """
    relations = {r.get("id"): r for r in registry.get("relations", [])}
    now = index.ordinal(at) if at else None
    snags: list[Snag] = []

    # R8.4, the tie half of "anchors that cannot be ordered". A connection that
    # ends before it starts is never active, which means it is invisible to
    # everything downstream while looking perfectly correct in the file -- the
    # same shape of problem as an Unplaced fact, and just as silent. Checked
    # BEFORE the active-window filter below, because that filter is exactly what
    # would drop it: a tie whose window is empty never reaches any other check.
    for tie in ties:
        if tie.get("intentional") or not tie.get("at") or not tie.get("until"):
            continue
        start = index.ordinal(tie.get("at"))
        end = index.ordinal(tie.get("until"))
        if start is None or end is None or end > start:
            continue
        snags.append(Snag(
            kind=SNAG_IMPOSSIBLE_ORDER, entity_id=entity_id,
            axis=str(tie.get("rel", "")), anchor=str(tie.get("at") or ""),
            summary=(f"This connection ends in "
                     f"{_anchor_label(tie.get('until'), label_for)}, at or "
                     f"before it starts in "
                     f"{_anchor_label(tie.get('at'), label_for)}, so it is "
                     f"never true anywhere."),
            sides=[{"id": f"{tie.get('rel', '')}:{tie.get('target')}",
                    "rel": tie.get("rel"), "target": tie.get("target"),
                    "at": tie.get("at"), "until": tie.get("until"),
                    "where": _anchor_label(tie.get("at"), label_for)}],
        ))

    active: list[dict] = []
    for tie in ties:
        start = index.ordinal(tie.get("at")) if tie.get("at") else None
        if start is not None and now is not None and start > now:
            continue                    # not true yet at the point being asked
        end = index.ordinal(tie.get("until")) if tie.get("until") else None
        if end is not None and now is not None and end <= now:
            continue                    # over by now
        active.append(tie)

    by_rel: dict[str, list[dict]] = {}
    for tie in active:
        by_rel.setdefault(str(tie.get("rel", "")), []).append(tie)

    for rel_id, group in sorted(by_rel.items()):
        relation = relations.get(rel_id)
        if not relation:
            continue
        if relation.get("cardinality") == "one" and len(group) > 1:
            snags.append(Snag(
                kind=SNAG_CARDINALITY, entity_id=entity_id, axis=rel_id,
                anchor=str(at or ""),
                summary=(f"'{relation.get('label', rel_id)}' allows one at a "
                         f"time, and there are {len(group)}."),
                sides=[{"id": f"{rel_id}:{t.get('target')}",
                        "target": t.get("target"), "at": t.get("at"),
                        "where": _anchor_label(t.get("at"), label_for)}
                       for t in group],
            ))

    # Exclusive groups: two DIFFERENT relations that cannot both be live.
    by_group: dict[str, list[tuple[str, dict]]] = {}
    for rel_id, group in by_rel.items():
        exclusive = (relations.get(rel_id) or {}).get("exclusive_group")
        if not exclusive:
            continue
        for tie in group:
            by_group.setdefault(exclusive, []).append((rel_id, tie))

    for group_id, entries in sorted(by_group.items()):
        if len({rel for rel, _ in entries}) < 2:
            continue
        snags.append(Snag(
            kind=SNAG_EXCLUSIVE, entity_id=entity_id, axis=group_id,
            anchor=str(at or ""),
            summary=(f"These connections cannot both be true at once "
                     f"({group_id})."),
            sides=[{"id": f"{rel}:{tie.get('target')}", "rel": rel,
                    "target": tie.get("target"), "at": tie.get("at"),
                    "where": _anchor_label(tie.get("at"), label_for)}
                   for rel, tie in entries],
        ))
    return snags


# ── Tangles ──────────────────────────────────────────────────────────────────

def group_tangles(snags: list[Snag]) -> list[list[Snag]]:
    """
    Snags sharing a cause, gathered into one stop.

    Moving one date can produce eleven Snags. Presenting those as eleven
    separate questions makes the writer answer the same thing eleven times
    and teaches them that the checker does not understand their book. Grouped
    by (entity, axis), which is the shape a single mistake actually takes.

    A group of one is still returned as a group: the caller renders a Tangle
    of one exactly as it renders a Snag, and having one code path is worth
    more than the distinction.
    """
    buckets: dict[tuple[str, str], list[Snag]] = {}
    for snag in snags:
        buckets.setdefault((snag.entity_id, snag.axis), []).append(snag)
    return [buckets[key] for key in sorted(buckets)]
