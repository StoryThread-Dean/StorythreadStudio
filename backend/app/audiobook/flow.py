# audiobook/flow.py -- continuous synthesis for pause-split paragraphs.
# ======================================================================
# THE ROOT CAUSE this module exists for (live listening tests, 2026-07-30):
# when a [pause] marker cuts a paragraph into fragments, each fragment is
# synthesized as its own ISOLATED utterance -- and Kokoro performs an
# ending on every isolated utterance (cold onset, stretched delivery,
# breathy final release). "A cult." alone renders as "Aahh Cuult" with a
# manufactured tail; the same words inside a longer sentence run are
# clean. Measured: isolated speech ran ~100ms longer than the identical
# words in context, and no amount of post-trim/fade could fix it because
# the artifact is loud, voiced audio -- a performance, not padding.
#
# The cure, verified by ear against the user's real passage: synthesize
# the WHOLE fragment run continuously (pauses stripped), then insert the
# writer's pauses INTO the natural silence gaps between sentences. Every
# seam lives inside real silence; the speech is one unbroken performance.
#
# Finding the gaps is the hard part -- commas and phrase breaks also
# produce silence (a naive "longest gaps win" matcher picked a comma
# break over a real sentence boundary). The trick that makes it robust:
# the engine is DETERMINISTIC, so each fragment's isolated duration is a
# known number, and in-context speech runs at a predictable fraction of
# it (~0.88x measured). Each boundary therefore has a narrow duration
# band it must land in, and within the band the longest gap is
# unambiguous. Any boundary that finds no gap in its band = the whole
# group falls back to per-fragment audio (today's behavior) -- the
# matcher is never allowed to guess.

import array
import io
import wave

# Gap detection: 10ms RMS windows; below GAP_QUIET_RMS counts as quiet;
# runs shorter than GAP_MIN_MS are ignored (plosive closures, not gaps).
_GAP_WINDOW_MS = 10
_GAP_QUIET_RMS = 120
_GAP_MIN_MS = 40

# A fragment's in-context length vs its isolated length. Measured 0.88x
# on real passages; the band is generous because prosody varies, and a
# wrong match is worse than a fallback.
_BAND_LO = 0.55
_BAND_HI = 1.10
# The last fragment's check gets extra headroom: clip-final silence and
# the engine's own closing ritardando ride on it.
_TAIL_SLACK_MS = 600

# Trailing near-silence level when measuring an isolated clip's speech
# length (same scale as wav_assembly's trim threshold).
_SPEECH_TRIM_THRESHOLD = 330


class FlowError(Exception):
    """A clip could not be parsed as the expected 16-bit mono WAV."""


def _load_wav(audio: bytes) -> tuple[int, array.array]:
    try:
        with wave.open(io.BytesIO(audio), "rb") as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1:
                raise FlowError("Flow matching expects 16-bit mono WAV clips.")
            rate = w.getframerate()
            data = array.array("h")
            data.frombytes(w.readframes(w.getnframes()))
    except (wave.Error, EOFError) as e:
        raise FlowError(f"Not a parseable WAV clip: {e}")
    return rate, data


def _wav_bytes(rate: int, samples: array.array) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(samples.tobytes())
    return buf.getvalue()


def speech_ms(audio: bytes) -> int:
    """An isolated clip's SPEECH length: total minus trailing near-silence.
    (The engine's manufactured-ending breath stays in -- the band is
    generous enough to absorb it.)"""
    rate, data = _load_wav(audio)
    end = len(data)
    while end > 0 and abs(data[end - 1]) < _SPEECH_TRIM_THRESHOLD:
        end -= 1
    return end * 1000 // rate


def _quiet_gaps(data: array.array, rate: int) -> list[tuple[int, int]]:
    """Interior quiet runs as (start_sample, length_samples), in order."""
    win = int(rate * _GAP_WINDOW_MS / 1000)

    def wrms(i: int) -> float:
        seg = data[i:i + win]
        return (sum(s * s for s in seg) / max(1, len(seg))) ** 0.5

    runs: list[list[int]] = []
    current: list[int] | None = None
    for i in range(0, len(data) - win, win):
        if wrms(i) < _GAP_QUIET_RMS:
            current = [i, i] if current is None else [current[0], i]
        elif current is not None:
            runs.append(current)
            current = None
    min_len = int(rate * _GAP_MIN_MS / 1000)
    return [(s, e + win - s) for s, e in runs
            if s > win and (e + win - s) >= min_len]


