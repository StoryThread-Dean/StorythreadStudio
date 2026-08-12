# codex/sections.py -- what the sidebar shows, and why
# =====================================================
# The old sidebar listed everything the app could hold, whether or not the
# writer had used any of it. That is fine with four kinds of entry. With
# nine, plus whatever kinds a writer invents, it becomes a wall of empty
# headings -- and a beginner reads a wall of empty headings as "there is an
# enormous amount I am supposed to fill in".
#
# So there is one rule:
#
#     A SECTION APPEARS WHEN IT HOLDS SOMETHING, OR WHEN IT IS A DEFAULT.
#
# Defaults are the handful any book uses -- Characters, Locations, Lore, and
# Author Notes -- so a new project still has somewhere obvious to start.
# Everything else waits until there is a reason for it, and arrives via
# "+ Add New".
#
# The same rule handles the awkward case without a special case anywhere:
# an existing project already has an Outline and a Style Guide, so those
# sections keep showing exactly as they always have. Nothing has to know
# whether a project is old or new.
#
# ---------------------------------------------------------------------------
# BEFORE AND AFTER CONVERSION
# ---------------------------------------------------------------------------
# A project that has not been brought into the Weave still has profiles/ and
# notes/ folders full of the writer's work. Counting those directly means
# the new sidebar is populated and useful on a project that has never been
# converted -- which is what makes conversion an offer rather than a toll
# gate.

import os
import re

from app.codex.icon_keywords import icon_for_name
from app.codex.types_registry import (
    GROUPS, TypesError, load_registry, normalize_group,
)

# ── Notes: a document the writer AUTHORS ─────────────────────────────────────
#
# The dividing line across the three groups, stated once:
#
#   Notes     something you WRITE -- an outline, a style guide, brainstorming,
#             your own "Dungeon Rules". Prose, in your voice.
#   Profiles  an entry ABOUT something in the world -- a person, a place, a
#             faction, a faith, a government. A profile OF something.
#   Other     genuinely neither. Concepts, objects, events, languages.
#
# These live in notes/ as ordinary Markdown and are edited in the editor
# rather than the Weave, but they belong in the same tree: to a writer they
# are simply another part of their world.
# NOTE the labels stay SINGULAR here, unlike the Thread kinds. A Profiles
# section is a container -- "Characters" holds many -- so its label is
# plural. A note is ONE document: there is a single Outline, a single Style
# Guide. Pluralising them would promise a list that does not exist.
NOTE_SECTIONS = [
    # Always shown: every project should have somewhere to put a loose
    # thought without adding anything first.
    {"id": "author_notes", "label": "Author Notes", "filename": "author-notes.md",
     "icon": "NotebookPen", "default_section": True},
    {"id": "outline", "label": "Outline", "filename": "outline.md",
     "icon": "ListTree", "default_section": False},
    {"id": "style_guide", "label": "Style Guide", "filename": "style-guide.md",
     "icon": "Feather", "default_section": False},
    {"id": "brainstorming", "label": "Brainstorming", "filename": "brainstorming.md",
     "icon": "Brain", "default_section": False},
    {"id": "research", "label": "Research", "filename": "research.md",
     "icon": "FileSearch", "default_section": False},
    {"id": "themes", "label": "Themes", "filename": "themes.md",
     "icon": "Paintbrush", "default_section": False},
]

GROUP_LABELS = {
    "notes": "Notes",
    "profiles": "Profiles",
    "other": "Other",
}

# The order groups appear in. "Other" last because it is the catch-all, and
# a catch-all above the things it is a catch-all FOR reads as a mistake.
GROUP_ORDER = ["notes", "profiles", "other"]


def _count_markdown(folder: str) -> int:
    if not os.path.isdir(folder):
        return 0
    try:
        return sum(1 for n in os.listdir(folder) if n.endswith(".md"))
    except OSError:
        return 0


