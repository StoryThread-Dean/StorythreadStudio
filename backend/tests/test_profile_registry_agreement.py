# tests/test_profile_registry_agreement.py -- one set of sections, three files
# ============================================================================
# The Profile Builder's sections are written down in THREE places:
#
#   backend/app/routers/profiles.py   SECTION_CONFIGS  (parses and writes
#                                                       profiles/*.md)
#   backend/app/codex/types_registry.py DEFAULT_TYPES  (parses and writes
#                                                       codex/*.md)
#   app/src/types/profile.ts          SECTION_CONFIGS  (renders the form)
#
# Collapsing them into one is recovery task R2.2b. Until then they are BOUND,
# because the drift has already cost the writer real work, twice:
#
#   * The Weave shipped four sections for a Location where the Profile Builder
#     had seven, so a converted Location and a Weaving-made Location had
#     different pages and only one of them opened properly.
#   * `hidden_and_foreshadowing` was the key in Python while the heading it was
#     read from derives to `hidden_and_foreshadowing_traits`. The form asked for
#     a section the parser never produced, so the writer's hidden traits showed
#     as empty -- and the next save wrote that emptiness to disk over them.
#
# Neither could be caught by using the app: the first looks like a thin page,
# the second looks like a section you have not filled in yet.
#
# This file reads the TypeScript from Python, the same trick test_explain_costs
# uses to stop a "free" claim outliving the route it describes. A test that
# checked only the two Python copies would have passed through the bug that
# actually shipped.

import os
import re

import pytest

from app.codex.threads import _section_id
from app.codex.types_registry import DEFAULT_TYPES
from app.routers.profiles import SECTION_CONFIGS

# The kinds the Profile Builder has a page for today. The other six registry
# kinds (Factions, Religions, Governments, Deities, Creatures, Cultures) have no
# profiles.py entry at all -- that is R2.8, and this file must not pretend
# otherwise by looping over the registry instead of over what exists.
SHARED_KINDS = ["character", "relationship", "location", "lore"]

PROFILE_TS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "app", "src", "types", "profile.ts",
)


def _registry_sections(kind: str) -> list[tuple[str, str, bool]]:
    entry = next(t for t in DEFAULT_TYPES if t["id"] == kind)
    return [(s["id"], s["heading"], bool(s.get("trait_blocks")))
            for s in entry["sections"]]


def _python_sections(kind: str) -> list[tuple[str, str, bool]]:
    return [(c.key, c.heading, c.has_trait_blocks) for c in SECTION_CONFIGS[kind]]


def _typescript_sections() -> dict[str, list[tuple[str, str, bool]]]:
    """
    Parse SECTION_CONFIGS out of profile.ts.

    Deliberately crude -- a regex over the object literal. Anything cleverer
    would need a TypeScript parser in the Python test suite, and the shape here
    is fixed enough that a change which breaks this parse is a change worth
    looking at anyway.
    """
    with open(PROFILE_TS, "r", encoding="utf-8") as f:
        source = f.read()

    start = source.index("export const SECTION_CONFIGS")
    body = source[start:source.index("\n};", start)]

    out: dict[str, list[tuple[str, str, bool]]] = {}
    current = None
    for line in body.splitlines():
        opener = re.match(r"\s{2}(\w+):\s*\[", line)
        if opener:
            current = opener.group(1)
            out[current] = []
            continue
        row = re.search(
            r'key:\s*"([^"]+)".*?heading:\s*"([^"]+)".*?hasTraitBlocks:\s*(true|false)',
            line,
        )
        if row and current:
            out[current].append((row.group(1), row.group(2), row.group(3) == "true"))
    return out


@pytest.mark.parametrize("kind", SHARED_KINDS)
def test_python_and_the_registry_ship_the_same_sections(kind):
    # Same ids, same headings, same trait-block flags, same ORDER -- order is
    # the sequence the writer fills the page in, and two screens disagreeing
    # about it is its own small bug.
    assert _python_sections(kind) == _registry_sections(kind)


@pytest.mark.parametrize("kind", SHARED_KINDS)
def test_the_form_asks_for_exactly_what_the_backend_stores(kind):
    assert _typescript_sections()[kind] == _registry_sections(kind)


@pytest.mark.parametrize("kind", SHARED_KINDS)
def test_every_key_is_what_its_own_heading_derives_to(kind):
    # The rule the hidden-traits bug broke. A section's id comes from its
    # heading when a file is read, so a key that does not match its heading
    # names a section that can never come back from disk.
    for section_id, heading, _ in _registry_sections(kind):
        assert section_id == _section_id(heading), (
            f"{kind}: '{heading}' is filed as '{_section_id(heading)}', "
            f"not '{section_id}'")


def test_a_heading_is_written_the_way_a_person_writes_one():
    # Not style policing: the two files have to agree on the exact heading
    # text, and ".title()" produced "Rule Or Concept" on one side while the
    # Profile Builder wrote "Rule or Concept" on the other.
    headings = [h for kind in SHARED_KINDS for _, h, _ in _registry_sections(kind)]
    assert "Rule or Concept" in headings
    assert "Tone and Atmosphere" in headings
    assert not [h for h in headings if " And " in h or " Or " in h]
