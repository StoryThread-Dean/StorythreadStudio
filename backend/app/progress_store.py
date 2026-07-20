# progress_store.py -- Per-project SQLite store for Writing Progress events
# ===========================================================================
# Each project has its own SQLite database at `<project>/.storythread/app.db`.
# This module owns the lifecycle (lazy-create, migrate, open/close) and the
# schema. The HTTP routers (documents save hooks, advisor endpoints, the
# /api/progress aggregation router) call into here -- they do not touch
# SQLite directly.
#
# Why per-project SQLite and not a global one?
#   - A project folder is meant to be portable (copy to a new machine, back
#     up, sync). The cache that derives from that folder belongs with it.
#   - Multiple projects open in sequence don't share each other's stats.
#   - .storythread/ is already documented as cache; if the file is deleted
#     or corrupted, the Markdown source of truth is untouched.
#
# Schema-version migration pattern:
#   A single `schema_version` table records every applied migration. The
#   `_MIGRATIONS` list contains migration functions in order. On every
#   connect() we check the version and apply any pending migrations.
#   New schema changes = append a new function to `_MIGRATIONS`. Old
#   databases catch up automatically the next time they're opened.

from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable

import aiosqlite

log = logging.getLogger(__name__)


# ── Paths ─────────────────────────────────────────────────────────────────────

def get_db_path(project_path: str | Path) -> Path:
    """
    Return the per-project SQLite path: `<project>/.storythread/app.db`.

    The `.storythread/` directory is the documented cache home (see CLAUDE.md
    and product-scope.md). Callers should treat its contents as derivable --
    if app.db is deleted, the next connect() will rebuild a fresh, empty
    database.
    """
    return Path(project_path) / ".storythread" / "app.db"


# ── Time helpers ──────────────────────────────────────────────────────────────
#
# The Writing Progress gauge uses local time, not UTC. Writers think in terms
# of "what did I write today?" where "today" is their wall-clock day, optionally
# shifted by a Night Owl offset (e.g. 4am rollover for writers who work past
# midnight). These helpers centralize that conversion so the rest of the code
# never has to think about it.

def now_iso_local() -> str:
    """
    ISO-formatted local datetime for the `occurred_at` column.

    No timezone suffix -- we deliberately store wall-clock local time so the
    writer sees what they expect when looking at logs. The gauge never compares
    across machines, so timezone metadata isn't needed.
    """
    return datetime.now().isoformat(timespec="seconds")


def local_date_for(occurred_at_iso: str, rollover_hour: int = 0) -> str:
    """
    Convert an ISO local-datetime string to the bucketed local-date string.

    `rollover_hour` shifts the day boundary. With rollover_hour=4 (Night Owl
    mode), anything between 00:00 and 03:59 still counts toward "yesterday."
    Returns a YYYY-MM-DD string for the `local_date` column.
    """
    dt = datetime.fromisoformat(occurred_at_iso)
    # If we're before the rollover hour, we're still in the previous "day."
    if rollover_hour > 0 and dt.hour < rollover_hour:
        dt = dt - timedelta(days=1)
    return dt.date().isoformat()


# ── Migrations ────────────────────────────────────────────────────────────────
#
# Each entry in _MIGRATIONS is an async function that takes a connection and
# applies one schema change. The position in the list IS the version number
# (1-indexed). Never reorder, edit, or delete entries -- only append.

async def _migration_001_progress_event(db: aiosqlite.Connection) -> None:
    """
    First schema version: the `progress_event` table.

    One row per recorded event. Three event types:
      - 'word_delta'   : a save that changed the word count of a file
      - 'task_credit'  : a save that earned the file its daily task credit
      - 'advisor_run'  : a Smart Advisor invocation (used for the special
                          "default OR all-three categories" credit rule)
    """
    await db.execute(
        """
        CREATE TABLE progress_event (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            project_path     TEXT NOT NULL,
            occurred_at      TEXT NOT NULL,
            local_date       TEXT NOT NULL,
            event_type       TEXT NOT NULL,
            file_relpath     TEXT,
            word_delta       INTEGER NOT NULL DEFAULT 0,
            advisor_category TEXT
        )
        """
    )
    await db.execute(
        "CREATE INDEX idx_progress_project_date "
        "ON progress_event(project_path, local_date)"
    )


