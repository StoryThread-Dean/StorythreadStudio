# tests/test_codex_weaving_routes.py -- Weaving over HTTP
# ========================================================
# The scan, the run ledger and the brief, end to end. The modules underneath
# are tested directly elsewhere; what only the HTTP layer can get wrong is
# here:
#
#   - the free pass staying free (no role, no model, no cost)
#   - the two-phase contract surviving a round trip through the wire
#   - /context ASSEMBLING and RETURNING rather than sending
#   - a run id from a request being treated as untrusted input

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils.structure_store import ensure_chapter_ids

client = TestClient(app)

ELARA = """---
type: character
entity_id: e-elara
name: Elara Voss
aliases:
  - Elara
ties:
  - rel: mentored_by
    target: e-garrick
---

# Overview
A tall woman.

# Run
- id: f-1
  at: c-CHAPTER
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

THIN = """---
type: character
entity_id: e-thin
name: Mira Kell
---

# Overview
"""


@pytest.fixture
def project(tmp_path):
    """Two connected characters, one thin unconnected one, two chapters."""
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-a.md").write_text(
        "# Chapter One\n\nElara waited. Rhoswen watched.\n", encoding="utf-8")
    (root / "manuscript" / "02-b.md").write_text(
        "# Chapter Two\n\nRhoswen did not answer.\n", encoding="utf-8")

    chapter_id = ensure_chapter_ids(str(root))["01-a.md"]
    (root / "codex" / "characters" / "elara.md").write_text(
        ELARA.replace("c-CHAPTER", chapter_id), encoding="utf-8")
    (root / "codex" / "characters" / "garrick.md").write_text(GARRICK, encoding="utf-8")
    (root / "codex" / "characters" / "mira.md").write_text(THIN, encoding="utf-8")
    return str(root)


def _scan(project, **kw):
    return client.post("/api/codex/scan",
                       json={"project_path": project, **kw}).json()


def _kinds(body):
    return {s["kind"] for s in body["stops"]}


# ── The free pass ────────────────────────────────────────────────────────────

def test_the_scan_finds_stops_without_any_model(project):
    body = _scan(project)
    assert body["stops"]
    assert body["total"] == len(body["stops"])


def test_every_stop_can_say_why_it_is_there(project):
    # A walkthrough that cannot explain itself trains the writer to click
    # through it.
    for stop in _scan(project)["stops"]:
        assert stop["why"].strip()
        assert stop["key"] and stop["kind"]


def test_the_thin_thread_and_the_unknown_name_are_both_found(project):
    kinds = _kinds(_scan(project))
    assert "frayed" in kinds          # Mira Kell has an empty Overview
    assert "unspun" in kinds          # Rhoswen appears twice with no Thread


def test_a_quick_pass_leaves_out_the_world_building(project):
    assert "unspun" not in _kinds(_scan(project, depth="quick"))


def test_narrowing_to_a_type_narrows_the_scan(project):
    body = _scan(project, types=["location"])
    assert not [s for s in body["stops"] if s["kind"] == "frayed"]


# ── The run ledger ───────────────────────────────────────────────────────────

def _new_run(project, **kw):
    return client.post("/api/codex/run",
                       json={"project_path": project, **kw}).json()


def _answer(project, run_id, **kw):
    return client.post("/api/codex/run/answer",
                       json={"project_path": project, "run_id": run_id,
                             **kw}).json()


def test_a_started_run_is_on_disk_immediately(project):
    # A crash must not lose the fact that a session was started.
    run = _new_run(project)
    assert client.get("/api/codex/run",
                      params={"project_path": project,
                              "run_id": run["run_id"]}).status_code == 200


def test_an_applied_stop_does_not_come_back(project):
    run = _new_run(project)
    key = _scan(project)["stops"][0]["key"]
    _answer(project, run["run_id"], key=key, state="applied")
    after = _scan(project, run_id=run["run_id"])
    assert key not in {s["key"] for s in after["stops"]}


def test_the_total_still_counts_what_was_answered(project):
    # "12 of 340" means something. Reporting only what is left would make a
    # long session look like it had barely started.
    run = _new_run(project)
    before = _scan(project)["total"]
    key = _scan(project)["stops"][0]["key"]
    _answer(project, run["run_id"], key=key, state="applied")
    after = _scan(project, run_id=run["run_id"])
    assert after["total"] == before
    assert len(after["stops"]) == before - 1


def test_a_staged_stop_that_was_never_saved_comes_back(project):
    # The two-phase contract, over the wire. There is no autosave, so an
    # Apply that never reached disk must return as a question.
    run = _new_run(project)
    key = _scan(project)["stops"][0]["key"]
    _answer(project, run["run_id"], key=key, state="staged")
    assert key in {s["key"] for s in _scan(project, run_id=run["run_id"])["stops"]}

    result = _answer(project, run["run_id"], discard_staged=True)
    assert result["returned"] == 1
    assert result["run"]["answers"][key]["state"] == "pending"


def test_a_deferred_stop_comes_back(project):
    run = _new_run(project)
    key = _scan(project)["stops"][0]["key"]
    _answer(project, run["run_id"], key=key, state="deferred")
    assert key in {s["key"] for s in _scan(project, run_id=run["run_id"])["stops"]}


def test_a_retired_phrase_is_never_asked_again(project):
    run = _new_run(project)
    _answer(project, run["run_id"], retire_phrase="Rhoswen")
    body = _scan(project, run_id=run["run_id"])
    assert "Rhoswen" not in {s.get("detail", {}).get("name") for s in body["stops"]}


def test_a_muted_kind_disappears_and_can_come_back(project):
    run = _new_run(project)
    _answer(project, run["run_id"], mute="frayed")
    assert "frayed" not in _kinds(_scan(project, run_id=run["run_id"]))

    _answer(project, run["run_id"], unmute="frayed")
    assert "frayed" in _kinds(_scan(project, run_id=run["run_id"]))


def test_a_run_id_from_a_request_is_not_trusted_as_a_path(project):
    response = client.get("/api/codex/run",
                          params={"project_path": project,
                                  "run_id": "../../project"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "run_not_found"


def test_past_sessions_are_listed(project):
    run = _new_run(project, depth="quick")
    listed = client.get("/api/codex/runs",
                        params={"project_path": project}).json()["runs"]
    assert [r["run_id"] for r in listed] == [run["run_id"]]
    assert listed[0]["depth"] == "quick"


# ── The brief ────────────────────────────────────────────────────────────────

def _context(project, **kw):
    return client.post("/api/codex/context",
                       json={"project_path": project, **kw}).json()


def test_the_brief_is_returned_not_sent(project):
    # The whole product rule in one assertion: this endpoint hands back what
    # WOULD be sent. Something the writer initiates does the sending.
    body = _context(project)
    assert "brief" in body and "threads" in body
    assert body["enabled"] is True


def test_naming_a_character_raises_their_relevance(project):
    body = _context(project, text="Elara crossed the bridge.")
    assert "e-elara" in body["mentioned"]
    ranks = {t["entity_id"]: t["relevance"] for t in body["threads"]}
    assert ranks["e-elara"] > ranks["e-garrick"] > ranks["e-thin"]


def test_a_thread_can_be_removed_from_the_brief(project):
    body = _context(project, exclude_ids=["e-garrick"])
    assert "e-garrick" not in {t["entity_id"] for t in body["threads"]}


def test_turning_the_weave_off_returns_the_app_to_manual_chips(project):
    body = _context(project, enabled=False)
    assert body["enabled"] is False
    assert body["brief"] == "" and body["threads"] == []


def test_the_budget_comes_back_broken_down(project):
    body = _context(project, model_context_limit=20_000,
                    system_prompt_tokens=500)
    assert body["budget"]["limit"] == 20_000
    assert body["budget"]["for_the_weave"] < 20_000


def test_a_belief_is_only_reached_through_its_own_pov(project):
    # Elara's belief about her father is in HER frame. A brief written from
    # nobody's point of view must not present it as objective truth.
    neutral = _context(project)["brief"]
    hers = _context(project, pov="e-elara")["brief"]
    assert "Believes her father died." not in neutral
    assert "(believed) Believes her father died." in hers
