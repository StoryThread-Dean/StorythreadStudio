# tests/test_hidden_trait_promise.py -- what the app says about hidden traits
# ===========================================================================
# "Hidden traits are never sent to the AI" has now been wrong in three places,
# and each time it was found by reading rather than by using the app, because a
# false promise about privacy produces no error:
#
#   1. A comment in profiles.py, deleted under recovery task R1.5a.
#   2. The system prompt for "How AI uses this" -- the feature whose entire job
#      is explaining how AI will use a trait.
#   3. The Importance Audit's prompt, which went further and told the model to
#      advise the writer to DEMOTE a hidden trait "that would improve AI
#      accuracy" -- advice that buys accuracy the writer already has and pays
#      for it with the secret.
#
# The truth: a hidden trait IS sent. What protects it is an instruction not to
# name it (see READING IMPORTANCE LABELS in prompts.py), not withholding.
#
# This file exists because the claim keeps coming back. It reads the real prompt
# text, so a well-meaning edit that reintroduces the falsehood fails the build.

import inspect

from app.ai import prompts

# Every prompt builder that takes no arguments, so this sweeps the whole module
# rather than a list somebody has to remember to extend.
NO_ARG_BUILDERS = [
    (name, fn) for name, fn in vars(prompts).items()
    if callable(fn) and not name.startswith("_")
    and inspect.isfunction(fn)
    and not inspect.signature(fn).parameters
]


def _all_prompt_text() -> list[tuple[str, str]]:
    """(where, text) for every prompt this module can produce without inputs,
    plus the module-level constants, which is where the base system prompt
    lives."""
    out: list[tuple[str, str]] = []
    for name, fn in NO_ARG_BUILDERS:
        try:
            result = fn()
        except Exception:                      # noqa: BLE001 - a builder that
            continue                           # needs context is covered below
        if isinstance(result, str):
            out.append((name, result))
    for name, value in vars(prompts).items():
        if name.isupper() and isinstance(value, str):
            out.append((name, value))
    return out


def test_no_prompt_claims_a_hidden_trait_is_never_sent():
    # The exact sentence, in any casing, anywhere the model can read it.
    for where, text in _all_prompt_text():
        lowered = text.lower()
        assert "never sent to ai" not in lowered, where
        assert "writer-only reference" not in lowered, where
        assert "writer-only notes, never sent" not in lowered, where


def test_the_builders_that_explain_importance_say_what_hidden_really_does():
    # Both of these list the importance levels for the model. Whatever they say
    # about hidden, it has to be the truth: sent, used, never named.
    for builder in (prompts.generate_usage_preview_prompt,
                    prompts.audit_importance_prompt):
        text = builder().lower()
        assert "hidden" in text
        assert "sent" in text
        assert "never name" in text or "never named" in text, builder.__name__


def test_the_audit_never_advises_trading_a_secret_for_accuracy():
    # It used to say: "A 'hidden' trait that would improve AI accuracy ->
    # suggest 'contextual' or higher". Following that on the villain whose
    # parents died in a hospital would let the model write the reason out loud.
    text = prompts.audit_importance_prompt()
    assert "suggest 'contextual' or higher" not in text
    assert "never suggest moving a 'hidden' trait" in text.lower()


def test_the_base_prompt_still_forbids_naming_one():
    # The protection itself. If this ever goes, hidden traits become ordinary
    # text and nothing else in the system notices.
    text = prompts.BASE_SYSTEM_PROMPT if hasattr(prompts, "BASE_SYSTEM_PROMPT") \
        else "\n".join(t for _, t in _all_prompt_text())
    lowered = text.lower()
    assert "never name" in lowered
    assert "influence material" in lowered


def test_feedback_may_name_it_but_prose_may_not():
    # The distinction the two analytical paths were missing. A consistency check
    # writes to the WRITER, who wrote the trait; being vague about their own
    # note helps nobody. The rule protects the manuscript, not the writer.
    pass_prompt = prompts.build_editor_pass_system_prompt("context", [], "general")
    chat_prompt = prompts.build_editor_chat_system_prompt("context", "general")
    for where, text in (("editor pass", pass_prompt), ("editor chat", chat_prompt)):
        lowered = text.lower()
        assert "may name" in lowered, where
        # And still refuses to put it in prose.
        assert "behaviour" in lowered or "behavior" in lowered, where
