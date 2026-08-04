# extraction/epub_extractor.py -- EPUB manuscripts via ebooklib.
# ===============================================================
# An EPUB is a zip of small HTML files plus a "spine" that lists reading
# order. ebooklib (already a dependency -- the export feature writes EPUBs
# with it) hands us those documents; our job is HTML -> plain text and
# deciding which spine items are real chapters versus furniture (cover
# page, table of contents, copyright page).

from html.parser import HTMLParser

import ebooklib
from ebooklib import epub

from app.audiobook.extraction import ExtractedChapter, ExtractionResult, normalize_text
from app.audiobook.extraction.text_extractor import _pretty_stem

# Spine items whose extracted text is shorter than this are treated as
# furniture, not chapters. A real chapter is never 60 characters.
_MIN_CHAPTER_CHARS = 60

# Tags that imply a line break when converting HTML to text.
_BLOCK_TAGS = {"p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li",
               "blockquote", "section", "article", "tr", "hr"}


class _TextGrabber(HTMLParser):
    """
    Minimal HTML -> text converter using only the standard library.

    Collects visible text with paragraph breaks at block tags, ignores
    script/style content entirely, and remembers the first h1/h2/h3 text it
    sees -- that heading is almost always the chapter title.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.first_heading: str = ""
        self._skip_depth = 0            # inside <script>/<style>
        self._heading_depth = 0         # inside the first h1/h2/h3
        self._heading_parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip_depth += 1
        if tag in _BLOCK_TAGS:
            self.parts.append("\n\n")
        if tag in ("h1", "h2", "h3") and not self.first_heading:
            self._heading_depth += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip_depth:
            self._skip_depth -= 1
        if tag in ("h1", "h2", "h3") and self._heading_depth:
            self._heading_depth -= 1
            if not self._heading_depth and not self.first_heading:
                self.first_heading = " ".join("".join(self._heading_parts).split())

    def handle_data(self, data):
        if self._skip_depth:
            return
        if self._heading_depth:
            self._heading_parts.append(data)
        self.parts.append(data)

    def text(self) -> str:
        return normalize_text("".join(self.parts))


def _first_meta(book: epub.EpubBook, name: str) -> str:
    """First Dublin Core metadata value ('title', 'creator'), or ''."""
    try:
        values = book.get_metadata("DC", name)
        return values[0][0].strip() if values else ""
    except Exception:
        return ""


def extract_epub(path: str) -> ExtractionResult:
    book = epub.read_epub(path)
    result = ExtractionResult(
        title=_first_meta(book, "title") or _pretty_stem(path),
        author=_first_meta(book, "creator"),
    )

    # Spine order = reading order. get_items_of_type yields in manifest
    # order, so walk the spine explicitly and look each document up by id.
    docs_by_id = {item.get_id(): item
                  for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT)}
    spine_ids = [entry[0] for entry in book.spine] if book.spine else list(docs_by_id)

    skipped = 0
    for spine_id in spine_ids:
        item = docs_by_id.get(spine_id)
        if item is None:
            continue
        grabber = _TextGrabber()
        try:
            grabber.feed(item.get_content().decode("utf-8", errors="replace"))
        except Exception:
            result.warnings.append(f"Could not read EPUB section '{spine_id}'; it was skipped.")
            continue
        text = grabber.text()
        if len(text) < _MIN_CHAPTER_CHARS:
            skipped += 1                # cover, nav, copyright page, etc.
            continue
        title = grabber.first_heading or f"Chapter {len(result.chapters) + 1}"
        # Drop a leading duplicate of the title line from the body -- the
        # heading text also arrives through handle_data, and the workspace
        # layer will re-add '# title' itself.
        if title and text.startswith(title):
            text = text[len(title):].strip("\n ")
        result.chapters.append(ExtractedChapter(title=title, text=text))

    if not result.chapters:
        result.warnings.append(
            "No readable chapters were found in this EPUB. The file may be "
            "image-based or DRM-protected."
        )
    return result
