"""
Does the help text tell the truth about money?

A cross-language contract, and it exists because of a lesson learned the hard
way twice this week: a claim the frontend makes about the backend is only as good
as something checking it. The `universal` flag was read by the editor and never
sent by the API; sixty frontend tests passed because their fixtures supplied it
themselves.

The same shape of mistake here costs real money rather than a broken button. The
help panel says "Free. No AI is called, so this costs nothing." for anything
declared free. If an AI pass later lands on a route described that way, the app
is telling the writer their click is free while spending their credit.

So the frontend declares which route each explanation triggers, and this walks
the router source to see whether that route actually calls a model. Python reads
TypeScript, the way test_codex_icon_keywords.py already does -- the two sides
cannot drift without one of these failing.
"""

import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"
ROUTERS = APP / "routers"
EXPLANATIONS = (Path(__file__).resolve().parents[2] / "app" / "src"
                / "components" / "learn" / "explanations.ts")

# One entry in the registry: its key, and the body up to the next key.
_ENTRY_RE = re.compile(r'^  "([a-z0-9.\-]+)":\s*\{(.*?)^  \},', re.MULTILINE | re.DOTALL)
_ENDPOINT_RE = re.compile(r'endpoint:\s*"([^"]+)"')
_COST_FREE_RE = re.compile(r"cost:\s*FREE\b")
_COST_SPENDS_RE = re.compile(r"cost:\s*spends\(")

# How every AI call site in this codebase is spelled. The Model Roles work made
# this the single door to a model, which is what makes the check possible at all
# -- see test_role_call_sites.py, which leans on the same fact.
_SPENDS_RE = re.compile(r"_resolve_model_and_key\(")


def _entries() -> dict[str, dict]:
    """{key: {endpoint, cost}} straight out of the frontend registry."""
    assert EXPLANATIONS.is_file(), f"cannot find {EXPLANATIONS}"
    source = EXPLANATIONS.read_text(encoding="utf-8")
    out: dict[str, dict] = {}
    for key, body in _ENTRY_RE.findall(source):
        endpoint = _ENDPOINT_RE.search(body)
        if _COST_FREE_RE.search(body):
            cost = "free"
        elif _COST_SPENDS_RE.search(body):
            cost = "spends"
        elif "cost:" not in body:
            # Mentioning cost is optional, so an entry with no cost line at all
            # is fine and simply makes no claim to check.
            cost = "silent"
        else:
            cost = "?"
        out[key] = {"endpoint": endpoint.group(1) if endpoint else None,
                    "cost": cost}
    return out


def _handler_source(route: str) -> str | None:
    """
    The body of the handler that serves this route.

    Found by its decorator, then read to the next decorator or the end of the
    file. Crude on purpose: a real import-and-inspect would need the whole app
    wired up, and this only has to be good enough to notice a model call.
    """
    path = route.replace("/api/", "").split("/")[0]
    router_file = ROUTERS / f"{path}.py"
    if not router_file.is_file():
        return None
    source = router_file.read_text(encoding="utf-8")
    tail = route.split(f"/api/{path}", 1)[-1] or "/"

    # @router.get("/scan") / @router.post("/scan") -- the prefix lives on the
    # router, so the decorator carries only the tail.
    pattern = re.compile(
        r'@router\.(?:get|post|put|patch|delete)\(\s*"' + re.escape(tail)
        + r'"[^)]*\)(.*?)(?=\n@router\.|\Z)', re.DOTALL)
    match = pattern.search(source)
    return match.group(1) if match else None


def test_the_registry_can_be_read_at_all():
    # If the parse silently found nothing, every test below would pass while
    # checking nothing -- the exact failure mode this file was written about.
    entries = _entries()
    assert len(entries) >= 10, entries
    assert any(e["endpoint"] for e in entries.values())


def test_a_cost_that_IS_stated_is_readable():
    # Saying nothing about money is allowed -- it was made a nice-to-have rather
    # than an obligation. What is not allowed is a claim this parser cannot read,
    # because an unreadable claim silently skips the check below.
    for key, entry in _entries().items():
        assert entry["cost"] in {"free", "spends", "silent"}, (
            f"{key}: cost is written in a form this test cannot read"
        )


def test_every_named_route_exists():
    # A stale endpoint means the check below silently stops applying to it.
    missing = [(key, entry["endpoint"])
               for key, entry in _entries().items()
               if entry["endpoint"] and _handler_source(entry["endpoint"]) is None]
    assert missing == [], f"named routes with no handler found: {missing}"


@pytest.mark.parametrize("key", sorted(_entries()))
def test_a_route_that_calls_a_model_is_never_described_as_free(key):
    """
    THE CHECK THAT MATTERS. Free is a promise about the writer's money.

    Saying nothing about money is fine; saying the wrong thing is not. So an
    entry that makes no claim is skipped, and one that does is held to it.
    """
    entry = _entries()[key]
    if not entry["endpoint"] or entry["cost"] == "silent":
        # No route named, or no claim made. Nothing to be wrong about.
        return
    body = _handler_source(entry["endpoint"])
    assert body is not None, key
    calls_model = bool(_SPENDS_RE.search(body))

    if entry["cost"] == "free":
        assert not calls_model, (
            f"{key} tells the writer '{entry['endpoint']}' is free, but that "
            f"handler calls a model. Change the cost to spends() with a note "
            f"saying what it spends, or the app is spending their credit while "
            f"promising it is not."
        )
    else:
        assert calls_model, (
            f"{key} says '{entry['endpoint']}' spends tokens, and that handler "
            f"never calls a model. Saying something costs money when it does "
            f"not teaches the writer to avoid a free feature."
        )
