# tests/test_codex_types.py -- the type registry, and why it is never repaired
# =============================================================================
# codex/types.json says what kinds of thing a world contains: types, their
# sections and custom fields, and the vocabulary of connections between them.
#
# The rule these tests exist to protect is the recovery rule. The moment a
# writer adds a custom type or a relation of their own, this file stops being
# config and becomes THEIR DATA. So unlike structure.json -- which is
# derivable from the folder and is therefore treated as absent when corrupt --
# an invalid types.json must be REFUSED, never regenerated. Helpfully
# resetting it would destroy work recoverable from nowhere else.

import json
import os

import pytest

from app.codex.types_registry import (
    SCHEMA_VERSION,
    TypesError,
    default_registry,
    folder_for_type,
    inverse_label,
    load_registry,
    registry_path,
    relation_allows,
    relation_by_id,
    seed_registry,
    type_by_id,
    validate_registry,
)


def _write(folder, data) -> str:
    path = registry_path(folder)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        if isinstance(data, str):
            f.write(data)
        else:
            json.dump(data, f)
    return path


def _project(tmp_path) -> str:
    root = tmp_path / "MyNovel"
    root.mkdir()
    return str(root)


# ── The defaults ─────────────────────────────────────────────────────────────

def test_the_built_in_registry_is_valid():
    validate_registry(default_registry())


def test_the_defaults_cover_the_types_the_writer_asked_for():
    ids = {t["id"] for t in default_registry()["types"]}
    # The four that exist today, plus the five the Weave adds.
    assert {"character", "relationship", "location", "lore"} <= ids
    assert {"faction", "religion", "object", "concept", "event"} <= ids


def test_married_to_ships_with_no_exclusivity():
    # Exclusivity is something a writer declares about THEIR world. Assuming
    # it would encode one culture's marriage rules into a tool for inventing
    # others -- and would make the contradiction checker flag ordinary
    # fiction as an error.
    married = relation_by_id(default_registry(), "married_to")
    assert married["exclusive_group"] is None
    assert married["symmetric"] is True


# ── Validation: each rule, and the message it produces ───────────────────────

def test_a_missing_schema_version_is_refused():
    with pytest.raises(TypesError, match="schema_version"):
        validate_registry({"types": [], "relations": []})


def test_a_newer_schema_version_is_refused_rather_than_guessed_at():
    data = default_registry()
    data["schema_version"] = SCHEMA_VERSION + 1
    with pytest.raises(TypesError, match="newer version"):
        validate_registry(data)


def test_an_invalid_identifier_names_where_it_is():
    data = default_registry()
    data["types"][2]["id"] = "Not An Id"
    with pytest.raises(TypesError) as exc:
        validate_registry(data)
    # "types[2].id" tells a writer where to look; "invalid file" does not.
    assert "types[2].id" in str(exc.value)


def test_duplicate_type_ids_are_refused():
    data = default_registry()
    data["types"][1]["id"] = data["types"][0]["id"]
    with pytest.raises(TypesError, match="Duplicate type id"):
        validate_registry(data)


def test_two_types_sharing_a_folder_are_refused():
    # They would silently interleave their entries on disk.
    data = default_registry()
    data["types"][1]["folder"] = data["types"][0]["folder"]
    with pytest.raises(TypesError, match="Duplicate folder"):
        validate_registry(data)


def test_a_folder_that_is_really_a_path_is_refused():
    data = default_registry()
    data["types"][0]["folder"] = "../../elsewhere"
    with pytest.raises(TypesError, match="plain folder name"):
        validate_registry(data)


def test_duplicate_relation_ids_are_refused():
    data = default_registry()
    data["relations"][1]["id"] = data["relations"][0]["id"]
    with pytest.raises(TypesError, match="Duplicate relation id"):
        validate_registry(data)


def test_a_relation_pointing_at_a_type_that_does_not_exist_is_refused():
    data = default_registry()
    data["relations"][0]["target_types"] = ["dragon"]
    with pytest.raises(TypesError, match="not a type defined"):
        validate_registry(data)


def test_an_unknown_custom_field_kind_is_refused():
    data = default_registry()
    data["types"][0]["custom_fields"] = [{"id": "born", "label": "Born", "kind": "sigil"}]
    with pytest.raises(TypesError) as exc:
        validate_registry(data)
    assert "kind" in str(exc.value)


