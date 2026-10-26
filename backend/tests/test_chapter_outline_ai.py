"""
Slice 3 of Chapter Outlines: what AI does with a plan, in both directions.

Two halves, and they interact in a way worth stating before either:

  1. Build Chapter Outline drafts a plan from what the writer describes.
  2. The Weaving scan READS chapter outlines as a planning source, so a
     capitalised name in one is raised as something the writer has planned.

Which means a model that invents "the Ashfall Compact" to make a line read
better does not just add a word. The writer inserts it, saves it, and the
Weave later asks them about a faction they never chose, as though it were
their own idea. The names rule in CHAPTER_OUTLINE_INSTRUCTIONS is what stands
between those two halves, and it is tested here rather than left to the prompt
being read carefully.

See docs/chapter-outline-spec.md sections 5.3, 6 and 7.
"""

import json
import os

import pytest
from fastapi.testclient import TestClient

import app.routers.ai as ai
from app.main import app

client = TestClient(app)

OUTLINE = ("1. The column is spotted at dusk.\n"
           "2. Vance argues for withdrawal, and is overruled.\n")


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "07-seven-to-one.md").write_text(
        "# Seven to One\n\nShe counted them again.\n", encoding="utf-8")
    return str(root)


def _write_outline(project: str, stem: str, text: str) -> None:
    folder = os.path.join(project, "outlines", "chapters")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"{stem}.md"), "w", encoding="utf-8") as f:
        f.write(text)


def _patch_model(monkeypatch, reply: str = "1. A thing happens.\n2. Another."):
    """Reach the endpoint body without a network call, and capture what it sent."""
    captured: dict = {}

    async def fake_run_chat(**kwargs):
        captured.update(kwargs)
        return reply

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)
    monkeypatch.setattr(ai, "_resolve_model_and_key",
                        lambda role, mid=None: (ai.OPENROUTER, "k", mid or "test/model"))
    return captured


def _chapter(project: str, filename: str) -> str:
    """An ABSOLUTE path, which is what _read_chapter_text validates and what
    the frontend sends -- the same shape generate-chapter-summary takes."""
    return os.path.join(project, "manuscript", filename)


def _build(project: str, **body):
    if "chapter_path" in body:
        body["chapter_path"] = _chapter(project, body["chapter_path"])
    base = {"project_path": project,
            "chapter_path": _chapter(project, "07-seven-to-one.md"),
            "instruction": "She takes the job she swore she would not take."}
    return client.post("/api/ai/build-chapter-outline", json={**base, **body})


# ── Build Chapter Outline ────────────────────────────────────────────────────

def test_it_drafts_from_what_the_writer_asked_for(project, monkeypatch):
    captured = _patch_model(monkeypatch)
    res = _build(project)
    assert res.status_code == 200, res.text
    assert res.json()["outline"].startswith("1.")

    sent = captured["messages"][0]["content"]
    assert "She takes the job she swore she would not take." in sent


def test_the_instruction_is_the_last_thing_the_model_reads(project, monkeypatch):
    # Everything else is material; this is the brief. Putting it last keeps it
    # the freshest thing in front of the model rather than something buried
    # above a chapter's worth of prose.
    captured = _patch_model(monkeypatch)
    _build(project, weave_brief="Kipling (Character)\nis hiding the override.")
    sent = captured["messages"][0]["content"]
    assert sent.index("FROM YOUR WORLD") < sent.index("WHAT I WANT FROM THIS CHAPTER")
    assert sent.rstrip().endswith("She takes the job she swore she would not take.")


def test_it_refuses_with_nothing_to_work_from(project, monkeypatch):
    # The whole feature is "build the outline I am describing". With no
    # description there is nothing to build, and spending the writer's money
    # to find that out is the wrong answer.
    _patch_model(monkeypatch)
    res = _build(project, instruction="   ")
    assert res.status_code == 400
    assert "Say what you want this chapter to do" in res.json()["detail"]


def test_it_reads_the_prose_when_there_is_some(project, monkeypatch):
    captured = _patch_model(monkeypatch)
    _build(project)
    assert "She counted them again." in captured["messages"][0]["content"]


