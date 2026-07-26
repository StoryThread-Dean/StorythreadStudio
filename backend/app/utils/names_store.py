# utils/names_store.py -- The character name database
# =====================================================
# Serves the Name Generator's real-world name pools (given names by culture
# + era + gender, surnames by culture + era) from an APP-LEVEL SQLite
# database at ~/.storythread/names.db.
#
# Why SQLite instead of shipping the lists to the frontend as code?
# The writer asked for room to grow: more cultures, more eras, and one day
# writer-added names. Rows scale where source files don't -- and a future
# "my names" feature can live in its own table that reseeding never touches.
#
# The DATA still ships with the app as JSON (backend/app/data/names/*.json,
# one file per region). On startup, seed_names_db() compares the shipped
# SEED_VERSION against the one recorded in the DB and reloads the tables
# when they differ -- so app updates refresh the pools automatically, and a
# deleted names.db simply rebuilds itself. Think of the JSON as the crate
# of index cards and the DB as the card catalog built from it.

import json
import sqlite3
import sys
from pathlib import Path

# Bump when the shipped JSON changes so existing installs reseed on update.
SEED_VERSION = "1"

# App-level location (NOT per-project -- name pools are global data).
# Module-level constants so tests can monkeypatch them to a tmp dir, the
# same isolation pattern settings_store uses.
NAMES_DIR = Path.home() / ".storythread"
NAMES_DB = NAMES_DIR / "names.db"

# The five era buckets, oldest first. Order matters: the fallback walk uses
# list position as distance. Labels are served to the frontend so the UI
# never hardcodes buckets.
ERAS: list[tuple[str, str]] = [
    ("medieval", "Medieval / Renaissance (pre-1700)"),
    ("colonial", "Colonial / Victorian (1700-1900)"),
    ("early20", "Early 20th Century (1900-1940)"),
    ("mid20", "Mid-late 20th Century (1941-1980)"),
    ("current", "Current (1981+)"),
]
ERA_ORDER = [era_id for era_id, _ in ERAS]

VALID_KINDS = {"given", "surname"}
VALID_GENDERS = {"male", "female"}


def _data_dir() -> Path:
    """Locate the shipped JSON seed files in both dev and frozen modes.

    Dev: backend/app/data/names relative to this file. Frozen (PyInstaller
    onefile): the bundle extracts datas to sys._MEIPASS, where the spec's
    ('app/data/names', 'app/data/names') entry recreates the same layout.
    """
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "app" / "data" / "names"
    return Path(__file__).resolve().parent.parent / "data" / "names"


def _connect() -> sqlite3.Connection:
    NAMES_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(NAMES_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def seed_names_db() -> None:
    """Create/refresh names.db from the shipped JSON. Called at startup.

    Cheap when nothing changed (one meta-table read). On a version change
    the seeded tables are dropped and rebuilt -- a future writer-added-names
    table would be separate and untouched by this.
    """
    conn = _connect()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        row = conn.execute("SELECT value FROM meta WHERE key='seed_version'").fetchone()

        # A matching version only counts if the DB actually HAS data. This
        # guards against a first run where the data files were missing or
        # unreadable (partial install, bad bundle) stamping success on an
        # empty database and never retrying -- the exact failure mode is a
        # Name Generator that silently shows only Fantasy races forever.
        has_cultures = False
        table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cultures'"
        ).fetchone()
        if table:
            has_cultures = conn.execute("SELECT 1 FROM cultures LIMIT 1").fetchone() is not None

        if row and row[0] == SEED_VERSION and has_cultures:
            return

        conn.execute("DROP TABLE IF EXISTS cultures")
        conn.execute("DROP TABLE IF EXISTS names")
        conn.execute(
            "CREATE TABLE cultures (id TEXT PRIMARY KEY, label TEXT, region TEXT, sort INTEGER)"
        )
        conn.execute(
            "CREATE TABLE names ("
            " culture TEXT, kind TEXT, era TEXT, gender TEXT, name TEXT)"
        )
        conn.execute("CREATE INDEX idx_names ON names (culture, kind, era, gender)")

        for json_path in sorted(_data_dir().glob("*.json")):
            with open(json_path, "r", encoding="utf-8") as f:
                cultures = json.load(f)
            for c in cultures:
                conn.execute(
                    "INSERT INTO cultures (id, label, region, sort) VALUES (?, ?, ?, ?)",
                    (c["id"], c["label"], c["region"], int(c.get("sort", 0))),
                )
                for era, genders in c.get("given", {}).items():
                    for gender, names in genders.items():
                        conn.executemany(
                            "INSERT INTO names (culture, kind, era, gender, name) VALUES (?, 'given', ?, ?, ?)",
                            [(c["id"], era, gender, n) for n in names],
                        )
                for era, names in c.get("surnames", {}).items():
                    # Surname buckets use the same era ids, plus "any" for
                    # cultures whose surnames didn't shift across periods.
                    conn.executemany(
                        "INSERT INTO names (culture, kind, era, gender, name) VALUES (?, 'surname', ?, NULL, ?)",
                        [(c["id"], era, n) for n in names],
                    )

        # Stamp the version ONLY when something was actually loaded --
        # otherwise leave it unstamped so the next startup tries again.
        inserted = conn.execute("SELECT COUNT(*) FROM cultures").fetchone()[0]
        if inserted > 0:
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)",
                (SEED_VERSION,),
            )
        conn.commit()
    finally:
        conn.close()


