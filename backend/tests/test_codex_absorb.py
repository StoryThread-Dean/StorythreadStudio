# tests/test_codex_absorb.py -- taking a word into an entry
# =========================================================
# Weaving offers one entry per NAME it finds, so a writer who accepts Lara,
# Croft and Lara Croft ends up with three entries where they meant one person.
#
# THE WORD "MERGE" IS WRONG AND THE DIFFERENCE IS THE FEATURE
# ----------------------------------------------------------
# Raised in review, and it is the right objection: to a writer, watching a dot
# for "Alexandra Langford" disappear reads as their profile being deleted. So
# the operation is not "merge B into A". It is "this WORD means her".
#
#     Alexandra Langford, Alexandra, Langford, Lexi, Lexa, Drea
#         -> all become names she answers to
#         -> every mention of any of them, anywhere, resolves to her
#         -> the placeholder that stood in for the word stops standing in for
#            anything, so it goes
#
# Nothing the writer wrote is touched, because a placeholder is BY DEFINITION
# a thing with nothing in it. Which is also the refusal: an entry holding
# prose, connections or dated facts is never absorbed.
#
# And the label is separate from the name. Alexandra Langford can be the
# official name on the profile while the story only ever says Lexa, and the
# map should say Lexa.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app import codex_store
from app.codex.threads import parse_thread
from app.main import app

client = TestClient(app)


def _thread(entity_id: str, name: str, overview: str = "", **front) -> str:
    lines = ["---", "type: character", f"entity_id: {entity_id}", f"name: {name}"]
    for key, value in front.items():
        lines.append(f"{key}: {value}")
    lines += ["---", "", "# Overview", overview, ""]
    return "\n".join(lines)


@pytest.fixture
def project(tmp_path):
    """One real profile, and the placeholders Weaving made from her names."""
    root = tmp_path / "MyNovel"
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")

    (root / "codex" / "characters" / "alexandra-langford.md").write_text(
        _thread("e-alex", "Alexandra Langford",
                "A quiet woman who is never called that."), encoding="utf-8")
    for slug, name in [("lexa", "Lexa"), ("lexi", "Lexi"), ("drea", "Drea")]:
        (root / "codex" / "characters" / f"{slug}.md").write_text(
            _thread(f"e-{slug}", name), encoding="utf-8")
    return str(root)


def _read(project, filename) -> dict:
    path = os.path.join(project, "codex", "characters", filename)
    with open(path, encoding="utf-8") as f:
        return parse_thread(f.read())


def _absorb(project, into, from_id, **kw):
    return client.post("/api/codex/absorb",
                       json={"project_path": project, "into": into,
                             "from_id": from_id, **kw})


# ── What a placeholder is ────────────────────────────────────────────────────

def test_an_entry_with_nothing_in_it_is_a_placeholder():
    assert codex_store.is_placeholder(
        {"sections": {"overview": {"content": "", "trait_blocks": []}}})


def test_prose_stops_it_being_a_placeholder():
    assert not codex_store.is_placeholder(
        {"sections": {"overview": {"content": "Words.", "trait_blocks": []}}})


def test_a_connection_stops_it_being_a_placeholder():
    # A writer who tied it to something has said what it is, even with no prose.
    assert not codex_store.is_placeholder(
        {"sections": {}, "ties": [{"rel": "knows", "target": "e-x"}]})


def test_a_dated_fact_stops_it_being_a_placeholder():
    assert not codex_store.is_placeholder(
        {"sections": {}, "run": [{"id": "f-1", "at": "c-1", "axis": "a",
                                  "value": "v"}]})


def test_a_trait_block_stops_it_being_a_placeholder():
    assert not codex_store.is_placeholder(
        {"sections": {"physical": {"content": "",
                                   "trait_blocks": [{"trait": "Scar"}]}}})


# ── Taking the word ─────────────────────────────────────────────────────────

def test_the_word_becomes_a_name_she_answers_to(project):
    body = _absorb(project, "e-alex", "e-lexa").json()
    assert "Lexa" in body["aliases"]
    assert _read(project, "alexandra-langford.md")["aliases"] == ["Lexa"]


def test_the_placeholder_goes_because_it_stands_in_for_nothing_now(project):
    _absorb(project, "e-alex", "e-lexa")
    assert not os.path.exists(
        os.path.join(project, "codex", "characters", "lexa.md"))


def test_nothing_the_writer_wrote_is_touched(project):
    _absorb(project, "e-alex", "e-lexa")
    kept = _read(project, "alexandra-langford.md")
    assert "never called that" in kept["sections"]["overview"]["content"]
    assert kept["name"] == "Alexandra Langford"


def test_several_words_can_be_taken_one_at_a_time(project):
    for stub in ["e-lexa", "e-lexi", "e-drea"]:
        _absorb(project, "e-alex", stub)
    assert set(_read(project, "alexandra-langford.md")["aliases"]) == \
        {"Lexa", "Lexi", "Drea"}


