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
    assert "gov_power" in before

    # Answer who holds power, the way Quick Entry does.
    client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "government", "name": "The Regency",
        "sections": {"overview": "The council that rules between kings."},
    })

    after = unwoven_ids()
    assert "gov_power" not in after         # the condition ended

    # AND WHAT IT OPENED IS NOW ASKED. This test used to assert `after < before`
    # -- strictly fewer questions, none added -- which passed only because R6.1
    # made every branch question unreachable. The root system's whole promise is
    # that an answer opens the questions it implies, so a world that gets bigger
    # as you decide things is the feature, not a regression.
    assert "gov_succession" in after


# ── What the Profile Builder's create form has always asked for (R2.3b) ──────

def test_a_new_entry_can_be_given_a_role_and_a_template(project):
    # The create form asks for a role ("protagonist") and, for characters, which
    # template to start from. This route could not carry either, so every
    # character the Profile Builder made through it would have opened as an
    # untitled Main -- and the writer would have found out by looking.
    response = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Mira Kell",
        "role": "protagonist", "character_kind": "side",
    })
    assert response.status_code == 200
    entity_id = response.json()["thread"]["entity_id"]

    body = client.get("/api/codex/entity",
                      params={"project_path": project,
                              "entity_id": entity_id}).json()
    assert body["role"] == "protagonist"
    assert body["character_kind"] == "side"

    # And the list can say so without opening the file, which is what a profile
    # list actually needs.
    threads = client.get("/api/codex/list",
                         params={"project_path": project}).json()["threads"]
    mira = next(t for t in threads if t["name"] == "Mira Kell")
    assert (mira["role"], mira["character_kind"]) == ("protagonist", "side")


def test_a_main_character_writes_no_template_line(project):
    # "main" is the default and is deliberately NOT written to disk, which is
    # what keeps a converted character's file byte-identical to the profile it
    # came from.
    response = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Garrick Vale II",
        "character_kind": "main",
    })
    assert response.status_code == 200
    import os
    path = os.path.join(project, "codex", "characters",
                        response.json()["thread"]["filename"])
    with open(path, encoding="utf-8") as f:
        assert "character_kind" not in f.read()


def test_a_new_entry_knows_when_it_was_made(project):
    # The profile format has always carried both dates. A file with none is not
    # a smaller file, it is one that has forgotten when the writer started it.
    thread = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Wren Ashby",
    }).json()["thread"]
    assert thread["created_at"] and thread["updated_at"]


def test_saving_an_entry_moves_its_updated_date_and_keeps_its_created_one(project):
    thread = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character", "name": "Wren Ashby",
    }).json()["thread"]
    created = thread["created_at"]

    thread["sections"]["overview"]["content"] = "She keeps the ledger."
    assert client.post("/api/codex/entity", json={
        "project_path": project, "thread": thread}).status_code == 200

    saved = client.get("/api/codex/entity",
                       params={"project_path": project,
                               "entity_id": thread["entity_id"]}).json()
    assert saved["created_at"] == created
    assert saved["updated_at"] >= created


def test_answering_a_shared_landing_place_settles_only_that_question(project):
    # THE R6.0 BUG, END TO END. Eleven questions land in a lore entry's "rule or
    # concept" -- marriage, inheritance, war rules, forms of address, records,
    # the dead, news -- because that is genuinely where a rule about the world
    # belongs. Content there used to settle all of them at once, so one entry
    # about blood price silenced four domains.
    def unwoven_ids():
        body = client.post("/api/codex/scan", json={
            "project_path": project, "depth": "unwoven_pass",
            "domains": ["kinship"]}).json()
        return {s["detail"]["question_id"] for s in body["stops"]}

    assert "kin_marriage" in unwoven_ids()

    # Answer it the way Quick Entry does: the entry claims the question.
    made = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "lore", "name": "Handfasting",
        "sections": {"rule_or_concept": "One spouse, chosen at midwinter."},
        "answers": ["kin_marriage"],
    })
    assert made.status_code == 200
    assert made.json()["thread"]["answers"] == ["kin_marriage"]

    after = unwoven_ids()
    assert "kin_marriage" not in after
    # Its neighbours in that very section are untouched.
    body = client.post("/api/codex/scan", json={
        "project_path": project, "depth": "unwoven_pass",
        "domains": ["memory"]}).json()
    assert "mem_records" in {s["detail"]["question_id"] for s in body["stops"]}


def test_the_claim_survives_a_round_trip_through_the_file(project):
    # It lives in the writer's Markdown, not in the cache, which is what makes
    # it derivation rather than a ledger. Deleting app.db must not lose it.
    client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "lore", "name": "Handfasting",
        "sections": {"rule_or_concept": "One spouse."},
        "answers": ["kin_marriage"],
    })
    import os
    path = os.path.join(project, "codex", "lore", "handfasting.md")
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    assert "answers:" in raw and "kin_marriage" in raw


def test_a_question_this_build_does_not_ask_is_never_recorded(project):
    # An unknown id would sit in the file forever answering nothing, and would
    # read to anyone opening the Markdown like a claim the app had lost track of.
    made = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "lore", "name": "Something",
        "sections": {"rule_or_concept": "A rule."},
        "answers": ["kin_marriage", "not_a_real_question"],
    })
    assert made.json()["thread"]["answers"] == ["kin_marriage"]