def test_a_symmetric_relation_may_not_also_name_an_inverse():
    # It IS its own inverse; a second answer to the same question would let
    # the two drift apart, which is the whole reason only one direction is
    # ever stored.
    data = default_registry()
    data["relations"][0]["symmetric"] = True
    data["relations"][0]["inverse"] = "something_else"
    with pytest.raises(TypesError, match="symmetric"):
        validate_registry(data)


def test_a_required_field_that_is_neither_section_nor_custom_field_is_refused():
    data = default_registry()
    data["types"][0]["required_fields"] = ["nonexistent"]
    with pytest.raises(TypesError, match="neither a section nor a custom field"):
        validate_registry(data)


def test_a_type_with_no_sections_is_refused():
    data = default_registry()
    data["types"][0]["sections"] = []
    with pytest.raises(TypesError, match="section"):
        validate_registry(data)


# ── Loading and the recovery rule ────────────────────────────────────────────

def test_an_absent_file_yields_the_defaults_and_writes_nothing(tmp_path):
    folder = _project(tmp_path)
    registry, from_file = load_registry(folder)
    assert from_file is False
    assert registry == default_registry()
    assert not os.path.exists(registry_path(folder))


def test_a_valid_file_is_loaded_as_written(tmp_path):
    folder = _project(tmp_path)
    custom = default_registry()
    custom["types"].append({
        "id": "vessel", "label": "Vessel", "folder": "vessels", "icon": "Package",
        "sections": [{"id": "overview", "heading": "Overview", "trait_blocks": False}],
        "required_fields": [], "custom_fields": [],
    })
    _write(folder, custom)

    registry, from_file = load_registry(folder)
    assert from_file is True
    assert folder_for_type(registry, "vessel") == "vessels"


def test_invalid_json_is_refused_and_the_file_is_left_alone(tmp_path):
    # THE rule. A writer's custom types must never be replaced by defaults
    # because of a stray comma.
    folder = _project(tmp_path)
    path = _write(folder, '{"schema_version": 1, "types": [ oops }')
    before = open(path, encoding="utf-8").read()

    with pytest.raises(TypesError) as exc:
        load_registry(folder)
    assert "left exactly as it is" in str(exc.value)
    assert open(path, encoding="utf-8").read() == before


def test_a_structurally_invalid_file_is_refused_and_left_alone(tmp_path):
    folder = _project(tmp_path)
    bad = default_registry()
    bad["types"][0]["id"] = "Bad Id"
    path = _write(folder, bad)
    before = open(path, encoding="utf-8").read()

    with pytest.raises(TypesError):
        load_registry(folder)
    assert open(path, encoding="utf-8").read() == before


def test_seeding_writes_the_defaults_once(tmp_path):
    folder = _project(tmp_path)
    seed_registry(folder)
    assert os.path.isfile(registry_path(folder))
    _, from_file = load_registry(folder)
    assert from_file is True


def test_seeding_never_overwrites_an_existing_file(tmp_path):
    folder = _project(tmp_path)
    custom = default_registry()
    custom["types"][0]["label"] = "Person"
    _write(folder, custom)

    seed_registry(folder)
    registry, _ = load_registry(folder)
    assert registry["types"][0]["label"] == "Person"


# ── Reading relations ────────────────────────────────────────────────────────

def test_an_inverse_is_derived_not_stored_twice():
    registry = default_registry()
    assert inverse_label(registry, "mentored_by") == "mentor_of"
    # A symmetric relation reads the same from either end.
    assert inverse_label(registry, "sibling_of") == "sibling_of"


def test_a_relation_knows_which_kinds_of_thing_it_connects():
    registry = default_registry()
    assert relation_allows(registry, "member_of", "character", "faction") is True
    # A location cannot be a member of a faction.
    assert relation_allows(registry, "member_of", "location", "faction") is False
    assert relation_allows(registry, "not_a_relation", "character", "faction") is False


# ── One kind, one set of sections ───────────────────────────────────────────
#
# A section's id is DERIVED FROM ITS HEADING when a file is read. That makes a
# registry id which disagrees with its own heading a section that can never be
# found: the editor looks up the declared id, the file produces the derived
# one, and the writer's words sit on disk looking like they were never saved.
#
# It is exactly how two populations of the same kind ended up in one world --
# entries converted from profiles/ carrying the Profile Builder's headings,
# and entries created by Weaving carrying the Weave's shorter set. Nothing
# checked that the two agreed, so nothing said anything.

