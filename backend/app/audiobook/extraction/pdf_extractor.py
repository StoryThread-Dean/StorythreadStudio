# extraction/pdf_extractor.py -- text-based PDF manuscripts via pypdf.
# =====================================================================
# PDF was deferred to its own stage for a reason: it is the only source
# format that does not actually contain a manuscript. It contains a
# PICTURE of one. There are no paragraphs in a PDF, only glyphs at
# coordinates, so everything below is reconstruction -- and reconstruction
# can be wrong.
#
# That shapes two rules this extractor follows:
#
#   1. NEVER lose the writer's words. Every cleanup step here removes
#      page furniture (running headers, page numbers) or re-joins text
#      that the page layout split. Nothing that could be prose is
#      dropped, and anything ambiguous is kept.
#   2. SAY what was reconstructed. Each cleanup reports itself as an
#      import warning, so the writer knows which parts of the narration
#      copy deserve a skim before they spend an engine on it.
#
# Scanned PDFs (a photograph of a page, with no text layer) are refused
# outright. OCR is out of scope by design -- a bad OCR pass would put
# invented words into a narration copy, which is the worst outcome this
# whole feature can produce.

import re

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.audiobook.extraction import ExtractedChapter, ExtractionResult, normalize_text
from app.audiobook.extraction.text_extractor import _TXT_HEADING_RE, _pretty_stem

# Below this many characters per page, on average, a document is a
# picture of a book rather than a book. Real prose runs 1500-3000
# characters on a paperback page; even a sparse poetry page clears 50.
# A scan with a stray watermark or a corner stamp can leak a handful of
# characters, which is exactly what this threshold is here to survive.
_SCANNED_CHARS_PER_PAGE = 50

# Lines that are page furniture rather than prose: a bare number, a roman
# numeral, "Page 12", "12 | The Hollow Road", "- 12 -".
_PAGE_NUMBER_RE = re.compile(
    r"^\s*(?:page\s+)?[-–—|\s]*"
    r"(?:\d{1,4}|[ivxlcdm]{1,7})"
    r"[-–—|\s]*(?:of\s+\d{1,4})?\s*$",
    re.IGNORECASE,
)

# How much of a book a repeated line must appear on before it counts as a
# running header rather than a coincidence. Two chapters that happen to
# open with the same sentence must never trip this.
_RUNNING_SHARE = 0.6
_RUNNING_MIN_PAGES = 3

# A line shorter than this fraction of the page's full MEASURE is the
# LAST line of a paragraph. In justified or wrapped body text every line
# runs nearly full width except that one, which makes short-ness the
# single most reliable paragraph signal a PDF gives us.
#
# The measure is a high percentile of line lengths rather than the
# median, because headings, page numbers and dialogue are all short and
# would otherwise drag the median down until no line looked short at all
# -- which merges every paragraph in the book into one.
_SHORT_LINE_RATIO = 0.8
_MEASURE_PERCENTILE = 0.9


class ScannedPdfError(ValueError):
    """A PDF with no usable text layer. Its own type so the router can
    answer with the spec's exact wording rather than a generic 400."""


def _page_texts(path: str) -> list[str]:
    """Raw text per page, or a clear error the writer can act on."""
    try:
        reader = PdfReader(path)
    except PdfReadError as e:
        raise ValueError(
            f"That PDF could not be opened ({e}). It may be damaged -- try "
            "re-exporting it, or export the manuscript as DOCX, EPUB, "
            "Markdown, or TXT instead."
        ) from e

    if reader.is_encrypted:
        # An empty-password decrypt covers the common "protected for
        # printing" case; a real password is the writer's to remove.
        try:
            if not reader.decrypt(""):
                raise ValueError(
                    "That PDF is password-protected. Open it in a PDF reader, "
                    "save an unprotected copy, and import that."
                )
        except NotImplementedError as e:
            raise ValueError(
                "That PDF uses an encryption method this app cannot open. "
                "Save an unprotected copy and import that."
            ) from e

    pages: list[str] = []
    for page in reader.pages:
        text = ""
        try:
            # LAYOUT mode, because a PDF stores no indentation: the first
            # line of a paragraph simply starts further right, and only
            # layout extraction reconstructs that as leading spaces.
            # Indentation is the best paragraph signal typeset fiction
            # gives us, and plain mode throws it away entirely.
            text = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            try:
                text = page.extract_text() or ""
            except Exception:
                # One unreadable page must not lose the other three hundred.
                text = ""
        pages.append(text)
    return pages