def create_note(project_path: str, label: str) -> dict:
    """
    Add a document of the writer's own under Notes -- "Dungeon Rules",
    "Magic Costs", whatever their book needs.

    The Notes equivalent of adding a kind. Same name rules, for the same
    reason: this becomes a file on their disk. The section then appears
    because sections.py discovers anything in notes/, so there is no list to
    register it in and nothing to keep in step.
    """
    from app.codex.types_registry import TypesError, custom_type_id

    type_id, tidy = custom_type_id(label)
    filename = type_id.replace("_", "-") + ".md"

    notes_dir = os.path.join(project_path, "notes")
    os.makedirs(notes_dir, exist_ok=True)
    path = os.path.join(notes_dir, filename)
    if os.path.isfile(path) and _has_content(path):
        raise TypesError(f"You already have a note called {tidy!r}.", "label")

    # Seeded with its own heading so the section has content immediately --
    # otherwise the "appears when it holds something" rule would hide the
    # thing the writer just asked for.
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# {tidy}\n\n")
    return {"id": type_id, "label": tidy, "filename": filename}


def rename_note(project_path: str, filename: str, label: str) -> dict:
    """
    Fix a note's name, keeping everything written in it.

    The file moves and its first heading follows, so a note called "Dungeon
    Rulez" becomes "Dungeon Rules" without the writer retyping a word of it.
    """
    from app.codex.types_registry import TypesError, custom_type_id

    new_id, tidy = custom_type_id(label)
    new_filename = new_id.replace("_", "-") + ".md"

    notes_dir = os.path.join(project_path, "notes")
    source = os.path.join(notes_dir, filename)
    if not os.path.isfile(source):
        raise TypesError(f"There is no note called {filename!r}.", "filename")

    target = os.path.join(notes_dir, new_filename)
    if os.path.abspath(target) != os.path.abspath(source) and os.path.exists(target):
        raise TypesError(f"You already have a note called {tidy!r}.", "label")

    try:
        with open(source, "r", encoding="utf-8") as f:
            raw = f.read()
        # The heading is the title the writer sees at the top of the page, so
        # leaving it saying the old name would be half a rename.
        updated = re.sub(r"^#\s+.*$", f"# {tidy}", raw, count=1, flags=re.MULTILINE)
        if not updated.lstrip().startswith("#"):
            updated = f"# {tidy}\n\n{raw}"
        with open(source, "w", encoding="utf-8") as f:
            f.write(updated)
        if os.path.abspath(target) != os.path.abspath(source):
            os.rename(source, target)
    except OSError as exc:
        raise TypesError(f"That note could not be renamed: {exc}", "filename") from exc

    return {"id": new_id, "label": tidy, "filename": new_filename}


def delete_note(project_path: str, filename: str) -> dict:
    """
    Remove a note from the sidebar WITHOUT destroying what is in it.

    A note is prose the writer wrote. Unlinking the file would be the one
    irreversible thing this whole feature does, so instead it moves to
    notes/trash/ -- out of the tree, still on disk, still theirs. The message
    says where it went, because a delete that silently keeps a copy is as
    dishonest as one that silently does not.

    Subfolders are not scanned, so it leaves the sidebar immediately.
    """
    from app.codex.types_registry import TypesError

    notes_dir = os.path.join(project_path, "notes")
    source = os.path.join(notes_dir, filename)
    if not os.path.isfile(source):
        raise TypesError(f"There is no note called {filename!r}.", "filename")

    trash = os.path.join(notes_dir, "trash")
    os.makedirs(trash, exist_ok=True)

    target = os.path.join(trash, filename)
    # Never overwrite something already in the trash: a writer who deleted
    # two drafts of the same note should still have both.
    stem, extension = os.path.splitext(filename)
    counter = 2
    while os.path.exists(target):
        target = os.path.join(trash, f"{stem}-{counter}{extension}")
        counter += 1

    try:
        os.rename(source, target)
    except OSError as exc:
        raise TypesError(f"That note could not be removed: {exc}", "filename") from exc

    return {"moved_to": os.path.relpath(target, project_path).replace("\\", "/")}