def test_a_chapter_with_no_prose_still_works(project, monkeypatch):
    # The ordinary case. Planning usually comes FIRST, which is the whole
    # reason this document exists -- a pass that needed prose would be useless
    # exactly when it is most wanted.
    (open(os.path.join(project, "manuscript", "08-empty.md"), "w",
          encoding="utf-8").write("# Empty\n"))
    captured = _patch_model(monkeypatch)
    res = _build(project, chapter_path="08-empty.md")
    assert res.status_code == 200
    assert "BEGIN CHAPTER TEXT" not in captured["messages"][0]["content"]


def test_a_revision_carries_what_is_already_there(project, monkeypatch):
    captured = _patch_model(monkeypatch)
    _build(project, existing=OUTLINE, instruction="add two beats after the second")
    sent = captured["messages"][0]["content"]
    assert "Vance argues for withdrawal" in sent
    assert "Return the whole revised version" in sent


def test_it_writes_nothing_at_all(project, monkeypatch):
    # THE ONE THAT KEEPS THIS INSIDE THE AI WRITE BOUNDARY. An outline is a
    # human-authored planning document, not one of the four designated
    # generated fields, so the model's text reaches disk only when the writer
    # presses Insert and then Save. Compare generate-chapter-summary, which
    # does write -- a chapter summary IS one of the four.
    _patch_model(monkeypatch)
    res = _build(project)
    assert res.status_code == 200
    assert res.json()["outline"]
    assert not os.path.exists(os.path.join(project, "outlines"))


def test_it_uses_the_structure_role(project, monkeypatch):
    # "Shape and pacing -- acts, chapters, scenes, beats" is what this is.
    seen = {}

    async def fake_run_chat(**kwargs):
        return "1. x"

    def fake_resolve(role, mid=None):
        seen["role"] = role
        return (ai.OPENROUTER, "k", "test/model")

    monkeypatch.setattr(ai, "run_chat", fake_run_chat)
    monkeypatch.setattr(ai, "_resolve_model_and_key", fake_resolve)
    _build(project)
    assert seen["role"] == "structure"


def test_the_prompt_forbids_inventing_names(project):
    # THE RULE THAT CONNECTS THE TWO HALVES OF THIS SLICE. The Weave reads
    # outlines for planned names, so a name the model invented comes back to
    # the writer later as their own decision. Same rule the outline presets
    # have, for the same reason.
    from app.ai.prompts import CHAPTER_OUTLINE_INSTRUCTIONS as rules

    assert "Never invent a" in rules
    assert "ONLY proper nouns that appear in the material" in rules
    # And it says what to do instead, or it is a prohibition with no exit.
    assert "describe it instead" in rules


def test_the_prompt_asks_for_a_plan_and_not_prose(project):
    from app.ai.prompts import CHAPTER_OUTLINE_INSTRUCTIONS as rules

    assert "Not prose." in rules
    assert "Not a summary." in rules
    assert "numbered list" in rules


# ── The Weaving scan reads outlines ──────────────────────────────────────────

def test_an_outline_is_read_as_a_planning_source(project):
    from app.codex.scan import _writer_vocabulary

    _write_outline(project, "07-seven-to-one",
                   "1. The Ashfall Compact sends an envoy.\n")
    corpora = _writer_vocabulary(project, [])
    joined = "\n".join(text for _label, text in corpora)
    assert "Ashfall Compact" in joined


def test_the_stop_can_name_the_chapter_it_came_from(project):
    # "you use this in chapter 7's outline" is a reason a writer can act on.
    # "you use this in 07-seven-to-one" is a filename read out loud.
    from app.codex.scan import _writer_vocabulary

    _write_outline(project, "07-seven-to-one", "1. The envoy arrives.\n")
    labels = [label for label, _text in _writer_vocabulary(project, [])]
    assert "chapter 7's outline" in labels


def test_a_project_with_no_outlines_reads_exactly_as_before(project):
    from app.codex.scan import _writer_vocabulary

    assert _writer_vocabulary(project, []) == []


# ── Planned in ───────────────────────────────────────────────────────────────

