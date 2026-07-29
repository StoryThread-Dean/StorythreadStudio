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
