# audiobook/tts_providers.py -- the hosted narration catalog (spec 13/16).
# =========================================================================
# The local narrator is free and unlimited, and it is what every book gets
# drafted with. This module is the OTHER side: hosted voices for the final
# pass, and -- more importantly -- the honest PRICE of using them.
#
# EVERY price and model id here is a PUBLISHED figure checked on
# 2026-07-31, not an estimate. Two things that research corrected, worth
# remembering because both were wrong in the first draft of this file:
#
#   1. OpenRouter hosts KOKORO ITSELF (hexgrad/kokoro-82m) at $0.62 per
#      MILLION characters with the same 54 preset voices as our local
#      narrator. So the cheap hosted tier is not a compromise: it is the
#      same engine and the same voice, rented, for about 35 cents a
#      novel. Voice parity with the local narrator is REAL on that tier,
#      and only the premium tiers have their own separate casts.
#   2. The two providers do NOT share a transport. OpenRouter speaks the
#      OpenAI-compatible /audio/speech; NanoGPT has its own /api/tts.
#      See cloud_speech.py.
#
# Prices are per 1,000 characters for the MATH (Decimal-safe strings) and
# per million for DISPLAY, because per-million is how providers quote and
# "$0.00062 per 1,000" reads like a rounding error. An estimate always
# rounds UP to the next cent: a quote that comes in a little high is a
# good surprise, the other direction is not.

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

    id: str                       # the provider's model slug, exactly
    label: str                    # user-facing name
    price_per_1k_chars: str       # Decimal-safe string, USD -- the MATH
    price_per_million_chars: str  # the same price as providers quote it
    voices: tuple[HostedVoice, ...]
    # Which shelf this sits on, so the picker can offer one honest choice
    # per budget instead of a wall of slugs. The FREE tier is the local
    # narrator itself and lives outside this catalog.
    tier: str = "standard"        # budget | standard | pro
    # PRICING/QUALITY copy: "the same engine as your free narrator, so it
    # sounds identical". Kept separate from voices_same_as_local because a
    # future hosted engine could match one without the other.
    same_as_local: bool = False
    # ROSTER TRUTH: this model speaks the local narrator's own voices, so
    # the picker should offer the live local list (54) instead of the
    # fallback below. This is what makes voice parity real.
    voices_same_as_local: bool = False
    # False when the provider does not publish its voice list. The UI then
    # offers a free-text voice field instead of inventing options.
    voices_verified: bool = True
    # Whether the model honors a speed parameter. Everything else gets
    # time-stretched at assembly instead (the [pace] contract is universal).
    supports_speed: bool = True
    notes: str = ""
    # OPTIONAL: when a model's voice id is composed from independent axes
    # (a voice, and separately an accent), declaring them here lets the UI
    # offer one short dropdown per axis instead of their cross product --
    # 26 voices and 3 accents rather than 78 rows. The STORED value stays
    # a single composed id, so nothing downstream changes.
    #
    # This is the shape to reach for as engines adopt universal voices with
    # accent/dialect as its own option; a model without axes keeps the
    # single flat list, so both kinds coexist.
    voice_axes: dict | None = None


@dataclass(frozen=True)
class TtsProviderConfig:
    """A hosted narration service."""

    key: str                      # stable id ("nanogpt" | "openrouter")
    label: str
    base_url: str                 # no trailing slash
    speech_path: str              # appended for the synthesis call
    transport: str                # "openai-speech" | "nanogpt-tts"
    api_key_setting: str          # settings_store key holding the API key
    key_hint: str                 # where to get a key / add funds
    # Plain steps shown when no key is connected. Narration-specific on
    # purpose: the writing side's provider copy talks about chat models.
    signup_steps: tuple[str, ...] = ()
    models: tuple[HostedModel, ...] = ()
    extra_headers: dict[str, str] = field(default_factory=dict)


