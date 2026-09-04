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
from app.codex.normalize import chapter_of
from app.codex.resolve import frames_for, resolve_thread
from app.codex.tie_run import resolve_ties
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
    # Traits left out because the writer said WHEN they are true and this is
    # not then. Counted for the same reason and reported the same way: a
    # character who arrives thinner than the profile is must say why, or the
    # writer reasonably concludes the brief is broken.
    withheld_traits: int = 0
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
            # THIS LINE WAS MISSING and the omission is worth keeping a note
            # about, because it is this programme's signature failure in
            # miniature. `withheld_not_present` was computed correctly from the
            # day presence shipped, tested at the dataclass, and read by
            # WeaveContextBar -- which rendered "N you placed in other
            # chapters" inside a branch that could never be true, because the
            # count stopped at the edge of this function and never reached the
            # wire. Nothing failed. The screen simply never said it.
            "withheld_not_present": self.withheld_not_present,
            "withheld_traits": self.withheld_traits,
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

    # ── ONE PASS FIRST, so connections can be rendered at all ───────────
    #
    # A connection needs two things this loop cannot supply one Thread at a
    # time: the other end's NAME (a target is an id, and "mentored by
    # 25346497-4a97" tells a model nothing), and whether that other end is
    # someone the reader has met.
    #
    # The second is visibility.py's rule, which the map already keeps: A
    # CONNECTION IS ONLY AS VISIBLE AS THE LEAST VISIBLE THING IT TOUCHES.
    # Judging the Tie alone would happily announce a character who has not
    # appeared yet, through the back door of somebody else's connection list.
    #
    # Verdicts are cached rather than recomputed, because the loop below needs
    # the same answer for its own filtering and a second call would be a
    # second chance to disagree.
    names: dict[str, str] = {}
    verdicts: dict[str, str] = {}
    for thread in threads:
        entity_id = str(thread.get("entity_id") or "")
        if not entity_id:
            continue
        names[entity_id] = str(thread.get("name") or "")
        verdicts[entity_id] = thread_visibility(thread, index, lens)
    met = {eid for eid, verdict in verdicts.items() if verdict == VISIBLE}

    pieces: list[Piece] = []
    spoilers = 0
    by_scope = 0
    not_present = 0
    not_true_here = 0

    for thread in threads:
        entity_id = str(thread.get("entity_id") or "")
        if not entity_id or entity_id in exclude_ids:
            continue
        if thread.get("type") in exclude_types and entity_id not in pinned:
            # A pinned Thread survives a category exclusion. The writer said
            # "not locations" and then attached this one by hand; the more
            # specific instruction wins.
            continue

        verdict = verdicts.get(entity_id, VISIBLE)
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
        not_true_here += int(resolved.get("withheld_traits") or 0)

        # THE CONNECTIONS AS THEY STAND HERE, through the resolver written for
        # them. `resolve_ties` was finished, tested and called by nothing; this
        # is its first caller in the brief. Reimplementing supersession here
        # would give the app a second definition of what is true now, which is
        # the thing tie_run.py exists to prevent.
        resolution = resolve_ties(
            thread.get("ties") or [], index, at,
            frames=frames_for(pov), hide_spoilers=True,
            include_on_request=include_on_request,
        )
        spoilers += int(resolution.withheld_spoilers or 0)
        by_scope += int(resolution.withheld_by_scope or 0)

        rendered_ties = []
        for state in resolution.states:
            # The least-visible-endpoint rule. A pair whose other end the
            # reader has not met is dropped WHOLE -- not merely unnamed --
            # because "mentored by someone" still asserts a mentor exists.
            if state.target not in met:
                spoilers += 1
                continue
            # THE PARAGRAPH, AND WHY IT IS RATIONED.
            #
            # `reason` is capped at 140 characters because every connection's
            # line is sent every time. The depth beside it runs several hundred
            # -- the writer's own relationship paragraphs are 700 to 900 -- and
            # eleven of those for one character IS the 920-word blob this whole
            # feature exists to replace. Sending them all always would move the
            # cost rather than remove it.
            #
            # So the line always goes and the paragraph goes when the OTHER END
            # is something the writer is actively working with: named in the
            # text they are writing, or pinned by hand.
            #
            # Not "both ends are in the brief", which sounds tighter and is
            # not: an entry with no `appears_in` is never filtered by presence,
            # and no entry in the writer's 56-entry world sets one -- so every
            # entry is a candidate in every brief and that rule would include
            # every paragraph always. Being NAMED is the signal that actually
            # tracks what they are doing right now.
            wanted = state.target in mentioned or state.target in pinned
            rendered_ties.append({
                "rel": state.rel, "frame": state.frame,
                "reason": state.reason,
                "target_name": names.get(state.target, ""),
                "description": state.record.get("description", "") if wanted
                else "",
            })
        resolved["ties"] = rendered_ties

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

    return _fit(pieces, budget, at, spoilers, by_scope, not_present,
                not_true_here)


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
    here = chapter_of(at)
    return any(chapter_of(anchor) == here for anchor in placed)


