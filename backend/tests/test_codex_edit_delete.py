# tests/test_codex_edit_delete.py -- fixing and removing a section
# =================================================================
# "Magic Sysstem" is the case this exists for. A typo in a section name
# feels permanent in a way it has no right to be, and a writer who cannot
# fix it either lives with it or loses whatever is inside it.
#
# The two halves behave differently, because what is at stake differs:
#
#   RENAME takes everything with it -- the folder on disk, the type line in
#   entries already written, or for a note the file and its heading. Nothing
#   the writer wrote changes beyond that.
#
#   DELETE refuses to destroy work. A kind holding entries is declined
#   outright with a count, because no confirmation dialog makes deleting
#   somebody's writing a good idea. A note is prose, so it moves to
#   notes/trash/ rather than being unlinked -- and the response says where it
#   went, because a delete that silently keeps a copy is as dishonest as one
#   that silently does not.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.codex.sections import build_sections, create_note, delete_note, rename_note
from app.codex.types_registry import (
    TypesError, add_type, delete_type, load_registry, rename_type, type_by_id,
)
from app.main import app

client = TestClient(app)


def _project(tmp_path) -> str:
    root = tmp_path / "MyNovel"
    root.mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    return str(root)


def _entry(folder: str, kind: str, name: str, text: str = "Some prose.") -> None:
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"{name}.md"), "w", encoding="utf-8") as f:
        f.write(f"---\ntype: {kind}\nentity_id: e-{name}\nname: {name}\n---\n\n"
                f"# Overview\n{text}\n")


def _sections(tree, group):
    for entry in tree["groups"]:
        if entry["id"] == group:
            return {s["id"]: s for s in entry["sections"]}
    return {}


# ── Renaming a kind ──────────────────────────────────────────────────────────

def test_a_typo_can_be_fixed(tmp_path):
    # THE case. "Magic Sysstem" -> "Magic System".
    folder = _project(tmp_path)
    add_type(folder, "", "Magic Sysstem", group="other")
    registry = rename_type(folder, "magic_sysstem", "Magic System")

    assert type_by_id(registry, "magic_sysstem") is None
    fixed = type_by_id(registry, "magic_system")
    assert fixed["label"] == "Magic Systems"
    assert fixed["folder"] == "magic_systems"


def test_renaming_brings_the_entries_with_it(tmp_path):
    # A rename that stranded the writer's entries would be worse than the
    # typo.
    folder = _project(tmp_path)
    add_type(folder, "", "Magic Sysstem", group="other")
    _entry(os.path.join(folder, "profiles", "magic_sysstems"), "magic_sysstem",
           "the-thread", "Costs a memory.")

    rename_type(folder, "magic_sysstem", "Magic System")

    moved = os.path.join(folder, "profiles", "magic_systems", "the-thread.md")
    assert os.path.isfile(moved)
    assert "Costs a memory." in open(moved, encoding="utf-8").read()
    assert not os.path.isdir(os.path.join(folder, "profiles", "magic_sysstems"))


def test_renaming_updates_what_the_entries_say_they_are(tmp_path):
    # The files still have to say what kind they are, or the index would not
    # find them.
    folder = _project(tmp_path)
    add_type(folder, "", "Magic Sysstem", group="other")
    _entry(os.path.join(folder, "profiles", "magic_sysstems"), "magic_sysstem", "x")

    rename_type(folder, "magic_sysstem", "Magic System")

    text = open(os.path.join(folder, "profiles", "magic_systems", "x.md"),
                encoding="utf-8").read()
    assert "type: magic_system" in text
    assert "magic_sysstem" not in text


def test_a_shipped_kind_can_be_relabelled_but_keeps_its_id(tmp_path):
    # profiles.py, the migration and the Profile Builder all name "character"
    # directly. Renaming the label is fine; renaming the id would strand them.
    folder = _project(tmp_path)
    registry = rename_type(folder, "character", "People")
    assert type_by_id(registry, "character")["label"] == "Peoples"
    assert type_by_id(registry, "people") is None


