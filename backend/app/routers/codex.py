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
import re
import uuid

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app import codex_store
from app.codex.anchors import AnchorIndex, format_anchor
from app.codex.errors import CodexError
from app.codex.migrate import (
    compare_migrated,
    load_report,
    migration_state,
    plan_migration,
    restore_backup,
    run_migration,
)
from app.codex.context import Budget, assemble, estimate_tokens
from app.codex.findings import (
    answer, discard_staged, is_permanent, list_runs, load_book, load_run,
    merge, mute_kind, new_run, open_stops, pin, refresh, remember_choice,
    retire, save_book, save_run, unpin,
)
from app.codex.mentions import alias_display, build_alias_map, find_mentions
from app.codex.resolve import resolve_thread
from app.codex.scan import DEPTH_FULL, ScanRequest, scan
from app.codex.snags import check_ties
from app.codex.sections import (
    build_sections, create_note, delete_note, rename_note,
)
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
    add_relation,
    add_type,
    adopt_relation,
    delete_type,
    folder_for_type,
    hide_type,
    load_registry,
    relation_allows,
    relation_by_id,
    relations_between,
    rename_type,
    shipped_relations_between,
    set_type_group,
    show_type,
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


class ShowTypeRequest(BaseModel):
    project_path: str
    id: str
    show: bool = True


@router.post("/type/show")
async def post_show_type(request: ShowTypeRequest):
    """
    Start (or stop) showing a kind the Weave already knows.

    "+ Add New > Faction" comes here, not to /type. Faction is a kind that
    ships with the app -- picking it is not creating anything, it is asking
    for the section. Sending it to /type would refuse it as a duplicate,
    which is true and useless.
    """
    project_path = validate_project_path(request.project_path)
    try:
        if request.show:
            show_type(project_path, request.id)
        else:
            hide_type(project_path, request.id)
    except TypesError as exc:
        raise CodexError("type_invalid", "That section could not be changed.",
                         str(exc)) from exc
    return build_sections(project_path, migration_state(project_path) == "done")


class AddNoteRequest(BaseModel):
    project_path: str
    label: str


@router.post("/note")
async def post_note(request: AddNoteRequest):
    """
    Add a document of the writer's own under Notes.

    The Notes half of "+ Add New". Profiles and Other add a KIND of entry;
    Notes adds a document -- "Dungeon Rules", "Magic Costs" -- because that
    is what a note is. Same name rules either way, since both become files.
    """
    project_path = validate_project_path(request.project_path)
    try:
        create_note(project_path, request.label)
    except TypesError as exc:
        raise CodexError("type_invalid", "That note could not be added.",
                         str(exc)) from exc
    return build_sections(project_path, migration_state(project_path) == "done")


class RenameSectionRequest(BaseModel):
    project_path: str
    label: str
    # One of these, depending on what is being renamed: a KIND has an id, a
    # NOTE is a file.
    id: str | None = None
    filename: str | None = None


@router.patch("/section")
async def patch_section(request: RenameSectionRequest):
    """
    Fix a section's name. "Magic Sysstem" becomes "Magic System".

    A typo in a name feels permanent in a way it has no right to be, so this
    moves everything with it: the folder, the `type:` line in entries already
    written, or -- for a note -- the file and its heading. Nothing the writer
    wrote changes beyond that.
    """
    project_path = validate_project_path(request.project_path)
    try:
        if request.filename:
            rename_note(project_path, request.filename, request.label)
        elif request.id:
            rename_type(project_path, request.id, request.label)
        else:
            raise TypesError("Nothing was named to rename.", "id")
    except TypesError as exc:
        raise CodexError("type_invalid", "That could not be renamed.",
                         str(exc)) from exc
    return build_sections(project_path, migration_state(project_path) == "done")


