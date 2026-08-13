# tests/test_codex_icon_keywords.py -- the small surprise, and its contract
# ==========================================================================
# When a writer invents a kind of their own, the app looks for a word it
# recognises and gives the section a fitting icon. It is entirely cosmetic.
# What it buys is a moment: somebody types a name they were sure was theirs
# alone, and the app answers with a little rocket.
#
# Two things are tested here. The matching rules, which the obvious
# implementation gets wrong. And the CROSS-LANGUAGE CONTRACT: every icon
# name Python can store has to be an icon TypeScript actually bundles.
# Nothing else checks that, and the failure -- a blank square where the
# surprise should be -- is exactly the kind that ships unnoticed.

import re
from pathlib import Path

from app.codex.icon_keywords import icon_for_name, known_icon_names
from app.codex.sections import NOTE_SECTIONS
from app.codex.types_registry import DEFAULT_TYPES

LEXICON = (Path(__file__).resolve().parents[2]
           / "app" / "src" / "features" / "codex" / "lexicon.ts")


# ── The rules, each of which the naive version gets wrong ────────────────────

def test_a_whole_word_beats_a_part_of_one():
    # "Starfighter" is a spaceship, not a star -- even though "star" is
    # sitting right there at the front. A plain substring scan gets this
    # backwards.
    assert icon_for_name("Starfighter") == "Rocket"
    assert icon_for_name("Star") == "Star"


def test_a_longer_substring_wins_over_a_shorter_one():
    assert icon_for_name("Starlight") == "Star"
    assert icon_for_name("Superstar") == "Star"


def test_the_first_word_wins():
    # "Demon Magic" is a demon. The writer put Demon first, and the leading
    # word is what a name is mostly about.
    assert icon_for_name("Demon Magic") == "Skull"
    assert icon_for_name("Magic System") == "Wand"
    assert icon_for_name("Winter Court") == "Snowflake"


def test_several_words_can_share_one_icon():
    for name in ("Magic", "Sorcery", "Enchantment", "Runes"):
        assert icon_for_name(name) == "Wand", name


def test_a_name_it_does_not_know_gets_nothing():
    # A miss must look exactly like the world before this existed: the
    # caller's own neutral default, not a wrong guess.
    assert icon_for_name("Bloodline") is None
    assert icon_for_name("Zzyzx Qwerty") is None
    assert icon_for_name("") is None


def test_matching_ignores_case_and_underscores():
    assert icon_for_name("DRAGON") == "Flame"
    assert icon_for_name("royal_household") == "Crown"


def test_a_short_word_does_not_match_inside_a_longer_one():
    # Substring matching is limited to keywords of four letters or more, so
    # an unrelated word does not pick up a fragment.
    assert icon_for_name("Warden") == "Shield"     # its own keyword
    assert icon_for_name("Software") is None       # not "war" inside it


def test_a_custom_kind_gets_its_surprise(tmp_path):
    from app.codex.types_registry import add_type, type_by_id

    root = tmp_path / "MyNovel"
    root.mkdir()
    (root / "project.json").write_text("{}", encoding="utf-8")
    registry = add_type(str(root), "", "Starfighter", group="other")
    assert type_by_id(registry, "starfighter")["icon"] == "Rocket"


def test_a_kind_it_does_not_recognise_still_gets_a_usable_icon(tmp_path):
    from app.codex.types_registry import add_type, type_by_id

    root = tmp_path / "MyNovel"
    root.mkdir()
    (root / "project.json").write_text("{}", encoding="utf-8")
    registry = add_type(str(root), "", "Bloodline", group="profiles")
    assert type_by_id(registry, "bloodline")["icon"] == "CircleDashed"


# ── The cross-language contract ──────────────────────────────────────────────

def _bundled_icon_names() -> set[str]:
    """The icon names lexicon.ts actually imports into its ICONS map.

    Reading a TypeScript file from a Python test is unusual, and it is the
    point: this is the ONE place the two languages agree on a vocabulary,
    and an agreement nothing verifies is one that quietly breaks. It already
    did once -- four kinds were added here and rendered as blanks over there
    for several commits.
    """
    source = LEXICON.read_text(encoding="utf-8")
    match = re.search(r"const ICONS: Record<string, LucideIcon> = \{(.*?)\n\};",
                      source, re.DOTALL)
    assert match, "could not find the ICONS map in lexicon.ts"
    body = re.sub(r"//[^\n]*", "", match.group(1))          # drop comments
    return {name.strip() for name in body.split(",") if name.strip()}


