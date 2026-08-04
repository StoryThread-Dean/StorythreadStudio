# test_audiobook_level_matching.py
# ================================
# Live finding: a two-paragraph Voxtral preview came back with the second
# paragraph noticeably LOUDER than the first, and it stayed loud. Two
# paragraphs are two requests, and an expressive hosted model picks its
# own level each time. Kokoro never did this; performer models do.
#
# Unlike the pitch drift that got Grok demoted, loudness IS fixable from
# our side, so match_level() normalizes each synthesis unit to a fixed
# target before anything is stitched.
#
# The subtle contract -- and the one worth guarding hardest -- is the UNIT.
# Flow synthesis renders a run of sentences as ONE clip and splits it
# afterwards. Those splits must share a single gain, or the natural rise
# and fall inside a sentence gets levelled into mush, destroying the exact
# thing flow synthesis exists to protect.

import io
import math
import wave

from app.audiobook.wav_assembly import (
    _TARGET_RMS,
    concat_wav,
    match_level,
)


def _tone(seconds: float, amplitude: int, rate: int = 24000,
          width: int = 2, channels: int = 1) -> bytes:
    """A WAV of a steady 220 Hz tone at a known amplitude."""
    n = int(rate * seconds)
    frames = bytearray()
    for i in range(n):
        value = int(amplitude * math.sin(2 * math.pi * 220 * i / rate))
        for _ in range(channels):
            frames += int(value).to_bytes(width, "little", signed=True)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(width)
        out.setframerate(rate)
        out.writeframes(bytes(frames))
    return buffer.getvalue()


def _rms(wav_bytes: bytes) -> float:
    with wave.open(io.BytesIO(wav_bytes), "rb") as clip:
        frames = clip.readframes(clip.getnframes())
    total = 0
    count = len(frames) // 2
    for i in range(0, len(frames), 2):
        value = int.from_bytes(frames[i:i + 2], "little", signed=True)
        total += value * value
    return (total / count) ** 0.5


def _peak(wav_bytes: bytes) -> int:
    with wave.open(io.BytesIO(wav_bytes), "rb") as clip:
        frames = clip.readframes(clip.getnframes())
    return max(abs(int.from_bytes(frames[i:i + 2], "little", signed=True))
               for i in range(0, len(frames), 2))


def test_two_paragraphs_at_different_levels_come_out_matched():
    # The reported bug, reproduced: a quiet clip and a loud one, stitched.
    quiet = match_level(_tone(0.25, 2000))
    loud = match_level(_tone(0.25, 9000))
    # Both land on target, so the seam between them is inaudible.
    assert _rms(quiet) == pytest_approx(_TARGET_RMS, 0.08)
    assert _rms(loud) == pytest_approx(_TARGET_RMS, 0.08)
    ratio = _rms(loud) / _rms(quiet)
    assert 0.85 < ratio < 1.18          # was 4.5x before matching


def test_the_gain_is_clamped_so_room_tone_is_never_amplified():
    # A very quiet clip must NOT be dragged up to speaking level -- that
    # would turn a breath or a hiss into a foreground noise.
    faint = _tone(0.25, 300)
    out = match_level(faint)
    assert _rms(out) / _rms(faint) <= 2.6      # +8 dB ceiling, not 11x
    # And true silence is left completely alone.
    silent = _tone(0.25, 0)
    assert match_level(silent) == silent


def test_normalizing_never_clips():
    # A hot clip must come DOWN, and must not be pushed into the rails.
    hot = match_level(_tone(0.25, 32000))
    assert _peak(hot) <= 29500


def test_a_clip_already_on_target_is_returned_untouched():
    # Byte-identical, not merely close: a no-op must not silently rewrite
    # every segment of a book on every assembly.
    on_target = _tone(0.25, int(_TARGET_RMS * math.sqrt(2)))
    assert match_level(on_target) == on_target


def test_formats_this_pipeline_does_not_own_pass_through():
    stereo = _tone(0.2, 3000, channels=2)
    assert match_level(stereo) == stereo
    eight_bit = _tone(0.2, 60, width=1)
    assert match_level(eight_bit) == eight_bit
    assert match_level(b"not a wav at all") == b"not a wav at all"


def test_a_flow_run_keeps_ONE_gain_across_its_split_pieces():
    # The contract that protects flow synthesis. A continuous render whose
    # second half is deliberately quieter (a phrase trailing off) must
    # KEEP that shape after normalizing -- one gain for the whole run.
    from app.audiobook import flow

    strong = _tone(0.30, 9000)
    with wave.open(io.BytesIO(_tone(0.30, 3000)), "rb") as clip:
        soft_frames = clip.readframes(clip.getnframes())
    with wave.open(io.BytesIO(strong), "rb") as clip:
        strong_frames = clip.readframes(clip.getnframes())
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(24000)
        out.writeframes(strong_frames + soft_frames)
    run = buffer.getvalue()

    # Normalize the WHOLE run first, THEN split -- the production order.
    pieces = flow.split_flow_pieces(match_level(run), [300], [500])
    clips = [p for p in pieces if isinstance(p, bytes)]
    assert len(clips) == 2
    # The 3:1 dynamic between the halves survives. Levelling them apart
    # would have flattened this to 1:1.
    ratio = _rms(clips[0]) / _rms(clips[1])
    assert ratio > 2.0


def test_matched_clips_still_stitch_into_one_wav():
    stitched = concat_wav([match_level(_tone(0.2, 2000)), 300,
                           match_level(_tone(0.2, 9000))])
    with wave.open(io.BytesIO(stitched), "rb") as clip:
        assert clip.getnchannels() == 1
        assert clip.getsampwidth() == 2
        assert clip.getnframes() > 24000 * 0.3


def pytest_approx(value: float, rel: float):
    """Tiny local helper so the assertions above read as prose."""
    class _Approx:
        def __eq__(self, other):
            return abs(other - value) <= abs(value) * rel

        def __repr__(self):
            return f"{value} +- {rel * 100:.0f}%"
    return _Approx()
