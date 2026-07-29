# audiobook/recents_store.py -- the app-level index of known audiobooks.
# =======================================================================
# The audiobook dashboard needs a Recent Activity list without scanning the
# whole disk for workspaces. This is a small SQLite index in the app data
# folder -- deliberately the same pattern as names_store.py: module-level
# path constant (monkeypatchable in tests), plain synchronous sqlite3, and
# the truth stays in the workspace folders themselves. Losing this DB loses
# nothing but the list; opening a workspace re-registers it.

import sqlite3
from pathlib import Path

# Monkeypatched to a tmp path in tests -- never touch the real app data dir
# from pytest.
AUDIOBOOKS_DB = Path.home() / ".storythread" / "audiobooks.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS audiobooks (
    workspace_path TEXT PRIMARY KEY,
    title          TEXT NOT NULL DEFAULT '',
    author         TEXT NOT NULL DEFAULT '',
    source_file    TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'needs_review',
    imported_at    TEXT NOT NULL DEFAULT '',
    last_opened    TEXT NOT NULL DEFAULT ''
);
"""


def _connect() -> sqlite3.Connection:
    AUDIOBOOKS_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(AUDIOBOOKS_DB)
    conn.row_factory = sqlite3.Row
    conn.execute(_SCHEMA)
    return conn


def record_audiobook(workspace_path: str, title: str, author: str,
                     source_file: str, status: str, imported_at: str) -> None:
    """Insert or refresh one audiobook row (import and open both land here)."""
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO audiobooks
                (workspace_path, title, author, source_file, status, imported_at, last_opened)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_path) DO UPDATE SET
                title=excluded.title, author=excluded.author,
                source_file=excluded.source_file, status=excluded.status,
                last_opened=excluded.last_opened
            """,
            (workspace_path, title, author, source_file, status, imported_at, imported_at),
        )


def touch_opened(workspace_path: str, when_iso: str, status: str | None = None) -> None:
    """Bump last_opened (and optionally status) when a workspace is opened."""
    with _connect() as conn:
        if status is None:
            conn.execute(
                "UPDATE audiobooks SET last_opened=? WHERE workspace_path=?",
                (when_iso, workspace_path),
            )
        else:
            conn.execute(
                "UPDATE audiobooks SET last_opened=?, status=? WHERE workspace_path=?",
                (when_iso, status, workspace_path),
            )


def list_recents() -> list[dict]:
    """Most recently opened first -- the dashboard's Recent Activity order."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM audiobooks ORDER BY last_opened DESC, title ASC"
        ).fetchall()
    return [dict(row) for row in rows]


def remove_recent(workspace_path: str) -> None:
    """
    Forget a workspace. This deletes the INDEX ROW ONLY -- the spec is
    explicit that Remove from Recents must never delete project files.
    """
    with _connect() as conn:
        conn.execute("DELETE FROM audiobooks WHERE workspace_path=?", (workspace_path,))
