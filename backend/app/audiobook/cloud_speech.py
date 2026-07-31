# audiobook/cloud_speech.py -- hosted voices behind the same seam.
# =================================================================
# A SynthesisBackend that speaks to an OpenAI-compatible /audio/speech
# endpoint (NanoGPT, OpenRouter). The generation engine cannot tell the
# difference between this and the local narrator: same interface, same
# retry rules, same truncation check, same flow synthesis.
#
# Two things this file is careful about, because money is involved:
#
#   1. ERRORS ARE HONEST AND CLASSIFIED. A rate limit or a hiccup is
#      retryable; an invalid key, an empty wallet, or a content refusal
#      is NOT -- retrying those just bills again for the same failure
#      (spec 20.1, and every attempt is counted pessimistically).
#   2. AUDIO IS NORMALIZED. The rest of the pipeline (flow synthesis,
#      the stdlib stitcher) works in 16-bit mono WAV. Hosted providers
#      may answer in stereo, so clips are folded to mono here rather
#      than failing deep inside assembly.

import array
import io
import wave

import httpx

from app.audiobook.synthesis import SynthesisBackend, SynthesisError
from app.audiobook.tts_providers import HostedModel, TtsProviderConfig, resolve_model

# A segment is at most ~1,500 characters, but premium voices are not fast.
# This is deliberately NOT the 300s chat timeout (spec 32): a stuck
# segment should fail and retry, not hang a whole book.
_TIMEOUT = httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=10.0)


def _fold_to_mono_16bit(audio: bytes) -> bytes:
    """
    Return 16-bit mono WAV bytes, folding stereo down if needed.

    Raises SynthesisError (not retryable) when the provider sent
    something this pipeline cannot use -- a clear message beats a
    mysterious failure four steps later in assembly.
    """
    if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise SynthesisError(
            "The narration service returned audio in an unexpected format "
            "(expected WAV). Try a different voice or model.",
            retryable=False,
        )
    try:
        with wave.open(io.BytesIO(audio), "rb") as clip:
            channels = clip.getnchannels()
            width = clip.getsampwidth()
            rate = clip.getframerate()
            frames = clip.readframes(clip.getnframes())
    except (wave.Error, EOFError) as e:
        raise SynthesisError(f"The narration service sent unreadable audio: {e}",
                             retryable=False)

    if width != 2:
        raise SynthesisError(
            f"The narration service returned {width * 8}-bit audio; this "
            "pipeline works in 16-bit. Try a different model.",
            retryable=False,
        )
    if channels == 1:
        return audio
    if channels != 2:
        raise SynthesisError(
            f"The narration service returned {channels}-channel audio; "
            "narration should be mono or stereo.",
            retryable=False,
        )

    # Stereo -> mono: average the pairs. Narration is centre-panned in
    # practice, so averaging loses nothing and halves the data.
    samples = array.array("h")
    samples.frombytes(frames)
    mono = array.array("h", [0]) * (len(samples) // 2)
    for i in range(len(mono)):
        mono[i] = (samples[2 * i] + samples[2 * i + 1]) // 2
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(mono.tobytes())
    return buffer.getvalue()


def _wav_seconds(audio: bytes) -> float:
    with wave.open(io.BytesIO(audio), "rb") as clip:
        rate = clip.getframerate()
        return clip.getnframes() / rate if rate else 0.0


def _translate(provider: TtsProviderConfig, status: int, body: str) -> SynthesisError:
    """One place where every hosted failure becomes a writer-facing
    sentence with the right retry verdict."""
    tail = f" The service said: {body.strip()[:200]}" if body.strip() else ""
    if status == 401:
        return SynthesisError(
            f"{provider.label} rejected the API key. Check it in Settings.{tail}",
            retryable=False)
    if status == 402:
        return SynthesisError(
            f"{provider.label} reports insufficient credits. Add funds at "
            f"{provider.key_hint}, or narrate free with the local narrator.{tail}",
            retryable=False)
    if status == 403:
        return SynthesisError(
            f"{provider.label} refused this passage (content policy). Mature "
            "or explicit books narrate without restriction on the free local "
            f"narrator.{tail}",
            retryable=False)
    if status == 404:
        return SynthesisError(
            f"{provider.label} does not know that model or voice any more. "
            f"Pick another in the narration settings.{tail}",
            retryable=False)
    if status == 429:
        return SynthesisError(
            f"{provider.label} rate limit reached. This segment will be "
            f"retried shortly.{tail}",
            retryable=True)
    if status >= 500:
        return SynthesisError(
            f"{provider.label} had a server error (HTTP {status}). Retrying.{tail}",
            retryable=True)
    return SynthesisError(
        f"{provider.label} rejected the request (HTTP {status}).{tail}",
        retryable=False)


class CloudSpeechBackend(SynthesisBackend):
    """One hosted narration model, plugged into the generation seam."""

    file_extension = "wav"

    def __init__(self, provider: TtsProviderConfig, model: HostedModel, api_key: str):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.key = provider.key
        self.model_id = model.id
        # Joins the generated-state hash: switching from the local
        # narrator to a hosted one marks the whole book stale, which is
        # exactly right -- the print pass IS a deliberate full rerender.
        self.engine_version = f"{provider.key}:{model.id}"

    def synthesize(self, text: str, voice_id: str,
                   speed: float = 1.0) -> tuple[bytes, float]:
        payload: dict = {
            "model": self.model.id,
            "voice": voice_id,
            "input": text,
            "response_format": "wav",
        }
        # Models without a speed control get time-stretched at assembly
        # instead; sending the field anyway risks a 400 (spec 15).
        if self.model.supports_speed and speed != 1.0:
            payload["speed"] = round(speed, 3)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            **self.provider.extra_headers,
        }
        url = f"{self.provider.base_url}{self.provider.speech_path}"
        try:
            with httpx.Client(timeout=_TIMEOUT) as client:
                response = client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException:
            raise SynthesisError(
                f"{self.provider.label} timed out on this segment. Retrying.",
                retryable=True)
        except httpx.RequestError as e:
            raise SynthesisError(
                f"Could not reach {self.provider.label}: {e}", retryable=True)

        if response.status_code != 200:
            raise _translate(self.provider, response.status_code, response.text)

        audio = _fold_to_mono_16bit(response.content)
        return audio, _wav_seconds(audio)


def make_backend(provider_key: str, model_id: str, api_key: str) -> CloudSpeechBackend:
    """Build a hosted backend, refusing clearly when the key is missing --
    a run must never start only to fail on every segment."""
    provider, model = resolve_model(provider_key, model_id)
    if not api_key.strip():
        raise ValueError(
            f"No {provider.label} API key saved. Add one in Settings "
            f"(get a key at {provider.key_hint}), or narrate free with the "
            "local narrator."
        )
    return CloudSpeechBackend(provider, model, api_key.strip())
