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


def test_summary_an_outline_activates_the_weighted_gauge(client: TestClient, tmp_path: Path):
    # An outline EXISTING switches the gauge from 100% manuscript to the
    # 60/20/20 split. It used to be gated on yaml frontmatter, which outlines
    # no longer carry -- and which the writer never saw and could not
    # deliberately create.
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novel"}), encoding="utf-8"
    )
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "outline.md").write_text(
        "# Outline\n\nTarget Word Count: 90000\n\nOutline body.", encoding="utf-8"
    )

    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    assert res.status_code == 200
    data = res.json()
    assert data["outline"]["present"] is True
    assert data["manuscript"]["weight"] == 60.0
    assert data["outline"]["weight"] == 20.0
    assert data["notes"]["weight"] == 20.0
    # The profiles slice is gone rather than left unfillable. It scored
    # matched-against-expected using the outline's expected_* lists, and those
    # inputs are retired -- leaving the weight would cap every gauge at 70%.
    assert data["profiles"]["weight"] == 0.0
    assert (data["manuscript"]["weight"] + data["outline"]["weight"]
            + data["notes"]["weight"] + data["profiles"]["weight"]) == 100.0


def test_summary_a_legacy_outline_still_reports_its_target(client: TestClient, tmp_path: Path):
    # A book not opened since the upgrade still carries yaml frontmatter. The
    # gauge must not quietly fall back to the story-type default and measure
    # the writer against a number they never chose.
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novel"}), encoding="utf-8"
    )
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "outline.md").write_text(
        "---\ntarget_word_count: 55000\n---\n\nOutline body.", encoding="utf-8"
    )

    res = client.get("/api/progress/summary", params={"project_path": str(tmp_path)})
    data = res.json()
    assert data["manuscript"]["target_words"] == 55000
    assert data["outline"]["legacy"] is True


def test_summary_outline_score_is_a_gradient(client: TestClient, tmp_path: Path):
    # Filling in more of the worksheet moves the number. This used to be a
    # binary on frontmatter existing, so there was nothing here to improve.
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novel"}), encoding="utf-8"
    )
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "outline.md").write_text(
        "# Outline\n\nTitle: A Book\nGenre: Fantasy\n", encoding="utf-8"
    )
    data = client.get("/api/progress/summary",
                      params={"project_path": str(tmp_path)}).json()
    assert data["outline"]["fields_filled"] == 2
    assert data["outline"]["fields_total"] == 10


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


# ── The Profiles breakdown, and which folder it counts ──────────────────
#
# The count is "info only" -- the weight is 0.0, because the expected_* lists
# it used to be scored against are retired -- but it is still shown, and it was
# still wrong. `_list_entry_names` joined `profiles/` itself, so on a converted
# project (and now on every new one) it found nothing and the gauge told a
# writer with twenty-two characters that they had "-no entry-" in every
# category. Nothing errored: an empty list is a perfectly ordinary answer to
# "how many characters have you written".

ENTRY = """---
type: character
name: Kael Ashen
---

# Overview
A thief.
"""

OUTLINE = """---
expected_characters:
  - Kael
---
# Outline

Target Word Count: 90000
"""


def _gauge_project(tmp_path: Path, *, entries_in: str, settings: dict) -> dict:
    (tmp_path / "project.json").write_text(
        json.dumps({"story_type": "novel", **settings}), encoding="utf-8")
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "outline.md").write_text(OUTLINE, encoding="utf-8")

    where = tmp_path / entries_in
    where.mkdir(parents=True)
    (where / "kael.md").write_text(ENTRY, encoding="utf-8")
    return {"project_path": str(tmp_path)}


def _characters(data: dict) -> dict:
    return next(s for s in data["profiles"]["subsegments"]
                if s["name"] == "characters")


def test_the_breakdown_counts_the_codex_on_a_codex_project(
        client: TestClient, tmp_path: Path):
    params = _gauge_project(tmp_path, entries_in="codex/characters",
                            settings={"codex_native": True})
    data = client.get("/api/progress/summary", params=params).json()

    row = _characters(data)
    assert row["actual"] == 1
    assert row["matched_names"] == ["Kael"]
    assert row["unmatched_names"] == []


def test_the_breakdown_still_counts_profiles_on_an_unconverted_project(
        client: TestClient, tmp_path: Path):
    # The other half, and the reason this is not just a swapped string: an
    # unconverted project's world is still in profiles/ and must still be
    # found. One question, asked through entries_home, exactly as the sidebar
    # and the exports ask it.
    params = _gauge_project(tmp_path, entries_in="profiles/characters",
                            settings={})
    data = client.get("/api/progress/summary", params=params).json()

    row = _characters(data)
    assert row["actual"] == 1
    assert row["matched_names"] == ["Kael"]


def test_fixing_the_count_did_not_start_scoring_it(
        client: TestClient, tmp_path: Path):
    # The Weave slice is COUNTED, NOT SCORED -- with no writer-declared cast
    # there is no honest denominator. This is a display fix and must stay one.
    params = _gauge_project(tmp_path, entries_in="codex/characters",
                            settings={"codex_native": True})
    data = client.get("/api/progress/summary", params=params).json()
    assert data["profiles"]["weight"] == 0.0


def test_every_kind_still_gets_a_row_even_with_nothing_in_it(
        client: TestClient, tmp_path: Path):
    # The breakdown UI renders "-no entry-" rows, so a missing folder must be
    # a zero rather than an absent row -- and the row keeps its FOLDER name
    # ("characters"), not the type id, so it reads the same on both dialects.
    params = _gauge_project(tmp_path, entries_in="codex/characters",
                            settings={"codex_native": True})
    data = client.get("/api/progress/summary", params=params).json()
    assert [s["name"] for s in data["profiles"]["subsegments"]] == [
        "characters", "locations", "lore", "relationships",
    ]
    assert _characters(data)["actual"] == 1
    lore = next(s for s in data["profiles"]["subsegments"] if s["name"] == "lore")
    assert lore["actual"] == 0


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
