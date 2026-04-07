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

import os
import re
import uuid
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
}

# Maps profile type to its subfolder inside the project
PROFILE_FOLDERS: dict[str, str] = {
    "character":    "profiles/characters",
    "relationship": "profiles/relationships",
    "location":     "profiles/locations",
    "lore":         "profiles/lore",
}

VALID_TYPES = set(PROFILE_FOLDERS.keys())

VALID_INFLUENCE = {"foreshadowing", "background", "minor", "major", "core"}


# ── Pydantic Models ───────────────────────────────────────────────────────────

class TraitBlock(BaseModel):
    """One entry in a trait-block section. May represent a single trait or a group."""
    id: str                   # UUID used as a React key (not stored in YAML)
    trait: str                # The trait name(s), e.g. "observant, punctual, eloquent"
    description: str          # Human-written description
    influence: str            # Influence level: foreshadowing|background|minor|major|core
    ai_usage_example: str = ""  # How AI should use this trait (often AI-generated)
    notes: str = ""           # Optional supporting notes


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

def _parse_trait_blocks(content: str) -> list[TraitBlock]:
    """
    Parse YAML-formatted trait block entries from a section's text content.

    The format (from the spec) looks like:
        - trait: observant, punctual, eloquent
          description: She is always on time...
          influence: core
          ai_usage_example: AI should reflect this through deliberate choices...
          notes: optional note

    This IS valid YAML -- a list of dicts -- so we use yaml.safe_load() to parse it.
    Each dict is converted to a TraitBlock. Unknown fields are ignored.

    Returns an empty list if content is empty or doesn't parse as a trait list.
    """
    content = content.strip()
    if not content:
        return []
    try:
        parsed = yaml.safe_load(content)
        if not isinstance(parsed, list):
            return []
        blocks = []
        for item in parsed:
            if not isinstance(item, dict) or "trait" not in item:
                continue
            blocks.append(TraitBlock(
                id=str(uuid.uuid4()),   # Fresh UUID for use as React key
                trait=str(item.get("trait", "")),
                description=str(item.get("description", "")),
                influence=str(item.get("influence", "minor")),
                ai_usage_example=str(item.get("ai_usage_example", "")),
                notes=str(item.get("notes", "")),
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
                    # Write as YAML list entry -- indented continuation lines
                    lines += [f"- trait: {block.trait}"]
                    lines += [f"  description: {block.description}"]
                    lines += [f"  influence: {block.influence}"]
                    if block.ai_usage_example:
                        lines += [f"  ai_usage_example: {block.ai_usage_example}"]
                    if block.notes:
                        lines += [f"  notes: {block.notes}"]
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
