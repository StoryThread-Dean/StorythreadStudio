# tests/test_series_path_healing.py -- the series folder moved, or was renamed
# ============================================================================
# Reported 2026-08-25, opening Book Details on a book in a series:
#
#     Folder not found: C:/Users/<name>/Documents/Storythread Studio/
#     the-living-code-sata
#
# Two things wrong in one string, and neither was the writer's mistake:
#
#   1. They renamed the folder by hand early on to fix a typo, sata -> saga.
#   2. The whole vault had since moved to C:/Storythread Studio.
#
# `root_path` has been healed on open since portability work went in, because a
# project folder can be moved or renamed. `series_path` is exactly the same kind
# of value -- a stored absolute path -- and nothing healed it. It was simply
# trusted, by thirty places in this backend.
#
# test_project_portability.py exists and covers a project with
# `series_path: None`, so the "a book moves between computers" claim was true
# only for books that are not in a series. These are the other half.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _series_with_book(tmp_path, stored_series_path: str | None,
                      series_folder: str = "the-living-code-saga"):
    """A book inside a series, with whatever series_path the file claims."""
    series = tmp_path / series_folder
    series.mkdir()
    (series / "series.json").write_text(json.dumps({
        "series_id": "s-1", "name": "The Living Code Saga",
        "genre": "", "subgenre": "", "tone": "", "pacing": "",
        "target_audience": "", "content_mode": "general", "keywords": [],
        "root_path": str(series),
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")

    book = series / "book-one"
    book.mkdir()
    (book / "project.json").write_text(json.dumps({
        "project_id": "p-1", "title": "Book One", "description": "",
        "root_path": str(book), "story_type": "novel",
        "content_mode_default": "general", "default_model": None,
        "series_id": "s-1", "series_path": stored_series_path,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")
    return series, book


def _stored_series_path(book) -> str:
    return json.loads((book / "project.json").read_text(encoding="utf-8"))["series_path"]


def test_a_renamed_series_folder_is_found_again(client, tmp_path):
    # THE REPORTED CASE. The file still says "...the-living-code-sata"; the
    # folder on disk is "the-living-code-saga".
    series, book = _series_with_book(
        tmp_path, str(tmp_path / "the-living-code-sata"))

    resp = client.post("/api/projects/open", json={"folder_path": str(book)})
    assert resp.status_code == 200, resp.text
    assert resp.json()["series_path"] == str(series)


def test_a_moved_vault_is_found_again(client, tmp_path):
    # The other half of the same report: the whole vault moved, so the stored
    # path is wrong in its parent directories too, not just its last segment.
    _, book = _series_with_book(
        tmp_path, r"C:/Users/somebody/Documents/Storythread Studio/whatever")

    resp = client.post("/api/projects/open", json={"folder_path": str(book)})
    assert resp.status_code == 200
    assert os.path.isfile(
        os.path.join(resp.json()["series_path"], "series.json"))


def test_the_repair_is_written_back_to_disk(client, tmp_path):
    # THE PART THAT MATTERS BEYOND THIS SCREEN. Thirty places read project.json
    # off disk for themselves -- the story context AI receives, the audiobook
    # prefill, series-level canonical profiles. An in-memory patch would fix
    # Book Details and leave all of them pointed at a folder that is not there.
    series, book = _series_with_book(tmp_path, str(tmp_path / "old-name"))
    client.post("/api/projects/open", json={"folder_path": str(book)})
    assert _stored_series_path(book) == str(series)


def test_a_correct_path_is_left_completely_alone(client, tmp_path):
    # No rewrite, no churn in the writer's git diff, on the ordinary case.
    series, book = _series_with_book(tmp_path, None)
    (book / "project.json").write_text(json.dumps({
        "project_id": "p-1", "title": "Book One", "description": "",
        "root_path": str(book), "story_type": "novel",
        "content_mode_default": "general", "default_model": None,
        "series_id": "s-1", "series_path": str(series),
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")
    before = (book / "project.json").read_text(encoding="utf-8")

    client.post("/api/projects/open", json={"folder_path": str(book)})
    assert (book / "project.json").read_text(encoding="utf-8") == before


def test_a_book_that_is_not_in_a_series_is_untouched(client, tmp_path):
    # No series_id means no series. The parent folder of a loose project is the
    # vault, and the vault is not a series -- but the guard is series_id, so
    # this never even looks.
    book = tmp_path / "loose-book"
    book.mkdir()
    (book / "project.json").write_text(json.dumps({
        "project_id": "p-2", "title": "Loose", "description": "",
        "root_path": str(book), "story_type": "novel",
        "content_mode_default": "general", "default_model": None,
        "series_id": None, "series_path": None,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")

    resp = client.post("/api/projects/open", json={"folder_path": str(book)})
    assert resp.status_code == 200
    assert not resp.json().get("series_path")


def test_a_book_taken_out_of_its_series_keeps_what_it_was_told(client, tmp_path):
    # The one case that must NOT be healed. The parent holds no series.json, so
    # the book is somewhere else now. "The series folder moved" and "this is not
    # in a series any more" are different states, and only the writer knows
    # which happened -- so the stored value is left for them to see.
    orphan = tmp_path / "somewhere-else"
    orphan.mkdir()
    (orphan / "project.json").write_text(json.dumps({
        "project_id": "p-3", "title": "Orphan", "description": "",
        "root_path": str(orphan), "story_type": "novel",
        "content_mode_default": "general", "default_model": None,
        "series_id": "s-1", "series_path": str(tmp_path / "gone"),
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")

    resp = client.post("/api/projects/open", json={"folder_path": str(orphan)})
    assert resp.status_code == 200
    assert resp.json()["series_path"] == str(tmp_path / "gone")


def test_renaming_the_series_works_after_the_heal(client, tmp_path):
    # End to end, which is what the writer was actually trying to do when the
    # error appeared: open the book, then rename its series from Book Details.
    series, book = _series_with_book(
        tmp_path, str(tmp_path / "the-living-code-sata"))

    healed = client.post("/api/projects/open",
                         json={"folder_path": str(book)}).json()["series_path"]
    resp = client.put("/api/series/settings", json={
        "folder_path": healed, "name": "The Living Code Saga, Book One",
    })
    assert resp.status_code == 200, resp.text
    assert json.loads((series / "series.json").read_text(encoding="utf-8"))["name"] \
        == "The Living Code Saga, Book One"