# `_chapter_of` used to be defined here as well. It is one line, which is
# exactly why it was worth writing twice and exactly why it should not have
# been: an entry's presence and a trait's window ask the same question of the
# same anchors, so they have to answer it the same way forever, and two
# one-liners are two places for that to stop being true.


def _fit(pieces: list[Piece], budget: Budget, at: str | None,
         spoilers: int, by_scope: int, not_present: int = 0,
         not_true_here: int = 0) -> Brief:
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
                  withheld_not_present=not_present,
                  withheld_traits=not_true_here, budget=budget.breakdown())

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
            # WHEN, alongside how much and whether-out-loud. Present only on a
            # brief with no anchor to stand at -- with one, the trait was
            # either dropped or it holds here, and marking a trait that does
            # hold here would be noise the model has to reason past.
            window = str(block.get("window_label") or "").strip().upper()
            marks = [m for m in (importance,
                                 "SUBTEXT" if block.get("subtext") else "",
                                 window) if m]
            label = f" [{', '.join(marks)}]" if marks else ""
            lines.append(f"- {block.get('trait', '')}{label}: "
                         f"{block.get('description', '')}")

    # ── WHO THIS IS TO EVERYONE ELSE ────────────────────────────────────
    #
    # THE BUG THIS CLOSES. This function never read `ties`, so a connection's
    # reason line reached no model on any path -- while `post_tie` refused to
    # save one without a reason and told the writer, in the refusal, "this is
    # what gets sent to AI when you ask for help". It was not. And
    # REASON_LIMIT is 140 characters precisely BECAUSE "the cost is the cap
    # times the number of connections in scope" -- a cap derived from a budget
    # the field never entered.
    #
    # Connections come last on purpose. The Run is what is true NOW and has to
    # be read first; a relationship is context around it rather than a
    # correction to it.
    #
    # What arrives here is already RESOLVED (see assemble): one state per pair
    # and frame, superseded states dropped, spoilers withheld, and any pair
    # whose other end the reader has not met removed whole. So this renders
    # what it is given and makes no judgement of its own.
    ties = resolved.get("ties") or []
    if ties:
        lines.append("Connections:")
        for tie in ties:
            # (believed) is the same marker the Run uses above, for the same
            # reason and it matters more here. A connection held in one
            # character's frame is what they THINK -- "he believes they are
            # together" while she has never heard of him -- and a model told
            # that flatly would write it as the world's truth.
            prefix = "- " if str(tie.get("frame") or "truth") == "truth" \
                else "- (believed) "
            # The relation as WORDS. `mentored_by` is an id, not English, and
            # the map already renders it this way -- one habit, not two.
            rel = str(tie.get("rel") or "").replace("_", " ").strip()
            name = str(tie.get("target_name") or "").strip()
            head = " ".join(p for p in (rel, name) if p) or name
            reason = str(tie.get("reason") or "").strip()
            lines.append(f"{prefix}{head}: {reason}" if reason
                         else f"{prefix}{head}")
            # Indented under its own line so a model reads the paragraph as
            # belonging to that connection rather than as loose prose about
            # the character. Present only when it earned its place -- see the
            # rationing note in assemble.
            depth = str(tie.get("description") or "").strip()
            if depth:
                lines.append(f"  {depth}")

    return "\n".join(lines).strip()


def _render(pieces: list[Piece], at: str | None) -> str:
    if not pieces:
        return ""
    header = ("# From the writer's world model"
              + (f" (as of {at})" if at else ""))
    return "\n\n".join([header] + [p.text for p in pieces])
