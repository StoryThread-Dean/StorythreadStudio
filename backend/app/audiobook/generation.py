# audiobook/generation.py -- the single-run generation engine.
# =============================================================
# One audiobook generates at a time (spec 12.1), one segment at a time, on
# a background worker THREAD inside the sidecar. The frontend polls
# /generation/status; state is persisted to the workspace after EVERY
# completed segment, which is what makes pause, cancel, crash, and app
# restart all recoverable for free (spec 21.2).
#
# Control model: pause/cancel set flags that the loop checks BETWEEN
# segments -- generation never aborts mid-provider-request (spec 12.1).
# "Background" honestly means while Storythread is open: the sidecar dies
# with the app window, and the interrupted run is detected on the next
# status read and marked paused (restart recovery).
#
# Run record: <workspace>/generation-run.json (spec 31.4 shape plus live
# progress counters).

import ctypes
import hashlib
import json
import os
import threading
import uuid
from datetime import datetime, timezone

from app.audiobook import locking, pronunciation, segmenter, workspace
from app.audiobook.synthesis import SynthesisBackend, SynthesisError

RUN_FILE = "generation-run.json"

# Spec 20.1: at most 2 AUTOMATIC retries per segment, retryable errors
# only. Every attempt counts pessimistically (it may have billed).
MAX_AUTO_RETRIES = 2

# Spec 26.3: typical narration pace for the truncation sanity check.
CHARS_PER_MINUTE = 1000
TRUNCATION_RATIO = 0.6
TRUNCATION_MIN_EXPECTED_SECONDS = 2.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, RUN_FILE)


