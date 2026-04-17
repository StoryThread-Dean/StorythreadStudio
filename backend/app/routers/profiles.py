# routers/profiles.py -- Profile File API
# ==========================================
# This router handles creating, reading, and saving structured profile files.
# Profiles live in the project's profiles/ subfolders as Markdown files with
# YAML frontmatter.
#
# Profile types supported:
#   character    -> profiles/characters/
#   relationship -> profiles/relationships/
#   location     -> profiles/locations/
#   lore         -> profiles/lore/
#
# Why Markdown + YAML frontmatter?
#   Keeps files human-readable and directly publishable to GitHub.
#   The YAML block holds metadata (id, name, role, tags).
#   The Markdown body holds the sections the writer fills in.
#
# Routes:
#   GET  /api/profiles/list    ?folder_path=...&type=...            -- list profiles
#   GET  /api/profiles/profile ?folder_path=...&type=...&filename=. -- load one
#   POST /api/profiles/create                                        -- new profile
#   POST /api/profiles/save                                          -- save profile
#   POST /api/profiles/import                                        -- import & fork a character

import os
import re
import uuid
import json as _json
from dataclasses import dataclass
from datetime import datetime, timezone

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


# ── Section Configuration ─────────────────────────────────────────────────────
# Each profile type has an ordered list of sections.
# "has_trait_blocks" = True means this section uses structured YAML trait entries.
# "has_trait_blocks" = False means this section uses plain Markdown text.
#
# This config drives both the Markdown parser (reading files) and the Markdown
# generator (writing files), as well as the frontend form layout.

@dataclass
class SectionConfig:
    key: str               # Snake_case internal key (used in JSON / Python dicts)
    heading: str           # Exact text of the # Heading in the Markdown file
    has_trait_blocks: bool # True = YAML trait list; False = freeform text


# Maps each profile type to its ordered section list
SECTION_CONFIGS: dict[str, list[SectionConfig]] = {
    "character": [
        SectionConfig("overview",                "Overview",                        False),
        SectionConfig("physical_traits",          "Physical Traits",                 True),
        SectionConfig("personality_traits",       "Personality Traits",              True),
        SectionConfig("motivations",              "Motivations",                     True),
        SectionConfig("voice_notes",              "Voice Notes",                     True),
        SectionConfig("hidden_and_foreshadowing", "Hidden and Foreshadowing Traits", True),
        SectionConfig("relationships_overview",   "Relationships Overview",          False),
        SectionConfig("notes",                    "Notes",                           False),
    ],
    "relationship": [
        SectionConfig("overview",            "Overview",           False),
        SectionConfig("history",             "History",            False),
        SectionConfig("current_dynamic",     "Current Dynamic",    False),
        SectionConfig("hidden_tensions",     "Hidden Tensions",    False),
        SectionConfig("emotional_direction", "Emotional Direction", False),
        SectionConfig("notes",               "Notes",              False),
    ],
    "location": [
        SectionConfig("overview",                "Overview",                False),
        SectionConfig("physical_description",    "Physical Description",    False),
        SectionConfig("tone_and_atmosphere",     "Tone and Atmosphere",     False),
        SectionConfig("historical_significance", "Historical Significance", False),
        SectionConfig("cultural_significance",   "Cultural Significance",   False),
        SectionConfig("scene_use_notes",         "Scene Use Notes",         False),
        SectionConfig("notes",                   "Notes",                   False),
    ],
    "lore": [
        SectionConfig("overview",             "Overview",             False),
        SectionConfig("rule_or_concept",      "Rule or Concept",      False),
        SectionConfig("what_it_affects",      "What It Affects",      False),
        SectionConfig("what_characters_know", "What Characters Know", False),
        SectionConfig("story_relevance",      "Story Relevance",      False),
        SectionConfig("notes",                "Notes",                False),
    ],
    # Chapter summary is dormant in this profile system. Phase 6 moved chapter
    # summaries to plain Markdown files under summaries/chapters/ so the writer
    # can edit them freely without the profile section scaffolding. This config
    # is preserved only so legacy chapter_summary profile files (from Phase 2)
    # still open in the Profile Builder without crashing.
    "chapter_summary": [
        SectionConfig("overview",           "Chapter Overview",     False),
        SectionConfig("key_events",         "Key Events",           False),
        SectionConfig("character_moments",  "Character Moments",    False),
        SectionConfig("notes",              "Notes",                False),
    ],
    "scene_summary": [
        SectionConfig("overview",            "Scene Overview",       False),
        SectionConfig("characters_present",  "Characters Present",   False),
        SectionConfig("setting",             "Setting",              False),
        SectionConfig("notes",               "Notes",                False),
    ],
}

