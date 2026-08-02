# tests/test_audiobook_speakers.py
# =================================
# The cast and [voice:NAME] spans (spec 27). Multi-voice narration is the
# first feature where a mistake produces something that SOUNDS fine and
# is wrong -- a passage read fluently by the wrong character. So these
# tests are mostly about the boundaries between speakers:
#
#   - two speakers can never share one synthesis request
#   - a name the cast does not know falls back audibly to the narrator,
#     and says so at save time rather than at listen time
#   - recasting a character changes her voice without touching a word of
#     the manuscript, and re-renders only her lines

import pytest
from fastapi.testclient import TestClient

from app.audiobook import generation, markers, pronunciation, recents_store, segmenter, workspace
from app.audiobook.markers import parse_narration, speaker_names
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


def _elements(text: str) -> list[dict]:
    return parse_narration(f"# Chapter 1\n\n{text}").chapters[0].elements


def _segments(text: str) -> list[dict]:
    parsed = parse_narration(f"# Chapter 1\n\n{text}")
    manifest = segmenter.resegment(parsed, None)
    return [i for i in manifest["chapters"][0]["items"] if i["kind"] == "segment"]


# ── Parsing ───────────────────────────────────────────────────────────────────

def test_a_voice_span_marks_its_text_and_nothing_else(tmp_path):
    elements = _elements(
        'She waited by the gate.\n\n'
        '[voice:Elena]"This cannot continue," she said.[/voice]\n\n'
        'He said nothing at all.'
    )
    texts = [e for e in elements if e["type"] == "text"]
    assert texts[0].get("voice") is None
    assert texts[1]["voice"] == "Elena"
    assert texts[2].get("voice") is None


def test_pace_can_live_inside_a_voice_span(tmp_path):
    # Voice is the OUTER span deliberately: a character's line may change
    # speed within it, but a pace change never changes who is speaking.
    elements = _elements(
        '[voice:Elena]She began slowly. [pace:-2]Then slower still.[/pace][/voice]'
    )
    texts = [e for e in elements if e["type"] == "text"]
    assert all(t["voice"] == "Elena" for t in texts)
    assert any(t.get("pace") == "-2" for t in texts)


def test_an_unclosed_voice_span_applies_to_the_rest_and_says_so():
    parsed = parse_narration('# Chapter 1\n\n[voice:Elena]She spoke.\n\nAnd spoke again.')
    texts = [e for e in parsed.chapters[0].elements if e["type"] == "text"]
    assert all(t["voice"] == "Elena" for t in texts)
    assert any("no closing [/voice]" in w for w in parsed.warnings)


def test_a_stray_closing_tag_is_dropped_with_the_preview_explanation():
    # The classic cause is a preview selection that cut into a span. It
    # must never reach the engine as narrated text, and the writer needs
    # to know why the passage came back in the narrator's voice.
    parsed = parse_narration('# Chapter 1\n\nShe spoke.[/voice]')
    text = [e for e in parsed.chapters[0].elements if e["type"] == "text"][0]
    assert "[/voice]" not in text["content"]
    assert any("read by the narrator" in w for w in parsed.warnings)


def test_voice_spans_cannot_nest():
    parsed = parse_narration(
        '# Chapter 1\n\n[voice:Elena]She said [voice:Marcus]nothing[/voice][/voice]')
    assert any("cannot nest" in w for w in parsed.warnings)


def test_an_empty_name_falls_back_to_the_narrator():
    parsed = parse_narration('# Chapter 1\n\n[voice:]Who is this?[/voice]')
    text = [e for e in parsed.chapters[0].elements if e["type"] == "text"][0]
    assert text.get("voice") is None
    assert any("has no name" in w for w in parsed.warnings)


def test_speaker_names_lists_every_name_once_in_first_use_order():
    names = speaker_names(
        "[voice:Elena]a[/voice] [voice:Marcus]b[/voice] [voice:elena]c[/voice]")
    assert names == ["Elena", "Marcus"]


# ── Segmentation ──────────────────────────────────────────────────────────────

def test_a_voice_change_is_a_hard_segment_boundary():
    # The rule everything else rests on: two speakers can never share one
    # synthesis request, because a request has exactly one voice.
    segments = _segments(
        'The gate stood open.\n\n'
        '[voice:Elena]"This cannot continue."[/voice]\n\n'
        '[voice:Marcus]"It already has."[/voice]'
    )
    assert [s.get("voice") for s in segments] == [None, "Elena", "Marcus"]


