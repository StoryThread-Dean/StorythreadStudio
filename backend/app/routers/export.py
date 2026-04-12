# routers/export.py -- Manuscript Export API
# ============================================
# This router handles exporting the writer's work out of the project
# into combined or snapshot files in the project's exports/ folder.
#
# Routes defined here:
#   POST /api/export/full-manuscript  -- combine all chapters into one .md file
#   POST /api/export/snapshot         -- save a dated copy of manuscript + metadata
#
# Think of this like a "publish" step -- the writer works on individual chapter
# files in manuscript/, and when they're ready, they can export everything into
# a single document or take a snapshot of their current progress.
#
# The exports/ folder already exists in every project (created by the project
# creation logic in projects.py). This router just writes into it.

import json
import os
import re
import shutil
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


# --- Router ---
router = APIRouter(prefix="/api/export", tags=["export"])


# --- Pydantic Models ---

class ExportRequest(BaseModel):
    """What the frontend sends when the writer clicks an export button."""
    folder_path: str   # The project's root directory (e.g. "C:/Users/.../MyNovel")


class ExportResponse(BaseModel):
    """Confirmation returned after a successful export."""
    export_type: str    # "full-manuscript" or "snapshot"
    output_path: str    # Absolute path to the exported file or folder
    message: str        # Human-readable success message


# --- Helper Functions ---

def _exports_dir(folder_path: str) -> str:
    """
    Returns the absolute path to the exports/ folder inside a project.
    Raises 404 if the exports/ folder doesn't exist.
    """
    exports = os.path.join(folder_path, "exports")
    if not os.path.isdir(exports):
        raise HTTPException(
            status_code=404,
            detail=f"exports/ folder not found in: {folder_path}"
        )
    return exports


def _manuscript_dir(folder_path: str) -> str:
    """
    Returns the absolute path to the manuscript/ folder inside a project.
    Raises 404 if the manuscript/ folder doesn't exist.
    """
    manuscript = os.path.join(folder_path, "manuscript")
    if not os.path.isdir(manuscript):
        raise HTTPException(
            status_code=404,
            detail=f"manuscript/ folder not found in: {folder_path}"
        )
    return manuscript


def _collect_chapters(folder_path: str) -> list[tuple[str, str]]:
    """
    Scans the manuscript/ folder for .md files, reads each one, and returns
    them as a sorted list of (filename, content) tuples.

    Sorting by filename ensures chapters come out in the right order when
    they're named like 01-chapter-one.md, 02-chapter-two.md, etc.
    """
    manuscript = _manuscript_dir(folder_path)
    chapters: list[tuple[str, str]] = []

    # os.scandir is efficient -- it reads directory entries without extra stat calls
    with os.scandir(manuscript) as entries:
        for entry in entries:
            if entry.is_file() and entry.name.endswith(".md"):
                try:
                    with open(entry.path, "r", encoding="utf-8") as f:
                        content = f.read()
                    chapters.append((entry.name, content))
                except OSError:
                    # Skip files we can't read -- better to export what we can
                    # than to fail the whole operation
                    pass

    # Sort by filename so chapters appear in numeric/alphabetical order
    chapters.sort(key=lambda c: c[0])
    return chapters


def _project_title(folder_path: str) -> str:
    """
    Reads the project title from project.json.
    Falls back to "untitled" if the file can't be read or has no title.
    """
    project_json_path = os.path.join(folder_path, "project.json")
    try:
        with open(project_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("title", "untitled") or "untitled"
    except (OSError, json.JSONDecodeError):
        return "untitled"


def _safe_title(title: str) -> str:
    """
    Converts a project title into a filename-safe slug.

    Examples:
      "The Lost Kingdom"    -> "the-lost-kingdom"
      "My Novel!!!"         -> "my-novel"
      "  Spaces & Symbols " -> "spaces-symbols"
    """
    # Lowercase, replace any run of non-alphanumeric characters with a single hyphen
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower())
    # Strip leading/trailing hyphens
    return slug.strip("-") or "untitled"


