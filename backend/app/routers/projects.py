# routers/projects.py -- Project Create and Open API
# =====================================================
# This file handles everything related to Storythread Studio writing projects:
# creating a new project (folder structure + project.json) and opening
# an existing one (reading project.json from a chosen folder).
#
# A "router" in FastAPI is like a mini-app that handles a specific group
# of related routes. We create one here for projects and then "include"
# it in main.py -- keeps the code organized as the app grows.
#
# Routes defined here:
#   POST /api/projects/create  -- make a new writing project folder
#   POST /api/projects/open    -- open an existing project folder

import os
import json
import uuid
from datetime import datetime, timezone

import re
from fastapi import APIRouter, HTTPException
from app.recent_projects import load_recent, track_project, remove_project
from app.outline_templates import render_outline, OutlineMetadata
from app.settings_store import get_vault_root
from pydantic import BaseModel


# Valid outline template values. Kept here (not in outline_templates.py) so
# the Pydantic request validation lives next to the endpoints that use it.
# When we add Save the Cat, Hero's Journey, etc., update both this tuple and
# the TEMPLATES dict in outline_templates.py.
VALID_OUTLINE_TEMPLATES = ("novel", "novella", "novelette", "short_story", "serial_fiction")


# Valid story_type values. The story type is the writer-facing label for
# what kind of work this project is (Novel, Novella, ...). At creation time
# the frontend uses it to auto-pick a default outline_template, but the two
# fields are independent on disk so the writer can swap templates later
# without changing the story type.
VALID_STORY_TYPES = ("novel", "novella", "novelette", "short_story", "serial_fiction")


# Default outline template per story type. Used when the frontend sends a
# story_type but no explicit template_type. This mapping mirrors the writer's
# stated preference (Novel/Novella/Novelette/Short Story/Serial Fiction each
# have their own dedicated scaffold).
STORY_TYPE_DEFAULT_TEMPLATE: dict[str, str] = {
    "novel":          "novel",
    "novella":        "novella",
    "novelette":      "novelette",
    "short_story":    "short_story",
    "serial_fiction": "serial_fiction",
}


# --- Router ---
# prefix="/api/projects" means every route in this file automatically
# starts with /api/projects -- we don't have to type it on every endpoint.
router = APIRouter(prefix="/api/projects", tags=["projects"])


# --- The folder structure every new project gets ---
# These folders are created relative to the project's root directory.
# They match exactly what's described in 02-architecture-and-storage.md.
PROJECT_FOLDERS = [
    "manuscript",
    "notes",
    "profiles/characters",
    "profiles/relationships",
    "profiles/locations",
    "profiles/lore",
    "profiles/chapters",
    "profiles/scenes",
    "exports",
    ".storythread",      # Hidden folder for app.db, cache, logs
]

# Default starter files created in a new project.
#
# NOTE: notes/outline.md is intentionally NOT in this dict -- its content
# depends on the template the writer picked (novel vs short_story) and on
# the project's metadata (title, genre, etc.). It's generated per-project
# inside create_project() and create_book_in_series() using the
# outline_templates module.
STARTER_FILES = {
    # The first chapter -- ready to write. Numeric ("Chapter 1", not
    # "Chapter One") so it matches the default the new-chapter dialog
    # proposes for every later chapter ("Chapter 2" -> 02-chapter-2.md).
    # Before this change the starter was the odd one out on disk.
    "manuscript/01-chapter-1.md": "# Chapter 1\n\n",

    # Style guide -- pre-populated with the no-em-dash rule
    "notes/style-guide.md": (
        "# Style Guide\n\n"
        "## Punctuation Rules\n\n"
        "- No em dashes. Use a double hyphen (--) instead.\n\n"
        "## Voice and Tone\n\n"
        "_Add your project's voice and tone notes here._\n"
    ),
}


# ── Vault placement helpers ──────────────────────────────────────────────────
# Phase 6+: when the frontend creates a project or series without a specific
# folder_path, we generate one for them under the configured vault root
# (defaults to ~/Documents/Storythread Studio). The writer never has to pick a folder
# for new projects -- only when opening one. These helpers do that.

