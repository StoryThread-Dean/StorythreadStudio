# tests/test_editor_chat_prompts.py
# ==================================
# Unit tests for the Writing Companion system-prompt builder, focused on the
# new "draft" category added so the AI can write story prose on request.
#
# These are pure-function tests: no filesystem, no DB, no network. They guard
# two things:
#   1. The "draft" prompt actually instructs prose drafting and drops the
#      conversational chat rules that produce poor prose.
#   2. The existing "chat" prompt is unchanged (regression guard) so the new
#      mode does not leak into normal discussion.

from app.ai.prompts import (
    _editor_chat_addendum,
    build_editor_chat_system_prompt,
    BASE_WRITING_ASSISTANT_CONTRACT,
    PUNCTUATION_RULE,
    _GENERAL_RESPONSE_RULES,
)


# ── The draft addendum ───────────────────────────────────────────────────────

def test_draft_addendum_instructs_prose_drafting():
    text = _editor_chat_addendum("draft")
    # It should frame the AI as writing prose, not discussing it.
    assert "Drafting story prose" in text
    assert "Write the actual story prose" in text


def test_draft_addendum_drops_conversational_chat_rules():
    # The general chat rules ("This is a chat, not a report... then stop") are
    # exactly what dilutes prose. The draft addendum must NOT include them.
    draft = _editor_chat_addendum("draft")
    assert "This is a chat, not a report" not in draft
    assert _GENERAL_RESPONSE_RULES not in draft


def test_draft_addendum_sets_segment_length_and_open_ending():
    text = _editor_chat_addendum("draft")
    assert "800" in text and "1200" in text          # segment length guidance
    assert "Continue" in text                          # tells writer they extend it


# ── The full draft system prompt ─────────────────────────────────────────────

def test_draft_system_prompt_includes_base_contract_and_punctuation_rule():
    prompt = build_editor_chat_system_prompt("draft", "general")
    # The base contract (continuation behavior, profile usage) must be present.
    assert BASE_WRITING_ASSISTANT_CONTRACT in prompt
    # The no-em-dash rule must survive into the draft prompt.
    assert PUNCTUATION_RULE in prompt
    # And the drafting role must be appended.
    assert "Drafting story prose" in prompt


def test_draft_system_prompt_does_not_carry_chat_tone():
    prompt = build_editor_chat_system_prompt("draft", "general")
    assert "This is a chat, not a report" not in prompt


# ── Regression guard: the chat prompt is unchanged ───────────────────────────

def test_chat_addendum_unchanged():
    # The general chat addendum should still describe a general companion and
    # still carry the conversational response rules. If this assertion breaks,
    # the draft work accidentally changed discussion-mode behavior.
    text = _editor_chat_addendum("chat")
    assert "General writing companion" in text
    assert "This is a chat, not a report" in text


def test_chat_system_prompt_uses_general_rules_not_draft():
    prompt = build_editor_chat_system_prompt("chat", "general")
    assert "This is a chat, not a report" in prompt
    assert "Drafting story prose" not in prompt