def test_a_word_it_already_answers_to_is_not_added_twice(project):
    _absorb(project, "e-alex", "e-lexa")
    # A second placeholder spelt the same way, which Weaving can produce.
    with open(os.path.join(project, "codex", "characters", "lexa-2.md"),
              "w", encoding="utf-8") as f:
        f.write(_thread("e-lexa2", "Lexa"))
    body = _absorb(project, "e-alex", "e-lexa2").json()
    assert body["aliases"].count("Lexa") == 1
    assert body["absorbed"] == []


def test_words_the_placeholder_had_already_gathered_come_across_too(project):
    # A placeholder that absorbed something itself, then gets absorbed.
    _absorb(project, "e-lexa", "e-lexi")
    _absorb(project, "e-alex", "e-lexa")
    assert set(_read(project, "alexandra-langford.md")["aliases"]) == \
        {"Lexa", "Lexi"}


def test_every_absorbed_word_then_resolves_to_her(project):
    # The whole reason the word matters: a mention of any of them, anywhere,
    # now finds her -- in the manuscript, in other profiles, in notes.
    from app.codex.mentions import build_alias_map
    for stub in ["e-lexa", "e-lexi", "e-drea"]:
        _absorb(project, "e-alex", stub)
    aliases = build_alias_map(codex_store.load_threads(project))
    for word in ["alexandra langford", "lexa", "lexi", "drea"]:
        assert aliases[word] == ["e-alex"], word


# ── The refusal that protects writing ───────────────────────────────────────

def test_an_entry_with_writing_in_it_is_never_absorbed(project):
    # The app does not move somebody's writing into another file and delete
    # the original on the strength of one click.
    with open(os.path.join(project, "codex", "characters", "lexa.md"),
              "w", encoding="utf-8") as f:
        f.write(_thread("e-lexa", "Lexa", "Hours of thinking about her."))

    response = _absorb(project, "e-alex", "e-lexa")
    assert response.json()["detail"]["code"] == "entity_not_empty"
    assert os.path.exists(os.path.join(project, "codex", "characters", "lexa.md"))


def test_the_refusal_offers_the_two_things_that_would_work(project):
    with open(os.path.join(project, "codex", "characters", "lexa.md"),
              "w", encoding="utf-8") as f:
        f.write(_thread("e-lexa", "Lexa", "Hours of thinking."))
    message = _absorb(project, "e-alex", "e-lexa").json()["detail"]["message"]
    assert "Copy across" in message
    assert "Tie" in message


def test_an_entry_cannot_absorb_itself(project):
    assert _absorb(project, "e-alex", "e-alex").json()["detail"]["code"] \
        == "type_invalid"


def test_absorbing_something_that_is_not_there_is_refused(project):
    assert _absorb(project, "e-alex", "e-nope").json()["detail"]["code"] \
        == "entity_not_found"


# ── The label, which is not the name ────────────────────────────────────────

def test_the_absorbed_word_can_become_the_label(project):
    body = _absorb(project, "e-alex", "e-lexa", as_label=True).json()
    assert body["display_name"] == "Lexa"
    # And the NAME is untouched -- she is still Alexandra Langford.
    assert body["name"] == "Alexandra Langford"


def test_the_label_is_written_to_the_file_so_it_survives(project):
    _absorb(project, "e-alex", "e-lexa", as_label=True)
    assert _read(project, "alexandra-langford.md")["display_name"] == "Lexa"


def test_an_ordinary_entry_writes_no_label_at_all(project):
    # Nothing is added to a file that did not need it.
    _absorb(project, "e-alex", "e-lexa")
    path = os.path.join(project, "codex", "characters", "alexandra-langford.md")
    assert "display_name" not in open(path, encoding="utf-8").read()


def test_the_label_can_be_set_on_its_own(project):
    _absorb(project, "e-alex", "e-lexa")
    body = client.patch("/api/codex/label", json={
        "project_path": project, "entity_id": "e-alex", "display_name": "Lexa",
    }).json()
    assert body["display_name"] == "Lexa"


def test_the_label_can_be_cleared_back_to_the_name(project):
    _absorb(project, "e-alex", "e-lexa", as_label=True)
    client.patch("/api/codex/label", json={
        "project_path": project, "entity_id": "e-alex", "display_name": "",
    })
    assert _read(project, "alexandra-langford.md")["display_name"] == ""


def test_a_label_the_entry_does_not_answer_to_is_refused(project):
    # Otherwise the map would say a word that appears nowhere in the text, and
    # the two would disagree with nothing to explain why.
    response = client.patch("/api/codex/label", json={
        "project_path": project, "entity_id": "e-alex", "display_name": "Bob",
    })
    assert response.json()["detail"]["code"] == "type_invalid"
    assert "not one of the names" in response.json()["detail"]["message"]


def test_the_entrys_own_name_is_always_a_valid_label(project):
    assert client.patch("/api/codex/label", json={
        "project_path": project, "entity_id": "e-alex",
        "display_name": "Alexandra Langford",
    }).status_code == 200


