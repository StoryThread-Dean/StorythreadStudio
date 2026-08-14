# utils/stable_ids.py -- keeping identity across an edit
# =======================================================
# Two features need the same awkward thing: a list of text blocks that keeps
# its IDs when the writer edits the document around them.
#
#   - The audiobook segmenter. Insert a paragraph in chapter 3 and only the
#     segments that actually changed should re-synthesise; everything else
#     keeps its recorded audio.
#   - The Weave's scene anchors. A fact recorded "as of chapter 7, scene 3"
#     must still point at that scene after the writer rewrites a sentence in
#     scene 1 and adds a scene break in scene 2.
#
# The naive approach -- "scene 3 is the third block" -- breaks the moment
# anything is inserted, because every later block silently becomes a
# different scene and every anchor pointing at them now lies.
#
# The technique here is the one the audiobook shipped with, extracted so
# there is one implementation rather than two: hash each block's text, then
# match the old list against the new one by those hashes. What is NEW here
# is the third stage, and the reason for it matters:
#
#   Hashing alone cannot survive an EDIT. Change one word and the hash
#   changes completely -- that is what a hash is for. So exact matching
#   answers "which blocks are untouched?", and nothing more. The audiobook
#   wants exactly that (a changed segment MUST get a new identity so it
#   re-synthesises), but the Weave does not: a scene the writer tweaked one
#   sentence of is still the same scene, and an anchor into it should hold.
#
# Hence the split below. content_hash + lcs_match are shared. fuzzy_rematch
# is the Weave's alone; the audiobook must never use it.

import difflib
import hashlib
import re

# How similar two blocks must be before we are willing to call them the same
# logical block after an edit. Deliberately conservative -- see the rule at
# the bottom of this comment block.
FUZZY_THRESHOLD = 0.80

# How much better the best candidate must be than the runner-up before we
# trust it. Two near-identical scenes (a repeated ritual, a refrain, a
# deliberately mirrored opening) would otherwise be a coin toss.
FUZZY_MARGIN = 0.05

# How far from its old position a block may have moved and still be
# considered "the same block, edited". Beyond this it is likelier to be
# different material that happens to read similarly.
FUZZY_NEIGHBOURHOOD = 3

_WHITESPACE_RE = re.compile(r"\s+")
_PUNCTUATION_RE = re.compile(r"[^\w\s]")


def content_hash(text: str) -> str:
    """
    The identity of a block's text.

    Hashed over the RAW text -- including any inline markup. That is
    deliberate for the audiobook, where editing a [say:...] changes the
    audio and so must change the identity.
    """
    return "sha256-" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def lcs_match(old_hashes: list[str], new_hashes: list[str]) -> dict[int, int]:
    """
    Longest common subsequence over content hashes. Returns
    {new_index: old_index} for every matched pair -- order preserving, so
    a hash that appears twice resolves in reading order.
    """
    n, m = len(old_hashes), len(new_hashes)
    # Classic DP table; ~500x500 for a full novel, comfortably cheap.
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            if old_hashes[i] == new_hashes[j]:
                dp[i][j] = dp[i + 1][j + 1] + 1
            else:
                dp[i][j] = max(dp[i + 1][j], dp[i][j + 1])
    matches: dict[int, int] = {}
    i = j = 0
    while i < n and j < m:
        if old_hashes[i] == new_hashes[j]:
            matches[j] = i
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return matches


def unique_exact_match(old_hashes: list[str], new_hashes: list[str]) -> dict[int, int]:
    """
    Pair up blocks whose hash appears exactly ONCE on each side.

    This is what makes a REORDER survive. LCS is order-preserving by
    definition, so moving scene 5 to the front costs it every pairing that
    crosses the move -- those blocks are untouched, but LCS cannot say so
    because it may only match in sequence.

    A hash occurring once in the old list and once in the new one is
    unambiguous wherever it sits: there is exactly one block it can be.
    Hashes appearing more than once are left for LCS, which resolves
    duplicates in reading order.
    """
    old_counts: dict[str, int] = {}
    new_counts: dict[str, int] = {}
    for h in old_hashes:
        old_counts[h] = old_counts.get(h, 0) + 1
    for h in new_hashes:
        new_counts[h] = new_counts.get(h, 0) + 1

    old_index = {h: i for i, h in enumerate(old_hashes)}
    matches: dict[int, int] = {}
    for new_i, h in enumerate(new_hashes):
        if old_counts.get(h) == 1 and new_counts.get(h) == 1:
            matches[new_i] = old_index[h]
    return matches


