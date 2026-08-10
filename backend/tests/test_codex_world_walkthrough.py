# tests/test_codex_world_walkthrough.py -- a real world, end to end
# =================================================================
# Every other test in this folder checks one rule. This one checks that the
# rules ADD UP: it builds a densely connected character out of the shipped
# vocabulary and then navigates the result the way a writer would.
#
# The world is Drizzt Do'Urden's, given in review as the worked example of what
# Connections are for:
#
#     Drizzt, also called Drizzt. Companion to Guenhwyvar (a creature) and to
#     Catti-brie, Bruenor, Wulfgar and Regis. Worships Mielikki. Part of the
#     Companions of the Hall. Carries Icingdeath, Twinkle, and an ebony statue
#     that summons Guenhwyvar. Lives across Icewind Dale, Mithral Hall, the
#     Sword Coast and Baldur's Gate. And is a Drow, alongside Zaknafein,
#     Jarlaxle, Vierna and Matron Malice.
#
# WHY THIS TEST EARNED ITS PLACE
# ------------------------------
# Writing it found four things a writer could not say. Creatures had no
# vocabulary whatsoever, so a ranger and his panther were two entries with
# nothing between them; an object could not summon anything; and a character's
# ordinary association with a place could only be recorded as "born in", which
# permits one and was the wrong word besides.
#
# None of that was visible from any single-rule test. It only shows up when a
# real world is put through the whole thing.

import json

import pytest
from fastapi.testclient import TestClient

from app.codex.types_registry import add_type, load_registry
from app.main import app

client = TestClient(app)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "Icewind"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    return str(root)


def _make(project, type_id, name):
    """One entry, the way the app makes them: id and filename minted for it."""
    response = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": type_id, "name": name})
    assert response.status_code == 200, response.text
    return response.json()["thread"]["entity_id"]


def _tie(project, src, rel, dst):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": src, "rel": rel, "dst_id": dst})
    assert response.status_code == 200, f"{rel}: {response.text}"
    return response.json()


def _relations(project, src_type, dst_type):
    return client.get("/api/codex/relations",
                      params={"project_path": project, "src_type": src_type,
                              "dst_type": dst_type}).json()


def _ties(project, entity_id):
    return client.get("/api/codex/ties",
                      params={"project_path": project,
                              "entity_id": entity_id}).json()["ties"]


@pytest.fixture
def world(project):
    """The whole example, built through the same endpoints the app uses."""
    ids = {}

    # A custom kind, exactly as it was described: Race is not something the app
    # ships with, and a writer adding it is the ordinary case rather than an
    # exotic one.
    add_type(project, "", "Race", group="other")

    for type_id, names in {
        "character": ["Drizzt Do'Urden", "Catti-brie", "Bruenor Battlehammer",
                      "Wulfgar", "Regis", "Zaknafein Do'Urden",
                      "Jarlaxle Baenre", "Vierna", "Matron Malice Do'Urden"],
        "creature": ["Guenhwyvar"],
        "deity": ["Mielikki"],
        "faction": ["Companions of the Hall"],
        "object": ["Icingdeath", "Twinkle", "Ebony statue of Guenhwyvar"],
        "location": ["Icewind Dale", "Mithral Hall", "Sword Coast",
                     "Baldur's Gate"],
        "race": ["Drow (Dark Elf)"],
    }.items():
        for name in names:
            ids[name] = _make(project, type_id, name)
    return {"project": project, "ids": ids}


# ── Everything in the example can be said ───────────────────────────────────

def test_a_character_is_a_companion_to_a_creature(world):
    # The gap that mattered most: creatures had no vocabulary at all, so a
    # ranger and his panther were two entries with nothing between them.
    ids = world["ids"]
    _tie(world["project"], ids["Drizzt Do'Urden"], "companion_of",
         ids["Guenhwyvar"])


def test_one_word_covers_companions_of_both_sorts(world):
    # Splitting this into "friend of" and "bonded to" would ask the writer to
    # classify a bond the story does not classify.
    ids, project = world["ids"], world["project"]
    for name in ["Catti-brie", "Bruenor Battlehammer", "Wulfgar", "Regis"]:
        _tie(project, ids["Drizzt Do'Urden"], "companion_of", ids[name])
    _tie(project, ids["Drizzt Do'Urden"], "companion_of", ids["Guenhwyvar"])

    companions = {t["other_name"] for t in _ties(project, ids["Drizzt Do'Urden"])}
    assert companions == {"Catti-brie", "Bruenor Battlehammer", "Wulfgar",
                          "Regis", "Guenhwyvar"}


