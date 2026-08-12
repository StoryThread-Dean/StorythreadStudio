# tests/test_before_the_story.py -- things that were true before page one
# =======================================================================
# The writer's second example, and it broke the model:
#
#   "Kipling the adventurer believes she is an orphan. Starts BEFORE chapter 1
#    when she is introduced to the reader as a grown young adult."
#
# There was no way to say that. A fact could be pinned to a chapter or left
# unplaced, and neither is true: chapter one says she was orphaned as the book
# opened, and unplaced is the Weave's word for "you have not told me yet", which
# it then asks about. Most of what is true about a character is true before the
# story starts -- an orphaning, a war, a house, a scar -- so the commonest case
# had the worst answer.
#
# BEFORE_STORY is a position below every real chapter. It is deliberate, so it is
# never Unplaced, and it is in force from the first page, so nothing hides it.

import json

import pytest
from fastapi.testclient import TestClient

from app.codex.anchors import ALWAYS, BEFORE_STORY, AnchorIndex
from app.codex.resolve import resolve_facts
from app.main import app

client = TestClient(app)


@pytest.fixture
def project(tmp_path):
    from app.utils.structure_store import ensure_chapter_ids

    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(
        json.dumps({"title": "N", "codex_migration_version": 1}), encoding="utf-8")
    for name, title in (("01-a.md", "The Road"), ("08-b.md", "The Letter")):
        (root / "manuscript" / name).write_text(f"# {title}\n\nText.\n",
                                                encoding="utf-8")
    (root / "codex" / "characters" / "kipling.md").write_text(
        "---\ntype: character\nentity_id: e-kipling\nname: Kipling\n---\n\n"
        "# Overview\nAn adventurer.\n", encoding="utf-8")
    ensure_chapter_ids(str(root))
    return str(root)


def _index(project) -> AnchorIndex:
    return AnchorIndex.for_project(project)


ORPHAN = {"id": "f-orphan", "axis": "family", "at": BEFORE_STORY,
          "value": "She is an orphan.", "frame": "truth"}


def test_it_resolves_to_a_position_below_every_chapter(project):
    assert _index(project).ordinal(BEFORE_STORY) == ALWAYS


def test_it_is_in_force_on_the_first_page(project):
    index = _index(project)
    chapters = client.get("/api/codex/anchors",
                          params={"project_path": project}).json()["chapters"]
    first = chapters[0]["anchor"]

    result = resolve_facts([ORPHAN], index, first)
    assert [f["value"] for f in result.facts] == ["She is an orphan."]


def test_it_is_never_reported_as_unplaced(project):
    # THE DISTINCTION THAT MATTERS. Unplaced means "you have not said when",
    # which Weaving asks the writer about. Before the story is an answer, and
    # being nagged about an answer teaches a writer to ignore the nagging.
    index = _index(project)
    result = resolve_facts([ORPHAN], index, None)
    assert result.unplaced == []


def test_an_unwritten_anchor_is_still_unplaced(project):
    # The other half: adding a real answer must not turn the missing one into a
    # silent default. A fact with nothing in the box is still a question.
    index = _index(project)
    result = resolve_facts([{**ORPHAN, "at": ""}], index, None)
    assert len(result.unplaced) == 1
    assert result.facts == []


def test_nothing_about_it_is_a_spoiler_by_default(project):
    # True from before page one and not stated to be a secret, so hiding it
    # would withhold the ordinary furniture of the world from every brief.
    index = _index(project)
    chapters = client.get("/api/codex/anchors",
                          params={"project_path": project}).json()["chapters"]
    result = resolve_facts([ORPHAN], index, chapters[0]["anchor"],
                           hide_spoilers=True)
    assert result.withheld_spoilers == 0
    assert result.facts


def test_it_can_still_be_held_back_from_the_reader(project):
    # Something true before the story that the reader learns in chapter eight --
    # a parentage, a betrayal. The two anchors are independent, which is the
    # whole reason they are separate fields.
    index = _index(project)
    chapters = client.get("/api/codex/anchors",
                          params={"project_path": project}).json()["chapters"]
    secret = {**ORPHAN, "revealed_at": chapters[1]["anchor"]}

    early = resolve_facts([secret], index, chapters[0]["anchor"], hide_spoilers=True)
    assert early.facts == []
    assert early.withheld_spoilers == 1

    late = resolve_facts([secret], index, chapters[1]["anchor"], hide_spoilers=True)
    assert [f["value"] for f in late.facts] == ["She is an orphan."]


def test_a_later_fact_still_supersedes_it(project):
    # Ordering has to keep working across the boundary: what was true before the
    # book can stop being true inside it.
    index = _index(project)
    chapters = client.get("/api/codex/anchors",
                          params={"project_path": project}).json()["chapters"]
    found = {"id": "f-found", "axis": "family", "at": chapters[1]["anchor"],
             "value": "Her mother is alive.", "frame": "truth"}

    result = resolve_facts([ORPHAN, found], index, chapters[1]["anchor"])
    assert [f["value"] for f in result.facts] == ["Her mother is alive."]


def test_it_survives_a_save(project):
    # It is written to the file as an anchor like any other, so it round trips
    # and a writer can read it in their own Markdown.
    thread = client.get("/api/codex/entity",
                        params={"project_path": project,
                                "entity_id": "e-kipling"}).json()
    thread["run"] = [ORPHAN]
    assert client.post("/api/codex/entity", json={
        "project_path": project, "thread": thread,
        "base_revision": thread.get("revision")}).status_code == 200

    again = client.get("/api/codex/entity",
                       params={"project_path": project,
                               "entity_id": "e-kipling"}).json()
    assert again["run"][0]["at"] == BEFORE_STORY


def test_the_resolver_and_the_anchor_index_agree_about_the_beginning():
    # One definition. The resolver used to carry its own copy of "below every
    # real position", and two definitions of where the book begins is two
    # answers to whether a fact is in force yet.
    from app.codex import resolve

    assert resolve._ALWAYS is ALWAYS
