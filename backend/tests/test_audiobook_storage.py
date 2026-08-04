# tests/test_audiobook_storage.py
# ================================
# Storage measurement and cleanup (spec 25). This module DELETES files,
# so its tests are written around the two ways that goes wrong:
#
#   1. Deleting more than was asked for. Every test that cleans one
#      category asserts the others are still on disk, and the files that
#      carry the writer's own work (narration copy, manifest, chapter
#      records, segments.json) are checked explicitly every time.
#   2. Leaving the manifest lying. Audio can be deleted out from under a
#      segment that claims `status: completed`; if the record is not
#      reset, the app promises an export it cannot produce.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.audiobook import pronunciation, recents_store, segmenter, storage, workspace
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


def _workspace(tmp_path) -> str:
    src = tmp_path / "book.txt"
    src.write_text("Chapter 1\n\nThe road vanished under snow.\n", encoding="utf-8")
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws),
        "title": "The Hollow Road",
    })
    assert response.status_code == 200, response.text
    return str(ws)


def _write(path: str, size: int = 100) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\0" * size)
    return path


def _populate(ws: str) -> dict[str, str]:
    """One file per category, with the live one recorded in segments.json
    the way generation would record it."""
    live_rel = os.path.join("generated-segments", "chapter-001", "seg-live.wav")
    paths = {
        "preview": _write(os.path.join(ws, "previews", "audition.wav"), 300),
        "failed": _write(os.path.join(ws, "generated-segments", "chapter-001",
                                      "seg-bad.wav.rejected"), 400),
        "orphan": _write(os.path.join(ws, "generated-segments", "chapter-001",
                                      "seg-old.wav"), 500),
        "revision": _write(os.path.join(ws, "revisions", "seg-older.wav"), 600),
        "live": _write(os.path.join(ws, live_rel), 700),
        "export": _write(os.path.join(ws, "output", "The Hollow Road.m4b"), 900),
    }
    manifest = {
        "version": segmenter.SEGMENTS_VERSION,
        "chapters": [{
            "chapter_id": "chapter-001",
            "title": "Chapter 1",
            "items": [{
                "kind": "segment", "segment_id": "seg-live",
                "chapter_id": "chapter-001", "text": "The road vanished under snow.",
                "content_hash": "hash-live", "generated_hash": "hash-live",
                "payload_hash": "payload-live", "status": "completed",
                "duration_seconds": 3.0, "voice_id": "af_heart",
                "output_file": live_rel,
            }],
        }],
        "superseded": [],
    }
    segmenter.save_segments(ws, manifest)
    return paths


def _by_key(scan: dict) -> dict[str, dict]:
    return {c["key"]: c for c in scan["categories"]}


# ── Measuring ─────────────────────────────────────────────────────────────────

def test_every_category_is_measured_separately(tmp_path):
    ws = _workspace(tmp_path)
    _populate(ws)
    cats = _by_key(storage.scan(ws))

    assert cats[storage.PREVIEWS]["bytes"] == 300
    assert cats[storage.FAILED_ATTEMPTS]["bytes"] == 400
    # Orphaned segment audio + the revisions folder are both "superseded".
    assert cats[storage.SUPERSEDED]["bytes"] == 500 + 600
    assert cats[storage.CURRENT_SEGMENTS]["bytes"] == 700
    assert cats[storage.EXPORTS]["bytes"] == 900
    # The imported source copy is real, so this is measured, not zero.
    assert cats[storage.SOURCE_SNAPSHOTS]["files"] >= 1


def test_orphaned_audio_counts_as_superseded_even_without_a_record(tmp_path):
    # Classification is by LEFTOVER, not by the superseded list. Audio
    # orphaned by an older build, or by a manifest that lost a record,
    # would otherwise be invisible forever and never reclaimable.
    ws = _workspace(tmp_path)
    _populate(ws)
    stored = segmenter.load_segments(ws)
    assert stored["superseded"] == []           # nothing recorded at all
    assert _by_key(storage.scan(ws))[storage.SUPERSEDED]["files"] == 2


