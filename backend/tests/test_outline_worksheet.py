"""
The Outline worksheet: what it writes, what it reads back, and the conversion.

Three groups, and the third is the dangerous one.

  RENDER    the ten labels, and the things deliberately NOT in the file.
  READ      tolerant of the writer reformatting their own document, strict
            about what counts as a number, and able to read a pre-v2.0.2 file
            that has not been converted yet.
  HEAL      the six properties from docs/outline-spec.md section 6. The
            Planner corruption regression (test_outline_sections.py) happened
            because the old code split the writer's file into parts and
            rebuilt it; a section that failed to parse was simply absent from
            the rebuild, and the next save wrote that absence to disk. The
            healer is the same shape of operation on the same file, so it is
            held to properties rather than to examples.
"""

import os
import re

import pytest

from app.outline_worksheet import (
    WORKSHEET_FIELDS,
    heal_outline,
    read_project_targets,
    read_targets,
    render_worksheet,
    set_target_chapter_count,
    set_target_word_count,
    write_worksheet,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "legacy-outline-novel.md")


def _project(tmp_path, outline_text=None):
    """A project folder, optionally with an outline already in it."""
    notes = tmp_path / "notes"
    notes.mkdir(parents=True, exist_ok=True)
    if outline_text is not None:
        (notes / "outline.md").write_text(outline_text, encoding="utf-8")
    return str(tmp_path)


def _legacy() -> str:
    with open(FIXTURE, "r", encoding="utf-8") as f:
        return f.read()


# ── Render ───────────────────────────────────────────────────────────────────

def test_worksheet_has_every_label_in_order():
    text = render_worksheet({"title": "The Ashen Pact"})
    positions = [text.index(f"{label}:") for label in WORKSHEET_FIELDS]
    assert positions == sorted(positions), "labels are out of order"


def test_worksheet_carries_the_metadata_it_was_given():
    text = render_worksheet({
        "title": "The Ashen Pact", "genre": "Dark Fantasy",
        "tone": "Grimdark", "series_name": "The Ember Throne Saga",
    })
    assert "Title: The Ashen Pact" in text
    assert "Genre: Dark Fantasy" in text
    assert "Series: The Ember Throne Saga" in text
    # And leaves the rest as bare labels to fill in.
    assert "Setting:\n" in text


def test_worksheet_has_no_yaml_no_comment_and_no_rule():
    # Each of these was in the old template, and each was machinery or
    # teaching sitting inside a document the writer owns.
    text = render_worksheet({"title": "X"})
    assert not text.startswith("---")
    assert "---" not in text, "a rule that can reach position 0 is a heal hazard"
    assert "<!--" not in text
    assert "target_word_count:" not in text


def test_serial_fiction_leaves_the_target_blank():
    # Absence is how "no fixed total" is spelled in a file a person reads.
    # A 0 or a null would both be a claim.
    text = render_worksheet({"title": "X"}, story_type="serial_fiction")
    assert "Target Word Count:\n" in text
    assert read_targets(text).word_count is None


@pytest.mark.parametrize("story_type,expected", [
    ("novel", 90000), ("novella", 30000),
    ("novelette", 13000), ("short_story", 6000),
])
def test_word_target_is_prefilled_per_story_type(story_type, expected):
    assert read_targets(render_worksheet(None, story_type)).word_count == expected


# ── Read ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("line", [
    "Target Word Count: 90000",
    "target word count: 90000",
    "TARGET WORD COUNT:90000",
    "- Target Word Count: 90000",
    "**Target Word Count:** 90000",
    "Target  Word   Count :   90000",
    "Target Word Count: 90,000",
])
def test_the_writer_can_reformat_their_own_file(line):
    assert read_targets(f"# Outline\n\n{line}\n").word_count == 90000


@pytest.mark.parametrize("value", ["", "  ", "lots", "0", "-5", "soon"])
def test_a_non_number_means_unset_never_zero(value):
    # Zero is a real target somebody could mean. "I have not decided" is not
    # zero, and a gauge dividing by it would be measuring against nothing.
    assert read_targets(f"Target Word Count: {value}\n").word_count is None