def load_run(workspace_path: str) -> dict | None:
    try:
        with open(run_path(workspace_path), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save_run(workspace_path: str, run: dict) -> None:
    with open(run_path(workspace_path), "w", encoding="utf-8") as f:
        json.dump(run, f, indent=2, ensure_ascii=False)


# ── Windows sleep inhibit (spec 21) ──────────────────────────────────────────
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED keeps the machine awake while a run is
# active; clearing back to ES_CONTINUOUS releases it. Applies to the
# CALLING thread, so both calls happen inside the worker thread. A laptop
# lid-close is the most likely way a two-hour run dies -- this is the
# guard. No-ops quietly anywhere the API is unavailable (tests, CI).

_ES_CONTINUOUS = 0x80000000
_ES_SYSTEM_REQUIRED = 0x00000001


def _set_sleep_inhibit(enabled: bool) -> None:
    try:
        state = _ES_CONTINUOUS | (_ES_SYSTEM_REQUIRED if enabled else 0)
        ctypes.windll.kernel32.SetThreadExecutionState(state)  # type: ignore[attr-defined]
    except Exception:
        pass


# ── The single active run (module-level singleton) ───────────────────────────

_state_lock = threading.Lock()
_active_thread: threading.Thread | None = None
_active_workspace: str | None = None
_pause_requested = threading.Event()
_cancel_requested = threading.Event()


def is_running() -> bool:
    with _state_lock:
        return _active_thread is not None and _active_thread.is_alive()


def active_workspace() -> str | None:
    with _state_lock:
        if _active_thread is not None and _active_thread.is_alive():
            return _active_workspace
    return None


def wait_for_idle(timeout: float = 30.0) -> None:
    """Block until the active run's thread finishes. Used by tests and
    shutdown paths -- the UI never calls this; it polls status instead."""
    with _state_lock:
        thread = _active_thread
    if thread is not None:
        thread.join(timeout)


def request_pause() -> None:
    _pause_requested.set()


def request_cancel() -> None:
    _cancel_requested.set()


# ── Starting a run ────────────────────────────────────────────────────────────

def payload_basis(payload_text: str, backend: SynthesisBackend, voice_id: str,
                  pace: float = 1.0) -> str:
    """
    The generated-state identity of a segment's AUDIO (spec 24.1): the
    prepared payload (so pronunciation rules and [say] edits count), the
    voice, the engine, and any [pace:...] override. A completed segment
    whose stored basis no longer matches is stale and re-queues
    automatically -- changing a pronunciation rule regenerates exactly the
    segments that contain the word, and switching voice regenerates the
    whole book (the print pass).

    Pace joins the basis only when it deviates from 1.0, so audio
    generated before pace spans existed keeps its stored hash valid.
    """
    parts = [payload_text, voice_id, backend.key, backend.model_id,
             backend.engine_version]
    if pace != 1.0:
        parts.append(f"pace={pace}")
    raw = "|".join(parts)
    return "sha256-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def start_run(workspace_path: str, backend: SynthesisBackend, voice_id: str,
              force: bool = False) -> dict:
    """
    Queue segments in the selected chapters and start the worker thread.
    Queued = pending/failed, plus completed segments whose payload basis
    changed (stale audio). `force=True` queues EVERYTHING selected -- the
    writer's explicit "regenerate regardless" escape hatch.

    Raises RuntimeError when a run is already active anywhere (one
    audiobook at a time), ValueError when there is nothing to generate,
    WorkspaceLockedError when another process holds the lock.
    """
    global _active_thread, _active_workspace

    with _state_lock:
        if _active_thread is not None and _active_thread.is_alive():
            raise RuntimeError(
                "An audiobook is already generating. Only one audiobook "
                "generates at a time -- pause or cancel it first."
            )

        manifest = segmenter.load_segments(workspace_path)
        if manifest is None:
            raise ValueError("No segments to generate. Save the narration once first.")

        selected_chapters = {
            c["chapter_id"] for c in workspace.list_chapters(workspace_path)
            if c.get("selected_for_generation", True)
        }
        rules = pronunciation.effective_rules(workspace_path)

        queue_ids: list[str] = []
        for chapter in manifest["chapters"]:
            if chapter["chapter_id"] not in selected_chapters:
                continue
            for item in chapter["items"]:
                if item.get("kind") != "segment":
                    continue
                if force or item.get("status") in ("pending", "failed"):
                    queue_ids.append(item["segment_id"])
                    continue
                # Completed audio: stale when its payload basis moved.
                basis = payload_basis(
                    pronunciation.prepare_tts_text(item["text"], rules),
                    backend, voice_id, item.get("pace", 1.0),
                )
                if item.get("payload_hash") != basis:
                    queue_ids.append(item["segment_id"])

        if not queue_ids:
            raise ValueError(
                "Nothing to generate -- every segment in the selected chapters "
                "is already up to date with the current text, pronunciations, "
                "and voice."
            )

        locking.acquire(workspace_path)     # WorkspaceLockedError propagates

        run = {
            "run_id": str(uuid.uuid4()),
            "status": "generating",
            "provider": backend.key,
            "model": backend.model_id,
            "engine_version": backend.engine_version,
            "voice_id": voice_id,
            "started_at": _now_iso(),
            "paused_at": None,
            "completed_at": None,
            "total_segments": len(queue_ids),
            "completed_segments": 0,
            "failed_segments": 0,
            "note": None,
        }
        save_run(workspace_path, run)

        _pause_requested.clear()
        _cancel_requested.clear()
        _active_workspace = workspace_path
        _active_thread = threading.Thread(
            target=_worker,
            args=(workspace_path, backend, voice_id, queue_ids, run),
            name="audiobook-generation",
            daemon=True,
        )
        _active_thread.start()
        return run


# ── The worker loop ───────────────────────────────────────────────────────────

def _worker(workspace_path: str, backend: SynthesisBackend, voice_id: str,
            queue_ids: list[str], run: dict) -> None:
    _set_sleep_inhibit(True)
    try:
        rules = pronunciation.effective_rules(workspace_path)
        for segment_id in queue_ids:
            # Control flags are honored BETWEEN segments only -- a segment
            # in flight always finishes (or fails) before the run stops.
            if _pause_requested.is_set() or _cancel_requested.is_set():
                break

            # Reload the manifest fresh each segment: the write below is
            # the persistence point, and reading back what was written
            # keeps this loop honest about what is actually on disk.
            manifest = segmenter.load_segments(workspace_path)
            segment = _find_segment(manifest, segment_id)
            if segment is None:
                continue                    # re-segmented away mid-run

            _generate_one(workspace_path, backend, voice_id, rules, segment)

            if segment["status"] == "completed":
                run["completed_segments"] += 1
            else:
                run["failed_segments"] += 1
            segmenter.save_segments(workspace_path, manifest)
            save_run(workspace_path, run)
    finally:
        _set_sleep_inhibit(False)
        _finalize(workspace_path, run)


def _finalize(workspace_path: str, run: dict) -> None:
    global _active_thread, _active_workspace
    if _cancel_requested.is_set():
        run["status"] = "cancelled"
    elif _pause_requested.is_set():
        run["status"] = "paused"
        run["paused_at"] = _now_iso()
    elif run["failed_segments"] > 0:
        run["status"] = "partially_completed"
        run["completed_at"] = _now_iso()
    else:
        run["status"] = "completed"
        run["completed_at"] = _now_iso()
    save_run(workspace_path, run)
    locking.release(workspace_path)
    with _state_lock:
        _active_thread = None
        _active_workspace = None


