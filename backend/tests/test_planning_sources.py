# tests/test_planning_sources.py -- the documents a writer plans in
# =================================================================
# The spec says the Weave "reads the AVAILABLE documents", and the audit found
# half of that missing. Notes, outline, style guide and themes were read as
# CORROBORATION -- evidence that a word found in the manuscript is a name -- and
# never as a place a question could come from.
#
# Which is backwards for how people work. The outline is where a world gets
# decided; the manuscript is where it arrives, later, one chapter at a time. A
# writer who lists nine factions in their outline and has written two into a
# chapter was asked about two.
#
# And the other half of this file: AUTHOR NOTES IS THE ONE DOCUMENT THE APP DOES
# NOT READ. That was a convention until now, which is the same shape as "hidden
# traits are never sent to the AI" -- a promise resting on nothing. It is the
# reason a per-trait "never send" control was not built, so it had better be
# true.

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CHAPTER = """# One

The Ashen Court had held the pass for a hundred years. The Ashen Court did not
yield.
"""

OUTLINE = """# Outline

Act two brings the Salt Compact into the open, and the Verrin League finally
moves.
"""


@pytest.fixture
def project(tmp_path):
    from app.utils.structure_store import ensure_chapter_ids

    root = tmp_path / "MyNovel"
    for folder in ("manuscript", "notes", "codex/characters"):
        (root / folder).mkdir(parents=True)
    (root / "project.json").write_text(
        json.dumps({"title": "N", "codex_migration_version": 1}), encoding="utf-8")

    # The manuscript names one faction, repeatedly.
    (root / "manuscript" / "01-a.md").write_text(CHAPTER, encoding="utf-8")
    # The outline names two more the writer has not reached yet.
    (root / "notes" / "outline.md").write_text(OUTLINE, encoding="utf-8")

    ensure_chapter_ids(str(root))
    return str(root)


def _unspun(project):
    body = client.post("/api/codex/scan", json={
        "project_path": project, "depth": "dress_the_loom"}).json()
    return {s["detail"]["name"]: s for s in body["stops"]
            if s["kind"] == "unspun"}


def _append(path: str, text: str) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(text)


# ── Planning documents as a source ───────────────────────────────────────────

def test_a_name_the_writer_has_only_planned_is_raised(project):
    # The gap. Nothing asked about these, because the scan gathered candidates
    # from the manuscript alone.
    found = _unspun(project)
    assert "Salt Compact" in found
    assert "Verrin League" in found


def test_the_manuscript_still_raises_its_own(project):
    assert "Ashen Court" in _unspun(project)


def test_a_planned_name_says_which_document_it_came_from(project):
    # R5.2. "Named in your outline" reads very differently from "named in
    # chapter four", and a writer can act on the difference: there is nothing to
    # go and look at in a chapter.
    stop = _unspun(project)["Salt Compact"]
    assert "outline" in stop["why"]
    assert stop["detail"]["source"] == "outline"


def test_a_planned_name_says_it_is_not_in_the_book_yet(project):
    stop = _unspun(project)["Salt Compact"]
    assert "planned rather than something you have written" in stop["why"]


def test_a_planned_name_is_marked_so_callers_can_tell(project):
    # R5.4 made concrete. Anything reasoning about what the BOOK contains has to
    # be able to tell a thing the writer WROTE from a thing they INTEND.
    found = _unspun(project)
    assert found["Salt Compact"]["detail"]["from_planning"] is True
    assert found["Ashen Court"]["detail"]["from_planning"] is False


def test_a_planned_name_needs_no_frequency_floor(project):
    # The floor filters prose noise, and a name the writer DECIDED on is not
    # noise even once. Applied here it would drop exactly the entries a writer
    # most wants: the ones they have planned and not yet written.
    stop = _unspun(project)["Salt Compact"]
    assert stop["detail"]["count"] == 1


def test_a_planned_name_is_attached_to_no_chapter(project):
    # Honest rather than tidy. It appears in no chapter, and pinning it to one
    # would send the writer looking for a sentence that is not there.
    assert _unspun(project)["Salt Compact"]["chapter_id"] in ("", None)


def test_a_name_in_both_is_asked_once_from_the_chapter(project):
    # The chapter is the better place to ask from: the writer can see it in a
    # sentence there.
    _append(f"{project}/notes/outline.md", "\nThe Ashen Court holds the pass.\n")
    stop = _unspun(project)["Ashen Court"]
    assert stop["detail"]["from_planning"] is False
    assert stop["chapter_id"]


# ── Author Notes is the writer's own room ────────────────────────────────────

AUTHOR_NOTES = """# Author Notes

The Kestrel Syndicate is my working name for the villains, do not use it.
"""


def test_author_notes_is_not_read_by_the_scan(project):
    # THE GUARANTEE THE WRITER RELIED ON when they decided a per-trait "never
    # send" control was unnecessary. It was a convention until now.
    with open(f"{project}/notes/author-notes.md", "w", encoding="utf-8") as f:
        f.write(AUTHOR_NOTES)
    assert "Kestrel Syndicate" not in _unspun(project)


