# tests/test_profile_unknown_sections.py -- a heading the template does not know
# ==============================================================================
# THE DATA LOSS THESE CLOSE, and it needed only a one-letter slip to trigger:
#
#     # Physcial Traits
#     - trait: Hazel Eyes
#       description: "Inherited from her father."
#       importance: core
#
# `_parse_profile_markdown` walked the SECTION_CONFIGS and read every other
# heading into a dict it then threw away. The editor saves what it loaded, so
# the next ordinary save wrote the file back without it: the writer's trait was
# destroyed by opening their own profile and pressing Save.
#
# Nothing raised anything, because a section the parser never mentions looks
# exactly like a section the writer never wrote. And the two dialects
# disagreed -- `codex/threads.py` has kept unknown sections all along -- so
# whether a typo cost you your work depended on whether you had converted.
#
# Preserving it is only half the job. The Profile Builder renders from the
# REGISTRY, so a section not in the registry is invisible on screen even when
# it is safe on disk. Surfacing it is Fix Profile's job; keeping it is this
# file's.

from app.routers.profiles import (
    SECTION_CONFIGS, _generate_profile_markdown, _parse_profile_markdown,
)

TYPO = """---
type: character
profile_id: p-1
name: Kipling
status: active
created_at: 2026-01-01
updated_at: 2026-01-02
---

# Overview
A guide from the mountain village.

# Physcial Traits
- trait: Hazel Eyes
  description: "Inherited from her father."
  importance: core

# Notes
Her literacy is limited.

# Full AI Summary
_Generated on demand. Editable by writer._
"""


def _parse(raw=TYPO):
    return _parse_profile_markdown(raw, "kipling.md", "character")


# ── Kept on the way in ───────────────────────────────────────────────────────

def test_an_unknown_heading_is_kept():
    assert "physcial_traits" in _parse().sections


def test_its_content_is_kept_whole():
    # Not parsed as trait blocks even though it looks like a trait list: we do
    # not know what this section IS. Filing a trait list under a heading the
    # app guessed at would take the decision away from the writer, and it is
    # their decision -- rename it, or fold it into Notes.
    section = _parse().sections["physcial_traits"]
    assert "Hazel Eyes" in section.content
    assert "Inherited from her father" in section.content
    assert section.trait_blocks == []


def test_the_heading_is_kept_exactly_as_written():
    # The slug is lossy -- "Physcial Traits" and "physcial  traits" share one --
    # so without the original wording a save could not write the section back
    # as the writer typed it, and a repair could not name it to them.
    assert _parse().sections["physcial_traits"].heading == "Physcial Traits"


def test_a_configured_section_carries_no_heading_override():
    # Its heading comes from the config. Writing one here would give every
    # existing profile a diff on the next save.
    assert _parse().sections["overview"].heading == ""


def test_an_empty_unknown_section_is_not_invented():
    raw = TYPO.replace(
        "# Physcial Traits\n- trait: Hazel Eyes\n  description: \"Inherited from her father.\"\n  importance: core\n",
        "# Physcial Traits\n")
    assert "physcial_traits" not in _parse(raw).sections


def test_the_run_heading_is_not_mistaken_for_a_lost_section():
    # A converted profile carries a Run. It is not a section and must not be
    # offered as one to repair.
    raw = TYPO.replace("# Notes", "# Run\n- id: f-1\n  axis: a\n  value: \"v\"\n\n# Notes")
    assert "run" not in _parse(raw).sections


def test_the_full_ai_summary_is_not_mistaken_for_one_either():
    assert "full_ai_summary" not in _parse().sections


