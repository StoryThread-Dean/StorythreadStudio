# tests/test_audiobook_workspace_routes.py
# =========================================
# The import pipeline and the /api/audiobook HTTP surface, end to end:
# real files in tmp_path, real TestClient requests, no mocks. The recents
# DB and the global pronunciation file are monkeypatched away from the real
# app data folder (autouse fixture) -- house rule for every store test.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.audiobook import pronunciation, recents_store
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


def _import_txt(tmp_path, name="book"):
    """Import a small two-chapter TXT and return (source, workspace, payload)."""
    src = tmp_path / f"{name}.txt"
    src.write_text(
        "Chapter 1\n\nFirst prose.\n\nChapter 2\n\nSecond prose.\n",
        encoding="utf-8",
    )
    ws = tmp_path / f"{name}-workspace"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src),
        "workspace_path": str(ws),
        "title": "The Hollow Road",
    })
    assert response.status_code == 200, response.text
    return src, ws, response.json()


# ── Adding chapters to an existing audiobook ─────────────────────────────────
# The writer keeps writing after the audiobook exists: new source
# chapters can be pulled in without a destructive re-import. (Removing a
# chapter is just deleting its heading+body in the narration editor.)

def test_new_source_chapters_can_be_added_without_reimport(tmp_path):
    src, ws, _payload = _import_txt(tmp_path)

    # The book grew after import.
    src.write_text(
        "Chapter 1\n\nFirst prose.\n\nChapter 2\n\nSecond prose.\n\n"
        "Chapter 3\n\nBrand new prose.\n\nChapter 4\n\nEven newer prose.\n",
        encoding="utf-8",
    )
    available = client.get("/api/audiobook/chapters/available",
                           params={"workspace_path": str(ws)})
    assert available.status_code == 200
    titles = [c["title"] for c in available.json()["available"]]
    assert titles == ["Chapter 3", "Chapter 4"]

    # The writer edited chapter 1 already -- adding must not touch it.
    narration = client.get("/api/audiobook/narration",
                           params={"workspace_path": str(ws)}).json()["content"]
    edited = narration.replace("First prose.", "First prose, hand-polished.")
    client.put("/api/audiobook/narration",
               json={"workspace_path": str(ws), "content": edited})

    added = client.post("/api/audiobook/chapters/add", json={
        "workspace_path": str(ws), "titles": ["Chapter 3"]})
    assert added.status_code == 200
    body = added.json()
    assert [c["title"] for c in body["chapters"]] == [
        "Chapter 1", "Chapter 2", "Chapter 3"]
    assert "Brand new prose." in body["content"]
    assert "hand-polished" in body["content"]        # edits survived

    # Chapter 4 (not picked) is still available; chapter 3 no longer is.
    remaining = client.get("/api/audiobook/chapters/available",
                           params={"workspace_path": str(ws)}).json()
    assert [c["title"] for c in remaining["available"]] == ["Chapter 4"]


def test_add_chapters_refuses_unknown_titles_and_a_missing_source(tmp_path):
    src, ws, _payload = _import_txt(tmp_path)
    response = client.post("/api/audiobook/chapters/add", json={
        "workspace_path": str(ws), "titles": ["Chapter 99"]})
    assert response.status_code == 400
    assert "not found in the source" in response.json()["detail"]

    src.unlink()                                     # the original moved away
    response = client.get("/api/audiobook/chapters/available",
                          params={"workspace_path": str(ws)})
    assert response.status_code == 400
    assert "could not be found" in response.json()["detail"]


# ── Generation reset (the writer's escape hatch) ─────────────────────────────

def test_reset_clears_a_stuck_run_and_a_stale_lock(tmp_path):
    # THE live bug scenario: a reboot left a run record and a lock file
    # pointing at a dead process on this machine; Resume was blocked with
    # "in use by another Storythread instance". Reset must clear both so
    # the writer can start over without hand-deleting files.
    _src, ws, _payload = _import_txt(tmp_path)
    (ws / "generation-run.json").write_text(json.dumps({
        "run_id": "r1", "status": "paused", "provider": "local-kokoro",
        "voice_id": "v", "total_segments": 5, "completed_segments": 2,
        "failed_segments": 0,
    }), encoding="utf-8")
    (ws / ".storythread-audiobook.lock").write_text(json.dumps({
        "pid": 37372, "hostname": "SOME-OTHER-BOX",   # unbreakable by staleness
        "acquired_at": "2026-07-29T00:00:00Z",
    }), encoding="utf-8")

    response = client.post("/api/audiobook/generation/reset",
                           json={"workspace_path": str(ws)})
    assert response.status_code == 200
    assert not (ws / "generation-run.json").exists()
    assert not (ws / ".storythread-audiobook.lock").exists()
    # Status now reads clean: no run, ready for a fresh Generate.
    status = client.get("/api/audiobook/generation/status",
                        params={"workspace_path": str(ws)}).json()
    assert status == {"run": None, "active": False}


