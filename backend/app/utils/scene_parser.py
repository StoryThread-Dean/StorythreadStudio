# utils/scene_parser.py -- Split a chapter into scenes
# =====================================================
# Fiction writers traditionally separate scenes within a chapter using a
# horizontal rule (HR): a line containing just "---" or "***" with blank
# lines above and below. This module splits a chapter's Markdown text into
# scene blocks based on that convention.
#
# Used by:
#   - /api/ai/split-chapter-scenes       -- lists scenes for the auto-split UI
#   - /api/ai/generate-scene-summary     -- produces one summary per scene
#   - /api/documents/chapter-scene-count -- left-nav shows scene count
#
# Why opt-in: the writer may use HRs as regular typographic separators rather
# than scene markers. The rest of the app only treats HRs as scene breaks
# when the writer explicitly invokes a scene-aware feature. That means this
# parser runs on-demand, never automatically in the background.

import re
from dataclasses import dataclass


# An HR line: optional leading/trailing whitespace, then exactly "---" or
# "***" (minimum 3 chars per the CommonMark spec), and nothing else.
# `^\s*(?:-{3,}|\*{3,})\s*$` -- the (?:...) is a non-capturing group.
_HR_LINE = re.compile(r"^\s*(?:-{3,}|\*{3,})\s*$")


# Word count threshold below which the pre-first-HR block is treated as a
# cosmetic chapter preamble (title + optional epigraph, quote, attribution)
# rather than a scene.
#
# Why this matters: a common chapter layout is
#
#     # Chapter One
#
#     ---
#
#     The real first scene starts here.
#
# The HR there is a typographic flourish that separates the chapter title from
# the body -- it is NOT a scene break. Without this rule, the parser would
# produce a bogus "Scene 1" containing only "# Chapter One", and the AI scene
# summary would say "no scene text provided" because the block is effectively
# empty.
#
# 50 words is roomy enough to also catch "Title + one-line epigraph + attribution"
# preambles. A deliberate cold-open scene shorter than 50 words AND placed
# before the first HR is vanishingly rare; if a writer really wants one, they
# can drop the cosmetic HR at the top.
_PREAMBLE_WORD_LIMIT = 50


def _word_count(text: str) -> int:
    """Count whitespace-separated tokens. Used for the preamble check."""
    return len(text.split())


# Title extraction patterns. Writers often label a scene with a heading or
# a standalone bold/italic line right after the HR. We try these in order.
#
#   # Heading          -> "Heading"          (any level of # works)
#   **Dawn at harbor** -> "Dawn at harbor"   (standalone bold line)
#   _Dawn at harbor_   -> "Dawn at harbor"   (standalone italic line)
#   *Dawn at harbor*   -> "Dawn at harbor"   (standalone italic line)
#
# We only look at the first few non-empty lines -- if the "title" isn't near
# the top, it's probably just prose, not a label.
_HEADING = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$")
_BOLD    = re.compile(r"^\s*\*\*(.+?)\*\*\s*$")
_ITALIC  = re.compile(r"^\s*(?:_|\*)(.+?)(?:_|\*)\s*$")


@dataclass
class Scene:
    """
    One scene inside a chapter.

    Think of the chapter as a deck of cards and HR lines as the dividers
    between hands. Each Scene is one hand: its index, where it sits in the
    deck (character offsets into the original text), what's written on it,
    and a title if the writer labeled it.
    """
    index: int           # 1-based position in the chapter
    title: str | None    # extracted from heading / bold / italic, else None
    text:  str           # scene body, no leading/trailing blank lines
    start: int           # character offset in the original chapter text
    end:   int           # character offset (exclusive)


def _extract_title(text: str) -> str | None:
    """
    Scan the first ~5 non-empty lines of a scene for a title-shaped line.

    Returns the extracted label (without the markdown wrappers) or None if
    none of the patterns match. We bail out early once we've inspected 5
    non-empty lines -- further down is almost always prose.
    """
    seen = 0
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        seen += 1
        if seen > 5:
            break
        for pattern in (_HEADING, _BOLD, _ITALIC):
            m = pattern.match(line)
            if m:
                # Strip any trailing punctuation/whitespace left over from the
                # regex group; the writer's heading may include a colon or
                # similar that reads fine as a title.
                return m.group(1).strip() or None
    return None


def split_into_scenes(chapter_text: str) -> list[str]:
    """
    Split chapter Markdown into a list of scene body strings (no metadata).

    Kept as a thin wrapper around split_into_scenes_with_meta() for callers
    that only need the raw text blocks. New code should prefer the _with_meta
    variant, which returns title, offsets, and index.
    """
    return [s.text for s in split_into_scenes_with_meta(chapter_text)]


