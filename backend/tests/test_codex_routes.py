# tests/test_codex_routes.py -- the Weave's HTTP surface
# =======================================================
# The router is deliberately thin -- anchors, resolution, the registry and
# migration are all tested directly elsewhere. What these tests cover is the
# things only the HTTP layer can get wrong:
#
#   - refusing with a STABLE CODE the frontend can branch on, not a string
#   - guarding paths, so a request cannot point the app outside a project
#   - never serving a stale index, without each route remembering to check
#   - defaulting the destructive operation to its preview

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.codex.errors import CODES
from app.main import app

client = TestClient(app)

CHARACTER = """---
type: character
entity_id: e-elara
name: Elara Voss
---

# Overview
A tall woman.

# Run
- id: f-1
  at: c-CHAPTER/s-x
  axis: belief.father
  value: "Believes her father died."
  frame: e-elara
  ai_scope: always
"""

GARRICK = """---
type: character
entity_id: e-garrick
name: Garrick Vale
---

# Overview
In hiding.
"""

RAVENSMOOR = """---
type: location
entity_id: e-ravensmoor
name: Ravensmoor
---

# Overview
A cold place.
"""


@pytest.fixture
def project(tmp_path):
    """A migrated project with two characters, a location and one chapter."""
    from app.utils.structure_store import ensure_chapter_ids

    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "codex" / "locations").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-a.md").write_text("# Chapter One\n\nText.\n", encoding="utf-8")

    # Chapter ids are minted lazily and randomly, so the fixture cannot
    # hardcode the anchor its fact is pinned to -- mint first, then write.
    chapter_id = ensure_chapter_ids(str(root))["01-a.md"]

    (root / "codex" / "characters" / "elara.md").write_text(
        CHARACTER.replace("c-CHAPTER", chapter_id), encoding="utf-8")
    (root / "codex" / "characters" / "garrick.md").write_text(GARRICK, encoding="utf-8")
    (root / "codex" / "locations" / "ravensmoor.md").write_text(RAVENSMOOR, encoding="utf-8")
    return str(root)


def _chapter_anchor(project: str) -> str:
    return client.get("/api/codex/anchors",
                      params={"project_path": project}).json()["chapters"][0]["anchor"]


def _code(response) -> str:
    return response.json()["detail"]["code"]


# ── The error contract ───────────────────────────────────────────────────────

def test_a_missing_thread_refuses_with_a_branchable_code(project):
    response = client.get("/api/codex/entity",
                          params={"project_path": project, "entity_id": "e-nope"})
    assert response.status_code == 404
    body = response.json()["detail"]
    assert body["code"] == "entity_not_found"
    # And a sentence a novelist can act on, not a field name.
    assert body["message"].strip().endswith(".")


def test_every_code_the_router_raises_is_in_the_closed_set(project):
    # Adding a code must be a deliberate act, or the frontend ends up
    # branching on strings that were never agreed.
    failures = [
        client.get("/api/codex/entity",
                   params={"project_path": project, "entity_id": "e-nope"}),
        client.get("/api/codex/list",
                   params={"project_path": project, "type": "dragon"}),
        client.delete("/api/codex/tie",
                      params={"project_path": project, "src_id": "e-elara",
                              "rel": "loves", "dst_id": "e-garrick"}),
    ]
    for response in failures:
        assert _code(response) in CODES


def test_an_unknown_type_is_refused_by_name(project):
    response = client.get("/api/codex/list",
                          params={"project_path": project, "type": "dragon"})
    assert _code(response) == "type_invalid"
    assert "dragon" in response.json()["detail"]["message"]


def test_a_corrupt_registry_refuses_and_says_where(project):
    with open(os.path.join(project, "codex", "types.json"), "w", encoding="utf-8") as f:
        f.write('{"schema_version": 1, "types": [ oops }')
    response = client.get("/api/codex/types", params={"project_path": project})
    assert _code(response) == "source_corrupt"
    # The writer needs the line, not just "invalid".
    assert "line" in response.json()["detail"]["detail"]


# ── Path guarding ────────────────────────────────────────────────────────────

def test_a_folder_that_is_not_a_project_is_refused(tmp_path):
    plain = tmp_path / "just-a-folder"
    plain.mkdir()
    response = client.get("/api/codex/list", params={"project_path": str(plain)})
    assert response.status_code == 404
    assert "not a Storythread project" in response.json()["detail"]


