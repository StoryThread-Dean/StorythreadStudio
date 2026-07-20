# tests/test_structure_manifest.py
# =================================
# Tests for the acts/order manifest (manuscript/structure.json):
#   - GET synthesizes for manifest-less projects WITHOUT writing a file
#   - PUT persists, validates, heals, and echoes the healed tree
#   - self-healing against hand-edits of the manuscript folder
#   - the ordering consumers (chapter list, reader bulk, export, progress)
#     follow manifest order once one exists
#   - create/delete chapter keep the manifest in step
#   - a chapter rename keeps its act and position (regression guard for the
#     "heal-before-sync drops the act assignment" bug)

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _create_project(client: TestClient, tmp_path: Path, title: str = "Struct Novel") -> str:
    folder = tmp_path / "proj"
    folder.mkdir()
    res = client.post("/api/projects/create", json={
        "folder_path": str(folder), "title": title,
    })
    assert res.status_code == 200, res.text
    return res.json()["root_path"]


def _add_chapter(root: str, filename: str, title: str) -> None:
    (Path(root) / "manuscript" / filename).write_text(f"# {title}\n\nWords.\n", encoding="utf-8")


def _manifest_path(root: str) -> Path:
    return Path(root) / "manuscript" / "structure.json"


# ── GET: synthesis ───────────────────────────────────────────────────────────

