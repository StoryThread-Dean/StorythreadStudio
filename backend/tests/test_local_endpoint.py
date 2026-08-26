# tests/test_local_endpoint.py -- What "Local model" is allowed to mean
# ======================================================================
# Every local runtime (Ollama, LM Studio, llama.cpp) speaks the same
# OpenAI-compatible API that OpenRouter and NanoGPT speak. That is
# convenient, and it is also the danger: an unvalidated address would let
# "Local model" quietly become a way to connect ANY remote service, with no
# key field, no cost warning, and no provider entry saying what it is.
#
# These tests pin the line -- loopback, private networks, and .local names
# only -- and the URL normalization that lets a writer paste whichever
# address their tool happened to show them.

import pytest

from app.ai.local_endpoint import (
    LOCAL_API_STYLES,
    LOCAL_CONNECT_TIMEOUT,
    LOCAL_LIST_TIMEOUT,
    chat_base_url,
    normalize_base_url,
    validate_local_base_url,
)
from app.ai.providers import LOCAL, OPENROUTER, base_url_for, list_base_url_for


# ── What counts as local ─────────────────────────────────────────────────────

@pytest.mark.parametrize("address", [
    "localhost:11434",                 # what most people actually type
    "http://localhost:11434",
    "http://127.0.0.1:1234",           # LM Studio's default
    "http://[::1]:11434",              # IPv6 loopback, brackets and all
    "http://192.168.1.50:11434",       # another machine on the home network
    "http://10.0.0.7:8080",
    "http://172.16.4.4:8080",
    "http://studio-pc.local:8080",     # mDNS / Bonjour name
])
def test_local_addresses_are_accepted(address):
    assert validate_local_base_url(address).startswith("http")


@pytest.mark.parametrize("address", [
    "https://api.openai.com/v1",
    "http://api.anthropic.com",
    "http://8.8.8.8:11434",            # a public IP is still public
    "http://example.com:11434",
    "http://localhost.evil.com:11434",  # not a .local name -- a real domain
])
def test_public_addresses_are_refused(address):
    with pytest.raises(ValueError, match="not a local address"):
        validate_local_base_url(address)


def test_the_refusal_explains_the_rule():
    # A bare "invalid" would leave the writer guessing what to type instead.
    with pytest.raises(ValueError) as exc:
        validate_local_base_url("https://api.openai.com/v1")
    message = str(exc.value)
    assert "localhost" in message and "192.168" in message


@pytest.mark.parametrize("address, fragment", [
    ("", "Enter the address"),
    ("   ", "Enter the address"),
    ("ftp://localhost:1234", "http://"),
    ("file:///models", "http://"),
])
def test_malformed_addresses_are_refused_with_their_own_message(address, fragment):
    with pytest.raises(ValueError, match=fragment):
        validate_local_base_url(address)


# ── Normalization: the writer should not have to know which path we want ─────

def test_openai_style_gets_exactly_one_v1():
    assert normalize_base_url("http://localhost:11434", "openai") == \
        "http://localhost:11434/v1"
    # Idempotent -- pasting the /v1 URL must not produce /v1/v1.
    assert normalize_base_url("http://localhost:11434/v1", "openai") == \
        "http://localhost:11434/v1"


def test_ollama_style_keeps_the_bare_root():
    # Ollama's native endpoints live under /api/, not /v1.
    assert normalize_base_url("http://localhost:11434", "ollama") == \
        "http://localhost:11434"
    assert normalize_base_url("http://localhost:11434/", "ollama") == \
        "http://localhost:11434"


def test_paths_and_query_strings_are_stripped_before_normalizing():
    assert normalize_base_url("http://localhost:11434/api/generate?x=1", "openai") == \
        "http://localhost:11434/v1"


def test_both_styles_exist_and_openai_is_the_default_shape():
    assert set(LOCAL_API_STYLES) == {"openai", "ollama"}


# ── Timeouts: "on this machine" answers fast or not at all ───────────────────

def test_local_timeouts_are_short_enough_to_feel_like_a_local_failure():
    # There is no transatlantic hop to be patient about: a local server is
    # either listening or it is not. Long waits here would read as a hang.
    assert LOCAL_CONNECT_TIMEOUT <= 5.0
    assert LOCAL_LIST_TIMEOUT <= 15.0
    assert LOCAL_CONNECT_TIMEOUT < LOCAL_LIST_TIMEOUT


