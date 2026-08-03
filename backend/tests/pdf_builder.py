# tests/pdf_builder.py -- build real PDFs for the extraction tests.
# ==================================================================
# The PDF extractor is reconstruction, not parsing, so testing it against
# a stubbed reader would prove nothing about the thing that actually goes
# wrong. These helpers write genuine PDF files -- correct xref table,
# real text-drawing operators -- so pypdf does its real work and the
# extractor sees exactly what a manuscript exported from Word looks like.
#
# Deliberately hand-built rather than pulled from a fixture binary: the
# tests need to control line lengths, page furniture, and hyphenation
# precisely, and a checked-in PDF cannot be adjusted when a heuristic
# changes.

_MEDIA_BOX = "[0 0 612 792]"


def _escape(text: str) -> str:
    """PDF string literals escape backslash and both parentheses."""
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


# 12pt Helvetica: a space is about 3.3pt, but the extractor only cares
# that an indent is VISIBLY further right, so a round 6pt per leading
# space keeps the arithmetic readable.
_SPACE_PT = 6.0
_LEFT_MARGIN = 72.0
_TOP = 720.0
_LEADING = 14.0


def _content_stream(lines: list[str]) -> bytes:
    """One page's text, one PDF line per list entry.

    Each line is positioned ABSOLUTELY with a text matrix rather than
    stepped with T*, so leading spaces in the input become a real
    horizontal offset on the page -- which is how a typeset first line of
    a paragraph is actually indented. A PDF stores no space characters
    there; the glyphs simply start further right, and only pypdf's layout
    extraction mode reconstructs that. Testing indentation any other way
    would test the fixture, not the extractor.
    """
    parts = ["BT", "/F1 12 Tf"]
    for index, line in enumerate(lines):
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        x = _LEFT_MARGIN + indent * _SPACE_PT
        y = _TOP - index * _LEADING
        parts.append(f"1 0 0 1 {x:.1f} {y:.1f} Tm")
        parts.append(f"({_escape(stripped)}) Tj")
    parts.append("ET")
    return "\n".join(parts).encode("latin-1", errors="replace")


def build_pdf(path, pages: list[list[str]], title: str = "", author: str = "") -> str:
    """
    Write a multi-page PDF where `pages[i]` is the list of text lines on
    page i. Returns the path as a string.

    The object layout is the minimum a reader needs: catalog, page tree,
    one page + content stream per page, and a shared Helvetica font.
    Offsets are computed as the file is assembled so the xref table is
    genuinely correct -- pypdf can repair a broken one, and a test that
    leaned on that repair would be testing the repair.
    """
    objects: list[bytes] = []          # 1-indexed by position

    font_num = 3 + 2 * len(pages)      # catalog=1, pages=2, then page/content pairs
    info_num = font_num + 1

    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(len(pages)))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())

    for index, lines in enumerate(pages):
        page_num = 3 + 2 * index
        content_num = page_num + 1
        objects.append((
            f"<< /Type /Page /Parent 2 0 R /MediaBox {_MEDIA_BOX} "
            f"/Resources << /Font << /F1 {font_num} 0 R >> >> "
            f"/Contents {content_num} 0 R >>"
        ).encode())
        stream = _content_stream(lines)
        objects.append(
            f"<< /Length {len(stream)} >>\nstream\n".encode()
            + stream
            + b"\nendstream"
        )

    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    info_parts = []
    if title:
        info_parts.append(f"/Title ({_escape(title)})")
    if author:
        info_parts.append(f"/Author ({_escape(author)})")
    objects.append(("<< " + " ".join(info_parts) + " >>").encode() if info_parts else b"<< >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info {info_num} 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF\n"
    ).encode()

    with open(path, "wb") as f:
        f.write(bytes(out))
    return str(path)


def build_image_only_pdf(path, page_count: int = 3) -> str:
    """A PDF whose pages carry no text layer at all -- what a scanner
    produces. Built without the image data itself, which the extractor
    never looks at; what matters is that extract_text() finds nothing."""
    return build_pdf(path, [[] for _ in range(page_count)])


def justified(sentence_words: list[str], width: int = 66) -> list[str]:
    """Wrap words into near-full-width lines, the way a typeset page
    does. The extractor's paragraph detection keys on the LAST line of a
    paragraph being short, so tests need real wrapping to exercise it."""
    lines: list[str] = []
    current = ""
    for word in sentence_words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines
