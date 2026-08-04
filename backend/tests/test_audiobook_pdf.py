# tests/test_audiobook_pdf.py
# ============================
# PDF import (Stage F) against REAL PDFs built by tests/pdf_builder.py --
# correct xref, real text operators, so pypdf does its actual work.
#
# A PDF does not contain a manuscript; it contains a picture of one. So
# every test here is about reconstruction going wrong in one of the two
# ways that matter:
#
#   LOSING WORDS. Cleanup removes page furniture. A rule that also eats a
#   chapter heading, a line of dialogue, or a number that was prose has
#   destroyed the writer's book, and they may not notice until they hear
#   it. Several tests assert the source words all survive.
#
#   INVENTING STRUCTURE. Paragraph breaks are guessed from line lengths.
#   Getting them wrong makes the audiobook breathe in the wrong places,
#   because the segmenter treats a paragraph as a unit of speech.

import pytest
from fastapi.testclient import TestClient

from app.audiobook.extraction import SUPPORTED_EXTENSIONS, extract_source
from app.audiobook.extraction.pdf_extractor import ScannedPdfError, extract_pdf
from app.audiobook import pronunciation, recents_store
from app.main import app
from tests.pdf_builder import build_image_only_pdf, build_pdf, justified

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setattr(recents_store, "AUDIOBOOKS_DB", tmp_path / "audiobooks.db")
    monkeypatch.setattr(pronunciation, "GLOBAL_RULES_PATH",
                        tmp_path / "global-pronunciations.json")


PARAGRAPH_ONE = (
    "The road disappeared beneath the gathering snow and somewhere behind "
    "her a second set of footsteps stopped exactly when hers did which was "
    "the detail she would remember afterwards for years."
).split()

PARAGRAPH_TWO = (
    "She did not turn around. Turning around was what people did in the "
    "stories her mother told and in those stories it never once helped "
    "anybody who did it."
).split()


def _paragraph(words: list[str], indent: bool = True) -> list[str]:
    """One typeset paragraph: wrapped to the measure, first line indented
    the way fiction is set. The indent is a real horizontal offset in the
    PDF, not spaces -- see pdf_builder."""
    lines = justified(words)
    if indent:
        lines[0] = "    " + lines[0]
    return lines


def _novel_pages(header: str = "THE HOLLOW ROAD", start_page: int = 10):
    """Three pages of a typeset novel: running header, wrapped body, page
    number at the foot -- the shape a Word-exported PDF actually has."""
    pages = []
    for offset, (heading, words) in enumerate([
        ("Chapter 1", PARAGRAPH_ONE),
        ("Chapter 2", PARAGRAPH_TWO),
        ("Chapter 3", PARAGRAPH_ONE),
    ]):
        pages.append(
            [header, heading] + _paragraph(words) + [str(start_page + offset)]
        )
    return pages


# ── The honest refusal ────────────────────────────────────────────────────────

def test_a_scanned_pdf_is_refused_with_the_workaround(tmp_path):
    # OCR is out of scope on purpose: a bad OCR pass would put INVENTED
    # words into a narration copy, which is the worst thing this feature
    # could produce. The message must name the way out.
    path = build_image_only_pdf(tmp_path / "scan.pdf", page_count=4)
    with pytest.raises(ScannedPdfError) as excinfo:
        extract_pdf(path)
    message = str(excinfo.value)
    assert "scanned pages rather than selectable text" in message
    assert "OCR is not currently supported" in message
    assert "DOCX, EPUB, Markdown, or TXT" in message


def test_a_scan_with_a_stray_watermark_is_still_a_scan(tmp_path):
    # Scans leak a few characters (a corner stamp, a watermark). A
    # threshold that only caught EMPTY text would let those through and
    # produce a one-word audiobook.
    path = build_pdf(tmp_path / "scan.pdf", [["SCANNED"], [""], ["12"], [""]])
    with pytest.raises(ScannedPdfError):
        extract_pdf(path)


def test_a_short_but_real_document_is_not_mistaken_for_a_scan(tmp_path):
    # The other side of that threshold: a genuine short manuscript must
    # import, not be refused as an image.
    path = build_pdf(tmp_path / "short.pdf", [justified(PARAGRAPH_ONE)])
    result = extract_pdf(path)
    assert "gathering snow" in result.chapters[0].text


# ── Page furniture ────────────────────────────────────────────────────────────

