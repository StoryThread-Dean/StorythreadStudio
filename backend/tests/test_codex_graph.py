# tests/test_codex_graph.py -- the map, over HTTP
# ================================================
# R8.11. The spec names this file and it did not exist, which matters more here
# than it would elsewhere: the graph route is the ONE place where visibility is
# applied to a whole connection rather than to a single record, and the bug that
# rule was written for -- a secret Tie drawn on a map that was correctly hiding
# the secret behind it -- is invisible until somebody looks at the picture.
#
# The modules underneath have their own tests. visibility.py knows the rules and
# test_codex_visibility.py pins them. What only the ROUTE can get wrong:
#
#   - a Thread not yet introduced appearing at an earlier anchor. Nothing
#     asserted this anywhere, and it is the most ordinary spoiler there is: a
#     character who does not turn up until chapter twelve, sitting on the map
#     while the writer works on chapter two.
#   - an edge outliving its endpoints. Hiding a node and keeping its line draws
#     a connection to nothing and names the thing that was hidden.
#   - a hidden thing being hidden SILENTLY. A map that quietly omits looks like
#     a world with less in it than the writer built, and they have no way to
#     tell the difference.
#   - one pair growing several lines as a relationship develops. Three states of
#     one friendship is one line whose label changes, not three lines.
#
# WHAT WRITING THIS FILE FOUND: the route's docstring said a Tie that is true
# LATER comes back with active=false so the map can draw it dashed, and it could
# not. `record_visibility` hid a future Tie outright, before the route's
# `not_yet` branch was reached, so `active: false` only ever meant "ended".
# Same class as R6.1's depth ceiling -- a documented capability whose condition
# can never be true, raising nothing.
#
# Fixed on the writer's ruling (R8.6b) with `show_future` on the lens, set for
# the MAP alone: the resolver and the brief must go on treating a future fact as
# not in force, which is the one thing anchors exist to guarantee. The spoiler
# check still runs, so a future connection nothing foreshadowed stays withheld.

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils.structure_store import ensure_chapter_ids

client = TestClient(app)


def _thread(entity_id: str, name: str, *, run: str = "", ties: str = "",
            body: str = "Someone.") -> str:
    return (
        "---\n"
        f"type: character\n"
        f"entity_id: {entity_id}\n"
        f"name: {name}\n"
        f"{ties}"
        "---\n\n"
        "# Overview\n"
        f"{body}\n"
        f"{run}"
    )


@pytest.fixture
def project(tmp_path):
    """
    Three chapters and a small world with one of everything that can hide.

    Elara is around from chapter one. Garrick is not introduced until chapter
    three -- every anchor on him is there. Their connection is public; the
    connection between Elara and Mira is a secret the reader learns in chapter
    three.
    """
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    for name, title in (("01-a.md", "One"), ("02-b.md", "Two"), ("03-c.md", "Three")):
        (root / "manuscript" / name).write_text(f"# Chapter {title}\n\nRain.\n",
                                                encoding="utf-8")
    ids = ensure_chapter_ids(str(root))
    c1, c2, c3 = ids["01-a.md"], ids["02-b.md"], ids["03-c.md"]

    write = lambda f, text: (root / "codex" / "characters" / f).write_text(  # noqa: E731
        text, encoding="utf-8")

    write("elara.md", _thread(
        "e-elara", "Elara Voss",
        run=("\n# Run\n"
             f"- id: f-1\n  at: {c1}\n  axis: home\n  value: \"Ashfall.\"\n"),
        ties=("ties:\n"
              "  - rel: mentored_by\n"
              "    target: e-garrick\n"
              "    reason: He taught her the trade.\n"
              f"    at: {c3}\n"
              "  - rel: connected_to\n"
              "    target: e-mira\n"
              "    reason: They are half sisters.\n"
              f"    at: {c1}\n"
              f"    revealed_at: {c3}\n"),
    ))
    # Introduced in chapter three: every anchor on him is there.
    write("garrick.md", _thread(
        "e-garrick", "Garrick Vale",
        run=("\n# Run\n"
             f"- id: f-2\n  at: {c3}\n  axis: home\n  value: \"The capital.\"\n"),
    ))
    write("mira.md", _thread(
        "e-mira", "Mira Kell",
        run=("\n# Run\n"
             f"- id: f-3\n  at: {c1}\n  axis: home\n  value: \"Ashfall.\"\n"),
    ))
    return str(root), c1, c2, c3


