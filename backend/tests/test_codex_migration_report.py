# tests/test_codex_migration_report.py -- the account a conversion gives
# ======================================================================
# Reported from live testing, after converting four profiles and a location:
# "apparently worked but I have zero context of what happened and where the
# information went to."
#
# That is the exact experience this app exists to avoid. A button that reports
# a number and nothing else asks the writer to take a rewrite of their own
# files on faith, which is the habit around AI-adjacent tools that Storythread
# is meant to break.
#
# So a conversion has to be able to say, afterwards and the next day: which
# files, where they went, and what it did to the words inside them.

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.codex.migrate import compare_migrated, load_report, run_migration
from app.main import app

client = TestClient(app)

ELARA = """---
profile_id: p-elara
name: Elara Voss
role: Protagonist
aliases: [Elara]
tags: [noble]
---

# Overview
A tall woman with a borrowed sword.

# Physical Traits
- trait: Scar
  description: "A thin line across her left palm."
  importance: present

- trait: The mark
  description: "Under the collarbone. She has never shown anyone."
  importance: hidden

## AI Summary: Physical Traits
Tall, scarred.

# Notes
Nothing yet.
"""

RAVENSMOOR = """---
profile_id: p-rav
name: Ravensmoor
---

# Overview
A cold place on the northern road.
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "MyNovel"
    (root / "profiles" / "characters").mkdir(parents=True)
    (root / "profiles" / "locations").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    (root / "profiles" / "characters" / "elara.md").write_text(ELARA, encoding="utf-8")
    (root / "profiles" / "locations" / "ravensmoor.md").write_text(
        RAVENSMOOR, encoding="utf-8")
    return str(root)


# ── The manifest ─────────────────────────────────────────────────────────────

def test_a_conversion_says_which_files_it_converted(project):
    result = run_migration(project)
    names = {e["name"] for e in result["entries"]}
    assert names == {"Elara Voss", "Ravensmoor"}


def test_it_says_where_each_one_went(project):
    # "Where did the information go?" answered per file, not per run.
    result = run_migration(project)
    elara = next(e for e in result["entries"] if e["name"] == "Elara Voss")
    assert elara["source"] == "profiles/characters/elara.md"
    assert elara["converted_to"] == "codex/characters/elara.md"
    assert os.path.isfile(os.path.join(project, "codex", "characters", "elara.md"))


def test_the_report_survives_the_http_response_that_returned_it(project):
    # "What did that actually do?" is a question a writer asks the next day as
    # well as in the moment.
    run_migration(project)
    saved = load_report(project)
    assert saved is not None
    assert len(saved["entries"]) == 2
    assert saved["finished_at"]


def test_the_report_is_reachable_over_http(project):
    run_migration(project)
    body = client.get("/api/codex/migrate/report",
                      params={"project_path": project}).json()
    assert {e["name"] for e in body["entries"]} == {"Elara Voss", "Ravensmoor"}


def test_a_project_with_no_conversion_says_so_rather_than_inventing_one(project):
    response = client.get("/api/codex/migrate/report",
                          params={"project_path": project})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "report_not_found"


# ── The comparison ───────────────────────────────────────────────────────────

def test_the_original_and_the_converted_are_both_shown(project):
    run_migration(project)
    diff = compare_migrated(project, "character", "elara.md")
    overview = next(s for s in diff["sections"] if s["id"] == "overview")
    assert "borrowed sword" in overview["original"]
    assert "borrowed sword" in overview["converted"]


def test_prose_that_came_across_unchanged_is_reported_as_unchanged(project):
    # Most of a conversion SHOULD be identical -- it is the writer's writing,
    # and a migration is not the place to improve it. Saying so plainly is
    # what makes the one real change worth looking at.
    run_migration(project)
    diff = compare_migrated(project, "character", "elara.md")
    overview = next(s for s in diff["sections"] if s["id"] == "overview")
    assert overview["changed"] is False


def test_the_one_content_change_is_visible_rather_than_hidden(project):
    # A "hidden" trait becomes ai_scope: on-request. That is the only content
    # change the conversion makes, and burying it inside a "same" verdict
    # would be the one thing a writer most needs to see.
    run_migration(project)
    diff = compare_migrated(project, "character", "elara.md")
    traits = next(s for s in diff["sections"] if s["id"] == "physical_traits")
    assert traits["changed"] is True
    assert "on-request" in traits["converted"]
    assert "on-request" not in traits["original"]


def test_a_section_that_did_not_come_across_is_named_as_missing(project):
    # "Changed" and "missing" mean different things to a writer: one is "this
    # was edited", the other is "this did not survive".
    run_migration(project)
    codex_file = os.path.join(project, "codex", "characters", "elara.md")
    text = open(codex_file, encoding="utf-8").read()
    with open(codex_file, "w", encoding="utf-8") as f:
        f.write(text.replace("A tall woman with a borrowed sword.", ""))

    diff = compare_migrated(project, "character", "elara.md")
    overview = next(s for s in diff["sections"] if s["id"] == "overview")
    assert overview["missing"] is True


def test_the_id_is_shown_as_a_field(project):
    # profile_id becomes entity_id. The writer should see that their entry has
    # an identifier rather than discover it in a file later.
    run_migration(project)
    diff = compare_migrated(project, "character", "elara.md")
    ids = next(f for f in diff["fields"] if f["field"] == "Id")
    assert ids["converted"]


def test_what_the_writer_wrote_in_frontmatter_is_compared_too(project):
    run_migration(project)
    diff = compare_migrated(project, "character", "elara.md")
    fields = {f["field"]: f for f in diff["fields"]}
    assert fields["Also known as"]["original"] == "Elara"
    assert fields["Also known as"]["changed"] is False
    assert fields["Role"]["converted"] == "Protagonist"


def test_the_raw_text_of_both_files_is_available(project):
    # So a writer who wants to see the actual file never has to leave the app.
    run_migration(project)
    diff = compare_migrated(project, "character", "elara.md")
    assert diff["original_raw"].startswith("---")
    assert diff["converted_raw"].startswith("---")


def test_the_original_is_read_from_the_backup_not_from_profiles(project):
    # Both still exist, but profiles/ could have been edited since. Reading it
    # would make the comparison quietly wrong about what was converted.
    run_migration(project)
    with open(os.path.join(project, "profiles", "characters", "elara.md"),
              "w", encoding="utf-8") as f:
        f.write("---\nname: Edited Later\n---\n\n# Overview\nDifferent.\n")

    diff = compare_migrated(project, "character", "elara.md")
    overview = next(s for s in diff["sections"] if s["id"] == "overview")
    assert "borrowed sword" in overview["original"]
    assert "Different." not in overview["original"]


def test_comparing_over_http(project):
    run_migration(project)
    body = client.get("/api/codex/migrate/compare",
                      params={"project_path": project, "type": "character",
                              "filename": "elara.md"}).json()
    assert body["name"] == "Elara Voss"
    assert any(s["changed"] for s in body["sections"])


def test_a_filename_off_the_wire_is_not_trusted_as_a_path(project):
    run_migration(project)
    response = client.get("/api/codex/migrate/compare",
                          params={"project_path": project, "type": "character",
                                  "filename": "../../project.json"})
    assert response.status_code >= 400


def test_a_missing_side_is_refused_rather_than_half_shown(project):
    run_migration(project)
    response = client.get("/api/codex/migrate/compare",
                          params={"project_path": project, "type": "character",
                                  "filename": "nobody.md"})
    assert response.json()["detail"]["code"] == "source_corrupt"


def test_an_unknown_type_is_refused(project):
    run_migration(project)
    response = client.get("/api/codex/migrate/compare",
                          params={"project_path": project, "type": "dragon",
                                  "filename": "elara.md"})
    assert response.json()["detail"]["code"] == "type_invalid"
