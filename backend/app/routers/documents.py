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

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.outline_frontmatter import parse_outline_frontmatter, strip_outline_frontmatter
from app.progress_store import record_save_event, migrate_file_relpath
from app.settings_store import get_rollover_hour
from app.utils.structure_store import (
    order_rank,
    sync_add_chapter,
    sync_remove_chapter,
    sync_rename_chapter,
)


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
    """What the frontend sends when the writer renames a chapter inline."""
    folder_path: str
    filename:    str
    new_title:   str


class RenameChapterResponse(BaseModel):
    """
    What comes back after a rename. Since the sidebar overhaul a rename
    changes the FILE NAME too (slug follows the title, numeric prefix kept),
    so the response carries both names plus per-step cascade flags. A False
    flag means that step failed softly -- the rename itself succeeded, and
    the affected piece self-heals or re-pairs later (see rename_chapter).
    """
    filename:     str    # the (possibly new) filename after the rename
    old_filename: str    # what it was -- frontend patches its state with this
    title:        str
    path:         str    # absolute path after the rename
    summary_moved:     bool = False   # summaries/chapters/<stem>.md followed
    scenes_moved:      bool = False   # summaries/scenes/<stem>/ followed
    structure_updated: bool = False   # structure.json entry swapped in place
    progress_migrated: bool = False   # progress history rows repointed


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
    Returns a list of all .md files in the project's manuscript/ folder in
    READING ORDER: manuscript/structure.json order when the project uses
    acts, plain filename order (01-, 02-, ...) when it doesn't.

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

    # Reading order comes from the structure manifest (falls back to
    # filename order for projects without one). Files the manifest hasn't
    # seen yet sort last by name -- rank.get() default handles that.
    rank = order_rank(folder_path)
    chapters.sort(key=lambda c: (rank.get(c.filename, len(rank)), c.filename))
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


# --- GET /api/documents/chapter-summaries (list) ---
# Convenience endpoint for the ChipPicker. Returns every chapter summary file
# present under summaries/chapters/, paired with the chapter's title (read
# from the matching manuscript/<stem>.md file's first heading). The picker
# uses this to render a list of attachable chapter-summary chips without
# making N+1 round trips.

class ChapterSummaryListItem(BaseModel):
    chapter_filename: str   # the manuscript file's name, e.g. "07-the-awakening.md"
    chapter_title:    str   # human-readable title; same logic as the chapter list
    summary_filename: str   # the summary file under summaries/chapters/


@router.get("/chapter-summaries", response_model=list[ChapterSummaryListItem])
async def list_chapter_summaries(folder_path: str):
    """
    List every chapter summary present in summaries/chapters/.

    Each entry pairs the summary file with the chapter title taken from the
    matching manuscript/<stem>.md (falling back to a humanized filename when
    the chapter file is missing or has no heading). Returns an empty list when
    the summaries/chapters/ directory doesn't exist yet, mirroring how
    list_scene_summaries handles the empty case.
    """
    summary_dir  = os.path.realpath(os.path.join(folder_path, "summaries", "chapters"))
    manuscript   = _manuscript_dir(folder_path)
    if not os.path.isdir(summary_dir):
        return []

    results: list[ChapterSummaryListItem] = []
    with os.scandir(summary_dir) as entries:
        for entry in entries:
            if not entry.is_file() or not entry.name.endswith(".md"):
                continue
            stem = entry.name.removesuffix(".md")
            chapter_filename = f"{stem}.md"
            chapter_path     = os.path.join(manuscript, chapter_filename)
            chapter_title    = _title_from_file(chapter_path, chapter_filename)
            results.append(ChapterSummaryListItem(
                chapter_filename = chapter_filename,
                chapter_title    = chapter_title,
                summary_filename = entry.name,
            ))

    # Sort in reading order (structure manifest, filename fallback) so the
    # picker matches the sidebar's chapter ordering.
    rank = order_rank(folder_path)
    results.sort(key=lambda r: (rank.get(r.chapter_filename, len(rank)), r.summary_filename))
    return results


