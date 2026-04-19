# recent_projects.py -- Recent Project Tracking
# ================================================
# Tracks which projects have been opened so the dashboard can show them
# on next launch without the writer having to find the folder again.
#
# Stored in ~/.storyforge/storyforge.json alongside settings.json.
# Each entry records the project's ID, title, path, and when it was
# last opened. The list is sorted by last_opened (most recent first).
#
# If a tracked project's folder has been deleted or moved, the entry
# stays in the list but is marked with exists=False so the frontend
# can show it as greyed out rather than crashing.

import json
import os
from datetime import datetime, timezone
from pathlib import Path

# Same directory as settings.json -- user's home, not per-project
STORYFORGE_DIR  = Path.home() / ".storyforge"
RECENT_FILE     = STORYFORGE_DIR / "storyforge.json"


def load_recent() -> list[dict]:
    """
    Load the recent projects list from disk.
    Returns a list sorted by last_opened (newest first).
    Each entry has an 'exists' field indicating whether the folder still exists.
    """
    if not RECENT_FILE.exists():
        return []

    try:
        with open(RECENT_FILE, "r", encoding="utf-8") as f:
            entries = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []

    if not isinstance(entries, list):
        return []

    # Add 'exists' flag by checking if the root_path folder is still there.
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
    """
    STORYFORGE_DIR.mkdir(parents=True, exist_ok=True)

    entries = load_recent()
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
    """
    entries = load_recent()
    entries = [e for e in entries if e.get("project_id") != project_id]
    _save(entries)


def _save(entries: list[dict]) -> None:
    """Write the entries list to disk. Strips the 'exists' field before saving."""
    STORYFORGE_DIR.mkdir(parents=True, exist_ok=True)

    # Remove the runtime 'exists' flag before persisting
    clean = []
    for entry in entries:
        e = dict(entry)
        e.pop("exists", None)
        clean.append(e)

    with open(RECENT_FILE, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2)
