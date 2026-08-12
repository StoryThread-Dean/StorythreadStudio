# tests/test_the_opening_example.py -- the thing the Weave was built for
# ======================================================================
# `docs/weave-spec.md` opens with one example, and it is the argument for the
# whole feature:
#
#   A heroine believes her father died in a raid. She believes it from chapter
#   one. In chapter fifteen she learns he is alive -- and so does the reader.
#   Ask the app who she is in chapter seven and it should say she is grieving a
#   man who is not dead; ask in chapter twenty and it should say she knows.
#
# The 2026-08-11 audit found this UNREACHABLE through the interface. Not broken:
# absent. The pieces existed -- anchors, frames, resolution, a story scrubber on
# the map -- and there was no screen on which a writer could record the example
# the feature is named after. Characters live in the Profile Builder, which had
# no fact editor, and `revealed_at` had no control anywhere at all.
#
# This is R2.5's done-when line, as a test: the example recorded the way a writer
# records it, then read back at three points in the book.
#
# It goes through the HTTP surface on purpose. A unit test of the resolver would
# have passed for the entire time the example was unrecordable.
#
# THREE FACTS, NOT TWO, and writing it taught me something worth recording here.
# A belief is only drawn on when resolving FROM THAT CHARACTER'S viewpoint --
# `frames_for` returns objective truth alone unless a pov is named. That is
# correct and deliberate: her mistake is not a fact about the world, and a brief
# for a scene she is not in should not carry it. So the example needs her
# CHANGE OF MIND recorded too, as a third fact on her own frame.

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CHAPTERS = [
    ("01-the-raid.md", "The Raid"),
    ("07-the-long-winter.md", "The Long Winter"),
    ("15-the-letter.md", "The Letter"),
    ("20-after.md", "After"),
]

ELARA = "e-elara"


@pytest.fixture
def project(tmp_path):
    """A converted project with four chapters and one character."""
    from app.utils.structure_store import ensure_chapter_ids

    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(
        json.dumps({"title": "N", "codex_migration_version": 1}), encoding="utf-8")

    for filename, title in CHAPTERS:
        (root / "manuscript" / filename).write_text(
            f"# {title}\n\nText.\n", encoding="utf-8")

    (root / "codex" / "characters" / "elara.md").write_text(
        "---\ntype: character\nentity_id: e-elara\nname: Elara Voss\n---\n\n"
        "# Overview\nA tall woman with a borrowed sword.\n",
        encoding="utf-8")

    ensure_chapter_ids(str(root))
    return str(root)


def _anchors(project) -> dict[str, str]:
    """Chapter title -> anchor, the way the editor's dropdown builds it."""
    body = client.get("/api/codex/anchors",
                      params={"project_path": project}).json()
    return {c["title"]: c["anchor"] for c in body["chapters"]}


def _elara(project) -> dict:
    return client.get("/api/codex/entity",
                      params={"project_path": project,
                              "entity_id": ELARA}).json()


def _record_the_example(project) -> dict:
    """
    What the writer does on screen: open the character, add three facts to the
    Run, and save.

    Written as the editor writes it -- the whole entry, with the Run as a list of
    facts -- rather than through a per-fact endpoint, because that is the path the
    Profile Builder and the Weave's own editor both take.
    """
    anchors = _anchors(project)
    thread = _elara(project)
    thread["run"] = [
        {
            # What she believes, from the beginning. `frame` is what makes this
            # recordable without making it TRUE.
            "id": "f-believes",
            "axis": "belief.father",
            "at": anchors["The Raid"],
            "value": "Her father died in the raid.",
            "frame": ELARA,
        },
        {
            # What is actually true, all along -- and what the READER does not
            # learn until chapter fifteen. Two different anchors on one fact,
            # which is the pair that had no control until R2.5.
            "id": "f-alive",
            "axis": "belief.father",
            "at": anchors["The Raid"],
            "value": "Her father is alive, held in the north.",
            "frame": "truth",
            "revealed_at": anchors["The Letter"],
        },
        {
            # And her change of mind, on her own frame. Same axis and same frame
            # as her earlier belief, so it supersedes it by position: after
            # chapter fifteen she no longer thinks he is dead.
            "id": "f-learns",
            "axis": "belief.father",
            "at": anchors["The Letter"],
            "value": "Her father is alive, and she knows it.",
            "frame": ELARA,
        },
    ]
    response = client.post("/api/codex/entity", json={
        "project_path": project, "thread": thread,
        "base_revision": thread.get("revision")})
    assert response.status_code == 200, response.json()
    return anchors


def _resolved(project, at: str, pov: str | None = None) -> dict:
    params = {"project_path": project, "entity_id": ELARA, "at": at}
    if pov:
        params["pov"] = pov
    return client.get("/api/codex/resolve", params=params).json()


def _values(resolved: dict) -> list[str]:
    return [f["value"] for f in resolved["run"]]


# ── Recording it ─────────────────────────────────────────────────────────────

