# routers/codex.py -- the Weave's HTTP surface
# =============================================
# Writers see "the Weave"; the code says "codex". Everything below is thin:
# the thinking lives in app/codex/ (anchors, resolution, the type registry,
# migration) and in app/codex_store.py (the index). A router that does real
# work is a router nobody can test without HTTP.
#
# Two rules every route here follows:
#
#   1. Refusals go through CodexError, so the frontend branches on a stable
#      code and the writer reads one sentence they can act on. No route
#      invents its own message shape.
#   2. Reads go through codex_store's freshness gate, so a stale index can
#      never be served as current canon. That check is inside the store
#      functions, not repeated here, so a new route cannot forget it.

import os

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app import codex_store
from app.codex.anchors import AnchorIndex, format_anchor
from app.codex.errors import CodexError
from app.codex.migrate import (
    migration_state,
    plan_migration,
    restore_backup,
    run_migration,
)
from app.codex.resolve import resolve_thread
from app.codex.sections import build_sections
from app.codex.visibility import (
    VISIBLE,
    Lens,
    connection_visibility,
    thread_visibility,
)
from app.codex.threads import parse_thread, render_thread
from app.codex.types_registry import (
    SCHEMA_VERSION,
    TypesError,
    add_type,
    folder_for_type,
    load_registry,
    relation_allows,
    set_type_group,
    type_by_id,
)
from app.db import open_db
from app.utils.paths import safe_child, validate_project_path
from app.utils.structure_store import ensure_chapter_ids, ordered_chapter_filenames

router = APIRouter(prefix="/api/codex", tags=["codex"])


# ── Shared helpers ───────────────────────────────────────────────────────────

def _registry(project_path: str) -> dict:
    """
    The project's type registry, or a refusal the writer can act on.

    An invalid types.json is never repaired or replaced -- it is the writer's
    own data (see types_registry). The message names the offending path so
    they can go and fix that line.
    """
    try:
        registry, _from_file = load_registry(project_path)
    except TypesError as exc:
        raise CodexError(
            "source_corrupt",
            "The Weave's types file could not be read, so it has been left "
            "exactly as it is. Fix the line named below and reopen.",
            str(exc),
        ) from exc
    return registry


def _thread_path(project_path: str, registry: dict, type_id: str, filename: str) -> str:
    folder = folder_for_type(registry, type_id)
    if folder is None:
        raise CodexError("type_invalid", f"There is no '{type_id}' in this world's types.")
    directory = os.path.join(project_path, "codex", folder)
    return safe_child(directory, filename)


async def _locate(project_path: str, entity_id: str) -> dict:
    """The index row for a Thread, or a refusal naming what was asked for."""
    for row in await codex_store.entities(project_path):
        if row["entity_id"] == entity_id:
            return row
    raise CodexError(
        "entity_not_found",
        "That entry is not in the Weave. It may have been deleted or renamed.",
        entity_id,
    )


def _read_thread(project_path: str, registry: dict, row: dict) -> dict:
    path = _thread_path(project_path, registry, row["type"], row["filename"])
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError as exc:
        raise CodexError(
            "source_corrupt",
            "That entry's file could not be read.",
            str(exc),
        ) from exc
    thread = parse_thread(raw, registry)
    thread["filename"] = row["filename"]
    return thread