def _graph(project_path: str, **kw) -> dict:
    response = client.get("/api/codex/graph",
                          params={"project_path": project_path, **kw})
    assert response.status_code == 200, response.text
    return response.json()


def _names(graph: dict) -> set[str]:
    return {n["name"] for n in graph["nodes"]}


# ── The whole world, with no anchor ──────────────────────────────────────────

def test_with_no_point_chosen_the_writer_sees_everything(project):
    # The default is the writer's own view of their own finished book. Hiding
    # what they have not dated would make the map useless for the ordinary case
    # where nothing is anchored yet.
    folder, _, _, _ = project
    graph = _graph(folder)
    assert _names(graph) == {"Elara Voss", "Garrick Vale", "Mira Kell"}
    assert graph["as_of"] is None


# ── The one nothing asserted: not yet introduced ─────────────────────────────

def test_a_thread_not_yet_introduced_is_omitted_at_an_earlier_anchor(project):
    # THE test this file was named for. A character whose every anchor is in
    # chapter three has not appeared yet in chapter one, and a map that draws
    # him there is telling the writer about their own book in the wrong order --
    # which is the entire reason anchors exist.
    folder, c1, _, _ = project
    graph = _graph(folder, at=c1)
    assert "Garrick Vale" not in _names(graph)
    assert "Elara Voss" in _names(graph)


def test_the_same_thread_appears_once_the_story_reaches_it(project):
    folder, _, _, c3 = project
    assert "Garrick Vale" in _names(_graph(folder, at=c3))


def test_a_thread_with_nothing_anchored_is_shown_rather_than_hidden(project):
    # The deliberate asymmetry: an unknown REVEAL point hides (a leak cannot be
    # taken back), an unknown INTRODUCTION shows (being unhelpful is a bug).
    # Most entries in a real project have no anchors at all.
    folder, c1, _, _ = project
    (   # a fourth character with no Run and no ties
        __import__("pathlib").Path(folder) / "codex" / "characters" / "nyla.md"
    ).write_text(_thread("e-nyla", "Nyla Sarn"), encoding="utf-8")
    assert "Nyla Sarn" in _names(_graph(folder, at=c1))


# ── Edges are judged as whole connections ────────────────────────────────────

def test_an_edge_never_outlives_the_thread_it_points_at(project):
    # An edge asserts three things: that both ends exist and that they are
    # related. Drawing a line to a hidden node names the thing that was hidden.
    folder, c1, _, _ = project
    graph = _graph(folder, at=c1)
    visible = {n["entity_id"] for n in graph["nodes"]}
    for edge in graph["edges"]:
        assert edge["src_id"] in visible and edge["dst_id"] in visible, edge


def test_a_secret_connection_is_withheld_until_the_reader_learns_it(project):
    # Public endpoints, secret connection. This is the exact bug the shared
    # visibility module was written to close, and the map is where it shows.
    folder, c1, _, c3 = project
    early = _graph(folder, at=c1)
    assert not [e for e in early["edges"]
                if {e["src_id"], e["dst_id"]} == {"e-elara", "e-mira"}]

    late = _graph(folder, at=c3)
    assert [e for e in late["edges"]
            if {e["src_id"], e["dst_id"]} == {"e-elara", "e-mira"}]


def test_spoilers_can_be_turned_off_for_the_writers_own_view(project):
    # The writer is not their own reader. With spoiler hiding off, the secret is
    # theirs to look at.
    folder, c1, _, _ = project
    graph = _graph(folder, at=c1, hide_spoilers=False)
    assert [e for e in graph["edges"]
            if {e["src_id"], e["dst_id"]} == {"e-elara", "e-mira"}]


# ── Nothing is hidden silently ───────────────────────────────────────────────

def test_what_is_left_out_is_counted(project):
    # A map that quietly omits looks like a world with less in it than the
    # writer built, and nothing on screen would say otherwise.
    folder, c1, _, _ = project
    graph = _graph(folder, at=c1)
    assert graph["hidden_nodes"] >= 1
    assert graph["hidden_edges"] >= 1


def test_nothing_is_reported_hidden_when_nothing_is(project):
    # The other half. A count that is never zero is a count nobody believes.
    folder, _, _, _ = project
    graph = _graph(folder, hide_spoilers=False)
    assert graph["hidden_nodes"] == 0
    assert graph["hidden_edges"] == 0


# ── One pair, one line ───────────────────────────────────────────────────────

