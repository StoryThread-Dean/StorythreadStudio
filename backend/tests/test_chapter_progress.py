# tests/test_chapter_progress.py
# ================================
# Unit tests for the per-chapter word target breakdown (progress.py).
#
# _chapter_progress_list() pairs manuscript chapters with word targets from
# the outline frontmatter's `chapters:` list. The matching is loose (same
# rule as the profiles bucket) and the YAML is hand-edited, so the edge
# cases worth locking down are: title matching, filename fallback matching,
# one-entry-credits-one-file consumption, malformed entries, and the
# percent clamp at 100.

from app.routers.progress import _chapter_progress_list


def _counts(*entries):
    """Shorthand: each entry is (filename, title, words)."""
    return list(entries)


def test_matches_outline_entry_by_chapter_title():
    result = _chapter_progress_list(
        _counts(("01-return.md", "Return to Ash", 1500)),
        {"chapters": [{"title": "Return to Ash", "word_target": 3000}]},
    )
    assert result[0].target_words == 3000
    assert result[0].percent == 50.0


def test_loose_match_works_with_partial_titles():
    # Outline says "Return", chapter heading is "Return to Ash" -- the loose
    # bidirectional substring match should still pair them.
    result = _chapter_progress_list(
        _counts(("01-return.md", "Return to Ash", 300)),
        {"chapters": [{"title": "Return", "word_target": 3000}]},
    )
    assert result[0].target_words == 3000


def test_falls_back_to_filename_when_title_differs():
    # The chapter heading doesn't match, but the filename stem does
    # ("02-hollow-crown" -> "02 hollow crown" contains "Hollow Crown").
    result = _chapter_progress_list(
        _counts(("02-hollow-crown.md", "Chapter Two", 100)),
        {"chapters": [{"title": "Hollow Crown", "word_target": 2000}]},
    )
    assert result[0].target_words == 2000


def test_each_outline_entry_credits_at_most_one_chapter():
    # One generic outline title must not hand the same target to every file.
    result = _chapter_progress_list(
        _counts(
            ("01-a.md", "Chapter", 100),
            ("02-b.md", "Chapter", 200),
        ),
        {"chapters": [{"title": "Chapter", "word_target": 1000}]},
    )
    assert result[0].target_words == 1000
    assert result[1].target_words is None


def test_unmatched_chapter_reports_no_target():
    result = _chapter_progress_list(
        _counts(("01-a.md", "Return to Ash", 500)),
        {"chapters": [{"title": "Completely Different", "word_target": 3000}]},
    )
    assert result[0].target_words is None
    assert result[0].percent is None


def test_percent_clamps_at_100():
    result = _chapter_progress_list(
        _counts(("01-a.md", "Return to Ash", 9000)),
        {"chapters": [{"title": "Return to Ash", "word_target": 3000}]},
    )
    assert result[0].percent == 100.0


def test_malformed_outline_entries_are_ignored():
    # Hand-edited YAML mid-keystroke: entries can be strings, lack fields,
    # or carry junk targets. None of these should crash or match.
    result = _chapter_progress_list(
        _counts(("01-a.md", "Return to Ash", 500)),
        {"chapters": [
            "just a string",
            {"word_target": 3000},                            # no title
            {"title": "Return to Ash"},                       # no target
            {"title": "Return to Ash", "word_target": -5},    # junk target
            {"title": "Return to Ash", "word_target": "big"}, # wrong type
        ]},
    )
    assert result[0].target_words is None


def test_no_chapters_key_yields_all_untargeted():
    result = _chapter_progress_list(
        _counts(("01-a.md", "Return to Ash", 500)),
        {},
    )
    assert len(result) == 1
    assert result[0].target_words is None
    assert result[0].actual_words == 500
