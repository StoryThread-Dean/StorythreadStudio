# codex/migrate.py -- profiles/ becomes codex/
# =============================================
# The single highest-risk operation in this whole programme. Everything else
# adds capability; this one REWRITES THE WRITER'S FILES. A bug here does not
# degrade a feature, it costs somebody their character notes.
#
# So the four guarantees came first and the converter was built inside them,
# rather than the other way round:
#
#   DRY RUN      Nothing is touched until the writer has seen exactly what
#                will happen -- how many files, which arcs, what cannot be
#                converted, and where the backup goes.
#   BACKUP       profiles/ is copied before anything is written, and is never
#                auto-deleted. profiles/ itself is also left in place; the
#                writer removes it when they are satisfied, not us.
#   IDEMPOTENT   Running twice does not duplicate Threads, facts or backups.
#   RECOVERABLE  A journal is written BEFORE any change. If the process dies
#                halfway, the next open finds it and offers Resume or Restore
#                Backup. Success is NEVER inferred from the presence of
#                codex/ -- a half-finished migration produces that folder too.
#
# The marker is written only at the very end. Until then the project is, by
# definition, mid-migration.

import json
import logging
import os
import shutil
from datetime import datetime, timezone

from app.codex.threads import parse_thread, render_thread
from app.codex.types_registry import default_registry, seed_registry

log = logging.getLogger(__name__)

MIGRATION_VERSION = 1
JOURNAL_NAME = "codex-migration.json"

# Today's four profile folders, and the Weave type each becomes.
FOLDER_TO_TYPE = {
    "characters": "character",
    "relationships": "relationship",
    "locations": "location",
    "lore": "lore",
}

# Legacy profile types that are NOT world entries. Phase 6 moved summaries to
# plain Markdown under summaries/; these folders only still exist so old
# files open. They are reported and skipped rather than becoming Threads.
SKIP_FOLDERS = {"chapters", "scenes"}


def journal_path(project_path: str) -> str:
    return os.path.join(project_path, ".storythread", JOURNAL_NAME)


def _project_json_path(project_path: str) -> str:
    return os.path.join(project_path, "project.json")