def test_a_heading_in_the_wrong_case_finds_its_real_section():
    # A SECOND LEGACY BUG, found by an earlier version of this test failing.
    # This parser matched headings as exact strings, so "# physical traits" or
    # a double-spaced "# Physical  Traits" found NOTHING: the section read as
    # empty and the writer's traits went out with the next save. The codex
    # dialect has always been tolerant here, so the two disagreed about
    # whether capitalisation costs you your work.
    for heading in ("# physical traits", "# PHYSICAL TRAITS",
                    "# Physical  Traits"):
        parsed = _parse(TYPO.replace("# Physcial Traits", heading))
        section = parsed.sections["physical_traits"]
        assert section.trait_blocks or "Hazel Eyes" in section.content, heading
        # And NOT also filed as an unknown section, which would show the writer
        # the same content twice and give a repair a phantom to offer.
        assert "physical_traits_2" not in parsed.sections, heading


def test_the_same_heading_twice_keeps_both():
    # A bad merge leaves two "# Notes". Picking one would delete the other, so
    # the second gets its own key, keeps its own heading, and reaches the file
    # again.
    raw = TYPO.replace(
        "# Notes\nHer literacy is limited.\n",
        "# Notes\nHer literacy is limited.\n\n# Notes\nA second block.\n")
    parsed = _parse(raw)
    assert "Her literacy is limited." in parsed.sections["notes"].content
    assert "A second block." in parsed.sections["notes_2"].content
    out = _generate_profile_markdown(parsed, "character")
    assert "Her literacy is limited." in out
    assert "A second block." in out


# ── Kept on the way out ──────────────────────────────────────────────────────

def test_it_survives_a_save():
    # The half that actually stops the loss: parse, save, and the words are
    # still in the file.
    out = _generate_profile_markdown(_parse(), "character")
    assert "# Physcial Traits" in out
    assert "Hazel Eyes" in out


def test_it_survives_two_saves_unchanged():
    once = _generate_profile_markdown(_parse(), "character")
    twice = _generate_profile_markdown(
        _parse_profile_markdown(once, "kipling.md", "character"), "character")
    assert once == twice


def test_the_writers_own_sections_are_untouched_by_it():
    out = _generate_profile_markdown(_parse(), "character")
    assert "A guide from the mountain village." in out
    assert "Her literacy is limited." in out


def test_it_is_written_after_the_template_and_before_the_summary():
    # Somewhere a person will notice it, rather than buried mid-template. And
    # never after Full AI Summary, which is the file's last word.
    out = _generate_profile_markdown(_parse(), "character")
    assert out.index("# Notes") < out.index("# Physcial Traits")
    assert out.index("# Physcial Traits") < out.index("# Full AI Summary")


def test_an_ordinary_profile_gains_nothing_from_any_of_this():
    # The rule that keeps this safe to ship: a file with no odd headings must
    # resave byte-identical, or every profile in every project shows a diff.
    clean = TYPO.replace(
        "# Physcial Traits\n- trait: Hazel Eyes\n  description: \"Inherited from her father.\"\n  importance: core\n\n",
        "")
    parsed = _parse_profile_markdown(clean, "kipling.md", "character")
    once = _generate_profile_markdown(parsed, "character")
    twice = _generate_profile_markdown(
        _parse_profile_markdown(once, "kipling.md", "character"), "character")
    assert once == twice
    assert "Physcial" not in once


def test_both_dialects_now_agree_that_a_typo_costs_nothing():
    # The codex dialect kept these all along. The disagreement was the bug:
    # whether a mistyped heading destroyed your work depended on whether you
    # had run the conversion.
    from app.codex.threads import parse_thread
    from app.codex.types_registry import default_registry

    codex = parse_thread(TYPO.replace("profile_id: p-1", "entity_id: e-1"),
                         default_registry())
    assert "physcial_traits" in codex["sections"]
    assert "physcial_traits" in _parse().sections


def test_every_configured_section_key_is_still_written():
    # Guard on the guard: the new loop skips known keys, and getting that
    # wrong would write every section twice.
    out = _generate_profile_markdown(_parse(), "character")
    for cfg in SECTION_CONFIGS["character"]:
        assert out.count(f"# {cfg.heading}\n") <= 1, cfg.heading
