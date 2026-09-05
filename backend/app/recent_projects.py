# recent_projects.py -- Recent Project Tracking
# ================================================
# Tracks which projects have been opened so the dashboard can show them
# on next launch without the writer having to find the folder again.
#
# Stored in ~/.storythread/storythread.json alongside settings.json.
# Each entry records the project's ID, title, path, and when it was
# last opened. The list is sorted by last_opened (most recent first).
#
# If a tracked project's folder has been deleted or moved, the entry
# stays in the list but is marked with exists=False so the frontend
# can show it as greyed out rather than crashing.
#
# ── WHY THIS FILE IS MORE CAREFUL THAN IT LOOKS ──────────────────────────────
# The writer reported the dashboard's Recent Projects column occasionally
# coming up blank despite having six books. Two faults produced that screen,
# and the second one was destroying data:
#
#   1. The save used a bare open(path, "w"), so a kill mid-write (an app
#      close, a crash, a scanner holding the file) left a truncated file.
#   2. The load caught JSONDecodeError and returned [] -- silently. An empty
#      list is a perfectly ordinary answer ("no projects yet"), so nothing was
#      in a position to tell "you have no books" from "I could not read your
#      books".
#
# Together they lost the list. track_project() does load -> mutate -> save, so
# a [] from a failed load was written straight back over the file: the writer
# opened one book and the other five were gone permanently. Making the write
# atomic does not fix that by itself -- the READ has to refuse to hand [] to a
# writer. That is what RecentsUnreadable is for.
#
# The write pattern here (tmp file -> snapshot .bak -> atomic replace) is
# copied from settings_store.py, which solved this same problem for
# settings.json. Same recovery order on the way back in: live file, then .bak,
# then admit defeat out loud.

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.utils.atomic import replace_atomic

# Same directory as settings.json -- user's home, not per-project
STORYTHREAD_DIR = Path.home() / ".storythread"
RECENT_FILE     = STORYTHREAD_DIR / "storythread.json"

log = logging.getLogger(__name__)


class RecentsUnreadable(RuntimeError):
    """
    The list is on disk but neither it nor its backup can be trusted.

    Raised instead of returning [] so that "I could not read this" can never
    again be mistaken for "there is nothing here". The route turns it into an
    HTTP error and the dashboard says so rather than claiming the writer has
    no books.
    """


# ── Sibling paths ────────────────────────────────────────────────────────────
# Derived from RECENT_FILE at CALL time rather than being module-level
# constants, and that is deliberate. tests/conftest.py redirects the store away
# from the writer's real home directory by assigning to RECENT_FILE -- which
# only works for names that are read after the assignment. A module-level
# RECENT_BACKUP would be computed at import, miss the redirect, and let the
# suite write into the writer's actual ~/.storythread. That has happened once
# already (a pytest run put 130+ dead entries on their dashboard), which is
# why conftest exists at all.


def _backup_path() -> Path:
    """Rolling one-generation snapshot of the last known-good list."""
    return RECENT_FILE.with_name(RECENT_FILE.name + ".bak")


def _tmp_path() -> Path:
    """
    Scratch file for the atomic write. It sits NEXT TO the real file on
    purpose: os.replace is only atomic within one filesystem, so a system
    temp directory would not do.
    """
    return RECENT_FILE.with_name(RECENT_FILE.name + ".tmp")


# ── Reading ──────────────────────────────────────────────────────────────────


