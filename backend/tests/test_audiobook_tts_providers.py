# tests/test_audiobook_tts_providers.py
# ======================================
# The hosted narration layer: the catalog and its PRICES, the print-pass
# estimator (money the writer is shown before a cent is spent), and the
# cloud synthesis backend behind the same seam as the local narrator --
# including that its failures are classified correctly, because a
# retryable verdict on a billing error would charge twice for nothing.

import io
import json
import wave

import httpx
import pytest
from fastapi.testclient import TestClient

from app import settings_store
from app.audiobook import cloud_speech, pronunciation, recents_store, tts_providers
from app.audiobook.synthesis import SynthesisError
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH", tmp_path / "gp.json")
    # Never read or write the real settings file (house rule).
    monkeypatch.setattr(settings_store, "SETTINGS_DIR", tmp_path / "st")
    monkeypatch.setattr(settings_store, "SETTINGS_FILE", tmp_path / "st" / "settings.json")
    monkeypatch.setattr(settings_store, "SETTINGS_BACKUP", tmp_path / "st" / "settings.json.bak")
    monkeypatch.setattr(settings_store, "SETTINGS_TMP", tmp_path / "st" / "settings.json.tmp")


def _wav(seconds: float, channels: int = 1, width: int = 2, rate: int = 24000) -> bytes:
    frames = int(rate * seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x11\x22" * frames * channels)
    return buffer.getvalue()


# ── The catalog and its prices ────────────────────────────────────────────────

def test_catalog_exposes_models_prices_and_voices():
    entries = {e["provider"]: e for e in tts_providers.catalog()}
    assert set(entries) == {"nanogpt", "openrouter"}

    kokoro = next(m for m in entries["nanogpt"]["models"] if m["id"] == "kokoro-82m")
    # Hosted Kokoro is the SAME engine as the free local narrator, and
    # the UI needs to be able to say so.
    assert kokoro["same_as_local"] is True
    assert kokoro["price_per_1k_chars"] == "0.001"
    assert any(v["id"] == "af_heart" for v in kokoro["voices"])

    eleven = next(m for m in entries["nanogpt"]["models"] if m["id"] == "elevenlabs-turbo")
    assert eleven["same_as_local"] is False
    assert eleven["supports_speed"] is False        # time-stretched instead


def test_unknown_provider_or_model_says_what_exists():
    with pytest.raises(ValueError, match="Unknown narration provider"):
        tts_providers.resolve_model("madeup", "x")
    with pytest.raises(ValueError, match="Available:"):
        tts_providers.resolve_model("nanogpt", "not-a-model")


def test_estimates_round_UP_to_the_next_cent():
    # A whole novel through hosted Kokoro is pennies: 500k chars at
    # $0.001/1k = $0.50.
    assert tts_providers.estimate_cost_usd(500_000, "nanogpt", "kokoro-82m") == "0.50"
    # Premium is the meaningfully-more tier: 500k at $0.06/1k = $30.
    assert tts_providers.estimate_cost_usd(500_000, "nanogpt", "elevenlabs-turbo") == "30.00"
    # Never quote under the real charge: 1 char still costs a cent.
    assert tts_providers.estimate_cost_usd(1, "nanogpt", "kokoro-82m") == "0.01"
    assert tts_providers.estimate_cost_usd(0, "nanogpt", "kokoro-82m") == "0.00"


# ── The estimator over a real workspace ──────────────────────────────────────

def _workspace(tmp_path) -> str:
    src = tmp_path / "b.md"
    src.write_text(
        "# One\n\nFirst chapter prose here.\n\n"
        "# Two\n\n[say:KAY-lith]Kaelith[/say] spoke.\n",
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "T"})
    assert response.status_code == 200, response.text
    return str(ws)


def test_print_estimate_counts_the_real_payload_text(tmp_path):
    ws = _workspace(tmp_path)
    body = client.get("/api/audiobook/print-estimate", params={
        "workspace_path": ws, "provider": "nanogpt", "model": "kokoro-82m"}).json()

    assert body["segments"] == 2
    assert body["chapters"] == 2
    # The [say] markup is NOT what gets billed -- the spoken form is.
    assert body["characters"] == len("First chapter prose here.") + len("kaylith spoke.")
    assert body["estimate_usd"] == "0.01"
    assert body["model_label"] == "Kokoro 82M (hosted)"


def test_print_estimate_before_any_narration_is_saved_says_so(tmp_path):
    from app.audiobook import workspace as workspace_mod
    ws = tmp_path / "empty"
    workspace_mod.create_workspace_dirs(str(ws))
    workspace_mod.save_manifest(str(ws), workspace_mod.new_manifest(str(ws), "T", "", ""))
    body = client.get("/api/audiobook/print-estimate", params={
        "workspace_path": str(ws), "provider": "nanogpt", "model": "kokoro-82m"}).json()
    assert body["characters"] == 0
    assert body["estimate_usd"] == "0.00"
    assert "Nothing to print yet" in body["note"]


def test_catalog_endpoint_reports_whether_a_key_is_saved(tmp_path):
    empty = {e["provider"]: e for e in
             client.get("/api/audiobook/tts-catalog").json()["providers"]}
    assert empty["nanogpt"]["has_api_key"] is False

    settings = settings_store.load_settings()
    settings["nanogpt_api_key"] = "sk-test"
    settings_store.save_settings(settings)
    saved = {e["provider"]: e for e in
             client.get("/api/audiobook/tts-catalog").json()["providers"]}
    assert saved["nanogpt"]["has_api_key"] is True


