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
import hashlib
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import zipfile
from pathlib import Path

import httpx

from app.audiobook.synthesis import SynthesisBackend, SynthesisError

# Packaged install location (component manager's target).
WORKER_INSTALL_DIR = Path.home() / ".storythread" / "kokoro-worker"
WORKER_EXE_NAME = "kokoro-worker.exe"

# The published worker artifact (spec 14.1): a PRERELEASE GitHub asset so
# it never becomes releases/latest (that would break the app updater's
# latest.json lookup). sha256 and size are stamped by scripts/
# build-worker.ps1 output when a worker version is published.
WORKER_RELEASE = {
    "version": "0.1.1",
    "url": ("https://github.com/StoryThread-Dean/StorythreadStudio/releases/"
            "download/kokoro-worker-v0.1.1/kokoro-worker-0.1.1-win64.zip"),
    # SHA256 of the built kokoro-worker-0.1.1-win64.zip (2026-07-29,
    # adds the parent watchdog). Publish and pin travel together, always.
    "sha256": "1bdda06ec104069288b37953d3b2cfe72cae95370b5b542af9cb4ace91a60a28",
    "size_mb": 372.1,
}

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
_log_file = None


def _log_path() -> Path:
    """The worker's log lives BESIDE the install dir, not inside it.
    Lesson from a live install failure: a log inside the install dir
    (with its handle leaked) made the directory undeletable, the cleanup
    failure was swallowed, and the new engine landed in a nested
    subfolder -- invisible to the exe check. The log now can never hold
    the install hostage."""
    return WORKER_INSTALL_DIR.parent / "kokoro-worker.log"


class WorkerUnavailableError(Exception):
    """The local narrator is not installed or failed to start."""


def _dev_worker_dir() -> Path | None:
    """The repo's kokoro-worker/ project, when running from a checkout.
    backend/app/audiobook/local_worker.py -> repo root is four parents up.
    STORYTHREAD_DISABLE_DEV_WORKER=1 hides it -- used to exercise the
    packaged install path on a dev machine."""
    if os.environ.get("STORYTHREAD_DISABLE_DEV_WORKER") == "1":
        return None
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
    installed_version = None
    try:
        with open(WORKER_INSTALL_DIR / "installed.json", "r", encoding="utf-8") as f:
            installed_version = json.load(f).get("version")
    except (OSError, json.JSONDecodeError):
        pass
    return {
        "installed": packaged or dev,
        "mode": "packaged" if packaged else ("dev" if dev else "none"),
        "running": _process is not None and _process.poll() is None,
        "health": _health,
        "installed_version": installed_version,
        "available_version": WORKER_RELEASE["version"],
        "download_published": WORKER_RELEASE["sha256"] is not None,
        "download_size_mb": WORKER_RELEASE["size_mb"],
        "install": install_status(),
    }


# ── Component manager: install / remove ──────────────────────────────────────
# The download-verify-extract flow (spec 14.1): a background thread with a
# poll-friendly progress state, SHA256 verification before a single byte
# is trusted, and the running worker shut down before its files change.

_install_lock = threading.Lock()
_install_thread: threading.Thread | None = None
_install_state = {"state": "idle", "progress": 0.0, "error": None}


def install_status() -> dict:
    with _install_lock:
        return dict(_install_state)


def _set_install(state: str, progress: float | None = None, error: str | None = None) -> None:
    with _install_lock:
        _install_state["state"] = state
        if progress is not None:
            _install_state["progress"] = round(progress, 3)
        _install_state["error"] = error


def start_install(source_zip: str | None = None) -> None:
    """
    Kick off an install on a background thread.

    source_zip: a LOCAL zip path override, used for testing the flow
    before (or without) the published download. The published path
    requires WORKER_RELEASE to carry a sha256 -- no hash, no install.
    """
    global _install_thread
    with _install_lock:
        if _install_thread is not None and _install_thread.is_alive():
            raise RuntimeError("An install is already in progress.")
    if source_zip is None and WORKER_RELEASE["sha256"] is None:
        raise ValueError(
            "The local narrator download has not been published yet. "
            "It arrives with this feature's release."
        )
    _set_install("starting", 0.0)
    _install_thread = threading.Thread(
        target=_install_worker, args=(source_zip,), name="kokoro-install", daemon=True)
    _install_thread.start()


def wait_for_install(timeout: float = 600.0) -> None:
    """Tests and scripts only -- the UI polls install_status()."""
    thread = _install_thread
    if thread is not None:
        thread.join(timeout)


