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
import shutil

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


class RenameChapterRequest(BaseModel):
    """What the frontend sends when the writer renames a chapter inline.

    Filename stays the same -- the numeric prefix (01-, 02-, ...) preserves
    ordering, and changing it would break any external references. We only
    update the first `# heading` line inside the file, which is what the UI
    displays as the chapter title.
    """
    folder_path: str
    filename:    str
    new_title:   str


class RenameChapterResponse(BaseModel):
    """Confirmation returned after a successful rename."""
    filename: str
    title:    str
    path:     str


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


# ── Phase 6: Scene Summary read/write (plain Markdown) ──────────────────────
# Scene summaries live as plain Markdown files inside a per-chapter folder:
#   <project>/summaries/scenes/<chapter-stem>/scene-01.md
#   <project>/summaries/scenes/<chapter-stem>/scene-02.md
#   ...
# The file body is "# <Scene Title>" followed by a blank line and the 200-400
# word summary body. Plain Markdown, no YAML frontmatter (matches chapter
# summaries). The chapter stem is derived from the chapter filename so a
# chapter renamed or re-ordered via filename also moves its scene folder.

class SceneSummaryInfo(BaseModel):
    """One entry in the scene-summaries list. Filled slots only."""
    index:    int   # 1-based positional index (matches scene-NN.md)
    title:    str   # Extracted from the `# Heading` line in the scene summary file
    filename: str   # e.g., "scene-01.md" -- useful for log messages and UI debugging


class SceneSummaryResponse(BaseModel):
    """Returned from GET /scene-summary. `exists` distinguishes not-yet-created
    from empty-on-purpose so the UI can show the right empty state."""
    index:   int
    title:   str
    content: str
    exists:  bool


class SaveSceneSummaryRequest(BaseModel):
    folder_path:      str
    chapter_filename: str     # Manuscript filename; stem drives the scene folder name
    index:            int     # 1-based positional index
    title:            str
    content:          str     # Summary body (no `# title` line -- we prepend it)


class SaveSceneSummaryResponse(BaseModel):
    filename: str
    index:    int
    message:  str


def _scene_summary_paths(folder_path: str, chapter_filename: str, index: int | None = None) -> tuple[str, str | None]:
    """
    Resolve (scene_folder, scene_file) for a given chapter and optional scene index.

    scene_folder is always the per-chapter directory. scene_file is the absolute
    path to scene-NN.md when `index` is given, else None (used by list/delete-folder).

    Path-traversal guard: both the folder and the file must still resolve inside
    summaries/scenes/ after realpath resolution.
    """
    stem = os.path.splitext(chapter_filename)[0]
    scenes_root = os.path.realpath(os.path.join(folder_path, "summaries", "scenes"))
    scene_dir   = os.path.realpath(os.path.join(scenes_root, stem))

    # The per-chapter folder must still sit under summaries/scenes/.
    if not scene_dir.startswith(scenes_root + os.sep) and scene_dir != scenes_root:
        raise HTTPException(status_code=400, detail="Invalid chapter filename.")

    if index is None:
        return scene_dir, None

    # Enforce a sensible index range. Two digits (01-99) is plenty for fiction;
    # a chapter with more than 99 scenes is a structural problem, not a storage one.
    if index < 1 or index > 99:
        raise HTTPException(status_code=400, detail=f"Scene index must be 1-99 (got {index}).")

    scene_file = os.path.realpath(os.path.join(scene_dir, f"scene-{index:02d}.md"))
    if not scene_file.startswith(scene_dir + os.sep) and scene_file != scene_dir:
        raise HTTPException(status_code=400, detail="Invalid scene index.")
    return scene_dir, scene_file


def _index_from_scene_filename(name: str) -> int | None:
    """
    Pull the numeric index out of "scene-NN.md". Returns None for anything that
    doesn't match, which lets us skip hidden files or stray notes the writer
    might have dropped in the folder.
    """
    m = re.match(r"^scene-(\d{1,3})\.md$", name)
    if not m:
        return None
    return int(m.group(1))


