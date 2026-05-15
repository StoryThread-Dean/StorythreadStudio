# outline_frontmatter.py -- Read YAML frontmatter from outline.md
# =================================================================
# The Outline templates (see outline_templates.py) write a YAML frontmatter
# block at the very top of every new outline. The block holds machine-readable
# planning data the Writing Progress gauge needs: target word count, expected
# character / location / lore / relationship lists, and optional per-chapter
# word targets.
#
# This module reads that block back out. It's intentionally permissive:
#   - Missing frontmatter? Return an empty dict. The gauge falls back to
#     per-template defaults from outline_templates.TEMPLATE_DEFAULTS.
#   - Malformed YAML? Return an empty dict and log a warning. We don't want
#     the gauge to crash mid-edit when the writer hasn't finished typing.
#   - Unexpected fields? Pass them through unchanged. Future-friendly.
#
# Why permissive?
# Writers will be editing this YAML block by hand in v1.0.2 (a form widget
# is on the roadmap for a later release). The block WILL be in a malformed
# state mid-keystroke. The gauge polls progress on a timer, so robustness
# matters more than strictness.

import logging
import re
from typing import Any

import yaml

log = logging.getLogger(__name__)


# Matches a YAML frontmatter block at the very start of a file:
#   - Begins with `---` on its own line at the very start
#   - Captures everything up to the next `---` on its own line
#   - re.DOTALL so `.` matches newlines inside the capture group
#
# The `\A` anchor means "start of string" (stricter than `^` which would
# match the start of any line under re.MULTILINE). YAML frontmatter is only
# valid at the very top of the file -- anything else looks like a horizontal
# rule and shouldn't be parsed as metadata.
_FRONTMATTER_RE = re.compile(
    r"\A---\s*\n(?P<body>.*?)\n---\s*(?:\n|$)",
    re.DOTALL,
)


def parse_outline_frontmatter(outline_text: str) -> dict[str, Any]:
    """
    Extract the YAML frontmatter block from the top of an outline.md file.

    Returns an empty dict if no frontmatter is present or the YAML is
    malformed. Never raises.

    Example:
        >>> text = "---\\ntarget_word_count: 90000\\n---\\n\\nBody here"
        >>> parse_outline_frontmatter(text)
        {'target_word_count': 90000}
    """
    if not outline_text:
        return {}

    match = _FRONTMATTER_RE.match(outline_text)
    if not match:
        return {}

    try:
        data = yaml.safe_load(match.group("body"))
    except yaml.YAMLError as exc:
        # Don't crash the gauge mid-edit. Log so the writer can see what went
        # wrong in the backend log if they're debugging, but return {} so the
        # caller falls back to defaults.
        log.warning("outline frontmatter YAML parse failed: %s", exc)
        return {}

    # yaml.safe_load returns None for an empty document. Treat that as
    # "no data" rather than letting None leak to the caller.
    if not isinstance(data, dict):
        return {}

    return data


def strip_outline_frontmatter(outline_text: str) -> str:
    """
    Return the outline body with the YAML frontmatter block removed.

    Useful when computing word counts of the outline -- the YAML lines and
    teaching `#` comments would otherwise inflate the count past any
    "meaningfully populated" threshold.
    """
    if not outline_text:
        return ""

    match = _FRONTMATTER_RE.match(outline_text)
    if not match:
        return outline_text

    return outline_text[match.end():]
