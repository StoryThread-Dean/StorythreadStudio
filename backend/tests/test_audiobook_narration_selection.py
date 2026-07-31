# tests/test_audiobook_narration_selection.py
# ============================================
# WHICH engine narrates. One backend function answers this for all three
# surfaces (the settings chooser, the rail's Premium Narration panel, and
# generation itself), so they can never disagree about what is about to be
# spent. Precedence: this book's override > the global setting > the
# writing side's model, with the last one flagged as almost certainly
# wrong rather than silently attempted.

import pytest

from app import settings_store
from app.audiobook import local_worker, pronunciation, recents_store, tts_providers


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH", tmp_path / "gp.json")
    monkeypatch.setattr(settings_store, "SETTINGS_DIR", tmp_path / "st")
    monkeypatch.setattr(settings_store, "SETTINGS_FILE", tmp_path / "st" / "settings.json")
    monkeypatch.setattr(settings_store, "SETTINGS_BACKUP", tmp_path / "st" / "settings.json.bak")
    monkeypatch.setattr(settings_store, "SETTINGS_TMP", tmp_path / "st" / "settings.json.tmp")
    # Hermetic: never let a voice lookup spawn the real 340MB worker.
    monkeypatch.setattr(local_worker, "list_voices",
                        lambda: [{"id": "bf_lily", "label": "Lily (British female)",
                                  "language": "en-GB", "gender_presentation": "female"}])


def _settings(**overrides) -> dict:
    base = dict(settings_store.DEFAULT_SETTINGS)
    base.update(overrides)
    return base


def resolve(settings, manifest=None):
    return tts_providers.resolve_narration_selection(settings, manifest)


# ── Precedence ────────────────────────────────────────────────────────────────

def test_nothing_chosen_and_no_writing_model_reports_none():
    selection = resolve(_settings(default_model="", ai_provider="nanogpt"))
    # NanoGPT has no fallback_model, so there is genuinely nothing to name.
    assert selection["source"] == "none"
    assert selection["can_spend"] is False


def test_the_global_setting_is_used_when_set():
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="hexgrad/kokoro-82m",
        openrouter_api_key="sk-test"))
    assert selection["source"] == "settings"
    assert selection["model_label"] == "Kokoro 82M (hosted)"
    assert selection["tier"] == "budget"
    assert selection["is_recommended"] is True
    assert selection["can_spend"] is True
    assert selection["warning"] is None


def test_this_books_override_beats_the_global_setting():
    settings = _settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="hexgrad/kokoro-82m",
        openrouter_api_key="sk-test", nanogpt_api_key="sk-nano")
    manifest = {"selected_provider": "nanogpt",
                "selected_model": "Elevenlabs-Turbo-V2.5"}
    selection = resolve(settings, manifest)
    assert selection["source"] == "book"
    assert selection["provider"] == "nanogpt"
    assert selection["tier"] == "pro"


def test_the_writing_model_is_the_last_resort_and_says_it_will_not_work():
    # The writing default is a CHAT model. Naming it honestly beats a
    # blank, but it must never look usable.
    selection = resolve(_settings(
        ai_provider="openrouter", default_model="openai/gpt-4o-mini",
        openrouter_api_key="sk-test"))
    assert selection["source"] == "writing-fallback"
    assert selection["model"] == "openai/gpt-4o-mini"
    assert selection["is_recommended"] is False
    assert selection["can_spend"] is False          # THE money gate
    assert "not one of the recommended narration models" in selection["fallback_note"]
    assert selection["price_per_1k_chars"] is None  # nothing to quote


# ── Keys ──────────────────────────────────────────────────────────────────────

def test_a_recommended_engine_without_a_key_cannot_spend():
    selection = resolve(_settings(
        audiobook_tts_provider="nanogpt",
        audiobook_tts_model="Elevenlabs-Turbo-V2.5"))
    assert selection["is_recommended"] is True
    assert selection["has_api_key"] is False
    assert selection["can_spend"] is False
    assert "No NanoGPT API key is connected" in selection["warning"]
    assert selection["signup_steps"]                # instructions come with it


def test_separate_narration_keys_are_read_when_borrowing_is_off():
    borrowed = resolve(_settings(
        audiobook_tts_provider="nanogpt", audiobook_tts_model="Kokoro-82m",
        nanogpt_api_key="writing-key", audiobook_use_writing_keys=True))
    assert borrowed["can_spend"] is True

    separate = resolve(_settings(
        audiobook_tts_provider="nanogpt", audiobook_tts_model="Kokoro-82m",
        nanogpt_api_key="writing-key", audiobook_use_writing_keys=False))
    # The writing key is deliberately NOT a fallback: spending on the
    # wrong account is worse than refusing.
    assert separate["can_spend"] is False
    assert separate["using_writing_keys"] is False


# ── Voices: the parity promise ────────────────────────────────────────────────

def test_hosted_kokoro_offers_the_LOCAL_roster():
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="hexgrad/kokoro-82m",
        openrouter_api_key="sk-test"))
    assert selection["voices_same_as_local"] is True
    assert selection["voices_are_fallback"] is False
    # The live local voice -- the one a writer actually fell in love with.
    assert [v["id"] for v in selection["voices"]] == ["bf_lily"]


def test_a_missing_local_engine_never_breaks_a_hosted_voice_list(monkeypatch):
    def explode():
        raise local_worker.WorkerUnavailableError("not installed")
    monkeypatch.setattr(local_worker, "list_voices", explode)

    selection = resolve(_settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="hexgrad/kokoro-82m",
        openrouter_api_key="sk-test"))
    # The premium path must not depend on the free path being installed.
    assert selection["voices_are_fallback"] is True
    assert any(v["id"] == "af_heart" for v in selection["voices"])


def test_premium_only_models_keep_their_own_cast():
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="x-ai/grok-voice-tts-1.0",
        openrouter_api_key="sk-test"))
    assert selection["voices_same_as_local"] is False
    assert [v["id"] for v in selection["voices"]] == \
        ["Eve", "Ara", "Rex", "Sal", "Leo"]


def test_a_model_with_no_published_voices_is_flagged_unverified():
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter", audiobook_tts_model="deepgram/aura-2",
        openrouter_api_key="sk-test"))
    assert selection["voices_verified"] is False
    assert selection["voices"] == []


# ── Voice choice ──────────────────────────────────────────────────────────────

def test_the_book_voice_overrides_the_default_voice():
    settings = _settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="hexgrad/kokoro-82m",
        audiobook_tts_voice="af_heart", openrouter_api_key="sk-test")
    plain = resolve(settings)
    assert plain["default_voice"] == "af_heart"
    assert plain["book_voice"] is None

    overridden = resolve(settings, {"selected_premium_voice": "bf_lily"})
    assert overridden["default_voice"] == "af_heart"
    assert overridden["book_voice"] == "bf_lily"


# ── Broken stored choices ─────────────────────────────────────────────────────

def test_a_stored_choice_that_no_longer_resolves_reads_as_unusable():
    # A renamed provider slug or a hand-edited manifest must not read as
    # a working engine.
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="openai/retired-tts-model",
        openrouter_api_key="sk-test"))
    assert selection["is_recommended"] is False
    assert selection["can_spend"] is False
    assert "Available:" in selection["fallback_note"]
