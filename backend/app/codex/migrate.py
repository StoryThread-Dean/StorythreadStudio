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

from app.utils.atomic import replace_atomic
import shutil
from datetime import datetime, timezone

from app.codex.threads import parse_thread, render_thread
from app.codex.types_registry import default_registry, seed_registry

log = logging.getLogger(__name__)

MIGRATION_VERSION = 1
JOURNAL_NAME = "codex-migration.json"

# BORN IN THE WEAVE. Written into project.json when a project is created, and
# stamped onto an existing project the first time it is opened with nothing in
# profiles/ (see stamp_codex_native).
#
# Why a flag and not a version: `codex_migration_version` is versioned because
# a conversion has a FORMAT, and a later build may need to know which one ran.
# Being born here has nothing to migrate, so there is no version to record.
#
# Why a boolean and not `"entries_home": "codex"`: a stored home string is a
# two-way switch, and the one hand edit that must never work is the one that
# sends a project back to profiles/ and hides a world. A flag can only be true
# or absent. See entries_home for the rule that reads it.
CODEX_NATIVE_KEY = "codex_native"

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


def _merge_project(project_path: str, updates: dict) -> None:
    """
    Read project.json, merge in a few keys, write it back atomically.

    ONE writer for this file, because there are now two things that stamp it
    (the conversion marker and the born-here flag) and a second copy of the
    read-modify-write would be a second chance to clobber the other one.

    `replace_atomic` rather than a plain write: on Windows a replace fails
    while a scanner, the indexer or a sync client holds the file for a
    moment, and losing a writer's project settings to that is not acceptable.
    """
    data = _read_project(project_path)
    data.update(updates)
    path = _project_json_path(project_path)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    replace_atomic(tmp, path)


def _write_marker(project_path: str) -> None:
    """
    Record that migration finished. Written ONLY on success.

    This is the one durable statement that the project is converted --
    which is why nothing infers it from the existence of codex/.
    """
    _merge_project(project_path, {"codex_migration_version": MIGRATION_VERSION})


def stamp_codex_native(project_path: str) -> bool:
    """
    Freeze the answer this project already gives, so it cannot change by
    accident. Returns True if it wrote anything.

    Called when a project is opened. It changes NO behaviour on the day it
    runs -- a project with nothing in profiles/ is already edited in codex/ by
    rule 5 below. What it changes is the day AFTER: rule 5 is an inference
    from an empty folder, and a single stray .md appearing under profiles/ at
    any depth flips the whole project to the legacy home with nothing on
    screen to explain where the writer's world went. A statement cannot be
    flipped by a file appearing.

    Deliberately silent when there is anything to lose. A project that has
    been converted, is mid-conversion, or holds real work in profiles/ is left
    exactly as it is -- this can only ever confirm an answer, never change one.
    """
    if migration_state(project_path) != "none":
        return False          # converted, interrupted, or already stamped
    if _holds_entries(os.path.join(project_path, "profiles")):
        return False          # the writer has work there; say nothing
    _merge_project(project_path, {CODEX_NATIVE_KEY: True})
    return True


def migration_state(project_path: str) -> str:
    """
    "incomplete" | "done" | "native" | "none"

    Checked when a project is opened. "incomplete" means a journal survived,
    so a previous run died partway and the writer must be offered a choice
    rather than silently continuing into a half-converted folder.

    "native" means the project was CREATED in the Weave and has no legacy
    world behind it. It is a fourth value rather than a second meaning for
    "done", because "done" is a claim that a conversion ran: it implies a
    backup on disk, a report to read, and a set of files that used to be
    something else. A native project has none of those, and the screen that
    offers to show "what the conversion did" would have nothing to open.

    It is also not "none". `WeaveScreen.tsx` renders the conversion panel for
    "none", so a new project reporting it is shown an offer to convert a world
    it does not have, INSTEAD of the map -- with no button on the panel, since
    there is nothing to convert. That was the state of every new project
    before this value existed.
    """
    if os.path.isfile(journal_path(project_path)):
        return "incomplete"
    data = _read_project(project_path)
    if data.get("codex_migration_version"):
        return "done"
    if data.get(CODEX_NATIVE_KEY):
        return "native"
    return "none"


def _holds_entries(root: str) -> int:
    """How many entry files are under a world folder, at any depth."""
    total = 0
    for _, _, names in os.walk(root):
        total += sum(1 for n in names if n.endswith(".md"))
    return total