def _slugify_folder_name(title: str) -> str:
    """
    Turn a project/series title into a safe folder name.

    "The Ember Throne!" -> "the-ember-throne"
    "  My Novel  "      -> "my-novel"
    ""                  -> "untitled"

    We lowercase and hyphenate so the folder names stay portable across
    filesystems and easy to type in a shell. Falls back to "untitled" when
    the title is empty after stripping.
    """
    s = title.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)   # drop punctuation
    s = re.sub(r"[\s_]+", "-", s)    # spaces/underscores -> hyphen
    s = re.sub(r"-+", "-", s)        # collapse repeats
    s = s.strip("-")
    return s or "untitled"


def _unique_folder(parent: str, base_slug: str) -> str:
    """
    Return an available folder path under `parent` based on `base_slug`.
    If `parent/base_slug` is free, returns it; otherwise tries -2, -3, ...
    until something doesn't exist. Caller still creates the directory.

    Used so two projects called "My Novel" don't collide -- the second one
    becomes "my-novel-2", the third "my-novel-3", etc., without surfacing
    the conflict to the writer.
    """
    candidate = os.path.join(parent, base_slug)
    if not os.path.exists(candidate):
        return candidate
    n = 2
    while True:
        candidate = os.path.join(parent, f"{base_slug}-{n}")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def _resolve_create_folder(requested: str | None, title: str) -> str:
    """
    Decide where a new project/series folder should live.

    If the frontend passed a folder_path (legacy or testing path), honor it.
    Otherwise place the new folder under the configured vault root using a
    slugified version of the title, with a numeric suffix on collisions.
    """
    if requested and requested.strip():
        return requested.strip()
    vault = get_vault_root()
    return _unique_folder(vault, _slugify_folder_name(title))


def _write_outline_template(
    project_root: str,
    template_type: str,
    metadata: OutlineMetadata,
) -> None:
    """
    Render the chosen outline template and write it to notes/outline.md.

    Small helper so create_project and create_book_in_series don't
    duplicate the same four lines of file I/O.
    """
    content = render_outline(template_type, metadata)
    outline_path = os.path.join(project_root, "notes", "outline.md")
    with open(outline_path, "w", encoding="utf-8") as f:
        f.write(content)


# --- Pydantic Models ---
# Pydantic is a Python library that validates request and response data.
# Think of these classes as contracts: "this is exactly what shape the
# data must be." FastAPI uses them to auto-validate incoming JSON and
# to document the API.

class CreateProjectRequest(BaseModel):
    """Data the frontend sends when creating a new project."""
    # Optional: when omitted/empty, the backend places the new project under
    # the configured vault root (default ~/Documents/Storythread Studio) using a
    # slugified version of the title. The writer never has to pick a folder
    # for new projects in the redesigned ProjectHome flow.
    folder_path: str = ""
    title: str          # Project name (e.g., "My Novel")
    description: str = ""  # Optional short description
    # Story type. Drives the default outline template at creation and is
    # surfaced in the recent-projects list so the writer can scan their
    # library by kind. Optional for backward compatibility; defaults to
    # "novel" when omitted.
    story_type: str = "novel"
    # Which outline template to seed notes/outline.md with. When omitted the
    # backend picks the matching template for the chosen story_type via
    # STORY_TYPE_DEFAULT_TEMPLATE. The writer can override this later via
    # the [+ New Template] button in the editor toolbar.
    template_type: str | None = None


class OpenProjectRequest(BaseModel):
    """Data the frontend sends when opening an existing project."""
    folder_path: str    # Absolute path to an existing project folder


class CreateBookInSeriesRequest(BaseModel):
    """Data the frontend sends when creating a new book inside a series."""
    series_path: str    # Absolute path to the series folder
    title: str          # Book title (e.g. "The Ashen Crown")
    description: str = ""
    folder_name: str = ""  # Optional custom folder name; defaults to title
    # Same as CreateProjectRequest -- the writer-facing label for what kind
    # of work this book is.
    story_type: str = "novel"
    # Optional. When None the backend picks the default template matching
    # story_type. The writer can swap later via [+ New Template].
    template_type: str | None = None


class ProjectResponse(BaseModel):
    """Data sent back to the frontend after create or open succeeds."""
    project_id: str
    title: str
    description: str
    root_path: str
    content_mode_default: str
    default_model: str | None
    series_id: str | None = None
    series_path: str | None = None
    # Story type -- the writer-facing label. "novel", "novella", "novelette",
    # "short_story", "serial_fiction". Optional for backward compatibility:
    # older project.json files without this field default to "novel" at
    # read time so the UI never sees null.
    story_type: str = "novel"
    # The scaffold last applied to notes/outline.md. Optional for backward
    # compatibility: older project.json files won't have it.
    outline_template: str | None = None
    created_at: str
    updated_at: str


