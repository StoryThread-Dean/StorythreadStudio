# tests/test_profile_chat_prompts.py -- Profile Companion prompt guardrails
# ===========================================================================
# First test coverage for build_profile_chat_system_prompt, added alongside
# the new "interview" behavior mode. The interview mode's contract matters:
# the AI must be the interviewer and organizer, NEVER the inventor -- these
# tests pin the prompt language that enforces that, plus the trigger/origin
# questioning style and the always-end-with-the-full-block rule.

from app.ai.prompts import (
    BASE_WRITING_ASSISTANT_CONTRACT,
    TEMPERATURE_DEFAULTS,
    _profile_chat_addendum,
    build_profile_chat_system_prompt,
)


CHARACTER_SECTIONS = [
    "Physical Traits", "Personality Traits", "Motivations", "Voice Notes",
    "Hidden and Foreshadowing Traits", "Relationships Overview", "Notes",
]


# ── The interview addendum ───────────────────────────────────────────────────

def test_interview_addendum_exists_and_is_not_the_fallback():
    text = _profile_chat_addendum("interview", "character", CHARACTER_SECTIONS)
    assert "MODE: CHARACTER INTERVIEW" in text
    assert "MODE: FALLBACK" not in text


def test_interview_is_interviewer_never_inventor():
    text = _profile_chat_addendum("interview", "character", CHARACTER_SECTIONS)
    # The governing rule, verbatim anchors:
    assert "NEVER the inventor" in text
    assert "(suggestion -- keep or discard)" in text


def test_interview_digs_for_triggers_and_origins():
    text = _profile_chat_addendum("interview", "character", CHARACTER_SECTIONS)
    assert "TRIGGERS and ORIGINS" in text
    # A trait is only done when it has both attached.
    assert "trigger and an origin" in text


def test_interview_uses_the_provided_section_labels():
    text = _profile_chat_addendum("interview", "character", CHARACTER_SECTIONS)
    assert "AVAILABLE SECTIONS: " + ", ".join(CHARACTER_SECTIONS) in text
    # And honors the frontend's "Expand these sections:" convention.
    assert "Expand these sections:" in text


def test_interview_ends_every_round_with_the_full_block():
    text = _profile_chat_addendum("interview", "character", CHARACTER_SECTIONS)
    assert "FULL updated copy/paste" in text
    # Question rounds stay small -- long interviews wander.
    assert "2-4 pointed questions" in text


def test_interview_story_context_shades_but_never_straitjackets():
    text = _profile_chat_addendum("interview", "character", CHARACTER_SECTIONS)
    assert "Shade, do not straitjacket" in text


# ── Full system prompt assembly ──────────────────────────────────────────────

def test_interview_system_prompt_includes_base_contract():
    prompt = build_profile_chat_system_prompt("interview", "character", "general", CHARACTER_SECTIONS)
    assert BASE_WRITING_ASSISTANT_CONTRACT in prompt
    assert "MODE: CHARACTER INTERVIEW" in prompt


def test_interview_system_prompt_carries_content_mode():
    prompt = build_profile_chat_system_prompt("interview", "character", "mature", CHARACTER_SECTIONS)
    assert "CONTENT MODE: MATURE" in prompt


# ── Existing modes unharmed (regression guards) ──────────────────────────────

def test_existing_modes_still_route_to_their_addenda():
    assert "MODE: GENERAL CHAT" in _profile_chat_addendum("chat", "character", None)
    assert "MODE: REFINE AND INTERPRET" in _profile_chat_addendum("refine", "character", None)
    assert "MODE: EXTRACT TRAITS" in _profile_chat_addendum("extract_traits", "character", None)
    assert "MODE: CHECK CONSISTENCY" in _profile_chat_addendum("check_consistency", "character", None)
    assert "MODE: GUIDED PROFILE BUILDING" in _profile_chat_addendum("guide", "character", None)


def test_unknown_mode_still_falls_back():
    assert "MODE: FALLBACK" in _profile_chat_addendum("no-such-mode", "character", None)


def test_interview_temperature_is_the_focused_profile_default():
    # Interview asks questions and organizes answers -- it must not take the
    # creative "generation" temperature that guide mode uses.
    assert TEMPERATURE_DEFAULTS["profile"] < TEMPERATURE_DEFAULTS["generation"]