def test_every_icon_the_easter_egg_can_produce_is_bundled():
    missing = known_icon_names() - _bundled_icon_names()
    assert not missing, (
        f"lexicon.ts does not import {sorted(missing)}, so those names would "
        f"render as a neutral square instead of the surprise."
    )


def test_every_shipped_kinds_icon_is_bundled():
    missing = {t["icon"] for t in DEFAULT_TYPES} - _bundled_icon_names()
    assert not missing, f"lexicon.ts does not import {sorted(missing)}"


def test_every_note_icon_is_bundled():
    missing = {n["icon"] for n in NOTE_SECTIONS} - _bundled_icon_names()
    assert not missing, f"lexicon.ts does not import {sorted(missing)}"


def test_the_fallbacks_are_bundled():
    assert {"CircleDashed", "FileText"} <= _bundled_icon_names()


def test_the_keyword_list_is_worth_having():
    # Not a size contest -- but a handful of words would not produce the
    # moment this exists for.
    from app.codex.icon_keywords import KEYWORD_ICONS
    assert len(KEYWORD_ICONS) > 150
    assert len(known_icon_names()) > 25


# ── The other cross-language contract: the walkthrough's vocabulary ──────────

def test_every_stop_kind_the_scan_sends_has_words_on_screen():
    """
    A stop kind with no Lexicon entry renders as a blank row.

    Same failure as the icons above, and same reason nothing else catches it:
    Python decides what to send, TypeScript decides what to say, and only a
    test that reads both notices when one moves. The app's own doctrine says
    a term that can appear on screen with nothing explaining it fails the
    build -- this is where that is enforced for Weaving.
    """
    from app.codex.scan import STOP_KINDS

    source = LEXICON.read_text(encoding="utf-8")
    match = re.search(r"export const STOP_KINDS: Record<string, LexEntry> = \{(.*?)\n\};",
                      source, re.DOTALL)
    assert match, "could not find the STOP_KINDS map in lexicon.ts"
    # Keys are written either bare or quoted; both are valid TypeScript and
    # both appear in that file.
    keys = set(re.findall(r'^\s{2}"?([a-z_][a-z0-9_-]*)"?:\s*entry\(',
                          match.group(1), re.MULTILINE))

    missing = set(STOP_KINDS) - keys
    assert not missing, (
        f"lexicon.ts has no entry for {sorted(missing)}, so those stops would "
        f"appear in the walkthrough with no name and nothing explaining them."
    )


def test_every_kinds_sidebar_group_agrees_with_the_frontend():
    """
    A THIRD cross-language contract, and the same failure mode as the icons.

    The kind pickers are grouped without fetching the registry, so lexicon.ts
    keeps its own copy of which group each kind is in. A copy nothing checks is
    a copy that drifts -- and the way it would show is a Faction appearing
    under "Other" in one screen and "Profiles" in another, which reads as a bug
    in the writer's own world rather than in ours.
    """
    from app.codex.types_registry import DEFAULT_TYPES

    source = LEXICON.read_text(encoding="utf-8")
    match = re.search(
        r'export const TYPE_GROUPS: Record<string, "profiles" \| "other"> = \{(.*?)\n\};',
        source, re.DOTALL)
    assert match, "could not find TYPE_GROUPS in lexicon.ts"

    body = re.sub(r"//[^\n]*", "", match.group(1))
    frontend = dict(re.findall(r'(\w+):\s*"(profiles|other)"', body))
    backend = {t["id"]: t["group"] for t in DEFAULT_TYPES}

    assert frontend == backend, (
        "lexicon.ts and the type registry disagree about which sidebar group a "
        "kind belongs to. Differences: "
        + ", ".join(
            f"{k}: registry={backend.get(k)!r} lexicon={frontend.get(k)!r}"
            for k in sorted(set(backend) | set(frontend))
            if backend.get(k) != frontend.get(k)
        )
    )