def test_renaming_obeys_the_same_name_rules(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Magic Sysstem", group="other")
    with pytest.raises(TypesError, match="no numbers"):
        rename_type(folder, "magic_sysstem", "System 2")


def test_renaming_onto_an_existing_kind_is_refused(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="profiles")
    with pytest.raises(TypesError, match="already has a kind"):
        rename_type(folder, "bloodline", "Faction")


# ── Deleting a kind ──────────────────────────────────────────────────────────

def test_an_empty_kind_is_removed_cleanly(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="profiles")
    registry = delete_type(folder, "bloodline")
    assert type_by_id(registry, "bloodline") is None


def test_a_kind_holding_entries_is_refused_and_says_how_many(tmp_path):
    # No confirmation dialog makes deleting somebody's writing a good idea.
    # The app declines and tells them what to do instead.
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="profiles")
    _entry(os.path.join(folder, "profiles", "bloodlines"), "bloodline", "house-vale")
    _entry(os.path.join(folder, "profiles", "bloodlines"), "bloodline", "house-thorne")

    with pytest.raises(TypesError) as exc:
        delete_type(folder, "bloodline")
    assert "2 entries" in str(exc.value)
    assert "hide the section instead" in str(exc.value)


def test_the_refusal_counts_one_entry_as_one(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="profiles")
    _entry(os.path.join(folder, "profiles", "bloodlines"), "bloodline", "only")
    with pytest.raises(TypesError, match="1 entry"):
        delete_type(folder, "bloodline")


def test_a_shipped_kind_is_never_deleted_only_hidden(tmp_path):
    # It is part of the app; removing it from one project would leave the
    # app's own code referring to something that is not there.
    folder = _project(tmp_path)
    with pytest.raises(TypesError, match="ships with"):
        delete_type(folder, "character")


def test_deleting_a_kind_drops_relations_that_named_it(tmp_path):
    # A relation pointing at a type that no longer exists is exactly what the
    # validator refuses, so the file would not load again.
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="profiles")
    registry, _ = load_registry(folder)
    registry["relations"].append({
        "id": "descends_from", "label": "descends from", "inverse": None,
        "symmetric": False, "source_types": ["character"],
        "target_types": ["bloodline"], "cardinality": "many",
        "exclusive_group": None,
    })
    from app.codex.types_registry import _write_registry
    _write_registry(folder, registry)

    delete_type(folder, "bloodline")
    reloaded, _ = load_registry(folder)          # must still validate
    assert all(r["id"] != "descends_from" for r in reloaded["relations"])


# ── Notes ────────────────────────────────────────────────────────────────────

