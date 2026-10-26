"""
tests/test_chat_sessions.py -- conversations the writer can come back to.

Four things here are load-bearing, and three of them fail SILENTLY if they
break, which is why each gets its own test rather than being covered in passing:

  1. A chat_id off the wire is a PATH. "../../project.json" is a traversal
     dressed as a session identifier.
  2. A hidden materials turn is stored as a DESCRIPTOR, never its text. Storing
     the text would put megabytes of duplicated manuscript on disk AND hand a
     resumed session a four-day-old chapter presented as current.
  3. A corrupt file is absent, not fatal. One bad session must not stop the
     panel opening.
  4. A file written by a NEWER build is refused, or reading it with older rules
     and saving it back silently discards whatever that build added.
"""

import json
import os

import pytest

from app.chat_sessions import (
    SCHEMA_VERSION,
    chat_dir,
    delete_chat,
    derive_title,
    list_chats,
    load_chat,
    new_chat,
    save_chat,
)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / ".storythread").mkdir(parents=True)
    return str(root)


def _turn(role: str, content: str) -> dict:
    return {"role": role, "content": content}


def _saved(project: str, surface: str = "companion", subject: str = "",
           messages: list[dict] | None = None) -> dict:
    chat = new_chat(surface, subject)
    chat["messages"] = messages if messages is not None else [
        _turn("user", "who betrays them?"),
        _turn("assistant", "Vance, in chapter twelve."),
    ]
    save_chat(project, chat)
    return chat


# ── Round trip ───────────────────────────────────────────────────────────────

def test_a_session_comes_back_exactly(project):
    chat = _saved(project)
    back = load_chat(project, chat["chat_id"])
    assert back is not None
    assert [m["content"] for m in back["messages"]] == [
        "who betrays them?", "Vance, in chapter twelve."]


def test_the_setup_comes_back_too(project):
    """
    THE PART THAT IS EASY TO GET WRONG. A transcript on its own is not a
    resumable session: without the chips, the canon stance and the ask
    boundaries, carrying on re-sends the chapter and duplicates materials.
    """
    chat = new_chat("companion")
    chat["messages"] = [_turn("user", "hello")]
    chat["setup"] = {
        "contextChips": [{"type": "character", "name": "Kipling", "content": "x"}],
        "treatAsCanon": False,
        "askBoundaries": [2],
    }
    save_chat(project, chat)

    back = load_chat(project, chat["chat_id"])
    assert back["setup"]["treatAsCanon"] is False
    assert back["setup"]["askBoundaries"] == [2]
    assert back["setup"]["contextChips"][0]["name"] == "Kipling"


def test_nothing_is_written_until_it_is_saved(project):
    # new_chat mints an id; it does not touch the disk. A session that wrote
    # itself on creation would litter the folder with empty conversations
    # every time the writer opened the panel.
    new_chat("companion")
    assert not os.path.isdir(chat_dir(project))


def test_an_unknown_surface_is_refused(project):
    # The value decides which list the session appears in. One that matches no
    # list is a session the writer can never find again.
    with pytest.raises(ValueError):
        new_chat("audiobook")


# ── The id is a path ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    "../../project",
    "../../project.json",
    "chat-../../x",
    "chat-ZZZZZZZZZZZZ",
    "chat-abc",
    "",
    "run-0123456789ab",          # a Weaving run id is not a chat id
])
def test_a_bad_id_reads_as_absent_rather_than_escaping(project, bad):
    assert load_chat(project, bad) is None
    assert delete_chat(project, bad) is False


def test_a_traversal_cannot_delete_a_real_file(project, tmp_path):
    """
    THE ATTACK HAS TO OMIT THE EXTENSION, and the first version of this test
    did not -- which made it pass with the guard removed.

    The path is built as f"{chat_id}.json", so "../../project.json" escapes to
    "project.json.json", which does not exist, and the test went green for a
    reason that had nothing to do with the guard. "../../project" lands
    exactly on the real file. Reinstating the bug is what found this; without
    it this file would have shipped a traversal test that tested nothing.
    """
    victim = tmp_path / "MyNovel" / "project.json"
    victim.write_text('{"title": "real"}', encoding="utf-8")

    assert load_chat(project, "../../project") is None
    assert delete_chat(project, "../../project") is False
    assert victim.exists()
    assert victim.read_text(encoding="utf-8") == '{"title": "real"}'


