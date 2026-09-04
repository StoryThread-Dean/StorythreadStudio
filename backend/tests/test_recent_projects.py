# tests/test_recent_projects.py -- The Recent Projects store
# ==========================================================
# The writer's dashboard shows a "Recent Projects" column built from
# ~/.storythread/storythread.json. This file tests the store behind it.
#
# WHY THIS FILE EXISTS. The writer reported that the column was occasionally
# blank despite having six real books. Two independent faults produced that
# same screen, and only one of them was the frontend's:
#
#   1. _save() wrote with a bare open(path, "w"), so a kill mid-write left a
#      truncated file.
#   2. load_recent() caught JSONDecodeError and returned [] -- SILENTLY. An
#      empty list is a perfectly ordinary answer ("you have no projects yet"),
#      so nothing anywhere was in a position to notice the difference between
#      "no projects" and "I could not read your projects".
#
# And the two combined into data loss, which is the part worth remembering:
# track_project() does load -> mutate -> save. Feed it a [] from a failed load
# and it writes that [] back over the file, so the writer's other five books
# are gone for good on the next launch. Making the WRITE atomic does not fix
# that on its own -- the READ has to refuse to hand [] to a writer.
#
# The test that matters most here is
# test_track_does_not_destroy_entries_when_live_file_is_blank. It fails against
# the pre-fix code.

import json

import pytest

from app import recent_projects


# ── Fixture ──────────────────────────────────────────────────────────────────
# conftest.py already redirects the store away from the writer's REAL home
# directory for the whole session (autouse), which is why a stray pytest run
# cannot fill their dashboard with dead entries. This fixture narrows that to
# one fresh directory per test so the .bak generations of one test cannot leak
# into the next.
#
# monkeypatch.setattr is safe on top of the session fixture: it restores the
# SANDBOX values afterwards, not the writer's real paths.
#
# Note we deliberately do NOT patch a backup/tmp path here -- the store derives
# those from RECENT_FILE at call time, precisely so that patching the one name
# is enough. If they were module-level constants, this fixture (and conftest's)
# would miss them and the suite would write into the real ~/.storythread.


@pytest.fixture
def isolated_recent(tmp_path, monkeypatch):
    sandbox = tmp_path / ".storythread"
    monkeypatch.setattr(recent_projects, "STORYTHREAD_DIR", sandbox)
    monkeypatch.setattr(recent_projects, "RECENT_FILE", sandbox / "storythread.json")
    return sandbox


def _track(project_id: str, title: str, root: str) -> None:
    """Shorthand -- the store takes a fair number of positional defaults."""
    recent_projects.track_project(
        project_id=project_id,
        title=title,
        root_path=root,
    )


# ── The ordinary path ────────────────────────────────────────────────────────


def test_load_returns_empty_when_no_file(isolated_recent):
    """
    A fresh install has no file at all. That is a genuinely empty list, and it
    must NOT be confused with the corruption cases further down.
    """
    assert recent_projects.load_recent() == []


def test_track_then_load_roundtrip(isolated_recent, tmp_path):
    book = tmp_path / "MyNovel"
    book.mkdir()
    (book / "project.json").write_text("{}", encoding="utf-8")

    _track("p1", "My Novel", str(book))
    entries = recent_projects.load_recent()

    assert len(entries) == 1
    assert entries[0]["project_id"] == "p1"
    assert entries[0]["title"] == "My Novel"


def test_load_backfills_exists_and_story_type(isolated_recent, tmp_path):
    """
    Two runtime fields the dashboard relies on. `exists` is False when the
    folder has moved or been deleted (the row greys out rather than crashing),
    and `story_type` defaults for entries written before that field existed.
    """
    real = tmp_path / "Real"
    real.mkdir()
    (real / "project.json").write_text("{}", encoding="utf-8")

    _track("p1", "Real Book", str(real))
    _track("p2", "Moved Book", str(tmp_path / "GoneAway"))

    by_id = {e["project_id"]: e for e in recent_projects.load_recent()}
    assert by_id["p1"]["exists"] is True
    assert by_id["p2"]["exists"] is False
    assert by_id["p1"]["story_type"] == "novel"


