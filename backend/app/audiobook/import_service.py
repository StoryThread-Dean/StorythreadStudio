# audiobook/import_service.py -- the import pipeline, end to end.
# ================================================================
# One function does the whole Step 1 flow from the spec:
#
#   1. validate the source and the target workspace folder
#   2. scaffold the workspace folders
#   3. COPY the original into source/ (the outside file is never touched,
#      never locked -- generation always works from this snapshot)
#   4. extract + normalize text into chapters
#   5. write the twin text layers (extracted-original / narration-copy)
#   6. derive narration-structure.json + chapters/*.json
#   7. write the manifest and register the workspace in Recents
#
# Raises ValueError with user-facing messages for every predictable
# problem; the router maps those to HTTP 400s.

import json
import os
import shutil

from app.audiobook import recents_store, workspace
from app.audiobook.extraction import extract_source


def _validate_target_folder(workspace_path: str) -> None:
    """
    The workspace folder must be brand new or empty. Importing into a
    folder that already has files risks clobbering someone's documents --
    refuse loudly instead.
    """
    if os.path.isfile(workspace_path):
        raise ValueError("The workspace location points at a file. Choose a folder.")
    if os.path.isdir(workspace_path) and any(os.scandir(workspace_path)):
        raise ValueError(
            "That folder is not empty. Choose a new or empty folder for the "
            "audiobook workspace."
        )


# ── Where a new audiobook should live (spec 5.1.2) ───────────────────────────
# The writer should not have to invent a folder. Two locked defaults:
#   Storythread book  -> <book folder>/audiobook
#   anything else     -> Documents/Storythread Audiobooks/<Book Title>
# A taken folder suggests "-2" rather than erroring the writer into a
# folder picker. The suggestion is only ever a DEFAULT; the Get Started
# flow still lets them choose.

EXTERNAL_ROOT_NAME = "Storythread Audiobooks"


def is_storythread_project(source_path: str) -> bool:
    """A folder carrying project.json is a Storythread book."""
    return os.path.isdir(source_path) and \
        os.path.isfile(os.path.join(source_path, "project.json"))


def suggest_workspace(source_path: str, title: str = "") -> dict:
    """
    Suggest the workspace folder for a source. Returns
    {"workspace_path", "source_kind", "reason", "collision"} -- reason is
    writer-facing text explaining WHY that location was chosen.
    """
    from app.audiobook.assembly import sanitize_component

    source = os.path.abspath(source_path) if source_path else ""
    if source and is_storythread_project(source):
        base = os.path.join(source, "audiobook")
        source_kind = "storythread-project"
        reason = "Storythread books keep their audiobook beside the book itself."
    else:
        # A file's stem (or a plain folder's name) is the best title guess
        # until the writer types one.
        stem = ""
        if source:
            leaf = os.path.basename(source.rstrip("\\/"))
            stem = os.path.splitext(leaf)[0]
        name = sanitize_component(title.strip() or stem or "Untitled Audiobook")
        base = os.path.join(os.path.expanduser("~"), "Documents",
                            EXTERNAL_ROOT_NAME, name)
        source_kind = "external"
        reason = ("Manuscripts from outside Storythread are collected in "
                  f"Documents/{EXTERNAL_ROOT_NAME}.")

    # Never propose a folder that already holds something -- suggest the
    # next free sibling instead of handing back an error.
    candidate = base
    collision = False
    counter = 2
    while os.path.isdir(candidate) and os.listdir(candidate):
        collision = True
        candidate = f"{base}-{counter}"
        counter += 1
    return {
        "workspace_path": candidate,
        "source_kind": source_kind,
        "reason": reason,
        "collision": collision,
    }


