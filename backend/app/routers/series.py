# routers/series.py -- Series Management API
# ================================================
# Handles creating, opening, and listing book series.
#
# A "series" is a folder that contains multiple book projects that share
# canonical profiles, settings, and a common story world. Think of it like
# a parent folder that holds several related novels.
#
# Directory structure:
#   ~/Documents/StoryForge/
#     The Ember Throne Saga/          <- series folder
#       series.json                   <- series-level settings
#       profiles/                     <- canonical series-level profiles
#         characters/
#         relationships/
#         locations/
#         lore/
#       The Ashen Crown/              <- book folder (a regular project)
#         project.json
#         manuscript/
#         ...
#
# Routes:
#   POST /api/series/create   -- create a new series folder
#   POST /api/series/open     -- open an existing series by folder path
#   POST /api/series/list-books -- list all book projects inside a series

import os
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


router = APIRouter(prefix="/api/series", tags=["series"])


# Subfolders created inside every new series for canonical (series-wide) profiles
SERIES_PROFILE_FOLDERS = [
    "profiles/characters",
    "profiles/relationships",
    "profiles/locations",
    "profiles/lore",
]


# ── Pydantic Models ──────────────────────────────────────────────────────────

class CreateSeriesRequest(BaseModel):
    """Data the frontend sends when creating a new series."""
    # Optional: when omitted/empty the backend places the new series under
    # the vault root (default ~/Documents/StoryForge) using a slugified
    # version of the series name. Same UX rationale as project creation:
    # the writer never gets prompted for a folder.
    folder_path: str = ""
    name: str             # Series name (e.g. "The Ember Throne Saga")
    genre: str = ""
    subgenre: str = ""
    tone: str = ""
    pacing: str = ""
    target_audience: str = ""
    content_mode: str = "general"   # general | mature | explicit
    keywords: list[str] = []


class OpenSeriesRequest(BaseModel):
    """Open an existing series by its folder path."""
    folder_path: str


class ListBooksRequest(BaseModel):
    """List all book projects inside a series folder."""
    series_path: str


class SeriesResponse(BaseModel):
    """Returned after creating or opening a series."""
    series_id: str
    name: str
    genre: str
    subgenre: str
    tone: str
    pacing: str
    target_audience: str
    content_mode: str
    keywords: list[str]
    root_path: str
    created_at: str
    updated_at: str


class BookListItem(BaseModel):
    """One book found inside a series folder."""
    project_id: str
    title: str
    folder_name: str
    root_path: str


class ListBooksResponse(BaseModel):
    """All books found inside a series."""
    books: list[BookListItem]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _read_series_json(folder_path: str) -> dict:
    """Read and parse series.json from a series folder."""
    series_file = os.path.join(folder_path, "series.json")

    if not os.path.exists(series_file):
        raise HTTPException(
            status_code=404,
            detail=f"No series.json found in: {folder_path}\n"
                   "This folder doesn't appear to be a StoryForge series."
        )

    try:
        with open(series_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"series.json is malformed (invalid JSON): {e}"
        )


