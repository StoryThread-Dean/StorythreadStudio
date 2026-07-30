# tests/test_audiobook_marker_demos.py
# =====================================
# The WAV stitcher and the audible marker demos: silence gaps are exact
# zero-sample runs, format mismatches refuse loudly, and each demo renders
# through the real parse -> synthesize -> stitch pipeline (with a fake
# engine emitting tiny valid WAVs).

import io
import wave

import pytest

from app.audiobook import marker_demos
from app.audiobook.marker_demos import DEMO_SCRIPTS, DEMO_VOICE, build_demo
from app.audiobook.synthesis import SynthesisBackend
from app.audiobook.wav_assembly import WavMismatchError, concat_wav


@pytest.fixture(autouse=True)
def _fresh_demo_cache():
    # The render cache is module-level state; tests that inspect WHICH
    # texts were synthesized need a cold cache every time.
    marker_demos._demo_cache.clear()
    yield
    marker_demos._demo_cache.clear()


def _tone_wav(seconds: float, rate: int = 24000) -> bytes:
    """A tiny valid 16-bit mono WAV of non-zero samples."""
    frames = int(rate * seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x11\x22" * frames)
    return buffer.getvalue()


def _duration(wav_bytes: bytes) -> float:
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        return w.getnframes() / w.getframerate()


class DemoBackend(SynthesisBackend):
    """One second of 'speech' per synthesize call, any text."""
    key = "fake"
    model_id = "m"
    engine_version = "e"

    def __init__(self):
        self.texts: list[str] = []

    def synthesize(self, text: str, voice_id: str, speed: float = 1.0):
        assert voice_id == DEMO_VOICE          # demos always use the reference voice
        self.texts.append(text)
        return _tone_wav(1.0), 1.0


# ── concat_wav ────────────────────────────────────────────────────────────────

def test_concat_inserts_exact_silence():
    out = concat_wav([_tone_wav(1.0), 1500, _tone_wav(1.0)])
    assert _duration(out) == pytest.approx(3.5, abs=0.03)


def _padded_tone_wav(speech_s: float, pad_s: float, rate: int = 24000) -> bytes:
    """A tone clip with true-silence padding on both edges -- the shape of
    real engine output whose padding used to stack onto inserted pauses."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        pad = b"\x00\x00" * int(rate * pad_s)
        w.writeframes(pad + (b"\x11\x22" * int(rate * speech_s)) + pad)
    return buffer.getvalue()


def test_engine_edge_padding_is_trimmed_so_pauses_stay_exact():
    # 1s speech padded 0.15s each side, twice, with a 0.5s pause between:
    # trimming keeps the writer's pause the ONLY gap (2s speech + 0.5s).
    clip = _padded_tone_wav(1.0, 0.15)
    out = concat_wav([clip, 500, clip])
    assert _duration(out) == pytest.approx(2.5, abs=0.03)


def test_boundary_fades_ramp_the_seams():
    # The first samples of a conditioned clip ramp from zero -- the
    # discontinuity that read as a consonant slur at pause seams is gone.
    out = concat_wav([_tone_wav(1.0)])
    with wave.open(io.BytesIO(out), "rb") as w:
        frames = w.readframes(w.getnframes())
    import array as array_module
    samples = array_module.array("h")
    samples.frombytes(frames)
    assert abs(samples[0]) < 100                 # starts at ~zero
    assert abs(samples[-1]) < 100                # ends at ~zero
    peak = max(abs(s) for s in samples)
    assert peak > 4000                           # the speech itself is intact


def test_concat_refuses_mismatched_rates():
    with pytest.raises(WavMismatchError):
        concat_wav([_tone_wav(1.0, rate=24000), _tone_wav(1.0, rate=44100)])


def test_concat_refuses_leading_silence_and_empty_input():
    with pytest.raises(WavMismatchError):
        concat_wav([500, _tone_wav(1.0)])
    with pytest.raises(WavMismatchError):
        concat_wav([])


# ── Demos ─────────────────────────────────────────────────────────────────────

def test_pause_demo_contains_its_advertised_silence():
    out = build_demo("pause", DemoBackend())
    # Two 1s speech clips + the 1.5s pause the script advertises.
    assert _duration(out) == pytest.approx(3.5, abs=0.01)


def test_chapter_break_demo_uses_the_three_second_default():
    out = build_demo("chapter-break", DemoBackend())
    assert _duration(out) == pytest.approx(5.0, abs=0.01)


def test_exclude_demo_never_speaks_the_excluded_text():
    backend = DemoBackend()
    build_demo("exclude", backend)
    spoken = " ".join(backend.texts)
    assert "never spoken" not in spoken            # the excluded sentence
    assert "narrated normally" in spoken


def test_say_demo_covers_both_use_cases():
    backend = DemoBackend()
    build_demo("say", backend)
    spoken = " ".join(backend.texts)
    # The demo opens by setting expectations: the engine is good; markers
    # are for VARIATIONS, not mass testing.
    assert "most pronunciations right" in spoken
    # Case 1 -- one "Jesus" doubles as the English default; the forced
    # Spanish form arrives fused and ear-tuned.
    assert "the name Jesus the English way" in spoken
    assert "Haysoos" in spoken                     # tuned by listening, not spelling
    # Case 2 -- regional variants: engine-default Lara plus three forced
    # readings, no hesitation gaps, closing on the user's tagline.
    assert "Lara, for example" in spoken
    assert "larah" in spoken
    assert "lairah" in spoken
    assert "leerah" in spoken
    # The closing act teaches the dictionary/say relationship out loud:
    # dictionary = whole book, say = one spot, say wins.
    assert "when both apply, say wins" in spoken
    assert "fine-tune your audiobook" in spoken
    assert "[say:" not in spoken                   # markup never narrated


def test_pace_demo_sends_three_speeds_and_speaks_each_value():
    speeds: list[float] = []

    class SpeedDemoBackend(DemoBackend):
        def synthesize(self, text: str, voice_id: str, speed: float = 1.0):
            speeds.append(speed)
            return super().synthesize(text, voice_id)

    backend = SpeedDemoBackend()
    build_demo("pace", backend)
    assert speeds == [1.0, 0.8, 1.2]
    # Each pace value is NARRATED while the listener experiences it, and
    # the spoken value matches the speed actually in effect for that piece.
    by_text = dict(zip(backend.texts, speeds))
    assert by_text[next(t for t in backend.texts if "one point zero" in t)] == 1.0
    assert by_text[next(t for t in backend.texts if "zero point eight" in t)] == 0.8
    assert by_text[next(t for t in backend.texts if "one point two" in t)] == 1.2


def test_every_script_renders():
    for kind in DEMO_SCRIPTS:
        assert len(build_demo(kind, DemoBackend())) > 44   # bigger than a WAV header


# ── render_marked_text (the select-text preview renderer) ────────────────────

def test_render_marked_text_applies_rules_and_silence():
    from app.audiobook.pronunciation import PronunciationRule
    backend = DemoBackend()
    out, warnings, _trace = marker_demos.render_marked_text(
        "Lara waited.\n\n[pause:2.0]\n\nNobody came.",
        backend, DEMO_VOICE, rules=[PronunciationRule("Lara", "LAR-uh")],
    )
    # Two 1s speech clips + the 2s pause = 4s of audio.
    assert _duration(out) == pytest.approx(4.0, abs=0.01)
    assert warnings == []
    # The dictionary rule reached the payload, fused.
    assert any("laruh" in t for t in backend.texts)


def test_render_marked_text_drops_leading_silence():
    backend = DemoBackend()
    out, _warnings, _trace = marker_demos.render_marked_text(
        "[pause:5.0]\n\nOnly this is spoken.", backend, DEMO_VOICE, rules=[])
    assert _duration(out) == pytest.approx(1.0, abs=0.01)


def test_render_reports_a_cut_into_pace_span():
    # THE live-testing mystery: a preview selection starting inside a pace
    # span has no opener -- the stray closer must warn AND never be spoken.
    backend = DemoBackend()
    _out, warnings, _trace = marker_demos.render_marked_text(
        "This part was inside the span.[/pace]\n\nAnd this was after it.",
        backend, DEMO_VOICE, rules=[])
    assert any("no opening [pace:...]" in w for w in warnings)
    spoken = " ".join(backend.texts)
    assert "[/pace]" not in spoken
    assert "pace" not in spoken.lower()          # marker never narrated


def test_post_span_text_returns_to_the_book_base_not_to_one():
    # The live report: with narrator 0.85 / dialogue 0.95, text AFTER a
    # closed [pace] span allegedly reverts to 1.0. Pin the truth: it must
    # return to the BOOK BASE (0.85), and unmarked dialogue must get the
    # dialogue base (0.95), before/inside/after any span.
    speeds: list[float] = []

    class SpeedSpy(DemoBackend):
        def synthesize(self, text: str, voice_id: str, speed: float = 1.0):
            speeds.append(speed)
            return super().synthesize(text, voice_id)

    settings = {"narrator_pace": 0.85, "dialogue_pace": 0.95,
                "scene_break_ms": 2000, "chapter_break_ms": 3000}
    _out, warnings, trace = marker_demos.render_marked_text(
        'Narration before the span, moving at the book base.\n\n'
        '[pace:0.8]The marked slow passage.[/pace]\n\n'
        'Narration after the span -- the reported reversion spot.\n\n'
        '"Unmarked dialogue right after," she said, "at the dialogue base."',
        SpeedSpy(), DEMO_VOICE, rules=[], settings=settings)
    assert warnings == []
    assert speeds == [0.85, pytest.approx(0.68), 0.85, 0.95]
    # The trace reports the same truth the audio used.
    assert [t["speed"] for t in trace] == speeds
    assert [t["dialogue"] for t in trace] == [False, False, False, True]


def test_multi_paragraph_pace_span_with_embedded_markers():
    # Pace must hold across paragraphs AND across embedded pauses/breaks
    # inside the span (the exact structure from live testing).
    speeds: list[float] = []

    class SpeedSpy(DemoBackend):
        def synthesize(self, text: str, voice_id: str, speed: float = 1.0):
            speeds.append(speed)
            return super().synthesize(text, voice_id)

    _out, warnings, _trace = marker_demos.render_marked_text(
        "Normal intro paragraph.\n\n"
        "[pace:0.8]Slow paragraph one.\n\n"
        "Slow paragraph two.\n\n"
        "[pause:0.5]\n\n"
        "Slow paragraph three, after an embedded pause.[/pace]\n\n"
        "Normal outro paragraph.",
        SpeedSpy(), DEMO_VOICE, rules=[])
    assert warnings == []
    # Every piece inside the span is slow -- including after the pause.
    assert speeds == [1.0, 0.8, 0.8, 1.0]


def test_render_marked_text_refuses_marker_only_selections():
    with pytest.raises(ValueError, match="Nothing to preview"):
        marker_demos.render_marked_text(
            "[pause:1.0]\n\n[exclude]all hidden[/exclude]",
            DemoBackend(), DEMO_VOICE, rules=[])


def test_demos_are_cached_per_engine_version():
    backend = DemoBackend()
    first = build_demo("pause", backend)
    calls_after_first = len(backend.texts)
    second = build_demo("pause", backend)
    assert second == first
    assert len(backend.texts) == calls_after_first     # no new synthesis

    # A NEW engine version misses the cache -- demos must never claim to
    # represent an engine that didn't render them.
    newer = DemoBackend()
    newer.engine_version = "e2"
    build_demo("pause", newer)
    assert len(newer.texts) > 0