def test_a_traversal_cannot_read_a_real_file(project, tmp_path):
    # The read side of the same hole. project.json is valid JSON with no
    # chat_id, so an unguarded load would return None here too -- a file the
    # attacker CHOSE is what makes it visible.
    planted = tmp_path / "MyNovel" / "secret.json"
    planted.write_text('{"chat_id": "chat-000000000000", "messages": []}',
                       encoding="utf-8")
    assert load_chat(project, "../../secret") is None


# ── Hidden materials are a descriptor, never the payload ─────────────────────

BIG_CHAPTER = "x" * 120_000


def _with_materials(project: str):
    chat = new_chat("companion")
    chat["messages"] = [
        {"role": "user", "hidden": True, "content":
            "=== BEGIN CHARACTER: Kipling ===\nCounts things.\n=== END CHARACTER: Kipling ===\n"
            "=== BEGIN AI NOTES ===\nVance is the traitor.\n=== END AI NOTES ===\n"
            "=== BEGIN WORLD CONTEXT ===\nThe Guild\n=== END WORLD CONTEXT ===\n"
            f"FULL CHAPTER:\n{BIG_CHAPTER}"},
        _turn("user", "continue"),
        _turn("assistant", "The column crested the ridge."),
    ]
    save_chat(project, chat)
    return load_chat(project, chat["chat_id"])


def test_the_chapter_snapshot_is_not_stored(project):
    """
    THE ONE THAT KEEPS THE FILES SMALL AND THE RESUMES HONEST.

    A materials block can carry a whole chapter plus a whole world brief.
    Stored verbatim it is megabytes of duplicated manuscript -- and worse, on
    resume it would hand the model the chapter as it stood four days ago and
    present it as current, with nothing on screen to say so.
    """
    back = _with_materials(project)
    raw = json.dumps(back)
    assert BIG_CHAPTER not in raw
    assert len(raw) < 5_000


def test_it_says_what_was_attached_instead(project):
    # Dropped, not forgotten. The writer reading the session back can still
    # see what that turn was given.
    hidden = _with_materials(project)["messages"][0]
    m = hidden["materials"]
    assert m["chips"] == ["Kipling"]
    assert m["had_chapter"] is True
    assert m["had_world"] is True
    assert m["had_ai_notes"] is True
    assert m["had_outline"] is False
    assert m["tokens"] > 0


def test_the_visible_turns_are_untouched(project):
    # Only the hidden ones are summarised. The writer's own words and the
    # reply they paid for are kept exactly.
    back = _with_materials(project)
    visible = [m for m in back["messages"] if not m.get("hidden")]
    assert [m["content"] for m in visible] == [
        "continue", "The column crested the ridge."]


def test_packing_twice_does_not_re_describe(project):
    # save -> load -> save happens on every turn. A descriptor that got
    # re-described would end up with materials about the word "materials".
    chat = new_chat("companion")
    chat["messages"] = [{"role": "user", "hidden": True,
                         "content": "=== BEGIN NOTE: Style Guide ===\nx\n"}]
    save_chat(project, chat)
    once = load_chat(project, chat["chat_id"])
    save_chat(project, once)
    twice = load_chat(project, chat["chat_id"])
    assert twice["messages"][0]["materials"]["chips"] == ["Style Guide"]


# ── Titles are derived, not bought ───────────────────────────────────────────

def test_a_session_is_named_from_the_writers_first_words(project):
    chat = _saved(project)
    assert load_chat(project, chat["chat_id"])["title"] == "who betrays them?"


def test_a_profile_session_leads_with_the_profile(project):
    # "Frodo Baggins -- what does he want" is findable in a list of twenty.
    # "what does he want" is not.
    chat = _saved(project, "profile", "Frodo Baggins",
                  [_turn("user", "what does he want?")])
    assert load_chat(project, chat["chat_id"])["title"] == \
        "Frodo Baggins -- what does he want?"


def test_a_long_first_message_is_cut_on_a_word(project):
    long = "I want to talk about how the ending works because right now it " \
           "does not land at all and I cannot tell why"
    title = derive_title([_turn("user", long)])
    assert len(title) <= 64
    assert title.endswith("...")
    assert not title.rstrip(".").endswith(" ")      # no trailing space before the dots
    assert "..." in title and " ".join(title.split())[:20] == long[:20]


def test_the_hidden_turn_is_never_the_title(project):
    # It is first in the list and it is not something the writer said.
    title = derive_title([
        {"role": "user", "hidden": True, "content": "=== BEGIN CHARACTER: X ==="},
        _turn("user", "what happens next?"),
    ])
    assert title == "what happens next?"


