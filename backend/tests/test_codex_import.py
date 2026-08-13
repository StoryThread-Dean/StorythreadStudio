# tests/test_codex_import.py -- bringing an entry in from another book
# ====================================================================
# The profile system could import CHARACTERS only. That was a limit of the
# profile system rather than of the idea: a world declares its kinds in its own
# registry, so anything that registry knows can be imported, and anything it does
# not know is refused by name.
#
# The care here is all in what is LEFT BEHIND. An entry from another project
# carries ids that mean nothing in this one -- connections pointing at its
# characters, facts anchored to its chapters, beliefs framed on its people. Carry
# them across and the writer gets a connection to nothing, a fact permanently out
# of force, and a belief attributed to a stranger. Drop them silently and the
# writer never learns what they lost.
#
# So they are dropped, and the response says what went.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SOURCE = """---
type: character
entity_id: e-from-elsewhere
name: Garrick Vale
role: mentor
tags:
  - noble
created_at: "2024-05-01T00:00:00+00:00"
ties:
  - rel: mentored_by
    target: e-somebody
    reason: "He taught her everything."
---

# Overview
A man who has run out of patience.

# Physical Traits
- trait: scarred hands
  description: "From the fire."
  importance: core

- trait: keeps a locket
  description: "Hers."
  importance: present
  subtext: true

# Run
- id: f-1
  at: c-other-book/s-1
  axis: allegiance
  value: "Sworn to the crown."
  frame: e-from-elsewhere
  revealed_at: c-other-book/s-4
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(
        json.dumps({"title": "N", "codex_migration_version": 1}), encoding="utf-8")
    return str(root)


@pytest.fixture
def source_file(tmp_path):
    other = tmp_path / "TheOtherBook"
    other.mkdir()
    path = other / "garrick-vale.md"
    path.write_text(SOURCE, encoding="utf-8")
    return str(path)


def _import(project, source_path):
    return client.post("/api/codex/import", json={
        "project_path": project, "source_path": source_path})


# ── What comes across ────────────────────────────────────────────────────────

def test_everything_the_writer_wrote_comes_across(project, source_file):
    body = _import(project, source_file).json()
    thread = body["thread"]
    assert thread["name"] == "Garrick Vale"
    assert thread["role"] == "mentor"
    assert thread["sections"]["overview"]["content"].startswith("A man who has")
    traits = thread["sections"]["physical_traits"]["trait_blocks"]
    assert [t["trait"] for t in traits] == ["scarred hands", "keeps a locket"]


def test_a_secret_stays_a_secret(project, source_file):
    # The one field where losing it is invisible AND changes what AI may say.
    body = _import(project, source_file).json()
    traits = body["thread"]["sections"]["physical_traits"]["trait_blocks"]
    assert traits[1]["subtext"] is True
    assert traits[0].get("subtext") in (None, False)


def test_the_words_of_a_fact_survive_even_though_its_place_does_not(project, source_file):
    body = _import(project, source_file).json()
    run = body["thread"]["run"]
    assert [f["value"] for f in run] == ["Sworn to the crown."]
    assert run[0]["axis"] == "allegiance"


def test_it_is_a_copy_rather_than_the_same_entry_twice(project, source_file):
    body = _import(project, source_file).json()
    assert body["thread"]["entity_id"] != "e-from-elsewhere"


def test_it_lands_on_disk_where_its_kind_lives(project, source_file):
    _import(project, source_file)
    assert os.path.isfile(os.path.join(project, "codex", "characters",
                                       "garrick-vale.md"))


def test_importing_twice_does_not_overwrite_the_first(project, source_file):
    first = _import(project, source_file).json()["thread"]["filename"]
    second = _import(project, source_file).json()["thread"]["filename"]
    assert first != second


# ── What is left behind, and said out loud ───────────────────────────────────

def test_connections_are_left_behind_and_reported(project, source_file):
    # A tie points at an entity id in the other book. Carried across it would
    # name something that does not exist here -- a line on the map to nothing.
    body = _import(project, source_file).json()
    assert body["thread"]["ties"] == []
    assert any("connection" in w for w in body["warnings"])


def test_a_fact_loses_its_chapter_and_the_writer_is_told(project, source_file):
    # Keeping the anchor would leave the fact permanently out of force, silently.
    # Clearing it makes the fact Unplaced, which is the Weave's word for "tell me
    # where this belongs" -- a question with an answer.
    body = _import(project, source_file).json()
    fact = body["thread"]["run"][0]
    assert not fact["at"]
    assert not fact["revealed_at"]
    assert any("place in the story" in w for w in body["warnings"])


def test_a_belief_becomes_plain_truth_and_the_writer_is_told(project, source_file):
    # The frame named a character in the other book. Left as it was, the fact
    # would be attributed to a stranger.
    body = _import(project, source_file).json()
    assert body["thread"]["run"][0]["frame"] == "truth"
    assert any("belief" in w for w in body["warnings"])


def test_a_clean_entry_produces_no_warnings(tmp_path, project):
    # Nothing to say means say nothing. A list of caveats on an entry that lost
    # nothing teaches the writer to skip reading them.
    plain = tmp_path / "plain.md"
    plain.write_text(
        "---\ntype: character\nentity_id: e-x\nname: Wren\n---\n\n"
        "# Overview\nA quiet one.\n", encoding="utf-8")
    body = _import(project, str(plain)).json()
    assert body["warnings"] == []


# ── Refusals ─────────────────────────────────────────────────────────────────

def test_a_kind_this_world_does_not_have_is_refused_by_name(tmp_path, project):
    alien = tmp_path / "alien.md"
    alien.write_text(
        "---\ntype: starship\nentity_id: e-x\nname: The Kestrel\n---\n\n"
        "# Overview\nFast.\n", encoding="utf-8")
    response = _import(project, str(alien))
    assert response.status_code >= 400
    assert "starship" in json.dumps(response.json())


def test_a_file_that_is_not_there_says_so(project):
    response = _import(project, "C:/nowhere/at/all.md")
    assert response.status_code >= 400


def test_a_file_with_no_name_in_it_is_refused(tmp_path, project):
    nameless = tmp_path / "nameless.md"
    nameless.write_text("---\ntype: character\n---\n\n# Overview\nx\n",
                        encoding="utf-8")
    assert _import(project, str(nameless)).status_code >= 400
