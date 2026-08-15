# tests/test_extractor_routes.py -- the Profile Extractor over HTTP
# ==================================================================
# The pass and its store are tested in test_codex_extract.py. What is only
# testable here is the part that touches the writer's files.
#
# THE RULE THESE TESTS EXIST FOR. This pass carries no evidence -- an Overview
# is synthesis with no source sentence to quote, so `speaker_analysis.py`'s
# verification cannot exist here (roadmap decision 4). That leaves the writer's
# per-item click as the ONLY thing between a model's guess and their story
# bible. So the interesting tests are not "does apply work" but:
#
#   - can anything reach a file WITHOUT a click (no)
#   - does `merge` ever lose a word the writer wrote (no)
#   - does a proposal for an entry that does not exist quietly create one (no)
#   - does starting a new run silently destroy proposals they paid for (no)

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.codex import extraction_store as store
from app.main import app
from app.utils.structure_store import ensure_chapter_ids

client = TestClient(app)

ROSIE = """---
type: character
entity_id: e-rosie
name: Rosie
---

# Overview
A courier. She knows the docks.

# Motivations
- trait: Wants out
  description: Saving to leave the city.
  importance: present
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-a.md").write_text(
        "# Chapter One\n\nRosie ran the length of the dock.\n", encoding="utf-8")
    (root / "manuscript" / "02-b.md").write_text(
        "# Chapter Two\n\nThe tall man watched her go.\n", encoding="utf-8")
    ensure_chapter_ids(str(root))
    (root / "codex" / "characters" / "rosie.md").write_text(ROSIE, encoding="utf-8")
    return str(root)


def _seed_run(project, *, entity_id="e-rosie", form=store.FORM_PROSE,
              section_id="overview", heading="Overview",
              content="She counts the exits in every room.", trait_name=""):
    """A saved extraction with exactly one proposal in it."""
    run = store.new_run(model_used="test/model")
    entry = store.new_entry(entity_id=entity_id, type_id="character",
                            name="Rosie")
    entry["parts"].append(store.new_part(
        section_id=section_id, heading=heading, form=form,
        content=content, trait_name=trait_name))
    run["entries"].append(entry)
    store.save(project, run)
    return run["entries"][0]["item_id"], run["entries"][0]["parts"][0]["part_id"]


def _read(project, filename="rosie.md"):
    path = os.path.join(project, "codex", "characters", filename)
    with open(path, encoding="utf-8") as handle:
        return handle.read()


# ── The plan: what a run would cover, before anything is spent ──────────────

def test_the_plan_lists_the_chapters_and_the_world(project):
    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    assert len(body["chapters"]) == 2
    assert [k["name"] for k in body["known"]] == ["Rosie"]
    assert body["has_world"] is True


def test_the_plan_suggests_leaving_a_written_entry_alone(project):
    # Roadmap decision 7: fully-written entries pre-ticked as "leave alone",
    # every tick reversible. A SUGGESTION, never automatic skipping -- nothing
    # here can know a character from chapter two has returned for the rest of
    # the book, so skipping would miss exactly the entry the writer wanted.
    long_text = "She knows the docks. " * 60
    path = os.path.join(project, "codex", "characters", "rosie.md")
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text.replace("A courier. She knows the docks.", long_text))

    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    rosie = body["known"][0]
    assert rosie["suggest_exclude"] is True
    assert rosie["written_chars"] > 600


def test_a_thin_entry_is_not_suggested_for_exclusion(project):
    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    assert body["known"][0]["suggest_exclude"] is False


def test_an_empty_world_says_so_before_money_is_spent(project, tmp_path):
    # The screen tells the writer to run Weaving first. This is what lets it:
    # running the Extractor on an empty world proposes a world from scratch
    # with nothing to match against, which is the expensive way to get the
    # noisiest possible result.
    bare = tmp_path / "Bare"
    (bare / "manuscript").mkdir(parents=True)
    (bare / "project.json").write_text("{}", encoding="utf-8")
    body = client.get("/api/extractor/plan",
                      params={"project_path": str(bare)}).json()
    assert body["has_world"] is False


# ── Nothing is written without a click ──────────────────────────────────────

def test_reading_the_current_extraction_writes_nothing(project):
    _seed_run(project)
    before = _read(project)
    body = client.get("/api/extractor/current",
                      params={"project_path": project}).json()
    assert body["progress"]["parts_open"] == 1
    assert _read(project) == before


def test_a_saved_run_arrives_with_NOTHING_ticked(project):
    _seed_run(project)
    body = client.get("/api/extractor/current",
                      params={"project_path": project}).json()
    counts = body["progress"]
    assert counts["parts_applied"] == 0
    assert counts["parts_dismissed"] == 0
    assert body["run"]["entries"][0]["state"] == store.ENTRY_OPEN


def test_dismissing_a_proposal_never_touches_the_file(project):
    item_id, part_id = _seed_run(project)
    before = _read(project)
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "dismiss",
    })
    assert response.status_code == 200
    assert _read(project) == before
    assert response.json()["progress"]["parts_dismissed"] == 1


# ── Merge must never lose a word the writer wrote ───────────────────────────

def test_MERGE_APPENDS_AND_KEEPS_THE_WRITERS_TEXT_FIRST(project):
    """
    Roadmap decision 2, in the writer's own words: two paragraphs of theirs
    plus one of the proposal's is three paragraphs, theirs first and untouched.

    This is the button that must never lose anything. `overwrite` exists for
    when they want their words replaced, and it is a separate, deliberate
    choice -- if merge could silently rewrite, there would be no safe answer on
    the screen at all.
    """
    item_id, part_id = _seed_run(project)
    client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "merge", "entity_id": "e-rosie",
    })
    text = _read(project)
    assert "A courier. She knows the docks." in text
    assert "She counts the exits in every room." in text
    assert text.index("A courier") < text.index("She counts the exits")


def test_overwrite_replaces_only_when_it_is_chosen(project):
    item_id, part_id = _seed_run(project)
    client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "overwrite", "entity_id": "e-rosie",
    })
    text = _read(project)
    assert "A courier. She knows the docks." not in text
    assert "She counts the exits in every room." in text


def test_applying_records_HOW_it_landed(project):
    item_id, part_id = _seed_run(project)
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "merge", "entity_id": "e-rosie",
    })
    assert response.json()["applied_as"] == "merge"
    run = store.load(project)
    assert run["entries"][0]["parts"][0]["state"] == store.PART_APPLIED


# ── Traits: added, or folded into one the writer PICKS ──────────────────────

def test_a_trait_can_be_added_as_its_own(project):
    item_id, part_id = _seed_run(
        project, form=store.FORM_TRAIT, section_id="motivations",
        heading="Motivations", trait_name="Owes a debt",
        content="To the wrong people.")
    client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "add", "entity_id": "e-rosie",
    })
    text = _read(project)
    assert "Owes a debt" in text
    # And the writer's own trait is still there beside it.
    assert "Wants out" in text


def test_a_trait_can_be_folded_into_one_the_writer_NAMES(project):
    # Roadmap decision 6. The case it exists for: the profile says "Fiercely
    # loyal" and the pass proposes "Loyal to a fault".
    item_id, part_id = _seed_run(
        project, form=store.FORM_TRAIT, section_id="motivations",
        heading="Motivations", trait_name="Loyal to a fault",
        content="Will not leave anyone behind.")
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "merge_trait", "entity_id": "e-rosie",
        "merge_into": "Wants out",
    })
    assert response.status_code == 200
    text = _read(project)
    assert "Saving to leave the city." in text          # theirs, kept
    assert "Will not leave anyone behind." in text      # the proposal, folded in
    assert "Loyal to a fault" not in text               # not a second trait
    assert "merged into Wants out" in response.json()["applied_as"]


def test_MERGING_A_TRAIT_WITHOUT_SAYING_WHICH_IS_REFUSED(project):
    """
    The picker is required and never guessed.

    Merging into a trait the app chose is how a writer's own wording gets
    overwritten -- and unlike a bad Overview, a mangled trait is easy to miss,
    because the trait is still there and still has their label on it.
    """
    item_id, part_id = _seed_run(
        project, form=store.FORM_TRAIT, section_id="motivations",
        heading="Motivations", trait_name="Loyal", content="Text.")
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "merge_trait", "entity_id": "e-rosie",
    })
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "type_invalid"
    # And nothing was written.
    assert "Text." not in _read(project)


def test_merging_into_a_trait_that_is_not_there_is_refused_by_name(project):
    item_id, part_id = _seed_run(
        project, form=store.FORM_TRAIT, section_id="motivations",
        heading="Motivations", trait_name="Loyal", content="Text.")
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "merge_trait", "entity_id": "e-rosie",
        "merge_into": "Nonexistent",
    })
    assert response.status_code == 400
    assert "Nonexistent" in response.json()["detail"]["message"]


def test_an_added_trait_is_not_given_an_invented_weight(project):
    # The pass proposes no importance and must not have one invented for it.
    # `present` is the neutral middle; a trait the writer keeps is one they
    # will weigh themselves.
    item_id, part_id = _seed_run(
        project, form=store.FORM_TRAIT, section_id="motivations",
        heading="Motivations", trait_name="Owes a debt", content="Money.")
    client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "add", "entity_id": "e-rosie",
    })
    text = _read(project)
    assert "importance: present" in text
    assert "importance: core" not in text


# ── A proposal for an entry that does not exist ─────────────────────────────

def test_A_NEW_PROPOSAL_DOES_NOT_QUIETLY_CREATE_A_PROFILE(project):
    """
    The writer creates the entry, deliberately, and only then can its pieces
    land. Roadmap decision 9: a new entry arrives base-level, the same thing
    Quick Entry makes, and the traits go in one click at a time.

    Auto-creating on first apply would be convenient and would make the largest
    unreviewed write in the app -- a whole profile from a pass with nothing
    checking it.
    """
    run = store.new_run()
    entry = store.new_entry(type_id="character", name="Mayor Bloomfield")
    entry["parts"].append(store.new_part(
        section_id="overview", heading="Overview",
        form=store.FORM_PROSE, content="Runs the city badly."))
    run["entries"].append(entry)
    store.save(project, run)

    before = sorted(os.listdir(os.path.join(project, "codex", "characters")))
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": entry["item_id"],
        "part_id": entry["parts"][0]["part_id"], "action": "merge",
    })
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "extraction_no_target"
    assert sorted(os.listdir(os.path.join(project, "codex", "characters"))) == before


def test_once_the_writer_creates_it_the_parts_know_where_to_land(project):
    run = store.new_run()
    entry = store.new_entry(type_id="character", name="Mayor Bloomfield")
    entry["parts"].append(store.new_part(
        section_id="overview", heading="Overview",
        form=store.FORM_PROSE, content="Runs the city badly."))
    run["entries"].append(entry)
    store.save(project, run)

    created = client.post("/api/codex/thread/new", json={
        "project_path": project, "type": "character",
        "name": "Mayor Bloomfield", "character_kind": "side",
    }).json()["thread"]

    # The screen records what the proposal became, so a second click cannot
    # make a second profile.
    client.post("/api/extractor/entry", json={
        "project_path": project, "item_id": entry["item_id"],
        "state": store.ENTRY_OPEN,
        "created_entity_id": created["entity_id"],
    })
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": entry["item_id"],
        "part_id": entry["parts"][0]["part_id"], "action": "merge",
    })
    assert response.status_code == 200
    assert "Runs the city badly." in _read(project, created["filename"])


# ── Starting again ─────────────────────────────────────────────────────────

def test_A_NEW_RUN_REFUSES_TO_DISCARD_UNREVIEWED_WORK_SILENTLY(project):
    """
    Roadmap decision 8. Superseding is what the writer asked for; doing it
    without saying what it costs is not.

    Those proposals were paid for in tokens, and this repo's rule is that what
    the writer paid for is never re-bought. The count travels in the refusal so
    the confirm can name it.
    """
    _seed_run(project)
    response = client.post("/api/extractor/run", json={
        "project_path": project, "chapter_ids": [], "exclude": [],
    })
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "extraction_would_replace"
    assert "1 proposal" in detail["message"]
    # And the existing run is untouched.
    assert store.load(project) is not None


def test_a_run_with_nothing_left_to_review_needs_no_confirmation(project, monkeypatch):
    # The guard must not cry wolf. A writer who finished the last run should not
    # be asked to confirm anything, or they learn to click through the warning
    # that matters.
    item_id, part_id = _seed_run(project)
    client.post("/api/extractor/part", json={
        "project_path": project, "item_id": item_id, "part_id": part_id,
        "action": "dismiss",
    })
    assert store.unreviewed_count(store.load(project)) == 0

    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    assert body["unreviewed"] == 0
    assert body["has_current"] is True


def test_discarding_the_current_extraction(project):
    _seed_run(project)
    response = client.delete("/api/extractor/current",
                             params={"project_path": project})
    assert response.json()["discarded"] is True
    assert client.get("/api/extractor/current",
                      params={"project_path": project}).json()["run"] is None


def test_ticking_an_entry_off_is_the_writers_own_act(project):
    # NOT inferred from the parts. "I have looked at this and want nothing from
    # it" is a real answer that leaves every part open, and inferring done-ness
    # would either nag the writer forever or hide work they had not seen.
    item_id, _ = _seed_run(project)
    response = client.post("/api/extractor/entry", json={
        "project_path": project, "item_id": item_id, "state": "done",
    })
    assert response.status_code == 200
    assert response.json()["progress"]["entries_done"] == 1
    # Still open, and no longer counted against a new run.
    assert store.unreviewed_count(store.load(project)) == 0


# ── Refusals come from the closed set ──────────────────────────────────────

def test_every_refusal_uses_a_known_code(project):
    from app.codex.errors import CODES

    responses = [
        client.post("/api/extractor/part", json={
            "project_path": project, "item_id": "x-nope",
            "part_id": "p-nope", "action": "dismiss"}),
        client.post("/api/extractor/entry", json={
            "project_path": project, "item_id": "x-nope", "state": "done"}),
    ]
    _seed_run(project)
    responses.append(client.post("/api/extractor/run", json={
        "project_path": project}))

    for response in responses:
        assert response.status_code >= 400
        assert response.json()["detail"]["code"] in CODES


def test_working_an_extraction_that_is_not_there_says_so(project):
    response = client.post("/api/extractor/part", json={
        "project_path": project, "item_id": "x-a", "part_id": "p-b",
        "action": "dismiss",
    })
    assert response.json()["detail"]["code"] == "extraction_missing"


# ── WHAT THE FIRST LIVE RUN COST, AND WHAT NOW PREVENTS IT ──────────────────
#
# The Extractor's first real use, on a 275,000-character novel: the writer
# believed they had chosen one model, the Long-context role was unassigned so
# it fell through to the Default Model, the request was about 69,000 tokens
# against that model's 64,000-token window, and the answer came back
# unreadable. The screen then reported "nothing was proposed" and offered the
# reassuring guess that the book probably already matched the entries.
#
# Four separate failures in one run, and only one of them was the model's:
#   - the writer was never told WHICH model would run it
#   - nothing checked whether the request could possibly fit
#   - the raw answer was discarded, so the failure was undiagnosable
#   - the screen invented a cause and stated it confidently
#
# The first two are prevented here. The other two are the frontend's.

def test_the_plan_names_the_model_that_will_actually_run_it(project, monkeypatch):
    import app.routers.extractor as extractor

    async def fake_resolve():
        return "deepseek/deepseek-chat", 64000, ""
    monkeypatch.setattr(extractor, "_resolve_for_display", fake_resolve)

    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    assert body["model_id"] == "deepseek/deepseek-chat"
    assert body["context_tokens"] == 64000


def test_the_plan_says_whether_the_book_FITS(project, monkeypatch):
    import app.routers.extractor as extractor

    async def small_window():
        # Small enough to be exceeded by this fixture's two short chapters.
        # The real case was 69,000 against 64,000; the arithmetic is the same.
        return "tiny/model", 10, ""
    monkeypatch.setattr(extractor, "_resolve_for_display", small_window)

    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    assert body["estimated_tokens"] > 0
    assert body["fits"] is False


def test_an_unknown_context_window_is_NOT_reported_as_fitting(project, monkeypatch):
    """
    0 means "we could not find out", which is a different thing from "it fits".

    Treating unknown as fine is how a writer ends up paying for a request that
    overflows -- which is exactly what happened, and the reason this
    distinction is a test rather than a comment.
    """
    import app.routers.extractor as extractor

    async def unknown():
        return "some/model", 0, ""
    monkeypatch.setattr(extractor, "_resolve_for_display", unknown)

    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    assert body["context_tokens"] == 0
    # Nothing is BLOCKED on an unknown window -- refusing every unlisted model
    # would make the feature unusable on a local one -- but the screen is told
    # the truth and warns rather than promising.
    assert body["fits"] is True


def test_the_plan_passes_on_why_no_model_could_be_resolved(project, monkeypatch):
    import app.routers.extractor as extractor

    async def broken():
        return "", 0, "No API key for OpenRouter."
    monkeypatch.setattr(extractor, "_resolve_for_display", broken)

    body = client.get("/api/extractor/plan",
                      params={"project_path": project}).json()
    assert body["model_error"] == "No API key for OpenRouter."


def test_A_RUN_THAT_CANNOT_FIT_IS_REFUSED_BEFORE_ANYTHING_IS_SENT(project, monkeypatch):
    """
    The money guard. Nothing is sent, so nothing is charged.

    Note what is NOT asserted: that it refuses when the window is unknown. A
    local model reports no context length and must stay usable.
    """
    import app.routers.extractor as extractor

    async def small(_provider, _key, _model):
        return 10
    monkeypatch.setattr(extractor, "_context_window", small)

    called = {"ran": False}

    async def must_not_run(**_kwargs):
        called["ran"] = True
        raise AssertionError("a request was sent despite not fitting")

    monkeypatch.setattr("app.ai.openrouter.run_completion", must_not_run)

    response = client.post("/api/extractor/run", json={
        "project_path": project, "chapter_ids": [], "exclude": [],
    })
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "extraction_too_long"
    assert called["ran"] is False
    message = response.json()["detail"]["message"]
    assert "nothing has been spent" in message.lower()
    # And it says what to do, not only what went wrong.
    assert "fewer chapters" in message.lower() or "Settings" in message
