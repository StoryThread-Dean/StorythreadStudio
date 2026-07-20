# tests/test_project_settings_fields.py
# ======================================
# Tests for the Book Details settings surface added in the sidebar overhaul:
#
#   - PUT /api/projects/settings accepts theme / setting / point_of_view /
#     tense / target_audience and persists them into project.json
#   - target_word_count round-trips through the OUTLINE frontmatter, never
#     project.json (single source of truth for the Progress gauge)
#   - GET/PUT /api/projects/ui-state round-trips the per-project UI blob
#     and degrades to {} on missing/corrupt files
#   - a freshly created project's starter chapter is the numeric
#     01-chapter-1.md (naming unified in the same overhaul)

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _create_project(client: TestClient, tmp_path: Path, title: str = "Test Novel") -> str:
    """Create a real project via the API and return its root path."""
    # When an explicit folder_path is given, /create expects it to already
    # exist (the native folder picker guarantees that in the real app).
    folder = tmp_path / "proj"
    folder.mkdir()
    res = client.post("/api/projects/create", json={
        "folder_path": str(folder),
        "title": title,
    })
    assert res.status_code == 200, res.text
    return res.json()["root_path"]


# ── Book Details fields → project.json ───────────────────────────────────────

def test_put_settings_persists_book_detail_fields(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)

    res = client.put("/api/projects/settings", json={
        "root_path": root,
        "theme": "Redemption",
        "setting": "Storm-locked archipelago",
        "point_of_view": "Third Limited",
        "tense": "Past",
        "target_audience": "Adult",
    })
    assert res.status_code == 200

    on_disk = json.loads((Path(root) / "project.json").read_text(encoding="utf-8"))
    assert on_disk["theme"] == "Redemption"
    assert on_disk["setting"] == "Storm-locked archipelago"
    assert on_disk["point_of_view"] == "Third Limited"
    assert on_disk["tense"] == "Past"
    assert on_disk["target_audience"] == "Adult"


def test_put_settings_partial_update_leaves_other_fields(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    client.put("/api/projects/settings", json={"root_path": root, "theme": "Trust"})

    # A later update to a different field must not clobber theme.
    client.put("/api/projects/settings", json={"root_path": root, "tone": "Wry"})

    on_disk = json.loads((Path(root) / "project.json").read_text(encoding="utf-8"))
    assert on_disk["theme"] == "Trust"
    assert on_disk["tone"] == "Wry"


# ── target_word_count → outline frontmatter, not project.json ───────────────

def test_target_word_count_patches_outline_not_project_json(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)

    res = client.put("/api/projects/settings", json={
        "root_path": root,
        "target_word_count": 120000,
    })
    assert res.status_code == 200
    # The PUT response echoes the effective value read back from the outline.
    assert res.json()["target_word_count"] == 120000

    # project.json must NOT gain the key -- the outline owns it.
    on_disk = json.loads((Path(root) / "project.json").read_text(encoding="utf-8"))
    assert "target_word_count" not in on_disk

    # The outline frontmatter carries the new value...
    outline = (Path(root) / "notes" / "outline.md").read_text(encoding="utf-8")
    assert "target_word_count: 120000" in outline

    # ...and GET /settings serves it as the computed field.
    res = client.get("/api/projects/settings", params={"root_path": root})
    assert res.json()["target_word_count"] == 120000


def test_target_word_count_missing_outline_is_soft_failure(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    (Path(root) / "notes" / "outline.md").unlink()

    # The PUT still succeeds (writers can delete outline.md); the target is
    # simply not stored anywhere and reads back as None.
    res = client.put("/api/projects/settings", json={
        "root_path": root,
        "target_word_count": 90000,
    })
    assert res.status_code == 200
    assert res.json()["target_word_count"] is None


# ── Per-project UI state ─────────────────────────────────────────────────────

def test_ui_state_round_trip(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)

    state = {"profilesCollapsed": True, "collapsedActs": ["a-12ab34cd"]}
    res = client.put("/api/projects/ui-state", json={"root_path": root, "state": state})
    assert res.status_code == 200

    res = client.get("/api/projects/ui-state", params={"root_path": root})
    assert res.status_code == 200
    assert res.json()["state"] == state

    # The blob lives in the hidden app folder, not project.json.
    assert (Path(root) / ".storythread" / "ui-state.json").is_file()


def test_ui_state_missing_file_returns_empty(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    res = client.get("/api/projects/ui-state", params={"root_path": root})
    assert res.status_code == 200
    assert res.json()["state"] == {}


def test_ui_state_corrupt_file_returns_empty(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    ui_file = Path(root) / ".storythread" / "ui-state.json"
    ui_file.parent.mkdir(exist_ok=True)
    ui_file.write_text("{not json!!", encoding="utf-8")

    res = client.get("/api/projects/ui-state", params={"root_path": root})
    assert res.status_code == 200
    assert res.json()["state"] == {}


def test_ui_state_rejects_non_project_folder(client: TestClient, tmp_path: Path):
    res = client.get("/api/projects/ui-state", params={"root_path": str(tmp_path)})
    assert res.status_code == 404
    res = client.put("/api/projects/ui-state", json={"root_path": str(tmp_path), "state": {}})
    assert res.status_code == 404


# ── Numeric starter chapter ──────────────────────────────────────────────────

def test_new_project_starter_chapter_is_numeric(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)

    starter = Path(root) / "manuscript" / "01-chapter-1.md"
    assert starter.is_file()
    assert starter.read_text(encoding="utf-8").startswith("# Chapter 1")
    # The old spelled-out starter must be gone from the scaffold.
    assert not (Path(root) / "manuscript" / "01-chapter-one.md").exists()