# --- POST /api/export/full-manuscript ---

@router.post("/full-manuscript", response_model=ExportResponse)
async def export_full_manuscript(request: ExportRequest):
    """
    Combines all chapters from manuscript/ into a single Markdown file.

    The output file is written to exports/{slug}-full-manuscript.md and is
    overwritten each time the writer exports. This gives the writer one
    canonical "full book" file they can share, print, or convert.

    Chapters are separated by horizontal rules (---) so they're visually
    distinct in the combined document.
    """
    folder_path = request.folder_path
    exports = _exports_dir(folder_path)

    # Collect all chapter files from manuscript/
    chapters = _collect_chapters(folder_path)
    if not chapters:
        raise HTTPException(
            status_code=404,
            detail="No chapters found in manuscript/ folder. Write some chapters first!"
        )

    # Build the combined document
    # Each chapter's content is included as-is, separated by a horizontal rule.
    # Most chapters already start with a # heading, so we don't need to add one.
    parts: list[str] = []
    for _filename, content in chapters:
        parts.append(content.strip())

    combined = "\n\n---\n\n".join(parts) + "\n"

    # Generate the output filename from the project title
    title = _project_title(folder_path)
    slug = _safe_title(title)
    output_filename = f"{slug}-full-manuscript.md"
    output_path = os.path.join(exports, output_filename)

    # Write the combined manuscript
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(combined)
    except OSError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not write export file: {e}"
        )

    return ExportResponse(
        export_type="full-manuscript",
        output_path=output_path,
        message=f"Exported {len(chapters)} chapter(s) to {output_filename}",
    )


# --- POST /api/export/snapshot ---

@router.post("/snapshot", response_model=ExportResponse)
async def export_snapshot(request: ExportRequest):
    """
    Creates a dated snapshot of the manuscript and project metadata.

    Unlike full-manuscript export (which overwrites one file), snapshots
    accumulate over time. Each snapshot gets its own timestamped folder
    inside exports/, so the writer can look back at earlier versions.

    The snapshot includes:
      - All .md files from manuscript/ (chapter drafts)
      - project.json (project settings and metadata)
    """
    folder_path = request.folder_path
    exports = _exports_dir(folder_path)
    manuscript = _manuscript_dir(folder_path)

    # Generate a timestamped folder name
    title = _project_title(folder_path)
    slug = _safe_title(title)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    snapshot_name = f"{slug}-snapshot-{timestamp}"
    snapshot_dir = os.path.join(exports, snapshot_name)

    # Create the snapshot folder
    try:
        os.makedirs(snapshot_dir, exist_ok=True)
    except OSError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not create snapshot folder: {e}"
        )

    copied_count = 0

    # Copy all .md files from manuscript/ into the snapshot
    try:
        with os.scandir(manuscript) as entries:
            for entry in entries:
                if entry.is_file() and entry.name.endswith(".md"):
                    shutil.copy2(entry.path, os.path.join(snapshot_dir, entry.name))
                    copied_count += 1
    except OSError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error copying manuscript files: {e}"
        )

    # Copy project.json if it exists
    project_json = os.path.join(folder_path, "project.json")
    if os.path.isfile(project_json):
        try:
            shutil.copy2(project_json, os.path.join(snapshot_dir, "project.json"))
        except OSError:
            pass  # Not critical -- the chapters are what matter most

    if copied_count == 0:
        # Clean up the empty folder since there was nothing to snapshot
        try:
            os.rmdir(snapshot_dir)
        except OSError:
            pass
        raise HTTPException(
            status_code=404,
            detail="No chapters found in manuscript/ folder. Nothing to snapshot."
        )

    return ExportResponse(
        export_type="snapshot",
        output_path=snapshot_dir,
        message=f"Snapshot saved: {copied_count} chapter(s) + project.json to {snapshot_name}/",
    )