def match_cut_points(group_audio: bytes,
                     fragment_speech_ms: list[int]) -> list[int] | None:
    """
    Locate the fragment boundaries inside a continuous render.

    Returns one cut position (ms, the midpoint of the matched gap) per
    internal boundary -- len(fragment_speech_ms) - 1 cuts -- or None when
    any boundary cannot be matched confidently.
    """
    rate, data = _load_wav(group_audio)
    total_ms = len(data) * 1000 // rate
    gaps = _quiet_gaps(data, rate)

    cuts: list[int] = []
    cursor_ms = 0.0
    for iso in fragment_speech_ms[:-1]:
        lo = cursor_ms + iso * _BAND_LO
        hi = cursor_ms + iso * _BAND_HI
        inside = [(s, ln) for s, ln in gaps if lo <= (s * 1000 / rate) <= hi]
        if not inside:
            return None
        s, ln = max(inside, key=lambda g: g[1])   # longest gap in the band
        cuts.append((s + ln // 2) * 1000 // rate)
        cursor_ms = (s + ln) * 1000 / rate        # next fragment starts after the gap
    # The audio remaining after the last boundary must plausibly BE the
    # last fragment -- otherwise a decoy gap fooled an earlier boundary.
    tail_ms = total_ms - cursor_ms
    last = fragment_speech_ms[-1]
    if not (last * _BAND_LO <= tail_ms <= last * _BAND_HI + _TAIL_SLACK_MS):
        return None
    return cuts


def synthesize_flow(backend, voice_id: str, speed: float,
                    payloads: list[str]) -> tuple[bytes, list[int], bool]:
    """
    Synthesize a pause-split fragment run the flow way.

    Returns (wav_bytes, cut_positions_ms, flowed):
      flowed=True  -- wav is the CONTINUOUS render; cuts sit inside its
                      natural sentence gaps.
      flowed=False -- matching failed; wav is the isolated fragments
                      concatenated (today's quality, never worse) and the
                      cuts sit exactly at the joins.

    The isolated fragments are synthesized either way -- they are the
    calibration table, and they double as the fallback audio.
    """
    fragment_clips: list[bytes] = []
    fragment_ms: list[int] = []
    for payload in payloads:
        audio, _duration = backend.synthesize(payload, voice_id, speed)
        fragment_clips.append(audio)
        fragment_ms.append(speech_ms(audio))

    group_audio, _duration = backend.synthesize(" ".join(payloads), voice_id, speed)
    try:
        cuts = match_cut_points(group_audio, fragment_ms)
    except FlowError:
        cuts = None
    if cuts is not None:
        return group_audio, cuts, True

    # Fallback: concatenate the isolated clips; every join is a cut, so
    # the stitcher inserts the writer's pauses in exactly today's places.
    rate, first = _load_wav(fragment_clips[0])
    combined = array.array("h", first)
    joins: list[int] = []
    for clip in fragment_clips[1:]:
        clip_rate, samples = _load_wav(clip)
        if clip_rate != rate:
            raise FlowError("Fragment clips disagree on sample rate.")
        joins.append(len(combined) * 1000 // rate)
        combined.extend(samples)
    return _wav_bytes(rate, combined), joins, False


def split_flow_pieces(audio: bytes, cuts_ms: list[int],
                      pauses_ms: list[int]) -> list[bytes | int]:
    """
    One flow WAV -> the stitcher's piece list: sub-clips split at the cut
    positions with the writer's CURRENT pause durations between them.
    Pause durations live outside the audio, so retiming a pause never
    regenerates speech. A count mismatch (narration edited since the
    audio was generated -- the segment is already queued as stale) pairs
    what it can and plays the rest gapless rather than failing.
    """
    if not cuts_ms:
        return [audio]
    rate, data = _load_wav(audio)
    pieces: list[bytes | int] = []
    cursor = 0
    for index, cut_ms in enumerate(cuts_ms):
        cut = min(len(data), int(rate * cut_ms / 1000))
        if cut > cursor:
            pieces.append(_wav_bytes(rate, data[cursor:cut]))
            cursor = cut
        if index < len(pauses_ms):
            pieces.append(int(pauses_ms[index]))
    if cursor < len(data):
        pieces.append(_wav_bytes(rate, data[cursor:]))
    return pieces