# Only the OFFLINE FALLBACK. Hosted Kokoro speaks the local narrator's
# full roster (54 voices); this handful exists so a premium voice list
# still renders when the local engine is not installed to report the real
# one. Never treat this as the truth -- see voices_for().
_KOKORO_FALLBACK_VOICES = (
    HostedVoice("af_heart", "Heart (American female)", "en-US", "female"),
    HostedVoice("af_bella", "Bella (American female)", "en-US", "female"),
    HostedVoice("am_michael", "Michael (American male)", "en-US", "male"),
    HostedVoice("am_adam", "Adam (American male)", "en-US", "male"),
    HostedVoice("bf_emma", "Emma (British female)", "en-GB", "female"),
    HostedVoice("bm_george", "George (British male)", "en-GB", "male"),
)

# xAI's Grok Voice roster: 26 voices, each able to speak three dialects
# via the id suffix (-en-US / -en-GB / -en-AU).
#
# ONLY FIVE BARE NAMES ARE EXPOSED (see _GROK_DOCUMENTED below), and no
# dialect suffixes at all. Three live 404s settled it, in order:
#   iris-en-US  -> 404   (undocumented voice)
#   iris-en-GB  -> 404   (same voice, different accent)
#   ara-en-GB   -> 404   (a DOCUMENTED voice -- so it is the SUFFIX)
# OpenRouter's own Grok page lists exactly five voices, named without a
# suffix, and that is precisely what its integration accepts. The wider
# roster appears to be a newer or not-yet-public xAI build.
#
# The full table is kept here because it is real and hard-won. The day
# OpenRouter catches up, or the day xAI is added as a direct provider,
# widening the list is a one-line change to _GROK_DOCUMENTED -- and the
# accent axis can come back with it (see the note further down).
# (name, id stem, gender, character)
_GROK_BASE: tuple[tuple[str, str, str, str], ...] = (
    ("Altair", "altair", "male", "elegant, refined, effortlessly premium"),
    ("Ara", "ara", "female", "warm, natural, friendly"),
    ("Atlas", "atlas", "male", "confident, commanding, reassuring"),
    ("Carina", "carina", "female", "soft, empathetic, soothing"),
    ("Castor", "castor", "male", "charismatic, down-to-earth, easygoing"),
    ("Celeste", "celeste", "female", "compassionate, confident, reassuring"),
    ("Cosmo", "cosmo", "male", "bright, curious, easy to follow"),
    ("Eve", "eve", "female", "energetic, upbeat, dynamic"),
    ("Helios", "helios", "male", "upbeat, energetic, endlessly versatile"),
    ("Helix", "helix", "male", "bold, dynamic, adrenaline-fueled"),
    ("Iris", "iris", "female", "friendly, upbeat, naturally charming"),
    ("Kepler", "kepler", "male", "inventive, forward-thinking, charismatic"),
    ("Leo", "leo", "male", "authoritative, strong, impactful"),
    # Masculine per the roster count (7 feminine, 19 masculine) -- an
    # earlier transcription had this one as feminine.
    ("Lumen", "lumen", "male", "warm, articulate, engaging"),
    ("Luna", "luna", "female", "gentle, patient, deeply nurturing"),
    ("Lux", "lux", "male", "grounded, calm, quietly wise"),
    ("Naksh", "naksh", "male", "warm, thoughtful, wise"),
    ("Orion", "orion", "male", "rich, cinematic, resonant"),
    ("Perseus", "perseus", "male", "strong, confident, trustworthy"),
    ("Rex", "rex", "male", "confident, clear, direct"),
    ("Rigel", "rigel", "male", "precise, professional, calmly confident"),
    ("Sal", "sal", "male", "smooth, balanced, neutral"),
    ("Sirius", "sirius", "male", "quick-witted, clever, playful"),
    ("Ursa", "ursa", "female", "friendly, warm, steadfast"),
    ("Zagan", "zagan", "male", "powerful, dramatic, unmistakable"),
    ("Zenith", "zenith", "male", "sharp, focused, driven"),
)


