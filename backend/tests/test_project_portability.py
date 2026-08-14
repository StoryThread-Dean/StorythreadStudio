# tests/test_project_portability.py -- carrying a book to another computer
# =========================================================================
# Asked by the writer, 2026-08-14, and it is the kind of question that only ever
# gets asked after a release:
#
#   "Authors work from multiple computers or need to transfer their project from
#    one computer to another at some point. I know the manuscript, profiles,
#    outline, notes, etc can be copied over via the full folder ... Can these
#    connections and everything recorded in The Weave and Weaving process be
#    copied over exactly?"
#
# Nothing was checking it. The design says yes -- Markdown is the source of
# truth, SQLite is a cache, and everything lives under the project folder -- but
# a design saying yes and the code doing it are different claims, and this repo
# has been burned by exactly that gap more than once.
#
# WHAT WOULD BREAK IT, and what these tests are really watching for: an absolute
# path written INTO the data. `C:\\Users\\Dean\\...` stored in app.db, in a run
# file, or in project.json is correct on the machine that wrote it and wrong
# everywhere else. It fails silently, because a path that does not resolve looks
# exactly like a thing the writer has not made yet.
#
# Three transfers are tested, because writers do all three:
#
#   A. The whole folder, dotfolder included -- a plain copy, a zip, a USB stick.
#   B. The whole folder MINUS .storythread -- what a dotfile-skipping sync
#      client, a "select the visible files" drag, or a git repo actually
#      delivers. This one LOSES something, and the test says exactly what.
#   C. app.db deleted -- a partial copy, or a writer clearing the cache.
#
# Each moves the project to a path that shares nothing with the original: a
# different user name, a different drive layout, a different folder name.

import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils.structure_store import ensure_chapter_ids

client = TestClient(app)

