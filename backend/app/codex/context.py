# codex/context.py -- what the AI is told, and what it is not
# ============================================================
# This module is the one that changes a product rule, so the rule is written
# here in full and the code below is answerable to it:
#
#     EXPLICITLY INSPECTABLE AND CONTROLLABLE CONTEXT. AI may automatically
#     receive story context relevant to the current anchor, but the writer
#     must be able to inspect what will be sent, remove individual Threads,
#     exclude categories, and disable automatic Weave context entirely. No
#     context is transmitted until the writer initiates an AI action.
#
# Four obligations, each one a function argument here rather than a promise:
# `pinned` and the returned `pieces` make it inspectable, `exclude_ids`
# removes one Thread, `exclude_types` removes a category, and `enabled=False`
# turns the whole thing off and returns the app to manual chips only.
#
# Nothing in this module sends anything anywhere. It builds a brief and hands
# it back; a caller triggered by the writer is what transmits.
#
# ---------------------------------------------------------------------------
# THE BUDGET RESERVES OVERHEAD, OR IT IS NOT A BUDGET
# ---------------------------------------------------------------------------
# "You have 10,000 tokens" produces a 10,000-token brief and leaves no room
# for the actual request. What is available to the Weave is what is left
# after everything else has been counted:
#
#     the model's context limit
#   - room for the reply
#   - the system prompt
#   - the writer's selection or chapter
#   - history and scaffolding
#   - anything the writer pinned by hand
#   = what the Weave may spend
#
# ---------------------------------------------------------------------------
# PINNED CONTENT IS NEVER PRUNED
# ---------------------------------------------------------------------------
# A chip the writer attached is an instruction, not a suggestion. Automatic
# Weave content prunes first, least relevant first, and what was dropped is
# REPORTED -- a brief that quietly omitted half the world would be worse than
# one that was never assembled, because the writer would trust it.
#
# If the pinned content alone does not fit, the app says so and refuses. It
# does not truncate: half a character profile reads as a whole one, and the
# model has no way to know it was handed a fragment.

from dataclasses import dataclass, field

from app.codex.anchors import AnchorIndex
from app.codex.resolve import resolve_thread
from app.codex.visibility import VISIBLE, Lens, thread_visibility

__all__ = [
    "Budget", "Brief", "Piece", "RELEVANCE_PINNED", "RELEVANCE_MENTIONED",
    "RELEVANCE_CONNECTED", "RELEVANCE_BACKGROUND", "assemble", "estimate_tokens",
]

# Why a Thread is in the brief -- and, read backwards, the order it is pruned
# in. Shown to the writer in the inspect panel, because "why is this here?"
# is the question that makes the panel worth opening.
RELEVANCE_PINNED = 3          # the writer attached it. Never pruned.
RELEVANCE_MENTIONED = 2       # named in the text being written
RELEVANCE_CONNECTED = 1       # tied to something that is
RELEVANCE_BACKGROUND = 0      # in the world, not in this scene

_RELEVANCE_WORDS = {
    RELEVANCE_PINNED: "you attached it",
    RELEVANCE_MENTIONED: "named in what you are writing",
    RELEVANCE_CONNECTED: "connected to someone here",
    RELEVANCE_BACKGROUND: "part of the world",
}


def estimate_tokens(text: str) -> int:
    """
    Roughly four characters to a token for English prose.

    The same proxy the audiobook estimator and the prompt-cache gate use. It
    is an estimate and is treated as one: the budget leaves real headroom
    rather than filling to the last token on the strength of it.
    """
    return len(text) // 4 + 1


@dataclass
class Budget:
    """
    What the Weave may actually spend, once everything else is counted.

    Every subtraction is named rather than folded into one number, so the
    inspect panel can show the writer where their window went instead of an
    unexplained "context full".
    """
    model_context_limit: int
    output_reserve: int = 4000
    system_prompt_tokens: int = 0
    user_text_tokens: int = 0
    fixed_request_overhead: int = 0
    pinned_tokens: int = 0

    def spent_elsewhere(self) -> int:
        return (self.output_reserve + self.system_prompt_tokens
                + self.user_text_tokens + self.fixed_request_overhead
                + self.pinned_tokens)

    def available(self) -> int:
        """Never negative -- a negative budget is a refusal, handled by the
        caller, not a number to do arithmetic with."""
        return max(0, self.model_context_limit - self.spent_elsewhere())

    def breakdown(self) -> dict:
        return {
            "limit": self.model_context_limit,
            "reply": self.output_reserve,
            "system": self.system_prompt_tokens,
            "your_text": self.user_text_tokens,
            "scaffolding": self.fixed_request_overhead,
            "pinned": self.pinned_tokens,
            "for_the_weave": self.available(),
        }


