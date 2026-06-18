# tests/test_sanitizer_routing.py
# ===============================
# Tests that drafted prose is cleaned by the right sanitizer. The em/en-dash
# ban must always hold, but the approved ' -- ' is legitimate punctuation in
# story prose, so draft mode must NOT fold it down to commas the way the
# conversational chat sanitizer does.
#
# Two layers are covered:
#   1. The sanitizer functions themselves (sanitize vs sanitize_chat).
#   2. run_chat() routing: sanitize_mode="prose" keeps ' -- ', the default
#      ("chat") does not. The OpenRouter HTTP call is monkeypatched so no
#      network is touched.

import httpx

from app.ai.openrouter import run_chat
from app.ai.sanitizer import sanitize, sanitize_chat


# ── The sanitizer functions ──────────────────────────────────────────────────

def test_sanitize_keeps_double_hyphen():
    # Prose sanitizer: approved ' -- ' stays as written.
    assert sanitize("He paused -- then ran.") == "He paused -- then ran."


def test_sanitize_chat_folds_double_hyphen_to_comma():
    # Chat sanitizer: ' -- ' becomes a comma for conversational replies.
    assert "--" not in sanitize_chat("He paused -- then ran.")


def test_both_sanitizers_strip_em_dash():
    em = "He paused—then ran."        # U+2014 em dash
    assert "—" not in sanitize(em)
    assert "—" not in sanitize_chat(em)


# ── run_chat sanitizer routing (network monkeypatched) ───────────────────────

class _FakeResponse:
    """Minimal stand-in for an httpx.Response."""
    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


class _FakeAsyncClient:
    """Stand-in for httpx.AsyncClient that returns a canned reply."""
    # Class attribute so the test can set what the model "returns".
    reply_content = ""

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return _FakeResponse(self.reply_content)


async def test_run_chat_prose_mode_keeps_double_hyphen(monkeypatch):
    _FakeAsyncClient.reply_content = "She ran -- then stopped."
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    reply = await run_chat(
        api_key="x", model_id="m", system_prompt="s",
        messages=[{"role": "user", "content": "go"}],
        sanitize_mode="prose",
    )
    assert "--" in reply


async def test_run_chat_default_chat_mode_folds_double_hyphen(monkeypatch):
    _FakeAsyncClient.reply_content = "She ran -- then stopped."
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    reply = await run_chat(
        api_key="x", model_id="m", system_prompt="s",
        messages=[{"role": "user", "content": "go"}],
        # no sanitize_mode -> defaults to "chat"
    )
    assert "--" not in reply