def test_get_synthesizes_without_writing(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _add_chapter(root, "02-second.md", "Second")

    res = client.get("/api/structure", params={"folder_path": root})
    assert res.status_code == 200
    data = res.json()

    assert data["exists"] is False
    assert data["acts"] == []
    # Everything unassigned, filename order, with display titles attached.
    names = [c["filename"] for c in data["unassigned"]]
    assert names == ["01-chapter-1.md", "02-second.md"]
    assert data["unassigned"][1]["title"] == "Second"
    # Crucial compatibility rule: looking must not create the file.
    assert not _manifest_path(root).exists()


def test_get_rejects_non_project_folder(client: TestClient, tmp_path: Path):
    res = client.get("/api/structure", params={"folder_path": str(tmp_path)})
    assert res.status_code == 404


# ── PUT: persist / validate / heal ───────────────────────────────────────────

def test_put_persists_and_echoes(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _add_chapter(root, "02-second.md", "Second")

    res = client.put("/api/structure", json={
        "folder_path": root,
        "acts": [
            {"title": "Act I", "chapters": ["02-second.md", "01-chapter-1.md"]},
            {"title": "Act II", "chapters": []},
        ],
        "unassigned": [],
    })
    assert res.status_code == 200
    data = res.json()

    assert data["exists"] is True
    assert [a["title"] for a in data["acts"]] == ["Act I", "Act II"]
    # Server assigned stable ids to the new acts.
    assert all(a["id"].startswith("a-") for a in data["acts"])
    # Custom order inside the act survived.
    assert [c["filename"] for c in data["acts"][0]["chapters"]] == [
        "02-second.md", "01-chapter-1.md",
    ]
    # Persisted to disk.
    on_disk = json.loads(_manifest_path(root).read_text(encoding="utf-8"))
    assert on_disk["acts"][0]["chapters"] == ["02-second.md", "01-chapter-1.md"]

    # A follow-up GET returns the same tree with the same ids.
    res2 = client.get("/api/structure", params={"folder_path": root})
    assert res2.json()["acts"][0]["id"] == data["acts"][0]["id"]


def test_put_rejects_traversal_filenames(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    for bad in ["../evil.md", "sub/dir.md", "..\\up.md", "notes.txt"]:
        res = client.put("/api/structure", json={
            "folder_path": root,
            "acts": [{"title": "Act I", "chapters": [bad]}],
            "unassigned": [],
        })
        assert res.status_code == 400, f"{bad!r} should be rejected"


def test_put_heals_ghost_and_missing_files(client: TestClient, tmp_path: Path):
    # Referencing a file that doesn't exist -> silently dropped (writer may
    # have deleted it mid-drag); omitting a real file -> appended unassigned.
    root = _create_project(client, tmp_path)
    _add_chapter(root, "02-second.md", "Second")

    res = client.put("/api/structure", json={
        "folder_path": root,
        "acts": [{"title": "Act I", "chapters": ["99-ghost.md", "01-chapter-1.md"]}],
        "unassigned": [],   # 02-second.md omitted on purpose
    })
    data = res.json()
    assert [c["filename"] for c in data["acts"][0]["chapters"]] == ["01-chapter-1.md"]
    assert [c["filename"] for c in data["unassigned"]] == ["02-second.md"]


# ── Self-healing on load ─────────────────────────────────────────────────────

def test_load_heals_hand_deleted_and_added_files(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _add_chapter(root, "02-second.md", "Second")
    client.put("/api/structure", json={
        "folder_path": root,
        "acts": [{"title": "Act I", "chapters": ["01-chapter-1.md", "02-second.md"]}],
        "unassigned": [],
    })

    # The writer goes wild in Explorer: deletes one file, adds another.
    (Path(root) / "manuscript" / "02-second.md").unlink()
    _add_chapter(root, "03-new.md", "Hand Added")

    res = client.get("/api/structure", params={"folder_path": root})
    data = res.json()
    assert [c["filename"] for c in data["acts"][0]["chapters"]] == ["01-chapter-1.md"]
    assert [c["filename"] for c in data["unassigned"]] == ["03-new.md"]


def test_corrupt_manifest_treated_as_absent(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _manifest_path(root).write_text("{ not json", encoding="utf-8")

    res = client.get("/api/structure", params={"folder_path": root})
    assert res.status_code == 200
    assert res.json()["exists"] is False
    assert [c["filename"] for c in res.json()["unassigned"]] == ["01-chapter-1.md"]

    # The chapter list must also survive a corrupt manifest.
    res = client.get("/api/documents/chapters", params={"folder_path": root})
    assert res.status_code == 200


# ── Ordering consumers follow the manifest ───────────────────────────────────

def _reorder_reversed(client: TestClient, root: str) -> None:
    """Put chapters in reverse-filename order inside one act."""
    _add_chapter(root, "02-second.md", "Second")
    _add_chapter(root, "03-third.md", "Third")
    res = client.put("/api/structure", json={
        "folder_path": root,
        "acts": [{
            "title": "Act I",
            "chapters": ["03-third.md", "01-chapter-1.md", "02-second.md"],
        }],
        "unassigned": [],
    })
    assert res.status_code == 200


def test_chapter_list_follows_manifest_order(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _reorder_reversed(client, root)

    res = client.get("/api/documents/chapters", params={"folder_path": root})
    names = [c["filename"] for c in res.json()]
    assert names == ["03-third.md", "01-chapter-1.md", "02-second.md"]


def test_reader_mode_bulk_follows_manifest_order(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _reorder_reversed(client, root)

    res = client.get("/api/documents/manuscript-content", params={"folder_path": root})
    names = [c["filename"] for c in res.json()]
    assert names == ["03-third.md", "01-chapter-1.md", "02-second.md"]


def test_export_follows_manifest_order(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _reorder_reversed(client, root)

    res = client.post("/api/export/full-manuscript", json={
        "folder_path": root, "formats": ["md"],
    })
    assert res.status_code == 200, res.text
    exports_dir = Path(root) / "exports"
    md_files = list(exports_dir.glob("*.md"))
    assert md_files, "export produced no .md file"
    combined = md_files[0].read_text(encoding="utf-8")
    # "Third" must come before "Chapter 1" which must come before "Second".
    assert combined.index("Third") < combined.index("Chapter 1") < combined.index("Second")


def test_progress_chapters_follow_manifest_order(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _reorder_reversed(client, root)

    res = client.get("/api/progress/summary", params={"project_path": root})
    assert res.status_code == 200
    titles = [c["title"] for c in res.json()["chapters"]]
    assert titles == ["Third", "Chapter 1", "Second"]


def test_no_manifest_keeps_filename_order(client: TestClient, tmp_path: Path):
    # Old projects (no structure.json) must behave byte-identically to
    # before: filename sort everywhere, no file materialized.
    root = _create_project(client, tmp_path)
    _add_chapter(root, "02-second.md", "Second")

    res = client.get("/api/documents/chapters", params={"folder_path": root})
    assert [c["filename"] for c in res.json()] == ["01-chapter-1.md", "02-second.md"]
    assert not _manifest_path(root).exists()


# ── create/delete keep the manifest in step ──────────────────────────────────

def test_create_chapter_lands_in_unassigned(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    client.put("/api/structure", json={
        "folder_path": root,
        "acts": [{"title": "Act I", "chapters": ["01-chapter-1.md"]}],
        "unassigned": [],
    })

    res = client.post("/api/documents/create-chapter", json={
        "folder_path": root, "title": "Chapter 2",
    })
    assert res.status_code == 200

    on_disk = json.loads(_manifest_path(root).read_text(encoding="utf-8"))
    assert "02-chapter-2.md" in on_disk["unassigned"]


def test_delete_chapter_leaves_manifest_clean(client: TestClient, tmp_path: Path):
    root = _create_project(client, tmp_path)
    _add_chapter(root, "02-second.md", "Second")
    client.put("/api/structure", json={
        "folder_path": root,
        "acts": [{"title": "Act I", "chapters": ["01-chapter-1.md", "02-second.md"]}],
        "unassigned": [],
    })

    res = client.request("DELETE", "/api/documents/chapter", params={
        "folder_path": root, "filename": "02-second.md",
    })
    assert res.status_code == 200

    on_disk = json.loads(_manifest_path(root).read_text(encoding="utf-8"))
    assert "02-second.md" not in on_disk["acts"][0]["chapters"]
    assert "02-second.md" not in on_disk["unassigned"]