def _write_thread(project_path: str, registry: dict, thread: dict) -> None:
    path = _thread_path(project_path, registry, thread["type"], thread["filename"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    labels = _label_lookup(project_path)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(render_thread(thread, registry, label_for=labels))
    os.replace(tmp, path)


def _label_lookup(project_path: str):
    """
    Turns ids into names for the human comments beside them in the Markdown.

    Purely cosmetic -- the file is complete and correct without it -- so a
    failure here returns None rather than blocking a save.
    """
    try:
        chapter_ids = ensure_chapter_ids(project_path)
        by_id = {cid: name for name, cid in chapter_ids.items()}
    except Exception:
        by_id = {}

    def label(value: str) -> str | None:
        head = value.split("/", 1)[0]
        return by_id.get(head)

    return label


# ── Registry and health ──────────────────────────────────────────────────────

@router.get("/types")
async def get_types(project_path: str = Query(...)):
    """The type registry: what kinds of thing this world contains, and which
    connections are meaningful between them."""
    project_path = validate_project_path(project_path)
    return _registry(project_path)


@router.get("/health")
async def get_health(project_path: str = Query(...)):
    """
    Is the Weave usable, and is its index current?

    Deliberately does NOT rebuild -- this is the check a UI polls, and a
    status call that quietly does work would make "is it healthy?" expensive.
    """
    project_path = validate_project_path(project_path)
    async with open_db(project_path) as db:
        meta = await codex_store.read_meta(db)

    registry_ok, registry_error = True, ""
    try:
        load_registry(project_path)
    except TypesError as exc:
        registry_ok, registry_error = False, str(exc)

    return {
        "schema_version": SCHEMA_VERSION,
        "migration_state": migration_state(project_path),
        "index_dirty": meta["dirty"]
        or meta["revision"] != codex_store.source_revision(project_path),
        "registry_ok": registry_ok,
        "registry_error": registry_error,
    }


@router.get("/sections")
async def get_sections(project_path: str = Query(...)):
    """
    The sidebar tree: which sections to show, and what can be added.

    One rule decides it -- a section appears when it holds something, or
    when it is a default -- and it is applied in codex/sections.py rather
    than in the frontend, so the answer cannot drift between the nav, the
    Add New menu and anything else that asks.

    Works before conversion too, counting profiles/ and notes/ directly, so
    the new sidebar is populated and useful on a project that has never been
    brought in. Conversion is an offer, not a toll gate.
    """
    project_path = validate_project_path(project_path)
    _registry(project_path)          # refuse early on a broken registry
    return build_sections(project_path, migration_state(project_path) == "done")


class AddTypeRequest(BaseModel):
    project_path: str
    id: str
    label: str = ""
    group: str = "etc"
    icon: str = "CircleDashed"


@router.post("/type")
async def post_type(request: AddTypeRequest):
    """
    Add a kind of Thread the Weave did not ship with.

    A Government, a Deity, a Bloodline. It behaves exactly like a built-in
    kind afterwards -- which is the point of keeping the type registry as
    data rather than as code.
    """
    project_path = validate_project_path(request.project_path)
    try:
        add_type(project_path, request.id, request.label, request.group, request.icon)
    except TypesError as exc:
        raise CodexError(
            "type_invalid",
            "That kind could not be added.",
            str(exc),
        ) from exc
    return build_sections(project_path, migration_state(project_path) == "done")


class MoveTypeRequest(BaseModel):
    project_path: str
    id: str
    group: str


@router.patch("/type/group")
async def patch_type_group(request: MoveTypeRequest):
    """Move a section to a different part of the sidebar. A world where
    Factions belong with the people should be able to say so."""
    project_path = validate_project_path(request.project_path)
    try:
        set_type_group(project_path, request.id, request.group)
    except TypesError as exc:
        raise CodexError("type_invalid", "That section could not be moved.",
                         str(exc)) from exc
    return build_sections(project_path, migration_state(project_path) == "done")


@router.post("/reindex")
async def post_reindex(project_path: str = Query(...)):
    project_path = validate_project_path(project_path)
    _registry(project_path)          # refuse early on a broken registry
    count = await codex_store.reindex(project_path)
    return {"indexed": count}


# ── Anchors ──────────────────────────────────────────────────────────────────

@router.get("/anchors")
async def get_anchors(project_path: str = Query(...)):
    """
    Every point in the story a fact can be pinned to, in reading order.

    Ordinals are not returned: they are computed from the CURRENT order and
    would be stale by the time the frontend used them. The list itself is
    already in order, which is the only thing a caller needs.
    """
    project_path = validate_project_path(project_path)
    ids = ensure_chapter_ids(project_path)
    ordered = ordered_chapter_filenames(project_path)

    from app.routers.documents import _title_from_file
    manuscript = os.path.join(project_path, "manuscript")

    chapters = []
    for name in ordered:
        chapter_id = ids.get(name)
        if not chapter_id:
            continue
        chapters.append({
            "chapter_id": chapter_id,
            "filename": name,
            "title": _title_from_file(os.path.join(manuscript, name), name),
            "anchor": format_anchor(chapter_id),
        })
    return {"chapters": chapters}


# ── Threads ──────────────────────────────────────────────────────────────────

@router.get("/list")
async def list_threads(project_path: str = Query(...), type: str | None = None):
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)
    if type and type_by_id(registry, type) is None:
        raise CodexError("type_invalid", f"There is no '{type}' in this world's types.")
    return {"threads": await codex_store.entities(project_path, type)}


@router.get("/entity")
async def get_entity(project_path: str = Query(...), entity_id: str = Query(...)):
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)
    row = await _locate(project_path, entity_id)
    return _read_thread(project_path, registry, row)


