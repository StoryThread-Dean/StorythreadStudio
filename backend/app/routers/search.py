# routers/search.py -- Global Search + Replace endpoints
# ========================================================
# Two endpoints power the Ctrl+Shift+F modal:
#
#   POST /api/search/find    -- scan all project Markdown files for a query,
#                               return grouped match results with context lines.
#   POST /api/search/replace -- snapshot touched files, apply selective
#                               replacements, return stats.
#   POST /api/search/restore -- undo a replace by restoring from a snapshot.
#
# Pure Python os.walk (via pathlib rglob). No ripgrep dependency needed --
# fiction project sizes are small enough that a single-pass scan is fast.

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/search", tags=["search"])


# ── Scope constants ───────────────────────────────────────────────────────────
#
# Spec: walk manuscript/, notes/, profiles/ (all subfolders), summaries/,
# arcs/. Hard-exclude exports/ and .storythread/.

_SEARCH_FOLDERS: list[str] = [
    "manuscript",
    "notes",
    "profiles",
    "summaries",
    "arcs",
]

_EXCLUDED_PARTS: frozenset[str] = frozenset({"exports", ".storythread"})


# ── Pydantic models ───────────────────────────────────────────────────────────

class FindRequest(BaseModel):
    project_path:   str
    query:          str
    case_sensitive: bool = False
    whole_word:     bool = False


class MatchHit(BaseModel):
    line:           int    # 1-based line number in the file
    col:            int    # 0-based column offset within that line
    match_length:   int    # byte length of the matched text
    context_before: str    # line before the match line (empty if first line)
    context_match:  str    # the full line containing the match
    context_after:  str    # line after the match line (empty if last line)


class FileMatches(BaseModel):
    file_relpath: str
    count:        int
    hits:         list[MatchHit]


class FindResponse(BaseModel):
    matches:    list[FileMatches]
    total_hits: int


class ReplaceSelection(BaseModel):
    file_relpath: str
    hit_indices:  list[int]   # 0-based indices into the hits array for this file


class ReplaceRequest(BaseModel):
    project_path:   str
    query:          str
    replacement:    str
    case_sensitive: bool = False
    whole_word:     bool = False
    selections:     list[ReplaceSelection]


class ReplaceResponse(BaseModel):
    snapshot_dir:      str    # absolute path to the snapshot directory
    files_modified:    int
    replacements_made: int


class RestoreRequest(BaseModel):
    project_path: str
    snapshot_dir: str         # absolute path returned by the replace endpoint


class RestoreResponse(BaseModel):
    files_restored: int


# ── Pattern builder ───────────────────────────────────────────────────────────

def _build_pattern(query: str, case_sensitive: bool, whole_word: bool) -> re.Pattern:
    """
    Compile the search regex from the user's query and toggle settings.

    We always do a literal (non-regex) search -- the query is escaped before
    being wrapped in optional word-boundary anchors. This keeps the feature
    approachable for fiction writers who are not thinking in regex terms.
    """
    escaped = re.escape(query)
    if whole_word:
        # \b anchors match at a word boundary (transition between \w and \W).
        # This prevents "the" matching "there" or "together".
        escaped = r"\b" + escaped + r"\b"
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(escaped, flags)


# ── File scanner ──────────────────────────────────────────────────────────────

def _scan_project(project_root: Path, pattern: re.Pattern) -> list[FileMatches]:
    """
    Walk the allowed folders and return one FileMatches entry per file that
    has at least one hit. Files are returned sorted by relative path so the
    frontend renders results in a predictable order.
    """
    all_matches: list[FileMatches] = []

    for folder_name in _SEARCH_FOLDERS:
        folder = project_root / folder_name
        if not folder.is_dir():
            continue

        # rglob("*.md") descends into all subfolders -- needed for
        # profiles/characters/, profiles/relationships/, etc.
        for fpath in sorted(folder.rglob("*.md")):
            rel = fpath.relative_to(project_root)

            # Belt-and-suspenders: skip if any ancestor folder is excluded.
            if any(part in _EXCLUDED_PARTS for part in rel.parts):
                continue

            try:
                content = fpath.read_text(encoding="utf-8")
            except OSError:
                continue

            lines = content.splitlines()
            hits: list[MatchHit] = []

            for match in pattern.finditer(content):
                # Determine which line this match starts on (0-based index).
                line_idx = content[: match.start()].count("\n")

                # Column = offset within the line.
                # rfind returns -1 if no '\n' exists before the match (first line),
                # so line_start = 0 in that case, giving the correct column offset.
                line_start = content.rfind("\n", 0, match.start()) + 1
                col = match.start() - line_start

                hits.append(MatchHit(
                    line=line_idx + 1,                              # 1-based for display
                    col=col,
                    match_length=match.end() - match.start(),
                    context_before=(lines[line_idx - 1] if line_idx > 0         else ""),
                    context_match =(lines[line_idx]     if line_idx < len(lines) else ""),
                    context_after =(lines[line_idx + 1] if line_idx + 1 < len(lines) else ""),
                ))

            if hits:
                relpath = str(rel).replace("\\", "/")
                all_matches.append(FileMatches(
                    file_relpath=relpath,
                    count=len(hits),
                    hits=hits,
                ))

    return all_matches


# ── /find endpoint ────────────────────────────────────────────────────────────

@router.post("/find", response_model=FindResponse)
async def find(req: FindRequest) -> FindResponse:
    """
    Scan the project for all occurrences of `query`. Returns grouped results
    (one entry per file) with three lines of context per match.

    A query shorter than 2 characters is rejected -- single-character searches
    produce too many results to be useful and put unnecessary I/O pressure on
    the scan.
    """
    if len(req.query) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters.")

    root = Path(req.project_path)
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"No such project: {req.project_path}")

    pattern = _build_pattern(req.query, req.case_sensitive, req.whole_word)
    matches = _scan_project(root, pattern)
    total = sum(fm.count for fm in matches)
    return FindResponse(matches=matches, total_hits=total)