# Maps profile type to its subfolder inside the project
PROFILE_FOLDERS: dict[str, str] = {
    "character":       "profiles/characters",
    "relationship":    "profiles/relationships",
    "location":        "profiles/locations",
    "lore":            "profiles/lore",
    "chapter_summary": "profiles/chapters",
    "scene_summary":   "profiles/scenes",
}

VALID_TYPES = set(PROFILE_FOLDERS.keys())

# The five importance levels control how (and whether) a trait is sent to AI.
# Core = always in prompt, highest priority position.
# Hidden = writer-only notes, never sent to the AI API.
VALID_IMPORTANCE = {"core", "present", "background", "contextual", "hidden"}


# ── Pydantic Models ───────────────────────────────────────────────────────────

class TraitBlock(BaseModel):
    """One entry in a trait-block section. May represent a single trait or a group."""
    id: str                   # UUID used as a React key (not stored in YAML)
    trait: str                # The trait name(s), e.g. "observant, punctual, eloquent"
    description: str          # Human-written description
    importance: str           # core|present|background|contextual|hidden


class ProfileSection(BaseModel):
    """One section of a profile (e.g. Physical Traits, Overview)."""
    content: str = ""                 # Plain text (for non-trait-block sections)
    trait_blocks: list[TraitBlock] = []  # Trait entries (for trait-block sections)
    ai_summary: str = ""              # Content under ## AI Summary: heading


class ProfileListItem(BaseModel):
    """Lightweight summary of a profile -- used in the left-panel list."""
    filename: str
    name: str
    type: str
    role: str = ""
    status: str = ""


class Profile(BaseModel):
    """Full structured profile data, parsed from or ready to write to Markdown."""
    profile_id: str
    type: str
    name: str
    role: str = ""
    status: str = "active"
    tags: list[str] = []
    filename: str
    sections: dict[str, ProfileSection]
    full_ai_summary: str = ""
    created_at: str
    updated_at: str


class CreateProfileRequest(BaseModel):
    folder_path: str
    type: str         # "character" | "relationship" | "location" | "lore"
    name: str
    role: str = ""


class SaveProfileRequest(BaseModel):
    folder_path: str
    filename: str
    profile: Profile


class ImportProfileRequest(BaseModel):
    folder_path: str    # Target project root (where the imported copy will live)
    source_path: str    # Absolute path to the .md file being imported


# ── Helpers: Path and Validation ─────────────────────────────────────────────

def _profile_dir(folder_path: str, profile_type: str) -> str:
    """Returns the absolute path to the subfolder for a given profile type."""
    return os.path.join(folder_path, PROFILE_FOLDERS[profile_type])


def _slugify(name: str) -> str:
    """
    Convert a name to a safe lowercase filename.
    "Elara Voss" -> "elara-voss"
    "The Dark City!" -> "the-dark-city"
    """
    name = name.lower().strip()
    name = re.sub(r"[^\w\s-]", "", name)    # Remove punctuation
    name = re.sub(r"[\s_]+", "-", name)     # Spaces/underscores to hyphens
    name = re.sub(r"-+", "-", name)         # Collapse multiple hyphens
    return name.strip("-") or "profile"


def _safe_path(profile_dir: str, filename: str) -> str:
    """
    Resolve the full path and check it stays inside the profile folder.
    This prevents path traversal attacks (e.g. filename="../../etc/passwd").
    """
    full = os.path.realpath(os.path.join(profile_dir, filename))
    safe = os.path.realpath(profile_dir)
    if not full.startswith(safe + os.sep) and full != safe:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    return full


# ── Helpers: Parsing ─────────────────────────────────────────────────────────

