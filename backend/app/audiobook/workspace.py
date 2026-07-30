# audiobook/workspace.py -- the audiobook workspace on disk.
# ===========================================================
# Every audiobook lives in its own user-chosen folder, completely separate
# from writing projects (a "second filing cabinet"). This module owns that
# folder's layout, the audiobook-project.json manifest, the text layers,
# and the per-chapter metadata files.
#
#   <workspace>/
#     audiobook-project.json        <- manifest (this module)
#     source/                       <- untouched copy of the original
#     manuscript/
#       extracted-original.md       <- read-only recovery point
#       narration-copy.md           <- THE editable narration text
#       narration-structure.json    <- derived from narration-copy (markers.py)
#       pronunciation-dictionary.json
#     chapters/chapter-001.json ... <- per-chapter metadata (selection, status)
#     generated-segments/  previews/  revisions/  output/chapters/  logs/
#
# Layer rule worth remembering: narration-copy.md is the ONLY file the
# writer edits. extracted-original.md never changes after import (it's the
# "restore from original" source), and narration-structure.json plus the
# chapter files are always derivable from the narration copy.

import json
import os
import uuid
from datetime import datetime, timezone

from app.audiobook.extraction import ExtractionResult
from app.audiobook.markers import parse_narration

SCHEMA_VERSION = 1

# Folders scaffolded at import time. output/chapters nests, so it is listed
# as a relative path, not a name.
WORKSPACE_SUBDIRS = [
    "source",
    "manuscript",
    "chapters",
    "generated-segments",
    "previews",
    "revisions",
    os.path.join("output", "chapters"),
    "logs",
]

MANIFEST_NAME = "audiobook-project.json"

# Book-level narration settings (stored under manifest["narration"]).
# These tame the engine's own pacing instincts globally so [pace] markers
# stay reserved for specific moments: base narrator speed, a separate
# speed for dialogue segments (where engine pace inference is wildest),
# and the silence lengths for scene/chapter breaks.
NARRATION_DEFAULTS = {
    "narrator_pace": 1.0,
    "dialogue_pace": 1.0,
    "scene_break_ms": 2000,
    "chapter_break_ms": 3000,
}


def narration_settings(manifest: dict) -> dict:
    """The manifest's narration settings over the defaults, values coerced
    and clamped so a hand-edited manifest can never produce chipmunk math."""
    merged = dict(NARRATION_DEFAULTS)
    stored = manifest.get("narration")
    if isinstance(stored, dict):
        for key in ("narrator_pace", "dialogue_pace"):
            try:
                merged[key] = min(2.0, max(0.5, float(stored.get(key, merged[key]))))
            except (TypeError, ValueError):
                pass
        for key in ("scene_break_ms", "chapter_break_ms"):
            try:
                merged[key] = min(15000, max(0, int(stored.get(key, merged[key]))))
            except (TypeError, ValueError):
                pass
    return merged


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def manifest_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, MANIFEST_NAME)


def narration_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, "manuscript", "narration-copy.md")


def extracted_original_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, "manuscript", "extracted-original.md")


def structure_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, "manuscript", "narration-structure.json")


def chapters_dir(workspace_path: str) -> str:
    return os.path.join(workspace_path, "chapters")


def is_workspace(path: str) -> bool:
    """A folder is an audiobook workspace iff its manifest exists."""
    return os.path.isfile(manifest_path(path))


def create_workspace_dirs(workspace_path: str) -> None:
    for sub in WORKSPACE_SUBDIRS:
        os.makedirs(os.path.join(workspace_path, sub), exist_ok=True)


def load_manifest(workspace_path: str) -> dict:
    with open(manifest_path(workspace_path), "r", encoding="utf-8") as f:
        return json.load(f)


