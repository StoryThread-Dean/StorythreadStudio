# app/db.py -- the per-project database, and its schema history
# ==============================================================
# One SQLite file per project, at `<project>/.storythread/app.db`.
#
# EVERYTHING IN HERE IS DERIVABLE. Markdown is the source of truth for the
# manuscript and for the Weave; this database is an index that makes lookups
# fast. Delete it and the next connection rebuilds an empty one, then the
# Weave reindexes itself from the folder. Nothing a writer typed lives here
# and nowhere else.
#
# (The Weaving findings ledger is the deliberate exception, and it does NOT
# live here for exactly that reason -- see the plan: findings are paid for
# with tokens, so they persist as files under .storythread/weave/runs/ and
# this database only indexes them.)
#
# WHY ONE MIGRATION LIST FOR TWO FEATURES
# Writing Progress and the Weave both keep tables here. The list below is
# the single ordered history for the file as a whole, because a version
# number has to mean one thing: "migrations 1..N have run". Two modules each
# appending to their own list would make version 2 ambiguous and would let
# import order decide the schema. So the list is canonical and append-only,
# and the feature modules (progress_store, codex_store) just use open_db.

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable

import aiosqlite

log = logging.getLogger(__name__)


def get_db_path(project_path: str | Path) -> Path:
    """
    Return the per-project SQLite path: `<project>/.storythread/app.db`.

    The `.storythread/` directory is the documented cache home (see CLAUDE.md
    and product-scope.md). Callers should treat its contents as derivable --
    if app.db is deleted, the next connect() will rebuild a fresh, empty
    database.
    """
    return Path(project_path) / ".storythread" / "app.db"


# ── Migrations ────────────────────────────────────────────────────────────────
#
# Each entry is an async function taking a connection and applying one schema
# change. Position in the list IS the version number (1-indexed). Never
# reorder, edit, or delete entries -- only append.


async def _migration_001_progress_event(db: aiosqlite.Connection) -> None:
    """Writing Progress events. Was progress_store's migration 1."""
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


async def _migration_002_codex(db: aiosqlite.Connection) -> None:
    """
    The Weave's index: Threads are nodes, Ties are edges, facts make both
    time-varying. This is the knowledge graph the design is built around.

    NOTE ON ANCHORS. The design sketch listed `at_ord` columns here, but that
    contradicts the rule the rest of the system holds to: ordinals are
    COMPUTED from the current reading order, never stored. A stored ordinal
    goes stale the moment the writer reorders an act, and a stale ordinal is
    worse than none -- it answers confidently and wrongly. So anchors are
    stored as their ids and compared in Python via AnchorIndex, which is
    always reading the current order. A novel's worth of facts is small
    enough that this costs nothing measurable.
    """
    # Single-row table. The CHECK keeps it that way, so "the meta row" is
    # never ambiguous.
    await db.execute(
        """
        CREATE TABLE codex_meta (
            id                      INTEGER PRIMARY KEY CHECK (id = 1),
            indexed_source_revision TEXT,
            dirty                   INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    # Starts DIRTY: an index that has never been built must not claim to be
    # current. The first read rebuilds it.
    await db.execute(
        "INSERT INTO codex_meta (id, indexed_source_revision, dirty) VALUES (1, NULL, 1)"
    )

    await db.execute(
        """
        CREATE TABLE codex_entity (
            entity_id  TEXT PRIMARY KEY,
            type       TEXT NOT NULL,
            name       TEXT NOT NULL,
            filename   TEXT NOT NULL,
            status     TEXT,
            ai_scope   TEXT,
            updated_at TEXT
        )
        """
    )
    await db.execute("CREATE INDEX idx_codex_entity_type ON codex_entity(type)")

    # Aliases drive mention detection, so they are looked up by TEXT far more
    # often than by entity.
    await db.execute(
        """
        CREATE TABLE codex_alias (
            entity_id TEXT NOT NULL,
            alias     TEXT NOT NULL
        )
        """
    )
    await db.execute("CREATE INDEX idx_codex_alias ON codex_alias(alias)")

    await db.execute(
        """
        CREATE TABLE codex_tie (
            src_id       TEXT NOT NULL,
            rel          TEXT NOT NULL,
            dst_id       TEXT NOT NULL,
            at_anchor    TEXT,
            until_anchor TEXT,
            frame        TEXT,
            revealed_at  TEXT,
            ai_scope     TEXT
        )
        """
    )
    # NOTE: `reason` and `reason_inverse` are added by migration 003 rather
    # than declared here. Editing this CREATE would give a fresh install a
    # different table from a migrated one, and then 003 would fail on the
    # duplicate column -- migrations are append-only for exactly this reason.
    await db.execute("CREATE INDEX idx_codex_tie_src ON codex_tie(src_id)")
    await db.execute("CREATE INDEX idx_codex_tie_dst ON codex_tie(dst_id)")

    await db.execute(
        """
        CREATE TABLE codex_fact (
            fact_id     TEXT PRIMARY KEY,
            entity_id   TEXT NOT NULL,
            axis        TEXT NOT NULL,
            value       TEXT NOT NULL,
            frame       TEXT,
            at_anchor   TEXT,
            revealed_at TEXT,
            ai_scope    TEXT,
            supersedes  TEXT,
            intentional INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    await db.execute("CREATE INDEX idx_codex_fact_entity ON codex_fact(entity_id)")

    await db.execute(
        """
        CREATE TABLE codex_mention (
            entity_id  TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            scene_id   TEXT,
            count      INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    await db.execute("CREATE INDEX idx_codex_mention_entity ON codex_mention(entity_id)")
    await db.execute("CREATE INDEX idx_codex_mention_chapter ON codex_mention(chapter_id)")


async def _migration_003_tie_reason(db: aiosqlite.Connection) -> None:
    """
    WHY two things are connected, in the writer's own words.

    Added because the connection the app could record and the connection worth
    recording turned out to be different things:

        A -- connected to -- B                  a name in the brief, no more
        A -- is hiding her theft from -- B      the scene

    Only the second is worth the tokens it costs, so the reason became the one
    field a connection cannot be saved without.

    ALTER rather than a rebuild: this index is a cache and reindexing would also
    fill the columns, but a writer's project may hold an index built minutes ago
    and there is no reason to make them wait for a full re-read of the world to
    get two columns.
    """
    await db.execute("ALTER TABLE codex_tie ADD COLUMN reason TEXT")
    await db.execute("ALTER TABLE codex_tie ADD COLUMN reason_inverse TEXT")
    # The relation as read from the other end, when it differs. "Alexandra
    # friends of Lara / Lara business partners with Alexandra" -- one connection,
    # two true descriptions.
    await db.execute("ALTER TABLE codex_tie ADD COLUMN rel_inverse TEXT")


# Ordered list. Append-only. Version N = _MIGRATIONS[N-1].
_MIGRATIONS: list[Callable[[aiosqlite.Connection], Awaitable[None]]] = [
    _migration_001_progress_event,
    _migration_002_codex,
    _migration_003_tie_reason,
]


async def _ensure_schema(db: aiosqlite.Connection) -> None:
    """
    Run any pending migrations against the open connection.

    Cheap to call on every connect -- the version check is one SELECT and
    applying zero new migrations is a no-op. Centralizing it here means
    callers never have to think about migration state.
    """
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
        log.info("applying app.db migration %d", version)
        await migrate_fn(db)
        await db.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))

    await db.commit()


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
