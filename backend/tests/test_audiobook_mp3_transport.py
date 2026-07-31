# test_audiobook_mp3_transport.py
# ===============================
# Hosted speech engines do not agree on an audio format, and the app found
# that out the expensive way: an audition of Mistral's Voxtral came back
#
#   400 -- Mistral TTS only supports response_format="mp3". Got "pcm".
#
# because the OpenAI-speech transport had "pcm" hard-coded. The format is
# now a property of the MODEL, and mp3 answers are decoded rather than
# blindly given a WAV header -- which would have produced a chapter of
# noise that plays, costs money, and fails no check.
#
# The tests below pin the three things that keeps honest:
#   1. Each model asks for the format it actually accepts.
#   2. Real mp3 bytes decode to real 16-bit mono WAV.
#   3. mp3 is recognised from its BYTES, so a mislabelled answer still
#      takes the decoder path instead of the raw-samples path.

import io
import wave
from pathlib import Path

from app.audiobook import cloud_speech
from app.audiobook.tts_providers import resolve_model

FIXTURE = Path(__file__).parent / "fixtures" / "tone-24k-mono.mp3"


def _backend(model_id: str, provider_key: str = "openrouter"):
    provider, model = resolve_model(provider_key, model_id)
    return cloud_speech.CloudSpeechBackend(provider, model, "sk-test")


def test_each_model_asks_for_the_format_it_accepts():
    # Voxtral refuses pcm outright. Everything else on OpenRouter takes it,
    # and pcm is what we want: raw frames we can header with the stdlib.
    voxtral = _backend("mistralai/voxtral-mini-tts-2603")
    assert voxtral._body("hello", "gb_jane_neutral", 1.0)["response_format"] == "mp3"

    for model_id in ("hexgrad/kokoro-82m", "x-ai/grok-voice-tts-1.0",
                     "deepgram/aura-2"):
        body = _backend(model_id)._body("hello", "", 1.0)
        assert body["response_format"] == "pcm", model_id


def test_mp3_answers_decode_to_16_bit_mono_wav():
    # A real mp3 file, not a mock: the failure this guards against is a
    # decoder that silently returns the wrong shape.
    wav = cloud_speech._decode_mp3(FIXTURE.read_bytes(), "OpenRouter")
    with wave.open(io.BytesIO(wav), "rb") as f:
        assert f.getnchannels() == 1
        assert f.getsampwidth() == 2          # 16-bit
        assert f.getframerate() == 24000
        frames = f.readframes(f.getnframes())
    # ~0.3s of tone, and audibly NOT silence -- a decoder that hands back
    # zeros would satisfy every assertion above.
    assert f.getnframes() > 6000
    assert any(frames[i:i + 2] != b"\x00\x00" for i in range(0, 400, 2))


def test_mp3_is_recognised_from_its_bytes_not_the_content_type():
    # Providers mislabel. Sniffing the frame sync means a wrong header
    # cannot route mp3 into _wrap_pcm, where it would become noise.
    raw = FIXTURE.read_bytes()
    assert cloud_speech._looks_like_mp3(raw) is True
    assert cloud_speech._looks_like_mp3(b"ID3\x04\x00rest of a tagged file") is True
    # Raw PCM samples must NOT be mistaken for mp3, or every working
    # engine would be routed into the decoder.
    assert cloud_speech._looks_like_mp3(b"\x00\x01\x02\x03" * 8) is False
    assert cloud_speech._looks_like_mp3(b"") is False


def test_mp3_behind_a_json_url_is_decoded_too(restore_httpx=None):
    # NanoGPT can answer with JSON pointing at a hosted file, and a hosted
    # audio file is very often mp3 -- that is what the format is for. This
    # branch used to be the one place a compressed answer slipped through
    # to the WAV reader.
    import httpx

    mp3_bytes = FIXTURE.read_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).endswith(".mp3"):
            return httpx.Response(200, content=mp3_bytes,
                                  headers={"content-type": "audio/mpeg"})
        return httpx.Response(
            200, json={"audio_url": "https://cdn.example.com/clip.mp3"},
            headers={"content-type": "application/json"})

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    class Patched(real_client):  # type: ignore[misc,valid-type]
        def __init__(self, *a, **kw):
            kw["transport"] = transport
            super().__init__(*a, **kw)

    httpx.Client = Patched  # type: ignore[misc]
    try:
        backend = _backend("Elevenlabs-Turbo-V2.5", "nanogpt")
        audio, duration = backend.synthesize("Hi.", "rachel")
    finally:
        httpx.Client = real_client  # type: ignore[misc]

    with wave.open(io.BytesIO(audio), "rb") as f:
        assert f.getnchannels() == 1
        assert f.getsampwidth() == 2
    assert duration > 0.2


def test_empty_audio_is_a_retryable_failure_not_a_zero_length_file():
    # An empty answer is a hiccup, not a corrupt book -- it must retry
    # rather than write a 0-second segment and call the chapter done.
    try:
        cloud_speech._decode_mp3(b"", "OpenRouter")
    except cloud_speech.SynthesisError as e:
        assert e.retryable is True
    else:
        raise AssertionError("empty mp3 should raise")
