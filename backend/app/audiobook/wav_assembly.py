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
_FADE_MS = 8


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

    fade = min(int(framerate * _FADE_MS / 1000), len(samples) // 2)
    for i in range(fade):
        samples[i] = int(samples[i] * i / fade)
        samples[-1 - i] = int(samples[-1 - i] * i / fade)
    return samples.tobytes()


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