# --- Helper: read project.json ---
def _read_project_json(folder_path: str) -> dict:
    """
    Reads and parses the project.json file inside a project folder.
    Raises an HTTPException if the file doesn't exist or is malformed.

    HTTPException is FastAPI's way of returning an error response.
    The `status_code` becomes the HTTP status (404 = not found, 400 = bad request).
    The `detail` message is sent to the frontend so it can show the user a clear error.
    """
    project_file = os.path.join(folder_path, "project.json")

    if not os.path.exists(project_file):
        raise HTTPException(
            status_code=404,
            detail=f"No project.json found in: {folder_path}\n"
                   "This folder doesn't appear to be a Storythread Studio project."
        )

    try:
        with open(project_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"project.json is malformed (invalid JSON): {e}"
        )


# --- POST /api/projects/create ---
@router.post("/create", response_model=ProjectResponse)
async def create_project(request: CreateProjectRequest):
    """
    Creates a new Storythread Studio writing project.

    Steps:
      1. Validate the folder path exists and is accessible
      2. Check a project doesn't already exist there
      3. Create all required subfolders
      4. Write starter files (first chapter, style guide, outline)
      5. Write project.json with the project's metadata
      6. Return the project info to the frontend

    The `response_model=ProjectResponse` tells FastAPI to validate our
    return value against the ProjectResponse model before sending it.
    """
    # Resolve the target folder. If the frontend didn't pass one, place the
    # project under the configured vault (default ~/Documents/Storythread Studio)
    # with a slugified title. _resolve_create_folder returns a path that
    # does NOT yet exist when the vault path is used, so we don't need the
    # legacy "no project already exists" check in that case. We still keep
    # the check below for the case where a folder path WAS supplied (e.g.,
    # an explicit override for testing or migration scripts).
    folder = _resolve_create_folder(request.folder_path, request.title)

    explicit_folder = bool(request.folder_path and request.folder_path.strip())

    if explicit_folder:
        # Legacy/explicit-path branch: validate the writer-provided folder.
        if not os.path.exists(folder):
            raise HTTPException(status_code=400, detail=f"Folder not found: {folder}")
        if not os.path.isdir(folder):
            raise HTTPException(status_code=400, detail=f"Path is not a folder: {folder}")
        if os.path.exists(os.path.join(folder, "project.json")):
            raise HTTPException(
                status_code=409,   # 409 = Conflict
                detail="A Storythread Studio project already exists in this folder. "
                       "Use 'Open Project' instead."
            )
    else:
        # Auto-derived path: ensure the new folder gets created. The vault
        # root itself is created lazily by get_vault_root().
        os.makedirs(folder, exist_ok=True)

    # -- Validate story_type and resolve the outline template --
    if request.story_type not in VALID_STORY_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown story type '{request.story_type}'. "
                   f"Valid options: {', '.join(VALID_STORY_TYPES)}."
        )

    # If the frontend didn't pin a specific template, pick the default for
    # the chosen story_type. Writers who want a non-matching scaffold can
    # explicitly send template_type from the form, or swap later via the
    # [+ New Template] toolbar button.
    template_type = request.template_type or STORY_TYPE_DEFAULT_TEMPLATE[request.story_type]
    if template_type not in VALID_OUTLINE_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown outline template '{template_type}'. "
                   f"Valid options: {', '.join(VALID_OUTLINE_TEMPLATES)}."
        )

    # -- Create the folder structure --
    # os.makedirs creates nested folders in one call.
    # exist_ok=True means "don't throw an error if the folder already exists."
    for subfolder in PROJECT_FOLDERS:
        os.makedirs(os.path.join(folder, subfolder), exist_ok=True)

    # -- Write starter files (chapter + style guide) --
    for relative_path, content in STARTER_FILES.items():
        file_path = os.path.join(folder, relative_path)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

    # -- Generate the outline from the chosen template --
    # Standalone projects don't have genre/tone/series metadata yet -- we only
    # know title + description from the creation form. The template handles
    # missing fields gracefully (shows "(not set)" in the seed metadata block).
    _write_outline_template(
        project_root=folder,
        template_type=template_type,
        metadata={
            "title":       request.title,
            "description": request.description,
        },
    )

    # -- Build the project metadata --
    now = datetime.now(timezone.utc).isoformat()
    project_data = {
        "project_id":           str(uuid.uuid4()),
        "title":                request.title,
        "description":          request.description,
        "root_path":            folder,
        "content_mode_default": "general",
        "default_model":        None,
        "series_id":            None,
        "series_path":          None,
        "model_routing_enabled": True,
        "allow_explicit_routing": True,
        "cost_tier":            "balanced",
        "active_style_guide":   "notes/style-guide.md",
        # Story type chosen at creation. Drives display in the recent-projects
        # list and lets future features filter or scaffold by kind.
        "story_type":           request.story_type,
        # Which outline template is currently applied to notes/outline.md.
        # Updated when the writer uses the "+ New Template" button later.
        "outline_template":     template_type,
        "created_at":           now,
        "updated_at":           now,
    }

    # -- Write project.json --
    project_file = os.path.join(folder, "project.json")
    with open(project_file, "w", encoding="utf-8") as f:
        # indent=2 makes the file human-readable (pretty-printed)
        json.dump(project_data, f, indent=2)

    # Track in recent projects so it appears on the dashboard next launch
    track_project(
        project_id=project_data["project_id"],
        title=project_data["title"],
        root_path=folder,
        content_mode=project_data.get("content_mode_default", "general"),
        story_type=project_data["story_type"],
    )

    return ProjectResponse(**project_data)