# Deepgram's published Aura-2 English registry. Rows are
# (name, voice id, gender, language, accent label, character) -- the
# character words are Deepgram's own and they are the useful part when
# casting a narrator, so they ride in the label rather than being dropped.
_AURA2_ROWS: tuple[tuple[str, str, str, str, str, str], ...] = (
    ("Andromeda", "aura-2-andromeda-en", "male", "en-US", "American", "casual, expressive, comfortable"),
    ("Apollo", "aura-2-apollo-en", "male", "en-US", "American", "confident, comfortable, casual"),
    ("Arcas", "aura-2-arcas-en", "male", "en-US", "American", "natural, smooth, clear"),
    ("Aries", "aura-2-aries-en", "male", "en-US", "American", "warm, energetic, caring"),
    ("Asteria", "aura-2-asteria-en", "female", "en-US", "American", "clear, confident, knowledgeable"),
    ("Athena", "aura-2-athena-en", "female", "en-US", "American", "calm, smooth, professional"),
    ("Atlas", "aura-2-atlas-en", "male", "en-US", "American", "enthusiastic, confident, approachable"),
    ("Aurora", "aura-2-aurora-en", "female", "en-US", "American", "cheerful, expressive, energetic"),
    ("Callista", "aura-2-callista-en", "female", "en-US", "American", "clear, energetic, professional"),
    ("Cora", "aura-2-cora-en", "female", "en-US", "American", "smooth, melodic, caring"),
    ("Cordelia", "aura-2-cordelia-en", "female", "en-US", "American", "approachable, warm, polite"),
    ("Delia", "aura-2-delia-en", "female", "en-US", "American", "casual, friendly, cheerful, breathy"),
    ("Draco", "aura-2-draco-en", "male", "en-GB", "British", "warm, approachable, trustworthy, baritone"),
    ("Electra", "aura-2-electra-en", "female", "en-US", "American", "professional, engaging, knowledgeable"),
    ("Harmonia", "aura-2-harmonia-en", "female", "en-US", "American", "empathetic, clear, calm, confident"),
    ("Helena", "aura-2-helena-en", "female", "en-US", "American", "caring, natural, positive, raspy"),
    ("Hera", "aura-2-hera-en", "female", "en-US", "American", "smooth, warm, professional"),
    ("Hermes", "aura-2-hermes-en", "male", "en-US", "American", "expressive, engaging, professional"),
    ("Hyperion", "aura-2-hyperion-en", "male", "en-AU", "Australian", "caring, warm, empathetic"),
    ("Iris", "aura-2-iris-en", "female", "en-US", "American", "cheerful, positive, approachable"),
    ("Janus", "aura-2-janus-en", "male", "en-US", "American Southern", "smooth, trustworthy"),
    ("Juno", "aura-2-juno-en", "female", "en-US", "American", "natural, engaging, melodic, breathy"),
    ("Jupiter", "aura-2-jupiter-en", "male", "en-US", "American", "expressive, knowledgeable, baritone"),
    ("Luna", "aura-2-luna-en", "female", "en-US", "American", "friendly, natural, engaging"),
    ("Mars", "aura-2-mars-en", "male", "en-US", "American", "smooth, patient, trustworthy, baritone"),
    ("Minerva", "aura-2-minerva-en", "female", "en-US", "American", "positive, friendly, natural"),
    ("Neptune", "aura-2-neptune-en", "male", "en-US", "American", "professional, patient, polite"),
    ("Odysseus", "aura-2-odysseus-en", "male", "en-US", "American", "calm, smooth, comfortable, professional"),
    ("Ophelia", "aura-2-ophelia-en", "female", "en-US", "American", "expressive, enthusiastic, cheerful"),
    ("Orion", "aura-2-orion-en", "male", "en-US", "American", "approachable, comfortable, calm, polite"),
    ("Orpheus", "aura-2-orpheus-en", "male", "en-US", "American", "professional, clear, confident, trustworthy"),
    ("Pandora", "aura-2-pandora-en", "female", "en-GB", "British", "smooth, calm, melodic, breathy"),
    ("Phoebe", "aura-2-phoebe-en", "female", "en-US", "American", "energetic, warm, casual"),
    ("Pluto", "aura-2-pluto-en", "male", "en-US", "American", "smooth, calm, empathetic, baritone"),
    ("Saturn", "aura-2-saturn-en", "male", "en-US", "American", "knowledgeable, confident, baritone"),
    ("Thalia", "aura-2-thalia-en", "female", "en-US", "American", "clear, confident, energetic"),
    ("Theia", "aura-2-theia-en", "female", "en-AU", "Australian", "expressive, polite"),
    ("Zeus", "aura-2-zeus-en", "male", "en-US", "American", "deep, trustworthy, smooth"),
)

