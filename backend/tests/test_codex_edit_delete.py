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
