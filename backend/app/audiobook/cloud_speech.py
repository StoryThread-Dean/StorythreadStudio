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


def _looks_like_mp3(raw: bytes) -> bool:
    """
    Sniff mp3 without trusting the content-type header.

    Two signatures cover everything in practice: an ID3 tag at the front,
    or an MPEG frame sync (11 set bits -- 0xFF then the top three bits of
    the next byte). Cheap, and it catches a provider that answers mp3
    while labelling it something else.
    """
    if len(raw) < 3:
        return False
    if raw[:3] == b"ID3":
        return True
    return raw[0] == 0xFF and (raw[1] & 0xE0) == 0xE0


def _decode_mp3(raw: bytes, provider_label: str) -> bytes:
    """
    mp3 -> 16-bit mono WAV, if this build can do it.

    The stdlib cannot decode mp3, so this needs a real audio library.
    miniaudio ships with the app for the job -- a single 268 KB wheel with
    nothing behind it, chosen over soundfile precisely because soundfile
    drags numpy along and this whole backend gets frozen into a sidecar.
    soundfile is still tried second: a developer who happens to have it
    should not be blocked if miniaudio ever fails to load on some machine.

    Decoding straight to 24 kHz MONO is deliberate. That is the shape the
    rest of the pipeline assumes -- flow synthesis measures durations on
    it and the stitcher concatenates frames of it -- so the conversion
    happens once, here, rather than being discovered later as a mismatch.
    """
    if not raw:
        raise SynthesisError(
            "The narration service returned no audio for this passage.",
            retryable=True)

    try:
        import miniaudio  # type: ignore[import-not-found]

        decoded = miniaudio.decode(raw, nchannels=1, sample_rate=24000)
        return _wrap_pcm(decoded.samples.tobytes(), decoded.sample_rate)
    except ImportError:
        pass
    except Exception as e:
        # NOT retryable. Bytes that will not decode are a format
        # incompatibility, not a hiccup, and every retry on a paid engine
        # spends real money to fail the same way.
        raise SynthesisError(
            f"{provider_label} returned audio in a format this build could "
            f"not decode: {e}",
            retryable=False)

    # libsndfile decodes mp3 from 1.1 onward; soundfile bundles it.
    try:
        import io as _io

        import soundfile  # type: ignore[import-not-found]

        samples, rate = soundfile.read(_io.BytesIO(raw), dtype="int16",
                                       always_2d=True)
        mono = samples[:, 0] if samples.shape[1] > 1 else samples.reshape(-1)
        return _wrap_pcm(mono.tobytes(), int(rate))
    except ImportError:
        pass
    except Exception as e:
        # NOT retryable. Bytes that will not decode are a format
        # incompatibility, not a hiccup, and every retry on a paid engine
        # spends real money to fail the same way.
        raise SynthesisError(
            f"{provider_label} returned audio in a format this build could "
            f"not decode: {e}",
            retryable=False)

    raise SynthesisError(
        f"{provider_label} answered with mp3 and no mp3 decoder could be "
        "loaded, so the audio cannot be stitched into a chapter. This "
        "should not happen in a normal install -- please report it. In "
        "the meantime, every other engine on the shelf speaks PCM.",
        retryable=False)


def _wrap_pcm(raw: bytes, sample_rate: int) -> bytes:
    """
    Raw 16-bit little-endian mono PCM -> a real WAV file.

    OpenRouter answers /audio/speech with `mp3` or `pcm` ONLY -- there is
    no wav option (checked 2026-07-31). Asking for mp3 would drag ffmpeg
    into every segment just to get samples back, so we take pcm and put
    the 44-byte header on ourselves. PCM at this layer is already the
    shape the rest of the pipeline wants: 16-bit mono, which is what flow
    synthesis and the stdlib stitcher require.
    """
    if not raw:
        raise SynthesisError(
            "The narration service returned no audio for this passage.",
            retryable=True)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        # An odd byte count would mean a truncated sample; drop the stray
        # byte rather than writing a malformed frame.
        out.writeframes(raw[: len(raw) - (len(raw) % 2)])
    return buffer.getvalue()


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


