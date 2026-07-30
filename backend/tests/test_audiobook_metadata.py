# tests/test_audiobook_metadata.py
# =================================
# Book metadata + cover art (spec 17): the manifest store, the HTTP
# surface, and the cover validators. What the exported files SAY about
# themselves -- the assembly-side tagging is covered in
# test_audiobook_assembly.py against real ffmpeg.

import base64
import json

import pytest
from fastapi.testclient import TestClient

from app.audiobook import pronunciation, recents_store, workspace
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


# A real, decodable 1x1 red PNG -- small enough to inline, real enough
# for header parsing and (in the assembly test) ffmpeg embedding.
RED_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ"
    "DwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _workspace(tmp_path) -> str:
    src = tmp_path / "book.txt"
    src.write_text("Chapter 1\n\nSome prose.\n", encoding="utf-8")
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws),
        "title": "The Hollow Road",
    })
    assert response.status_code == 200, response.text
    return str(ws)


# ── The merged view ───────────────────────────────────────────────────────────

def test_metadata_defaults_fall_back_to_the_manifest():
    meta = workspace.book_metadata({
        "title": "The Hollow Road", "author": "Dean", "language": "en-US",
    })
    assert meta["title"] == "The Hollow Road"
    assert meta["author"] == "Dean"
    assert meta["language"] == "en-US"
    assert meta["narrator"] == ""
    assert meta["use_chapter_names"] is True
    assert meta["embed_cover"] is True
    assert meta["apply_to_chapter_mp3s"] is True
    assert meta["cover_file"] is None


def test_stored_metadata_wins_over_the_manifest():
    meta = workspace.book_metadata({
        "title": "Working Title",
        "metadata": {"title": "The Real Title", "publisher": "Storythread",
                     "use_chapter_names": False},
    })
    assert meta["title"] == "The Real Title"
    assert meta["publisher"] == "Storythread"
    assert meta["use_chapter_names"] is False


# ── Cover validation ──────────────────────────────────────────────────────────

def test_validate_cover_reads_png_dimensions():
    ext, width, height = workspace.validate_cover_bytes(RED_PIXEL_PNG)
    assert (ext, width, height) == ("png", 1, 1)


