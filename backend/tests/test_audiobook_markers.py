# tests/test_audiobook_markers.py
# ================================
# The narration copy is plain Markdown with inline markers; the structured
# form is DERIVED by parsing. These tests pin the marker grammar, the
# warnings for malformed markers, and the reading-order guarantees.

from app.audiobook.markers import parse_narration, split_chapters


def test_split_chapters_on_h1_only():
    text = "# One\n\nProse.\n\n## Scene notes\n\nMore prose.\n\n# Two\n\nEnd."
    chapters = split_chapters(text)
    assert [title for title, _ in chapters] == ["One", "Two"]
    # The h2 stays inside chapter One's body -- h1 is the only split level.
    assert "## Scene notes" in chapters[0][1]


def test_text_before_first_heading_becomes_front_matter():
    chapters = split_chapters("Dedication.\n\n# One\n\nProse.")
    assert [title for title, _ in chapters] == ["Front Matter", "One"]


def test_pause_scene_and_chapter_markers_parse_in_order():
    text = (
        "# One\n\n"
        "The door closed behind him.\n\n"
        "[pause:0.4]\n\n"
        "She looked toward the window.\n\n"
        "[scene-break]\n\n"
        "Later that night.\n\n"
        "[chapter-break]\n"
    )
    parsed = parse_narration(text)
    assert parsed.warnings == []
    kinds = [e["type"] for e in parsed.chapters[0].elements]
    assert kinds == ["text", "pause", "text", "scene_break", "text", "chapter_break"]
    pause = parsed.chapters[0].elements[1]
    assert pause["duration_ms"] == 400


def test_pause_accepts_decimals_and_is_case_insensitive():
    parsed = parse_narration("# C\n\nA.\n\n[Pause:1.5]\n\nB.")
    assert parsed.chapters[0].elements[1] == {"type": "pause", "duration_ms": 1500}


def test_invalid_pause_duration_warns_and_is_ignored():
    parsed = parse_narration("# C\n\nA.\n\n[pause:fast]\n\nB.")
    kinds = [e["type"] for e in parsed.chapters[0].elements]
    assert kinds == ["text", "text"]           # marker dropped, prose kept
    assert any("not a valid duration" in w for w in parsed.warnings)


def test_out_of_range_pause_warns():
    parsed = parse_narration("# C\n\nA.\n\n[pause:300]\n\nB.")
    assert any("not a valid duration" in w for w in parsed.warnings)


def test_exclude_blocks_are_recorded_not_narrated():
    text = (
        "# C\n\n"
        "Keep this.\n\n"
        "[exclude]Author note: fix pacing here.[/exclude]\n\n"
        "Keep this too.\n"
    )
    parsed = parse_narration(text)
    elements = parsed.chapters[0].elements
    assert [e["type"] for e in elements] == ["text", "excluded", "text"]
    assert elements[1]["content"] == "Author note: fix pacing here."
    # Reading order preserved around the excluded block.
    assert elements[0]["content"] == "Keep this."
    assert elements[2]["content"] == "Keep this too."


def test_unclosed_exclude_swallows_to_chapter_end_with_warning():
    text = "# C\n\nKeep.\n\n[exclude]Never closed, all of this is out.\n"
    parsed = parse_narration(text)
    elements = parsed.chapters[0].elements
    assert [e["type"] for e in elements] == ["text", "excluded"]
    assert any("no closing" in w for w in parsed.warnings)


def test_pace_spans_tag_their_text_elements():
    parsed = parse_narration(
        "# C\n\nNormal speed.\n\n[pace:0.8]Slow and heavy.[/pace]\n\n"
        "[pace:1.2]Quick and sharp.[/pace]\n\nNormal again."
    )
    elements = parsed.chapters[0].elements
    assert [(e["content"], e.get("pace")) for e in elements] == [
        ("Normal speed.", None),
        ("Slow and heavy.", 0.8),
        ("Quick and sharp.", 1.2),
        ("Normal again.", None),
    ]
    assert parsed.warnings == []


def test_pace_span_can_contain_pauses():
    parsed = parse_narration("# C\n\n[pace:0.8]First beat.\n\n[pause:0.5]\n\nSecond beat.[/pace]")
    elements = parsed.chapters[0].elements
    assert [e["type"] for e in elements] == ["text", "pause", "text"]
    assert elements[0]["pace"] == 0.8
    assert elements[2]["pace"] == 0.8


def test_invalid_pace_warns_and_uses_normal():
    parsed = parse_narration("# C\n\n[pace:9]Too fast to be real.[/pace]")
    assert parsed.chapters[0].elements[0].get("pace") is None
    assert any("not a valid pace" in w for w in parsed.warnings)


def test_step_pace_markers_parse_to_signed_strings():
    # The step form (what the toolbar inserts): the SIGN marks a step,
    # a bare number stays the legacy multiplier. Steps normalize to a
    # signed string so downstream code can tell the forms apart.
    parsed = parse_narration(
        "# C\n\n[pace:-2]Two steps slower.[/pace]\n\n"
        "[pace:+3]Three steps faster.[/pace]\n\n"
        "[pace:0.8]Legacy multiplier still works.[/pace]"
    )
    elements = parsed.chapters[0].elements
    assert parsed.warnings == []
    assert [(e["content"], e.get("pace")) for e in elements] == [
        ("Two steps slower.", "-2"),
        ("Three steps faster.", "+3"),
        ("Legacy multiplier still works.", 0.8),
    ]


def test_zero_step_pace_is_treated_as_unmarked_text():
    parsed = parse_narration("# C\n\n[pace:+0]No change asked for.[/pace]")
    assert parsed.warnings == []
    assert parsed.chapters[0].elements[0].get("pace") is None


def test_invalid_step_pace_warns_and_uses_normal():
    parsed = parse_narration("# C\n\n[pace:+fast]Not a number.[/pace]")
    assert parsed.chapters[0].elements[0].get("pace") is None
    assert any("not a valid pace" in w for w in parsed.warnings)


def test_unclosed_pace_applies_to_rest_of_chapter_with_warning():
    parsed = parse_narration("# C\n\nNormal.\n\n[pace:0.7]Slow from here on.")
    elements = parsed.chapters[0].elements
    assert elements[0].get("pace") is None
    assert elements[1]["pace"] == 0.7
    assert any("no closing [/pace]" in w for w in parsed.warnings)


def test_nested_pace_warns_and_ignores_inner():
    parsed = parse_narration("# C\n\n[pace:0.8]Outer [pace:1.5] still outer.[/pace]")
    assert parsed.chapters[0].elements[0]["pace"] == 0.8
    assert any("cannot nest" in w for w in parsed.warnings)


def test_structure_json_shape():
    structure = parse_narration("# One\n\nProse.\n\n[scene-break]").to_structure()
    assert structure["version"] == 1
    assert structure["chapters"][0]["title"] == "One"
    assert structure["chapters"][0]["elements"][1] == {"type": "scene_break"}
    assert structure["warnings"] == []


def test_markers_never_leak_into_text_elements():
    parsed = parse_narration("# C\n\nBefore. [pause:0.8] After.")
    texts = [e["content"] for e in parsed.chapters[0].elements if e["type"] == "text"]
    assert texts == ["Before.", "After."]
