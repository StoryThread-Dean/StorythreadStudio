# tests/test_codex_export.py -- getting the Weave out of the app
# ==============================================================
# THE SPEC NAMES THIS FILE and it did not exist, which is a fair summary of the
# gap it covers: there was no way to export the Weave at all. The Markdown
# entries already travelled -- copy a project folder and the prose comes with it
# -- but what the Weave ADDS lived in YAML frontmatter and in an index the docs
# describe as a rebuildable cache. A world model a writer cannot take out is a
# world model they do not really own.
#
# Three shapes, three promises. Markdown for a person, JSON for a program, CSV
# for the spreadsheet a great many novelists actually keep their lists in.
#
# The rule that runs through all of them: AN ANCHOR TRAVELS AS AN ID AND AS A
# LABEL. Drop the id and a program cannot follow a renamed chapter; drop the
# label and a person cannot read the file. Which half you lose decides who the
# export is useless to.

import csv
import io
import json
import os

import pytest
from fastapi.testclient import TestClient

from app.codex.export import read_world, to_csv_tables, to_json, to_markdown
from app.main import app

client = TestClient(app)

ELARA = """---
type: character
entity_id: e-elara
name: Alexandra Langford
display_name: Lexa
aliases:
  - Miss Langford
ties:
  - rel: mentored_by
    target: e-garrick
    reason: "He taught her to pick a lock before she could read."
---

# Overview
A tall woman with a borrowed sword.

# Physical Traits
- trait: keeps a locket
  description: "Her mother's."
  importance: core
  subtext: true

# Run
- id: f-believes
  at: c-CH1
  axis: belief.father
  value: "Her father died in the raid."
  frame: e-elara

- id: f-alive
  at: c-CH1
  axis: belief.father
  value: "Her father is alive."
  frame: truth
  revealed_at: c-CH3
"""

GARRICK = """---
type: character
entity_id: e-garrick
name: Garrick Vale
---

# Overview
In hiding.
"""


@pytest.fixture
def project(tmp_path):
    from app.utils.structure_store import ensure_chapter_ids

    root = tmp_path / "MyNovel"
    for folder in ("manuscript", "exports", "codex/characters"):
        (root / folder).mkdir(parents=True)
    (root / "project.json").write_text(
        json.dumps({"title": "The Curse", "codex_migration_version": 1}),
        encoding="utf-8")
    for name, title in (("01-a.md", "The Raid"), ("02-b.md", "The Long Winter"),
                        ("03-c.md", "The Letter")):
        (root / "manuscript" / name).write_text(f"# {title}\n\nText.\n",
                                                encoding="utf-8")

    ids = ensure_chapter_ids(str(root))
    text = ELARA.replace("c-CH1", ids["01-a.md"]).replace("c-CH3", ids["03-c.md"])
    (root / "codex" / "characters" / "lexa.md").write_text(text, encoding="utf-8")
    (root / "codex" / "characters" / "garrick.md").write_text(GARRICK,
                                                              encoding="utf-8")
    return str(root)


# ── Reading the world ────────────────────────────────────────────────────────

def test_it_reads_the_files_rather_than_the_index(project):
    # app.db is documented as a rebuildable cache. An export is a promise about
    # what the writer actually HAS, so reading the source of truth means it
    # cannot be wrong in a way a reindex would quietly fix.
    os.remove(os.path.join(project, ".storythread", "app.db")) if os.path.isfile(
        os.path.join(project, ".storythread", "app.db")) else None
    world = read_world(project)
    assert {e["name"] for e in world["entries"]} == {"Alexandra Langford",
                                                     "Garrick Vale"}


# ── Markdown, for a person ───────────────────────────────────────────────────

def test_markdown_says_what_the_story_calls_her(project):
    text = to_markdown(project)
    assert "### Lexa" in text
    assert "Alexandra Langford" in text          # and what she IS, both


def test_markdown_carries_the_reason_a_connection_exists(project):
    # The half worth reading. A connection exported without it is a diagram.
    text = to_markdown(project)
    assert "mentored by **Garrick Vale**" in text
    assert "taught her to pick a lock" in text


def test_markdown_uses_chapter_NAMES_not_anchors(project):
    text = to_markdown(project)
    assert "1. The Raid" in text
    assert "c-" not in text.replace("codex", "")   # no raw ids in a human file


def test_markdown_says_whose_belief_a_fact_is(project):
    text = to_markdown(project)
    assert "only Lexa thinks this" in text


def test_markdown_says_when_the_reader_finds_out(project):
    text = to_markdown(project)
    assert "the reader learns this at 3. The Letter" in text


def test_markdown_marks_a_secret_trait(project):
    text = to_markdown(project)
    assert "never named" in text


# ── JSON, for a program ──────────────────────────────────────────────────────

def test_json_carries_both_halves_of_every_anchor(project):
    # R4.3, and the reason it is a task of its own. The id survives a chapter
    # rename and is what a program follows; the label is the only half a person
    # can read. An export with one of them is useless to somebody.
    data = json.loads(to_json(project))
    fact = next(f for f in data["facts"] if f["fact_id"] == "f-alive")
    assert fact["at"].startswith("c-")
    assert fact["at_label"] == "1. The Raid"
    assert fact["revealed_at"].startswith("c-")
    assert fact["revealed_at_label"] == "3. The Letter"


