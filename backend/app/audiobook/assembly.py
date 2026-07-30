# audiobook/assembly.py -- segments become an audiobook (spec 26).
# =================================================================
# The last mile: stitch each chapter's completed segments with real
# silence (pauses, scene/chapter breaks from Narration Settings), master
# it to the ACX-safe loudness targets, and encode the deliverables --
# chapter MP3s, a combined MP3, and an M4B with chapter markers.
#
# Pipeline per chapter (spec 26.1/26.2):
#   segments (WAV) --stdlib stitch--> chapter WAV
#   --ffmpeg loudnorm pass 1 (measure)--> numbers
#   --ffmpeg loudnorm pass 2 (apply, linear)--> mastered WAV @44.1kHz mono
#   --libmp3lame 192k CBR + ID3 tags--> output/chapters/NN - Title.mp3
# Then: combined MP3 = concat of mastered chapters; M4B = AAC 128k with
# an FFMETADATA chapter map derived from the mastered durations.
#
# FFmpeg is an ON-DEMAND component like the kokoro-worker: resolved from
# the app data dir first (installed by the component manager), then PATH
# (dev convenience). LGPL build only -- see the pin below.

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path

import httpx

from app.audiobook import flow, segmenter, workspace
from app.audiobook.wav_assembly import concat_wav

# Where the component manager installs ffmpeg (ffmpeg.exe + ffprobe.exe).
FFMPEG_DIR = Path.home() / ".storythread" / "ffmpeg"

# The pinned LGPL build (BtbN autobuild -- dated tags are immutable, so
# URL + SHA256 stay honest forever). GPL "full" builds are off the table
# per spec 26; this build carries libmp3lame (LGPL), native aac, loudnorm.
FFMPEG_RELEASE = {
    "version": "n8.1.2",
    "url": ("https://github.com/BtbN/FFmpeg-Builds/releases/download/"
            "autobuild-2026-07-29-13-36/"
            "ffmpeg-n8.1.2-31-g8c9502e9b0-win64-lgpl-8.1.zip"),
    "sha256": "dc1caf47ae4fbbf33dcd39d30e7c7af2c63d417e872f0e948b5d68ae5a106794",
    "size_mb": 138.6,
}

# Mastering targets (spec 26.2): inside ACX's -23..-18 dB RMS / -3 dB
# peak window. Applied PER CHAPTER so chapters match each other.
LOUDNORM_I = -20.0
LOUDNORM_TP = -3.0
LOUDNORM_LRA = 11.0

MP3_BITRATE = "192k"        # the ACX spec (26.2)
M4B_BITRATE = "128k"
OUTPUT_RATE = 44100          # distribution rate (26.1)


class AssemblyError(Exception):
    """Anything that stops an export, with a user-facing message."""


class FfmpegUnavailableError(AssemblyError):
    """FFmpeg is not installed yet."""


def resolve_ffmpeg() -> tuple[str, str]:
    """(ffmpeg, ffprobe) paths: app-data install first, PATH second."""
    exe = FFMPEG_DIR / "ffmpeg.exe"
    probe = FFMPEG_DIR / "ffprobe.exe"
    if exe.is_file() and probe.is_file():
        return str(exe), str(probe)
    on_path = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if on_path[0] and on_path[1]:
        return on_path[0], on_path[1]
    raise FfmpegUnavailableError(
        "The audio assembler (FFmpeg) is not installed. Install it from "
        "the export panel."
    )


def _run(args: list[str], error_context: str) -> str:
    """Run an ffmpeg/ffprobe command; return stderr text (ffmpeg's voice).
    Failures raise AssemblyError with the tail of stderr -- enough to
    diagnose without dumping walls of log at the writer."""
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    result = subprocess.run(args, capture_output=True, text=True,
                            encoding="utf-8", errors="replace",
                            creationflags=creationflags)
    if result.returncode != 0:
        tail = (result.stderr or "").strip()[-600:]
        raise AssemblyError(f"{error_context} failed:\n{tail}")
    return result.stderr or ""


# ── Windows-safe file names (spec 8.1) ───────────────────────────────────────

_ILLEGAL_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL",
             *(f"COM{n}" for n in range(1, 10)),
             *(f"LPT{n}" for n in range(1, 10))}


