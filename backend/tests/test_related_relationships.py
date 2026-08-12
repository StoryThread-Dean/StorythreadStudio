# tests/test_related_relationships.py -- the relationship-aware full summary
# ==========================================================================
# Generating a character's Full AI Summary reads the project's RELATIONSHIP
# entries and weaves in who this character is to other people. That behaviour
# shipped in Phase 6 with no test, and it was the last AI path with a hardcoded
# profiles/ folder in it.
#
# Which made it the worst kind of breakage waiting to happen. The function
# returns a LIST, and an empty list is a perfectly ordinary result -- a character
# with no relationships written yet. So on a converted project it would have
# quietly stopped finding anything: no error, no warning, just a thinner summary
# than the writer used to get, for a reason nothing on screen could explain.

import json
import os

from app.codex.migrate import MIGRATION_VERSION
from app.routers.ai import _find_related_relationships, _relationship_dir

RELATIONSHIP = """---
type: relationship
name: Lexa and Garrick
---

# Overview
She was his apprentice before she was his rival.

# Current Dynamic
They circle each other in every room, and neither says why.
"""


def _project(tmp_path, *, folder, converted):
    root = tmp_path / "MyNovel"
    (root / folder).mkdir(parents=True)
    settings = {"title": "N"}
    if converted:
        settings["codex_migration_version"] = MIGRATION_VERSION
    (root / "project.json").write_text(json.dumps(settings), encoding="utf-8")
    (root / folder / "lexa-garrick.md").write_text(RELATIONSHIP, encoding="utf-8")
    return str(root)


def test_an_unconverted_project_reads_its_profiles_folder(tmp_path):
    project = _project(tmp_path, folder="profiles/relationships", converted=False)
    found = _find_related_relationships(project, "Garrick")
    assert [name for name, _ in found] == ["Lexa and Garrick"]


def test_a_converted_project_reads_the_codex(tmp_path):
    # The regression this file exists for. Before the fix this returned [] and
    # the summary simply came back thinner.
    project = _project(tmp_path, folder="codex/relationships", converted=True)
    found = _find_related_relationships(project, "Garrick")
    assert [name for name, _ in found] == ["Lexa and Garrick"]


def test_what_the_ai_is_told_is_the_same_from_either_folder(tmp_path):
    # A Thread file and a profile file use the same headings, which is why one
    # reader serves both. If that ever stops being true, this fails rather than
    # the writer noticing their summaries got worse.
    old = _find_related_relationships(
        _project(tmp_path / "a", folder="profiles/relationships", converted=False),
        "Lexa")
    new = _find_related_relationships(
        _project(tmp_path / "b", folder="codex/relationships", converted=True),
        "Lexa")
    assert old == new
    assert "was his apprentice" in old[0][1]
    assert "circle each other" in old[0][1]


def test_a_character_nobody_has_a_relationship_with_finds_nothing(tmp_path):
    project = _project(tmp_path, folder="codex/relationships", converted=True)
    assert _find_related_relationships(project, "Wren Ashby") == []


def test_the_folder_follows_a_renamed_section(tmp_path):
    # A writer can rename the Relationships section, and the folder moves with
    # it. Spelling "relationships" here a second time would break the scan for
    # anybody who did.
    project = _project(tmp_path, folder="codex/relationships", converted=True)
    types_path = os.path.join(project, "codex", "types.json")
    os.makedirs(os.path.dirname(types_path), exist_ok=True)
    from app.codex.types_registry import default_registry

    registry = default_registry()
    for entry in registry["types"]:
        if entry["id"] == "relationship":
            entry["folder"] = "bonds"
    with open(types_path, "w", encoding="utf-8") as f:
        json.dump(registry, f)

    assert _relationship_dir(project).endswith(os.path.join("codex", "bonds"))


def test_a_broken_registry_does_not_make_the_scan_lie(tmp_path):
    # An unreadable types.json means "use the conventional folder", not "this
    # character has no relationships".
    project = _project(tmp_path, folder="codex/relationships", converted=True)
    with open(os.path.join(project, "codex", "types.json"), "w",
              encoding="utf-8") as f:
        f.write("{not json")

    assert _find_related_relationships(project, "Garrick")
