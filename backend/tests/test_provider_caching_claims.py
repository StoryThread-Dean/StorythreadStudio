# tests/test_provider_caching_claims.py -- does the UI tell the truth about caching
# ==================================================================================
# R8.7, and a sibling of test_explain_costs.py for the same reason: this is a
# claim about MONEY. Prompt caching discounts repeat requests, and the switch for
# it is a single toggle in Settings -- so a writer who turns it on will
# reasonably assume it applies to every role they have assigned. It does not.
# Only a service that understands the cache_control marker can honour it.
#
# The backend has computed that caveat since Model Roles shipped
# (`ai/roles.py::resolve_role_model` sets `caveat`) and no screen ever rendered
# it, which is why the writer could not find out. The Model Roles screen renders
# it now, from the FRONTEND's own provider registry -- so this test reads both
# registries and fails the build if they disagree.
#
# Why the frontend keeps its own copy at all: `providerMeta.ts` is a catalog of
# setup instructions, key placeholders and taglines, none of which the backend
# has or wants. The one overlapping fact is this flag, and one overlapping fact
# bound by a test is better than a round trip on a settings screen.

import os
import re

from app.ai.providers import PROVIDERS

_META = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "app", "src", "components", "settings", "providerMeta.ts",
)


def _frontend_claims() -> dict[str, bool]:
    """{provider id -> what the UI says about caching}, read from the source."""
    with open(_META, "r", encoding="utf-8") as f:
        text = f.read()

    claims: dict[str, bool] = {}
    # Each entry is a `{ id: "...", ... supportsCaching: true|false, ... }`
    # object literal. Split on the id and take the first supportsCaching after
    # it, which keeps this readable without pulling in a TypeScript parser.
    for match in re.finditer(r'id:\s*"([^"]+)"', text):
        provider_id = match.group(1)
        rest = text[match.end():]
        flag = re.search(r"supportsCaching:\s*(true|false)", rest)
        if flag is None:
            continue
        # Do not read past the next entry -- a missing flag must fail loudly
        # rather than inherit the following provider's answer.
        next_entry = re.search(r'id:\s*"', rest)
        if next_entry and flag.start() > next_entry.start():
            continue
        claims[provider_id] = flag.group(1) == "true"
    return claims


def test_every_provider_the_backend_knows_is_described_on_screen():
    # A provider missing from the UI registry gets no caveat at all, which is
    # the silent version of the bug this test exists for.
    assert set(PROVIDERS) <= set(_frontend_claims()), (
        "a provider the backend can route to has no entry in providerMeta.ts"
    )


def test_the_ui_never_claims_caching_a_provider_does_not_support():
    # The expensive direction. A `true` here means the screen says nothing, and
    # the writer pays full price for every repeat request believing otherwise.
    claims = _frontend_claims()
    for key, provider in PROVIDERS.items():
        if claims.get(key):
            assert provider.supports_cache_control, (
                f"providerMeta.ts says {key} supports prompt caching and "
                f"providers.py says it does not"
            )


def test_the_ui_never_warns_about_a_provider_that_does_support_it():
    # The other direction is cheaper but still wrong: a caveat nobody needs
    # teaches the writer to ignore caveats, which is how the real one gets
    # missed.
    claims = _frontend_claims()
    for key, provider in PROVIDERS.items():
        if provider.supports_cache_control:
            assert claims.get(key) is True, (
                f"providers.py says {key} supports prompt caching and "
                f"providerMeta.ts warns that it does not"
            )


def test_at_least_one_provider_each_way():
    # Guards the test itself. If every provider ever agreed by accident -- or
    # the parser above quietly returned nothing -- the two tests up there would
    # pass over an empty set and prove nothing.
    values = set(_frontend_claims().values())
    assert values == {True, False}, (
        "expected both a caching and a non-caching provider; the parser or the "
        "registry has changed shape"
    )