# Source rows stay alphabetical so they can be audited against a
# provider's page line by line. The ORDER WRITERS SEE is expressed here
# instead: accent group first (American, then British, then Australian),
# feminine before masculine inside each group, alphabetical within that.
# A dropdown of dozens of voices is only usable if it is grouped the way
# a person actually narrows one down.
_ACCENT_ORDER = ("American", "British", "Australian")
_GENDER_ORDER = ("female", "male")


def _voice_sort_key(row: tuple[str, str, str, str, str, str]) -> tuple[int, int, str]:
    name, _voice_id, gender, _language, accent, _character = row
    # "American Southern" sorts with the Americans, by prefix, rather than
    # becoming an orphan group of one.
    accent_rank = next(
        (i for i, group in enumerate(_ACCENT_ORDER) if accent.startswith(group)),
        len(_ACCENT_ORDER))
    gender_rank = (_GENDER_ORDER.index(gender) if gender in _GENDER_ORDER
                   else len(_GENDER_ORDER))
    return (accent_rank, gender_rank, name)


def _build_voices(
    rows: "list[tuple[str, str, str, str, str, str]] | tuple[tuple[str, str, str, str, str, str], ...]",
) -> tuple[HostedVoice, ...]:
    """
    Rows of (name, voice id, gender, language, accent, character) -> the
    grouped, labelled catalog. The character words are the provider's own
    and they are the useful part when casting a narrator, so they ride in
    the label rather than being dropped on the floor.
    """
    return tuple(
        HostedVoice(voice_id, f"{name} ({accent} {gender}) -- {character}",
                    language, gender)
        for name, voice_id, gender, language, accent, character
        in sorted(rows, key=_voice_sort_key)
    )


_AURA2_VOICES = _build_voices(_AURA2_ROWS)

# The five voices OpenRouter actually documents for Grok. Everything else
# in the roster above 404s through this provider.
_GROK_DOCUMENTED = ("Ara", "Eve", "Leo", "Rex", "Sal")

# Feminine before masculine, alphabetical within -- the same grouping as
# every other roster here, so the dropdowns all read the same way.
_GROK_EXPOSED = tuple(sorted(
    (row for row in _GROK_BASE if row[0] in _GROK_DOCUMENTED),
    key=lambda row: (_GENDER_ORDER.index(row[2])
                     if row[2] in _GENDER_ORDER else len(_GENDER_ORDER),
                     row[0])))

# The flat list: the documented names, accent-free, with their character
# words kept -- those are how a narrator gets cast.
_GROK_VOICES = tuple(
    HostedVoice(name, f"{name} ({gender}) -- {character}", "en-US", gender)
    for name, _stem, gender, character in _GROK_EXPOSED
)

# NO ACCENT AXIS. It was offered here for one commit and testing killed
# it: ara-en-GB -- a DOCUMENTED voice with a dialect suffix -- came back
# 404 exactly like iris-en-GB did. So OpenRouter's Grok integration takes
# bare names only, and an accent dropdown would have been a control that
# breaks whatever you pick. The two-axis machinery lives on in
# VoicePicker.tsx for the engines that will need it; this model simply
# does not declare axes.

# ElevenLabs' long-standing preset names. NanoGPT exposes 46 voices but
# does not publish the list, so these are offered as a starting point and
# the UI also accepts a typed voice name (voices_verified=False).
_ELEVEN_VOICES = (
    HostedVoice("Rachel", "Rachel (warm, narrative)", "en-US", "female"),
    HostedVoice("Adam", "Adam (deep, narrative)", "en-US", "male"),
    HostedVoice("Antoni", "Antoni (well-rounded)", "en-US", "male"),
    HostedVoice("Bella", "Bella (soft, young)", "en-US", "female"),
    HostedVoice("Josh", "Josh (young male)", "en-US", "male"),
    HostedVoice("Elli", "Elli (emotional)", "en-US", "female"),
)

