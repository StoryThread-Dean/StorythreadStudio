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
#   interrupted         -> profiles/    (what a restore puts back)
#   converted           -> codex/       (that is what conversion means)
#   born in the Weave   -> codex/       (it says so; see below)
#   unconverted, in use -> profiles/    (never hide a world behind placeholders)
#   nothing yet         -> codex/       (a new project starts in the new world)
#
# THE THIRD RULE IS A STATEMENT AND THE FOURTH IS AN INFERENCE, which is why
# the order between those two is the whole point rather than an accident. A
# project created in the Weave used to reach codex/ only by the last rule --
# by nobody having put a file in profiles/ yet -- so one stray .md appearing
# there at any depth silently moved the writer's entire world to the legacy
# home. Nothing errored, nothing failed a test, and every codex entry simply
# stopped being listed.

import json
import os

from fastapi.testclient import TestClient

from app.codex.migrate import (
    CODEX_NATIVE_KEY, MIGRATION_VERSION, entries_home, journal_path,
    migration_state,
)
from app.codex.sections import build_sections
from app.main import app

client = TestClient(app)

ENTRY = "---\ntype: character\nname: Elara Voss\n---\n\n# Overview\nA tall woman.\n"


def _project(tmp_path, *, profiles=0, codex=0, converted=False,
             interrupted=False, native=None, name="MyNovel"):
    # `name` so one test can build two projects and compare them. Without it
    # the second call collides on mkdir and the failure reads like a bug in
    # the thing under test.
    root = tmp_path / name
    (root / "manuscript").mkdir(parents=True)
    settings = {"title": "N"}
    if converted:
        settings["codex_migration_version"] = MIGRATION_VERSION
    # `native` takes any value, not just True, because half of what these
    # tests are for is what the flag does when it is NOT true.
    if native is not None:
        settings[CODEX_NATIVE_KEY] = native
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


# ── Born in the Weave ─────────────────────────────────────────────

def test_a_stray_file_cannot_move_a_project_born_in_the_weave(tmp_path):
    """
    THE ONE THIS FLAG EXISTS FOR.

    Without it, the two tests above are the whole story: a new project reaches
    codex/ by the LAST rule, because nobody has put anything in profiles/ yet.
    That is an inference from a file count, and it reverses itself the moment
    the count changes -- an export saved to the wrong folder, a backup unzipped
    a level too high, one note. The writer's three codex entries stop being
    listed, the sidebar agrees with the editor that there is nothing there, and
    nothing anywhere errors, because "you have no characters" is an ordinary
    thing for this app to say.

    Reinstating the bug is how this was checked: drop `"native"` out of the
    rule at migrate.py and this test goes red while every other test in the
    suite stays green.
    """
    project = _project(tmp_path, native=True, codex=3, profiles=1)
    assert entries_home(project) == "codex"


def test_no_value_of_the_flag_can_send_a_project_back_to_profiles(tmp_path):
    """
    The guarantee is narrow and it is the one that matters: this key can say
    "codex", and it can say nothing. It can never say "profiles".

    That asymmetry is deliberate rather than tidy. project.json is a file a
    person can open, and a key that could route a project to the legacy home
    could hide a world that is really there -- an empty Profile Builder is
    indistinguishable from having lost everything. A key that can only ever
    point at codex/ has no such failure: if work does turn up in profiles/,
    GET /health counts it as `elsewhere` and the screen says so out loud.

    It is read with a plain truth test, so falsy falls through to the ordinary
    rules exactly as an absent key does, and any truthy junk reads as "yes,
    born here" -- which is the harmless direction.
    """
    # Falsy: falls through, and the writer's profiles/ world is found.
    assert entries_home(
        _project(tmp_path, native=False, profiles=2, name="a")) == "profiles"
    # Falsy with nothing in profiles/: the last rule still says codex/.
    assert entries_home(
        _project(tmp_path, native=False, codex=2, name="b")) == "codex"
    # Truthy junk: read as "yes". Never as "profiles", which is the point.
    assert entries_home(
        _project(tmp_path, native="profiles", profiles=2, name="c")) == "codex"


def test_an_interrupted_conversion_outranks_the_flag(tmp_path):
    # A journal can only exist on a project that ran a conversion, which a
    # project born here cannot have done -- so if these two ever contradict
    # each other on disk, the contradiction came from a hand edit. The answer
    # that loses has to be the one that cannot lose files, and profiles/ is
    # what a restore puts back.
    project = _project(tmp_path, native=True, codex=2, profiles=5,
                       interrupted=True)
    assert entries_home(project) == "profiles"


def test_the_state_says_native_rather_than_converted(tmp_path):
    # "done" is a claim that a conversion RAN: it implies a backup on disk and
    # a report to open. A project born here has neither, and the screen that
    # offers to show "what the conversion did" would have nothing to show.
    assert migration_state(_project(tmp_path, native=True, name="a")) == "native"
    assert migration_state(_project(tmp_path, converted=True, name="b")) == "done"
    assert migration_state(_project(tmp_path, profiles=2, name="c")) == "none"


def test_a_real_conversion_still_outranks_the_flag(tmp_path):
    # Both keys present is a state nothing in the app produces, but a file a
    # person can edit is a file a person can edit. Converted wins, because it
    # is the claim with a backup behind it.
    project = _project(tmp_path, native=True, converted=True, codex=2)
    assert migration_state(project) == "done"
    assert entries_home(project) == "codex"


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
