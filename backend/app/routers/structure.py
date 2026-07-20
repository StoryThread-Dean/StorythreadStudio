# routers/structure.py -- Acts & Chapter Order API
# ==================================================
# The HTTP face of manuscript/structure.json (see utils/structure_store.py
# for the manifest rules). Deliberately TWO endpoints:
#
#   GET /api/structure   -- the healed tree, with display titles
#   PUT /api/structure   -- full replacement
#
# No per-operation endpoints (create-act, move-chapter, reorder...): the
# sidebar holds the whole tree in memory anyway, every mutation is
# "adjust the tree, PUT it", and this is a single-user local app -- there
# is no concurrent editor to merge with. Fewer endpoints, one code path,
# and the PUT heals + echoes so the frontend always converges to truth.

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.utils.structure_store import (
    _new_act_id,
    load_structure,
    save_structure,
    _heal,
    _manuscript_files,
)
from app.routers.documents import _title_from_file

router = APIRouter(prefix="/api/structure", tags=["structure"])


# ── Response / request shapes ────────────────────────────────────────────────
# GET decorates each chapter filename with its display title so the sidebar
# needs no second request. PUT accepts bare filename lists -- titles are
# derived data and never stored in the manifest.

class ChapterRef(BaseModel):
    filename: str
    title:    str


class ActOut(BaseModel):
    id:       str
    title:    str
    chapters: list[ChapterRef]


class StructureResponse(BaseModel):
    exists:     bool               # False = synthesized (no file on disk yet)
    acts:       list[ActOut]
    unassigned: list[ChapterRef]


class ActIn(BaseModel):
    id:       str | None = None    # None = new act, server assigns an id
    title:    str
    chapters: list[str] = []


class PutStructureRequest(BaseModel):
    folder_path: str
    acts:        list[ActIn] = []
    unassigned:  list[str] = []


# ── Helpers ──────────────────────────────────────────────────────────────────

def _require_project(folder_path: str) -> None:
    """Same guard as the ui-state endpoints: only real project folders."""
    if not os.path.isfile(os.path.join(folder_path, "project.json")):
        raise HTTPException(status_code=404, detail="Not a project folder (no project.json).")


def _reject_unsafe_filename(name: str) -> None:
    """
    Manifest entries must be BARE filenames inside manuscript/. Anything
    that smells like a path (separators, parent refs) is rejected outright
    -- the manifest must never become a path-traversal vector.
    """
    if ("/" in name) or ("\\" in name) or (".." in name) or not name.endswith(".md"):
        raise HTTPException(status_code=400, detail=f"Invalid chapter filename: {name!r}")


def _decorate(folder_path: str, manifest: dict, exists: bool) -> StructureResponse:
    """Attach display titles (first H1, same rule as the chapter list)."""
    manuscript = os.path.join(folder_path, "manuscript")

    def ref(name: str) -> ChapterRef:
        return ChapterRef(
            filename=name,
            title=_title_from_file(os.path.join(manuscript, name), name),
        )

    return StructureResponse(
        exists=exists,
        acts=[
            ActOut(id=a["id"], title=a["title"], chapters=[ref(n) for n in a["chapters"]])
            for a in manifest["acts"]
        ],
        unassigned=[ref(n) for n in manifest["unassigned"]],
    )


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=StructureResponse)
async def get_structure(folder_path: str):
    """
    The project's act/chapter tree. Projects that never used acts get a
    synthesized view (everything unassigned, filename order) and NO file is
    written -- opening an old project must not touch its bytes.
    """
    _require_project(folder_path)
    manifest, exists = load_structure(folder_path)
    return _decorate(folder_path, manifest, exists)


@router.put("", response_model=StructureResponse)
async def put_structure(request: PutStructureRequest):
    """
    Replace the whole manifest (act CRUD, moves, and reorders are all just
    'client adjusts the tree and PUTs'). The payload is validated, healed
    against the real directory, persisted, and echoed back -- the frontend
    should adopt the echoed tree as its new state.
    """
    _require_project(request.folder_path)

    # Validate every referenced filename before touching disk.
    for act in request.acts:
        for name in act.chapters:
            _reject_unsafe_filename(name)
    for name in request.unassigned:
        _reject_unsafe_filename(name)

    candidate = {
        "acts": [
            {
                "id": act.id or _new_act_id(),
                "title": act.title.strip() or "Untitled Act",
                "chapters": list(act.chapters),
            }
            for act in request.acts
        ],
        "unassigned": list(request.unassigned),
    }

    # Heal instead of 400 on stale filenames: the writer may have deleted a
    # file in Explorer mid-drag. Dropping ghosts and appending unknowns is
    # friendlier than failing the save, and the echo shows the truth.
    healed, _ = _heal(candidate, _manuscript_files(request.folder_path))
    save_structure(request.folder_path, healed)
    return _decorate(request.folder_path, healed, True)