def read_series_settings(series_path: str) -> dict | None:
    """
    Read series.json if it exists. Returns None if the path is empty
    or the file doesn't exist. Used by other modules (ai.py) to inject
    series context into prompts without raising HTTP errors.
    """
    if not series_path:
        return None
    series_file = os.path.join(series_path, "series.json")
    if not os.path.exists(series_file):
        return None
    try:
        with open(series_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/create", response_model=SeriesResponse)
async def create_series(request: CreateSeriesRequest):
    """
    Create a new book series.

    Steps:
      1. Resolve where the series folder lives (vault root if no parent
         given, otherwise the writer-provided parent folder)
      2. Create the series folder + canonical profile subfolders
      3. Write series.json with series metadata
      4. Return series info
    """
    # Resolve the parent folder. If the frontend didn't pass one, use the
    # vault root (default ~/Documents/StoryForge). Imported inline to keep
    # the top-of-file import graph small and avoid a circular dependency
    # if settings_store ever ends up importing from this module.
    from app.routers.projects import _slugify_folder_name, _unique_folder
    from app.settings_store import get_vault_root

    explicit_parent = bool(request.folder_path and request.folder_path.strip())

    if explicit_parent:
        parent = request.folder_path
        if not os.path.exists(parent):
            raise HTTPException(status_code=400, detail=f"Parent folder not found: {parent}")
        if not os.path.isdir(parent):
            raise HTTPException(status_code=400, detail=f"Path is not a folder: {parent}")
        # Legacy path: respect the writer-provided name verbatim. If the
        # exact folder collides we surface a clear error rather than
        # silently renaming -- the writer chose this path explicitly.
        series_folder = os.path.join(parent, request.name)
        if os.path.exists(os.path.join(series_folder, "series.json")):
            raise HTTPException(
                status_code=409,
                detail="A series already exists in this folder. Use 'Open Series' instead."
            )
    else:
        # Auto-placement under the vault root with slugified naming +
        # collision suffix. _unique_folder returns a path that doesn't yet
        # exist on disk; we create it below.
        parent = get_vault_root()
        series_folder = _unique_folder(parent, _slugify_folder_name(request.name))

    # Create the series folder and canonical profile subfolders
    os.makedirs(series_folder, exist_ok=True)
    for subfolder in SERIES_PROFILE_FOLDERS:
        os.makedirs(os.path.join(series_folder, subfolder), exist_ok=True)

    # Build series metadata
    now = datetime.now(timezone.utc).isoformat()
    series_data = {
        "series_id":       str(uuid.uuid4()),
        "name":            request.name,
        "genre":           request.genre,
        "subgenre":        request.subgenre,
        "tone":            request.tone,
        "pacing":          request.pacing,
        "target_audience": request.target_audience,
        "content_mode":    request.content_mode,
        "keywords":        request.keywords,
        "root_path":       series_folder,
        "created_at":      now,
        "updated_at":      now,
    }

    # Write series.json
    series_file = os.path.join(series_folder, "series.json")
    with open(series_file, "w", encoding="utf-8") as f:
        json.dump(series_data, f, indent=2)

    return SeriesResponse(**series_data)


@router.post("/open", response_model=SeriesResponse)
async def open_series(request: OpenSeriesRequest):
    """Open an existing series by reading its series.json."""
    folder = request.folder_path

    if not os.path.exists(folder):
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder}")

    data = _read_series_json(folder)

    # Patch root_path in case the series was moved
    data["root_path"] = folder

    return SeriesResponse(**data)


@router.post("/list-books", response_model=ListBooksResponse)
async def list_books(request: ListBooksRequest):
    """
    List all book projects inside a series folder.

    Scans immediate subdirectories for project.json files. Each one
    that has a valid project.json is returned as a book.
    """
    series_path = request.series_path

    if not os.path.exists(series_path):
        raise HTTPException(status_code=400, detail=f"Series folder not found: {series_path}")

    books: list[BookListItem] = []

    # Scan immediate children for project.json
    try:
        entries = sorted(os.listdir(series_path))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot read series folder: {e}")

    for entry in entries:
        entry_path = os.path.join(series_path, entry)
        if not os.path.isdir(entry_path):
            continue

        project_file = os.path.join(entry_path, "project.json")
        if not os.path.exists(project_file):
            continue

        try:
            with open(project_file, "r", encoding="utf-8") as f:
                pdata = json.load(f)
            books.append(BookListItem(
                project_id=pdata.get("project_id", ""),
                title=pdata.get("title", entry),
                folder_name=entry,
                root_path=entry_path,
            ))
        except (json.JSONDecodeError, OSError):
            # Skip malformed project files
            continue

    return ListBooksResponse(books=books)
