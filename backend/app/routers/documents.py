# routers/documents.py -- Chapter File API
# ==========================================
# This router handles reading and writing the actual Markdown chapter files
# that live inside a project's manuscript/ folder.
#
# Routes defined here:
#   GET  /api/documents/chapters?folder_path=...              -- list all chapters
#   GET  /api/documents/chapter?folder_path=...&filename=...  -- load one chapter
#   POST /api/documents/chapter                               -- save a chapter to disk
#
# Why a separate router from projects.py?
# projects.py handles the project container (create, open, metadata).
# documents.py handles the content inside the project (the actual writing).
# Keeping them separate follows the "single responsibility" principle --
# each file does one job and is easier to understand and extend.

import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


# --- Router ---
router = APIRouter(prefix="/api/documents", tags=["documents"])


# --- Pydantic Models ---

class ChapterInfo(BaseModel):
    """Metadata about one chapter file. Returned in the chapter list."""
    filename: str   # e.g. "01-chapter-one.md"
    title: str      # e.g. "Chapter One" (from the first # heading or the filename)
    path: str       # Full absolute path to the file on disk


class LoadChapterResponse(BaseModel):
    """The content and metadata of one chapter, returned after a load request."""
    filename: str
    title: str
    content: str    # The full Markdown text of the chapter
    path: str


class SaveChapterRequest(BaseModel):
    """What the frontend sends when the writer saves a chapter."""
    folder_path: str   # The project's root directory
    filename: str      # e.g. "01-chapter-one.md"
    content: str       # The full Markdown content to write


class SaveChapterResponse(BaseModel):
    """Confirmation returned after a successful save."""
    filename: str
    path: str
    message: str


# --- Helpers ---

def _manuscript_dir(folder_path: str) -> str:
    """Returns the absolute path to the manuscript/ folder inside a project."""
    return os.path.join(folder_path, "manuscript")


def _title_from_file(filepath: str, filename: str) -> str:
    """
    Tries to extract a human-readable chapter title by reading the first
    # heading from the file. Falls back to formatting the filename if the
    file can't be read or has no heading.

    Examples:
      "01-chapter-one.md" with "# Chapter One\\n..." -> "Chapter One"
      "02-the-storm.md" with no heading              -> "The Storm"
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("# "):
                    return line[2:].strip()   # Strip the "# " prefix
    except OSError:
        pass  # If we can't read the file, fall through to filename-based title

    # Fallback: convert filename to a readable title
    # "01-chapter-one.md" -> "Chapter One"
    name = filename.removesuffix(".md")                  # Drop extension
    name = re.sub(r"^\d+-", "", name)                    # Drop leading number prefix
    name = name.replace("-", " ").replace("_", " ")      # Dashes/underscores to spaces
    return name.title()                                  # Title Case


# --- GET /api/documents/chapters ---
@router.get("/chapters", response_model=list[ChapterInfo])
async def list_chapters(folder_path: str):
    """
    Returns a list of all .md files in the project's manuscript/ folder,
    sorted by filename (which sorts by chapter number when files are
    named like 01-chapter-one.md, 02-chapter-two.md, etc.)

    The frontend calls this when a project is opened to populate the
    chapter list in the left navigation panel.
    """
    manuscript = _manuscript_dir(folder_path)

    if not os.path.isdir(manuscript):
        raise HTTPException(
            status_code=404,
            detail=f"manuscript/ folder not found in: {folder_path}"
        )

    chapters = []
    # os.scandir is faster than os.listdir for large folders because it
    # doesn't need a separate stat() call to check the file type.
    with os.scandir(manuscript) as entries:
        for entry in entries:
            if entry.is_file() and entry.name.endswith(".md"):
                chapters.append(ChapterInfo(
                    filename=entry.name,
                    title=_title_from_file(entry.path, entry.name),
                    path=entry.path,
                ))

    # Sort by filename so chapters appear in numeric order
    chapters.sort(key=lambda c: c.filename)
    return chapters


# --- GET /api/documents/chapter ---
@router.get("/chapter", response_model=LoadChapterResponse)
async def load_chapter(folder_path: str, filename: str):
    """
    Reads and returns the full Markdown content of one chapter file.

    The frontend calls this when the writer clicks a chapter in the nav panel.
    Security note: we validate that the resolved path stays inside the
    manuscript/ folder to prevent path traversal attacks (e.g. filename="../../etc/passwd").
    """
    manuscript = _manuscript_dir(folder_path)
    # os.path.realpath resolves ".." and symlinks so we can safely compare paths
    chapter_path = os.path.realpath(os.path.join(manuscript, filename))
    safe_root    = os.path.realpath(manuscript)

    # Reject any path that escapes the manuscript/ folder
    if not chapter_path.startswith(safe_root + os.sep) and chapter_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not os.path.isfile(chapter_path):
        raise HTTPException(
            status_code=404,
            detail=f"Chapter not found: {filename}"
        )

    try:
        with open(chapter_path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not read file: {e}")

    return LoadChapterResponse(
        filename=filename,
        title=_title_from_file(chapter_path, filename),
        content=content,
        path=chapter_path,
    )


# --- POST /api/documents/chapter ---
@router.post("/chapter", response_model=SaveChapterResponse)
async def save_chapter(request: SaveChapterRequest):
    """
    Writes the chapter content to disk, overwriting the existing file.

    This is called every time the writer presses Ctrl+S or the Save button.
    Markdown files are the source of truth -- this is what actually persists the work.

    Security note: same path traversal check as load_chapter.
    """
    manuscript = _manuscript_dir(request.folder_path)
    chapter_path = os.path.realpath(os.path.join(manuscript, request.filename))
    safe_root    = os.path.realpath(manuscript)

    if not chapter_path.startswith(safe_root + os.sep) and chapter_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not os.path.isdir(manuscript):
        raise HTTPException(
            status_code=404,
            detail=f"manuscript/ folder not found in: {request.folder_path}"
        )

    try:
        with open(chapter_path, "w", encoding="utf-8") as f:
            f.write(request.content)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write file: {e}")

    return SaveChapterResponse(
        filename=request.filename,
        path=chapter_path,
        message=f"Saved {request.filename} successfully.",
    )
