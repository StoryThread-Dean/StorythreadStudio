# tests/test_audiobook_speaker_analysis.py
# =========================================
# The AI speaker pass (spec 27.3). Every test here is a variation on one
# question: what happens when the model is WRONG?
#
# The dangerous failure is not a bad guess -- the writer sees those and
# rejects them. It is the model quoting the passage inexactly: fixing a
# typo, straightening a quotation mark, reflowing a line. If the app
# accepted that, it would wrap a [voice:...] span around words the writer
# never wrote and save them as their own prose. So the contract under
# test is: a proposal that cannot be found character for character in the
# source is dropped, every time, no matter how confident it is.

import json

import pytest
from fastapi.testclient import TestClient

from app.audiobook import pronunciation, recents_store, speaker_analysis
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


PASSAGE = (
    'The gate stood open.\n\n'
    '"This cannot continue," Elena said.\n\n'
    'Marcus turned away from her.\n\n'
    '"It already has," he answered.\n'
)


def _response(proposals) -> str:
    return json.dumps({"proposals": proposals})


# ── Verification ──────────────────────────────────────────────────────────────

def test_an_exact_quote_is_kept_with_its_offsets():
    kept, dropped = speaker_analysis.parse_response(_response([
        {"quote": '"This cannot continue,"', "speaker": "Elena",
         "confidence": 0.92, "reason": "dialogue tag"},
    ]), PASSAGE)
    assert dropped == 0
    assert kept[0]["speaker"] == "Elena"
    # Offsets, not a re-typed copy: the editor wraps the real words.
    assert PASSAGE[kept[0]["start"]:kept[0]["end"]] == '"This cannot continue,"'


def test_a_paraphrased_quote_is_dropped_however_confident_it_is():
    # THE test. A model that rewrites on the way past must not get its
    # rewrite wrapped in a marker and saved as the writer's prose.
    kept, dropped = speaker_analysis.parse_response(_response([
        {"quote": '"This can not continue,"', "speaker": "Elena", "confidence": 1.0},
    ]), PASSAGE)
    assert kept == []
    assert dropped == 1


def test_straightened_punctuation_is_also_a_paraphrase():
    # The subtlest version: curly quotes normalized to straight ones.
    # Character for character means character for character.
    passage = 'She said “Enough.” and left.'
    kept, dropped = speaker_analysis.parse_response(_response([
        {"quote": '"Enough."', "speaker": "Elena", "confidence": 0.9},
    ]), passage)
    assert kept == []
    assert dropped == 1


def test_overlapping_proposals_keep_only_the_first():
    # Two spans over the same words would nest, which the parser warns
    # about and the writer would have to untangle by hand.
    kept, dropped = speaker_analysis.parse_response(_response([
        {"quote": '"This cannot continue," Elena said.', "speaker": "Elena",
         "confidence": 0.9},
        {"quote": '"This cannot continue,"', "speaker": "Marcus", "confidence": 0.8},
    ]), PASSAGE)
    assert len(kept) == 1
    assert dropped == 1


def test_proposals_come_back_in_reading_order():
    kept, _dropped = speaker_analysis.parse_response(_response([
        {"quote": '"It already has,"', "speaker": "Marcus", "confidence": 0.8},
        {"quote": '"This cannot continue,"', "speaker": "Elena", "confidence": 0.9},
    ]), PASSAGE)
    assert [p["speaker"] for p in kept] == ["Elena", "Marcus"]


def test_a_nameless_or_empty_proposal_is_dropped():
    kept, dropped = speaker_analysis.parse_response(_response([
        {"quote": '"This cannot continue,"', "speaker": "  "},
        {"quote": "   ", "speaker": "Elena"},
        "not even an object",
    ]), PASSAGE)
    assert kept == []
    assert dropped == 3


def test_a_possessive_or_trailing_comma_is_cleaned_off_the_name():
    kept, _dropped = speaker_analysis.parse_response(_response([
        {"quote": '"This cannot continue,"', "speaker": "Elena,", "confidence": 0.7},
    ]), PASSAGE)
    assert kept[0]["speaker"] == "Elena"


def test_confidence_is_clamped_and_survives_junk():
    kept, _dropped = speaker_analysis.parse_response(_response([
        {"quote": '"This cannot continue,"', "speaker": "Elena", "confidence": 4},
        {"quote": '"It already has,"', "speaker": "Marcus", "confidence": "very"},
    ]), PASSAGE)
    assert kept[0]["confidence"] == 1.0
    assert kept[1]["confidence"] == 0.0