def _clean_trait_yaml(content: str) -> str:
    """
    Pre-process raw trait block YAML to fix two classes of problems that cause
    yaml.safe_load() to fail, silently returning [] and making all traits vanish.

    PROBLEM 1 -- JSON code block wrappers in ai_usage_example fields:
        ai_usage_example: ```json
        {"ai_usage_example": "When generating scenes..."}
        ```
    This is valid Markdown but INVALID YAML. We extract the string value and
    replace the whole block with a properly double-quoted YAML scalar.

    PROBLEM 2 -- Unquoted plain scalars containing ': ' (colon-space):
        notes: Overall: She presents an imposing figure...
        description: Her mantra is: "never give up..."
    In YAML, a plain (unquoted) scalar cannot contain ': ' because YAML
    interprets it as the start of a nested mapping key. We quote these values
    with json.dumps() so YAML reads them as literal strings.

    Why json.dumps() throughout?
    json.dumps() produces a valid JSON double-quoted string, which is ALSO
    valid YAML for a string scalar -- fully portable with proper escaping.

    Order matters: fix code blocks FIRST (so the quoted results of step 1 are
    already properly formatted before step 2 sees them).
    """

    # --- PASS 1: Strip JSON code block wrappers ---
    def _extract_json_block(match: re.Match) -> str:
        indent     = match.group(1)
        field_name = match.group(2)
        json_body  = match.group(3).strip()

        try:
            parsed = _json.loads(json_body)
        except (_json.JSONDecodeError, ValueError):
            parsed = None

        value = ""
        if isinstance(parsed, dict):
            for key in (field_name, "ai_usage_example", "section_summary", "text", "content"):
                if key in parsed and isinstance(parsed[key], str):
                    value = parsed[key]
                    break
            if not value:
                for v in parsed.values():
                    if isinstance(v, str):
                        value = v
                        break
        elif isinstance(parsed, str):
            value = parsed

        value = " ".join(value.split())   # Collapse internal newlines
        return f"{indent}{field_name}: {_json.dumps(value)}"

    code_block_pattern = r'^([ \t]*)(\w+):\s*```[\w]*\s*\n([\s\S]*?)\n[ \t]*```'
    content = re.sub(code_block_pattern, _extract_json_block, content, flags=re.MULTILINE)

    # --- PASS 2: Quote unquoted values that contain ': ' ---
    # In YAML block mappings, a plain scalar value that contains ': ' is
    # ambiguous -- YAML may interpret it as a nested key-value pair.
    # We quote any such values that aren't already wrapped in double quotes.
    def _quote_colon_values(match: re.Match) -> str:
        indent = match.group(1)
        key    = match.group(2)
        value  = match.group(3)

        # Already a properly double-quoted scalar? Leave it alone.
        # (json.dumps results from pass 1 land here as already-quoted)
        if value.startswith('"') and value.endswith('"'):
            return match.group(0)

        # Contains ': ' which YAML could misread as a mapping indicator?
        if ': ' in value:
            safe = " ".join(value.split())   # Normalize whitespace
            return f"{indent}{key}: {_json.dumps(safe)}"

        return match.group(0)

    # Only match INDENTED lines (block mapping values inside a list entry).
    # Lines starting at column 0 (like '- trait:') use '^-' and won't match.
    colon_value_pattern = r'^([ \t]+)(\w+): (.+)$'
    content = re.sub(colon_value_pattern, _quote_colon_values, content, flags=re.MULTILINE)

    return content


# Map old influence values to new importance levels.
# Old: foreshadowing|background|minor|major|core
# New: core|present|background|contextual|hidden
_INFLUENCE_TO_IMPORTANCE: dict[str, str] = {
    "core":           "core",
    "major":          "present",
    "minor":          "background",
    "background":     "contextual",
    "foreshadowing":  "hidden",
}


def _migrate_influence(raw: str) -> str:
    """Convert an old influence level or new importance level to a valid importance value."""
    raw = raw.strip().lower()
    if raw in VALID_IMPORTANCE:
        return raw
    return _INFLUENCE_TO_IMPORTANCE.get(raw, "background")


def _parse_trait_blocks(content: str) -> list[TraitBlock]:
    """
    Parse YAML-formatted trait block entries from a section's text content.

    Expected format (from the spec):
        - trait: observant, punctual, eloquent
          description: She is always on time...
          influence: core
          ai_usage_example: AI should reflect this through deliberate choices...
          notes: optional note

    This is valid YAML (a list of dicts), parsed with yaml.safe_load().
    Before parsing, _clean_trait_yaml() strips any JSON code block wrappers
    that some AI responses embed in ai_usage_example fields -- those break
    the YAML parser and would cause all traits in the section to vanish.

    Returns an empty list if content is empty or doesn't parse as a trait list.
    """
    content = content.strip()
    if not content:
        return []

    # Strip any JSON code block wrappers BEFORE handing to YAML
    content = _clean_trait_yaml(content)

    try:
        parsed = yaml.safe_load(content)
        if not isinstance(parsed, list):
            return []
        blocks = []
        for item in parsed:
            if not isinstance(item, dict) or "trait" not in item:
                continue
            # Backward compat: read "importance" first, fall back to old
            # "influence" field. Map old influence values to new importance
            # levels so legacy profiles load correctly.
            raw_level = str(item.get("importance", "") or item.get("influence", "background"))
            importance = _migrate_influence(raw_level)
            blocks.append(TraitBlock(
                id=str(uuid.uuid4()),
                trait=str(item.get("trait", "")),
                description=str(item.get("description", "")),
                importance=importance,
            ))
        return blocks
    except yaml.YAMLError:
        return []


def _split_ai_summary(content: str) -> tuple[str, str]:
    """
    Split a raw section body into (main_content, ai_summary).

    The AI summary lives under a '## AI Summary: <Section Name>' heading.
    Everything before that heading = main content.
    Everything after that heading = AI summary text.
    """
    match = re.search(r'^## AI Summary:.*$', content, re.MULTILINE)
    if match:
        main = content[:match.start()].strip()
        ai   = content[match.end():].strip()
        return main, ai
    return content.strip(), ""


def _parse_profile_markdown(raw: str, filename: str, profile_type: str) -> Profile:
    """
    Parse a full profile Markdown file into a structured Profile object.

    Steps:
      1. Split on '---' to extract YAML frontmatter and Markdown body
      2. Parse frontmatter with PyYAML to get metadata (name, role, tags, etc.)
      3. Split body on '# Heading' lines to isolate each section
      4. For each section: split off the '## AI Summary:' block, then
         parse trait blocks (if applicable) or keep as plain text
      5. Extract 'Full AI Summary' section if present
      6. Return a Profile object
    """
    # 1. Split frontmatter. Expect: "" | frontmatter | body
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise HTTPException(status_code=400, detail="Profile file has no frontmatter.")

    fm_text = parts[1]
    body    = parts[2]

    # 2. Parse frontmatter YAML
    try:
        meta: dict = yaml.safe_load(fm_text) or {}
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Bad frontmatter YAML: {e}")

    # 3. Split body on '# Heading' lines (single #, not ##)
    #    re.split with a capture group keeps the captured text in the list.
    #    Result pattern: [pre, heading1, content1, heading2, content2, ...]
    raw_parts = re.split(r'^# (.+)$', body, flags=re.MULTILINE)

    heading_content: dict[str, str] = {}
    i = 1
    while i + 1 < len(raw_parts):
        heading = raw_parts[i].strip()
        content = raw_parts[i + 1]
        heading_content[heading] = content
        i += 2

    # 4. Parse each section according to its config
    configs = SECTION_CONFIGS.get(profile_type, [])
    sections: dict[str, ProfileSection] = {}

    for cfg in configs:
        raw_section = heading_content.get(cfg.heading, "")
        main_content, ai_summary = _split_ai_summary(raw_section)

        if cfg.has_trait_blocks:
            sections[cfg.key] = ProfileSection(
                content="",
                trait_blocks=_parse_trait_blocks(main_content),
                ai_summary=ai_summary,
            )
        else:
            sections[cfg.key] = ProfileSection(
                content=main_content,
                trait_blocks=[],
                ai_summary=ai_summary,
            )

    # 5. Full AI Summary section (not in the per-section configs)
    full_ai_summary = heading_content.get("Full AI Summary", "").strip()
    # Strip the placeholder text so the field reads as empty
    if full_ai_summary == "_Generated on demand. Editable by writer._":
        full_ai_summary = ""

    return Profile(
        profile_id=str(meta.get("profile_id", uuid.uuid4())),
        type=profile_type,
        name=str(meta.get("name", "")),
        role=str(meta.get("role", "")),
        status=str(meta.get("status", "active")),
        tags=list(meta.get("tags") or []),
        filename=filename,
        sections=sections,
        full_ai_summary=full_ai_summary,
        created_at=str(meta.get("created_at", "")),
        updated_at=str(meta.get("updated_at", "")),
    )


# ── Helpers: Generating ───────────────────────────────────────────────────────

def _generate_profile_markdown(profile: Profile, profile_type: str) -> str:
    """
    Generate the full Markdown file content from a structured Profile object.
    Called when creating a new profile (empty template) or saving an edited one.

    The output format mirrors the example in 03-profile-builder-spec.md:
      - YAML frontmatter block (--- ... ---)
      - # Section headings with content or trait block YAML
      - ## AI Summary: headings with generated or placeholder text
      - # Full AI Summary at the end
    """
    configs = SECTION_CONFIGS.get(profile_type, [])
    lines: list[str] = []

    # --- Frontmatter ---
    lines += ["---"]
    lines += [f"type: {profile_type}"]
    lines += [f"profile_id: {profile.profile_id}"]
    lines += [f"name: {profile.name}"]
    if profile.role:
        lines += [f"role: {profile.role}"]
    lines += [f"status: {profile.status}"]
    if profile.tags:
        lines += ["tags:"]
        for tag in profile.tags:
            lines += [f"  - {tag}"]
    lines += [f"created_at: {profile.created_at}"]
    lines += [f"updated_at: {profile.updated_at}"]
    lines += ["---", ""]

    # --- Body Sections ---
    for cfg in configs:
        section = profile.sections.get(cfg.key, ProfileSection())
        lines += [f"# {cfg.heading}"]

        if cfg.has_trait_blocks:
            if section.trait_blocks:
                for block in section.trait_blocks:
                    # Write as YAML list entry.
                    # description uses json.dumps() to produce a properly
                    # double-quoted YAML string -- prevents YAML parsing failures
                    # caused by ': ' in values (e.g. "Overall: She presents..."
                    # would break yaml.safe_load without quoting).
                    safe_description = " ".join(block.description.split())
                    lines += [f"- trait: {block.trait}"]
                    lines += [f"  description: {_json.dumps(safe_description)}"]
                    lines += [f"  importance: {block.importance}"]
                    lines += [""]
            else:
                lines += [""]
        else:
            if section.content:
                lines += [section.content]
            lines += [""]

        # AI Summary subsection -- always present as a placeholder if empty
        lines += [f"## AI Summary: {cfg.heading}"]
        lines += [section.ai_summary if section.ai_summary else "_Generated on demand. Editable by writer._"]
        lines += [""]

    # --- Full AI Summary ---
    lines += ["# Full AI Summary"]
    lines += [profile.full_ai_summary if profile.full_ai_summary else "_Generated on demand. Editable by writer._"]
    lines += [""]

    return "\n".join(lines)


def _make_empty_profile(profile_type: str, name: str, role: str, filename: str) -> Profile:
    """Build a blank Profile object with all sections empty. Used when creating new profiles."""
    now = datetime.now(timezone.utc).isoformat()
    configs = SECTION_CONFIGS.get(profile_type, [])
    return Profile(
        profile_id=str(uuid.uuid4()),
        type=profile_type,
        name=name,
        role=role,
        status="active",
        tags=[],
        filename=filename,
        sections={cfg.key: ProfileSection() for cfg in configs},
        full_ai_summary="",
        created_at=now,
        updated_at=now,
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/list", response_model=list[ProfileListItem])
async def list_profiles(folder_path: str, type: str):
    """
    Returns a list of all profile files for the given type, sorted by name.
    Each item includes the filename, name, role, and status (parsed from frontmatter).
    The frontend uses this to populate the left panel's profile list.
    """
    if type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown profile type: {type}")

    profile_dir = _profile_dir(folder_path, type)

    if not os.path.isdir(profile_dir):
        raise HTTPException(status_code=404, detail=f"Profile folder not found: {profile_dir}")

    items: list[ProfileListItem] = []

    with os.scandir(profile_dir) as entries:
        for entry in entries:
            if not (entry.is_file() and entry.name.endswith(".md")):
                continue
            try:
                with open(entry.path, "r", encoding="utf-8") as f:
                    raw = f.read()
                # Only read the frontmatter for the list -- no need to parse sections
                parts = raw.split("---", 2)
                meta: dict = yaml.safe_load(parts[1]) if len(parts) >= 3 else {}
                items.append(ProfileListItem(
                    filename=entry.name,
                    name=str(meta.get("name", entry.name.removesuffix(".md"))),
                    type=type,
                    role=str(meta.get("role", "")),
                    status=str(meta.get("status", "active")),
                ))
            except Exception:
                # Skip files that can't be read -- don't crash the whole list
                continue

    items.sort(key=lambda p: p.name.lower())
    return items


@router.get("/profile", response_model=Profile)
async def load_profile(folder_path: str, type: str, filename: str):
    """
    Reads and parses one profile file into structured data.
    The frontend calls this when the writer selects a profile from the list.
    """
    if type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown profile type: {type}")

    profile_dir = _profile_dir(folder_path, type)
    filepath    = _safe_path(profile_dir, filename)

    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail=f"Profile not found: {filename}")

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not read file: {e}")

    return _parse_profile_markdown(raw, filename, type)


