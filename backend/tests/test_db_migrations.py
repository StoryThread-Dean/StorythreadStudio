"""
The migration ladder, and the one rule that makes it safe.

WHY THIS FILE EXISTS. A real project broke, immediately, on the first connection
it tried to read:

    "Alexandra's connection came up. How is Alexandra Langford connected?
     *Reading connections  [Failed to fetch] error message"

The cause was an ALTER added to migration 003 AFTER 003 had already run on that
machine. An applied migration never runs again -- the version says it is done --
so the column was never added, and the next SELECT that named it died with
"no such column: rel_inverse".

The whole suite passed through it. Every other test builds its database from
scratch, where a rewritten 003 is indistinguishable from a correct one. Only an
UPGRADE finds this class of bug, so upgrades are what this file tests.
"""

import sqlite3

import pytest

from app.db import _MIGRATIONS, _ensure_schema, get_db_path, open_db


def _columns(project_path: str, table: str) -> set[str]:
    con = sqlite3.connect(get_db_path(project_path))
    try:
        return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    finally:
        con.close()


def _version(project_path: str) -> int:
    con = sqlite3.connect(get_db_path(project_path))
    try:
        row = con.execute("SELECT MAX(version) FROM schema_version").fetchone()
        return row[0] or 0
    finally:
        con.close()


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / ".storythread").mkdir(parents=True)
    return str(root)


async def _build_to(project_path: str, stop_after: int) -> None:
    """
    A database as it stood when only the first `stop_after` migrations existed.

    This is the only way to test an upgrade honestly: run the real migration
    functions, in order, and stamp the versions the real code would have
    stamped -- then let the current code find it and do whatever it does.
    """
    import aiosqlite

    async with aiosqlite.connect(get_db_path(project_path)) as db:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)")
        for version in range(1, stop_after + 1):
            await _MIGRATIONS[version - 1](db)
            await db.execute("INSERT INTO schema_version (version) VALUES (?)",
                             (version,))
        await db.commit()


# ── The bug that prompted this file ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_database_at_version_3_gets_rel_inverse(project):
    # THE EXACT FAILURE. A project that had been open while `reason` shipped is
    # at version 3. If the next column is smuggled into 003 it never arrives.
    await _build_to(project, 3)
    assert "rel_inverse" not in _columns(project, "codex_tie")

    async with open_db(project) as db:
        await db.execute("SELECT rel_inverse FROM codex_tie")

    assert "rel_inverse" in _columns(project, "codex_tie")


@pytest.mark.asyncio
async def test_a_database_at_version_2_gets_all_three_columns(project):
    # A project that predates the reason line entirely.
    await _build_to(project, 2)
    async with open_db(project):
        pass
    assert {"reason", "reason_inverse", "rel_inverse"} <= _columns(project, "codex_tie")


@pytest.mark.asyncio
async def test_an_upgraded_database_matches_a_fresh_one(project, tmp_path):
    # The real guarantee. If these two ever differ, some code path works on one
    # writer's machine and not another's, and which one you are depends on when
    # you happened to first open the app.
    await _build_to(project, 2)
    async with open_db(project):
        pass

    fresh = tmp_path / "Fresh"
    (fresh / ".storythread").mkdir(parents=True)
    async with open_db(str(fresh)):
        pass

    for table in ("codex_tie", "codex_entity", "codex_fact", "codex_mention",
                  "codex_alias", "codex_meta", "progress_event"):
        assert _columns(project, table) == _columns(str(fresh), table), table
    assert _version(project) == _version(str(fresh))


# ── The ladder itself ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_every_migration_is_reached(project):
    async with open_db(project):
        pass
    assert _version(project) == len(_MIGRATIONS)


@pytest.mark.asyncio
async def test_opening_an_up_to_date_database_changes_nothing(project):
    # Called on every connect, so a no-op has to really be one.
    async with open_db(project):
        pass
    before = (_version(project), _columns(project, "codex_tie"))
    for _ in range(3):
        async with open_db(project):
            pass
    assert (_version(project), _columns(project, "codex_tie")) == before


@pytest.mark.asyncio
async def test_a_partly_migrated_database_resumes_rather_than_restarting(project):
    # Migration 001 would fail on a duplicate table if the ladder started over.
    await _build_to(project, 1)
    async with open_db(project):
        pass
    assert _version(project) == len(_MIGRATIONS)


@pytest.mark.asyncio
async def test_each_migration_can_run_on_the_one_before_it(project):
    # Walks the ladder one rung at a time, which is what a writer who opens the
    # app after every release actually does. A migration that only works when
    # applied in a batch with its neighbours passes the other tests here and
    # fails for them.
    import aiosqlite

    async with aiosqlite.connect(get_db_path(project)) as db:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)")
        await db.commit()

    for step in range(1, len(_MIGRATIONS) + 1):
        async with aiosqlite.connect(get_db_path(project)) as db:
            # Pretend only `step` migrations exist by running the ladder to
            # there, through the real entry point.
            original = list(_MIGRATIONS)
            try:
                del _MIGRATIONS[step:]
                await _ensure_schema(db)
            finally:
                _MIGRATIONS[:] = original
        assert _version(project) == step


# ── 005: role and character_kind on the index (R2.3) ────────────────────────
#
# Both were in every Thread FILE from the start and neither was indexed, so
# /api/codex/list could not say whether a character was a protagonist or a
# walk-on, or which editor template they use. The Profile Builder needs both to
# draw a row, so this had to land before it could point at the codex.
#
# Tested as an UPGRADE, which is the whole point of this file: an ALTER
# smuggled into an already-applied migration looks perfectly correct when every
# test builds its database from scratch.

@pytest.mark.asyncio
async def test_a_database_at_version_4_gains_role_and_kind(project):
    await _build_to(project, 4)
    assert "role" not in _columns(project, "codex_entity")

    async with open_db(project):
        pass                       # opening runs what is pending

    assert {"role", "character_kind"} <= _columns(project, "codex_entity")


@pytest.mark.asyncio
async def test_a_v4_upgrade_ends_up_identical_to_a_fresh_database(project, tmp_path):
    await _build_to(project, 4)
    async with open_db(project):
        pass

    fresh = tmp_path / "Fresh"
    (fresh / ".storythread").mkdir(parents=True)
    async with open_db(str(fresh)):
        pass

    assert _columns(project, "codex_entity") == _columns(str(fresh), "codex_entity")
    assert _version(project) == _version(str(fresh))


@pytest.mark.asyncio
async def test_an_existing_row_survives_the_upgrade(project):
    # Every row in a real project predates these columns. If the ALTER demanded
    # a value the upgrade would refuse on exactly the projects that matter.
    import aiosqlite

    await _build_to(project, 4)
    async with aiosqlite.connect(get_db_path(project)) as db:
        await db.execute(
            "INSERT INTO codex_entity (entity_id, type, name, filename) "
            "VALUES ('e-1', 'character', 'Elara Voss', 'elara.md')")
        await db.commit()

    async with open_db(project) as db:
        cursor = await db.execute(
            "SELECT name, role, character_kind FROM codex_entity")
        row = await cursor.fetchone()
        await cursor.close()

    assert row[0] == "Elara Voss"
    assert row[1] is None and row[2] is None