@dataclass
class Piece:
    """One Thread as it will appear in the brief."""
    entity_id: str
    name: str
    type: str
    text: str
    tokens: int
    relevance: int
    pinned: bool = False

    def reason(self) -> str:
        return _RELEVANCE_WORDS.get(self.relevance, "")

    def as_dict(self) -> dict:
        return {"entity_id": self.entity_id, "name": self.name,
                "type": self.type, "tokens": self.tokens,
                "relevance": self.relevance, "reason": self.reason(),
                "pinned": self.pinned, "text": self.text}


@dataclass
class Brief:
    """
    What would be sent, and what would not.

    `refused` is not an error case bolted on. It is the honest answer when
    the pinned content alone does not fit, and it is returned rather than
    raised so the caller can show the writer their own numbers.
    """
    text: str = ""
    pieces: list[Piece] = field(default_factory=list)
    omitted: list[dict] = field(default_factory=list)
    token_estimate: int = 0
    as_of: str | None = None
    enabled: bool = True
    refused: bool = False
    refusal: str = ""
    withheld_spoilers: int = 0
    withheld_by_scope: int = 0
    # Entries left out because the writer said where they appear and this is
    # not one of those places. COUNTED, never silent: a shorter brief with no
    # explanation is indistinguishable from a smaller world, which is the rule
    # this app applies to every other omission it makes.
    withheld_not_present: int = 0
    budget: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "brief": self.text,
            "threads": [p.as_dict() for p in self.pieces],
            "omitted": self.omitted,
            "token_estimate": self.token_estimate,
            "as_of": self.as_of,
            "enabled": self.enabled,
            "refused": self.refused,
            "refusal": self.refusal,
            "withheld_spoilers": self.withheld_spoilers,
            "withheld_by_scope": self.withheld_by_scope,
            "budget": self.budget,
        }


# ── Assembly ─────────────────────────────────────────────────────────────────

def assemble(
    threads: list[dict],
    index: AnchorIndex,
    *,
    at: str | None,
    budget: Budget,
    pov: str | None = None,
    mentioned: set[str] | None = None,
    pinned: set[str] | None = None,
    exclude_ids: set[str] | None = None,
    exclude_types: set[str] | None = None,
    enabled: bool = True,
    include_on_request: bool = False,
) -> Brief:
    """
    The brief for one point in the story.

    `mentioned` is entity ids the caller detected in the text being written.
    AMBIGUOUS MENTIONS MUST NOT BE IN IT -- mentions.py refuses to bind them
    for exactly this reason, and passing a guess here is how the wrong
    character's beliefs reach the model without anyone seeing it happen.
    """
    mentioned = mentioned or set()
    pinned = pinned or set()
    exclude_ids = exclude_ids or set()
    exclude_types = exclude_types or set()

    if not enabled:
        # The global off switch. The app returns to manual chips only, which
        # is exactly how it behaved before the Weave existed.
        return Brief(enabled=False, as_of=at, budget=budget.breakdown())

    lens = Lens.for_pov(at, pov, include_on_request=include_on_request)
    connected = _connected_to(threads, mentioned)

    pieces: list[Piece] = []
    spoilers = 0
    by_scope = 0
    not_present = 0

    for thread in threads:
        entity_id = str(thread.get("entity_id") or "")
        if not entity_id or entity_id in exclude_ids:
            continue
        if thread.get("type") in exclude_types and entity_id not in pinned:
            # A pinned Thread survives a category exclusion. The writer said
            # "not locations" and then attached this one by hand; the more
            # specific instruction wins.
            continue

        verdict = thread_visibility(thread, index, lens)
        if verdict != VISIBLE:
            by_scope += 1
            continue

        # ── WHO IS ACTUALLY IN THIS CHAPTER ─────────────────────────────
        #
        # An entry the writer has PLACED is only sent where they placed it.
        # This is the answer to a world of sixty characters: without it the
        # brief carries everyone who is merely visible, ranked and then
        # trimmed to budget, and the writer's only control is unticking them
        # by hand every time.
        #
        # TWO THINGS OUTRANK IT, and they are what make filtering safe rather
        # than merely tight:
        #
        #   - a PINNED Thread. The writer said "this one, now", which is more
        #     specific than a list they wrote last week.
        #   - a Thread NAMED IN THE TEXT being written. The strongest signal
        #     there is: if the paragraph says Lou, Lou goes, whatever any
        #     placement says. A tag must never hide the character the writer
        #     is literally writing about.
        #
        # An entry with NO placement is not filtered. Silence means "I have
        # not said", not "nowhere" -- otherwise turning this feature on would
        # empty the brief for every project that has never used it.
        if (at and not _is_present(thread, at, index)
                and entity_id not in pinned and entity_id not in mentioned):
            not_present += 1
            continue

        resolved = resolve_thread(thread, index, at, pov=pov,
                                  hide_spoilers=True,
                                  include_on_request=include_on_request)
        spoilers += int(resolved.get("withheld_spoilers") or 0)
        by_scope += int(resolved.get("withheld_by_scope") or 0)

        text = render_thread_brief(resolved)
        if not text.strip():
            continue

        pieces.append(Piece(
            entity_id=entity_id,
            name=str(thread.get("name") or ""),
            type=str(thread.get("type") or ""),
            text=text,
            tokens=estimate_tokens(text),
            relevance=_relevance(entity_id, mentioned, connected, pinned),
            pinned=entity_id in pinned,
        ))

    return _fit(pieces, budget, at, spoilers, by_scope, not_present)


