# ai/sanitizer.py -- Em Dash Sanitizer
# =======================================
# Enforces the no-em-dash rule at the OUTPUT layer.
#
# The rule is enforced at THREE layers (from 04-ai-assistants-and-routing.md):
#   1. Prompt layer    -- every system prompt explicitly bans em dashes
#   2. Sanitizer layer -- THIS FILE -- post-process all model output
#   3. Style guide     -- the project's style guide Markdown records the rule
#
# Why do we need all three?
# Models don't always follow instructions perfectly, especially for
# punctuation habits they've absorbed from training data. The sanitizer
# is the safety net that catches any em dashes that slip through despite
# the prompt instruction.
#
# Unicode reference:
#   Em dash:  — (U+2014) -- the long dash, like this—example
#   En dash:  – (U+2013) -- the medium dash, like this–example
#   Minus:    - (U+002D) -- the standard hyphen/minus, always allowed
#
# Policy: replace all em dashes and en dashes with " -- " (double hyphen
# with spaces), which is the project's approved alternative.

import re


def sanitize(text: str) -> str:
    """
    Remove all em dashes and en dashes from AI output, replacing them
    with ' -- ' (double hyphen with surrounding spaces).

    This is called on every piece of text the model returns before it
    reaches the frontend.

    Examples:
      "He waited--then left."  -> unchanged (double hyphen is already correct)
      "He waited\u2014then left." -> "He waited -- then left."
      "Pages 10\u201320"          -> "Pages 10 -- 20"
    """
    # Replace em dash (U+2014)
    text = text.replace("\u2014", " -- ")
    # Replace en dash (U+2013)
    text = text.replace("\u2013", " -- ")
    # Clean up any accidental triple or quadruple spaces from the substitution
    text = re.sub(r"  +", " ", text)
    return text


def contains_em_dash(text: str) -> bool:
    """
    Returns True if the text contains an em or en dash.
    Used for logging/debugging to detect when models ignore the prompt instruction.
    """
    return "\u2014" in text or "\u2013" in text


def sanitize_chat(text: str) -> str:
    """
    Sanitize a profile chat response.

    Applies two passes:
      1. sanitize() -- converts actual em/en dash characters to ', '
      2. Replaces ' -- ' (double hyphen with spaces) with ', '

    Why the second pass?
    The writing assistants use ' -- ' as an approved alternative to em dashes
    in prose suggestions, so we can't remove it globally. But in the profile
    chat, ' -- ' is almost always being used as a dash substitute (connector,
    elaboration, or parenthetical) where a comma or colon is more appropriate.
    Replacing it here enforces the "use commas, parentheses, colons, or
    semicolons instead" rule that the prompt instructs but models often ignore.

    Note: this does NOT affect the writing assistant pipeline, which uses
    sanitize() and sanitize_dict() separately.
    """
    # Pass 1: replace actual em/en dash characters
    text = sanitize(text)
    # Pass 2: replace double-hyphen dash constructs with a comma
    # ' -- ' → ', '  (connector/elaborator use)
    # ' --\n' → ':\n' (list intro use)
    import re
    text = re.sub(r'\s--\s', ', ', text)
    text = re.sub(r'\s--\n', ':\n', text)
    return text


def sanitize_dict(data: dict) -> dict:
    """
    Recursively walk a nested dict/list structure and sanitize all string values.
    Used to clean the entire parsed JSON response from a model in one pass.

    Example:
      {"summary": "Good\u2014but wordy", "suggestions": [...]}
      -> {"summary": "Good -- but wordy", "suggestions": [...]}
    """
    if isinstance(data, dict):
        return {k: sanitize_dict(v) for k, v in data.items()}
    if isinstance(data, list):
        return [sanitize_dict(item) for item in data]
    if isinstance(data, str):
        return sanitize(data)
    return data