def test_unparseable_output_is_an_empty_pass_not_an_error():
    # A failed analysis is a feature that found nothing, not a broken
    # workspace -- the writer can simply try again.
    assert speaker_analysis.parse_response("I'm afraid I can't do that", PASSAGE) == ([], 0)
    assert speaker_analysis.parse_response("[1, 2, 3]", PASSAGE) == ([], 0)


# ── The prompt ────────────────────────────────────────────────────────────────

def test_the_prompt_forbids_rewriting_and_demands_exact_quotes():
    prompt = speaker_analysis.SPEAKER_ANALYSIS_PROMPT
    assert "QUOTE EXACTLY" in prompt
    assert "Do not fix typos" in prompt
    assert "Do not rewrite" in prompt
    # House rule, in every prompt that produces text.
    assert "em dash" in prompt
    assert "—" not in prompt and "–" not in prompt
    # Guessing confidently is the expensive mistake: a wrong voice is
    # heard by every listener.
    assert "below 0.5" in prompt


def test_the_user_message_names_the_existing_cast():
    # Without it the model invents a new spelling for a character who is
    # already in the book, and every one of those reads to the writer as
    # the feature not working.
    message = speaker_analysis.build_user_message("She spoke.", ["Elena", "Marcus"])
    assert "Elena, Marcus" in message
    assert "BEGIN PASSAGE" in message
    # No cast yet: no dangling sentence about an empty list.
    assert "already in this audiobook's cast" not in \
        speaker_analysis.build_user_message("She spoke.", [])


# ── The endpoint ──────────────────────────────────────────────────────────────

def _workspace(tmp_path) -> str:
    src = tmp_path / "book.md"
    src.write_text(f"# Chapter 1\n\n{PASSAGE}", encoding="utf-8")
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": str(src), "workspace_path": str(ws), "title": "Cast",
    })
    assert response.status_code == 200, response.text
    return str(ws)


def _fake_completion(payload: str):
    async def _run(**kwargs):
        _fake_completion.last_kwargs = kwargs
        return {"choices": [{"message": {"content": payload}}]}
    return _run


def test_the_endpoint_proposes_and_flags_who_is_not_in_the_cast_yet(tmp_path, monkeypatch):
    ws = _workspace(tmp_path)
    client.put("/api/audiobook/speakers", json={
        "workspace_path": ws,
        "speakers": [{"display_name": "Elena", "voice_id": "bf_emma"}],
    })
    monkeypatch.setattr("app.routers.ai._resolve_model_and_key",
                        lambda override: (__import__("app.ai.providers", fromlist=["OPENROUTER"]).OPENROUTER,
                                          "sk-test", "some/model"))
    monkeypatch.setattr("app.ai.openrouter.run_completion", _fake_completion(_response([
        {"quote": '"This cannot continue,"', "speaker": "Elena", "confidence": 0.9},
        {"quote": '"It already has,"', "speaker": "Marcus", "confidence": 0.8},
        {"quote": '"a line nobody wrote"', "speaker": "Elena", "confidence": 0.99},
    ])))

    response = client.post("/api/audiobook/analyze-speakers", json={
        "workspace_path": ws, "text": PASSAGE})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [p["speaker"] for p in body["proposals"]] == ["Elena", "Marcus"]
    assert body["proposals"][0]["in_cast"] is True
    assert body["proposals"][1]["in_cast"] is False      # Marcus needs adding
    # The invented line was dropped, and the count is reported rather
    # than hidden -- otherwise a discarding pass looks like a model that
    # found nothing.
    assert body["dropped"] == 1


def test_the_endpoint_refuses_a_passage_too_long_to_analyse(tmp_path):
    ws = _workspace(tmp_path)
    response = client.post("/api/audiobook/analyze-speakers", json={
        "workspace_path": ws, "text": "x" * 30001})
    assert response.status_code == 400
    assert "a chapter at a time" in response.json()["detail"]


def test_the_endpoint_writes_nothing(tmp_path, monkeypatch):
    # The AI write boundary: proposals go to the writer, never to a file.
    ws = _workspace(tmp_path)
    from app.audiobook import workspace as ws_mod
    before = ws_mod.read_narration(ws)
    monkeypatch.setattr("app.routers.ai._resolve_model_and_key",
                        lambda override: (__import__("app.ai.providers", fromlist=["OPENROUTER"]).OPENROUTER,
                                          "sk-test", "some/model"))
    monkeypatch.setattr("app.ai.openrouter.run_completion", _fake_completion(_response([
        {"quote": '"This cannot continue,"', "speaker": "Elena", "confidence": 0.9},
    ])))
    client.post("/api/audiobook/analyze-speakers", json={
        "workspace_path": ws, "text": PASSAGE})
    assert ws_mod.read_narration(ws) == before