@router.delete("/section")
async def delete_section(project_path: str = Query(...),
                         id: str | None = None,
                         filename: str | None = None):
    """
    Remove a section.

    The two halves behave differently because what is at stake differs. A
    KIND holding entries is refused outright with a count -- deleting it
    would take the writer's work with it, and no confirmation makes that a
    good idea. A NOTE is prose, so it moves to notes/trash/ rather than being
    unlinked, and the response says where it went.
    """
    project_path = validate_project_path(project_path)
    try:
        if filename:
            moved = delete_note(project_path, filename)
        elif id:
            delete_type(project_path, id)
            moved = {}
        else:
            raise TypesError("Nothing was named to remove.", "id")
    except TypesError as exc:
        raise CodexError("type_invalid", "That could not be removed.",
                         str(exc)) from exc

    tree = build_sections(project_path, migration_state(project_path) == "done")
    return {**tree, **moved}


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

    # Which act each chapter belongs to. The scrubber draws acts as bands above
    # the track, so it needs the grouping -- and it has to come from the same
    # manifest the sidebar reads, or the two would disagree about the shape of
    # the book.
    from app.utils.structure_store import load_structure
    manifest, _exists = load_structure(project_path)
    act_of: dict[str, dict] = {}
    for position, act in enumerate(manifest.get("acts") or []):
        for filename in act.get("chapters") or []:
            act_of[filename] = {"id": act.get("id", ""),
                                "title": act.get("title", ""),
                                "position": position}

    chapters = []
    for name in ordered:
        chapter_id = ids.get(name)
        if not chapter_id:
            continue
        act = act_of.get(name)
        chapters.append({
            "chapter_id": chapter_id,
            "filename": name,
            "title": _title_from_file(os.path.join(manuscript, name), name),
            "anchor": format_anchor(chapter_id),
            # Empty when the writer has not used acts, which is the ordinary
            # case for a project that never opened the acts tree.
            "act_id": (act or {}).get("id", ""),
            "act_title": (act or {}).get("title", ""),
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
    registry = _registry(project_path)
    rows = await codex_store.ties_for(project_path, entity_id)

    # Names and labels, resolved here rather than in every caller. A tie is
    # stored as three ids, and three ids is not something to show a novelist.
    known = {e["entity_id"]: e for e in await codex_store.entities(project_path)}
    threads = {t.get("entity_id"): t for t in codex_store.load_threads(project_path)}
    label_for = _label_lookup(project_path)

    ties = []
    for row in rows:
        other_id = row["src_id"] if row["incoming"] else row["dst_id"]
        other = threads.get(other_id) or {}
        rel = relation_by_id(registry, row["rel"]) or {}
        ties.append({
            **row,
            "other_id": other_id,
            "other_name": (other.get("display_name")
                           or other.get("name")
                           or known.get(other_id, {}).get("name", "")
                           or other_id),
            "other_type": other.get("type", ""),
            # Read from THIS end. An incoming "mentored by" reads as "mentor
            # of" from the other side, and showing the stored direction would
            # make the writer translate it in their head every time.
            "reads_as": _tie_wording(rel, row["incoming"]),
            "at_label": label_for(row["at"]) if row.get("at") else "",
            "until_label": label_for(row["until"]) if row.get("until") else "",
        })
    return {"ties": ties}


def _tie_wording(rel: dict, incoming: bool) -> str:
    """
    How a connection reads from the end being looked at.

    A symmetric relation reads the same both ways. Otherwise the inverse is
    used when there is one, and a plain "<- label" when there is not -- which
    is honest about not knowing the phrase rather than inventing one.
    """
    label = rel.get("label") or rel.get("id") or ""
    if not incoming or rel.get("symmetric"):
        return label
    inverse = rel.get("inverse")
    if inverse:
        return str(inverse).replace("_", " ")
    return f"{label} (the other way round)"


@router.get("/relations")
async def get_relations(project_path: str = Query(...),
                        src_type: str = Query(...),
                        dst_type: str = Query(...)):
    """
    How these two kinds of thing are allowed to connect.

    Returns THREE lists, because "nothing fits" is three different situations
    and only one of them is a dead end:

      forward   connections that run from src to dst
      reverse   connections that run the other way, so the editor can offer to
                turn the pair around rather than making the writer work out
                that "governed by" is "governs" backwards
      available connections this build ships with that WOULD fit and that this
                world does not have. A project converted before the vocabulary
                grew has none of the newer ones, and types.json is the writer's
                own file which is never silently modified -- so they are
                offered rather than added behind their back.
    """
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)

    def render(rel: dict, flipped: bool = False) -> dict:
        return {
            "id": rel["id"],
            "label": rel.get("label", rel["id"]),
            "symmetric": bool(rel.get("symmetric")),
            "cardinality": rel.get("cardinality", "many"),
            # What the OTHER end reads as, when the registry knows. Shown so a
            # writer can see both halves of what they are recording.
            "inverse_label": (rel.get("inverse") or "").replace("_", " "),
            "flipped": flipped,
        }

    return {
        "forward": [render(r) for r in relations_between(registry, src_type, dst_type)],
        "reverse": [render(r, True) for r in relations_between(registry, dst_type, src_type)],
        "available": [render(r) for r in shipped_relations_between(registry, src_type, dst_type)],
    }


class RelationBody(BaseModel):
    project_path: str
    # Either name one this build ships with...
    adopt: str | None = None
    # ...or describe your own.
    label: str = ""
    source_types: list[str] = []
    target_types: list[str] = []
    symmetric: bool = False
    inverse_label: str = ""


@router.post("/relation")
async def post_relation(body: RelationBody):
    """
    Add a way things can connect: one this app ships with, or the writer's own.

    The shipped vocabulary will always be short of somebody's invented world,
    and a writer who meets "nothing fits" needs somewhere to go other than
    away. The checker reads relations from the registry rather than from code,
    so a connection named here works everywhere with no further change.
    """
    project_path = validate_project_path(body.project_path)
    try:
        if body.adopt:
            registry = adopt_relation(project_path, body.adopt)
            rel_id = body.adopt
        else:
            registry = add_relation(
                project_path, body.label, body.source_types, body.target_types,
                symmetric=body.symmetric, inverse_label=body.inverse_label)
            from app.codex.types_registry import relation_id
            rel_id = relation_id(body.label)
    except TypesError as exc:
        raise CodexError("type_invalid", str(exc), exc.path or "") from exc

    rel = relation_by_id(registry, rel_id) or {}
    return {"id": rel_id, "label": rel.get("label", rel_id)}


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

    # The same connection twice is not a second fact about the world, and it
    # would draw two identical edges and count twice against cardinality.
    for existing in thread.get("ties") or []:
        if existing.get("rel") == request.rel                 and existing.get("target") == request.dst_id:
            raise CodexError(
                "tie_endpoint_invalid",
                "That connection is already recorded.",
                f"{request.src_id} {request.rel} {request.dst_id}",
            )

    thread.setdefault("ties", []).append({
        "rel": request.rel, "target": request.dst_id, "at": request.at,
        "until": request.until, "frame": request.frame,
        "revealed_at": request.revealed_at, "ai_scope": request.ai_scope,
    })
    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)

    # Cardinality and exclusivity are WARNED about, not refused. A relation
    # marked "one at a time" with two live targets is usually a mistake and is
    # sometimes a story -- a disputed throne, a marriage nobody has annulled --
    # and the app is not entitled to decide which. The Snag checker raises it
    # in the walkthrough either way; this just says so at the moment it happens
    # rather than leaving the writer to find out later.
    warnings: list[str] = []
    index = AnchorIndex.for_project(project_path)
    for snag in check_ties(request.src_id, thread["ties"], registry, index,
                           at=request.at, label_for=_label_lookup(project_path)):
        warnings.append(snag.summary)

    return {"created": True, "warnings": warnings}


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
        nodes.append({
            "entity_id": row["entity_id"],
            "type": row["type"],
            "name": row["name"],
            # What the story calls it, when that differs from what it is.
            "display_name": thread.get("display_name") or "",
            # Every word that means this thing. The map shows them on the
            # entry, because "which names are tied to this?" is the question a
            # writer is actually asking when they look at a cluster of dots.
            "aliases": list(thread.get("aliases") or []),
            # A bare dot: an entry Weaving made from a name, with nothing in it
            # yet. Derived, never recorded -- it stops being one the moment the
            # writer puts something in it.
            "placeholder": codex_store.is_placeholder(thread),
        })

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


