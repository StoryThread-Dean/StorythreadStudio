"""
chat_sessions.py -- conversations the writer can come back to.

Until now both chats were `useState` arrays and nothing else. Close the app and
every reply the writer had paid for was gone, along with the setup that
produced it: which profiles were attached, whether the chapter had been sent,
where one ask ended and the next began.

---------------------------------------------------------------------------
WHY THIS IS NOT IN app.db
---------------------------------------------------------------------------
The same argument `codex/findings.py` makes, and it is worth restating rather
than cross-referencing, because the temptation to add a `chat_session` table is
obvious and the rule against it is one line in another file.

app.db is documented -- correctly, everywhere -- as a rebuildable cache: delete
it and the next connection rebuilds an empty one, and nothing is lost. A
transcript is the opposite. It was paid for in tokens, it is not derivable from
the Markdown, and no amount of reindexing brings it back. Those two contracts
cannot both hold for one file.

So sessions live beside the Weaving ledger, under `.storythread/`, written
atomically through `replace_atomic` -- which RETRIES, because on Windows a
rename fails while a scanner or a sync client holds the file for a moment.

---------------------------------------------------------------------------
WHAT A SESSION HOLDS, AND THE ONE THING IT DELIBERATELY DOES NOT
---------------------------------------------------------------------------
`messages` is the transcript, and it includes the hidden materials turns -- the
blocks the backend echoes back so the frontend can keep the model's view of the
conversation intact.

Those are stored as a DESCRIPTOR rather than their text, and that single
decision solves two unrelated problems at once:

  SIZE.       One materials block can carry a 100,000-character chapter plus a
              60,000-character world brief. Stored verbatim, a long session
              would be megabytes of duplicated manuscript on disk.
  STALENESS.  It is a SNAPSHOT. Resuming a four-day-old session would hand the
              model a chapter as it stood four days ago and present it as
              current -- the writer's own prose, quietly out of date, with
              nothing on screen to say so.

So the descriptor records what WAS sent (which chips, which chapter, roughly
how big the brief was) for the writer to read, and on resume the materials are
rebuilt from today's files. See `describe_materials`.
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

from app.utils.atomic import replace_atomic

__all__ = [
    "SCHEMA_VERSION", "SURFACES", "SURFACE_COMPANION", "SURFACE_PROFILE",
    "chat_dir", "delete_chat", "describe_materials", "derive_title",
    "list_chats", "load_chat", "new_chat", "save_chat",
]

SCHEMA_VERSION = 1

# Which chat a session belongs to. Kept as a field rather than as two folders
# so "every session in this book, newest first" stays one listing -- the writer
# thinks in terms of when they had the conversation, not which panel it was in.
SURFACE_COMPANION = "companion"     # the Writing Companion, beside the editor
SURFACE_PROFILE = "profile"         # the Profile Builder's chat
SURFACES = frozenset({SURFACE_COMPANION, SURFACE_PROFILE})

_CHAT_ID_RE = re.compile(r"^chat-[0-9a-f]{12}$")

# Long enough to recognise a conversation, short enough for a list. Titles are
# derived from the writer's first message, which is often a paragraph.
_TITLE_MAX = 60


# ── Where it lives ───────────────────────────────────────────────────────────

def chat_dir(project_path: str) -> str:
    return os.path.join(project_path, ".storythread", "chats")


def _chat_path(project_path: str, chat_id: str) -> str:
    """
    The file for one session.

    The id is validated rather than trusted: it arrives over HTTP, and a
    chat_id of "../../project.json" would otherwise be a path traversal
    dressed up as a session identifier. Straight from findings.py, which
    learned this the same way everyone does.
    """
    if not _CHAT_ID_RE.match(chat_id or ""):
        raise ValueError(f"not a chat id: {chat_id!r}")
    return os.path.join(chat_dir(project_path), f"{chat_id}.json")


def _now() -> str:
    """
    Full precision, for what that is worth on this platform.

    The session list sorts by this, and the Windows wall clock advances in
    steps of roughly 15ms however many digits it prints -- so two sessions
    saved in the same tick get identical timestamps and there is genuinely no
    answer to which is newer. `list_chats` breaks that tie stably rather than
    pretending to know.
    """
    return datetime.now(timezone.utc).isoformat()


# ── Making one ───────────────────────────────────────────────────────────────

def derive_title(messages: list[dict], subject: str = "") -> str:
    """
    A name for the conversation, from the writer's own first words.

    DERIVED RATHER THAN GENERATED, and that is a cost decision. A model could
    write a better title, but it would be one AI call per conversation for a
    label -- and this repo's rule is that what the writer paid for is never
    re-bought, which cuts both ways: it should not be bought at all where the
    free version is good enough. The writer can rename any session.

    The subject leads for profile sessions, because "Frodo Baggins -- what does
    he want" is findable in a list and "what does he want" is not.
    """
    first = ""
    for m in messages:
        if m.get("role") == "user" and not m.get("hidden"):
            first = " ".join(str(m.get("content") or "").split())
            break

    if not first:
        # An empty conversation still needs a name -- it can be saved the
        # moment a subject is chosen, before anything is typed.
        return subject or "Untitled"

    if len(first) > _TITLE_MAX:
        # Cut on a word boundary where there is one nearby, so a title does
        # not end mid-word. rfind returns -1 when there is none, and the
        # threshold keeps a single very long word from becoming three dots.
        cut = first.rfind(" ", 0, _TITLE_MAX)
        first = first[:cut if cut > _TITLE_MAX // 2 else _TITLE_MAX].rstrip() + "..."

    return f"{subject} -- {first}" if subject else first


def new_chat(surface: str, subject: str = "") -> dict:
    """
    A fresh session. Not written to disk until something is in it.

    An unknown surface is refused rather than stored: the value decides which
    list the session appears in, and one that matches no list is a session the
    writer can never find again.
    """
    if surface not in SURFACES:
        raise ValueError(f"unknown surface: {surface!r}")
    return {
        "schema_version": SCHEMA_VERSION,
        "chat_id": "chat-" + uuid.uuid4().hex[:12],
        "surface": surface,
        # What the conversation was ABOUT: a profile name, or the chapter that
        # was open. Free text, shown in the list.
        "subject": subject,
        "title": "",
        "created_at": _now(),
        "updated_at": _now(),
        "messages": [],
        # Everything needed to put the panel back the way it was. See
        # docs/long-context-spec.md; the checklist is the body of
        # clearWritingCompanionChat in App.tsx.
        "setup": {},
        # The recap that stands in for older turns once this session is
        # resumed. Empty until one is bought, then kept -- never re-bought.
        "recap": "",
        "recap_through": 0,
        # The same cut counted in visible messages -- see ChatRecapResponse.
        "recap_visible_through": 0,
    }


def describe_materials(message: dict) -> dict:
    """
    Turn one hidden materials turn into something small and honest.

    The text is DROPPED. What is kept is what the writer would want to know
    when reading the session back: what was attached at that point. Rebuilt
    fresh on resume, never replayed -- see the module docstring.
    """
    content = str(message.get("content") or "")
    return {
        "role": "user",
        "hidden": True,
        # The marker that says this is a descriptor rather than a turn. Any
        # reader that does not understand it must skip the message rather than
        # send its (absent) content.
        "materials": {
            "chips": re.findall(r"=== BEGIN (?:[A-Z ]+): (.+?) ===", content),
            "had_chapter": "FULL CHAPTER:" in content
                           or "BEGIN PASSAGE TO ENHANCE" in content,
            "had_world": "BEGIN WORLD CONTEXT" in content,
            "had_outline": "BEGIN CHAPTER OUTLINE" in content,
            "had_ai_notes": "BEGIN AI NOTES" in content,
            # Roughly what it cost, for the writer reading the session back.
            # The same len/4 proxy the rest of the app uses.
            "tokens": len(content) // 4,
        },
    }


def _pack(messages: list[dict]) -> list[dict]:
    """Store descriptors in place of hidden materials text."""
    out = []
    for m in messages or []:
        if m.get("hidden") and not m.get("materials"):
            out.append(describe_materials(m))
        else:
            out.append(m)
    return out


# ── Reading and writing ──────────────────────────────────────────────────────

def load_chat(project_path: str, chat_id: str) -> dict | None:
    """
    A saved session, or None.

    A corrupt file is treated as absent rather than raising. Losing one
    conversation is bad; refusing to open the chat panel at all because of it
    would be worse, and every other session is unaffected.
    """
    try:
        path = _chat_path(project_path, chat_id)
    except ValueError:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or not data.get("chat_id"):
        return None
    if int(data.get("schema_version") or 0) > SCHEMA_VERSION:
        # Written by a newer build. Reading it with older rules and saving it
        # back would silently discard whatever that build added.
        return None
    data.setdefault("messages", [])
    data.setdefault("setup", {})
    data.setdefault("subject", "")
    data.setdefault("recap", "")
    data.setdefault("recap_through", 0)
    data.setdefault("recap_visible_through", 0)
    return data


def save_chat(project_path: str, chat: dict) -> str:
    """
    Write atomically. Returns the path.

    tmp + replace_atomic, so a crash mid-write leaves the previous version
    intact rather than a half-written file that loads as nothing.

    Called after each completed turn. THAT IS NOT A BREACH OF MANUAL-SAVE-ONLY:
    that rule protects the writer's prose from being changed underneath them. A
    reply is not their prose, it is an artifact they already paid for, and the
    precedent is POST /run, which writes a Weaving session immediately so a
    crash cannot lose the fact it started.
    """
    path = _chat_path(project_path, str(chat.get("chat_id") or ""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    chat["updated_at"] = _now()
    chat["messages"] = _pack(chat.get("messages") or [])
    if not chat.get("title"):
        chat["title"] = derive_title(chat["messages"], chat.get("subject", ""))
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(chat, f, indent=2)
    replace_atomic(tmp, path)
    return path


def delete_chat(project_path: str, chat_id: str) -> bool:
    """Remove one session. False when there was nothing to remove."""
    try:
        path = _chat_path(project_path, chat_id)
    except ValueError:
        return False
    try:
        os.remove(path)
        return True
    except OSError:
        return False


def list_chats(project_path: str, surface: str = "") -> list[dict]:
    """
    Summaries, newest first, for the session picker.

    Counts VISIBLE turns rather than stored messages: the hidden materials
    descriptors are bookkeeping, and "12 messages" for a six-turn conversation
    would be a number the writer cannot reconcile with what they see.
    """
    folder = chat_dir(project_path)
    if not os.path.isdir(folder):
        return []

    out: list[dict] = []
    for name in os.listdir(folder):
        if not name.endswith(".json"):
            continue
        chat = load_chat(project_path, name[:-5])
        if chat is None:
            continue
        if surface and chat.get("surface") != surface:
            continue
        messages = chat.get("messages") or []
        out.append({
            "chat_id": chat["chat_id"],
            "surface": chat.get("surface", ""),
            "subject": chat.get("subject", ""),
            "title": chat.get("title") or derive_title(messages,
                                                       chat.get("subject", "")),
            "created_at": chat.get("created_at", ""),
            "updated_at": chat.get("updated_at", ""),
            "turns": sum(1 for m in messages if not m.get("hidden")),
            # Whether resuming this one would cost a recap. The picker says so
            # before the writer opens it, rather than surprising them with a
            # request they did not ask for.
            "has_recap": bool(chat.get("recap")),
        })

    # chat_id as a tiebreak, because two sessions CAN share a timestamp -- the
    # Windows wall clock moves in ~15ms steps. Arbitrary-but-fixed beats a list
    # that reshuffles between reads.
    out.sort(key=lambda c: (c["updated_at"], c["chat_id"]), reverse=True)
    return out