# ── Phase 6: Scene Summary read/write (plain Markdown) ──────────────────────
# Scene summaries live as plain Markdown files inside a per-chapter folder:
#   <project>/summaries/scenes/<chapter-stem>/scene-01.md
#   <project>/summaries/scenes/<chapter-stem>/scene-02.md
#   ...
# The file body is "# <Scene Title>" followed by a blank line and the 200-400
# word summary body. Plain Markdown, no YAML frontmatter (matches chapter
# summaries). The chapter stem is derived from the chapter filename so a
# chapter renamed or re-ordered via filename also moves its scene folder.

class Beat(BaseModel):
    """
    One beat: a planning checkpoint inside a scene ("MC finds the letter").
    Beats live INSIDE the scene's sidecar summary file as a `## Beats`
    checklist section -- never in the manuscript prose itself, which stays
    100% clean. `done` maps to the checkbox: - [ ] vs - [x].
    """
    text: str
    done: bool = False


class SceneSummaryInfo(BaseModel):
    """One entry in the scene-summaries list. Filled slots only."""
    index:    int   # 1-based positional index (matches scene-NN.md)
    title:    str   # Extracted from the `# Heading` line in the scene summary file
    filename: str   # e.g., "scene-01.md" -- useful for log messages and UI debugging
    # The scene's beats, so the sidebar can render Scene > Beats children
    # from the single list call it already makes.
    beats:    list[Beat] = []


class SceneSummaryResponse(BaseModel):
    """Returned from GET /scene-summary. `exists` distinguishes not-yet-created
    from empty-on-purpose so the UI can show the right empty state.
    `content` NEVER includes the `## Beats` section -- beats come back as
    structured data so the raw checklist can't leak into the summary editor."""
    index:   int
    title:   str
    content: str
    exists:  bool
    beats:   list[Beat] = []


class SaveSceneSummaryRequest(BaseModel):
    folder_path:      str
    chapter_filename: str     # Manuscript filename; stem drives the scene folder name
    index:            int     # 1-based positional index
    title:            str
    content:          str     # Summary body (no `# title` line -- we prepend it)
    # Beats handling -- the None default is LOAD-BEARING:
    #   None  => PRESERVE whatever `## Beats` section is on disk. The AI
    #            regeneration path saves through this endpoint without any
    #            beats field; without this rule every regenerate would
    #            silently wipe the writer's beats.
    #   []    => remove the Beats section on purpose.
    #   [...] => write exactly this list.
    beats:            list[Beat] | None = None


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


# The `## Beats` section: always the LAST section of a scene sidecar file.
# `- [ ] text` / `- [x] text` lines are beats; anything else inside the
# section is ignored on parse and dropped on rewrite (the section is
# app-owned; the free-form summary body above it belongs to the writer).
_BEATS_HEADING_RE = re.compile(r"^##\s+beats\s*$", re.IGNORECASE | re.MULTILINE)
_BEAT_LINE_RE     = re.compile(r"^-\s*\[( |x|X)\]\s*(.+)$")


def _split_beats_section(raw: str) -> tuple[str, list[Beat]]:
    """
    Split a scene sidecar file into (text_without_beats_section, beats).

    The cut happens at the first `## Beats` heading; everything from that
    heading to the end of the file is the beats section. Files with no
    such heading come back unchanged with an empty list.
    """
    m = _BEATS_HEADING_RE.search(raw)
    if not m:
        return raw, []

    before  = raw[: m.start()].rstrip("\n") + "\n" if raw[: m.start()].strip() else ""
    section = raw[m.end():]

    beats: list[Beat] = []
    for line in section.splitlines():
        bm = _BEAT_LINE_RE.match(line.strip())
        if bm:
            beats.append(Beat(text=bm.group(2).strip(), done=bm.group(1).lower() == "x"))
    return before, beats


def _render_beats_section(beats: list[Beat]) -> str:
    """The `## Beats` block ready to append to a sidecar file ("" if empty)."""
    if not beats:
        return ""
    lines = "\n".join(
        f"- [{'x' if b.done else ' '}] {b.text.strip()}" for b in beats if b.text.strip()
    )
    if not lines:
        return ""
    return f"\n## Beats\n\n{lines}\n"


