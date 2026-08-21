"""
The preset sections, and the one rule that makes them safe to ship.

NO PRESET MAY CONTAIN AN INVENTED PROPER NOUN.

That is not a style guideline, it is the reason presets can carry examples at
all. Preset text lands in notes/outline.md, and two things read that file and
believe it:

  THE WEAVE'S SCAN treats a capitalised word in a planning document as a name
  the writer has DECIDED on -- deliberately with no frequency floor, because
  choosing a name once is enough. An example reading "Kael must reach
  Ironhold" would put two people's worth of invented fiction into the writer's
  world and then ask them about it as though they had planned it.

  AI CONTEXT can carry the outline as an attached chip, where a model has no
  way to tell a shipped example from the writer's own material.

The old templates needed a whole <!-- TREAT AS SEED METADATA --> banner to
warn the AI off their invented values. Ship none and the banner is
unnecessary. This file is what keeps that true.
"""

import re

import pytest
from fastapi.testclient import TestClient

from app.codex.scan import _template_vocabulary
from app.outline_presets import GROUP_ORDER, PRESETS, render_preset


def test_there_are_presets_at_all():
    # A test suite that iterates an empty list passes forever.
    assert len(PRESETS) >= 15


def test_every_preset_belongs_to_a_known_group():
    for p in PRESETS:
        assert p["group"] in GROUP_ORDER, f"{p['id']} is in an unlisted group"


def test_ids_and_headings_are_unique():
    ids = [p["id"] for p in PRESETS]
    assert len(ids) == len(set(ids)), "two presets share an id"

    # Headings must be unique after the SAME normalisation the greying rule
    # uses, or two entries would grey each other out.
    def norm(h: str) -> str:
        return re.sub(r"\s+", " ", h.split(" -- ")[0]).strip().lower()

    headings = [norm(p["heading"]) for p in PRESETS]
    assert len(headings) == len(set(headings)), "two presets normalise alike"


def test_no_preset_ships_an_em_dash():
    # Locked product rule. `--` is the approved substitute.
    for p in PRESETS:
        assert "—" not in render_preset(p), f"{p['id']} has an em dash"
        assert "–" not in render_preset(p), f"{p['id']} has an en dash"


def test_every_preset_renders_its_heading_as_an_h2():
    # The greying rule matches `## Heading` lines, so a preset whose markdown
    # did not open with one could never grey out.
    for p in PRESETS:
        assert render_preset(p).startswith(f"## {p['heading']}\n")


def test_character_sections_are_repeatable():
    # A book has more than one character. Greying these after the first would
    # make the drawer useless from character two onward.
    repeatable = {p["id"] for p in PRESETS if p["repeatable"]}
    assert "identity" in repeatable
    assert "story_function" in repeatable


def test_the_world_preset_does_not_collide_with_the_worksheet_label():
    # The worksheet has a `Setting:` line at the top of the same file. The
    # preset heading is "Setting Sketch" so the two are visibly different to
    # a reader, not only to the matcher.
    headings = {p["heading"] for p in PRESETS}
    assert "Setting Sketch" in headings
    assert "Setting" not in headings


# ── The rule ─────────────────────────────────────────────────────────────────

def _capitalised_candidates(text: str) -> set[str]:
    """
    Capitalised words that are not at the start of a sentence or a line.

    Crude on purpose. A preset that trips this is asked to be rewritten rather
    than argued with -- the cost of a false positive is picking a different
    word, and the cost of a false negative is a fabricated name in somebody's
    story bible.
    """
    found: set[str] = set()
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue          # headings are chrome, stripped before scanning
        # Drop the first word of each sentence, which is capitalised by
        # grammar rather than by being a name.
        for sentence in re.split(r"(?<=[.!?])\s+", stripped):
            words = sentence.split()
            for word in words[1:]:
                bare = word.strip("_*.,;:()\"'?!")
                if bare[:1].isupper() and bare[1:].islower() and len(bare) > 2:
                    found.add(bare)
    return found