def _scene_title_from_file(filepath: str) -> str:
    """
    Read the first `# Heading` line from a scene summary file as its title.
    Falls back to "Scene" if the file has no heading line.

    Mirrors the pattern in _title_from_file() for chapters, but we accept
    any first-line heading (not just `# `) because a writer editing the
    file by hand might use `## ` instead.
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped.startswith("#"):
                    # Strip leading #s and whitespace -- works for #, ##, ###, etc.
                    return stripped.lstrip("#").strip() or "Scene"
    except OSError:
        pass
    return "Scene"


# --- GET /api/documents/scene-summaries (list) ---
@router.get("/scene-summaries", response_model=list[SceneSummaryInfo])
async def list_scene_summaries(folder_path: str, chapter_filename: str):
    """
    List all scene summary files that exist for a given chapter.

    Returns an empty list if the per-chapter folder doesn't exist yet -- the
    frontend treats that as "no scenes summarized" rather than an error. This
    keeps the sidebar's "Scene Summaries" group rendering trivial (the
    grandchildren disappear when the list is empty).
    """
    scene_dir, _ = _scene_summary_paths(folder_path, chapter_filename)
    if not os.path.isdir(scene_dir):
        return []

    results: list[SceneSummaryInfo] = []
    with os.scandir(scene_dir) as entries:
        for entry in entries:
            if not entry.is_file():
                continue
            idx = _index_from_scene_filename(entry.name)
            if idx is None:
                continue
            results.append(SceneSummaryInfo(
                index    = idx,
                title    = _scene_title_from_file(entry.path),
                filename = entry.name,
            ))

    # Sort by index so the sidebar shows Scene 1, 2, 3 in order even if the
    # OS returned them in a different order.
    results.sort(key=lambda r: r.index)
    return results


# --- GET /api/documents/scene-summary (one) ---
@router.get("/scene-summary", response_model=SceneSummaryResponse)
async def load_scene_summary(folder_path: str, chapter_filename: str, index: int):
    """
    Load a single scene summary file.

    Returns exists=False with empty title/content when the file isn't there yet,
    so the UI can render an empty-state rather than showing an error.
    """
    _scene_dir, scene_file = _scene_summary_paths(folder_path, chapter_filename, index)

    if scene_file is None or not os.path.isfile(scene_file):
        return SceneSummaryResponse(index=index, title="", content="", exists=False)

    with open(scene_file, "r", encoding="utf-8") as f:
        raw = f.read()

    # Pull the `# Title` line off the top (first non-blank line). Whatever
    # follows that line (minus the blank separator) is the summary body.
    lines = raw.splitlines()
    title = ""
    body_start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            body_start = i + 1
            continue
        if stripped.startswith("#"):
            title = stripped.lstrip("#").strip() or "Scene"
            body_start = i + 1
            # If the next line is blank, skip it so `content` doesn't start
            # with an empty line the writer never typed.
            if body_start < len(lines) and not lines[body_start].strip():
                body_start += 1
            break
        # First non-blank line wasn't a heading -- treat the whole file as body.
        break

    body = "\n".join(lines[body_start:]).strip() if title else raw.strip()

    return SceneSummaryResponse(
        index   = index,
        title   = title or "Scene",
        content = body,
        exists  = True,
    )


# --- POST /api/documents/scene-summary (save/overwrite) ---
@router.post("/scene-summary", response_model=SaveSceneSummaryResponse)
async def save_scene_summary(request: SaveSceneSummaryRequest):
    """
    Save a scene summary to disk. Creates the per-chapter folder on first save.
    Overwrites any existing file at the same scene index.

    On-disk layout: "# <title>\\n\\n<content>\\n". Prepending the title as a
    heading keeps the file self-documenting when opened in any Markdown tool.
    """
    scene_dir, scene_file = _scene_summary_paths(
        request.folder_path, request.chapter_filename, request.index
    )
    assert scene_file is not None  # index was provided, so _scene_summary_paths returns a file path

    title = request.title.strip() or "Scene"
    body  = request.content.strip()

    os.makedirs(scene_dir, exist_ok=True)

    # We always write with exactly one blank line between the heading and the
    # body, plus a trailing newline. Consistent formatting = fewer surprising
    # diffs when the writer edits the file by hand later.
    text = f"# {title}\n\n{body}\n" if body else f"# {title}\n"
    try:
        with open(scene_file, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write scene summary: {e}")

    return SaveSceneSummaryResponse(
        filename = f"scene-{request.index:02d}.md",
        index    = request.index,
        message  = "Scene summary saved.",
    )


# --- DELETE /api/documents/scene-summary (one) ---
@router.delete("/scene-summary")
async def delete_scene_summary(folder_path: str, chapter_filename: str, index: int):
    """
    Delete a single scene summary file. The per-chapter folder stays in place
    even if this was the last file; list_scene_summaries returns an empty
    list either way, and leaving the folder avoids a race with a concurrent
    save request.
    """
    _scene_dir, scene_file = _scene_summary_paths(folder_path, chapter_filename, index)
    assert scene_file is not None

    if not os.path.isfile(scene_file):
        raise HTTPException(status_code=404, detail=f"Scene {index} has no summary file.")

    try:
        os.remove(scene_file)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not delete scene summary: {e}")

    return {
        "filename": f"scene-{index:02d}.md",
        "index":    index,
        "message":  f"Deleted scene {index}.",
    }


# --- DELETE /api/documents/scene-summaries (whole chapter folder) ---
@router.delete("/scene-summaries")
async def delete_all_scene_summaries(folder_path: str, chapter_filename: str):
    """
    Remove the entire per-chapter scene summaries folder. Used by the sidebar
    "delete all scene summaries" action and (best-effort) by the chapter
    delete endpoint below.
    """
    scene_dir, _ = _scene_summary_paths(folder_path, chapter_filename)

    if not os.path.isdir(scene_dir):
        raise HTTPException(status_code=404, detail="No scene summaries folder exists for this chapter.")

    try:
        shutil.rmtree(scene_dir)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not delete scene summaries folder: {e}")

    return {
        "chapter_filename": chapter_filename,
        "message":          "Deleted all scene summaries for this chapter.",
    }


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


# --- DELETE /api/documents/chapter ---
@router.delete("/chapter")
async def delete_chapter(folder_path: str, filename: str):
    """
    Delete a chapter file from the manuscript/ folder, and also remove the
    paired chapter summary file (if one exists) in summaries/chapters/.

    Why delete the summary too?
    The summary is derived from the chapter -- its purpose is to describe the
    chapter's events. With the chapter gone, an orphaned summary would be
    confusing clutter. Deleting both keeps the project self-consistent.

    The operation is final -- no trash, no undo. The frontend confirms with
    the writer before calling this endpoint.
    """
    manuscript   = _manuscript_dir(folder_path)
    chapter_path = os.path.realpath(os.path.join(manuscript, filename))
    safe_root    = os.path.realpath(manuscript)

    # Path-traversal guard: same style as load_chapter / save_chapter above.
    if not chapter_path.startswith(safe_root + os.sep) and chapter_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not os.path.isfile(chapter_path):
        raise HTTPException(status_code=404, detail=f"Chapter not found: {filename}")

    try:
        os.remove(chapter_path)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not delete chapter: {e}")

    # Best-effort: remove the paired summary file too. We don't surface a
    # partial-success error if the summary file doesn't exist -- that is the
    # expected state for chapters that never had a summary generated.
    summary_removed = False
    try:
        _summary_dir, summary_file = _chapter_summary_paths(folder_path, filename)
        if os.path.isfile(summary_file):
            os.remove(summary_file)
            summary_removed = True
    except HTTPException:
        pass  # Invalid path -- ignore, we already deleted the chapter itself
    except OSError:
        pass  # Could not remove summary -- leave it, chapter delete already succeeded

    # Best-effort: remove the scene summaries folder too. Same reasoning as
    # above: orphaned per-scene summaries with no chapter to describe would
    # be confusing clutter.
    scenes_removed = False
    try:
        scene_dir, _ = _scene_summary_paths(folder_path, filename)
        if os.path.isdir(scene_dir):
            shutil.rmtree(scene_dir)
            scenes_removed = True
    except HTTPException:
        pass
    except OSError:
        pass

    return {
        "filename":        filename,
        "summary_removed": summary_removed,
        "scenes_removed":  scenes_removed,
        "message":         f"Deleted {filename}.",
    }


# --- DELETE /api/documents/chapter-summary ---
@router.delete("/chapter-summary")
async def delete_chapter_summary(folder_path: str, chapter_filename: str):
    """
    Delete the chapter summary file for a given chapter.

    The chapter itself is untouched -- this endpoint only removes the summary
    under summaries/chapters/<stem>.md. Useful when the writer wants to clear
    out a bad AI-generated summary and start fresh.
    """
    _summary_dir, summary_file = _chapter_summary_paths(folder_path, chapter_filename)

    if not os.path.isfile(summary_file):
        raise HTTPException(status_code=404, detail="No summary file exists for this chapter.")

    try:
        os.remove(summary_file)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not delete summary: {e}")

    stem = os.path.splitext(chapter_filename)[0]
    return {"filename": f"{stem}.md", "message": "Summary deleted."}


# --- POST /api/documents/rename-chapter ---
@router.post("/rename-chapter", response_model=RenameChapterResponse)
async def rename_chapter(request: RenameChapterRequest):
    """
    Rename a chapter by updating the first `# heading` line inside the file.

    Why update the heading instead of the filename?
    The filename carries the numeric prefix (01-landing.md, 02-storm.md) that
    drives manuscript sort order. Changing it would either break ordering or
    require re-numbering every chapter after it. The heading is what the UI
    displays as the title -- updating only the heading keeps the rename cheap
    and reversible without touching the manuscript's structural ordering.

    If the file has no `# heading`, we insert one at the top.
    """
    new_title = request.new_title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="New title cannot be empty.")

    manuscript   = _manuscript_dir(request.folder_path)
    chapter_path = os.path.realpath(os.path.join(manuscript, request.filename))
    safe_root    = os.path.realpath(manuscript)

    if not chapter_path.startswith(safe_root + os.sep) and chapter_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not os.path.isfile(chapter_path):
        raise HTTPException(status_code=404, detail=f"Chapter not found: {request.filename}")

    try:
        with open(chapter_path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not read chapter: {e}")

    # Replace the first `# ...` heading, or prepend one if none exists.
    # re.sub with count=1 rewrites only the first match so we don't touch
    # later sub-headings or in-content '#' lines the writer may have added.
    new_heading = f"# {new_title}"
    pattern     = r'^#\s+.*$'
    updated, replaced = re.subn(pattern, new_heading, content, count=1, flags=re.MULTILINE)

    if replaced == 0:
        # No heading line found -- prepend one followed by a blank line
        updated = f"{new_heading}\n\n{content}" if content else f"{new_heading}\n\n"

    try:
        with open(chapter_path, "w", encoding="utf-8") as f:
            f.write(updated)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write chapter: {e}")

    return RenameChapterResponse(
        filename=request.filename,
        title=new_title,
        path=chapter_path,
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
