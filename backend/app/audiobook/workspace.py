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
    # The beat between paragraphs. A paragraph break is a real pause when
    # a person reads aloud, but no TTS engine can be relied on to produce
    # one: some ignore a blank line entirely, and clip-edge trimming then
    # removes even the engine's own trailing breath. Without this, one
    # paragraph lands milliseconds after the last -- which readers hear
    # immediately as wrong, and which forced writers to hand-place a
    # [pause] after every single paragraph (live finding).
    "paragraph_gap_ms": 550,
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
        for key in ("paragraph_gap_ms", "scene_break_ms", "chapter_break_ms"):
            try:
                merged[key] = min(15000, max(0, int(stored.get(key, merged[key]))))
            except (TypeError, ValueError):
                pass
    return merged


# ── The cast (spec 27) ────────────────────────────────────────────────────────
# Every segment has referenced a speaker since Stage B, when the whole
# cast was one entry called Narrator. Stage G makes that structure real:
# a writer can add characters, give each one a voice, and mark their
# lines with [voice:Elena] spans.
#
# Two rules hold the design together:
#
#   A SPEAKER HAS TWO VOICES, ONE PER PASS. This app's whole workflow is
#   "draft locally, print premium", so a book has two narration paths at
#   once: the free local narrator it is drafted with, and the hosted
#   engine it may be printed with. Voice ids do not carry across -- the
#   rosters are different -- so each speaker holds a DRAFT voice (local)
#   and optionally a PRINT voice (that book's hosted engine). Generation
#   picks whichever matches the engine actually running.
#
#   An earlier build stored one voice and decided availability by "is
#   this the book's current engine", which greyed out the entire local
#   roster the moment a hosted engine was chosen -- for a writer whose
#   local voices were the ones they had been using all along (live
#   finding).
#
#   NAMES, NOT IDS. The narration copy says [voice:Elena]; the cast maps
#   Elena to a voice id. Recasting a character is one edit in the cast,
#   not a find-and-replace through the manuscript -- and the narration
#   copy stays readable in any text editor, which is the whole point of
#   the format.

NARRATOR_ID = "narrator"
NARRATOR_NAME = "Narrator"


def _narrator_entry(manifest: dict) -> dict:
    """The cast entry that always exists. Its voice falls back to the
    book's remembered narrator voice, so the voice picker in the rail
    keeps meaning what it has always meant."""
    return {
        "speaker_id": NARRATOR_ID,
        "display_name": NARRATOR_NAME,
        "role": "narrator",
        "voice_id": str(manifest.get("selected_voice") or ""),
        # The book's premium voice has lived in the manifest since Stage
        # D; the narrator simply reads it, so the two places that set it
        # (the Premium panel and the cast) can never disagree.
        "premium_voice_id": str(manifest.get("selected_premium_voice") or ""),
    }


def speakers(manifest: dict) -> list[dict]:
    """The book's cast, narrator first, always at least one entry.

    Tolerant by design: this reads manifests written before the cast
    existed, and hand-edited ones. Anything unusable is dropped rather
    than raising -- a broken cast entry must never make a book
    unopenable.
    """
    stored = manifest.get("speakers")
    cast = [_narrator_entry(manifest)]
    if not isinstance(stored, list):
        return cast
    for raw in stored:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("display_name") or "").strip()
        if not name or name.lower() == NARRATOR_NAME.lower():
            # The narrator is synthesized above; a stored duplicate would
            # give the cast two entries answering to the same name.
            if name.lower() == NARRATOR_NAME.lower():
                if raw.get("voice_id"):
                    cast[0]["voice_id"] = str(raw["voice_id"])
                if raw.get("premium_voice_id"):
                    cast[0]["premium_voice_id"] = str(raw["premium_voice_id"])
            continue
        if any(name.lower() == existing["display_name"].lower() for existing in cast):
            continue                       # first one wins; names are the key
        cast.append({
            "speaker_id": str(raw.get("speaker_id") or "").strip()
                          or f"character-{name.lower().replace(' ', '-')}",
            "display_name": name,
            "role": "character",
            "voice_id": str(raw.get("voice_id") or ""),
            "premium_voice_id": str(raw.get("premium_voice_id") or ""),
        })
    return cast