# Ordered list. Append-only. Version N = _MIGRATIONS[N-1].
_MIGRATIONS: list[Callable[[aiosqlite.Connection], Awaitable[None]]] = [
    _migration_001_progress_event,
]


async def _ensure_schema(db: aiosqlite.Connection) -> None:
    """
    Run any pending migrations against the open connection.

    Cheap to call on every connect -- the version check is one SELECT and
    applying zero new migrations is a no-op. Centralizing it here means
    callers never have to think about migration state.
    """
    # The version table itself is bootstrapped here so the very first
    # connect on a fresh database works without a special case.
    await db.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
    )

    cursor = await db.execute("SELECT MAX(version) FROM schema_version")
    row = await cursor.fetchone()
    await cursor.close()
    current = row[0] if row and row[0] is not None else 0

    target = len(_MIGRATIONS)
    if current >= target:
        return

    for version in range(current + 1, target + 1):
        migrate_fn = _MIGRATIONS[version - 1]
        log.info("applying progress_store migration %d", version)
        await migrate_fn(db)
        await db.execute(
            "INSERT INTO schema_version (version) VALUES (?)", (version,)
        )

    await db.commit()


# ── Public API: opening a connection ──────────────────────────────────────────

@asynccontextmanager
async def open_db(project_path: str | Path) -> AsyncIterator[aiosqlite.Connection]:
    """
    Open (or lazily create) a project's app.db, run any pending migrations,
    yield the connection, and close it on exit.

    Usage:
        async with open_db(project_path) as db:
            await db.execute("INSERT INTO progress_event ...")
            await db.commit()

    The first call against a new project creates `.storythread/` and the
    database file. Every call ensures the schema is at the latest version.
    """
    db_path = get_db_path(project_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    db = await aiosqlite.connect(db_path)
    try:
        await _ensure_schema(db)
        yield db
    finally:
        await db.close()


# ── Word counting ─────────────────────────────────────────────────────────────
#
# Approximate, deliberately. The Writing Progress gauge cares about deltas
# between saves, not absolute accuracy. Consistent under-counting cancels out
# across the diff. We strip the two things most likely to skew the count for
# fiction Markdown -- YAML frontmatter at the top, and fenced code blocks
# (which writers rarely use but technically can paste in).

_FRONTMATTER_STRIP_RE = re.compile(r"\A---\s*\n.*?\n---\s*(?:\n|$)", re.DOTALL)
_FENCED_CODE_RE = re.compile(r"```[\s\S]*?```")


def count_words(text: str | None) -> int:
    """
    Approximate word count for a Markdown file. Returns 0 for empty/None input.

    Strips YAML frontmatter at the top of the file and any fenced code blocks
    before splitting on whitespace. Punctuation and Markdown markup remain
    attached to neighboring tokens -- we count tokens, not glyphs.
    """
    if not text:
        return 0
    text = _FRONTMATTER_STRIP_RE.sub("", text, count=1)
    text = _FENCED_CODE_RE.sub("", text)
    return len(text.split())


# ── Event recording ──────────────────────────────────────────────────────────
#
# Save endpoints call record_save_event after writing the file. The function
# never raises -- progress recording is best-effort and should never break a
# save. Callers can wrap in their own try/except as belt-and-suspenders.

async def record_save_event(
    project_path: str | Path,
    file_relpath: str,
    new_content: str,
    previous_content: str | None,
    *,
    rollover_hour: int = 0,
    count_for_task_credit: bool = True,
) -> None:
    """
    Record events resulting from a file save.

    Always: inserts a `word_delta` row if `new_words - previous_words != 0`.
    Conditionally: inserts a `task_credit` row if `count_for_task_credit` is
    True AND no `task_credit` already exists for this file on this local-date.

    Parameters
    ----------
    project_path : the project's root folder (used for db lookup and stored
                   as a column for cross-book series rollups later).
    file_relpath : path relative to the project root, e.g. "manuscript/01.md".
    new_content  : the text just written to disk.
    previous_content : the text that was on disk before the save, or None
                   for a brand-new file.
    rollover_hour : 0 for midnight rollover, 4 for Night Owl mode. Anything
                   in [00:00, rollover_hour) counts as the previous day.
    count_for_task_credit : True for writer-edited files (manuscript, notes,
                   profiles). False for AI-only generated content like
                   chapter/scene summaries -- those still log word_delta for
                   stats but don't earn a daily task credit.
    """
    new_count = count_words(new_content)
    old_count = count_words(previous_content)
    delta = new_count - old_count

    occurred_at = now_iso_local()
    local_date = local_date_for(occurred_at, rollover_hour)

    try:
        async with open_db(project_path) as db:
            if delta != 0:
                await db.execute(
                    "INSERT INTO progress_event "
                    "(project_path, occurred_at, local_date, event_type, "
                    " file_relpath, word_delta) "
                    "VALUES (?, ?, ?, 'word_delta', ?, ?)",
                    (str(project_path), occurred_at, local_date, file_relpath, delta),
                )

            if count_for_task_credit:
                # Idempotent per file per day: only insert if no credit exists yet.
                cursor = await db.execute(
                    "SELECT 1 FROM progress_event "
                    "WHERE project_path = ? AND local_date = ? "
                    "AND event_type = 'task_credit' AND file_relpath = ? "
                    "LIMIT 1",
                    (str(project_path), local_date, file_relpath),
                )
                existing = await cursor.fetchone()
                await cursor.close()

                if existing is None:
                    await db.execute(
                        "INSERT INTO progress_event "
                        "(project_path, occurred_at, local_date, event_type, file_relpath) "
                        "VALUES (?, ?, ?, 'task_credit', ?)",
                        (str(project_path), occurred_at, local_date, file_relpath),
                    )

            await db.commit()
    except Exception:
        # Recording is best-effort. If the DB write fails, log and move on --
        # never let progress tracking interfere with the writer's save.
        log.exception("record_save_event failed for %s/%s", project_path, file_relpath)


async def record_advisor_run(
    project_path: str | Path,
    file_relpath: str,
    category: str,
    *,
    rollover_hour: int = 0,
) -> None:
    """
    Record a Smart Advisor invocation.

    `category` is one of 'default' | 'readability' | 'structure' | 'context'.
    The aggregation layer (see progress router) decides when a chapter has
    accumulated enough advisor runs to earn a task credit:
      - one 'default' run is enough on its own
      - OR all three of {readability, structure, context} run separately

    Best-effort like record_save_event.
    """
    occurred_at = now_iso_local()
    local_date = local_date_for(occurred_at, rollover_hour)

    try:
        async with open_db(project_path) as db:
            await db.execute(
                "INSERT INTO progress_event "
                "(project_path, occurred_at, local_date, event_type, "
                " file_relpath, advisor_category) "
                "VALUES (?, ?, ?, 'advisor_run', ?, ?)",
                (str(project_path), occurred_at, local_date, file_relpath, category),
            )
            await db.commit()
    except Exception:
        log.exception("record_advisor_run failed for %s/%s/%s",
                      project_path, file_relpath, category)


async def migrate_file_relpath(
    project_path: str | Path,
    old_relpath: str,
    new_relpath: str,
) -> bool:
    """
    Repoint every progress_event row from one file path to another.

    Called by the chapter rename cascade: history rows store the relpath
    ("manuscript/01-the-storm.md"), so a file rename would otherwise strand
    them -- today's task credit would double-grant under the new name and
    per-file history would split in two.

    This is a plain data UPDATE, not a schema migration -- it deliberately
    does NOT belong in _MIGRATIONS (that list is for schema changes only).

    Best-effort like every other write in this module: returns True on
    success, False after logging on any failure. Never raises.
    """
    try:
        async with open_db(project_path) as db:
            await db.execute(
                "UPDATE progress_event SET file_relpath = ? "
                "WHERE project_path = ? AND file_relpath = ?",
                (new_relpath, str(project_path), old_relpath),
            )
            await db.commit()
        return True
    except Exception:
        log.exception("migrate_file_relpath failed for %s (%s -> %s)",
                      project_path, old_relpath, new_relpath)
        return False
