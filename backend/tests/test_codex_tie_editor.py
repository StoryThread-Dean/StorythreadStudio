# tests/test_codex_tie_editor.py -- recording a connection by hand
# ================================================================
# The case that drove this, from live testing:
#
#     "The Daughters of Pathicus are a faction. The word Cult means them.
#      Pathicus is a deity. A religion of Pathicus exists too, because the
#      Daughters worship him. The AI and app might not recognise any of these
#      connections directly, but the writer would."
#
# Four entries, three kinds, and every link obvious to the writer and
# invisible to any rule. Absorbing handles the WORD (Cult means the faction).
# This is the other half: the writer saying how the things themselves relate.
#
# THE TWO THINGS THAT HAVE TO HOLD
# --------------------------------
# 1. THE VOCABULARY MUST NOT BE A DEAD END. The shipped list of ways things
#    connect will always be short of somebody's invented world. Before this
#    work a faction could not worship a deity at all -- there was no relation
#    that ran between those kinds -- and a writer meeting "nothing fits" had
#    nowhere to go. Now there are shipped relations for those kinds, and a
#    writer can name their own when even that is short.
#
# 2. THE REGISTRY DECIDES, NOT THE ROUTER. What is meaningful between two
#    kinds is read from types.json, which is the writer's own file. That is
#    what makes a custom relation work everywhere with no further change --
#    and it is why relations this build ships with are OFFERED to an older
#    project rather than written into its file behind its back.

import json

import pytest
from fastapi.testclient import TestClient

from app.codex.types_registry import (
    TypesError, add_relation, adopt_relation, load_registry, relation_by_id,
    relation_id, relations_between, shipped_relations_between,
)
from app.main import app

client = TestClient(app)


def _entry(root, folder, entity_id, name, type_id):
    path = root / "codex" / folder
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{entity_id}.md").write_text(
        f"---\ntype: {type_id}\nentity_id: {entity_id}\nname: {name}\n---\n\n"
        f"# Overview\nSomething.\n", encoding="utf-8")


@pytest.fixture
def project(tmp_path):
    """The reported world: a faction, a deity, a religion, and a character."""
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    _entry(root, "factions", "e-daughters", "Daughters of Pathicus", "faction")
    _entry(root, "deities", "e-pathicus", "Pathicus", "deity")
    _entry(root, "religions", "e-faith", "The Faith of Pathicus", "religion")
    _entry(root, "characters", "e-elara", "Elara Voss", "character")
    return str(root)


def _relations(project, src, dst):
    return client.get("/api/codex/relations",
                      params={"project_path": project, "src_type": src,
                              "dst_type": dst}).json()


def _tie(project, src, rel, dst, **kw):
    return client.post("/api/codex/tie",
                       json={"project_path": project, "src_id": src,
                             "rel": rel, "dst_id": dst, **kw})


def _ties(project, entity_id):
    return client.get("/api/codex/ties",
                      params={"project_path": project,
                              "entity_id": entity_id}).json()["ties"]


# ── The reported world can now be expressed ─────────────────────────────────

def test_a_faction_can_worship_a_deity(project):
    # It could not before. There was no relation running between those kinds,
    # so the writer's most obvious statement about their world was unsayable.
    assert _tie(project, "e-daughters", "worships", "e-pathicus").status_code == 200


def test_a_religion_can_worship_the_deity_it_is_named_for(project):
    assert _tie(project, "e-faith", "worships", "e-pathicus").status_code == 200


def test_a_faction_can_be_part_of_a_religion(project):
    assert _tie(project, "e-daughters", "part_of", "e-faith").status_code == 200


def test_the_whole_cluster_holds_together(project):
    # Faction worships deity, faction part of religion, religion worships
    # deity. Three statements, three kinds, none of which a scan could infer.
    _tie(project, "e-daughters", "worships", "e-pathicus")
    _tie(project, "e-daughters", "part_of", "e-faith")
    _tie(project, "e-faith", "worships", "e-pathicus")

    faction = {(t["rel"], t["other_id"]) for t in _ties(project, "e-daughters")}
    assert faction == {("worships", "e-pathicus"), ("part_of", "e-faith")}
    # And the deity knows about both, from the other side.
    deity = {t["other_id"] for t in _ties(project, "e-pathicus")}
    assert deity == {"e-daughters", "e-faith"}


# ── What the editor is offered ──────────────────────────────────────────────

def test_the_editor_is_told_what_runs_between_two_kinds(project):
    body = _relations(project, "faction", "deity")
    assert "worships" in {r["id"] for r in body["forward"]}


def test_it_is_also_told_what_runs_the_OTHER_way(project):
    # So the editor can offer to turn the pair around, rather than making the
    # writer work out that "governed by" is "governs" backwards.
    body = _relations(project, "location", "government")
    assert "governs" in {r["id"] for r in body["reverse"]}
    assert all(r["flipped"] for r in body["reverse"])