# --- POST /api/projects/open ---
@router.post("/open", response_model=ProjectResponse)
async def open_project(request: OpenProjectRequest):
    """
    Opens an existing Storythread Studio project by reading its project.json.

    The frontend sends the folder path the user selected.
    We validate it's a real Storythread Studio project folder and return its info.
    """
    folder = request.folder_path

    if not os.path.exists(folder):
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder}")

    # Read and return the project data
    data = _read_project_json(folder)

    # Patch root_path in case the project was moved since it was created
    data["root_path"] = folder

    # Backward-compat fallback: pre-Phase-6 project.json files don't have a
    # story_type. Default to "novel" so the response model validates and the
    # frontend always sees a defined value.
    if not data.get("story_type"):
        data["story_type"] = "novel"

    # If the file is missing the story_type field on disk, take this open as
    # the chance to rewrite it with the default. Cheap one-time migration so
    # subsequent opens don't keep re-defaulting.
    project_file = os.path.join(folder, "project.json")
    try:
        with open(project_file, "r", encoding="utf-8") as f:
            on_disk = json.load(f)
        if "story_type" not in on_disk:
            on_disk["story_type"] = data["story_type"]
            with open(project_file, "w", encoding="utf-8") as f:
                json.dump(on_disk, f, indent=2)
    except (OSError, json.JSONDecodeError):
        # Not worth failing the open if we can't write the migration -- the
        # in-memory default keeps the session working either way.
        pass

    # Track in recent projects
    track_project(
        project_id=data.get("project_id", ""),
        title=data.get("title", ""),
        root_path=folder,
        content_mode=data.get("content_mode_default", "general"),
        series_name=data.get("series_name"),
        story_type=data.get("story_type", "novel"),
    )

    return ProjectResponse(**data)


