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
    normalize_base_url,
    validate_local_base_url,
)
from app.ai.providers import LOCAL, OPENROUTER, base_url_for


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
