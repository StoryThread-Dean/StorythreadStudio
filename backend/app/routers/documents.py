# routers/documents.py -- Chapter & Note File API
# ==================================================
# This router handles reading and writing the Markdown files that make up
# a project's content: chapters in manuscript/ and notes in notes/.
#
# Routes defined here:
#   GET  /api/documents/chapters?folder_path=...              -- list all chapters
#   GET  /api/documents/chapter?folder_path=...&filename=...  -- load one chapter
#   POST /api/documents/chapter                               -- save a chapter to disk
#   GET  /api/documents/note?folder_path=...&filename=...     -- load one note file
#   POST /api/documents/note                                  -- save a note file to disk
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


class CreateChapterRequest(BaseModel):
    """What the frontend sends when the writer creates a new chapter."""
    folder_path: str   # The project's root directory
    title: str         # e.g. "The Storm" -- used for filename and heading


class CreateChapterResponse(BaseModel):
    """Returned after a new chapter is created on disk."""
    filename: str
    title: str
    path: str


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


# ── Phase 6: Chapter Summary read/write (plain Markdown) ─────────────────────
# Chapter summaries live as plain Markdown files in summaries/chapters/, named
# after the chapter stem (e.g., manuscript/01-landing.md pairs with
# summaries/chapters/01-landing.md). The writer edits them like any other
# document in the app; the AI generation endpoint writes to the same file.

class ChapterSummaryResponse(BaseModel):
    """Returned from the GET endpoint. `exists` distinguishes empty-but-present
    from not-yet-created so the UI can show the right empty-state message."""
    filename: str
    content:  str
    exists:   bool


class SaveChapterSummaryRequest(BaseModel):
    folder_path:      str
    chapter_filename: str     # e.g. "01-landing.md" (the manuscript filename; stem is used)
    content:          str


class SaveChapterSummaryResponse(BaseModel):
    filename: str
    message:  str


def _chapter_summary_paths(folder_path: str, chapter_filename: str) -> tuple[str, str]:
    """
    Returns (summary_dir, summary_file) for a given chapter. The stem of the
    chapter filename becomes the summary filename, so 01-landing.md pairs
    with summaries/chapters/01-landing.md.
    """
    stem = os.path.splitext(chapter_filename)[0]
    summary_dir  = os.path.realpath(os.path.join(folder_path, "summaries", "chapters"))
    summary_file = os.path.realpath(os.path.join(summary_dir, f"{stem}.md"))
    # Path-traversal guard: the resolved file must still sit inside the
    # intended summaries/chapters folder after .. / symlink resolution.
    if not summary_file.startswith(summary_dir + os.sep) and summary_file != summary_dir:
        raise HTTPException(status_code=400, detail="Invalid chapter filename.")
    return summary_dir, summary_file


# --- GET /api/documents/chapter-summary ---
@router.get("/chapter-summary", response_model=ChapterSummaryResponse)
async def load_chapter_summary(folder_path: str, chapter_filename: str):
    """
    Read the plain-Markdown chapter summary for one chapter.

    Returns {exists: false, content: ""} when no summary file has been
    created yet. Callers use that flag to show the "No summary yet. Click
    Regenerate." empty state rather than an error.
    """
    _summary_dir, summary_file = _chapter_summary_paths(folder_path, chapter_filename)

    stem = os.path.splitext(chapter_filename)[0]
    filename = f"{stem}.md"

    if not os.path.isfile(summary_file):
        return ChapterSummaryResponse(filename=filename, content="", exists=False)

    with open(summary_file, "r", encoding="utf-8") as f:
        return ChapterSummaryResponse(filename=filename, content=f.read(), exists=True)


# --- POST /api/documents/chapter-summary ---
@router.post("/chapter-summary", response_model=SaveChapterSummaryResponse)
async def save_chapter_summary(request: SaveChapterSummaryRequest):
    """
    Save a manually-edited chapter summary to disk. Overwrites the existing
    file, or creates it if this is the first save. Does NOT call the AI --
    this endpoint is for direct writer edits (including Ctrl+S in the
    SummaryView editor).
    """
    summary_dir, summary_file = _chapter_summary_paths(request.folder_path, request.chapter_filename)
    os.makedirs(summary_dir, exist_ok=True)

    # Normalize trailing whitespace so the file always ends with exactly one
    # newline. Writers don't notice, but some Markdown tools choke on no
    # final newline.
    content = request.content.rstrip() + "\n"
    with open(summary_file, "w", encoding="utf-8") as f:
        f.write(content)

    stem = os.path.splitext(request.chapter_filename)[0]
    return SaveChapterSummaryResponse(filename=f"{stem}.md", message="Summary saved.")


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


