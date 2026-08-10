# codex/types_registry.py -- what KINDS of thing a world contains
# ================================================================
# Today the app has four hardcoded entry types (character, relationship,
# location, lore), listed in Python in profiles.py and again in TypeScript in
# types/profile.ts. Adding "faction" means editing both and hoping they stay
# in step.
#
# The Weave makes that data instead: codex/types.json. Types, their sections,
# their custom fields, and the vocabulary of connections between them all
# live in one file, seeded from the defaults below and served to the frontend
# so the two cannot drift.
#
# ---------------------------------------------------------------------------
# WHY THIS FILE IS VALIDATED SO STRICTLY
# ---------------------------------------------------------------------------
# The moment a writer adds a custom type or a relation of their own, this
# stops being config and becomes THEIR DATA -- as much theirs as a chapter.
# So the recovery rule is the opposite of structure.json's:
#
#   structure.json corrupt  -> treat as absent, synthesize, carry on. It is
#                              derivable from the folder, so nothing is lost.
#   types.json corrupt      -> REFUSE. Report the error, leave the file
#                              exactly as it is, open the Weave read-only.
#
# "Helpfully" regenerating defaults over a writer's customization would
# destroy work that cannot be recovered from anywhere else. A validation
# error the writer can read and fix is always better than a silent reset.

import json
import os
import re

SCHEMA_VERSION = 1

# Identifiers are used as folder names, YAML keys and JSON keys, so they are
# kept boring on purpose: lowercase, no spaces, no punctuation beyond "_".
IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

# What a custom field may be. Deliberately short -- every kind here has an
# obvious editor and an obvious serialization.
FIELD_KINDS = {"text", "longtext", "number", "date", "boolean", "list"}

CARDINALITIES = {"one", "many"}

# Where a kind of Thread appears in the sidebar.
#
# Three groups, and ALL THREE ARE ALWAYS SHOWN even when empty. They are the
# navigational skeleton: a writer opening the Weave sees Notes, Profiles and
# Other, and moves toward whichever matches what they are thinking about.
# Hiding a group until it has content would mean they never discover it, and
# would leave nowhere to click "+ Add New" for the things that belong there.
#
# It is the SECTIONS INSIDE the groups that grow. That is where the
# anti-overwhelm rule applies -- see codex/sections.py.
#
# "Other" is not a dumping ground. It is the honest answer for a kind that
# is neither a written document nor a profile of something, and a writer can
# move a section out of it whenever they disagree.
GROUPS = {"notes", "profiles", "other"}
DEFAULT_GROUP = "other"

# Accepted on read only. An early build wrote "etc"; the word on screen is
# "Other", and a cryptic abbreviation in the writer's own types.json is not
# something to leave lying around.
_GROUP_ALIASES = {"etc": "other"}


def normalize_group(value) -> str:
    """A stored group name, mapped to what this build calls it."""
    group = str(value or DEFAULT_GROUP).strip().lower()
    return _GROUP_ALIASES.get(group, group)


class TypesError(Exception):
    """An invalid registry. Carries where the problem is, so the message can
    point at a line rather than saying 'invalid file'."""

    def __init__(self, message: str, path: str = ""):
        self.path = path
        super().__init__(f"{path}: {message}" if path else message)


# ── The built-in defaults ────────────────────────────────────────────────────
# Seeded into a new project's types.json. After that the file is the writer's;
# these are never re-applied over it.

def _sections(*names: str) -> list[dict]:
    return [{"id": n, "heading": n.replace("_", " ").title(), "trait_blocks": False}
            for n in names]


# THE SIDEBAR RULE, in one place because three surfaces depend on it:
#
#   A section appears when it holds something, OR when it is a default.
#
# Defaults are the handful a writer of any book will use -- Characters,
# Locations, Lore -- so a new project is not an empty tree with nothing to
# click. Everything else stays out of the way until it has a reason to be
# there, which is what stops a nine-kind world from greeting a beginner with
# nine empty headings.
#
# The same rule handles the awkward case gracefully: an existing project
# already has an Outline and a Style Guide, so those sections keep showing
# exactly as they always did. Nothing has to know whether a project is old
# or new.


