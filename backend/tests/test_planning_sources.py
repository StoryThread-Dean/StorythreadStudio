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