# --- POST /api/documents/create-chapter ---
@router.post("/create-chapter", response_model=CreateChapterResponse)
async def create_chapter(request: CreateChapterRequest):
    """
    Create a new chapter file in the manuscript/ folder.

    The filename is auto-generated from the existing chapter count so chapters
    stay in numeric order (e.g. 03-the-storm.md). The file starts with a
    # heading matching the title the writer provided.
    """
    manuscript = _manuscript_dir(request.folder_path)

    if not os.path.isdir(manuscript):
        raise HTTPException(
            status_code=404,
            detail=f"manuscript/ folder not found in: {request.folder_path}"
        )

    # Count existing .md files to determine the next chapter number
    existing = [
        f for f in os.listdir(manuscript)
        if f.endswith(".md") and os.path.isfile(os.path.join(manuscript, f))
    ]
    next_num = len(existing) + 1

    # Convert the title to a filename-safe slug: "The Storm" -> "the-storm"
    slug = re.sub(r"[^a-z0-9]+", "-", request.title.lower()).strip("-")
    if not slug:
        slug = "untitled"
    filename = f"{next_num:02d}-{slug}.md"

    chapter_path = os.path.join(manuscript, filename)

    # Don't overwrite if a file with this name somehow already exists
    if os.path.exists(chapter_path):
        raise HTTPException(
            status_code=409,
            detail=f"A file named {filename} already exists."
        )

    # Write the new chapter with a heading
    try:
        with open(chapter_path, "w", encoding="utf-8") as f:
            f.write(f"# {request.title}\n\n")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not create file: {e}")

    return CreateChapterResponse(
        filename=filename,
        title=request.title,
        path=os.path.realpath(chapter_path),
    )


# --- Notes ---
# Notes are Markdown files in the project's notes/ folder.
# Unlike chapters, notes are freeform reference documents: outline, style guide,
# themes, etc. They use the same load/save pattern as chapters but read from
# a different folder.

def _notes_dir(folder_path: str) -> str:
    """Returns the absolute path to the notes/ folder inside a project."""
    return os.path.join(folder_path, "notes")


# --- GET /api/documents/note ---
@router.get("/note", response_model=LoadChapterResponse)
async def load_note(folder_path: str, filename: str):
    """
    Reads and returns the full Markdown content of one note file.

    The frontend calls this when the writer clicks "Outline" or "Style Guide"
    in the left nav panel. Same security and error handling as load_chapter.
    """
    notes = _notes_dir(folder_path)
    note_path = os.path.realpath(os.path.join(notes, filename))
    safe_root = os.path.realpath(notes)

    # Reject any path that escapes the notes/ folder
    if not note_path.startswith(safe_root + os.sep) and note_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not os.path.isfile(note_path):
        raise HTTPException(
            status_code=404,
            detail=f"Note not found: {filename}"
        )

    try:
        with open(note_path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not read file: {e}")

    return LoadChapterResponse(
        filename=filename,
        title=_title_from_file(note_path, filename),
        content=content,
        path=note_path,
    )


# --- POST /api/documents/note ---
@router.post("/note", response_model=SaveChapterResponse)
async def save_note(request: SaveChapterRequest):
    """
    Writes note content to disk, overwriting the existing file.

    Called when the writer saves while editing a note (Outline, Style Guide, etc.).
    Same security and error handling as save_chapter.
    """
    notes = _notes_dir(request.folder_path)
    note_path = os.path.realpath(os.path.join(notes, request.filename))
    safe_root = os.path.realpath(notes)

    if not note_path.startswith(safe_root + os.sep) and note_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not os.path.isdir(notes):
        raise HTTPException(
            status_code=404,
            detail=f"notes/ folder not found in: {request.folder_path}"
        )

    try:
        with open(note_path, "w", encoding="utf-8") as f:
            f.write(request.content)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write file: {e}")

    return SaveChapterResponse(
        filename=request.filename,
        path=note_path,
        message=f"Saved {request.filename} successfully.",
    )