# ── The cloud backend behind the seam ────────────────────────────────────────

# The pristine class, captured before any test patches it. Every patch
# subclasses THIS -- patching the already-patched class made a second
# handler in one test silently reuse the first one's transport.
_PRISTINE_CLIENT = httpx.Client


def _route_httpx(handler) -> None:
    """Send every httpx.Client request to `handler` (restored by the
    restore_httpx fixture)."""
    transport = httpx.MockTransport(handler)

    class PatchedClient(_PRISTINE_CLIENT):     # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    httpx.Client = PatchedClient


def _backend(handler, provider_key: str = "nanogpt",
             model_id: str = "kokoro-82m") -> cloud_speech.CloudSpeechBackend:
    """A hosted backend whose HTTP layer is a local handler."""
    provider, model = tts_providers.resolve_model(provider_key, model_id)
    _route_httpx(handler)
    return cloud_speech.CloudSpeechBackend(provider, model, "sk-test")


@pytest.fixture
def restore_httpx():
    yield
    httpx.Client = _PRISTINE_CLIENT


def test_synthesize_sends_the_payload_and_returns_audio(restore_httpx):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=_wav(1.5))

    backend = _backend(handler)
    audio, duration = backend.synthesize("Hello there.", "af_heart", 0.9)

    assert seen["url"] == "https://nano-gpt.com/api/v1/audio/speech"
    assert seen["auth"] == "Bearer sk-test"
    assert seen["body"]["model"] == "kokoro-82m"
    assert seen["body"]["voice"] == "af_heart"
    assert seen["body"]["input"] == "Hello there."
    assert seen["body"]["speed"] == 0.9          # Kokoro honors speed
    assert seen["body"]["response_format"] == "wav"
    assert duration == pytest.approx(1.5, abs=0.01)
    assert audio[:4] == b"RIFF"
    # The engine identity carries the provider AND model, so switching to
    # a hosted voice marks every segment stale (the print pass).
    assert backend.engine_version == "nanogpt:kokoro-82m"


def test_speed_is_withheld_from_models_that_lack_it(restore_httpx):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=_wav(1.0))

    backend = _backend(handler, "nanogpt", "elevenlabs-turbo")
    backend.synthesize("Hello.", "rachel", 0.8)
    assert "speed" not in seen["body"]           # would 400 on this model


def test_stereo_answers_are_folded_to_mono(restore_httpx):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_wav(1.0, channels=2))

    audio, duration = _backend(handler).synthesize("Hi.", "af_heart")
    with wave.open(io.BytesIO(audio), "rb") as clip:
        assert clip.getnchannels() == 1          # flow synthesis needs mono
        assert clip.getsampwidth() == 2
    assert duration == pytest.approx(1.0, abs=0.02)


def test_non_wav_and_odd_bit_depth_fail_loudly(restore_httpx):
    def mp3(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"ID3\x04junk")

    with pytest.raises(SynthesisError, match="unexpected format") as caught:
        _backend(mp3).synthesize("Hi.", "af_heart")
    assert caught.value.retryable is False

    def eight_bit(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_wav(0.5, width=1))

    with pytest.raises(SynthesisError, match="8-bit"):
        _backend(eight_bit).synthesize("Hi.", "af_heart")


@pytest.mark.parametrize("status,retryable,needle", [
    (401, False, "rejected the API key"),
    (402, False, "insufficient credits"),
    (403, False, "content policy"),
    (404, False, "does not know that model"),
    (429, True, "rate limit"),
    (500, True, "server error"),
    (400, False, "rejected the request"),
])
def test_http_failures_are_classified_for_the_retry_cap(
        restore_httpx, status, retryable, needle):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="provider detail here")

    with pytest.raises(SynthesisError) as caught:
        _backend(handler).synthesize("Hi.", "af_heart")
    assert needle in str(caught.value)
    # THE money rule: billing and refusal errors must never auto-retry.
    assert caught.value.retryable is retryable


def test_timeouts_and_network_errors_retry(restore_httpx):
    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow")

    with pytest.raises(SynthesisError) as caught:
        _backend(timeout).synthesize("Hi.", "af_heart")
    assert caught.value.retryable is True


# ── Resolving a hosted backend at all ────────────────────────────────────────

def test_hosted_backend_refuses_without_a_saved_key():
    from app.audiobook import synthesis
    with pytest.raises(ValueError, match="No NanoGPT API key saved"):
        synthesis.resolve_backend("nanogpt", "kokoro-82m")


def test_hosted_backend_needs_a_model_choice():
    from app.audiobook import synthesis
    with pytest.raises(ValueError, match="Choose a NanoGPT narration model"):
        synthesis.resolve_backend("nanogpt")


def test_local_narrator_still_resolves_by_its_own_key(monkeypatch):
    from app.audiobook import local_worker, synthesis
    monkeypatch.setattr(local_worker, "make_backend",
                        lambda: "the-local-one")
    assert synthesis.resolve_backend("local-kokoro") == "the-local-one"