def list_cultures() -> list[dict]:
    """All cultures for the picker dropdown, region-grouped display order."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, label, region FROM cultures ORDER BY region, sort, label"
        ).fetchall()
        return [{"id": r[0], "label": r[1], "region": r[2]} for r in rows]
    finally:
        conn.close()


def _fetch(conn: sqlite3.Connection, culture: str, kind: str, era: str, gender: str | None) -> list[str]:
    """Names for one exact (culture, kind, era) slot, gender-aware for given."""
    if kind == "given":
        if gender in VALID_GENDERS:
            rows = conn.execute(
                "SELECT name FROM names WHERE culture=? AND kind='given' AND era=? AND gender=?",
                (culture, era, gender),
            ).fetchall()
        else:  # "any" gender -> both pools
            rows = conn.execute(
                "SELECT name FROM names WHERE culture=? AND kind='given' AND era=?",
                (culture, era),
            ).fetchall()
    else:
        rows = conn.execute(
            "SELECT name FROM names WHERE culture=? AND kind='surname' AND era=?",
            (culture, era),
        ).fetchall()
    return [r[0] for r in rows]


def get_pool(culture: str, kind: str, era: str, gender: str | None = None) -> tuple[list[str], str]:
    """Return (names, used_era) for a request, with honest era fallback.

    era="any" unions every bucket (deduped, first-seen order). A specific
    era tries its exact bucket first, then walks OUTWARD by distance --
    earlier eras before later at each step, because a writer asking for
    Medieval would rather see Colonial names than 1990s ones -- and finally
    the culture's "any" surname bucket. used_era reports what was actually
    served so the UI can say "showing closest available".
    """
    conn = _connect()
    try:
        if era == "any":
            seen: dict[str, None] = {}
            for candidate in [*ERA_ORDER, "any"]:
                for n in _fetch(conn, culture, kind, candidate, gender):
                    seen.setdefault(n)
            return list(seen.keys()), "any"

        # Exact era, then the outward walk, then the "any" bucket.
        candidates = [era]
        idx = ERA_ORDER.index(era)
        for dist in range(1, len(ERA_ORDER)):
            if idx - dist >= 0:
                candidates.append(ERA_ORDER[idx - dist])
            if idx + dist < len(ERA_ORDER):
                candidates.append(ERA_ORDER[idx + dist])
        candidates.append("any")

        for candidate in candidates:
            names = _fetch(conn, culture, kind, candidate, gender)
            if names:
                return names, candidate
        return [], era
    finally:
        conn.close()


def culture_exists(culture_id: str) -> bool:
    conn = _connect()
    try:
        row = conn.execute("SELECT 1 FROM cultures WHERE id=?", (culture_id,)).fetchone()
        return row is not None
    finally:
        conn.close()
