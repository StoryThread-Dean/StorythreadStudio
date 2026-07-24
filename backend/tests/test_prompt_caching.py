# tests/test_prompt_caching.py -- Prompt caching payload shapes
# ===============================================================
# The Prompt Caching feature marks the system prompt with an Anthropic-style
# cache_control block -- but ONLY for providers that support it (OpenRouter).
# A wrong payload here is invisible in normal use (providers ignore or
# reject it silently), so these tests capture the exact JSON sent to the
# provider and assert its shape. The HTTP layer is monkeypatched with the
# same fake-client pattern as test_sanitizer_routing.py.

import httpx
import pytest

from app.ai.openrouter import run_chat, run_completion
from app.ai.providers import OPENROUTER, NANOGPT


class _FakeResponse:
    """Minimal stand-in for an httpx.Response with a canned JSON reply."""
    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": "{\"summary\": \"ok\"}"}}]}


class _CapturingAsyncClient:
    """Fake httpx.AsyncClient that records the request it was asked to send."""
    # Class attributes so tests can read what the client "sent".
    last_url = ""
    last_headers: dict = {}
    last_payload: dict = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        _CapturingAsyncClient.last_url = url
        _CapturingAsyncClient.last_headers = headers or {}
        _CapturingAsyncClient.last_payload = json or {}
        return _FakeResponse()


@pytest.fixture(autouse=True)
def fake_http(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _CapturingAsyncClient)


def _sent_system_message() -> dict:
    return _CapturingAsyncClient.last_payload["messages"][0]


# ── run_chat ─────────────────────────────────────────────────────────────────

async def test_chat_caching_on_openrouter_marks_system_block():
    await run_chat(
        api_key="x", model_id="m", system_prompt="the static instructions",
        messages=[{"role": "user", "content": "go"}],
        provider=OPENROUTER, cache_prompts=True,
    )
    system = _sent_system_message()
    assert system["role"] == "system"
    # Structured content-part array with the cache marker on the text block.
    assert system["content"] == [{
        "type": "text",
        "text": "the static instructions",
        "cache_control": {"type": "ephemeral"},
    }]
    # User messages stay plain strings -- they change per request.
    assert _CapturingAsyncClient.last_payload["messages"][1]["content"] == "go"


async def test_chat_caching_off_keeps_plain_string():
    await run_chat(
        api_key="x", model_id="m", system_prompt="s",
        messages=[{"role": "user", "content": "go"}],
        provider=OPENROUTER,  # cache_prompts defaults to False
    )
    assert _sent_system_message()["content"] == "s"


async def test_chat_nanogpt_never_gets_cache_control():
    # Even with cache_prompts=True (a bug upstream would look like this),
    # the client's own provider gate keeps NanoGPT payloads plain.
    await run_chat(
        api_key="x", model_id="m", system_prompt="s",
        messages=[{"role": "user", "content": "go"}],
        provider=NANOGPT, cache_prompts=True,
    )
    assert _sent_system_message()["content"] == "s"


async def test_nanogpt_calls_use_its_base_url_and_no_attribution_headers():
    await run_chat(
        api_key="nano-key", model_id="m", system_prompt="s",
        messages=[{"role": "user", "content": "go"}],
        provider=NANOGPT,
    )
    assert _CapturingAsyncClient.last_url.startswith("https://nano-gpt.com/api/v1")
    headers = _CapturingAsyncClient.last_headers
    assert headers["Authorization"] == "Bearer nano-key"
    # OpenRouter's attribution headers must not leak to other providers.
    assert "HTTP-Referer" not in headers
    assert "X-Title" not in headers


# ── run_completion ───────────────────────────────────────────────────────────

async def test_completion_caching_on_openrouter_marks_system_block():
    await run_completion(
        api_key="x", model_id="m", system_prompt="instructions",
        user_message="do the thing",
        provider=OPENROUTER, cache_prompts=True,
    )
    system = _sent_system_message()
    assert system["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert system["content"][0]["text"] == "instructions"


async def test_completion_default_is_plain_string():
    await run_completion(
        api_key="x", model_id="m", system_prompt="s", user_message="u",
    )
    assert _sent_system_message()["content"] == "s"
