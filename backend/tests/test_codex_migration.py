# tests/test_codex_migration.py -- rewriting the writer's files
# ==============================================================
# The highest-risk operation in the programme. Everything else in the Weave
# adds capability; this one rewrites files somebody wrote by hand. A bug here
# does not degrade a feature, it costs a writer their character notes.
#
# So these tests are mostly about the four guarantees rather than about
# conversion being pretty:
#
#   DRY RUN      nothing is touched until the writer has seen what will happen
#   BACKUP       taken before any write, never auto-deleted, profiles/ kept
#   IDEMPOTENT   running twice does not duplicate anything
#   RECOVERABLE  a crash leaves a journal, and success is NEVER inferred from
#                the presence of codex/ -- a half-finished run produces that
#                folder too

import json
import os

from app.codex.migrate import (
    journal_path,
    migration_state,
    plan_migration,
    read_journal,
    restore_backup,
    run_migration,
)
from app.codex.threads import parse_thread

CHARACTER = """---
type: character
profile_id: 8f3c1a2b
name: Elara Voss
role: Protagonist
status: active
tags:
  - noble
---

# Overview
A tall woman with her father's hands.
## AI Summary: Overview
She is the protagonist.

# Personality Traits
- trait: guarded
  description: "Keeps her own counsel, even with allies."
  importance: core

- trait: the mark on her wrist
  description: "She hides it. It matters later."
  importance: hidden

## AI Summary: Personality Traits
_Generated on demand. Editable by writer._

# Full AI Summary
Elara is the protagonist and carries the story.
"""

LOCATION = """---
type: location
profile_id: 77b1e044
name: Ravensmoor
---

# Overview
A cold place.
"""


def _project(tmp_path, *, arcs: bool = False, legacy: bool = False) -> str:
    root = tmp_path / "MyNovel"
    (root / "profiles" / "characters").mkdir(parents=True)
    (root / "profiles" / "locations").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "MyNovel"}), encoding="utf-8")
    (root / "profiles" / "characters" / "elara.md").write_text(CHARACTER, encoding="utf-8")
    (root / "profiles" / "locations" / "ravensmoor.md").write_text(LOCATION, encoding="utf-8")
    if arcs:
        (root / "profiles" / "arcs" / "characters").mkdir(parents=True)
        (root / "profiles" / "arcs" / "characters" / "elara.md").write_text(
            "---\ntype: character\nname: Elara Voss\n---\n\n"
            "# Overview\nIn this book she is colder.\n",
            encoding="utf-8")
    if legacy:
        (root / "profiles" / "chapters").mkdir(parents=True)
        (root / "profiles" / "chapters" / "01.md").write_text("# Old\n", encoding="utf-8")
    return str(root)


def _thread(folder, type_folder, name) -> dict:
    with open(os.path.join(folder, "codex", type_folder, name), encoding="utf-8") as f:
        return parse_thread(f.read())


# ── Dry run: nothing is touched ──────────────────────────────────────────────

def test_planning_reports_what_would_happen(tmp_path):
    folder = _project(tmp_path)
    plan = plan_migration(folder)
    assert plan["total"] == 2
    folders = {g["folder"]: g for g in plan["convert"]}
    assert folders["characters"]["type"] == "character"
    assert folders["locations"]["type"] == "location"
    assert plan["backup_path"].endswith(tuple("0123456789"))


def test_planning_writes_nothing_at_all(tmp_path):
    # A destructive operation the writer has not seen the shape of is one
    # they cannot consent to -- so the preview must cost nothing.
    folder = _project(tmp_path)
    before = sorted(os.listdir(folder))
    plan_migration(folder)
    assert sorted(os.listdir(folder)) == before
    assert not os.path.exists(os.path.join(folder, "codex"))