def _strip_running_lines(pages: list[list[str]]) -> tuple[int, int]:
    """
    Remove running headers and footers, in place. Returns (headers, footers)
    as counts of LINES removed, for the warning.

    Detection is by repetition, not by position or font: take the first
    (and last) line of every page, normalize away the digits that make
    each one unique, and remove it only when the same skeleton appears on
    most of the book. "The Hollow Road" atop 300 pages is furniture; a
    sentence that happens to open two chapters is not.
    """
    if len(pages) < _RUNNING_MIN_PAGES:
        return 0, 0

    def skeleton(line: str) -> str:
        # Digits vary per page; everything else is the repeated part.
        return re.sub(r"\d+", "#", line).strip().lower()

    removed = [0, 0]
    for edge, index in ((0, 0), (1, -1)):
        candidates: dict[str, list[int]] = {}
        for page_no, lines in enumerate(pages):
            if not lines:
                continue
            key = skeleton(lines[index])
            if key:
                candidates.setdefault(key, []).append(page_no)

        for key, page_nos in candidates.items():
            if len(page_nos) < max(_RUNNING_MIN_PAGES, len(pages) * _RUNNING_SHARE):
                continue
            # A line that looks like a chapter heading is NOT furniture,
            # however often it repeats -- losing it would silently merge
            # chapters together.
            if _TXT_HEADING_RE.match(key):
                continue
            for page_no in page_nos:
                if pages[page_no]:
                    pages[page_no].pop(index)
                    removed[edge] += 1
    return removed[0], removed[1]


def _strip_page_numbers(pages: list[list[str]]) -> int:
    """Drop bare page numbers wherever they sit at a page edge. Only the
    edges: a line reading "12" in the middle of a page could be prose
    (a year, a list, a countdown), and prose is never worth the risk."""
    removed = 0
    for lines in pages:
        for index in (0, -1):
            if lines and _PAGE_NUMBER_RE.match(lines[index]):
                lines.pop(index)
                removed += 1
    return removed


def _dehyphenate(lines: list[str]) -> tuple[list[str], int]:
    """
    Rejoin words the page layout split across a line break.

    "gath-" / "ering" becomes "gathering". The hyphen is dropped, which
    is right for a line-break hyphen and wrong for a genuinely hyphenated
    word that happened to land at the margin ("well-" / "known"). There
    is no way to tell them apart without a dictionary, so the join is
    made -- it is right far more often -- and COUNTED, so the warning can
    tell the writer how many words to spot-check.
    """
    out: list[str] = []
    joined = 0
    buffer: str | None = None
    for line in lines:
        if buffer is not None:
            stripped = line.lstrip()
            # Only join into a lowercase continuation. A capital or a
            # marker means the hyphen ended something, not split it.
            if stripped[:1].islower():
                out.append(buffer[:-1] + stripped)
                joined += 1
                buffer = None
                continue
            out.append(buffer)
            buffer = None
        if re.search(r"[A-Za-z]-$", line):
            buffer = line
            continue
        out.append(line)
    if buffer is not None:
        out.append(buffer)
    return out, joined


def _indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _rewrap(lines: list[str]) -> str:
    """
    Turn typographic line breaks back into paragraphs.

    A PDF breaks lines wherever the margin fell, so importing them as-is
    would give the narration editor a poem-shaped manuscript -- and the
    segmenter treats a paragraph as a unit of speech, so the audiobook
    would breathe in the wrong places.

    Two signals, used together because each catches what the other
    misses:

      INDENT. In typeset fiction the first line of a paragraph starts
      further right. When the page uses indentation this is exact, and it
      catches the paragraph whose last line happens to run full width --
      which the length rule cannot see.

      LENGTH. Every line runs nearly the full measure except the last one
      of a paragraph, so a noticeably short line ends one. This is the
      only signal available for pages with no indentation at all
      (block-paragraph layout, most non-fiction), and it catches
      dialogue, which is often set flush left.

    They never contradict: one says where a paragraph ENDS, the other
    where the next one BEGINS.
    """
    real = sorted(len(line.strip()) for line in lines if line.strip())
    if not real:
        return ""
    measure = real[int(_MEASURE_PERCENTILE * (len(real) - 1))]
    threshold = measure * _SHORT_LINE_RATIO

    # The body's left margin is whatever most lines sit at; anything
    # further right than that is an indent. Using the MINIMUM as the base
    # keeps a page whose every line is inset (a block quote, a title
    # page) from reading as one endless indent.
    indents = [_indent_of(line) for line in lines if line.strip()]
    base_indent = min(indents) if indents else 0
    indented = [i for i in indents if i > base_indent + 1]
    # A handful of indents is a stray; a real indented layout indents a
    # good share of its lines (one per paragraph).
    use_indent = len(indented) >= 2 and len(indented) >= len(indents) * 0.05

    paragraphs: list[str] = []
    current: list[str] = []

    def flush() -> None:
        if current:
            paragraphs.append(" ".join(current).strip())
            current.clear()

    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if _TXT_HEADING_RE.match(stripped):
            # A heading stands alone on both sides, whatever its length.
            flush()
            paragraphs.append(stripped)
            continue
        if use_indent and _indent_of(line) > base_indent + 1:
            flush()                       # this line STARTS a paragraph
        # Layout extraction pads justified text with runs of spaces to
        # hold the original column positions. Inside a sentence those are
        # noise, and they would reach the narrator as pauses.
        current.append(re.sub(r"\s{2,}", " ", stripped))

        following = lines[index + 1].strip() if index + 1 < len(lines) else ""
        if len(stripped) < threshold or not following or _TXT_HEADING_RE.match(following):
            flush()
    flush()
    return "\n\n".join(p for p in paragraphs if p)