def test_a_nonexistent_folder_is_refused(tmp_path):
    response = client.get("/api/codex/list",
                          params={"project_path": str(tmp_path / "nowhere")})
    assert response.status_code == 404


def test_an_empty_project_path_is_refused(tmp_path):
    assert client.get("/api/codex/list", params={"project_path": ""}).status_code == 400


# ── Reading ──────────────────────────────────────────────────────────────────

def test_listing_returns_every_thread(project):
    body = client.get("/api/codex/list", params={"project_path": project}).json()
    assert {t["name"] for t in body["threads"]} == \
        {"Elara Voss", "Garrick Vale", "Ravensmoor"}


def test_listing_filters_by_type(project):
    body = client.get("/api/codex/list",
                      params={"project_path": project, "type": "location"}).json()
    assert [t["name"] for t in body["threads"]] == ["Ravensmoor"]


def test_reading_a_thread_returns_its_run(project):
    body = client.get("/api/codex/entity",
                      params={"project_path": project, "entity_id": "e-elara"}).json()
    assert body["name"] == "Elara Voss"
    assert body["run"][0]["axis"] == "belief.father"


def test_a_thread_added_on_disk_appears_without_a_reindex_call(project):
    # The freshness gate lives inside the store, so no route has to remember.
    with open(os.path.join(project, "codex", "characters", "new.md"), "w",
              encoding="utf-8") as f:
        f.write(GARRICK.replace("e-garrick", "e-new").replace("Garrick Vale", "New Person"))
    body = client.get("/api/codex/list", params={"project_path": project}).json()
    assert "New Person" in {t["name"] for t in body["threads"]}


def test_health_reports_state_without_doing_the_work(project):
    body = client.get("/api/codex/health", params={"project_path": project}).json()
    assert body["registry_ok"] is True
    assert body["migration_state"] in {"none", "done", "incomplete"}
    # It reported dirty and did NOT quietly rebuild -- a status call a UI
    # polls must stay cheap.
    assert body["index_dirty"] is True
    assert client.get("/api/codex/health",
                      params={"project_path": project}).json()["index_dirty"] is True


# ── Anchors ──────────────────────────────────────────────────────────────────

def test_anchors_list_the_chapters_in_reading_order(project):
    body = client.get("/api/codex/anchors", params={"project_path": project}).json()
    assert len(body["chapters"]) == 1
    assert body["chapters"][0]["title"] == "Chapter One"
    assert body["chapters"][0]["anchor"].startswith("c-")


def test_anchors_do_not_return_ordinals(project):
    # They are computed from the CURRENT order and would be stale by the time
    # the frontend used them. The list is already in order.
    chapter = client.get("/api/codex/anchors",
                         params={"project_path": project}).json()["chapters"][0]
    assert "ordinal" not in chapter


# ── Ties ─────────────────────────────────────────────────────────────────────

def test_a_tie_can_be_created_and_read_back(project):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
    })
    assert response.status_code == 200
    ties = client.get("/api/codex/ties",
                      params={"project_path": project, "entity_id": "e-elara"}).json()
    assert ties["ties"][0]["rel"] == "mentored_by"


def test_the_other_end_of_a_tie_can_find_it(project):
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
    })
    ties = client.get("/api/codex/ties",
                      params={"project_path": project, "entity_id": "e-garrick"}).json()
    assert ties["ties"][0]["incoming"] is True


def test_a_relation_that_makes_no_sense_between_two_types_is_refused(project):
    # The REGISTRY decides, not the router -- so a writer's own custom
    # relation works with no code change.
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-ravensmoor",
        "rel": "mentored_by", "dst_id": "e-garrick",
    })
    assert _code(response) == "relation_not_allowed"
    assert "location" in response.json()["detail"]["message"]


def test_a_thread_cannot_connect_to_itself(project):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "loves", "dst_id": "e-elara",
    })
    assert _code(response) == "tie_endpoint_invalid"


def test_a_tie_to_a_thread_that_does_not_exist_is_refused(project):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "loves", "dst_id": "e-ghost",
    })
    assert _code(response) == "entity_not_found"


# ── Facts ────────────────────────────────────────────────────────────────────