def test_the_voice_rides_the_segment_record_for_generation():
    segments = _segments('[voice:Elena]"This cannot continue."[/voice]')
    assert segments[0]["voice"] == "Elena"
    # It is the NAME, not a voice id -- resolving happens at generation,
    # so recasting never rewrites the manuscript.
    assert segments[0]["voice"] == "Elena"


def test_an_edit_elsewhere_leaves_a_characters_segment_alone():
    first = parse_narration(
        '# Chapter 1\n\nThe gate stood open.\n\n[voice:Elena]"Enough."[/voice]')
    manifest = segmenter.resegment(first, None)
    elena = [i for i in manifest["chapters"][0]["items"]
             if i["kind"] == "segment" and i.get("voice") == "Elena"][0]
    elena.update({"status": "completed", "output_file": "x.wav"})

    second = parse_narration(
        '# Chapter 1\n\nThe gate stood wide open.\n\n[voice:Elena]"Enough."[/voice]')
    after = segmenter.resegment(second, manifest)
    kept = [i for i in after["chapters"][0]["items"]
            if i["kind"] == "segment" and i.get("voice") == "Elena"][0]
    assert kept["segment_id"] == elena["segment_id"]
    assert kept["status"] == "completed"      # her audio survives


# ── The cast ──────────────────────────────────────────────────────────────────

def test_the_narrator_always_exists_and_takes_the_books_voice():
    cast = workspace.speakers({"selected_voice": "af_heart"})
    assert len(cast) == 1
    assert cast[0]["display_name"] == workspace.NARRATOR_NAME
    assert cast[0]["voice_id"] == "af_heart"


def test_a_broken_cast_entry_never_makes_a_book_unopenable():
    # Hand-edited manifests and older files both land here.
    cast = workspace.speakers({
        "selected_voice": "af_heart",
        "speakers": ["nonsense", {}, {"display_name": "  "},
                     {"display_name": "Elena", "voice_id": "bf_emma"}],
    })
    assert [s["display_name"] for s in cast] == ["Narrator", "Elena"]


def test_a_duplicate_name_is_collapsed_because_names_are_the_key():
    # The manuscript says [voice:Elena]; two Elenas would make that
    # ambiguous, and the ambiguity would be resolved silently at render.
    cast = workspace.speakers({"speakers": [
        {"display_name": "Elena", "voice_id": "bf_emma"},
        {"display_name": "elena", "voice_id": "am_adam"},
    ]})
    assert [s["display_name"] for s in cast] == ["Narrator", "Elena"]
    assert cast[1]["voice_id"] == "bf_emma"


def test_voice_lookup_is_case_insensitive_and_falls_back_to_the_narrator():
    cast = workspace.speakers({
        "selected_voice": "af_heart",
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}],
    })
    assert workspace.voice_for_speaker("elena", cast, "af_heart") == "bf_emma"
    assert workspace.voice_for_speaker("ELENA", cast, "af_heart") == "bf_emma"
    # Unknown name: the run continues in the narrator's voice rather than
    # failing. A misspelling in one paragraph must not stop a book.
    assert workspace.voice_for_speaker("Marcus", cast, "af_heart") == "af_heart"
    assert workspace.voice_for_speaker("", cast, "af_heart") == "af_heart"


def test_a_speaker_with_no_voice_yet_reads_as_the_narrator():
    # Added to the cast but not yet given a voice: audible continuity
    # beats a crash or a silent gap.
    cast = workspace.speakers({"speakers": [{"display_name": "Elena"}]})
    assert workspace.voice_for_speaker("Elena", cast, "af_heart") == "af_heart"


def test_unknown_names_are_reported_at_save_time(tmp_path):
    manifest = {"selected_voice": "af_heart",
                "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}]}
    warnings = workspace.unknown_speaker_warnings(
        '[voice:Elena]a[/voice] [voice:Marcus]b[/voice]', manifest)
    assert len(warnings) == 1
    assert "Marcus" in warnings[0]
    assert "read by the narrator" in warnings[0]


# ── End to end ────────────────────────────────────────────────────────────────

def _workspace(tmp_path) -> str:
    src = tmp_path / "book.md"
    src.write_text(
        '# Chapter 1\n\nThe gate stood open.\n\n'
        '[voice:Elena]"This cannot continue," she said.[/voice]\n',
        encoding="utf-8",
    )
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "Cast Test",
    })
    assert response.status_code == 200, response.text
    return str(ws)


def test_the_cast_endpoint_offers_the_names_the_manuscript_already_uses(tmp_path):
    # The writer wrote [voice:Elena] before opening the cast panel. Making
    # them retype the name would be the app forgetting what it just read.
    ws = _workspace(tmp_path)
    response = client.get("/api/audiobook/speakers", params={"workspace_path": ws})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [s["display_name"] for s in body["speakers"]] == ["Narrator"]
    assert body["unassigned_names"] == ["Elena"]
    assert body["single_engine"] is True


