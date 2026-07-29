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
    resolve_say_markers,
    strip_say_markers,
)


@pytest.fixture(autouse=True)
def _isolated_global_rules(tmp_path, monkeypatch):
    # Never let a test read or write the real ~/.storythread file.
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


def test_whole_word_substitution_only():
    rules = [PronunciationRule("Kae", "kay")]
    # "Kae" as a word changes; "Kaelith" (contains it) must not.
    out = apply_pronunciations("Kae met Kaelith.", rules)
    assert out == "kay met Kaelith."


# ── speakable(): caps-for-stress must not become spelled-out acronyms ────────

def test_spoken_forms_are_flattened_and_fused_for_the_engine():
    # Two live bugs pinned at once: espeak reads ALL-CAPS tokens as
    # acronyms ("LAR-uh" came out "L, A, R, uh"), and a syllable boundary
    # left as a space or hyphen becomes an audible hesitation ("Lar... a").
    # Spoken forms lowercase the caps AND fuse hyphenated syllables; the
    # dictionary file keeps the writer's "LAR-uh".
    from app.audiobook.pronunciation import speakable
    assert speakable("LAR-uh") == "laruh"
    assert speakable("LOR-ah") == "lorah"
    assert speakable("LAIR-ah") == "lairah"
    assert speakable("KAY-lith") == "kaylith"
    assert speakable("luh-THAY-oh") == "luhthayoh"
    # Mixed case and real multi-word forms pass through untouched --
    # spaces the writer typed stay word breaks.
    assert speakable("McRae") == "McRae"
    assert speakable("Doctor Vex") == "Doctor Vex"


def test_apply_flattens_spoken_text_in_payload_only():
    rules = [PronunciationRule("Lara", "LAR-uh")]
    assert apply_pronunciations("Lara climbed.", rules) == "laruh climbed."


def test_say_markers_flatten_their_spoken_form_too():
    assert resolve_say_markers("[say:LAR-uh]Lara[/say] climbed.") == "laruh climbed."


def test_case_insensitive_by_default_and_sensitive_on_request():
    insensitive = [PronunciationRule("kaelith", "KAY-lith")]
    assert apply_pronunciations("Kaelith spoke.", insensitive) == "kaylith spoke."

    sensitive = [PronunciationRule("Vex", "VEKS", case_sensitive=True)]
    assert apply_pronunciations("Vex met the vex hex.", sensitive) == "veks met the vex hex."


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
    assert out == "kaylith paused—listening."


def test_effective_rules_merges_workspace_then_global(tmp_path):
    workspace = tmp_path / "ws"
    (workspace / "manuscript").mkdir(parents=True)
    pronunciation.save_workspace_rules(str(workspace), [
        PronunciationRule("Kaelith", "KAY-lith", scope="audiobook"),
    ])
    pronunciation.save_global_rules([
        PronunciationRule("Reyes", "RAY-ess", scope="all"),
    ])

    rules = pronunciation.effective_rules(str(workspace))
    # Workspace first -- a per-book rule wins over a global one.
    assert [r.display_text for r in rules] == ["Kaelith", "Reyes"]


def test_legacy_occurrence_scope_loads_as_audiobook(tmp_path):
    # Files written before the [say] design may carry scope "occurrence";
    # they migrate to audiobook scope instead of being dropped.
    workspace = tmp_path / "ws"
    (workspace / "manuscript").mkdir(parents=True)
    with open(pronunciation.workspace_rules_path(str(workspace)), "w", encoding="utf-8") as f:
        json.dump([{"display_text": "Old", "spoken_text": "OLD", "scope": "occurrence"}], f)
    rules = pronunciation.load_workspace_rules(str(workspace))
    assert rules[0].scope == "audiobook"


# ── Inline [say] overrides ────────────────────────────────────────────────────

def test_say_marker_payload_and_display_sides():
    text = "She met [say:KAY-lith]Kaelith[/say] at the gate."
    assert resolve_say_markers(text) == "She met kaylith at the gate."
    assert strip_say_markers(text) == "She met Kaelith at the gate."


def test_say_marker_wins_over_dictionary_for_its_span():
    rules = [PronunciationRule("Kaelith", "kuh-LEETH")]
    text = "[say:KAY-lith]Kaelith[/say] smiled. Kaelith left."
    out = prepare_tts_text(text, rules)
    # The marked occurrence uses the writer's explicit form; the unmarked
    # occurrence falls through to the dictionary rule. Both fused.
    assert out == "kaylith smiled. kuhleeth left."


def test_say_marker_case_insensitive_and_multiline():
    text = "[SAY:two words]something\nspanning lines[/say] end."
    assert resolve_say_markers(text) == "two words end."


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