def _read_file(path: Path) -> tuple[list | None, bool]:
    """
    Try to read one generation of the list.

    Returns (entries, trustworthy):
      (None, True)  -- no such file. A genuinely empty list; a fresh install.
      (None, False) -- the file is THERE but cannot be believed: zero bytes,
                       broken JSON, or valid JSON of the wrong shape.
      (list, True)  -- good.

    The distinction in the middle row is the whole point. "No such file" and
    "present but unreadable" are completely different facts, and code that
    treats them alike will confidently report that something does not exist
    while it is busy existing.
    """
    if not path.exists():
        return None, True

    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()

        # Checked separately from the JSON parse below, because a zero-byte
        # file is the actual signature of a torn write -- a process killed
        # between truncating the file and writing the new bytes. json.loads("")
        # raising is incidental to that.
        if not text.strip():
            return None, False

        parsed = json.loads(text)

        # A hand-edited file could hold anything. `{}` is valid JSON and is not
        # a list; treating it as an empty list would be the same silent lie
        # this module exists to stop telling.
        if not isinstance(parsed, list):
            return None, False

        # Drop anything in the list that is not an entry-shaped object, so a
        # stray value cannot crash every later .get() call.
        return [e for e in parsed if isinstance(e, dict)], True

    except (json.JSONDecodeError, OSError):
        return None, False


def _read_with_recovery() -> list | None:
    """
    Read the list, falling back to the backup generation if the live file
    cannot be trusted. Returns None when NOTHING could be read -- callers must
    decide what to do about that, and they each do something different.

    Recovery order mirrors settings_store.load_settings():
      1. storythread.json      (the live file)
      2. storythread.json.bak  (last known-good snapshot)
      3. give up, and say so
    """
    entries, trustworthy = _read_file(RECENT_FILE)
    if trustworthy:
        # Includes the no-file case, which really is an empty list.
        return entries if entries is not None else []

    backup = _backup_path()
    recovered, backup_trustworthy = _read_file(backup)
    if backup_trustworthy and recovered is not None:
        # Logged so the recovery shows up in the sidecar's output and can be
        # pointed at in a future bug report.
        log.warning("%s unreadable; recovered from %s", RECENT_FILE, backup)

        # Repair the live file so the next save has a valid baseline to build
        # on. Without this the store would recover on every single read and
        # stay one bad write away from losing the lot. Best-effort: if the
        # copy fails we still return the entries we parsed.
        try:
            shutil.copy2(backup, RECENT_FILE)
        except OSError as exc:
            log.warning("Could not restore %s from backup: %s", RECENT_FILE, exc)

        return recovered

    return None


def load_recent() -> list[dict]:
    """
    Load the recent projects list from disk.
    Returns a list sorted by last_opened (newest first).
    Each entry has an 'exists' field indicating whether the folder still exists.

    Raises RecentsUnreadable when the file is present but neither it nor its
    backup can be parsed. This is a READ, so it never moves or rewrites
    anything -- preserving unreadable bytes is the write path's job. (If a read
    quarantined the file, the very next read would find nothing there and go
    straight back to silently answering [].)
    """
    entries = _read_with_recovery()
    if entries is None:
        raise RecentsUnreadable(
            f"{RECENT_FILE} could not be read, and neither could "
            f"{_backup_path()}. The file has been left exactly as it is."
        )

    # Add 'exists' by checking whether the folder is still there.
    # Backward-compat: legacy entries (pre-Phase-6) have no story_type field;
    # default them to "novel" so the response model always sees a value and
    # the recent-projects UI can render the badge without null checks.
    for entry in entries:
        root = entry.get("root_path", "")
        entry["exists"] = os.path.isdir(root) and os.path.isfile(
            os.path.join(root, "project.json")
        )
        if not entry.get("story_type"):
            entry["story_type"] = "novel"

    # Sort by last_opened descending (most recent first)
    entries.sort(key=lambda e: e.get("last_opened", ""), reverse=True)

    return entries


# ── Writing ──────────────────────────────────────────────────────────────────


