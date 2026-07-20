# utils/structure_store.py -- The manuscript/structure.json manifest
# ====================================================================
# Acts and chapter ORDER live in one small manifest file:
#
#   manuscript/structure.json
#   {
#     "version": 1,
#     "acts": [
#       { "id": "a-3f9c2e1b", "title": "Act I", "chapters": ["01-chapter-1.md"] }
#     ],
#     "unassigned": ["02-loose-idea.md"]
#   }
#
# Why a manifest instead of renaming/renumbering files: every mature writing
# tool that supports drag-to-reorder (Scrivener's .scrivx, novelWriter's
# .nwx, Obsidian Longform's index note) converged on the same shape -- ONE
# ordered index keyed to stable file identities. Renumbering files on every
# move would churn git history and break everything keyed by filename
# (summaries, progress events, exports).
#
# Reading order = acts in listed order, their chapters in listed order,
# then the unassigned bucket. A project with no acts is just today's flat
# list.
#
# Lifecycle rules (important for backward compatibility):
#   - The file is NOT created at project scaffold time. Projects without it
#     behave exactly as before (filename sort). It first appears when the
#     writer creates an act or reorders something (a PUT).
#   - Loading SELF-HEALS: files deleted by hand are dropped from the
#     manifest; .md files added by hand are appended to `unassigned`; the
#     writer can do anything to the folder in Explorer and the sidebar
#     stays truthful.
#   - A corrupt/unreadable manifest is treated as absent -- never crash the
#     chapter list over a JSON typo.

import json
import logging
import os
import uuid

log = logging.getLogger(__name__)

STRUCTURE_VERSION = 1


def _structure_path(folder_path: str) -> str:
    return os.path.join(folder_path, "manuscript", "structure.json")


def _manuscript_files(folder_path: str) -> list[str]:
    """All top-level .md filenames in manuscript/, filename-sorted."""
    manuscript = os.path.join(folder_path, "manuscript")
    if not os.path.isdir(manuscript):
        return []
    files = [
        e.name for e in os.scandir(manuscript)
        if e.is_file() and e.name.endswith(".md")
    ]
    files.sort()
    return files


def _new_act_id() -> str:
    # Short, stable, greppable. Uniqueness within one project's handful of
    # acts is all we need -- 8 hex chars is plenty.
    return "a-" + uuid.uuid4().hex[:8]


def _empty_structure() -> dict:
    return {"version": STRUCTURE_VERSION, "acts": [], "unassigned": []}


def _heal(manifest: dict, disk_files: list[str]) -> tuple[dict, bool]:
    """
    Reconcile a manifest against what's actually on disk.

    Returns (healed_manifest, changed). Rules:
      1. Entries whose file no longer exists are dropped.
      2. A filename listed twice keeps only its first occurrence.
      3. Disk files missing from the manifest are appended to `unassigned`
         in filename order (hand-added files show up, at the end).
      4. Acts keep their id/title even when emptied -- the writer may be
         mid-reorganization; deleting their act would be rude.
    """
    changed = False
    disk_set = set(disk_files)
    seen: set[str] = set()

    healed_acts = []
    for act in manifest.get("acts", []):
        if not isinstance(act, dict):
            changed = True
            continue
        kept: list[str] = []
        for name in act.get("chapters", []):
            if not isinstance(name, str) or name not in disk_set or name in seen:
                changed = True
                continue
            seen.add(name)
            kept.append(name)
        if kept != act.get("chapters", []):
            changed = True
        healed_acts.append({
            "id": str(act.get("id") or _new_act_id()),
            "title": str(act.get("title") or "Untitled Act"),
            "chapters": kept,
        })

    healed_unassigned: list[str] = []
    for name in manifest.get("unassigned", []):
        if not isinstance(name, str) or name not in disk_set or name in seen:
            changed = True
            continue
        seen.add(name)
        healed_unassigned.append(name)

    # Rule 3: anything on disk the manifest doesn't know about yet.
    for name in disk_files:
        if name not in seen:
            healed_unassigned.append(name)
            changed = True

    return (
        {"version": STRUCTURE_VERSION, "acts": healed_acts, "unassigned": healed_unassigned},
        changed,
    )


