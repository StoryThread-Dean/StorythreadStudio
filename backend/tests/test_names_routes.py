# tests/test_names_routes.py -- Name Generator HTTP surface
# ===========================================================
# The two read-only endpoints the NameGeneratorPanel consumes. Uses the
# session TestClient from conftest with the store pointed at a tmp DB.

import pytest

from app.utils import names_store
from app.utils.names_store import seed_names_db


@pytest.fixture(autouse=True)
def isolated_names_db(tmp_path, monkeypatch):
    monkeypatch.setattr(names_store, "NAMES_DIR", tmp_path)
    monkeypatch.setattr(names_store, "NAMES_DB", tmp_path / "names.db")
    seed_names_db()
    return tmp_path


def test_cultures_endpoint_shape(client):
    data = client.get("/api/names/cultures").json()
    assert len(data["cultures"]) == 20
    assert {c["region"] for c in data["cultures"]} == {
        "Europe", "Middle East & Africa", "Asia", "The Americas",
    }
    # Era list ships from the backend so the frontend never hardcodes it.
    assert [e["id"] for e in data["eras"]] == [
        "medieval", "colonial", "early20", "mid20", "current",
    ]


def test_pool_happy_path(client):
    data = client.get(
        "/api/names/pool",
        params={"culture": "british", "kind": "given", "era": "colonial", "gender": "female"},
    ).json()
    assert data["used_era"] == "colonial"
    assert len(data["names"]) >= 20


def test_pool_reports_fallback_era(client):
    data = client.get(
        "/api/names/pool",
        params={"culture": "peruvian", "kind": "given", "era": "medieval", "gender": "male"},
    ).json()
    # Peru's given names start at colonial -- the response says so.
    assert data["used_era"] == "colonial"


def test_pool_rejects_unknowns(client):
    bad_kind = client.get("/api/names/pool", params={"culture": "british", "kind": "nickname"})
    assert bad_kind.status_code == 400

    bad_era = client.get(
        "/api/names/pool", params={"culture": "british", "kind": "given", "era": "bronze_age"})
    assert bad_era.status_code == 400

    bad_gender = client.get(
        "/api/names/pool",
        params={"culture": "british", "kind": "given", "gender": "robot"})
    assert bad_gender.status_code == 400

    bad_culture = client.get(
        "/api/names/pool", params={"culture": "atlantean", "kind": "given"})
    assert bad_culture.status_code == 400
    assert "Unknown culture" in bad_culture.json()["detail"]