def _read_beats_on_disk(scene_file: str) -> list[Beat]:
    """Beats currently stored in a sidecar file ([] if missing/unreadable)."""
    try:
        with open(scene_file, "r", encoding="utf-8") as f:
            return _split_beats_section(f.read())[1]
    except OSError:
        return []


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
                # Sidecar files are small (a few hundred words); reading each
                # one for its beats keeps the sidebar to this single request.
                beats    = _read_beats_on_disk(entry.path),
            ))

    # Sort by index so the sidebar shows Scene 1, 2, 3 in order even if the
    # OS returned them in a different order.
    results.sort(key=lambda r: r.index)
    return results


# --- GET /api/documents/all-scene-summaries (list across chapters) ---
# Convenience endpoint that returns every scene summary in the project,
# grouped by chapter. The ChipPicker uses this to render a tree of attachable
# scene-summary chips without making one request per chapter. Skips chapters
# that have no scene summaries so the picker only shows usable entries.

class SceneSummaryGroup(BaseModel):
    chapter_filename: str
    chapter_title:    str
    scenes:           list[SceneSummaryInfo]


@router.get("/all-scene-summaries", response_model=list[SceneSummaryGroup])
async def list_all_scene_summaries(folder_path: str):
    """
    For every chapter in manuscript/, return its scene summary list. Chapters
    with no scene summaries are omitted; the response only contains groups
    that have at least one scene to attach.
    """
    manuscript = _manuscript_dir(folder_path)
    if not os.path.isdir(manuscript):
        return []

    groups: list[SceneSummaryGroup] = []

    # Iterate chapters in reading order (structure manifest, filename
    # fallback). Same ordering rule as list_chapters so the picker matches
    # the sidebar.
    rank = order_rank(folder_path)
    chapter_filenames = sorted(
        (e.name for e in os.scandir(manuscript)
         if e.is_file() and e.name.endswith(".md")),
        key=lambda name: (rank.get(name, len(rank)), name),
    )

    for chapter_filename in chapter_filenames:
        scene_dir, _ = _scene_summary_paths(folder_path, chapter_filename)
        if not os.path.isdir(scene_dir):
            continue

        scenes: list[SceneSummaryInfo] = []
        with os.scandir(scene_dir) as entries:
            for entry in entries:
                if not entry.is_file():
                    continue
                idx = _index_from_scene_filename(entry.name)
                if idx is None:
                    continue
                scenes.append(SceneSummaryInfo(
                    index    = idx,
                    title    = _scene_title_from_file(entry.path),
                    filename = entry.name,
                ))

        if not scenes:
            continue

        scenes.sort(key=lambda s: s.index)
        chapter_path  = os.path.join(manuscript, chapter_filename)
        chapter_title = _title_from_file(chapter_path, chapter_filename)
        groups.append(SceneSummaryGroup(
            chapter_filename = chapter_filename,
            chapter_title    = chapter_title,
            scenes           = scenes,
        ))

    return groups


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
        file_raw = f.read()

    # Split the app-owned `## Beats` section off FIRST -- it comes back as
    # structured data, never as text the summary editor could mangle.
    raw, beats = _split_beats_section(file_raw)

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
        beats   = beats,
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

    # Beats rule (see SaveSceneSummaryRequest): None = preserve what's on
    # disk. This is what keeps AI regeneration -- which saves through this
    # endpoint with no beats field -- from wiping the writer's beats.
    beats = request.beats if request.beats is not None else _read_beats_on_disk(scene_file)

    os.makedirs(scene_dir, exist_ok=True)

    # We always write with exactly one blank line between the heading and the
    # body, plus a trailing newline. Consistent formatting = fewer surprising
    # diffs when the writer edits the file by hand later. The `## Beats`
    # section, when present, is always the last section of the file.
    text = f"# {title}\n\n{body}\n" if body else f"# {title}\n"
    text += _render_beats_section(beats)
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


# --- POST /api/documents/scene-beats (beats only) ---
# The beats workhorse: toggling a checkbox, adding, editing, or reordering
# beats rewrites ONLY the `## Beats` section, leaving the title and summary
# body byte-identical. A checkbox click must never round-trip and rewrite
# prose the writer may be editing at the same moment. The client always
# sends the FULL list (beats are ~5-15 items; per-beat endpoints would be
# ceremony for nothing).