@router.post("/create", response_model=Profile)
async def create_profile(request: CreateProfileRequest):
    """
    Creates a new blank profile file and returns the parsed Profile.

    Steps:
      1. Validate type and folder
      2. Build a slug filename from the name (e.g. "elara-voss.md")
      3. Check no file already exists at that path
      4. Generate the Markdown template and write to disk
      5. Return the parsed Profile
    """
    if request.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown profile type: {request.type}")
    if not request.name.strip():
        raise HTTPException(status_code=400, detail="Profile name cannot be empty.")

    profile_dir = _profile_dir(request.folder_path, request.type)

    if not os.path.isdir(profile_dir):
        raise HTTPException(status_code=404, detail=f"Profile folder not found: {profile_dir}")

    # Build a filename from the name. If it already exists, append a short UUID.
    base_slug = _slugify(request.name.strip())
    filename  = f"{base_slug}.md"
    filepath  = os.path.join(profile_dir, filename)

    if os.path.exists(filepath):
        short_id = str(uuid.uuid4())[:8]
        filename  = f"{base_slug}-{short_id}.md"
        filepath  = os.path.join(profile_dir, filename)

    profile  = _make_empty_profile(request.type, request.name.strip(), request.role, filename)
    markdown = _generate_profile_markdown(profile, request.type)

    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(markdown)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write profile: {e}")

    return profile


@router.post("/save", response_model=Profile)
async def save_profile(request: SaveProfileRequest):
    """
    Saves an edited profile back to disk by regenerating its Markdown content.

    The frontend sends the full Profile object (including all edited fields).
    The backend rebuilds the Markdown and overwrites the file.
    updated_at is refreshed to the current UTC time.
    """
    profile_type = request.profile.type
    if profile_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown profile type: {profile_type}")

    profile_dir = _profile_dir(request.folder_path, profile_type)
    filepath    = _safe_path(profile_dir, request.filename)

    # Refresh updated_at before writing
    request.profile.updated_at = datetime.now(timezone.utc).isoformat()

    markdown = _generate_profile_markdown(request.profile, profile_type)

    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(markdown)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not save profile: {e}")

    return request.profile


