# tests/test_codex_sections.py -- what the sidebar shows, and why
# ================================================================
# The old sidebar listed everything the app could hold whether or not the
# writer had used any of it. That is fine with four kinds of entry. With
# nine, plus whatever kinds a writer invents, it becomes a wall of empty
# headings -- and a beginner reads that as "there is an enormous amount I am
# supposed to fill in".
#
# One rule replaces it:
#
#     A section appears when it holds something, OR when it is a default.
#
# These tests are that rule, plus the two cases it has to get right without
# a special case anywhere: a brand new project (which should look inviting,
# not empty) and an existing one (which must not appear to have lost work).

import json

import pytest
from fastapi.testclient import TestClient

from app.codex.sections import build_sections
from app.codex.types_registry import TypesError, add_type, set_type_group
from app.main import app

client = TestClient(app)


def _project(tmp_path, *, profiles=(), notes=(), converted=False) -> str:
    root = tmp_path / "MyNovel"
    root.mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    base = root / ("codex" if converted else "profiles")
    for folder, names in profiles:
        (base / folder).mkdir(parents=True, exist_ok=True)
        for name in names:
            (base / folder / f"{name}.md").write_text("# x\n", encoding="utf-8")
    if notes:
        (root / "notes").mkdir(exist_ok=True)
        for filename, body in notes:
            (root / "notes" / filename).write_text(body, encoding="utf-8")
    return str(root)


def _sections(tree, group):
    for entry in tree["groups"]:
        if entry["id"] == group:
            return {s["id"]: s for s in entry["sections"]}
    return {}


def _group_ids(tree):
    return [g["id"] for g in tree["groups"]]


def _available_ids(tree):
    return {a["id"] for a in tree["available"]}


# ── The rule ─────────────────────────────────────────────────────────────────

def test_a_new_project_shows_only_the_defaults(tmp_path):
    # Somewhere obvious to start, and nothing else. Nine empty headings would
    # read as a demand rather than an invitation.
    tree = build_sections(_project(tmp_path), converted=False)
    assert set(_sections(tree, "profiles")) == {"character", "location", "lore"}
    assert set(_sections(tree, "notes")) == {"author_notes"}
    # "etc" has nothing in it yet, so it is not a heading at all.
    assert "etc" not in _group_ids(tree)


def test_everything_else_is_offered_rather_than_hidden(tmp_path):
    # Not hidden -- waiting. "+ Add New" is where a writer looks for a kind
    # they have not used yet.
    tree = build_sections(_project(tmp_path), converted=False)
    assert {"faction", "religion", "object", "concept", "event"} <= _available_ids(tree)
    assert {"outline", "style_guide"} <= _available_ids(tree)


def test_a_section_appears_once_it_holds_something(tmp_path):
    folder = _project(tmp_path, profiles=[("factions", ["the-order"])])
    tree = build_sections(folder, converted=False)
    assert "faction" in _sections(tree, "etc")
    assert "faction" not in _available_ids(tree)
    # And the group it lives in now exists.
    assert "etc" in _group_ids(tree)


def test_a_default_section_shows_even_when_empty(tmp_path):
    tree = build_sections(_project(tmp_path), converted=False)
    assert _sections(tree, "profiles")["character"]["count"] == 0


def test_sections_report_how_much_is_in_them(tmp_path):
    folder = _project(tmp_path, profiles=[("characters", ["a", "b", "c"])])
    tree = build_sections(folder, converted=False)
    assert _sections(tree, "profiles")["character"]["count"] == 3


# ── An existing project must not appear to have lost work ────────────────────

def test_an_existing_outline_keeps_its_section(tmp_path):
    # THE case the rule has to get right without a special case. Existing
    # projects all have these files; they must keep showing exactly as
    # before, while a NEW project starts clean.
    folder = _project(tmp_path, notes=[
        ("outline.md", "# Outline\n\nAct one.\n"),
        ("style-guide.md", "# Style\n\nNo em dashes.\n"),
    ])
    tree = build_sections(folder, converted=False)
    assert {"author_notes", "outline", "style_guide"} <= set(_sections(tree, "notes"))
    assert "outline" not in _available_ids(tree)


def test_an_empty_scaffolded_outline_does_not_count_as_content(tmp_path):
    # Project creation writes these files empty. An empty Outline is not a
    # reason to show the section -- that would put every project back to the
    # wall of headings.
    folder = _project(tmp_path, notes=[("outline.md", "   \n\n")])
    tree = build_sections(folder, converted=False)
    assert "outline" not in _sections(tree, "notes")
    assert "outline" in _available_ids(tree)


def test_a_note_the_writer_added_by_hand_is_discovered(tmp_path):
    # Their file, their section. Pretending it is not there would be worse
    # than an unexpected heading.
    folder = _project(tmp_path, notes=[("world-rules.md", "Rules.\n")])
    tree = build_sections(folder, converted=False)
    assert "world_rules" in _sections(tree, "notes")
    assert _sections(tree, "notes")["world_rules"]["label"] == "World Rules"