def test_an_object_can_summon_a_creature(world):
    ids, project = world["ids"], world["project"]
    _tie(project, ids["Ebony statue of Guenhwyvar"], "summons", ids["Guenhwyvar"])
    assert _ties(project, ids["Guenhwyvar"])[0]["reads_as"] == "summoned by"


def test_a_character_can_be_associated_with_several_places(world):
    # Only "born in" existed, which permits ONE and was the wrong word anyway.
    ids, project = world["ids"], world["project"]
    for place in ["Icewind Dale", "Mithral Hall", "Sword Coast", "Baldur's Gate"]:
        result = _tie(project, ids["Drizzt Do'Urden"], "lives_in", ids[place])
        assert result["warnings"] == []


def test_the_rest_of_the_example_needs_no_new_vocabulary(world):
    ids, project = world["ids"], world["project"]
    _tie(project, ids["Drizzt Do'Urden"], "worships", ids["Mielikki"])
    _tie(project, ids["Drizzt Do'Urden"], "member_of",
         ids["Companions of the Hall"])
    for weapon in ["Icingdeath", "Twinkle", "Ebony statue of Guenhwyvar"]:
        _tie(project, ids["Drizzt Do'Urden"], "owns", ids[weapon])

    assert len(_ties(project, ids["Drizzt Do'Urden"])) == 5


# ── A custom kind is connectable, which is the harder half ──────────────────

def test_a_custom_kind_starts_with_no_way_to_connect_to_it(world):
    # Honest rather than broken: the app has never heard of Race and will not
    # invent a meaning for it. What matters is that this is not a dead end.
    body = _relations(world["project"], "character", "race")
    assert body["forward"] == []
    assert body["reverse"] == []
    assert body["available"] == []


def test_the_writer_names_the_connection_and_it_works_at_once(world):
    ids, project = world["ids"], world["project"]
    added = client.post("/api/codex/relation", json={
        "project_path": project, "label": "Race",
        "source_types": ["character"], "target_types": ["race"],
    }).json()
    assert added["id"] == "race"
    _tie(project, ids["Drizzt Do'Urden"], "race", ids["Drow (Dark Elf)"])


def test_a_named_connection_is_then_offered_for_every_pair_like_it(world):
    # The registry decides, not the code -- so naming it once makes it
    # available for every character and every race from then on.
    ids, project = world["ids"], world["project"]
    client.post("/api/codex/relation", json={
        "project_path": project, "label": "Race",
        "source_types": ["character"], "target_types": ["race"],
    })
    assert "race" in {r["id"] for r in _relations(project, "character",
                                                 "race")["forward"]}
    for who in ["Zaknafein Do'Urden", "Jarlaxle Baenre", "Vierna"]:
        _tie(project, ids[who], "race", ids["Drow (Dark Elf)"])


def test_a_custom_connection_survives_being_written_and_read(world):
    project = world["project"]
    client.post("/api/codex/relation", json={
        "project_path": project, "label": "Race",
        "source_types": ["character"], "target_types": ["race"],
    })
    registry, from_file = load_registry(project)
    assert from_file is True
    assert any(r["id"] == "race" for r in registry["relations"])


# ── Navigating it from any point ────────────────────────────────────────────

def _graph(project, **params):
    return client.get("/api/codex/graph",
                      params={"project_path": project, **params}).json()


@pytest.fixture
def connected(world):
    """The example, wired up."""
    ids, project = world["ids"], world["project"]
    client.post("/api/codex/relation", json={
        "project_path": project, "label": "Race",
        "source_types": ["character"], "target_types": ["race"],
    })
    for who in ["Drizzt Do'Urden", "Zaknafein Do'Urden", "Jarlaxle Baenre",
                "Vierna", "Matron Malice Do'Urden"]:
        _tie(project, ids[who], "race", ids["Drow (Dark Elf)"])
    for name in ["Catti-brie", "Bruenor Battlehammer", "Wulfgar", "Regis"]:
        _tie(project, ids["Drizzt Do'Urden"], "companion_of", ids[name])
    _tie(project, ids["Drizzt Do'Urden"], "companion_of", ids["Guenhwyvar"])
    _tie(project, ids["Drizzt Do'Urden"], "worships", ids["Mielikki"])
    _tie(project, ids["Drizzt Do'Urden"], "member_of",
         ids["Companions of the Hall"])
    _tie(project, ids["Ebony statue of Guenhwyvar"], "summons", ids["Guenhwyvar"])
    for place in ["Icewind Dale", "Mithral Hall", "Sword Coast", "Baldur's Gate"]:
        _tie(project, ids["Drizzt Do'Urden"], "lives_in", ids[place])
    return world


