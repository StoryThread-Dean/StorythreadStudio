# audiobook/jsonstore.py -- JSON files that are never caught half-written.
# =========================================================================
# `open(path, "w")` truncates before it writes. Any reader that arrives in
# that window sees an empty or partial file, and json.load raises. For a
# file written once that is a rare race; for one written after EVERY
# generated segment, over a two-hundred-segment run, it is a certainty.
#
# It cost a real bug: a status poll landed mid-write, the run record read
# as missing, and the app decided nothing was generating while the worker
# thread carried on. The writer got an idle Generate button and a "already
# generating" error when they pressed it.
#
# os.replace() is atomic on Windows and POSIX alike: a reader sees either
# the whole old file or the whole new one, never a seam. The settings
# store has done this since v1.0.x; this is the same guarantee for the
# audiobook workspace's records.

import json
import os

from app.utils.atomic import replace_atomic


def write_json_atomic(path: str, data) -> None:
    """Write `data` as JSON so that no reader can ever see a partial file.

    The temp file sits beside the real one deliberately -- os.replace is
    only atomic within a single filesystem, and a system temp directory
    may be on another drive.
    """
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        # The bytes must be on disk before the rename, or a crash between
        # them leaves the new name pointing at an empty file.
        f.flush()
        os.fsync(f.fileno())
    # RETRIED, NOT BARE. On Windows a rename fails while a virus scanner, the
    # search indexer, a cloud-sync client or the writer's own editor holds the
    # file open for a moment -- so a save fails at random with no cause the
    # writer could diagnose. R2.5b saw this happen for real (WinError 5) and
    # fixed the Weave's writes; these are the same one-line change in code the
    # recovery does not own, which is why they were recorded rather than swept
    # up. replace_atomic retries for ~150ms and then raises honestly.
    replace_atomic(tmp, path)


def read_json(path: str) -> tuple[object | None, bool]:
    """
    (data, readable).

    The second value is the one that matters: `False` means the file is
    THERE but could not be parsed right now -- a mid-write read, a lock,
    a permissions blip. That is a very different fact from "no such
    file", and code that treats them alike will confidently report that
    something does not exist while it is busy existing.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), True
    except FileNotFoundError:
        return None, True
    except (OSError, json.JSONDecodeError):
        return None, False