# --- POST /api/projects/create-in-series ---
@router.post("/create-in-series", response_model=ProjectResponse)
async def create_book_in_series(request: CreateBookInSeriesRequest):
    """
    Create a new book project inside an existing series folder.

    Similar to create_project but:
      - The book folder is created inside the series folder
      - project.json includes series_id and series_path linking it to the series
      - An arcs/ subfolder is added under profiles/ for per-book character arcs
    """
    series_path = request.series_path

    if not os.path.exists(series_path):
        raise HTTPException(status_code=400, detail=f"Series folder not found: {series_path}")

    # Read series.json to get the series_id
    series_file = os.path.join(series_path, "series.json")
    if not os.path.exists(series_file):
        raise HTTPException(
            status_code=400,
            detail="Not a valid series folder (no series.json found)."
        )

    try:
        with open(series_file, "r", encoding="utf-8") as f:
            series_data = json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"series.json is malformed: {e}")

    series_id = series_data.get("series_id", "")

    # Determine the book folder name
    folder_name = request.folder_name.strip() if request.folder_name.strip() else request.title
    book_folder = os.path.join(series_path, folder_name)

    # Check if a project already exists there
    if os.path.exists(os.path.join(book_folder, "project.json")):
        raise HTTPException(
            status_code=409,
            detail="A book project already exists in this folder."
        )

    # Validate story_type and resolve the outline template (same shape as
    # the standalone create endpoint).
    if request.story_type not in VALID_STORY_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown story type '{request.story_type}'. "
                   f"Valid options: {', '.join(VALID_STORY_TYPES)}."
        )
    template_type = request.template_type or STORY_TYPE_DEFAULT_TEMPLATE[request.story_type]
    if template_type not in VALID_OUTLINE_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown outline template '{template_type}'. "
                   f"Valid options: {', '.join(VALID_OUTLINE_TEMPLATES)}."
        )

    # Create the standard project folders + arcs subfolder for per-book character arcs
    book_folders = PROJECT_FOLDERS + [
        "profiles/arcs/characters",
        "profiles/arcs/relationships",
    ]
    for subfolder in book_folders:
        os.makedirs(os.path.join(book_folder, subfolder), exist_ok=True)

    # Write starter files (chapter + style guide)
    for relative_path, content in STARTER_FILES.items():
        file_path = os.path.join(book_folder, relative_path)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

    # Generate the outline from the chosen template. For books-in-series we
    # have richer metadata (series name, genre, tone) which lets the template
    # seed the HTML comment block with more context than a standalone project.
    _write_outline_template(
        project_root=book_folder,
        template_type=template_type,
        metadata={
            "title":       request.title,
            "description": request.description,
            "series_name": series_data.get("name", ""),
            "genre":       series_data.get("genre", ""),
            "tone":        series_data.get("tone", ""),
        },
    )

    # Build project metadata linked to the series
    now = datetime.now(timezone.utc).isoformat()

    # Inherit content_mode from series if set, otherwise default to "general"
    content_mode = series_data.get("content_mode", "general") or "general"

    project_data = {
        "project_id":           str(uuid.uuid4()),
        "title":                request.title,
        "description":          request.description,
        "root_path":            book_folder,
        "content_mode_default": content_mode,
        "default_model":        None,
        "series_id":            series_id,
        "series_path":          series_path,
        "model_routing_enabled": True,
        "allow_explicit_routing": True,
        "cost_tier":            "balanced",
        "active_style_guide":   "notes/style-guide.md",
        "story_type":           request.story_type,
        # Track which scaffold was last applied -- same field as standalone.
        "outline_template":     template_type,
        "created_at":           now,
        "updated_at":           now,
    }

    # Write project.json
    project_file = os.path.join(book_folder, "project.json")
    with open(project_file, "w", encoding="utf-8") as f:
        json.dump(project_data, f, indent=2)

    # Track in recent projects
    track_project(
        project_id=project_data["project_id"],
        title=project_data["title"],
        root_path=book_folder,
        content_mode=content_mode,
        series_name=series_data.get("name"),
        story_type=project_data["story_type"],
    )

    return ProjectResponse(**project_data)


# ── Recent Projects + Project Settings ─────────────────────────────────────

class RecentProjectItem(BaseModel):
    project_id:   str
    title:        str
    root_path:    str
    content_mode: str
    series_name:  str | None
    # Story type drives the kind label on each recent-projects row. Defaults
    # to "novel" so legacy entries (created before this field existed) still
    # validate -- load_recent() already backfills the same default at load.
    story_type:   str = "novel"
    last_opened:  str
    exists:       bool


class UpdateProjectSettingsRequest(BaseModel):
    """Fields the frontend can update in project.json. All optional."""
    root_path:            str              # Required: identifies which project
    title:                str | None = None
    description:          str | None = None
    genre:                str | None = None
    tone:                 str | None = None
    content_mode_default: str | None = None
    cost_tier:            str | None = None
    default_model:        str | None = None


@router.get("/recent", response_model=list[RecentProjectItem])
async def get_recent_projects():
    """Return the list of recently opened projects, sorted by last opened."""
    entries = load_recent()
    return [RecentProjectItem(**e) for e in entries if "project_id" in e]


