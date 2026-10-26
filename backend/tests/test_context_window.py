"""
tests/test_context_window.py -- how much a model holds, and the honest answer
when we do not know.

THE BUG THIS MODULE EXISTS FOR was a short-circuit: `if context_tokens and
estimated > context_tokens * 0.8`. A model reporting 0 -- which is EVERY local
model, because Ollama's /api/tags does not publish a window -- fell straight
through and could never be refused. And Ollama's default on an oversize prompt
is to trim it and answer anyway, so the writer gets a confident reply built on
half their book, from the one provider where nothing bills them and therefore
nothing else would ever make them look.

The rule was already written in the extractor's own docstring, four lines from
the code that broke it:

    A 0 window means unknown, which the caller must treat as different from
    "it fits".

`fits()` returns three verdicts so a caller cannot accidentally collapse them
into two.
"""

import pytest

from app.ai.context_window import (
    SAFETY_FRACTION,
    UNKNOWN,
    VERDICT_FITS,
    VERDICT_TOO_BIG,
    VERDICT_UNKNOWN,
    context_window,
    estimate_tokens,
    fits,
    forget_cached_windows,
)


@pytest.fixture(autouse=True)
def _clean_cache():
    forget_cached_windows()
    yield
    forget_cached_windows()


# ── Three verdicts, not two ──────────────────────────────────────────────────

def test_a_comfortable_request_fits():
    assert fits(10_000, 100_000) == VERDICT_FITS


def test_an_oversize_request_does_not():
    assert fits(90_000, 100_000) == VERDICT_TOO_BIG


def test_the_slack_is_real_and_deliberate():
    # The manuscript is not the whole request: the prompt, the attachments and
    # the model's own answer all have to fit alongside it.
    window = 100_000
    assert fits(int(window * SAFETY_FRACTION) - 1, window) == VERDICT_FITS
    assert fits(int(window * SAFETY_FRACTION) + 1, window) == VERDICT_TOO_BIG


@pytest.mark.parametrize("size", [1, 30_000, 10_000_000])
def test_an_unknown_window_is_never_reported_as_fitting(size):
    """
    THE ONE THAT MATTERS. Whatever the size, an unknown window cannot answer
    "it fits" -- claiming a fit nobody verified is how a writer pays for a
    request that overflows.
    """
    assert fits(size, UNKNOWN) == VERDICT_UNKNOWN


def test_an_unknown_window_is_not_reported_as_too_big_either():
    # Folding UNKNOWN into TOO_BIG would refuse every local model outright,
    # which is worse than useless for a writer who chose one deliberately.
    assert fits(10, UNKNOWN) != VERDICT_TOO_BIG


def test_the_three_verdicts_are_distinct():
    # A caller doing `if verdict == VERDICT_FITS` must not accidentally catch
    # the unknown case through truthiness or equality.
    assert len({VERDICT_FITS, VERDICT_TOO_BIG, VERDICT_UNKNOWN}) == 3


# ── Looking it up ────────────────────────────────────────────────────────────

class _FakeProvider:
    pass


def _models(monkeypatch, entries, calls=None):
    async def fake_list_models(api_key, provider):
        if calls is not None:
            calls.append(1)
        return entries

    import app.ai.openrouter as openrouter
    monkeypatch.setattr(openrouter, "list_models", fake_list_models)


@pytest.mark.asyncio
async def test_it_reads_the_published_window(monkeypatch):
    _models(monkeypatch, [{"id": "big/model", "context_length": 200_000}])
    assert await context_window(_FakeProvider(), "k", "big/model") == 200_000


@pytest.mark.asyncio
async def test_a_model_that_publishes_nothing_is_unknown(monkeypatch):
    # The local case. Ollama's /api/tags carries no context_length at all.
    _models(monkeypatch, [{"id": "llama3"}])
    assert await context_window(_FakeProvider(), "", "llama3") == UNKNOWN


@pytest.mark.asyncio
async def test_a_model_not_in_the_catalog_is_unknown(monkeypatch):
    _models(monkeypatch, [{"id": "other/model", "context_length": 8_000}])
    assert await context_window(_FakeProvider(), "k", "missing") == UNKNOWN


@pytest.mark.asyncio
async def test_an_unreachable_catalog_is_unknown_rather_than_an_error(monkeypatch):
    # This runs on screens that have not spent anything yet. Every failure
    # degrades to "we could not find out" rather than blocking the writer.
    async def boom(api_key, provider):
        raise RuntimeError("no network")

    import app.ai.openrouter as openrouter
    monkeypatch.setattr(openrouter, "list_models", boom)
    assert await context_window(_FakeProvider(), "k", "any") == UNKNOWN


# ── The cache, and the zero it used to keep forever ──────────────────────────

@pytest.mark.asyncio
async def test_a_known_window_is_only_looked_up_once(monkeypatch):
    calls: list[int] = []
    _models(monkeypatch, [{"id": "m", "context_length": 128_000}], calls)
    await context_window(_FakeProvider(), "k", "m")
    await context_window(_FakeProvider(), "k", "m")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_an_unknown_window_is_retried_rather_than_kept_forever(monkeypatch):
    """
    THE OTHER HALF OF THE OLD BUG. The previous cache stored a failed lookup
    with no expiry, so one flaky call at startup left that model "unknown" for
    the life of the process -- recoverable only by restarting the app, with
    nothing on screen to suggest that would help.

    A real window is cached for an hour; an unknown one for a minute.
    """
    import app.ai.context_window as cw

    calls: list[int] = []
    _models(monkeypatch, [{"id": "m"}], calls)          # no context_length
    assert await context_window(_FakeProvider(), "k", "m") == UNKNOWN
    assert len(calls) == 1

    # Within the short TTL: still cached, no second lookup.
    await context_window(_FakeProvider(), "k", "m")
    assert len(calls) == 1

    # Past it: asked again. The catalog now answers, and so do we.
    monkeypatch.setattr(cw, "_TTL_UNKNOWN", -1.0)
    _models(monkeypatch, [{"id": "m", "context_length": 32_000}], calls)
    assert await context_window(_FakeProvider(), "k", "m") == 32_000
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_changing_the_assigned_model_forgets_what_was_cached(monkeypatch):
    calls: list[int] = []
    _models(monkeypatch, [{"id": "m", "context_length": 8_000}], calls)
    await context_window(_FakeProvider(), "k", "m")
    forget_cached_windows()
    await context_window(_FakeProvider(), "k", "m")
    assert len(calls) == 2


# ── One estimator ────────────────────────────────────────────────────────────

def test_the_estimate_grows_with_the_text():
    assert estimate_tokens("") < estimate_tokens("x" * 100) < estimate_tokens("x" * 1000)


def test_it_never_returns_zero_for_real_text():
    # A zero estimate would make an oversize request look free.
    assert estimate_tokens("a") >= 1


def test_it_handles_nothing_without_raising():
    assert estimate_tokens("") >= 0
    assert estimate_tokens(None) >= 0            # type: ignore[arg-type]