class SaveThreadRequest(BaseModel):
    project_path: str
    thread: dict
    # The revision the editor started from. When it does not match what is on
    # disk, somebody else (or the writer in another window) has saved since --
    # overwriting silently would lose their work.
    base_revision: str | None = None


@router.post("/entity")
async def save_entity(request: SaveThreadRequest):
    project_path = validate_project_path(request.project_path)
    registry = _registry(project_path)
    thread = dict(request.thread or {})

    entity_id = str(thread.get("entity_id") or "").strip()
    if not entity_id:
        raise CodexError("type_invalid", "That entry has no id, so it cannot be saved.")
    if type_by_id(registry, thread.get("type", "")) is None:
        raise CodexError(
            "type_invalid",
            f"'{thread.get('type')}' is not one of this world's types.",
        )
    if not thread.get("filename"):
        raise CodexError("type_invalid", "That entry has no filename, so it cannot be saved.")

    if request.base_revision is not None:
        current = codex_store.source_revision(project_path)
        if current != request.base_revision:
            raise CodexError(
                "version_conflict",
                "This entry changed on disk since you opened it. Reload before "
                "saving so nothing is lost.",
            )

    # An id already used by a DIFFERENT file would silently merge the two in
    # the index.
    for row in await codex_store.entities(project_path):
        if row["entity_id"] == entity_id and row["filename"] != thread["filename"]:
            raise CodexError(
                "duplicate_entity_id",
                "Another entry already uses that id.",
                row["filename"],
            )

    seen: set[str] = set()
    for fact in thread.get("run") or []:
        fid = str(fact.get("id") or "")
        if fid and fid in seen:
            raise CodexError("duplicate_fact_id", "Two facts share an id.", fid)
        seen.add(fid)

    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)
    return {"saved": True, "revision": codex_store.source_revision(project_path)}


@router.delete("/entity")
async def delete_entity(project_path: str = Query(...), entity_id: str = Query(...)):
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)
    row = await _locate(project_path, entity_id)
    path = _thread_path(project_path, registry, row["type"], row["filename"])
    try:
        os.remove(path)
    except OSError as exc:
        raise CodexError("source_corrupt", "That entry could not be deleted.",
                         str(exc)) from exc
    await codex_store.reindex(project_path)
    return {"deleted": entity_id}


# ── Ties ─────────────────────────────────────────────────────────────────────

@router.get("/ties")
async def get_ties(project_path: str = Query(...), entity_id: str = Query(...)):
    """Every Tie touching this Thread, in both directions -- only one
    direction is stored, so incoming edges have to be found too."""
    project_path = validate_project_path(project_path)
    await _locate(project_path, entity_id)
    return {"ties": await codex_store.ties_for(project_path, entity_id)}


class TieRequest(BaseModel):
    project_path: str
    src_id: str
    rel: str
    dst_id: str
    at: str | None = None
    until: str | None = None
    frame: str | None = None
    revealed_at: str | None = None
    ai_scope: str | None = None


@router.post("/tie")
async def post_tie(request: TieRequest):
    project_path = validate_project_path(request.project_path)
    registry = _registry(project_path)

    source = await _locate(project_path, request.src_id)
    target = await _locate(project_path, request.dst_id)

    if request.src_id == request.dst_id:
        raise CodexError("tie_endpoint_invalid", "An entry cannot connect to itself.")

    # The registry decides what is meaningful, not this router -- so a
    # writer's own custom relation works with no code change.
    if not relation_allows(registry, request.rel, source["type"], target["type"]):
        raise CodexError(
            "relation_not_allowed",
            f"'{request.rel}' is not a connection that can run from a "
            f"{source['type']} to a {target['type']} in this world.",
        )

    thread = _read_thread(project_path, registry, source)
    thread.setdefault("ties", []).append({
        "rel": request.rel, "target": request.dst_id, "at": request.at,
        "until": request.until, "frame": request.frame,
        "revealed_at": request.revealed_at, "ai_scope": request.ai_scope,
    })
    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)
    return {"created": True}


