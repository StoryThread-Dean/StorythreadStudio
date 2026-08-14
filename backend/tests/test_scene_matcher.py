# tests/test_scene_matcher.py -- scene identity across an edit
# =============================================================
# The Weave anchors facts to a point in the story: "as of chapter 7, scene
# 3, she believes her father died in the raid." That only works if scene 3
# is still scene 3 after the writer edits chapter 7.
#
# Positional identity ("scene 3 is the third block") breaks on the first
# insertion. Hash identity breaks on the first typo fix. So the matcher runs
# three stages -- unique-exact (survives reorder), ordered-exact (resolves
# duplicates), then fuzzy (survives edits).
#
# THE GOVERNING RULE, which most of these tests are really about:
#
#     A false split is safer than a false identity.
#
# Getting it wrong by minting a new ID costs the writer one anchor to
# re-point, and they can see it. Getting it wrong by REUSING an ID silently
# attaches a character's beliefs to the wrong scene, and nobody would ever
# think to check. So every ambiguous case below must decline to match.

from app.utils.stable_ids import (
    content_hash,
    fuzzy_rematch,
    lcs_match,
    match_blocks,
    similarity,
    unique_exact_match,
)


def _check_no_double_claim(matches: dict[int, int]) -> None:
    """No old block may be claimed by two new ones. The invariant that makes
    tombstoning safe -- if two scenes both claimed old scene 3, one of them
    would inherit facts that are not about it."""
    claimed = list(matches.values())
    assert len(claimed) == len(set(claimed)), f"an old block was claimed twice: {matches}"


# ── The easy half: text that did not change ──────────────────────────────────

def test_an_untouched_list_maps_to_itself():
    scenes = ["The raid came at dawn.", "She buried him at noon.", "Winter followed."]
    assert match_blocks(scenes, scenes, fuzzy=True) == {0: 0, 1: 1, 2: 2}


def test_inserting_a_scene_leaves_the_later_ones_alone():
    old = ["Scene one text.", "Scene two text.", "Scene three text."]
    new = ["Scene one text.", "A NEW SCENE entirely.", "Scene two text.", "Scene three text."]
    matches = match_blocks(old, new, fuzzy=True)
    assert matches[0] == 0
    assert matches[2] == 1      # old scene two, now third
    assert matches[3] == 2
    assert 1 not in matches      # the insert is genuinely new
    _check_no_double_claim(matches)


def test_a_pure_reorder_keeps_every_identity():
    # This is what unique-exact matching exists for. LCS alone is
    # order-preserving, so it would lose every pairing crossing the move.
    old = ["Alpha scene.", "Bravo scene.", "Charlie scene.", "Delta scene."]
    new = ["Delta scene.", "Alpha scene.", "Bravo scene.", "Charlie scene."]
    assert match_blocks(old, new, fuzzy=True) == {0: 3, 1: 0, 2: 1, 3: 2}


def test_deleting_a_scene_leaves_it_unclaimed_so_it_can_be_tombstoned():
    old = ["Keep one.", "DELETE ME.", "Keep two."]
    new = ["Keep one.", "Keep two."]
    matches = match_blocks(old, new, fuzzy=True)
    assert matches == {0: 0, 1: 2}
    assert 1 not in matches.values()   # the caller tombstones old index 1


def test_identical_duplicate_scenes_resolve_in_reading_order():
    # A repeated refrain or a deliberately mirrored opening. Ambiguous by
    # hash, so reading order decides -- and neither may claim the other's.
    repeated = "The bell rang three times."
    old = [repeated, "Something else.", repeated]
    new = [repeated, "Something else.", repeated]
    matches = match_blocks(old, new, fuzzy=True)
    assert matches == {0: 0, 1: 1, 2: 2}
    _check_no_double_claim(matches)


# ── The hard half: text the writer edited ────────────────────────────────────

def test_a_punctuation_only_edit_keeps_the_scene():
    old = ["He said, 'Hello.' She did not answer him at all that evening."]
    new = ['He said, "Hello!" She did not answer him at all that evening.']
    assert match_blocks(old, new, fuzzy=True) == {0: 0}


def test_editing_one_sentence_keeps_the_scene():
    old = ["She knelt beside the well. The water was black. Her hands shook badly."]
    new = ["She knelt beside the well. The water was dark. Her hands shook badly."]
    assert match_blocks(old, new, fuzzy=True) == {0: 0}


def test_inserting_a_paragraph_inside_a_scene_keeps_it():
    body = ("She knelt beside the well and looked down into it. "
            "The water was black and gave back nothing at all. "
            "Somewhere behind her a door closed, and she did not turn around. ")
    old = [body]
    new = [body + "A bird called once from the roof."]
    assert match_blocks(old, new, fuzzy=True) == {0: 0}


