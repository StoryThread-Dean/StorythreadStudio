# tests/test_character_kinds.py -- Main vs Side character templates
# ===================================================================
# v1.0.10 splits character profiles into two templates: "main" (the full
# trait-block editor) and "side" (simplified -- every section is a single
# free-text field). Both live in the same folder and the same section
# headings; the difference is HOW trait sections store their body:
#   main -> YAML trait list (unchanged)
#   side -> plain paragraphs
# The parser is now tolerant: a trait-section body that isn't a YAML list
# round-trips as content instead of silently vanishing. These tests pin the
# round trip in both directions plus the frontmatter kind handling.

from fastapi.testclient import TestClient  # noqa: F401  (client fixture from conftest)

from app.routers.profiles import (
    Profile,
    ProfileSection,
    TraitBlock,
    _generate_profile_markdown,
    _make_empty_profile,
    _parse_profile_markdown,
)


def _roundtrip(profile: Profile) -> Profile:
    """Generate markdown from a Profile, then parse it back."""
    md = _generate_profile_markdown(profile, "character")
    return _parse_profile_markdown(md, profile.filename, "character")


def test_side_kind_survives_the_round_trip():
    p = _make_empty_profile("character", "Barkeep Tam", "Comic Relief", "tam.md",
                            character_kind="side")
    assert p.character_kind == "side"
    back = _roundtrip(p)
    assert back.character_kind == "side"


def test_main_kind_is_default_and_not_written_to_frontmatter():
    p = _make_empty_profile("character", "Alexandra", "", "alexandra.md")
    assert p.character_kind == "main"
    md = _generate_profile_markdown(p, "character")
    # Main is the default: omitting it keeps pre-v1.0.10 files byte-stable
    # on resave (no surprise frontmatter churn in the writer's git diffs).
    assert "character_kind" not in md


def test_old_files_without_kind_parse_as_main():
    p = _make_empty_profile("character", "Old Timer", "", "old.md")
    md = _generate_profile_markdown(p, "character")
    assert "character_kind" not in md
    back = _parse_profile_markdown(md, "old.md", "character")
    assert back.character_kind == "main"


def test_unknown_kind_falls_back_to_main():
    p = _make_empty_profile("character", "X", "", "x.md", character_kind="villain")
    assert p.character_kind == "main"


def test_side_template_plain_text_in_trait_sections_round_trips():
    # The heart of the side template: plain paragraphs living under a
    # trait-block heading like "# Physical Traits".
    p = _make_empty_profile("character", "Tam", "", "tam.md", character_kind="side")
    p.sections["physical_traits"] = ProfileSection(
        content="A gentle giant with impossibly perfect hair.\nAlways slightly sunburned.",
    )
    p.sections["motivations"] = ProfileSection(
        content="Wants the shop to outlive him and fears it won't.",
    )
    back = _roundtrip(p)
    assert "gentle giant" in back.sections["physical_traits"].content
    assert "Always slightly sunburned." in back.sections["physical_traits"].content
    assert back.sections["physical_traits"].trait_blocks == []
    assert "outlive him" in back.sections["motivations"].content


def test_main_template_trait_blocks_still_round_trip():
    # Regression guard: the tolerant parsing must not disturb the classic
    # YAML trait-list path.
    p = _make_empty_profile("character", "Alexandra", "", "alexandra.md")
    p.sections["personality_traits"] = ProfileSection(trait_blocks=[
        TraitBlock(id="1", trait="animated, awkward, clumsy",
                   description="Talks with her whole body: knocks things over mid-gesture.",
                   importance="core"),
    ])
    back = _roundtrip(p)
    blocks = back.sections["personality_traits"].trait_blocks
    assert len(blocks) == 1
    assert blocks[0].trait == "animated, awkward, clumsy"
    assert blocks[0].importance == "core"
    # Blocks win: content stays empty when the section parses as traits.
    assert back.sections["personality_traits"].content == ""


def test_side_template_drops_per_section_ai_summary_placeholders():
    # The simplified template keeps ONLY the Full AI Summary at the bottom.
    # Per-section "## AI Summary:" placeholders are main-template furniture.
    p = _make_empty_profile("character", "Tam", "", "tam.md", character_kind="side")
    md = _generate_profile_markdown(p, "character")
    assert "## AI Summary:" not in md
    assert "# Full AI Summary" in md
    # Main template keeps the per-section placeholders (regression guard).
    main_md = _generate_profile_markdown(
        _make_empty_profile("character", "Alexandra", "", "a.md"), "character")
    assert "## AI Summary:" in main_md


def test_side_template_preserves_existing_section_summary():
    # A summary that already exists (e.g. the profile was Main once, or the
    # writer generated one) must survive the resave, not be deleted.
    p = _make_empty_profile("character", "Tam", "", "tam.md", character_kind="side")
    p.sections["overview"] = ProfileSection(content="A barkeep.", ai_summary="Tam keeps the peace.")
    back = _roundtrip(p)
    assert back.sections["overview"].ai_summary == "Tam keeps the peace."


def test_create_endpoint_accepts_kind_and_list_reports_it(client, tmp_path):
    # HTTP-level: create one of each kind, then list and check the kinds.
    project = tmp_path / "proj"
    (project / "profiles" / "characters").mkdir(parents=True)

    r1 = client.post("/api/profiles/create", json={
        "folder_path": str(project), "type": "character",
        "name": "Main Hero", "character_kind": "main",
    })
    r2 = client.post("/api/profiles/create", json={
        "folder_path": str(project), "type": "character",
        "name": "Side Barkeep", "character_kind": "side",
    })
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r1.json()["character_kind"] == "main"
    assert r2.json()["character_kind"] == "side"

    listed = client.get("/api/profiles/list", params={
        "folder_path": str(project), "type": "character",
    }).json()
    kinds = {item["name"]: item["character_kind"] for item in listed}
    assert kinds == {"Main Hero": "main", "Side Barkeep": "side"}