@router.get("/migrate/report")
async def get_migrate_report(project_path: str = Query(...)):
    """
    The last conversion's account of itself, one row per file.

    Kept on disk rather than only returned once, because "what did that
    actually do?" is a question a writer asks the next day too.
    """
    project_path = validate_project_path(project_path)
    report = load_report(project_path)
    if report is None:
        raise CodexError(
            "report_not_found",
            "There is no conversion report for this project yet.",
            project_path,
        )
    return report


@router.get("/migrate/compare")
async def get_migrate_compare(project_path: str = Query(...),
                              type: str = Query(...),
                              filename: str = Query(...)):
    """
    One profile before and after, field by field.

    The original comes from the BACKUP, which is the copy the conversion
    actually read and which nothing can have edited since.
    """
    project_path = validate_project_path(project_path)
    # The filename arrives over HTTP and is used to build two paths, so it is
    # contained the same way every other file name in this router is.
    safe_child(os.path.join(project_path, "codex"), filename)
    try:
        return compare_migrated(project_path, type, filename)
    except ValueError as exc:
        raise CodexError("type_invalid", str(exc)) from exc
    except OSError as exc:
        raise CodexError(
            "source_corrupt",
            "One side of that comparison could not be read, so it is not "
            "being shown as if it were complete.",
            str(exc),
        ) from exc