def split_into_scenes_with_meta(chapter_text: str) -> list[Scene]:
    """
    Split chapter Markdown into a list of Scene objects with metadata.

    A line counts as a scene break when:
      - It contains only "---" (three or more dashes) or "***" (three or more
        asterisks), with optional surrounding whitespace.
      - It has a blank line immediately above AND immediately below (this
        prevents false positives inside code fences or tables).

    Returns a list of Scene objects ordered by position. A chapter with zero
    valid HRs returns a single-element list containing the whole chapter.

    Each Scene gets:
      - index     (1-based, so Scene 1, Scene 2, ...)
      - title     (from first heading / bold / italic line, or None)
      - text      (scene body, outer blank lines stripped)
      - start/end (character offsets in chapter_text, useful for selection mapping)

    Empty scenes (two HRs with nothing between them) are dropped -- no point
    summarizing nothing. Drop happens AFTER numbering so the indices reflect
    positional order in the final (non-empty) list.

    Cosmetic preamble rule: if the chapter has at least one HR AND the text
    before the first HR is short (under _PREAMBLE_WORD_LIMIT words), that
    block is treated as a chapter header / epigraph, not a scene. See the
    comment on _PREAMBLE_WORD_LIMIT above for the reasoning.
    """
    lines = chapter_text.splitlines(keepends=True)
    # We need character offsets, not just line indices. Precompute the
    # cumulative character position of each line start so we can map from
    # "line N" back to "character offset X" in O(1).
    line_offsets: list[int] = []
    running = 0
    for raw in lines:
        line_offsets.append(running)
        running += len(raw)
    total_len = running

    # Collect the line indices of valid HR scene breaks. We check "blank
    # above, blank below" to avoid misreading an HR that appears inside a
    # code fence or a Markdown table. Start-of-file and end-of-file count
    # as blank for this purpose, so an HR at the very top/bottom still splits.
    break_indices: list[int] = []
    for i, raw in enumerate(lines):
        # splitlines(keepends=True) keeps the trailing newline, so we match
        # against the stripped line.
        stripped_line = raw.rstrip("\r\n")
        if not _HR_LINE.match(stripped_line):
            continue
        above_blank = (i == 0) or (lines[i - 1].strip() == "")
        below_blank = (i == len(lines) - 1) or (lines[i + 1].strip() == "")
        if above_blank and below_blank:
            break_indices.append(i)

    # Turn the break positions into (start_line, end_line_exclusive) spans.
    # A chapter with N valid breaks produces N+1 spans.
    spans: list[tuple[int, int]] = []
    start_line = 0
    for idx in break_indices:
        spans.append((start_line, idx))
        start_line = idx + 1
    spans.append((start_line, len(lines)))

    # Build Scene objects for each span. We slice the original text using
    # character offsets (from line_offsets) so `start`/`end` are precise.
    scenes: list[Scene] = []
    for span_idx, (lo, hi) in enumerate(spans):
        if lo >= hi:
            continue
        start_char = line_offsets[lo]
        # end_char is the offset just past the last line in the span (or the
        # end of the text if this span runs to EOF).
        end_char   = line_offsets[hi] if hi < len(lines) else total_len
        block      = chapter_text[start_char:end_char]
        stripped   = block.strip("\n\r ")
        if not stripped.strip():
            continue  # empty scene (e.g., two HRs in a row) -- skip

        # Cosmetic preamble: the first span, when there's at least one real
        # HR after it AND the block is under the word threshold, is almost
        # always a chapter title / epigraph pairing rather than a scene.
        # Drop it so the scene numbering starts at the first actual scene.
        if (
            span_idx == 0
            and len(spans) > 1
            and _word_count(stripped) < _PREAMBLE_WORD_LIMIT
        ):
            continue

        scenes.append(Scene(
            index = 0,  # assigned after filtering
            title = _extract_title(stripped),
            text  = stripped,
            start = start_char,
            end   = end_char,
        ))

    # Renumber 1..N so indices reflect position in the non-empty scene list.
    for i, scene in enumerate(scenes, start=1):
        scene.index = i

    return scenes


def count_hr_breaks(chapter_text: str) -> int:
    """
    Return the number of valid HR scene breaks in the chapter.

    Useful for the UI's "no scene breaks found" fallback: if this returns 0,
    the auto-split button should show the fallback modal instead of running
    through a no-op loop.
    """
    lines = chapter_text.splitlines()
    count = 0
    for i, line in enumerate(lines):
        if not _HR_LINE.match(line):
            continue
        above_blank = (i == 0) or (lines[i - 1].strip() == "")
        below_blank = (i == len(lines) - 1) or (lines[i + 1].strip() == "")
        if above_blank and below_blank:
            count += 1
    return count