def _entity(project: str, entity_id: str, name: str, aliases=()) -> None:
    folder = os.path.join(project, "codex", "characters")
    os.makedirs(folder, exist_ok=True)
    lines = ["---", "type: character", f"entity_id: {entity_id}", f"name: {name}"]
    if aliases:
        lines.append("aliases:")
        lines += [f"  - {a}" for a in aliases]
    lines += ["---", "", "# Overview", "Someone.", ""]
    with open(os.path.join(folder, f"{entity_id}.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _planned(project: str, entity_id: str):
    res = client.get("/api/codex/planned-in", params={
        "project_path": project, "entity_id": entity_id})
    assert res.status_code == 200, res.text
    return [c["chapter_filename"] for c in res.json()["chapters"]]


def test_an_entry_says_which_chapters_plan_to_use_it(project):
    _entity(project, "e-kipling", "Kipling")
    _write_outline(project, "07-seven-to-one", "1. Kipling counts them again.\n")
    _write_outline(project, "08-highest-bidder", "1. Nobody she knows is there.\n")

    assert _planned(project, "e-kipling") == ["07-seven-to-one.md"]


def test_it_finds_the_name_the_writer_actually_uses(project):
    # A writer planning chapter seven writes "Lexa", not "Alexandra Langford".
    _entity(project, "e-lexa", "Alexandra Langford", aliases=["Lexa"])
    _write_outline(project, "07-seven-to-one", "1. Lexa refuses the contract.\n")
    assert _planned(project, "e-lexa") == ["07-seven-to-one.md"]


def test_it_does_not_match_a_name_inside_another_word(project):
    # "Kip" must not match "Kipling", or every short name in the book would be
    # planned in every chapter and the whole answer would be worthless.
    _entity(project, "e-kip", "Kip")
    _write_outline(project, "07-seven-to-one", "1. Kipling counts them again.\n")
    assert _planned(project, "e-kip") == []


def test_it_is_in_reading_order(project):
    _entity(project, "e-kipling", "Kipling")
    for stem, n in (("10-j", 10), ("02-b", 2), ("01-a", 1)):
        with open(os.path.join(project, "manuscript", f"{stem}.md"), "w",
                  encoding="utf-8") as f:
            f.write(f"# Chapter {n}\n")
        _write_outline(project, stem, "1. Kipling is there.\n")

    assert _planned(project, "e-kipling") == ["01-a.md", "02-b.md", "10-j.md"]


def test_nothing_planned_is_an_empty_list_not_an_error(project):
    _entity(project, "e-kipling", "Kipling")
    assert _planned(project, "e-kipling") == []


def test_it_is_recomputed_rather_than_cached(project):
    """
    THE RULE THIS ENDPOINT EXISTS TO KEEP.

    R8.5 deleted the codex_mention table because mentions derived from the
    manuscript while the freshness gate fingerprints codex/ -- so every
    chapter the writer edited left the rows silently wrong with the index
    reporting itself current. "Planned in" derives from outlines/, which the
    index does not fingerprint either, so caching it would rebuild that bug
    exactly.

    Editing an outline with NO reindex in between must change the answer.
    """
    _entity(project, "e-kipling", "Kipling")
    _write_outline(project, "07-seven-to-one", "1. Kipling counts them again.\n")
    assert _planned(project, "e-kipling") == ["07-seven-to-one.md"]

    _write_outline(project, "07-seven-to-one", "1. Nobody she knows is there.\n")
    assert _planned(project, "e-kipling") == []

    _write_outline(project, "07-seven-to-one", "1. Kipling is back.\n")
    assert _planned(project, "e-kipling") == ["07-seven-to-one.md"]


def test_an_unreadable_outline_costs_that_file_and_nothing_else(project):
    _entity(project, "e-kipling", "Kipling")
    _write_outline(project, "07-seven-to-one", "1. Kipling counts them again.\n")
    folder = os.path.join(project, "outlines", "chapters")
    with open(os.path.join(folder, "99-broken.md"), "wb") as f:
        f.write(b"\xff\xfe\x00 not utf-8 \xff")

    assert _planned(project, "e-kipling") == ["07-seven-to-one.md"]
