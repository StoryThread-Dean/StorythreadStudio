"""
A prologue is not chapter zero, and an epilogue is not the last chapter.

Adding chapters worked; there was no way to add either of these, and treating
one as a chapter is wrong in ways the writer can see:

  - It has no chapter NUMBER. Every manuscript file carried a numeric `NN-`
    prefix, which drives reading order in a project with no manifest and is
    what "Chapter 2" is read from.
  - It sits OUTSIDE the acts. An act of one is a lie about the shape of the
    book, and `unassigned` means "not filed yet" -- the opposite of a piece
    whose position is the one certain thing about it.
  - It is not what the writer means by "thirty chapters".

So the manifest grows two lists, `front` and `back`, and reading order becomes
front, then the acts, then unassigned, then back. The manifest is already THE
ordering authority (`ordered_chapter_filenames`), so every consumer -- the
sidebar, Reader Mode, exports, the progress gauge, the Weave's anchors -- picks
this up without knowing anything new.

THE TWO FAILURES THAT WOULD BE SILENT are both tested below: an act reorder
sweeping the prologue into `unassigned`, and a prologue on disk consuming a
chapter number so the next chapter skips one.
"""

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils.structure_store import (
    front_matter_filenames,
    load_structure,
    ordered_chapter_filenames,
    save_structure,
)

client = TestClient(app)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    for name, title in (("01-chapter-1.md", "Chapter 1"),
                        ("02-chapter-2.md", "Chapter 2")):
        (root / "manuscript" / name).write_text(f"# {title}\n\nWords here.\n",
                                                encoding="utf-8")
    return str(root)


def _create(project: str, title: str, kind: str = "chapter"):
    return client.post("/api/documents/create-chapter", json={
        "folder_path": project, "title": title, "kind": kind})


def _order(project: str) -> list[str]:
    return ordered_chapter_filenames(project)


# ── Creating one ─────────────────────────────────────────────────────────────

def test_a_prologue_gets_no_chapter_number(project):
    res = _create(project, "Prologue", "front")
    assert res.status_code == 200, res.text
    assert res.json()["filename"] == "prologue.md"


def test_an_epilogue_gets_no_chapter_number(project):
    assert _create(project, "Epilogue", "back").json()["filename"] == "epilogue.md"


def test_a_chapter_is_still_numbered(project):
    assert _create(project, "The Storm").json()["filename"] == "03-the-storm.md"


def test_a_prologue_comes_first_and_an_epilogue_last(project):
    _create(project, "Epilogue", "back")
    _create(project, "Prologue", "front")

    assert _order(project) == [
        "prologue.md", "01-chapter-1.md", "02-chapter-2.md", "epilogue.md",
    ]


def test_a_prologue_does_not_consume_a_chapter_number(project):
    # THE SILENT ONE. `next_num` used max(highest_prefix, FILE COUNT) + 1, so
    # an unnumbered file on disk pushed the sequence along: prologue plus two
    # chapters offered "04" next and skipped 03 with nothing to explain it.
    _create(project, "Prologue", "front")
    assert _create(project, "The Storm").json()["filename"] == "03-the-storm.md"


def test_creating_one_brings_the_manifest_into_existence(project):
    # Unlike a chapter, which is a no-op for a project with no manifest.
    # Without one the reading order is a filename sort, and "epilogue.md"
    # sorts BEFORE "prologue.md" and both after "01-". The manifest is the
    # only thing that can say a file goes first.
    assert not os.path.isfile(os.path.join(project, "manuscript", "structure.json"))
    _create(project, "Prologue", "front")
    assert os.path.isfile(os.path.join(project, "manuscript", "structure.json"))


def test_it_is_not_left_sitting_in_unassigned(project):
    # Healing appends anything on disk it does not recognise to `unassigned`,
    # so the file is in there for a moment before it is claimed. If the claim
    # did not remove it, it would be listed twice and drawn twice.
    _create(project, "Prologue", "front")
    manifest, _ = load_structure(project)
    assert manifest["front"] == ["prologue.md"]
    assert "prologue.md" not in manifest["unassigned"]


def test_an_unknown_kind_is_treated_as_a_chapter(project):
    # A client sending nonsense gets the ordinary behaviour rather than a
    # file in a list nothing reads.
    res = client.post("/api/documents/create-chapter", json={
        "folder_path": project, "title": "Odd", "kind": "sideways"})
    assert res.json()["filename"] == "03-odd.md"


# ── It survives everything a chapter survives ────────────────────────────────

def test_renaming_keeps_it_in_front(project):
    # Swapped IN PLACE. Dropping and re-adding would put it in `unassigned`,
    # which is the one list that cannot say "this goes first".
    _create(project, "Prologue", "front")
    res = client.post("/api/documents/rename-chapter", json={
        "folder_path": project, "filename": "prologue.md",
        "new_title": "Before the Fall"})
    assert res.status_code == 200, res.text
    new_name = res.json()["filename"]

    manifest, _ = load_structure(project)
    assert manifest["front"] == [new_name]
    assert _order(project)[0] == new_name