def _has_content(path: str) -> bool:
    """A file counts as holding something only if it has words in it. An
    empty Outline scaffolded at project creation is not a reason to show
    the section."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return bool(f.read().strip())
    except OSError:
        return False


def build_sections(project_path: str, home: str = "profiles") -> dict:
    """
    The sidebar tree: groups, their sections, and what is available to add.

    `home` is WHICH FOLDER the Thread counts come from -- "codex" or
    "profiles". Callers get it from `entries_home`, which is the one place that
    decides, because the count in this tree and the list in the Profile Builder
    disagreeing is exactly the bug the writer reported: thirteen Characters in
    the tree, twelve on the map, and twelve of them unopenable.

    Either way the tree looks the same, so the sidebar does not change shape
    underneath a writer when they convert.

    Note that `home` is NOT the same question as "has this project been
    converted", and this used to be one parameter doing both jobs. A project
    with nothing in profiles/ is edited in codex/ while being entirely
    unconverted, and reporting that as converted would have been a small lie
    told by the tree.
    """
    from app.codex.migrate import migration_state
    try:
        registry, _ = load_registry(project_path)
    except TypesError:
        # A broken registry is reported by the screen that owns it. Here it
        # means "we cannot describe the tree", not "the tree is empty".
        raise

    root = os.path.join(project_path,
                        "codex" if home == "codex" else "profiles")
    notes_dir = os.path.join(project_path, "notes")

    groups: dict[str, list[dict]] = {name: [] for name in GROUPS}
    available: list[dict] = []

    # ── Threads ──────────────────────────────────────────────────────────
    for entry in registry.get("types", []):
        count = _count_markdown(os.path.join(root, entry.get("folder", "")))
        group = normalize_group(entry.get("group"))
        section = {
            "kind": "type",
            "id": entry["id"],
            "label": entry.get("label", entry["id"]),
            "icon": entry.get("icon", "CircleDashed"),
            "group": group,
            "count": count,
            "default_section": bool(entry.get("default_section")),
        }
        if count > 0 or section["default_section"]:
            groups.setdefault(group, []).append(section)
        else:
            # Not hidden -- waiting. It is offered under "+ Add New", which
            # is where a writer looks for a kind they have not used yet.
            available.append({
                "kind": "type", "id": entry["id"],
                "label": section["label"], "icon": section["icon"], "group": group,
            })

    # ── Notes ────────────────────────────────────────────────────────────
    seen_files = set()
    for note in NOTE_SECTIONS:
        path = os.path.join(notes_dir, note["filename"])
        seen_files.add(note["filename"])
        exists = os.path.isfile(path) and _has_content(path)
        section = {
            "kind": "note",
            "id": note["id"],
            "label": note["label"],
            "icon": note.get("icon", "FileText"),
            "group": "notes",
            "filename": note["filename"],
            "count": 1 if exists else 0,
            "default_section": note["default_section"],
        }
        if exists or note["default_section"]:
            groups["notes"].append(section)
        else:
            available.append({
                "kind": "note", "id": note["id"], "label": note["label"],
                "icon": note.get("icon", "FileText"), "group": "notes",
                "filename": note["filename"],
            })

    # Anything else the writer has put in notes/ by hand. Their file, their
    # section -- discovering it beats pretending it is not there.
    if os.path.isdir(notes_dir):
        try:
            extra = sorted(n for n in os.listdir(notes_dir)
                           if n.endswith(".md") and n not in seen_files)
        except OSError:
            extra = []
        for filename in extra:
            label = filename[:-3].replace("-", " ").replace("_", " ").title()
            groups["notes"].append({
                "kind": "note",
                "id": filename[:-3].replace("-", "_"),
                "label": label,
                # A note the writer named themselves gets the same small
                # surprise a custom kind does.
                "icon": icon_for_name(label) or "FileText",
                "group": "notes", "filename": filename,
                "count": 1, "default_section": False,
            })

    return {
        # ALL THREE GROUPS, ALWAYS. They are the navigational skeleton: a
        # writer opens the Weave, sees Notes, Profiles and Other, and moves
        # toward whichever matches what they are thinking about. Hiding one
        # until it had content would mean they never found it -- and would
        # leave nowhere to click "+ Add New" for the things that belong
        # there, which is the only route to most of the app.
        #
        # The growth this design wants is in the SECTIONS, not the groups.
        "groups": [
            {
                "id": name,
                "label": GROUP_LABELS.get(name, name),
                "sections": groups.get(name, []),
                # What "+ Add New" offers from inside this group. The window
                # shows everything, grouped -- a writer who opened it from
                # Profiles can still add a Religion -- but it opens pointed
                # at the group they came from.
                "available": [a for a in available if a["group"] == name],
            }
            for name in GROUP_ORDER
        ],
        "available": available,
        # The marker in project.json is the only durable statement of this,
        # so it is read rather than inferred from where the entries live.
        "converted": migration_state(project_path) == "done",
    }
