# tests/test_codex_anchors.py -- stable chapter identity for Weave anchors
# ========================================================================
# The Weave records facts against a point in the story: "as of chapter 7,
# she knows her father is alive." That needs a chapter identity that is not
# the filename, because renaming a chapter is an ordinary thing to do and
# every anchor keyed to the old name would break.
#
# Two rules the rest of the app depends on:
#
#   1. IDs are minted LAZILY. A project that never opens the Weave must keep
#      its structure.json exactly as it was -- no new key, and no file
#      created where there was none. Opening an old project must not touch
#      its bytes.
#   2. An id follows its chapter through a rename and DIES with it. An
#      anchor into a deleted chapter must resolve to nothing (visible), not
#      to whatever file later occupies that position (silent and wrong).

import json
import os

from app.utils.structure_store import (
    chapter_id_for_file,
    ensure_chapter_ids,
    file_for_chapter_id,
    load_structure,
    ordered_chapter_filenames,
    ordered_chapter_ids,
    save_structure,
    sync_remove_chapter,
    sync_rename_chapter,
)


def _project(tmp_path, *chapters: str) -> str:
    """A minimal project folder with the given chapter files."""
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text("{}", encoding="utf-8")
    for name in chapters:
        (root / "manuscript" / name).write_text(f"# {name}\n\nText.\n", encoding="utf-8")
    return str(root)


def _raw(folder: str) -> dict:
    with open(os.path.join(folder, "manuscript", "structure.json"), encoding="utf-8") as f:
        return json.load(f)


# ── Rule 1: nothing happens until the Weave asks ─────────────────────────────

def test_ordinary_use_does_not_create_a_structure_file(tmp_path):
    folder = _project(tmp_path, "01-a.md", "02-b.md")
    load_structure(folder)
    ordered_chapter_filenames(folder)
    assert not os.path.exists(os.path.join(folder, "manuscript", "structure.json"))


def test_an_existing_manifest_gains_no_chapter_ids_key_on_its_own(tmp_path):
    folder = _project(tmp_path, "01-a.md", "02-b.md")
    save_structure(folder, {
        "version": 1,
        "acts": [{"id": "a-1", "title": "Act I", "chapters": ["01-a.md"]}],
        "unassigned": ["02-b.md"],
    })
    load_structure(folder)                       # a plain read
    assert "chapter_ids" not in _raw(folder)


def test_chapter_id_for_file_is_none_before_any_are_minted(tmp_path):
    folder = _project(tmp_path, "01-a.md")
    assert chapter_id_for_file(folder, "01-a.md") is None


# ── Minting, once the Weave needs anchors ────────────────────────────────────

def test_ensure_chapter_ids_gives_every_chapter_one(tmp_path):
    folder = _project(tmp_path, "01-a.md", "02-b.md")
    ids = ensure_chapter_ids(folder)
    assert set(ids) == {"01-a.md", "02-b.md"}
    assert all(cid.startswith("c-") for cid in ids.values())
    assert len(set(ids.values())) == 2           # distinct


def test_minting_is_idempotent(tmp_path):
    folder = _project(tmp_path, "01-a.md", "02-b.md")
    first = ensure_chapter_ids(folder)
    second = ensure_chapter_ids(folder)
    assert first == second


def test_a_new_chapter_gets_an_id_without_disturbing_the_others(tmp_path):
    folder = _project(tmp_path, "01-a.md")
    before = ensure_chapter_ids(folder)
    (tmp_path / "MyNovel" / "manuscript" / "02-b.md").write_text("# B\n", encoding="utf-8")
    after = ensure_chapter_ids(folder)
    assert after["01-a.md"] == before["01-a.md"]
    assert "02-b.md" in after


def test_ids_are_persisted(tmp_path):
    folder = _project(tmp_path, "01-a.md")
    ids = ensure_chapter_ids(folder)
    assert _raw(folder)["chapter_ids"] == ids


