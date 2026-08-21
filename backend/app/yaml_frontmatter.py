# yaml_frontmatter.py -- Read a YAML frontmatter block from a Markdown file
# ==========================================================================
# A `---` block at the very top of a Markdown file, holding machine-readable
# fields. Two callers, and the second one is the reason this module is not
# named after the first:
#
#   PROFILES     progress.py::_profile_name_from_file reads a profile's
#                `name:` field with this. Profiles have used the same
#                convention since long before the Outline did.
#
#   THE HEALER   outline_worksheet.heal_outline reads the OLD outline block
#                when converting a pre-v2.0.2 project to the worksheet.
#
# It used to be called outline_frontmatter.py, which was already only half
# true and became a lie when the Outline stopped carrying frontmatter at all.
# `set_target_word_count` lived here too and has moved to outline_worksheet.py,
# where the thing it writes actually lives.
#
# Deliberately permissive, and that has not changed:
#   - Missing frontmatter? Empty dict.
#   - Malformed YAML? Empty dict and a logged warning. A file being edited by
#     hand is malformed between keystrokes, and the progress gauge polls on a
#     timer -- robustness matters more than strictness here.
#   - Unexpected fields? Passed through unchanged.

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


def parse_yaml_frontmatter(text: str) -> dict[str, Any]:
    """
    Extract the YAML frontmatter block from the top of an outline.md file.

    Returns an empty dict if no frontmatter is present or the YAML is
    malformed. Never raises.

    Example:
        >>> text = "---\\ntarget_word_count: 90000\\n---\\n\\nBody here"
        >>> parse_yaml_frontmatter(text)
        {'target_word_count': 90000}
    """
    if not text:
        return {}

    match = _FRONTMATTER_RE.match(text)
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


# set_target_word_count used to live here. It moved to
# outline_worksheet.py, next to the worksheet line it now writes --
# this module reads a YAML block and has no business editing outlines.


def strip_yaml_frontmatter(text: str) -> str:
    """
    Return the outline body with the YAML frontmatter block removed.

    Useful when computing word counts of the outline -- the YAML lines and
    teaching `#` comments would otherwise inflate the count past any
    "meaningfully populated" threshold.
    """
    if not text:
        return ""

    match = _FRONTMATTER_RE.match(text)
    if not match:
        return text

    return text[match.end():]