def save_manifest(workspace_path: str, manifest: dict) -> None:
    manifest["updated_at"] = _now_iso()
    with open(manifest_path(workspace_path), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


def new_manifest(workspace_path: str, title: str, author: str, source_file: str) -> dict:
    """The spec's core project record, with generation fields empty for now."""
    now = _now_iso()
    return {
        "project_id": str(uuid.uuid4()),
        "schema_version": SCHEMA_VERSION,
        "title": title or "Untitled Audiobook",
        "author": author,
        "workspace_path": workspace_path,
        "source_file": source_file,          # relative path inside source/
        "language": "en-US",
        "status": "needs_review",            # fresh imports start at review
        "created_at": now,
        "updated_at": now,
        "selected_provider": None,           # chosen in the Voice step (Stage B+)
        "selected_model": None,
        "selected_voice": None,
        "output_formats": ["chapter_mp3", "combined_mp3", "m4b"],
        "retain_intermediate_audio": True,
    }


# ── Text layers ───────────────────────────────────────────────────────────────

def chapters_to_markdown(result: ExtractionResult) -> str:
    """
    Serialize extracted chapters into the canonical layer format: one '# '
    heading per chapter, bodies separated by blank lines. This exact text
    becomes BOTH extracted-original.md (frozen) and narration-copy.md
    (editable) at import time -- identical twins that drift apart as the
    writer edits the copy.
    """
    parts: list[str] = []
    for chapter in result.chapters:
        parts.append(f"# {chapter.title}")
        if chapter.text:
            parts.append(chapter.text)
    return "\n\n".join(parts) + "\n"


def read_narration(workspace_path: str) -> str:
    with open(narration_path(workspace_path), "r", encoding="utf-8") as f:
        return f.read()


def write_narration(workspace_path: str, content: str) -> dict:
    """
    Save the narration copy, then re-derive everything downstream of it:
    narration-structure.json and the per-chapter metadata files. Returns
    {"chapters": [...], "warnings": [...]} for the UI.

    Chapter metadata survival rule: selection flags carry over by TITLE
    when a chapter with the same title still exists, otherwise the chapter
    is new and defaults to selected. Order and count always come from the
    narration text -- the file is the truth.
    """
    with open(narration_path(workspace_path), "w", encoding="utf-8") as f:
        f.write(content)

    parsed = parse_narration(content)
    with open(structure_path(workspace_path), "w", encoding="utf-8") as f:
        json.dump(parsed.to_structure(), f, indent=2, ensure_ascii=False)

    previous = {c["title"]: c for c in list_chapters(workspace_path)}
    chapter_records = []
    for order, chapter in enumerate(parsed.chapters, start=1):
        old = previous.get(chapter.title, {})
        chapter_records.append({
            "chapter_id": f"chapter-{order:03d}",
            "title": chapter.title,
            "order": order,
            "selected_for_generation": old.get("selected_for_generation", True),
            "status": old.get("status", "ready"),
        })
    _write_chapter_files(workspace_path, chapter_records)

    # Re-derive the generation segments, carrying identity forward: an
    # unchanged paragraph keeps its segment ID and any audio already
    # generated for it (spec 23.1). Local import avoids a module cycle
    # (segmenter imports markers, workspace imports both).
    from app.audiobook import segmenter
    manifest = segmenter.resegment(parsed, segmenter.load_segments(workspace_path))
    segmenter.save_segments(workspace_path, manifest)

    return {"chapters": chapter_records, "warnings": parsed.warnings}


def _write_chapter_files(workspace_path: str, records: list[dict]) -> None:
    """Replace chapters/*.json wholesale -- they are derived data."""
    folder = chapters_dir(workspace_path)
    os.makedirs(folder, exist_ok=True)
    for entry in os.scandir(folder):
        if entry.is_file() and entry.name.endswith(".json"):
            os.remove(entry.path)
    for record in records:
        path = os.path.join(folder, f"{record['chapter_id']}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)


def list_chapters(workspace_path: str) -> list[dict]:
    """All chapter records, ordered. Tolerant of a missing/empty folder."""
    folder = chapters_dir(workspace_path)
    if not os.path.isdir(folder):
        return []
    records: list[dict] = []
    for entry in sorted(os.scandir(folder), key=lambda e: e.name):
        if not (entry.is_file() and entry.name.endswith(".json")):
            continue
        try:
            with open(entry.path, "r", encoding="utf-8") as f:
                records.append(json.load(f))
        except (OSError, json.JSONDecodeError):
            continue                     # one corrupt file never hides the rest
    records.sort(key=lambda r: r.get("order", 0))
    return records
