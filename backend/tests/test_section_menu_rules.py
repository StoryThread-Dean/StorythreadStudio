# tests/test_section_menu_rules.py -- what a writer may do to a section
# =====================================================================
# Reported as a cosmetic bug and it was really a duplicated-rules bug. Under
# The Weave > Profiles, the counts beside Characters, Locations and Lore sat
# flush against the edge while Factions and Deities sat a menu-width in from
# it -- because rows the writer had ADDED got a three-dot menu and rows the app
# ships with did not, so nothing held the space on the shipped ones.
#
# The frontend decided which rows were "fixed" from its own hardcoded list. That
# is the same shape as every other bug this recovery has found: a rule written
# down twice, one copy drifting. The rules live here now, beside the code that
# enforces them, and every row gets the menu.
#
# The writer's own instinct about the risk was right, and it is recorded here as
# assertions: "might have to just change the display name instead of the actual
# rooted directories and code that is specifically linking to all of them."

import json
import os

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _project(tmp_path, *, notes=(), profiles=()):
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    if notes:
        (root / "notes").mkdir(exist_ok=True)
        for filename, body in notes:
            (root / "notes" / filename).write_text(body, encoding="utf-8")
    for folder, names in profiles:
        (root / "profiles" / folder).mkdir(parents=True, exist_ok=True)
        for name in names:
            (root / "profiles" / folder / f"{name}.md").write_text(
                "# Overview\nx\n", encoding="utf-8")
    return str(root)


def _sections(project):
    tree = client.get("/api/codex/sections",
                      params={"project_path": project}).json()
    return {f"{s['kind']}:{s['id']}": s
            for group in tree["groups"] for s in group["sections"]}


# ── Every row can answer the menu's two questions ────────────────────────────

def test_every_section_says_what_may_be_done_to_it(tmp_path):
    # The alignment fix, as a contract: a row with no answer here is a row the
    # frontend would have to guess about, which is how the hardcoded list
    # happened in the first place.
    project = _project(tmp_path, notes=[("outline.md", "Act one.\n")])
    for key, section in _sections(project).items():
        assert section["rename"] in {"full", "label", "none"}, key
        assert section["removal"] in {"delete", "hide", "trash"}, key
        assert isinstance(section["shipped"], bool), key


def test_a_kind_the_app_ships_with_is_relabelled_never_re_identified(tmp_path):
    # Characters can be called anything the writer likes. Its id and folder
    # cannot move: profiles.py, the migration and the Profile Builder all name
    # "character" directly.
    sections = _sections(_project(tmp_path))
    assert sections["type:character"]["shipped"] is True
    assert sections["type:character"]["rename"] == "label"
    assert sections["type:character"]["removal"] == "hide"


def test_relabelling_a_shipped_kind_keeps_its_id_and_its_entries(tmp_path):
    project = _project(tmp_path, profiles=[("characters", ["elara"])])
    body = client.patch("/api/codex/section", json={
        "project_path": project, "id": "character", "label": "Cast"}).json()
    row = {s["id"]: s for group in body["groups"] for s in group["sections"]}
    # Labels are pluralised by the app, so "Cast" becomes "Casts" -- a
    # container of many holds a plural name.
    assert row["character"]["label"] == "Casts"
    # The entry is still where every other part of the app expects it.
    assert os.path.isfile(os.path.join(project, "profiles", "characters", "elara.md"))
    assert row["character"]["count"] == 1


def test_a_kind_the_writer_added_moves_everything_with_its_name(tmp_path):
    project = _project(tmp_path)
    client.post("/api/codex/type", json={
        "project_path": project, "id": "", "label": "Bloodline",
        "group": "profiles"})
    # A kind with nothing in it waits under "+ Add New" until it is asked for,
    # which is the sidebar's rule rather than anything to do with this test.
    client.post("/api/codex/type/show",
                json={"project_path": project, "id": "bloodline"})
    sections = _sections(project)
    assert sections["type:bloodline"]["shipped"] is False
    assert sections["type:bloodline"]["rename"] == "full"
    assert sections["type:bloodline"]["removal"] == "delete"


# ── Removing ─────────────────────────────────────────────────────────────────

def test_a_shipped_kind_is_hidden_rather_than_deleted(tmp_path):
    # The writer asked for the option on their own story: "the writer should be
    # given the option to delete/remove them on their specific story." Hiding is
    # that option -- the section leaves the sidebar and nothing on disk moves,
    # so it is reversible from "+ Add New".
    project = _project(tmp_path)
    body = client.post("/api/codex/type/show", json={
        "project_path": project, "id": "lore", "show": False}).json()
    shown = {s["id"] for group in body["groups"] for s in group["sections"]}
    assert "lore" not in shown
    available = {a["id"] for a in body["available"]}
    assert "lore" in available


def test_hiding_says_nothing_untrue_about_a_section_that_holds_work(tmp_path):
    # The rule is "a section appears when it holds something OR is a default",
    # and hiding only turns off the second half. A section with entries in it
    # stays, which the menu has to say rather than appearing to do nothing.
    project = _project(tmp_path, profiles=[("lore", ["the-curse"])])
    client.post("/api/codex/type/show", json={
        "project_path": project, "id": "lore", "show": False})
    assert "type:lore" in _sections(project)


def test_deleting_a_shipped_kind_is_refused_and_names_the_alternative(tmp_path):
    project = _project(tmp_path)
    response = client.delete("/api/codex/section",
                             params={"project_path": project, "id": "character"})
    assert response.status_code >= 400
    message = json.dumps(response.json())
    assert "hide" in message.lower()


# ── Notes ────────────────────────────────────────────────────────────────────

def test_a_document_the_app_opens_by_name_cannot_be_renamed(tmp_path):
    # notes/outline.md carries the book's word target in its frontmatter and is
    # read by that path. Renaming it would not be a rename, it would be a
    # disappearance -- the app would quietly start a fresh empty one.
    project = _project(tmp_path, notes=[("outline.md", "Act one.\n")])
    assert _sections(project)["note:outline"]["rename"] == "none"

    response = client.patch("/api/codex/section", json={
        "project_path": project, "filename": "outline.md", "label": "My Plan"})
    assert response.status_code >= 400
    assert "name is fixed" in json.dumps(response.json())
    # And it is still there under its own name.
    assert os.path.isfile(os.path.join(project, "notes", "outline.md"))


def test_a_document_the_app_opens_by_name_can_still_be_removed(tmp_path):
    # Refusing the rename must not take the writer's other option with it. The
    # words move to notes/trash/, so the decision is reversible with a file
    # move.
    project = _project(tmp_path, notes=[("outline.md", "Act one.\n")])
    body = client.delete("/api/codex/section",
                         params={"project_path": project,
                                 "filename": "outline.md"}).json()
    assert body["moved_to"]
    assert not os.path.isfile(os.path.join(project, "notes", "outline.md"))
    assert os.path.isfile(os.path.join(project, "notes", "trash", "outline.md"))


def test_a_note_the_writer_wrote_is_theirs_to_rename(tmp_path):
    project = _project(tmp_path, notes=[("dungeon-rules.md", "# Dungeon Rules\n\nx\n")])
    assert _sections(project)["note:dungeon_rules"]["rename"] == "full"
    body = client.patch("/api/codex/section", json={
        "project_path": project, "filename": "dungeon-rules.md",
        "label": "Dungeon Costs"}).json()
    labels = {s["label"] for group in body["groups"] for s in group["sections"]}
    assert "Dungeon Costs" in labels
