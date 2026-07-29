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
        def synthesize(self, text, voice_id):
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
