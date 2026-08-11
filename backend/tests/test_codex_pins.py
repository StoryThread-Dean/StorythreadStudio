# tests/test_codex_pins.py -- marking a connection by hand
# =========================================================
# Weaving will miss things, so the writer needs a way to say "this one
# matters" about a word the scan never raised.
#
# THE DESIGN DECISION THESE TESTS PROTECT
# ---------------------------------------
# The obvious version of "let me make a connection myself" is a form: pick a
# relation, pick a direction, pick two endpoints. That form has two failure
# modes with nothing to catch them, both of which the request itself
# identified:
#
#     the writer records the WRONG relation, and nothing knows
#     there is nothing to connect it to YET, and the form cannot be finished
#
# So the action MARKS rather than connects. A mark has no relation to get
# wrong and can wait indefinitely, and the walkthrough then handles it like
# any other stop -- inheriting the evidence quote, the "why am I seeing
# this", and the four ways to answer.
#
# The other rule it must keep: NOTHING IS WRITTEN INTO THE MANUSCRIPT. Asking
# a novelist to decorate their prose with markup to make a feature work is
# asking them to write for the app instead of for the reader.

import json

import pytest
from fastapi.testclient import TestClient

from app.codex.findings import load_book, pin, save_book, unpin
from app.main import app
from app.utils.structure_store import ensure_chapter_ids

client = TestClient(app)

CHAPTER = "# Chapter One\n\nThey rode into Kithicor Forest before dawn.\n"


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-a.md").write_text(CHAPTER, encoding="utf-8")
    ensure_chapter_ids(str(root))
    return str(root)


def _pin(project, phrase, **kw):
    return client.post("/api/codex/pin",
                       json={"project_path": project, "phrase": phrase,
                             **kw}).json()


def _scan(project, **kw):
    return client.post("/api/codex/scan",
                       json={"project_path": project, **kw}).json()


def _pinned_stops(body):
    return [s for s in body["stops"] if s["kind"] == "pinned"]


# ── The store ────────────────────────────────────────────────────────────────

def test_a_phrase_is_stored_as_a_phrase_not_a_position(tmp_path):
    # Offsets rot the moment the writer edits the paragraph above. A phrase is
    # found again by looking for it, which is how `retired` already works.
    book = load_book(str(tmp_path))
    assert pin(book, "Kithicor Forest") is True
    assert book["pinned"][0]["phrase"] == "Kithicor Forest"
    assert "offset" not in book["pinned"][0]


def test_whitespace_is_tidied_so_a_selection_is_forgiving(tmp_path):
    book = load_book(str(tmp_path))
    pin(book, "  Kithicor   Forest ")
    assert book["pinned"][0]["phrase"] == "Kithicor Forest"


def test_pinning_the_same_thing_twice_is_not_two_pins(tmp_path):
    book = load_book(str(tmp_path))
    assert pin(book, "Kithicor Forest") is True
    assert pin(book, "kithicor forest") is False
    assert len(book["pinned"]) == 1


def test_an_empty_selection_pins_nothing(tmp_path):
    book = load_book(str(tmp_path))
    assert pin(book, "   ") is False
    assert book["pinned"] == []


def test_a_pin_can_be_taken_back(tmp_path):
    book = load_book(str(tmp_path))
    pin(book, "Kithicor Forest")
    unpin(book, "KITHICOR FOREST")
    assert book["pinned"] == []


def test_pins_survive_being_written_and_read(tmp_path):
    folder = str(tmp_path)
    book = load_book(folder)
    pin(book, "Kithicor Forest", note="is this one place or two?")
    save_book(folder, book)
    assert load_book(folder)["pinned"][0]["note"] == "is this one place or two?"


# ── From the editor, with no session open ────────────────────────────────────

def test_a_mark_can_be_made_without_starting_a_walkthrough(project):
    # This is the point of a separate endpoint: the writer is in the editor,
    # mid-sentence, and has not opened Weaving at all.
    body = _pin(project, "Kithicor Forest")
    assert body == {"pinned": True, "phrase": "Kithicor Forest", "total": 1}


def test_marking_twice_says_it_was_already_marked(project):
    # A different answer from "marked", and saying so stops the writer
    # wondering whether the click registered.
    _pin(project, "Kithicor Forest")
    assert _pin(project, "Kithicor Forest")["pinned"] is False


def test_nothing_is_written_into_the_manuscript(project):
    # The locked rule. No [[markup]] in prose, ever.
    _pin(project, "Kithicor Forest", where="They rode into Kithicor Forest.")
    import os
    text = open(os.path.join(project, "manuscript", "01-a.md"),
                encoding="utf-8").read()
    assert text == CHAPTER


def test_the_marks_can_be_counted(project):
    _pin(project, "Kithicor Forest")
    _pin(project, "the Grey Road")
    body = client.get("/api/codex/pins", params={"project_path": project}).json()
    assert {p["phrase"] for p in body["pinned"]} == {"Kithicor Forest",
                                                    "the Grey Road"}