@router.post("/import", response_model=Profile)
async def import_profile(request: ImportProfileRequest):
    """
    Imports a character profile from another project as a fully independent copy.

    Rules (from the spec):
      - Character profiles only (not relationships, locations, or lore)
      - The copy gets a new profile_id so it has no link to the original
      - No relationships are auto-imported
      - The writer can edit the copy freely in the new project

    Steps:
      1. Read and validate the source file as a character profile
      2. Parse it into a Profile object
      3. Regenerate the profile_id (makes it a true independent copy)
      4. Choose a filename in the target project (handle conflicts)
      5. Write the new file to the target project's profiles/characters/ folder
      6. Return the new Profile so the frontend can open it immediately
    """
    # 1. Read the source file
    if not os.path.isfile(request.source_path):
        raise HTTPException(status_code=404, detail=f"Source file not found: {request.source_path}")

    try:
        with open(request.source_path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not read source file: {e}")

    # 2. Validate it's a character profile by checking the frontmatter type field
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise HTTPException(status_code=400, detail="Source file has no frontmatter -- not a valid profile.")

    try:
        meta: dict = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid frontmatter in source file: {e}")

    if meta.get("type") != "character":
        raise HTTPException(
            status_code=400,
            detail="Only character profiles can be imported. "
                   f"This file has type: '{meta.get('type', 'unknown')}'"
        )

    # 3. Parse the full profile
    source_filename = os.path.basename(request.source_path)
    profile = _parse_profile_markdown(raw, source_filename, "character")

    # 4. Give it a fresh profile_id -- this makes the copy fully independent
    profile.profile_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    profile.updated_at = now
    # Keep created_at from the original so the writer knows when it was first written

    # 5. Choose the destination filename (keep original slug, handle conflicts)
    target_dir = _profile_dir(request.folder_path, "character")
    if not os.path.isdir(target_dir):
        raise HTTPException(status_code=404, detail=f"Characters folder not found in: {request.folder_path}")

    base_slug = source_filename.removesuffix(".md")
    filename  = f"{base_slug}.md"
    filepath  = os.path.join(target_dir, filename)

    if os.path.exists(filepath):
        short_id = str(uuid.uuid4())[:8]
        filename  = f"{base_slug}-imported-{short_id}.md"
        filepath  = os.path.join(target_dir, filename)

    profile.filename = filename

    # 6. Write the new file
    markdown = _generate_profile_markdown(profile, "character")
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(markdown)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write imported profile: {e}")

    return profile


# ── Arc Files ────────────────────────────────────────────────────────────────
# Arc files hold per-book character changes that overlay on series-level
# canonical profiles. They use the same Markdown format as regular profiles
# but live in profiles/arcs/<type>/ inside a book folder.
#
# When AI needs context, it receives the merged result: canonical profile
# fields as the base, with arc file fields overriding where present.

# Maps profile type to its arc subfolder inside a book project
ARC_FOLDERS: dict[str, str] = {
    "character":    "profiles/arcs/characters",
    "relationship": "profiles/arcs/relationships",
}

ARC_TYPES = set(ARC_FOLDERS.keys())


def _arc_dir(folder_path: str, profile_type: str) -> str:
    """Returns the absolute path to the arc subfolder for a given profile type."""
    return os.path.join(folder_path, ARC_FOLDERS[profile_type])


@router.get("/arc/list", response_model=list[ProfileListItem])
async def list_arcs(folder_path: str, type: str):
    """
    List all arc files for a given profile type in the book's arcs folder.
    Returns an empty list if the arcs folder doesn't exist (standalone project).
    """
    if type not in ARC_TYPES:
        raise HTTPException(status_code=400, detail=f"Arc files not supported for type: {type}")

    arc_path = _arc_dir(folder_path, type)

    if not os.path.isdir(arc_path):
        return []

    items: list[ProfileListItem] = []
    with os.scandir(arc_path) as entries:
        for entry in entries:
            if not (entry.is_file() and entry.name.endswith(".md")):
                continue
            try:
                with open(entry.path, "r", encoding="utf-8") as f:
                    raw = f.read()
                parts = raw.split("---", 2)
                meta: dict = yaml.safe_load(parts[1]) if len(parts) >= 3 else {}
                items.append(ProfileListItem(
                    filename=entry.name,
                    name=str(meta.get("name", entry.name.removesuffix(".md"))),
                    type=type,
                    role=str(meta.get("role", "")),
                    status=str(meta.get("status", "active")),
                ))
            except Exception:
                continue

    items.sort(key=lambda p: p.name.lower())
    return items


@router.get("/arc/profile", response_model=Profile)
async def load_arc(folder_path: str, type: str, filename: str):
    """Load a single arc file from the book's arcs folder."""
    if type not in ARC_TYPES:
        raise HTTPException(status_code=400, detail=f"Arc files not supported for type: {type}")

    arc_path = _arc_dir(folder_path, type)
    filepath = _safe_path(arc_path, filename)

    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail=f"Arc file not found: {filename}")

    with open(filepath, "r", encoding="utf-8") as f:
        raw = f.read()

    return _parse_profile_markdown(raw, filename, type)


@router.post("/arc/create", response_model=Profile)
async def create_arc(request: CreateProfileRequest):
    """
    Create a new arc file in the book's arcs folder.
    Same shape as a regular profile but stored in profiles/arcs/<type>/.
    """
    if request.type not in ARC_TYPES:
        raise HTTPException(status_code=400, detail=f"Arc files not supported for type: {request.type}")

    arc_path = _arc_dir(request.folder_path, request.type)
    os.makedirs(arc_path, exist_ok=True)

    slug = _slugify(request.name)
    filename = f"{slug}.md"
    filepath = os.path.join(arc_path, filename)

    if os.path.exists(filepath):
        raise HTTPException(status_code=409, detail=f"An arc file named '{filename}' already exists.")

    now = datetime.now(timezone.utc).isoformat()
    section_configs = SECTION_CONFIGS.get(request.type, [])

    profile = Profile(
        profile_id=str(uuid.uuid4()),
        type=request.type,
        name=request.name,
        role=request.role,
        filename=filename,
        sections={
            cfg.key: ProfileSection(content="", trait_blocks=[], ai_summary="")
            for cfg in section_configs
        },
        created_at=now,
        updated_at=now,
    )

    markdown = _generate_profile_markdown(profile, request.type)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(markdown)

    return profile


