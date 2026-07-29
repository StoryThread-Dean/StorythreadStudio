# tests/test_audiobook_generation.py
# ===================================
# The generation engine's contracts: single run at a time, per-segment
# persistence, pause/cancel between segments, retry cap with pessimistic
# attempt counting, truncation validation, restart recovery, and the
# workspace lockfile. All driven through fake SynthesisBackends -- the
# engine must not care which engine renders audio; that IS the seam the
# kokoro-worker and cloud providers plug into later.

import json
import threading

import pytest
from fastapi.testclient import TestClient

from app.audiobook import generation, local_worker, locking, pronunciation, recents_store
from app.audiobook.synthesis import SynthesisBackend, SynthesisError
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")
    # Hermetic: resolve_backend("local-kokoro") must NEVER find the repo's
    # dev worker (or a packaged one) from inside pytest -- a test that
    # spawns the real 340MB model is a bug, not coverage.
    monkeypatch.setattr(local_worker, "WORKER_INSTALL_DIR", tmp_path / "kokoro-worker")
    monkeypatch.setattr(local_worker, "_dev_worker_dir", lambda: None)
    yield
    # A test must never leave a worker thread running into the next test.
    generation.request_cancel()
    generation.wait_for_idle(timeout=10)


class FakeBackend(SynthesisBackend):
    """Instant success; duration matches the pace model so validation passes."""
    key = "fake"
    model_id = "fake-tts-1"
    engine_version = "fake-worker 1.0"

    def synthesize(self, text: str, voice_id: str, speed: float = 1.0) -> tuple[bytes, float]:
        return b"FAKEAUDIO:" + text[:16].encode(), len(text) / 1000 * 60.0


class BlockingBackend(FakeBackend):
    """First call parks until released -- lets tests act mid-run without
    any sleep-based timing guesswork."""

    def __init__(self):
        self.first_started = threading.Event()
        self.release = threading.Event()
        self._calls = 0

    def synthesize(self, text: str, voice_id: str, speed: float = 1.0) -> tuple[bytes, float]:
        self._calls += 1
        if self._calls == 1:
            self.first_started.set()
            assert self.release.wait(timeout=10)
        return super().synthesize(text, voice_id)