def test_remove_project_drops_only_that_entry(isolated_recent, tmp_path):
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    recent_projects.remove_project("p1")

    remaining = [e["project_id"] for e in recent_projects.load_recent()]
    assert remaining == ["p2"]


# ── Atomic write ─────────────────────────────────────────────────────────────


def test_save_leaves_no_temp_file_behind(isolated_recent, tmp_path):
    """
    The write goes through a .tmp sibling and then an atomic replace. Once the
    save returns, the .tmp must be gone -- a leftover means the replace did not
    happen and the writer's save silently did not land.
    """
    _track("p1", "One", str(tmp_path / "one"))

    strays = list(isolated_recent.glob("*.tmp"))
    assert strays == [], f"temp file left behind: {strays}"


def test_second_save_creates_a_backup(isolated_recent, tmp_path):
    """
    .bak holds the PREVIOUS generation, so it appears on the second save. The
    first save has no parseable live file to snapshot yet.
    """
    _track("p1", "One", str(tmp_path / "one"))
    assert not (isolated_recent / "storythread.json.bak").exists()

    _track("p2", "Two", str(tmp_path / "two"))
    assert (isolated_recent / "storythread.json.bak").exists()


def test_save_does_not_overwrite_backup_with_corrupt_live(isolated_recent, tmp_path):
    """
    The load-bearing ordering rule, borrowed from settings_store: a corrupt
    live file must never be snapshotted over a GOOD backup. Otherwise one bad
    write destroys both generations at once and the recovery below is worthless.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    # .bak now holds the one-entry generation. Corrupt the live file, then save.
    (isolated_recent / "storythread.json").write_text("", encoding="utf-8")
    _track("p3", "Three", str(tmp_path / "three"))

    backup = json.loads((isolated_recent / "storythread.json.bak").read_text(encoding="utf-8"))
    ids = [e["project_id"] for e in backup]
    assert "p1" in ids, "a corrupt live file clobbered the good backup"


# ── Corruption recovery ──────────────────────────────────────────────────────


def test_load_recovers_from_blanked_live_file(isolated_recent, tmp_path):
    """
    The torn-write signature: a kill between truncate and write leaves zero
    bytes. json.loads("") raising is incidental -- the empty file is the real
    tell, which is why it gets its own check rather than riding on the
    JSONDecodeError branch.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    (isolated_recent / "storythread.json").write_text("", encoding="utf-8")

    ids = [e["project_id"] for e in recent_projects.load_recent()]
    assert "p1" in ids


def test_load_recovers_from_truncated_array(isolated_recent, tmp_path):
    """Half a JSON array -- the payload here is a list, not a dict."""
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    (isolated_recent / "storythread.json").write_text(
        '[{"project_id": "p2", "title": "Tw', encoding="utf-8"
    )

    ids = [e["project_id"] for e in recent_projects.load_recent()]
    assert "p1" in ids


def test_load_rejects_valid_json_of_the_wrong_shape(isolated_recent, tmp_path):
    """
    A file can parse perfectly and still be untrustworthy. `{}` is valid JSON
    and not a list; treating it as an empty list would be the same silent lie.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    (isolated_recent / "storythread.json").write_text("{}", encoding="utf-8")

    ids = [e["project_id"] for e in recent_projects.load_recent()]
    assert "p1" in ids


def test_load_heals_the_live_file_after_recovering(isolated_recent, tmp_path):
    """
    After reading from .bak, the live file is repaired so the next save has a
    valid baseline. Without this the store would recover on every single read
    and stay one bad write away from losing everything.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    live = isolated_recent / "storythread.json"
    live.write_text("", encoding="utf-8")

    recent_projects.load_recent()

    restored = json.loads(live.read_text(encoding="utf-8"))
    assert isinstance(restored, list)
    assert "p1" in [e["project_id"] for e in restored]


