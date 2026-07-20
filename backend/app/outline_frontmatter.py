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
import os
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


def set_target_word_count(project_root: str, value: int) -> bool:
    """
    Write a new target_word_count into notes/outline.md's frontmatter.

    The outline frontmatter is the single source of truth for the project
    word target -- the Writing Progress gauge reads it from there. The Book
    Details panel edits the target through this helper instead of storing a
    duplicate copy in project.json, which would inevitably drift out of sync
    (two masters, one gauge).

    Approach: surgical line replacement, NOT a YAML re-serialize. The
    frontmatter contains hand-written `#` teaching comments and careful
    ordering that yaml.dump() would destroy. We only touch the one line.

    Returns True on success, False (with a logged warning) when outline.md
    is missing or has no frontmatter block -- the caller treats that as a
    soft failure, not an error, because a writer can delete outline.md.
    """
    outline_path = os.path.join(project_root, "notes", "outline.md")
    if not os.path.isfile(outline_path):
        log.warning("set_target_word_count: no outline.md in %s", project_root)
        return False

    try:
        with open(outline_path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as exc:
        log.warning("set_target_word_count: could not read outline.md: %s", exc)
        return False

    match = _FRONTMATTER_RE.match(text)
    if not match:
        log.warning("set_target_word_count: outline.md has no frontmatter block")
        return False

    body = match.group("body")
    line_re = re.compile(r"^target_word_count:.*$", re.MULTILINE)
    if line_re.search(body):
        # Replace the existing line in place, preserving everything else.
        new_body = line_re.sub(f"target_word_count: {value}", body, count=1)
    else:
        # No line yet (writer deleted it?) -- add one at the top of the block.
        new_body = f"target_word_count: {value}\n{body}"

    new_text = text[: match.start("body")] + new_body + text[match.end("body"):]

    try:
        with open(outline_path, "w", encoding="utf-8") as f:
            f.write(new_text)
    except OSError as exc:
        log.warning("set_target_word_count: could not write outline.md: %s", exc)
        return False

    return True


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
