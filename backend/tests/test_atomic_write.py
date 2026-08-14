# tests/test_atomic_write.py -- a save that loses a race must not lose the work
# ============================================================================
# Found in the suite rather than by using the app, and it would have been read as
# a flaky test by anyone in a hurry: one save in a full run failed with
# PermissionError (WinError 5) from os.replace, and the same test passed twice on
# its own afterwards.
#
# It is not the test that is flaky. On Windows a replace fails while the target
# or the temp file is held open by another process, and the usual holders are
# entirely ordinary: a virus scanner reading a file the instant it appears, the
# search indexer, a cloud-sync client, or the writer's own editor with the entry
# open in another window. The lock clears in milliseconds.
#
# Which means a writer pressing Save gets a failure they cannot diagnose -- rarely
# enough that they will never report it, often enough to stop trusting the app. A
# short retry costs nothing and removes the whole class.

import os

import pytest

from app.utils.atomic import replace_atomic


def test_it_replaces_the_file(tmp_path):
    target = tmp_path / "entry.md"
    target.write_text("old", encoding="utf-8")
    tmp = tmp_path / "entry.md.tmp"
    tmp.write_text("new", encoding="utf-8")

    replace_atomic(str(tmp), str(target))
    assert target.read_text(encoding="utf-8") == "new"
    assert not tmp.exists()


def test_it_survives_a_lock_that_clears(monkeypatch, tmp_path):
    # The real case: something holds the file for a moment and lets go.
    target = tmp_path / "entry.md"
    target.write_text("old", encoding="utf-8")
    tmp = tmp_path / "entry.md.tmp"
    tmp.write_text("new", encoding="utf-8")

    real = os.replace
    attempts = {"n": 0}

    def sticky(src, dst):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise PermissionError(5, "Access is denied")
        return real(src, dst)

    monkeypatch.setattr(os, "replace", sticky)
    replace_atomic(str(tmp), str(target))

    assert target.read_text(encoding="utf-8") == "new"
    assert attempts["n"] == 3


def test_a_lock_that_never_clears_is_reported_rather_than_swallowed(monkeypatch, tmp_path):
    # A save that quietly did not happen is far worse than one that says so: the
    # writer needs to know their words are still only in the editor.
    def held(src, dst):
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr(os, "replace", held)
    with pytest.raises(PermissionError):
        replace_atomic(str(tmp_path / "a.tmp"), str(tmp_path / "a.md"))


def test_it_gives_up_quickly_enough_to_not_hang_a_save():
    # Under a fifth of a second in total. Retrying for longer would park a save
    # behind a file somebody left open in another program all afternoon.
    from app.utils import atomic

    assert sum(atomic._BACKOFF_SECONDS) < 0.2
    assert len(atomic._BACKOFF_SECONDS) >= 3