def test_a_relation_says_what_the_other_end_reads_as(project):
    body = _relations(project, "faction", "location")
    governs = next(r for r in body["forward"] if r["id"] == "governs")
    assert governs["inverse_label"] == "governed by"


def _named(body, key="forward"):
    """The relations that say something, excluding the plain one.

    The plain "connected to" runs between anything, so it is present for every
    pair by design. A test about the NAMED vocabulary has to look past it.
    """
    return [r for r in body[key] if r["id"] != "connected_to"]


def test_a_pair_with_no_NAMED_connection_still_has_the_plain_one(project):
    # There is no such thing as two things that cannot be connected. What can
    # be missing is a word for HOW, and that is a different sentence.
    body = _relations(project, "deity", "character")
    assert _named(body) == []
    assert "connected_to" in {r["id"] for r in body["forward"]}


# ── An older project is offered what it is missing ──────────────────────────

def test_a_world_missing_a_shipped_relation_is_offered_it(project):
    # types.json is the writer's own file and is never silently modified, so a
    # project converted before the vocabulary grew simply does not have the
    # newer relations. "Nothing fits" would be a lie; this is the truth.
    registry, _ = load_registry(project)
    registry["relations"] = [r for r in registry["relations"]
                             if r["id"] != "worships"]
    from app.codex.types_registry import _write_registry
    _write_registry(project, registry)

    body = _relations(project, "faction", "deity")
    assert _named(body) == []
    assert "worships" in {r["id"] for r in body["available"]}


def test_adopting_one_writes_it_into_this_world(project):
    registry, _ = load_registry(project)
    registry["relations"] = [r for r in registry["relations"]
                             if r["id"] != "worships"]
    from app.codex.types_registry import _write_registry
    _write_registry(project, registry)

    client.post("/api/codex/relation",
                json={"project_path": project, "adopt": "worships"})
    assert relation_by_id(load_registry(project)[0], "worships") is not None
    assert _tie(project, "e-daughters", "worships", "e-pathicus").status_code == 200


def test_adopting_twice_is_harmless(project):
    adopt_relation(project, "worships")
    adopt_relation(project, "worships")
    relations = load_registry(project)[0]["relations"]
    assert len([r for r in relations if r["id"] == "worships"]) == 1


def test_adopting_something_this_app_does_not_ship_is_refused(project):
    with pytest.raises(TypesError, match="ships with"):
        adopt_relation(project, "invented_by_a_client")


def test_a_relation_is_never_offered_for_kinds_this_world_lacks(project):
    registry, _ = load_registry(project)
    registry["types"] = [t for t in registry["types"] if t["id"] != "deity"]
    registry["relations"] = [
        r for r in registry["relations"]
        if "deity" not in r["source_types"] and "deity" not in r["target_types"]
    ]
    from app.codex.types_registry import _write_registry
    _write_registry(project, registry)

    assert shipped_relations_between(load_registry(project)[0],
                                     "faction", "deity") == []


# ── A writer naming their own ───────────────────────────────────────────────

def test_a_writer_can_name_a_connection_the_app_never_thought_of(project):
    # The shipped vocabulary will always be short of somebody's world, and a
    # tool for writing invented cultures cannot pretend otherwise.
    body = client.post("/api/codex/relation", json={
        "project_path": project, "label": "Sworn to destroy",
        "source_types": ["faction"], "target_types": ["deity"],
    }).json()
    assert body["id"] == "sworn_to_destroy"
    assert _tie(project, "e-daughters", "sworn_to_destroy",
                "e-pathicus").status_code == 200


def test_the_id_is_derived_so_the_writer_never_types_one(project):
    assert relation_id("Sworn enemy of") == "sworn_enemy_of"
    assert relation_id("  bound  BY  blood ") == "bound_by_blood"


def test_a_name_with_no_letters_in_it_is_refused(project):
    with pytest.raises(TypesError, match="letters"):
        add_relation(project, "!!!", ["faction"], ["deity"])


def test_a_duplicate_connection_name_is_refused(project):
    with pytest.raises(TypesError, match="already has a connection"):
        add_relation(project, "Worships", ["faction"], ["deity"])


def test_a_connection_to_a_kind_this_world_lacks_is_refused(project):
    # Writing it would produce a types.json that then fails its own validator,
    # which is the worst possible outcome for the writer's own file.
    with pytest.raises(TypesError, match="no 'dragon' in this world"):
        add_relation(project, "Rides", ["character"], ["dragon"])


def test_a_connection_needs_an_end_at_each_side(project):
    with pytest.raises(TypesError, match="a kind at each end"):
        add_relation(project, "Floats", ["faction"], [])


def test_a_custom_connection_can_be_symmetric(project):
    add_relation(project, "Twinned with", ["faction"], ["faction"],
                 symmetric=True)
    rel = relation_by_id(load_registry(project)[0], "twinned_with")
    assert rel["symmetric"] is True