def test_a_short_scene_that_doubles_in_length_gets_a_new_id():
    # Honest, documented behaviour rather than a bug: past a point the block
    # is not "the same scene, edited" in any meaningful sense, and the rule
    # says decline rather than guess.
    old = ["She wept."]
    new = ["She wept. Then she rose, washed her face, saddled the grey mare, "
           "and rode north through the pass without telling anyone."]
    matches = match_blocks(old, new, fuzzy=True)
    assert matches == {}


def test_splitting_a_scene_in_two_never_lets_both_halves_claim_it():
    original = ("She knelt beside the well and looked down into the water. "
                "Later, in the hall, her brother would not meet her eyes.")
    old = [original]
    new = ["She knelt beside the well and looked down into the water.",
           "Later, in the hall, her brother would not meet her eyes."]
    matches = match_blocks(old, new, fuzzy=True)
    _check_no_double_claim(matches)
    # At most one half may inherit the original's identity; the other is new.
    assert len(matches) <= 1


def test_merging_two_scenes_claims_at_most_one_of_them():
    old = ["She knelt beside the well and looked down into the water.",
           "Later, in the hall, her brother would not meet her eyes."]
    new = ["She knelt beside the well and looked down into the water. "
           "Later, in the hall, her brother would not meet her eyes."]
    matches = match_blocks(old, new, fuzzy=True)
    _check_no_double_claim(matches)
    assert len(matches) <= 1


def test_two_near_identical_scenes_are_left_alone_rather_than_guessed():
    # The margin rule. Both candidates score almost the same, so picking
    # either is a coin toss -- and a coin toss reads as correct until the
    # day it silently is not.
    a = "The ritual began at dusk. The first bell rang. They knelt."
    b = "The ritual began at dawn. The first bell rang. They knelt."
    old = [a, b]
    new = ["The ritual began. The first bell rang. They knelt."]
    matches = match_blocks(old, new, fuzzy=True)
    assert matches == {}


def test_text_that_moved_far_and_changed_is_not_reclaimed():
    # The neighbourhood rule: similar text a long way from where it was is
    # likelier to be different material that happens to read alike.
    moved = "She knelt beside the well and looked into the black water below."
    edited = "She knelt beside the well and looked into the dark water below."
    old = [moved, "b", "c", "d", "e", "f"]
    new = ["b", "c", "d", "e", "f", edited]
    matches = match_blocks(old, new, fuzzy=True)
    assert 5 not in matches


# ── The audiobook must not get any of this ───────────────────────────────────

def test_without_fuzzy_an_edited_block_gets_a_new_identity():
    # The audiobook's requirement, and the reason fuzzy is opt-in: a changed
    # segment MUST lose its ID so its recorded audio is regenerated. Reusing
    # it would leave the old recording attached to new words.
    old = ["She knelt beside the well. The water was black."]
    new = ["She knelt beside the well. The water was dark."]
    assert match_blocks(old, new, fuzzy=False) == {}


def test_without_fuzzy_unchanged_blocks_still_keep_their_identity():
    old = ["Untouched one.", "Untouched two."]
    assert match_blocks(old, list(old), fuzzy=False) == {0: 0, 1: 1}


# ── The pieces, checked directly ─────────────────────────────────────────────

def test_content_hash_is_stable_and_sensitive():
    assert content_hash("abc") == content_hash("abc")
    assert content_hash("abc") != content_hash("abd")
    # Raw text, deliberately: markup changes the audio, so it changes identity.
    assert content_hash("a [say:bee]b[/say]") != content_hash("a b")


def test_lcs_match_is_order_preserving():
    a, b, c = content_hash("a"), content_hash("b"), content_hash("c")
    assert lcs_match([a, b, c], [a, c]) == {0: 0, 1: 2}


def test_unique_exact_match_ignores_ambiguous_hashes():
    dup, solo = content_hash("dup"), content_hash("solo")
    # "dup" appears twice on each side, so it is not unambiguous -- left for LCS.
    matches = unique_exact_match([dup, solo, dup], [dup, dup, solo])
    assert matches == {2: 1}


def test_similarity_ignores_case_punctuation_and_wrapping():
    assert similarity("He said, 'Hello.'", 'he said "hello"') > 0.95
    assert similarity("Total nonsense here", "Entirely different text") < 0.6


def test_fuzzy_rematch_never_steals_an_already_matched_block():
    old = ["The same words here.", "The same words here."]
    new = ["The same words here.", "The same words nearly here."]
    already = {0: 0}
    extra = fuzzy_rematch(old, new, already)
    assert 0 not in extra              # already decided
    assert extra.get(1) != 0           # cannot claim what stage 0/1 took