# ── R8.10: the connection vocabulary, which was exempt from all of this ──────
#
# About seventy relations ship, and they were the one part of the writer-facing
# vocabulary nothing checked. They are exempt from the CROSS-LANGUAGE half by
# construction -- the picker fetches them from GET /relations rather than
# keeping a copy -- so there is no drift to catch. What there is instead is a
# vocabulary that a writer reads off a dropdown, and every failure below shows
# up as a menu that is confusing rather than as an error:
#
#   a relation filed under a heading the picker does not know -> lands nowhere
#   two identical labels in one group                          -> unpickable
#   a directional relation with no inverse                     -> the other end
#                                                                 reads as
#                                                                 "X (the other
#                                                                 way round)"
#   a relation whose kinds do not exist                        -> never offered
#
# None of those raise anything. All of them are the writer's problem.

def _relations() -> list[dict]:
    from app.codex.types_registry import DEFAULT_RELATIONS
    return DEFAULT_RELATIONS


def test_every_relation_is_filed_under_a_heading_the_picker_knows():
    from app.codex.types_registry import RELATION_GROUPS

    stray = {r["id"]: r.get("group") for r in _relations()
             if r.get("group") not in RELATION_GROUPS}
    assert not stray, (
        f"these relations name a group the picker does not order: {stray}. "
        f"The heading would be sorted alphabetically among the real ones, or "
        f"not appear at all."
    )


def test_no_two_relations_in_one_group_read_the_same():
    # A dropdown with two identical lines is a dropdown where one of them can
    # never knowingly be chosen.
    seen: dict[tuple[str, str], str] = {}
    clashes: list[str] = []
    for rel in _relations():
        key = (rel.get("group", ""), rel["label"].lower())
        if key in seen:
            clashes.append(f"{seen[key]} and {rel['id']} both read "
                           f"'{rel['label']}' under {rel.get('group')}")
        seen[key] = rel["id"]
    assert not clashes, "; ".join(clashes)


def test_every_directional_relation_can_be_read_from_the_other_end():
    # Without an inverse the far end of the connection renders as "X (the other
    # way round)", which is honest and clumsy -- and it is what a writer sees on
    # the OTHER entry's page, where they did not make the choice.
    missing = [r["id"] for r in _relations()
               if not r.get("symmetric") and not r.get("inverse")]
    assert not missing, (
        f"these relations are directional and have no inverse label: {missing}"
    )


def test_no_relation_is_offered_between_kinds_that_do_not_exist():
    # A relation whose endpoints name a kind the registry does not ship can
    # never be offered by anything, which is the connection-to-nothing failure
    # the Weave exists to prevent, applied to its own vocabulary.
    kinds = {t["id"] for t in DEFAULT_TYPES}
    broken: list[str] = []
    for rel in _relations():
        if rel.get("universal"):
            continue        # runs between anything, including kinds invented later
        unknown = (set(rel["source_types"]) | set(rel["target_types"])) - kinds
        if unknown:
            broken.append(f"{rel['id']} -> {sorted(unknown)}")
    assert not broken, "; ".join(broken)


def test_relation_labels_read_as_english():
    # They are read straight off a menu. An id leaking through as a label
    # ("mentored_by") is the same failure as a stop kind with no Lexicon entry:
    # the app's own word showing where the writer's should be.
    #
    # `inverse` is checked differently ON PURPOSE. It is stored underscored and
    # rendered with `.replace("_", " ")`, so underscores there are the format
    # rather than a leak; what matters is that it becomes a readable phrase.
    for rel in _relations():
        label = rel["label"]
        assert "_" not in label, (
            f"{rel['id']} shows an id rather than words: {label!r}")
        assert label == label.strip(), f"{rel['id']} label has loose whitespace"
        assert "\u2014" not in label and "\u2013" not in label, (
            f"{rel['id']} uses an em or en dash")

        inverse = rel.get("inverse")
        if inverse:
            spoken = inverse.replace("_", " ")
            assert spoken == spoken.strip() and spoken, (
                f"{rel['id']} inverse does not render as a phrase: {spoken!r}")
            assert "\u2014" not in spoken and "\u2013" not in spoken, (
                f"{rel['id']} inverse uses an em or en dash")


def test_ids_are_unique():
    ids = [r["id"] for r in _relations()]
    assert len(ids) == len(set(ids)), "two relations share an id"


def test_the_vocabulary_is_worth_having():
    # Not a size contest. But the reported world (faction worships deity,
    # faction part of religion, religion worships deity) needs a real spread,
    # and a handful of relations would send every writer to "name your own".
    rels = _relations()
    assert len(rels) > 50
    # And it must not all be one heading, or the grouping buys nothing.
    assert len({r.get("group") for r in rels}) >= 6
