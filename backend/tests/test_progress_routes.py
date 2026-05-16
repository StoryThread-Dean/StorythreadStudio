# tests/test_progress_routes.py
# ==============================
# HTTP-level tests for the Writing Progress endpoints:
#   GET /api/progress/summary  -- project completion gauge
#   GET /api/progress/daily    -- today's words/tasks/sparkline
#
# These tests use FastAPI's TestClient, which runs the ASGI app inside the
# test process with a real HTTP-like request/response cycle. No actual server
# is started; no port is bound. The `client` fixture is defined in conftest.py.
#
# Each test gets its own temp project directory (pytest's `tmp_path` fixture)
# so filesystem state is isolated between tests.

import json
from pathlib import Path

from fastapi.testclient import TestClient


# ── /api/progress/summary ────────────────────────────────────────────────────

def test_summary_missing_project_json_returns_404(client: TestClient, tmp_path: Path):
    # An empty directory with no project.json is not a valid project.
    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    assert res.status_code == 404


def test_summary_minimal_novel_project_returns_200(client: TestClient, tmp_path: Path):
    # A project with only project.json (no outline, no manuscript, no profiles)
    # is valid -- the gauge shows 0% with manuscript as the 100% weight bucket.
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novel"}), encoding="utf-8"
    )
    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    assert res.status_code == 200

    data = res.json()
    assert data["story_type"] == "novel"
    assert data["is_serial"] is False
    assert isinstance(data["percent"], float)
    assert data["percent"] == 0.0  # no manuscript words yet


def test_summary_serial_fiction_sets_is_serial(client: TestClient, tmp_path: Path):
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "serial_fiction"}), encoding="utf-8"
    )
    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    assert res.json()["is_serial"] is True
    # Serial fiction always reports 0% gauge (percentage model not applicable yet)
    assert res.json()["percent"] == 0.0


def test_summary_counts_manuscript_words(client: TestClient, tmp_path: Path):
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novel"}), encoding="utf-8"
    )
    ms = tmp_path / "manuscript"
    ms.mkdir()
    # Write 1000-word file (approximate -- count_words splits on whitespace)
    words = " ".join(["word"] * 1000)
    (ms / "01-chapter.md").write_text(words, encoding="utf-8")

    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    data = res.json()
    # Default novel target is 90,000 words; 1,000 / 90,000 * 100 ≈ 1.1%
    assert data["manuscript"]["actual_words"] == 1000
    assert data["manuscript"]["target_words"] == 90000
    assert data["manuscript"]["chapter_count"] == 1
    assert data["percent"] > 0.0


def test_summary_outline_frontmatter_activates_weighted_gauge(client: TestClient, tmp_path: Path):
    # With frontmatter, the gauge switches from 100% manuscript to the
    # locked 50/10/30/10 split.
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novel"}), encoding="utf-8"
    )
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "outline.md").write_text(
        "---\ntarget_word_count: 90000\n---\n\nOutline body.", encoding="utf-8"
    )

    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    data = res.json()
    assert data["outline"]["has_frontmatter"] is True
    assert data["manuscript"]["weight"] == 50.0
    assert data["outline"]["weight"] == 10.0
    assert data["profiles"]["weight"] == 30.0
    assert data["notes"]["weight"] == 10.0


def test_summary_response_has_required_shape(client: TestClient, tmp_path: Path):
    # Smoke test: verify all top-level keys are present and typed correctly.
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novella"}), encoding="utf-8"
    )
    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    data = res.json()
    assert "story_type" in data
    assert "is_serial" in data
    assert "percent" in data
    assert "manuscript" in data
    assert "outline" in data
    assert "profiles" in data
    assert "notes" in data
    assert "subsegments" in data["profiles"]


# ── /api/progress/daily ──────────────────────────────────────────────────────

def test_daily_nonexistent_directory_returns_404(client: TestClient, tmp_path: Path):
    ghost = str(tmp_path / "does_not_exist")
    res = client.get("/api/progress/daily", params={"project_path": ghost})
    assert res.status_code == 404


def test_daily_empty_project_returns_zero_words(client: TestClient, tmp_path: Path):
    # No events in the DB yet -- all counts should be zero.
    res = client.get("/api/progress/daily", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    data = res.json()
    assert data["today_words"] == 0
    assert data["today_tasks"] == []


def test_daily_sparkline_always_has_seven_entries(client: TestClient, tmp_path: Path):
    res = client.get("/api/progress/daily", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    sparkline = res.json()["sparkline_7day"]
    assert len(sparkline) == 7


def test_daily_response_has_required_shape(client: TestClient, tmp_path: Path):
    res = client.get("/api/progress/daily", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    data = res.json()
    assert "skill_level" in data
    assert "word_target" in data
    assert "task_target" in data
    assert "rollover_hour" in data
    assert "today_local_date" in data
    assert "today_words" in data
    assert "today_tasks" in data
    assert "sparkline_7day" in data


def test_daily_sparkline_entries_have_correct_shape(client: TestClient, tmp_path: Path):
    res = client.get("/api/progress/daily", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    for cell in res.json()["sparkline_7day"]:
        assert "local_date" in cell
        assert "words" in cell
        assert "tasks" in cell
        assert "hit" in cell