@router.post("/migrate/restore")
async def post_restore(project_path: str = Query(...)):
    """Undo an interrupted conversion, putting profiles/ back as it was."""
    project_path = validate_project_path(project_path)
    return restore_backup(project_path)


# ── Weaving: the scan ────────────────────────────────────────────────────────

class ScanBody(BaseModel):
    project_path: str
    depth: str = DEPTH_FULL
    types: list[str] = []
    chapter_ids: list[str] = []
    kinds: list[str] = []
    # Answers carried in from a run, so the scan can leave out what the writer
    # has already retired or muted.
    run_id: str | None = None


@router.post("/scan")
async def post_scan(body: ScanBody):
    """
    Everything findable without asking a model anything.

    NO ROLE, NO MODEL, NO COST. This is the free pass, and it runs before any
    button that spends is offered -- which is what lets the walkthrough tell
    the writer a REAL number ("this found 340 stops") rather than an estimate
    that turns out wrong two hours in.
    """
    project_path = validate_project_path(body.project_path)
    registry = _registry(project_path)
    await codex_store.ensure_fresh(project_path)

    # The book's permanent record is read WHETHER OR NOT a session is open.
    # The setup screen scans before a run exists, and it has to quote the
    # count that is actually left rather than counting things the writer
    # retired months ago.
    run = load_run(project_path, body.run_id) if body.run_id else None
    view = merge(load_book(project_path), run)

    request = ScanRequest(
        depth=body.depth, types=body.types, chapter_ids=body.chapter_ids,
        kinds=body.kinds,
        retired=set(view["retired"]),
        muted_kinds=set(view["muted_kinds"]),
        pinned=list(view["pinned"]),
    )

    threads = codex_store.load_threads(project_path)
    result = scan(project_path, threads, registry, request,
                  label_for=_label_lookup(project_path))

    report = {}
    if run is not None:
        report = refresh(run, result.stops)
        save_run(project_path, run)
        view = merge(load_book(project_path), run)
    stops = open_stops(view, result.stops)

    return {
        "run_id": (run or {}).get("run_id"),
        "stops": [s.as_dict() for s in stops],
        "counts": result.counts,
        # The total BEFORE the writer's answers were applied, so "12 of 340"
        # means something. Reporting only what is left would make a long
        # session look like it had barely started.
        "total": len(result.stops),
        "unreadable": result.unreadable,
        "resumed": report,
    }