def test_existing_profiles_populate_the_tree_before_conversion(tmp_path):
    # Conversion is an offer, not a toll gate: the new sidebar has to be
    # useful on a project that has never been brought in.
    folder = _project(tmp_path, profiles=[("characters", ["elara", "garrick"])])
    tree = build_sections(folder, converted=False)
    assert _sections(tree, "profiles")["character"]["count"] == 2


def test_the_tree_looks_the_same_after_conversion(tmp_path):
    # The sidebar must not change shape underneath a writer when they convert.
    before = build_sections(
        _project(tmp_path / "a", profiles=[("characters", ["elara"])]), converted=False)
    after = build_sections(
        _project(tmp_path / "b", profiles=[("characters", ["elara"])], converted=True),
        converted=True)
    assert _group_ids(before) == _group_ids(after)
    assert set(_sections(before, "profiles")) == set(_sections(after, "profiles"))


# ── Groups ───────────────────────────────────────────────────────────────────

def test_groups_come_back_in_a_settled_order(tmp_path):
    # etc last: a catch-all above the things it is a catch-all FOR reads as
    # a mistake.
    folder = _project(tmp_path, profiles=[("factions", ["x"])],
                      notes=[("outline.md", "Act one.\n")])
    assert _group_ids(build_sections(folder, converted=False)) == \
        ["notes", "profiles", "etc"]


def test_an_empty_group_is_not_a_heading(tmp_path):
    tree = build_sections(_project(tmp_path), converted=False)
    for group in tree["groups"]:
        assert group["sections"], f"{group['id']} is an empty heading"


# ── Kinds a writer invents ───────────────────────────────────────────────────

def test_a_custom_kind_becomes_a_section(tmp_path):
    # Government and Deity are not among the nine. A custom kind must behave
    # exactly like a built-in one, which is the whole point of the registry
    # being data.
    folder = _project(tmp_path)
    add_type(folder, "government", "Government", group="etc")
    tree = build_sections(folder, converted=False)
    assert "government" in _sections(tree, "etc")


def test_a_custom_kind_shows_immediately_without_waiting_for_an_entry(tmp_path):
    # A kind the writer added on purpose is one they intend to use.
    folder = _project(tmp_path)
    add_type(folder, "deity", "Deity", group="profiles")
    assert _sections(build_sections(folder, converted=False), "profiles")["deity"]["count"] == 0


def test_a_custom_kind_can_be_put_in_any_group(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "bloodline", "Bloodline", group="profiles")
    assert "bloodline" in _sections(build_sections(folder, converted=False), "profiles")


def test_a_section_can_be_moved_afterwards(tmp_path):
    # A world where Factions belong with the people should be able to say so.
    folder = _project(tmp_path, profiles=[("factions", ["x"])])
    set_type_group(folder, "faction", "profiles")
    tree = build_sections(folder, converted=False)
    assert "faction" in _sections(tree, "profiles")
    assert "faction" not in _sections(tree, "etc")


def test_a_duplicate_kind_is_refused(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="already has a kind"):
        add_type(folder, "character", "Character")


def test_an_unusable_id_is_refused(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError):
        add_type(folder, "Not An Id", "Nope")


def test_an_unknown_group_is_refused(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="sidebar group"):
        add_type(folder, "government", "Government", group="somewhere")


# ── Over HTTP ────────────────────────────────────────────────────────────────

def test_the_sections_endpoint_returns_the_tree(tmp_path):
    folder = _project(tmp_path)
    body = client.get("/api/codex/sections", params={"project_path": folder}).json()
    assert [g["id"] for g in body["groups"]] == ["notes", "profiles"]
    assert body["converted"] is False


def test_adding_a_kind_over_http_returns_the_new_tree(tmp_path):
    folder = _project(tmp_path)
    body = client.post("/api/codex/type", json={
        "project_path": folder, "id": "government", "label": "Government", "group": "etc",
    }).json()
    assert "government" in {s["id"] for g in body["groups"] if g["id"] == "etc"
                            for s in g["sections"]}


def test_adding_a_kind_that_exists_is_refused_by_name(tmp_path):
    folder = _project(tmp_path)
    response = client.post("/api/codex/type", json={
        "project_path": folder, "id": "character", "label": "Character",
    })
    assert response.json()["detail"]["code"] == "type_invalid"
    assert "already has a kind" in response.json()["detail"]["detail"]


def test_moving_a_section_over_http(tmp_path):
    folder = _project(tmp_path, profiles=[("religions", ["x"])])
    body = client.patch("/api/codex/type/group", json={
        "project_path": folder, "id": "religion", "group": "profiles",
    }).json()
    assert "religion" in {s["id"] for g in body["groups"] if g["id"] == "profiles"
                          for s in g["sections"]}
