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
    """What the frontend sends when the writer clicks an export button.

    The `include_*` flags default to False so the old behavior (manuscript
    only) is preserved for any caller that doesn't pass the new fields.
    Callers that want the richer exports opt in explicitly.
    """
    folder_path: str   # The project's root directory (e.g. "C:/Users/.../MyNovel")

    # Opt-in extras for the richer Phase 6 export:
    #   chapter_summaries -> append a "Chapter Summaries" section to the full
    #                        manuscript, or copy summaries/chapters/ into the
    #                        snapshot folder.
    #   scene_summaries   -> same, but for summaries/scenes/<stem>/*.md
    #   notes             -> copy notes/*.md (outline, style guide, themes)
    #   profiles          -> copy profiles/ (characters, relationships, etc.)
    include_chapter_summaries: bool = False
    include_scene_summaries:   bool = False
    include_notes:             bool = False
    include_profiles:          bool = False

    # Optional chapter filter. When None or empty, ALL chapters in manuscript/
    # are exported (preserves the original behavior for callers that don't pass
    # the field). When non-empty, only chapters whose filename appears in this
    # list are included -- letting the writer export, say, just chapters 3-5
    # for sharing a draft excerpt without splitting their project.
    chapter_filenames: list[str] | None = None


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


def _collect_chapters(
    folder_path: str,
    only_filenames: list[str] | None = None,
) -> list[tuple[str, str]]:
    """
    Scans the manuscript/ folder for .md files, reads each one, and returns
    them as a sorted list of (filename, content) tuples.

    Sorting by filename ensures chapters come out in the right order when
    they're named like 01-chapter-one.md, 02-chapter-two.md, etc.

    When `only_filenames` is provided (and non-empty), only chapters whose
    filename appears in the set are returned. This powers the per-chapter
    selection UI in ExportModal -- the writer picks which chapters to export
    instead of the all-or-nothing behavior. None / empty list = include all
    (preserves the original behavior for older callers).
    """
    manuscript = _manuscript_dir(folder_path)
    chapters: list[tuple[str, str]] = []

    # Build a fast lookup set if a filter was supplied. Comparing filenames
    # is safe here -- the manuscript folder is flat (no subdirectories) so
    # there's no path-traversal risk from this check alone, and the
    # _manuscript_dir() guard already locks us inside the project.
    filter_set: set[str] | None = set(only_filenames) if only_filenames else None

    # os.scandir is efficient -- it reads directory entries without extra stat calls
    with os.scandir(manuscript) as entries:
        for entry in entries:
            if not (entry.is_file() and entry.name.endswith(".md")):
                continue
            if filter_set is not None and entry.name not in filter_set:
                continue
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


# ── Phase 6: helpers for the opt-in extras ──────────────────────────────────
# These read optional project subfolders for the richer exports. Each returns
# an empty list/string when the folder is missing so the export never fails
# just because the writer hasn't created any summaries or notes yet.

def _collect_md_files(folder: str) -> list[tuple[str, str]]:
    """
    Generic "read all .md files in this folder" helper. Used for chapter
    summaries and notes. Sorted by filename so order is stable.
    Returns [] if the folder doesn't exist -- a missing subfolder is normal
    in projects where the writer hasn't used that feature yet.
    """
    if not os.path.isdir(folder):
        return []
    items: list[tuple[str, str]] = []
    with os.scandir(folder) as entries:
        for entry in entries:
            if entry.is_file() and entry.name.endswith(".md"):
                try:
                    with open(entry.path, "r", encoding="utf-8") as f:
                        items.append((entry.name, f.read()))
                except OSError:
                    pass
    items.sort(key=lambda c: c[0])
    return items