# ── Import ────────────────────────────────────────────────────────────────────

def test_import_builds_the_full_workspace(tmp_path):
    src, ws, payload = _import_txt(tmp_path)

    # Every scaffold folder exists.
    for sub in ["source", "manuscript", "chapters", "generated-segments",
                "previews", "revisions", os.path.join("output", "chapters"), "logs"]:
        assert (ws / sub).is_dir(), f"missing {sub}"

    # The original was COPIED in and the outside file is untouched.
    assert (ws / "source" / "original-book.txt").is_file()
    assert src.read_text(encoding="utf-8").startswith("Chapter 1")

    # Twin layers are identical at import time.
    extracted = (ws / "manuscript" / "extracted-original.md").read_text(encoding="utf-8")
    narration = (ws / "manuscript" / "narration-copy.md").read_text(encoding="utf-8")
    assert extracted == narration
    assert "# Chapter 1" in narration

    # Manifest carries the override title and spec defaults.
    manifest = payload["manifest"]
    assert manifest["title"] == "The Hollow Road"
    assert manifest["schema_version"] == 1
    assert manifest["status"] == "needs_review"
    assert manifest["output_formats"] == ["chapter_mp3", "combined_mp3", "m4b"]
    assert manifest["retain_intermediate_audio"] is True

    # Chapters derived, ordered, selected by default.
    chapters = payload["chapters"]
    assert [c["title"] for c in chapters] == ["Chapter 1", "Chapter 2"]
    assert all(c["selected_for_generation"] for c in chapters)

    # And the workspace landed in Recents.
    recents = client.get("/api/audiobook/recents").json()["audiobooks"]
    assert [r["title"] for r in recents] == ["The Hollow Road"]


def test_import_refuses_a_non_empty_folder(tmp_path):
    src = tmp_path / "b.txt"
    src.write_text("Chapter 1\n\nProse.", encoding="utf-8")
    target = tmp_path / "occupied"
    target.mkdir()
    (target / "keepsake.txt").write_text("precious")

    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(target),
    })
    assert response.status_code == 400
    assert "not empty" in response.json()["detail"]
    # Nothing was created or destroyed.
    assert (target / "keepsake.txt").read_text() == "precious"
    assert not (target / "audiobook-project.json").exists()


def test_import_pdf_rejected_cleanly_no_half_workspace(tmp_path):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF fake")
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(pdf), "workspace_path": str(ws),
    })
    assert response.status_code == 400
    assert "PDF import is not supported yet" in response.json()["detail"]
    assert not ws.exists()          # extraction failed BEFORE scaffolding


def test_import_missing_source_400(tmp_path):
    response = client.post("/api/audiobook/import", json={
        "source_path": str(tmp_path / "ghost.txt"),
        "workspace_path": str(tmp_path / "ws"),
    })
    assert response.status_code == 400
    assert "could not be found" in response.json()["detail"]


# ── Project / narration round trip ────────────────────────────────────────────

def test_get_project_returns_manifest_and_touches_recents(tmp_path):
    _, ws, _ = _import_txt(tmp_path)
    response = client.get("/api/audiobook/project", params={"workspace_path": str(ws)})
    assert response.status_code == 200
    body = response.json()
    assert body["manifest"]["title"] == "The Hollow Road"
    assert len(body["chapters"]) == 2


def test_get_project_unknown_path_404(tmp_path):
    response = client.get("/api/audiobook/project",
                          params={"workspace_path": str(tmp_path / "nowhere")})
    assert response.status_code == 404


def test_narration_save_rederives_structure_and_chapters(tmp_path):
    _, ws, _ = _import_txt(tmp_path)

    content = client.get("/api/audiobook/narration",
                         params={"workspace_path": str(ws)}).json()["content"]
    edited = content + "\n[scene-break]\n\n# Chapter 3\n\nBrand new prose.\n"

    response = client.put("/api/audiobook/narration", json={
        "workspace_path": str(ws), "content": edited,
    })
    assert response.status_code == 200
    body = response.json()
    assert [c["title"] for c in body["chapters"]] == ["Chapter 1", "Chapter 2", "Chapter 3"]

    # narration-structure.json was re-derived from the saved text.
    structure = json.loads((ws / "manuscript" / "narration-structure.json")
                           .read_text(encoding="utf-8"))
    all_kinds = [e["type"] for ch in structure["chapters"] for e in ch["elements"]]
    assert "scene_break" in all_kinds

    # chapters/ folder matches the new count.
    files = sorted(p.name for p in (ws / "chapters").glob("*.json"))
    assert files == ["chapter-001.json", "chapter-002.json", "chapter-003.json"]


