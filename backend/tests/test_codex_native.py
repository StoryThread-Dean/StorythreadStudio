"""
A new project is born in the Weave, and never gets a profiles/ folder.

The Weave replaced the profile system as this app's world model in v2.0.0 and
the Profile Builder was repointed at codex/ in the same release. Creation was
not. Every project made between then and now was scaffolded with six
profiles/* directories and no codex/ at all, and only BEHAVED like a codex
project by accident: entries_home fell through to its last rule because the
folders it had just created happened to be empty.

That accident had two costs, and the second one is the reason this file is
mostly about a flag in project.json rather than about folders.

  1. The home was an INFERENCE. One stray .md under profiles/ at any depth --
     an export dropped in the wrong place, a backup unzipped a level too high,
     a note -- silently moved the writer's entire world to the legacy home.
     Every codex entry would vanish from the Profile Builder with nothing on
     screen to explain where it went, because an empty list is a perfectly
     ordinary answer to "how many characters do you have".

  2. `migration_state` said "none", and WeaveScreen renders the conversion
     panel for "none". So a brand-new project's Weave tab showed an offer to
     convert a world it did not have -- INSTEAD of the map -- and the panel
     computes "there is nothing to convert" and renders that as one sentence
     with no button. A wall, on the headline feature, on every new project.

What did NOT change: profiles/ is still a live home for every project that has
not converted. Conversion stays an offer, not a toll gate. Those tests live in
test_entries_home.py and test_codex_migration.py and still pass unchanged.
"""

import json
import os

from fastapi.testclient import TestClient

from app.codex.migrate import entries_home, migration_state, run_migration
from app.codex.types_registry import default_registry
from app.main import app

client = TestClient(app)

ENTRY = "---\ntype: character\nname: Elara Voss\n---\n\n# Overview\nA tall woman.\n"


def _create(tmp_path, title: str = "Smoke Test Novel") -> str:
    folder = tmp_path / "MyNovel"
    folder.mkdir()
    res = client.post("/api/projects/create", json={
        "folder_path": str(folder), "title": title,
    })
    assert res.status_code == 200, res.text
    return res.json()["root_path"]


