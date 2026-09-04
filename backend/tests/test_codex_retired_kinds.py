# tests/test_codex_retired_kinds.py -- a kind the app no longer offers
# =====================================================================
# `relationship` is the first retired kind, and retiring it is the FIX for a
# reported problem rather than housekeeping after one:
#
#     "Every profile has to have a separate Relationship profile. This is both
#      cumbersome, not efficent, creates another tag in The Weave connection.
#      All to create a profile to address how a character is connected to
#      another character... Its badly designed, not thought out, not an
#      efficent use of tokens if send to ai for draft or context checking."
#
# Every part of that is true, and the mechanisms are worse than inefficiency:
# a relationship entry's five prose sections enter the brief WHOLE at every
# anchor and are never windowed, while ranking lowest and being pruned first
# (prose never says the words "Kipling's Relationships"); the kind is
# `is_active` False so the connection walk never asks how it relates to
# anything; no relation in DEFAULT_RELATIONS accepts it at either end, so only
# the universal "connected to" can attach; and ai/prompts.py pays a model at
# inference time to reconcile it against the character's own page.
#
# RETIRED IS A NARROW WORD HERE and these tests are mostly about how narrow.
# It means "cannot be created". It does not mean hidden, deleted, unreadable,
# unsaveable or unlisted -- every one of which would be data loss for a writer
# who already has fourteen of them.

import re
from pathlib import Path

from app.codex.types_registry import (
    DEFAULT_RELATIONS, DEFAULT_TYPES, default_registry, type_by_id,
)

LEXICON = (Path(__file__).resolve().parents[2]
           / "app" / "src" / "features" / "codex" / "lexicon.ts")

RETIRED = {"relationship"}


def _retired_in_registry() -> set[str]:
    return {t["id"] for t in DEFAULT_TYPES if t.get("retired")}


# ── What retiring means, and what it must not mean ──────────────────────────

def test_the_kind_is_marked_retired():
    assert _retired_in_registry() == RETIRED


def test_it_is_still_a_kind():
    # THE PART THAT MATTERS MOST. profiles.py parses and writes by CONFIG, so a
    # kind missing from DEFAULT_TYPES is a kind whose files cannot be read at
    # all -- every existing profiles/relationships/*.md would 404 on list, load
    # and save. Deleting the entry outright is data loss dressed as a cleanup.
    assert type_by_id(default_registry(), "relationship") is not None


def test_it_keeps_every_one_of_its_sections():
    # An existing entry has prose in these. A section dropped from the list is
    # a section silently dropped from the file on the next save.
    sections = [s["id"] for s in type_by_id(default_registry(),
                                            "relationship")["sections"]]
    assert sections == ["overview", "history", "current_dynamic",
                        "hidden_tensions", "emotional_direction", "notes"]


def test_it_keeps_its_folder_so_files_are_still_found():
    assert type_by_id(default_registry(), "relationship")["folder"] == "relationships"


def test_it_is_not_a_default_section_so_a_clean_project_never_shows_it():
    # The sidebar rule -- a section appears when it holds something, or when it
    # is a default -- already does the right thing here, and did before this
    # change. A project that never used the kind never sees it; one that has
    # fourteen entries still reaches all fourteen.
    assert type_by_id(default_registry(), "relationship")["default_section"] is False


def test_a_writers_own_registry_is_not_rewritten_by_this():
    # types.json is the writer's data, not config. Retiring a shipped kind must
    # not reach into a project that has already seeded its own registry and
    # change what is in it.
    registry = default_registry()
    assert registry["types"] is not DEFAULT_TYPES
    entry = type_by_id(registry, "relationship")
    entry["retired"] = False
    assert _retired_in_registry() == RETIRED


# ── The cross-language half ─────────────────────────────────────────────────

def test_the_frontend_retires_exactly_what_the_backend_does():
    # The picker cannot fetch the registry before rendering, so it carries its
    # own list -- and a copy nothing checks is a copy that drifts. Drift here
    # is silent in the worst direction: the app would go on offering a kind it
    # has retired, and a writer would keep making the thing this change exists
    # to stop them making.
    source = LEXICON.read_text(encoding="utf-8")
    match = re.search(r"RETIRED_TYPES\s*=\s*new Set<string>\(\[(.*?)\]\)",
                      source, re.DOTALL)
    assert match, "could not find RETIRED_TYPES in lexicon.ts"
    listed = set(re.findall(r'"([^"]+)"', match.group(1)))
    assert listed == _retired_in_registry()


def test_the_frontend_still_knows_the_kind_exists():
    # Retired is not removed on that side either: an existing entry has to
    # render with its own icon and its own word, or the writer's fourteen files
    # become fourteen unlabelled rows.
    source = LEXICON.read_text(encoding="utf-8")
    assert '"relationship"' in source
    assert "relationship: \"Heart\"" in source or "relationship:" in source


# ── Why it was the wrong shape, pinned so the reasoning survives ────────────

def test_nothing_could_ever_connect_to_it_meaningfully():
    # Not an oversight to fix -- the reason the kind was wrong. A relationship
    # is not a thing in the world that other things relate TO, so no shipped
    # relation names it at either end, and the only edge it could carry was the
    # universal "connected to".
    named = [r["id"] for r in DEFAULT_RELATIONS
             if "relationship" in (r.get("source_types") or [])
             or "relationship" in (r.get("target_types") or [])]
    assert named == []


def test_the_character_now_has_somewhere_to_put_them():
    # The replacement, on the other side of the same change: a relationship
    # with an entry on the other end is a Connection, and one without is a
    # trait-shaped block here.
    sections = {s["id"]: s for s in type_by_id(default_registry(),
                                               "character")["sections"]}
    assert sections["relationships"]["trait_blocks"] is True
    assert not sections["relationships"].get("retired")