def test_narration_save_preserves_selection_by_title(tmp_path):
    _, ws, _ = _import_txt(tmp_path)

    # Writer deselects Chapter 2 (simulated directly in the derived file --
    # the selection endpoint arrives with the Chapters step in a later slice).
    ch2 = ws / "chapters" / "chapter-002.json"
    record = json.loads(ch2.read_text(encoding="utf-8"))
    record["selected_for_generation"] = False
    ch2.write_text(json.dumps(record), encoding="utf-8")

    # Re-save the narration with a new chapter appended.
    content = client.get("/api/audiobook/narration",
                         params={"workspace_path": str(ws)}).json()["content"]
    body = client.put("/api/audiobook/narration", json={
        "workspace_path": str(ws),
        "content": content + "\n# Chapter 3\n\nNew.\n",
    }).json()

    by_title = {c["title"]: c for c in body["chapters"]}
    assert by_title["Chapter 2"]["selected_for_generation"] is False   # survived
    assert by_title["Chapter 3"]["selected_for_generation"] is True    # new default


# ── Segments over HTTP ────────────────────────────────────────────────────────

def test_import_builds_segments_and_the_endpoint_serves_them(tmp_path):
    _, ws, _ = _import_txt(tmp_path)
    response = client.get("/api/audiobook/segments", params={"workspace_path": str(ws)})
    assert response.status_code == 200
    manifest = response.json()
    assert [c["title"] for c in manifest["chapters"]] == ["Chapter 1", "Chapter 2"]
    segments = [i for c in manifest["chapters"] for i in c["items"] if i["kind"] == "segment"]
    assert all(s["segment_id"].startswith("seg-") for s in segments)
    assert all(s["status"] == "pending" for s in segments)
    # The manifest file itself lives in the workspace, not app data.
    assert (ws / "generated-segments" / "segments.json").is_file()


def test_segments_404_before_any_narration_exists(tmp_path):
    # A workspace whose manifest exists but segments were never derived
    # (hand-built folder) gets the helpful 404, not a crash.
    ws = tmp_path / "bare"
    (ws / "manuscript").mkdir(parents=True)
    (ws / "audiobook-project.json").write_text("{}", encoding="utf-8")
    response = client.get("/api/audiobook/segments", params={"workspace_path": str(ws)})
    assert response.status_code == 404
    assert "Save the narration" in response.json()["detail"]


# ── Pronunciations over HTTP ──────────────────────────────────────────────────

def test_pronunciations_round_trip(tmp_path):
    _, ws, _ = _import_txt(tmp_path)

    put = client.put("/api/audiobook/pronunciations", json={
        "workspace_path": str(ws),
        "workspace_rules": [
            {"display_text": "Kaelith", "spoken_text": "KAY-lith"},
        ],
        "global_rules": [
            {"display_text": "Reyes", "spoken_text": "RAY-ess", "scope": "all"},
        ],
    })
    assert put.status_code == 200

    got = client.get("/api/audiobook/pronunciations",
                     params={"workspace_path": str(ws)}).json()
    assert got["workspace_rules"][0]["display_text"] == "Kaelith"
    assert got["global_rules"][0]["scope"] == "all"


def test_pronunciations_reject_bad_scope(tmp_path):
    _, ws, _ = _import_txt(tmp_path)
    response = client.put("/api/audiobook/pronunciations", json={
        "workspace_path": str(ws),
        "workspace_rules": [
            {"display_text": "X", "spoken_text": "Y", "scope": "everywhere"},
        ],
    })
    assert response.status_code == 422       # pydantic pattern guard


# ── Recents ───────────────────────────────────────────────────────────────────

def test_remove_from_recents_keeps_all_files(tmp_path):
    _, ws, _ = _import_txt(tmp_path)
    response = client.post("/api/audiobook/recents/remove",
                           json={"workspace_path": str(ws)})
    assert response.status_code == 200
    assert client.get("/api/audiobook/recents").json()["audiobooks"] == []
    # The spec's hard rule: files untouched.
    assert (ws / "audiobook-project.json").is_file()
    assert (ws / "manuscript" / "narration-copy.md").is_file()


def test_reopening_a_removed_workspace_re_registers_it(tmp_path):
    _, ws, _ = _import_txt(tmp_path)
    client.post("/api/audiobook/recents/remove", json={"workspace_path": str(ws)})
    client.get("/api/audiobook/project", params={"workspace_path": str(ws)})
    recents = client.get("/api/audiobook/recents").json()["audiobooks"]
    assert len(recents) == 1                 # losing the index loses nothing


def test_recents_order_most_recently_opened_first(tmp_path):
    _, ws1, _ = _import_txt(tmp_path, name="alpha")
    _, ws2, _ = _import_txt(tmp_path, name="beta")
    # Touch the first one with an unambiguously later timestamp (the HTTP
    # path stamps wall-clock seconds, which can tie inside one test run).
    recents_store.touch_opened(str(ws1), "2999-01-01T00:00:00Z")
    recents = client.get("/api/audiobook/recents").json()["audiobooks"]
    assert recents[0]["workspace_path"] == str(ws1)
    assert recents[1]["workspace_path"] == str(ws2)