def voice_for_speaker(name: str, cast: list[dict], default_voice: str,
                      premium: bool = False) -> str:
    """
    The voice id a [voice:NAME] span should narrate in, for the pass that
    is actually running.

    `premium=True` means a hosted engine is generating, so the speaker's
    PRINT voice is used; a speaker who has not been given one falls back
    to the run's default rather than sending a local voice id to a hosted
    engine that has never heard of it.

    An unknown NAME also falls back to the default rather than failing
    the run. A misspelt name in one paragraph must not stop a book from
    generating -- the editor warns about it at save time, which is where
    the writer can actually fix it.
    """
    if name:
        for entry in cast:
            if entry["display_name"].lower() == name.strip().lower():
                chosen = (entry.get("premium_voice_id") if premium
                          else entry.get("voice_id"))
                return str(chosen or "") or default_voice
    return default_voice


def unknown_speaker_warnings(narration_text: str, manifest: dict) -> list[str]:
    """One warning per [voice:NAME] the cast does not contain.

    Surfaced on save, next to the marker warnings, because that is the
    moment the writer can still fix the spelling. Silence here would mean
    discovering it as a stranger's voice mid-chapter.
    """
    from app.audiobook.markers import speaker_names

    known = {entry["display_name"].lower() for entry in speakers(manifest)}
    return [
        f"[voice:{name}] is not in your cast, so those passages will be read "
        f"by the narrator. Add {name} in the Cast panel, or fix the spelling."
        for name in speaker_names(narration_text)
        if name.lower() not in known
    ]


# ── Book metadata (spec 17) ───────────────────────────────────────────────────
# What the exported files SAY about themselves: ID3 tags on the MP3s, the
# M4B's metadata atom, and the embedded cover. Stored under
# manifest["metadata"]; title/author fall back to the manifest's own
# fields so a book exported before ever opening the metadata form still
# tags sensibly.

METADATA_TEXT_FIELDS = [
    "title", "subtitle", "author", "narrator", "series", "series_number",
    "description", "genre", "publication_year", "publisher", "copyright",
    "language",
]

METADATA_OPTION_DEFAULTS = {
    "use_chapter_names": True,       # chapter markers carry real titles
    "embed_cover": True,
    "apply_to_chapter_mp3s": True,   # full tag set on per-chapter files too
}

# Covers: JPG/PNG only, kept under a sane embed size (players choke on
# multi-MB art, and it rides EVERY chapter MP3 when embedding is on).
COVER_MAX_BYTES = 10 * 1024 * 1024
COVER_FILENAMES = {"jpg": "cover.jpg", "png": "cover.png"}


def book_metadata(manifest: dict, workspace_path: str | None = None) -> dict:
    """The manifest's metadata over the fallbacks: every text field (empty
    string when unset), the option flags, and the stored cover file.

    With a workspace_path, empty fields additionally fall back to the
    SOURCE Storythread project's own details (genre, description, series
    name) -- the writer already typed those once; the app should not ask
    twice. Saved metadata always wins over every fallback."""
    stored = manifest.get("metadata")
    stored = stored if isinstance(stored, dict) else {}
    merged: dict = {}
    for field in METADATA_TEXT_FIELDS:
        value = stored.get(field)
        merged[field] = str(value) if value is not None else ""
    if not merged["title"]:
        merged["title"] = manifest.get("title") or ""
    if not merged["author"]:
        merged["author"] = manifest.get("author") or ""
    if not merged["language"]:
        merged["language"] = manifest.get("language") or ""
    if workspace_path:
        for field, value in project_prefill(workspace_path).items():
            if not merged.get(field):
                merged[field] = value
    for key, default in METADATA_OPTION_DEFAULTS.items():
        merged[key] = bool(stored.get(key, default))
    merged["cover_file"] = stored.get("cover_file") or None
    return merged