class SceneBeatsRequest(BaseModel):
    folder_path:      str
    chapter_filename: str
    index:            int
    beats:            list[Beat]


@router.post("/scene-beats")
async def save_scene_beats(request: SceneBeatsRequest):
    """
    Replace a scene's `## Beats` section. Creates the sidecar file (with a
    placeholder title, no summary body) if the scene has no summary yet --
    a writer can plan beats before any summary exists.
    """
    scene_dir, scene_file = _scene_summary_paths(
        request.folder_path, request.chapter_filename, request.index
    )
    assert scene_file is not None

    if os.path.isfile(scene_file):
        try:
            with open(scene_file, "r", encoding="utf-8") as f:
                raw = f.read()
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Could not read scene summary: {e}")
        # Keep everything except the old beats section, byte-for-byte.
        base, _old = _split_beats_section(raw)
        if not base.strip():
            base = f"# Scene {request.index}\n"
    else:
        base = f"# Scene {request.index}\n"

    os.makedirs(scene_dir, exist_ok=True)
    text = base.rstrip("\n") + "\n" + _render_beats_section(request.beats)
    try:
        with open(scene_file, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write scene beats: {e}")

    return {
        "filename": f"scene-{request.index:02d}.md",
        "index":    request.index,
        "beats":    request.beats,
        "message":  "Beats saved.",
    }


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

    # Read previous content (if any) before we overwrite. The Writing Progress
    # gauge needs old vs. new word counts to compute the delta for the day.
    previous_content: str | None = None
    if os.path.isfile(chapter_path):
        try:
            with open(chapter_path, "r", encoding="utf-8") as f:
                previous_content = f.read()
        except OSError:
            # Best-effort -- if we can't read the old content, treat it as new.
            previous_content = None

    try:
        with open(chapter_path, "w", encoding="utf-8") as f:
            f.write(request.content)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write file: {e}")

    # Record the save as a progress event. record_save_event() never raises,
    # so a failure here cannot break the save.
    await record_save_event(
        request.folder_path,
        f"manuscript/{request.filename}",
        request.content,
        previous_content,
        rollover_hour=get_rollover_hour(),
    )

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

    # Determine the next chapter number from the HIGHEST existing numeric
    # prefix, not the file count. Counting files breaks after a delete:
    # with 01- and 03- on disk, count+1 would produce another "03-" and
    # collide. max(prefix)+1 always steps past every file that exists.
    existing = [
        f for f in os.listdir(manuscript)
        if f.endswith(".md") and os.path.isfile(os.path.join(manuscript, f))
    ]
    highest = 0
    for f in existing:
        m = re.match(r"^(\d+)-", f)
        if m:
            highest = max(highest, int(m.group(1)))
    next_num = max(highest, len(existing)) + 1

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

    # Keep the structure manifest in step (no-op for projects without one).
    # New chapters land in the "unassigned" bucket until the writer files
    # them into an act.
    sync_add_chapter(request.folder_path, filename)

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

    # Keep the structure manifest in step (no-op for projects without one).
    sync_remove_chapter(folder_path, filename)

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
    Rename a chapter: update the first `# heading` line AND rename the file
    so the slug always matches the title ("The Storm" -> 03-the-storm.md).
    The numeric NN- prefix is preserved -- it's the on-disk reading-order
    hint -- only the slug part changes.

    Before the sidebar overhaul this endpoint was heading-only, which left
    files permanently named after their FIRST title. That drift confused
    writers browsing the folder ("01-chapter-one.md" containing "The
    Beginning of X"), so renames now cascade.

    Cascade order matters. Everything up to os.rename() is fail-hard (500,
    nothing moved). Everything AFTER it is fail-SOFT with a reported flag:
    a half-finished cascade leaves an annoying-but-self-consistent project
    (an unmoved summary just un-pairs until regenerated; the structure
    manifest heals on next load), whereas refusing the rename because a
    sidecar move failed would be worse. Frontend shows a soft warning when
    any flag comes back False.
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

    # ── Compute the target filename: keep the NN- prefix, re-slug the rest ──
    # Same slug rule as create_chapter so names stay consistent either way
    # a chapter gets its title.
    prefix_match = re.match(r"^(\d+-)", request.filename)
    prefix = prefix_match.group(1) if prefix_match else ""
    slug = re.sub(r"[^a-z0-9]+", "-", new_title.lower()).strip("-")
    if not slug:
        slug = "untitled"
    new_filename = f"{prefix}{slug}.md"
    new_path     = os.path.realpath(os.path.join(manuscript, new_filename))

    if not new_path.startswith(safe_root + os.sep) and new_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid new filename.")

    # Collision guard. One subtlety: Windows filesystems are case-insensitive,
    # so renaming "03-the-storm.md" to "03-The-Storm.md" makes exists() report
    # the SOURCE file itself. A case-only rename must be allowed through.
    renaming_file = new_filename != request.filename
    if (
        renaming_file
        and os.path.exists(new_path)
        and new_filename.lower() != request.filename.lower()
    ):
        raise HTTPException(
            status_code=409,
            detail=f"A file named {new_filename} already exists.",
        )

    # ── Step 1 (fail-hard): rewrite the heading in the old file ─────────────
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

    # Title unchanged as a filename? Then this is a heading-only rename
    # (e.g. only capitalization of words the slug flattens) -- done.
    if not renaming_file:
        return RenameChapterResponse(
            filename=request.filename,
            old_filename=request.filename,
            title=new_title,
            path=chapter_path,
        )

    # ── Step 2 (fail-hard pivot): rename the manuscript file ────────────────
    # If this fails the chapter is still fully valid under its old name with
    # the new heading -- consistent, just not renamed.
    try:
        os.rename(chapter_path, new_path)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not rename file: {e}")

    # ── Steps 3-6 (fail-soft): move everything keyed by the old stem ────────
    summary_moved = False
    try:
        _dir, old_summary = _chapter_summary_paths(request.folder_path, request.filename)
        _dir, new_summary = _chapter_summary_paths(request.folder_path, new_filename)
        if os.path.isfile(old_summary) and not os.path.exists(new_summary):
            os.rename(old_summary, new_summary)
            summary_moved = True
        elif not os.path.isfile(old_summary):
            summary_moved = True   # nothing to move counts as success
    except (HTTPException, OSError):
        pass

    scenes_moved = False
    try:
        old_scene_dir, _ = _scene_summary_paths(request.folder_path, request.filename)
        new_scene_dir, _ = _scene_summary_paths(request.folder_path, new_filename)
        if os.path.isdir(old_scene_dir) and not os.path.exists(new_scene_dir):
            os.rename(old_scene_dir, new_scene_dir)
            scenes_moved = True
        elif not os.path.isdir(old_scene_dir):
            scenes_moved = True    # nothing to move counts as success
    except (HTTPException, OSError):
        pass

    structure_updated = False
    try:
        structure_updated = sync_rename_chapter(
            request.folder_path, request.filename, new_filename
        )
    except OSError:
        pass

    # Progress history rows store "manuscript/<filename>" -- repoint them so
    # daily task-credit dedupe and per-file history survive the rename.
    progress_migrated = False
    try:
        progress_migrated = await migrate_file_relpath(
            request.folder_path,
            f"manuscript/{request.filename}",
            f"manuscript/{new_filename}",
        )
    except Exception:
        # progress is a nicety; never fail the rename over it
        pass

    return RenameChapterResponse(
        filename=new_filename,
        old_filename=request.filename,
        title=new_title,
        path=new_path,
        summary_moved=summary_moved,
        scenes_moved=scenes_moved,
        structure_updated=structure_updated,
        progress_migrated=progress_migrated,
    )


# --- GET /api/documents/manuscript-content ---
# Returns every chapter in manuscript/ with its full Markdown text in one
# request. Used by the Reader Mode overlay so it can stitch all chapters
# together without making one round-trip per chapter.

class ManuscriptChapter(BaseModel):
    """One chapter with its full content, for bulk-manuscript reads."""
    filename: str
    title:    str
    content:  str


@router.get("/manuscript-content", response_model=list[ManuscriptChapter])
async def load_manuscript_content(folder_path: str):
    """
    Read every chapter file in manuscript/ and return them all with their
    content, sorted by filename (chapter order).

    Why bulk? Reader Mode renders the whole manuscript. Making 30 individual
    /chapter requests would be slow and would hammer the backend during the
    open animation. One call is faster and simpler.
    """
    manuscript = _manuscript_dir(folder_path)
    if not os.path.isdir(manuscript):
        raise HTTPException(status_code=404, detail=f"manuscript/ folder not found: {folder_path}")

    chapters: list[ManuscriptChapter] = []
    with os.scandir(manuscript) as entries:
        for entry in entries:
            if not entry.is_file() or not entry.name.endswith(".md"):
                continue
            try:
                with open(entry.path, "r", encoding="utf-8") as f:
                    content = f.read()
            except OSError:
                content = ""
            chapters.append(ManuscriptChapter(
                filename = entry.name,
                title    = _title_from_file(entry.path, entry.name),
                content  = content,
            ))

    # Reader Mode presents the book as a reader would see it -- reading
    # order comes from the structure manifest (filename fallback).
    rank = order_rank(folder_path)
    chapters.sort(key=lambda c: (rank.get(c.filename, len(rank)), c.filename))
    return chapters


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

    # Read previous content (if any) for the word-delta calculation.
    previous_content: str | None = None
    if os.path.isfile(note_path):
        try:
            with open(note_path, "r", encoding="utf-8") as f:
                previous_content = f.read()
        except OSError:
            previous_content = None

    try:
        with open(note_path, "w", encoding="utf-8") as f:
            f.write(request.content)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write file: {e}")

    # Record the save as a progress event. Notes include outline.md, which
    # the gauge treats as a tracked file for both word-delta and task-credit.
    await record_save_event(
        request.folder_path,
        f"notes/{request.filename}",
        request.content,
        previous_content,
        rollover_hour=get_rollover_hour(),
    )

    return SaveChapterResponse(
        filename=request.filename,
        path=note_path,
        message=f"Saved {request.filename} successfully.",
    )


# ── Outline Planner: structured read/write of notes/outline.md ───────────────
#
# These endpoints power the OutlinePlanner screen. They parse outline.md into
# its constituent parts (YAML frontmatter + preamble + ## sections) so the
# writer can edit via a form UI without writing raw YAML.
#
# GET  /api/documents/outline?folder_path=...  -> OutlineResponse
# POST /api/documents/outline                  -> SaveChapterResponse

# Matches "## heading" lines. The split pattern captures the heading so
# re.split returns [preamble, "## Heading1", content1, "## Heading2", ...].
_SECTION_SPLIT_RE = re.compile(r"\n(## [^\n]+)")

# Matches a YAML-closing --- fused directly with a ## heading on the same line,
# e.g. "---## Front Matter". This corruption is produced when _reconstruct_outline
# is called with a preamble that doesn't start with \n, causing fm_block (which
# ends with "---") to run directly into the preamble's first character.
_FUSED_SEPARATOR_RE = re.compile(r"(?m)^---## ")


class OutlineSectionItem(BaseModel):
    """One ## section from outline.md stripped of its surrounding --- separators."""
    heading: str   # e.g. "Front Matter", "Act I -- Setup"
    content: str   # The section body text


class OutlineFrontmatterData(BaseModel):
    """Planning metadata fields from the YAML frontmatter block."""
    target_word_count:      int | None  = None
    expected_characters:    list[str]   = []
    expected_locations:     list[str]   = []
    expected_lore:          list[str]   = []
    expected_relationships: list[str]   = []
    # Chapters is a complex nested list edited via the body section, not the form.
    # We round-trip it unchanged so no data is lost.
    chapters: list = []


class OutlineResponse(BaseModel):
    frontmatter: OutlineFrontmatterData
    preamble:    str                        # HTML comment + title + desc, verbatim
    sections:    list[OutlineSectionItem]


class OutlineSaveRequest(BaseModel):
    folder_path: str
    frontmatter: OutlineFrontmatterData
    preamble:    str
    sections:    list[OutlineSectionItem]


def _parse_outline_sections(body: str) -> tuple[str, list[dict]]:
    """
    Split the outline body (after YAML frontmatter stripped) into preamble and
    a list of {heading, content} dicts.

    The preamble is everything before the first ## heading (HTML comment,
    title, description, and the first --- separator). Each section's content
    has its surrounding --- separators stripped so the round-trip is clean.
    """
    # Auto-heal: if a previous save fused the YAML closing --- with a ## heading
    # (producing e.g. "---## Setting"), split them back onto separate lines.
    # This repairs corrupted files silently on load without any data loss.
    if _FUSED_SEPARATOR_RE.search(body):
        body = _FUSED_SEPARATOR_RE.sub("---\n\n## ", body)

    # Normalize: the regex requires \n BEFORE ## to match. If the body starts
    # with "## " directly (no preceding newline) the first section would be
    # absorbed into the invisible preamble. Prepend \n so the regex finds it.
    if body and not body.startswith("\n"):
        body = "\n" + body

    parts = _SECTION_SPLIT_RE.split(body)
    preamble = parts[0] if parts else ""

    sections: list[dict] = []
    i = 1
    while i < len(parts):
        heading_raw = parts[i]                     # e.g. "## Front Matter"
        content_raw = parts[i + 1] if i + 1 < len(parts) else ""
        i += 2

        heading = heading_raw[3:].strip()           # strip "## " prefix
        # Strip the trailing --- separator that the template writes between
        # sections, plus any leading/trailing blank lines.
        content = content_raw.strip()
        content = re.sub(r"\s*\n---\s*$", "", content).strip()

        sections.append({"heading": heading, "content": content})

    return preamble, sections


def _serialize_frontmatter_block(fm: dict) -> str:
    """
    Serialize the frontmatter dict to a YAML block with the standard teaching
    comments. We reconstruct the comments manually because PyYAML does not
    preserve them when round-tripping through a dict.
    """
    target = fm.get("target_word_count")
    chars  = fm.get("expected_characters")     or []
    locs   = fm.get("expected_locations")      or []
    lore   = fm.get("expected_lore")           or []
    rels   = fm.get("expected_relationships")  or []
    chapters = fm.get("chapters") or []

    def _inline(items: list) -> str:
        if not items:
            return "[]"
        return "[" + ", ".join(str(item) for item in items) + "]"

    if target is None:
        target_line = (
            "target_word_count: null  "
            "# Serial fiction is chapter-self-contained; no fixed total target yet."
        )
    else:
        target_line = f"target_word_count: {int(target)}"

    chapters_str = yaml.dump(chapters, allow_unicode=True, default_flow_style=False).rstrip() if chapters else "[]"

    return (
        "---\n"
        "# OUTLINE TRACKING DATA -- read by the Writing Progress gauge.\n"
        "# Fill these in as you plan. Empty lists are fine; the gauge falls\n"
        "# back to story-type defaults when fields are blank.\n"
        f"{target_line}\n"
        f"expected_characters: {_inline(chars)}\n"
        f"expected_locations: {_inline(locs)}\n"
        f"expected_lore: {_inline(lore)}\n"
        f"expected_relationships: {_inline(rels)}\n"
        f"chapters: {chapters_str}\n"
        "---"
    )


def _reconstruct_outline(fm_block: str, preamble: str, sections: list[dict]) -> str:
    """
    Reassemble the outline.md file from its structured parts.

    Layout produced:
        ---
        YAML block
        ---
        [preamble: HTML comment + title + description + first ---]
        ## Section 1

        content

        ---
        ## Section 2

        content
        ...
    """
    result = fm_block
    # Preamble contains the text after the YAML --- and before the first ## heading.
    # Always ensure a newline between the fm_block (which ends with "---") and the
    # preamble. Without this, a preamble that starts with a non-newline character
    # (e.g. "## Heading") would fuse with the YAML closing --- on the same line,
    # making that section permanently invisible to the parser on next load.
    if not result.endswith("\n"):
        result += "\n"
    result += preamble.rstrip("\n") + "\n"

    for i, section in enumerate(sections):
        result += f"\n## {section['heading']}\n\n{section['content'].strip()}\n"
        if i < len(sections) - 1:
            result += "\n---"

    return result


# --- GET /api/documents/outline ---
@router.get("/outline", response_model=OutlineResponse)
async def get_outline(folder_path: str):
    """
    Parse notes/outline.md into structured parts for the OutlinePlanner screen.

    Returns the YAML frontmatter as typed fields and the body split by ## section
    headings. The preamble (HTML comment metadata, title heading, template
    description) is preserved verbatim so save_outline can reconstruct faithfully.
    """
    notes_dir    = os.path.join(folder_path, "notes")
    outline_path = os.path.join(notes_dir, "outline.md")

    if not os.path.isfile(outline_path):
        raise HTTPException(status_code=404, detail="outline.md not found in notes/.")

    try:
        with open(outline_path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read outline.md: {exc}") from exc

    # Auto-heal before any parsing. The _FUSED_SEPARATOR_RE check in
    # _parse_outline_sections catches fusions in the body, but only AFTER
    # strip_outline_frontmatter runs. If the fusion is at the YAML closing
    # position (e.g. "---## Setting in One Paragraph"), the frontmatter regex
    # mis-fires and absorbs section content into the YAML body, losing both
    # section visibility AND YAML field values. Healing the raw bytes here
    # ensures the frontmatter and body parse correctly, and writing the healed
    # content back means subsequent Planner saves don't overwrite lost sections.
    healed_raw = _FUSED_SEPARATOR_RE.sub("---\n\n## ", raw)
    if healed_raw != raw:
        try:
            with open(outline_path, "w", encoding="utf-8") as wf:
                wf.write(healed_raw)
        except OSError:
            pass  # Non-fatal: serve healed version in memory even if write fails
        raw = healed_raw

    fm_data = parse_outline_frontmatter(raw)
    body    = strip_outline_frontmatter(raw)
    preamble, sections = _parse_outline_sections(body)

    fm = OutlineFrontmatterData(
        target_word_count       = fm_data.get("target_word_count"),
        expected_characters     = fm_data.get("expected_characters")     or [],
        expected_locations      = fm_data.get("expected_locations")      or [],
        expected_lore           = fm_data.get("expected_lore")           or [],
        expected_relationships  = fm_data.get("expected_relationships")  or [],
        chapters                = fm_data.get("chapters")                or [],
    )

    return OutlineResponse(
        frontmatter = fm,
        preamble    = preamble,
        sections    = [OutlineSectionItem(heading=s["heading"], content=s["content"]) for s in sections],
    )


# --- POST /api/documents/outline ---
@router.post("/outline", response_model=SaveChapterResponse)
async def save_outline(request: OutlineSaveRequest):
    """
    Reconstruct notes/outline.md from the structured data sent by the planner and
    write it to disk.

    Uses the same progress-tracking hook as POST /note so the Writing Progress
    gauge picks up word-delta and task-credit events from outline saves.
    """
    notes_dir    = os.path.join(request.folder_path, "notes")
    outline_path = os.path.realpath(os.path.join(notes_dir, "outline.md"))
    safe_root    = os.path.realpath(notes_dir)

    if not outline_path.startswith(safe_root + os.sep) and outline_path != safe_root:
        raise HTTPException(status_code=400, detail="Invalid outline path.")

    if not os.path.isdir(notes_dir):
        raise HTTPException(status_code=404, detail=f"notes/ folder not found in: {request.folder_path}")

    fm_block        = _serialize_frontmatter_block(request.frontmatter.model_dump())
    sections_dicts  = [{"heading": s.heading, "content": s.content} for s in request.sections]
    content         = _reconstruct_outline(fm_block, request.preamble, sections_dicts)

    previous_content: str | None = None
    if os.path.isfile(outline_path):
        try:
            with open(outline_path, "r", encoding="utf-8") as f:
                previous_content = f.read()
        except OSError:
            previous_content = None

    try:
        with open(outline_path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write outline.md: {exc}") from exc

    await record_save_event(
        request.folder_path,
        "notes/outline.md",
        content,
        previous_content,
        rollover_hour=get_rollover_hour(),
    )

    return SaveChapterResponse(
        filename = "outline.md",
        path     = outline_path,
        message  = "Outline saved.",
    )