def test_an_empty_conversation_still_gets_a_name(project):
    assert derive_title([], "Gandalf") == "Gandalf"
    assert derive_title([]) == "Untitled"


def test_a_title_the_writer_set_is_not_overwritten(project):
    chat = _saved(project)
    chat["title"] = "The ending problem"
    save_chat(project, chat)
    assert load_chat(project, chat["chat_id"])["title"] == "The ending problem"


# ── The list ─────────────────────────────────────────────────────────────────

def test_newest_first(project):
    a = _saved(project, messages=[_turn("user", "first")])
    b = _saved(project, messages=[_turn("user", "second")])
    # Saved in order, so b is newer. Stamped by save_chat, not by the caller.
    ids = [c["chat_id"] for c in list_chats(project)]
    assert ids.index(b["chat_id"]) < ids.index(a["chat_id"])


def test_two_sessions_saved_in_the_same_tick_still_order_stably(project):
    """
    The Windows wall clock advances in ~15ms steps however many digits it
    prints, so identical timestamps are real rather than theoretical. There is
    no answer to which is newer; what matters is that the list does not
    reshuffle between reads, because a picker whose rows move is unusable.
    """
    for i in range(6):
        _saved(project, messages=[_turn("user", f"m{i}")])
    for chat in os.listdir(chat_dir(project)):
        path = os.path.join(chat_dir(project), chat)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        data["updated_at"] = "2026-09-06T10:00:00+00:00"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    assert [c["chat_id"] for c in list_chats(project)] == \
           [c["chat_id"] for c in list_chats(project)]


def test_the_two_surfaces_can_be_listed_apart(project):
    _saved(project, "companion")
    _saved(project, "profile", "Frodo")
    assert len(list_chats(project)) == 2
    assert len(list_chats(project, "profile")) == 1
    assert list_chats(project, "profile")[0]["subject"] == "Frodo"


def test_the_count_is_of_turns_the_writer_can_see(project):
    # "12 messages" for a six-turn conversation is a number they cannot
    # reconcile with what is on screen.
    chat = new_chat("companion")
    chat["messages"] = [
        {"role": "user", "hidden": True, "content": "=== BEGIN NOTE: x ==="},
        _turn("user", "a"), _turn("assistant", "b"),
    ]
    save_chat(project, chat)
    assert list_chats(project)[0]["turns"] == 2


def test_no_sessions_is_an_empty_list_not_an_error(project):
    # The ordinary state of a new book, and of every book before this shipped.
    assert list_chats(project) == []


def test_a_deleted_session_leaves_the_list(project):
    chat = _saved(project)
    assert delete_chat(project, chat["chat_id"]) is True
    assert list_chats(project) == []
    assert load_chat(project, chat["chat_id"]) is None


# ── Damaged and future files ─────────────────────────────────────────────────

def test_a_corrupt_session_is_absent_rather_than_fatal(project):
    good = _saved(project)
    os.makedirs(chat_dir(project), exist_ok=True)
    with open(os.path.join(chat_dir(project), "chat-ffffffffffff.json"),
              "w", encoding="utf-8") as f:
        f.write("{not json")

    # Losing one conversation is bad. Refusing to open the panel is worse.
    assert load_chat(project, "chat-ffffffffffff") is None
    assert [c["chat_id"] for c in list_chats(project)] == [good["chat_id"]]


def test_a_file_from_a_newer_build_is_refused(project):
    """
    Not paranoia -- the writer moves a book between computers, and this repo
    proved that path works. An older build reading a newer file with older
    rules and saving it back would silently drop whatever the newer one added.
    Refusing to load is the honest failure.
    """
    chat = _saved(project)
    path = os.path.join(chat_dir(project), f"{chat['chat_id']}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data["schema_version"] = SCHEMA_VERSION + 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)

    assert load_chat(project, chat["chat_id"]) is None


def test_a_half_written_file_never_replaces_a_good_one(project):
    # save is tmp + replace_atomic. A .tmp left behind by a crash is not a
    # session and must not appear in the list.
    chat = _saved(project)
    with open(os.path.join(chat_dir(project), "chat-aaaaaaaaaaaa.json.tmp"),
              "w", encoding="utf-8") as f:
        f.write("{}")
    assert [c["chat_id"] for c in list_chats(project)] == [chat["chat_id"]]
