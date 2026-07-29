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

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.audiobook import (
    generation,
    import_service,
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


# ── Generation ────────────────────────────────────────────────────────────────
# The single-run engine. Start queues pending/failed segments in selected
# chapters; pause/cancel act between segments; status is poll-friendly and
# self-heals interrupted runs to paused (restart recovery).

class StartGenerationRequest(BaseModel):
    workspace_path: str
    provider: str = "local-kokoro"
    voice_id: str


@router.post("/generate")
def start_generation(request: StartGenerationRequest):
    _require_workspace(request.workspace_path)
    try:
        backend = synthesis.resolve_backend(request.provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return generation.start_run(request.workspace_path, backend, request.voice_id)
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
