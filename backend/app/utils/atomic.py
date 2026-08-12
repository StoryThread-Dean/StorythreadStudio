# utils/atomic.py -- finishing an atomic write on Windows
# =======================================================
# Every store in this app writes the same way: put the new content in a temp
# file beside the real one, then `os.replace` it over the top. That is atomic on
# Windows and POSIX alike, so a reader sees either the old file or the new one
# and never a half-written mess. The pattern is right and stays.
#
# What it does not survive is somebody else holding the file open for a moment.
# On Windows a replace fails with PermissionError (WinError 5) when the target
# or the temp file is open in another process, and the usual culprits are not
# exotic: a virus scanner reading a file the moment it appears, the search
# indexer, a cloud-sync client, or the writer's own text editor with the entry
# open. The lock is typically gone within milliseconds.
#
# FOUND IN THE TEST SUITE, which is the only reason it was found at all. A save
# failed once in a full run and passed on its own, twice. The tempting reading is
# "flaky test"; the honest one is that the same race happens to a writer pressing
# Save, and produces a failed save with no cause they could ever diagnose. A
# writer whose save fails one time in two hundred does not file a bug, they lose
# confidence in the app.
#
# So: retry briefly, then give up honestly. Retrying forever would hang a save
# behind a file somebody left open in Word; not retrying at all fails on a lock
# that would have cleared before they noticed.

import os
import time

# Short and rising: 10ms, 20ms, 40ms, 80ms. Under a sixth of a second in total,
# which is faster than a writer can perceive, and long enough for a scanner to
# let go. Beyond that it is not a race, it is a file somebody is holding.
_BACKOFF_SECONDS = (0.01, 0.02, 0.04, 0.08)


def replace_atomic(tmp: str, path: str) -> None:
    """
    Move `tmp` over `path`, atomically, surviving a momentary lock.

    Raises the original error if the lock outlasts the retries, because a save
    that quietly did not happen is far worse than one that says so.
    """
    for delay in _BACKOFF_SECONDS:
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(delay)
    # Last attempt, unguarded: whatever it raises is what the caller sees, with
    # its real message rather than one this function invented.
    os.replace(tmp, path)