@router.delete("/recent/{project_id}")
async def remove_recent_project(project_id: str):
    """Remove a project from the recent list (does not delete files)."""
    remove_project(project_id)
    return {"status": "ok"}


@router.get("/settings")
async def get_project_settings(root_path: str):
    """Read and return the full project.json for a given project."""
    data = _read_project_json(root_path)
    data["root_path"] = root_path
    return data


# ── Inspect folder (smart-detect for the unified [Open Project] button) ────
#
# Phase 6 collapses the old separate "Open Project" / "Open Series" buttons
# into one. This endpoint takes a folder path the writer just picked, looks
# for project.json or series.json inside it, and tells the frontend which
# kind of thing it is so the UI can route accordingly:
#   - "project" -> open it directly in the editor
#   - "series"  -> show the books-in-series picker (with [+ Add Book])
#   - "unknown" -> show a friendly "this doesn't look like Storythread Studio" error
#
# Listing books for the series case is folded in here so the frontend gets
# everything in one round-trip. Same scan logic as the existing /list-books
# endpoint, just inlined.

class InspectedBook(BaseModel):
    """One book entry inside an inspected series folder."""
    project_id:  str
    title:       str
    folder_name: str
    root_path:   str


class InspectFolderResponse(BaseModel):
    kind:    str                   # "project" | "series" | "unknown"
    path:    str                   # Echoed back so the frontend doesn't have to remember
    title:   str | None = None     # project.title or series.name when known
    books:   list[InspectedBook] = []   # Populated only when kind == "series"


@router.get("/inspect-folder", response_model=InspectFolderResponse)
async def inspect_folder(path: str):
    """
    Look at a folder and report whether it contains a Storythread Studio project,
    a series, or neither. Used by the unified [Open Project] flow on the
    main menu so a single button handles both cases.
    """
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Folder not found: {path}")

    # Project takes precedence: a folder containing both project.json and
    # series.json (unusual, but possible in nested layouts) opens as the
    # project, since that's the more specific thing the writer probably wants.
    project_file = os.path.join(path, "project.json")
    if os.path.isfile(project_file):
        try:
            with open(project_file, "r", encoding="utf-8") as f:
                pdata = json.load(f)
            return InspectFolderResponse(
                kind="project",
                path=path,
                title=pdata.get("title"),
            )
        except (json.JSONDecodeError, OSError):
            # Malformed project.json -- treat as unknown rather than failing
            # the whole inspect call.
            return InspectFolderResponse(kind="unknown", path=path)

    series_file = os.path.join(path, "series.json")
    if os.path.isfile(series_file):
        try:
            with open(series_file, "r", encoding="utf-8") as f:
                sdata = json.load(f)
        except (json.JSONDecodeError, OSError):
            return InspectFolderResponse(kind="unknown", path=path)

        books: list[InspectedBook] = []
        # Scan immediate children for book project.json files. Same shape as
        # the existing /api/series/list-books endpoint, inlined here so the
        # frontend gets project + books in one network call.
        try:
            entries = sorted(os.listdir(path))
        except OSError:
            entries = []
        for entry in entries:
            entry_path = os.path.join(path, entry)
            if not os.path.isdir(entry_path):
                continue
            book_pf = os.path.join(entry_path, "project.json")
            if not os.path.isfile(book_pf):
                continue
            try:
                with open(book_pf, "r", encoding="utf-8") as f:
                    bdata = json.load(f)
                books.append(InspectedBook(
                    project_id  = bdata.get("project_id", ""),
                    title       = bdata.get("title", entry),
                    folder_name = entry,
                    root_path   = entry_path,
                ))
            except (json.JSONDecodeError, OSError):
                continue

        return InspectFolderResponse(
            kind="series",
            path=path,
            title=sdata.get("name"),
            books=books,
        )

    return InspectFolderResponse(kind="unknown", path=path)


# ── Apply Outline Template ─────────────────────────────────────────────────
#
# Called when the writer clicks "+ New Template" in the editor toolbar (or
# from Project Settings). Overwrites notes/outline.md with the chosen
# scaffold. The frontend shows a confirmation warning before calling this
# because the existing outline contents are destroyed (hard overwrite --
# no automatic backup by design).
#
# We read metadata from project.json (and series.json if this is a
# book-in-series) so the rendered template's HTML comment header has
# the right seed values.