def source_origin_path(workspace_path: str) -> str | None:
    """Where this audiobook was imported FROM (recorded at import time in
    source/source-metadata.json). None when the record is missing."""
    try:
        with open(os.path.join(workspace_path, "source", "source-metadata.json"),
                  "r", encoding="utf-8") as f:
            origin = json.load(f).get("origin_path")
        return origin if isinstance(origin, str) and origin else None
    except (OSError, json.JSONDecodeError):
        return None


def project_prefill(workspace_path: str) -> dict:
    """
    Metadata fallbacks pulled from the source Storythread PROJECT, when
    the audiobook was imported from one: genre and description from
    project.json, the series name from series.json. (Storythread projects
    do not record author or publication year -- nothing to pull there.)
    Returns {} for file imports or when the project has moved.
    """
    origin = source_origin_path(workspace_path)
    if not origin or not os.path.isdir(origin):
        return {}
    try:
        with open(os.path.join(origin, "project.json"), "r", encoding="utf-8") as f:
            project = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    prefill: dict = {}
    if project.get("genre"):
        prefill["genre"] = str(project["genre"])
    if project.get("description"):
        prefill["description"] = str(project["description"])
    series_path = project.get("series_path")
    if series_path and os.path.isdir(series_path):
        try:
            with open(os.path.join(series_path, "series.json"), "r", encoding="utf-8") as f:
                series = json.load(f)
            if series.get("name"):
                prefill["series"] = str(series["name"])
        except (OSError, json.JSONDecodeError):
            pass
    return prefill


def validate_cover_bytes(data: bytes) -> tuple[str, int, int]:
    """
    Validate cover image bytes: returns (extension, width, height) or
    raises ValueError with a writer-facing message. Dimensions are read
    straight from the file headers -- no imaging library needed for the
    two formats we accept.
    """
    if len(data) > COVER_MAX_BYTES:
        raise ValueError(
            f"Cover image is {len(data) / (1024 * 1024):.1f} MB "
            f"(max {COVER_MAX_BYTES // (1024 * 1024)} MB). Use a smaller file "
            "-- 1400x1400 to 3000x3000 JPG is the audiobook standard."
        )
    # PNG: 8-byte signature, then the IHDR chunk holds width/height.
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        width = int.from_bytes(data[16:20], "big")
        height = int.from_bytes(data[20:24], "big")
        return "png", width, height
    # JPEG: scan segment markers for a SOF (start of frame) header.
    if data[:2] == b"\xff\xd8":
        pos = 2
        while pos + 9 < len(data):
            if data[pos] != 0xFF:
                break
            marker = data[pos + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                pos += 2
                continue
            length = int.from_bytes(data[pos + 2 : pos + 4], "big")
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height = int.from_bytes(data[pos + 5 : pos + 7], "big")
                width = int.from_bytes(data[pos + 7 : pos + 9], "big")
                return "jpg", width, height
            pos += 2 + length
        raise ValueError("This JPG could not be read -- the file may be corrupt.")
    raise ValueError("Cover images must be JPG or PNG.")


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
        # Per-book narration choice. selected_voice is the LOCAL narrator's
        # remembered voice; selected_provider/selected_model/
        # selected_premium_voice are this book's optional override of the
        # global hosted-narration choice (see
        # tts_providers.resolve_narration_selection). Every reader must use
        # .get() -- load_manifest has no migration layer, so older files
        # simply lack the newer keys.
        "selected_provider": None,
        "selected_model": None,
        "selected_voice": None,
        "selected_premium_voice": None,
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

    # A [voice:NAME] the cast does not know reads in the narrator's voice
    # at generation time. Say so HERE, on save, because this is the last
    # moment the writer is looking at the spelling -- the alternative is
    # finding out as a stranger's voice mid-chapter.
    warnings = list(parsed.warnings)
    try:
        warnings.extend(unknown_speaker_warnings(content, load_manifest(workspace_path)))
    except OSError:
        pass                                 # no manifest = nothing to check against

    return {"chapters": chapter_records, "warnings": warnings}


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
