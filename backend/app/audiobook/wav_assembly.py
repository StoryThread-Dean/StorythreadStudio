# audiobook/wav_assembly.py -- stitching WAV pieces with real silence.
# =====================================================================
# The first, tiny slice of assembly (spec 10.3 / 26): concatenate 16-bit
# mono WAV clips and insert exact zero-sample silence between them --
# pure stdlib, no FFmpeg needed, because every clip comes from the same
# engine at the same sample rate. Used today by the marker "Hear it"
# demos; the full chapter assembler (FFmpeg, FLAC, loudnorm) builds on
# the same idea in Stage C.

import array
import io
import wave


class WavMismatchError(Exception):
    """Clips with different formats cannot be naively concatenated."""


# ── Boundary conditioning (live-testing finding) ─────────────────────────────
# Raw clip edges butted against inserted silence produce audible smears
# on boundary consonants ("Can you describe it?" -- the t slurred before
# every [pause]). Two treatments per clip, both inaudible as effects:
#   TRIM: shave near-silence off head/tail so the writer's pause is the
#         ONLY gap -- engine padding never stacks onto it.
#   FADE: ~8ms linear ramps at each edge kill the waveform discontinuity
#         that reads as a lisp/click at the seam.

_TRIM_THRESHOLD = 330          # ~-40 dBFS on 16-bit samples
_TRIM_MAX_MS = 250             # never eat into actual speech
_FADE_IN_MS = 8
# The fade-OUT is longer: utterance-final sibilants (the s in
# "strokes") decay as low-level noise, and a hard 8ms ramp read as a
# slur into the following pause. 25ms lands the tail gently.
_FADE_OUT_MS = 25