@router.delete("/tie")
async def delete_tie(project_path: str = Query(...), src_id: str = Query(...),
                     rel: str = Query(...), dst_id: str = Query(...)):
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)
    source = await _locate(project_path, src_id)

    thread = _read_thread(project_path, registry, source)
    before = len(thread.get("ties") or [])
    thread["ties"] = [
        t for t in (thread.get("ties") or [])
        if not (t.get("rel") == rel and t.get("target") == dst_id)
    ]
    if len(thread["ties"]) == before:
        raise CodexError("tie_endpoint_invalid", "That connection is not recorded.")

    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)
    return {"deleted": True}


# ── Facts ────────────────────────────────────────────────────────────────────

class FactRequest(BaseModel):
    project_path: str
    entity_id: str
    fact: dict


@router.post("/fact")
async def post_fact(request: FactRequest):
    project_path = validate_project_path(request.project_path)
    registry = _registry(project_path)
    row = await _locate(project_path, request.entity_id)
    thread = _read_thread(project_path, registry, row)

    fact = dict(request.fact or {})
    if not fact.get("id"):
        import uuid
        fact["id"] = "f-" + uuid.uuid4().hex[:8]
    if any(f.get("id") == fact["id"] for f in thread.get("run") or []):
        raise CodexError("duplicate_fact_id", "That fact id is already used here.",
                         fact["id"])
    _check_anchor(project_path, fact.get("at"))

    thread.setdefault("run", []).append(fact)
    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)
    return {"created": fact["id"]}


@router.delete("/fact")
async def delete_fact(project_path: str = Query(...), entity_id: str = Query(...),
                      fact_id: str = Query(...)):
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)
    row = await _locate(project_path, entity_id)
    thread = _read_thread(project_path, registry, row)

    remaining = [f for f in (thread.get("run") or []) if f.get("id") != fact_id]
    if len(remaining) == len(thread.get("run") or []):
        raise CodexError("fact_not_found", "That fact is not on this entry.", fact_id)

    thread["run"] = remaining
    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)
    return {"deleted": fact_id}


def _check_anchor(project_path: str, anchor: str | None) -> None:
    """
    Refuse a fact pinned to a chapter that does not exist.

    An unresolvable anchor is allowed to EXIST (the resolver reports those as
    unplaced rather than guessing), but accepting a brand-new one would be
    creating the problem rather than tolerating it.
    """
    if not anchor:
        return
    index = AnchorIndex.for_project(project_path)
    if index.ordinal(anchor) is None:
        raise CodexError(
            "anchor_not_found",
            "That point in the story does not exist. The chapter may have been "
            "deleted.",
            anchor,
        )


# ── Resolution ───────────────────────────────────────────────────────────────

@router.get("/resolve")
async def get_resolve(
    project_path: str = Query(...),
    entity_id: str = Query(...),
    at: str | None = None,
    pov: str | None = None,
    hide_spoilers: bool = True,
    include_on_request: bool = False,
):
    """
    Who this Thread IS at a point in the story. The whole reason for the Weave.

    `at` omitted means the end of the book -- how a writer looking at the
    finished story sees it.
    """
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)
    row = await _locate(project_path, entity_id)
    thread = _read_thread(project_path, registry, row)

    _check_anchor(project_path, at)
    index = AnchorIndex.for_project(project_path)
    resolved = resolve_thread(
        thread, index, at, pov=pov,
        hide_spoilers=hide_spoilers, include_on_request=include_on_request,
    )
    # Ambiguities are dataclasses; the wire wants plain objects, and the
    # writer wants the sentence rather than the field names.
    resolved["ambiguities"] = [
        {"axis": a.axis, "frame": a.frame, "anchor": a.anchor,
         "fact_ids": a.fact_ids, "message": a.describe()}
        for a in resolved["ambiguities"]
    ]
    return resolved


