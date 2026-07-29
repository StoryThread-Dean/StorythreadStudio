# extraction/storythread_project_extractor.py -- import from a writing project.
# ==============================================================================
# The friendliest source of all: a Storythread project already stores each
# chapter as its own Markdown file, and manuscript/structure.json (when
# present) records the true reading order -- so chapter detection is exact,
# not heuristic. This extractor reuses structure_store's ordering logic, the
# same authority the sidebar and exports use.
#
# The audiobook workspace still takes a full COPY of the text. Nothing here
# links back to the writing project; later edits to the novel do not touch
# the audiobook (by design -- see the spec's source-locking rules).

import json
import os
import re

from app.audiobook.extraction import ExtractedChapter, ExtractionResult, normalize_text
from app.utils import structure_store

# 'NN-some-chapter.md' -> 'Some Chapter' when the file has no # heading.
_STEM_CLEAN_RE = re.compile(r"^\d+[-_ ]*")


def _title_from_stem(filename: str) -> str:
    stem = os.path.splitext(filename)[0]
    stem = _STEM_CLEAN_RE.sub("", stem)
    stem = re.sub(r"[-_]+", " ", stem).strip()
    return stem.title() if stem else filename


def extract_storythread_project(project_path: str) -> ExtractionResult:
    # Project title/author come from project.json when present. Every field
    # is optional -- a hand-edited or older project.json must never break
    # the import.
    title, author = "", ""
    try:
        with open(os.path.join(project_path, "project.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        title = str(data.get("title") or "").strip()
        author = str(data.get("author") or "").strip()
    except Exception:
        pass
    if not title:
        title = os.path.basename(os.path.normpath(project_path)) or "Untitled"

    result = ExtractionResult(title=title, author=author)

    # Reading order from the structure manifest (acts in order, then the
    # unassigned bucket) -- the same order the writer sees in the sidebar.
    filenames = structure_store.ordered_chapter_filenames(project_path)
    manuscript_dir = os.path.join(project_path, "manuscript")

    for filename in filenames:
        path = os.path.join(manuscript_dir, filename)
        try:
            with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
                raw = f.read()
        except OSError:
            result.warnings.append(f"Chapter file '{filename}' could not be read; it was skipped.")
            continue

        text = normalize_text(raw)
        chapter_title = _title_from_stem(filename)

        # A chapter file usually opens with '# Its Title' -- lift it out so
        # the workspace layer doesn't end up with a doubled heading.
        lines = text.split("\n")
        if lines and lines[0].startswith("# "):
            chapter_title = lines[0][2:].strip() or chapter_title
            text = "\n".join(lines[1:]).strip("\n")

        result.chapters.append(ExtractedChapter(title=chapter_title, text=text))

    if not result.chapters:
        result.warnings.append("The project has no manuscript chapters to import.")
    return result