def test_running_headers_and_page_numbers_are_removed(tmp_path):
    path = build_pdf(tmp_path / "novel.pdf", _novel_pages())
    result = extract_pdf(path)
    body = "\n".join(c.text for c in result.chapters)

    assert "THE HOLLOW ROAD" not in body
    for page_number in ("10", "11", "12"):
        assert f"\n{page_number}\n" not in f"\n{body}\n"
    assert any("running header" in w for w in result.warnings)
    assert any("page number" in w for w in result.warnings)


def test_cleanup_never_removes_a_chapter_heading(tmp_path):
    # A book whose every page opens with the same heading line would
    # otherwise trip the repetition rule and silently merge the whole
    # book into one chapter.
    pages = [["Chapter 1"] + justified(PARAGRAPH_ONE) for _ in range(5)]
    result = extract_pdf(build_pdf(tmp_path / "same.pdf", pages))
    body = "\n".join(c.title + "\n" + c.text for c in result.chapters)
    assert "Chapter 1" in body


def test_a_number_inside_the_prose_is_never_treated_as_a_page_number(tmp_path):
    # "1985" alone on a line mid-page is a year, a countdown, a list --
    # prose. Only the page EDGES are furniture.
    lines = justified(PARAGRAPH_ONE) + ["1985"] + justified(PARAGRAPH_TWO)
    pages = [["HEADER"] + lines + ["7"] for _ in range(3)]
    result = extract_pdf(build_pdf(tmp_path / "year.pdf", pages))
    assert "1985" in "\n".join(c.text for c in result.chapters)


def test_a_two_page_document_keeps_its_first_lines(tmp_path):
    # Repetition needs enough pages to mean anything. Across two pages,
    # a repeated line is a coincidence, not furniture.
    pages = [["An Opening Line"] + justified(PARAGRAPH_ONE) for _ in range(2)]
    result = extract_pdf(build_pdf(tmp_path / "two.pdf", pages))
    assert "An Opening Line" in "\n".join(c.text for c in result.chapters)


# ── Reconstruction ────────────────────────────────────────────────────────────

def test_hyphenated_line_breaks_are_rejoined_and_counted(tmp_path):
    path = build_pdf(tmp_path / "hyphen.pdf", [[
        "The road disappeared beneath the gath-",
        "ering snow, and somewhere behind her the",
        "second set of footsteps simply stopped.",
        "She did not turn around at all, not once.",
    ]])
    result = extract_pdf(path)
    text = result.chapters[0].text
    assert "gathering snow" in text
    assert "gath-" not in text
    # Counted, because a genuinely hyphenated word could have lost its
    # hyphen and only the writer can tell.
    assert any("Rejoined 1 word" in w for w in result.warnings)


def test_a_hyphen_before_a_capital_is_left_alone(tmp_path):
    # "Anglo-" / "Saxon" across a break is rarer than a real em-dash-ish
    # construction ending a line; joining into a capital is the riskier
    # guess, so it is not made.
    path = build_pdf(tmp_path / "cap.pdf", [[
        "She had never once been to Anglo-",
        "Saxon England, whatever she claimed.",
        "It was simply not the sort of place one went.",
    ]])
    text = extract_pdf(path).chapters[0].text
    assert "Anglo-" in text


def test_typographic_line_breaks_become_paragraphs(tmp_path):
    # The heart of it: a PDF breaks lines at the margin, so importing
    # them as-is gives a poem-shaped manuscript -- and the segmenter
    # treats a paragraph as a unit of speech, so the audiobook would
    # breathe in the wrong places.
    pages = [["HEADER", "Chapter 1"]
             + _paragraph(PARAGRAPH_ONE) + _paragraph(PARAGRAPH_TWO) + ["4"]] * 3
    result = extract_pdf(build_pdf(tmp_path / "wrap.pdf", pages))
    text = result.chapters[0].text

    # Each source paragraph is one line of output, not six.
    assert "gathering snow and somewhere behind her" in text
    for paragraph in [p for p in text.split("\n\n") if p.strip()]:
        assert "\n" not in paragraph
    # Two paragraphs in, two paragraphs out -- the indent said where the
    # second one began even though the first one's last line ran nearly
    # full width, which the length rule alone cannot see.
    assert text.count("\n\n") >= 1
    assert "which was the detail she would remember afterwards for years." in text
    assert text.split("\n\n")[1].startswith("She did not turn around")


