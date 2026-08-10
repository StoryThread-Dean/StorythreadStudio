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

from app.codex.sections import build_sections, create_note
from app.codex.types_registry import (
    TypesError, add_type, default_registry, hide_type, set_type_group, show_type,
)
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
    # Somewhere obvious to start, and nothing else. A dozen empty headings
    # would read as a demand rather than an invitation.
    tree = build_sections(_project(tmp_path), converted=False)
    assert set(_sections(tree, "notes")) == {"author_notes"}
    assert set(_sections(tree, "profiles")) == {"character", "location", "lore"}
    assert set(_sections(tree, "other")) == {"event"}


def test_every_group_opens_with_something_in_it(tmp_path):
    # Not just a heading. Each group starts with at least one familiar kind
    # a writer can click straight into, so none of the three is a dead end
    # on day one -- Other especially, whose name gives nothing away.
    tree = build_sections(_project(tmp_path), converted=False)
    for group in tree["groups"]:
        assert group["sections"], f"{group['id']} opens with nothing to click"


def test_all_three_groups_are_always_there(tmp_path):
    # The three groups are the navigational skeleton. A writer opens the
    # Weave, sees Notes / Profiles / Other, and moves toward whichever
    # matches what they are thinking about. Hiding one until it had content
    # would mean they never found it -- and would leave nowhere to click
    # "+ Add New" for everything that belongs there, which is the only route
    # to most of the app.
    tree = build_sections(_project(tmp_path), converted=False)
    assert _group_ids(tree) == ["notes", "profiles", "other"]


def test_every_group_offers_a_way_to_add_to_it(tmp_path):
    # "+ Add New" sits at the top of each group's list, so the empty Other
    # group is an invitation rather than a dead heading.
    tree = build_sections(_project(tmp_path), converted=False)
    for group in tree["groups"]:
        assert group["available"], f"{group['id']} offers nothing to add"


def test_everything_else_is_offered_rather_than_hidden(tmp_path):
    # Not hidden -- waiting. "+ Add New" is where a writer looks for a kind
    # they have not used yet.
    tree = build_sections(_project(tmp_path), converted=False)
    assert {"faction", "religion", "object", "concept", "language"} <= _available_ids(tree)
    assert {"outline", "style_guide", "brainstorming"} <= _available_ids(tree)
    # ...and a default is NOT offered, because it is already on screen.
    assert "event" not in _available_ids(tree)
    assert "character" not in _available_ids(tree)


def test_a_section_appears_once_it_holds_something(tmp_path):
    folder = _project(tmp_path, profiles=[("factions", ["the-order"])])
    tree = build_sections(folder, converted=False)
    assert "faction" in _sections(tree, "profiles")
    # And stops being offered, because it is now on screen.
    assert "faction" not in _available_ids(tree)


# ── What decides which group a kind belongs to ───────────────────────────────

def _kind_groups() -> dict:
    """Group membership straight from the registry, so these tests describe
    the classification itself rather than whatever happens to be visible."""
    return {t["id"]: t["group"] for t in default_registry()["types"]}


def test_a_profile_is_an_entry_about_something_in_the_world(tmp_path):
    # The dividing line: am I writing a profile OF something? A Faction, a
    # Religion, a Government are profiles of a group, a faith and a state --
    # so they belong beside Character, not in the leftovers.
    groups = _kind_groups()
    for kind in ("character", "location", "lore", "relationship", "faction",
                 "religion", "government", "deity", "creature", "culture"):
        assert groups[kind] == "profiles", f"{kind} should be a Profile"


def test_notes_are_documents_the_writer_authors(tmp_path):
    # Prose, in the writer's own voice -- and they are FILES, not kinds of
    # entry, which is why they live in NOTE_SECTIONS rather than the type
    # registry at all.
    offered = {a["id"]: a["group"]
               for a in build_sections(_project(tmp_path), converted=False)["available"]}
    for note in ("outline", "style_guide", "brainstorming", "research", "themes"):
        assert offered[note] == "notes", f"{note} should be a Note"


def test_other_holds_only_what_is_genuinely_neither(tmp_path):
    groups = _kind_groups()
    other = {k for k, group in groups.items() if group == "other"}
    assert other == {"object", "concept", "event", "language"}


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
    # Other last: a catch-all above the things it is a catch-all FOR reads
    # as a mistake.
    folder = _project(tmp_path, profiles=[("factions", ["x"])],
                      notes=[("outline.md", "Act one.\n")])
    assert _group_ids(build_sections(folder, converted=False)) == \
        ["notes", "profiles", "other"]


def test_a_group_is_labelled_in_words_a_writer_reads(tmp_path):
    # "Other", not "etc". The sidebar is the first thing a new writer meets.
    labels = {g["id"]: g["label"]
              for g in build_sections(_project(tmp_path), converted=False)["groups"]}
    assert labels == {"notes": "Notes", "profiles": "Profiles", "other": "Other"}