@router.post("/arc/save", response_model=Profile)
async def save_arc(request: SaveProfileRequest):
    """Save an arc file back to disk (same as save_profile but for arcs folder)."""
    ptype = request.profile.type
    if ptype not in ARC_TYPES:
        raise HTTPException(status_code=400, detail=f"Arc files not supported for type: {ptype}")

    arc_path = _arc_dir(request.folder_path, ptype)
    filepath = _safe_path(arc_path, request.filename)

    request.profile.updated_at = datetime.now(timezone.utc).isoformat()

    markdown = _generate_profile_markdown(request.profile, ptype)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(markdown)

    return request.profile


# ── Profile Merge Logic ──────────────────────────────────────────────────────
# Merges a canonical (series-level) profile with a book-level arc file.
# The arc file's non-empty fields override the canonical profile's fields.
# Trait blocks from the arc file are appended (not replaced) so the writer
# can add book-specific traits while keeping the canonical ones.

def merge_profile_with_arc(canonical: Profile, arc: Profile) -> Profile:
    """
    Merge a canonical profile with a book-level arc overlay.

    Rules:
      - Arc's frontmatter fields override canonical if non-empty
      - For each section: arc content overrides canonical content if non-empty
      - Arc trait blocks are appended to canonical trait blocks
      - Arc ai_summary overrides canonical ai_summary if non-empty
      - Arc full_ai_summary overrides canonical if non-empty
    """
    merged_sections: dict[str, ProfileSection] = {}

    for key, canon_section in canonical.sections.items():
        arc_section = arc.sections.get(key)

        if arc_section is None:
            merged_sections[key] = canon_section
            continue

        # Arc content overrides canonical content if non-empty
        content = arc_section.content if arc_section.content.strip() else canon_section.content

        # Append arc trait blocks to canonical trait blocks
        trait_blocks = list(canon_section.trait_blocks) + list(arc_section.trait_blocks)

        # Arc AI summary overrides canonical if non-empty
        ai_summary = arc_section.ai_summary if arc_section.ai_summary.strip() else canon_section.ai_summary

        merged_sections[key] = ProfileSection(
            content=content,
            trait_blocks=trait_blocks,
            ai_summary=ai_summary,
        )

    return Profile(
        profile_id=canonical.profile_id,
        type=canonical.type,
        name=arc.name if arc.name.strip() else canonical.name,
        role=arc.role if arc.role.strip() else canonical.role,
        status=arc.status if arc.status.strip() else canonical.status,
        tags=arc.tags if arc.tags else canonical.tags,
        filename=canonical.filename,
        sections=merged_sections,
        full_ai_summary=arc.full_ai_summary if arc.full_ai_summary.strip() else canonical.full_ai_summary,
        created_at=canonical.created_at,
        updated_at=arc.updated_at,
    )


@router.get("/merged", response_model=Profile)
async def load_merged_profile(
    series_path: str, book_path: str, type: str, filename: str
):
    """
    Load a canonical profile merged with its book-level arc file (if one exists).

    The canonical profile lives in the series profiles/ folder.
    The arc file lives in the book's profiles/arcs/ folder with the same filename.
    If no arc file exists, returns the canonical profile as-is.
    """
    if type not in ARC_TYPES:
        raise HTTPException(status_code=400, detail=f"Merge not supported for type: {type}")

    # Load canonical profile from the series
    canonical_dir = _profile_dir(series_path, type)
    canonical_path = _safe_path(canonical_dir, filename)

    if not os.path.isfile(canonical_path):
        raise HTTPException(status_code=404, detail=f"Canonical profile not found: {filename}")

    with open(canonical_path, "r", encoding="utf-8") as f:
        raw = f.read()
    canonical = _parse_profile_markdown(raw, filename, type)

    # Try to load the arc file from the book
    arc_filepath = os.path.join(_arc_dir(book_path, type), filename)
    if not os.path.isfile(arc_filepath):
        return canonical

    with open(arc_filepath, "r", encoding="utf-8") as f:
        raw = f.read()
    arc = _parse_profile_markdown(raw, filename, type)

    return merge_profile_with_arc(canonical, arc)