def test_every_shipped_section_id_matches_its_own_heading():
    from app.codex.threads import _section_id

    for entry in default_registry()["types"]:
        for section in entry.get("sections") or []:
            assert section["id"] == _section_id(section["heading"]), (
                f"{entry['id']}.{section['id']} would be read back as "
                f"'{_section_id(section['heading'])}'"
            )


def test_the_kinds_the_profile_builder_edits_carry_its_full_set():
    # The Profile Builder's sets are canonical: they are what the writer has
    # actually been filling in. The Weave shipped shorter ones and the two
    # disagreed; deciding the other way would have meant handing the writer a
    # thinner page for the same job.
    expected = {
        # `relationships_overview` is retired and still listed: it round trips
        # so a writer's legacy prose is not dropped on the next save. The
        # section that does the job now is `relationships`, which carries trait
        # blocks -- one per relationship with nobody on the other end. A
        # relationship that HAS an entry on the other end is a Connection and
        # lives in the frontmatter, where it can resolve and be drawn.
        "character": ["overview", "physical_traits", "personality_traits",
                      "motivations", "voice_notes",
                      "hidden_and_foreshadowing_traits",
                      "relationships_overview", "relationships", "notes"],
        "location": ["overview", "physical_description", "tone_and_atmosphere",
                     "historical_significance", "cultural_significance",
                     "scene_use_notes", "notes"],
        "lore": ["overview", "rule_or_concept", "what_it_affects",
                 "what_characters_know", "story_relevance", "notes"],
        "relationship": ["overview", "history", "current_dynamic",
                         "hidden_tensions", "emotional_direction", "notes"],
    }
    by_id = {t["id"]: t for t in default_registry()["types"]}
    for type_id, sections in expected.items():
        assert [s["id"] for s in by_id[type_id]["sections"]] == sections


def test_a_file_written_under_an_older_section_name_still_finds_its_home():
    # The healing path: read normalises, and the canonical heading comes back
    # with it so the next save writes the new name. No pass to run.
    from app.codex.threads import parse_thread

    raw = ("---\ntype: location\nentity_id: e-moor\nname: Ravensmoor\n---\n\n"
           "# Appearance\nCold stone and colder wind.\n")
    section = parse_thread(raw, default_registry())["sections"]
    assert "physical_description" in section
    assert section["physical_description"]["heading"] == "Physical Description"
    assert "colder wind" in section["physical_description"]["content"]


def test_the_two_populations_of_a_kind_agree_after_reading():
    # An entry converted from profiles/ and one created by Weaving must land
    # on the SAME keys, or the editor shows one and not the other.
    from app.codex.threads import parse_thread

    converted = ("---\ntype: character\nentity_id: e-a\nname: A\n---\n\n"
                 "# Hidden and Foreshadowing Traits\nShe knows.\n")
    made = ("---\ntype: character\nentity_id: e-b\nname: B\n---\n\n"
            "# Hidden and Foreshadowing\nHe knows.\n")
    a = parse_thread(converted, default_registry())["sections"]
    b = parse_thread(made, default_registry())["sections"]
    assert set(a) == set(b) == {"hidden_and_foreshadowing_traits"}


# ── A SHIPPED LABEL THAT WAS RENAMED ────────────────────────────────────────
#
# "Government" turned out to be too specific for what the kind holds. The
# writer's report: "A leader of a party isn't a government. 'Ruling Authority'
# is more accurate." A crown, a council, a corporate board, an occupying force
# and a party boss are all ruling authorities; only some are governments.
#
# The change is a LABEL and nothing else -- the id stays `government` and the
# folder stays `governments`, because renaming either would rewrite entity types
# on disk and break every relation endpoint naming this kind, for a word on a
# screen.
#
# The delicate part is projects seeded before the change: their own types.json
# carries the old word and would say it forever.

def test_the_shipped_label_is_the_new_one():
    entry = next(t for t in default_registry()["types"] if t["id"] == "government")
    assert entry["label"] == "Ruling Authorities"
    # And the parts that must NOT move.
    assert entry["id"] == "government"
    assert entry["folder"] == "governments"


def test_an_old_project_is_healed_on_load(tmp_path):
    from app.codex.types_registry import load_registry, registry_path

    registry = default_registry()
    for entry in registry["types"]:
        if entry["id"] == "government":
            entry["label"] = "Governments"          # as it was seeded
    path = registry_path(str(tmp_path))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(registry, handle)

    loaded, from_file = load_registry(str(tmp_path))
    assert from_file is True
    label = next(t["label"] for t in loaded["types"] if t["id"] == "government")
    assert label == "Ruling Authorities"