ELARA = """---
type: character
entity_id: e-elara
name: Elara Voss
---

# Overview
A tall woman who believes her father died.
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
def written(tmp_path):
    """
    A project on "computer one" with real Weave work in it.

    Deliberately one of everything that could have been stored badly: a
    connection carrying a reason, a fact anchored to a chapter (anchors are ids
    minted per project, so they are a prime candidate for machine-specific
    state), and a Weaving session holding all three kinds of answer.
    """
    root = tmp_path / "Users" / "Dean" / "Documents" / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    # Written the way `POST /api/projects/create` writes it, absolute
    # `root_path` included, because that field is the whole point of one of the
    # tests below and a hand-trimmed version would not have it.
    (root / "project.json").write_text(json.dumps({
        "project_id": "p-portability", "title": "Portability",
        "description": "", "root_path": str(root),
        "content_mode_default": "general", "default_model": None,
        "series_id": None, "series_path": None,
        "model_routing_enabled": True, "allow_explicit_routing": True,
        "cost_tier": "balanced", "active_style_guide": "notes/style-guide.md",
        "story_type": "novel", "outline_template": "three-act",
        "created_at": "2026-08-14T00:00:00+00:00",
        "updated_at": "2026-08-14T00:00:00+00:00",
    }), encoding="utf-8")
    # The prose deliberately contains a name with NO entry, twice, so it clears
    # the frequency floor and the walk really does have something to ask. A
    # fixture where nothing is found would let the "nothing is asked" assertion
    # further down pass without the writer's answers doing any work at all.
    (root / "manuscript" / "01-a.md").write_text(
        "# Chapter One\n\nElara crossed the hall past Blaskowitz Sideburn.\n"
        "Garrick was waiting there, and Blaskowitz Sideburn watched them both.\n",
        encoding="utf-8")
    ensure_chapter_ids(str(root))
    (root / "codex" / "characters" / "elara.md").write_text(ELARA, encoding="utf-8")
    (root / "codex" / "characters" / "garrick.md").write_text(GARRICK, encoding="utf-8")
    # And an entry nothing connects to, so the muted `loose_thread` kind has
    # something to be muted ABOUT. Same reasoning as the name above: a silenced
    # question that was never going to be asked proves nothing.
    #
    # A CHARACTER rather than a location, and the difference is a real rule
    # rather than a detail of this fixture: a passive type (location, lore,
    # faction, deity) with no connections is not a problem and is never raised.
    # A cold place that nobody has been tied to yet is just a place.
    (root / "codex" / "characters" / "marisol.md").write_text(
        "---\ntype: character\nentity_id: e-marisol\nname: Marisol\n---\n\n"
        "# Overview\nA woman nobody is connected to yet.\n", encoding="utf-8")

    project = str(root)
    anchor = client.get("/api/codex/anchors",
                        params={"project_path": project}).json()["chapters"][0]["anchor"]

    assert client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "dst_id": "e-garrick",
        "rel": "mentored_by", "reason": "He raised her after the fire.",
    }).status_code == 200
    assert client.post("/api/codex/fact", json={
        "project_path": project, "entity_id": "e-elara",
        "fact": {"axis": "belief.father", "value": "Believes her father died.",
                 "at": anchor, "frame": "e-elara", "ai_scope": "always"},
    }).status_code == 200

    run_id = client.post("/api/codex/run", json={
        "project_path": project, "depth": "warp"}).json()["run_id"]
    # The three kinds of answer, which are stored in two different places.
    client.post("/api/codex/run/answer", json={
        "project_path": project, "run_id": run_id,
        "retire_phrase": "Blaskowitz Sideburn"})
    client.post("/api/codex/run/answer", json={
        "project_path": project, "run_id": run_id, "mute": "loose_thread"})
    client.post("/api/codex/run/answer", json={
        "project_path": project, "run_id": run_id,
        "key": "unspun|elara", "state": "deferred"})
    return project


def _move(source: str, tmp_path, name: str, *,
          skip_dotfolder=False, drop_db=False) -> str:
    """
    The copy a writer actually performs, landing somewhere that shares no path
    component with the original. If any machine-specific state were stored, this
    is where it would stop resolving.
    """
    dest = tmp_path / "Volumes" / "WorkLaptop" / "K Reyes" / "Writing" / name
    if skip_dotfolder:
        shutil.copytree(
            source, dest,
            ignore=lambda folder, names: (
                [".storythread"]
                if os.path.abspath(folder) == os.path.abspath(source) else []))
    else:
        shutil.copytree(source, dest)
    if drop_db:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(os.path.join(dest, ".storythread", "app.db") + suffix)
            except OSError:
                pass
    return str(dest)


def _world(project: str) -> tuple:
    """What the app can tell the writer about their world, as one comparable."""
    graph = client.get("/api/codex/graph", params={"project_path": project}).json()
    entity = client.get("/api/codex/entity",
                        params={"project_path": project,
                                "entity_id": "e-elara"}).json()
    thread = entity.get("thread") or entity
    return (len(graph.get("nodes", [])),
            len(graph.get("edges", [])),
            len(thread.get("run", []) or []))


# ── The world itself ─────────────────────────────────────────────────────────

def test_the_whole_weave_survives_a_move_to_another_machine(written, tmp_path):
    """A. The ordinary transfer, and the one that must be perfect."""
    before = _world(written)
    assert before == (3, 1, 1), "fixture did not build what these tests assume"
    assert _world(_move(written, tmp_path, "A")) == before


def test_a_connection_keeps_its_reason_and_direction_across_the_move(written, tmp_path):
    # The reason is the whole point of a connection here -- the Weave exists so a
    # writer need not paste context, and "A connected to B" spends brief budget
    # to say nothing. Losing it would leave the edge looking intact.
    moved = _move(written, tmp_path, "reason")
    edges = client.get("/api/codex/graph",
                       params={"project_path": moved}).json()["edges"]
    assert len(edges) == 1
    assert edges[0]["src_id"] == "e-elara"
    assert edges[0]["dst_id"] == "e-garrick"
    assert edges[0]["reason"] == "He raised her after the fire."


def test_a_fact_still_points_at_the_chapter_it_was_anchored_to(written, tmp_path):
    # Anchors are ids minted per project and stored in structure.json. If they
    # were derived from anything machine-specific, a moved fact would come back
    # Unplaced -- which reads as "the writer never placed it", not as damage.
    moved = _move(written, tmp_path, "anchor")
    entity = client.get("/api/codex/entity",
                        params={"project_path": moved,
                                "entity_id": "e-elara"}).json()
    fact = (entity.get("thread") or entity)["run"][0]
    assert fact["at"], "the fact came back unanchored after the move"
    chapters = client.get("/api/codex/anchors",
                          params={"project_path": moved}).json()["chapters"]
    assert fact["at"] in {c["anchor"] for c in chapters}


def test_no_file_in_a_moved_project_still_names_the_old_machine(written, tmp_path):
    """
    THE ROOT-CAUSE TEST. Everything above checks a symptom; this checks the
    cause, and it is the one that will catch a regression written years from now
    by someone storing a convenient absolute path in a new file.
    """
    moved = _move(written, tmp_path, "paths")

    # BOTH SPELLINGS, and this is not pedantry -- the first version of this test
    # searched for the raw path only and passed while project.json sat there
    # holding the old machine's location. JSON escapes backslashes, so a Windows
    # path written by json.dump appears on disk as C:\\Users\\Dean and never
    # matches a search for C:\Users\Dean. A detector that cannot see the most
    # likely offender is worse than no detector, because it reports safety.
    spellings = {written, written.replace("\\", "\\\\"), written.replace("\\", "/")}

    stale = []
    for folder, _dirs, files in os.walk(moved):
        for name in files:
            path = os.path.join(folder, name)
            try:
                text = open(path, "r", encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            if any(spelling in text for spelling in spellings):
                stale.append(os.path.relpath(path, moved))
    # project.json is the ONE known exception and it is a safe one: `root_path`
    # is written at creation and overwritten from the folder actually opened, so
    # the stale copy is never trusted. It is excluded here by name rather than by
    # loosening the search, so that a SECOND file gaining an absolute path fails
    # this test instead of quietly joining an allowance.
    stale = [s for s in stale if s != "project.json"]
    assert stale == [], (
        f"these files still contain computer one's path: {stale}. An absolute "
        f"path stored in project data is correct on the machine that wrote it "
        f"and silently wrong on every other one."
    )


def test_opening_a_moved_project_heals_the_one_stale_path_it_has(written, tmp_path):
    """
    The exception above, checked rather than asserted in a comment.

    If this healing ever stops happening, the test above starts allowing a
    genuinely stale path -- so the two belong together.
    """
    moved = _move(written, tmp_path, "heal")
    before = json.loads(open(os.path.join(moved, "project.json"),
                             encoding="utf-8").read())
    assert before["root_path"] == written, "fixture no longer sets up the problem"

    opened = client.post("/api/projects/open", json={"folder_path": moved})
    assert opened.status_code == 200
    assert opened.json()["root_path"] == moved


# ── The cache really is a cache ──────────────────────────────────────────────

def test_deleting_app_db_costs_the_writer_nothing(written, tmp_path):
    """C. The dual-storage promise, stated in CLAUDE.md, actually checked."""
    before = _world(written)
    assert _world(_move(written, tmp_path, "C", drop_db=True)) == before


# ── The one thing a transfer CAN lose ────────────────────────────────────────

def test_the_world_survives_even_without_the_dotfolder(written, tmp_path):
    """
    B. The reassuring half: entries, connections and facts are Markdown under
    `codex/`, so they travel however the writer copies the folder.
    """
    before = _world(written)
    assert _world(_move(written, tmp_path, "B", skip_dotfolder=True)) == before


def test_but_the_weaving_ANSWERS_do_not_and_the_walk_asks_again(written, tmp_path):
    """
    B, the half worth knowing about, pinned so nobody later assumes otherwise.

    What a writer answered during Weaving is deliberately not derivable from
    anything -- that is why it lives in `.storythread/weave/` rather than in
    app.db, so clearing the cache never costs answers. The flip side is that a
    transfer which skips the dotfolder loses them, and loses them QUIETLY: the
    walk simply asks everything again, which is indistinguishable from having
    never answered.

    Not asserted as correct behaviour. Asserted so that the cost is written
    down, because the alternative to knowing this is a writer redoing a session
    and never understanding why.
    """
    kept = _move(written, tmp_path, "kept")
    lost = _move(written, tmp_path, "lost", skip_dotfolder=True)

    def stops(project):
        return client.post("/api/codex/scan", json={
            "project_path": project, "depth": "warp"}).json()["stops"]

    # Everything was answered on computer one, so nothing is asked.
    assert stops(kept) == []
    # Without the dotfolder, the retirement and the mute are both gone.
    kinds = sorted({s["kind"] for s in stops(lost)})
    assert kinds == ["loose_thread", "unspun"]

    # And the sessions themselves are gone, so there is nothing to carry on.
    assert client.get("/api/codex/runs",
                      params={"project_path": kept}).json()["runs"]
    assert client.get("/api/codex/runs",
                      params={"project_path": lost}).json()["runs"] == []