def _clean_aliases(aliases: list[str], name: str) -> list[str]:
    """Tidied, de-duplicated, and never repeating the entry's own name."""
    out: list[str] = []
    seen = {name.lower()}
    for alias in aliases or []:
        text = " ".join(str(alias).split())
        if text and text.lower() not in seen:
            seen.add(text.lower())
            out.append(text)
    return out


class NewThreadBody(BaseModel):
    project_path: str
    type: str
    name: str
    # Other words the prose uses for the same thing. Weaving groups a name with
    # its variants before it asks, so creating the entry once settles all of
    # them -- without this the writer would be back to three entries.
    aliases: list[str] = []


@router.post("/thread/new")
async def post_new_thread(body: NewThreadBody):
    """
    Create an empty Thread from a name -- what "Unspun" offers in one click.

    The id and the filename are minted HERE rather than by the caller. They
    are conventions (`e-` plus twelve hex digits; a slugged filename that
    cannot collide), and a second implementation of a convention is a
    convention that drifts. The frontend sends a name and gets back an entry.
    """
    project_path = validate_project_path(body.project_path)
    registry = _registry(project_path)

    name = " ".join(str(body.name or "").split())
    if not name:
        raise CodexError("type_invalid", "An entry needs a name.")
    type_entry = type_by_id(registry, body.type)
    if type_entry is None:
        raise CodexError("type_invalid",
                         f"'{body.type}' is not one of this world's types.")

    folder = os.path.join(project_path, "codex", type_entry["folder"])
    os.makedirs(folder, exist_ok=True)
    stem = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "entry"
    filename = f"{stem}.md"
    # A second Garrick gets garrick-2.md rather than overwriting the first.
    # Silently replacing an existing entry would be the one irreversible
    # thing this button could do.
    n = 2
    while os.path.exists(os.path.join(folder, filename)):
        filename = f"{stem}-{n}.md"
        n += 1

    thread = {
        "type": type_entry["id"],
        "entity_id": "e-" + uuid.uuid4().hex[:12],
        "name": name,
        "filename": filename,
        "status": "active",
        "aliases": _clean_aliases(body.aliases, name),
        "tags": [], "fields": {}, "ties": [], "run": [],
        "sections": {
            section["id"]: {"heading": section["heading"], "content": "",
                            "trait_blocks": [], "ai_summary": ""}
            for section in type_entry.get("sections", [])
        },
    }
    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)
    return {"thread": thread}


class AbsorbBody(BaseModel):
    project_path: str
    # The entry that survives -- the writer's real profile.
    into: str
    # The placeholder whose WORD is being taken. Its name (and any aliases it
    # picked up) become aliases of `into`.
    from_id: str
    # Optionally make the absorbed word the label on the map. "Lexa" over
    # "Alexandra Langford" is the case this exists for.
    as_label: bool = False