def test_validate_cover_reads_jpeg_dimensions():
    # Minimal JPEG: SOI, APP0 (JFIF), SOF0 declaring 240x320, no scan data
    # needed -- the validator only reads headers.
    jpeg = (
        b"\xff\xd8"
        b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xc0\x00\x11\x08" + (240).to_bytes(2, "big") + (320).to_bytes(2, "big")
        + b"\x03\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )
    ext, width, height = workspace.validate_cover_bytes(jpeg)
    assert (ext, width, height) == ("jpg", 320, 240)


def test_validate_cover_rejects_other_formats_and_oversize():
    with pytest.raises(ValueError, match="JPG or PNG"):
        workspace.validate_cover_bytes(b"GIF89a not a cover")
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (workspace.COVER_MAX_BYTES + 1)
    with pytest.raises(ValueError, match="MB"):
        workspace.validate_cover_bytes(big)


# ── The HTTP surface ──────────────────────────────────────────────────────────

def test_metadata_roundtrip_over_the_api(tmp_path):
    ws = _workspace(tmp_path)

    initial = client.get("/api/audiobook/metadata", params={"workspace_path": ws})
    assert initial.status_code == 200
    assert initial.json()["title"] == "The Hollow Road"     # manifest fallback

    put = client.put("/api/audiobook/metadata", json={
        "workspace_path": ws,
        "title": "The Hollow Road", "subtitle": "A Tomb Raider Story",
        "author": "Dean", "narrator": "Heart",
        "series": "Tomb Raider", "series_number": "1",
        "description": "A librarian meets a legend.",
        "genre": "Adventure", "publication_year": "2026",
        "publisher": "Storythread", "copyright": "(c) 2026 Dean",
        "language": "en-US",
        "use_chapter_names": False, "embed_cover": True,
        "apply_to_chapter_mp3s": False,
    })
    assert put.status_code == 200
    saved = put.json()
    assert saved["subtitle"] == "A Tomb Raider Story"
    assert saved["use_chapter_names"] is False
    assert saved["apply_to_chapter_mp3s"] is False

    again = client.get("/api/audiobook/metadata", params={"workspace_path": ws})
    assert again.json() == saved


def test_cover_upload_preview_and_removal(tmp_path):
    ws = _workspace(tmp_path)
    image = tmp_path / "art.png"
    image.write_bytes(RED_PIXEL_PNG)

    set_response = client.post("/api/audiobook/metadata/cover", json={
        "workspace_path": ws, "source_path": str(image)})
    assert set_response.status_code == 200
    body = set_response.json()
    assert body == {"cover_file": "cover.png", "width": 1, "height": 1,
                    "square": True}

    # The preview endpoint serves the stored bytes.
    preview = client.get("/api/audiobook/metadata/cover-image",
                         params={"workspace_path": ws})
    assert preview.status_code == 200
    assert preview.content == RED_PIXEL_PNG
    assert preview.headers["content-type"].startswith("image/png")

    # A metadata PUT must not lose the stored cover.
    client.put("/api/audiobook/metadata", json={
        "workspace_path": ws, "title": "Edited"})
    meta = client.get("/api/audiobook/metadata",
                      params={"workspace_path": ws}).json()
    assert meta["cover_file"] == "cover.png"

    removed = client.delete("/api/audiobook/metadata/cover",
                            params={"workspace_path": ws})
    assert removed.status_code == 200
    assert removed.json() == {"cover_file": None}
    assert client.get("/api/audiobook/metadata/cover-image",
                      params={"workspace_path": ws}).status_code == 404


def test_cover_upload_rejects_a_text_file(tmp_path):
    ws = _workspace(tmp_path)
    fake = tmp_path / "cover.jpg"
    fake.write_text("not an image at all", encoding="utf-8")
    response = client.post("/api/audiobook/metadata/cover", json={
        "workspace_path": ws, "source_path": str(fake)})
    assert response.status_code == 400
    assert "JPG or PNG" in response.json()["detail"]


# ── Source-project prefill ────────────────────────────────────────────────────
# The writer already typed genre/description/series into their
# Storythread project -- the metadata form must not ask twice.

def _project_sourced_workspace(tmp_path) -> str:
    """A workspace whose recorded origin is a Storythread project inside
    a series."""
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    (series_dir / "series.json").write_text(json.dumps({
        "series_id": "s1", "name": "The Hollow Saga"}), encoding="utf-8")

    project = tmp_path / "project"
    (project / "manuscript").mkdir(parents=True)
    (project / "project.json").write_text(json.dumps({
        "project_id": "p1", "title": "The Hollow Road",
        "genre": "Urban Fantasy", "description": "A librarian meets a legend.",
        "series_path": str(series_dir),
    }), encoding="utf-8")
    (project / "manuscript" / "chapter-01.md").write_text(
        "# The Door\n\nProse.\n", encoding="utf-8")

    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(project), "workspace_path": str(ws),
        "title": "The Hollow Road",
    })
    assert response.status_code == 200, response.text
    return str(ws)


def test_empty_fields_prefill_from_the_source_project(tmp_path):
    ws = _project_sourced_workspace(tmp_path)
    meta = client.get("/api/audiobook/metadata",
                      params={"workspace_path": ws}).json()
    assert meta["genre"] == "Urban Fantasy"
    assert meta["description"] == "A librarian meets a legend."
    assert meta["series"] == "The Hollow Saga"


def test_saved_metadata_beats_the_project_prefill(tmp_path):
    ws = _project_sourced_workspace(tmp_path)
    client.put("/api/audiobook/metadata", json={
        "workspace_path": ws, "title": "The Hollow Road",
        "genre": "Adventure"})
    meta = client.get("/api/audiobook/metadata",
                      params={"workspace_path": ws}).json()
    assert meta["genre"] == "Adventure"              # the writer's word wins
    # Fields the writer left empty still prefill.
    assert meta["series"] == "The Hollow Saga"


def test_prefill_survives_a_moved_project(tmp_path):
    import shutil
    ws = _project_sourced_workspace(tmp_path)
    shutil.rmtree(tmp_path / "project")
    meta = client.get("/api/audiobook/metadata",
                      params={"workspace_path": ws}).json()
    assert meta["genre"] == ""                       # no crash, just no prefill


# ── Per-book voice memory ─────────────────────────────────────────────────────

def test_selected_voice_persists_per_book(tmp_path):
    ws = _workspace(tmp_path)
    put = client.put("/api/audiobook/voice", json={
        "workspace_path": ws, "voice_id": "bf_emma"})
    assert put.status_code == 200
    project = client.get("/api/audiobook/project",
                         params={"workspace_path": ws}).json()
    assert project["manifest"]["selected_voice"] == "bf_emma"