def test_A_LABEL_THE_WRITER_CHOSE_IS_NEVER_OVERWRITTEN(tmp_path):
    """
    The rule that makes the heal safe, and the one worth the test.

    R2.11 made renaming a kind a supported thing to do, and this app's standing
    rule is that a types.json is never repaired over the writer's own
    customisation. A writer who called this kind "The Crown" meant it, and
    replacing that with "Ruling Authorities" would be the app overruling them
    about the vocabulary of their own world.
    """
    from app.codex.types_registry import load_registry, registry_path

    registry = default_registry()
    for entry in registry["types"]:
        if entry["id"] == "government":
            entry["label"] = "The Crown"
    path = registry_path(str(tmp_path))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(registry, handle)

    loaded, _ = load_registry(str(tmp_path))
    label = next(t["label"] for t in loaded["types"] if t["id"] == "government")
    assert label == "The Crown"


def test_the_heal_writes_nothing_to_disk(tmp_path):
    # Applied to what is LOADED, not saved back. A project the writer never
    # edits is never touched -- same lifecycle rule the registry already has,
    # where an absent file yields defaults and writes nothing.
    from app.codex.types_registry import load_registry, registry_path

    registry = default_registry()
    for entry in registry["types"]:
        if entry["id"] == "government":
            entry["label"] = "Governments"
    path = registry_path(str(tmp_path))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(registry, handle)
    before = open(path, encoding="utf-8").read()

    load_registry(str(tmp_path))
    assert open(path, encoding="utf-8").read() == before


# ── Sections the app gained after a project was seeded ───────────────────────
#
# THE BUG THESE CLOSE, and this module's own rules are what made it easy to
# walk into. `types.json` is seeded per project at first use and is never
# rewritten, because the moment a writer adds a kind or a relation of their own
# it stops being config and becomes THEIR DATA. That rule is right.
#
# The consequence is not. A section added to DEFAULT_TYPES reached NEW projects
# only. Every existing project went on rendering the list it was seeded with,
# so the writer's twenty-one characters had no Relationships section at all --
# and nothing said so, because a section the registry does not list is a
# section the form has no place for. Reported as exactly that: "all 20 require
# Relationships to be added."
#
# Reconciled in memory on every read. The file is never touched.

def _seeded(tmp_path, sections, type_id="character", extra_types=None):
    """A project whose types.json predates a shipped change."""
    root = tmp_path / "Novel"
    (root / "codex").mkdir(parents=True)
    types = [{
        "id": type_id, "label": "Characters", "folder": "characters",
        "icon": "User", "group": "profiles", "default_section": True,
        "sections": [{"id": s, "heading": s.replace("_", " ").title(),
                      "trait_blocks": False} for s in sections],
        "required_fields": [], "custom_fields": [],
    }]
    types += list(extra_types or [])
    (root / "codex" / "types.json").write_text(
        json.dumps({"schema_version": SCHEMA_VERSION, "types": types, "relations": []}, indent=2),
        encoding="utf-8")
    return str(root)


OLD_CHARACTER = ["overview", "physical_traits", "personality_traits",
                 "motivations", "voice_notes",
                 "hidden_and_foreshadowing_traits", "relationships_overview",
                 "notes"]


def test_a_project_seeded_before_the_section_existed_gets_it(tmp_path):
    registry, from_file = load_registry(_seeded(tmp_path, OLD_CHARACTER))
    assert from_file is True
    ids = [s["id"] for s in type_by_id(registry, "character")["sections"]]
    assert "relationships" in ids


def test_it_lands_where_it_ships_rather_than_at_the_end(tmp_path):
    # Between Relationships Overview and Notes. Appended after the writer's own
    # additions it would read as an afterthought on a page whose ordering is
    # the template.
    registry, _ = load_registry(_seeded(tmp_path, OLD_CHARACTER))
    ids = [s["id"] for s in type_by_id(registry, "character")["sections"]]
    assert ids.index("relationships_overview") < ids.index("relationships")
    assert ids.index("relationships") < ids.index("notes")


def test_it_arrives_with_its_shipped_shape(tmp_path):
    # Trait-blocked, or the section renders as one text box and a relationship
    # cannot carry a weight or a window.
    registry, _ = load_registry(_seeded(tmp_path, OLD_CHARACTER))
    section = next(s for s in type_by_id(registry, "character")["sections"]
                   if s["id"] == "relationships")
    assert section["trait_blocks"] is True