def test_json_resolves_ids_to_names_without_dropping_the_ids(project):
    data = json.loads(to_json(project))
    tie = data["connections"][0]
    assert tie["to"] == "e-garrick"
    assert tie["to_name"] == "Garrick Vale"


def test_json_lists_the_chapters_it_refers_to(project):
    data = json.loads(to_json(project))
    assert [c["label"] for c in data["chapters"]] == [
        "1. The Raid", "2. The Long Winter", "3. The Letter"]


def test_json_is_valid_and_says_what_it_is(project):
    data = json.loads(to_json(project))
    assert data["format"] == "storythread-weave"
    assert data["version"] == 1


# ── CSV, for a spreadsheet ───────────────────────────────────────────────────

def test_csv_is_three_tables_rather_than_one_nested_file(project):
    tables = to_csv_tables(project)
    assert set(tables) == {"entries.csv", "connections.csv", "facts.csv"}


def test_csv_opens_as_csv(project):
    tables = to_csv_tables(project)
    rows = list(csv.DictReader(io.StringIO(tables["facts.csv"])))
    assert len(rows) == 2
    assert rows[0]["at_label"] == "1. The Raid"


def test_csv_carries_both_halves_too(project):
    rows = list(csv.DictReader(io.StringIO(to_csv_tables(project)["connections.csv"])))
    assert rows[0]["to"] == "e-garrick"
    assert rows[0]["to_name"] == "Garrick Vale"


# ── The bundle endpoint ──────────────────────────────────────────────────────

def _bundle(project, formats=None):
    payload = {"folder_path": project}
    if formats is not None:
        payload["formats"] = formats
    return client.post("/api/export/weave", json=payload)


def test_the_bundle_writes_all_three_by_default(project):
    response = _bundle(project)
    assert response.status_code == 200, response.json()
    folder = response.json()["output_path"]
    for name in ("weave.md", "weave.json", "entries.csv", "connections.csv",
                 "facts.csv"):
        assert os.path.isfile(os.path.join(folder, name)), name


def test_the_bundle_says_what_it_exported(project):
    # A number a writer can check against what they think they have.
    message = _bundle(project).json()["message"]
    assert "2 entries" in message
    assert "1 connections" in message
    assert "2 facts" in message


def test_one_format_writes_only_that_one(project):
    folder = _bundle(project, ["json"]).json()["output_path"]
    assert os.path.isfile(os.path.join(folder, "weave.json"))
    assert not os.path.isfile(os.path.join(folder, "weave.md"))


def test_an_unknown_format_is_refused_by_name(project):
    response = _bundle(project, ["pdf"])
    assert response.status_code == 400
    assert "pdf" in response.json()["detail"]


def test_asking_for_nothing_is_refused(project):
    assert _bundle(project, []).status_code == 400


# ── The flag on the other two exports ────────────────────────────────────────

def test_the_manuscript_export_can_carry_the_weave(project):
    response = client.post("/api/export/full-manuscript", json={
        "folder_path": project, "format": "markdown", "include_weave": True})
    assert response.status_code == 200, response.json()
    with open(response.json()["output_path"], "r", encoding="utf-8") as f:
        text = f.read()
    assert "# The Weave" in text
    assert "taught her to pick a lock" in text


def test_it_stays_out_unless_asked_for(project):
    response = client.post("/api/export/full-manuscript", json={
        "folder_path": project, "format": "markdown"})
    with open(response.json()["output_path"], "r", encoding="utf-8") as f:
        assert "# The Weave" not in f.read()


def test_a_snapshot_carries_all_three_shapes(project):
    response = client.post("/api/export/snapshot", json={
        "folder_path": project, "include_weave": True})
    assert response.status_code == 200, response.json()
    weave = os.path.join(response.json()["output_path"], "weave")
    assert os.path.isfile(os.path.join(weave, "weave.md"))
    assert os.path.isfile(os.path.join(weave, "weave.json"))
    assert os.path.isfile(os.path.join(weave, "facts.csv"))


# ── The awkward cases ────────────────────────────────────────────────────────

def test_a_world_with_nothing_in_it_exports_honestly(tmp_path):
    root = tmp_path / "Empty"
    for folder in ("manuscript", "exports"):
        (root / folder).mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "E"}), encoding="utf-8")
    text = to_markdown(str(root))
    assert "no entries yet" in text


def test_a_fact_with_no_place_says_so_rather_than_printing_nothing(project):
    path = os.path.join(project, "codex", "characters", "garrick.md")
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n# Run\n- id: f-x\n  axis: mood\n  value: \"Restless.\"\n")
    assert "not placed yet" in to_markdown(project)


def test_an_anchor_whose_chapter_is_gone_leaves_the_label_blank(project):
    # Honest rather than tidy: a deleted chapter means there is no name to give,
    # and inventing one would be worse than an empty cell.
    path = os.path.join(project, "codex", "characters", "garrick.md")
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n# Run\n- id: f-y\n  at: c-deleted\n  axis: mood\n"
                "  value: \"Gone.\"\n")
    data = json.loads(to_json(project))
    fact = next(f for f in data["facts"] if f["fact_id"] == "f-y")
    assert fact["at"] == "c-deleted"
    assert fact["at_label"] == ""