def test_a_fact_can_be_added_at_a_real_anchor(project):
    anchor = _chapter_anchor(project)
    response = client.post("/api/codex/fact", json={
        "project_path": project, "entity_id": "e-elara",
        "fact": {"axis": "status", "value": "wounded", "at": anchor, "frame": "truth"},
    })
    assert response.status_code == 200
    body = client.get("/api/codex/entity",
                      params={"project_path": project, "entity_id": "e-elara"}).json()
    assert any(f["value"] == "wounded" for f in body["run"])


def test_a_fact_pinned_to_a_chapter_that_does_not_exist_is_refused(project):
    # An unresolvable anchor may EXIST (the resolver reports those as
    # unplaced), but accepting a brand new one would be creating the problem
    # rather than tolerating it.
    response = client.post("/api/codex/fact", json={
        "project_path": project, "entity_id": "e-elara",
        "fact": {"axis": "status", "value": "x", "at": "c-GONE/s-y"},
    })
    assert _code(response) == "anchor_not_found"


def test_a_fact_can_be_deleted(project):
    response = client.delete("/api/codex/fact", params={
        "project_path": project, "entity_id": "e-elara", "fact_id": "f-1"})
    assert response.status_code == 200
    body = client.get("/api/codex/entity",
                      params={"project_path": project, "entity_id": "e-elara"}).json()
    assert body["run"] == []


def test_deleting_a_fact_that_is_not_there_is_refused(project):
    response = client.delete("/api/codex/fact", params={
        "project_path": project, "entity_id": "e-elara", "fact_id": "f-nope"})
    assert _code(response) == "fact_not_found"


# ── Saving ───────────────────────────────────────────────────────────────────

def test_saving_a_thread_writes_it_and_returns_a_revision(project):
    thread = client.get("/api/codex/entity",
                        params={"project_path": project, "entity_id": "e-elara"}).json()
    thread["sections"]["overview"]["content"] = "Rewritten."
    response = client.post("/api/codex/entity",
                           json={"project_path": project, "thread": thread})
    assert response.status_code == 200
    assert response.json()["revision"].startswith("rev-")

    again = client.get("/api/codex/entity",
                       params={"project_path": project, "entity_id": "e-elara"}).json()
    assert again["sections"]["overview"]["content"] == "Rewritten."


def test_saving_over_somebody_elses_change_is_refused(project):
    thread = client.get("/api/codex/entity",
                        params={"project_path": project, "entity_id": "e-elara"}).json()
    stale = "rev-something-older"
    response = client.post("/api/codex/entity", json={
        "project_path": project, "thread": thread, "base_revision": stale})
    assert _code(response) == "version_conflict"


def test_two_threads_may_not_share_an_id(project):
    thread = client.get("/api/codex/entity",
                        params={"project_path": project, "entity_id": "e-garrick"}).json()
    thread["entity_id"] = "e-elara"          # collide with the other file
    response = client.post("/api/codex/entity",
                           json={"project_path": project, "thread": thread})
    assert _code(response) == "duplicate_entity_id"


def test_two_facts_on_one_thread_may_not_share_an_id(project):
    thread = client.get("/api/codex/entity",
                        params={"project_path": project, "entity_id": "e-elara"}).json()
    thread["run"].append(dict(thread["run"][0]))
    response = client.post("/api/codex/entity",
                           json={"project_path": project, "thread": thread})
    assert _code(response) == "duplicate_fact_id"


def test_deleting_a_thread_removes_it(project):
    assert client.delete("/api/codex/entity", params={
        "project_path": project, "entity_id": "e-ravensmoor"}).status_code == 200
    body = client.get("/api/codex/list", params={"project_path": project}).json()
    assert "Ravensmoor" not in {t["name"] for t in body["threads"]}


# ── Resolution and the graph ─────────────────────────────────────────────────

def test_resolving_asks_who_a_thread_is_at_a_point(project):
    anchor = _chapter_anchor(project)
    body = client.get("/api/codex/resolve", params={
        "project_path": project, "entity_id": "e-elara",
        "at": anchor, "pov": "e-elara"}).json()
    assert body["as_of"] == anchor
    assert [f["value"] for f in body["run"]] == ["Believes her father died."]


