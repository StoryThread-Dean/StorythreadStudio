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

from app.audiobook import flow, locking, pronunciation, segmenter, workspace
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
                  pace: float = 1.0, layout: str = "", draft: bool = False) -> str:
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
    `layout` (flow segments only) fingerprints WHERE the mid-paragraph
    pauses cut the fragment run -- moving a pause to a different sentence
    boundary re-queues the segment so its stored cut positions get
    re-matched. Pause DURATIONS stay out on purpose: retiming is free.
    """
    parts = [payload_text, voice_id, backend.key, backend.model_id,
             backend.engine_version]
    if pace != 1.0:
        parts.append(f"pace={pace}")
    if layout:
        parts.append(f"layout={layout}")
    if draft:
        # Draft audio is a different artifact: a Standard run must see it
        # as stale (and vice versa) -- a draft can never ship by accident.
        parts.append("draft=1")
    raw = "|".join(parts)
    return "sha256-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _is_hosted_provider(provider_key: str) -> bool:
    """True for a paid narration provider, false for the local narrator
    (and for the fake backends tests generate with).

    Asked as "is this one of the hosted providers" rather than "is this
    not local" on purpose: the question being answered is which of a
    speaker's two voices to use, and only a real hosted engine has a
    print roster. Anything else is drafting.
    """
    from app.audiobook import tts_providers
    return provider_key in tts_providers.PROVIDERS


def _is_print_pass(backend: SynthesisBackend) -> bool:
    return _is_hosted_provider(backend.key)


def segment_layout(segment: dict) -> str:
    """A flow segment's fragment layout as a basis fingerprint: the
    fragment character lengths, which move whenever a mid-paragraph
    pause is added, removed, or relocated. Empty for plain segments."""
    fragments = segment.get("fragments")
    if not fragments or len(fragments) < 2:
        return ""
    return ",".join(str(len(f)) for f in fragments)


def effective_pace(segment: dict, settings: dict) -> float:
    """
    The speed a segment actually synthesizes at, starting from the
    book-level base (dialogue segments use Dialogue Pace, everything
    else Narrator Pace) and adjusted by any [pace:...] marker.

    Marker forms (see markers.py):
      STEP form ('+2' / '-1', stored as a signed string): base plus
        N steps of 0.05 -- so "faster" means the next confirmed-clean
        speeds up from whatever base the writer chose. The result is
        capped to the proven 0.8-1.2 band (spec 15.1): stacking +5 on
        a 1.2 base stays 1.2, and -5 on 0.8 stays 0.8. A base the
        writer deliberately set outside the band is respected, but a
        marker can never push past it.
      MULTIPLIER form (legacy float): base times the value, clamped
        to the engine range.

    Every result is SNAPPED to the nearest 0.05. Compound values like
    1.2 x 0.9 = 1.08 land between the speeds Kokoro renders cleanly --
    listening tests pinned a sibilant slur ("lisp") to 1.08x while the
    neighboring 0.05-grid speeds were clean. The engine only ever gets
    asked for speeds in its comfortable gears.
    """
    base = settings["dialogue_pace"] if segment.get("dialogue") else settings["narrator_pace"]
    marker = segment.get("pace", 1.0)
    if isinstance(marker, str):
        target = base + int(marker) * 0.05
        snapped = round(round(target / 0.05) * 0.05, 2)
        return max(min(0.8, base), min(max(1.2, base), snapped))
    raw = base * marker
    snapped = round(round(raw / 0.05) * 0.05, 2)
    return max(0.5, min(2.0, snapped))


# ── Reading audio state without generating (spec 24.2) ───────────────────────
# The rail needs to say "Chapter 2 is outdated" WITHOUT starting a run,
# spawning the local worker, or contacting a paid engine. The trick: a
# completed segment already records the engine that made it, so its own
# basis can be recomputed from what is stored. That answers the question
# the writer actually asks -- "has anything changed since this was
# narrated?" -- with no engine present at all.

class _StoredEngine:
    """Just enough of a SynthesisBackend for payload_basis: the identity
    fields a finished segment already carries."""

    def __init__(self, segment: dict):
        self.key = str(segment.get("provider") or "")
        self.model_id = str(segment.get("model") or "")
        self.engine_version = str(segment.get("engine_version") or "")


# Per-segment verdicts (spec 24.2's three markers).
AUDIO_CURRENT = "current"          # matches the generated audio
AUDIO_OUTDATED = "outdated"        # modified since generation
AUDIO_MISSING = "missing"          # no audio generated


def segment_audio_state(segment: dict, rules, settings: dict,
                        book_voice: str = "") -> dict:
    """One segment's audio verdict, and why."""
    if segment.get("status") != "completed" or not segment.get("output_file"):
        return {"state": AUDIO_MISSING,
                "reason": "failed" if segment.get("status") == "failed" else "none"}

    stored_voice = str(segment.get("voice_id") or "")
    # A voice change is checked FIRST and separately. It is the print
    # pass: every segment is outdated, and saying "the voice changed"
    # explains a whole-book requeue far better than "the text moved".
    #
    # `book_voice` is the voice this segment SHOULD have, which for a
    # [voice:NAME] span is that character's voice rather than the
    # narrator's -- otherwise every line of dialogue in a cast book would
    # read as permanently outdated.
    if book_voice and stored_voice and stored_voice != book_voice:
        return {"state": AUDIO_OUTDATED, "reason": "voice"}

    engine = _StoredEngine(segment)
    payload = pronunciation.prepare_tts_text(segment["text"], rules)
    pace = effective_pace(segment, settings)
    layout = segment_layout(segment)
    stored_hash = segment.get("payload_hash")

    for draft in (False, True):
        basis = payload_basis(payload, engine, stored_voice, pace,
                              layout=layout, draft=draft)
        if stored_hash == basis:
            # Draft audio is current for a draft, and deliberately stale
            # for a real pass -- the rail says so rather than calling it
            # simply "current".
            return {"state": AUDIO_CURRENT, "reason": "draft" if draft else "match"}

    # Audio generated before payload_hash existed has nothing to compare
    # against. Treat it as current rather than nagging a writer to
    # re-narrate a book that is probably fine.
    if not stored_hash:
        return {"state": AUDIO_CURRENT, "reason": "legacy"}
    return {"state": AUDIO_OUTDATED, "reason": "text"}