def _condition_edges(frames: bytes, framerate: int) -> bytes:
    """Trim + fade one 16-bit mono clip's frames. Anything else passes
    through untouched -- this only ever sees our own engine output."""
    samples = array.array("h")
    samples.frombytes(frames)
    n = len(samples)
    if n == 0:
        return frames

    max_trim = int(framerate * _TRIM_MAX_MS / 1000)
    start = 0
    while start < min(n, max_trim) and abs(samples[start]) < _TRIM_THRESHOLD:
        start += 1
    end = n
    floor = max(start, n - max_trim)
    while end > floor and abs(samples[end - 1]) < _TRIM_THRESHOLD:
        end -= 1
    if end <= start:
        return frames                    # an all-quiet clip: leave it be
    samples = samples[start:end]

    fade_in = min(int(framerate * _FADE_IN_MS / 1000), len(samples) // 2)
    for i in range(fade_in):
        samples[i] = int(samples[i] * i / fade_in)
    fade_out = min(int(framerate * _FADE_OUT_MS / 1000), len(samples) // 2)
    for i in range(fade_out):
        samples[-1 - i] = int(samples[-1 - i] * i / fade_out)
    return samples.tobytes()


# ── Level matching (live-testing finding) ────────────────────────────────────
# Hosted engines do not return a consistent LOUDNESS. A two-paragraph
# Voxtral preview came back with the second paragraph noticeably louder
# than the first and it stayed there: two paragraphs are two requests, and
# a performer model picks its own level each time. Kokoro does not do this;
# expressive hosted models do, and it is the same family of problem as the
# pitch drift that got Grok demoted -- except this one we CAN fix.
#
# Applied per SYNTHESIS UNIT, never per clip. The distinction is the whole
# design: flow synthesis renders a run of sentences as one continuous clip
# and splits it afterwards, and those splits must share a single gain. Give
# them separate gains and the natural rise and fall inside a sentence gets
# flattened into loudness-war mush -- destroying exactly what flow
# synthesis exists to protect. So callers normalize the WHOLE clip, then
# split.
#
# Target is -20 dBFS RMS, the middle of Audible's ACX window (-23 to -18
# dB RMS, peaks under -3 dB), with a -1 dBFS peak ceiling here.

_TARGET_RMS = 3277             # -20 dBFS on the 16-bit scale
_PEAK_CEILING = 29205          # -1 dBFS: headroom against inter-sample peaks
_SILENCE_RMS = 104             # -50 dBFS: silence, nothing to normalize
_MAX_GAIN = 2.5                # +8 dB. Beyond this we would be amplifying
_MIN_GAIN = 0.4                # -8 dB. room tone, not fixing a level
_GAIN_DEADBAND = 0.03          # ignore corrections under ~0.25 dB


def match_level(wav_bytes: bytes) -> bytes:
    """
    One synthesis unit -> the same audio at a consistent loudness.

    Pass the ENTIRE clip a single model call produced. For a flow segment
    that means the whole continuous render, BEFORE it is split at the cut
    points -- see the note above.

    Anything that is not 16-bit mono passes through untouched, as does
    near-silence and any clip already close enough to target. The gain is
    clamped hard in both directions: this exists to correct an engine's
    arbitrary level choice, not to squeeze a quiet passage into a loud one.
    """
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as clip:
            params = clip.getparams()
            frames = clip.readframes(clip.getnframes())
    except (wave.Error, EOFError):
        return wav_bytes
    if params.sampwidth != 2 or params.nchannels != 1 or not frames:
        return wav_bytes

    samples = array.array("h")
    samples.frombytes(frames)
    if not samples:
        return wav_bytes

    # RMS off every 8th sample. Speech is dense enough that the estimate
    # lands within a fraction of a dB, and it keeps a full-length chapter
    # from spending seconds in a Python loop just to measure itself.
    window = samples[::8] or samples
    total = 0
    peak = 0
    for value in window:
        total += value * value
        if value > peak:
            peak = value
        elif -value > peak:
            peak = -value
    rms = (total / len(window)) ** 0.5
    if rms < _SILENCE_RMS or peak == 0:
        return wav_bytes

    gain = _TARGET_RMS / rms
    gain = max(_MIN_GAIN, min(_MAX_GAIN, gain))
    # Never let the correction clip. The true peak may sit between the
    # sampled points, so measure it properly before trusting the ceiling.
    true_peak = max(abs(min(samples)), abs(max(samples)))
    if true_peak * gain > _PEAK_CEILING:
        gain = _PEAK_CEILING / true_peak
    if abs(gain - 1.0) < _GAIN_DEADBAND:
        return wav_bytes

    # The clamps above guarantee the result fits in int16, so this can
    # multiply without a per-sample bounds check.
    scaled = array.array("h", [int(value * gain) for value in samples])
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(params.framerate)
        out.writeframes(scaled.tobytes())
    return buffer.getvalue()


def concat_wav(pieces: list[bytes | int]) -> bytes:
    """
    Merge a sequence of WAV byte blobs and silence gaps into one WAV.

    `pieces` mixes two kinds of items, in playback order:
      bytes -- a complete WAV file (16-bit PCM mono expected)
      int   -- milliseconds of silence to insert at that point

    The output inherits the first clip's sample rate/width/channels; any
    clip that disagrees raises WavMismatchError rather than producing
    chipmunk audio.
    """
    params = None
    frames: list[bytes] = []

    for piece in pieces:
        if isinstance(piece, int):
            if params is None:
                # Leading silence before any clip: remember and emit once
                # we know the format. Simplest correct handling: require a
                # clip first (demos always start with speech).
                raise WavMismatchError("Silence cannot come before the first clip.")
            frame_count = int(params.framerate * piece / 1000)
            frames.append(b"\x00" * (frame_count * params.sampwidth * params.nchannels))
            continue

        with wave.open(io.BytesIO(piece), "rb") as clip:
            clip_params = clip.getparams()
            if params is None:
                params = clip_params
            elif (clip_params.framerate != params.framerate
                  or clip_params.sampwidth != params.sampwidth
                  or clip_params.nchannels != params.nchannels):
                raise WavMismatchError(
                    f"Clip format {clip_params.framerate}Hz/"
                    f"{clip_params.nchannels}ch does not match "
                    f"{params.framerate}Hz/{params.nchannels}ch."
                )
            raw = clip.readframes(clip.getnframes())
            if clip_params.sampwidth == 2 and clip_params.nchannels == 1:
                raw = _condition_edges(raw, clip_params.framerate)
            frames.append(raw)

    if params is None:
        raise WavMismatchError("No audio clips to concatenate.")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(params.nchannels)
        out.setsampwidth(params.sampwidth)
        out.setframerate(params.framerate)
        out.writeframes(b"".join(frames))
    return buffer.getvalue()
