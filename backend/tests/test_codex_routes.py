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
        "reason": "Trained her from the year she arrived",
    })
    assert response.status_code == 200
    ties = client.get("/api/codex/ties",
                      params={"project_path": project, "entity_id": "e-elara"}).json()
    assert ties["ties"][0]["rel"] == "mentored_by"


def test_the_other_end_of_a_tie_can_find_it(project):
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "Trained her from the year she arrived",
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
        "reason": "Trained her from the year she arrived",
    })
    assert _code(response) == "relation_not_allowed"
    assert "location" in response.json()["detail"]["message"]


def test_a_thread_cannot_connect_to_itself(project):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "loves", "dst_id": "e-elara",
        "reason": "Trained her from the year she arrived",
    })
    assert _code(response) == "tie_endpoint_invalid"


def test_a_tie_to_a_thread_that_does_not_exist_is_refused(project):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "loves", "dst_id": "e-ghost",
        "reason": "Trained her from the year she arrived",
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
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "Recorded so the connection exists"})
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert len(body["nodes"]) == 3
    assert len(body["edges"]) == 1
    assert body["edges"][0]["rel"] == "mentored_by"


def test_the_graph_draws_each_edge_once(project):
    # Ties are readable from both ends but stored once; drawing the incoming
    # copy too would double every line on the map.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "Recorded so the connection exists"})
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
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "Recorded so the connection exists"})

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

# ── Acts on the anchor list ──────────────────────────────────────────────────
# The scrubber draws acts as bands over the chapters they contain, so it needs
# the grouping. It comes from the SAME manifest the sidebar reads: two sources
# of truth about the shape of a book would eventually disagree, and the writer
# would have no way to tell which was lying.

def test_a_chapter_says_which_act_it_is_in(project):
    from app.utils.structure_store import load_structure, save_structure

    manifest, _ = load_structure(project)
    manifest["acts"] = [{"id": "a-one", "title": "Act I",
                         "chapters": ["01-a.md"]}]
    manifest["unassigned"] = []
    save_structure(project, manifest)

    chapters = client.get("/api/codex/anchors",
                          params={"project_path": project}).json()["chapters"]
    first = next(c for c in chapters if c["filename"] == "01-a.md")
    assert first["act_id"] == "a-one"
    assert first["act_title"] == "Act I"


def test_a_project_that_never_used_acts_says_nothing_rather_than_guessing(project):
    # The ordinary case. An invented act name would be worse than none.
    chapters = client.get("/api/codex/anchors",
                          params={"project_path": project}).json()["chapters"]
    assert all(c["act_id"] == "" and c["act_title"] == "" for c in chapters)


def test_the_order_is_still_the_reading_order(project):
    # Acts are extra information ABOUT the list, never a reordering of it --
    # ordered_chapter_filenames stays the single ordering authority.
    from app.utils.structure_store import (
        load_structure, ordered_chapter_filenames, save_structure,
    )
    manifest, _ = load_structure(project)
    manifest["acts"] = [{"id": "a-one", "title": "Act I",
                         "chapters": ["01-a.md"]}]
    manifest["unassigned"] = []
    save_structure(project, manifest)

    chapters = client.get("/api/codex/anchors",
                          params={"project_path": project}).json()["chapters"]
    assert [c["filename"] for c in chapters] == ordered_chapter_filenames(project)


# ── A connection with no reason is refused ───────────────────────────────────
#
# The rule that redirected the whole feature. The Weave exists so a writer can
# ask AI for help without pasting profiles and explaining context. Against that
# measure a bare edge is a cost with no benefit:
#
#     Alexandra -- connected to -- Dean               a name, nothing more
#     Alexandra -- is hiding her theft from -- Dean   the scene
#
# So the app refuses the first rather than collecting thousands of them and
# making every brief longer and no smarter.

def test_a_connection_with_no_reason_is_refused(project):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
    })
    assert _code(response) == "reason_required"


