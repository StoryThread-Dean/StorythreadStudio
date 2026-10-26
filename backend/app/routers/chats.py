# routers/chats.py -- saved conversations
# =========================================
# The HTTP face of app/chat_sessions.py. Five endpoints, deliberately shaped
# like the Weaving run routes the writer has already met:
#
#   GET    /api/chats           -- the picker: summaries, newest first
#   GET    /api/chats/one       -- one session, to reopen it
#   PUT    /api/chats/one       -- save after a turn (create or update)
#   DELETE /api/chats/one       -- throw one away
#   POST   /api/chats/rename    -- give one a better name
#
# NO "resume" ENDPOINT, unlike Weaving. Weaving needs one because a run holds
# deferrals and mutes that a NEW run would silently discard, so "carry on"
# versus "start fresh" is a real decision with a cost. A chat has no such
# hidden state: reopening one is just reading it. Adding a resume route here
# would be a second way to do a GET, and this codebase has been bitten enough
# times by one idea having two vocabularies.
#
# The session BODY is stored opaquely -- `messages` and `setup` are validated
# only for shape, not contents. Same reasoning as ui-state: the keys change
# with every iteration of the panel, the worst case of garbage is a session
# that reopens looking wrong, and a Pydantic model here would be a third copy
# of the frontend's state shape to keep in step.

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.chat_sessions import (
    SURFACES,
    delete_chat,
    list_chats,
    load_chat,
    new_chat,
    save_chat,
)
from app.utils.paths import validate_project_path

router = APIRouter(prefix="/api/chats", tags=["chats"])


class SaveChatRequest(BaseModel):
    project_path: str
    surface:      str
    # Absent on the first save of a conversation: the backend mints the id and
    # hands it back, so the frontend never invents one. An id it made up would
    # either collide or fail the store's format guard.
    chat_id:      str | None = None
    subject:      str = ""
    title:        str = ""
    messages:     list[dict] = []
    setup:        dict = {}


class RenameChatRequest(BaseModel):
    project_path: str
    chat_id:      str
    title:        str


def _surface(value: str) -> str:
    if value not in SURFACES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown chat surface: {value!r}. "
                   f"Expected one of {', '.join(sorted(SURFACES))}.",
        )
    return value


@router.get("")
async def get_chats(project_path: str = Query(...), surface: str = Query("")):
    """
    Summaries for the picker, newest first.

    An empty `surface` means every session in the book. A book with none
    returns an empty list -- that is the ordinary state of every project
    before this shipped, not an error.
    """
    root = validate_project_path(project_path)
    if surface:
        _surface(surface)
    return {"chats": list_chats(root, surface)}


@router.get("/one")
async def get_chat(project_path: str = Query(...), chat_id: str = Query(...)):
    """
    One whole session, to reopen it.

    A 404 covers three different things on purpose -- no such file, a corrupt
    one, and one written by a newer build -- because the caller does the same
    thing in all three cases: offer a new conversation instead. The store
    logs nothing and raises nothing for any of them.
    """
    root = validate_project_path(project_path)
    chat = load_chat(root, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=404,
            detail="That conversation could not be opened. It may have been "
                   "deleted, or saved by a newer version of the app.",
        )
    return chat


@router.put("/one")
async def put_chat(request: SaveChatRequest):
    """
    Save a conversation. Creates it on the first call, updates it after.

    Called after each completed turn. NOT a breach of manual-save-only: that
    rule protects the writer's PROSE from changing underneath them. A reply is
    an artifact they already paid for, and losing it to a crash is the thing
    the rule is trying to prevent, not the thing it permits. POST /api/codex/run
    writes a Weaving session immediately for the same reason.
    """
    root = validate_project_path(request.project_path)
    surface = _surface(request.surface)

    chat = load_chat(root, request.chat_id) if request.chat_id else None
    if chat is None:
        # Either the first save, or an id that no longer resolves. Minting a
        # fresh one beats refusing: the writer's turn already happened and was
        # already paid for, so the worst outcome here is a new row in the list
        # and the best is not losing it.
        chat = new_chat(surface, request.subject)

    chat["surface"] = surface
    if request.subject:
        chat["subject"] = request.subject
    if request.title:
        chat["title"] = request.title
    chat["messages"] = request.messages
    chat["setup"] = request.setup

    save_chat(root, chat)
    # The id and the derived title go back, because on a first save the
    # frontend has neither and needs both to keep writing to the same file.
    return {"chat_id": chat["chat_id"], "title": chat["title"],
            "updated_at": chat["updated_at"]}


@router.delete("/one")
async def remove_chat(project_path: str = Query(...), chat_id: str = Query(...)):
    """
    Throw one away.

    Deleting something that is already gone is a success, not an error: the
    writer wanted it gone and it is gone. `removed` says which happened, for
    a caller that wants to phrase the confirmation differently.
    """
    root = validate_project_path(project_path)
    return {"removed": delete_chat(root, chat_id)}


@router.post("/rename")
async def rename_chat(request: RenameChatRequest):
    """
    Give a session a name the writer will recognise.

    Titles are derived from the first message for free, which is usually good
    enough and occasionally useless ("hmm"). An empty title is refused rather
    than accepted and re-derived, because a row with no name in the picker is
    a row that cannot be chosen.
    """
    root = validate_project_path(request.project_path)
    title = request.title.strip()
    if not title:
        raise HTTPException(status_code=400,
                            detail="A conversation needs a name.")

    chat = load_chat(root, request.chat_id)
    if chat is None:
        raise HTTPException(status_code=404,
                            detail="That conversation could not be opened.")

    chat["title"] = title
    save_chat(root, chat)
    return {"chat_id": chat["chat_id"], "title": chat["title"]}
