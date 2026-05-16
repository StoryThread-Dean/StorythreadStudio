# tests/test_outline_frontmatter.py
# =================================
# Unit tests for the YAML frontmatter parser used by the Writing Progress
# gauge. These are pure-function tests: no filesystem, no DB, no network.
#
# The parser is deliberately permissive -- a writer editing outline.md by
# hand will leave the YAML block in a malformed state between keystrokes.
# The gauge polls progress on a timer, so "never crash on partial input"
# matters more than "reject invalid YAML loudly."

from app.outline_frontmatter import parse_outline_frontmatter, strip_outline_frontmatter


# ── parse_outline_frontmatter ────────────────────────────────────────────────

def test_parse_valid_frontmatter_returns_dict():
    text = "---\ntarget_word_count: 90000\n---\n\nBody text here."
    result = parse_outline_frontmatter(text)
    assert result["target_word_count"] == 90000


def test_parse_multiple_fields():
    text = (
        "---\n"
        "target_word_count: 30000\n"
        "expected_characters:\n"
        "  - Kael\n"
        "  - Lyra\n"
        "expected_locations:\n"
        "  - The Citadel\n"
        "---\n\nBody here."
    )
    result = parse_outline_frontmatter(text)
    assert result["target_word_count"] == 30000
    assert result["expected_characters"] == ["Kael", "Lyra"]
    assert result["expected_locations"] == ["The Citadel"]


def test_parse_no_frontmatter_returns_empty_dict():
    # A plain Markdown file with no --- block at the top.
    result = parse_outline_frontmatter("Just a normal paragraph.\n\nNo frontmatter here.")
    assert result == {}


def test_parse_empty_string_returns_empty_dict():
    assert parse_outline_frontmatter("") == {}


def test_parse_none_equivalent_empty_body():
    # A frontmatter block with no keys at all (empty YAML document).
    # yaml.safe_load returns None for an empty document; we treat that as {}.
    text = "---\n\n---\n\nBody text."
    result = parse_outline_frontmatter(text)
    assert result == {}


def test_parse_malformed_yaml_returns_empty_dict_not_crash():
    # Unclosed bracket -- would raise yaml.YAMLError without the try/except.
    # The gauge must never crash mid-edit, so we return {} instead.
    text = "---\nkey: [unclosed bracket\n---\n\nBody text."
    result = parse_outline_frontmatter(text)
    assert result == {}


def test_parse_frontmatter_must_be_at_very_top():
    # A `---` block after some leading text is a Markdown horizontal rule,
    # not frontmatter. The `\A` anchor in the regex enforces this.
    text = "Some leading text.\n---\ntarget_word_count: 90000\n---\n"
    result = parse_outline_frontmatter(text)
    assert result == {}


def test_parse_unknown_fields_are_passed_through():
    # The parser is future-friendly: fields added in later versions pass
    # through unchanged so old code reading new outlines doesn't discard data.
    text = "---\nsome_future_field: true\ntarget_word_count: 60000\n---\n"
    result = parse_outline_frontmatter(text)
    assert result.get("some_future_field") is True
    assert result.get("target_word_count") == 60000


# ── strip_outline_frontmatter ────────────────────────────────────────────────

def test_strip_removes_frontmatter_block():
    text = "---\ntarget_word_count: 90000\n---\n\nHere is the outline body."
    result = strip_outline_frontmatter(text)
    assert "target_word_count" not in result
    assert "Here is the outline body." in result


def test_strip_with_no_frontmatter_returns_unchanged():
    text = "Plain text with no frontmatter."
    result = strip_outline_frontmatter(text)
    assert result == text


def test_strip_empty_string_returns_empty_string():
    assert strip_outline_frontmatter("") == ""
