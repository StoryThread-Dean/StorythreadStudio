# audiobook/storage.py -- what the workspace is using, and what may go.
# =====================================================================
# An audiobook workspace gets big. A novel's worth of segment audio runs
# to gigabytes, and most of it is intermediate: previews nobody will play
# again, rejected takes kept for inspection, and superseded audio left
# behind by edits. Spec 25 says the writer decides what to delete, so
# this module does exactly two things -- MEASURE by category, and DELETE
# the categories asked for.
#
# The whole design rests on one asymmetry: deleting is instant and
# permanent, regenerating costs time and (on a hosted engine) money. So
# every default here leans toward keeping, and the two categories that
# cannot be rebuilt at all -- the finished exports and the original
# manuscript snapshot -- are marked protected and never pre-checked.
#
# What is NEVER touchable from here, at any setting: narration-copy.md
# (the writer's own edits), the manifest, the chapter files, the
# pronunciation dictionary, and segments.json. Those are the workspace's
# identity. Losing segment AUDIO costs a re-render; losing segments.json
# costs the writer their formatting.

import os

from app.audiobook import segmenter, workspace

# ── Retention (spec 25.1) ─────────────────────────────────────────────────────
# What should happen to intermediate audio once a book has exported
# successfully. Per BOOK, not per app: one writer can be mid-revision on
# a novel while archiving a finished novella beside it.
RETENTION_KEEP = "keep"
RETENTION_DELETE = "delete_after_export"
RETENTION_ASK = "ask_after_export"
RETENTION_CHOICES = (RETENTION_KEEP, RETENTION_DELETE, RETENTION_ASK)

# Keeping is the default, deliberately. The alternative -- reclaiming
# gigabytes automatically -- silently destroys the writer's ability to
# fix one paragraph without paying to narrate the book again.
RETENTION_DEFAULT = RETENTION_KEEP


def retention_mode(manifest: dict) -> str:
    """This book's retention choice, tolerating the older boolean field.

    Workspaces created before this setting existed carry
    `retain_intermediate_audio: true`. That means the same thing as
    "keep", so it migrates silently rather than resetting anyone's
    choice.
    """
    stored = manifest.get("intermediate_retention")
    if stored in RETENTION_CHOICES:
        return str(stored)
    if manifest.get("retain_intermediate_audio") is False:
        return RETENTION_DELETE
    return RETENTION_DEFAULT


# ── Category definitions ──────────────────────────────────────────────────────
# Order matters: the dialog lists them in this order, cheapest-to-lose
# first. `default_selected` pre-checks a box; `protected` earns a
# stronger warning and can never be pre-checked.

PREVIEWS = "previews"
FAILED_ATTEMPTS = "failed_attempts"
SUPERSEDED = "superseded"
CURRENT_SEGMENTS = "current_segments"
SOURCE_SNAPSHOTS = "source_snapshots"
EXPORTS = "exports"

CATEGORY_META = {
    PREVIEWS: {
        "label": "Preview files",
        "description": "Voice auditions and the marker help demos. Rebuilt "
                       "free the next time you press play.",
        "consequence": "",
        "default_selected": True,
        "protected": False,
    },
    FAILED_ATTEMPTS: {
        "label": "Failed generation attempts",
        "description": "Takes that came back too short and were kept for "
                       "inspection. Never used in an export.",
        "consequence": "",
        "default_selected": True,
        "protected": False,
    },
    SUPERSEDED: {
        "label": "Superseded audio revisions",
        "description": "Audio for text you have since rewritten. Nothing "
                       "reads it any more.",
        "consequence": "Restoring the old wording would need generating again.",
        "default_selected": False,
        "protected": False,
    },
    CURRENT_SEGMENTS: {
        "label": "Current segment files",
        "description": "The narrated audio your exports are assembled from.",
        "consequence": "You could no longer fix one paragraph, re-export at "
                       "another quality, or reassemble a chapter without "
                       "narrating the book again.",
        "default_selected": False,
        "protected": False,
    },
    SOURCE_SNAPSHOTS: {
        "label": "Extracted manuscript snapshots",
        "description": "The untouched copy of the file you imported, plus "
                       "the first extraction of its text.",
        "consequence": "Restore-from-original would no longer be possible. "
                       "Your narration copy and all your formatting are NOT "
                       "affected.",
        "default_selected": False,
        "protected": True,
    },
    EXPORTS: {
        "label": "Final MP3 and M4B exports",
        "description": "The finished audiobook files.",
        "consequence": "This is the audiobook itself. Copy it somewhere else "
                       "first.",
        "default_selected": False,
        "protected": True,
    },
}