OPENROUTER = TtsProviderConfig(
    key="openrouter",
    label="OpenRouter",
    base_url="https://openrouter.ai/api/v1",
    speech_path="/audio/speech",
    transport="openai-speech",
    api_key_setting="openrouter_api_key",
    key_hint="openrouter.ai",
    signup_steps=(
        "Create an account at openrouter.ai and add credit (pay per use, "
        "no subscription).",
        "Open Keys in your OpenRouter account and create an API key.",
        "Paste it below. Narration and writing can share one key or use "
        "separate ones.",
    ),
    extra_headers={
        "HTTP-Referer": "http://localhost:1420",
        "X-Title": "Storythread Studio",
    },
    models=(
        HostedModel(
            id="hexgrad/kokoro-82m",
            label="Kokoro 82M (hosted)",
            price_per_1k_chars="0.00062",
            price_per_million_chars="0.62",
            voices=_KOKORO_FALLBACK_VOICES,
            tier="budget",
            same_as_local=True,
            voices_same_as_local=True,
            notes="The same engine and the same 54 voices as your free "
                  "local narrator, rented by the character -- roughly 35 "
                  "cents for a whole novel. The one hosted tier that keeps "
                  "the voice you drafted with.",
        ),
        HostedModel(
            id="x-ai/grok-voice-tts-1.0",
            label="Grok Voice TTS",
            price_per_1k_chars="0.015",
            price_per_million_chars="15",
            voices=_GROK_VOICES,
            tier="standard",
            voices_verified=False,
            notes="Five voices, American only. xAI's own roster is wider (26 "
                  "voices, each able to speak British or Australian too), but "
                  "OpenRouter answers to these five bare names and nothing "
                  "else -- both the extra voices and the accent suffixes come "
                  "back 404. Tested, not guessed.",
        ),
        HostedModel(
            id="deepgram/aura-2",
            label="Deepgram Aura-2",
            price_per_1k_chars="0.030",
            price_per_million_chars="30",
            voices=_AURA2_VOICES,
            tier="pro",
            notes="Studio-grade narration with 38 English voices, each "
                  "with its own character -- American, British, "
                  "Australian, and one American Southern. Deepgram's own "
                  "descriptions ride in the voice names, so a narrator "
                  "can be cast by temperament rather than guessed at.",
        ),
    ),
)

NANOGPT = TtsProviderConfig(
    key="nanogpt",
    label="NanoGPT",
    base_url="https://nano-gpt.com",
    speech_path="/api/tts",
    transport="nanogpt-tts",
    api_key_setting="nanogpt_api_key",
    key_hint="nano-gpt.com",
    signup_steps=(
        "Create an account at nano-gpt.com and add funds (pay per "
        "character, no subscription).",
        "Copy your API key from the account page.",
        "Paste it below. NanoGPT carries both hosted Kokoro and the "
        "ElevenLabs premium voices.",
    ),
    models=(
        HostedModel(
            id="Kokoro-82m",
            label="Kokoro 82M (hosted)",
            price_per_1k_chars="0.001",
            price_per_million_chars="1",
            voices=_KOKORO_FALLBACK_VOICES,
            tier="budget",
            same_as_local=True,
            voices_same_as_local=True,
            notes="The same engine as your free local narrator, with 44 of "
                  "its voices, rented by the character.",
        ),
        HostedModel(
            id="Elevenlabs-Turbo-V2.5",
            label="ElevenLabs Turbo v2.5",
            price_per_1k_chars="0.06",
            price_per_million_chars="60",
            voices=_ELEVEN_VOICES,
            tier="pro",
            voices_verified=False,
            supports_speed=False,
            notes="Premium narration performance with 46 voices and style "
                  "controls -- the final-pass voice when the book is done.",
        ),
    ),
)

PROVIDERS: dict[str, TtsProviderConfig] = {
    NANOGPT.key: NANOGPT,
    OPENROUTER.key: OPENROUTER,
}