def test_planning_names_what_it_cannot_convert(tmp_path):
    folder = _project(tmp_path)
    os.mkdir(os.path.join(folder, "profiles", "spaceships"))
    open(os.path.join(folder, "profiles", "spaceships", "x.md"), "w").close()
    plan = plan_migration(folder)
    assert any(u["folder"] == "spaceships" for u in plan["unconvertible"])


def test_planning_reports_legacy_summary_folders_as_skipped(tmp_path):
    folder = _project(tmp_path, legacy=True)
    plan = plan_migration(folder)
    assert any(s["folder"] == "chapters" for s in plan["skipped"])
    assert plan["total"] == 2      # not counted as conversions


def test_a_project_with_no_profiles_says_so_rather_than_failing(tmp_path):
    root = tmp_path / "Empty"
    root.mkdir()
    (root / "project.json").write_text("{}", encoding="utf-8")
    plan = plan_migration(str(root))
    assert plan["total"] == 0
    assert any("nothing to convert" in w for w in plan["warnings"])


# ── Converting ───────────────────────────────────────────────────────────────

def test_migration_converts_every_profile(tmp_path):
    folder = _project(tmp_path)
    result = run_migration(folder)
    assert result["status"] == "migrated"
    assert result["converted"] == 2
    assert os.path.isfile(os.path.join(folder, "codex", "characters", "elara.md"))
    assert os.path.isfile(os.path.join(folder, "codex", "locations", "ravensmoor.md"))


def test_the_writers_own_words_survive_untouched(tmp_path):
    # A migration is not the place to improve somebody's prose.
    folder = _project(tmp_path)
    run_migration(folder)
    thread = _thread(folder, "characters", "elara.md")
    assert thread["sections"]["overview"]["content"] == \
        "A tall woman with her father's hands."
    assert thread["sections"]["overview"]["ai_summary"] == "She is the protagonist."
    assert thread["full_ai_summary"] == "Elara is the protagonist and carries the story."
    assert thread["tags"] == ["noble"]
    assert thread["role"] == "Protagonist"


def test_trait_blocks_survive_with_their_importance(tmp_path):
    folder = _project(tmp_path)
    run_migration(folder)
    blocks = _thread(folder, "characters", "elara.md")["sections"]["personality_traits"]["trait_blocks"]
    assert [b["trait"] for b in blocks] == ["guarded", "the mark on her wrist"]
    assert blocks[0]["importance"] == "core"
    assert blocks[0]["description"] == "Keeps her own counsel, even with allies."


def test_a_hidden_trait_becomes_a_weight_plus_a_secret(tmp_path):
    # THIS TEST USED TO ASSERT THE OPPOSITE, and the opposite was wrong.
    #
    # An earlier pass set `ai_scope: on-request` on every hidden trait, on the
    # sound observation that the prompt's never-name rule was not a hard gate.
    # But that trade is worse than the problem: withholding a secret stops the
    # model NAMING it by stopping the model KNOWING it. The writer's villain --
    # parents dead in a hospital, freezes at the sight of held hands -- would
    # arrive with none of that and behave like somebody else entirely.
    #
    # So a hidden trait converts to what it always meant: an ordinary weight,
    # plus a flag that says never say this out loud. It is sent, it is weighted,
    # and the prompt forbids naming it.
    folder = _project(tmp_path)
    run_migration(folder)
    blocks = _thread(folder, "characters", "elara.md")["sections"]["personality_traits"]["trait_blocks"]

    secret = [b for b in blocks if b.get("subtext")][0]
    assert secret["importance"] == "present"      # a weight, not "hidden"
    # NOT withheld. This is the line that matters.
    assert secret.get("ai_scope") in (None, "", "always")

    # And an ordinary trait is left alone entirely.
    ordinary = [b for b in blocks if b["importance"] == "core"][0]
    assert not ordinary.get("ai_scope")
    assert not ordinary.get("subtext")


def test_the_profile_id_becomes_the_entity_id(tmp_path):
    folder = _project(tmp_path)
    run_migration(folder)
    assert _thread(folder, "characters", "elara.md")["entity_id"] == "8f3c1a2b"


