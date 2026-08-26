# tests/test_series_settings.py -- renaming a series after it exists
# ==================================================================
# Reported 2026-08-25 as an oversight, and it was one: "This is technically the
# only place the writer can Create the series and/or change its name."
#
# The series name was typed once, into a checkbox on the new-book form, before
# the writer had written a word of the thing they were naming -- and then it was
# permanent. series.py had create, open and list-books, and no way to change
# anything. Every other name in the app can be corrected.
#
# These tests are about the two ways a rename can go wrong: losing the fields
# nobody sent, and moving the folder every book points at.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def series(tmp_path):
    """A series folder on disk, as create_series would leave it."""
    folder = tmp_path / "the-ashen-crown"
    folder.mkdir()
    data = {
        "series_id": "s-1",
        "name": "The Ashen Crown",
        "genre": "Fantasy",
        "subgenre": "Grimdark",
        "tone": "Bleak",
        "pacing": "Slow burn",
        "target_audience": "Adult",
        "content_mode": "mature",
        "keywords": ["ash", "crown"],
        "root_path": str(folder),
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    (folder / "series.json").write_text(json.dumps(data), encoding="utf-8")
    return folder


def _read(folder) -> dict:
    return json.loads((folder / "series.json").read_text(encoding="utf-8"))


def test_the_name_can_be_changed_after_creation(client, series):
    resp = client.put("/api/series/settings", json={
        "folder_path": str(series), "name": "The Ashen Throne",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "The Ashen Throne"
    # Persisted, not just echoed.
    assert _read(series)["name"] == "The Ashen Throne"


def test_a_field_left_out_is_a_field_left_alone(client, series):
    # The failure that would make this feature worse than nothing: renaming a
    # series and silently blanking its genre, tone and keywords because the
    # screen only sent the name.
    client.put("/api/series/settings", json={
        "folder_path": str(series), "name": "The Ashen Throne",
    })
    after = _read(series)
    assert after["genre"] == "Fantasy"
    assert after["tone"] == "Bleak"
    assert after["subgenre"] == "Grimdark"
    assert after["content_mode"] == "mature"
    assert after["keywords"] == ["ash", "crown"]
    assert after["series_id"] == "s-1"
    assert after["created_at"] == "2026-01-01T00:00:00+00:00"


def test_the_folder_is_never_renamed(client, series):
    # THE DANGEROUS ONE. Every book inside carries series_path pointing here,
    # and so do the recents list and each project.json's root_path. Renaming a
    # thing the writer can SEE must not rearrange the folders they back up.
    client.put("/api/series/settings", json={
        "folder_path": str(series), "name": "Something Else Entirely",
    })
    assert os.path.isdir(series), "the series folder moved"
    assert series.name == "the-ashen-crown", "the folder slug changed"
    assert _read(series)["root_path"] == str(series)


def test_an_empty_name_is_refused_with_the_reason(client, series):
    # A series with no name is one the writer cannot find again in the picker.
    resp = client.put("/api/series/settings", json={
        "folder_path": str(series), "name": "   ",
    })
    assert resp.status_code == 400
    assert "needs a name" in resp.json()["detail"]
    # And nothing was written on the way to refusing.
    assert _read(series)["name"] == "The Ashen Crown"


def test_the_name_is_trimmed_rather_than_stored_with_its_spaces(client, series):
    client.put("/api/series/settings", json={
        "folder_path": str(series), "name": "  The Ashen Throne  ",
    })
    assert _read(series)["name"] == "The Ashen Throne"


def test_updated_at_moves_and_created_at_does_not(client, series):
    client.put("/api/series/settings", json={
        "folder_path": str(series), "name": "The Ashen Throne",
    })
    after = _read(series)
    assert after["updated_at"] != "2026-01-01T00:00:00+00:00"
    assert after["created_at"] == "2026-01-01T00:00:00+00:00"


def test_the_other_series_fields_can_be_corrected_too(client, series):
    # The name is what was reported, but everything else on that form was typed
    # in the same hurried moment and had the same one chance.
    resp = client.put("/api/series/settings", json={
        "folder_path": str(series),
        "tone": "Hopeful", "keywords": ["ash", "  ", "rebirth"],
    })
    assert resp.status_code == 200
    after = _read(series)
    assert after["tone"] == "Hopeful"
    assert after["keywords"] == ["ash", "rebirth"], "blank keyword kept"
    assert after["name"] == "The Ashen Crown", "name changed when not sent"


def test_a_folder_that_is_not_a_series_says_so(client, tmp_path):
    empty = tmp_path / "not-a-series"
    empty.mkdir()
    resp = client.put("/api/series/settings", json={
        "folder_path": str(empty), "name": "Whatever",
    })
    assert resp.status_code == 404
    assert "series.json" in resp.json()["detail"]


def test_a_missing_folder_says_so_rather_than_creating_one(client, tmp_path):
    gone = tmp_path / "gone"
    resp = client.put("/api/series/settings", json={
        "folder_path": str(gone), "name": "Whatever",
    })
    assert resp.status_code == 400
    assert not gone.exists()
