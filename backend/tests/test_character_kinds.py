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


# ── A colon in a trait name, in the OTHER Markdown dialect ───────────────────
#
# Reported by the writer as "Personality traits no longer create individual
# tiles -- saving groups them all into notes". The cause was ours: the trait NAME
# was written as a bare YAML scalar, and this app's own Story Role picker
# produces "Story role: Comic Relief". A colon-space ends the key, so the line
# stopped being a mapping, the whole list failed to parse, and the tolerant
# branch above did its job perfectly -- every word kept, as prose.
#
# Personality Traits was the only section affected because it is the only one the
# spine pickers write into, which is why it looked like a per-section bug.
#
# Fixed in BOTH writers: codex/threads.py for converted projects (pinned in
# test_codex_threads.py) and here for unconverted ones. The comment above the
# write in profiles.py had already worked out why a colon breaks a value -- and
# fixed only `description`.

def _with_trait(name: str) -> Profile:
    profile = _make_empty_profile("character", "Newton", "", "newton.md")
    profile.sections["personality_traits"] = ProfileSection(
        content="",
        trait_blocks=[
            TraitBlock(id="b-1", trait=name, description="Cares, awkwardly.",
                       importance="core"),
            TraitBlock(id="b-2", trait="Highly Anxious", description="Flustered.",
                       importance="present"),
        ],
    )
    return profile


def test_a_trait_name_with_a_colon_survives_the_round_trip():
    back = _roundtrip(_with_trait("Story role: Comic Relief"))
    section = back.sections["personality_traits"]
    assert [b.trait for b in section.trait_blocks] == [
        "Story role: Comic Relief", "Highly Anxious"]
    # And nothing fell through into prose, which is how the failure showed.
    assert section.content.strip() == ""


def test_one_bad_trait_never_takes_the_whole_section_with_it():
    # The cost was never one trait: YAML fails on the document, so a single
    # colon cost the writer every card in the section.
    back = _roundtrip(_with_trait("Story role: Comic Relief"))
    assert len(back.sections["personality_traits"].trait_blocks) == 2


def test_the_written_file_quotes_a_colon_rather_than_relying_on_the_repair():
    # ASSERTED ON THE FILE, not on a round trip. The read-time repair catches a
    # badly written trait on the way back in, so a round-trip test passes whether
    # or not the write side is fixed -- and the repair only exists for files
    # already on disk. If this is the only thing holding the write side up, the
    # app goes on producing files that need repairing forever.
    md = _generate_profile_markdown(_with_trait("Story role: Comic Relief"),
                                    "character")
    assert '- trait: "Story role: Comic Relief"' in md


def test_an_ordinary_trait_name_is_still_written_bare():
    # Quoting only when needed. These are the writer's own files and they open
    # them elsewhere; quoting everything would also rewrite every profile in
    # every project on its next save.
    md = _generate_profile_markdown(_with_trait("Genuinely Concerned"), "character")
    assert "- trait: Genuinely Concerned" in md


def test_a_profile_already_broken_on_disk_is_repaired_on_read():
    # The write side is fixed, so no new file can be written this way. This is
    # for the ones already on disk, and the repair used to skip exactly this line.
    broken = """---
name: Newton
type: character
---

# Overview

# Physical Traits

# Personality Traits
- trait: Genuinely Concerned
  description: "Cares, awkwardly."
  importance: background

- trait: Story role: Comic Relief
  description: "A punchline with a pressure gauge inside."
  importance: core

# Motivations

# Voice Notes

# Hidden and Foreshadowing Traits

# Relationships Overview

# Notes
"""
    back = _parse_profile_markdown(broken, "newton.md", "character")
    section = back.sections["personality_traits"]
    assert [b.trait for b in section.trait_blocks] == [
        "Genuinely Concerned", "Story role: Comic Relief"]
    assert section.content.strip() == ""


def test_a_writers_own_quoting_is_not_doubled():
    already = """---
name: Newton
type: character
---

# Personality Traits
- trait: "Story role: Comic Relief"
  description: "Fine as written."
  importance: core

# Notes
"""
    back = _parse_profile_markdown(already, "newton.md", "character")
    assert back.sections["personality_traits"].trait_blocks[0].trait \
        == "Story role: Comic Relief"


# ── The Enneagram type, stored ───────────────────────────────────────────────
#
# Spec: docs/character-spine-spec.md section 5.
#
# The writer's report was "the functionality and purpose of picking the
# ennegram never stays put". It did not: the control was a fire-and-forget
# inserter, and on a SIDE character it appended the paragraph with no label at
# all, so nothing on disk recorded that a type had ever been chosen. The
# character in the report was a side character.
#
# The type is a field now, and it has to survive both dialects. A field one
# parser knows and the other drops is the shape of R11.3 and of the `subtext`
# round trip, and it is invisible: a lost string looks exactly like one never
# set.