def load_structure(folder_path: str) -> tuple[dict, bool]:
    """
    Load the healed manifest for a project.

    Returns (manifest, exists_on_disk).

    When manuscript/structure.json is absent (or corrupt), a manifest is
    SYNTHESIZED in memory -- no acts, every chapter unassigned in filename
    order -- and NOT written to disk. Old projects stay byte-identical
    until the writer actively uses acts.

    When the file exists and healing changed it (hand-deleted/added files),
    the healed version is written back so the manifest converges to truth.
    """
    disk_files = _manuscript_files(folder_path)
    path = _structure_path(folder_path)

    raw: dict | None = None
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                raw = loaded
            else:
                log.warning("structure.json is not an object; treating as absent")
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("structure.json unreadable (%s); treating as absent", exc)

    if raw is None:
        manifest = _empty_structure()
        manifest["unassigned"] = disk_files
        return manifest, False

    healed, changed = _heal(raw, disk_files)
    if changed:
        # Converge the on-disk file to reality. Best-effort: a failed write
        # just means we heal again next load.
        try:
            save_structure(folder_path, healed)
        except OSError as exc:
            log.warning("could not write healed structure.json: %s", exc)
    return healed, True


def save_structure(folder_path: str, manifest: dict) -> None:
    """
    Atomically write the manifest (tmp file + os.replace, same pattern as
    settings_store) so a crash mid-write can't leave half a JSON file.
    """
    path = _structure_path(folder_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    os.replace(tmp, path)


def ordered_chapter_filenames(folder_path: str) -> list[str]:
    """
    The project's chapter reading order -- THE ordering authority.

    Manifest order when structure.json exists (acts first, then unassigned);
    plain filename sort when it doesn't. Every consumer that used to
    `sort(key=filename)` goes through here instead, so the sidebar, Reader
    Mode, exports, and the progress gauge always agree.
    """
    manifest, exists = load_structure(folder_path)
    if not exists:
        return manifest["unassigned"]   # synthesized = filename-sorted

    ordered: list[str] = []
    for act in manifest["acts"]:
        ordered.extend(act["chapters"])
    ordered.extend(manifest["unassigned"])
    return ordered


def order_rank(folder_path: str) -> dict[str, int]:
    """
    {filename: position} for sorting chapter lists. Files not in the map
    (created between the manifest read and the directory scan) sort last by
    name -- callers use rank.get(name, len(rank)) style fallbacks.
    """
    return {name: i for i, name in enumerate(ordered_chapter_filenames(folder_path))}


# ── Mutation hooks (called by chapter create/delete/rename) ─────────────────
# All three are no-ops when structure.json doesn't exist yet: projects that
# never used acts keep their zero-manifest life, and the synthesized view
# picks up new files automatically via the disk scan.
#
# IMPORTANT: these operate on the RAW manifest (_load_raw), not the healed
# one. The rename hook runs AFTER the file was renamed on disk -- healing at
# that moment would see "old name gone, new name unknown", drop the old
# entry from its act, and append the new name to `unassigned`. The chapter
# would silently fall out of its act on every rename. Raw + targeted edit
# keeps the position; the next ordinary load still heals anything else.

def _load_raw(folder_path: str) -> dict | None:
    """The manifest exactly as stored, or None when absent/corrupt."""
    path = _structure_path(folder_path)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("structure.json unreadable in mutation hook (%s)", exc)
        return None
    if not isinstance(loaded, dict):
        return None
    loaded.setdefault("acts", [])
    loaded.setdefault("unassigned", [])
    return loaded


def sync_add_chapter(folder_path: str, filename: str) -> None:
    """A chapter file was created -- append it to `unassigned`."""
    manifest = _load_raw(folder_path)
    if manifest is None:
        return
    already_known = filename in manifest["unassigned"] or any(
        filename in act.get("chapters", [])
        for act in manifest["acts"] if isinstance(act, dict)
    )
    if not already_known:
        manifest["unassigned"].append(filename)
        save_structure(folder_path, manifest)


def sync_remove_chapter(folder_path: str, filename: str) -> None:
    """A chapter file was deleted -- drop it wherever it appears."""
    manifest = _load_raw(folder_path)
    if manifest is None:
        return
    for act in manifest["acts"]:
        if isinstance(act, dict):
            act["chapters"] = [n for n in act.get("chapters", []) if n != filename]
    manifest["unassigned"] = [n for n in manifest["unassigned"] if n != filename]
    save_structure(folder_path, manifest)


def sync_rename_chapter(folder_path: str, old_filename: str, new_filename: str) -> bool:
    """
    A chapter file was renamed -- swap the entry IN PLACE so the chapter
    keeps its act and its position. Returns True on success (including the
    no-manifest case, where there's simply nothing to update).
    """
    manifest = _load_raw(folder_path)
    if manifest is None:
        return True

    found = False
    for act in manifest["acts"]:
        if not isinstance(act, dict):
            continue
        chapters = act.get("chapters", [])
        for i, name in enumerate(chapters):
            if name == old_filename:
                chapters[i] = new_filename
                found = True
    for i, name in enumerate(manifest["unassigned"]):
        if name == old_filename:
            manifest["unassigned"][i] = new_filename
            found = True

    if found:
        save_structure(folder_path, manifest)
    return True