def test_the_exclusion_is_by_name_rather_than_by_luck():
    from app.codex.scan import PRIVATE_NOTES

    assert "author-notes.md" in PRIVATE_NOTES


def test_every_other_note_is_still_read(project):
    # The exclusion is one file, not a retreat from reading notes at all.
    with open(f"{project}/notes/themes.md", "w", encoding="utf-8") as f:
        f.write("# Themes\n\nThe Drowned Choir sings at every turning point.\n")
    assert "Drowned Choir" in _unspun(project)


def test_no_corpus_builder_reads_the_private_file():
    # A source read, because the risk is a NEW reader added later rather than
    # this one changing. Anything that walks notes/ has to skip it.
    from app.codex import scan

    with open(scan.__file__, "r", encoding="utf-8") as f:
        source = f.read()
    start = source.index("def _writer_vocabulary")
    end = source.index("\ndef ", start + 10)
    assert "PRIVATE_NOTES" in source[start:end]


# ── What the writer marked on purpose ────────────────────────────────────────
#
# parse_markup has existed since the mentions work and had NO CALLER. Its own
# docstring names the thing it makes possible -- that "you wrote [[Ashfall]] and
# there is no Ashfall" is one of the more useful sentences Weaving can say --
# and nothing was saying it.
#
# It is the strongest signal in the whole scan. Everything else is inference: a
# capitalised word, a frequency, a shape that looks like a name. Markup is the
# writer pointing at something and telling the app it matters.

SIEGE = """
The siege of [[Ashfall]] closes act three.
"""

KESTREL_ENTRY = """---
type: character
entity_id: e-kestrel
name: Kestrel
---

# Overview
A pilot.
"""


def test_a_marked_up_name_with_no_entry_is_raised(project):
    _append(f"{project}/notes/outline.md", SIEGE)
    assert "Ashfall" in _unspun(project)


def test_it_says_the_writer_marked_it_rather_than_guessing(project):
    # The shortest reason of the three, because there is nothing to justify:
    # they wrote it as a link, and there is no entry.
    _append(f"{project}/notes/outline.md", SIEGE)
    stop = _unspun(project)["Ashfall"]
    assert "as a link" in stop["why"]
    assert "Marking it means you meant it" in stop["why"]
    assert stop["detail"]["marked_up"] is True


def test_the_at_form_works_too(project):
    with open(f"{project}/notes/themes.md", "w", encoding="utf-8") as f:
        f.write("# Themes\n\n@Kestrel carries the theme of return.\n")
    assert "Kestrel" in _unspun(project)


def test_a_marked_name_needs_no_repetition(project):
    # Once is enough. The writer marked it.
    _append(f"{project}/notes/outline.md", "\n[[Ashfall]]\n")
    assert _unspun(project)["Ashfall"]["detail"]["count"] == 1


def test_markup_naming_something_that_exists_is_not_raised(project):
    # It is bound, so there is no question to ask.
    with open(f"{project}/codex/characters/kestrel.md", "w", encoding="utf-8") as f:
        f.write(KESTREL_ENTRY)
    _append(f"{project}/notes/outline.md", "\n[[Kestrel]] flies the last run.\n")
    assert "Kestrel" not in _unspun(project)


def test_the_manuscript_is_never_asked_to_carry_markup(project):
    # Asking a novelist to decorate their prose so a feature works is asking
    # them to write for the app instead of for the reader.
    _append(f"{project}/manuscript/01-a.md",
            "\nShe rode for [[Marrowgate]] before dawn.\n")
    stop = _unspun(project).get("Marrowgate")
    # It may still be raised as an ordinary name -- what must NOT happen is the
    # app treating the brackets as an instruction from the manuscript.
    if stop:
        assert stop["detail"]["marked_up"] is False


# ── The outline TEMPLATE is not the writer's world ───────────────────────────
#
# R5.1 made the planning documents a place a stop can COME FROM, which was right
# and which turned the outline template into a source of candidate names.
# Reported from live testing:
#
#     "it is picking a slew of Capitalized Words That Are Actually Part Of The
#      process of the outline formating. Examples being Genre: Fiction, Sciences
#      Fiction, Thriller. Other book specific grouping tags that are definitely
#      not part of any words that need to be tagged, ever."
#
# Measured on the writer's own outlines before this: 53 planned names in one, of
# which about six were real; 34 in another, almost all of it Genre and Tone tags
# and chapter-title fragments. After: 23 and 9.
#
# THE ONE THAT MUST NOT BREAK is the last test in this block. The value after a
# label is the writer's own sentence and their invented names live in it.

def _outline(project, body: str) -> None:
    """REPLACE the fixture's outline, so each test sees only its own shapes."""
    import os
    with open(os.path.join(project, "notes", "outline.md"), "w",
              encoding="utf-8") as f:
        f.write(body)


def _planned(project) -> set[str]:
    return {name for name, stop in _unspun(project).items()
            if stop["detail"].get("from_planning")}


