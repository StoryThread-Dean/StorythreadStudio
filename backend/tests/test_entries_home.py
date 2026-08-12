# tests/test_entries_home.py -- where a project's entries live
# ============================================================
# The writer reported this as a counting bug: "the side panel shows Characters
# 13, the Weave graph shows 12, and twelve of them have no editable profile."
# It was not a counting bug. The sidebar was counting codex/ while the Profile
# Builder was reading profiles/, and both were reporting honestly about
# different folders.
#
# So there is now exactly one function that answers "which folder", and every
# surface asks it. These tests are about the RULES it applies, and each one
# exists because getting it wrong hides some of the writer's world:
#
#   converted           -> codex/       (that is what conversion means)
#   interrupted         -> profiles/    (what a restore puts back)
#   unconverted, in use -> profiles/    (never hide a world behind placeholders)
#   nothing yet         -> codex/       (a new project starts in the new world)

import json
import os

from fastapi.testclient import TestClient

from app.codex.migrate import MIGRATION_VERSION, entries_home, journal_path
from app.codex.sections import build_sections
from app.main import app

client = TestClient(app)

ENTRY = "---\ntype: character\nname: Elara Voss\n---\n\n# Overview\nA tall woman.\n"


def _project(tmp_path, *, profiles=0, codex=0, converted=False, interrupted=False):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    settings = {"title": "N"}
    if converted:
        settings["codex_migration_version"] = MIGRATION_VERSION
    (root / "project.json").write_text(json.dumps(settings), encoding="utf-8")

    for count, folder in ((profiles, "profiles"), (codex, "codex")):
        if count:
            (root / folder / "characters").mkdir(parents=True)
            for i in range(count):
                (root / folder / "characters" / f"e{i}.md").write_text(
                    ENTRY, encoding="utf-8")

    if interrupted:
        os.makedirs(os.path.dirname(journal_path(str(root))), exist_ok=True)
        with open(journal_path(str(root)), "w", encoding="utf-8") as f:
            f.write("{}\n")
    return str(root)


def test_a_converted_project_is_edited_in_the_codex(tmp_path):
    project = _project(tmp_path, codex=3, converted=True)
    assert entries_home(project) == "codex"


def test_an_unconverted_project_is_still_edited_in_profiles(tmp_path):
    # Conversion is an offer, not a toll gate. A writer who has never opened the
    # Weave must find their profiles exactly where they left them.
    project = _project(tmp_path, profiles=13)
    assert entries_home(project) == "profiles"


def test_a_world_of_profiles_is_never_hidden_behind_a_few_weave_entries(tmp_path):
    # The case that decides the ORDER of the rules. Weaving can create entries
    # in codex/ on a project that was never converted, so both folders hold
    # something. Preferring codex/ here would make thirteen profiles vanish
    # behind three placeholders -- which is the original complaint, rebuilt.
    project = _project(tmp_path, profiles=13, codex=3)
    assert entries_home(project) == "profiles"


def test_a_project_with_nothing_in_profiles_starts_in_the_codex(tmp_path):
    # A new book, or one where the writer went to the Weave first. There is
    # nothing to lose and something to gain: an entry Weaving makes is editable
    # in the Profile Builder the moment it exists.
    project = _project(tmp_path, codex=2)
    assert entries_home(project) == "codex"


def test_an_empty_project_starts_in_the_codex(tmp_path):
    assert entries_home(_project(tmp_path)) == "codex"


def test_an_interrupted_conversion_stays_out_of_the_codex(tmp_path):
    # A journal survived, so a run died partway. profiles/ is what a restore
    # puts back, and writing into a half-converted codex/ is the one thing that
    # could make that restore lossy. The writer is asked to resume or restore
    # before anything else -- they are not quietly given an editor pointed at
    # the wreckage.
    project = _project(tmp_path, profiles=5, codex=2, interrupted=True)
    assert entries_home(project) == "profiles"


def test_the_sidebar_counts_the_folder_the_editor_opens(tmp_path):
    # THE ORIGINAL BUG, as an assertion. Two surfaces, one question: the tree's
    # count and the editor's list must come from the same folder, whatever the
    # rule happens to be.
    cases = [{"profiles": 13, "codex": 3},
             {"codex": 3, "converted": True},
             {"codex": 2},
             {"profiles": 4}]
    for i, kwargs in enumerate(cases):
        project = _project(tmp_path / f"case{i}", **kwargs)
        home = entries_home(project)
        tree = build_sections(project, home)
        characters = next(
            section
            for group in tree["groups"] if group["id"] == "profiles"
            for section in group["sections"] if section["id"] == "character"
        )
        expected = len([
            name
            for name in os.listdir(os.path.join(project, home, "characters"))
            if name.endswith(".md")
        ]) if os.path.isdir(os.path.join(project, home, "characters")) else 0
        assert characters["count"] == expected, kwargs


def test_health_reports_the_home_and_what_it_is_not_showing(tmp_path):
    # A limitation stated out loud is a limitation; the same limitation unstated
    # is the writer counting rows and finding one missing.
    project = _project(tmp_path, profiles=13, codex=3)
    body = client.get("/api/codex/health",
                      params={"project_path": project}).json()
    assert body["entries_home"] == "profiles"
    assert body["elsewhere"] == 3


def test_nothing_elsewhere_is_reported_as_nothing(tmp_path):
    project = _project(tmp_path, codex=2)
    body = client.get("/api/codex/health",
                      params={"project_path": project}).json()
    assert body["entries_home"] == "codex"
    assert body["elsewhere"] == 0
