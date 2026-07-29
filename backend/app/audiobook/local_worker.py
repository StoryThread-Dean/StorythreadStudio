# audiobook/local_worker.py -- managing the kokoro-worker subprocess.
# ====================================================================
# The free local narrator is a SEPARATE program (spec 14.1): the frozen
# Storythread backend cannot install the ONNX runtime into itself, so the
# worker ships as its own artifact, spawned on demand and supervised here.
#
# Two ways the worker can exist:
#   PACKAGED: ~/.storythread/kokoro-worker/kokoro-worker.exe -- installed
#             by the component manager (download + SHA256 verify; the
#             download flow lands with the packaged build).
#   DEV:      the repo's kokoro-worker/ project, spawned via `uv run` --
#             which is what makes the whole pipeline testable TODAY,
#             before any exe is built or published.
#
# Lifecycle: ensure_running() spawns once and reuses; the process is
# terminated when the backend exits (atexit) -- the worker never outlives
# the app, same rule as the sidecar itself.

import atexit
import socket
import subprocess
import threading
import time
from pathlib import Path

import httpx

from app.audiobook.synthesis import SynthesisBackend, SynthesisError

# Packaged install location (component manager's target).
WORKER_INSTALL_DIR = Path.home() / ".storythread" / "kokoro-worker"
WORKER_EXE_NAME = "kokoro-worker.exe"

# How long to wait for the worker's /health after spawn. First start pays
# a 310MB model load; a cold exe on a slow disk needs real headroom.
STARTUP_TIMEOUT_SECONDS = 90.0

# Per-segment synthesis timeout: Kokoro runs ~2-5x realtime on CPU, so a
# 1,500-char segment (~90s of audio) needs under a minute -- 180s is a
# generous ceiling that still fails fast enough to retry.
SYNTHESIS_TIMEOUT_SECONDS = 180.0

_lock = threading.Lock()
_process: subprocess.Popen | None = None
_base_url: str | None = None
_health: dict | None = None


class WorkerUnavailableError(Exception):
    """The local narrator is not installed or failed to start."""


def _dev_worker_dir() -> Path | None:
    """The repo's kokoro-worker/ project, when running from a checkout.
    backend/app/audiobook/local_worker.py -> repo root is four parents up."""
    candidate = Path(__file__).resolve().parents[3] / "kokoro-worker"
    if (candidate / "main.py").is_file() and (candidate / "models").is_dir():
        return candidate
    return None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def installed_state() -> dict:
    """What the component manager and Settings show."""
    packaged = (WORKER_INSTALL_DIR / WORKER_EXE_NAME).is_file()
    dev = _dev_worker_dir() is not None
    return {
        "installed": packaged or dev,
        "mode": "packaged" if packaged else ("dev" if dev else "none"),
        "running": _process is not None and _process.poll() is None,
        "health": _health,
    }


def _spawn_command(port: int) -> tuple[list[str], str]:
    """(argv, cwd) for whichever worker flavor exists. Packaged wins."""
    exe = WORKER_INSTALL_DIR / WORKER_EXE_NAME
    if exe.is_file():
        return ([str(exe), "--port", str(port),
                 "--models-dir", str(WORKER_INSTALL_DIR / "models")],
                str(WORKER_INSTALL_DIR))
    dev_dir = _dev_worker_dir()
    if dev_dir is not None:
        return (["uv", "run", "--project", str(dev_dir),
                 "python", "main.py", "--port", str(port)],
                str(dev_dir))
    raise WorkerUnavailableError(
        "The free local narrator is not installed. Install it from the "
        "Audiobook Converter's voice settings."
    )


def ensure_running() -> str:
    """Spawn the worker if needed, wait for a healthy model, return its
    base URL. Raises WorkerUnavailableError with a user-facing message."""
    global _process, _base_url, _health
    with _lock:
        if _process is not None and _process.poll() is None and _base_url:
            return _base_url

        port = _free_port()
        argv, cwd = _spawn_command(port)
        try:
            # No console window on Windows; stdout/stderr to a log file in
            # the app data dir so a startup crash is diagnosable.
            WORKER_INSTALL_DIR.mkdir(parents=True, exist_ok=True)
            log_file = open(WORKER_INSTALL_DIR / "worker.log", "ab")
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            _process = subprocess.Popen(
                argv, cwd=cwd, stdout=log_file, stderr=log_file,
                creationflags=creationflags,
            )
        except OSError as e:
            raise WorkerUnavailableError(f"Could not start the local narrator: {e}")

        base_url = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
        last_error = "no response"
        while time.monotonic() < deadline:
            if _process.poll() is not None:
                _process = None
                raise WorkerUnavailableError(
                    "The local narrator exited during startup. See "
                    f"{WORKER_INSTALL_DIR / 'worker.log'} for details."
                )
            try:
                response = httpx.get(f"{base_url}/health", timeout=2.0)
                body = response.json()
                if body.get("ok"):
                    _base_url = base_url
                    _health = body
                    return base_url
                last_error = "model still loading"
            except Exception as e:
                last_error = str(e)
            time.sleep(0.5)

        shutdown()
        raise WorkerUnavailableError(
            f"The local narrator did not become ready in "
            f"{STARTUP_TIMEOUT_SECONDS:.0f}s ({last_error})."
        )


def shutdown() -> None:
    global _process, _base_url, _health
    with _lock:
        if _process is not None and _process.poll() is None:
            _process.terminate()
            try:
                _process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _process.kill()
        _process = None
        _base_url = None
        _health = None


atexit.register(shutdown)


def list_voices() -> list[dict]:
    base_url = ensure_running()
    response = httpx.get(f"{base_url}/voices", timeout=10.0)
    response.raise_for_status()
    return response.json()["voices"]


class KokoroBackend(SynthesisBackend):
    """The local narrator as a generation-engine backend. Synchronous one
    HTTP round trip per segment -- exactly what the worker thread wants."""

    key = "local-kokoro"
    file_extension = "wav"       # canonical FLAC transcode arrives with assembly

    def __init__(self, base_url: str, health: dict):
        self.base_url = base_url
        self.model_id = health.get("model", "kokoro-82m")
        self.engine_version = health.get("worker_version", "kokoro-worker unknown")

    def synthesize(self, text: str, voice_id: str,
                   speed: float = 1.0) -> tuple[bytes, float]:
        try:
            response = httpx.post(
                f"{self.base_url}/synthesize",
                json={"text": text, "voice": voice_id, "speed": speed},
                timeout=SYNTHESIS_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException:
            raise SynthesisError("The local narrator timed out on this segment.",
                                 retryable=True)
        except httpx.RequestError as e:
            raise SynthesisError(f"Could not reach the local narrator: {e}",
                                 retryable=True)
        if response.status_code != 200:
            detail = response.text[:200]
            raise SynthesisError(f"The local narrator failed: {detail}", retryable=False)
        duration = float(response.headers.get("X-Duration-Seconds", "0") or 0)
        return response.content, duration


def make_backend() -> KokoroBackend:
    base_url = ensure_running()
    return KokoroBackend(base_url, _health or {})
