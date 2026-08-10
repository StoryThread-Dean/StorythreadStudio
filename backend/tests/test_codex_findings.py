# tests/test_codex_findings.py -- the answers, which are never re-bought
# =======================================================================
# The scan re-derives every stop from the book every time, so nothing about
# the WORLD is stored here. What is stored is everything about the WRITER --
# and two promises hang on it:
#
#   1. Deleting app.db loses nothing they paid for. app.db is documented as a
#      rebuildable cache; findings are promised the opposite. Both contracts
#      cannot hold for one file, so findings are not in it.
#
#   2. An Apply that never reached disk comes back as a question. The app has
#      no autosave, so "applied" has to mean SAVED -- otherwise closing
#      without saving loses the edit AND the finding that would have offered
#      it again.

import json
import os

from app.codex.findings import (
    STATE_APPLIED, STATE_DEFERRED, STATE_DISMISSED, STATE_PENDING,
    STATE_STAGED, STATE_STALE,
    answer, discard_staged, list_runs, load_run, mute_kind, new_run,
    open_stops, refresh, remember_choice, retire, run_dir, save_run,
)
from app.codex.scan import STOP_LOOSE, STOP_UNSPUN, Stop


def _project(tmp_path) -> str:
    root = tmp_path / "MyNovel"
    root.mkdir(parents=True)
    return str(root)


def _stop(key: str, kind: str = STOP_UNSPUN, evidence_hash: str = "") -> Stop:
    return Stop(kind=kind, key=key, title=key, why="because",
                evidence_hash=evidence_hash)


# ── Durability ───────────────────────────────────────────────────────────────

def test_a_run_survives_deleting_the_database(tmp_path):
    # THE contract. app.db is a cache; this is not in it.
    folder = _project(tmp_path)
    run = new_run("full")
    answer(run, "k1", STATE_APPLIED)
    save_run(folder, run)

    db = os.path.join(folder, ".storythread", "app.db")
    os.makedirs(os.path.dirname(db), exist_ok=True)
    open(db, "w").close()
    os.remove(db)

    assert load_run(folder, run["run_id"])["answers"]["k1"]["state"] == STATE_APPLIED


def test_a_half_written_file_cannot_replace_a_good_one(tmp_path):
    # tmp + os.replace. A crash mid-write leaves the previous run intact
    # rather than a truncated file that loads as nothing.
    folder = _project(tmp_path)
    run = new_run("full")
    answer(run, "k1", STATE_APPLIED)
    path = save_run(folder, run)
    assert not os.path.exists(path + ".tmp")
    assert json.load(open(path, encoding="utf-8"))["run_id"] == run["run_id"]


def test_a_corrupt_run_reads_as_absent_rather_than_raising(tmp_path):
    # Losing a session's answers is bad. Refusing to open Weaving at all
    # because of it would be worse.
    folder = _project(tmp_path)
    run = new_run("full")
    path = save_run(folder, run)
    with open(path, "w", encoding="utf-8") as f:
        f.write("{ not json")
    assert load_run(folder, run["run_id"]) is None


def test_a_run_from_a_newer_build_is_not_half_read(tmp_path):
    # Reading it with older rules would silently drop its unknown fields on
    # the next save.
    folder = _project(tmp_path)
    run = new_run("full")
    run["schema_version"] = 99
    save_run(folder, run)
    assert load_run(folder, run["run_id"]) is None


def test_a_run_id_cannot_be_a_path(tmp_path):
    # It arrives over HTTP. "../../project.json" would be a traversal
    # dressed up as a session identifier.
    folder = _project(tmp_path)
    assert load_run(folder, "../../project") is None
    assert load_run(folder, "run-../../x") is None


def test_every_run_is_listed_with_its_own_counts(tmp_path):
    # Deliberately does NOT assert which comes first. Two runs saved in the
    # same clock tick have identical timestamps -- the Windows wall clock
    # moves in ~15ms steps -- so there is no true answer, and asserting one
    # made this test fail about a third of the time. What IS guaranteed is
    # that every run is there and each one's counts belong to it.
    folder = _project(tmp_path)
    first = new_run("full")
    save_run(folder, first)
    second = new_run("quick")
    answer(second, "k1", STATE_DEFERRED)
    save_run(folder, second)

    listed = {r["run_id"]: r for r in list_runs(folder)}
    assert set(listed) == {first["run_id"], second["run_id"]}
    assert listed[second["run_id"]]["deferred"] == 1
    assert listed[first["run_id"]]["deferred"] == 0


def test_the_order_is_stable_between_reads(tmp_path):
    # A "carry on where you left off" list that reshuffles is worse than one
    # in an arbitrary order, because the writer cannot learn it.
    folder = _project(tmp_path)
    for _ in range(4):
        save_run(folder, new_run("full"))
    once = [r["run_id"] for r in list_runs(folder)]
    twice = [r["run_id"] for r in list_runs(folder)]
    assert once == twice


def test_an_unwritten_run_leaves_no_folder_behind(tmp_path):
    # Opening the panel and closing it should not litter the project.
    folder = _project(tmp_path)
    new_run("full")
    assert not os.path.isdir(run_dir(folder))


# ── Two-phase ────────────────────────────────────────────────────────────────

def test_staging_is_not_applying(tmp_path):
    run = new_run("full")
    answer(run, "k1", STATE_STAGED)
    assert run["answers"]["k1"]["state"] == STATE_STAGED


