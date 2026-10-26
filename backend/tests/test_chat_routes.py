"""
tests/test_chat_routes.py -- the HTTP face of saved conversations.

The store is tested in test_chat_sessions.py. This file is about what the wire
adds: a project_path that has to be a real project, a chat_id that arrives from
outside, and the one piece of protocol the frontend depends on -- the id coming
back on a first save, so the second turn writes to the same file rather than
starting a new conversation every time.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    return str(root)


def _save(project: str, **over):
    body = {
        "project_path": project,
        "surface": "companion",
        "messages": [{"role": "user", "content": "who betrays them?"},
                     {"role": "assistant", "content": "Vance."}],
        "setup": {},
    }
    body.update(over)
    return client.put("/api/chats/one", json=body)


# ── Saving ───────────────────────────────────────────────────────────────────

def test_a_first_save_mints_an_id_and_hands_it_back(project):
    """
    THE PIECE OF PROTOCOL EVERYTHING ELSE RESTS ON.

    The frontend has no id on the first turn. If it did not get one back it
    would send `chat_id: null` again on turn two, and every turn of every
    conversation would become a separate one-turn session in the picker.
    """
    res = _save(project)
    assert res.status_code == 200, res.text
    assert res.json()["chat_id"].startswith("chat-")


def test_the_second_save_updates_the_same_session(project):
    first = _save(project).json()["chat_id"]
    _save(project, chat_id=first, messages=[
        {"role": "user", "content": "who betrays them?"},
        {"role": "assistant", "content": "Vance."},
        {"role": "user", "content": "since when?"},
    ])
    listing = client.get("/api/chats", params={"project_path": project}).json()
    assert len(listing["chats"]) == 1
    assert listing["chats"][0]["turns"] == 3


def test_the_derived_title_comes_back_too(project):
    # The picker shows it immediately, without a second round trip.
    assert _save(project).json()["title"] == "who betrays them?"


def test_the_setup_survives_the_wire(project):
    chat_id = _save(project, setup={
        "contextChips": [{"type": "character", "name": "Kipling", "content": "x"}],
        "treatAsCanon": False,
        "askBoundaries": [2],
    }).json()["chat_id"]

    got = client.get("/api/chats/one",
                     params={"project_path": project, "chat_id": chat_id}).json()
    assert got["setup"]["treatAsCanon"] is False
    assert got["setup"]["contextChips"][0]["name"] == "Kipling"


def test_an_id_that_no_longer_resolves_starts_a_new_one_rather_than_failing(project):
    """
    The writer deleted the session in another window, or the file was lost.
    Their turn has already happened and already cost money -- refusing the
    save would throw away the only copy of a reply they paid for. A new row
    in the picker is the cheapest possible wrong answer.
    """
    res = _save(project, chat_id="chat-ffffffffffff")
    assert res.status_code == 200
    assert res.json()["chat_id"] != "chat-ffffffffffff"


def test_a_bad_id_on_save_does_not_escape_the_folder(project, tmp_path):
    # Same traversal shape as the store test, over HTTP. It falls through to
    # "mint a new one", which is both safe and the right behaviour.
    victim = tmp_path / "MyNovel" / "project.json"
    before = victim.read_text(encoding="utf-8")
    res = _save(project, chat_id="../../project")
    assert res.status_code == 200
    assert res.json()["chat_id"].startswith("chat-")
    assert victim.read_text(encoding="utf-8") == before


@pytest.mark.parametrize("surface", ["audiobook", "", "COMPANION"])
def test_an_unknown_surface_is_refused_by_name(project, surface):
    # Refused rather than defaulted: a session filed under a surface no list
    # asks for is one the writer can never find again.
    res = _save(project, surface=surface)
    assert res.status_code in (400, 422)
    if res.status_code == 400:
        assert "surface" in res.json()["detail"].lower()


# ── Listing ──────────────────────────────────────────────────────────────────

def test_a_book_with_no_conversations_returns_an_empty_list(project):
    # The ordinary state of every project before this shipped. An error here
    # would make the picker look broken on a book that is simply new.
    res = client.get("/api/chats", params={"project_path": project})
    assert res.status_code == 200
    assert res.json()["chats"] == []


def test_the_two_surfaces_can_be_asked_for_separately(project):
    _save(project)
    _save(project, surface="profile", subject="Frodo Baggins",
          messages=[{"role": "user", "content": "what does he want?"}])

    both = client.get("/api/chats", params={"project_path": project}).json()
    just = client.get("/api/chats",
                      params={"project_path": project, "surface": "profile"}).json()
    assert len(both["chats"]) == 2
    assert len(just["chats"]) == 1
    assert just["chats"][0]["title"] == "Frodo Baggins -- what does he want?"


def test_listing_refuses_an_unknown_surface(project):
    res = client.get("/api/chats",
                     params={"project_path": project, "surface": "nonsense"})
    assert res.status_code == 400


# ── Opening ──────────────────────────────────────────────────────────────────

def test_opening_one_gives_the_whole_conversation(project):
    chat_id = _save(project).json()["chat_id"]
    got = client.get("/api/chats/one",
                     params={"project_path": project, "chat_id": chat_id}).json()
    assert [m["content"] for m in got["messages"]] == \
        ["who betrays them?", "Vance."]


def test_a_missing_one_is_a_404_that_says_what_to_do(project):
    res = client.get("/api/chats/one",
                     params={"project_path": project,
                             "chat_id": "chat-000000000000"})
    assert res.status_code == 404
    # Three different causes, one message, because the caller's next move is
    # the same for all of them.
    assert "deleted" in res.json()["detail"]


def test_a_traversal_id_is_a_404_not_a_file(project):
    res = client.get("/api/chats/one",
                     params={"project_path": project, "chat_id": "../../project"})
    assert res.status_code == 404


# ── Deleting and renaming ────────────────────────────────────────────────────

def test_deleting_removes_it_from_the_list(project):
    chat_id = _save(project).json()["chat_id"]
    res = client.delete("/api/chats/one",
                        params={"project_path": project, "chat_id": chat_id})
    assert res.json()["removed"] is True
    assert client.get("/api/chats",
                      params={"project_path": project}).json()["chats"] == []


def test_deleting_something_already_gone_is_not_an_error(project):
    # The writer wanted it gone and it is gone. `removed` says which happened.
    res = client.delete("/api/chats/one",
                        params={"project_path": project,
                                "chat_id": "chat-000000000000"})
    assert res.status_code == 200
    assert res.json()["removed"] is False


def test_renaming_sticks(project):
    chat_id = _save(project).json()["chat_id"]
    res = client.post("/api/chats/rename", json={
        "project_path": project, "chat_id": chat_id,
        "title": "The ending problem"})
    assert res.status_code == 200

    listing = client.get("/api/chats", params={"project_path": project}).json()
    assert listing["chats"][0]["title"] == "The ending problem"


def test_a_rename_is_not_undone_by_the_next_save(project):
    # save_chat re-derives a title only when there is none. A rename that a
    # later turn silently reverted would be maddening and hard to describe.
    chat_id = _save(project).json()["chat_id"]
    client.post("/api/chats/rename", json={
        "project_path": project, "chat_id": chat_id, "title": "Mine"})
    _save(project, chat_id=chat_id, messages=[
        {"role": "user", "content": "a different first line entirely"}])

    listing = client.get("/api/chats", params={"project_path": project}).json()
    assert listing["chats"][0]["title"] == "Mine"


def test_an_empty_name_is_refused(project):
    # A row with no name in the picker is a row that cannot be chosen.
    chat_id = _save(project).json()["chat_id"]
    res = client.post("/api/chats/rename", json={
        "project_path": project, "chat_id": chat_id, "title": "   "})
    assert res.status_code == 400


# ── The project has to be a project ──────────────────────────────────────────

def test_a_folder_that_is_not_a_project_is_refused(tmp_path):
    stray = tmp_path / "Documents"
    stray.mkdir()
    res = client.get("/api/chats", params={"project_path": str(stray)})
    assert res.status_code == 404
    assert "project.json" in res.json()["detail"]


def test_no_project_path_is_a_400(tmp_path):
    assert client.get("/api/chats", params={"project_path": ""}).status_code == 400