# ── Kinds a writer invents ───────────────────────────────────────────────────

def test_a_custom_kind_joins_the_world_like_any_other(tmp_path):
    # Government and Deity are not among the nine. A custom kind must behave
    # exactly like a built-in one -- including waiting for its first entry --
    # which is the whole point of the registry being data rather than code.
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="other")
    tree = build_sections(folder, converted=False)
    assert "bloodline" in _available_ids(tree)

    (tmp_path / "MyNovel" / "profiles" / "bloodlines").mkdir(parents=True)
    (tmp_path / "MyNovel" / "profiles" / "bloodlines" / "the-crown.md").write_text(
        "# x\n", encoding="utf-8")
    assert "bloodline" in _sections(build_sections(folder, converted=False), "other")


def test_a_custom_kind_follows_the_same_rule_as_every_other(tmp_path):
    # Adding the kind is the first half of "choose Government, write the
    # first one, save". A kind whose entry was never saved must not leave an
    # empty heading behind -- it stays offered under "+ Add New", so an
    # abandoned attempt heals itself rather than littering the sidebar.
    folder = _project(tmp_path)
    add_type(folder, "", "Warband", group="profiles")
    tree = build_sections(folder, converted=False)
    assert "warband" not in _sections(tree, "profiles")
    assert "warband" in _available_ids(tree)


def test_a_custom_kind_can_be_put_in_any_group(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="profiles")
    offered = {a["id"]: a["group"]
               for a in build_sections(folder, converted=False)["available"]}
    assert offered["bloodline"] == "profiles"


def test_a_section_can_be_moved_afterwards(tmp_path):
    # A world where Factions belong with the people should be able to say so.
    folder = _project(tmp_path, profiles=[("factions", ["x"])])
    set_type_group(folder, "faction", "profiles")
    tree = build_sections(folder, converted=False)
    assert "faction" in _sections(tree, "profiles")
    assert "faction" not in _sections(tree, "other")


def test_a_duplicate_kind_is_refused(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="already has a kind"):
        add_type(folder, "character", "Character")


