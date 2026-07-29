# tests/test_audiobook_pronunciation.py
# ======================================
# Pronunciation substitution and TTS payload preparation. The display text
# is never rewritten anywhere -- these functions are pure text-in/text-out
# used only when building a provider payload.

import json

import pytest

from app.audiobook import pronunciation
from app.audiobook.pronunciation import (
    PronunciationRule,
    apply_pronunciations,
    normalize_for_tts,
    prepare_tts_text,
)


@pytest.fixture(autouse=True)
def _isolated_global_rules(tmp_path, monkeypatch):
    # Never let a test read or write the real ~/.storythread file.
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


def test_whole_word_substitution_only():
    rules = [PronunciationRule("Kae", "KAY")]
    # "Kae" as a word changes; "Kaelith" (contains it) must not.
    out = apply_pronunciations("Kae met Kaelith.", rules)
    assert out == "KAY met Kaelith."


def test_case_insensitive_by_default_and_sensitive_on_request():
    insensitive = [PronunciationRule("kaelith", "KAY-lith")]
    assert apply_pronunciations("Kaelith spoke.", insensitive) == "KAY-lith spoke."

    sensitive = [PronunciationRule("Vex", "VEKS", case_sensitive=True)]
    assert apply_pronunciations("Vex met the vex hex.", sensitive) == "VEKS met the vex hex."


def test_punctuation_in_display_text_is_literal():
    rules = [PronunciationRule("Dr. Vex", "Doctor Vex")]
    assert apply_pronunciations("Dr. Vex arrived.", rules) == "Doctor Vex arrived."


def test_double_hyphen_becomes_em_dash_in_payload_only():
    # ' -- ' is the Storythread house substitute; the TTS payload gets a
    # real em dash so voices read natural punctuation.
    assert normalize_for_tts("She ran -- fast.") == "She ran—fast."
    assert normalize_for_tts("She ran--fast.") == "She ran—fast."


def test_writer_authored_em_dashes_pass_through():
    assert normalize_for_tts("She paused—then ran.") == "She paused—then ran."


def test_prepare_applies_rules_before_normalization():
    rules = [PronunciationRule("Kaelith", "KAY-lith")]
    out = prepare_tts_text("Kaelith paused -- listening.", rules)
    assert out == "KAY-lith paused—listening."


def test_effective_rules_merges_workspace_then_global(tmp_path):
    workspace = tmp_path / "ws"
    (workspace / "manuscript").mkdir(parents=True)
    pronunciation.save_workspace_rules(str(workspace), [
        PronunciationRule("Kaelith", "KAY-lith", scope="audiobook"),
        PronunciationRule("later", "ignored", scope="occurrence"),   # deferred scope
    ])
    pronunciation.save_global_rules([
        PronunciationRule("Reyes", "RAY-ess", scope="all"),
    ])

    rules = pronunciation.effective_rules(str(workspace))
    names = [r.display_text for r in rules]
    # Workspace first (wins ties), occurrence-scope excluded for now.
    assert names == ["Kaelith", "Reyes"]


def test_loader_skips_malformed_entries(tmp_path):
    workspace = tmp_path / "ws"
    (workspace / "manuscript").mkdir(parents=True)
    path = pronunciation.workspace_rules_path(str(workspace))
    with open(path, "w", encoding="utf-8") as f:
        json.dump([
            {"display_text": "Good", "spoken_text": "GOOD"},
            {"display_text": "", "spoken_text": "nope"},        # empty display
            "not even a dict",
            {"display_text": "NoSpoken"},                        # missing spoken
        ], f)
    rules = pronunciation.load_workspace_rules(str(workspace))
    assert [r.display_text for r in rules] == ["Good"]


def test_corrupt_rules_file_loads_as_empty(tmp_path):
    workspace = tmp_path / "ws"
    (workspace / "manuscript").mkdir(parents=True)
    with open(pronunciation.workspace_rules_path(str(workspace)), "w") as f:
        f.write("{ not json")
    assert pronunciation.load_workspace_rules(str(workspace)) == []