class ApplyOutlineTemplateRequest(BaseModel):
    root_path:     str   # Which project -- same identifier pattern as /settings
    template_type: str   # "novel" | "short_story"


class ApplyOutlineTemplateResponse(BaseModel):
    content:          str   # The new outline.md contents, so the editor can refresh
    template_applied: str   # Echo of which template was used (for UI feedback)


@router.post("/apply-outline-template", response_model=ApplyOutlineTemplateResponse)
async def apply_outline_template(request: ApplyOutlineTemplateRequest):
    """
    Overwrite notes/outline.md with the selected template, pre-filled
    with whatever metadata we can pull from project.json + series.json.

    Returns the new content so the editor can reload without an extra
    GET call. Also records the template choice in project.json so other
    parts of the app can know what scaffold is currently in play.
    """
    # Validate the template choice up front so we don't touch any files
    # if the value is bogus.
    if request.template_type not in VALID_OUTLINE_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown outline template '{request.template_type}'. "
                   f"Valid options: {', '.join(VALID_OUTLINE_TEMPLATES)}."
        )

    root = request.root_path
    if not os.path.isdir(root):
        raise HTTPException(status_code=400, detail=f"Not a folder: {root}")

    project_json_path = os.path.join(root, "project.json")
    if not os.path.isfile(project_json_path):
        raise HTTPException(
            status_code=404,
            detail="project.json not found -- can't apply a template to a "
                   "folder that isn't a Storythread Studio project."
        )

    # Read the project's own metadata
    try:
        with open(project_json_path, "r", encoding="utf-8") as f:
            project_data = json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"project.json is malformed: {e}")

    # If this book is part of a series, fold in the series's genre/tone too.
    # The creation flow does this already; the toolbar button needs the same
    # logic so re-applying a template captures the current series context.
    series_name = ""
    genre = ""
    tone = ""
    series_path = project_data.get("series_path") or ""
    if series_path:
        series_json_path = os.path.join(series_path, "series.json")
        if os.path.isfile(series_json_path):
            try:
                with open(series_json_path, "r", encoding="utf-8") as f:
                    series_data = json.load(f)
                series_name = series_data.get("name", "") or ""
                genre       = series_data.get("genre", "") or ""
                tone        = series_data.get("tone", "") or ""
            except (json.JSONDecodeError, OSError):
                # Series file unreadable -- just render without its metadata.
                # Better to succeed with less pre-fill than to fail entirely.
                pass

    metadata: OutlineMetadata = {
        "title":       project_data.get("title", "") or "",
        "description": project_data.get("description", "") or "",
        "series_name": series_name,
        "genre":       genre,
        "tone":        tone,
    }

    # Render + write. We overwrite outline.md in place with no backup
    # because the frontend's confirmation dialog already warned the user.
    content = render_outline(request.template_type, metadata)
    outline_path = os.path.join(root, "notes", "outline.md")
    os.makedirs(os.path.dirname(outline_path), exist_ok=True)
    with open(outline_path, "w", encoding="utf-8") as f:
        f.write(content)

    # Record the new template choice in project.json so settings UIs and
    # future features can tell what scaffold is in play.
    project_data["outline_template"] = request.template_type
    project_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    with open(project_json_path, "w", encoding="utf-8") as f:
        json.dump(project_data, f, indent=2)

    return ApplyOutlineTemplateResponse(
        content=content,
        template_applied=request.template_type,
    )


@router.put("/settings")
async def update_project_settings(request: UpdateProjectSettingsRequest):
    """Update specific fields in a project's project.json file."""
    root_path = request.root_path
    project_file = os.path.join(root_path, "project.json")

    if not os.path.isfile(project_file):
        raise HTTPException(status_code=404, detail="project.json not found.")

    # Read current
    try:
        with open(project_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"project.json is malformed: {e}")

    # Update only provided fields
    if request.title is not None:
        data["title"] = request.title
    if request.description is not None:
        data["description"] = request.description
    if request.genre is not None:
        data["genre"] = request.genre
    if request.tone is not None:
        data["tone"] = request.tone
    if request.content_mode_default is not None:
        data["content_mode_default"] = request.content_mode_default
    if request.cost_tier is not None:
        data["cost_tier"] = request.cost_tier
    if request.default_model is not None:
        data["default_model"] = request.default_model

    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Write back
    with open(project_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    data["root_path"] = root_path
    return data