def test_no_preset_contains_an_invented_proper_noun():
    # THE RULE. Examples use role words -- "a disgraced soldier", "the heir",
    # "the winter road" -- so there is no name for a model to adopt and none
    # for the Weave to raise.
    #
    # The allow-list is words that are capitalised for a reason other than
    # being a name, and it is short deliberately: a long one would mean the
    # presets are drifting toward naming things.
    ALLOWED = {"Act", "One", "Two", "Three", "Chapter", "Example", "Goals",
               "Motivations", "Main", "Stakes", "Name", "Role", "Age", "Race",
               "Species"}
    offenders: dict[str, set[str]] = {}
    for p in PRESETS:
        found = _capitalised_candidates(p["body"]) - ALLOWED
        if found:
            offenders[p["id"]] = found
    assert not offenders, (
        f"invented-looking proper nouns in presets: {offenders}. "
        "Rewrite with role words: 'a disgraced soldier', not 'Kael'."
    )


def test_preset_words_are_subtracted_from_planned_names():
    # Otherwise the app asks the writer about its own scaffolding: "you seem
    # to have planned someone called Protagonist".
    vocabulary = _template_vocabulary()
    for word in ["premise", "protagonist", "midpoint", "resolution", "climax"]:
        assert word in vocabulary, f"{word!r} would be raised as a planned name"


def test_the_retired_templates_are_still_subtracted():
    # THE ONE NOBODY WOULD THINK OF. Every project made before v2.0.2 still
    # HAS a full template body in notes/outline.md. Deleting the renderers
    # without keeping their vocabulary would stop the subtraction for all of
    # those books at once, and nothing would fail -- the writer would just
    # find their planned-name list full of "Logline" and "Status Quo" again.
    vocabulary = _template_vocabulary()
    for word in ["logline", "status quo", "inciting incident", "working title"]:
        assert word in vocabulary, (
            f"{word!r} came from a retired template and is no longer "
            "subtracted -- check app/data/retired_outline_vocabulary.txt"
        )


def test_the_vocabulary_is_not_suspiciously_small():
    # Re-measured against the real presets plus the frozen corpus rather than
    # carried over from the template era. The floor is a tripwire for the
    # sources silently failing to load, not a target.
    assert len(_template_vocabulary()) > 120


# ── Over the wire ────────────────────────────────────────────────────────────

def test_the_catalog_is_served(client: TestClient):
    res = client.get("/api/documents/outline/presets")
    assert res.status_code == 200
    body = res.json()
    assert body["groups"] == GROUP_ORDER
    assert len(body["presets"]) == len(PRESETS)
    first = body["presets"][0]
    assert first["markdown"].startswith("## ")


def test_the_worksheet_is_offered_from_book_details(client: TestClient, tmp_path):
    import json as _json
    (tmp_path / "project.json").write_text(
        _json.dumps({"title": "A Book", "genre": "Fantasy", "story_type": "novella"}),
        encoding="utf-8",
    )
    res = client.get("/api/documents/outline/worksheet",
                     params={"folder_path": str(tmp_path)})
    assert res.status_code == 200
    content = res.json()["content"]
    assert "Title: A Book" in content
    assert "Genre: Fantasy" in content
    # Novella default, proving story_type reached the renderer.
    assert "Target Word Count: 30000" in content


def test_asking_for_the_worksheet_writes_nothing(client: TestClient, tmp_path):
    # It goes into the editor BUFFER. Its predecessor overwrote the file on
    # the server with no backup, which is why that one needed a two-step
    # confirm and this one does not.
    import json as _json
    (tmp_path / "project.json").write_text(_json.dumps({"title": "A Book"}),
                                           encoding="utf-8")
    (tmp_path / "notes").mkdir()
    outline = tmp_path / "notes" / "outline.md"
    outline.write_text("# Mine\n\nDo not touch.\n", encoding="utf-8")

    client.get("/api/documents/outline/worksheet",
               params={"folder_path": str(tmp_path)})
    assert outline.read_text(encoding="utf-8") == "# Mine\n\nDo not touch.\n"


@pytest.mark.parametrize("preset", PRESETS, ids=[p["id"] for p in PRESETS])
def test_each_preset_body_says_something(preset):
    # A heading with no prompt under it is a blank the writer has to guess at.
    assert len(preset["body"].strip()) > 20, f"{preset['id']} has no guidance"
