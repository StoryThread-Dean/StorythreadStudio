# ai/providers.py -- The AI Provider Registry
# =============================================
# Storythread Studio can talk to more than one AI service. Every service we
# support ("provider") speaks the same OpenAI-compatible chat API, so the
# ONLY things that differ between them are captured in one small config
# object: where to send requests, which stored key to use, and which extra
# features the service understands.
#
# Think of a ProviderConfig like a contact card: the client code in
# openrouter.py is the phone that can call anyone, and the card tells it
# which number to dial and how formal to be.
#
# Adding a future provider (see docs/research-multi-provider.md) is meant
# to be exactly this:
#   1. Add a ProviderConfig instance below + register it in PROVIDERS.
#   2. Add its settings keys (API key / base URL) to settings_store.py.
#   3. Add a panel entry in the frontend's providerMeta.ts.
# The request path (all AI endpoints in routers/ai.py) never changes.
#
# Seams already reserved for the local-runtime providers (Ollama, LM Studio,
# llama.cpp) planned on the roadmap:
#   - requires_api_key=False will hide the key field and skip the
#     Authorization header (headers are built from config, so "no auth"
#     is just an empty config).
#   - A future model_list_style field ("openai" | "ollama_tags") will switch
#     the model-list fetch for Ollama's native GET /api/tags quirk.
#   - A future strip_think_blocks flag will gate sanitizer-level removal of
#     inline <think>...</think> traces that local reasoning models emit.

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ProviderConfig:
    """Everything the client needs to know to talk to one AI service.

    frozen=True makes instances immutable -- provider configs are constants,
    and freezing them prevents accidental mutation at runtime.
    """

    key: str                 # Stable id stored in settings ("openrouter" | "nanogpt")
    label: str               # User-facing name, used in error messages ("OpenRouter")
    base_url: str            # OpenAI-compatible API root, no trailing slash
    api_key_setting: str     # Which settings_store key holds this provider's API key
    key_hint: str            # Where the user gets a key / adds funds ("openrouter.ai")
    # Extra HTTP headers beyond Authorization/Content-Type. OpenRouter asks
    # for app-attribution headers; other providers send nothing extra.
    extra_headers: dict[str, str] = field(default_factory=dict)
    # Hosted providers need an API key; future local runtimes will not.
    requires_api_key: bool = True
    # Whether the service understands OpenRouter's "reasoning" request
    # parameter (out-of-band reasoning traces). Anything else would either
    # error on the unknown field or silently ignore it -- we just don't send it.
    supports_reasoning_param: bool = False
    # Whether the service understands Anthropic-style cache_control blocks
    # (prompt caching). Only OpenRouter today; see run_chat/run_completion.
    supports_cache_control: bool = False
    # Model used when neither the project nor global settings pick one.
    # None means "no safe guess" -- the user must pick a model explicitly.
    fallback_model: str | None = None


# --- The two providers shipped today -----------------------------------------

OPENROUTER = ProviderConfig(
    key="openrouter",
    label="OpenRouter",
    base_url="https://openrouter.ai/api/v1",
    api_key_setting="openrouter_api_key",
    key_hint="openrouter.ai",
    extra_headers={
        # OpenRouter recommends these headers for app attribution/tracking.
        "HTTP-Referer": "http://localhost:1420",
        "X-Title":      "Storythread Studio",
    },
    supports_reasoning_param=True,
    supports_cache_control=True,
    fallback_model="openai/gpt-4o-mini",
)

NANOGPT = ProviderConfig(
    key="nanogpt",
    label="NanoGPT",
    base_url="https://nano-gpt.com/api/v1",
    api_key_setting="nanogpt_api_key",
    key_hint="nano-gpt.com",
    # No attribution headers, no reasoning param, no cache_control -- NanoGPT
    # is a plain OpenAI-compatible endpoint. No fallback model either: its
    # catalog is different from OpenRouter's, so guessing a slug would just
    # produce a confusing 404. The user picks a model in Settings instead.
)

# Registry keyed by the settings value. Order here drives nothing -- the
# frontend has its own display order in providerMeta.ts.
PROVIDERS: dict[str, ProviderConfig] = {
    OPENROUTER.key: OPENROUTER,
    NANOGPT.key:    NANOGPT,
}


def active_provider(settings: dict) -> ProviderConfig:
    """Resolve the provider selected in global settings.

    Unknown or missing values fall back to OpenRouter -- the safe default,
    since it is the provider every existing install was using before the
    ai_provider setting existed.
    """
    return PROVIDERS.get(settings.get("ai_provider", "openrouter"), OPENROUTER)