def _typed(name: str, filename: str, enneagram: str, kind: str = "main") -> Profile:
    p = _make_empty_profile("character", name, "", filename, character_kind=kind)
    p.enneagram = enneagram
    return p


def test_the_type_survives_a_profiles_round_trip():
    back = _roundtrip(_typed("Saki Murakami", "saki.md", "e1", kind="side"))
    assert back.enneagram == "e1"
    assert back.character_kind == "side"


def test_absent_stays_absent_and_writes_nothing():
    # Every profile ever written is in this state and must stay in it -- and an
    # ordinary profile must resave with no diff, so the key is not written at
    # all rather than written empty.
    p = _make_empty_profile("character", "Nobody", "", "n.md")
    md = _generate_profile_markdown(p, "character")
    assert "enneagram:" not in md
    assert _roundtrip(p).enneagram == ""


def test_an_unknown_id_is_kept_rather_than_dropped():
    # A hand edit, or a newer release. Dropping it to look tidy would destroy
    # the writer's answer; the SCREEN decides what it can render.
    assert _roundtrip(_typed("Odd", "o.md", "e99")).enneagram == "e99"


def test_both_dialects_carry_the_type():
    # THE CONTRACT THAT MATTERS. profiles.py and codex/threads.py must agree,
    # or bringing a project into the Weave silently loses every type.
    from app.codex.threads import parse_thread, render_thread

    profiles_md = _generate_profile_markdown(
        _typed("Saki Murakami", "saki.md", "e4"), "character")
    assert "enneagram: e4" in profiles_md

    thread = parse_thread(profiles_md)
    assert thread.get("enneagram") == "e4", "threads.py dropped the type"
    assert "enneagram: e4" in render_thread(thread), "render_thread dropped it"
    assert parse_thread(render_thread(thread))["enneagram"] == "e4"


# ── Aliases: every word an entry answers to ──────────────────────────────────
#
# Spec: docs/weave-spec.md, appendix 2, section A3.1.
#
# The Weave has carried aliases since v2.0.0 and profiles/ never did, so a
# writer on an unconverted project had nowhere to put a nickname. The writer's
# own example: Gwendolyn Barksdale is Gwen to everyone who knows her and Willow
# on stage, and all three have to point at one profile.

def _named(name: str, filename: str, aliases: list[str],
           ptype: str = "character") -> Profile:
    p = _make_empty_profile(ptype, name, "", filename)
    p.aliases = aliases
    return p


def test_aliases_survive_the_profiles_round_trip():
    back = _roundtrip(_named("Gwendolyn Barksdale", "gwen.md", ["Gwen", "Willow"]))
    assert back.aliases == ["Gwen", "Willow"]


def test_no_aliases_writes_nothing_and_stays_empty():
    # Every profile written before this is in that state and must resave with
    # no diff.
    p = _make_empty_profile("character", "Nobody", "", "n.md")
    assert "aliases:" not in _generate_profile_markdown(p, "character")
    assert _roundtrip(p).aliases == []


def test_an_alias_with_a_colon_does_not_break_the_frontmatter():
    # The same hazard a trait name had: a colon turns the line into a mapping
    # and takes the whole list down with it.
    back = _roundtrip(_named("The Guild", "guild.md",
                             ["Weavers: the old name"], ptype="lore"))
    assert back.aliases == ["Weavers: the old name"]


def test_blank_aliases_are_dropped_rather_than_stored():
    back = _roundtrip(_named("Ashfall", "ash.md", ["the Ash", "   ", ""],
                             ptype="location"))
    assert back.aliases == ["the Ash"]


def test_both_dialects_carry_aliases():
    # THE CONTRACT. profiles.py and codex/threads.py must agree, or converting
    # a project silently loses every nickname the writer typed.
    from app.codex.threads import parse_thread, render_thread

    md = _generate_profile_markdown(
        _named("Gwendolyn Barksdale", "gwen.md", ["Gwen", "Willow"]), "character")
    thread = parse_thread(md)
    assert thread.get("aliases") == ["Gwen", "Willow"], "threads.py dropped them"
    assert parse_thread(render_thread(thread))["aliases"] == ["Gwen", "Willow"]


def test_aliases_are_not_a_character_only_idea():
    # A place is "Ashfall" and "the burned city" as readily as a person is
    # "Gwendolyn" and "Gwen". build_alias_map walks every Thread regardless of
    # kind, so restricting this to characters would be a limit invented by one
    # screen and contradicted by the index behind it.
    for ptype in ("location", "lore", "relationship"):
        back = _parse_profile_markdown(
            _generate_profile_markdown(
                _named("Ashfall", "a.md", ["the Ash"], ptype=ptype), ptype),
            "a.md", ptype)
        assert back.aliases == ["the Ash"], ptype