def test_a_reason_of_only_spaces_is_no_reason(project):
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick", "reason": "   \n  ",
    })
    assert _code(response) == "reason_required"


def test_the_refusal_says_why_it_matters_not_just_that_it_is_required(project):
    # "Reason is required" teaches nothing and reads as bureaucracy. The writer
    # needs to know this sentence is what gets sent to AI.
    response = client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
    })
    message = response.json()["detail"]["message"]
    assert "one line is enough" in message
    assert "sent to AI" in message


def test_the_reason_comes_back_on_the_connection(project):
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "Taught her everything, then vanished",
    })
    ties = client.get("/api/codex/ties",
                      params={"project_path": project,
                              "entity_id": "e-elara"}).json()["ties"]
    assert ties[0]["reason"] == "Taught her everything, then vanished"


def test_the_other_end_gets_the_reason_too(project):
    # Garrick's screen has to be able to say what this connection is, and only
    # one direction is ever stored.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "Taught her everything, then vanished",
        "reason_inverse": "His last student, and the one he regrets",
    })
    ties = client.get("/api/codex/ties",
                      params={"project_path": project,
                              "entity_id": "e-garrick"}).json()["ties"]
    assert ties[0]["reason_inverse"] == "His last student, and the one he regrets"


def test_a_wordy_reason_is_cut_to_the_budget_rather_than_refused(project):
    # Refusing it would lose the writer's sentence. The limit is arithmetic --
    # this line is multiplied by every connection in a brief -- so the honest
    # move is to keep what fits and let the UI stop them before they get here.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "x" * 400,
    })
    ties = client.get("/api/codex/ties",
                      params={"project_path": project,
                              "entity_id": "e-elara"}).json()["ties"]
    assert len(ties[0]["reason"]) == 140


def test_a_reason_pasted_over_two_lines_becomes_one(project):
    # A writer who pasted two lines meant both. Dropping the second half would
    # be worse than joining them.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara",
        "rel": "mentored_by", "dst_id": "e-garrick",
        "reason": "Taught her everything.\nThen vanished.",
    })
    ties = client.get("/api/codex/ties",
                      params={"project_path": project,
                              "entity_id": "e-elara"}).json()["ties"]
    assert ties[0]["reason"] == "Taught her everything. Then vanished."


def test_the_input_limit_travels_with_the_registry(project):
    # So the box the writer types in cannot be wider than what the backend will
    # keep. Duplicating the number in the frontend is how silent truncation
    # gets shipped.
    types = client.get("/api/codex/types",
                       params={"project_path": project}).json()
    assert types["reason_limit"] == 140


# ── A connection that changes across the book ────────────────────────────────
#
# Three ordinary scenarios were given as the test of whether the model could
# express real relationships:
#
#   "Chapter 2 Alexandra meets Dean through Lara = acquaintances. Chapter 4
#    Alexandra and Dean are friends. Chapter 8 Alexandra saves Deans life
#    becoming real friends."
#
# Only the never-changing one worked. A connection now has states, resolved by
# the same rule facts follow -- the PAIR is the axis -- and these hold what the
# HTTP surface has to do differently as a result.

def _state(project, rel, reason, at=None):
    body = {"project_path": project, "src_id": "e-elara",
            "rel": rel, "dst_id": "e-garrick", "reason": reason}
    if at:
        body["at"] = at
    return client.post("/api/codex/tie", json=body)


def test_the_same_relation_at_a_LATER_point_is_a_new_state(project):
    # They were friends, drifted, and were friends again. Refusing the third
    # would make a relationship that recovers impossible to record.
    anchor = _chapter_anchor(project)
    assert _state(project, "mentored_by", "Taught her everything").status_code == 200
    assert _state(project, "mentored_by", "Teaching her again, warier",
                  at=anchor).status_code == 200


def test_the_same_relation_at_the_SAME_point_is_still_a_duplicate(project):
    anchor = _chapter_anchor(project)
    _state(project, "mentored_by", "Taught her everything", at=anchor)
    response = _state(project, "mentored_by", "Said twice by mistake", at=anchor)
    assert _code(response) == "tie_endpoint_invalid"