def test_first_match_wins():
    # A writer mentioning their target further down in prose must not override
    # the header they filled in.
    text = "Target Word Count: 90000\n\nI want a Target Word Count: 5 book.\n"
    assert read_targets(text).word_count == 90000


def test_the_two_targets_are_read_independently():
    text = "Target Word Count: 80000\nTarget Chapter Count: 30\n"
    got = read_targets(text)
    assert (got.word_count, got.chapter_count) == (80000, 30)


def test_chapter_count_alone_is_fine():
    got = read_targets("Target Chapter Count: 42\n")
    assert got.chapter_count == 42 and got.word_count is None


def test_fields_filled_counts_only_answered_labels():
    text = render_worksheet({"title": "X", "genre": "Y"})   # + the word target
    assert read_targets(text).fields_filled == 3
    assert read_targets(render_worksheet(None, "serial_fiction")).fields_filled == 0


def test_a_legacy_outline_still_reports_its_target():
    # THE FALLBACK THAT DECOUPLES "the gauge is right" FROM "the file has been
    # rewritten". A project not opened since the upgrade, or one whose
    # conversion was refused, must not silently lose its target.
    got = read_targets(_legacy())
    assert got.word_count == 90000
    assert got.from_legacy is True


def test_a_converted_outline_does_not_report_as_legacy():
    got = read_targets(render_worksheet({"title": "X"}))
    assert got.word_count == 90000 and got.from_legacy is False


# ── Write ────────────────────────────────────────────────────────────────────

def test_setting_a_target_replaces_only_that_value(tmp_path):
    root = _project(tmp_path, render_worksheet({"title": "The Ashen Pact"}))
    assert set_target_word_count(root, 120000) is True
    text = open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read()
    assert read_targets(text).word_count == 120000
    assert "Title: The Ashen Pact" in text, "the rest of the worksheet moved"


def test_setting_a_target_preserves_the_writers_formatting(tmp_path):
    root = _project(tmp_path, "# Outline\n\n- **Target Word Count:** 1000\n")
    set_target_word_count(root, 2000)
    text = open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read()
    assert "- **Target Word Count:** 2000" in text


def test_a_missing_line_is_inserted_into_the_header(tmp_path):
    root = _project(tmp_path, "# Outline\n\nTitle: X\nGenre: Y\n\nSome prose.\n")
    assert set_target_chapter_count(root, 30) is True
    text = open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read()
    assert read_targets(text).chapter_count == 30
    # Placed with the other labels rather than appended after the prose.
    assert text.index("Target Chapter Count") < text.index("Some prose.")


def test_a_missing_outline_is_a_soft_failure(tmp_path):
    # The writer is allowed to delete outline.md.
    assert set_target_word_count(_project(tmp_path), 90000) is False


def test_writing_a_target_into_a_legacy_file_leaves_ONE_number(tmp_path):
    # The setter heals first. Without that, the worksheet line and the YAML
    # block would both claim to be the word target, and read_targets prefers
    # the worksheet -- so the stale one would sit above it waiting to be read
    # by anything that looked at the YAML.
    root = _project(tmp_path, _legacy())
    set_target_word_count(root, 111000)
    text = open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read()
    assert read_targets(text).word_count == 111000
    assert "target_word_count:" not in text
    assert len(re.findall(r"111000", text)) == 1


def test_write_worksheet_creates_the_file(tmp_path):
    root = str(tmp_path)
    write_worksheet(root, {"title": "New Book"}, "novella")
    got = read_project_targets(root)
    assert got.word_count == 30000


# ── Heal ─────────────────────────────────────────────────────────────────────

def test_healing_converts_a_real_legacy_outline(tmp_path):
    root = _project(tmp_path, _legacy())
    result = heal_outline(root, {"title": "The Ashen Pact"})
    assert result.healed is True
    assert not result.text.startswith("---")
    assert "target_word_count:" not in result.text
    assert "TREAT AS SEED METADATA" not in result.text
    # The target survives the conversion.
    assert read_targets(result.text).word_count == 90000