def _collect_scene_summaries(folder_path: str) -> list[tuple[str, int, str]]:
    """
    Walk summaries/scenes/<chapter-stem>/scene-NN.md and return a list of
    (chapter_stem, scene_index, content) tuples sorted by (chapter, index).
    Returns [] if no scene summaries exist yet.
    """
    scenes_root = os.path.join(folder_path, "summaries", "scenes")
    if not os.path.isdir(scenes_root):
        return []

    rows: list[tuple[str, int, str]] = []
    try:
        for chapter_stem in sorted(os.listdir(scenes_root)):
            chapter_dir = os.path.join(scenes_root, chapter_stem)
            if not os.path.isdir(chapter_dir):
                continue
            with os.scandir(chapter_dir) as entries:
                for entry in entries:
                    if not entry.is_file() or not entry.name.endswith(".md"):
                        continue
                    m = re.match(r"^scene-(\d{1,3})\.md$", entry.name)
                    if not m:
                        continue
                    try:
                        with open(entry.path, "r", encoding="utf-8") as f:
                            rows.append((chapter_stem, int(m.group(1)), f.read()))
                    except OSError:
                        pass
    except OSError:
        return []

    rows.sort(key=lambda r: (r[0], r[1]))
    return rows


def _copy_tree(src: str, dest: str) -> int:
    """
    Recursively copy src into dest. Returns the count of files copied.
    Returns 0 if src doesn't exist. Used by the snapshot export for
    summaries/, notes/, and profiles/.
    """
    if not os.path.isdir(src):
        return 0
    count = 0
    for root, _dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        target_root = dest if rel == "." else os.path.join(dest, rel)
        os.makedirs(target_root, exist_ok=True)
        for name in files:
            try:
                shutil.copy2(os.path.join(root, name), os.path.join(target_root, name))
                count += 1
            except OSError:
                pass  # One bad file shouldn't abort the whole copy
    return count


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

    # Collect chapter files. When the writer passed a filter list (per-chapter
    # selection from ExportModal), only those chapters end up in the export.
    chapters = _collect_chapters(folder_path, request.chapter_filenames)
    if not chapters:
        # Two distinct empty cases: no chapters at all vs. nothing matched the
        # selection. The error message helps the writer tell them apart.
        if request.chapter_filenames:
            raise HTTPException(
                status_code=404,
                detail="None of the selected chapter filenames matched files in manuscript/."
            )
        raise HTTPException(
            status_code=404,
            detail="No chapters found in manuscript/ folder. Write some chapters first!"
        )

    # Build the combined document. Each chapter's content goes in as-is,
    # separated by a horizontal rule; most chapters already start with a #
    # heading, so we don't need to synthesize one.
    parts: list[str] = []
    for _filename, content in chapters:
        parts.append(content.strip())
    combined = "\n\n---\n\n".join(parts) + "\n"

    # ── Opt-in appendices. Each one is rendered as a top-level # section so
    #    the combined file still reads as a single Markdown document. We skip
    #    sections that are empty on disk -- no point in writing a "Notes"
    #    heading for a project that has no notes. ─────────────────────────
    appendices: list[str] = []
    extras_summary_parts: list[str] = []

    if request.include_chapter_summaries:
        chapter_summaries = _collect_md_files(os.path.join(folder_path, "summaries", "chapters"))
        if chapter_summaries:
            section = ["# Chapter Summaries"]
            for name, body in chapter_summaries:
                section.append(f"\n## {name.removesuffix('.md')}\n")
                section.append(body.strip())
            appendices.append("\n".join(section))
            extras_summary_parts.append(f"{len(chapter_summaries)} chapter summaries")

    if request.include_scene_summaries:
        scene_rows = _collect_scene_summaries(folder_path)
        if scene_rows:
            section = ["# Scene Summaries"]
            current_stem: str | None = None
            for stem, idx, body in scene_rows:
                if stem != current_stem:
                    section.append(f"\n## {stem}\n")
                    current_stem = stem
                section.append(f"\n### Scene {idx}\n")
                # The per-scene file already starts with "# <Scene Title>";
                # strip that leading heading so the combined export uses the
                # ### Scene N heading instead of double-stacking.
                trimmed = re.sub(r"^\s*#[^\n]*\n", "", body.strip(), count=1)
                section.append(trimmed.strip())
            appendices.append("\n".join(section))
            extras_summary_parts.append(f"{len(scene_rows)} scene summaries")

    if request.include_notes:
        notes = _collect_md_files(os.path.join(folder_path, "notes"))
        if notes:
            section = ["# Notes"]
            for name, body in notes:
                section.append(f"\n## {name.removesuffix('.md')}\n")
                section.append(body.strip())
            appendices.append("\n".join(section))
            extras_summary_parts.append(f"{len(notes)} notes")

    if request.include_profiles:
        # Profiles fan out into character/relationship/location/lore folders.
        # Flatten them into one section with subheadings per type.
        profile_types = ["character", "relationship", "location", "lore"]
        profile_chunks: list[str] = []
        total_profiles = 0
        for ptype in profile_types:
            files = _collect_md_files(os.path.join(folder_path, "profiles", ptype))
            if not files:
                continue
            profile_chunks.append(f"\n## {ptype.title()}s\n")
            for name, body in files:
                profile_chunks.append(f"\n### {name.removesuffix('.md')}\n")
                profile_chunks.append(body.strip())
                total_profiles += 1
        if profile_chunks:
            appendices.append("# Profiles" + "".join(profile_chunks))
            extras_summary_parts.append(f"{total_profiles} profiles")

    if appendices:
        combined = combined.rstrip() + "\n\n---\n\n" + "\n\n---\n\n".join(appendices) + "\n"

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

    extras_msg = ""
    if extras_summary_parts:
        extras_msg = " (plus " + ", ".join(extras_summary_parts) + ")"

    return ExportResponse(
        export_type="full-manuscript",
        output_path=output_path,
        message=f"Exported {len(chapters)} chapter(s) to {output_filename}{extras_msg}",
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

    # Optional per-chapter filter: when the writer chose specific chapters in
    # ExportModal, the snapshot only mirrors those (the other manuscript files
    # are simply not copied). None / empty list = full snapshot, same as before.
    chapter_filter: set[str] | None = (
        set(request.chapter_filenames) if request.chapter_filenames else None
    )

    # Copy selected .md files from manuscript/ into the snapshot
    try:
        with os.scandir(manuscript) as entries:
            for entry in entries:
                if not (entry.is_file() and entry.name.endswith(".md")):
                    continue
                if chapter_filter is not None and entry.name not in chapter_filter:
                    continue
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

    # ── Opt-in extras (Phase 6). Each bucket is copied into a matching
    #    subfolder inside the snapshot dir so the shape mirrors the project
    #    layout -- restoring from a snapshot is then a straight copy-paste.
    extras_parts: list[str] = []

    if request.include_chapter_summaries:
        n = _copy_tree(
            os.path.join(folder_path, "summaries", "chapters"),
            os.path.join(snapshot_dir, "summaries", "chapters"),
        )
        if n:
            extras_parts.append(f"{n} chapter summaries")

    if request.include_scene_summaries:
        n = _copy_tree(
            os.path.join(folder_path, "summaries", "scenes"),
            os.path.join(snapshot_dir, "summaries", "scenes"),
        )
        if n:
            extras_parts.append(f"{n} scene summary files")

    if request.include_notes:
        n = _copy_tree(
            os.path.join(folder_path, "notes"),
            os.path.join(snapshot_dir, "notes"),
        )
        if n:
            extras_parts.append(f"{n} notes")

    if request.include_profiles:
        n = _copy_tree(
            os.path.join(folder_path, "profiles"),
            os.path.join(snapshot_dir, "profiles"),
        )
        if n:
            extras_parts.append(f"{n} profile files")

    if copied_count == 0:
        # Clean up the empty folder since there was nothing to snapshot
        try:
            shutil.rmtree(snapshot_dir)
        except OSError:
            pass
        if chapter_filter is not None:
            raise HTTPException(
                status_code=404,
                detail="None of the selected chapter filenames matched files in manuscript/."
            )
        raise HTTPException(
            status_code=404,
            detail="No chapters found in manuscript/ folder. Nothing to snapshot."
        )

    extras_msg = ""
    if extras_parts:
        extras_msg = " (plus " + ", ".join(extras_parts) + ")"

    return ExportResponse(
        export_type="snapshot",
        output_path=snapshot_dir,
        message=f"Snapshot saved: {copied_count} chapter(s) + project.json to {snapshot_name}/{extras_msg}",
    )