def _normalize(text: str) -> str:
    """Lowercase, collapse whitespace, drop punctuation.

    Comparing normalized text means a retyped quotation mark or a rewrapped
    paragraph does not read as a different scene.
    """
    text = _PUNCTUATION_RE.sub(" ", text.lower())
    return _WHITESPACE_RE.sub(" ", text).strip()


def similarity(a: str, b: str) -> float:
    """How alike two blocks are, 0.0 to 1.0, ignoring formatting noise."""
    return difflib.SequenceMatcher(None, _normalize(a), _normalize(b)).ratio()


def fuzzy_rematch(
    old_texts: list[str],
    new_texts: list[str],
    already_matched: dict[int, int],
    threshold: float = FUZZY_THRESHOLD,
    margin: float = FUZZY_MARGIN,
    neighbourhood: int = FUZZY_NEIGHBOURHOOD,
) -> dict[int, int]:
    """
    Pair up EDITED blocks that exact matching could not.

    Only for the Weave. The audiobook must not use this: there, a changed
    segment is meant to get a new identity so its audio regenerates.

    Returns additional {new_index: old_index} pairs, never overwriting one
    already made. A pair is only accepted when all three hold:

      1. similarity >= threshold      -- it really is mostly the same text
      2. it beats the runner-up by margin -- no coin toss between two
         near-identical blocks (a refrain, a mirrored opening, a repeated
         ritual scene)
      3. it sits within `neighbourhood` of where it was -- text that moved
         halfway across the book and also changed is likelier to be
         different material that happens to read alike

    THE GOVERNING RULE: a false split is safer than a false identity. If
    this cannot confidently say two blocks are the same, it says nothing,
    the block gets a fresh ID, and the old one is tombstoned. The cost of
    being wrong that way is one anchor the writer re-points. The cost of a
    wrong REUSE is a character's beliefs silently attached to the wrong
    scene, which nobody would ever think to check.
    """
    taken_old = set(already_matched.values())
    matches: dict[int, int] = {}

    for new_i, new_text in enumerate(new_texts):
        if new_i in already_matched:
            continue

        scored: list[tuple[float, int]] = []
        for old_i, old_text in enumerate(old_texts):
            if old_i in taken_old:
                continue
            if abs(old_i - new_i) > neighbourhood:
                continue
            scored.append((similarity(old_text, new_text), old_i))

        if not scored:
            continue
        scored.sort(key=lambda pair: (-pair[0], pair[1]))
        best_score, best_old = scored[0]
        if best_score < threshold:
            continue
        # Rule 2: an ambiguous best is no answer at all.
        if len(scored) > 1 and (best_score - scored[1][0]) < margin:
            continue

        matches[new_i] = best_old
        taken_old.add(best_old)

    return matches


def match_blocks(
    old_texts: list[str],
    new_texts: list[str],
    fuzzy: bool = False,
) -> dict[int, int]:
    """
    The whole ladder: which new block is which old block?

    Returns {new_index: old_index}. Anything absent from the result is a
    genuinely new block and should mint a fresh ID; any old index not among
    the values has gone and should be tombstoned rather than deleted, so an
    anchor pointing into it degrades instead of dangling.

      Stage 0  unique exact   -- survives REORDER
      Stage 1  ordered exact  -- resolves duplicate text in reading order
      Stage 2  fuzzy          -- survives EDITS (opt-in; Weave only)

    `fuzzy=False` is the audiobook's behaviour and the default, so a caller
    that has not thought about it gets the conservative answer.
    """
    old_hashes = [content_hash(t) for t in old_texts]
    new_hashes = [content_hash(t) for t in new_texts]

    matches = unique_exact_match(old_hashes, new_hashes)

    # Feed LCS only what is still unclaimed, so a pairing found in stage 0
    # cannot be contradicted here.
    taken_old = set(matches.values())
    remaining_old = [i for i in range(len(old_hashes)) if i not in taken_old]
    remaining_new = [i for i in range(len(new_hashes)) if i not in matches]
    lcs = lcs_match(
        [old_hashes[i] for i in remaining_old],
        [new_hashes[i] for i in remaining_new],
    )
    for local_new, local_old in lcs.items():
        matches[remaining_new[local_new]] = remaining_old[local_old]

    if fuzzy:
        matches.update(fuzzy_rematch(old_texts, new_texts, matches))

    return matches