@router.post("/absorb")
async def post_absorb(body: AbsorbBody):
    """
    Take a word into an entry that already exists.

    ---------------------------------------------------------------------------
    THIS IS NOT A MERGE, AND THE DIFFERENCE IS THE WHOLE POINT
    ---------------------------------------------------------------------------
    Weaving offers one entry per NAME it finds, so a writer who accepts Lara,
    Croft and Lara Croft ends up with three entries where they meant one
    person. The obvious repair is "merge B into A", and the word merge is
    wrong in a way that matters: to a writer, watching a dot for Alexandra
    Langford disappear reads as their profile being deleted.

    What actually happens is that the WORD moves. "Alexandra Langford",
    "Alexandra", "Langford", "Lexi", "Lexa" and "Drea" all mean her, so they
    become names she answers to -- and every mention of any of them, in the
    manuscript, in other profiles, in relationships and notes, resolves to her
    from then on. The placeholder that was standing in for the word is no
    longer standing in for anything, so it goes. Nothing the writer wrote is
    touched, because a placeholder is by definition a thing with nothing in it.

    WHICH IS ALSO THE REFUSAL. An entry that holds prose, connections or dated
    facts is NOT a placeholder and is never absorbed -- the app does not move
    somebody's writing into another file and delete the original on the
    strength of one click. It says what is in there and stops.
    """
    project_path = validate_project_path(body.project_path)
    registry = _registry(project_path)

    if body.into == body.from_id:
        raise CodexError("type_invalid", "An entry cannot absorb itself.")

    target = _read_thread(project_path, registry,
                          await _locate(project_path, body.into))
    source = _read_thread(project_path, registry,
                          await _locate(project_path, body.from_id))

    if not codex_store.is_placeholder(source):
        raise CodexError(
            "entity_not_empty",
            f"'{source.get('name')}' has writing in it, so its word cannot "
            f"simply be moved. Copy across whatever you want to keep first, "
            f"or connect the two entries with a Tie instead and leave both.",
            source.get("filename", ""),
        )

    # The word, plus anything it had already been told it also means.
    words = [str(source.get("name") or "")] + list(source.get("aliases") or [])
    aliases = list(target.get("aliases") or [])
    known = {a.lower() for a in aliases} | {str(target.get("name") or "").lower()}
    added: list[str] = []
    for word in words:
        word = " ".join(str(word).split())
        if word and word.lower() not in known:
            aliases.append(word)
            known.add(word.lower())
            added.append(word)
    target["aliases"] = aliases

    if body.as_label:
        target["display_name"] = str(source.get("name") or "")

    _write_thread(project_path, registry, target)

    # The placeholder last, so a failure above leaves both entries intact
    # rather than a word recorded nowhere and a file gone.
    path = _thread_path(project_path, registry, source["type"], source["filename"])
    try:
        os.remove(path)
    except OSError as exc:
        raise CodexError(
            "source_corrupt",
            "The word was recorded, but the empty placeholder could not be "
            "removed. It is safe to delete by hand.",
            str(exc),
        ) from exc

    await codex_store.reindex(project_path)
    return {
        "entity_id": target["entity_id"],
        "name": target.get("name", ""),
        "display_name": target.get("display_name", ""),
        "aliases": target["aliases"],
        "absorbed": added,
        "removed_placeholder": source.get("name", ""),
    }


class LabelBody(BaseModel):
    project_path: str
    entity_id: str
    # Empty clears it, which means "go back to using the name".
    display_name: str = ""


@router.patch("/label")
async def patch_label(body: LabelBody):
    """
    What to call an entry on the map, which is not always its name.

    Kept separate from the name because they answer different questions. The
    name is what the thing IS -- the official name on the profile, the one a
    writer would put in a wiki. The label is what the story CALLS it. Renaming
    the entry to Lexa would lose the fact that she is Alexandra Langford; this
    keeps both and lets the map show the one the reader would recognise.
    """
    project_path = validate_project_path(body.project_path)
    registry = _registry(project_path)
    thread = _read_thread(project_path, registry,
                          await _locate(project_path, body.entity_id))

    label = " ".join(str(body.display_name or "").split())
    if label:
        names = {str(thread.get("name") or "").lower()}
        names |= {str(a).lower() for a in (thread.get("aliases") or [])}
        if label.lower() not in names:
            raise CodexError(
                "type_invalid",
                f"'{label}' is not one of the names this entry answers to. "
                f"Add it as a name first, so the map and the text agree.",
                body.entity_id,
            )
    thread["display_name"] = label
    _write_thread(project_path, registry, thread)
    await codex_store.reindex(project_path)
    return {"entity_id": body.entity_id, "display_name": label}


# ── Weaving: the run ledger ──────────────────────────────────────────────────