def test_a_mark_can_be_removed_over_http(project):
    _pin(project, "Kithicor Forest")
    body = client.request("DELETE", "/api/codex/pin",
                          params={"project_path": project,
                                  "phrase": "Kithicor Forest"}).json()
    assert body["pinned"] == []


# ── As a stop ────────────────────────────────────────────────────────────────

def test_a_mark_becomes_a_stop(project):
    _pin(project, "Kithicor Forest")
    stops = _pinned_stops(_scan(project))
    assert [s["detail"]["name"] for s in stops] == ["Kithicor Forest"]


def test_the_stop_says_the_writer_asked_rather_than_a_rule_firing(project):
    # It is the one stop kind not found by a rule, and it should say so --
    # otherwise it reads like something the app decided.
    _pin(project, "Kithicor Forest")
    stop = _pinned_stops(_scan(project))[0]
    assert "you pointed at it" in stop["why"]


def test_the_note_the_writer_wrote_comes_back_to_them(project):
    _pin(project, "Kithicor Forest", note="one place or two?")
    stop = _pinned_stops(_scan(project))[0]
    assert "one place or two?" in stop["why"]


def test_the_sentence_it_came_from_is_kept(project):
    _pin(project, "Kithicor Forest",
         where="They rode into Kithicor Forest before dawn.")
    stop = _pinned_stops(_scan(project))[0]
    assert "before dawn" in stop["quote"]


def test_a_mark_with_no_entry_asks_for_one(project):
    _pin(project, "Kithicor Forest")
    stop = _pinned_stops(_scan(project))[0]
    assert stop["detail"]["has_entry"] is False
    assert "no entry yet" in stop["title"]


def test_a_mark_that_already_names_something_asks_about_the_CONNECTION(project):
    # The entry exists, so "make an entry" is the wrong question. What is open
    # is what it connects to.
    client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Kithicor Forest",
    })
    _pin(project, "Kithicor Forest")
    stop = _pinned_stops(_scan(project))[0]
    assert stop["detail"]["has_entry"] is True
    assert "connect" in stop["title"]
    # And it carries where to go, like every other stop about a Thread.
    assert stop["detail"]["type"] == "character"
    assert stop["detail"]["filename"]


def test_a_mark_is_raised_until_it_is_ANSWERED_not_until_a_rule_stops(project):
    # Every other stop ends when its condition ends. A hand-made mark has no
    # condition, so only the writer can end it -- quietly dropping it would
    # lose the one thing here that was never derivable.
    _pin(project, "Kithicor Forest")
    assert _pinned_stops(_scan(project))

    run = client.post("/api/codex/run",
                      json={"project_path": project}).json()
    key = _pinned_stops(_scan(project))[0]["key"]
    client.post("/api/codex/run/answer",
                json={"project_path": project, "run_id": run["run_id"],
                      "key": key, "state": "deferred"})
    # Deferred means it comes back.
    assert _pinned_stops(_scan(project, run_id=run["run_id"]))


def test_answering_a_mark_for_good_also_removes_the_mark(project):
    # The answer alone would hide the stop, but the pin list is a COUNT the
    # writer sees, and a count that only goes up is one they stop believing.
    _pin(project, "Kithicor Forest")
    run = client.post("/api/codex/run", json={"project_path": project}).json()
    key = _pinned_stops(_scan(project))[0]["key"]
    client.post("/api/codex/run/answer",
                json={"project_path": project, "run_id": run["run_id"],
                      "key": key, "state": "dismissed"})

    assert _pinned_stops(_scan(project, run_id=run["run_id"])) == []
    body = client.get("/api/codex/pins", params={"project_path": project}).json()
    assert body["pinned"] == []


def test_a_mark_survives_a_new_session(project):
    # It is about the book, not about one sitting.
    _pin(project, "Kithicor Forest")
    client.post("/api/codex/run", json={"project_path": project})
    second = client.post("/api/codex/run", json={"project_path": project}).json()
    assert _pinned_stops(_scan(project, run_id=second["run_id"]))


def test_marks_belong_to_dressing_the_loom(project):
    # A pin is a phrase the writer pointed at and asked to be reminded about, and
    # what it needs is an entry or a connection -- which is setup work, not a
    # contradiction. So it sits with Unspun and Loose thread rather than in Read
    # the Cloth, even though the old "quick pass" reasoning (a problem the writer
    # raised themselves is the most certain problem) was fair too. A kind lives in
    # exactly ONE pass, or it gets asked twice.
    _pin(project, "Kithicor Forest")
    assert _pinned_stops(_scan(project, depth="warp"))
    assert not _pinned_stops(_scan(project, depth="cloth"))


def test_muting_the_kind_silences_marks_too(project):
    # It is still a preference about what to be shown.
    _pin(project, "Kithicor Forest")
    run = client.post("/api/codex/run", json={"project_path": project}).json()
    client.post("/api/codex/run/answer",
                json={"project_path": project, "run_id": run["run_id"],
                      "mute": "pinned"})
    assert _pinned_stops(_scan(project, run_id=run["run_id"])) == []