def _chapter_rollup(counts: dict[str, int]) -> str:
    """Spec 24.2's four chapter words, from the segment tally."""
    total = counts["current"] + counts["outdated"] + counts["missing"]
    if total == 0:
        return "empty"
    if counts["current"] == total:
        return "current"
    if counts["current"] == 0 and counts["outdated"] == 0:
        return "not_generated"
    if counts["current"] == 0:
        return "outdated"
    return "partial"


def audio_status(workspace_path: str) -> dict:
    """Per-chapter audio freshness for the rail. Never starts anything."""
    manifest = segmenter.load_segments(workspace_path)
    if manifest is None:
        return {"chapters": [], "book": "empty", "outdated_segments": 0,
                "draft_segments": 0}

    book_manifest = workspace.load_manifest(workspace_path)
    rules = pronunciation.effective_rules(workspace_path)
    settings = workspace.narration_settings(book_manifest)
    narrator_voice = str(book_manifest.get("selected_voice") or "")
    cast = workspace.speakers(book_manifest)

    chapters = []
    totals = {"current": 0, "outdated": 0, "missing": 0}
    drafts = 0
    reasons: set[str] = set()

    for chapter in manifest["chapters"]:
        counts = {"current": 0, "outdated": 0, "missing": 0}
        for item in chapter["items"]:
            if item.get("kind") != "segment":
                continue
            # Which roster this segment's audio came from -- a hosted
            # segment is measured against the print voice, a local one
            # against the draft voice. Getting this wrong would report a
            # correctly narrated cast book as permanently outdated.
            was_premium = _is_hosted_provider(item.get("provider", ""))
            expected_voice = workspace.voice_for_speaker(
                item.get("voice", ""), cast,
                str(book_manifest.get("selected_premium_voice") or "") if was_premium
                else narrator_voice,
                premium=was_premium)
            verdict = segment_audio_state(item, rules, settings, expected_voice)
            counts[verdict["state"]] += 1
            totals[verdict["state"]] += 1
            if verdict["state"] == AUDIO_OUTDATED:
                reasons.add(verdict["reason"])
            if verdict["reason"] == "draft":
                drafts += 1
        chapters.append({
            "chapter_id": chapter["chapter_id"],
            "title": chapter.get("title", ""),
            "status": _chapter_rollup(counts),
            **counts,
        })

    return {
        "chapters": chapters,
        "book": _chapter_rollup(totals),
        "outdated_segments": totals["outdated"],
        "draft_segments": drafts,
        # One word for why, when the whole book agrees on it. The panel
        # uses this to say "the voice changed" instead of the vaguer
        # "edited since generation".
        "outdated_reason": reasons.pop() if len(reasons) == 1 else "",
    }


def start_run(workspace_path: str, backend: SynthesisBackend, voice_id: str,
              force: bool = False, draft: bool = False) -> dict:
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
        book = workspace.load_manifest(workspace_path)
        settings = workspace.narration_settings(book)
        # The cast maps [voice:NAME] spans to voice ids. Read once per
        # run: recasting mid-run would give one chapter two voices.
        cast = workspace.speakers(book)
        is_premium = _is_print_pass(backend)

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
                # Completed audio: stale when its payload basis moved --
                # including via the book-level pace settings.
                basis = payload_basis(
                    pronunciation.prepare_tts_text(item["text"], rules),
                    backend,
                    workspace.voice_for_speaker(item.get("voice", ""), cast, voice_id,
                                                premium=is_premium),
                    effective_pace(item, settings),
                    layout=segment_layout(item), draft=draft,
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
            "draft": draft,
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
            args=(workspace_path, backend, voice_id, queue_ids, run, draft),
            name="audiobook-generation",
            daemon=True,
        )
        _active_thread.start()
        return run