# ── The provider config itself ───────────────────────────────────────────────

def test_the_local_provider_asks_for_no_key_and_guesses_no_model():
    assert LOCAL.requires_api_key is False
    assert LOCAL.api_key_setting == ""
    # No fallback model, for NanoGPT's reason squared: we cannot know which
    # models a writer has pulled onto their own disk.
    assert LOCAL.fallback_model is None
    # Local reasoning models write their thinking into the reply body.
    assert LOCAL.strip_think_blocks is True


def test_base_url_for_reads_local_from_settings_and_hosted_from_config():
    settings = {"local_base_url": "localhost:11434", "local_api_style": "openai"}
    assert base_url_for(LOCAL, settings) == "http://localhost:11434/v1"
    # A hosted provider ignores the setting entirely.
    assert base_url_for(OPENROUTER, settings) == OPENROUTER.base_url


def test_base_url_for_says_so_when_no_local_address_is_set():
    with pytest.raises(ValueError, match="No address is set"):
        base_url_for(LOCAL, {"local_base_url": ""})


# ── THE CHAT TRANSPORT, which is the bug this section exists for ─────────────
#
# Spec: docs/local-model-spec.md sections 3.1, 3.2 and 10.1.
#
# `local_api_style` used to choose the chat transport as well as the model
# list, and its "ollama" value could not work: the address stayed at the bare
# root while run_completion and run_chat both POST to a hardcoded
# {base}/chat/completions, which Ollama serves at /v1/... and /api/chat but
# never there. The writer got a passing Test Connection, a full model dropdown,
# and a 404 on every Draft, Advisor pass and summary.
#
# It shipped because NOTHING in the suite had ever asked where a local
# completion would be POSTed. Listing was tested thoroughly; generation was
# not tested at all. These are that test.

def test_chat_always_resolves_to_the_openai_compatible_root():
    # Whatever the writer chose for LISTING, a prompt goes to /v1.
    for style in LOCAL_API_STYLES:
        settings = {"local_base_url": "localhost:11434", "local_api_style": style}
        assert base_url_for(LOCAL, settings) == "http://localhost:11434/v1", (
            f"chat base is wrong for style {style!r}"
        )


def test_the_url_a_local_completion_is_actually_posted_to():
    # THE REGRESSION TEST. Not "the base looks right" but the whole URL the
    # request layer builds, spelled out, because the defect lived in the gap
    # between a correct base and a hardcoded suffix.
    settings = {"local_base_url": "http://localhost:11434",
                "local_api_style": "ollama"}
    base = base_url_for(LOCAL, settings)
    assert f"{base}/chat/completions" == \
        "http://localhost:11434/v1/chat/completions"


def test_chat_base_url_is_idempotent_and_style_blind():
    assert chat_base_url("localhost:11434") == "http://localhost:11434/v1"
    # A writer who pasted the /v1 URL their tool showed them gets one /v1.
    assert chat_base_url("http://localhost:11434/v1") == \
        "http://localhost:11434/v1"


# ── LISTING stays style-aware, because that difference is real ───────────────

def test_listing_keeps_the_bare_root_for_ollama():
    # /api/tags hangs off the root, and it is also the only place a model's
    # parameter size, quantization and family come from -- which is why the
    # dropdown survives rather than being retired.
    settings = {"local_base_url": "localhost:11434", "local_api_style": "ollama"}
    assert list_base_url_for(LOCAL, settings) == "http://localhost:11434"


def test_listing_uses_v1_for_everything_else():
    settings = {"local_base_url": "localhost:1234", "local_api_style": "openai"}
    assert list_base_url_for(LOCAL, settings) == "http://localhost:1234/v1"


def test_listing_refuses_a_missing_address_the_same_way_chat_does():
    # One refusal, two callers: a writer must not get a different story about
    # the same empty field depending on which question was asked.
    with pytest.raises(ValueError, match="No address is set"):
        list_base_url_for(LOCAL, {"local_base_url": ""})


def test_a_public_address_is_still_refused_for_both_questions():
    # The narrowing in 3.2 changed the PATH rules. It must not have loosened
    # what counts as local -- that restriction is the provider's whole promise.
    settings = {"local_base_url": "https://api.example.com",
                "local_api_style": "openai"}
    for resolve in (base_url_for, list_base_url_for):
        with pytest.raises(ValueError):
            resolve(LOCAL, settings)