# The recommended shelf: one honest pick per budget, FREE first. The free
# entry is the local narrator, which is not a hosted model at all -- it
# leads the list in the SETTINGS engine chooser so the paid tiers read as
# a deliberate upgrade. (The rail's Premium Narration section never shows
# this shelf, so "free" never appears as an option inside "premium".)
TIER_ORDER = ("free", "budget", "standard", "pro")

TIER_LABELS = {
    "free":     "Free",
    "budget":   "Budget",
    "standard": "Standard",
    "pro":      "Pro",
}

TIER_BLURBS = {
    "free":     "Runs on your computer. Unlimited, private, costs nothing.",
    "budget":   "Pennies for a whole book, in the same voices as free.",
    "standard": "A step up in delivery for a few dollars a book.",
    "pro":      "Studio-grade narration performance. The final-pass voice.",
}

LOCAL_TIER_ENTRY = {
    "tier": "free",
    "tier_label": TIER_LABELS["free"],
    "blurb": TIER_BLURBS["free"],
    "provider": "local-kokoro",
    "provider_label": "Local narrator",
    "model": "",
    "model_label": "Kokoro 82M (on this computer)",
    "price_per_1k_chars": "0.000",
    "price_per_million_chars": "0",
    "same_as_local": True,
    "voices_same_as_local": True,
    "voices_verified": True,
    "requires_key": False,
    "signup_steps": [],
    "notes": "",
}


def recommended_tiers() -> list[dict]:
    """The engine shelf: free, budget, standard, pro, in that order."""
    entries: list[dict] = [dict(LOCAL_TIER_ENTRY)]
    for provider in PROVIDERS.values():
        for model in provider.models:
            entries.append({
                "tier": model.tier,
                "tier_label": TIER_LABELS.get(model.tier, model.tier.title()),
                "blurb": TIER_BLURBS.get(model.tier, ""),
                "provider": provider.key,
                "provider_label": provider.label,
                "model": model.id,
                "model_label": model.label,
                "price_per_1k_chars": model.price_per_1k_chars,
                "price_per_million_chars": model.price_per_million_chars,
                "same_as_local": model.same_as_local,
                "voices_same_as_local": model.voices_same_as_local,
                "voices_verified": model.voices_verified,
                "requires_key": True,
                "signup_steps": list(provider.signup_steps),
                "notes": model.notes,
            })
    entries.sort(key=lambda e: TIER_ORDER.index(e["tier"])
                 if e["tier"] in TIER_ORDER else len(TIER_ORDER))
    return entries


def narration_api_key(settings: dict, provider: TtsProviderConfig) -> str:
    """
    The key narration should use for this provider.

    Narration BORROWS the writing side's key by default (one key, nothing
    extra to set up -- and usually the same account anyway). A writer who
    wants them separate -- a premium drafting model on one account, cheap
    narration on another -- turns that off and fills the audiobook key,
    and then the writing key is deliberately NOT consulted: a silent
    fallback would spend on the wrong account.
    """
    if settings.get("audiobook_use_writing_keys", True):
        return str(settings.get(provider.api_key_setting) or "")
    return str(settings.get(f"audiobook_{provider.api_key_setting}") or "")


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


def voices_for(provider_key: str, model_id: str) -> tuple[list[dict], bool]:
    """
    (voices, is_fallback) for a hosted model.

    When the model speaks the local narrator's roster, ask the LOCAL
    ENGINE for the real list -- that is the whole voice-parity promise.
    A missing or unreachable local engine must never break a hosted voice
    list, so it falls back to the curated handful and says so; the premium
    path cannot be made to depend on the free path being installed.
    """
    _provider, model = resolve_model(provider_key, model_id)
    curated = [
        {"id": v.id, "label": v.label, "language": v.language,
         "gender_presentation": v.gender_presentation}
        for v in model.voices
    ]
    if not model.voices_same_as_local:
        return curated, False
    try:
        from app.audiobook import local_worker
        live = local_worker.list_voices()
        if live:
            return live, False
    except Exception:
        # Worker not installed, not running, or unreachable -- expected,
        # not exceptional. The curated list keeps the UI honest instead.
        pass
    return curated, True