def test_resolving_reports_ambiguity_as_a_readable_sentence(project):
    anchor = _chapter_anchor(project)
    client.post("/api/codex/fact", json={
        "project_path": project, "entity_id": "e-elara",
        "fact": {"id": "f-a", "axis": "status", "value": "one", "at": anchor}})
    client.post("/api/codex/fact", json={
        "project_path": project, "entity_id": "e-elara",
        "fact": {"id": "f-b", "axis": "status", "value": "two", "at": anchor}})

    body = client.get("/api/codex/resolve", params={
        "project_path": project, "entity_id": "e-elara", "at": anchor}).json()
    assert len(body["ambiguities"]) == 1
    assert "same point" in body["ambiguities"][0]["message"]
    assert not any(f["axis"] == "status" for f in body["run"])


def test_the_graph_returns_nodes_and_edges(project):
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick"})
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert len(body["nodes"]) == 3
    assert len(body["edges"]) == 1
    assert body["edges"][0]["rel"] == "mentored_by"


def test_the_graph_draws_each_edge_once(project):
    # Ties are readable from both ends but stored once; drawing the incoming
    # copy too would double every line on the map.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick"})
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert len(body["edges"]) == 1


def test_a_secret_tie_is_not_drawn_before_the_reader_learns_of_it(project):
    # Hiding the secret FACT while drawing a labelled edge that announces it
    # would leak exactly what spoiler mode protects.
    anchor = _chapter_anchor(project)
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "rel": "married_to",
        "dst_id": "e-garrick", "at": anchor, "revealed_at": "c-LATER"})
    body = client.get("/api/codex/graph",
                      params={"project_path": project, "at": anchor}).json()
    assert body["edges"] == []


def test_an_author_only_tie_is_never_drawn(project):
    anchor = _chapter_anchor(project)
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "rel": "married_to",
        "dst_id": "e-garrick", "at": anchor, "ai_scope": "never"})
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert body["edges"] == []


def test_a_public_tie_to_an_author_only_thread_is_not_drawn(project):
    # The generalisation of the secret-Tie bug. An edge asserts three things
    # at once -- that both ends exist and that they are related -- so judging
    # only the middle one leaks the other two. A perfectly public marriage to
    # a character the reader never meets still puts that character on screen.
    thread = client.get("/api/codex/entity",
                        params={"project_path": project, "entity_id": "e-garrick"}).json()
    thread["ai_scope"] = "never"
    client.post("/api/codex/entity", json={"project_path": project, "thread": thread})

    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick"})

    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert "e-garrick" not in {n["entity_id"] for n in body["nodes"]}
    assert body["edges"] == []
    # Reported, not silent: a map that quietly omits things looks like a
    # world with less in it than the writer built.
    assert body["hidden_nodes"] >= 1


def test_an_author_only_thread_is_not_a_node_at_all(project):
    # The graph used to return every Thread unfiltered, so an author-only
    # entry was drawn whatever its scope said.
    thread = client.get("/api/codex/entity",
                        params={"project_path": project, "entity_id": "e-garrick"}).json()
    thread["ai_scope"] = "never"
    client.post("/api/codex/entity", json={"project_path": project, "thread": thread})

    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    names = {n["name"] for n in body["nodes"]}
    assert "Garrick Vale" not in names
    assert "Elara Voss" in names


def test_the_graph_never_leaves_an_edge_dangling(project):
    # Whatever is hidden, every edge returned must have both endpoints in the
    # node list -- a map cannot draw a line to something that is not there.
    anchor = _chapter_anchor(project)
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "rel": "mentored_by",
        "dst_id": "e-garrick", "at": anchor})

    for hide in (True, False):
        body = client.get("/api/codex/graph", params={
            "project_path": project, "at": anchor, "hide_spoilers": hide}).json()
        ids = {n["entity_id"] for n in body["nodes"]}
        for edge in body["edges"]:
            assert edge["src_id"] in ids and edge["dst_id"] in ids


# ── Migration ────────────────────────────────────────────────────────────────

def test_migrate_defaults_to_the_preview(tmp_path):
    # The destructive form has to be asked for. A client that forgets the
    # parameter must get the preview, not a rewrite of the writer's files.
    root = tmp_path / "Old"
    (root / "profiles" / "characters").mkdir(parents=True)
    (root / "project.json").write_text("{}", encoding="utf-8")
    (root / "profiles" / "characters" / "x.md").write_text(
        "---\ntype: character\nprofile_id: 1\nname: X\n---\n\n# Overview\nA.\n",
        encoding="utf-8")

    body = client.post("/api/codex/migrate", params={"project_path": str(root)}).json()
    assert body["total"] == 1
    assert not os.path.exists(os.path.join(str(root), "codex"))