def sanitize_component(name: str, max_len: int = 60) -> str:
    """One title -> one legal Windows path component. Never empty."""
    cleaned = _ILLEGAL_RE.sub("", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    if cleaned.upper() in _RESERVED:
        cleaned = f"{cleaned} audio"
    cleaned = cleaned[:max_len].rstrip(". ")
    return cleaned or "Untitled"


# ── Loudness mastering ────────────────────────────────────────────────────────

def _loudnorm_two_pass(ffmpeg: str, source_wav: str, mastered_wav: str) -> None:
    """EBU R128 two-pass: measure, then apply linearly. Output lands at
    the distribution rate (loudnorm upsamples internally; -ar pins it)."""
    base = f"loudnorm=I={LOUDNORM_I}:TP={LOUDNORM_TP}:LRA={LOUDNORM_LRA}"
    stderr = _run(
        [ffmpeg, "-hide_banner", "-i", source_wav,
         "-af", f"{base}:print_format=json", "-f", "null", os.devnull],
        "Loudness measurement",
    )
    # The measurement JSON is a {...} block somewhere on stderr; its
    # position varies between builds, so find the block that actually
    # carries the numbers instead of trusting the tail.
    measured = None
    for block in re.findall(r"\{[^{}]*\}", stderr):
        if "input_i" in block:
            measured = json.loads(block)
    if measured is None:
        raise AssemblyError("Loudness measurement produced no readable result.")

    applied = (f"{base}"
               f":measured_I={measured['input_i']}"
               f":measured_TP={measured['input_tp']}"
               f":measured_LRA={measured['input_lra']}"
               f":measured_thresh={measured['input_thresh']}"
               f":offset={measured['target_offset']}:linear=true")
    _run(
        [ffmpeg, "-hide_banner", "-y", "-i", source_wav,
         "-af", applied, "-ar", str(OUTPUT_RATE), "-ac", "1",
         mastered_wav],
        "Loudness mastering",
    )


def _duration_seconds(ffprobe: str, path: str) -> float:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True, creationflags=creationflags)
    try:
        return float(result.stdout.strip())
    except ValueError:
        raise AssemblyError(f"Could not read the duration of {Path(path).name}.")


# ── Chapter stitching ─────────────────────────────────────────────────────────

def _stitch_chapter_wav(workspace_path: str, chapter: dict,
                        settings: dict, out_path: str) -> None:
    """One chapter's items -> one WAV: segment audio in order, silence for
    pauses and breaks (durations from Narration Settings, spec 10.3)."""
    pieces: list[bytes | int] = []
    for item in chapter["items"]:
        kind = item.get("kind")
        if kind == "segment":
            audio_path = Path(workspace_path) / item["output_file"]
            with open(audio_path, "rb") as f:
                audio = f.read()
            if item.get("flow_cuts_ms"):
                # Flow segment (mid-paragraph pauses): the audio is one
                # continuous render; split it at the recorded cuts and
                # insert the CURRENT pause durations -- retiming a pause
                # in the narration is honored here without regeneration.
                pieces.extend(flow.split_flow_pieces(
                    audio, item["flow_cuts_ms"], item.get("internal_pauses", [])))
            else:
                pieces.append(audio)
        elif kind == "pause":
            pieces.append(int(item["duration_ms"]))
        elif kind == "scene_break":
            pieces.append(int(settings["scene_break_ms"]))
        elif kind == "chapter_break":
            pieces.append(int(settings["chapter_break_ms"]))
    while pieces and isinstance(pieces[0], int):
        pieces.pop(0)                       # leading silence has no anchor
    with open(out_path, "wb") as f:
        f.write(concat_wav(pieces))


def _chapter_ready(chapter: dict) -> tuple[bool, int]:
    """(all segments completed, segment count) for one chapter."""
    segments = [i for i in chapter["items"] if i.get("kind") == "segment"]
    done = all(s.get("status") == "completed" for s in segments)
    return (done and len(segments) > 0, len(segments))


# ── The public entry point ────────────────────────────────────────────────────

