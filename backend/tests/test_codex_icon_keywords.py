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
