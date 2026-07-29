# audiobook/extraction -- turn any supported source into chapters of text.
# =========================================================================
# Every extractor speaks the same tiny language: it takes a source path and
# returns an ExtractionResult -- a best-guess title/author plus an ordered
# list of chapters, where each chapter is just (title, text). Everything
# downstream (workspace layers, chapter manifests, narration editing) only
# ever sees that shape, so adding a new format later (PDF is deliberately
# deferred) means writing one new extractor and adding one dispatch line.
#
# House rule reminder: extracted text is the WRITER'S text. No sanitizing,
# no em dash replacement, no rewriting -- extraction only normalizes
# whitespace and line endings so the editor behaves predictably.

import os
from dataclasses import dataclass, field


@dataclass
class ExtractedChapter:
    """One chapter of source text. Title without any leading '#'."""
    title: str
    text: str


@dataclass
class ExtractionResult:
    """What every extractor returns, regardless of source format."""
    title: str                                   # best-guess book title ("" if unknown)
    author: str                                  # best-guess author ("" if unknown)
    chapters: list[ExtractedChapter] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# Formats the import endpoint accepts today. PDF is deferred by design --
# see the spec's Deferred Format Behavior section.
SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".docx", ".epub"}


def normalize_text(raw: str) -> str:
    """
    Whitespace-only cleanup applied to every extracted chapter body:
      - Windows/Mac line endings become plain \n
      - trailing spaces on each line are stripped
      - runs of 3+ blank lines collapse to one blank line
    Nothing else is touched -- punctuation, em dashes, and the writer's
    words all pass through exactly as written.
    """
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    out: list[str] = []
    blank_run = 0
    for line in lines:
        if line == "":
            blank_run += 1
            if blank_run > 1:
                continue          # collapse extra blanks
        else:
            blank_run = 0
        out.append(line)
    return "\n".join(out).strip("\n")


def extract_source(source_path: str) -> ExtractionResult:
    """
    Dispatch a source file (or Storythread project FOLDER) to its extractor.

    Raises ValueError with a user-facing message for unsupported formats --
    the router turns that into a clean 400, never a stack trace.
    """
    # A directory containing project.json is a Storythread writing project.
    if os.path.isdir(source_path):
        if os.path.isfile(os.path.join(source_path, "project.json")):
            from app.audiobook.extraction.storythread_project_extractor import extract_storythread_project
            return extract_storythread_project(source_path)
        raise ValueError(
            "That folder is not a Storythread project (no project.json found). "
            "Pick a manuscript file or a Storythread project folder."
        )

    ext = os.path.splitext(source_path)[1].lower()
    if ext == ".pdf":
        # Deliberate, honest rejection -- see the spec. Do not soften this
        # into a generic unsupported-format message; PDF users need to know
        # the workaround.
        raise ValueError(
            "PDF import is not supported yet. Export the manuscript as "
            "DOCX, EPUB, Markdown, or TXT and try again."
        )
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported manuscript format '{ext or '(none)'}'. Supported: "
            "DOCX, EPUB, Markdown (.md), TXT, or a Storythread project folder."
        )

    if ext in (".txt",):
        from app.audiobook.extraction.text_extractor import extract_txt
        return extract_txt(source_path)
    if ext in (".md", ".markdown"):
        from app.audiobook.extraction.text_extractor import extract_markdown
        return extract_markdown(source_path)
    if ext == ".docx":
        from app.audiobook.extraction.docx_extractor import extract_docx
        return extract_docx(source_path)
    # Only .epub remains.
    from app.audiobook.extraction.epub_extractor import extract_epub
    return extract_epub(source_path)
