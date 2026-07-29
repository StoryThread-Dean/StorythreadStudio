# tests/test_audiobook_local_worker.py
# =====================================
# The worker manager and KokoroBackend WITHOUT any real subprocess or
# model: transport errors are simulated by monkeypatching httpx calls.
# (The real end-to-end path -- spawn, model load, actual audio -- is
# covered by the dev-mode manual smoke; pytest must stay hermetic.)

import httpx
import pytest
from fastapi.testclient import TestClient

from app.audiobook import local_worker, pronunciation, recents_store
from app.audiobook.local_worker import KokoroBackend
from app.audiobook.synthesis import SynthesisError
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH", tmp_path / "gp.json")
    # No test may ever spawn a real worker (or find the repo's dev one),
    # and no leftover process state from another file may leak in.
    local_worker.shutdown()
    monkeypatch.setattr(local_worker, "WORKER_INSTALL_DIR", tmp_path / "kokoro-worker")
    monkeypatch.setattr(local_worker, "_dev_worker_dir", lambda: None)


def _backend() -> KokoroBackend:
    return KokoroBackend("http://127.0.0.1:9999",
                         {"model": "kokoro-82m-v1.0", "worker_version": "kokoro-worker 0.1.0"})


def test_backend_carries_engine_identity_for_the_hash():
    backend = _backend()
    assert backend.key == "local-kokoro"
    assert backend.model_id == "kokoro-82m-v1.0"
    assert backend.engine_version == "kokoro-worker 0.1.0"
    assert backend.file_extension == "wav"