def resolve_narration_selection(settings: dict, manifest: dict | None = None) -> dict:
    """
    WHICH engine narrates, is it any good, and can it actually spend?

    One function owns this because three surfaces ask it (the settings
    chooser, the rail's premium panel, and generation itself), and
    duplicating the precedence in TypeScript would let them disagree
    about money. Precedence:

        1. this book's own override (manifest)
        2. the audiobook narration setting
        3. the WRITING side's provider + default model

    Level 3 exists because a writer who never opens narration settings
    still deserves an honest answer rather than a blank. That answer is
    normally "this is a chat model, it will not narrate" -- which is
    exactly what is_recommended=False and fallback_note say out loud.
    """
    from app.ai.providers import active_provider

    manifest = manifest or {}
    source = "none"
    provider_key = ""
    model_id = ""

    book_provider = str(manifest.get("selected_provider") or "")
    book_model = str(manifest.get("selected_model") or "")
    setting_provider = str(settings.get("audiobook_tts_provider") or "")
    setting_model = str(settings.get("audiobook_tts_model") or "")

    if book_provider and book_model:
        source, provider_key, model_id = "book", book_provider, book_model
    elif setting_provider and setting_model:
        source, provider_key, model_id = "settings", setting_provider, setting_model

    result: dict = {
        "source": source,
        "provider": provider_key,
        "model": model_id,
        "provider_label": "",
        "model_label": "",
        "tier": "",
        "tier_label": "",
        "price_per_1k_chars": None,
        "price_per_million_chars": None,
        "is_recommended": False,
        "requires_key": True,
        "has_api_key": False,
        "using_writing_keys": bool(settings.get("audiobook_use_writing_keys", True)),
        "key_setting": "",
        "key_hint": "",
        "signup_steps": [],
        "voices_same_as_local": False,
        "voices": [],
        "voice_axes": None,
        "voices_are_fallback": False,
        "voices_verified": True,
        "supports_speed": True,
        "default_voice": str(settings.get("audiobook_tts_voice") or ""),
        "book_voice": manifest.get("selected_premium_voice") or None,
        "can_spend": False,
        "warning": None,
        "fallback_note": None,
    }

    if source in ("book", "settings"):
        try:
            provider, model = resolve_model(provider_key, model_id)
        except ValueError as e:
            # A stored choice that no longer resolves (a renamed slug, a
            # hand-edited manifest) must not read as usable.
            result["fallback_note"] = str(e)
            return result
        voices, is_fallback = voices_for(provider.key, model.id)
        api_key = narration_api_key(settings, provider)
        result.update({
            "provider_label": provider.label,
            "model_label": model.label,
            "tier": model.tier,
            "tier_label": TIER_LABELS.get(model.tier, model.tier.title()),
            "price_per_1k_chars": model.price_per_1k_chars,
            "price_per_million_chars": model.price_per_million_chars,
            "is_recommended": True,
            "has_api_key": bool(api_key.strip()),
            "key_setting": provider.api_key_setting,
            "key_hint": provider.key_hint,
            "signup_steps": list(provider.signup_steps),
            "voices_same_as_local": model.voices_same_as_local,
            "voices": voices,
            "voice_axes": model.voice_axes,
            "voices_are_fallback": is_fallback,
            "voices_verified": model.voices_verified,
            "supports_speed": model.supports_speed,
        })
        if not result["has_api_key"]:
            borrowed = ("Narration is set to borrow your writing key."
                        if result["using_writing_keys"]
                        else "Narration is set to use its own key.")
            result["warning"] = (
                f"No {provider.label} API key is connected, so this engine "
                f"cannot narrate yet. {borrowed}"
            )
        result["can_spend"] = bool(result["has_api_key"])
        return result

    # Level 3: whatever the writing side is pointed at.
    writing = active_provider(settings)
    writing_model = str(settings.get("default_model") or "") or (writing.fallback_model or "")
    if not writing_model:
        return result
    result.update({
        "source": "writing-fallback",
        "provider": writing.key,
        "model": writing_model,
        "provider_label": writing.label,
        "model_label": writing_model,
        "key_setting": writing.api_key_setting,
        "key_hint": writing.key_hint,
        "has_api_key": bool(str(settings.get(writing.api_key_setting) or "").strip()),
        "fallback_note": (
            f"{writing_model} is your writing model, not one of the "
            "recommended narration models. It will most likely refuse to "
            "narrate. Pick a narration engine in Audiobook Settings."
        ),
    })
    if writing.key in PROVIDERS:
        result["signup_steps"] = list(PROVIDERS[writing.key].signup_steps)
    # can_spend stays False: an unrecommended model would 400 at the
    # estimate anyway, so the UI must not offer to spend on it.
    return result