# ── The data-loss regression ─────────────────────────────────────────────────


def test_track_does_not_destroy_entries_when_live_file_is_blank(
    isolated_recent, tmp_path
):
    """
    THE ONE THAT MATTERS. This fails against the pre-fix code.

    track_project does load -> mutate -> save. Pre-fix, a corrupt live file
    made load_recent() return [], so opening a project wrote a one-entry list
    over the top and the writer's other books were gone permanently.

    Note this is not a hypothetical: opening a project is what CALLS
    track_project, so the writer's own next action was what destroyed the list.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    (isolated_recent / "storythread.json").write_text("", encoding="utf-8")

    # The writer opens a different book, which tracks it.
    _track("p3", "Three", str(tmp_path / "three"))

    ids = [e["project_id"] for e in recent_projects.load_recent()]
    assert "p3" in ids, "the project just opened was not recorded"
    assert "p1" in ids, "opening a project destroyed the existing list"


# ── Both generations gone ────────────────────────────────────────────────────


def test_load_raises_when_both_generations_are_corrupt(isolated_recent, tmp_path):
    """
    Nothing is recoverable, so the store must SAY so rather than return [].
    The endpoint turns this into an HTTP error and the dashboard shows
    "couldn't load" instead of claiming the writer has no books.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    (isolated_recent / "storythread.json").write_text("garbage{", encoding="utf-8")
    (isolated_recent / "storythread.json.bak").write_text("also garbage{", encoding="utf-8")

    with pytest.raises(recent_projects.RecentsUnreadable):
        recent_projects.load_recent()


def test_load_raises_rather_than_mutating(isolated_recent, tmp_path):
    """
    A read must not quarantine or rewrite anything. Preserving the bytes is
    the write path's job -- if a read moved the file aside, the very next read
    would find nothing and go back to silently answering [].
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    live = isolated_recent / "storythread.json"
    live.write_text("garbage{", encoding="utf-8")
    (isolated_recent / "storythread.json.bak").write_text("also garbage{", encoding="utf-8")

    with pytest.raises(recent_projects.RecentsUnreadable):
        recent_projects.load_recent()

    assert live.read_text(encoding="utf-8") == "garbage{"
    assert list(isolated_recent.glob("*.corrupt-*")) == []


def test_track_quarantines_and_keeps_working(isolated_recent, tmp_path):
    """
    track_project must NEVER raise: it runs after a project has already been
    opened successfully (projects.py calls it on create and open), so raising
    would mean the writer could not open ANY book -- far worse than a blank
    list. It preserves the unreadable bytes, records the new project, and lets
    the writer carry on.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    (isolated_recent / "storythread.json").write_text("garbage{", encoding="utf-8")
    (isolated_recent / "storythread.json.bak").write_text("also garbage{", encoding="utf-8")

    _track("p3", "Three", str(tmp_path / "three"))

    preserved = list(isolated_recent.glob("storythread.json.corrupt-*"))
    assert preserved, "the unreadable bytes were discarded rather than preserved"

    ids = [e["project_id"] for e in recent_projects.load_recent()]
    assert ids == ["p3"]


def test_remove_refuses_when_unreadable(isolated_recent, tmp_path):
    """
    Removing one entry from a list that cannot be read is meaningless, and
    doing it anyway would write a near-empty list over the writer's data.
    """
    _track("p1", "One", str(tmp_path / "one"))
    _track("p2", "Two", str(tmp_path / "two"))

    live = isolated_recent / "storythread.json"
    live.write_text("garbage{", encoding="utf-8")
    (isolated_recent / "storythread.json.bak").write_text("also garbage{", encoding="utf-8")

    recent_projects.remove_project("p1")

    # Nothing written, nothing lost.
    assert live.read_text(encoding="utf-8") == "garbage{"