def test_discarding_an_unsaved_buffer_brings_the_finding_back():
    # Without this, closing without saving loses the edit AND the finding.
    run = new_run("full")
    answer(run, "k1", STATE_STAGED)
    assert discard_staged(run) == 1
    assert run["answers"]["k1"]["state"] == STATE_PENDING


def test_discarding_returns_a_deferred_finding_to_deferred():
    # Otherwise "not yet" quietly becomes "ask me again immediately" every
    # time the writer changes their mind.
    run = new_run("full")
    answer(run, "k1", STATE_DEFERRED)
    answer(run, "k1", STATE_STAGED)
    discard_staged(run)
    assert run["answers"]["k1"]["state"] == STATE_DEFERRED


def test_staging_twice_does_not_make_staged_the_thing_to_return_to():
    run = new_run("full")
    answer(run, "k1", STATE_STAGED)
    answer(run, "k1", STATE_STAGED)
    discard_staged(run)
    assert run["answers"]["k1"]["state"] == STATE_PENDING


def test_a_saved_finding_is_not_touched_by_a_discard():
    run = new_run("full")
    answer(run, "k1", STATE_APPLIED)
    assert discard_staged(run) == 0
    assert run["answers"]["k1"]["state"] == STATE_APPLIED


# ── What comes back and what does not ────────────────────────────────────────

def test_applied_and_dismissed_never_return():
    run = new_run("full")
    answer(run, "a", STATE_APPLIED)
    answer(run, "b", STATE_DISMISSED)
    stops = [_stop("a"), _stop("b"), _stop("c")]
    assert [s.key for s in open_stops(run, stops)] == ["c"]


def test_deferred_returns():
    # A "not yet" that never came back would be a dismissal the writer did
    # not choose.
    run = new_run("full")
    answer(run, "a", STATE_DEFERRED)
    assert [s.key for s in open_stops(run, [_stop("a")])] == ["a"]


def test_a_muted_kind_is_not_shown():
    run = new_run("full")
    mute_kind(run, STOP_LOOSE)
    stops = [_stop("a", STOP_LOOSE), _stop("b", STOP_UNSPUN)]
    assert [s.key for s in open_stops(run, stops)] == ["b"]


def test_unmuting_brings_the_kind_back():
    run = new_run("full")
    mute_kind(run, STOP_LOOSE)
    mute_kind(run, STOP_LOOSE, muted=False)
    assert open_stops(run, [_stop("a", STOP_LOOSE)])


# ── Staleness, checked locally ───────────────────────────────────────────────

def test_changed_evidence_marks_a_finding_stale_with_no_ai_call():
    # A string comparison, not a model. A writer who edits a chapter between
    # sessions gets told, not re-charged.
    run = new_run("full")
    answer(run, "a", STATE_DEFERRED, evidence_hash="hash-old")
    report = refresh(run, [_stop("a", evidence_hash="hash-new")])
    assert report["stale"] == 1
    assert run["answers"]["a"]["state"] == STATE_STALE


def test_unchanged_evidence_keeps_the_answer():
    run = new_run("full")
    answer(run, "a", STATE_DEFERRED, evidence_hash="hash-same")
    refresh(run, [_stop("a", evidence_hash="hash-same")])
    assert run["answers"]["a"]["state"] == STATE_DEFERRED


def test_a_stop_with_no_evidence_never_goes_stale():
    # A Loose thread has no quoted text. Marking it stale because one side is
    # empty would flag every structural finding on every resume.
    run = new_run("full")
    answer(run, "a", STATE_DEFERRED)
    assert refresh(run, [_stop("a", STOP_LOOSE)])["stale"] == 0


def test_a_permanent_answer_is_never_reopened_by_an_edit():
    run = new_run("full")
    answer(run, "a", STATE_APPLIED, evidence_hash="hash-old")
    refresh(run, [_stop("a", evidence_hash="hash-new")])
    assert run["answers"]["a"]["state"] == STATE_APPLIED


def test_an_answer_whose_stop_vanished_is_kept_not_deleted():
    # The condition may come back -- a section emptied again, a name
    # re-added. A dismissal that evaporated would resurface as a question the
    # writer already refused.
    run = new_run("full")
    answer(run, "a", STATE_DISMISSED)
    report = refresh(run, [])
    assert report["gone"] == 1
    assert run["answers"]["a"]["state"] == STATE_DISMISSED


def test_a_stale_finding_is_offered_again():
    run = new_run("full")
    answer(run, "a", STATE_DEFERRED, evidence_hash="old")
    refresh(run, [_stop("a", evidence_hash="new")])
    assert [s.key for s in open_stops(run, [_stop("a")])] == ["a"]


# ── The answers that are not about one stop ──────────────────────────────────

def test_a_retired_phrase_is_recorded_once(tmp_path):
    # It is about a PHRASE, not a stop: the same name in another chapter must
    # not be asked either.
    folder = _project(tmp_path)
    run = new_run("full")
    retire(run, "Ash Road")
    retire(run, "Ash Road")
    save_run(folder, run)
    assert load_run(folder, run["run_id"])["retired"] == ["Ash Road"]


def test_which_john_is_asked_once(tmp_path):
    folder = _project(tmp_path)
    run = new_run("full")
    remember_choice(run, "John", "e-jv")
    save_run(folder, run)
    assert load_run(folder, run["run_id"])["disambiguations"] == {"john": "e-jv"}
