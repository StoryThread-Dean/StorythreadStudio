# routers/projects.py -- Project Create and Open API
# =====================================================
# This file handles everything related to StoryForge writing projects:
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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


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
    ".storyforge",       # Hidden folder for app.db, cache, logs
]

# Default starter files created in a new project
STARTER_FILES = {
    # The first chapter -- ready to write
    "manuscript/01-chapter-one.md": "# Chapter One\n\n",

    # Style guide -- pre-populated with the no-em-dash rule
    "notes/style-guide.md": (
        "# Style Guide\n\n"
        "## Punctuation Rules\n\n"
        "- No em dashes. Use a double hyphen (--) instead.\n\n"
        "## Voice and Tone\n\n"
        "_Add your project's voice and tone notes here._\n"
    ),

    # Outline placeholder
    "notes/outline.md": "# Outline\n\n_Add your story outline here._\n",
}


# --- Pydantic Models ---
# Pydantic is a Python library that validates request and response data.
# Think of these classes as contracts: "this is exactly what shape the
# data must be." FastAPI uses them to auto-validate incoming JSON and
# to document the API.

class CreateProjectRequest(BaseModel):
    """Data the frontend sends when creating a new project."""
    folder_path: str    # Absolute path to the folder the user selected
    title: str          # Project name (e.g., "My Novel")
    description: str = ""  # Optional short description


class OpenProjectRequest(BaseModel):
    """Data the frontend sends when opening an existing project."""
    folder_path: str    # Absolute path to an existing project folder


class ProjectResponse(BaseModel):
    """Data sent back to the frontend after create or open succeeds."""
    project_id: str
    title: str
    description: str
    root_path: str
    content_mode_default: str
    default_model: str | None
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
                   "This folder doesn't appear to be a StoryForge project."
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
    Creates a new StoryForge writing project.

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
    folder = request.folder_path

    # -- Validate the folder --
    if not os.path.exists(folder):
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder}")

    if not os.path.isdir(folder):
        raise HTTPException(status_code=400, detail=f"Path is not a folder: {folder}")

    # -- Check no project already exists there --
    if os.path.exists(os.path.join(folder, "project.json")):
        raise HTTPException(
            status_code=409,   # 409 = Conflict
            detail="A StoryForge project already exists in this folder. "
                   "Use 'Open Project' instead."
        )

    # -- Create the folder structure --
    # os.makedirs creates nested folders in one call.
    # exist_ok=True means "don't throw an error if the folder already exists."
    for subfolder in PROJECT_FOLDERS:
        os.makedirs(os.path.join(folder, subfolder), exist_ok=True)

    # -- Write starter files --
    for relative_path, content in STARTER_FILES.items():
        file_path = os.path.join(folder, relative_path)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

    # -- Build the project metadata --
    now = datetime.now(timezone.utc).isoformat()
    project_data = {
        "project_id":           str(uuid.uuid4()),
        "title":                request.title,
        "description":          request.description,
        "root_path":            folder,
        "content_mode_default": "general",
        "default_model":        None,
        "model_routing_enabled": True,
        "allow_explicit_routing": True,
        "cost_tier":            "balanced",
        "active_style_guide":   "notes/style-guide.md",
        "created_at":           now,
        "updated_at":           now,
    }

    # -- Write project.json --
    project_file = os.path.join(folder, "project.json")
    with open(project_file, "w", encoding="utf-8") as f:
        # indent=2 makes the file human-readable (pretty-printed)
        json.dump(project_data, f, indent=2)

    return ProjectResponse(**project_data)


# --- POST /api/projects/open ---
@router.post("/open", response_model=ProjectResponse)
async def open_project(request: OpenProjectRequest):
    """
    Opens an existing StoryForge project by reading its project.json.

    The frontend sends the folder path the user selected.
    We validate it's a real StoryForge project folder and return its info.
    """
    folder = request.folder_path

    if not os.path.exists(folder):
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder}")

    # Read and return the project data
    data = _read_project_json(folder)

    # Patch root_path in case the project was moved since it was created
    data["root_path"] = folder

    return ProjectResponse(**data)
