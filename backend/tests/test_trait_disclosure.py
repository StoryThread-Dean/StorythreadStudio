# tests/test_trait_disclosure.py -- weight and secrecy are different questions
# ============================================================================
# `importance: hidden` was a rung on the importance ladder, so a trait could be
# secret OR important, never both. The writer's worked example is what broke it:
#
#   A villain avoids hospitals because he watched his parents die in one. He
#   will not enter one and will not say the word (CORE -- it decides where the
#   plot can go). He freezes when he sees people holding hands, because they
#   died holding hands (PRESENT). If asked, he says only that they were taken
#   from him early (BACKGROUND).
#
# Three traits, all secret, at three weights. As one level they collapsed into
# each other AND sorted lowest in every prompt, so the trait driving the most
# scenes arrived as the weakest thing on the page.
#
# So: `importance` is weight, four levels. `subtext` is disclosure. This file
# pins the two apart in both file formats, and pins the migration of files
# written before the split.

import uuid

from app.codex.threads import parse_thread, render_thread
from app.routers.profiles import (
    VALID_IMPORTANCE, ProfileSection, TraitBlock, _generate_profile_markdown,
    _parse_profile_markdown, _parse_trait_blocks,
)

VILLAIN = """- trait: avoids hospitals
  description: "Will not enter one, will not say the word."
  importance: core
  subtext: true

- trait: freezes at held hands
  description: "Loses several seconds, looks away."
  importance: present
  subtext: true

- trait: tall, grey at the temples
  description: "Reads as older than he is."
  importance: background
"""


def test_importance_is_only_about_weight():
    # Four levels. "hidden" is not one of them any more, because it was never
    # answering the same question as the other four.
    assert VALID_IMPORTANCE == {"core", "present", "background", "contextual"}


def test_a_secret_can_carry_any_weight():
    blocks = _parse_trait_blocks(VILLAIN)
    by_trait = {b.trait: b for b in blocks}
    assert (by_trait["avoids hospitals"].importance,
            by_trait["avoids hospitals"].subtext) == ("core", True)
    assert (by_trait["freezes at held hands"].importance,
            by_trait["freezes at held hands"].subtext) == ("present", True)
    # And an ordinary trait is untouched by any of it.
    assert by_trait["tall, grey at the temples"].subtext is False


def test_a_secret_survives_a_profile_round_trip():
    profile = _parse_profile_markdown(
        "---\ntype: character\nprofile_id: p-1\nname: The Mayor\n"
        "created_at: x\nupdated_at: y\n---\n\n"
        "# Physical Traits\n" + VILLAIN + "\n"
        "# Overview\nHe runs the city.\n",
        "mayor.md", "character")
    written = _generate_profile_markdown(profile, "character")
    again = _parse_profile_markdown(written, "mayor.md", "character")

    secrets = {b.trait: b.subtext
               for b in again.sections["physical_traits"].trait_blocks}
    assert secrets["avoids hospitals"] is True
    assert secrets["tall, grey at the temples"] is False


def test_an_ordinary_trait_writes_no_extra_line():
    # Only written when true, so a project with no secrets produces no diff the
    # first time it is saved after the change.
    profile = _parse_profile_markdown(
        "---\ntype: character\nprofile_id: p-1\nname: X\n"
        "created_at: x\nupdated_at: y\n---\n\n"
        "# Physical Traits\n- trait: tall\n  description: \"Very.\"\n"
        "  importance: core\n", "x.md", "character")
    assert "subtext" not in _generate_profile_markdown(profile, "character")


def test_a_secret_written_by_hand_is_read():
    # These are the writer's files. Typing the line in a text editor has to work.
    blocks = _parse_trait_blocks(
        '- trait: a secret\n  description: "Never said."\n'
        '  importance: core\n  subtext: true\n')
    assert blocks[0].subtext is True


# ── Files written before the split ───────────────────────────────────────────