def assemble_book(workspace_path: str, formats: list[str],
                  progress_cb=None) -> dict:
    """
    Export the selected chapters to the requested formats
    ("chapter_mp3", "combined_mp3", "m4b"). Returns
    {"outputs": [relative paths], "chapters": N}.

    Every selected chapter must be fully generated -- assembly never
    invents audio, it only arranges what generation produced.
    """
    ffmpeg, ffprobe = resolve_ffmpeg()
    manifest = workspace.load_manifest(workspace_path)
    settings = workspace.narration_settings(manifest)
    seg_manifest = segmenter.load_segments(workspace_path)
    if seg_manifest is None:
        raise AssemblyError("Nothing to export -- generate the audiobook first.")

    selected = {c["chapter_id"] for c in workspace.list_chapters(workspace_path)
                if c.get("selected_for_generation", True)}
    chapters = [c for c in seg_manifest["chapters"]
                if c["chapter_id"] in selected and
                any(i.get("kind") == "segment" for i in c["items"])]
    if not chapters:
        raise AssemblyError("No selected chapters contain narration segments.")

    not_ready = [c["title"] for c in chapters if not _chapter_ready(c)[0]]
    if not_ready:
        raise AssemblyError(
            "These chapters are not fully generated yet: "
            + ", ".join(not_ready[:5])
            + (" ..." if len(not_ready) > 5 else "")
            + ". Generate the audiobook first."
        )

    # Book metadata (spec 17): the writer's form over manifest fallbacks.
    meta = workspace.book_metadata(manifest)
    book_title = meta["title"] or "Untitled Audiobook"
    author = meta["author"]
    narrator = meta["narrator"] or manifest.get("selected_voice") or ""
    cover_path: Path | None = None
    if meta["embed_cover"] and meta.get("cover_file"):
        candidate = Path(workspace_path) / meta["cover_file"]
        if candidate.is_file():
            cover_path = candidate

    def _shared_tags() -> list[str]:
        """Book-level tag arguments every format shares. Empty fields are
        skipped -- a blank publisher should not write an empty tag."""
        pairs = [
            ("album", book_title), ("artist", author), ("composer", narrator),
            ("album_artist", author), ("genre", meta["genre"] or "Audiobook"),
            ("date", meta["publication_year"]), ("publisher", meta["publisher"]),
            ("copyright", meta["copyright"]), ("language", meta["language"]),
            ("comment", meta["description"]),
        ]
        if meta["series"]:
            number = f" #{meta['series_number']}" if meta["series_number"] else ""
            pairs.append(("grouping", f"{meta['series']}{number}"))
        if meta["subtitle"]:
            pairs.append(("subtitle", meta["subtitle"]))
        args: list[str] = []
        for key, value in pairs:
            if value:
                args += ["-metadata", f"{key}={value}"]
        return args

    def _cover_args(input_count: int) -> list[str]:
        """Extra ffmpeg arguments to embed the cover as attached art.
        `input_count` = how many -i inputs precede the cover input."""
        if cover_path is None:
            return []
        return ["-i", str(cover_path), "-map", "0:a",
                "-map", f"{input_count}:v", "-c:v", "copy",
                "-disposition:v:0", "attached_pic",
                "-metadata:s:v", "title=Album cover",
                "-metadata:s:v", "comment=Cover (front)"]

    output_dir = Path(workspace_path) / "output"
    chapters_dir = output_dir / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)

    outputs: list[str] = []
    width = max(2, len(str(len(chapters))))
    staging = Path(tempfile.mkdtemp(prefix="stw-assembly-"))
    try:
        # 1. Stitch + master every chapter once; every format reuses the
        #    mastered WAVs (re-exporting formats never re-masters).
        mastered: list[tuple[dict, Path]] = []
        for index, chapter in enumerate(chapters, start=1):
            if progress_cb:
                progress_cb("mastering", index, len(chapters), chapter["title"])
            raw = staging / f"raw-{index:03d}.wav"
            done = staging / f"mastered-{index:03d}.wav"
            _stitch_chapter_wav(workspace_path, chapter, settings, str(raw))
            _loudnorm_two_pass(ffmpeg, str(raw), str(done))
            raw.unlink()                     # keep the staging footprint small
            mastered.append((chapter, done))

        # 2. Chapter MP3s: NN - Title.mp3 with ID3 tags (spec 26.4).
        if "chapter_mp3" in formats:
            for index, (chapter, wav) in enumerate(mastered, start=1):
                name = f"{str(index).zfill(width)} - {sanitize_component(chapter['title'])}.mp3"
                target = chapters_dir / name
                chapter_title = (chapter["title"] if meta["use_chapter_names"]
                                 else f"Chapter {index}")
                command = [ffmpeg, "-hide_banner", "-y", "-i", str(wav)]
                if meta["apply_to_chapter_mp3s"]:
                    command += _cover_args(1)
                command += ["-c:a", "libmp3lame", "-b:a", MP3_BITRATE,
                            "-metadata", f"title={chapter_title}",
                            "-metadata", f"track={index}/{len(mastered)}"]
                if meta["apply_to_chapter_mp3s"]:
                    command += _shared_tags()
                else:
                    command += ["-metadata", f"album={book_title}",
                                "-metadata", f"artist={author}"]
                command += ["-id3v2_version", "3", str(target)]
                _run(command, f"Chapter MP3 encode ({chapter['title']})")
                outputs.append(str(target.relative_to(workspace_path)))

        # 3. The concat list both remaining formats share.
        needs_concat = ("combined_mp3" in formats) or ("m4b" in formats)
        if needs_concat:
            concat_list = staging / "concat.txt"
            with open(concat_list, "w", encoding="utf-8") as f:
                for _, wav in mastered:
                    escaped = str(wav).replace("'", "'\\''")
                    f.write(f"file '{escaped}'\n")

        if "combined_mp3" in formats:
            if progress_cb:
                progress_cb("encoding", 1, 1, "combined MP3")
            target = output_dir / f"{sanitize_component(book_title)}.mp3"
            _run(
                [ffmpeg, "-hide_banner", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(concat_list),
                 *_cover_args(1),
                 "-c:a", "libmp3lame", "-b:a", MP3_BITRATE,
                 "-metadata", f"title={book_title}",
                 *_shared_tags(),
                 "-id3v2_version", "3", str(target)],
                "Combined MP3 encode",
            )
            outputs.append(str(target.relative_to(workspace_path)))

        # 4. M4B: AAC in an MP4 container with a chapter map built from
        #    the mastered durations (FFMETADATA, milliseconds timebase).
        if "m4b" in formats:
            if progress_cb:
                progress_cb("encoding", 1, 1, "M4B audiobook")
            metadata_file = staging / "ffmetadata.txt"

            def _ff_escape(value: str) -> str:
                # FFMETADATA treats these as syntax; escape user text.
                for ch in ("\\", "=", ";", "#", "\n"):
                    value = value.replace(ch, f"\\{ch}")
                return value

            lines = [";FFMETADATA1", f"title={_ff_escape(book_title)}"]
            for key, value in (
                ("album", book_title), ("artist", author),
                ("album_artist", author), ("composer", narrator),
                ("genre", meta["genre"] or "Audiobook"),
                ("date", meta["publication_year"]),
                ("publisher", meta["publisher"]),
                ("copyright", meta["copyright"]),
                ("language", meta["language"]),
                ("comment", meta["description"]),
                ("grouping", (f"{meta['series']} #{meta['series_number']}"
                              if meta["series"] and meta["series_number"]
                              else meta["series"])),
                ("subtitle", meta["subtitle"]),
            ):
                if value:
                    lines.append(f"{key}={_ff_escape(value)}")
            position_ms = 0
            for index, (chapter, wav) in enumerate(mastered, start=1):
                duration_ms = int(round(_duration_seconds(ffprobe, str(wav)) * 1000))
                marker = (chapter["title"] if meta["use_chapter_names"]
                          else f"Chapter {index}")
                lines += ["", "[CHAPTER]", "TIMEBASE=1/1000",
                          f"START={position_ms}",
                          f"END={position_ms + duration_ms}",
                          f"title={_ff_escape(marker)}"]
                position_ms += duration_ms
            metadata_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

            target = output_dir / f"{sanitize_component(book_title)}.m4b"
            _run(
                [ffmpeg, "-hide_banner", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(concat_list), "-i", str(metadata_file),
                 *_cover_args(2),
                 "-map_metadata", "1", "-map_chapters", "1",
                 "-c:a", "aac", "-b:a", M4B_BITRATE,
                 "-movflags", "+faststart", str(target)],
                "M4B encode",
            )
            outputs.append(str(target.relative_to(workspace_path)))
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    return {"outputs": [p.replace("\\", "/") for p in outputs],
            "chapters": len(chapters)}