def test_a_note_can_be_renamed_keeping_everything_in_it(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rulez")
    path = os.path.join(folder, "notes", "dungeon-rulez.md")
    with open(path, "a", encoding="utf-8") as f:
        f.write("No resurrection after chapter twelve.\n")

    rename_note(folder, "dungeon-rulez.md", "Dungeon Rules")

    moved = os.path.join(folder, "notes", "dungeon-rules.md")
    text = open(moved, encoding="utf-8").read()
    assert "No resurrection after chapter twelve." in text
    # The heading is the title the writer sees, so a half-rename would leave
    # the page still calling itself the old name.
    assert text.startswith("# Dungeon Rules")
    assert not os.path.exists(path)


def test_renaming_a_note_onto_an_existing_one_is_refused(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    create_note(folder, "Magic Costs")
    with pytest.raises(TypesError, match="already have a note"):
        rename_note(folder, "magic-costs.md", "Dungeon Rules")


def test_deleting_a_note_keeps_the_prose(tmp_path):
    # A note is writing. Unlinking it would be the one irreversible thing
    # this feature does.
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    path = os.path.join(folder, "notes", "dungeon-rules.md")
    with open(path, "a", encoding="utf-8") as f:
        f.write("Hours of thinking.\n")

    result = delete_note(folder, "dungeon-rules.md")

    assert not os.path.exists(path)
    kept = os.path.join(folder, "notes", "trash", "dungeon-rules.md")
    assert os.path.isfile(kept)
    assert "Hours of thinking." in open(kept, encoding="utf-8").read()
    # And it SAYS where it went. A delete that silently keeps a copy is as
    # dishonest as one that silently does not.
    assert "trash" in result["moved_to"]


def test_a_deleted_note_leaves_the_sidebar(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    delete_note(folder, "dungeon-rules.md")
    assert "dungeon_rules" not in _sections(
        build_sections(folder, converted=False), "notes")


def test_deleting_two_notes_of_the_same_name_keeps_both(tmp_path):
    # A writer who deleted two drafts should still have both.
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    delete_note(folder, "dungeon-rules.md")
    create_note(folder, "Dungeon Rules")
    delete_note(folder, "dungeon-rules.md")

    trash = os.listdir(os.path.join(folder, "notes", "trash"))
    assert len(trash) == 2


def test_the_trash_is_not_scanned_as_notes(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    delete_note(folder, "dungeon-rules.md")
    sections = _sections(build_sections(folder, converted=False), "notes")
    assert not any("trash" in key for key in sections)


# ── Over HTTP ────────────────────────────────────────────────────────────────

def test_renaming_a_kind_over_http(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Magic Sysstem", group="other")
    body = client.patch("/api/codex/section", json={
        "project_path": folder, "id": "magic_sysstem", "label": "Magic System",
    }).json()
    assert "groups" in body
    registry, _ = load_registry(folder)
    assert type_by_id(registry, "magic_system") is not None


def test_renaming_a_note_over_http(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rulez")
    body = client.patch("/api/codex/section", json={
        "project_path": folder, "filename": "dungeon-rulez.md",
        "label": "Dungeon Rules",
    }).json()
    notes = next(g for g in body["groups"] if g["id"] == "notes")
    assert "dungeon_rules" in {s["id"] for s in notes["sections"]}


def test_deleting_over_http_refuses_a_kind_that_holds_entries(tmp_path):
    folder = _project(tmp_path)
    add_type(folder, "", "Bloodline", group="profiles")
    _entry(os.path.join(folder, "profiles", "bloodlines"), "bloodline", "x")
    response = client.request("DELETE", "/api/codex/section",
                              params={"project_path": folder, "id": "bloodline"})
    assert response.json()["detail"]["code"] == "type_invalid"
    assert "1 entry" in response.json()["detail"]["detail"]


def test_deleting_a_note_over_http_reports_where_it_went(tmp_path):
    folder = _project(tmp_path)
    create_note(folder, "Dungeon Rules")
    body = client.request("DELETE", "/api/codex/section",
                          params={"project_path": folder,
                                  "filename": "dungeon-rules.md"}).json()
    assert "trash" in body["moved_to"]


def test_renaming_nothing_in_particular_is_refused(tmp_path):
    folder = _project(tmp_path)
    response = client.patch("/api/codex/section",
                            json={"project_path": folder, "label": "Whatever"})
    assert response.json()["detail"]["code"] == "type_invalid"


# ── This is not what I said it was ──────────────────────────────────────────
#
# From live testing, in the writer's words: "Pathicus was wrongly assumed to
# be a Character instead of a Deity. I need to be able to change it from there
# or delete it altogether because it was made incorrectly. This should reset
# the name connection allowing for Dress the Loom to pick it up again so it
# can be tagged and connected."
#
# Two capabilities in one report, and the second half is the one easy to get
# wrong: deleting the FILE is not enough, because the ledger remembers the
# name as answered for good.

@pytest.fixture
def world(tmp_path):
    """A project with Pathicus filed, wrongly, as a character."""
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}),
                                       encoding="utf-8")
    (root / "manuscript" / "01.md").write_text(
        "# One\nThe Daughters prayed to Pathicus. Pathicus did not answer.\n",
        encoding="utf-8")
    path = root / "codex" / "characters"
    path.mkdir(parents=True)
    (path / "pathicus.md").write_text(
        "---\ntype: character\nentity_id: e-pathicus\nname: Pathicus\n---\n\n"
        "# Overview\nA god of the deep places.\n", encoding="utf-8")
    return str(root)


def _kind(project, entity_id, type_id):
    return client.patch("/api/codex/entity/kind", json={
        "project_path": project, "entity_id": entity_id, "type": type_id})


def test_a_wrong_kind_can_be_corrected(world):
    assert _kind(world, "e-pathicus", "deity").status_code == 200
    body = client.get("/api/codex/entity", params={
        "project_path": world, "entity_id": "e-pathicus"}).json()
    assert body["type"] == "deity"


def test_the_file_moves_to_its_new_kinds_folder(world):
    _kind(world, "e-pathicus", "deity")
    assert os.path.exists(os.path.join(world, "codex", "deities", "pathicus.md"))
    # And does NOT linger under the old one -- a leftover would be read as a
    # second entry with the same id on the next scan.
    assert not os.path.exists(
        os.path.join(world, "codex", "characters", "pathicus.md"))


def test_everything_written_in_it_survives_the_move(world):
    # The whole reason this is not "delete it and start again".
    _kind(world, "e-pathicus", "deity")
    body = client.get("/api/codex/entity", params={
        "project_path": world, "entity_id": "e-pathicus"}).json()
    assert body["entity_id"] == "e-pathicus"          # ties/facts still point here
    assert body["name"] == "Pathicus"
    assert "god of the deep places" in body["sections"]["overview"]["content"]


def test_a_kind_this_world_does_not_have_is_refused_by_name(world):
    body = _kind(world, "e-pathicus", "spaceship").json()
    assert body["detail"]["code"] == "type_invalid"
    assert "spaceship" in body["detail"]["message"]


def test_changing_to_the_same_kind_does_nothing_and_says_so(world):
    body = _kind(world, "e-pathicus", "character").json()
    assert body["type"] == "character"
    assert body["warnings"] == []


def test_connections_are_kept_and_the_odd_ones_reported(world):
    # A writer correcting a mistake must not lose their connections AS A SIDE
    # EFFECT of the correction -- that would be a second, larger mistake made
    # on their behalf. So a relation that no longer fits warns and stays.
    import pathlib
    factions = pathlib.Path(world) / "codex" / "factions"
    factions.mkdir(parents=True)
    (factions / "daughters.md").write_text(
        "---\ntype: faction\nentity_id: e-daughters\nname: Daughters\n---\n\n"
        "# Overview\nHers.\n", encoding="utf-8")
    client.post("/api/codex/tie", json={
        "project_path": world, "src_id": "e-pathicus", "rel": "member_of",
        "dst_id": "e-daughters", "reason": "recorded before the kind was fixed"})

    body = _kind(world, "e-pathicus", "deity").json()
    assert body["warnings"]                            # said out loud
    assert "kept" in body["warnings"][0]
    ties = client.get("/api/codex/ties", params={
        "project_path": world, "entity_id": "e-pathicus"}).json()["ties"]
    assert len(ties) == 1                              # and still there


# ── Deleting resets the question ────────────────────────────────────────────

def _stops(project, **kw):
    return client.post("/api/codex/scan",
                       json={"project_path": project, **kw}).json()["stops"]


def _unspun(project, name):
    """Stops offering to MAKE an entry for a name -- not every stop that
    happens to mention one."""
    return [s for s in _stops(project)
            if s["kind"] == "unspun"
            and s.get("detail", {}).get("name") == name]


def test_deleting_an_entry_lets_the_scan_find_the_name_again(world):
    # THE reported requirement. The name was made into an entry from an Unspun
    # stop, so the ledger says answered-for-good; deleting the file alone
    # would leave the prose full of a word the Weave had agreed to ignore
    # forever.
    run = client.post("/api/codex/run", json={"project_path": world}).json()
    client.post("/api/codex/run/answer", json={
        "project_path": world, "run_id": run["run_id"],
        "key": "unspun|pathicus", "state": "dismissed",
        "retire_phrase": "Pathicus"})
    # Retired: nothing offers to make an entry for the name.
    assert not _unspun(world, "Pathicus")

    client.delete("/api/codex/entity", params={
        "project_path": world, "entity_id": "e-pathicus"})

    # ...and now it does again, which is the whole request: the prose still
    # says Pathicus, so the Weave should be asking about it.
    assert _unspun(world, "Pathicus")


def test_it_forgets_only_answers_about_the_entry_it_deleted(world):
    run = client.post("/api/codex/run", json={"project_path": world}).json()
    client.post("/api/codex/run/answer", json={
        "project_path": world, "run_id": run["run_id"],
        "key": "frayed|e-pathicus", "state": "applied"})
    client.post("/api/codex/run/answer", json={
        "project_path": world, "run_id": run["run_id"],
        "key": "frayed|e-somebody-else", "state": "applied"})

    client.delete("/api/codex/entity", params={
        "project_path": world, "entity_id": "e-pathicus"})

    book = json.load(open(os.path.join(world, ".storythread", "weave",
                                       "answers.json"), encoding="utf-8"))
    assert "frayed|e-pathicus" not in book["answers"]
    assert "frayed|e-somebody-else" in book["answers"]


def test_the_forgetting_can_be_declined(world):
    # Deleting a genuine duplicate is the other reason to delete, and there
    # the writer does NOT want the name raised again -- the survivor answers
    # to it.
    run = client.post("/api/codex/run", json={"project_path": world}).json()
    client.post("/api/codex/run/answer", json={
        "project_path": world, "run_id": run["run_id"],
        "key": "unspun|pathicus", "state": "dismissed",
        "retire_phrase": "Pathicus"})

    client.delete("/api/codex/entity", params={
        "project_path": world, "entity_id": "e-pathicus",
        "forget_answers": False})

    assert not _unspun(world, "Pathicus")


def test_it_reports_how_much_it_forgot(world):
    run = client.post("/api/codex/run", json={"project_path": world}).json()
    client.post("/api/codex/run/answer", json={
        "project_path": world, "run_id": run["run_id"],
        "key": "frayed|e-pathicus", "state": "applied"})
    body = client.delete("/api/codex/entity", params={
        "project_path": world, "entity_id": "e-pathicus"}).json()
    assert body["deleted"] == "e-pathicus"
    assert body["forgotten"] >= 1