def test_saving_the_cast_round_trips_and_clears_the_unassigned_name(tmp_path):
    ws = _workspace(tmp_path)
    saved = client.put("/api/audiobook/speakers", json={
        "workspace_path": ws,
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}],
        "narrator_voice": "am_michael",
    })
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert [s["display_name"] for s in body["speakers"]] == ["Narrator", "Elena"]
    assert body["speakers"][0]["voice_id"] == "am_michael"
    assert body["unassigned_names"] == []


def test_saving_narration_warns_about_a_name_not_in_the_cast(tmp_path):
    ws = _workspace(tmp_path)
    response = client.put("/api/audiobook/narration", json={
        "workspace_path": ws,
        "content": '# Chapter 1\n\n[voice:Marcus]"It already has."[/voice]\n',
    })
    assert response.status_code == 200, response.text
    assert any("Marcus" in w for w in response.json()["warnings"])


def test_generation_narrates_each_speaker_in_their_own_voice(tmp_path):
    from tests.test_audiobook_generation import FakeBackend

    ws = _workspace(tmp_path)
    client.put("/api/audiobook/speakers", json={
        "workspace_path": ws,
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}],
    })

    used: list[tuple[str, str]] = []

    class VoiceSpy(FakeBackend):
        def synthesize(self, text, voice_id, speed=1.0):
            used.append((text[:12], voice_id))
            return super().synthesize(text, voice_id)

    generation.start_run(ws, VoiceSpy(), voice_id="af_heart")
    generation.wait_for_idle()

    assert ("The gate sto", "af_heart") in used
    assert any(voice == "bf_emma" for _text, voice in used)


def test_recasting_a_character_requeues_only_her_lines(tmp_path):
    from tests.test_audiobook_generation import FakeBackend

    ws = _workspace(tmp_path)
    client.put("/api/audiobook/speakers", json={
        "workspace_path": ws,
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}],
    })
    generation.start_run(ws, FakeBackend(), voice_id="af_heart")
    generation.wait_for_idle()

    # Give Elena a different voice. The manuscript does not change.
    client.put("/api/audiobook/speakers", json={
        "workspace_path": ws,
        "speakers": [{"display_name": "Elena", "voice_id": "af_bella"}],
    })

    run = generation.start_run(ws, FakeBackend(), voice_id="af_heart")
    assert run["total_segments"] == 1          # her line only
    generation.wait_for_idle()


def test_a_cast_book_is_not_permanently_outdated(tmp_path):
    # The trap this closes: audio_status compared every segment against
    # the NARRATOR's voice, so a book with any dialogue span would report
    # itself outdated forever and nag for a re-render that changes nothing.
    from tests.test_audiobook_generation import FakeBackend

    ws = _workspace(tmp_path)
    client.put("/api/audiobook/speakers", json={
        "workspace_path": ws,
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}],
    })
    generation.start_run(ws, FakeBackend(), voice_id="af_heart")
    generation.wait_for_idle()

    status = generation.audio_status(ws)
    assert status["book"] == "current"
    assert status["outdated_segments"] == 0


def test_markers_module_names_the_narrator_once(tmp_path):
    # One spelling of the fallback name, shared by the parser and the
    # cast, so "Narrator" can never mean two different things.
    assert markers.NARRATOR == workspace.NARRATOR_NAME


# ── The two rosters the Cast panel reads (live-testing feedback) ─────────────

def test_voice_options_always_offer_the_local_roster(tmp_path, monkeypatch):
    # Live finding: choosing a hosted print engine greyed out EVERY local
    # voice, which were the ones the writer had been drafting with all
    # along. Availability is not "is this the current engine" -- the app
    # has two passes at once, and the free one is always available.
    from app.audiobook import local_worker

    monkeypatch.setattr(local_worker, "list_voices", lambda: [
        {"id": "af_heart", "label": "Heart (American female)"},
        {"id": "bf_emma", "label": "Emma (British female)"},
    ])
    monkeypatch.setattr("app.settings_store.load_settings", lambda: {
        # A hosted print engine IS chosen, with a working key.
        "audiobook_tts_provider": "openrouter",
        "audiobook_tts_model": "deepgram/aura-2",
        "openrouter_api_key": "sk-test",
    })
    ws = _workspace(tmp_path)
    body = client.get("/api/audiobook/voice-options",
                      params={"workspace_path": ws}).json()

    assert body["draft"]["installed"] is True
    assert len(body["draft"]["voices"]) == 2
    assert body["draft"]["note"] == ""