def catalog() -> list[dict]:
    """The whole hosted catalog as plain data for the UI, prices included."""
    return [
        {
            "provider": provider.key,
            "provider_label": provider.label,
            "key_hint": provider.key_hint,
            "api_key_setting": provider.api_key_setting,
            "signup_steps": list(provider.signup_steps),
            "models": [
                {
                    "id": model.id,
                    "label": model.label,
                    "price_per_1k_chars": model.price_per_1k_chars,
                    "price_per_million_chars": model.price_per_million_chars,
                    "tier": model.tier,
                    "same_as_local": model.same_as_local,
                    "voices_same_as_local": model.voices_same_as_local,
                    "voices_verified": model.voices_verified,
                    "supports_speed": model.supports_speed,
                    "voice_axes": model.voice_axes,
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
    What a final pass over this workspace would cost, counted from the
    REAL payload text (pronunciation rules and [say] overrides applied,
    excluded spans already gone) of every segment in the selected
    chapters.

    A final pass is a full rerender by definition -- the voice and engine
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
            "flow_segments": 0,
            "price_per_1k_chars": model.price_per_1k_chars,
            "price_per_million_chars": model.price_per_million_chars,
            "estimate_usd": "0.00",
            "note": "Nothing to narrate yet -- save the narration once first.",
        }

    selected = {c["chapter_id"] for c in workspace_mod.list_chapters(workspace_path)
                if c.get("selected_for_generation", True)}
    rules = pronunciation.effective_rules(workspace_path)
    characters = 0
    segments = 0
    chapters = 0
    flow_segments = 0
    for chapter in manifest["chapters"]:
        if chapter["chapter_id"] not in selected:
            continue
        counted_here = False
        for item in chapter["items"]:
            if item.get("kind") != "segment":
                continue
            fragments = item.get("fragments")
            if fragments and len(fragments) >= 2:
                # A FLOW segment is billed twice over: every fragment is
                # synthesized (the calibration table) AND so is the
                # continuous render they are matched against (flow.py).
                # Counting it once would quote under the real charge on
                # any pause-heavy book -- exactly the direction a quote
                # must never miss in.
                payloads = [pronunciation.prepare_tts_text(f, rules) for f in fragments]
                characters += sum(len(p) for p in payloads)
                characters += len(" ".join(payloads))
                flow_segments += 1
            else:
                characters += len(pronunciation.prepare_tts_text(item["text"], rules))
            segments += 1
            counted_here = True
        if counted_here:
            chapters += 1

    note = ""
    if flow_segments:
        note = (f"{flow_segments} passage(s) carry mid-sentence pauses. Those "
                "are rendered continuously and matched, which bills their "
                "text twice -- already included above.")
    return {
        "provider": provider.key, "provider_label": provider.label,
        "model": model.id, "model_label": model.label,
        "characters": characters, "segments": segments, "chapters": chapters,
        "flow_segments": flow_segments,
        "price_per_1k_chars": model.price_per_1k_chars,
        "price_per_million_chars": model.price_per_million_chars,
        "estimate_usd": estimate_cost_usd(characters, provider_key, model_id),
        "note": note,
    }


def estimate_cost_usd(characters: int, provider_key: str, model_id: str) -> str:
    """
    What narrating `characters` of payload text would cost, as a decimal
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