def test_segments_json_is_never_a_deletion_candidate(tmp_path):
    # It holds identity and the writer's formatting -- losing it costs
    # far more than losing audio, which is only a re-render.
    ws = _workspace(tmp_path)
    _populate(ws)
    grouped = storage._category_files(ws)
    every_file = [p for files in grouped.values() for p in files]
    assert not [p for p in every_file if p.endswith("segments.json")]


def test_the_dangerous_categories_are_never_pre_checked(tmp_path):
    # Spec 25.3: final exports must not be selected by default. The same
    # rule is applied to anything else that cannot be rebuilt.
    ws = _workspace(tmp_path)
    cats = _by_key(storage.scan(ws))
    assert cats[storage.PREVIEWS]["default_selected"] is True
    assert cats[storage.FAILED_ATTEMPTS]["default_selected"] is True
    for key in (storage.SUPERSEDED, storage.CURRENT_SEGMENTS,
                storage.SOURCE_SNAPSHOTS, storage.EXPORTS):
        assert cats[key]["default_selected"] is False, key
    assert cats[storage.EXPORTS]["protected"] is True
    assert cats[storage.SOURCE_SNAPSHOTS]["protected"] is True
    # Anything irreversible says what is lost, in the writer's terms.
    assert "narrating the book again" in cats[storage.CURRENT_SEGMENTS]["consequence"]


# ── Retention ─────────────────────────────────────────────────────────────────

def test_retention_defaults_to_keep_and_migrates_the_old_boolean():
    assert storage.retention_mode({}) == storage.RETENTION_KEEP
    # Workspaces predating the setting carry the boolean; it must not
    # reset a writer's choice on upgrade.
    assert storage.retention_mode(
        {"retain_intermediate_audio": True}) == storage.RETENTION_KEEP
    assert storage.retention_mode(
        {"retain_intermediate_audio": False}) == storage.RETENTION_DELETE
    # An explicit choice always wins over the legacy field.
    assert storage.retention_mode({
        "retain_intermediate_audio": False,
        "intermediate_retention": storage.RETENTION_ASK,
    }) == storage.RETENTION_ASK
    # Junk falls back to the safe answer rather than deleting anything.
    assert storage.retention_mode(
        {"intermediate_retention": "nonsense"}) == storage.RETENTION_KEEP


# ── Deleting ──────────────────────────────────────────────────────────────────

def test_cleanup_deletes_only_what_was_asked_for(tmp_path):
    ws = _workspace(tmp_path)
    paths = _populate(ws)
    result = storage.cleanup(ws, [storage.PREVIEWS, storage.FAILED_ATTEMPTS])

    assert not os.path.exists(paths["preview"])
    assert not os.path.exists(paths["failed"])
    assert result["freed_bytes"] == 300 + 400
    # Everything else survives, including both irreversible categories.
    for key in ("orphan", "revision", "live", "export"):
        assert os.path.isfile(paths[key]), key
    # And the writer's own work is never in range.
    assert os.path.isfile(workspace.narration_path(ws))
    assert os.path.isfile(workspace.manifest_path(ws))
    assert os.path.isfile(segmenter.segments_path(ws))


def test_deleting_current_segments_resets_them_to_not_generated(tmp_path):
    # The failure this prevents: segments.json still claiming completed
    # for audio that is gone, so the app offers an export it cannot make.
    ws = _workspace(tmp_path)
    _populate(ws)
    storage.cleanup(ws, [storage.CURRENT_SEGMENTS])

    segment = segmenter.load_segments(ws)["chapters"][0]["items"][0]
    assert segment["status"] == "pending"
    assert "output_file" not in segment
    assert "generated_hash" not in segment
    assert "payload_hash" not in segment
    # Identity and the writer's text survive -- only the audio is gone.
    assert segment["segment_id"] == "seg-live"
    assert segment["text"] == "The road vanished under snow."
    assert segment["content_hash"] == "hash-live"


def test_deleting_superseded_leaves_live_audio_alone(tmp_path):
    ws = _workspace(tmp_path)
    paths = _populate(ws)
    storage.cleanup(ws, [storage.SUPERSEDED])

    assert not os.path.exists(paths["orphan"])
    assert not os.path.exists(paths["revision"])
    assert os.path.isfile(paths["live"])
    segment = segmenter.load_segments(ws)["chapters"][0]["items"][0]
    assert segment["status"] == "completed"      # untouched