# ── The worker loop ───────────────────────────────────────────────────────────

def _worker(workspace_path: str, backend: SynthesisBackend, voice_id: str,
            queue_ids: list[str], run: dict, draft: bool = False) -> None:
    _set_sleep_inhibit(True)
    try:
        rules = pronunciation.effective_rules(workspace_path)
        book = workspace.load_manifest(workspace_path)
        settings = workspace.narration_settings(book)
        cast = workspace.speakers(book)
        is_premium = _is_print_pass(backend)
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

            # One segment, one voice: the span's name resolved against
            # the cast, falling back to the run's narrator voice.
            segment_voice = workspace.voice_for_speaker(
                segment.get("voice", ""), cast, voice_id, premium=is_premium)
            _generate_one(workspace_path, backend, segment_voice, rules, settings,
                          segment, draft=draft)

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
                  rules: list, settings: dict, segment: dict,
                  draft: bool = False) -> None:
    """One segment through the payload-prep + synthesize + validate path.
    Mutates the segment record in place; the caller persists it.

    Flow segments (mid-paragraph pauses, see flow.py) synthesize the
    whole fragment run CONTINUOUSLY and record the matched cut positions;
    the stitcher inserts the writer's pauses into those cuts later.
    draft=True keeps the pauses but skips the continuous render -- the
    fast testing gear."""
    payload = pronunciation.prepare_tts_text(segment["text"], rules)
    pace = effective_pace(segment, settings)
    # Flow synthesis is WAV-only (it reads samples to find gaps); a
    # provider that returns MP3 keeps the plain per-segment path.
    fragments = segment.get("fragments")
    is_flow = (bool(fragments) and len(fragments) >= 2
               and backend.file_extension == "wav")

    audio: bytes | None = None
    duration = 0.0
    flow_cuts: list[int] = []
    flowed = False
    failure_reason: str | None = None

    for attempt in range(1 + MAX_AUTO_RETRIES):
        # Pessimistic attempt counting (spec 20.1): the attempt is recorded
        # BEFORE the call, because a timeout after billing still billed.
        segment["attempts"] = segment.get("attempts", 0) + 1
        try:
            if is_flow:
                payloads = [pronunciation.prepare_tts_text(f, rules) for f in fragments]
                audio, flow_cuts, flowed = flow.synthesize_flow(
                    backend, voice_id, pace, payloads, draft=draft)
                duration = _wav_seconds(audio)
            else:
                audio, duration = backend.synthesize(payload, voice_id, pace)
            failure_reason = None
            break
        except SynthesisError as e:
            failure_reason = str(e)
            if not e.retryable or attempt == MAX_AUTO_RETRIES:
                break
        except flow.FlowError as e:
            failure_reason = str(e)    # malformed engine audio: not retryable
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
        "payload_hash": payload_basis(payload, backend, voice_id, pace,
                                      layout=segment_layout(segment), draft=draft),
        "provider": backend.key,
        "model": backend.model_id,
        "engine_version": backend.engine_version,
        "voice_id": voice_id,
        "duration_seconds": round(duration, 2),
        "output_file": output_rel,
    })
    if is_flow:
        # Where the stitcher may cut this audio to insert the writer's
        # pauses. flowed=False means matching fell back to concatenated
        # isolated fragments -- same cut semantics, today's sound.
        segment["flow_cuts_ms"] = flow_cuts
        segment["flowed"] = flowed
    else:
        segment.pop("flow_cuts_ms", None)
        segment.pop("flowed", None)
    segment.pop("failure_reason", None)


def _wav_seconds(audio: bytes) -> float:
    """Duration of a WAV blob -- flow synthesis composes its result, so
    there is no single X-Duration header to trust."""
    import io
    import wave
    with wave.open(io.BytesIO(audio), "rb") as w:
        rate = w.getframerate()
        return w.getnframes() / rate if rate else 0.0


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


def reset(workspace_path: str) -> None:
    """
    The writer's Cancel-and-start-over: forget the run record and force
    the lock off, so Generate is available fresh no matter what state a
    crash, reboot, or bug left behind. Completed segment audio is kept
    (still valid, still skipped by the next run); the caller has already
    verified no run is active in THIS process.
    """
    try:
        os.remove(run_path(workspace_path))
    except OSError:
        pass
    locking.force_release(workspace_path)


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
