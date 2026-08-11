"""
Editing one fact in place, and creating an entry that already says something.

Both endpoints exist for one reason: the Weave walkthrough is a CLOSED WORLD
now. The writer never leaves the popup -- fixing a Snag, placing an Unplaced
fact, or answering an Unwoven question all happen inside it, and each of those
needs to change exactly one thing on an entry without rewriting the file by
hand:

    "Every single process and option keeps them within the Weave UI even if it
     taps into a creation process that is normally done elsewhere."

PATCH /fact matters beyond convenience. The old ways to change a fact were a
whole-entry rewrite or DELETE + POST -- and the second one loses the fact's id,
which is what `supersedes` on OTHER facts points at. An edit that silently broke
an ordering the writer already settled would be a bug they could not see.
"""

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
---

# Overview
A tall woman.

# Run
- id: f-eyes-1
  at: c-CH1
  axis: eyes
  value: "Green."
- id: f-eyes-2
  at: c-CH1
  axis: eyes
  value: "Blue."
- id: f-later
  at: c-CH2
  axis: mood
  value: "Weary."
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-a.md").write_text("# One\n\nText.\n", encoding="utf-8")
    (root / "manuscript" / "02-b.md").write_text("# Two\n\nMore.\n", encoding="utf-8")

    ids = ensure_chapter_ids(str(root))
    text = ELARA.replace("c-CH1", ids["01-a.md"]).replace("c-CH2", ids["02-b.md"])
    (root / "codex" / "characters" / "elara.md").write_text(text, encoding="utf-8")
    return str(root)


def _run(project) -> list[dict]:
    return client.get("/api/codex/entity",
                      params={"project_path": project,
                              "entity_id": "e-elara"}).json()["run"]


def _patch(project, fact_id, **changes):
    return client.patch("/api/codex/fact", json={
        "project_path": project, "entity_id": "e-elara",
        "fact_id": fact_id, "set": changes,
    })


def _code(response) -> str:
    return response.json()["detail"]["code"]


# ── The edit itself ──────────────────────────────────────────────────────────

def test_a_value_can_be_changed_in_place(project):
    assert _patch(project, "f-eyes-1", value="Grey.").status_code == 200
    facts = {f["id"]: f for f in _run(project)}
    assert facts["f-eyes-1"]["value"] == "Grey."
    assert facts["f-eyes-2"]["value"] == "Blue."     # its rival untouched


def test_the_id_and_the_position_survive(project):
    # The id is what `supersedes` on OTHER facts points at, and the position is
    # the order the writer wrote the Run in. An edit that changed either would
    # be quietly turning one fact into a different one.
    before = [f["id"] for f in _run(project)]
    _patch(project, "f-eyes-1", value="Grey.")
    assert [f["id"] for f in _run(project)] == before


def test_the_anchor_can_be_moved_to_a_real_chapter(project):
    ids = ensure_chapter_ids(project)
    ch2 = ids["02-b.md"]
    assert _patch(project, "f-eyes-1", at=ch2).status_code == 200
    facts = {f["id"]: f for f in _run(project)}
    assert facts["f-eyes-1"]["at"] == ch2


def test_a_chapter_that_does_not_exist_is_refused(project):
    # The resolver TOLERATES an unresolvable anchor (reported as unplaced), but
    # accepting a brand-new one here would be creating the problem rather than
    # tolerating it. Same rule as POST /fact.
    response = _patch(project, "f-eyes-1", at="c-nowhere")
    assert _code(response) == "anchor_not_found"


def test_a_fact_that_is_not_there_is_refused_by_name(project):
    assert _code(_patch(project, "f-ghost", value="X.")) == "fact_not_found"


def test_identity_fields_cannot_be_changed_this_way(project):
    # id and axis ARE the fact. A patch that could touch them would let an edit
    # quietly turn one fact into a different one.
    for key in ("id", "axis"):
        response = _patch(project, "f-eyes-1", **{key: "something"})
        assert _code(response) == "type_invalid", key
        assert key in response.json()["detail"]["message"]


def test_an_empty_patch_is_refused_rather_than_pretending(project):
    assert _code(_patch(project, "f-eyes-1")) == "type_invalid"


# ── Mark as deliberate, end to end ───────────────────────────────────────────

def test_deliberate_silences_the_snag_on_the_next_scan(project):
    # THE INTEGRATION THAT MATTERS. "Mark as deliberate" is only real if the
    # walkthrough stops asking -- much good fiction contradicts itself on
    # purpose, and a checker that cannot be told so becomes noise the writer
    # stops reading. The checkers have skipped intentional facts since they were
    # written; this endpoint is the first thing that can SET the flag.
    def snags():
        body = client.post("/api/codex/scan", json={
            "project_path": project, "depth": "cloth"}).json()
        return [s for s in body["stops"] if s["kind"] == "snag"]

    assert len(snags()) == 1        # Green vs Blue at the same chapter

    for fact_id in ("f-eyes-1", "f-eyes-2"):
        assert _patch(project, fact_id, intentional=True).status_code == 200

    assert snags() == []            # never re-fires, re-derived not remembered


def test_deliberate_is_stored_as_a_real_boolean(project):
    # A truthy string would survive a round trip as the string, and the next
    # reader would be left deciding what "yes" means.
    _patch(project, "f-eyes-1", intentional="yes")
    facts = {f["id"]: f for f in _run(project)}
    assert facts["f-eyes-1"]["intentional"] is True


# ── Creating an entry that already says something ────────────────────────────

def test_a_new_entry_can_carry_starter_text(project):
    # Quick Entry in one atomic call: the Weave creates an entry WITH its basic
    # information instead of creating an empty file and racing a second request
    # to fill it. The worked example was a Government answering an Unwoven
    # question about succession.
    response = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "government", "name": "The Regency",
        "sections": {"succession": "The crown passes by combat, once a decade."},
    })
    assert response.status_code == 200
    entity_id = response.json()["thread"]["entity_id"]

    body = client.get("/api/codex/entity",
                      params={"project_path": project,
                              "entity_id": entity_id}).json()
    assert body["sections"]["succession"]["content"] \
        == "The crown passes by combat, once a decade."
    # The other sections exist and are empty, exactly as an empty create makes
    # them -- starter text fills, it does not reshape.
    assert body["sections"]["overview"]["content"] == ""


def test_starter_text_for_a_section_the_type_lacks_is_refused_by_name(project):
    # Refused rather than dropped. Silently discarding the writer's answer to an
    # Unwoven question would be the worst possible version of "created".
    response = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "government", "name": "The Regency",
        "sections": {"favourite_soup": "Leek."},
    })
    assert _code(response) == "type_invalid"
    assert "favourite_soup" in response.json()["detail"]["message"]


def test_an_answered_unwoven_question_stops_being_asked(project):
    # The other half of the Government example: once the answer lands in the
    # section that asked for it, the walkthrough's question resolves by
    # RE-DERIVATION -- no ledger entry, no memory, the condition simply ended.
    def unwoven_ids():
        body = client.post("/api/codex/scan", json={
            "project_path": project, "depth": "unwoven_pass"}).json()
        return {s["detail"]["question_id"] for s in body["stops"]}

    before = unwoven_ids()
    assert "gov-succession" in before or len(before) > 0

    # Answer the succession question the way Quick Entry does.
    client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "government", "name": "The Regency",
        "sections": {"succession": "The crown passes by combat, once a decade.",
                     "overview": "The council that rules between kings."},
    })

    after = unwoven_ids()
    assert after < before           # strictly fewer questions, none added