def test_voice_options_offer_the_chosen_print_engine_when_its_key_is_connected(
        tmp_path, monkeypatch):
    from app.audiobook import local_worker

    monkeypatch.setattr(local_worker, "list_voices", lambda: [])
    monkeypatch.setattr("app.settings_store.load_settings", lambda: {
        "audiobook_tts_provider": "openrouter",
        "audiobook_tts_model": "deepgram/aura-2",
        "openrouter_api_key": "sk-test",
    })
    ws = _workspace(tmp_path)
    body = client.get("/api/audiobook/voice-options",
                      params={"workspace_path": ws}).json()

    assert body["print"]["configured"] is True
    assert body["print"]["has_api_key"] is True
    assert body["print"]["voices"], "a connected engine must offer its voices"
    assert body["print"]["note"] == ""
    assert "Aura-2" in body["print"]["label"]


def test_voice_options_do_not_warn_about_engines_nobody_chose(tmp_path, monkeypatch):
    # Live finding: the panel opened with five alert tiles for engines
    # the writer had never selected. An engine nobody picked is not a
    # problem to be alerted about.
    from app.audiobook import local_worker

    monkeypatch.setattr(local_worker, "list_voices", lambda: [
        {"id": "af_heart", "label": "Heart"}])
    monkeypatch.setattr("app.settings_store.load_settings", lambda: {})
    ws = _workspace(tmp_path)
    body = client.get("/api/audiobook/voice-options",
                      params={"workspace_path": ws}).json()

    # Exactly two rosters come back, never a list of every engine.
    assert set(body) == {"draft", "print"}
    assert body["print"]["configured"] is False
    assert body["print"]["voices"] == []
    # And the local roster is unaffected by there being no print engine.
    assert body["draft"]["voices"]


def test_voice_options_say_when_the_print_engine_has_no_key(tmp_path, monkeypatch):
    from app.audiobook import local_worker

    monkeypatch.setattr(local_worker, "list_voices", lambda: [])
    monkeypatch.setattr("app.settings_store.load_settings", lambda: {
        "audiobook_tts_provider": "openrouter",
        "audiobook_tts_model": "deepgram/aura-2",
    })
    ws = _workspace(tmp_path)
    body = client.get("/api/audiobook/voice-options",
                      params={"workspace_path": ws}).json()
    assert body["print"]["has_api_key"] is False
    assert "API key is connected" in body["print"]["note"]


def test_voice_options_admit_when_the_local_engine_is_not_installed(tmp_path, monkeypatch):
    # An empty dropdown with no explanation reads as a broken feature.
    from app.audiobook import local_worker

    def explode():
        raise RuntimeError("not installed")

    monkeypatch.setattr(local_worker, "list_voices", explode)
    monkeypatch.setattr("app.settings_store.load_settings", lambda: {})
    ws = _workspace(tmp_path)
    body = client.get("/api/audiobook/voice-options",
                      params={"workspace_path": ws}).json()
    assert body["draft"]["voices"] == []
    assert body["draft"]["installed"] is False
    assert "not installed yet" in body["draft"]["note"]


# ── Two voices per speaker, one per pass ─────────────────────────────────────

def test_a_speaker_holds_a_draft_voice_and_a_print_voice():
    cast = workspace.speakers({
        "selected_voice": "af_heart",
        "selected_premium_voice": "thalia",
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma",
                      "premium_voice_id": "asteria"}],
    })
    # Drafting uses the local roster...
    assert workspace.voice_for_speaker("Elena", cast, "af_heart") == "bf_emma"
    # ...and printing uses the hosted one. Sending "bf_emma" to a hosted
    # engine that never heard of it would fail line by line.
    assert workspace.voice_for_speaker(
        "Elena", cast, "thalia", premium=True) == "asteria"


def test_a_speaker_with_no_print_voice_falls_back_to_the_narrators():
    # Half-cast books are the normal state during a print pass. Falling
    # back to the run's voice keeps the book generating.
    cast = workspace.speakers({
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}]})
    assert workspace.voice_for_speaker(
        "Elena", cast, "thalia", premium=True) == "thalia"


def test_the_narrators_print_voice_is_the_books_premium_voice():
    # One field, written by both the Premium panel and the cast, so the
    # two can never disagree about who narrates a print pass.
    cast = workspace.speakers({"selected_premium_voice": "thalia"})
    assert cast[0]["premium_voice_id"] == "thalia"
