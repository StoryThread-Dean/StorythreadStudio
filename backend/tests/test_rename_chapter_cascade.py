# tests/test_rename_chapter_cascade.py
# =====================================
# Tests for the file-renaming chapter rename (sidebar overhaul).
# POST /api/documents/rename-chapter now renames the FILE (slug follows the
# title, NN- prefix kept) and cascades everything keyed by the old stem:
# chapter summary, scene-summary folder, structure manifest entry, and
# progress-event relpaths.

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.progress_store import open_db, record_save_event


def _create_project(client: TestClient, tmp_path: Path) -> str:
    folder = tmp_path / "proj"
    folder.mkdir()
    res = client.post("/api/projects/create", json={
        "folder_path": str(folder), "title": "Rename Novel",
    })
    assert res.status_code == 200, res.text
    return res.json()["root_path"]


def _rename(client: TestClient, root: str, filename: str, new_title: str):
    return client.post("/api/documents/rename-chapter", json={
        "folder_path": root, "filename": filename, "new_title": new_title,
    })


# ── The basic rename ─────────────────────────────────────────────────────────

def test_rename_updates_heading_and_filename(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)

    res = _rename(client, root, "01-chapter-1.md", "The Beginning of X")
    assert res.status_code == 200
    data = res.json()

    assert data["old_filename"] == "01-chapter-1.md"
    assert data["filename"] == "01-the-beginning-of-x.md"   # NN- prefix kept
    assert data["title"] == "The Beginning of X"

    manuscript = Path(root) / "manuscript"
    assert not (manuscript / "01-chapter-1.md").exists()
    new_file = manuscript / "01-the-beginning-of-x.md"
    assert new_file.is_file()
    assert new_file.read_text(encoding="utf-8").startswith("# The Beginning of X")


def test_rename_without_prefix_keeps_bare_slug(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    (Path(root) / "manuscript" / "prologue.md").write_text("# Prologue\n", encoding="utf-8")

    res = _rename(client, root, "prologue.md", "Cold Open")
    assert res.status_code == 200
    assert res.json()["filename"] == "cold-open.md"


def test_same_slug_is_heading_only_no_op(client: TestClient, tmp_path: Path):
    # "Chapter 1" -> "CHAPTER 1" slugs identically; the file must be left
    # alone and only the heading rewritten.
    root = _create_project(client, tmp_path)

    res = _rename(client, root, "01-chapter-1.md", "CHAPTER 1")
    assert res.status_code == 200
    data = res.json()
    assert data["filename"] == "01-chapter-1.md"
    assert data["old_filename"] == "01-chapter-1.md"

    content = (Path(root) / "manuscript" / "01-chapter-1.md").read_text(encoding="utf-8")
    assert content.startswith("# CHAPTER 1")


def test_collision_returns_409(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    (Path(root) / "manuscript" / "01-the-storm.md").write_text("# The Storm\n", encoding="utf-8")

    res = _rename(client, root, "01-chapter-1.md", "The Storm")
    assert res.status_code == 409


def test_empty_title_is_400(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    res = _rename(client, root, "01-chapter-1.md", "   ")
    assert res.status_code == 400


# ── Cascade: summary + scene folder ──────────────────────────────────────────

def test_cascade_moves_summary_and_scene_folder(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)

    # Give the chapter a summary and a scene-summary folder.
    summaries = Path(root) / "summaries"
    (summaries / "chapters").mkdir(parents=True)
    (summaries / "chapters" / "01-chapter-1.md").write_text("Summary body\n", encoding="utf-8")
    scene_dir = summaries / "scenes" / "01-chapter-1"
    scene_dir.mkdir(parents=True)
    (scene_dir / "scene-01.md").write_text("# Opening\n\nScene summary\n", encoding="utf-8")

    res = _rename(client, root, "01-chapter-1.md", "Landfall")
    assert res.status_code == 200
    data = res.json()
    assert data["summary_moved"] is True
    assert data["scenes_moved"] is True

    assert (summaries / "chapters" / "01-landfall.md").is_file()
    assert not (summaries / "chapters" / "01-chapter-1.md").exists()
    assert (summaries / "scenes" / "01-landfall" / "scene-01.md").is_file()
    assert not (summaries / "scenes" / "01-chapter-1").exists()


def test_cascade_flags_true_when_nothing_to_move(client: TestClient, tmp_path: Path):
    # No summary, no scenes: "nothing to move" is success, not failure.
    root = _create_project(client, tmp_path)
    res = _rename(client, root, "01-chapter-1.md", "Landfall")
    data = res.json()
    assert data["summary_moved"] is True
    assert data["scenes_moved"] is True
    assert data["structure_updated"] is True   # no manifest = nothing to update
    assert data["progress_migrated"] is True


# ── Cascade: structure manifest keeps act + position ─────────────────────────

def test_rename_keeps_act_membership_and_position(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    (Path(root) / "manuscript" / "02-second.md").write_text("# Second\n", encoding="utf-8")

    client.put("/api/structure", json={
        "folder_path": root,
        "acts": [{"title": "Act I", "chapters": ["01-chapter-1.md", "02-second.md"]}],
        "unassigned": [],
    })

    res = _rename(client, root, "01-chapter-1.md", "Landfall")
    assert res.json()["structure_updated"] is True

    manifest = json.loads(
        (Path(root) / "manuscript" / "structure.json").read_text(encoding="utf-8")
    )
    # Still first in Act I -- NOT dumped into unassigned (the heal-vs-sync
    # ordering bug this test pins down).
    assert manifest["acts"][0]["chapters"] == ["01-landfall.md", "02-second.md"]
    assert manifest["unassigned"] == []


# ── Cascade: progress relpath migration ──────────────────────────────────────

@pytest.mark.asyncio
async def test_rename_migrates_progress_relpaths(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)

    # Seed a real progress event under the old relpath.
    await record_save_event(
        root, "manuscript/01-chapter-1.md",
        new_content="one two three", previous_content="",
    )

    res = _rename(client, root, "01-chapter-1.md", "Landfall")
    assert res.json()["progress_migrated"] is True

    async with open_db(root) as db:
        cursor = await db.execute(
            "SELECT file_relpath FROM progress_event WHERE project_path = ?",
            (str(root),),
        )
        rows = [r[0] for r in await cursor.fetchall()]

    assert rows, "expected seeded progress rows"
    assert all(r == "manuscript/01-landfall.md" for r in rows)