def _quarantine_unreadable() -> list:
    """
    Move the unreadable generations aside, preserving their bytes under a
    dated name, and return an empty list to build on.

    Called only from the write path. Renaming rather than deleting matters:
    the bytes may be the only remaining trace of the writer's list, and a
    person can still pick a title out of a truncated file by eye.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    for path in (RECENT_FILE, _backup_path()):
        if not path.exists():
            continue
        preserved = path.with_name(f"{path.name}.corrupt-{stamp}")
        try:
            os.replace(path, preserved)
            log.warning("%s was unreadable; preserved it as %s", path, preserved)
        except OSError as exc:
            log.warning("Could not preserve %s: %s", path, exc)

    return []


def track_project(
    project_id: str,
    title: str,
    root_path: str,
    content_mode: str = "general",
    series_name: str | None = None,
    story_type: str = "novel",
) -> None:
    """
    Add or update a project in the recent list.
    Called every time a project is created or opened.

    This function deliberately NEVER raises over an unreadable file. It runs
    after a project has already been opened successfully, so raising would
    mean the writer could not open ANY book -- far worse than a blank list. If
    the file cannot be read it preserves the bytes, starts a fresh list, and
    lets the writer carry on; the list rebuilds itself as they reopen books.
    """
    entries = _read_with_recovery()
    if entries is None:
        entries = _quarantine_unreadable()

    now = datetime.now(timezone.utc).isoformat()

    # Check if this project is already tracked (by project_id or root_path)
    existing = None
    for entry in entries:
        if entry.get("project_id") == project_id or entry.get("root_path") == root_path:
            existing = entry
            break

    if existing:
        # Update the existing entry
        existing["title"] = title
        existing["root_path"] = root_path
        existing["content_mode"] = content_mode
        existing["series_name"] = series_name
        existing["story_type"] = story_type
        existing["last_opened"] = now
    else:
        # Add a new entry
        entries.append({
            "project_id":   project_id,
            "title":        title,
            "root_path":    root_path,
            "content_mode": content_mode,
            "series_name":  series_name,
            "story_type":   story_type,
            "last_opened":  now,
        })

    _save(entries)


def remove_project(project_id: str) -> None:
    """
    Remove a project from the recent list.
    Does not delete any files -- just stops tracking it.

    Refuses when the file cannot be read: dropping one entry from a list
    nobody can read is meaningless, and writing the result would put a
    near-empty list over the writer's data.
    """
    entries = _read_with_recovery()
    if entries is None:
        log.warning(
            "Refusing to remove %s: %s is unreadable, so there is no list to "
            "remove it from.", project_id, RECENT_FILE
        )
        return

    entries = [e for e in entries if e.get("project_id") != project_id]
    _save(entries)


def _save(entries: list[dict]) -> None:
    """
    Write the entries list to disk. Strips the 'exists' field before saving.

    Three steps, in this order, and the order is load-bearing:
      1. Write the new content to a .tmp sibling and flush it to the disk.
      2. Snapshot the CURRENT live file as .bak -- but only if it parses.
      3. Swap the .tmp over the live file atomically.

    Step 2's parse check is the part that is easy to get wrong: copying a
    corrupt live file over a good backup would destroy both generations at
    once and make the recovery in _read_with_recovery worthless. And .bak
    holds the PREVIOUS generation, so the snapshot has to happen before the
    swap, not after.

    Step 3 means a reader never sees a half-written file. os.replace is atomic;
    replace_atomic wraps it with a short retry because on Windows a rename
    fails outright while a scanner, an indexer or a sync client holds the file
    for a moment. It raises honestly if the lock outlasts the retries -- a save
    that quietly did not happen is worse than one that says so.
    """
    STORYTHREAD_DIR.mkdir(parents=True, exist_ok=True)

    # Remove the runtime 'exists' flag before persisting
    clean = []
    for entry in entries:
        e = dict(entry)
        e.pop("exists", None)
        clean.append(e)

    tmp = _tmp_path()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2)
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            # Some Windows and network filesystems have no working fsync.
            # The atomic replace below is still the real guarantee.
            pass

    live, trustworthy = _read_file(RECENT_FILE)
    if trustworthy and live is not None:
        try:
            shutil.copy2(RECENT_FILE, _backup_path())
        except OSError as exc:
            log.warning("Could not refresh %s: %s", _backup_path(), exc)

    replace_atomic(str(tmp), str(RECENT_FILE))