@router.get("/runs")
async def get_runs(project_path: str = Query(...)):
    """Past sessions, newest first, for "carry on where you left off"."""
    return {"runs": list_runs(validate_project_path(project_path))}


class NewRunBody(BaseModel):
    project_path: str
    depth: str = DEPTH_FULL
    types: list[str] = []
    chapter_ids: list[str] = []


@router.post("/run")
async def post_run(body: NewRunBody):
    """Start a session. Written immediately so a crash cannot lose the fact
    that one was started."""
    project_path = validate_project_path(body.project_path)
    run = new_run(body.depth, types=body.types, chapter_ids=body.chapter_ids)
    save_run(project_path, run)
    return run


@router.get("/run")
async def get_run(project_path: str = Query(...), run_id: str = Query(...)):
    run = load_run(validate_project_path(project_path), run_id)
    if run is None:
        raise CodexError(
            "run_not_found",
            "That Weaving session could not be read. Starting a new one "
            "loses nothing you applied and saved.",
            run_id,
        )
    return run


class AnswerBody(BaseModel):
    project_path: str
    run_id: str
    # One of: a stop answered, a phrase retired, a kind muted, a name settled.
    key: str | None = None
    state: str | None = None
    evidence_hash: str = ""
    retire_phrase: str | None = None
    pin_phrase: str | None = None
    pin_note: str = ""
    pin_where: str = ""
    unpin_phrase: str | None = None
    mute: str | None = None
    unmute: str | None = None
    alias: str | None = None
    entity_id: str | None = None
    # The writer discarded an unsaved buffer; everything staged comes back.
    discard_staged: bool = False


@router.post("/run/answer")
async def post_answer(body: AnswerBody):
    """
    Record what the writer did. One endpoint, because every one of these is
    the same operation -- write a fact about the writer and save the file.

    The two-phase contract lives here: `state: "staged"` means an unsaved
    buffer, `"applied"` means the Thread file was written. A caller that
    reports "applied" before the save has landed breaks the promise that a
    discarded edit comes back as a question.
    """
    project_path = validate_project_path(body.project_path)
    run = load_run(project_path, body.run_id)
    if run is None:
        raise CodexError(
            "run_not_found",
            "That Weaving session could not be read.",
            body.run_id,
        )

    book = load_book(project_path)

    returned = 0
    if body.discard_staged:
        returned = discard_staged(run)
    if body.key and body.state:
        answer(run, body.key, body.state, evidence_hash=body.evidence_hash)
        # Permanence is written to the BOOK, not to the session. "Not a
        # connection" has to mean never again, not "never again until you
        # open Weaving tomorrow".
        if is_permanent(body.state):
            answer(book, body.key, body.state, evidence_hash=body.evidence_hash)
            # A pin that has been dealt with stops being a pin. The answer
            # alone would keep the stop hidden, but the pin list is also a
            # COUNT the writer sees, and a count that only goes up is a count
            # they stop believing.
            if body.key.startswith("pinned|"):
                unpin(book, body.key.split("|", 1)[1])

    # These are all statements about the book rather than about this sitting,
    # so they go in both: the book to be obeyed, the run so the session log
    # says what happened in it.
    if body.pin_phrase:
        pin(book, body.pin_phrase, note=body.pin_note, where=body.pin_where)
    if body.unpin_phrase:
        unpin(book, body.unpin_phrase)

    for target in (run, book):
        if body.retire_phrase:
            retire(target, body.retire_phrase)
        if body.mute:
            mute_kind(target, body.mute)
        if body.unmute:
            mute_kind(target, body.unmute, muted=False)
        if body.alias and body.entity_id:
            remember_choice(target, body.alias, body.entity_id)

    save_run(project_path, run)
    save_book(project_path, book)
    return {"run": run, "book": book, "returned": returned}


class PinBody(BaseModel):
    project_path: str
    phrase: str
    note: str = ""
    # The sentence it came from, so the walkthrough can show the writer where
    # they were when they marked it.
    where: str = ""


