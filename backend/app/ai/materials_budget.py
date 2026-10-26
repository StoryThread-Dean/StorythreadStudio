"""
ai/materials_budget.py -- making a request fit, and saying what it cost.

This is the roadmap's "priority pinning + summary swap" for the builder that
carries the writer's actual prose. The Weave has had the same idea since
v2.0.0 (`codex/context.py`); the chat, Draft, Enhance and Advisor paths have
had nothing but six flat character caps that answer 400.

---------------------------------------------------------------------------
WHY THIS IS NOT `codex/context.py`
---------------------------------------------------------------------------
It reuses that module's `Budget` -- pure arithmetic about how much room is
left, with nothing Thread-shaped in it -- and deliberately does NOT reuse
`_fit`.

`_fit` sorts `Piece`s, and a `Piece` requires an `entity_id`, a `name`, a
`type` and a relevance rung on a ladder whose rungs are about how a Thread
relates to the scene. A chapter, a style guide and the writer's own selection
have none of those and never will. The choice was: give `Piece` a document
variant, or write the document version of the same idea. This is the second,
because the first would put two unrelated kinds of thing behind one sort
order and the ladder would stop meaning what it says.

What IS shared is the principle, and it is the part worth copying:

  - PINNED CONTENT IS NEVER DROPPED. If the pinned set alone will not fit,
    the request is REFUSED rather than quietly trimmed. Half a chapter reads
    to a model exactly like a whole one.
  - EVERYTHING DROPPED IS COUNTED AND NAMED. A brief that quietly omitted
    half the world would be worse than none, because the writer would trust
    it.

---------------------------------------------------------------------------
THE SWAP
---------------------------------------------------------------------------
One material has a cheaper form rather than an all-or-nothing: the full
chapter, which can be sent as its chapter summary instead. That is the
roadmap's "swaps full chapter prose for chapter summaries before truncating
older scene text", and it is why `Material` carries `swap_text`.

---------------------------------------------------------------------------
WHEN IT ENGAGES
---------------------------------------------------------------------------
Only when the model's window is KNOWN and the request would overflow it.
An unknown window (every local model) leaves the old behaviour exactly as it
was, because acting on a number we do not have would be guessing with the
writer's prose. The flat caps stay in place underneath as backstops -- they
are the only thing between an oversize request and the provider, and nothing
downstream checks size at all.
"""

from dataclasses import dataclass, field

from app.codex.context import Budget, estimate_tokens

__all__ = ["Material", "FitResult", "fit_materials"]


@dataclass
class Material:
    """One block of the materials message."""

    key: str
    # What the writer would call it, for the sentence explaining what happened.
    label: str
    text: str
    # Never dropped. If the pinned set will not fit, the request is refused.
    pinned: bool = False
    # A cheaper stand-in, when one exists. Today only the full chapter has one
    # (its summary); the field is general because the next one will not be.
    swap_text: str = ""
    swap_label: str = ""

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)

    @property
    def swap_tokens(self) -> int:
        return estimate_tokens(self.swap_text) if self.swap_text else 0


@dataclass
class FitResult:
    """What survived, what was swapped, what was dropped, and whether to stop."""

    # Whether the budget actually evaluated anything. DISTINCT FROM
    # `engaged`, and the distinction is load-bearing: `ran` False means the
    # caller must use its original values untouched (an unknown window, a
    # model that would not resolve), while `ran` True means `kept` is the
    # whole truth and a missing key was DROPPED.
    #
    # Conflating them is a real bug and it was written first: reading
    # `kept.get(key, original)` makes a dropped material fall straight back
    # to the thing that did not fit.
    ran: bool = False
    kept: dict[str, str] = field(default_factory=dict)
    # key -> the writer-facing label of what it became
    swapped: list[tuple[str, str]] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    # True when even the pinned material will not fit. The caller must refuse
    # rather than send: this is the "half a chapter" case.
    refused: bool = False
    refusal: str = ""
    # True when nothing had to change, which is the ordinary case and the one
    # that must stay silent -- a note on every request teaches the writer to
    # stop reading notes.
    engaged: bool = False

    def note(self) -> str:
        """One sentence for the writer, or nothing."""
        if not self.engaged:
            return ""
        parts = []
        for _key, became in self.swapped:
            parts.append(f"sent {became} instead of the full text")
        if self.dropped:
            parts.append("left out " + ", ".join(self.dropped))
        if not parts:
            return ""
        return ("This did not all fit in the model's context window, so it "
                + " and ".join(parts) + ".")


def fit_materials(materials: list[Material], budget: Budget) -> FitResult:
    """
    Decide what to send.

    `materials` is in DROP ORDER -- least missed first. The caller owns that
    order because it knows what the writer is doing: grounding context around
    a passage is the first thing that can go, and the passage itself is the
    last, because it is the thing being asked about.

    Returns what to send keyed by `key`. A key absent from `kept` was dropped;
    a key in `kept` may hold either the original text or a swap.
    """
    result = FitResult(ran=True)

    required = [m for m in materials if m.pinned]
    optional = [m for m in materials if not m.pinned]

    room = budget.available()
    required_tokens = sum(m.tokens for m in required)

    # THE REFUSAL. Nothing is truncated to make it fit: a model handed half a
    # chapter has no way to tell, and answers confidently about a book that
    # stops mid-sentence.
    if required_tokens > room:
        result.refused = True
        result.engaged = True
        result.refusal = (
            f"What has to be sent for this is about {required_tokens:,} tokens "
            f"and there is room for about {room:,}. Nothing has been sent. Work "
            f"on a smaller selection, or switch to a model that holds more."
        )
        return result

    for m in required:
        result.kept[m.key] = m.text
    spent = required_tokens

    # Everything else, most-missed first -- the caller hands them over in drop
    # order, so this walks it backwards.
    for m in reversed(optional):
        if m.tokens <= room - spent:
            result.kept[m.key] = m.text
            spent += m.tokens
            continue

        # It does not fit whole. Is there a cheaper version?
        if m.swap_text and m.swap_tokens <= room - spent:
            result.kept[m.key] = m.swap_text
            spent += m.swap_tokens
            result.swapped.append((m.key, m.swap_label or "a summary"))
            result.engaged = True
            continue

        # Dropped, and NAMED. This is the rule the Weave's brief already
        # keeps: what is left out is counted rather than quietly lost.
        result.dropped.append(m.label)
        result.engaged = True

    return result
