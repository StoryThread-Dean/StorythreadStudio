# audiobook/tts_providers.py -- the hosted narration catalog (spec 13/16).
# =========================================================================
# The local narrator is free and unlimited, and it is what every book gets
# drafted with. This module is the OTHER side: hosted voices for the print
# pass, and -- more importantly -- the honest PRICE of using them.
#
# Two shapes of provider, both OpenAI-compatible over POST /audio/speech:
#
#   nanogpt   hosts the SAME Kokoro model and voices as the local engine
#             (about a dollar per thousand thousand characters -- pennies
#             for a novel), plus premium ElevenLabs voices.
#   openrouter  a spread of premium voices from several labs.
#
# The pricing here is what the writer is shown BEFORE anything is spent
# (spec 19: never auto-spend). It is deliberately conservative: prices are
# per 1,000 characters of PAYLOAD text, the same text the engine receives,
# and an estimate always rounds UP to the next cent. A quote that comes in
# a little high is a good surprise; the other direction is not.
#
# Prices are a published-rate SNAPSHOT (2026-07). They are shown as
# estimates, never as invoices, and every provider is asked to confirm its
# own charge at run time where its API reports one.

from dataclasses import dataclass, field
from decimal import ROUND_CEILING, Decimal


@dataclass(frozen=True)
class HostedVoice:
    """One curated voice. Dynamic voice discovery barely exists for TTS
    (spec 16.2), so these catalogs are hand-kept."""

    id: str
    label: str
    language: str = "en-US"
    gender_presentation: str = "other"


@dataclass(frozen=True)
class HostedModel:
    """One hosted narration model: what it costs and who can speak it."""

    id: str                       # the provider's model slug
    label: str                    # user-facing name
    price_per_1k_chars: str       # Decimal-safe string, USD
    voices: tuple[HostedVoice, ...]
    # Kokoro hosted remotely is the same engine as the local narrator, so
    # a draft made here sounds like the free draft. Flagged so the UI can
    # say "same voices as your free narrator".
    same_as_local: bool = False
    # Whether the model honors a speed parameter. Everything else gets
    # time-stretched at assembly instead (the [pace] contract is universal).
    supports_speed: bool = True
    notes: str = ""


@dataclass(frozen=True)
class TtsProviderConfig:
    """A hosted narration service."""

    key: str                      # stable id ("nanogpt" | "openrouter")
    label: str
    base_url: str                 # no trailing slash
    speech_path: str              # appended for the synthesis call
    api_key_setting: str          # settings_store key holding the API key
    key_hint: str                 # where to get a key / add funds
    models: tuple[HostedModel, ...] = ()
    extra_headers: dict[str, str] = field(default_factory=dict)


# The 54 local Kokoro voices are the local engine's business; hosted
# Kokoro exposes the same family, so the catalog here lists the handful
# worth offering as narrators rather than all of them.
_KOKORO_VOICES = (
    HostedVoice("af_heart", "Heart (American female)", "en-US", "female"),
    HostedVoice("af_bella", "Bella (American female)", "en-US", "female"),
    HostedVoice("am_michael", "Michael (American male)", "en-US", "male"),
    HostedVoice("am_adam", "Adam (American male)", "en-US", "male"),
    HostedVoice("bf_emma", "Emma (British female)", "en-GB", "female"),
    HostedVoice("bm_george", "George (British male)", "en-GB", "male"),
)

_ELEVEN_VOICES = (
    HostedVoice("rachel", "Rachel (warm, narrative)", "en-US", "female"),
    HostedVoice("adam", "Adam (deep, narrative)", "en-US", "male"),
    HostedVoice("antoni", "Antoni (well-rounded)", "en-US", "male"),
    HostedVoice("bella", "Bella (soft, young)", "en-US", "female"),
)

_OPENAI_TTS_VOICES = (
    HostedVoice("alloy", "Alloy (neutral)", "en-US", "other"),
    HostedVoice("echo", "Echo (measured male)", "en-US", "male"),
    HostedVoice("fable", "Fable (expressive, British)", "en-GB", "other"),
    HostedVoice("onyx", "Onyx (deep male)", "en-US", "male"),
    HostedVoice("nova", "Nova (bright female)", "en-US", "female"),
    HostedVoice("shimmer", "Shimmer (gentle female)", "en-US", "female"),
)

NANOGPT = TtsProviderConfig(
    key="nanogpt",
    label="NanoGPT",
    base_url="https://nano-gpt.com/api/v1",
    speech_path="/audio/speech",
    api_key_setting="nanogpt_api_key",
    key_hint="nano-gpt.com",
    models=(
        HostedModel(
            id="kokoro-82m",
            label="Kokoro 82M (hosted)",
            price_per_1k_chars="0.001",
            voices=_KOKORO_VOICES,
            same_as_local=True,
            notes="The same engine and voices as your free local narrator, "
                  "rented by the character. Useful for drafting on a "
                  "machine that cannot install the local narrator.",
        ),
        HostedModel(
            id="elevenlabs-turbo",
            label="ElevenLabs Turbo",
            price_per_1k_chars="0.06",
            voices=_ELEVEN_VOICES,
            supports_speed=False,
            notes="Premium narration performance. The print-pass voice.",
        ),
    ),
)