def test_healing_keeps_every_line_of_the_writers_body(tmp_path):
    # THE PROPERTY THE REGRESSION VIOLATED. Not "the sections we recognise
    # survive" -- every line does.
    legacy = _legacy()
    root = _project(tmp_path, legacy)
    result = heal_outline(root, {"title": "The Ashen Pact"})

    removed_prefix = legacy.index("# Outline")
    body_lines = [ln.rstrip() for ln in legacy[removed_prefix:].split("\n") if ln.strip()]
    kept = [ln.rstrip() for ln in result.text.split("\n") if ln.strip()]
    for line in body_lines:
        assert line in kept, f"lost from the writer's outline: {line!r}"


def test_healing_is_idempotent(tmp_path):
    root = _project(tmp_path, _legacy())
    first = heal_outline(root, {"title": "The Ashen Pact"})
    second = heal_outline(root, {"title": "The Ashen Pact"})
    assert first.healed is True
    assert second.healed is False, "a converted file was converted again"
    after = open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read()
    assert after == first.text


def test_healing_never_produces_the_fused_separator(tmp_path):
    # `---## Heading` is the exact shape that made a section invisible to the
    # split regex AND made the frontmatter regex over-reach into prose.
    root = _project(tmp_path, _legacy())
    result = heal_outline(root, {"title": "X"})
    assert not re.search(r"^-{3,}#{2,}", result.text, re.MULTILINE)


def test_healing_refuses_a_file_with_no_frontmatter(tmp_path):
    # Nothing to convert. A hand-written outline is never touched.
    hand_written = "# My outline\n\nJust some notes I typed.\n"
    root = _project(tmp_path, hand_written)
    result = heal_outline(root)
    assert result.healed is False
    assert open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read() == hand_written


def test_healing_refuses_malformed_yaml_rather_than_guessing(tmp_path):
    # A malformed file the writer can see and fix beats one the app quietly
    # rewrote into something else.
    broken = "---\ntarget_word_count: [unclosed\n---\n\n# Outline\n\nMy prose.\n"
    root = _project(tmp_path, broken)
    result = heal_outline(root)
    assert result.healed is False
    assert open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read() == broken


def test_healing_keeps_lists_the_writer_typed(tmp_path):
    # Decision #3 dropped the expected_* INPUTS, not the writer's data.
    legacy = (
        "---\n"
        "target_word_count: 90000\n"
        "expected_characters: [Kael, Vire]\n"
        "expected_locations: [Ironhold]\n"
        "expected_lore: []\n"
        "expected_relationships: []\n"
        "chapters:\n"
        "- title: Opening\n"
        "  word_target: 3000\n"
        "---\n\n# Outline\n\nMy prose.\n"
    )
    root = _project(tmp_path, legacy)
    result = heal_outline(root)
    assert result.healed is True
    assert "Kept from your old outline" in result.text
    assert "Kael" in result.text and "Vire" in result.text
    assert "Ironhold" in result.text
    assert "Opening (3000)" in result.text
    # Empty lists leave no trace.
    assert "Lore:" not in result.text


def test_healing_snapshots_what_it_replaced(tmp_path):
    root = _project(tmp_path, _legacy())
    result = heal_outline(root)
    assert result.snapshot and os.path.isfile(result.snapshot)
    assert open(result.snapshot, encoding="utf-8").read() == _legacy()
    assert ".storythread" in result.snapshot


def test_healing_aborts_and_writes_NOTHING_when_a_line_would_be_lost(
    tmp_path, monkeypatch,
):
    # REINSTATE THE BUG. The post-condition is the whole safety argument, so
    # it is verified by breaking the transform underneath it: a healer that
    # drops the body must write nothing at all rather than a shorter file.
    import app.outline_worksheet as ow

    legacy = _legacy()
    root = _project(tmp_path, legacy)

    real_render = ow.render_worksheet
    monkeypatch.setattr(
        ow, "render_worksheet",
        lambda *a, **k: real_render(*a, **k) + "\n(this transform eats the body)",
    )
    monkeypatch.setattr(ow, "_SEED_COMMENT_RE", re.compile(r".*", re.DOTALL))

    result = heal_outline(root)
    assert result.healed is False
    assert result.reason == "post-condition failed"
    on_disk = open(os.path.join(root, "notes", "outline.md"), encoding="utf-8").read()
    assert on_disk == legacy, "the writer's file was modified by a failed heal"
