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
    ids = {v["id"] for v in selection["voices"]}
    # None of the local Kokoro ids appear here -- a different engine, a
    # different cast.
    assert "af_heart" not in ids
    assert "Ara" in ids


def test_grok_offers_only_the_voices_openrouter_documents():
    # Live finding, three 404s deep: iris-en-US, then iris-en-GB, then
    # ara-en-GB -- and that last one is a DOCUMENTED voice, which proves
    # it is the dialect suffix OpenRouter rejects, not just the wider
    # roster. xAI's own registry is 26 voices x 3 dialects; OpenRouter
    # takes five bare names. Offering the other 73 was offering options
    # that cannot play, so the list is trimmed to what works.
    voices = tts_providers.voices_for("openrouter", "x-ai/grok-voice-tts-1.0")[0]
    assert [v["id"] for v in voices] == ["Ara", "Eve", "Leo", "Rex", "Sal"]
    # Feminine before masculine, the way every other roster here groups.
    assert [v["gender_presentation"] for v in voices] == (
        ["female", "female", "male", "male", "male"])
    # The character words survive the trim -- they are how a writer casts.
    ara = voices[0]
    assert ara["label"] == "Ara (female) -- warm, natural, friendly"


def test_voxtral_fills_the_standard_tier_with_one_voice_per_mood():
    # Grok's replacement. The roster comes from OpenRouter's own model
    # metadata, which is the source that turned out to be right about Grok
    # when the vendor's page was not.
    voices = tts_providers.voices_for(
        "openrouter", "mistralai/voxtral-mini-tts-2603")[0]
    ids = [v["id"] for v in voices]
    assert len(ids) == 24                       # 8 Paul + 9 Jane + 7 Oliver
    # Neutral leads each speaker: it is what a narrator reads in.
    assert ids[0] == "en_paul_neutral"
    assert ids.index("gb_jane_neutral") < ids.index("gb_jane_sarcasm")
    # Grouped American then British, feminine before masculine inside that.
    ranks = [({"en-US": 0, "en-GB": 1}[v["language"]],
              0 if v["gender_presentation"] == "female" else 1) for v in voices]
    assert ranks == sorted(ranks)
    # French exists upstream and is deliberately not offered.
    assert not any(i.startswith("fr_") for i in ids)


def test_voxtral_bakes_mood_into_the_voice_not_an_axis():
    # NOT modelled as speaker x emotion axes: the emotion sets differ per
    # speaker, so two dropdowns would offer combinations that do not
    # exist -- the exact trap removed from Grok.
    _provider, model = tts_providers.resolve_model(
        "openrouter", "mistralai/voxtral-mini-tts-2603")
    assert model.voice_axes is None
    assert model.tier == "standard"
    assert model.price_per_million_chars == "16"


def test_voxtral_is_demoted_for_its_fixed_moods():
    # Four voices tried by ear (curious, neutral, sarcastic, confident).
    # The verdict was not about defects -- inside a paragraph it is clean,
    # no slurs, no mangled words -- but about the CAST. Every voice has a
    # mood welded on, the same id reads the whole book, and it turns
    # monotonous in about twenty seconds. There is no mood-free variant to
    # fall back to; neutral is the plainest there is.
    _provider, model = tts_providers.resolve_model(
        "openrouter", "mistralai/voxtral-mini-tts-2603")
    assert model.recommended is False
    assert "monotonous" in model.caveat
    # Still selectable, and still able to spend -- a demotion is a
    # warning the writer can overrule, not a block.
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="mistralai/voxtral-mini-tts-2603",
        openrouter_api_key="sk-test"))
    assert selection["can_spend"] is True
    assert "monotonous" in selection["caveat"]


def test_grok_is_demoted_off_the_recommended_shelf_with_its_reason():
    # It narrates, and it sounds good for a sentence. But pitch and tone
    # reset between sentences -- each segment is its own request and the
    # model re-improvises delivery every time, so a chapter arrives
    # sounding spliced. Nothing on our side can steady that, so it comes
    # off the shelf. It stays SELECTABLE: a working engine somebody may
    # want for a short piece, and a book already pointed at it must not
    # break.
    tiers = {(t["provider"], t["model"]): t
             for t in tts_providers.recommended_tiers()}
    grok = tiers[("openrouter", "x-ai/grok-voice-tts-1.0")]
    assert grok["recommended"] is False
    assert "reset between them" in grok["caveat"]

    # The shelf is now the free local narrator, hosted Kokoro, and the Pro
    # engines. Both Standard-tier candidates were auditioned and both came
    # off it -- which is the honest state, not a gap to paper over.
    demoted = {key for key, t in tiers.items() if not t["recommended"]}
    assert demoted == {
        ("openrouter", "x-ai/grok-voice-tts-1.0"),
        ("openrouter", "mistralai/voxtral-mini-tts-2603"),
    }
    assert all(t["caveat"] for key, t in tiers.items() if key in demoted)


def test_a_demoted_engine_can_still_be_chosen_and_still_spends():
    # The caveat rides along with the selection so the panel that spends
    # money can repeat it, and can_spend stays True: this is a warning the
    # writer overrules, not a block. The red fallback_note path -- a chat
    # model that cannot narrate at all -- is the one that stops spending.
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter",
        audiobook_tts_model="x-ai/grok-voice-tts-1.0",
        openrouter_api_key="sk-test"))
    assert selection["is_recommended"] is False
    assert "reset between them" in selection["caveat"]
    assert selection["can_spend"] is True
    assert selection["fallback_note"] is None