def test_standing_on_the_race_shows_every_character_of_it(connected):
    # The navigation described in review: click the Drow entry and see
    # Zaknafein, Jarlaxle, Vierna, Matron Malice and Drizzt.
    ids, project = connected["ids"], connected["project"]
    drow = {t["other_name"] for t in _ties(project, ids["Drow (Dark Elf)"])}
    assert drow == {"Drizzt Do'Urden", "Zaknafein Do'Urden", "Jarlaxle Baenre",
                    "Vierna", "Matron Malice Do'Urden"}


def test_it_reads_correctly_from_that_end_too(connected):
    # A relation with no named other half says so rather than inventing a
    # phrase -- better an awkward truth than a confident guess.
    ids, project = connected["ids"], connected["project"]
    row = _ties(project, ids["Drow (Dark Elf)"])[0]
    assert row["incoming"] is True
    assert row["reads_as"] == "Race (the other way round)"


def test_standing_on_the_creature_finds_both_the_ranger_and_the_statue(connected):
    # Two different kinds of connection arriving from two different kinds of
    # thing, which is the shape a real world has.
    ids, project = connected["ids"], connected["project"]
    rows = {t["other_name"]: t["reads_as"]
            for t in _ties(project, ids["Guenhwyvar"])}
    assert rows == {"Drizzt Do'Urden": "companion of",
                    "Ebony statue of Guenhwyvar": "summoned by"}


def test_the_map_draws_the_whole_thing(connected):
    ids, project = connected["ids"], connected["project"]
    graph = _graph(project)
    # 5 race + 5 companion_of + 1 worships + 1 member_of + 1 summons
    # + 4 lives_in. Written out because a bare number in a test is a number
    # nobody can check.
    assert len(graph["edges"]) == 5 + 5 + 1 + 1 + 1 + 4
    # And nothing is hidden without saying so.
    assert graph["hidden_nodes"] == 0
    assert graph["hidden_edges"] == 0
    drawn = {n["entity_id"] for n in graph["nodes"]}
    assert ids["Drow (Dark Elf)"] in drawn


def test_a_connected_entry_is_no_longer_a_bare_dot(connected):
    # A dot fills in the moment it holds anything, which is what makes the map
    # read as progress rather than as a fixed picture.
    ids, project = connected["ids"], connected["project"]
    nodes = {n["entity_id"]: n for n in _graph(project)["nodes"]}
    assert nodes[ids["Drizzt Do'Urden"]]["placeholder"] is False
    # Nothing has been said about Twinkle yet, so it is still bare.
    assert nodes[ids["Twinkle"]]["placeholder"] is True


def test_the_short_name_can_be_the_one_on_the_map(connected):
    # "Also goes by Drizzt", from the example. The entry stays Drizzt Do'Urden.
    ids, project = connected["ids"], connected["project"]
    stub = _make(project, "character", "Drizzt")
    client.post("/api/codex/absorb", json={
        "project_path": project, "into": ids["Drizzt Do'Urden"],
        "from_id": stub, "as_label": True,
    })
    node = next(n for n in _graph(project)["nodes"]
                if n["entity_id"] == ids["Drizzt Do'Urden"])
    assert node["display_name"] == "Drizzt"
    assert node["name"] == "Drizzt Do'Urden"
    assert "Drizzt" in node["aliases"]


def test_a_connection_shows_the_other_end_by_its_map_name(connected):
    ids, project = connected["ids"], connected["project"]
    stub = _make(project, "character", "Drizzt")
    client.post("/api/codex/absorb", json={
        "project_path": project, "into": ids["Drizzt Do'Urden"],
        "from_id": stub, "as_label": True,
    })
    assert "Drizzt" in {t["other_name"]
                        for t in _ties(project, ids["Guenhwyvar"])}