def _project_json(root: str) -> dict:
    with open(os.path.join(root, "project.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def _subdirs(root: str, folder: str) -> list[str]:
    path = os.path.join(root, folder)
    if not os.path.isdir(path):
        return []
    return sorted(n for n in os.listdir(path)
                  if os.path.isdir(os.path.join(path, n)))


# ── What a new project looks like on disk ────────────────────────────────────

def test_a_new_project_has_no_profiles_folder_at_all(tmp_path):
    # Not an empty profiles/. No profiles/.
    root = _create(tmp_path)
    assert not os.path.exists(os.path.join(root, "profiles"))


def test_a_new_project_gets_the_kinds_the_sidebar_shows(tmp_path):
    root = _create(tmp_path)
    assert _subdirs(root, "codex") == ["characters", "events", "locations", "lore"]


def test_the_scaffold_is_read_from_the_registry_not_written_twice(tmp_path):
    # The four folders are the `default_section` kinds -- the ones the sidebar
    # shows even while they hold nothing. Asserted against the list that
    # DEFINES them, so adding a fifth default kind moves the scaffold and this
    # test together instead of leaving them to drift apart.
    root = _create(tmp_path)
    expected = sorted(t["folder"] for t in default_registry()["types"]
                      if t.get("default_section"))
    assert _subdirs(root, "codex") == expected


def test_a_new_project_has_no_types_json(tmp_path):
    # load_registry falls back to the shipped kinds, so a project that has
    # never customised one must not gain a file recording that it did. Writing
    # it here would also give every project a second copy of the registry to
    # drift from.
    root = _create(tmp_path)
    assert not os.path.isfile(os.path.join(root, "codex", "types.json"))


def test_everything_else_a_project_needs_is_still_there(tmp_path):
    # The change removed folders. It must not have removed the rest of the
    # scaffold on the way past.
    root = _create(tmp_path)
    for folder in ("manuscript", "notes", "exports", ".storythread"):
        assert os.path.isdir(os.path.join(root, folder)), folder
    assert os.path.isfile(os.path.join(root, "manuscript", "01-chapter-1.md"))
    assert os.path.isfile(os.path.join(root, "notes", "style-guide.md"))
    assert os.path.isfile(os.path.join(root, "notes", "outline.md"))


# ── And what it says about itself ────────────────────────────────────────────

def test_a_new_project_says_it_was_born_here(tmp_path):
    root = _create(tmp_path)
    assert _project_json(root)["codex_native"] is True
    assert migration_state(root) == "native"
    assert entries_home(root) == "codex"


def test_health_reports_native_with_nothing_elsewhere(tmp_path):
    root = _create(tmp_path)
    body = client.get("/api/codex/health",
                      params={"project_path": root}).json()
    assert body["entries_home"] == "codex"
    assert body["migration_state"] == "native"
    assert body["elsewhere"] == 0


def test_the_weave_is_never_offered_a_conversion_of_nothing(tmp_path):
    # THE WALL. WeaveScreen renders the conversion panel for "none" and for
    # "incomplete", and for nothing else -- so this assertion is what keeps a
    # new project's Weave tab showing the map. Read as source because the gate
    # is one `||` in a TSX file and rendering that screen would mean mocking
    # its whole API; the same choice Explain.test.tsx makes.
    root = _create(tmp_path)
    assert migration_state(root) == "native"

    here = os.path.dirname(os.path.abspath(__file__))
    screen = os.path.join(here, "..", "..", "app", "src", "features", "codex",
                          "WeaveScreen.tsx")
    with open(screen, "r", encoding="utf-8") as f:
        source = f.read()

    # The CONDITION only, cut at the `? (` that opens the branch. Reading as
    # far as <MigrationPanel would swallow the comment underneath it, which
    # explains why "native" is missing and so contains the word.
    gate = source[source.index("migration_state ==="):]
    gate = gate[:gate.index("? (")]
    assert '"incomplete"' in gate
    assert '"none"' in gate
    assert '"native"' not in gate, (
        "WeaveScreen sends 'native' to the conversion panel, which offers to "
        "convert nothing and gives the writer no way out of it."
    )


def test_a_native_project_is_told_there_is_nothing_to_convert(tmp_path):
    root = _create(tmp_path)
    plan = client.post("/api/codex/migrate",
                       params={"project_path": root, "dry_run": True}).json()
    assert plan["state"] == "native"
    assert plan["total"] == 0
    assert any("created in the Weave" in w for w in plan["warnings"])


def test_a_native_project_is_never_actually_converted(tmp_path):
    # Nothing on screen offers this, but the route is reachable, and letting
    # it run would do real damage rather than nothing: a journal, a types.json
    # the project deliberately does not have, and a codex_migration_version
    # relabelling a project that was never converted as converted.
    root = _create(tmp_path)
    result = run_migration(root)

    assert result["status"] == "codex-native"
    assert result["converted"] == 0
    assert not os.path.isfile(os.path.join(root, ".storythread",
                                           "codex-migration.json"))
    assert not os.path.isfile(os.path.join(root, "codex", "types.json"))
    assert "codex_migration_version" not in _project_json(root)
    assert migration_state(root) == "native"


# ── A book in a series ───────────────────────────────────────────────────────

def _series_with_book(tmp_path) -> tuple[str, str]:
    parent = tmp_path / "MySeries"
    parent.mkdir()
    res = client.post("/api/series/create", json={
        "folder_path": str(parent), "name": "The Ember Throne",
    })
    assert res.status_code == 200, res.text
    series = res.json()["root_path"]

    res = client.post("/api/projects/create-in-series", json={
        "series_path": series, "title": "Book One",
    })
    assert res.status_code == 200, res.text
    return series, res.json()["root_path"]


def test_a_book_in_a_series_is_born_here_too(tmp_path):
    _, book = _series_with_book(tmp_path)
    assert not os.path.exists(os.path.join(book, "profiles"))
    assert _subdirs(book, "codex") == ["characters", "events", "locations", "lore"]
    assert _project_json(book)["codex_native"] is True
    assert migration_state(book) == "native"


def test_a_book_in_a_series_gets_no_arcs_folder(tmp_path):
    # Two empty folders on every book, for an editor that was built, tested,
    # and wired to no control at all -- nothing in the app could ever put a
    # file in them. The conversion still READS arc files, for the projects
    # that have them; see _absorb_arcs.
    _, book = _series_with_book(tmp_path)
    assert not os.path.exists(os.path.join(book, "profiles", "arcs"))


def test_the_series_folder_still_keeps_its_own_profiles(tmp_path):
    # DELIBERATE, and pinned so a later pass cannot tidy it away by accident.
    # A series folder has no project.json, so it can never be converted and can
    # never answer "which home?" -- and the chip picker's "Series Profiles"
    # toggle reads it through the legacy API for exactly that reason. This
    # ruling was about book projects.
    series, _ = _series_with_book(tmp_path)
    assert _subdirs(series, "profiles") == [
        "characters", "locations", "lore", "relationships",
    ]


# ── Stamping a project that already exists ───────────────────────────────────

def _legacy_project(tmp_path, *, entries: dict[str, int] | None = None,
                    settings: dict | None = None) -> str:
    """A project made by an older build: profiles/ folders, no marker."""
    root = tmp_path / "OldNovel"
    (root / "manuscript").mkdir(parents=True)
    for folder in ("characters", "relationships", "locations", "lore"):
        (root / "profiles" / folder).mkdir(parents=True)
    data = {"project_id": "p-old", "title": "Old Novel", "description": "",
            "root_path": str(root), "story_type": "novel",
            "content_mode_default": "general", "default_model": None,
            "series_id": None, "series_path": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00"}
    data.update(settings or {})
    (root / "project.json").write_text(json.dumps(data), encoding="utf-8")

    for relative, count in (entries or {}).items():
        target = root / relative
        target.mkdir(parents=True, exist_ok=True)
        for i in range(count):
            (target / f"e{i}.md").write_text(ENTRY, encoding="utf-8")
    return str(root)


def _open(root: str) -> None:
    res = client.post("/api/projects/open", json={"folder_path": root})
    assert res.status_code == 200, res.text


def test_opening_an_empty_legacy_project_freezes_its_answer(tmp_path):
    # It was already being edited in codex/ -- by inference. Now it says so.
    root = _legacy_project(tmp_path)
    assert entries_home(root) == "codex"

    _open(root)
    assert _project_json(root)["codex_native"] is True
    assert migration_state(root) == "native"


def test_the_empty_folders_are_left_exactly_where_they_are(tmp_path):
    # Deleting a writer's directories without being asked is not ours to do,
    # and they cost nothing.
    root = _legacy_project(tmp_path)
    _open(root)
    assert _subdirs(root, "profiles") == [
        "characters", "locations", "lore", "relationships",
    ]


def test_a_project_with_work_in_profiles_is_not_stamped(tmp_path):
    # The whole safety of rule 3 in entries_home rests on this: the flag is
    # only ever written when there is nothing in profiles/ to hide.
    root = _legacy_project(tmp_path, entries={"profiles/lore": 1})
    _open(root)
    assert "codex_native" not in _project_json(root)
    assert entries_home(root) == "profiles"


def test_one_file_at_any_depth_is_enough_to_hold_the_stamp_back(tmp_path):
    # _holds_entries walks the whole tree, so an arc file, a legacy chapter
    # summary, or anything else buried under profiles/ counts as work.
    root = _legacy_project(tmp_path, entries={"profiles/arcs/characters": 1})
    _open(root)
    assert "codex_native" not in _project_json(root)


def test_a_converted_project_is_not_relabelled(tmp_path):
    # "done" and "native" are different claims. A converted project has a
    # backup on disk and a report to read; a native one has neither.
    root = _legacy_project(tmp_path,
                           settings={"codex_migration_version": 1})
    _open(root)
    assert "codex_native" not in _project_json(root)
    assert migration_state(root) == "done"


def test_an_interrupted_conversion_is_not_stamped(tmp_path):
    root = _legacy_project(tmp_path)
    os.makedirs(os.path.join(root, ".storythread"), exist_ok=True)
    with open(os.path.join(root, ".storythread", "codex-migration.json"),
              "w", encoding="utf-8") as f:
        f.write("{}\n")

    _open(root)
    assert "codex_native" not in _project_json(root)
    assert migration_state(root) == "incomplete"
    # And it still reads the folder a restore would put back.
    assert entries_home(root) == "profiles"


def test_the_stamp_happens_once_and_costs_nothing_else(tmp_path):
    # A backfill that rewrote project.json on every open would put churn in
    # the writer's git diff forever, and every rewrite is a chance to lose a
    # field. Also pins that the stamp carries the rest of the file through.
    root = _legacy_project(tmp_path, settings={"series_id": "s-1",
                                               "default_model": "x/y"})
    _open(root)
    after_first = _project_json(root)
    with open(os.path.join(root, "project.json"), "r", encoding="utf-8") as f:
        bytes_after_first = f.read()

    _open(root)
    with open(os.path.join(root, "project.json"), "r", encoding="utf-8") as f:
        assert f.read() == bytes_after_first

    assert after_first["title"] == "Old Novel"
    assert after_first["series_id"] == "s-1"
    assert after_first["default_model"] == "x/y"
    assert after_first["story_type"] == "novel"