def _find_segment(manifest: dict | None, segment_id: str) -> dict | None:
    if not manifest:
        return None
    for chapter in manifest["chapters"]:
        for item in chapter["items"]:
            if item.get("kind") == "segment" and item.get("segment_id") == segment_id:
                return item
    return None


def _generate_one(workspace_path: str, backend: SynthesisBackend, voice_id: str,
                  rules: list, segment: dict) -> None:
    """One segment through the payload-prep + synthesize + validate path.
    Mutates the segment record in place; the caller persists it."""
    payload = pronunciation.prepare_tts_text(segment["text"], rules)
    pace = segment.get("pace", 1.0)

    audio: bytes | None = None
    duration = 0.0
    failure_reason: str | None = None

    for attempt in range(1 + MAX_AUTO_RETRIES):
        # Pessimistic attempt counting (spec 20.1): the attempt is recorded
        # BEFORE the call, because a timeout after billing still billed.
        segment["attempts"] = segment.get("attempts", 0) + 1
        try:
            audio, duration = backend.synthesize(payload, voice_id, pace)
            failure_reason = None
            break
        except SynthesisError as e:
            failure_reason = str(e)
            if not e.retryable or attempt == MAX_AUTO_RETRIES:
                break

    if audio is None:
        segment["status"] = "failed"
        segment["failure_reason"] = failure_reason or "The narration engine returned nothing."
        return

    # Truncation sanity check (spec 26.3): a segment that "succeeded" with
    # half the audio is a Failed segment NOW, not a chapter-30 surprise.
    # The pace scales the expectation -- 0.8x pace legitimately runs longer.
    expected_seconds = len(payload) / CHARS_PER_MINUTE * 60.0 / pace
    if expected_seconds > TRUNCATION_MIN_EXPECTED_SECONDS and duration < TRUNCATION_RATIO * expected_seconds:
        segment["status"] = "failed"
        segment["failure_reason"] = (
            f"Audio shorter than expected (got {duration:.1f}s, expected about "
            f"{expected_seconds:.0f}s) -- possible truncation. The audio was kept for inspection."
        )
        # Kept on disk for inspection, never assembled (spec 26.3).
        _write_segment_audio(workspace_path, segment, backend, audio, suffix=".rejected")
        return

    output_rel = _write_segment_audio(workspace_path, segment, backend, audio)
    segment.update({
        "status": "completed",
        "generated_hash": segment["content_hash"],
        "payload_hash": payload_basis(payload, backend, voice_id, pace),
        "provider": backend.key,
        "model": backend.model_id,
        "engine_version": backend.engine_version,
        "voice_id": voice_id,
        "duration_seconds": round(duration, 2),
        "output_file": output_rel,
    })
    segment.pop("failure_reason", None)


def _write_segment_audio(workspace_path: str, segment: dict,
                         backend: SynthesisBackend, audio: bytes,
                         suffix: str = "") -> str:
    """Write audio under generated-segments/<chapter>/<segment>.<ext>,
    returning the workspace-relative path recorded on the segment."""
    rel = os.path.join(
        "generated-segments", segment["chapter_id"],
        f"{segment['segment_id']}.{backend.file_extension}{suffix}",
    )
    absolute = os.path.join(workspace_path, rel)
    os.makedirs(os.path.dirname(absolute), exist_ok=True)
    with open(absolute, "wb") as f:
        f.write(audio)
    return rel.replace("\\", "/")


# ── Status with restart recovery ─────────────────────────────────────────────

def status_with_recovery(workspace_path: str) -> dict | None:
    """
    The run record, healed on read: a record claiming "generating" with no
    live thread in this process means the app (or sidecar) died mid-run --
    mark it paused so Resume picks up exactly where the last persisted
    segment left off. This IS the restart recovery (spec 21.2).
    """
    run = load_run(workspace_path)
    if run is None:
        return None
    if run.get("status") == "generating" and active_workspace() != workspace_path:
        run["status"] = "paused"
        run["paused_at"] = _now_iso()
        run["note"] = ("Generation was interrupted (the app closed or the backend "
                       "restarted). Resume to continue from the last completed segment.")
        save_run(workspace_path, run)
        locking.release(workspace_path)
    return run