def _connected_to(threads: list[dict], mentioned: set[str]) -> set[str]:
    """
    Everything one Tie away from something named in the text.

    Both directions, because only one is ever stored: a mentor is connected
    to their student whether or not the student's file is the one that
    happens to carry the Tie.
    """
    if not mentioned:
        return set()
    connected: set[str] = set()
    for thread in threads:
        entity_id = str(thread.get("entity_id") or "")
        for tie in thread.get("ties") or []:
            target = str(tie.get("target") or "")
            if entity_id in mentioned and target:
                connected.add(target)
            if target in mentioned and entity_id:
                connected.add(entity_id)
    return connected - mentioned


def _relevance(entity_id: str, mentioned: set[str], connected: set[str],
               pinned: set[str]) -> int:
    if entity_id in pinned:
        return RELEVANCE_PINNED
    if entity_id in mentioned:
        return RELEVANCE_MENTIONED
    if entity_id in connected:
        return RELEVANCE_CONNECTED
    return RELEVANCE_BACKGROUND


def _is_present(thread: dict, at: str, index) -> bool:
    """
    Has the writer placed this entry here?

    True when they have placed it nowhere, which is the ordinary state of a
    project that has never used this: silence means "not said", not "nowhere".

    Comparison is by CHAPTER. A placement is stored as an anchor so scenes can
    extend it later, and an anchor carrying a scene still answers for its
    chapter -- so a writer who places something at a scene is not excluded from
    every request made about the chapter around it.
    """
    placed = thread.get("appears_in") or []
    if not placed:
        return True
    here = _chapter_of(at)
    return any(_chapter_of(anchor) == here for anchor in placed)


def _chapter_of(anchor: str) -> str:
    """The chapter half of an anchor. `c-abc/s-def` -> `c-abc`."""
    return str(anchor or "").split("/", 1)[0]


