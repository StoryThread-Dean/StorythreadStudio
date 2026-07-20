# tests/test_story_context_fields.py
# ===================================
# Tests for _build_story_context() picking up the Book Details fields
# (theme, setting, point_of_view, tense, target_audience) added in the
# sidebar overhaul, alongside the pre-existing genre/tone/pacing fields.
#
# _build_story_context reads project.json directly (plus series.json when
# the project belongs to a series), so these tests just write JSON files
# into tmp_path and call the function -- no HTTP layer needed.

import json
from pathlib import Path

from app.routers.ai import _build_story_context


def _write_project(tmp_path: Path, data: dict) -> str:
    (tmp_path / "project.json").write_text(json.dumps(data), encoding="utf-8")
    return str(tmp_path)


def test_new_book_detail_fields_are_injected(tmp_path: Path):
    root = _write_project(tmp_path, {
        "genre": "Fantasy",
        "tone": "Grim",
        "theme": "Redemption",
        "setting": "Post-war island kingdom",
        "point_of_view": "Third Limited",
        "tense": "Past",
        "target_audience": "Adult",
    })

    block = _build_story_context(root)

    assert "Genre: Fantasy" in block
    assert "Tone: Grim" in block
    assert "Theme: Redemption" in block
    assert "Setting: Post-war island kingdom" in block
    assert "Tense: Past" in block
    assert "Target Audience: Adult" in block


def test_point_of_view_label_capitalization(tmp_path: Path):
    # .title() would produce "Point Of View" -- the label override map must
    # correct it to natural English.
    root = _write_project(tmp_path, {"point_of_view": "First"})

    block = _build_story_context(root)

    assert "Point of View: First" in block
    assert "Point Of View" not in block


def test_empty_fields_are_omitted(tmp_path: Path):
    # Only populated fields appear; an all-empty project yields no block.
    root = _write_project(tmp_path, {"genre": "", "theme": None})
    assert _build_story_context(root) == ""


def test_missing_project_returns_empty(tmp_path: Path):
    assert _build_story_context(str(tmp_path / "nope")) == ""
    assert _build_story_context(None) == ""


def test_book_overrides_series_for_target_audience(tmp_path: Path):
    # target_audience exists in BOTH series.json and project.json. The book
    # value must win when non-empty (same merge rule as genre/tone).
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    (series_dir / "series.json").write_text(json.dumps({
        "name": "The Saga",
        "target_audience": "Young Adult",
        "genre": "Fantasy",
    }), encoding="utf-8")

    book_dir = tmp_path / "book1"
    book_dir.mkdir()
    root = _write_project(book_dir, {
        "series_path": str(series_dir),
        "target_audience": "Adult",   # overrides the series value
        "theme": "Found family",      # book-only field, no series equivalent
    })

    block = _build_story_context(root)

    assert "Target Audience: Adult" in block
    assert "Young Adult" not in block
    # Series-level genre still flows through when the book doesn't override.
    assert "Genre: Fantasy" in block
    assert "Theme: Found family" in block


def test_field_order_groups_related_fields(tmp_path: Path):
    # The block lists what-the-story-is fields before how-it's-told fields.
    # Pin the relative order so a refactor can't silently scramble the prompt.
    root = _write_project(tmp_path, {
        "genre": "Mystery",
        "theme": "Trust",
        "point_of_view": "First",
        "target_audience": "Adult",
    })

    block = _build_story_context(root)

    assert block.index("Genre:") < block.index("Theme:")
    assert block.index("Theme:") < block.index("Point of View:")
    assert block.index("Point of View:") < block.index("Target Audience:")