def extract_pdf(path: str) -> ExtractionResult:
    raw_pages = _page_texts(path)
    total_chars = sum(len(p.strip()) for p in raw_pages)

    # Scanned or image-only: refuse, with the workaround named. OCR is
    # deliberately out of scope -- see the module note.
    if not raw_pages or total_chars < _SCANNED_CHARS_PER_PAGE * max(1, len(raw_pages)):
        raise ScannedPdfError(
            "This PDF appears to contain scanned pages rather than selectable "
            "text. Scanned-document OCR is not currently supported. Convert it "
            "to a text-searchable PDF, DOCX, EPUB, Markdown, or TXT file and "
            "try again."
        )

    pages = [
        [line.rstrip() for line in page.replace("\r\n", "\n").replace("\r", "\n").split("\n")
         if line.strip()]
        for page in raw_pages
    ]
    # Page numbers first: left in place they all reduce to the same
    # skeleton ("#") and would be swept up as a "running footer", which
    # both mislabels them in the warning and hides any real footer
    # sitting above them. Then again afterwards, for the number that was
    # tucked beneath a running header.
    numbers = _strip_page_numbers(pages)
    headers, footers = _strip_running_lines(pages)
    numbers += _strip_page_numbers(pages)

    lines: list[str] = []
    for page_lines in pages:
        lines.extend(page_lines)
        # A page boundary is not a paragraph boundary, but it usually
        # coincides with one; a blank line here lets _rewrap decide using
        # the same short-line rule it uses everywhere else.
        lines.append("")

    lines, hyphens = _dehyphenate(lines)
    text = normalize_text(_rewrap(lines))

    reader_meta = {}
    try:
        reader_meta = PdfReader(path).metadata or {}
    except Exception:
        pass
    result = ExtractionResult(
        title=str(reader_meta.get("/Title", "") or "").strip() or _pretty_stem(path),
        author=str(reader_meta.get("/Author", "") or "").strip(),
    )

    # Chapter detection is the same "what looks like a heading" rule the
    # TXT importer uses -- one source of truth, so a manuscript imported
    # both ways splits the same way.
    body_lines = text.split("\n")
    heading_idxs = [i for i, line in enumerate(body_lines) if _TXT_HEADING_RE.match(line)]
    if len(heading_idxs) < 2:
        result.chapters.append(ExtractedChapter(title="Chapter 1", text=text))
        result.warnings.append(
            "No chapter headings were detected; the PDF was imported as a "
            "single chapter. Add '# ' headings in the narration editor to "
            "split it."
        )
    else:
        preamble = "\n".join(body_lines[: heading_idxs[0]]).strip("\n")
        if preamble:
            result.chapters.append(ExtractedChapter(title="Front Matter", text=preamble))
        for n, start in enumerate(heading_idxs):
            end = heading_idxs[n + 1] if n + 1 < len(heading_idxs) else len(body_lines)
            result.chapters.append(ExtractedChapter(
                title=body_lines[start].strip(),
                text="\n".join(body_lines[start + 1 : end]).strip("\n"),
            ))

    # Everything reconstructed, reported. The writer decides what to check.
    if headers or footers:
        parts = []
        if headers:
            parts.append(f"{headers} running header line(s)")
        if footers:
            parts.append(f"{footers} running footer line(s)")
        result.warnings.append(
            f"Removed {' and '.join(parts)} that repeated across pages.")
    if numbers:
        result.warnings.append(f"Removed {numbers} page number line(s).")
    if hyphens:
        result.warnings.append(
            f"Rejoined {hyphens} word(s) that were hyphenated across a line "
            "break. Words that are genuinely hyphenated may have lost their "
            "hyphen -- worth a skim.")
    result.warnings.append(
        "PDF text is reconstructed from page layout, so paragraph breaks are "
        "a best guess. Read through the narration copy before generating.")
    return result