# ── What the map is told ────────────────────────────────────────────────────

def _graph(project):
    return client.get("/api/codex/graph",
                      params={"project_path": project}).json()


def test_the_map_is_told_which_dots_are_still_bare(project):
    nodes = {n["name"]: n for n in _graph(project)["nodes"]}
    assert nodes["Lexa"]["placeholder"] is True
    assert nodes["Alexandra Langford"]["placeholder"] is False


def test_a_dot_stops_being_bare_once_it_holds_something(project):
    # Derived, never recorded. The writer writes a sentence and the dot changes.
    with open(os.path.join(project, "codex", "characters", "lexa.md"),
              "w", encoding="utf-8") as f:
        f.write(_thread("e-lexa", "Lexa", "She hates that name."))
    nodes = {n["name"]: n for n in _graph(project)["nodes"]}
    assert nodes["Lexa"]["placeholder"] is False


def test_the_map_is_told_the_words_and_the_label(project):
    _absorb(project, "e-alex", "e-lexa", as_label=True)
    node = next(n for n in _graph(project)["nodes"]
                if n["entity_id"] == "e-alex")
    assert node["display_name"] == "Lexa"
    assert "Lexa" in node["aliases"]
    assert node["name"] == "Alexandra Langford"


def test_absorbing_removes_the_dot_from_the_map(project):
    before = {n["entity_id"] for n in _graph(project)["nodes"]}
    _absorb(project, "e-alex", "e-lexa")
    after = {n["entity_id"] for n in _graph(project)["nodes"]}
    assert before - after == {"e-lexa"}


# ── A bare WORD onto an entry, which absorb cannot do ────────────────────────
#
# Reported from live testing, and it is the commonest true answer an Unspun stop
# could not give:
#
#     "Blaskowitz Sideburn was flagged. This is PART of one of Newton's
#      nicknames ... I'm not going to assign it a new profile because its wrong
#      in how it was flagged. [And] I couldn't CONNECT that name to an existing
#      profile for Newton."
#
# The stop offered "make an entry" and "never make an entry" and nothing else.
# `absorb` does almost this and cannot be used: it moves a word off a
# PLACEHOLDER ENTITY, and an Unspun word has no entity at all. Creating one just
# to absorb it would write a file, delete it, and reindex twice to record a
# string.

def _alias(project, entity_id, word, **kw):
    return client.post("/api/codex/alias",
                       json={"project_path": project, "entity_id": entity_id,
                             "word": word, **kw})


def test_a_word_from_the_prose_becomes_a_name_she_answers_to(project):
    body = _alias(project, "e-alex", "Blaskowitz").json()
    assert body["added"] == "Blaskowitz"
    assert "Blaskowitz" in _read(project, "alexandra-langford.md")["aliases"]


def test_the_word_then_resolves_to_her_everywhere(project):
    # The point of recording it. A name that is stored and does not bind is
    # worse than one that was never offered.
    import asyncio
    _alias(project, "e-alex", "Blaskowitz")
    found = asyncio.run(codex_store.find_by_alias(project, "Blaskowitz"))
    assert found == ["e-alex"]


def test_a_word_that_already_means_something_else_is_REFUSED(project):
    # The important one. An ambiguous word resolves to two entries, and the
    # mention binder correctly refuses to bind anything ambiguous -- so quietly
    # accepting it would produce a name that is in the world, looks recorded,
    # and never matches anything again.
    response = _alias(project, "e-alex", "Lexa")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "alias_taken"
    # And it names the entry that already has it, so the writer can act.
    assert "Lexa" in detail["message"]


def test_a_refused_word_is_not_half_written(project):
    _alias(project, "e-alex", "Lexa")
    assert "Lexa" not in _read(project, "alexandra-langford.md")["aliases"]


def test_a_word_she_already_answers_to_is_not_an_error(project):
    # The writer's belief about their own world is correct and there is nothing
    # to do. Refusing would make being right feel like a mistake.
    _alias(project, "e-alex", "Blaskowitz")
    response = _alias(project, "e-alex", "Blaskowitz")
    assert response.status_code == 200
    assert response.json()["added"] == ""
    # And it was not added twice.
    assert _read(project, "alexandra-langford.md")["aliases"].count("Blaskowitz") == 1


def test_her_own_name_is_already_hers(project):
    assert _alias(project, "e-alex", "Alexandra Langford").json()["added"] == ""


def test_an_empty_word_is_refused(project):
    assert _alias(project, "e-alex", "   ").status_code == 400


def test_a_word_can_become_the_label_the_map_shows(project):
    # Same argument as absorb's: the official name on the profile can differ
    # from what the story actually calls her.
    _alias(project, "e-alex", "Lex", as_label=True)
    assert _read(project, "alexandra-langford.md")["display_name"] == "Lex"


def test_an_entry_that_is_not_there_is_a_404(project):
    assert _alias(project, "e-nobody", "Whatever").status_code == 404
