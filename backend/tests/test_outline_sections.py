# tests/test_outline_sections.py
# ================================
# Unit tests for outline section parsing and corruption healing.
#
# These tests guard against a class of corruption where the YAML closing ---
# gets fused with a ## section heading on the same line (e.g. "---## Setting").
# This happens when _reconstruct_outline writes a preamble that doesn't start
# with \n. The result is sections become permanently invisible in the Planner
# and a subsequent Planner save deletes them from the file entirely.

import pytest
from app.routers.documents import (
    _parse_outline_sections,
    _reconstruct_outline,
    _FUSED_SEPARATOR_RE,
)


# ── _parse_outline_sections: normal cases ───────────────────────────────────

def test_parse_sections_normal():
    """A well-formed body (from strip_outline_frontmatter) returns all sections."""
    body = (
        "\n<!-- comment -->\n\n# Outline\n\n_desc_\n\n---\n\n"
        "## Front Matter\n\nfront content\n\n---\n"
        "## Setting in One Paragraph\n\nsetting content\n"
    )
    preamble, sections = _parse_outline_sections(body)
    headings = [s["heading"] for s in sections]
    assert headings == ["Front Matter", "Setting in One Paragraph"]
    assert sections[0]["content"] == "front content"
    assert sections[1]["content"] == "setting content"


def test_parse_sections_empty_body():
    preamble, sections = _parse_outline_sections("")
    assert preamble == ""
    assert sections == []


def test_parse_sections_no_headings():
    body = "\nJust some text with no ## headings.\n"
    preamble, sections = _parse_outline_sections(body)
    assert sections == []
    assert "Just some text" in preamble


# ── Healing: ## at position 0 (no preceding \n) ─────────────────────────────

def test_parse_sections_heading_at_position_zero():
    """A body starting with ## (no preceding newline) must not be swallowed into preamble.
    This happens when strip_outline_frontmatter returns a body that begins directly
    with a section heading (no blank line after the YAML closing ---)."""
    body = "## Setting in One Paragraph\n\nsetting content\n\n---\n\n## Act I\n\nact content"
    preamble, sections = _parse_outline_sections(body)
    headings = [s["heading"] for s in sections]
    assert "Setting in One Paragraph" in headings, (
        "Section at position 0 must be recognized, not absorbed into preamble"
    )
    assert "Act I" in headings


def test_parse_sections_heading_at_position_zero_preamble_is_empty():
    """When the body starts directly with ##, preamble should be empty (or just whitespace)."""
    body = "## Only Section\n\ncontent here"
    preamble, sections = _parse_outline_sections(body)
    assert sections[0]["heading"] == "Only Section"
    assert preamble.strip() == ""


# ── Healing: fused ---## corruption ─────────────────────────────────────────

def test_fused_separator_regex_matches():
    """The regex detects ---## at the start of a line."""
    assert _FUSED_SEPARATOR_RE.search("---## Setting in One Paragraph\n")
    assert _FUSED_SEPARATOR_RE.search("---\nYAML\n---## Heading\ncontent")


def test_fused_separator_regex_no_false_positive():
    """The regex must not match --- on its own line or ## not preceded by ---."""
    assert not _FUSED_SEPARATOR_RE.search("---\n## Heading\n")
    assert not _FUSED_SEPARATOR_RE.search("## Heading\n")
    assert not _FUSED_SEPARATOR_RE.search("---\n\n## Heading\n")


def test_parse_sections_auto_heals_fused_separator():
    """A body containing ---## (the known corruption pattern) is healed automatically.
    Without healing, the fused heading is never matched by _SECTION_SPLIT_RE and
    the section's content is absorbed into preamble."""
    # Simulate what strip_outline_frontmatter returns when the raw file has:
    # chapters: []\n---## Setting in One Paragraph\n...\n\n---\n\n## Act I\n...
    # The frontmatter regex over-reaches and body starts after the first bare ---
    body = (
        "\n---## Setting in One Paragraph\n\nsetting content\n\n- _..._\n\n---\n\n"
        "## Act I\n\nact content"
    )
    preamble, sections = _parse_outline_sections(body)
    headings = [s["heading"] for s in sections]
    assert "Setting in One Paragraph" in headings, (
        "---## fusion must be healed so the section becomes visible"
    )
    assert "Act I" in headings


def test_parse_sections_healed_content_is_correct():
    """After healing a ---## fusion, the section's content is the text after the heading."""
    body = "---## My Section\n\nmy content here\n\n---\n\n## Next Section\n\nnext content"
    preamble, sections = _parse_outline_sections(body)
    assert sections[0]["heading"] == "My Section"
    assert sections[0]["content"] == "my content here"
    assert sections[1]["heading"] == "Next Section"


# ── _reconstruct_outline: no-fusion guarantee ────────────────────────────────

def test_reconstruct_always_newline_between_yaml_and_preamble():
    """_reconstruct_outline must never fuse the YAML closing --- with preamble content.
    Even when preamble starts with ## (no leading newline), the output must have
    a newline separator so the frontmatter regex can close correctly on next parse."""
    fm_block = "---\ntarget_word_count: 90000\n---"  # ends with --- (no trailing \n)
    preamble = "## Orphaned Section\n\nsome content"   # starts with ## (no leading \n)
    sections = [{"heading": "Act I", "content": "act content"}]

    result = _reconstruct_outline(fm_block, preamble, sections)

    # The YAML closing --- must be on its own line, not fused with ##
    assert "---## " not in result, (
        "_reconstruct_outline produced ---## fusion which breaks the frontmatter parser"
    )
    # The result must still contain all the content
    assert "## Orphaned Section" in result
    assert "## Act I" in result


def test_reconstruct_with_normal_preamble():
    """Normal preamble (starts with \n) round-trips correctly."""
    fm_block = "---\ntarget_word_count: 90000\n---"
    preamble = "\n<!-- comment -->\n\n# Outline\n\n_desc_\n\n---\n\n"
    sections = [
        {"heading": "Front Matter", "content": "fm content"},
        {"heading": "Act I", "content": "act content"},
    ]
    result = _reconstruct_outline(fm_block, preamble, sections)

    assert result.startswith("---\ntarget_word_count")
    assert "## Front Matter" in result
    assert "## Act I" in result
    assert "---## " not in result