def test_the_duplicate_refusal_says_WHERE(project):
    # "Already recorded" is confusing once a connection can be recorded at
    # several points. The writer needs to know which one collided.
    _state(project, "mentored_by", "Taught her everything")
    response = _state(project, "mentored_by", "Again")
    assert "no point in the story given" in response.json()["detail"]["message"]


# ── The map draws one line, not one per state ────────────────────────────────

def test_three_states_of_one_relationship_draw_ONE_edge(project):
    # Three lines stacked on each other would make a developing friendship look
    # like a crowd. It is one line whose LABEL changes as the writer scrubs.
    anchor = _chapter_anchor(project)
    _state(project, "mentored_by", "Taught her everything")
    _state(project, "mentored_by", "Teaching her again", at=anchor)
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert len(body["edges"]) == 1


def test_the_edge_drawn_is_the_one_in_force(project):
    anchor = _chapter_anchor(project)
    _state(project, "mentored_by", "Undated, so true from the start")
    _state(project, "mentored_by", "By this chapter, something else", at=anchor)
    body = client.get("/api/codex/graph",
                      params={"project_path": project, "at": anchor}).json()
    assert body["edges"][0]["reason"] == "By this chapter, something else"


def test_an_earlier_point_reads_the_earlier_state(project):
    # Scrubbing back is the whole feature.
    anchor = _chapter_anchor(project)
    _state(project, "mentored_by", "Undated, so true from the start")
    _state(project, "loves", "Only by this chapter", at=anchor)
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert body["edges"][0]["reason"] == "Only by this chapter"


def test_the_edge_carries_its_reason_so_the_map_can_label_it(project):
    _state(project, "mentored_by", "Taught her everything, then vanished")
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert body["edges"][0]["reason"] == "Taught her everything, then vanished"


def test_the_edge_says_WHEN_by_id_and_leaves_the_wording_to_the_client(project):
    # The map needs to say "since Chapter 4". It gets the id, and joins on the
    # chapter TITLES it already holds from /anchors -- a second source of titles
    # here is one more thing that can disagree with the scrubber.
    anchor = _chapter_anchor(project)
    _state(project, "mentored_by", "From here on", at=anchor)
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert body["edges"][0]["at"] == anchor


def test_an_undated_connection_still_draws(project):
    # Every connection made before states existed. Treating them as unplaced
    # would empty the map of every project that already has one.
    _state(project, "mentored_by", "Simply true of the whole book")
    body = client.get("/api/codex/graph", params={"project_path": project}).json()
    assert len(body["edges"]) == 1
    assert body["edges"][0]["active"] is True


# ── The plain connection has to be findable from the wire ────────────────────
#
# THE BUG THESE GUARD, because it stopped the feature dead and no frontend test
# caught it:
#
#     "I attempted to connect Alexandra to Lara Croft... None of the options
#      below were clickable, there was no 'accept' or 'save' or any means to
#      move foreward."
#
# The editor finds its primary Record-it button with `find(r => r.universal)`,
# and this endpoint never sent `universal`. So the button never rendered, for
# every project, and a writer who had typed their reason had nowhere to go.
#
# Every TieEditor test passed throughout, because their fixtures set the flag by
# hand -- a mock more generous than the API it stood for. The lesson is that a
# field the client BRANCHES on has to be pinned where it is produced, so these
# live here rather than there.

def test_the_plain_connection_is_marked_as_such(project):
    body = client.get("/api/codex/relations",
                      params={"project_path": project, "src_type": "character",
                              "dst_type": "character"}).json()
    plain = [r for r in body["forward"] if r.get("universal")]
    assert [r["id"] for r in plain] == ["connected_to"]