def test_the_file_on_disk_is_never_touched(tmp_path):
    # THE RULE THIS HAS TO OBEY. It is the writer's file; a read must not
    # rewrite it, or every project shows a diff for a change nobody made.
    root = _seeded(tmp_path, OLD_CHARACTER)
    path = os.path.join(root, "codex", "types.json")
    before = open(path, "rb").read()
    load_registry(root)
    load_registry(root)
    assert open(path, "rb").read() == before


def test_a_retired_kind_is_retired_for_an_old_project_too(tmp_path):
    # Otherwise the app goes on offering a kind it has retired, to exactly the
    # writers who already have too many of them.
    root = _seeded(tmp_path, OLD_CHARACTER, extra_types=[{
        "id": "relationship", "label": "Relationships",
        "folder": "relationships", "icon": "Heart", "group": "profiles",
        "default_section": False,
        "sections": [{"id": "overview", "heading": "Overview",
                      "trait_blocks": False}],
        "required_fields": [], "custom_fields": [],
    }])
    registry, _ = load_registry(root)
    assert type_by_id(registry, "relationship")["retired"] is True


# ── What it must never do ───────────────────────────────────────────────────

def test_a_kind_the_writer_invented_is_left_completely_alone(tmp_path):
    root = _seeded(tmp_path, ["overview", "my_own_section"],
                   type_id="starship")
    registry, _ = load_registry(root)
    ids = [s["id"] for s in type_by_id(registry, "starship")["sections"]]
    assert ids == ["overview", "my_own_section"]


def test_the_writers_own_sections_are_kept_and_not_reordered(tmp_path):
    # They moved things around, or added their own. Reconciling shipped
    # sections must insert, never rearrange.
    order = ["overview", "my_own_section", "physical_traits",
             "personality_traits", "motivations", "voice_notes",
             "hidden_and_foreshadowing_traits", "relationships_overview",
             "notes"]
    registry, _ = load_registry(_seeded(tmp_path, order))
    ids = [s["id"] for s in type_by_id(registry, "character")["sections"]]
    assert ids.index("my_own_section") == 1
    assert [i for i in ids if i in order] == order


def test_nothing_is_ever_removed(tmp_path):
    root = _seeded(tmp_path, OLD_CHARACTER + ["a_section_we_never_shipped"])
    registry, _ = load_registry(root)
    ids = [s["id"] for s in type_by_id(registry, "character")["sections"]]
    assert "a_section_we_never_shipped" in ids


def test_an_existing_sections_shape_is_not_rewritten(tmp_path):
    # A writer -- or an older build -- may have a shipped section with
    # different flags. Changing `trait_blocks` under existing content is how
    # prose becomes invisible and a trait list becomes a paragraph, so only
    # sections being ADDED get their shipped shape.
    sections = [{"id": "overview", "heading": "Overview", "trait_blocks": True}]
    root = tmp_path / "Odd"
    (root / "codex").mkdir(parents=True)
    (root / "codex" / "types.json").write_text(json.dumps({
        "schema_version": SCHEMA_VERSION, "relations": [], "types": [{
            "id": "character", "label": "Characters", "folder": "characters",
            "icon": "User", "group": "profiles", "default_section": True,
            "sections": sections, "required_fields": [], "custom_fields": [],
        }]}, indent=2), encoding="utf-8")
    registry, _ = load_registry(str(root))
    overview = next(s for s in type_by_id(registry, "character")["sections"]
                    if s["id"] == "overview")
    assert overview["trait_blocks"] is True


def test_a_project_with_no_file_still_gets_the_defaults(tmp_path):
    # The absent-file lifecycle is unchanged: defaults in memory, nothing
    # written, so a project that never opens the Weave stays untouched.
    root = tmp_path / "Fresh"
    (root / "codex").mkdir(parents=True)
    registry, from_file = load_registry(str(root))
    assert from_file is False
    ids = [s["id"] for s in type_by_id(registry, "character")["sections"]]
    assert "relationships" in ids
    assert not os.path.exists(os.path.join(str(root), "codex", "types.json"))


def test_reading_twice_adds_it_once(tmp_path):
    root = _seeded(tmp_path, OLD_CHARACTER)
    load_registry(root)
    registry, _ = load_registry(root)
    ids = [s["id"] for s in type_by_id(registry, "character")["sections"]]
    assert ids.count("relationships") == 1