def test_backend_success_returns_audio_and_duration(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        return httpx.Response(200, content=b"WAVBYTES",
                              headers={"X-Duration-Seconds": "12.345"})
    monkeypatch.setattr(local_worker.httpx, "post", fake_post)
    audio, duration = _backend().synthesize("text", "af_heart")
    assert audio == b"WAVBYTES"
    assert duration == pytest.approx(12.345)


def test_backend_timeout_is_retryable(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        raise httpx.ReadTimeout("slow")
    monkeypatch.setattr(local_worker.httpx, "post", fake_post)
    with pytest.raises(SynthesisError) as err:
        _backend().synthesize("text", "af_heart")
    assert err.value.retryable is True


def test_backend_server_error_is_not_retryable(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        return httpx.Response(500, text="Synthesis failed: bad voice")
    monkeypatch.setattr(local_worker.httpx, "post", fake_post)
    with pytest.raises(SynthesisError) as err:
        _backend().synthesize("text", "af_heart")
    assert err.value.retryable is False
    assert "bad voice" in str(err.value)


def test_installed_state_reports_none_when_nothing_exists():
    state = local_worker.installed_state()
    assert state["installed"] is False
    assert state["mode"] == "none"
    assert state["running"] is False


def test_spawn_command_prefers_packaged_over_dev(tmp_path, monkeypatch):
    exe_dir = local_worker.WORKER_INSTALL_DIR
    exe_dir.mkdir(parents=True)
    (exe_dir / local_worker.WORKER_EXE_NAME).write_bytes(b"fake exe")
    argv, cwd = local_worker._spawn_command(1234)
    assert argv[0].endswith("kokoro-worker.exe")
    assert "--port" in argv and "1234" in argv
    assert cwd == str(exe_dir)


def test_spawn_command_without_any_worker_raises_honestly():
    with pytest.raises(local_worker.WorkerUnavailableError, match="not installed"):
        local_worker._spawn_command(1234)


# ── Endpoint surface (worker faked at the manager seam) ──────────────────────

def test_engine_status_endpoint_never_spawns():
    response = client.get("/api/audiobook/local-engine/status")
    assert response.status_code == 200
    assert response.json()["mode"] == "none"


def test_voices_endpoint_503_when_unavailable(monkeypatch):
    def raise_unavailable():
        raise local_worker.WorkerUnavailableError("The free local narrator is not installed.")
    monkeypatch.setattr(local_worker, "list_voices", raise_unavailable)
    response = client.get("/api/audiobook/voices")
    assert response.status_code == 503
    assert "not installed" in response.json()["detail"]


def test_voices_endpoint_serves_the_catalog(monkeypatch):
    monkeypatch.setattr(local_worker, "list_voices", lambda: [
        {"id": "af_heart", "label": "Heart (American female)",
         "language": "en-US", "gender_presentation": "female"},
    ])
    response = client.get("/api/audiobook/voices")
    assert response.status_code == 200
    assert response.json()["voices"][0]["id"] == "af_heart"


def test_preview_endpoint_returns_wav_with_payload_prep(tmp_path, monkeypatch):
    sent: list[str] = []

    class FakeBackend(KokoroBackend):
        def __init__(self):
            super().__init__("http://x", {})
        def synthesize(self, text, voice_id, speed=1.0):
            sent.append(text)
            return b"RIFFfake", 1.0

    from app.audiobook import synthesis
    monkeypatch.setattr(synthesis, "resolve_backend", lambda provider: FakeBackend())

    response = client.post("/api/audiobook/preview", json={
        "text": "She ran -- fast.", "voice_id": "af_heart",
    })
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content == b"RIFFfake"
    # Payload prep ran even without a workspace ('--' became an em dash).
    assert sent == ["She ran—fast."]


def test_preview_endpoint_rejects_empty_text():
    response = client.post("/api/audiobook/preview", json={
        "text": "   ", "voice_id": "af_heart",
    })
    assert response.status_code == 400


# ── Install / remove flow (miniature fake artifact, no network) ──────────────

def _make_worker_zip(tmp_path, with_exe: bool = True) -> str:
    import zipfile
    zip_path = tmp_path / "fake-worker.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        if with_exe:
            archive.writestr("kokoro-worker.exe", b"fake engine bytes")
        archive.writestr("_internal/runtime.dll", b"fake dll")
        archive.writestr("models/kokoro-v1.0.onnx", b"fake model")
    return str(zip_path)


@pytest.fixture(autouse=True)
def _reset_install_state():
    local_worker._set_install("idle", 0.0)
    yield
    local_worker.wait_for_install(timeout=10)
    local_worker._set_install("idle", 0.0)


def test_install_from_local_zip_end_to_end(tmp_path):
    zip_path = _make_worker_zip(tmp_path)
    response = client.post("/api/audiobook/local-engine/install",
                           json={"source_zip": zip_path})
    assert response.status_code == 200
    local_worker.wait_for_install()

    status = client.get("/api/audiobook/local-engine/status").json()
    assert status["install"]["state"] == "done"
    assert status["mode"] == "packaged"
    assert "local zip" in status["installed_version"]
    assert (local_worker.WORKER_INSTALL_DIR / "kokoro-worker.exe").is_file()
    assert (local_worker.WORKER_INSTALL_DIR / "models" / "kokoro-v1.0.onnx").is_file()

    # Remove: files gone, mode back to none (dev is disabled in tests).
    response = client.post("/api/audiobook/local-engine/remove")
    assert response.status_code == 200
    status = client.get("/api/audiobook/local-engine/status").json()
    assert status["mode"] == "none"
    assert not local_worker.WORKER_INSTALL_DIR.exists()


def test_install_refuses_when_download_not_published(monkeypatch):
    # No source override + no published sha256 = an honest 400, not a
    # download attempt against a URL that may not exist.
    monkeypatch.setitem(local_worker.WORKER_RELEASE, "sha256", None)
    response = client.post("/api/audiobook/local-engine/install", json={})
    assert response.status_code == 400
    assert "not been published" in response.json()["detail"]


def test_download_integrity_failure_installs_nothing(tmp_path, monkeypatch):
    # Published-path download whose bytes do not match the pinned SHA256:
    # the error is clear and NOTHING lands in the install dir.
    monkeypatch.setitem(local_worker.WORKER_RELEASE, "sha256", "0" * 64)

    class FakeStream:
        def __init__(self):
            self.headers = {"Content-Length": "9"}
        def raise_for_status(self): pass
        def iter_bytes(self, chunk_size): yield b"tampered!"
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(local_worker.httpx, "stream",
                        lambda *a, **k: FakeStream())

    client.post("/api/audiobook/local-engine/install", json={})
    local_worker.wait_for_install()

    status = client.get("/api/audiobook/local-engine/status").json()
    assert status["install"]["state"] == "error"
    assert "integrity check" in status["install"]["error"]
    assert not local_worker.WORKER_INSTALL_DIR.exists()


def test_archive_without_the_engine_is_rejected(tmp_path):
    zip_path = _make_worker_zip(tmp_path, with_exe=False)
    client.post("/api/audiobook/local-engine/install", json={"source_zip": zip_path})
    local_worker.wait_for_install()
    status = local_worker.install_status()
    assert status["state"] == "error"
    assert "does not contain the narrator engine" in status["error"]
    assert not local_worker.WORKER_INSTALL_DIR.exists()


# ── Select-text preview endpoint ──────────────────────────────────────────────

def _import_workspace(tmp_path):
    src = tmp_path / "b.md"
    src.write_text("# Chapter 1\n\nSome prose here.\n", encoding="utf-8")
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "T"})
    assert response.status_code == 200
    return ws


def test_preview_selection_renders_markers_and_rules(tmp_path, monkeypatch):
    ws = _import_workspace(tmp_path)

    sent: list[str] = []

    class FakeBackend(KokoroBackend):
        def __init__(self):
            super().__init__("http://x", {})
        def synthesize(self, text, voice_id, speed=1.0):
            sent.append(text)
            # A tiny real WAV so concat_wav can stitch it.
            import io
            import wave
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(24000)
                w.writeframes(b"\x01\x02" * 2400)
            return buffer.getvalue(), 0.1

    from app.audiobook import synthesis
    monkeypatch.setattr(synthesis, "resolve_backend", lambda provider: FakeBackend())

    response = client.post("/api/audiobook/preview-selection", json={
        "workspace_path": str(ws),
        "text": "She ran.\n\n[pause:0.5]\n\n[exclude]note[/exclude]\n\nShe stopped -- cold.",
        "voice_id": "af_heart",
    })
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    # Markers were structural, not narrated; excluded text never spoken;
    # payload prep ran ('--' became an em dash).
    assert sent == ["She ran.", "She stopped—cold."]


def test_preview_selection_surfaces_parse_warnings_in_header(tmp_path, monkeypatch):
    ws = _import_workspace(tmp_path)

    class FakeBackend(KokoroBackend):
        def __init__(self):
            super().__init__("http://x", {})
        def synthesize(self, text, voice_id, speed=1.0):
            import io
            import wave
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(24000)
                w.writeframes(b"\x01\x02" * 240)
            return buffer.getvalue(), 0.01

    from app.audiobook import synthesis
    monkeypatch.setattr(synthesis, "resolve_backend", lambda provider: FakeBackend())

    # A selection that cut INTO a pace span: stray closer, no opener.
    response = client.post("/api/audiobook/preview-selection", json={
        "workspace_path": str(ws),
        "text": "Was inside the span.[/pace]\n\nAfter it.",
        "voice_id": "af_heart",
    })
    assert response.status_code == 200
    from urllib.parse import unquote
    import json as jsonlib
    warnings = jsonlib.loads(unquote(response.headers["X-Preview-Warnings"]))
    assert any("no opening [pace:...]" in w for w in warnings)


def test_preview_selection_caps_length(tmp_path, monkeypatch):
    ws = _import_workspace(tmp_path)
    response = client.post("/api/audiobook/preview-selection", json={
        "workspace_path": str(ws), "text": "x" * 3001, "voice_id": "v",
    })
    assert response.status_code == 400
    assert "3,000" in response.json()["detail"]


def test_preview_selection_requires_a_selection(tmp_path):
    ws = _import_workspace(tmp_path)
    response = client.post("/api/audiobook/preview-selection", json={
        "workspace_path": str(ws), "text": "   ", "voice_id": "v",
    })
    assert response.status_code == 400
    assert "Select a passage" in response.json()["detail"]