@router.get("/graph")
async def get_graph(
    project_path: str = Query(...),
    at: str | None = None,
    pov: str | None = None,
    hide_spoilers: bool = True,
    include_on_request: bool = False,
):
    """
    Nodes and edges for the map, as of a point in the story.

    Visibility is decided by codex/visibility.py, the same module resolution
    uses -- they used to judge it separately and disagreed, which is how a
    secret connection came to be drawn on a map that was correctly hiding the
    secret behind it.

    An edge asserts three things at once: that both endpoints exist and that
    they are related. So the whole connection is judged together and the
    LEAST visible part governs. A public marriage to a character the reader
    has not met still gives away that the character is coming.

    Ties that are true LATER are returned with active=false rather than
    dropped, so the map can draw them as dashed lines -- the writer is
    looking at their own future book, not a reader's view. That is only for
    things already revealed; a secret is withheld outright.
    """
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)
    index = AnchorIndex.for_project(project_path)
    now = index.ordinal(at) if at else None
    lens = Lens.for_pov(at, pov, hide_spoilers=hide_spoilers,
                        include_on_request=include_on_request)

    # Threads are read in full because visibility needs their anchors: a
    # Thread is "introduced" at the earliest point anything about it happens.
    rows = await codex_store.entities(project_path)
    threads: dict[str, dict] = {}
    for row in rows:
        try:
            threads[row["entity_id"]] = _read_thread(project_path, registry, row)
        except CodexError:
            continue        # an unreadable Thread costs itself, not the map

    nodes = []
    hidden_nodes = 0
    for row in rows:
        thread = threads.get(row["entity_id"])
        if thread is None:
            continue
        if thread_visibility(thread, index, lens) != VISIBLE:
            hidden_nodes += 1
            continue
        nodes.append({"entity_id": row["entity_id"], "type": row["type"],
                      "name": row["name"]})

    visible_ids = {n["entity_id"] for n in nodes}
    edges = []
    hidden_edges = 0
    for entity_id, thread in threads.items():
        for tie in thread.get("ties") or []:
            target_id = tie.get("target") or ""
            target = threads.get(target_id)
            if target is None:
                continue        # points at something that is not there

            if connection_visibility(tie, thread, target, index, lens) != VISIBLE:
                hidden_edges += 1
                continue
            # Belt and braces: an endpoint that did not make the node list
            # must never leave a dangling edge for the map to draw.
            if entity_id not in visible_ids or target_id not in visible_ids:
                hidden_edges += 1
                continue

            started = index.ordinal(tie["at"]) if tie.get("at") else None
            ended = index.ordinal(tie["until"]) if tie.get("until") else None
            expired = ended is not None and now is not None and ended <= now
            not_yet = started is not None and now is not None and started > now

            edges.append({
                "src_id": entity_id, "rel": tie["rel"], "dst_id": target_id,
                "active": not (expired or not_yet),
                "expired": expired,
            })

    # Reported, not silent: a map that quietly omits things looks like a
    # world with less in it than the writer built.
    return {"nodes": nodes, "edges": edges, "as_of": at,
            "hidden_nodes": hidden_nodes, "hidden_edges": hidden_edges}


# ── Migration ────────────────────────────────────────────────────────────────

@router.post("/migrate")
async def post_migrate(project_path: str = Query(...), dry_run: bool = True,
                       resume: bool = False):
    """
    Convert profiles/ into codex/.

    `dry_run` DEFAULTS TO TRUE. The destructive form has to be asked for
    explicitly -- a client that forgets the parameter gets the preview, not
    a rewrite of the writer's files.
    """
    project_path = validate_project_path(project_path)
    if dry_run:
        return plan_migration(project_path)

    result = run_migration(project_path, resume=resume)
    if result.get("status") == "incomplete":
        raise CodexError(
            "migration_incomplete",
            "A previous conversion did not finish. Resume it or restore the "
            "backup before continuing.",
            result.get("journal", ""),
        )
    if result.get("status") == "migrated":
        await codex_store.reindex(project_path)
    return result


@router.post("/migrate/restore")
async def post_restore(project_path: str = Query(...)):
    """Undo an interrupted conversion, putting profiles/ back as it was."""
    project_path = validate_project_path(project_path)
    return restore_backup(project_path)