def test_a_custom_kind_appears_once_it_has_an_entry(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Warband", group="profiles")
    (tmp_path / "MyNovel" / "profiles" / "warbands").mkdir(parents=True)
    (tmp_path / "MyNovel" / "profiles" / "warbands" / "the-thread.md").write_text(
        "# x\n", encoding="utf-8")
    assert "warband" in _sections(build_sections(folder, converted=False), "profiles")


# ── A name a writer types becomes a folder on their disk ─────────────────────

def test_a_name_with_numbers_is_refused_in_plain_words(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="no numbers"):
        add_type(folder, "", "Order 66", group="other")


def test_a_name_with_symbols_is_refused(tmp_path):
    folder = _project(tmp_path)
    for bad in ["House/Ward", "Ward: North", "Ward*", "Ward.", "<Ward>"]:
        with pytest.raises(TypesError, match="letters and spaces"):
            add_type(folder, "", bad, group="other")


def test_a_windows_reserved_name_is_refused_before_it_can_fail(tmp_path):
    # A writer naming a kind "Aux" is not doing anything wrong, and the
    # failure would be baffling: Windows simply cannot create the folder.
    folder = _project(tmp_path)
    for reserved in ["Con", "Aux", "Nul", "Com1", "Lpt9"]:
        with pytest.raises(TypesError, match="Windows will not allow|no numbers"):
            add_type(folder, "", reserved, group="other")


def test_a_two_word_name_becomes_one_tidy_id(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Royal Household", group="other")
    tree = build_sections(folder, converted=False)
    assert "royal_household" in _available_ids(tree)


def test_an_overlong_name_is_refused(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="too long"):
        add_type(folder, "", "A" * 60, group="other")


def test_an_empty_name_is_refused(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="Give this kind a name"):
        add_type(folder, "", "   ", group="other")


def test_the_id_is_derived_from_the_name_not_accepted_separately(tmp_path):
    # There is no second route in. If the id could be supplied directly, a
    # digit or a symbol could be slipped past the rule that exists to keep
    # folder names safe.
    folder = _project(tmp_path)
    add_type(folder, "ignored_entirely", "Guild", group="other")
    assert "guild" in _available_ids(build_sections(folder, converted=False))


def test_an_unknown_group_is_refused(tmp_path):
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="sidebar group"):
        add_type(folder, "government", "Government", group="somewhere")


# ── Over HTTP ────────────────────────────────────────────────────────────────

# ── Picking a preset SHOWS it, it does not create it ─────────────────────────

def test_picking_a_shipped_kind_shows_its_section(tmp_path):
    # "+ Add New > Faction" is not creating anything: Faction ships with the
    # app and is simply not on screen. Routing this through add_type would
    # refuse it as a duplicate, which is true and completely unhelpful.
    folder = _project(tmp_path)
    show_type(folder, "faction")
    tree = build_sections(folder, converted=False)
    assert "faction" in _sections(tree, "profiles")
    assert "faction" not in _available_ids(tree)


def test_a_shown_section_appears_even_though_it_is_empty(tmp_path):
    # Which is the point -- the writer asked for it so they can put the
    # first entry in.
    folder = _project(tmp_path)
    show_type(folder, "religion")
    assert _sections(build_sections(folder, converted=False), "profiles")["religion"]["count"] == 0


def test_an_unused_section_can_be_tidied_away_again(tmp_path):
    folder = _project(tmp_path)
    show_type(folder, "religion")
    hide_type(folder, "religion")
    tree = build_sections(folder, converted=False)
    assert "religion" not in _sections(tree, "profiles")
    assert "religion" in _available_ids(tree)


def test_hiding_a_section_that_holds_something_does_not_hide_it(tmp_path):
    # The rule is "appears when it holds something OR is a default". Turning
    # off the second half must not hide entries the writer has written.
    folder = _project(tmp_path, profiles=[("religions", ["the-thread"])])
    hide_type(folder, "religion")
    assert "religion" in _sections(build_sections(folder, converted=False), "profiles")


def test_showing_a_kind_over_http(tmp_path):
    folder = _project(tmp_path)
    body = client.post("/api/codex/type/show", json={
        "project_path": folder, "id": "faction", "show": True,
    }).json()
    profiles = next(g for g in body["groups"] if g["id"] == "profiles")
    assert "faction" in {s["id"] for s in profiles["sections"]}


def test_showing_a_kind_that_does_not_exist_is_refused(tmp_path):
    folder = _project(tmp_path)
    response = client.post("/api/codex/type/show", json={
        "project_path": folder, "id": "dragon", "show": True,
    })
    assert response.json()["detail"]["code"] == "type_invalid"


# ── The Notes half of "+ Add New" ────────────────────────────────────────────
# Profiles and Other add a KIND of entry. Notes adds a DOCUMENT, because
# that is what a note is -- "Dungeon Rules", "Magic Costs", whatever this
# particular book needs.

def test_a_writer_can_add_a_note_of_their_own(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    tree = build_sections(folder, converted=False)
    assert "dungeon_rules" in _sections(tree, "notes")
    assert _sections(tree, "notes")["dungeon_rules"]["label"] == "Dungeon Rules"


def test_a_new_note_appears_straight_away(tmp_path):
    # Seeded with its own heading, so the "appears when it holds something"
    # rule does not hide the thing the writer just asked for.
    folder = _project(tmp_path)
    create_note(folder, "Magic Costs")
    section = _sections(build_sections(folder, converted=False), "notes")["magic_costs"]
    assert section["count"] == 1


def test_a_note_lands_in_a_file_the_writer_can_open_anywhere(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    path = tmp_path / "MyNovel" / "notes" / "dungeon-rules.md"
    assert path.is_file()
    assert path.read_text(encoding="utf-8").startswith("# Dungeon Rules")


def test_a_note_name_follows_the_same_rules_as_a_kind(tmp_path):
    # Both become files on disk, so both get the same guard.
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="no numbers"):
        create_note(folder, "Chapter 3 Ideas")
    with pytest.raises(TypesError, match="Windows will not allow"):
        create_note(folder, "Aux")


def test_adding_a_note_that_exists_is_refused(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    with pytest.raises(TypesError, match="already have a note"):
        create_note(folder, "Dungeon Rules")


def test_adding_a_note_over_http_returns_the_new_tree(tmp_path):
    folder = _project(tmp_path)
    body = client.post("/api/codex/note", json={
        "project_path": folder, "label": "Dungeon Rules",
    }).json()
    notes = next(g for g in body["groups"] if g["id"] == "notes")
    assert "dungeon_rules" in {s["id"] for s in notes["sections"]}


def test_the_sections_endpoint_returns_all_three_groups(tmp_path):
    folder = _project(tmp_path)
    body = client.get("/api/codex/sections", params={"project_path": folder}).json()
    assert [g["id"] for g in body["groups"]] == ["notes", "profiles", "other"]
    assert body["converted"] is False


def test_adding_a_kind_over_http_offers_it_in_its_group(tmp_path):
    folder = _project(tmp_path)
    body = client.post("/api/codex/type", json={
        "project_path": folder, "id": "", "label": "Bloodline", "group": "other",
    }).json()
    other = next(g for g in body["groups"] if g["id"] == "other")
    assert "bloodline" in {a["id"] for a in other["available"]}


def test_a_bad_custom_name_over_http_says_why_in_plain_words(tmp_path):
    folder = _project(tmp_path)
    response = client.post("/api/codex/type", json={
        "project_path": folder, "id": "", "label": "Order 66", "group": "other",
    })
    assert response.json()["detail"]["code"] == "type_invalid"
    assert "no numbers" in response.json()["detail"]["detail"]


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
