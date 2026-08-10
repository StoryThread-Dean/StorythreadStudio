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


def _new_chapter_id() -> str:
    """Same style as act ids. See chapter_ids below for what these are for."""
    return "c-" + uuid.uuid4().hex[:8]


# ── Chapter IDs (the Weave's anchors) ────────────────────────────────────────
# The Weave records facts against a point in the story -- "as of chapter 7,
# she knows" -- so it needs a chapter identity that survives a rename. The
# filename cannot be it: renaming a chapter is an ordinary thing to do, and
# every anchor keyed to the old name would break.
#
# Stored as a MAP beside the tree rather than inside it:
#
#   "chapter_ids": { "01-chapter-1.md": "c-3f9c2e1b" }
#
# A map rather than turning each entry into {id, file} because filename is
# already the identity everywhere else in this codebase (summaries, progress
# rows, scene sidecars), and every consumer of ordered_chapter_filenames()
# keeps working untouched.
#
# MINTED LAZILY. Nothing here creates ids on its own -- only ensure_chapter_ids()
# does, and only the Weave calls it. A project that never opens the Weave
# keeps a structure.json without the key at all, byte-identical to before.


def _empty_structure() -> dict:
    return {"version": STRUCTURE_VERSION, "acts": [], "unassigned": [], "chapter_ids": {}}


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

    # Chapter ids follow their files: an id whose file is gone is dropped
    # (the anchor pointing at it degrades rather than resolving to nothing),
    # and no id is ever minted here -- see ensure_chapter_ids.
    raw_ids = manifest.get("chapter_ids") or {}
    healed_ids = {
        name: str(cid)
        for name, cid in raw_ids.items()
        if isinstance(name, str) and name in disk_set and cid
    }
    if len(healed_ids) != len(raw_ids):
        changed = True

    return (
        {
            "version": STRUCTURE_VERSION,
            "acts": healed_acts,
            "unassigned": healed_unassigned,
            "chapter_ids": healed_ids,
        },
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
    # Omit chapter_ids entirely when there are none. A project that has never
    # opened the Weave then keeps exactly the file shape it had before ids
    # existed, rather than gaining an empty key on its next act reorder.
    payload = dict(manifest)
    if not payload.get("chapter_ids"):
        payload.pop("chapter_ids", None)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
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


# ── Chapter identity, for Weave anchors ──────────────────────────────────────

def ensure_chapter_ids(folder_path: str) -> dict[str, str]:
    """
    Give every chapter a stable id, minting any that are missing.

    THE ONLY function that creates chapter ids, and the only one that writes
    the manifest for that reason. Call it when a project first needs anchors;
    a project that never does keeps its structure.json untouched (and may not
    have one at all).

    Returns {filename: chapter_id} for every chapter currently on disk.
    """
    manifest, _exists = load_structure(folder_path)
    ids = dict(manifest.get("chapter_ids") or {})

    minted = False
    for name in ordered_chapter_filenames(folder_path):
        if not ids.get(name):
            ids[name] = _new_chapter_id()
            minted = True

    if minted:
        manifest["chapter_ids"] = ids
        try:
            save_structure(folder_path, manifest)
        except OSError as exc:
            # Best-effort, like the healing write above. An anchor created in
            # this session still resolves; the next call re-mints.
            log.warning("could not persist chapter ids: %s", exc)
    return ids


def chapter_id_for_file(folder_path: str, filename: str) -> str | None:
    """This chapter's stable id, or None if ids have never been minted."""
    manifest, _ = load_structure(folder_path)
    return (manifest.get("chapter_ids") or {}).get(filename)


def file_for_chapter_id(folder_path: str, chapter_id: str) -> str | None:
    """
    The chapter a stored anchor points at, or None when it has been deleted.

    None is a normal answer, not an error: an anchor into a chapter the
    writer removed should degrade visibly rather than resolve to whatever
    file now sits in that position.
    """
    manifest, _ = load_structure(folder_path)
    for name, cid in (manifest.get("chapter_ids") or {}).items():
        if cid == chapter_id:
            return name
    return None


def ordered_chapter_ids(folder_path: str) -> list[tuple[str, str]]:
    """
    [(chapter_id, filename)] in reading order, minting ids if needed.

    Reading order comes from ordered_chapter_filenames() -- the single
    ordering authority -- so anchors sort the same way the sidebar, Reader
    Mode and exports do.
    """
    ids = ensure_chapter_ids(folder_path)
    return [(ids[name], name) for name in ordered_chapter_filenames(folder_path) if name in ids]


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
    loaded.setdefault("chapter_ids", {})
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
    # Drop the id too. Any Weave anchor into it now resolves to None, which
    # reads as "that chapter is gone" rather than silently pointing at
    # whatever file later takes its place.
    manifest.get("chapter_ids", {}).pop(filename, None)
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

    # Carry the chapter id across the rename. This is the whole point of
    # having ids: a rename is an ordinary thing to do, and every Weave anchor
    # keyed to this chapter must survive it. Done even when the tree itself
    # had no entry to update, so a renamed chapter never loses its identity.
    ids = manifest.get("chapter_ids", {})
    if old_filename in ids:
        ids[new_filename] = ids.pop(old_filename)
        found = True

    if found:
        save_structure(folder_path, manifest)
    return True