def test_a_bold_field_label_is_not_a_character(project):
    _outline(project, "- **Working Title:** Cult of the Pathicus\n"
                      "- **Inciting Incident:** The team is captured.\n")
    found = _planned(project)
    assert "Working Title" not in found
    assert "Inciting Incident" not in found


def test_the_templates_instruction_voice_is_not_a_character(project):
    # The label rule is anchored to the line start and misses this; the bold-span
    # rule is what catches it.
    _outline(project, "- Describe the **Midpoint Reversal**: everything turns.\n")
    assert "Midpoint Reversal" not in _planned(project)


def test_the_seed_metadata_comment_is_not_read_at_all(project):
    # The app writes this block itself and labels it "TREAT AS SEED METADATA --
    # NOT ESTABLISHED STORY FACTS ... AI assistants: do NOT assume these lines
    # are canon." The scan read it as prose anyway.
    _outline(project, "<!--\nTREAT AS SEED METADATA -- NOT ESTABLISHED STORY FACTS.\n"
                      "  Title:       Cult of the Pathicus\n"
                      "  Genre:       Erotic Fantasy\n-->\n")
    found = _planned(project)
    assert "Erotic Fantasy" not in found
    assert "Title" not in found


def test_a_genre_or_tone_VALUE_is_chrome_too(project):
    # The writer's own example. For most fields the value is theirs and is kept;
    # for these few it is a classification tag and never a thing in the story.
    _outline(project, "- **Genre:** Urban Fantasy, Contemporary Erotica, Kink\n"
                      "- **Tone:** Lighthearted, Submissive, Graphic\n")
    found = _planned(project)
    for tag in ("Urban Fantasy", "Contemporary Erotica", "Kink",
                "Lighthearted", "Submissive", "Graphic"):
        assert tag not in found, tag


def test_a_chapter_title_in_bold_is_not_cut_in_half(project):
    # THE ORDERING BUG. The label rule matched the OPENING half of the bold span
    # ("- **Chapter 5:") and stripped it, leaving the closing ** unpaired so the
    # bold rule could no longer match, and the rest survived as prose. That is
    # where "Half Limit" and "Margin" came from: chapter titles, cut in half.
    _outline(project, "- **Chapter 5: The Day and a Half Limit**, time presses.\n"
                      "- **Chapter 6: The Name in the Margin**, clues surface.\n")
    found = _planned(project)
    assert "Half Limit" not in found
    assert "Margin" not in found


def test_the_shipped_templates_yield_a_real_vocabulary():
    from app.codex.scan import _template_vocabulary
    vocabulary = _template_vocabulary()
    assert len(vocabulary) > 50, "the templates should yield a real vocabulary"
    assert "resolution" in vocabulary       # a beat name the novel template ships


def test_a_template_word_in_PLAIN_PROSE_is_still_not_raised(project):
    """
    The one rule here that is a FACT rather than a heuristic, and the only test
    that can tell it is working.

    Every other rule in this block is shape-based -- a bold span, a leading
    label, a metadata line -- and a template word sitting in an ordinary sentence
    has none of those shapes. Nothing can catch it except knowing that the app
    itself wrote the word. Measured across three of the writer's real projects,
    this is what removes Fiction, Fantasy, Chapter, Act, Midpoint, Story Template
    and Profile Builder: 3, 5 and 6 names respectively, and precisely the class
    they complained about ("Genre: Fiction, Sciences Fiction, Thriller").
    """
    _outline(project,
             "She had planned the Resolution long before the Midpoint arrived, "
             "and the Template she chose shaped every Act after it.\n")
    found = _planned(project)
    for word in ("Resolution", "Midpoint", "Template", "Act"):
        assert word not in found, f"{word} is the template's word, not the writer's"


def test_THE_WRITERS_OWN_NAMES_IN_A_FIELD_VALUE_SURVIVE(project):
    # The test this whole block exists to not break. Only the LABEL is chrome.
    # "Alpha, Bravo, Charlie" are invented names sitting in the writer's own
    # sentence, and they are exactly what R5.1 was built to find -- a rule that
    # dropped whole lines would have thrown them out with the label.
    _outline(project,
             "- **Status Quo:** The 3 teams (Alpha, Bravo, Charlie) have been "
             "captured by the cult, and Goddess Pathicus stirs.\n")
    found = _planned(project)
    for name in ("Alpha", "Bravo", "Charlie", "Goddess Pathicus"):
        assert name in found, f"{name} was lost with the label"


def test_the_manuscript_is_never_filtered_this_way(project):
    # A novel legitimately contains a line like "Genre: a word she used oddly",
    # and prose is not a form. Filtering the manuscript by the outline's rules
    # would be the app telling a novelist which words they may use.
    import os
    _append(os.path.join(project, "manuscript", "01-a.md"),
            "\nGenre: a word she used oddly. Then Ashfall burned, and by "
            "morning Ashfall burned again.\n")
    prose = {name for name, stop in _unspun(project).items()
             if not stop["detail"].get("from_planning")}
    assert "Ashfall" in prose