# ── Disk preflight (spec 20.2) ────────────────────────────────────────────────

def preflight_disk(workspace_path: str) -> None:
    """Check free space BEFORE exporting: mastered intermediates plus
    outputs, with a 20 percent margin. Running out mid-export stays a
    handled error; preflight makes it rare."""
    segment_bytes = 0
    seg_dir = Path(workspace_path) / "generated-segments"
    if seg_dir.is_dir():
        for path in seg_dir.rglob("*.wav"):
            segment_bytes += path.stat().st_size
    # Mastered WAVs re-sampled to 44.1k (~1.8x of 24k sources) + encoded
    # outputs; a generous multiplier beats a precise wrong one.
    estimate = int(segment_bytes * 2.5) + 50 * 1024 * 1024
    free = shutil.disk_usage(workspace_path).free
    if free < estimate * 1.2:
        need_gb = estimate * 1.2 / (1 << 30)
        free_gb = free / (1 << 30)
        raise AssemblyError(
            f"This export needs an estimated {need_gb:.1f} GB free on the "
            f"workspace drive and only {free_gb:.1f} GB is available. Free up "
            "space or move the workspace to a larger drive."
        )


# ── Background export runner (one at a time, poll-friendly) ──────────────────

_export_lock = threading.Lock()
_export_thread: threading.Thread | None = None
_export_state = {"state": "idle", "message": None, "progress": 0.0,
                 "error": None, "outputs": [], "workspace_path": None}