def test_paragraphs_are_found_without_any_indentation(tmp_path):
    # Block-paragraph layout (most non-fiction, and anything exported
    # flush-left): no indent to read, so the short last line is the only
    # signal there is.
    pages = [["HEADER", "Chapter 1"]
             + _paragraph(PARAGRAPH_TWO, indent=False)
             + _paragraph(PARAGRAPH_ONE, indent=False) + ["4"]] * 3
    text = extract_pdf(build_pdf(tmp_path / "flat.pdf", pages)).chapters[0].text
    # PARAGRAPH_TWO ends on a genuinely short line, so its break is seen.
    assert text.count("\n\n") >= 1
    assert "anybody who did it." in text


def test_no_word_of_the_manuscript_is_lost(tmp_path):
    # The rule that outranks every heuristic here. Cleanup may remove
    # furniture; it may never remove prose.
    result = extract_pdf(build_pdf(tmp_path / "novel.pdf", _novel_pages()))
    body = " ".join(c.text for c in result.chapters)
    for word in set(PARAGRAPH_ONE + PARAGRAPH_TWO):
        assert word.strip(".,") in body, word


def test_chapters_split_on_heading_lines(tmp_path):
    result = extract_pdf(build_pdf(tmp_path / "novel.pdf", _novel_pages()))
    titles = [c.title for c in result.chapters]
    assert titles == ["Chapter 1", "Chapter 2", "Chapter 3"]


def test_a_pdf_without_headings_imports_as_one_chapter_and_says_so(tmp_path):
    pages = [justified(PARAGRAPH_ONE) + justified(PARAGRAPH_TWO)]
    result = extract_pdf(build_pdf(tmp_path / "flat.pdf", pages))
    assert len(result.chapters) == 1
    assert any("single chapter" in w for w in result.warnings)


def test_every_import_warns_that_pdf_text_is_reconstructed(tmp_path):
    # Not a nag: this is the one format where the app is guessing, and
    # the writer is about to spend an engine on the result.
    result = extract_pdf(build_pdf(tmp_path / "novel.pdf", _novel_pages()))
    assert any("best guess" in w for w in result.warnings)


# ── Metadata and dispatch ─────────────────────────────────────────────────────

def test_pdf_metadata_supplies_title_and_author(tmp_path):
    path = build_pdf(tmp_path / "meta.pdf", _novel_pages(),
                     title="The Hollow Road", author="Dean Peterson")
    result = extract_pdf(path)
    assert result.title == "The Hollow Road"
    assert result.author == "Dean Peterson"


def test_a_pdf_without_metadata_falls_back_to_the_filename(tmp_path):
    result = extract_pdf(build_pdf(tmp_path / "my-second_novel.pdf", _novel_pages()))
    assert result.title == "My Second Novel"


def test_extract_source_routes_pdf(tmp_path):
    # The dispatch line, and the removal of the old deferral message.
    path = build_pdf(tmp_path / "novel.pdf", _novel_pages())
    assert ".pdf" in SUPPORTED_EXTENSIONS
    result = extract_source(path)
    assert len(result.chapters) == 3


def test_the_unsupported_format_message_now_offers_pdf(tmp_path):
    bad = tmp_path / "book.rtf"
    bad.write_text("nope", encoding="utf-8")
    with pytest.raises(ValueError, match="PDF, DOCX, EPUB"):
        extract_source(str(bad))


# ── Through the import endpoint ───────────────────────────────────────────────

def test_importing_a_pdf_builds_a_workspace(tmp_path):
    path = build_pdf(tmp_path / "novel.pdf", _novel_pages(), title="The Hollow Road")
    ws = tmp_path / "ws"
    response = client.post("/api/audiobook/import", json={
        "source_path": path, "workspace_path": str(ws), "title": "The Hollow Road",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["chapters"]) == 3
    # The reconstruction warnings reach the writer, not just the log.
    assert any("best guess" in w for w in body["warnings"])
    narration = (ws / "manuscript" / "narration-copy.md").read_text(encoding="utf-8")
    assert "gathering snow" in narration
    assert "THE HOLLOW ROAD" not in narration


def test_importing_a_scanned_pdf_fails_cleanly(tmp_path):
    path = build_image_only_pdf(tmp_path / "scan.pdf", page_count=4)
    response = client.post("/api/audiobook/import", json={
        "source_path": path, "workspace_path": str(tmp_path / "ws"), "title": "Scan",
    })
    assert response.status_code == 400
    assert "OCR is not currently supported" in response.json()["detail"]
