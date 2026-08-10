# app/codex_store.py -- the Weave's index, and keeping it honest
# ===============================================================
# Markdown is the source of truth. This is an index over it: Threads as
# nodes, Ties as edges, facts making both time-varying. It exists so that
# "which Thread is called Garrick?" and "what does this chapter mention?"
# are lookups rather than a walk over every file in the folder.
#
# ---------------------------------------------------------------------------
# THE PROBLEM THIS MODULE IS MOSTLY ABOUT
# ---------------------------------------------------------------------------
# "An index failure must never block a save" is obviously right -- losing a
# writer's chapter because a cache write failed would be indefensible. But
# taken alone it creates a worse bug:
#
#     the Markdown write succeeds
#     the index write fails
#     the app carries on
#     the graph now answers questions with stale information, confidently
#
# A stale index is more dangerous than a missing one, because nothing looks
# wrong. So every write that fails to update the index sets a DIRTY flag, and
# no read is served while that flag is set: the next reader rebuilds first.
#
# The same flag catches the case no flag could be set for -- the writer
# editing a Thread in another editor, or restoring an old folder from backup.
# `indexed_source_revision` is a fingerprint of the codex folder; if it does
# not match what is on disk now, the index is stale whatever the flag says.

import hashlib
import logging
import os

# is_placeholder lives with the Thread it describes; re-exported here
# because callers already ask the store about entries.
from app.codex.threads import is_placeholder, parse_thread
from app.codex.types_registry import TypesError, load_registry
from app.db import open_db

log = logging.getLogger(__name__)


# ── Is the index current? ────────────────────────────────────────────────────

def source_revision(project_path: str) -> str:
    """
    A fingerprint of the codex folder as it stands.

    Names, sizes and modification times -- enough to notice any edit, cheap
    enough to compute on every read. Not a content hash: reading every
    Thread to decide whether to read every Thread would defeat the point.
    """
    root = os.path.join(project_path, "codex")
    if not os.path.isdir(root):
        return "empty"

    parts: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            if not name.endswith(".md"):
                continue
            full = os.path.join(dirpath, name)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, root).replace("\\", "/")
            parts.append(f"{rel}:{stat.st_size}:{stat.st_mtime_ns}")

    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return "rev-" + digest[:24]


async def read_meta(db) -> dict:
    cursor = await db.execute(
        "SELECT indexed_source_revision, dirty FROM codex_meta WHERE id = 1"
    )
    row = await cursor.fetchone()
    await cursor.close()
    if row is None:
        return {"revision": None, "dirty": True}
    return {"revision": row[0], "dirty": bool(row[1])}


async def mark_dirty(project_path: str) -> None:
    """
    Record that the index can no longer be trusted.

    Best-effort and never raises: it is called from failure paths, and an
    exception here would turn "the index is stale" into "the save failed".
    A dirty flag we could not write is recovered anyway by the revision
    fingerprint, which is why that second mechanism exists.
    """
    try:
        async with open_db(project_path) as db:
            await db.execute("UPDATE codex_meta SET dirty = 1 WHERE id = 1")
            await db.commit()
    except Exception:
        log.exception("could not mark the codex index dirty")


# ── Loading Threads off disk ─────────────────────────────────────────────────

def load_threads(project_path: str) -> list[dict]:
    """
    Every Thread in the project, parsed, each carrying its filename.

    A file that cannot be read is skipped with a log line rather than
    failing the whole index -- one unreadable Thread should cost that
    Thread, not the writer's ability to open the Weave.
    """
    try:
        registry, _ = load_registry(project_path)
    except TypesError:
        # An invalid registry is refused elsewhere with a message the writer
        # can act on; there is nothing sensible to index in the meantime.
        raise

    threads: list[dict] = []
    for type_entry in registry.get("types", []):
        folder = os.path.join(project_path, "codex", type_entry.get("folder", ""))
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".md"):
                continue
            path = os.path.join(folder, name)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = f.read()
            except OSError as exc:
                log.warning("could not read Thread %s: %s", path, exc)
                continue
            thread = parse_thread(raw, registry)
            thread["filename"] = name
            if not thread.get("type"):
                thread["type"] = type_entry.get("id", "")
            threads.append(thread)
    return threads


# ── Rebuilding ───────────────────────────────────────────────────────────────

