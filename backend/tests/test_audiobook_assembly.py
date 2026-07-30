# tests/test_audiobook_assembly.py
# =================================
# The assembler against REAL ffmpeg: a fabricated two-chapter book with
# tone-WAV "segments" goes through stitch -> loudnorm -> encode, and
# ffprobe verifies what came out (durations incl. silence, ID3 tags, M4B
# chapter markers).
#
# Requirement: ffmpeg must be resolvable (the app-data install or PATH).
# These tests READ the installed tool like they read the python on PATH;
# they never write outside tmp_path. A missing ffmpeg fails loudly with
# the resolver's install message -- that is the correct signal, not a
# skip.

import io
import json
import subprocess
import wave
from pathlib import Path

import pytest

from app.audiobook import assembly, pronunciation, recents_store, segmenter, workspace
from app.audiobook.assembly import AssemblyError, assemble_book, sanitize_component


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH", tmp_path / "gp.json")


def _tone_wav_bytes(seconds: float, rate: int = 24000) -> bytes:
    # A quiet square-ish tone (NOT silence -- loudnorm needs real signal).
    frames = int(rate * seconds)
    sample = (b"\x00\x20" * 50 + b"\x00\xe0" * 50)
    body = (sample * (frames // 100 + 1))[: frames * 2]
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(body)
    return buffer.getvalue()


def _make_generated_book(tmp_path, narration: str, title: str) -> str:
    """A workspace whose every segment 'generated' a half-second tone."""
    ws = tmp_path / "ws"
    workspace.create_workspace_dirs(str(ws))
    manifest = workspace.new_manifest(str(ws), title=title, author="Dean",
                                      source_file="")
    manifest["selected_voice"] = "af_heart"
    workspace.save_manifest(str(ws), manifest)
    workspace.write_narration(str(ws), narration)

    seg_manifest = segmenter.load_segments(str(ws))
    for chapter in seg_manifest["chapters"]:
        for item in chapter["items"]:
            if item.get("kind") != "segment":
                continue
            rel = f"generated-segments/{chapter['chapter_id']}/{item['segment_id']}.wav"
            path = ws / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(_tone_wav_bytes(0.5))
            item.update({"status": "completed", "output_file": rel})
    segmenter.save_segments(str(ws), seg_manifest)
    return str(ws)


def _ffprobe_json(path: str, *extra: str) -> dict:
    _ffmpeg, ffprobe = assembly.resolve_ffmpeg()
    result = subprocess.run(
        [ffprobe, "-v", "error", "-of", "json", *extra, path],
        capture_output=True, text=True)
    return json.loads(result.stdout)


# ── Filename sanitizer (spec 8.1) ─────────────────────────────────────────────

def test_sanitize_component_rules():
    assert sanitize_component("The Hollow Road: Book 2?") == "The Hollow Road Book 2"
    assert sanitize_component("dots and spaces . . ") == "dots and spaces"
    assert sanitize_component("CON") == "CON audio"          # reserved device
    assert sanitize_component("<>:|?*") == "Untitled"        # nothing survives
    assert len(sanitize_component("x" * 300)) <= 60


# ── The full pipeline ─────────────────────────────────────────────────────────

NARRATION = (
    "# The Door\n\nFirst piece of prose.\n\n[pause:1.0]\n\nSecond piece.\n\n"
    "# The Window\n\nOnly piece of chapter two."
)


def test_assemble_all_formats_end_to_end(tmp_path):
    ws = _make_generated_book(tmp_path, NARRATION, "Hollow: Road?")

    report = assemble_book(ws, ["chapter_mp3", "combined_mp3", "m4b"])
    assert report["chapters"] == 2
    outputs = [Path(ws) / p for p in report["outputs"]]
    for path in outputs:
        assert path.is_file() and path.stat().st_size > 0

    # Chapter MP3s: zero-padded, sanitized names (spec 26.4).
    names = sorted(p.name for p in (Path(ws) / "output" / "chapters").iterdir())
    assert names == ["01 - The Door.mp3", "02 - The Window.mp3"]

    # Chapter one = two 0.5s segments + a 1.0s pause = ~2.0s.
    fmt = _ffprobe_json(str(Path(ws) / "output" / "chapters" / "01 - The Door.mp3"),
                        "-show_entries", "format=duration:format_tags=title,album,artist,composer,track")
    assert float(fmt["format"]["duration"]) == pytest.approx(2.0, abs=0.25)
    tags = {k.lower(): v for k, v in fmt["format"].get("tags", {}).items()}
    assert tags["title"] == "The Door"
    assert tags["album"] == "Hollow: Road?"      # tags keep the REAL title
    assert tags["artist"] == "Dean"
    assert tags["composer"] == "af_heart"
    assert tags["track"] == "1/2"

    # Combined MP3 and M4B carry the sanitized book name.
    assert (Path(ws) / "output" / "Hollow Road.mp3").is_file()
    m4b = Path(ws) / "output" / "Hollow Road.m4b"
    assert m4b.is_file()

    # M4B chapter markers: two chapters, right titles, contiguous times.
    chapters = _ffprobe_json(str(m4b), "-show_chapters")["chapters"]
    assert [c["tags"]["title"] for c in chapters] == ["The Door", "The Window"]
    assert float(chapters[0]["start_time"]) == pytest.approx(0.0, abs=0.1)
    assert float(chapters[1]["start_time"]) == pytest.approx(
        float(chapters[0]["end_time"]), abs=0.1)

    # Combined duration ~ chapter1 (2.0s) + chapter2 (0.5s).
    combined = _ffprobe_json(str(Path(ws) / "output" / "Hollow Road.mp3"),
                             "-show_entries", "format=duration")
    assert float(combined["format"]["duration"]) == pytest.approx(2.5, abs=0.35)


def test_break_silence_comes_from_narration_settings(tmp_path):
    ws = _make_generated_book(
        tmp_path, "# One\n\nBefore the scene break.\n\n[scene-break]\n\nAfter it.",
        "Breaks")
    manifest = workspace.load_manifest(ws)
    manifest["narration"] = {"narrator_pace": 1.0, "dialogue_pace": 1.0,
                             "scene_break_ms": 3000, "chapter_break_ms": 3000}
    workspace.save_manifest(ws, manifest)

    assemble_book(ws, ["chapter_mp3"])
    mp3 = next((Path(ws) / "output" / "chapters").iterdir())
    fmt = _ffprobe_json(str(mp3), "-show_entries", "format=duration")
    # 0.5s + 3.0s configured scene break + 0.5s.
    assert float(fmt["format"]["duration"]) == pytest.approx(4.0, abs=0.25)


def test_refuses_when_generation_is_incomplete(tmp_path):
    ws = _make_generated_book(tmp_path, NARRATION, "Partial")
    seg_manifest = segmenter.load_segments(ws)
    # Un-complete one segment of chapter two.
    for chapter in seg_manifest["chapters"]:
        for item in chapter["items"]:
            if item.get("kind") == "segment" and chapter["title"] == "The Window":
                item["status"] = "pending"
    segmenter.save_segments(ws, seg_manifest)

    with pytest.raises(AssemblyError, match="not fully generated"):
        assemble_book(ws, ["chapter_mp3"])
    # Nothing half-exported.
    assert not any((Path(ws) / "output" / "chapters").iterdir())


def test_refuses_before_any_generation(tmp_path):
    ws = tmp_path / "empty"
    workspace.create_workspace_dirs(str(ws))
    workspace.save_manifest(str(ws), workspace.new_manifest(str(ws), "T", "", ""))
    with pytest.raises(AssemblyError, match="generate the audiobook first"):
        assemble_book(str(ws), ["m4b"])


# ── The export runner + HTTP surface ─────────────────────────────────────────

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_export_endpoint_end_to_end(tmp_path):
    ws = _make_generated_book(tmp_path, NARRATION, "Endpoint Book")

    response = client.post("/api/audiobook/assemble", json={
        "workspace_path": ws, "formats": ["chapter_mp3", "m4b"],
    })
    assert response.status_code == 200, response.text
    assembly.wait_for_export()

    status = client.get("/api/audiobook/assemble/status").json()
    assert status["state"] == "done"
    assert len(status["outputs"]) == 3          # 2 chapter MP3s + 1 M4B
    for rel in status["outputs"]:
        assert (Path(ws) / rel).is_file()


def test_export_endpoint_fails_fast_on_empty_formats(tmp_path):
    ws = _make_generated_book(tmp_path, NARRATION, "T")
    response = client.post("/api/audiobook/assemble", json={
        "workspace_path": ws, "formats": [],
    })
    assert response.status_code == 400
    assert "at least one" in response.json()["detail"]


def test_export_503_when_ffmpeg_missing(tmp_path, monkeypatch):
    ws = _make_generated_book(tmp_path, NARRATION, "T")
    monkeypatch.setattr(assembly, "FFMPEG_DIR", tmp_path / "no-ffmpeg")
    monkeypatch.setattr(assembly.shutil, "which", lambda name: None)
    response = client.post("/api/audiobook/assemble", json={
        "workspace_path": ws, "formats": ["m4b"],
    })
    assert response.status_code == 503
    assert "not installed" in response.json()["detail"]


def test_export_fails_fast_on_disk_shortfall(tmp_path, monkeypatch):
    ws = _make_generated_book(tmp_path, NARRATION, "T")

    class TinyDisk:
        free = 1024
    monkeypatch.setattr(assembly.shutil, "disk_usage", lambda p: TinyDisk)
    response = client.post("/api/audiobook/assemble", json={
        "workspace_path": ws, "formats": ["m4b"],
    })
    assert response.status_code == 400
    assert "Free up space" in response.json()["detail"]


def test_ffmpeg_status_endpoint_shape():
    body = client.get("/api/audiobook/ffmpeg/status").json()
    assert body["installed"] is True            # this machine has the pin
    assert body["version"] == assembly.FFMPEG_RELEASE["version"]
    assert body["install"]["state"] in ("idle", "done")