def test_grok_offers_no_accent_choice_because_suffixes_404():
    # An accent dropdown was shipped here for exactly one commit, then
    # ara-en-GB came back 404 and killed it: every option in it would have
    # broken whatever voice the writer picked. A control that cannot work
    # is worse than no control, so the model declares no axes and the
    # five bare names stand alone.
    _provider, model = tts_providers.resolve_model(
        "openrouter", "x-ai/grok-voice-tts-1.0")
    assert model.voice_axes is None
    # No id anywhere in the offered list carries a dialect suffix.
    voices = tts_providers.voices_for("openrouter", "x-ai/grok-voice-tts-1.0")[0]
    assert not any("-en-" in v["id"] for v in voices)


def test_aura2_carries_its_published_registry():
    selection = resolve(_settings(
        audiobook_tts_provider="openrouter", audiobook_tts_model="deepgram/aura-2",
        openrouter_api_key="sk-test"))
    assert selection["voices_verified"] is True
    assert len(selection["voices"]) == 38
    ids = {v["id"] for v in selection["voices"]}
    assert "aura-2-zeus-en" in ids
    # The character words are the useful part when casting a narrator, so
    # they travel in the label rather than being dropped on the floor.
    zeus = next(v for v in selection["voices"] if v["id"] == "aura-2-zeus-en")
    assert zeus["label"] == "Zeus (American male) -- deep, trustworthy, smooth"
    assert zeus["gender_presentation"] == "male"
    # Non-American accents keep their own language tag.
    pandora = next(v for v in selection["voices"] if v["id"] == "aura-2-pandora-en")
    assert pandora["language"] == "en-GB"
    theia = next(v for v in selection["voices"] if v["id"] == "aura-2-theia-en")
    assert theia["language"] == "en-AU"


def test_aura2_voices_are_grouped_the_way_a_writer_narrows_them_down():
    # 38 voices in one dropdown are only usable if they are grouped:
    # accent first (American, British, Australian), feminine before
    # masculine inside each group, alphabetical within that.
    voices = tts_providers.voices_for("openrouter", "deepgram/aura-2")[0]

    def group(voice) -> tuple[int, int]:
        language_rank = {"en-US": 0, "en-GB": 1, "en-AU": 2}[voice["language"]]
        gender_rank = 0 if voice["gender_presentation"] == "female" else 1
        return (language_rank, gender_rank)

    ranks = [group(v) for v in voices]
    assert ranks == sorted(ranks)                       # never interleaved
    assert voices[0]["id"] == "aura-2-asteria-en"        # first American woman
    assert voices[-1]["id"] == "aura-2-hyperion-en"      # last Australian man
    # The American Southern voice sorts with the Americans, not into its
    # own orphan group.
    janus = next(i for i, v in enumerate(voices) if v["id"] == "aura-2-janus-en")
    first_british = next(i for i, v in enumerate(voices) if v["language"] == "en-GB")
    assert janus < first_british


def test_a_model_whose_voice_list_is_unpublished_is_flagged_unverified():
    # NanoGPT's ElevenLabs tier has 46 voices it does not publish: the
    # known preset names are offered as a starting point, and the flag
    # tells the UI to also accept a typed voice name.
    selection = resolve(_settings(
        audiobook_tts_provider="nanogpt",
        audiobook_tts_model="Elevenlabs-Turbo-V2.5",
        nanogpt_api_key="sk-test"))
    assert selection["voices_verified"] is False
    assert any(v["id"] == "Rachel" for v in selection["voices"])


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


def test_mai_voice_ids_carry_the_model_suffix_azure_requires():
    # Two live 400s to learn this. An Azure voice ShortName includes the
    # MODEL: "en-US-Harper:MAI-Voice-2". OpenRouter's metadata lists the
    # bare stem, which looks like a finished id and is not -- sending it
    # got an opaque 400, and sending no voice at all finally produced the
    # useful complaint, "An explicit voice is required".
    voices = tts_providers.voices_for("openrouter", "microsoft/mai-voice-2")[0]
    assert all(v["id"].endswith(":MAI-Voice-2") for v in voices)
    assert "en-US-Harper:MAI-Voice-2" in {v["id"] for v in voices}


def test_mai_has_a_real_english_cast_not_one_voice():
    # The earlier "one English voice" came from the gateway's partial
    # list. Microsoft publishes seven, which is what makes this engine
    # worth auditioning at all -- a single voice cannot cast two books.
    voices = tts_providers.voices_for("openrouter", "microsoft/mai-voice-2")[0]
    assert len(voices) == 7
    assert sum(1 for v in voices if v["gender_presentation"] == "female") == 4
    assert sum(1 for v in voices if v["gender_presentation"] == "male") == 3
    # Grouped like every other roster: American first, feminine first.
    ranks = [({"en-US": 0, "en-AU": 2}[v["language"]],
              0 if v["gender_presentation"] == "female" else 1) for v in voices]
    assert ranks == sorted(ranks)


def test_mai_sends_no_response_format_and_stays_typeable():
    # It rejected the field's presence, and a voice id we cannot fully
    # verify means the writer keeps a way to type one.
    _provider, model = tts_providers.resolve_model(
        "openrouter", "microsoft/mai-voice-2")
    assert model.response_format is None
    assert model.voices_verified is False
    assert model.tier == "standard"