def test_every_relation_says_whether_it_is_the_plain_one(project):
    # Present on all of them, not only the one that is true -- the client reads
    # the key, and a missing key is indistinguishable from false until it isn't.
    body = client.get("/api/codex/relations",
                      params={"project_path": project, "src_type": "character",
                              "dst_type": "character"}).json()
    for key in ("forward", "reverse", "available"):
        for rel in body[key]:
            assert "universal" in rel, f"{key}: {rel['id']}"


def test_an_older_project_is_still_offered_the_plain_one(project):
    # types.json is the writer's file and is never rewritten behind them, so a
    # project converted before the plain connection existed does not have it.
    # It has to arrive under `available` still MARKED, or the only writers with a
    # save button would be the ones who started a project this week.
    import json as _json

    with open(os.path.join(project, "codex", "types.json"), "w",
              encoding="utf-8") as f:
        _json.dump({
            "schema_version": 1,
            "types": [{"id": "character", "label": "Character",
                       "folder": "characters", "icon": "User",
                       "sections": [{"id": "overview", "label": "Overview"}],
                       "required_fields": ["overview"]}],
            "relations": [{"id": "mentored_by", "label": "mentored by",
                           "source_types": ["character"],
                           "target_types": ["character"],
                           "cardinality": "many"}],
        }, f)

    body = client.get("/api/codex/relations",
                      params={"project_path": project, "src_type": "character",
                              "dst_type": "character"}).json()
    assert not any(r.get("universal") for r in body["forward"])
    offered = [r["id"] for r in body["available"] if r.get("universal")]
    assert offered == ["connected_to"]


# ── The other end may be a different relation entirely ───────────────────────
#
# Requested in these words: "Other way around works the same way because it
# could be very differently from the perspective of the other character /
# Alexandra friends of Lara Croft / in reverse / Lara Croft business partners
# with Alexandra."
#
# The registry's `inverse` is a DERIVATION -- mentored_by reads as mentor of --
# and no derivation could produce "business partners with" from "friend of".
# Both descriptions are true; they are just true from different ends.

def test_a_connection_can_read_as_a_different_relation_from_the_other_end(project):
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "dst_id": "e-garrick",
        "rel": "mentored_by", "rel_inverse": "rivals",
        "reason": "Taught her everything",
        "reason_inverse": "The student who outgrew him",
    })
    garrick = client.get("/api/codex/ties",
                         params={"project_path": project,
                                 "entity_id": "e-garrick"}).json()["ties"][0]
    assert garrick["reads_as"] == "rival of"


def test_without_one_it_still_derives_the_inverse(project):
    # The default, and right almost always -- which is why saying it is optional.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "dst_id": "e-garrick",
        "rel": "mentored_by", "reason": "Taught her everything",
    })
    garrick = client.get("/api/codex/ties",
                         params={"project_path": project,
                                 "entity_id": "e-garrick"}).json()["ties"][0]
    assert garrick["reads_as"] == "mentor of"


def test_the_end_that_owns_it_reads_its_own_relation(project):
    # The override is about the OTHER end. Elara still mentored-by Garrick.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "dst_id": "e-garrick",
        "rel": "mentored_by", "rel_inverse": "rivals",
        "reason": "Taught her everything",
    })
    elara = client.get("/api/codex/ties",
                       params={"project_path": project,
                               "entity_id": "e-elara"}).json()["ties"][0]
    assert elara["reads_as"] == "mentored by"


def test_a_reverse_relation_the_registry_does_not_know_is_still_readable(project):
    # Readable rather than dropped: dropping it would silently substitute the
    # derived inverse, which is a different statement about the world.
    client.post("/api/codex/tie", json={
        "project_path": project, "src_id": "e-elara", "dst_id": "e-garrick",
        "rel": "mentored_by", "rel_inverse": "kept_at_arms_length",
        "reason": "Taught her everything",
    })
    garrick = client.get("/api/codex/ties",
                         params={"project_path": project,
                                 "entity_id": "e-garrick"}).json()["ties"][0]
    assert garrick["reads_as"] == "kept at arms length"
