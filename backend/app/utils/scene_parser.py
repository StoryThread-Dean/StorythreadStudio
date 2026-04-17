# utils/scene_parser.py -- Split a chapter into scenes
# =====================================================
# Fiction writers traditionally separate scenes within a chapter using a
# horizontal rule (HR): a line containing just "---" or "***" with blank
# lines above and below. This module splits a chapter's Markdown text into
# scene blocks based on that convention.
#
# Used by:
#   - /api/ai/generate-scene-summaries -- produces one summary per scene
#   - /api/documents/chapter-scene-count -- left-nav shows scene count
#
# Why opt-in: the writer may use HRs as regular typographic separators rather
# than scene markers. The rest of the app only treats HRs as scene breaks
# when the writer explicitly invokes a scene-aware feature. That means this
# parser runs on-demand, never automatically in the background.

import re


# An HR line: optional leading/trailing whitespace, then exactly "---" or
# "***" (minimum 3 chars per the CommonMark spec), and nothing else.
# `^\s*(?:-{3,}|\*{3,})\s*$` -- the (?:...) is a non-capturing group.
_HR_LINE = re.compile(r"^\s*(?:-{3,}|\*{3,})\s*$")


def split_into_scenes(chapter_text: str) -> list[str]:
    """
    Split chapter Markdown into a list of scene blocks using HR lines as
    delimiters.

    A line counts as a scene break when:
      - It contains only "---" (three or more dashes) or "***" (three or more
        asterisks), with optional surrounding whitespace.
      - It has a blank line immediately above AND immediately below (this
        prevents false positives inside code fences or tables).

    Returns a list of scene text blocks. The result length is always
    (number of valid HR breaks) + 1. A chapter with zero HRs returns a
    single-element list containing the entire chapter.

    Example:
        "scene one\\n\\n---\\n\\nscene two"  ->  ["scene one\\n", "scene two"]
        "no breaks"                         ->  ["no breaks"]
    """
    lines = chapter_text.splitlines()

    # Collect the line indices where a scene break lives. We check "blank
    # line above, blank line below" to avoid misreading an HR that appears
    # inside code fences or tables. Start-of-file and end-of-file count as
    # blank for this purpose so an HR at the very top/bottom still splits.
    break_indices: list[int] = []
    for i, line in enumerate(lines):
        if not _HR_LINE.match(line):
            continue
        above_blank = (i == 0) or (lines[i - 1].strip() == "")
        below_blank = (i == len(lines) - 1) or (lines[i + 1].strip() == "")
        if above_blank and below_blank:
            break_indices.append(i)

    # No breaks at all -- whole chapter is one scene.
    if not break_indices:
        return [chapter_text]

    # Slice the original text on those break lines. We work on `lines` (already
    # split) and rejoin with newline, then strip outer blank lines on each
    # block so the caller doesn't see leading/trailing noise.
    scenes: list[str] = []
    start = 0
    for idx in break_indices:
        chunk = "\n".join(lines[start:idx]).strip("\n")
        scenes.append(chunk)
        start = idx + 1
    # Last chunk after the final break
    scenes.append("\n".join(lines[start:]).strip("\n"))

    # Drop empty blocks (e.g., two HRs with nothing between them). The writer
    # probably doesn't want to summarize an empty scene, and the endpoint
    # shouldn't waste an AI call on one.
    return [s for s in scenes if s.strip()]