def test_cleanup_refuses_an_unknown_category(tmp_path):
    # Silently ignoring it would report success while deleting nothing.
    ws = _workspace(tmp_path)
    with pytest.raises(ValueError, match="Unknown cleanup category"):
        storage.cleanup(ws, ["everything"])


def test_the_workspace_layout_survives_a_cleanup(tmp_path):
    # Other code assumes these folders exist; a cleanup must not leave
    # the workspace half-built.
    ws = _workspace(tmp_path)
    _populate(ws)
    storage.cleanup(ws, [storage.PREVIEWS, storage.CURRENT_SEGMENTS,
                         storage.SUPERSEDED])
    for sub in workspace.WORKSPACE_SUBDIRS:
        assert os.path.isdir(os.path.join(ws, sub)), sub


def test_export_only_when_the_audio_goes_but_the_book_remains(tmp_path):
    ws = _workspace(tmp_path)
    _populate(ws)
    assert storage.scan(ws)["export_only"] is False

    after = storage.cleanup(ws, [storage.CURRENT_SEGMENTS])
    assert after["storage"]["export_only"] is True
    assert "generating the narration again" in after["storage"]["export_only_note"]


def test_a_workspace_with_no_exports_is_not_export_only(tmp_path):
    # A book that has simply never been generated is "not started", not
    # "export only" -- the state must not be inferred from emptiness.
    ws = _workspace(tmp_path)
    scan = storage.scan(ws)
    assert scan["export_only"] is False
    assert scan["has_exports"] is False


# ── HTTP surface ──────────────────────────────────────────────────────────────

def test_storage_endpoint_reports_categories_and_retention(tmp_path):
    ws = _workspace(tmp_path)
    _populate(ws)
    response = client.get("/api/audiobook/storage", params={"workspace_path": ws})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["retention"] == storage.RETENTION_KEEP
    assert [c["key"] for c in body["categories"]] == storage.CATEGORY_ORDER
    assert body["total_bytes"] > 0


def test_retention_endpoint_round_trips_and_keeps_the_legacy_flag(tmp_path):
    ws = _workspace(tmp_path)
    response = client.put("/api/audiobook/storage/retention", json={
        "workspace_path": ws, "retention": "delete_after_export"})
    assert response.status_code == 200, response.text
    assert response.json()["retention"] == "delete_after_export"

    with open(workspace.manifest_path(ws), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    assert manifest["intermediate_retention"] == "delete_after_export"
    # An older build reads the boolean and must reach the same conclusion.
    assert manifest["retain_intermediate_audio"] is False


def test_retention_endpoint_rejects_an_invalid_mode(tmp_path):
    ws = _workspace(tmp_path)
    response = client.put("/api/audiobook/storage/retention", json={
        "workspace_path": ws, "retention": "delete_everything_now"})
    assert response.status_code == 422


def test_cleanup_endpoint_refuses_an_empty_selection(tmp_path):
    # An empty request is almost always a UI bug. Answering it with a
    # cheerful "freed 0 bytes" would hide that.
    ws = _workspace(tmp_path)
    response = client.post("/api/audiobook/storage/cleanup", json={
        "workspace_path": ws, "categories": []})
    assert response.status_code == 400
    assert "nothing was deleted" in response.json()["detail"]


def test_cleanup_endpoint_deletes_and_returns_a_fresh_scan(tmp_path):
    ws = _workspace(tmp_path)
    paths = _populate(ws)
    response = client.post("/api/audiobook/storage/cleanup", json={
        "workspace_path": ws, "categories": ["previews"]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deleted"]["previews"]["files"] == 1
    assert not os.path.exists(paths["preview"])
    # The response carries the new state, so the dialog never has to
    # guess what is left after its own delete.
    assert _by_key(body["storage"])[storage.PREVIEWS]["bytes"] == 0


def test_storage_endpoint_404s_on_a_folder_that_is_not_a_workspace(tmp_path):
    response = client.get("/api/audiobook/storage",
                          params={"workspace_path": str(tmp_path / "nowhere")})
    assert response.status_code == 404