def export_status() -> dict:
    with _export_lock:
        return dict(_export_state)


def _set_export(state: str, message: str | None = None,
                progress: float | None = None, error: str | None = None,
                outputs: list | None = None) -> None:
    with _export_lock:
        _export_state["state"] = state
        _export_state["message"] = message
        if progress is not None:
            _export_state["progress"] = round(progress, 3)
        _export_state["error"] = error
        if outputs is not None:
            _export_state["outputs"] = outputs


def start_export(workspace_path: str, formats: list[str]) -> None:
    """Validate everything that can fail FAST (ffmpeg present, formats
    sane, disk space), then assemble on a background thread. Progress is
    polled via export_status()."""
    global _export_thread
    valid = [f for f in formats if f in ("chapter_mp3", "combined_mp3", "m4b")]
    if not valid:
        raise AssemblyError("Pick at least one export format.")
    with _export_lock:
        if _export_thread is not None and _export_thread.is_alive():
            raise RuntimeError("An export is already running.")
    resolve_ffmpeg()                        # FfmpegUnavailableError -> 503
    preflight_disk(workspace_path)

    _set_export("starting", "Preparing export...", 0.0)
    with _export_lock:
        _export_state["workspace_path"] = workspace_path

    def _progress(stage: str, index: int, total: int, label: str) -> None:
        if stage == "mastering":
            # Mastering dominates the wall clock; save the last 15 percent
            # for the encodes so the bar never sits at 100 while working.
            _set_export("running",
                        f"Mastering chapter {index} of {total}: {label}",
                        0.85 * index / max(total, 1))
        else:
            _set_export("running", f"Encoding {label}...", 0.9)

    def _worker() -> None:
        try:
            report = assemble_book(workspace_path, valid, progress_cb=_progress)
            _set_export("done", f"Exported {len(report['outputs'])} file(s).",
                        1.0, outputs=report["outputs"])
        except AssemblyError as e:
            _set_export("error", error=str(e))
        except Exception as e:              # never leave the UI spinning
            _set_export("error", error=f"Export failed unexpectedly: {e}")

    _export_thread = threading.Thread(target=_worker, name="audiobook-export",
                                      daemon=True)
    _export_thread.start()


def wait_for_export(timeout: float = 600.0) -> None:
    """Tests and scripts only -- the UI polls export_status()."""
    thread = _export_thread
    if thread is not None:
        thread.join(timeout)