def test_a_profile_with_no_id_is_given_one_and_flagged(tmp_path):
    folder = _project(tmp_path)
    with open(os.path.join(folder, "profiles", "characters", "nameless.md"), "w",
              encoding="utf-8") as f:
        f.write("---\ntype: character\nname: Nobody\n---\n\n# Overview\nX.\n")
    result = run_migration(folder)
    assert any("no profile_id" in w for w in result["warnings"])
    assert _thread(folder, "characters", "nameless.md")["entity_id"].startswith("e-")


def test_duplicate_ids_are_split_rather_than_silently_merged(tmp_path):
    # Two Threads sharing an id would collide in the index and merge without
    # a word.
    folder = _project(tmp_path)
    with open(os.path.join(folder, "profiles", "characters", "twin.md"), "w",
              encoding="utf-8") as f:
        f.write(CHARACTER.replace("Elara Voss", "Twin"))
    result = run_migration(folder)
    assert any("shared an id" in w for w in result["warnings"])
    ids = {_thread(folder, "characters", n)["entity_id"]
           for n in ("elara.md", "twin.md")}
    assert len(ids) == 2


def test_the_registry_is_seeded(tmp_path):
    folder = _project(tmp_path)
    run_migration(folder)
    assert os.path.isfile(os.path.join(folder, "codex", "types.json"))


# ── Backup ───────────────────────────────────────────────────────────────────

def test_a_backup_is_taken_before_anything_is_written(tmp_path):
    folder = _project(tmp_path)
    result = run_migration(folder)
    backup = result["backup_path"]
    assert os.path.isfile(os.path.join(backup, "characters", "elara.md"))
    # Byte-for-byte, not a re-render.
    with open(os.path.join(backup, "characters", "elara.md"), encoding="utf-8") as f:
        assert f.read() == CHARACTER


def test_profiles_is_left_in_place(tmp_path):
    # The writer removes it when they are satisfied, not us.
    folder = _project(tmp_path)
    run_migration(folder)
    assert os.path.isfile(os.path.join(folder, "profiles", "characters", "elara.md"))


# ── Idempotency ──────────────────────────────────────────────────────────────

def test_running_twice_is_a_no_op(tmp_path):
    folder = _project(tmp_path)
    run_migration(folder)
    second = run_migration(folder)
    assert second["status"] == "already-migrated"
    assert second["converted"] == 0


def test_running_twice_does_not_duplicate_threads_or_backups(tmp_path):
    folder = _project(tmp_path)
    run_migration(folder)
    run_migration(folder)
    assert len(os.listdir(os.path.join(folder, "codex", "characters"))) == 1
    backups = [n for n in os.listdir(folder) if n.startswith("profiles.backup-")]
    assert len(backups) == 1


# ── Recovery ─────────────────────────────────────────────────────────────────

def test_the_journal_is_gone_once_it_finished(tmp_path):
    folder = _project(tmp_path)
    run_migration(folder)
    assert not os.path.exists(journal_path(folder))
    assert migration_state(folder) == "done"


def test_the_marker_is_what_says_it_finished_not_the_codex_folder(tmp_path):
    # A half-finished run produces codex/ too. Inferring success from it
    # would declare a broken migration complete.
    folder = _project(tmp_path)
    run_migration(folder)
    os.remove(os.path.join(folder, "project.json"))
    with open(os.path.join(folder, "project.json"), "w", encoding="utf-8") as f:
        json.dump({"title": "MyNovel"}, f)
    assert os.path.isdir(os.path.join(folder, "codex"))
    assert migration_state(folder) == "none"