@router.post("/pin")
async def post_pin(body: PinBody):
    """
    Mark a phrase from anywhere in the app, with no Weaving session open.

    This is the endpoint behind right-click > Weaving > Mark for Weaving. It
    exists separately from /run/answer because a pin is not an answer to a
    question -- it is the writer ASKING one, from the editor, before any
    walkthrough has started.

    NOTHING IS WRITTEN INTO THE MANUSCRIPT. The mark lives in the Weave's own
    answers file. Decorating a novel with markup to make a feature work is
    asking the writer to write for the app instead of for the reader, and the
    manuscript staying clean prose is a locked product rule.
    """
    project_path = validate_project_path(body.project_path)
    book = load_book(project_path)
    added = pin(book, body.phrase, note=body.note, where=body.where)
    save_book(project_path, book)
    return {"pinned": added, "phrase": body.phrase.strip(),
            "total": len(book.get("pinned") or [])}


@router.get("/pins")
async def get_pins(project_path: str = Query(...)):
    """Everything marked and not yet dealt with, for a count in the sidebar."""
    project_path = validate_project_path(project_path)
    return {"pinned": load_book(project_path).get("pinned") or []}


@router.delete("/pin")
async def delete_pin(project_path: str = Query(...), phrase: str = Query(...)):
    project_path = validate_project_path(project_path)
    book = load_book(project_path)
    unpin(book, phrase)
    save_book(project_path, book)
    return {"pinned": book.get("pinned") or []}


# ── Weaving: the brief ───────────────────────────────────────────────────────

class ContextBody(BaseModel):
    project_path: str
    at: str | None = None
    pov: str | None = None
    text: str = ""
    # Budget inputs. The caller knows its own model and its own prompt; this
    # endpoint refuses to guess at either.
    model_context_limit: int = 32_000
    output_reserve: int = 4_000
    system_prompt_tokens: int = 0
    fixed_request_overhead: int = 0
    pinned_tokens: int = 0
    # The four controls the product rule obliges.
    pinned: list[str] = []
    exclude_ids: list[str] = []
    exclude_types: list[str] = []
    enabled: bool = True
    include_on_request: bool = False


@router.post("/context")
async def post_context(body: ContextBody):
    """
    What WOULD be sent, assembled and handed back.

    THIS ENDPOINT TRANSMITS NOTHING. It builds the brief and returns it, so
    the writer can read it, remove Threads from it, or turn it off. Something
    the writer initiated is what sends it, later and elsewhere. That is the
    product rule, not an implementation detail.
    """
    project_path = validate_project_path(body.project_path)
    await codex_store.ensure_fresh(project_path)
    threads = codex_store.load_threads(project_path)
    index = AnchorIndex.for_project(project_path)

    # Which Threads the text names. Ambiguous mentions are NOT included: a
    # guess here is how the wrong character's beliefs reach the model with
    # nobody able to see it happen.
    mentioned: set[str] = set()
    if body.text:
        alias_map = build_alias_map(threads)
        for mention in find_mentions(body.text, alias_map,
                                     display=alias_display(threads)):
            if mention.bound and mention.entity_id:
                mentioned.add(mention.entity_id)

    budget = Budget(
        model_context_limit=body.model_context_limit,
        output_reserve=body.output_reserve,
        system_prompt_tokens=body.system_prompt_tokens,
        user_text_tokens=estimate_tokens(body.text),
        fixed_request_overhead=body.fixed_request_overhead,
        pinned_tokens=body.pinned_tokens,
    )

    brief = assemble(
        threads, index, at=body.at, budget=budget, pov=body.pov,
        mentioned=mentioned, pinned=set(body.pinned),
        exclude_ids=set(body.exclude_ids),
        exclude_types=set(body.exclude_types),
        enabled=body.enabled, include_on_request=body.include_on_request,
    )
    payload = brief.as_dict()
    payload["mentioned"] = sorted(mentioned)
    return payload
