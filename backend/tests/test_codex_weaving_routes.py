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
    # Rhoswen appears MID-SENTENCE both times. A name that only ever begins a
    # sentence is indistinguishable from "Because" or "Every" and is not
    # offered -- see codex/mentions.py.
    (root / "manuscript" / "01-a.md").write_text(
        "# Chapter One\n\nElara waited while Rhoswen watched.\n",
        encoding="utf-8")
    (root / "manuscript" / "02-b.md").write_text(
        "# Chapter Two\n\nBy dawn Rhoswen had not answered.\n",
        encoding="utf-8")

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
    # A crash must not lose the fact that a session was started. Read from the
    # DISK rather than through an endpoint: the file is the claim, and GET
    # /run (which this used to call) was removed as an unused doorway.
    import os
    run = _new_run(project)
    path = os.path.join(project, ".storythread", "weave", "runs",
                        f"{run['run_id']}.json")
    assert os.path.exists(path)


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
    # Asked of /run/answer, which is now the endpoint that takes a run id off
    # the wire. The guard lives in load_run; what matters is that a live
    # surface still proves it, so removing GET /run did not quietly retire a
    # traversal test along with the doorway.
    response = client.post("/api/codex/run/answer",
                           json={"project_path": project,
                                 "run_id": "../../project",
                                 "key": "x", "state": "applied"})
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


# ── One click from a name in the prose ───────────────────────────────────────

def test_creating_an_entry_from_a_name_mints_its_own_id_and_file(project):
    # The id and filename are conventions, and a second implementation of a
    # convention is a convention that drifts. The frontend sends a name.
    body = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Rhoswen",
    }).json()["thread"]
    assert body["entity_id"].startswith("e-")
    assert body["filename"] == "rhoswen.md"
    assert body["name"] == "Rhoswen"


def test_what_it_creates_is_EMPTY(project):
    # The one-click action in the walkthrough creates a named entry with
    # nothing in it. The app does not write the writer's characters.
    body = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Rhoswen",
    }).json()["thread"]
    assert all(not s["content"] for s in body["sections"].values())


def test_a_second_entry_of_the_same_name_does_not_overwrite_the_first(project):
    # Silently replacing an existing entry would be the one irreversible
    # thing this button could do.
    first = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Rhoswen",
    }).json()["thread"]
    second = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Rhoswen",
    }).json()["thread"]
    assert first["filename"] != second["filename"]
    assert first["entity_id"] != second["entity_id"]


def test_a_new_entry_is_in_the_weave_immediately(project):
    client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Rhoswen",
    })
    listed = client.get("/api/codex/list",
                        params={"project_path": project}).json()["threads"]
    assert "Rhoswen" in {t["name"] for t in listed}


def _named(body, kind):
    return {s["detail"].get("name") for s in body["stops"] if s["kind"] == kind}


def test_creating_it_settles_the_stop_that_asked_for_it(project):
    # Rhoswen was Unspun. Once she has an entry the condition is gone, and
    # the scan says so on its own -- nothing had to record that it was
    # handled. That is the whole reason stops are never stored.
    assert "Rhoswen" in _named(_scan(project), "unspun")

    client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Rhoswen",
    })
    assert "Rhoswen" not in _named(_scan(project), "unspun")


def test_an_empty_new_entry_immediately_becomes_the_next_question(project):
    # And this is the honest other half: an entry with nothing in it is
    # Frayed, so the walkthrough now asks her to be written rather than
    # created. One click did not finish the job and does not pretend to.
    client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Rhoswen",
    })
    assert "Rhoswen" in _named(_scan(project), "frayed")


def test_an_entry_needs_a_name(project):
    response = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "   ",
    })
    assert response.json()["detail"]["code"] == "type_invalid"


def test_an_unknown_type_is_refused(project):
    response = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "dragon", "name": "Rhoswen",
    })
    assert response.json()["detail"]["code"] == "type_invalid"