def _fit(pieces: list[Piece], budget: Budget, at: str | None,
         spoilers: int, by_scope: int, not_present: int = 0) -> Brief:
    """
    Keep what fits, drop the least relevant, and say what was dropped.

    Sorted by relevance then by size: among equally relevant Threads the
    smaller ones go in first, which fits more of the world into the same
    window. Ties broken by name so the same book assembles the same brief
    twice -- a brief that shuffled between runs would make every difference
    in the model's answer impossible to attribute.
    """
    brief = Brief(as_of=at, withheld_spoilers=spoilers,
                  withheld_by_scope=by_scope,
                  withheld_not_present=not_present, budget=budget.breakdown())

    required = [p for p in pieces if p.pinned]
    optional = [p for p in pieces if not p.pinned]
    required.sort(key=lambda p: (p.name, p.entity_id))
    optional.sort(key=lambda p: (-p.relevance, p.tokens, p.name, p.entity_id))

    # `room` is what the Weave may spend, full stop. Budget.pinned_tokens is
    # already subtracted from it and means something else -- the chips the
    # writer attached through the existing chip picker, outside this module.
    # Pinned THREADS are Weave content and are paid for out of `room` like
    # everything else; what makes them different is only that they are never
    # the thing that gets dropped.
    required_tokens = sum(p.tokens for p in required)
    room = budget.available()

    if required_tokens > room:
        brief.refused = True
        brief.refusal = (
            f"The Threads you pinned need about {required_tokens:,} tokens "
            f"and there is room for about {room:,}. Nothing was assembled. "
            f"Unpin something, or use a model with a larger context window "
            f"-- the app will not hand the model half a profile and let it "
            f"treat that as the whole one."
        )
        return brief

    kept = list(required)
    used = required_tokens
    for piece in optional:
        if used + piece.tokens > room:
            brief.omitted.append({
                "entity_id": piece.entity_id, "name": piece.name,
                "type": piece.type, "tokens": piece.tokens,
                "reason": "no room left",
            })
            continue
        kept.append(piece)
        used += piece.tokens

    kept.sort(key=lambda p: (-p.relevance, p.name, p.entity_id))
    brief.pieces = kept
    brief.text = _render(kept, at)
    brief.token_estimate = estimate_tokens(brief.text)
    return brief


# ── Rendering ────────────────────────────────────────────────────────────────

def render_thread_brief(resolved: dict) -> str:
    """
    One Thread as prose the model can read, AS OF the anchor.

    The Run comes first and is labelled as what is true NOW. That ordering is
    the whole point of the feature: a model given "Overview: a grieving
    daughter" followed by "as of here: she knows he is alive" will weight
    whichever it read as authoritative, so the time-varying part goes first
    and says plainly that it is current.
    """
    lines: list[str] = [f"## {resolved.get('name', '')}"]
    kind = str(resolved.get("type") or "")
    if kind:
        lines.append(f"({kind})")

    run = resolved.get("run") or []
    if run:
        lines.append("True at this point in the story:")
        for fact in run:
            frame = str(fact.get("frame") or "truth")
            prefix = "- " if frame == "truth" else "- (believed) "
            lines.append(f"{prefix}{fact.get('value', '')}")

    for section in (resolved.get("sections") or {}).values():
        content = str(section.get("content") or "").strip()
        blocks = section.get("trait_blocks") or []
        if not content and not blocks:
            continue
        lines.append(f"{section.get('heading', '')}:")
        if content:
            lines.append(content)
        for block in blocks:
            # WEIGHT AND SECRECY, both. This used to emit a bare
            # "- trait: description", which meant two things were lost between
            # the Weave's own brief and the model:
            #
            #   the weight, so every trait arrived flat and a Core voice trait
            #   read no louder than a Background one;
            #
            #   and the SUBTEXT marker, which is far worse, because the prompt's
            #   never-name rule keys on it. A secret reaching a model through this
            #   path arrived as ordinary text the model was free to state
            #   outright. The chip path (formatProfileForAI) marked it and this
            #   one did not, so the same trait was protected or exposed depending
            #   on how it happened to be sent.
            #
            # Same shape as the chip path on purpose -- `[core, SUBTEXT]` -- so
            # there is one thing for the prompt to recognise.
            importance = str(block.get("importance") or "").strip()
            marks = [m for m in (importance, "SUBTEXT" if block.get("subtext") else "") if m]
            label = f" [{', '.join(marks)}]" if marks else ""
            lines.append(f"- {block.get('trait', '')}{label}: "
                         f"{block.get('description', '')}")

    return "\n".join(lines).strip()


def _render(pieces: list[Piece], at: str | None) -> str:
    if not pieces:
        return ""
    header = ("# From the writer's world model"
              + (f" (as of {at})" if at else ""))
    return "\n\n".join([header] + [p.text for p in pieces])