def test_a_writer_can_record_the_example_at_all(project):
    # The audit's finding, as an assertion. Everything below depends on this.
    _record_the_example(project)
    run = {fact["id"]: fact for fact in _elara(project)["run"]}
    assert run["f-believes"]["frame"] == ELARA
    assert run["f-alive"]["frame"] == "truth"
    assert run["f-learns"]["at"]


def test_the_reveal_point_survives_the_save(project):
    # `revealed_at` was in the file format, in the type, in the resolver and in
    # spoiler mode, and NOTHING could set it. A field nothing can write is a
    # feature that does not exist.
    anchors = _record_the_example(project)
    run = {fact["id"]: fact for fact in _elara(project)["run"]}
    assert run["f-alive"]["revealed_at"] == anchors["The Letter"]
    # And a fact with no reveal point keeps none, rather than being given one.
    assert not run["f-believes"].get("revealed_at")


def test_the_writer_picks_a_chapter_rather_than_typing_an_id(project):
    # The editor's dropdowns are built from this, and it is why a writer never
    # sees an anchor: their own chapter titles, in their own order.
    body = client.get("/api/codex/anchors",
                      params={"project_path": project}).json()
    assert [c["title"] for c in body["chapters"]] == [t for _, t in CHAPTERS]
    assert all(c["anchor"] for c in body["chapters"])


# ── Reading it back at three points in the book ──────────────────────────────

def test_in_chapter_seven_she_is_grieving_a_man_who_is_not_dead(project):
    # The sentence the spec opens with. From inside her head at chapter seven she
    # believes he is dead; the truth is withheld, because the reader does not know
    # it yet either. Both halves in one answer is the whole point of frames.
    anchors = _record_the_example(project)
    resolved = _resolved(project, anchors["The Long Winter"], pov=ELARA)
    assert any("died in the raid" in v for v in _values(resolved))
    assert not any("alive" in v for v in _values(resolved))
    assert resolved["withheld_spoilers"] == 1


def test_in_chapter_twenty_she_knows(project):
    # Her change of mind supersedes her earlier belief, because they share an
    # axis and a frame and this one is later.
    anchors = _record_the_example(project)
    values = _values(_resolved(project, anchors["After"], pov=ELARA))
    assert any("she knows it" in v for v in values)
    assert not any("died in the raid" in v for v in values)


def test_without_a_viewpoint_only_the_world_is_reported(project):
    # A belief is not a fact about the world. Asked plainly, at chapter seven,
    # the honest answer is that there is nothing to say yet -- her mistake belongs
    # to her, and the truth is still a spoiler.
    anchors = _record_the_example(project)
    early = _resolved(project, anchors["The Long Winter"])
    assert _values(early) == []
    assert early["withheld_spoilers"] == 1

    late = _resolved(project, anchors["After"])
    assert any("held in the north" in v for v in _values(late))


def test_the_brief_says_which_is_believed_and_which_is_true(project):
    # What a model actually receives when drafting from her viewpoint. A brief
    # listing both without marking the belief would read as a contradiction and
    # the model would pick one.
    anchors = _record_the_example(project)
    body = client.post("/api/codex/context", json={
        "project_path": project,
        "at": anchors["The Long Winter"],
        "pov": ELARA,
        "text": "Elara Voss stood at the window.",
    }).json()
    brief = body.get("brief") or ""
    assert "believed" in brief.lower()
    assert "died in the raid" in brief


# ── The reveal, which is what the story scrubber moves through ───────────────

def test_before_chapter_fifteen_the_truth_is_hidden_from_the_map(project):
    # Spoiler mode on the map hides what the reader does not know yet. Until
    # `revealed_at` could be set, every truth was visible at chapter one and the
    # scrubber had nothing to reveal.
    from app.codex.anchors import AnchorIndex
    from app.codex.visibility import VISIBLE, Lens, record_visibility

    anchors = _record_the_example(project)
    index = AnchorIndex.for_project(project)
    truth = next(f for f in _elara(project)["run"] if f["id"] == "f-alive")

    # VISIBLE is the empty string: the function returns the REASON something is
    # withheld, and no reason means it shows.
    early = record_visibility(
        truth, index, Lens.for_pov(anchors["The Long Winter"], None))
    late = record_visibility(truth, index, Lens.for_pov(anchors["After"], None))
    assert early != VISIBLE
    assert late == VISIBLE


def test_the_belief_is_visible_from_the_start(project):
    # She believes it from chapter one and the reader watches her believe it, so
    # there is nothing to withhold.
    from app.codex.anchors import AnchorIndex
    from app.codex.visibility import VISIBLE, Lens, record_visibility

    anchors = _record_the_example(project)
    index = AnchorIndex.for_project(project)
    belief = next(f for f in _elara(project)["run"] if f["id"] == "f-believes")
    assert record_visibility(
        belief, index,
        Lens.for_pov(anchors["The Long Winter"], ELARA)) == VISIBLE