def _translate(provider: TtsProviderConfig, status: int, body: str,
               model_id: str = "", voice_id: str = "") -> SynthesisError:
    """One place where every hosted failure becomes a writer-facing
    sentence with the right retry verdict."""
    tail = f" The service said: {body.strip()[:200]}" if body.strip() else ""
    named = ""
    if model_id or voice_id:
        parts = [p for p in (model_id and f"model {model_id}",
                             voice_id and f"voice {voice_id}") if p]
        named = f" (asked for {' with '.join(parts)})"
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
        # Nearly always the VOICE rather than the model: a provider's
        # integration can lag behind the voice roster its own engine
        # publishes, and it answers 404 for an id it has not picked up.
        return SynthesisError(
            f"{provider.label} rejected that voice or model as unknown"
            f"{named}. Try another voice from the list, or pick a different "
            f"engine in Audiobook Settings.{tail}",
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

    def _body(self, text: str, voice_id: str, speed: float) -> dict:
        """The request body for this provider's transport. The two hosted
        services do NOT share one: OpenRouter speaks the OpenAI-compatible
        /audio/speech, NanoGPT has its own /api/tts."""
        if self.provider.transport == "nanogpt-tts":
            body: dict = {"model": self.model.id, "text": text}
            if voice_id:
                body["voice"] = voice_id
            if self.model.supports_speed and speed != 1.0:
                body["speed"] = round(speed, 3)
            return body

        body = {
            "model": self.model.id,
            "input": text,
            # Per MODEL, not a constant. OpenRouter offers mp3 and pcm and
            # no wav, and which of the two a model accepts depends on the
            # vendor behind it -- Mistral rejects pcm outright with a 400.
            # pcm is the house default because we can header it ourselves.
            "response_format": self.model.response_format,
        }
        if voice_id:
            body["voice"] = voice_id
        # Models without a speed control get time-stretched at assembly
        # instead; sending the field anyway risks a 400 (spec 15).
        if self.model.supports_speed and speed != 1.0:
            body["speed"] = round(speed, 3)
        return body

    def _read_audio(self, response: httpx.Response) -> bytes:
        """Provider answer -> 16-bit mono WAV bytes."""
        content_type = (response.headers.get("content-type") or "").lower()

        # NanoGPT may answer with JSON carrying a URL to the audio rather
        # than the bytes themselves.
        if "application/json" in content_type:
            try:
                payload = response.json()
            except ValueError:
                raise SynthesisError(
                    f"{self.provider.label} returned an unreadable response.",
                    retryable=True)
            url = (payload.get("audio_url") or payload.get("url")
                   or payload.get("audio"))
            if not isinstance(url, str) or not url.startswith("http"):
                raise SynthesisError(
                    f"{self.provider.label} returned no audio for this "
                    f"passage: {str(payload)[:200]}",
                    retryable=False)
            try:
                with httpx.Client(timeout=_TIMEOUT) as client:
                    fetched = client.get(url)
            except httpx.RequestError as e:
                raise SynthesisError(
                    f"Could not download the narrated audio: {e}", retryable=True)
            if fetched.status_code != 200:
                raise _translate(self.provider, fetched.status_code, fetched.text)
            # A hosted file behind a URL is very often mp3 -- that is what
            # the format is FOR. Sniff it here too, or this branch would
            # be the one place a compressed answer slipped through.
            if _looks_like_mp3(fetched.content):
                return _decode_mp3(fetched.content, self.provider.label)
            return _fold_to_mono_16bit(fetched.content)

        # Compressed answers must be decoded before anything downstream can
        # touch them: flow synthesis measures durations and cuts on sample
        # boundaries, and the stitcher concatenates raw frames. Wrapping
        # mp3 bytes in a WAV header would produce a file that "plays" as
        # noise, so this is checked BEFORE the pcm path.
        if _looks_like_mp3(response.content) or "audio/mpeg" in content_type \
                or self.model.response_format == "mp3":
            return _decode_mp3(response.content, self.provider.label)

        if "audio/l16" in content_type or "audio/pcm" in content_type \
                or self.provider.transport == "openai-speech":
            # Raw samples: 24 kHz is the OpenAI-compatible default and what
            # Kokoro itself produces.
            return _wrap_pcm(response.content, 24000)
        return _fold_to_mono_16bit(response.content)

    def synthesize(self, text: str, voice_id: str,
                   speed: float = 1.0) -> tuple[bytes, float]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            **self.provider.extra_headers,
        }
        url = f"{self.provider.base_url}{self.provider.speech_path}"
        try:
            with httpx.Client(timeout=_TIMEOUT) as client:
                response = client.post(
                    url, json=self._body(text, voice_id, speed), headers=headers)
        except httpx.TimeoutException:
            raise SynthesisError(
                f"{self.provider.label} timed out on this segment. Retrying.",
                retryable=True)
        except httpx.RequestError as e:
            raise SynthesisError(
                f"Could not reach {self.provider.label}: {e}", retryable=True)

        if response.status_code != 200:
            raise _translate(self.provider, response.status_code, response.text,
                             self.model.id, voice_id)

        audio = self._read_audio(response)
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