OPENROUTER = TtsProviderConfig(
    key="openrouter",
    label="OpenRouter",
    base_url="https://openrouter.ai/api/v1",
    speech_path="/audio/speech",
    api_key_setting="openrouter_api_key",
    key_hint="openrouter.ai",
    extra_headers={
        "HTTP-Referer": "http://localhost:1420",
        "X-Title": "Storythread Studio",
    },
    models=(
        HostedModel(
            id="openai/gpt-4o-mini-tts",
            label="GPT-4o Mini TTS",
            price_per_1k_chars="0.015",
            voices=_OPENAI_TTS_VOICES,
            notes="Natural, steady narration at a moderate price.",
        ),
    ),
)

PROVIDERS: dict[str, TtsProviderConfig] = {
    NANOGPT.key: NANOGPT,
    OPENROUTER.key: OPENROUTER,
}


def resolve_model(provider_key: str, model_id: str) -> tuple[TtsProviderConfig, HostedModel]:
    """(provider, model) for a pair of ids, or ValueError with a
    writer-facing message."""
    provider = PROVIDERS.get(provider_key)
    if provider is None:
        raise ValueError(f"Unknown narration provider '{provider_key}'.")
    for model in provider.models:
        if model.id == model_id:
            return provider, model
    names = ", ".join(m.id for m in provider.models)
    raise ValueError(
        f"{provider.label} has no narration model '{model_id}'. Available: {names}."
    )


def catalog() -> list[dict]:
    """The whole hosted catalog as plain data for the UI, prices included."""
    return [
        {
            "provider": provider.key,
            "provider_label": provider.label,
            "key_hint": provider.key_hint,
            "api_key_setting": provider.api_key_setting,
            "models": [
                {
                    "id": model.id,
                    "label": model.label,
                    "price_per_1k_chars": model.price_per_1k_chars,
                    "same_as_local": model.same_as_local,
                    "supports_speed": model.supports_speed,
                    "notes": model.notes,
                    "voices": [
                        {"id": v.id, "label": v.label, "language": v.language,
                         "gender_presentation": v.gender_presentation}
                        for v in model.voices
                    ],
                }
                for model in provider.models
            ],
        }
        for provider in PROVIDERS.values()
    ]


def estimate_print(workspace_path: str, provider_key: str, model_id: str) -> dict:
    """
    What a print pass over this workspace would cost, counted from the
    REAL payload text (pronunciation rules and [say] overrides applied,
    excluded spans already gone) of every segment in the selected
    chapters.

    A print pass is a full rerender by definition -- the voice and engine
    both change, which marks every segment stale -- so this counts
    everything rather than guessing at what is current.
    """
    from app.audiobook import pronunciation, segmenter, workspace as workspace_mod

    provider, model = resolve_model(provider_key, model_id)
    manifest = segmenter.load_segments(workspace_path)
    if manifest is None:
        return {
            "provider": provider.key, "provider_label": provider.label,
            "model": model.id, "model_label": model.label,
            "characters": 0, "segments": 0, "chapters": 0,
            "price_per_1k_chars": model.price_per_1k_chars,
            "estimate_usd": "0.00",
            "note": "Nothing to print yet -- save the narration once first.",
        }

    selected = {c["chapter_id"] for c in workspace_mod.list_chapters(workspace_path)
                if c.get("selected_for_generation", True)}
    rules = pronunciation.effective_rules(workspace_path)
    characters = 0
    segments = 0
    chapters = 0
    for chapter in manifest["chapters"]:
        if chapter["chapter_id"] not in selected:
            continue
        counted_here = False
        for item in chapter["items"]:
            if item.get("kind") != "segment":
                continue
            characters += len(pronunciation.prepare_tts_text(item["text"], rules))
            segments += 1
            counted_here = True
        if counted_here:
            chapters += 1

    return {
        "provider": provider.key, "provider_label": provider.label,
        "model": model.id, "model_label": model.label,
        "characters": characters, "segments": segments, "chapters": chapters,
        "price_per_1k_chars": model.price_per_1k_chars,
        "estimate_usd": estimate_cost_usd(characters, provider_key, model_id),
        "note": "",
    }


def estimate_cost_usd(characters: int, provider_key: str, model_id: str) -> str:
    """
    What printing `characters` of payload text would cost, as a decimal
    string of dollars, ALWAYS rounded up to the next cent. Free is "0.00"
    only when there is genuinely nothing to charge for.
    """
    _provider, model = resolve_model(provider_key, model_id)
    if characters <= 0:
        return "0.00"
    per_1k = Decimal(model.price_per_1k_chars)
    raw = per_1k * Decimal(characters) / Decimal(1000)
    # Round UP: a quote must never come in under the real charge.
    return str(raw.quantize(Decimal("0.01"), rounding=ROUND_CEILING))
