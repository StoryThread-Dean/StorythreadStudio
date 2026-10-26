"""
ai/context_window.py -- how much a model can hold, and what to do when we
do not know.

Lifted out of routers/extractor.py in v2.0.6, where it had been the ONLY
context-window reasoning in the app: `editor-chat`, `editor-pass` and
`revise-suggestion` never asked, and used flat character caps instead.

---------------------------------------------------------------------------
ZERO MEANS UNKNOWN. IT DOES NOT MEAN UNLIMITED.
---------------------------------------------------------------------------
The rule was already written down before this module existed, in the
extractor's own docstring:

    A 0 window means unknown, which the caller must treat as different from
    "it fits". Claiming a fit we did not verify is exactly how a writer ends
    up paying for a request that overflows.

And the code four lines away broke it: `if context_tokens and estimated >
...` short-circuits on 0, so a model with an unknown window was the one model
that could never be refused.

That is not a hypothetical. **A local model has no window.** Ollama's
`/api/tags` does not report one, so every local model normalises to 0 -- and
Ollama's default behaviour on an oversize prompt is to TRIM IT AND ANSWER
ANYWAY. The writer gets a confident reply built on a silently truncated
manuscript, from the one provider where nothing bills them for it and so
nothing else would ever make them look.

`fits()` is the answer: three states, not two.
"""

import time

__all__ = ["UNKNOWN", "VERDICT_FITS", "VERDICT_TOO_BIG", "VERDICT_UNKNOWN",
           "context_window", "fits", "forget_cached_windows"]

UNKNOWN = 0

VERDICT_FITS = "fits"
VERDICT_TOO_BIG = "too_big"
VERDICT_UNKNOWN = "unknown"

# Deliberate slack rather than timidity: the manuscript is not the whole
# request. The prompt, any attachments and the model's own answer all have to
# fit alongside it, and an answer truncated halfway is indistinguishable from
# a model that could not do the job.
SAFETY_FRACTION = 0.8

# The proxy the whole app uses. Kept here so the frontend and backend can be
# pinned to one number -- four slightly different roundings of len/4 shipped
# before this, and a frontend total that disagrees with the backend surfaces
# as a request the writer was told would fit and did not.
CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    """A rough, deliberately generous-to-the-writer token count."""
    return len(text or "") // CHARS_PER_TOKEN + 1


# Cached per process, with a TTL. A model's window changes about once a month,
# and the screens that ask do so repeatedly.
#
# THE TTL EXISTS BECAUSE OF THE ZERO. The old cache stored a failed lookup
# forever: one flaky network call at startup and that model was "unknown" for
# the life of the process, with no way to recover but a restart. A real window
# is cached for an hour; an unknown one is retried after a minute.
# (window, when it was stored). The TTL is applied when the entry is READ
# rather than baked into an expiry at write time, so changing it takes
# effect on entries already held -- which is what makes it testable, and
# what would let it become a setting without a restart.
_CACHE: dict[str, tuple[int, float]] = {}
_TTL_KNOWN = 3600.0
_TTL_UNKNOWN = 60.0


def forget_cached_windows() -> None:
    """Drop everything. For tests, and for a settings change."""
    _CACHE.clear()


async def context_window(provider, api_key: str, model_id: str) -> int:
    """
    How much the model can hold, in tokens. `UNKNOWN` (0) when we cannot say.

    Best-effort by design: this is called from screens that have not spent
    anything yet, so every failure degrades to "we could not find out" rather
    than blocking the writer.
    """
    now = time.monotonic()
    cached = _CACHE.get(model_id)
    if cached is not None:
        window, stored_at = cached
        if now - stored_at < (_TTL_KNOWN if window else _TTL_UNKNOWN):
            return window

    window = UNKNOWN
    try:
        from app.ai.openrouter import list_models

        for entry in await list_models(api_key, provider):
            if entry.get("id") == model_id:
                window = int(entry.get("context_length") or 0)
                break
    except Exception:                             # noqa: BLE001 - best effort
        window = UNKNOWN

    _CACHE[model_id] = (window, now)
    return window


def fits(estimated_tokens: int, window: int) -> str:
    """
    Three answers, because there are three situations.

        VERDICT_FITS     -- we know the window and it is big enough
        VERDICT_TOO_BIG  -- we know the window and it is not
        VERDICT_UNKNOWN  -- we do not know the window

    The caller must handle UNKNOWN separately. Folding it into FITS is the bug
    this module exists to stop; folding it into TOO_BIG would refuse every
    local model outright, which is worse than useless for a writer who chose
    one deliberately.
    """
    if not window:
        return VERDICT_UNKNOWN
    return VERDICT_FITS if estimated_tokens <= window * SAFETY_FRACTION \
        else VERDICT_TOO_BIG