def test_an_interrupted_migration_is_detected(tmp_path):
    folder = _project(tmp_path)
    # Simulate a crash: the journal exists, the marker does not.
    os.makedirs(os.path.join(folder, ".storythread"), exist_ok=True)
    with open(journal_path(folder), "w", encoding="utf-8") as f:
        json.dump({"backup_path": os.path.join(folder, "profiles.backup-x"),
                   "completed": False}, f)
    assert migration_state(folder) == "incomplete"


def test_an_interrupted_migration_refuses_to_barrel_on(tmp_path):
    folder = _project(tmp_path)
    os.makedirs(os.path.join(folder, ".storythread"), exist_ok=True)
    with open(journal_path(folder), "w", encoding="utf-8") as f:
        json.dump({"backup_path": "", "completed": False}, f)
    result = run_migration(folder)
    assert result["status"] == "incomplete"
    assert "Resume" in result["message"] or "resume" in result["message"]


def test_an_interrupted_migration_can_be_resumed(tmp_path):
    folder = _project(tmp_path)
    os.makedirs(os.path.join(folder, ".storythread"), exist_ok=True)
    with open(journal_path(folder), "w", encoding="utf-8") as f:
        json.dump({"backup_path": "", "completed": False}, f)
    result = run_migration(folder, resume=True)
    assert result["status"] == "migrated"
    assert migration_state(folder) == "done"


def test_restoring_puts_the_writer_back_where_they_started(tmp_path):
    folder = _project(tmp_path)
    # A migration that got as far as copying the backup and writing codex/.
    import shutil
    backup = os.path.join(folder, "profiles.backup-test")
    shutil.copytree(os.path.join(folder, "profiles"), backup)
    os.makedirs(os.path.join(folder, "codex", "characters"), exist_ok=True)
    open(os.path.join(folder, "codex", "characters", "half.md"), "w").close()
    os.makedirs(os.path.join(folder, ".storythread"), exist_ok=True)
    with open(journal_path(folder), "w", encoding="utf-8") as f:
        json.dump({"backup_path": backup, "completed": False}, f)

    result = restore_backup(folder)
    assert result["status"] == "restored"
    assert not os.path.isdir(os.path.join(folder, "codex"))
    assert os.path.isfile(os.path.join(folder, "profiles", "characters", "elara.md"))
    # The safety net is kept -- the end of a recovery is an odd moment to
    # start trusting ourselves.
    assert os.path.isdir(backup)
    assert migration_state(folder) == "none"


def test_the_journal_records_where_the_backup_went(tmp_path):
    folder = _project(tmp_path)
    os.makedirs(os.path.join(folder, ".storythread"), exist_ok=True)
    with open(journal_path(folder), "w", encoding="utf-8") as f:
        json.dump({"backup_path": "/somewhere", "completed": False}, f)
    assert read_journal(folder)["backup_path"] == "/somewhere"


# ── Arcs ─────────────────────────────────────────────────────────────────────

def test_arcs_become_facts_with_no_point_in_the_story_yet(tmp_path):
    # An arc was "this character, but in this book" -- which is a fact with
    # an anchor, now that anchors exist. We cannot know WHICH chapter it
    # began at, and inventing one would place it where it may not belong.
    folder = _project(tmp_path, arcs=True)
    result = run_migration(folder)
    assert result["arcs_absorbed"] == 1

    run = _thread(folder, "characters", "elara.md")["run"]
    arc_fact = [f for f in run if f["axis"].startswith("arc.")][0]
    assert arc_fact["value"] == "In this book she is colder."
    assert arc_fact["at"] is None
    assert any("no point in the story yet" in w for w in result["warnings"])


def test_an_arc_with_no_matching_thread_is_reported_not_dropped(tmp_path):
    folder = _project(tmp_path, arcs=True)
    with open(os.path.join(folder, "profiles", "arcs", "characters", "ghost.md"), "w",
              encoding="utf-8") as f:
        f.write("---\ntype: character\nname: Ghost\n---\n\n# Overview\nNobody.\n")
    result = run_migration(folder)
    assert any("no matching Thread" in w for w in result["warnings"])