DEFAULT_TYPES: list[dict] = [
    {
        "id": "character", "label": "Character", "folder": "characters",
        "icon": "User",
        "sections": [
            {"id": "overview", "heading": "Overview", "trait_blocks": False},
            {"id": "physical_traits", "heading": "Physical Traits", "trait_blocks": True},
            {"id": "personality_traits", "heading": "Personality Traits", "trait_blocks": True},
            {"id": "motivations", "heading": "Motivations", "trait_blocks": True},
            {"id": "voice_notes", "heading": "Voice Notes", "trait_blocks": True},
            {"id": "hidden_and_foreshadowing", "heading": "Hidden and Foreshadowing",
             "trait_blocks": True},
            {"id": "relationships_overview", "heading": "Relationships Overview",
             "trait_blocks": False},
            {"id": "notes", "heading": "Notes", "trait_blocks": False},
        ],
        "required_fields": ["overview"],
        "custom_fields": [],
        "group": "profiles",
        "default_section": True,
    },
    {"id": "relationship", "label": "Relationship", "folder": "relationships",
     "icon": "Heart", "group": "profiles", "default_section": False,
     "sections": _sections("overview", "current_dynamic", "history", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "location", "label": "Location", "folder": "locations", "icon": "MapPin",
     "group": "profiles", "default_section": True,
     "sections": _sections("overview", "appearance", "significance", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "lore", "label": "Lore", "folder": "lore", "icon": "BookOpen",
     "group": "profiles", "default_section": True,
     "sections": _sections("overview", "details", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    # ── Profiles: an entry ABOUT something in the world ──────────────────
    # A person, a place, a group, a faith, a government. The test is "am I
    # writing a profile OF something?" -- which is why a Faction belongs
    # here beside a Character, and not in the leftovers.
    {"id": "faction", "label": "Faction", "folder": "factions", "icon": "Flag",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "structure", "goals", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "religion", "label": "Religion", "folder": "religions", "icon": "Sparkles",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "beliefs", "practices", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "government", "label": "Government", "folder": "governments", "icon": "Landmark",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "structure", "laws", "succession", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "deity", "label": "Deity", "folder": "deities", "icon": "Sun",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "domain", "worship", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "creature", "label": "Creature", "folder": "creatures", "icon": "PawPrint",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "appearance", "behaviour", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "culture", "label": "Culture", "folder": "cultures", "icon": "Users",
     "group": "profiles", "default_section": False,
     "sections": _sections("overview", "customs", "values", "notes"),
     "required_fields": ["overview"], "custom_fields": []},

    # ── Other: genuinely neither a document nor a profile of something ───
    {"id": "object", "label": "Object", "folder": "objects", "icon": "Package",
     "group": "other", "default_section": False,
     "sections": _sections("overview", "appearance", "significance", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "concept", "label": "Concept", "folder": "concepts", "icon": "Lightbulb",
     "group": "other", "default_section": False,
     "sections": _sections("overview", "details", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "event", "label": "Event", "folder": "events", "icon": "CalendarClock",
     "group": "other", "default_section": False,
     "sections": _sections("overview", "what_happened", "consequences", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
    {"id": "language", "label": "Language", "folder": "languages", "icon": "Languages",
     "group": "other", "default_section": False,
     "sections": _sections("overview", "sound_and_script", "notes"),
     "required_fields": ["overview"], "custom_fields": []},
]


def _rel(rid, label, *, inverse=None, symmetric=False, src, dst,
         cardinality="many", exclusive_group=None) -> dict:
    return {
        "id": rid, "label": label, "inverse": inverse, "symmetric": symmetric,
        "source_types": list(src), "target_types": list(dst),
        "cardinality": cardinality, "exclusive_group": exclusive_group,
    }


# NOTE on exclusive_group, which is deliberately EMPTY on married_to.
# It is tempting to have the contradiction checker treat two simultaneous
# marriages as an error. That would encode one culture's marriage rules into
# a tool for writing invented ones -- polygamy, political marriages and
# stranger arrangements are ordinary in fiction. Exclusivity is something a
# writer declares about THEIR world, not something the app assumes.
DEFAULT_RELATIONS: list[dict] = [
    _rel("mentored_by", "mentored by", inverse="mentor_of",
         src=["character"], dst=["character"]),
    _rel("parent_of", "parent of", inverse="child_of",
         src=["character"], dst=["character"]),
    _rel("sibling_of", "sibling of", symmetric=True,
         src=["character"], dst=["character"]),
    _rel("married_to", "married to", symmetric=True,
         src=["character"], dst=["character"]),
    _rel("loves", "loves", src=["character"], dst=["character"]),
    _rel("rivals", "rival of", symmetric=True,
         src=["character"], dst=["character"]),
    _rel("betrayed", "betrayed", src=["character"], dst=["character"]),
    _rel("serves", "serves", src=["character"], dst=["character", "faction"]),
    _rel("member_of", "member of", inverse="has_member",
         src=["character"], dst=["faction", "religion"]),
    _rel("leads", "leads", inverse="led_by",
         src=["character"], dst=["faction", "religion"], cardinality="one"),
    _rel("founded", "founded", inverse="founded_by",
         src=["character"], dst=["faction", "religion", "location"]),
    _rel("exiled_from", "exiled from",
         src=["character"], dst=["location", "faction"]),
    _rel("born_in", "born in", src=["character"], dst=["location"], cardinality="one"),
    _rel("rules", "rules", inverse="ruled_by",
         src=["character", "faction"], dst=["location"]),
    _rel("at_war_with", "at war with", symmetric=True,
         src=["faction", "religion"], dst=["faction", "religion"]),
    _rel("allied_with", "allied with", symmetric=True,
         src=["faction", "religion"], dst=["faction", "religion"]),
    _rel("vassal_of", "vassal of", inverse="overlord_of",
         src=["faction"], dst=["faction"], cardinality="one"),
    _rel("schism_of", "schism of", src=["faction", "religion"],
         dst=["faction", "religion"]),
    _rel("believes", "believes", src=["character", "faction"],
         dst=["religion", "lore", "concept"]),
    _rel("practices", "practices", src=["character", "faction"],
         dst=["religion", "concept"]),
    _rel("forbidden_by", "forbidden by", src=["concept", "object", "lore"],
         dst=["religion", "faction"]),
    _rel("prophesied_in", "prophesied in", src=["character", "event"],
         dst=["lore", "religion"]),
    _rel("owns", "owns", inverse="owned_by",
         src=["character", "faction"], dst=["object"]),
]


def default_registry() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "types": [dict(t) for t in DEFAULT_TYPES],
        "relations": [dict(r) for r in DEFAULT_RELATIONS],
    }


# ── Validation ───────────────────────────────────────────────────────────────

def _check_identifier(value, path: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.match(value):
        raise TypesError(
            f"{value!r} is not a valid id. Use lowercase letters, digits and "
            f"underscores, starting with a letter (max 40 characters).",
            path,
        )
    return value


def validate_registry(data) -> None:
    """
    Raise TypesError describing the FIRST problem found, naming its location.

    Deliberately fail-fast with a located message: "types[3].id" tells a
    writer where to look, where "invalid types.json" does not.
    """
    if not isinstance(data, dict):
        raise TypesError("The file must contain a JSON object.")

    version = data.get("schema_version")
    if version is None:
        raise TypesError("Missing 'schema_version'.", "schema_version")
    if not isinstance(version, int):
        raise TypesError("Must be a whole number.", "schema_version")
    if version > SCHEMA_VERSION:
        # Written by a newer build. Refusing beats guessing at a shape we do
        # not know -- and beats silently discarding whatever is new in it.
        raise TypesError(
            f"This file was written by a newer version of Storythread Studio "
            f"(schema {version}; this build understands {SCHEMA_VERSION}). "
            f"Update the app to open it.",
            "schema_version",
        )

    types = data.get("types")
    if not isinstance(types, list) or not types:
        raise TypesError("At least one type is required.", "types")

    seen_types: set[str] = set()
    seen_folders: set[str] = set()
    for i, entry in enumerate(types):
        path = f"types[{i}]"
        if not isinstance(entry, dict):
            raise TypesError("Must be an object.", path)
        type_id = _check_identifier(entry.get("id"), f"{path}.id")
        if type_id in seen_types:
            raise TypesError(f"Duplicate type id {type_id!r}.", f"{path}.id")
        seen_types.add(type_id)

        folder = entry.get("folder")
        if not isinstance(folder, str) or not folder.strip():
            raise TypesError("A folder name is required.", f"{path}.folder")
        # Two types sharing a folder would silently interleave their entries.
        if folder in seen_folders:
            raise TypesError(f"Duplicate folder {folder!r}.", f"{path}.folder")
        seen_folders.add(folder)
        if "/" in folder or "\\" in folder or ".." in folder:
            raise TypesError("Must be a plain folder name.", f"{path}.folder")

        group = normalize_group(entry.get("group", DEFAULT_GROUP))
        if group not in GROUPS:
            raise TypesError(
                f"{group!r} is not a sidebar group. Use one of: "
                f"{', '.join(sorted(GROUPS))}.",
                f"{path}.group",
            )

        sections = entry.get("sections")
        if not isinstance(sections, list) or not sections:
            raise TypesError("At least one section is required.", f"{path}.sections")
        seen_sections: set[str] = set()
        for j, section in enumerate(sections):
            spath = f"{path}.sections[{j}]"
            if not isinstance(section, dict):
                raise TypesError("Must be an object.", spath)
            section_id = _check_identifier(section.get("id"), f"{spath}.id")
            if section_id in seen_sections:
                raise TypesError(f"Duplicate section id {section_id!r}.", f"{spath}.id")
            seen_sections.add(section_id)

        for j, field in enumerate(entry.get("custom_fields") or []):
            fpath = f"{path}.custom_fields[{j}]"
            if not isinstance(field, dict):
                raise TypesError("Must be an object.", fpath)
            _check_identifier(field.get("id"), f"{fpath}.id")
            kind = field.get("kind")
            if kind not in FIELD_KINDS:
                raise TypesError(
                    f"{kind!r} is not a field kind. Use one of: "
                    f"{', '.join(sorted(FIELD_KINDS))}.",
                    f"{fpath}.kind",
                )

        for name in entry.get("required_fields") or []:
            if name not in seen_sections and name not in {
                f.get("id") for f in (entry.get("custom_fields") or [])
            }:
                raise TypesError(
                    f"{name!r} is required but is neither a section nor a custom field.",
                    f"{path}.required_fields",
                )

    relations = data.get("relations")
    if not isinstance(relations, list):
        raise TypesError("Must be a list (may be empty).", "relations")

    seen_relations: set[str] = set()
    for i, rel in enumerate(relations):
        path = f"relations[{i}]"
        if not isinstance(rel, dict):
            raise TypesError("Must be an object.", path)
        rel_id = _check_identifier(rel.get("id"), f"{path}.id")
        if rel_id in seen_relations:
            raise TypesError(f"Duplicate relation id {rel_id!r}.", f"{path}.id")
        seen_relations.add(rel_id)

        if rel.get("inverse") is not None:
            _check_identifier(rel.get("inverse"), f"{path}.inverse")
            if rel.get("symmetric"):
                # A symmetric relation IS its own inverse; naming another one
                # would give two different answers to the same question.
                raise TypesError(
                    "A symmetric relation cannot also name an inverse.",
                    f"{path}.inverse",
                )

        for key in ("source_types", "target_types"):
            values = rel.get(key)
            if not isinstance(values, list) or not values:
                raise TypesError("At least one type is required.", f"{path}.{key}")
            for value in values:
                if value not in seen_types:
                    raise TypesError(
                        f"{value!r} is not a type defined in this file.",
                        f"{path}.{key}",
                    )

        if rel.get("cardinality", "many") not in CARDINALITIES:
            raise TypesError(
                f"Must be one of: {', '.join(sorted(CARDINALITIES))}.",
                f"{path}.cardinality",
            )


# ── Loading ──────────────────────────────────────────────────────────────────

def registry_path(folder_path: str) -> str:
    return os.path.join(folder_path, "codex", "types.json")


def load_registry(folder_path: str) -> tuple[dict, bool]:
    """
    (registry, from_file). Raises TypesError on an invalid file.

    An ABSENT file yields the built-in defaults with from_file=False and
    writes nothing -- same lifecycle rule as structure.json, so a project
    that never opens the Weave stays untouched.

    An INVALID file raises. It is never replaced, never repaired, never
    quietly ignored: it is the writer's own data, and the caller's job is to
    surface the message and open read-only.
    """
    path = registry_path(folder_path)
    if not os.path.isfile(path):
        return default_registry(), False

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        raise TypesError(
            f"The file is not valid JSON (line {exc.lineno}, column {exc.colno}): "
            f"{exc.msg}. It has been left exactly as it is."
        ) from exc
    except OSError as exc:
        raise TypesError(f"The file could not be read: {exc}") from exc

    validate_registry(data)
    return data, True


def seed_registry(folder_path: str) -> dict:
    """
    Write the built-in registry if the project does not have one yet.

    Never overwrites: an existing file is the writer's, whatever state it is
    in. Returns whatever is now in force.
    """
    path = registry_path(folder_path)
    if os.path.isfile(path):
        return load_registry(folder_path)[0]

    registry = default_registry()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)
    os.replace(tmp, path)
    return registry


# ── Reading the registry ─────────────────────────────────────────────────────

# Names Windows refuses to use for a file or folder, whatever the extension.
# A writer naming a kind "Aux" is not doing anything wrong, and the failure
# would be baffling -- the folder simply cannot be created.
_WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}

# Letters and single spaces. Deliberately narrower than IDENTIFIER_RE, which
# governs ids the APP writes -- this one governs a name a writer types, and
# it becomes a folder on their disk.
_CUSTOM_NAME_RE = re.compile(r"^[A-Za-z]+(?: [A-Za-z]+)*$")
CUSTOM_NAME_MAX = 32


def custom_type_id(label: str) -> tuple[str, str]:
    """
    Turn a name a writer typed into (type_id, tidy_label), or refuse.

    Narrow on purpose. This name becomes a FOLDER on the writer's disk, and
    the ways that goes wrong are all quiet: a digit or a symbol that some
    tool later chokes on, a trailing space Windows silently strips, a
    reserved device name that simply cannot be created. Better to say "use
    letters" up front than to fail at save time with something unreadable.

    Letters and single spaces only. "Royal Household" -> royal_household.
    """
    tidy = " ".join(str(label or "").split())
    if not tidy:
        raise TypesError("Give this kind a name.", "label")
    if len(tidy) > CUSTOM_NAME_MAX:
        raise TypesError(
            f"That name is too long. Keep it under {CUSTOM_NAME_MAX} characters.",
            "label",
        )
    if any(ch.isdigit() for ch in tidy):
        raise TypesError(
            "Use letters only -- no numbers. This name becomes a folder on "
            "your computer.",
            "label",
        )
    if not _CUSTOM_NAME_RE.match(tidy):
        raise TypesError(
            "Use letters and spaces only, with no punctuation or symbols. "
            "This name becomes a folder on your computer.",
            "label",
        )

    type_id = tidy.lower().replace(" ", "_")
    if type_id in _WINDOWS_RESERVED or type_id.split("_")[0] in _WINDOWS_RESERVED:
        raise TypesError(
            f"Windows will not allow a folder called {tidy!r}. Try another name.",
            "label",
        )
    return type_id, tidy.title()


def add_type(
    project_path: str,
    type_id: str,
    label: str,
    group: str = DEFAULT_GROUP,
    icon: str = "CircleDashed",
) -> dict:
    """
    Add a kind of Thread the Weave did not ship with -- a Government, a
    Deity, a Bloodline, a Ship.

    A custom kind behaves exactly like a built-in one: its own folder, its
    own section in the sidebar, its own entries and connections. Nothing
    about the rest of the system needs to know it was added later, which is
    the whole reason the registry is data.

    Writes to the project's own types.json, seeding it from the defaults
    first if the project has never had one.
    """
    # The name the writer typed is what governs, because it is what becomes a
    # folder. The id is derived from it rather than accepted separately, so
    # there is no way to slip a digit or a symbol past the rule.
    type_id, label = custom_type_id(label or type_id.replace("_", " "))
    group = normalize_group(group)
    if group not in GROUPS:
        raise TypesError(
            f"{group!r} is not a sidebar group. Use one of: {', '.join(sorted(GROUPS))}.",
            "group",
        )

    registry = seed_registry(project_path)
    if type_by_id(registry, type_id) is not None:
        raise TypesError(f"This world already has a kind called {type_id!r}.", "id")

    folder = type_id if type_id.endswith("s") else type_id + "s"
    if any(t.get("folder") == folder for t in registry.get("types", [])):
        raise TypesError(f"The folder {folder!r} is already in use.", "folder")

    registry["types"].append({
        "id": type_id,
        "label": label,
        "folder": folder,
        "icon": icon,
        "group": group,
        # Same rule as every built-in kind: the section appears once it holds
        # something. Adding a kind is the first half of "choose Government,
        # write the first one, save" -- and a kind whose entry was never
        # saved should not leave an empty heading behind. It stays offered
        # under "+ Add New" until it has an entry, which also means an
        # abandoned attempt heals itself.
        "default_section": False,
        "sections": _sections("overview", "details", "notes"),
        "required_fields": ["overview"],
        "custom_fields": [],
    })

    validate_registry(registry)
    _write_registry(project_path, registry)
    return registry


def set_type_group(project_path: str, type_id: str, group: str) -> dict:
    """Move a section to a different part of the sidebar. A writer whose
    world puts Factions with the people should be able to say so."""
    if group not in GROUPS:
        raise TypesError(
            f"{group!r} is not a sidebar group. Use one of: {', '.join(sorted(GROUPS))}.",
            "group",
        )
    registry = seed_registry(project_path)
    entry = type_by_id(registry, type_id)
    if entry is None:
        raise TypesError(f"This world has no kind called {type_id!r}.", "id")
    entry["group"] = group
    _write_registry(project_path, registry)
    return registry


def _write_registry(project_path: str, registry: dict) -> None:
    path = registry_path(project_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)
    os.replace(tmp, path)


def type_by_id(registry: dict, type_id: str) -> dict | None:
    for entry in registry.get("types", []):
        if entry.get("id") == type_id:
            return entry
    return None


def relation_by_id(registry: dict, rel_id: str) -> dict | None:
    for rel in registry.get("relations", []):
        if rel.get("id") == rel_id:
            return rel
    return None


def folder_for_type(registry: dict, type_id: str) -> str | None:
    entry = type_by_id(registry, type_id)
    return entry.get("folder") if entry else None


def inverse_label(registry: dict, rel_id: str) -> str | None:
    """
    The id to use when reading a Tie backwards.

    A symmetric relation is its own inverse -- "sibling of" reads the same
    from either end. Only ONE direction is ever stored; the other is derived
    here, because storing both lets them drift apart.
    """
    rel = relation_by_id(registry, rel_id)
    if rel is None:
        return None
    if rel.get("symmetric"):
        return rel_id
    return rel.get("inverse")


def relation_allows(registry: dict, rel_id: str, source_type: str, target_type: str) -> bool:
    """Is this connection meaningful between these two kinds of thing?"""
    rel = relation_by_id(registry, rel_id)
    if rel is None:
        return False
    return (source_type in rel.get("source_types", [])
            and target_type in rel.get("target_types", []))