# ── Selective replacement ─────────────────────────────────────────────────────

def _apply_selected_replacements(
    content: str,
    pattern: re.Pattern,
    replacement: str,
    hit_indices: set[int],
) -> tuple[str, int]:
    """
    Rebuild `content` replacing only the matches whose 0-based index appears
    in `hit_indices`. Matches not in the set are left verbatim.

    Returns (new_content, number_replaced).
    """
    parts: list[str] = []
    last_end = 0
    replaced = 0

    for i, m in enumerate(pattern.finditer(content)):
        # Append everything between the previous match and this one unchanged.
        parts.append(content[last_end : m.start()])

        if i in hit_indices:
            parts.append(replacement)
            replaced += 1
        else:
            # Keep the original match text (preserves case in case-insensitive mode).
            parts.append(m.group(0))

        last_end = m.end()

    # Append the tail after the last match.
    parts.append(content[last_end:])
    return "".join(parts), replaced


# ── Snapshot writer ───────────────────────────────────────────────────────────

def _create_snapshot(
    project_root: Path,
    files_to_snap: list[Path],
    query: str,
    replacement: str,
    case_sensitive: bool,
    whole_word: bool,
) -> Path:
    """
    Copy each file in `files_to_snap` into a timestamped snapshot directory
    and write a manifest. Returns the snapshot directory path.

    Layout:
        <project>/.storythread/snapshots/global-replace/<timestamp>/
            manifest.json
            manuscript/ch01.md   <- verbatim copy of original
            notes/outline.md     <- verbatim copy of original
            ...
    """
    timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    snap_dir = (
        project_root / ".storythread" / "snapshots" / "global-replace" / timestamp
    )
    snap_dir.mkdir(parents=True, exist_ok=True)

    relpaths: list[str] = []
    for fpath in files_to_snap:
        rel = fpath.relative_to(project_root)
        dst = snap_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(fpath, dst)
        relpaths.append(str(rel).replace("\\", "/"))

    manifest = {
        "timestamp": timestamp,
        "query":          query,
        "replacement":    replacement,
        "case_sensitive": case_sensitive,
        "whole_word":     whole_word,
        "files_touched":  relpaths,
    }
    (snap_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    return snap_dir


# ── /replace endpoint ─────────────────────────────────────────────────────────

@router.post("/replace", response_model=ReplaceResponse)
async def replace(req: ReplaceRequest) -> ReplaceResponse:
    """
    Replace selected occurrences of `query` across the project.

    Safety flow (spec-mandated):
      1. Snapshot all files that will be touched (before any writes).
      2. Apply selective replacements per file.
      3. Return the snapshot_dir so the frontend can offer an Undo button.

    `selections` lists only the files and hit indices the user wants changed.
    Files not in `selections` are not touched, even if they contain matches.
    """
    if not req.selections:
        raise HTTPException(status_code=400, detail="No selections provided.")

    root = Path(req.project_path)
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"No such project: {req.project_path}")

    pattern = _build_pattern(req.query, req.case_sensitive, req.whole_word)

    # Resolve absolute paths for each selected file, validating they're inside
    # the project root (prevents path-traversal via crafted file_relpath).
    file_paths: list[tuple[Path, set[int]]] = []
    for sel in req.selections:
        if not sel.hit_indices:
            continue
        fpath = (root / sel.file_relpath).resolve()
        # Security: must stay inside the project root.
        try:
            fpath.relative_to(root.resolve())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Path escapes project root: {sel.file_relpath}",
            )
        if not fpath.is_file():
            continue
        file_paths.append((fpath, set(sel.hit_indices)))

    if not file_paths:
        raise HTTPException(status_code=400, detail="No valid files to modify.")

    # Step 1: snapshot before any writes.
    snap_dir = _create_snapshot(
        root,
        [fp for fp, _ in file_paths],
        req.query,
        req.replacement,
        req.case_sensitive,
        req.whole_word,
    )

    # Step 2: apply replacements.
    files_modified = 0
    replacements_made = 0

    for fpath, hit_indices in file_paths:
        try:
            content = fpath.read_text(encoding="utf-8")
        except OSError:
            continue

        new_content, count = _apply_selected_replacements(
            content, pattern, req.replacement, hit_indices
        )

        if count > 0:
            fpath.write_text(new_content, encoding="utf-8")
            files_modified += 1
            replacements_made += count

    return ReplaceResponse(
        snapshot_dir=str(snap_dir),
        files_modified=files_modified,
        replacements_made=replacements_made,
    )


# ── /restore endpoint ─────────────────────────────────────────────────────────

@router.post("/restore", response_model=RestoreResponse)
async def restore_snapshot(req: RestoreRequest) -> RestoreResponse:
    """
    Undo a replace by restoring all files from the given snapshot directory.

    Reads the snapshot's manifest.json to find which files were touched,
    then copies each snapshot copy back to its original location.

    The snapshot directory is NOT deleted -- it persists as a manual recovery
    point even after the in-modal Undo affordance is gone.
    """
    snap_dir = Path(req.snapshot_dir)
    if not snap_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Snapshot not found: {req.snapshot_dir}")

    manifest_path = snap_dir / "manifest.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=400, detail="Snapshot manifest missing.")

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"Manifest unreadable: {exc}") from exc

    root = Path(req.project_path)
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"No such project: {req.project_path}")

    files_restored = 0
    for relpath in manifest.get("files_touched", []):
        src = snap_dir / relpath
        dst = root / relpath
        if src.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            files_restored += 1

    return RestoreResponse(files_restored=files_restored)
