# tests/test_codex_store.py -- the index, and never serving stale canon
# ======================================================================
# Markdown is the source of truth; this is an index over it. Which means the
# only interesting failure is not "the index is missing" -- it is "the index
# is WRONG and says nothing about it".
#
# "An index failure must never block a save" is right, and on its own it
# produces exactly that bug: the Markdown write lands, the index write does
# not, and the graph carries on answering confidently with old information.
# Two mechanisms stop it, and most of this file tests them:
#
#   dirty flag              -- set when a write is known to have failed
#   source revision         -- a fingerprint of the folder, which catches the
#                              case no flag could be set for (a writer editing
#                              a Thread in another editor, or restoring a
#                              backup)
#
# No read is served while either says the index is stale.

import asyncio
import os

import pytest

from app.codex_store import (
    ensure_fresh,
    entities,
    facts_for,
    find_by_alias,
    load_threads,
    mark_dirty,
    read_meta,
    reindex,
    source_revision,
    ties_for,
)
from app.db import get_db_path, open_db

ELARA = """---
type: character
entity_id: e-elara
name: Elara Voss
aliases:
  - the Thread-daughter
ties:
  - rel: mentored_by
    target: e-garrick
    at: c-aaa/s-a1
---

# Overview
A tall woman.

# Run
- id: f-1
  at: c-aaa/s-a2
  axis: belief.father
  value: "Believes her father died."
  frame: e-elara
  ai_scope: always
"""

GARRICK = """---
type: character
entity_id: e-garrick
name: Garrick Vale
---

# Overview
In hiding.
"""


def _project(tmp_path, **files) -> str:
    root = tmp_path / "MyNovel"
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text("{}", encoding="utf-8")
    for name, body in files.items():
        (root / "codex" / "characters" / f"{name}.md").write_text(body, encoding="utf-8")
    return str(root)


def run(coro):
    return asyncio.run(coro)


# ── Loading and indexing ─────────────────────────────────────────────────────

def test_threads_are_loaded_from_their_type_folders(tmp_path):
    folder = _project(tmp_path, elara=ELARA, garrick=GARRICK)
    threads = load_threads(folder)
    assert {t["name"] for t in threads} == {"Elara Voss", "Garrick Vale"}
    assert all(t["filename"].endswith(".md") for t in threads)


def test_reindexing_populates_the_graph(tmp_path):
    folder = _project(tmp_path, elara=ELARA, garrick=GARRICK)
    assert run(reindex(folder)) == 2

    assert {e["name"] for e in run(entities(folder))} == {"Elara Voss", "Garrick Vale"}
    assert run(facts_for(folder, "e-elara"))[0]["axis"] == "belief.father"
    assert len(run(ties_for(folder, "e-elara"))) == 1


def test_a_ties_other_end_can_find_it_too(tmp_path):
    # Only one direction is stored -- the inverse is derived -- so asking
    # "what connects to Garrick?" must return the edge Elara owns.
    folder = _project(tmp_path, elara=ELARA, garrick=GARRICK)
    run(reindex(folder))
    incoming = run(ties_for(folder, "e-garrick"))
    assert len(incoming) == 1
    assert incoming[0]["incoming"] is True


def test_a_threads_own_name_is_searchable_as_an_alias(tmp_path):
    # Detection should not have to special-case "the one that is not in the
    # aliases list".
    folder = _project(tmp_path, elara=ELARA)
    run(reindex(folder))
    assert run(find_by_alias(folder, "Elara Voss")) == ["e-elara"]
    assert run(find_by_alias(folder, "the Thread-daughter")) == ["e-elara"]