def test_a_connection_that_develops_is_one_line_not_three(tmp_path):
    # Acquaintances, then friends, then something more, is three STATES of one
    # connection. Drawing a line each stacks three labels and makes a developing
    # friendship look like a crowd -- the scrubber exists so the LABEL changes.
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    for name in ("01-a.md", "02-b.md", "03-c.md"):
        (root / "manuscript" / name).write_text("# C\n\nRain.\n", encoding="utf-8")
    ids = ensure_chapter_ids(str(root))
    c1, c2, c3 = ids["01-a.md"], ids["02-b.md"], ids["03-c.md"]

    (root / "codex" / "characters" / "a.md").write_text(_thread(
        "e-a", "Ana",
        ties=("ties:\n"
              f"  - rel: connected_to\n    target: e-b\n"
              f"    reason: They share a shift.\n    at: {c1}\n"
              f"  - rel: rivals\n    target: e-b\n"
              f"    reason: One of them wants the other's post.\n    at: {c2}\n"
              f"  - rel: loves\n    target: e-b\n"
              f"    reason: It turned, and neither says so.\n    at: {c3}\n"),
    ), encoding="utf-8")
    (root / "codex" / "characters" / "b.md").write_text(
        _thread("e-b", "Bel"), encoding="utf-8")

    for anchor, expected in ((c1, "connected_to"), (c2, "rivals"), (c3, "loves")):
        graph = _graph(str(root), at=anchor)
        pair = [e for e in graph["edges"]
                if {e["src_id"], e["dst_id"]} == {"e-a", "e-b"}]
        assert len(pair) == 1, f"{len(pair)} lines at {anchor}"
        assert pair[0]["rel"] == expected, anchor


def test_a_connection_that_is_not_true_yet_is_drawn_as_not_yet(tmp_path):
    # Returned with active=false rather than dropped: the writer is looking at
    # their own future book, not a reader's view, and a dashed line is more use
    # than an absence.
    #
    # BOTH ENDS HAVE TO BE AROUND ALREADY, which is why this builds its own
    # world rather than reusing the fixture. A tie to somebody not yet
    # introduced is hidden by the ENDPOINT, and rightly: drawing it dashed would
    # still announce that a character called Garrick is coming. Two people who
    # both exist from chapter one and do not marry until chapter nine is the
    # case this is for.
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    for name in ("01-a.md", "02-b.md"):
        (root / "manuscript" / name).write_text("# C\n\nRain.\n", encoding="utf-8")
    ids = ensure_chapter_ids(str(root))
    c1, c2 = ids["01-a.md"], ids["02-b.md"]

    (root / "codex" / "characters" / "a.md").write_text(_thread(
        "e-a", "Ana",
        run=("\n# Run\n"
             f"- id: f-a\n  at: {c1}\n  axis: home\n  value: \"Here.\"\n"),
        ties=("ties:\n"
              "  - rel: married_to\n    target: e-b\n"
              "    reason: They marry after the siege.\n"
              f"    at: {c2}\n"),
    ), encoding="utf-8")
    (root / "codex" / "characters" / "b.md").write_text(_thread(
        "e-b", "Bel",
        run=("\n# Run\n"
             f"- id: f-b\n  at: {c1}\n  axis: home\n  value: \"Here too.\"\n"),
    ), encoding="utf-8")

    # This branch was UNREACHABLE until R8.6b. record_visibility hid a future
    # Tie before the route's `not_yet` test ran, so `active: false` could only
    # ever mean "ended" -- the same class as R6.1's depth ceiling, and just as
    # silent. `show_future` on the lens is what makes the route's own docstring
    # true, and it is set for the map ALONE: the resolver and the brief must go
    # on treating a future fact as not in force.
    later = [e for e in _graph(str(root), at=c1, hide_spoilers=False)["edges"]
             if {e["src_id"], e["dst_id"]} == {"e-a", "e-b"}]
    assert later and later[0]["active"] is False
    assert later[0]["expired"] is False, "not yet is not the same as over"

    # With spoiler hiding ON it is withheld outright, because a Tie with no
    # reveal point of its own becomes known where it happens -- and a reader in
    # chapter one has not been told these two will marry.
    assert not [e for e in _graph(str(root), at=c1)["edges"]
                if {e["src_id"], e["dst_id"]} == {"e-a", "e-b"}]


