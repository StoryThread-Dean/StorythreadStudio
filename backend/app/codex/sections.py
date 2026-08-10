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

from app.codex.types_registry import GROUPS, TypesError, load_registry

# Documents rather than Threads. These live in notes/ as ordinary Markdown
# and are edited in the editor, not the Weave -- but they belong in the same
# tree, because to a writer they are simply another part of their world.
NOTE_SECTIONS = [
    # Always shown: every project should have somewhere to put a loose
    # thought without adding anything first.
    {"id": "author_notes", "label": "Author Notes", "filename": "author-notes.md",
     "default_section": True},
    {"id": "outline", "label": "Outline", "filename": "outline.md",
     "default_section": False},
    {"id": "style_guide", "label": "Style Guide", "filename": "style-guide.md",
     "default_section": False},
]

GROUP_LABELS = {
    "notes": "Notes",
    "profiles": "Profiles",
    "etc": "etc",
}

# The order groups appear in. "etc" last because it is the catch-all, and a
# catch-all above the things it is a catch-all FOR reads as a mistake.
GROUP_ORDER = ["notes", "profiles", "etc"]


def _count_markdown(folder: str) -> int:
    if not os.path.isdir(folder):
        return 0
    try:
        return sum(1 for n in os.listdir(folder) if n.endswith(".md"))
    except OSError:
        return 0


def _has_content(path: str) -> bool:
    """A file counts as holding something only if it has words in it. An
    empty Outline scaffolded at project creation is not a reason to show
    the section."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return bool(f.read().strip())
    except OSError:
        return False


def build_sections(project_path: str, converted: bool) -> dict:
    """
    The sidebar tree: groups, their sections, and what is available to add.

    `converted` decides where Thread counts come from -- codex/ once the
    project has been brought in, profiles/ before that. Either way the tree
    looks the same, so the sidebar does not change shape underneath a writer
    when they convert.
    """
    try:
        registry, _ = load_registry(project_path)
    except TypesError:
        # A broken registry is reported by the screen that owns it. Here it
        # means "we cannot describe the tree", not "the tree is empty".
        raise

    root = os.path.join(project_path, "codex" if converted else "profiles")
    notes_dir = os.path.join(project_path, "notes")

    groups: dict[str, list[dict]] = {name: [] for name in GROUPS}
    available: list[dict] = []

    # ── Threads ──────────────────────────────────────────────────────────
    for entry in registry.get("types", []):
        count = _count_markdown(os.path.join(root, entry.get("folder", "")))
        group = entry.get("group", "etc")
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
            "icon": "FileText",
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
                "icon": "FileText", "group": "notes", "filename": note["filename"],
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
            groups["notes"].append({
                "kind": "note",
                "id": filename[:-3].replace("-", "_"),
                "label": filename[:-3].replace("-", " ").replace("_", " ").title(),
                "icon": "FileText", "group": "notes", "filename": filename,
                "count": 1, "default_section": False,
            })

    return {
        "groups": [
            {"id": name, "label": GROUP_LABELS.get(name, name),
             "sections": groups.get(name, [])}
            for name in GROUP_ORDER
            # An empty group is a heading with nothing under it. "etc" in
            # particular should not exist until something is in it.
            if groups.get(name)
        ],
        "available": available,
        "converted": converted,
    }
