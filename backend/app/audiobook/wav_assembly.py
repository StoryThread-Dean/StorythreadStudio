# audiobook/wav_assembly.py -- stitching WAV pieces with real silence.
# =====================================================================
# The first, tiny slice of assembly (spec 10.3 / 26): concatenate 16-bit
# mono WAV clips and insert exact zero-sample silence between them --
# pure stdlib, no FFmpeg needed, because every clip comes from the same
# engine at the same sample rate. Used today by the marker "Hear it"
# demos; the full chapter assembler (FFmpeg, FLAC, loudnorm) builds on
# the same idea in Stage C.

import io
import wave


class WavMismatchError(Exception):
    """Clips with different formats cannot be naively concatenated."""


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
            frames.append(clip.readframes(clip.getnframes()))

    if params is None:
        raise WavMismatchError("No audio clips to concatenate.")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(params.nchannels)
        out.setsampwidth(params.sampwidth)
        out.setframerate(params.framerate)
        out.writeframes(b"".join(frames))
    return buffer.getvalue()