def test_a_foreshadowed_future_connection_is_drawn_even_to_a_reader(tmp_path):
    # The other half of "only for things already revealed". If the reader has
    # been TOLD in chapter one that these two are promised to each other, the
    # coming marriage is not a spoiler and the line belongs on the map, dashed.
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    for name in ("01-a.md", "02-b.md"):
        (root / "manuscript" / name).write_text("# C\n\nRain.\n", encoding="utf-8")
    ids = ensure_chapter_ids(str(root))
    c1, c2 = ids["01-a.md"], ids["02-b.md"]

    (root / "codex" / "characters" / "a.md").write_text(_thread(
        "e-a", "Ana",
        run=("\n# Run\n"
             f"- id: f-a\n  at: {c1}\n  axis: home\n  value: \"Here.\"\n"),
        ties=("ties:\n"
              "  - rel: married_to\n    target: e-b\n"
              "    reason: Promised in chapter one, married in chapter two.\n"
              f"    at: {c2}\n    revealed_at: {c1}\n"),
    ), encoding="utf-8")
    (root / "codex" / "characters" / "b.md").write_text(_thread(
        "e-b", "Bel",
        run=("\n# Run\n"
             f"- id: f-b\n  at: {c1}\n  axis: home\n  value: \"Here too.\"\n"),
    ), encoding="utf-8")

    coming = [e for e in _graph(str(root), at=c1)["edges"]
              if {e["src_id"], e["dst_id"]} == {"e-a", "e-b"}]
    assert coming and coming[0]["active"] is False


def test_a_future_connection_to_someone_not_yet_introduced_stays_hidden(project):
    # show_future must not become a hole in the introduction rule. Drawing this
    # dashed would still announce that a character called Garrick is coming,
    # which is the thing the endpoint check exists to prevent.
    folder, c1, _, _ = project
    assert not [e for e in _graph(folder, at=c1, hide_spoilers=False)["edges"]
                if {e["src_id"], e["dst_id"]} == {"e-elara", "e-garrick"}]


def test_a_connection_that_has_ENDED_is_drawn_as_over(tmp_path):
    # The half of `active` that does work. `until` is not consulted by the
    # visibility rules at all, so an ended tie stays on the map and is marked
    # over -- which is right: a marriage that ended in chapter nine is part of
    # the world at chapter twelve, and drawing nothing would lose it.
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    for name in ("01-a.md", "02-b.md", "03-c.md"):
        (root / "manuscript" / name).write_text("# C\n\nRain.\n", encoding="utf-8")
    ids = ensure_chapter_ids(str(root))
    c1, c2, c3 = ids["01-a.md"], ids["02-b.md"], ids["03-c.md"]

    (root / "codex" / "characters" / "a.md").write_text(_thread(
        "e-a", "Ana",
        ties=("ties:\n"
              "  - rel: married_to\n    target: e-b\n"
              "    reason: It lasted two chapters.\n"
              f"    at: {c1}\n    until: {c2}\n"),
    ), encoding="utf-8")
    (root / "codex" / "characters" / "b.md").write_text(
        _thread("e-b", "Bel"), encoding="utf-8")

    over = [e for e in _graph(str(root), at=c3)["edges"]
            if {e["src_id"], e["dst_id"]} == {"e-a", "e-b"}]
    assert over and over[0]["active"] is False and over[0]["expired"] is True

    # And it is live while it lasts.
    live = [e for e in _graph(str(root), at=c1)["edges"]
            if {e["src_id"], e["dst_id"]} == {"e-a", "e-b"}]
    assert live and live[0]["active"] is True


def test_every_edge_carries_the_reason_it_was_recorded(project):
    # The Weave exists so a writer need not paste context. "A connected to B"
    # spends brief budget to say nothing the prose did not already show, which
    # is why the reason is the one field a connection cannot be saved without --
    # and the map is where it earns that.
    folder, _, _, c3 = project
    graph = _graph(folder, at=c3, hide_spoilers=False)
    assert graph["edges"]
    for edge in graph["edges"]:
        assert edge["reason"].strip(), edge


def test_a_tie_pointing_at_nothing_draws_nothing(tmp_path):
    # A hand-edited file, or an entry deleted since. The map must not render a
    # line into empty space.
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "codex" / "characters").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "manuscript" / "01-a.md").write_text("# C\n\nRain.\n", encoding="utf-8")
    ensure_chapter_ids(str(root))
    (root / "codex" / "characters" / "a.md").write_text(_thread(
        "e-a", "Ana",
        ties=("ties:\n"
              "  - rel: connected_to\n    target: e-ghost\n"
              "    reason: Whatever this was.\n"),
    ), encoding="utf-8")

    graph = _graph(str(root))
    assert _names(graph) == {"Ana"}
    assert graph["edges"] == []
