# routers/audiobook.py -- HTTP endpoints for the Audiobook Converter.
# ====================================================================
# The frontend never reads files directly (house architecture rule), so
# every dashboard/wizard/editor action goes through these endpoints. All
# heavy logic lives in app/audiobook/*; this file is the thin waiter
# between the UI and that kitchen.
#
# Stage A surface:
#   GET  /api/audiobook/recents            dashboard Recent Activity list
#   POST /api/audiobook/recents/remove     forget a workspace (files kept!)
#   POST /api/audiobook/import             manuscript/project -> new workspace
#   GET  /api/audiobook/project            manifest + chapters (touches recents)
#   GET  /api/audiobook/narration          narration copy text
#   PUT  /api/audiobook/narration          save text, re-derive structure
#   GET  /api/audiobook/pronunciations     workspace + global rules
#   PUT  /api/audiobook/pronunciations     replace workspace/global rules

import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.audiobook import (
    assembly,
    generation,
    import_service,
    local_worker,
    locking,
    pronunciation,
    recents_store,
    segmenter,
    synthesis,
    workspace,
)

router = APIRouter(prefix="/api/audiobook", tags=["audiobook"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_workspace(workspace_path: str) -> None:
    """404 with a helpful message when the path is not a workspace."""
    if not workspace.is_workspace(workspace_path):
        raise HTTPException(
            status_code=404,
            detail="No audiobook workspace was found at that location. "
                   "It may have been moved or deleted.",
        )


# ── Recents ───────────────────────────────────────────────────────────────────

@router.get("/recents")
def get_recents():
    return {"audiobooks": recents_store.list_recents()}


class RemoveRecentRequest(BaseModel):
    workspace_path: str


@router.post("/recents/remove")
def remove_recent(request: RemoveRecentRequest):
    # Index row only -- the spec forbids this action from touching files.
    recents_store.remove_recent(request.workspace_path)
    return {"ok": True}


# ── Import ────────────────────────────────────────────────────────────────────

class ImportRequest(BaseModel):
    source_path: str
    workspace_path: str
    title: str = ""          # optional override of the detected title


@router.post("/import")
def import_manuscript(request: ImportRequest):
    try:
        return import_service.import_source(
            source_path=request.source_path,
            workspace_path=request.workspace_path,
            title_override=request.title,
        )
    except ValueError as e:
        # Every predictable import problem arrives as a ValueError with a
        # user-facing message (unsupported format, non-empty folder, ...).
        raise HTTPException(status_code=400, detail=str(e))


# ── Project / chapters ────────────────────────────────────────────────────────

@router.get("/project")
def get_project(workspace_path: str):
    _require_workspace(workspace_path)
    manifest = workspace.load_manifest(workspace_path)
    # Opening a workspace counts as activity; keep the manifest as the
    # source of truth for status and mirror it into the index.
    recents_store.record_audiobook(
        workspace_path=workspace_path,
        title=manifest.get("title", ""),
        author=manifest.get("author", ""),
        source_file=manifest.get("source_file", ""),
        status=manifest.get("status", "needs_review"),
        imported_at=manifest.get("created_at", _now_iso()),
    )
    recents_store.touch_opened(workspace_path, _now_iso())
    return {
        "manifest": manifest,
        "chapters": workspace.list_chapters(workspace_path),
    }


# ── Narration copy ────────────────────────────────────────────────────────────

@router.get("/narration")
def get_narration(workspace_path: str):
    _require_workspace(workspace_path)
    try:
        return {"content": workspace.read_narration(workspace_path)}
    except OSError:
        raise HTTPException(status_code=404, detail="The narration copy file is missing.")


class SaveNarrationRequest(BaseModel):
    workspace_path: str
    content: str


@router.put("/narration")
def save_narration(request: SaveNarrationRequest):
    _require_workspace(request.workspace_path)
    # Manual save only -- the endpoint writes exactly what the editor sent,
    # then reports the re-derived chapter list and any marker warnings.
    result = workspace.write_narration(request.workspace_path, request.content)
    return result


# ── Segments ──────────────────────────────────────────────────────────────────

@router.get("/segments")
def get_segments(workspace_path: str):
    """
    The book-wide segments manifest: what the generation queue will work
    through, chapter by chapter, plus superseded segments awaiting cleanup.
    Derived data -- rebuilt on every narration save.
    """
    _require_workspace(workspace_path)
    manifest = segmenter.load_segments(workspace_path)
    if manifest is None:
        raise HTTPException(
            status_code=404,
            detail="No segments manifest yet. Save the narration once to build it.",
        )
    return manifest


# ── Local narrator engine + voices + preview ─────────────────────────────────

@router.get("/local-engine/status")
def local_engine_status():
    """Installed / running state for the component manager UI, including
    live install progress. Never spawns the worker -- status checks must
    stay instant."""
    return local_worker.installed_state()


class InstallEngineRequest(BaseModel):
    # Local zip override: lets the install flow be exercised before the
    # download is published (and in tests). Absent = published download.
    source_zip: str | None = None


@router.post("/local-engine/install")
def install_local_engine(request: InstallEngineRequest):
    """Download (or copy), SHA256-verify, and install the local narrator.
    Runs in the background; poll /local-engine/status for progress."""
    try:
        local_worker.start_install(request.source_zip)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.post("/local-engine/remove")
def remove_local_engine():
    """Uninstall the packaged engine. Workspaces and generated audio are
    never touched -- this only frees the engine's disk space."""
    local_worker.remove_worker()
    return {"ok": True}


@router.get("/voices")
def get_voices(provider: str = "local-kokoro"):
    """The voice catalog. Spawns the local worker on first call (a few
    seconds while the model loads), then serves from the live process."""
    if provider != "local-kokoro":
        raise HTTPException(status_code=400,
                            detail="Only the local narrator has voices so far.")
    try:
        return {"voices": local_worker.list_voices()}
    except local_worker.WorkerUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


class PreviewRequest(BaseModel):
    text: str
    voice_id: str
    provider: str = "local-kokoro"
    workspace_path: str | None = None    # when set, pronunciation rules apply


@router.post("/preview")
def preview_voice(request: PreviewRequest):
    """A short voice preview. Local previews are free (spec 18); the text
    is capped so a stray full-chapter paste can't stall the worker."""
    text = request.text.strip()[:600]
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to preview.")
    try:
        backend = synthesis.resolve_backend(request.provider)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if request.workspace_path and workspace.is_workspace(request.workspace_path):
        rules = pronunciation.effective_rules(request.workspace_path)
        text = pronunciation.prepare_tts_text(text, rules)
    else:
        text = pronunciation.normalize_for_tts(pronunciation.resolve_say_markers(text))
    try:
        audio, _duration = backend.synthesize(text, request.voice_id)
    except synthesis.SynthesisError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return Response(content=audio, media_type="audio/wav")


class NarrationSettingsRequest(BaseModel):
    workspace_path: str
    narrator_pace: float = Field(ge=0.5, le=2.0)
    dialogue_pace: float = Field(ge=0.5, le=2.0)
    scene_break_ms: int = Field(ge=0, le=15000)
    chapter_break_ms: int = Field(ge=0, le=15000)


@router.get("/narration-settings")
def get_narration_settings(workspace_path: str):
    _require_workspace(workspace_path)
    manifest = workspace.load_manifest(workspace_path)
    return workspace.narration_settings(manifest)


@router.put("/narration-settings")
def save_narration_settings(request: NarrationSettingsRequest):
    """Book-level pacing: narrator/dialogue base speeds and break silence
    lengths. Changing paces marks affected audio stale via the payload
    basis -- the next Generate re-queues exactly what changed."""
    _require_workspace(request.workspace_path)
    manifest = workspace.load_manifest(request.workspace_path)
    manifest["narration"] = {
        "narrator_pace": request.narrator_pace,
        "dialogue_pace": request.dialogue_pace,
        "scene_break_ms": request.scene_break_ms,
        "chapter_break_ms": request.chapter_break_ms,
    }
    workspace.save_manifest(request.workspace_path, manifest)
    return workspace.narration_settings(manifest)


class PreviewSelectionRequest(BaseModel):
    workspace_path: str
    text: str
    voice_id: str
    provider: str = "local-kokoro"


# Enough for a long scene beat (~3 minutes of audio) while keeping the
# wait tolerable on CPU; the writer previews passages, not chapters.
PREVIEW_SELECTION_MAX_CHARS = 3000


@router.post("/preview-selection")
def preview_selection(request: PreviewSelectionRequest):
    """Select text in the narration editor, hear EXACTLY how it will
    sound: markers become real silence, pronunciation rules and [say]
    overrides apply, excluded spans are skipped. Local and free -- this
    is the pacing/pronunciation rehearsal tool (spec 18.1)."""
    _require_workspace(request.workspace_path)
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400,
                            detail="Select a passage in the editor first.")
    if len(text) > PREVIEW_SELECTION_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"That selection is {len(text):,} characters "
                   f"(max {PREVIEW_SELECTION_MAX_CHARS:,} for a preview). "
                   "Select a shorter passage -- full chapters are what "
                   "Generate is for.",
        )
    try:
        backend = synthesis.resolve_backend(request.provider)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))

    from app.audiobook import marker_demos
    rules = pronunciation.effective_rules(request.workspace_path)
    settings = workspace.narration_settings(workspace.load_manifest(request.workspace_path))
    try:
        audio, warnings, trace = marker_demos.render_marked_text(
            text, backend, request.voice_id, rules, settings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except synthesis.SynthesisError as e:
        raise HTTPException(status_code=502, detail=str(e))
    # Headers must be latin-1; URI-encode so any message survives. The
    # frontend decodes and shows these under the player. The trace turns
    # "the pace reverted" into a checkable fact: exact speed per piece.
    from urllib.parse import quote
    headers = {"X-Preview-Trace": quote(json.dumps(trace))}
    if warnings:
        headers["X-Preview-Warnings"] = quote(json.dumps(warnings))
    return Response(content=audio, media_type="audio/wav", headers=headers)


class MarkerDemoRequest(BaseModel):
    kind: str    # pause | scene-break | chapter-break | say | exclude


@router.post("/marker-demo")
def marker_demo(request: MarkerDemoRequest):
    """An audible demo of one marker, rendered through the REAL pipeline
    (synthesis + exact stitched silence) in the default reference voice.
    Powers the narration toolbar's What's-this panel."""
    from app.audiobook import marker_demos
    if request.kind not in marker_demos.DEMO_SCRIPTS:
        raise HTTPException(status_code=400, detail=f"Unknown marker demo '{request.kind}'.")
    try:
        backend = synthesis.resolve_backend("local-kokoro")
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        audio = marker_demos.build_demo(request.kind, backend)
    except synthesis.SynthesisError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return Response(content=audio, media_type="audio/wav")


# ── Generation ────────────────────────────────────────────────────────────────
# The single-run engine. Start queues pending/failed segments in selected
# chapters; pause/cancel act between segments; status is poll-friendly and
# self-heals interrupted runs to paused (restart recovery).

class StartGenerationRequest(BaseModel):
    workspace_path: str
    provider: str = "local-kokoro"
    voice_id: str
    # The explicit "regenerate everything regardless" escape hatch --
    # normal starts already re-queue stale audio automatically.
    force: bool = False


@router.post("/generate")
def start_generation(request: StartGenerationRequest):
    _require_workspace(request.workspace_path)
    try:
        backend = synthesis.resolve_backend(request.provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return generation.start_run(request.workspace_path, backend,
                                    request.voice_id, force=request.force)
    except RuntimeError as e:            # a run is already active
        raise HTTPException(status_code=409, detail=str(e))
    except locking.WorkspaceLockedError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:              # nothing to generate / no segments
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/generation/status")
def generation_status(workspace_path: str):
    _require_workspace(workspace_path)
    run = generation.status_with_recovery(workspace_path)
    if run is None:
        return {"run": None, "active": False}
    return {
        "run": run,
        "active": generation.active_workspace() == workspace_path,
    }


class GenerationControlRequest(BaseModel):
    workspace_path: str


@router.post("/generation/pause")
def pause_generation(request: GenerationControlRequest):
    if generation.active_workspace() != request.workspace_path:
        raise HTTPException(status_code=409, detail="No active generation run for that workspace.")
    generation.request_pause()
    return {"ok": True}


@router.post("/generation/cancel")
def cancel_generation(request: GenerationControlRequest):
    if generation.active_workspace() != request.workspace_path:
        raise HTTPException(status_code=409, detail="No active generation run for that workspace.")
    generation.request_cancel()
    return {"ok": True}


@router.post("/generation/resume")
def resume_generation(request: GenerationControlRequest):
    """Resume = a fresh run over whatever is still pending/failed, reusing
    the paused run's provider and voice. The per-segment persistence means
    nothing already completed is ever redone (or re-billed)."""
    _require_workspace(request.workspace_path)
    run = generation.load_run(request.workspace_path)
    if run is None:
        raise HTTPException(status_code=400, detail="There is no run to resume. Start generation instead.")
    if run.get("status") not in ("paused", "cancelled", "partially_completed"):
        raise HTTPException(status_code=409, detail=f"The last run is {run.get('status')}, not resumable.")
    try:
        backend = synthesis.resolve_backend(run.get("provider", ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return generation.start_run(request.workspace_path, backend, run.get("voice_id", ""))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except locking.WorkspaceLockedError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Export (assembly) ─────────────────────────────────────────────────────────

@router.get("/ffmpeg/status")
def get_ffmpeg_status():
    """Audio assembler (FFmpeg) install state for the export panel."""
    return assembly.ffmpeg_status()


class InstallFfmpegRequest(BaseModel):
    source_zip: str | None = None    # local override for tests/pre-publish


@router.post("/ffmpeg/install")
def install_ffmpeg(request: InstallFfmpegRequest):
    """Download the pinned LGPL FFmpeg build, verify, install ffmpeg +
    ffprobe only. Poll /ffmpeg/status for progress."""
    try:
        assembly.start_ffmpeg_install(request.source_zip)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True}


class StartExportRequest(BaseModel):
    workspace_path: str
    formats: list[str]


@router.post("/assemble")
def start_assemble(request: StartExportRequest):
    """Export the generated audiobook to the chosen formats. Runs in the
    background; poll /assemble/status. Fails fast (before the thread) on
    missing ffmpeg, empty formats, or a disk-space shortfall."""
    _require_workspace(request.workspace_path)
    try:
        assembly.start_export(request.workspace_path, request.formats)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except assembly.FfmpegUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except assembly.AssemblyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.get("/assemble/status")
def assemble_status():
    return assembly.export_status()


# ── Pronunciation rules ───────────────────────────────────────────────────────

class PronunciationEntry(BaseModel):
    display_text: str
    spoken_text: str
    # One-spot overrides are inline [say] markers in the narration text,
    # not dictionary entries -- so only the two file scopes are valid here.
    scope: str = Field(default="audiobook", pattern="^(audiobook|all)$")
    case_sensitive: bool = False


@router.get("/pronunciations")
def get_pronunciations(workspace_path: str):
    _require_workspace(workspace_path)
    return {
        "workspace_rules": [vars(r) for r in pronunciation.load_workspace_rules(workspace_path)],
        "global_rules": [vars(r) for r in pronunciation.load_global_rules()],
    }


class SavePronunciationsRequest(BaseModel):
    workspace_path: str
    workspace_rules: list[PronunciationEntry]
    global_rules: list[PronunciationEntry] | None = None   # omitted = untouched


@router.put("/pronunciations")
def save_pronunciations(request: SavePronunciationsRequest):
    _require_workspace(request.workspace_path)
    pronunciation.save_workspace_rules(
        request.workspace_path,
        [pronunciation.PronunciationRule(**e.model_dump()) for e in request.workspace_rules],
    )
    if request.global_rules is not None:
        pronunciation.save_global_rules(
            [pronunciation.PronunciationRule(**e.model_dump()) for e in request.global_rules],
        )
    return {"ok": True}