def test_a_legacy_hidden_trait_keeps_its_secrecy():
    # The important half. If the flag were lost, the trait becomes ordinary text
    # and the model may write it out loud -- and nothing anywhere would report it.
    blocks = _parse_trait_blocks(
        '- trait: the real reason\n  description: "His parents."\n'
        '  importance: hidden\n')
    assert blocks[0].subtext is True


def test_a_legacy_hidden_trait_gets_a_weight_rather_than_a_guess_at_zero():
    # `hidden` recorded no weight, so one has to be chosen. `present` rather
    # than `core` because guessing high would flood every prompt -- and these
    # are LISTED for the writer to weigh, not silently decided.
    blocks = _parse_trait_blocks(
        '- trait: the real reason\n  description: "His parents."\n'
        '  importance: hidden\n')
    assert blocks[0].importance == "present"


def test_an_even_older_foreshadowing_trait_is_secret_too():
    # The pre-importance vocabulary. "foreshadowing" meant secret by intent, so
    # reading it as merely unimportant would quietly expose it.
    blocks = _parse_trait_blocks(
        '- trait: the locket\n  description: "Hers."\n'
        '  influence: foreshadowing\n')
    assert blocks[0].subtext is True


# ── The Weave's own format ───────────────────────────────────────────────────

THREAD = """---
type: character
entity_id: e-1
name: The Mayor
---

# Physical Traits
""" + VILLAIN


def test_a_thread_round_trips_a_secret():
    once = parse_thread(THREAD)
    twice = parse_thread(render_thread(once))
    assert twice["sections"]["physical_traits"]["trait_blocks"] == \
        once["sections"]["physical_traits"]["trait_blocks"]
    assert twice["sections"]["physical_traits"]["trait_blocks"][0]["subtext"] is True


def test_a_secret_is_sent_rather_than_withheld():
    # THE CORRECTION THAT MATTERS MOST, and it undoes an earlier fix of mine.
    # The Weave's conversion set `ai_scope: on-request` on every hidden trait,
    # which withholds it from the automatic brief. That stops the model naming
    # the secret by stopping the model KNOWING it -- so the villain arrives with
    # no reason to avoid hospitals and behaves like somebody else. Disclosure is
    # the never-name instruction; ai_scope is availability; they are not the same
    # tool.
    thread = parse_thread(
        "---\ntype: character\nentity_id: e-1\nname: X\n---\n\n"
        "# Physical Traits\n- trait: the real reason\n"
        '  description: "His parents."\n  importance: hidden\n'
        "  ai_scope: on-request\n")
    block = thread["sections"]["physical_traits"]["trait_blocks"][0]
    assert block["subtext"] is True
    assert not block["ai_scope"]


def test_a_file_can_still_be_read_exactly_as_written():
    # The before-and-after comparison after a conversion needs the file as
    # WRITTEN, or the one content change it makes is invisible in the screen
    # built to show it.
    thread = parse_thread(
        "---\ntype: character\nentity_id: e-1\nname: X\n---\n\n"
        "# Physical Traits\n- trait: t\n  description: \"d\"\n"
        "  importance: hidden\n", heal_legacy=False)
    block = thread["sections"]["physical_traits"]["trait_blocks"][0]
    assert block["importance"] == "hidden"
    assert not block["subtext"]


def test_the_two_formats_agree_about_the_field():
    # profiles/ and codex/ are the same trait written two ways. A field one
    # keeps and the other drops is a field lost on the first conversion.
    block = TraitBlock(id=str(uuid.uuid4()), trait="a secret",
                       description="Never said.", importance="core",
                       subtext=True)
    from app.routers.profiles import Profile

    profile = Profile(
        profile_id="p-1", type="character", name="X", filename="x.md",
        created_at="a", updated_at="b",
        sections={"physical_traits": ProfileSection(trait_blocks=[block])})
    written = _generate_profile_markdown(profile, "character")

    thread = parse_thread(written)
    read_back = thread["sections"]["physical_traits"]["trait_blocks"][0]
    assert read_back["subtext"] is True
    assert read_back["importance"] == "core"
