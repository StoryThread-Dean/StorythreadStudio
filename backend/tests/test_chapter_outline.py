"""
The chapter outline: the one per-chapter document that looks FORWARD.

A chapter summary is written from prose that already exists and says what the
chapter turned out to be. An outline is the other direction -- what has to
happen in this chapter, written before there is anything to summarise. The
writer's words: "the main key events that take place that move the scenes,
dialogue, action, events along."

The summaries have no test file of their own, which is why several of the
assertions below look obvious: this is the first per-chapter document to get
one, and the obvious things are the ones that break silently. A missing
`exists` flag turns an unwritten outline into an error screen; a missing
containment guard turns a filename off the wire into a path traversal; and a
file left behind by a rename is a plan for a chapter that no longer answers to
that name, which nothing will ever open again.

See docs/chapter-outline-spec.md.
"""

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

OUTLINE = """1. The column is spotted at dusk; Kipling counts seven and says so.
2. Vance argues for withdrawal. Milton overrules him in front of everyone.
3. The mercenaries hit the flank before the party has agreed a plan.
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "07-seven-to-one.md").write_text(
        "# Seven to One\n\nProse.\n", encoding="utf-8")
    (root / "manuscript" / "08-highest-bidder.md").write_text(
        "# Highest Bidder\n\nMore.\n", encoding="utf-8")
    return str(root)


def _outline_path(project: str, stem: str) -> str:
    return os.path.join(project, "outlines", "chapters", f"{stem}.md")


def _get(project: str, chapter: str):
    return client.get("/api/documents/chapter-outline", params={
        "folder_path": project, "chapter_filename": chapter})


def _save(project: str, chapter: str, content: str):
    return client.post("/api/documents/chapter-outline", json={
        "folder_path": project, "chapter_filename": chapter, "content": content})


# ── Reading and writing ──────────────────────────────────────────────────────

def test_a_chapter_nobody_has_planned_is_not_an_error(project):
    # `exists` is what lets the screen teach in the empty state. Without it a
    # 404 would be the ordinary answer for most chapters of most books.
    body = _get(project, "07-seven-to-one.md").json()
    assert body["exists"] is False
    assert body["content"] == ""
    assert body["filename"] == "07-seven-to-one.md"


def test_it_saves_and_reads_back_exactly(project):
    assert _save(project, "07-seven-to-one.md", OUTLINE).status_code == 200
    body = _get(project, "07-seven-to-one.md").json()
    assert body["exists"] is True
    assert body["content"] == OUTLINE


def test_the_folder_is_made_on_first_save_and_not_before(project):
    # Lazy, like summaries/. A project full of empty folders for documents the
    # writer has never used says the app expects something of them.
    assert not os.path.exists(os.path.join(project, "outlines"))
    _save(project, "07-seven-to-one.md", OUTLINE)
    assert os.path.isfile(_outline_path(project, "07-seven-to-one"))


def test_it_pairs_with_the_chapter_by_stem(project):
    _save(project, "07-seven-to-one.md", OUTLINE)
    assert os.path.isfile(_outline_path(project, "07-seven-to-one"))
    # And it is its own document, not something bolted into the summary.
    assert not os.path.exists(
        os.path.join(project, "summaries", "chapters", "07-seven-to-one.md"))


def test_the_writer_gets_back_what_they_typed(project):
    # NEVER PARSED. No numbering is imposed, no checkbox state is inferred, no
    # structure is read out of it -- docs/outline-spec.md ruled against
    # machine-read structure in a writer's file and this is a writer's file.
    # A writer who prefers dashes and paragraphs keeps them.
    freeform = "- she refuses\n\nThen a long paragraph about why, with no list at all.\n"
    _save(project, "07-seven-to-one.md", freeform)
    assert _get(project, "07-seven-to-one.md").json()["content"] == freeform


def test_it_ends_with_exactly_one_newline(project):
    _save(project, "07-seven-to-one.md", "1. A thing happens.\n\n\n\n")
    with open(_outline_path(project, "07-seven-to-one"), encoding="utf-8") as f:
        assert f.read() == "1. A thing happens.\n"


def test_saving_twice_overwrites_rather_than_appending(project):
    _save(project, "07-seven-to-one.md", "1. First.\n")
    _save(project, "07-seven-to-one.md", "1. Second.\n")
    assert _get(project, "07-seven-to-one.md").json()["content"] == "1. Second.\n"


def test_a_filename_cannot_climb_out_of_the_project(project):
    # The chapter filename arrives over HTTP. The guard resolves the path
    # first and checks containment after, because ".." and a symlink both
    # survive a check made before resolution.
    for attack in ("../../etc/passwd.md", "..\\..\\evil.md"):
        assert _get(project, attack).status_code == 400
        assert _save(project, attack, "x").status_code == 400


# ── Deleting ─────────────────────────────────────────────────────────────────

def test_an_outline_can_be_deleted(project):
    _save(project, "07-seven-to-one.md", OUTLINE)
    res = client.delete("/api/documents/chapter-outline", params={
        "folder_path": project, "chapter_filename": "07-seven-to-one.md"})
    assert res.status_code == 200
    assert not os.path.exists(_outline_path(project, "07-seven-to-one"))


def test_deleting_one_that_is_not_there_says_so(project):
    res = client.delete("/api/documents/chapter-outline", params={
        "folder_path": project, "chapter_filename": "07-seven-to-one.md"})
    assert res.status_code == 404


# ── The list, for the context picker ─────────────────────────────────────────

def test_the_list_is_empty_before_anything_is_planned(project):
    # Not an error. Having planned nothing is the ordinary state of a new book.
    res = client.get("/api/documents/chapter-outlines",
                     params={"folder_path": project})
    assert res.status_code == 200
    assert res.json() == []


def test_the_list_carries_the_chapter_title(project):
    # The picker shows the writer their chapter's name, not a filename stem.
    _save(project, "07-seven-to-one.md", OUTLINE)
    rows = client.get("/api/documents/chapter-outlines",
                      params={"folder_path": project}).json()
    assert len(rows) == 1
    assert rows[0]["chapter_filename"] == "07-seven-to-one.md"
    assert rows[0]["chapter_title"] == "Seven to One"


def test_the_list_is_in_reading_order(project):
    # Sorted the way the sidebar is, so chapter 10 does not come before
    # chapter 2 in a picker sitting next to a correctly ordered tree.
    for i, name in ((2, "02-b.md"), (10, "10-j.md"), (1, "01-a.md")):
        (os.path.join(project, "manuscript"),)
        with open(os.path.join(project, "manuscript", name), "w",
                  encoding="utf-8") as f:
            f.write(f"# Chapter {i}\n")
        _save(project, name, f"1. Chapter {i} happens.\n")

    rows = client.get("/api/documents/chapter-outlines",
                      params={"folder_path": project}).json()
    assert [r["chapter_filename"] for r in rows] == ["01-a.md", "02-b.md", "10-j.md"]


# ── The cascade: an outline belongs to its chapter ───────────────────────────

def test_renaming_a_chapter_takes_its_outline_along(project):
    _save(project, "07-seven-to-one.md", OUTLINE)
    res = client.post("/api/documents/rename-chapter", json={
        "folder_path": project, "filename": "07-seven-to-one.md",
        "new_title": "Seven Against One"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outline_moved"] is True

    new_stem = os.path.splitext(body["filename"])[0]
    assert not os.path.exists(_outline_path(project, "07-seven-to-one"))
    with open(_outline_path(project, new_stem), encoding="utf-8") as f:
        assert f.read() == OUTLINE


def test_a_chapter_with_no_outline_still_reports_success(project):
    # "Nothing to move counts as success" -- the same idiom the summary and
    # scene folders use. Without it every chapter that has never been planned
    # would report a failed rename step and warn the writer about nothing.
    res = client.post("/api/documents/rename-chapter", json={
        "folder_path": project, "filename": "07-seven-to-one.md",
        "new_title": "Seven Against One"})
    assert res.json()["outline_moved"] is True


def test_deleting_a_chapter_takes_its_outline_with_it(project):
    _save(project, "07-seven-to-one.md", OUTLINE)
    _save(project, "08-highest-bidder.md", "1. They outbid him.\n")

    res = client.delete("/api/documents/chapter", params={
        "folder_path": project, "filename": "07-seven-to-one.md"})
    assert res.status_code == 200
    assert res.json()["outline_removed"] is True

    assert not os.path.exists(_outline_path(project, "07-seven-to-one"))
    # The neighbour is untouched. A cascade that took more than its own
    # chapter would be the worst possible version of this.
    assert os.path.isfile(_outline_path(project, "08-highest-bidder"))


def test_deleting_a_chapter_that_had_no_outline_is_not_a_failure(project):
    res = client.delete("/api/documents/chapter", params={
        "folder_path": project, "filename": "07-seven-to-one.md"})
    assert res.status_code == 200
    assert res.json()["outline_removed"] is False


# ── Export ───────────────────────────────────────────────────────────────────

def test_outlines_are_exported_only_when_asked_for(project):
    # A separate flag from the summaries because it is the opposite document.
    # Someone sending their manuscript to a reader wants neither; someone
    # sending it to a collaborator may want one and not the other.
    _save(project, "07-seven-to-one.md", OUTLINE)
    os.makedirs(os.path.join(project, "exports"), exist_ok=True)

    def export(**flags):
        # The route writes a file and hands back its path, so the assertion
        # has to read what actually landed on disk rather than a response body.
        res = client.post("/api/export/full-manuscript", json={
            "folder_path": project, "format": "markdown", **flags})
        assert res.status_code == 200, res.text
        with open(res.json()["output_path"], encoding="utf-8") as f:
            return f.read()

    assert "Chapter Outlines" not in export()

    with_them = export(include_chapter_outlines=True)
    assert "# Chapter Outlines" in with_them
    assert "Vance argues for withdrawal" in with_them