def test_renaming_it_keeps_the_bare_slug(project):
    # There is no numeric prefix to preserve, and inventing one would put it
    # into the chapter sequence.
    _create(project, "Prologue", "front")
    res = client.post("/api/documents/rename-chapter", json={
        "folder_path": project, "filename": "prologue.md",
        "new_title": "Before the Fall"})
    assert res.json()["filename"] == "before-the-fall.md"


def test_deleting_it_takes_it_out_of_the_manifest(project):
    _create(project, "Prologue", "front")
    client.delete("/api/documents/chapter",
                  params={"folder_path": project, "filename": "prologue.md"})
    manifest, _ = load_structure(project)
    assert manifest["front"] == []
    assert "prologue.md" not in _order(project)


def test_an_act_reorder_does_not_demote_it(project):
    """
    THE OTHER SILENT ONE, and the reason `front` is not in the PUT payload.

    The acts tree is what the writer drags things around in, and a prologue is
    not in that tree. If the PUT rebuilt the manifest from the payload alone,
    every reorder would drop `front` on the floor -- healing would find the
    file on disk, append it to `unassigned`, and the writer's prologue would
    quietly become an unfiled chapter somewhere in the middle of the book.

    Same shape as chapter_ids, which are carried across for the same reason.
    """
    _create(project, "Prologue", "front")
    _create(project, "Epilogue", "back")

    res = client.put("/api/structure", json={
        "folder_path": project,
        "acts": [{"id": None, "title": "Act I",
                  "chapters": ["02-chapter-2.md", "01-chapter-1.md"]}],
        "unassigned": [],
    })
    assert res.status_code == 200, res.text

    manifest, _ = load_structure(project)
    assert manifest["front"] == ["prologue.md"]
    assert manifest["back"] == ["epilogue.md"]
    assert _order(project) == [
        "prologue.md", "02-chapter-2.md", "01-chapter-1.md", "epilogue.md",
    ]


def test_the_tree_reports_them_so_the_sidebar_can_draw_them(project):
    _create(project, "Prologue", "front")
    _create(project, "Epilogue", "back")
    body = client.get("/api/structure", params={"folder_path": project}).json()

    assert [c["filename"] for c in body["front"]] == ["prologue.md"]
    assert [c["filename"] for c in body["back"]] == ["epilogue.md"]
    assert [c["filename"] for c in body["unassigned"]] == [
        "01-chapter-1.md", "02-chapter-2.md"]


def test_a_hand_edited_manifest_keeps_a_prologue_a_prologue(project):
    # Front is claimed before the acts during healing, so a file listed in
    # both stays where its position is meaningful. A writer who edits
    # structure.json by hand should not have their prologue demoted to
    # chapter one of Act I.
    _create(project, "Prologue", "front")
    manifest, _ = load_structure(project)
    manifest["acts"] = [{"id": "a-1", "title": "Act I",
                         "chapters": ["prologue.md", "01-chapter-1.md"]}]
    save_structure(project, manifest)

    healed, _ = load_structure(project)
    assert healed["front"] == ["prologue.md"]
    assert healed["acts"][0]["chapters"] == ["01-chapter-1.md"]
    assert _order(project)[0] == "prologue.md"


# ── What counts as a chapter ─────────────────────────────────────────────────

def test_front_matter_is_named_for_the_things_that_count_chapters(project):
    _create(project, "Prologue", "front")
    _create(project, "Epilogue", "back")
    assert front_matter_filenames(project) == ["prologue.md", "epilogue.md"]


def test_a_project_with_neither_reports_none(project):
    assert front_matter_filenames(project) == []


def test_the_gauge_counts_the_words_but_not_the_chapter(project):
    # A writer who set a target of thirty and wrote a prologue plus thirty
    # chapters has written thirty chapters. Their prologue's words are still
    # theirs, and still count towards the manuscript total.
    _create(project, "Prologue", "front")
    with open(os.path.join(project, "manuscript", "prologue.md"), "w",
              encoding="utf-8") as f:
        f.write("# Prologue\n\n" + " ".join(["word"] * 500) + "\n")

    data = client.get("/api/progress/summary",
                      params={"project_path": project}).json()
    assert data["manuscript"]["chapter_count"] == 2      # not 3
    assert data["manuscript"]["actual_words"] >= 500     # the words are counted


# ── The Weave ────────────────────────────────────────────────────────────────

def test_a_prologue_gets_an_anchor_like_any_other_chapter(project):
    # Things happen in a prologue, and the writer must be able to anchor a
    # fact to them. `ensure_chapter_ids` walks the reading order, so this
    # comes free the moment the file is in it -- asserted because "free" is
    # a claim about code that could stop being true.
    from app.utils.structure_store import ensure_chapter_ids

    _create(project, "Prologue", "front")
    ids = ensure_chapter_ids(project)
    assert ids.get("prologue.md")


def test_the_scrubber_sees_it_first(project):
    _create(project, "Prologue", "front")
    body = client.get("/api/codex/anchors",
                      params={"project_path": project}).json()
    assert body["chapters"][0]["filename"] == "prologue.md"
    assert body["chapters"][0]["title"] == "Prologue"