def _install_worker(source_zip: str | None) -> None:
    staging = Path(tempfile.mkdtemp(prefix="stw-worker-install-"))
    try:
        zip_path = staging / "worker.zip"

        if source_zip is not None:
            _set_install("verifying", 0.5)
            shutil.copyfile(source_zip, zip_path)
        else:
            _set_install("downloading", 0.0)
            hasher = hashlib.sha256()
            with httpx.stream("GET", WORKER_RELEASE["url"], timeout=60.0,
                              follow_redirects=True) as response:
                response.raise_for_status()
                total = int(response.headers.get("Content-Length", 0)) or None
                done = 0
                with open(zip_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=1 << 20):
                        f.write(chunk)
                        hasher.update(chunk)
                        done += len(chunk)
                        if total:
                            _set_install("downloading", done / total)
            _set_install("verifying", 1.0)
            digest = hasher.hexdigest().lower()
            if digest != WORKER_RELEASE["sha256"]:
                raise ValueError(
                    "The downloaded file failed its integrity check "
                    f"(expected {WORKER_RELEASE['sha256'][:12]}..., got {digest[:12]}...). "
                    "Nothing was installed -- try again."
                )

        # Extract to a scratch dir FIRST; only a complete, valid extract
        # replaces the install dir. Zip-slip guarded.
        _set_install("extracting", 1.0)
        extract_dir = staging / "extract"
        extract_dir.mkdir()
        with zipfile.ZipFile(zip_path) as archive:
            for member in archive.namelist():
                target = (extract_dir / member).resolve()
                if not str(target).startswith(str(extract_dir.resolve())):
                    raise ValueError("The archive contains an unsafe path; refusing to install.")
            archive.extractall(extract_dir)
        if not (extract_dir / WORKER_EXE_NAME).is_file():
            raise ValueError("The archive does not contain the narrator engine.")

        # Swap in: stop any running worker, then replace the install dir
        # CONTENTS item by item. Never a whole-directory move: if the dir
        # survives a failed cleanup (a file held open by some stale
        # process -- the live failure mode), a directory move would nest
        # the new engine one level down and silently break everything.
        # Per-item replacement is immune to that, and a locked file that
        # actually matters fails LOUDLY instead of installing garbage.
        shutdown()
        WORKER_INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        for leftover in list(WORKER_INSTALL_DIR.iterdir()):
            try:
                if leftover.is_dir():
                    shutil.rmtree(leftover)
                else:
                    leftover.unlink()
            except OSError:
                raise ValueError(
                    f"Could not replace '{leftover.name}' in the install folder -- "
                    "another Storythread window may be running. Close it and try again."
                )
        for item in list(extract_dir.iterdir()):
            shutil.move(str(item), str(WORKER_INSTALL_DIR / item.name))
        if not (WORKER_INSTALL_DIR / WORKER_EXE_NAME).is_file():
            raise ValueError("Install finished but the engine is missing -- try again.")
        with open(WORKER_INSTALL_DIR / "installed.json", "w", encoding="utf-8") as f:
            json.dump({"version": WORKER_RELEASE["version"] if source_zip is None
                       else f"{WORKER_RELEASE['version']} (local zip)"}, f)

        _set_install("done", 1.0)
    except Exception as e:
        _set_install("error", error=str(e))
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def remove_worker() -> None:
    """Uninstall the packaged engine (files only -- generated audio and
    workspaces are untouched; the dev checkout, if any, remains usable)."""
    shutdown()
    if WORKER_INSTALL_DIR.exists():
        shutil.rmtree(WORKER_INSTALL_DIR, ignore_errors=True)


def _installed_version() -> str | None:
    """The bare version from installed.json ('0.1.1 (local zip)' -> '0.1.1')."""
    try:
        with open(WORKER_INSTALL_DIR / "installed.json", "r", encoding="utf-8") as f:
            raw = str(json.load(f).get("version") or "")
        return raw.split(" ")[0] or None
    except (OSError, json.JSONDecodeError):
        return None


def _spawn_command(port: int) -> tuple[list[str], str]:
    """(argv, cwd) for whichever worker flavor exists. Packaged wins.
    --parent-pid arms the worker's watchdog: it exits when THIS backend
    dies, however it dies -- hard kills orphaned one loaded-model worker
    per dev session before this existed (46 strays in one day, live)."""
    parent = ["--parent-pid", str(os.getpid())]
    exe = WORKER_INSTALL_DIR / WORKER_EXE_NAME
    if exe.is_file():
        # Version gate: an installed worker from a different release may
        # not understand this backend's arguments (live failure: a 0.1.0
        # engine rejected --parent-pid and crash-looped at startup).
        # Refuse with an update message the UI turns into an Update
        # button -- never spawn a worker we can't talk to.
        installed = _installed_version()
        if installed != WORKER_RELEASE["version"]:
            raise WorkerUnavailableError(
                "The local narrator needs an update "
                f"(installed {installed or 'unknown'}, this version of "
                f"Storythread needs {WORKER_RELEASE['version']}). "
                "Update it from the narration panel."
            )
        return ([str(exe), "--port", str(port),
                 "--models-dir", str(WORKER_INSTALL_DIR / "models"), *parent],
                str(WORKER_INSTALL_DIR))
    dev_dir = _dev_worker_dir()
    if dev_dir is not None:
        return (["uv", "run", "--project", str(dev_dir),
                 "python", "main.py", "--port", str(port), *parent],
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
            # the app data dir so a startup crash is diagnosable. The
            # handle is tracked and closed in shutdown() -- never leaked.
            global _log_file
            _log_path().parent.mkdir(parents=True, exist_ok=True)
            if _log_file is None or _log_file.closed:
                _log_file = open(_log_path(), "ab")
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            _process = subprocess.Popen(
                argv, cwd=cwd, stdout=_log_file, stderr=_log_file,
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
                    f"{_log_path()} for details."
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
    global _process, _base_url, _health, _log_file
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
        if _log_file is not None and not _log_file.closed:
            try:
                _log_file.close()
            except OSError:
                pass
        _log_file = None


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