def import_source(source_path: str, workspace_path: str,
                  title_override: str = "") -> dict:
    """
    Import a manuscript into a fresh audiobook workspace.

    Returns {"manifest": ..., "chapters": [...], "warnings": [...]} --
    everything the frontend needs to land on the Review & Edit step.
    """
    if not os.path.exists(source_path):
        raise ValueError("The selected manuscript could not be found on disk.")
    _validate_target_folder(workspace_path)

    # Extraction runs BEFORE any folders are created: an unsupported or
    # unreadable source must not leave a half-built workspace behind.
    result = extract_source(source_path)
    if title_override.strip():
        result.title = title_override.strip()

    workspace.create_workspace_dirs(workspace_path)

    # Copy the original in. A Storythread project folder is not copied
    # wholesale (it can be huge and it is not "a file") -- for projects the
    # snapshot IS the extracted layer, and source/ records where it came from.
    if os.path.isdir(source_path):
        source_rel = ""
        origin_note = source_path
    else:
        source_rel = os.path.join("source", "original-" + os.path.basename(source_path))
        shutil.copy2(source_path, os.path.join(workspace_path, source_rel))
        origin_note = source_path

    with open(os.path.join(workspace_path, "source", "source-metadata.json"),
              "w", encoding="utf-8") as f:
        json.dump({"origin_path": origin_note, "copied_as": source_rel},
                  f, indent=2, ensure_ascii=False)

    # Twin text layers: identical at import, only narration-copy evolves.
    layer_text = workspace.chapters_to_markdown(result)
    with open(workspace.extracted_original_path(workspace_path), "w", encoding="utf-8") as f:
        f.write(layer_text)
    derived = workspace.write_narration(workspace_path, layer_text)

    manifest = workspace.new_manifest(
        workspace_path=workspace_path,
        title=result.title,
        author=result.author,
        source_file=source_rel,
    )
    workspace.save_manifest(workspace_path, manifest)

    recents_store.record_audiobook(
        workspace_path=workspace_path,
        title=manifest["title"],
        author=manifest["author"],
        source_file=source_rel or origin_note,
        status=manifest["status"],
        imported_at=manifest["created_at"],
    )

    return {
        "manifest": manifest,
        "chapters": derived["chapters"],
        "warnings": result.warnings + derived["warnings"],
    }


# ── Adding chapters to an EXISTING audiobook ─────────────────────────────────
# The writer keeps writing after the audiobook exists. Instead of a
# destructive re-import (which would wipe every narration edit), the
# source is re-extracted and chapters whose titles are not in the
# narration copy yet can be appended one by one. Removal needs no
# backend: deleting a chapter's heading+body in the narration editor and
# saving supersedes its segments automatically.

def available_chapters(workspace_path: str) -> dict:
    """
    Chapters in the ORIGINAL source that the narration copy does not have
    (matched by exact title -- a renamed chapter shows as available; the
    writer simply skips it). Raises ValueError when the source is gone.
    """
    origin = workspace.source_origin_path(workspace_path)
    if not origin or not os.path.exists(origin):
        raise ValueError(
            "The original source for this audiobook could not be found "
            "(it may have been moved or deleted)."
        )
    result = extract_source(origin)
    from app.audiobook.markers import split_chapters
    existing = {title for title, _body in
                split_chapters(workspace.read_narration(workspace_path))}
    fresh = [
        {"title": c.title, "characters": len(c.text)}
        for c in result.chapters if c.title not in existing
    ]
    return {"available": fresh, "source": origin, "warnings": result.warnings}


def add_chapters(workspace_path: str, titles: list[str]) -> dict:
    """
    Append the named source chapters to the narration copy (in source
    order) and re-derive structure/chapters/segments. Returns the same
    shape as a narration save so the frontend refreshes in one motion.
    """
    origin = workspace.source_origin_path(workspace_path)
    if not origin or not os.path.exists(origin):
        raise ValueError("The original source for this audiobook could not be found.")
    wanted = [t for t in titles if t.strip()]
    if not wanted:
        raise ValueError("Pick at least one chapter to add.")
    result = extract_source(origin)
    by_title = {c.title: c for c in result.chapters}
    missing = [t for t in wanted if t not in by_title]
    if missing:
        raise ValueError(
            "These chapters were not found in the source: " + ", ".join(missing[:3])
        )

    narration = workspace.read_narration(workspace_path).rstrip("\n")
    parts = [narration] if narration else []
    for title in wanted:                     # keep the writer's picked order
        chapter = by_title[title]
        parts.append(f"# {chapter.title}\n\n{chapter.text.strip()}")
    updated = "\n\n".join(parts) + "\n"
    derived = workspace.write_narration(workspace_path, updated)
    return {"content": updated, "chapters": derived["chapters"],
            "warnings": derived["warnings"]}