# ── FFmpeg component manager (same treatment as the kokoro-worker) ───────────

_ffmpeg_install_lock = threading.Lock()
_ffmpeg_install_thread: threading.Thread | None = None
_ffmpeg_install_state = {"state": "idle", "progress": 0.0, "error": None}


def ffmpeg_status() -> dict:
    try:
        resolve_ffmpeg()
        installed = True
    except FfmpegUnavailableError:
        installed = False
    with _ffmpeg_install_lock:
        install = dict(_ffmpeg_install_state)
    return {"installed": installed,
            "version": FFMPEG_RELEASE["version"],
            "download_size_mb": FFMPEG_RELEASE["size_mb"],
            "install": install}


def _set_ffmpeg_install(state: str, progress: float | None = None,
                        error: str | None = None) -> None:
    with _ffmpeg_install_lock:
        _ffmpeg_install_state["state"] = state
        if progress is not None:
            _ffmpeg_install_state["progress"] = round(progress, 3)
        _ffmpeg_install_state["error"] = error


def start_ffmpeg_install(source_zip: str | None = None) -> None:
    """Download (or copy) the pinned LGPL build, verify its SHA256, and
    install ONLY ffmpeg.exe + ffprobe.exe (the zip carries ffplay and
    docs nobody needs)."""
    global _ffmpeg_install_thread
    with _ffmpeg_install_lock:
        if _ffmpeg_install_thread is not None and _ffmpeg_install_thread.is_alive():
            raise RuntimeError("The assembler install is already in progress.")
    _set_ffmpeg_install("starting", 0.0)
    _ffmpeg_install_thread = threading.Thread(
        target=_ffmpeg_install_worker, args=(source_zip,),
        name="ffmpeg-install", daemon=True)
    _ffmpeg_install_thread.start()


def wait_for_ffmpeg_install(timeout: float = 600.0) -> None:
    thread = _ffmpeg_install_thread
    if thread is not None:
        thread.join(timeout)


def _ffmpeg_install_worker(source_zip: str | None) -> None:
    staging = Path(tempfile.mkdtemp(prefix="stw-ffmpeg-install-"))
    try:
        zip_path = staging / "ffmpeg.zip"
        if source_zip is not None:
            _set_ffmpeg_install("verifying", 0.5)
            shutil.copyfile(source_zip, zip_path)
        else:
            _set_ffmpeg_install("downloading", 0.0)
            hasher = hashlib.sha256()
            with httpx.stream("GET", FFMPEG_RELEASE["url"], timeout=60.0,
                              follow_redirects=True) as response:
                response.raise_for_status()
                total = int(response.headers.get("Content-Length", 0)) or None
                done = 0
                with open(zip_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=1 << 20):
                        f.write(chunk)
                        hasher.update(chunk)
                        done += len(chunk)
                        if total:
                            _set_ffmpeg_install("downloading", done / total)
            _set_ffmpeg_install("verifying", 1.0)
            digest = hasher.hexdigest().lower()
            if digest != FFMPEG_RELEASE["sha256"]:
                raise AssemblyError(
                    "The assembler download failed its integrity check. "
                    "Nothing was installed -- try again."
                )

        _set_ffmpeg_install("extracting", 1.0)
        wanted = {"ffmpeg.exe": None, "ffprobe.exe": None}
        with zipfile.ZipFile(zip_path) as archive:
            for member in archive.namelist():
                base = member.rsplit("/", 1)[-1]
                if base in wanted and "/bin/" in member:
                    wanted[base] = member
            missing = [n for n, m in wanted.items() if m is None]
            if missing:
                raise AssemblyError(
                    f"The archive is missing {', '.join(missing)}; refusing to install.")
            FFMPEG_DIR.mkdir(parents=True, exist_ok=True)
            for base, member in wanted.items():
                with archive.open(member) as src, \
                     open(FFMPEG_DIR / base, "wb") as dst:
                    shutil.copyfileobj(src, dst)
        _set_ffmpeg_install("done", 1.0)
    except Exception as e:
        _set_ffmpeg_install("error", error=str(e))
    finally:
        shutil.rmtree(staging, ignore_errors=True)