def test_alias_lookup_is_case_insensitive(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    run(reindex(folder))
    assert run(find_by_alias(folder, "elara voss")) == ["e-elara"]


def test_two_threads_sharing_a_name_both_come_back(tmp_path):
    # More than one is a NORMAL answer -- two characters called John, a
    # character and a location sharing a name. The caller must treat this as
    # ambiguous and refuse to bind, never take the first.
    twin = GARRICK.replace("e-garrick", "e-other").replace("Garrick Vale", "Elara Voss")
    folder = _project(tmp_path, elara=ELARA, other=twin)
    run(reindex(folder))
    assert sorted(run(find_by_alias(folder, "Elara Voss"))) == ["e-elara", "e-other"]


def test_a_thread_with_no_id_is_skipped_not_indexed_wrongly(tmp_path):
    # Without an id it cannot be linked to or anchored against; indexing it
    # under an empty key would let unrelated Threads collide.
    nameless = "---\ntype: character\nname: Nobody\n---\n\n# Overview\nX.\n"
    folder = _project(tmp_path, elara=ELARA, nobody=nameless)
    run(reindex(folder))
    assert {e["entity_id"] for e in run(entities(folder))} == {"e-elara"}


def test_an_unreadable_thread_costs_only_itself(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    # A directory where a .md file is expected: reading it raises OSError.
    os.mkdir(os.path.join(folder, "codex", "characters", "broken.md"))
    threads = load_threads(folder)
    assert [t["name"] for t in threads] == ["Elara Voss"]


def test_reindexing_replaces_rather_than_accumulates(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    run(reindex(folder))
    run(reindex(folder))
    assert len(run(entities(folder))) == 1
    assert len(run(facts_for(folder, "e-elara"))) == 1


# ── Never serving stale canon ────────────────────────────────────────────────

def test_a_brand_new_index_starts_dirty(tmp_path):
    # An index that has never been built must not claim to be current.
    folder = _project(tmp_path, elara=ELARA)

    async def check():
        async with open_db(folder) as db:
            return await read_meta(db)

    assert run(check())["dirty"] is True


def test_ensure_fresh_rebuilds_when_dirty_then_stops(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    assert run(ensure_fresh(folder)) is True     # first call builds it
    assert run(ensure_fresh(folder)) is False    # nothing changed


def test_marking_dirty_forces_the_next_read_to_rebuild(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    run(ensure_fresh(folder))
    run(mark_dirty(folder))
    assert run(ensure_fresh(folder)) is True


def test_an_edit_made_outside_the_app_is_noticed(tmp_path):
    # The case no dirty flag could ever be set for: the writer edits a Thread
    # in another editor, or restores an old folder from backup.
    folder = _project(tmp_path, elara=ELARA)
    run(ensure_fresh(folder))
    assert run(ensure_fresh(folder)) is False

    path = os.path.join(folder, "codex", "characters", "elara.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(ELARA.replace("Elara Voss", "Elara Thorne"))

    assert run(ensure_fresh(folder)) is True
    assert {e["name"] for e in run(entities(folder))} == {"Elara Thorne"}


def test_a_new_thread_appearing_on_disk_is_noticed(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    run(ensure_fresh(folder))
    (tmp_path / "MyNovel" / "codex" / "characters" / "garrick.md").write_text(
        GARRICK, encoding="utf-8")
    assert len(run(entities(folder))) == 2


def test_reads_go_through_the_freshness_gate(tmp_path):
    # No caller has to remember to reindex: asking a question is enough.
    folder = _project(tmp_path, elara=ELARA)
    assert {e["name"] for e in run(entities(folder))} == {"Elara Voss"}


def test_deleting_the_database_loses_nothing(tmp_path):
    # Everything here is derivable from Markdown. This is the property that
    # lets .storythread/ be documented as a cache.
    folder = _project(tmp_path, elara=ELARA, garrick=GARRICK)
    run(ensure_fresh(folder))
    before = run(entities(folder))

    os.remove(get_db_path(folder))

    assert run(entities(folder)) == before


def test_mark_dirty_never_raises_even_on_a_bad_path(tmp_path):
    # It is called from failure paths. An exception here would turn "the
    # index is stale" into "the save failed".
    run(mark_dirty(str(tmp_path / "does" / "not" / "exist" / "\0bad")))


# ── The fingerprint itself ───────────────────────────────────────────────────

def test_source_revision_changes_when_a_thread_changes(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    before = source_revision(folder)
    path = os.path.join(folder, "codex", "characters", "elara.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(ELARA + "\nmore text\n")
    assert source_revision(folder) != before


def test_source_revision_is_stable_when_nothing_changes(tmp_path):
    folder = _project(tmp_path, elara=ELARA)
    assert source_revision(folder) == source_revision(folder)


def test_a_project_with_no_codex_folder_has_a_revision_anyway(tmp_path):
    root = tmp_path / "Empty"
    root.mkdir()
    assert source_revision(str(root)) == "empty"


@pytest.mark.parametrize("missing", ["codex", "codex/characters"])
def test_indexing_an_empty_project_is_not_an_error(tmp_path, missing):
    root = tmp_path / "MyNovel"
    (root / missing).mkdir(parents=True)
    (root / "project.json").write_text("{}", encoding="utf-8")
    assert run(reindex(str(root))) == 0