def entries_home(project_path: str) -> str:
    """
    WHERE THIS PROJECT'S ENTRIES LIVE: "codex" or "profiles".

    One answer, in one place, because the alternative has already cost the
    writer a day. The sidebar counted one folder while the Profile Builder read
    the other, so a converted project showed thirteen Characters in the tree
    and twelve on the map -- and twelve of the thirteen could not be opened at
    all. Any surface that needs to know now asks here instead of deciding for
    itself.

    Note what this is NOT. It does not say whether a project has been
    converted; `migration_state` is still the only thing that says that, and
    the marker in project.json is still the only durable statement of it. This
    answers the narrower question the editor actually has to ask, which is
    which folder to open.

    The order of the rules is the whole design:

    1. An INTERRUPTED conversion reads as profiles/. The backup a restore puts
       back is profiles/, so writing into a half-converted codex/ is the one
       thing that could make that restore lossy. This stays first even against
       the born-here flag below: a journal can only exist on a project that
       ran a conversion, which a native project cannot do, so if the two ever
       contradict each other on disk the contradiction is a hand edit -- and
       the answer that loses must be the one that cannot lose files.
    2. A CONVERTED project is codex/. That is what conversion means.
    3. A project BORN IN THE WEAVE is codex/, and this rule has to sit above
       rule 4 rather than below it. Rule 4 is an inference drawn from counting
       files; this is a statement the project makes about itself. A statement
       outranks an inference about the same question. Without this ordering,
       one stray .md anywhere under profiles/ -- an export dropped in the
       wrong folder, a backup unzipped a level too high -- silently relocates
       the writer's entire world and every codex entry disappears from the
       Profile Builder with nothing to explain it.
    4. An UNCONVERTED project whose profiles/ holds work is profiles/, even if
       codex/ has a few entries Weaving made. Hiding a world of thirteen
       profiles behind three placeholders would be the worse failure by far,
       and conversion is an offer rather than a toll gate.
    5. Anything else is codex/. A project with nothing in profiles/ has nothing
       to lose and everything to gain: entries Weaving creates are editable in
       the Profile Builder the moment they exist, which is the handshake the
       Weave is for.

    THE FLAG IS A POSITIVE CLAIM ONLY. It is read as a plain truth test, so a
    hand-written `"codex_native": false` -- or any other value -- falls
    through to rule 4 exactly as an absent key does. There is deliberately no
    value of it that means "profiles". Two things make rule 3 safe in the one
    direction it can act: the flag is only ever WRITTEN when profiles/ holds
    nothing, so it can never be what hides existing work; and if work turns up
    in profiles/ afterwards, `GET /health` counts it as `elsewhere` and the
    screen says so out loud, which is a far better answer than the app
    quietly reversing itself.

    Rule 4 leaves a real gap, and it is deliberately left visible rather than
    papered over: on a project with both, entries Weaving made are edited in
    the Weave and not here. `GET /health` reports the count in the other home
    so the screen can say so out loud instead of quietly showing less than the
    writer has.
    """
    state = migration_state(project_path)
    if state == "incomplete":
        return "profiles"
    if state in ("done", "native"):
        return "codex"
    if _holds_entries(os.path.join(project_path, "profiles")):
        return "profiles"
    return "codex"


def entries_root(project_path: str) -> tuple[str, dict]:
    """
    (the folder this project keeps its entries in, its type registry).

    `entries_home` answers WHICH folder; this hands back the path and the
    registry that names the subfolders inside it, which is what a caller
    walking the world actually needs. Promoted here from export.py, where it
    was the only copy, because the completion gauge needed the same pair and
    a third hand-rolled version is how the two screens come to disagree.

    A broken types.json is reported by the screen that owns it. Here it means
    "use the shipped kinds", not "there is no world".
    """
    from app.codex.types_registry import TypesError, default_registry, load_registry

    home = entries_home(project_path)
    try:
        registry, _ = load_registry(project_path)
    except TypesError:
        registry = default_registry()
    return os.path.join(project_path, home), registry


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

    # BORN HERE, so there is nothing to convert -- and the older wording below
    # would be actively wrong for this project: "the Weave will start empty"
    # said to a writer with thirty entries already in it reads as a threat.
    if report["state"] == "native":
        report["warnings"].append(
            "This project was created in the Weave, so there is nothing to "
            "convert. Your entries already live in codex/."
        )
        return report

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
    # BORN HERE. Nothing on screen offers this, but the route is reachable, and
    # letting it run would do real damage rather than nothing: it writes a
    # journal, calls seed_registry -- which creates a codex/types.json the
    # project deliberately does not have -- and stamps codex_migration_version,
    # relabelling a project that was never converted as converted.
    if state == "native":
        return {"status": "codex-native", "converted": 0, "arcs_absorbed": 0,
                "backup_path": None,
                "warnings": ["This project was created in the Weave, so there "
                             "is nothing to convert."]}
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
        replace_atomic(tmp, path)
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

    # DISCLOSURE, SPLIT FROM WEIGHT.
    #
    # This used to set `ai_scope: on-request` on every hidden trait, reasoning
    # that the prompt's never-name rule was not a real gate. That was a worse
    # trade, not a fix: withholding a secret stops the model naming it by
    # stopping the model knowing it, so a character whose behaviour is entirely
    # shaped by one buried thing arrives with none of it and reads as somebody
    # else. The writer's villain -- parents dead in a hospital, freezes at held
    # hands -- is exactly that character.
    #
    # So a hidden trait converts to what it always meant: an ordinary weight
    # plus `subtext`, which is sent, weighted, and never named. `present` is the
    # weight because the old level recorded none, and these are listed for the
    # writer to weigh rather than guessed at.
    for section in thread.get("sections", {}).values():
        for block in section.get("trait_blocks") or []:
            if block.get("importance") == "hidden":
                block["importance"] = "present"
                block["subtext"] = True

    return thread


def _absorb_arcs(project_path: str, registry: dict, warnings: list[str]) -> int:
    """
    Series arcs become facts on the canonical Thread.

    An arc was "this character, but in this book" -- which is exactly a fact
    with an anchor, now that anchors exist. Absorbing them removed the second
    overlay mechanism rather than maintaining two: the arc editor and
    GET /api/profiles/merged were built, tested, and never called by anything
    on screen, and they are gone.

    WHICH IS WHY THIS STAYS. Nothing in the app can write an arc file any
    more, so it is tempting to delete this too. But an older project, or a
    hand-authored one, may still have files here, and a conversion that
    silently dropped them would be exactly the kind of quiet loss the whole
    backup-and-report design exists to prevent. It costs one isdir check on
    every other project.

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
    replace_atomic(tmp, path)


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

    # The original AS THE WRITER WROTE IT. Reading it with the legacy healing on
    # would interpret its `importance: hidden` the same way the converted file
    # states it, and the two would compare as identical -- hiding the one content
    # change the conversion makes, in the screen built to show it.
    before = parse_thread(original_raw, heal_legacy=False)
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
        if block.get("subtext"):
            line += "  [subtext: true]"
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