def test_ordered_chapter_ids_follows_reading_order_not_filename_order(tmp_path):
    folder = _project(tmp_path, "01-a.md", "02-b.md", "03-c.md")
    save_structure(folder, {
        "version": 1,
        "acts": [{"id": "a-1", "title": "Act I", "chapters": ["03-c.md", "01-a.md"]}],
        "unassigned": ["02-b.md"],
    })
    ordered = ordered_chapter_ids(folder)
    assert [name for _cid, name in ordered] == ["03-c.md", "01-a.md", "02-b.md"]


# ── Rule 2: an id follows its chapter, and dies with it ──────────────────────

def test_an_id_survives_a_rename(tmp_path):
    # The whole reason ids exist. Renaming is ordinary; anchors must hold.
    folder = _project(tmp_path, "01-a.md")
    original = ensure_chapter_ids(folder)["01-a.md"]

    os.rename(os.path.join(folder, "manuscript", "01-a.md"),
              os.path.join(folder, "manuscript", "01-renamed.md"))
    sync_rename_chapter(folder, "01-a.md", "01-renamed.md")

    assert chapter_id_for_file(folder, "01-renamed.md") == original
    assert chapter_id_for_file(folder, "01-a.md") is None
    assert file_for_chapter_id(folder, original) == "01-renamed.md"


def test_a_rename_keeps_the_id_even_when_the_chapter_is_in_an_act(tmp_path):
    folder = _project(tmp_path, "01-a.md", "02-b.md")
    save_structure(folder, {
        "version": 1,
        "acts": [{"id": "a-1", "title": "Act I", "chapters": ["01-a.md", "02-b.md"]}],
        "unassigned": [],
    })
    original = ensure_chapter_ids(folder)["01-a.md"]

    os.rename(os.path.join(folder, "manuscript", "01-a.md"),
              os.path.join(folder, "manuscript", "01-new.md"))
    sync_rename_chapter(folder, "01-a.md", "01-new.md")

    assert chapter_id_for_file(folder, "01-new.md") == original
    # And it kept its place in the act.
    assert ordered_chapter_filenames(folder)[0] == "01-new.md"


def test_a_deleted_chapters_anchor_resolves_to_nothing(tmp_path):
    # Not to whatever file later sits in that position -- an anchor that
    # silently re-points is worse than one that visibly dangles.
    folder = _project(tmp_path, "01-a.md", "02-b.md")
    ids = ensure_chapter_ids(folder)
    doomed = ids["01-a.md"]

    os.remove(os.path.join(folder, "manuscript", "01-a.md"))
    sync_remove_chapter(folder, "01-a.md")

    assert file_for_chapter_id(folder, doomed) is None
    assert chapter_id_for_file(folder, "02-b.md") == ids["02-b.md"]


def test_reordering_acts_over_the_api_does_not_re_mint_ids(tmp_path):
    # The PUT rebuilds the whole manifest from a payload that knows nothing
    # about chapter ids. Without carrying them across, every act reorder
    # would orphan every anchor in the book.
    from fastapi.testclient import TestClient
    from app.main import app

    folder = _project(tmp_path, "01-a.md", "02-b.md")
    before = ensure_chapter_ids(folder)

    client = TestClient(app)
    response = client.put("/api/structure", json={
        "folder_path": folder,
        "acts": [{"id": "", "title": "Act I", "chapters": ["02-b.md", "01-a.md"]}],
        "unassigned": [],
    })
    assert response.status_code == 200

    assert ensure_chapter_ids(folder) == before
    assert ordered_chapter_filenames(folder) == ["02-b.md", "01-a.md"]


def test_a_file_deleted_outside_the_app_drops_its_id_on_next_load(tmp_path):
    # Healing already handles hand-deleted files; ids must follow the same
    # rule or the map would accumulate ghosts.
    folder = _project(tmp_path, "01-a.md", "02-b.md")
    ids = ensure_chapter_ids(folder)
    os.remove(os.path.join(folder, "manuscript", "01-a.md"))

    manifest, _ = load_structure(folder)
    assert "01-a.md" not in manifest["chapter_ids"]
    assert manifest["chapter_ids"]["02-b.md"] == ids["02-b.md"]