def _make_workspace(tmp_path, paragraphs: int = 3):
    """Import a manuscript whose paragraphs become separate segments
    (separated by pauses so grouping cannot merge them)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    body = "\n\n[pause:0.5]\n\n".join(
        f"Paragraph number {n} with a little prose in it." for n in range(1, paragraphs + 1))
    src = tmp_path / "book.md"
    src.write_text(f"# Chapter 1\n\n{body}\n", encoding="utf-8")
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "Run Test",
    })
    assert response.status_code == 200, response.text
    return ws


def _segments_on_disk(ws) -> list[dict]:
    manifest = json.loads((ws / "generated-segments" / "segments.json").read_text(encoding="utf-8"))
    return [i for c in manifest["chapters"] for i in c["items"] if i["kind"] == "segment"]


def _run_record(ws) -> dict:
    return json.loads((ws / "generation-run.json").read_text(encoding="utf-8"))


# ── Happy path ────────────────────────────────────────────────────────────────

def test_run_completes_all_segments_and_persists_everything(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=3)
    run = generation.start_run(str(ws), FakeBackend(), voice_id="af_heart")
    assert run["status"] == "generating"
    generation.wait_for_idle()

    record = _run_record(ws)
    assert record["status"] == "completed"
    assert record["completed_segments"] == 3
    assert record["failed_segments"] == 0

    for segment in _segments_on_disk(ws):
        assert segment["status"] == "completed"
        assert segment["generated_hash"] == segment["content_hash"]
        assert segment["engine_version"] == "fake-worker 1.0"
        assert segment["voice_id"] == "af_heart"
        assert segment["attempts"] == 1
        audio = ws / segment["output_file"]
        assert audio.is_file() and audio.read_bytes().startswith(b"FAKEAUDIO:")

    # The lock is released when the run ends.
    assert locking.read_lock(str(ws)) is None


def test_payload_prep_applies_say_and_pronunciations(tmp_path):
    src = tmp_path / "b.md"
    src.write_text(
        "# Chapter 1\n\n[say:KAY-lith]Kaelith[/say] met Verroth -- again.\n",
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "T"})
    pronunciation.save_workspace_rules(str(ws), [
        pronunciation.PronunciationRule("Verroth", "vair-ROTH"),
    ])

    sent: list[str] = []

    class SpyBackend(FakeBackend):
        def synthesize(self, text: str, voice_id: str, speed: float = 1.0):
            sent.append(text)
            return super().synthesize(text, voice_id)

    generation.start_run(str(ws), SpyBackend(), voice_id="v")
    generation.wait_for_idle()
    # [say] resolved (spoken form flattened so the engine can't spell it
    # as an acronym), dictionary applied, ' -- ' became an em dash --
    # payload only; the narration file keeps the writer's text.
    assert sent == ["kaylith met vairroth—again."]
    narration = (ws / "manuscript" / "narration-copy.md").read_text(encoding="utf-8")
    assert "[say:KAY-lith]Kaelith[/say]" in narration


# ── Failure paths ─────────────────────────────────────────────────────────────

def test_retry_cap_and_pessimistic_attempts(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=1)

    class AlwaysTimingOut(FakeBackend):
        def synthesize(self, text, voice_id, speed=1.0):
            raise SynthesisError("Request timed out.", retryable=True)

    generation.start_run(str(ws), AlwaysTimingOut(), voice_id="v")
    generation.wait_for_idle()

    segment = _segments_on_disk(ws)[0]
    assert segment["status"] == "failed"
    # 1 original + exactly 2 automatic retries, every attempt counted.
    assert segment["attempts"] == 3
    assert _run_record(ws)["status"] == "partially_completed"


def test_non_retryable_errors_never_auto_retry(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=1)

    class Refusing(FakeBackend):
        def synthesize(self, text, voice_id, speed=1.0):
            raise SynthesisError("The provider declined this content.", retryable=False)

    generation.start_run(str(ws), Refusing(), voice_id="v")
    generation.wait_for_idle()

    segment = _segments_on_disk(ws)[0]
    assert segment["status"] == "failed"
    assert segment["attempts"] == 1          # refusals are never re-billed
    assert "declined" in segment["failure_reason"]


def test_truncated_audio_fails_validation_and_is_kept_for_inspection(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=1)

    class Truncating(FakeBackend):
        def synthesize(self, text, voice_id, speed=1.0):
            return b"HALF", 0.2              # far below the pace expectation

    generation.start_run(str(ws), Truncating(), voice_id="v")
    generation.wait_for_idle()

    segment = _segments_on_disk(ws)[0]
    assert segment["status"] == "failed"
    assert "possible truncation" in segment["failure_reason"]
    rejected = list((ws / "generated-segments" / "chapter-001").glob("*.rejected"))
    assert len(rejected) == 1                # kept on disk, never assembled


# ── Staleness + force (the "already generated" complaint) ────────────────────

def test_pronunciation_change_requeues_only_affected_segments(tmp_path):
    src = tmp_path / "b.md"
    src.write_text(
        "# Chapter 1\n\nLara climbed the wall.\n\n[pause:0.4]\n\nNobody followed her.\n",
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "T"})

    generation.start_run(str(ws), FakeBackend(), voice_id="v")
    generation.wait_for_idle()
    assert _run_record(ws)["status"] == "completed"

    # A second run with nothing changed is honestly refused.
    with pytest.raises(ValueError, match="up to date"):
        generation.start_run(str(ws), FakeBackend(), voice_id="v")

    # Add the Lara rule -- exactly the live scenario. Only the segment
    # containing "Lara" goes stale; the other keeps its audio.
    pronunciation.save_workspace_rules(str(ws), [
        pronunciation.PronunciationRule("Lara", "LAR-uh"),
    ])
    run = generation.start_run(str(ws), FakeBackend(), voice_id="v")
    assert run["total_segments"] == 1
    generation.wait_for_idle()
    assert _run_record(ws)["status"] == "completed"


def test_voice_change_requeues_everything(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=2)
    generation.start_run(str(ws), FakeBackend(), voice_id="af_heart")
    generation.wait_for_idle()

    run = generation.start_run(str(ws), FakeBackend(), voice_id="am_adam")
    assert run["total_segments"] == 2        # the print-pass semantics
    generation.wait_for_idle()


def test_force_regenerates_regardless(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=2)
    generation.start_run(str(ws), FakeBackend(), voice_id="v")
    generation.wait_for_idle()

    run = generation.start_run(str(ws), FakeBackend(), voice_id="v", force=True)
    assert run["total_segments"] == 2
    generation.wait_for_idle()
    assert _run_record(ws)["status"] == "completed"


def test_pace_flows_to_the_engine_and_pace_edits_requeue(tmp_path):
    src = tmp_path / "b.md"
    src.write_text(
        "# Chapter 1\n\nNormal speed here.\n\n[pace:0.8]Slow and heavy passage.[/pace]\n",
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "T"})

    speeds: list[float] = []

    class SpeedSpy(FakeBackend):
        def synthesize(self, text, voice_id, speed=1.0):
            speeds.append(speed)
            return super().synthesize(text, voice_id)

    generation.start_run(str(ws), SpeedSpy(), voice_id="v")
    generation.wait_for_idle()
    assert speeds == [1.0, 0.8]

    # Removing the pace span keeps the segment's identity but changes its
    # payload basis -- exactly one segment re-queues.
    content = client.get("/api/audiobook/narration",
                         params={"workspace_path": str(ws)}).json()["content"]
    client.put("/api/audiobook/narration", json={
        "workspace_path": str(ws),
        "content": content.replace("[pace:0.8]", "").replace("[/pace]", ""),
    })
    run = generation.start_run(str(ws), SpeedSpy(), voice_id="v")
    assert run["total_segments"] == 1
    generation.wait_for_idle()
    assert speeds[-1] == 1.0


def test_narration_settings_drive_dialogue_and_narrator_pace(tmp_path):
    src = tmp_path / "b.md"
    src.write_text(
        '# Chapter 1\n\nShe walked to the gate slowly.\n\n'
        '"You came back," he said quietly.\n',
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "T"})

    put = client.put("/api/audiobook/narration-settings", json={
        "workspace_path": str(ws),
        "narrator_pace": 0.95, "dialogue_pace": 0.85,
        "scene_break_ms": 2500, "chapter_break_ms": 4000,
    })
    assert put.status_code == 200

    speeds: list[float] = []

    class SpeedSpy(FakeBackend):
        def synthesize(self, text, voice_id, speed=1.0):
            speeds.append(speed)
            return super().synthesize(text, voice_id)

    generation.start_run(str(ws), SpeedSpy(), voice_id="v")
    generation.wait_for_idle()
    # Narration paragraph at narrator pace, dialogue paragraph at dialogue pace.
    assert speeds == [0.95, 0.85]

    # Changing ONLY the dialogue pace re-queues only the dialogue segment.
    client.put("/api/audiobook/narration-settings", json={
        "workspace_path": str(ws),
        "narrator_pace": 0.95, "dialogue_pace": 0.9,
        "scene_break_ms": 2500, "chapter_break_ms": 4000,
    })
    run = generation.start_run(str(ws), SpeedSpy(), voice_id="v")
    assert run["total_segments"] == 1
    generation.wait_for_idle()
    assert speeds[-1] == 0.9


def test_marker_pace_multiplies_the_base(tmp_path):
    src = tmp_path / "b.md"
    src.write_text(
        "# Chapter 1\n\n[pace:0.8]A slow passage on top of a slow book.[/pace]\n",
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "T"})
    client.put("/api/audiobook/narration-settings", json={
        "workspace_path": str(ws),
        "narrator_pace": 0.9, "dialogue_pace": 1.0,
        "scene_break_ms": 2000, "chapter_break_ms": 3000,
    })

    speeds: list[float] = []

    class SpeedSpy(FakeBackend):
        def synthesize(self, text, voice_id, speed=1.0):
            speeds.append(speed)
            return super().synthesize(text, voice_id)

    generation.start_run(str(ws), SpeedSpy(), voice_id="v")
    generation.wait_for_idle()
    assert speeds == [pytest.approx(0.72)]      # 0.9 base * 0.8 marker


# ── Control: pause, cancel, single-run, lock ─────────────────────────────────

def test_pause_finishes_current_segment_then_stops(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=3)
    backend = BlockingBackend()
    generation.start_run(str(ws), backend, voice_id="v")

    assert backend.first_started.wait(timeout=10)
    generation.request_pause()               # while segment 1 is in flight
    backend.release.set()
    generation.wait_for_idle()

    record = _run_record(ws)
    assert record["status"] == "paused"
    statuses = [s["status"] for s in _segments_on_disk(ws)]
    assert statuses == ["completed", "pending", "pending"]
    assert locking.read_lock(str(ws)) is None   # released while paused


def test_resume_continues_from_persisted_state_via_api(tmp_path, monkeypatch):
    ws = _make_workspace(tmp_path, paragraphs=3)
    backend = BlockingBackend()
    generation.start_run(str(ws), backend, voice_id="af_heart")
    assert backend.first_started.wait(timeout=10)
    generation.request_pause()
    backend.release.set()
    generation.wait_for_idle()

    # Resume through the endpoint: it reuses the paused run's provider.
    monkeypatch.setattr("app.routers.audiobook.synthesis.resolve_backend",
                        lambda provider: FakeBackend())
    response = client.post("/api/audiobook/generation/resume",
                           json={"workspace_path": str(ws)})
    assert response.status_code == 200, response.text
    generation.wait_for_idle()

    assert [s["status"] for s in _segments_on_disk(ws)] == ["completed"] * 3
    assert _run_record(ws)["status"] == "completed"
    # Only the two remaining segments were generated on the second run.
    assert _run_record(ws)["total_segments"] == 2


def test_cancel_stops_after_current_segment(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=3)
    backend = BlockingBackend()
    generation.start_run(str(ws), backend, voice_id="v")
    assert backend.first_started.wait(timeout=10)
    generation.request_cancel()
    backend.release.set()
    generation.wait_for_idle()
    assert _run_record(ws)["status"] == "cancelled"


def test_only_one_run_at_a_time_anywhere(tmp_path):
    ws1 = _make_workspace(tmp_path / "a", paragraphs=1)
    ws2 = _make_workspace(tmp_path / "b", paragraphs=1)
    backend = BlockingBackend()
    generation.start_run(str(ws1), backend, voice_id="v")
    assert backend.first_started.wait(timeout=10)
    try:
        with pytest.raises(RuntimeError, match="already generating"):
            generation.start_run(str(ws2), FakeBackend(), voice_id="v")
    finally:
        backend.release.set()
        generation.wait_for_idle()


def test_foreign_live_lock_blocks_a_run(tmp_path, monkeypatch):
    ws = _make_workspace(tmp_path, paragraphs=1)
    # A DIFFERENT process id that is definitely alive from our probe's view.
    (ws / locking.LOCK_NAME).write_text(json.dumps({
        "pid": 999999, "hostname": __import__("socket").gethostname(),
        "acquired_at": "2026-07-29T00:00:00Z",
    }), encoding="utf-8")
    monkeypatch.setattr(locking, "_pid_alive", lambda pid: True)
    with pytest.raises(locking.WorkspaceLockedError):
        generation.start_run(str(ws), FakeBackend(), voice_id="v")


def test_stale_lock_is_broken_automatically(tmp_path, monkeypatch):
    ws = _make_workspace(tmp_path, paragraphs=1)
    (ws / locking.LOCK_NAME).write_text(json.dumps({
        "pid": 999999, "hostname": __import__("socket").gethostname(),
        "acquired_at": "2026-07-29T00:00:00Z",
    }), encoding="utf-8")
    monkeypatch.setattr(locking, "_pid_alive", lambda pid: False)   # holder is gone
    generation.start_run(str(ws), FakeBackend(), voice_id="v")
    generation.wait_for_idle()
    assert _run_record(ws)["status"] == "completed"


# ── Restart recovery + endpoint surface ──────────────────────────────────────

def test_interrupted_run_heals_to_paused_on_status_read(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=1)
    # Simulate a crash: a run record left claiming "generating" with no
    # live worker in this process.
    generation.save_run(str(ws), {
        "run_id": "r1", "status": "generating", "provider": "fake",
        "model": "m", "engine_version": "e", "voice_id": "v",
        "started_at": "2026-07-29T00:00:00Z", "paused_at": None,
        "completed_at": None, "total_segments": 5,
        "completed_segments": 2, "failed_segments": 0, "note": None,
    })
    response = client.get("/api/audiobook/generation/status",
                          params={"workspace_path": str(ws)})
    body = response.json()
    assert body["active"] is False
    assert body["run"]["status"] == "paused"
    assert "interrupted" in body["run"]["note"]


def test_generate_endpoint_is_honest_about_missing_engines(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=1)
    response = client.post("/api/audiobook/generate", json={
        "workspace_path": str(ws), "provider": "local-kokoro", "voice_id": "af_heart",
    })
    assert response.status_code == 400
    assert "not installed" in response.json()["detail"]


def test_pause_endpoint_409_when_nothing_is_running(tmp_path):
    ws = _make_workspace(tmp_path, paragraphs=1)
    response = client.post("/api/audiobook/generation/pause",
                           json={"workspace_path": str(ws)})
    assert response.status_code == 409