# ── Permanence outlives the session ──────────────────────────────────────────
# Reported from live testing: "not a connection" was clicked about fifteen
# times, and every one of them came back the next session. Permanence was
# being stored in the RUN, and a new walkthrough starts a new run -- so
# "permanently" quietly meant "until you close the panel". That is the single
# most annoying thing a walkthrough can do, and it is invisible until
# somebody comes back a second time.

def test_a_retired_phrase_survives_a_new_session(project):
    first = _new_run(project)
    _answer(project, first["run_id"], retire_phrase="Rhoswen")

    second = _new_run(project)
    body = _scan(project, run_id=second["run_id"])
    assert "Rhoswen" not in _named(body, "unspun")


def test_a_dismissed_stop_survives_a_new_session(project):
    first = _new_run(project)
    key = next(s["key"] for s in _scan(project)["stops"] if s["kind"] == "frayed")
    _answer(project, first["run_id"], key=key, state="dismissed")

    second = _new_run(project)
    assert key not in {s["key"] for s in
                       _scan(project, run_id=second["run_id"])["stops"]}


def test_an_applied_stop_survives_a_new_session(project):
    first = _new_run(project)
    key = next(s["key"] for s in _scan(project)["stops"] if s["kind"] == "frayed")
    _answer(project, first["run_id"], key=key, state="applied")

    second = _new_run(project)
    assert key not in {s["key"] for s in
                       _scan(project, run_id=second["run_id"])["stops"]}


def test_a_muted_kind_survives_a_new_session(project):
    first = _new_run(project)
    _answer(project, first["run_id"], mute="frayed")
    second = _new_run(project)
    assert "frayed" not in _kinds(_scan(project, run_id=second["run_id"]))


def test_unmuting_survives_too_rather_than_being_undone(project):
    # Muting is a preference about the book, so the book is authoritative --
    # otherwise unmuting in one session would be silently undone by the next.
    first = _new_run(project)
    _answer(project, first["run_id"], mute="frayed")
    _answer(project, first["run_id"], unmute="frayed")
    second = _new_run(project)
    assert "frayed" in _kinds(_scan(project, run_id=second["run_id"]))


def test_the_count_before_a_session_starts_reflects_what_was_answered(project):
    # The setup screen scans with no run open. It has to quote the count that
    # is actually left, not count things the writer retired months ago.
    run = _new_run(project)
    before = _scan(project)["total"]
    key = next(s["key"] for s in _scan(project)["stops"] if s["kind"] == "frayed")
    _answer(project, run["run_id"], key=key, state="dismissed")

    assert len(_scan(project)["stops"]) == before - 1


def test_a_deferred_stop_is_NOT_made_permanent(project):
    # "Not yet" is the one that must still come back. Storing it alongside
    # the permanent answers would turn it into a dismissal the writer never
    # chose.
    first = _new_run(project)
    key = next(s["key"] for s in _scan(project)["stops"] if s["kind"] == "frayed")
    _answer(project, first["run_id"], key=key, state="deferred")

    second = _new_run(project)
    assert key in {s["key"] for s in
                   _scan(project, run_id=second["run_id"])["stops"]}


def test_a_staged_stop_is_NOT_made_permanent(project):
    # Staged means an unsaved buffer. If it were permanent, closing without
    # saving would lose the edit AND the finding, which is the whole reason
    # the two-phase contract exists.
    first = _new_run(project)
    key = next(s["key"] for s in _scan(project)["stops"] if s["kind"] == "frayed")
    _answer(project, first["run_id"], key=key, state="staged")

    second = _new_run(project)
    assert key in {s["key"] for s in
                   _scan(project, run_id=second["run_id"])["stops"]}


def test_deleting_the_run_files_does_not_lose_permanence(project):
    # Runs are session logs; the book is the record. Losing a log should not
    # re-ask a question the writer already refused for good.
    import shutil
    from app.codex.findings import run_dir

    run = _new_run(project)
    _answer(project, run["run_id"], retire_phrase="Rhoswen")
    shutil.rmtree(run_dir(project))

    assert "Rhoswen" not in _named(_scan(project), "unspun")
