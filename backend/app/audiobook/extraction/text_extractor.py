# extraction/text_extractor.py -- TXT and Markdown manuscripts.
# ==============================================================
# The two plain-text formats share one file because they share one problem:
# figuring out where the chapters are.
#
#   Markdown: headings are explicit (#/##), so chapter detection is exact.
#   TXT:      no markup at all, so we look for lines that LOOK like chapter
#             headings ("Chapter 7", "PROLOGUE", "Part Two -- The Fall").
#
# When detection finds nothing, the honest fallback is a single chapter --
# the writer can split it in the narration editor with [chapter-break]s or
# by adding '# ' headings.

import os
import re

from app.audiobook.extraction import ExtractedChapter, ExtractionResult, normalize_text

# Lines that read as chapter headings in plain text. Anchored to the whole
# line and capped at 80 chars so a sentence that merely BEGINS with
# "Chapter" ("Chapter meetings bored her...") never matches -- prose
# sentences are longer and keep going.
_TXT_HEADING_RE = re.compile(
    r"^\s*(chapter|prologue|epilogue|part|interlude|act)\b[^\n]{0,80}$",
    re.IGNORECASE,
)


def _pretty_stem(path: str) -> str:
    """'my-novel_final2.txt' -> 'My Novel Final2' -- a humane title fallback."""
    stem = os.path.splitext(os.path.basename(path))[0]
    stem = re.sub(r"[-_]+", " ", stem).strip()
    return stem.title() if stem else "Untitled"


def _read(path: str) -> str:
    # utf-8-sig eats a Windows BOM if present; errors='replace' means one
    # bad byte can't kill an entire import.
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        return f.read()


def extract_txt(path: str) -> ExtractionResult:
    text = normalize_text(_read(path))
    lines = text.split("\n")

    # Find heading lines. Fewer than 2 hits means the manuscript probably
    # doesn't use "Chapter N" lines at all -- treat as a single chapter
    # rather than splitting on one accidental match.
    heading_idxs = [i for i, line in enumerate(lines) if _TXT_HEADING_RE.match(line)]
    result = ExtractionResult(title=_pretty_stem(path), author="")

    if len(heading_idxs) < 2:
        result.chapters.append(ExtractedChapter(title="Chapter 1", text=text))
        if not heading_idxs:
            result.warnings.append(
                "No chapter headings were detected; the manuscript was imported "
                "as a single chapter."
            )
        return result

    # Text before the first heading (title page, dedication) becomes front
    # matter the writer can delete in the narration editor -- we keep it
    # rather than silently dropping words.
    preamble = "\n".join(lines[: heading_idxs[0]]).strip("\n")
    if preamble:
        result.chapters.append(ExtractedChapter(title="Front Matter", text=preamble))

    for n, start in enumerate(heading_idxs):
        end = heading_idxs[n + 1] if n + 1 < len(heading_idxs) else len(lines)
        title = lines[start].strip()
        body = "\n".join(lines[start + 1 : end]).strip("\n")
        result.chapters.append(ExtractedChapter(title=title, text=body))
    return result


def extract_markdown(path: str) -> ExtractionResult:
    text = normalize_text(_read(path))
    lines = text.split("\n")

    # Prefer h1 headings as chapters; fall back to h2 when the writer used
    # '##' throughout (common when '#' was reserved for the book title).
    for level_prefix in ("# ", "## "):
        heading_idxs = [i for i, line in enumerate(lines) if line.startswith(level_prefix)]
        if len(heading_idxs) >= 1:
            break

    result = ExtractionResult(title=_pretty_stem(path), author="")
    if not heading_idxs:
        result.chapters.append(ExtractedChapter(title="Chapter 1", text=text))
        result.warnings.append(
            "No Markdown headings were detected; the manuscript was imported "
            "as a single chapter."
        )
        return result

    preamble = "\n".join(lines[: heading_idxs[0]]).strip("\n")
    if preamble:
        result.chapters.append(ExtractedChapter(title="Front Matter", text=preamble))

    for n, start in enumerate(heading_idxs):
        end = heading_idxs[n + 1] if n + 1 < len(heading_idxs) else len(lines)
        title = lines[start][len(level_prefix):].strip()
        body = "\n".join(lines[start + 1 : end]).strip("\n")
        result.chapters.append(ExtractedChapter(title=title or "Untitled Chapter", text=body))

    # A single h1 whose text spans the whole file is usually the BOOK title,
    # not a chapter -- promote it when it's the only heading.
    if len(heading_idxs) == 1 and level_prefix == "# ":
        only = result.chapters[-1]
        result.title = only.title
        only.title = "Chapter 1"
    return result