def _read_project(project_path: str) -> dict:
    try:
        with open(_project_json_path(project_path), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_marker(project_path: str) -> None:
    """
    Record that migration finished. Written ONLY on success.

    This is the one durable statement that the project is converted --
    which is why nothing infers it from the existence of codex/.
    """
    data = _read_project(project_path)
    data["codex_migration_version"] = MIGRATION_VERSION
    path = _project_json_path(project_path)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def migration_state(project_path: str) -> str:
    """
    "done" | "incomplete" | "none"

    Checked when a project is opened. "incomplete" means a journal survived,
    so a previous run died partway and the writer must be offered a choice
    rather than silently continuing into a half-converted folder.
    """
    if os.path.isfile(journal_path(project_path)):
        return "incomplete"
    if _read_project(project_path).get("codex_migration_version"):
        return "done"
    return "none"


# ── Looking before leaping ───────────────────────────────────────────────────

def plan_migration(project_path: str) -> dict:
    """
    What WOULD happen. Touches nothing.

    Shown to the writer before the real run, because a destructive operation
    they have not seen the shape of is one they cannot consent to.
    """
    profiles_root = os.path.join(project_path, "profiles")
    report: dict = {
        "project_path": project_path,
        "state": migration_state(project_path),
        "backup_path": _backup_path(project_path),
        "convert": [],
        "arcs": [],
        "skipped": [],
        "warnings": [],
        "unconvertible": [],
        "total": 0,
    }

    if not os.path.isdir(profiles_root):
        report["warnings"].append(
            "This project has no profiles folder, so there is nothing to convert. "
            "The Weave will start empty."
        )
        return report

    for entry in sorted(os.listdir(profiles_root)):
        folder = os.path.join(profiles_root, entry)
        if not os.path.isdir(folder):
            continue

        if entry == "arcs":
            for arc_type in sorted(os.listdir(folder)):
                arc_folder = os.path.join(folder, arc_type)
                if not os.path.isdir(arc_folder):
                    continue
                names = [n for n in sorted(os.listdir(arc_folder)) if n.endswith(".md")]
                if names:
                    report["arcs"].append({"type": arc_type, "count": len(names),
                                           "files": names})
            continue

        if entry in SKIP_FOLDERS:
            names = [n for n in sorted(os.listdir(folder)) if n.endswith(".md")]
            if names:
                report["skipped"].append({
                    "folder": entry, "count": len(names),
                    "reason": "Summaries live under summaries/ since v1.0.x; these "
                              "are legacy files and are left where they are.",
                })
            continue

        type_id = FOLDER_TO_TYPE.get(entry)
        if type_id is None:
            report["unconvertible"].append({
                "folder": entry,
                "reason": "Not a profile type this version knows. Left untouched.",
            })
            continue

        files = [n for n in sorted(os.listdir(folder)) if n.endswith(".md")]
        if not files:
            continue
        report["convert"].append({"folder": entry, "type": type_id,
                                  "count": len(files), "files": files})
        report["total"] += len(files)

        # Warn about anything that will need a decision, before it is made.
        for name in files:
            try:
                with open(os.path.join(folder, name), "r", encoding="utf-8") as f:
                    raw = f.read()
            except OSError as exc:
                report["unconvertible"].append(
                    {"folder": entry, "file": name, "reason": f"Cannot read: {exc}"})
                continue
            thread = parse_thread(raw)
            if not thread.get("entity_id"):
                report["warnings"].append(
                    f"{entry}/{name} has no profile_id; it will be given a new id."
                )

    if report["arcs"]:
        report["warnings"].append(
            "Series arcs become anchored facts on their canonical Thread. The "
            "arc files are kept in the backup."
        )
    return report


def _backup_path(project_path: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return os.path.join(project_path, f"profiles.backup-{stamp}")


# ── Doing it ─────────────────────────────────────────────────────────────────

def run_migration(project_path: str, resume: bool = False) -> dict:
    """
    Convert profiles/ into codex/. Returns a report of what was done.

    Idempotent: an already-migrated project is a no-op. Safe to re-run after
    a crash, which is what `resume` means -- the journal already exists and
    should not be treated as somebody else's unfinished work.
    """
    state = migration_state(project_path)
    if state == "done":
        return {"status": "already-migrated", "converted": 0, "arcs_absorbed": 0,
                "backup_path": None, "warnings": []}
    if state == "incomplete" and not resume:
        return {"status": "incomplete", "journal": journal_path(project_path),
                "message": "A previous migration did not finish. Resume it or "
                           "restore the backup before continuing."}

    plan = plan_migration(project_path)
    backup = plan["backup_path"]

    # 1. The journal, BEFORE anything changes. If the power goes out after
    #    this line, the next open knows a migration was in flight.
    os.makedirs(os.path.join(project_path, ".storythread"), exist_ok=True)
    _write_journal(project_path, {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "backup_path": backup,
        "planned_total": plan["total"],
        "completed": False,
    })

    warnings = list(plan["warnings"])
    profiles_root = os.path.join(project_path, "profiles")

    # 2. Back up first. Never auto-deleted, and profiles/ itself stays too --
    #    the writer removes it when they are satisfied, not us.
    if os.path.isdir(profiles_root) and not os.path.isdir(backup):
        shutil.copytree(profiles_root, backup)

    seed_registry(project_path)
    registry = default_registry()

    converted = 0
    entries: list[dict] = []
    seen_ids: set[str] = set()
    for group in plan["convert"]:
        source = os.path.join(profiles_root, group["folder"])
        target = os.path.join(project_path, "codex", _folder_for(registry, group["type"]))
        os.makedirs(target, exist_ok=True)

        for name in group["files"]:
            try:
                with open(os.path.join(source, name), "r", encoding="utf-8") as f:
                    raw = f.read()
            except OSError as exc:
                warnings.append(f"{group['folder']}/{name} could not be read: {exc}")
                continue

            thread = _convert(raw, group["type"], name, seen_ids, warnings)
            out = os.path.join(target, name)
            # Idempotency: a Thread already written by an earlier attempt is
            # overwritten with the same content, never duplicated beside itself.
            with open(out, "w", encoding="utf-8") as f:
                f.write(render_thread(thread, registry))
            converted += 1
            # WHAT went WHERE, one row per file. Without this the writer is
            # told a number and nothing else, which is exactly the "one button
            # and something happened" experience this app exists to avoid.
            entries.append({
                "type": group["type"],
                "name": thread.get("name") or name,
                "entity_id": thread.get("entity_id", ""),
                "filename": name,
                "source": f"profiles/{group['folder']}/{name}",
                "converted_to":
                    f"codex/{_folder_for(registry, group['type'])}/{name}",
            })

    arcs_absorbed = _absorb_arcs(project_path, registry, warnings)

    # 3. The marker, last. Until this line the project is mid-migration by
    #    definition, whatever exists on disk.
    _write_marker(project_path)

    # 4. Journal removed only once everything above succeeded.
    try:
        os.remove(journal_path(project_path))
    except OSError:
        pass

    report = {
        "status": "migrated",
        "converted": converted,
        "arcs_absorbed": arcs_absorbed,
        "backup_path": backup,
        "entries": entries,
        "skipped": plan["skipped"],
        "unconvertible": plan["unconvertible"],
        "warnings": warnings,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    # Kept on disk, not just returned. "What did that do?" is a question a
    # writer asks the next day as well as in the moment, and a report that
    # only exists in one HTTP response cannot answer it.
    _write_report(project_path, report)
    return report


REPORT_NAME = "migration-report.json"


def report_path(project_path: str) -> str:
    return os.path.join(project_path, ".storythread", "weave", REPORT_NAME)


def _write_report(project_path: str, report: dict) -> None:
    """Best-effort: a report we could not save must not fail a conversion that
    already succeeded."""
    try:
        path = report_path(project_path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        os.replace(tmp, path)
    except OSError as exc:
        log.warning("could not write the migration report: %s", exc)


def load_report(project_path: str) -> dict | None:
    """The last conversion's report, or None if there has not been one."""
    try:
        with open(report_path(project_path), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _folder_for(registry: dict, type_id: str) -> str:
    for entry in registry.get("types", []):
        if entry.get("id") == type_id:
            return entry.get("folder", type_id)
    return type_id


def _convert(raw: str, type_id: str, filename: str,
             seen_ids: set[str], warnings: list[str]) -> dict:
    """
    One profile into one Thread.

    The only content change is the ai_scope fix. Everything else -- prose,
    trait blocks, summaries, tags -- moves across untouched, because it is
    the writer's writing and a migration is not the place to improve it.
    """
    thread = parse_thread(raw)
    thread["type"] = type_id
    thread["filename"] = filename

    if not thread.get("entity_id"):
        import uuid
        thread["entity_id"] = "e-" + uuid.uuid4().hex[:12]
    if thread["entity_id"] in seen_ids:
        # Two profiles sharing an id would collide in the index and silently
        # merge. Give the second a fresh one and say so.
        import uuid
        replacement = "e-" + uuid.uuid4().hex[:12]
        warnings.append(
            f"{filename} shared an id with another profile; it was given a new "
            f"one ({replacement}). Check any links that pointed at it."
        )
        thread["entity_id"] = replacement
    seen_ids.add(thread["entity_id"])

    # THE ai_scope FIX. profiles.py:125 claimed importance "hidden" was never
    # sent to the AI. It was: formatProfileForAI serialized it and the prompt
    # merely asked the model not to name it directly. ai_scope is the real
    # gate, so a hidden trait becomes on-request -- available when the writer
    # asks for it, never volunteered.
    for section in thread.get("sections", {}).values():
        for block in section.get("trait_blocks") or []:
            if block.get("importance") == "hidden" and not block.get("ai_scope"):
                block["ai_scope"] = "on-request"

    return thread


def _absorb_arcs(project_path: str, registry: dict, warnings: list[str]) -> int:
    """
    Series arcs become facts on the canonical Thread.

    An arc was "this character, but in this book" -- which is exactly a fact
    with an anchor, now that anchors exist. Absorbing them removes the second
    overlay mechanism (merge_profile_with_arc, built and tested with zero
    frontend callers) rather than maintaining two.

    Arc content becomes an UNANCHORED fact: we cannot know which chapter it
    began at, and inventing one would place something in the story where it
    may not belong. The Weaving walkthrough surfaces these as Unplaced and
    asks the writer where they go.
    """
    arcs_root = os.path.join(project_path, "profiles", "arcs")
    if not os.path.isdir(arcs_root):
        return 0

    absorbed = 0
    for arc_type in sorted(os.listdir(arcs_root)):
        folder = os.path.join(arcs_root, arc_type)
        if not os.path.isdir(folder):
            continue
        type_id = FOLDER_TO_TYPE.get(arc_type)
        if type_id is None:
            continue
        target_dir = os.path.join(project_path, "codex", _folder_for(registry, type_id))

        for name in sorted(os.listdir(folder)):
            if not name.endswith(".md"):
                continue
            target = os.path.join(target_dir, name)
            if not os.path.isfile(target):
                warnings.append(
                    f"Arc {arc_type}/{name} has no matching Thread; its content "
                    f"is preserved in the backup but was not absorbed."
                )
                continue

            with open(os.path.join(folder, name), "r", encoding="utf-8") as f:
                arc = parse_thread(f.read())
            with open(target, "r", encoding="utf-8") as f:
                thread = parse_thread(f.read(), registry)

            for section_id, section in arc.get("sections", {}).items():
                text = (section.get("content") or "").strip()
                if not text:
                    continue
                thread.setdefault("run", []).append({
                    "id": f"f-arc-{absorbed:04d}",
                    "at": None,                     # deliberately unplaced
                    "axis": f"arc.{section_id}",
                    "value": text,
                    "frame": "truth",
                    "revealed_at": None,
                    "ai_scope": "always",
                    "supersedes": None,
                })
                absorbed += 1

            with open(target, "w", encoding="utf-8") as f:
                f.write(render_thread(thread, registry))

    if absorbed:
        warnings.append(
            f"{absorbed} arc entries were absorbed as facts with no point in the "
            f"story yet. The Weaving walkthrough will ask where each one belongs."
        )
    return absorbed


# ── Recovery ─────────────────────────────────────────────────────────────────

def _write_journal(project_path: str, data: dict) -> None:
    path = journal_path(project_path)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def read_journal(project_path: str) -> dict | None:
    try:
        with open(journal_path(project_path), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def restore_backup(project_path: str) -> dict:
    """
    Put the writer back where they started.

    The half-written codex/ folder is removed and profiles/ is restored from
    the backup. The backup itself is left in place: the writer keeps it until
    they say otherwise, and deleting the safety net at the end of a recovery
    would be an odd time to start trusting ourselves.
    """
    journal = read_journal(project_path)
    if journal is None:
        return {"status": "nothing-to-restore"}

    backup = journal.get("backup_path") or ""
    profiles_root = os.path.join(project_path, "profiles")
    codex_root = os.path.join(project_path, "codex")

    if backup and os.path.isdir(backup):
        if os.path.isdir(profiles_root):
            shutil.rmtree(profiles_root)
        shutil.copytree(backup, profiles_root)
    if os.path.isdir(codex_root):
        shutil.rmtree(codex_root)

    try:
        os.remove(journal_path(project_path))
    except OSError:
        pass

    return {"status": "restored", "backup_path": backup}


# ── Showing the writer what it did ───────────────────────────────────────────
# "It converted 5 profiles" is a number, not an account. A writer who cannot
# see WHAT a conversion did to their own words has to take it on faith, and
# taking AI-adjacent operations on faith is the habit this whole app is built
# to break.
#
# The original side is read from the BACKUP rather than from profiles/. Both
# still exist, but the backup is the copy that was actually converted from and
# nothing can have edited it since. profiles/ could have been touched by the
# writer in the meantime, which would make the comparison quietly wrong.

_TYPE_TO_FOLDER = {v: k for k, v in FOLDER_TO_TYPE.items()}


def compare_migrated(project_path: str, type_id: str, filename: str) -> dict:
    """
    One profile, before and after, field by field.

    Raises FileNotFoundError when either side is missing -- the caller turns
    that into a refusal the writer can act on rather than showing half a
    comparison as if it were whole.
    """
    profiles_folder = _TYPE_TO_FOLDER.get(type_id)
    if profiles_folder is None:
        raise ValueError(f"not a converted type: {type_id!r}")

    report = load_report(project_path) or {}
    backup = report.get("backup_path") or _backup_path(project_path)
    original_path = os.path.join(backup, profiles_folder, filename)

    registry = default_registry()
    converted_path = os.path.join(project_path, "codex",
                                  _folder_for(registry, type_id), filename)

    original_raw = _read(original_path)
    converted_raw = _read(converted_path)

    before = parse_thread(original_raw)
    after = parse_thread(converted_raw)

    return {
        "name": after.get("name") or before.get("name") or filename,
        "type": type_id,
        "filename": filename,
        "original_path": original_path,
        "converted_path": converted_path,
        "sections": _compare_sections(before, after),
        "fields": _compare_fields(before, after),
        # The raw text of both, so a writer who wants to see the actual files
        # never has to leave the app to do it.
        "original_raw": original_raw,
        "converted_raw": converted_raw,
    }


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _section_text(section: dict) -> str:
    """One section flattened for comparison: prose, or its trait blocks."""
    parts: list[str] = []
    content = str(section.get("content") or "").strip()
    if content:
        parts.append(content)
    for block in section.get("trait_blocks") or []:
        line = f"{block.get('trait', '')}: {block.get('description', '')}"
        importance = block.get("importance")
        if importance:
            line += f"  [{importance}]"
        # The one content change the conversion makes, so it has to be visible
        # in the comparison rather than hidden inside a "same" verdict.
        if block.get("ai_scope"):
            line += f"  [AI: {block['ai_scope']}]"
        parts.append(line)
    return "\n".join(parts)


def _compare_sections(before: dict, after: dict) -> list[dict]:
    ids: list[str] = list(before.get("sections") or {})
    for section_id in (after.get("sections") or {}):
        if section_id not in ids:
            ids.append(section_id)

    rows: list[dict] = []
    for section_id in ids:
        old = (before.get("sections") or {}).get(section_id) or {}
        new = (after.get("sections") or {}).get(section_id) or {}
        old_text = _section_text(old)
        new_text = _section_text(new)
        rows.append({
            "id": section_id,
            "heading": new.get("heading") or old.get("heading") or section_id,
            "original": old_text,
            "converted": new_text,
            "changed": old_text.strip() != new_text.strip(),
            # Named separately from "changed" because the two mean different
            # things to a writer: one is "this was edited", the other is
            # "this did not come across".
            "missing": bool(old_text.strip()) and not new_text.strip(),
        })
    return rows


def _compare_fields(before: dict, after: dict) -> list[dict]:
    """The frontmatter, including the bits the conversion deliberately adds."""
    def render(value) -> str:
        if isinstance(value, list):
            return ", ".join(str(v) for v in value)
        if isinstance(value, dict):
            return ", ".join(f"{k}: {v}" for k, v in value.items())
        return "" if value is None else str(value)

    rows: list[dict] = []
    for key, label in (
        ("name", "Name"), ("type", "Kind"), ("entity_id", "Id"),
        ("role", "Role"), ("status", "Status"), ("aliases", "Also known as"),
        ("tags", "Tags"), ("fields", "Extra fields"),
        ("character_kind", "Character kind"), ("ai_scope", "AI may see"),
    ):
        old, new = render(before.get(key)), render(after.get(key))
        if not old and not new:
            continue
        rows.append({"field": label, "original": old, "converted": new,
                     "changed": old != new})
    return rows
