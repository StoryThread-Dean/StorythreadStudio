# tests/test_after_conversion.py -- the writer's world survives being converted
# =============================================================================
# Spec step 503.4 was skipped, and the audit's summary of the damage was that
# after conversion "the writer's world vanishes from chips, exports and Global
# Search at once".
#
# Every one of those failures is SILENT. Search returns no results, which is
# indistinguishable from "you have not written that yet". A chip list comes back
# empty, which looks like a project with no characters. An export omits the
# profiles appendix, which looks like an export. Nothing anywhere raises, and the
# writer's only clue is a growing sense that the app has forgotten their book.
#
# So this file converts a real project and then asks all three surfaces the same
# question: can you still find Elara Voss? It is deliberately end to end. Unit
# tests of each surface passed throughout the period the bug existed.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.codex.migrate import run_migration
from app.main import app

client = TestClient(app)

ELARA = """---
type: character
profile_id: p-elara
name: Elara Voss
role: protagonist
---

# Overview
A tall woman with a borrowed sword.

# Physical Traits
- trait: scarred hands
  description: "From the fire at Ravensmoor."
  importance: core
"""

GOVERNMENT = """---
type: government
entity_id: e-regency
name: The Regency
---

# Overview
The council that rules between kings.
"""


@pytest.fixture
def converted(tmp_path):
    """A project with a profile, converted, plus one Weave-only kind."""
    root = tmp_path / "MyNovel"
    for folder in ("manuscript", "exports", "profiles/characters"):
        (root / folder).mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-the-raid.md").write_text(
        "# The Raid\n\nSmoke over the water.\n", encoding="utf-8")
    (root / "profiles" / "characters" / "elara.md").write_text(ELARA, encoding="utf-8")

    run_migration(str(root))

    # A kind that only exists after conversion, so the tests below also cover
    # the nine kinds the profile system never had.
    (root / "codex" / "governments").mkdir(parents=True, exist_ok=True)
    (root / "codex" / "governments" / "the-regency.md").write_text(
        GOVERNMENT, encoding="utf-8")
    return str(root)


# ── Surface 1: the list the chip picker reads ────────────────────────────────

def test_the_chip_picker_can_still_find_her(converted):
    # The picker used to fetch /api/profiles/list, which after conversion reads
    # the BACKUP copy -- so attaching a character sent the model her old text, or
    # nothing at all once the writer tidied profiles/ away. It reads the same
    # source layer the editor does now, which is this endpoint.
    body = client.get("/api/codex/list",
                      params={"project_path": converted,
                              "type": "character"}).json()
    assert [t["name"] for t in body["threads"]] == ["Elara Voss"]


def test_the_picker_can_reach_kinds_the_profile_system_never_had(converted):
    body = client.get("/api/codex/list",
                      params={"project_path": converted,
                              "type": "government"}).json()
    assert [t["name"] for t in body["threads"]] == ["The Regency"]


def test_what_the_chip_actually_carries_is_her_current_text(converted):
    # Reading the entry, not just its name: the failure this replaced sent the
    # model a stale copy, which is worse than sending nothing.
    threads = client.get("/api/codex/list",
                         params={"project_path": converted}).json()["threads"]
    elara = next(t for t in threads if t["name"] == "Elara Voss")
    entry = client.get("/api/codex/entity",
                       params={"project_path": converted,
                               "entity_id": elara["entity_id"]}).json()
    assert "borrowed sword" in entry["sections"]["overview"]["content"]
    traits = entry["sections"]["physical_traits"]["trait_blocks"]
    assert [t["trait"] for t in traits] == ["scarred hands"]


# ── Surface 2: Global Search ─────────────────────────────────────────────────

def _find(project, query):
    return client.post("/api/search/find", json={
        "project_path": project, "query": query}).json()


def test_global_search_still_finds_her(converted):
    # It walked manuscript/, notes/, profiles/, summaries/, arcs/ -- and not
    # codex/, which is where a converted project keeps everything.
    body = _find(converted, "borrowed sword")
    hits = [f["file_relpath"] for f in body["matches"]]
    assert any("codex" in h and "elara" in h for h in hits), hits


def test_global_search_reaches_the_newer_kinds_too(converted):
    body = _find(converted, "council that rules")
    assert body["matches"], "a Government is as findable as a character"


def test_global_search_still_covers_the_manuscript(converted):
    # The fix adds a folder rather than swapping one. A search that quietly
    # stopped covering the book would be the same bug facing the other way.
    body = _find(converted, "Smoke over the water")
    assert any("manuscript" in f["file_relpath"] for f in body["matches"])


# ── Surface 3: the export ────────────────────────────────────────────────────

def _export(project):
    response = client.post("/api/export/full-manuscript", json={
        "folder_path": project, "format": "markdown", "include_profiles": True})
    assert response.status_code == 200, response.json()
    path = response.json()["output_path"]
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_the_export_carries_her(converted):
    text = _export(converted)
    assert "# Profiles" in text
    assert "Elara Voss" in text or "elara" in text.lower()
    assert "borrowed sword" in text


def test_the_export_appendix_worked_at_all(converted):
    # IT NEVER DID. The appendix read profiles/<TYPE> -- "profiles/character" --
    # while the folders are plural, so ticking "include profiles" produced an
    # export with no profiles in it and said nothing. Two bugs in one line, and
    # the folder-name one predates the Weave entirely.
    text = _export(converted)
    assert "## Characters" in text


def test_the_export_carries_the_newer_kinds(converted):
    # Four hardcoded types became every kind the world declares.
    text = _export(converted)
    assert "## Governments" in text
    assert "council that rules" in text


def test_a_snapshot_copies_the_live_folder(converted):
    response = client.post("/api/export/snapshot", json={
        "folder_path": converted, "include_profiles": True})
    assert response.status_code == 200, response.json()
    snapshot = response.json()["output_path"]
    assert os.path.isfile(os.path.join(snapshot, "codex", "characters", "elara.md"))


# ── And the same three, before conversion ────────────────────────────────────

def test_an_unconverted_project_is_unaffected(tmp_path):
    # Every fix here adds the live folder rather than replacing profiles/. A
    # writer who has never opened the Weave must see no difference at all.
    root = tmp_path / "Older"
    for folder in ("manuscript", "exports", "profiles/characters"):
        (root / folder).mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-a.md").write_text("# A\n\nText.\n", encoding="utf-8")
    (root / "profiles" / "characters" / "elara.md").write_text(ELARA, encoding="utf-8")
    project = str(root)

    found = _find(project, "borrowed sword")
    assert any("profiles" in f["file_relpath"] for f in found["matches"])

    text = _export(project)
    assert "Elara Voss" in text or "elara" in text.lower()
    assert "borrowed sword" in text
