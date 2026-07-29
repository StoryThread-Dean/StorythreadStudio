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

    def synthesize(self, text: str, voice_id: str):
        assert voice_id == DEMO_VOICE          # demos always use the reference voice
        self.texts.append(text)
        return _tone_wav(1.0), 1.0


# ── concat_wav ────────────────────────────────────────────────────────────────

def test_concat_inserts_exact_silence():
    out = concat_wav([_tone_wav(1.0), 1500, _tone_wav(1.0)])
    assert _duration(out) == pytest.approx(3.5, abs=0.01)


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


def test_every_script_renders():
    for kind in DEMO_SCRIPTS:
        assert len(build_demo(kind, DemoBackend())) > 44   # bigger than a WAV header


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