CATEGORY_ORDER = [PREVIEWS, FAILED_ATTEMPTS, SUPERSEDED, CURRENT_SEGMENTS,
                  SOURCE_SNAPSHOTS, EXPORTS]


# ── Measuring ─────────────────────────────────────────────────────────────────

def _file_size(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _walk_files(root: str) -> list[str]:
    """Every file under a folder, or [] if it is missing. Never follows
    outside the folder -- os.walk does not traverse symlinked dirs."""
    found: list[str] = []
    if not os.path.isdir(root):
        return found
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            found.append(os.path.join(dirpath, name))
    return found


def _segment_audio_files(workspace_path: str) -> tuple[list[str], list[str], list[str]]:
    """Split the generated-segments tree into (current, superseded, failed).

    Classification is by what the MANIFEST claims, with the filesystem as
    the tiebreaker:
      - a file named by a live segment's output_file is current,
      - anything ending .rejected is a failed attempt,
      - every other audio file in the tree is orphaned -- which is what
        superseded audio looks like after an edit, since resegment moves
        the record out of the chapter list but leaves the file.

    Doing it by leftovers rather than by the superseded LIST matters:
    files orphaned by an older app version, or by a manifest that lost a
    record, would otherwise be invisible forever and never reclaimable.
    """
    root = os.path.join(workspace_path, "generated-segments")
    manifest = segmenter.load_segments(workspace_path) or {}

    live: set[str] = set()
    for chapter in manifest.get("chapters", []):
        for item in chapter.get("items", []):
            rel = item.get("output_file")
            if rel:
                live.add(os.path.normcase(os.path.join(workspace_path, rel)))

    current: list[str] = []
    superseded: list[str] = []
    failed: list[str] = []
    for path in _walk_files(root):
        # segments.json is the identity record, not audio. Never a
        # deletion candidate under any category.
        if os.path.basename(path).lower() == "segments.json":
            continue
        if path.endswith(".rejected"):
            failed.append(path)
        elif os.path.normcase(path) in live:
            current.append(path)
        else:
            superseded.append(path)
    return current, superseded, failed


def _category_files(workspace_path: str) -> dict[str, list[str]]:
    """Every deletion candidate, grouped by category."""
    current, superseded, failed = _segment_audio_files(workspace_path)

    # Superseded also owns the revisions/ folder, which exists for
    # retained older takes (spec 8 layout).
    superseded = superseded + _walk_files(os.path.join(workspace_path, "revisions"))

    snapshots = _walk_files(os.path.join(workspace_path, "source"))
    original = workspace.extracted_original_path(workspace_path)
    if os.path.isfile(original):
        snapshots = snapshots + [original]

    return {
        PREVIEWS: _walk_files(os.path.join(workspace_path, "previews")),
        FAILED_ATTEMPTS: failed,
        SUPERSEDED: superseded,
        CURRENT_SEGMENTS: current,
        SOURCE_SNAPSHOTS: snapshots,
        EXPORTS: _walk_files(os.path.join(workspace_path, "output")),
    }


def scan(workspace_path: str, manifest: dict | None = None) -> dict:
    """What this workspace is using, by category, plus its export state."""
    grouped = _category_files(workspace_path)
    categories = []
    for key in CATEGORY_ORDER:
        files = grouped[key]
        categories.append({
            "key": key,
            **CATEGORY_META[key],
            "files": len(files),
            "bytes": sum(_file_size(p) for p in files),
        })

    total = sum(c["bytes"] for c in categories)
    has_exports = bool(grouped[EXPORTS])
    has_segments = bool(grouped[CURRENT_SEGMENTS])
    if manifest is None:
        try:
            manifest = workspace.load_manifest(workspace_path)
        except OSError:
            manifest = {}

    return {
        "categories": categories,
        "total_bytes": total,
        # Spec 25.3: exports survive, the material behind them does not.
        "export_only": has_exports and not has_segments,
        "export_only_note": (
            "Individual sections can no longer be regenerated or reassembled "
            "without generating the narration again."
        ),
        "has_exports": has_exports,
        "retention": retention_mode(manifest),
    }


# ── Deleting ──────────────────────────────────────────────────────────────────

def _forget_deleted_audio(workspace_path: str) -> None:
    """Reset segments whose audio file is gone back to 'not generated'.

    Without this the manifest keeps claiming `status: completed` for
    audio that no longer exists, and the writer is told the book is ready
    to export when it cannot be. Only the generated-state fields are
    cleared -- segment_id, text and every formatting field survive, so
    identity (and therefore the writer's markers) is untouched.
    """
    manifest = segmenter.load_segments(workspace_path)
    if not manifest:
        return
    changed = False
    for chapter in manifest.get("chapters", []):
        for item in chapter.get("items", []):
            rel = item.get("output_file")
            if not rel or os.path.isfile(os.path.join(workspace_path, rel)):
                continue
            for field in ("output_file", "generated_hash", "payload_hash",
                          "duration_seconds", "provider", "model",
                          "engine_version", "voice_id", "flow_cuts_ms",
                          "flowed", "draft"):
                item.pop(field, None)
            item["status"] = "pending"
            changed = True
    if changed:
        segmenter.save_segments(workspace_path, manifest)


def cleanup(workspace_path: str, keys: list[str],
            manifest: dict | None = None) -> dict:
    """Delete the named categories. Returns what went, and a fresh scan.

    Unknown keys are refused OUT LOUD rather than ignored: a typo that
    silently deletes nothing would read as success, and the writer would
    believe space was reclaimed. A file that will not delete (locked by a
    player, most likely) is reported rather than swallowed -- the lesson
    from the worker-install bug, where ignore_errors turned a failed
    cleanup into a corrupted install.
    """
    unknown = [k for k in keys if k not in CATEGORY_META]
    if unknown:
        raise ValueError(
            f"Unknown cleanup category: {', '.join(sorted(unknown))}. "
            f"Expected any of: {', '.join(CATEGORY_ORDER)}."
        )

    grouped = _category_files(workspace_path)
    deleted: dict[str, dict] = {}
    problems: list[str] = []
    freed = 0

    for key in CATEGORY_ORDER:
        if key not in keys:
            continue
        count = 0
        bytes_freed = 0
        for path in grouped[key]:
            size = _file_size(path)
            try:
                os.remove(path)
            except OSError as e:
                problems.append(f"{os.path.basename(path)}: {e.strerror or e}")
                continue
            count += 1
            bytes_freed += size
        deleted[key] = {"files": count, "bytes": bytes_freed}
        freed += bytes_freed

    _prune_empty_dirs(workspace_path)
    if CURRENT_SEGMENTS in keys or SUPERSEDED in keys:
        _forget_deleted_audio(workspace_path)

    return {
        "deleted": deleted,
        "freed_bytes": freed,
        "problems": problems,
        "storage": scan(workspace_path, manifest),
    }


def _prune_empty_dirs(workspace_path: str) -> None:
    """Drop per-chapter folders left empty by a delete, then re-scaffold
    the standard tree. The workspace layout is a promise other code
    relies on -- a cleanup must not leave it half-missing."""
    root = os.path.join(workspace_path, "generated-segments")
    if os.path.isdir(root):
        for name in os.listdir(root):
            path = os.path.join(root, name)
            if os.path.isdir(path) and not os.listdir(path):
                try:
                    os.rmdir(path)
                except OSError:
                    pass
    workspace.create_workspace_dirs(workspace_path)