def test_a_custom_connection_can_name_its_other_half(project):
    add_relation(project, "Hunts", ["faction"], ["creature"],
                 inverse_label="Hunted by")
    rel = relation_by_id(load_registry(project)[0], "hunts")
    assert rel["inverse"] == "hunted_by"


def test_a_custom_connection_appears_in_what_runs_between_two_kinds(project):
    # The registry decides, not the router. This is what makes a writer's own
    # relation work everywhere with no further change.
    add_relation(project, "Sworn to destroy", ["faction"], ["deity"])
    assert "sworn_to_destroy" in {
        r["id"] for r in relations_between(load_registry(project)[0],
                                           "faction", "deity")}


# ── How a connection reads from each end ────────────────────────────────────

def test_a_connection_reads_correctly_from_the_end_being_looked_at(project):
    # An incoming "mentored by" is "mentor of" from the other side. Showing the
    # stored direction would make the writer translate it in their head.
    _tie(project, "e-faith", "part_of", "e-daughters")

    faith = _ties(project, "e-faith")[0]
    assert faith["reads_as"] == "part of"
    daughters = _ties(project, "e-daughters")[0]
    assert daughters["reads_as"] == "contains"


def test_a_symmetric_connection_reads_the_same_both_ways(project):
    add_relation(project, "Twinned with", ["faction"], ["faction"],
                 symmetric=True)
    _entry(__import__("pathlib").Path(project), "factions", "e-sons",
           "Sons of Pathicus", "faction")
    _tie(project, "e-daughters", "twinned_with", "e-sons")
    assert _ties(project, "e-sons")[0]["reads_as"] == "Twinned with"


def test_a_connection_carries_the_other_end_by_NAME(project):
    _tie(project, "e-daughters", "worships", "e-pathicus")
    assert _ties(project, "e-daughters")[0]["other_name"] == "Pathicus"


def test_a_labelled_entry_is_shown_by_its_label(project):
    # The map calls her Lexa; so should a connection to her.
    import os
    path = os.path.join(project, "codex", "characters", "e-elara.md")
    text = open(path, encoding="utf-8").read()
    with open(path, "w", encoding="utf-8") as f:
        f.write(text.replace("name: Elara Voss",
                             "name: Elara Voss\ndisplay_name: Elara\naliases:\n  - Elara"))
    _tie(project, "e-elara", "member_of", "e-daughters")
    assert _ties(project, "e-daughters")[0]["other_name"] == "Elara"


# ── Refusals and warnings ───────────────────────────────────────────────────

def test_a_connection_that_makes_no_sense_between_two_kinds_is_refused(project):
    response = _tie(project, "e-pathicus", "born_in", "e-elara")
    assert response.json()["detail"]["code"] == "relation_not_allowed"


def test_an_entry_cannot_connect_to_itself(project):
    assert _tie(project, "e-daughters", "part_of",
                "e-daughters").json()["detail"]["code"] == "tie_endpoint_invalid"


def test_the_same_connection_twice_is_refused(project):
    # Not a second fact about the world, and it would draw two identical edges
    # and count twice against a one-at-a-time limit.
    _tie(project, "e-daughters", "worships", "e-pathicus")
    response = _tie(project, "e-daughters", "worships", "e-pathicus")
    assert response.json()["detail"]["code"] == "tie_endpoint_invalid"
    assert "already recorded" in response.json()["detail"]["message"]


def test_a_one_at_a_time_limit_WARNS_rather_than_refusing(project):
    # Usually a mistake, sometimes a story: a disputed throne, a marriage
    # nobody annulled. The app is not entitled to decide which, so it says so
    # and records what the writer asked for.
    import pathlib
    _entry(pathlib.Path(project), "governments", "e-crown", "The Crown",
           "government")
    _entry(pathlib.Path(project), "locations", "e-vale", "The Vale", "location")
    _entry(pathlib.Path(project), "locations", "e-moor", "Ravensmoor", "location")

    add_relation(project, "Seat of", ["government"], ["location"])
    registry, _ = load_registry(project)
    for rel in registry["relations"]:
        if rel["id"] == "seat_of":
            rel["cardinality"] = "one"
    from app.codex.types_registry import _write_registry
    _write_registry(project, registry)

    assert _tie(project, "e-crown", "seat_of", "e-vale").json()["warnings"] == []
    second = _tie(project, "e-crown", "seat_of", "e-moor").json()
    assert second["created"] is True
    assert any("one at a time" in w for w in second["warnings"])


def test_removing_a_connection_leaves_the_entries_alone(project):
    _tie(project, "e-daughters", "worships", "e-pathicus")
    client.request("DELETE", "/api/codex/tie",
                   params={"project_path": project, "src_id": "e-daughters",
                           "rel": "worships", "dst_id": "e-pathicus"})
    assert _ties(project, "e-daughters") == []
    # Both entries are still there. Removing a connection is not removing a
    # thing, and a writer must never have to wonder.
    assert client.get("/api/codex/entity",
                      params={"project_path": project,
                              "entity_id": "e-pathicus"}).status_code == 200