async def reindex(project_path: str, threads: list[dict] | None = None) -> int:
    """
    Rebuild the index from the folder. Returns how many Threads were indexed.

    A full wipe-and-rebuild rather than incremental updates. The whole thing
    is derivable and a novel's worth of Threads is small, so the simpler
    operation that cannot drift is the right one -- an incremental index that
    misses a case fails silently, which is the failure mode this module
    exists to prevent.
    """
    if threads is None:
        threads = load_threads(project_path)

    revision = source_revision(project_path)

    async with open_db(project_path) as db:
        for table in ("codex_entity", "codex_alias", "codex_tie",
                      "codex_fact", "codex_mention"):
            await db.execute(f"DELETE FROM {table}")

        for thread in threads:
            entity_id = thread.get("entity_id") or ""
            if not entity_id:
                # Without an id it cannot be linked to or anchored against.
                log.warning("Thread %s has no entity_id; skipped",
                            thread.get("filename"))
                continue

            await db.execute(
                "INSERT OR REPLACE INTO codex_entity "
                "(entity_id, type, name, filename, status, ai_scope, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (entity_id, thread.get("type", ""), thread.get("name", ""),
                 thread.get("filename", ""), thread.get("status", ""),
                 thread.get("ai_scope", ""), thread.get("updated_at", "")),
            )

            # The name is an alias too -- detection should not have to
            # special-case "the one that is not in the aliases list".
            names = [thread.get("name", "")] + list(thread.get("aliases") or [])
            for alias in {n.strip() for n in names if n and n.strip()}:
                await db.execute(
                    "INSERT INTO codex_alias (entity_id, alias) VALUES (?, ?)",
                    (entity_id, alias),
                )

            for tie in thread.get("ties") or []:
                await db.execute(
                    "INSERT INTO codex_tie (src_id, rel, dst_id, at_anchor, "
                    "until_anchor, frame, revealed_at, ai_scope) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (entity_id, tie.get("rel", ""), tie.get("target", ""),
                     tie.get("at"), tie.get("until"), tie.get("frame"),
                     tie.get("revealed_at"), tie.get("ai_scope")),
                )

            for fact in thread.get("run") or []:
                if not fact.get("id"):
                    continue
                await db.execute(
                    "INSERT OR REPLACE INTO codex_fact (fact_id, entity_id, axis, "
                    "value, frame, at_anchor, revealed_at, ai_scope, supersedes, "
                    "intentional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (fact.get("id"), entity_id, fact.get("axis", ""),
                     str(fact.get("value", "")), fact.get("frame"), fact.get("at"),
                     fact.get("revealed_at"), fact.get("ai_scope"),
                     fact.get("supersedes"), 1 if fact.get("intentional") else 0),
                )

        await db.execute(
            "UPDATE codex_meta SET indexed_source_revision = ?, dirty = 0 WHERE id = 1",
            (revision,),
        )
        await db.commit()

    return len(threads)


async def ensure_fresh(project_path: str) -> bool:
    """
    Guarantee the index reflects the folder. Returns True if it rebuilt.

    EVERY read path calls this first. A stale graph must never masquerade as
    current canon, so the choice is always "rebuild now" rather than "serve
    what we have and hope".
    """
    async with open_db(project_path) as db:
        meta = await read_meta(db)

    if not meta["dirty"] and meta["revision"] == source_revision(project_path):
        return False

    await reindex(project_path)
    return True


# ── Reading ──────────────────────────────────────────────────────────────────

async def entities(project_path: str, type_id: str | None = None) -> list[dict]:
    await ensure_fresh(project_path)
    sql = ("SELECT entity_id, type, name, filename, status FROM codex_entity")
    params: tuple = ()
    if type_id:
        sql += " WHERE type = ?"
        params = (type_id,)
    sql += " ORDER BY name"
    async with open_db(project_path) as db:
        cursor = await db.execute(sql, params)
        rows = await cursor.fetchall()
        await cursor.close()
    return [
        {"entity_id": r[0], "type": r[1], "name": r[2], "filename": r[3], "status": r[4]}
        for r in rows
    ]




async def find_by_alias(project_path: str, alias: str) -> list[str]:
    """
    Entity ids answering to a name. MORE THAN ONE IS A NORMAL ANSWER.

    Two characters called John, a character and a location sharing a name, a
    title like "Mother" that fits several people -- the caller must treat a
    multi-result as ambiguous and refuse to bind, never take the first.
    """
    await ensure_fresh(project_path)
    async with open_db(project_path) as db:
        cursor = await db.execute(
            "SELECT DISTINCT entity_id FROM codex_alias WHERE alias = ? COLLATE NOCASE",
            (alias,),
        )
        rows = await cursor.fetchall()
        await cursor.close()
    return [r[0] for r in rows]


async def facts_for(project_path: str, entity_id: str) -> list[dict]:
    """Raw facts for a Thread. Temporal filtering is codex/resolve.py's job --
    this returns everything and lets the resolver apply the rules."""
    await ensure_fresh(project_path)
    async with open_db(project_path) as db:
        cursor = await db.execute(
            "SELECT fact_id, axis, value, frame, at_anchor, revealed_at, "
            "ai_scope, supersedes, intentional FROM codex_fact WHERE entity_id = ?",
            (entity_id,),
        )
        rows = await cursor.fetchall()
        await cursor.close()
    return [
        {"id": r[0], "axis": r[1], "value": r[2], "frame": r[3], "at": r[4],
         "revealed_at": r[5], "ai_scope": r[6], "supersedes": r[7],
         "intentional": bool(r[8])}
        for r in rows
    ]


async def ties_for(project_path: str, entity_id: str) -> list[dict]:
    """
    Every Tie touching this Thread, in both directions.

    Only one direction is ever STORED (the inverse is derived from the
    registry), so a caller asking "what connects to Garrick?" has to be given
    the edges pointing at him as well as the ones he owns.
    """
    await ensure_fresh(project_path)
    async with open_db(project_path) as db:
        cursor = await db.execute(
            "SELECT src_id, rel, dst_id, at_anchor, until_anchor, frame, "
            "revealed_at, ai_scope FROM codex_tie WHERE src_id = ? OR dst_id = ?",
            (entity_id, entity_id),
        )
        rows = await cursor.fetchall()
        await cursor.close()
    return [
        {"src_id": r[0], "rel": r[1], "dst_id": r[2], "at": r[3], "until": r[4],
         "frame": r[5], "revealed_at": r[6], "ai_scope": r[7],
         "incoming": r[2] == entity_id and r[0] != entity_id}
        for r in rows
    ]


__all__ = [
    "entities", "ensure_fresh", "facts_for", "find_by_alias",
    "is_placeholder", "load_threads", "mark_dirty", "read_meta", "reindex",
    "source_revision", "ties_for",
]
