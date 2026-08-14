"""
Who shares a scene with whom -- the free signal behind the walk's picker.

The reason this exists, in the writer's own words, after a Loose thread stop
offered every entry in the book as an equally likely answer:

    "3 profiles and 1 location appear in a list. the actual profile for
     Alexandra Langford which does exist is not listed as an option."

The list was not wrong so much as useless. What is wanted is the SHORT list --
the people the prose already keeps putting in the room with her -- and the
prose contains that list for free.

The tests below hold the two decisions that make it trustworthy: the unit is
the scene rather than the chapter, and one shared scene is not evidence.
"""

from app.codex.together import MIN_SHARED_SCENES, shared_scenes


def _thread(entity_id: str, name: str, **kw) -> dict:
    return {"entity_id": entity_id, "name": name, "type": "character",
            "aliases": kw.pop("aliases", []), **kw}


ELARA = _thread("e-1", "Elara")
GARRICK = _thread("e-2", "Garrick")
MIRA = _thread("e-3", "Mira")
WORLD = [ELARA, GARRICK, MIRA]


def _pair(results, a, b):
    want = tuple(sorted([a, b]))
    for t in results:
        if (t.a, t.b) == want:
            return t
    return None


# ── The unit is the scene ────────────────────────────────────────────────────

def test_two_names_in_one_scene_are_together():
    prose = "Elara waited by the gate. Garrick did not come."
    result = shared_scenes([("c-1", prose)], WORLD)
    assert _pair(result, "e-1", "e-2").scenes == 1


def test_a_chapter_that_CUTS_between_scenes_does_not_pair_them():
    # THE REASON THE SCENE IS THE UNIT. This chapter cuts from Elara's rooftop
    # to Garrick's cell. They are in the same chapter and nowhere near each
    # other. Counting by chapter would assert a connection the story denies.
    prose = ("Elara watched the rain from the roof.\n\n"
             "---\n\n"
             "Garrick counted the bars of his cell.\n")
    result = shared_scenes([("c-1", prose)], WORLD)
    assert _pair(result, "e-1", "e-2") is None


def test_the_same_pair_across_scenes_adds_up():
    prose = ("Elara found Garrick at the well.\n\n"
             "---\n\n"
             "Later, Elara and Garrick argued about it.\n")
    result = shared_scenes([("c-1", prose)], WORLD)
    assert _pair(result, "e-1", "e-2").scenes == 2


def test_it_adds_up_across_chapters_too():
    result = shared_scenes([("c-1", "Elara found Garrick."),
                            ("c-2", "Garrick avoided Elara."),
                            ("c-3", "Elara asked Garrick why.")], WORLD)
    assert _pair(result, "e-1", "e-2").scenes == 3


def test_every_pair_in_a_crowded_scene_is_counted():
    # Three people in a room is three pairs, not one group. The walk asks about
    # one connection at a time, so the data has to be shaped that way.
    result = shared_scenes([("c-1", "Elara, Garrick and Mira met at dusk.")],
                           WORLD)
    assert len(result) == 3


def test_a_name_alone_pairs_with_nobody():
    result = shared_scenes([("c-1", "Elara walked alone.")], WORLD)
    assert result == []


# ── What it refuses to conclude ──────────────────────────────────────────────

def test_an_ambiguous_name_is_not_counted_as_present():
    # Two Johns, and a scene that says only "John". Neither can be placed in
    # the room, so neither is paired with anyone. A wrong pairing here would
    # reach the writer as a confident suggestion about a relationship that
    # does not exist.
    johns = [_thread("e-a", "John Reed", aliases=["John"]),
             _thread("e-b", "John Vale", aliases=["John"]),
             ELARA]
    result = shared_scenes([("c-1", "John spoke to Elara for a long time.")],
                           johns)
    assert result == []


def test_it_does_not_say_WHAT_the_connection_is():
    # Sharing scenes is evidence of a relationship, not of its kind -- a knight
    # and the dragon he is hunting share a great many. Naming it stays the
    # writer's call, so there is nowhere here to put a guess.
    result = shared_scenes([("c-1", "Elara struck at Garrick.")], WORLD)
    assert not hasattr(result[0], "relation")


def test_an_empty_world_finds_nothing_rather_than_failing():
    assert shared_scenes([("c-1", "Rain fell on the empty square.")], []) == []


def test_no_manuscript_finds_nothing():
    assert shared_scenes([], WORLD) == []


# ── Evidence, because a claim without its source asks for faith ─────────────

def test_it_records_where_they_first_appeared_together():
    result = shared_scenes([("c-1", "Rain fell."),
                            ("c-2", "Elara found Garrick at the well."),
                            ("c-3", "Elara and Garrick left.")], WORLD)
    assert _pair(result, "e-1", "e-2").first_chapter == "c-2"


def test_it_quotes_the_scene_that_put_them_together():
    result = shared_scenes([("c-1", "Elara found Garrick at the well.")],
                           WORLD)
    assert "Garrick at the well" in _pair(result, "e-1", "e-2").quote


def test_a_long_scene_is_quoted_short_enough_to_read():
    prose = "Elara found Garrick. " + ("The rain went on and on. " * 40)
    quote = shared_scenes([("c-1", prose)], WORLD)[0].quote
    assert len(quote) <= 170
    assert quote.endswith("...")


# ── Order, so the strongest answer is the nearest one ───────────────────────

def test_the_pair_that_shares_most_scenes_comes_first():
    result = shared_scenes([("c-1", "Elara and Mira spoke."),
                            ("c-2", "Elara found Garrick."),
                            ("c-3", "Elara found Garrick again."),
                            ("c-4", "Garrick waited for Elara.")], WORLD)
    assert (result[0].a, result[0].b) == ("e-1", "e-2")


def test_the_order_never_wobbles_between_runs():
    # Spatial memory is most of the value of a ranked list. One that reshuffles
    # itself between identical runs teaches the writer to distrust it.
    chapters = [("c-1", "Elara, Garrick and Mira met.")]
    first = [(t.a, t.b) for t in shared_scenes(chapters, WORLD)]
    for _ in range(3):
        assert [(t.a, t.b) for t in shared_scenes(chapters, WORLD)] == first


# ── The two ends, addressable from either side ──────────────────────────────

def test_a_pairing_can_be_read_from_either_end():
    # The picker asks "who is connected to Elara?" and the same row has to
    # answer "who is connected to Garrick?" without being stored twice.
    t = shared_scenes([("c-1", "Elara found Garrick.")], WORLD)[0]
    assert t.other("e-1") == "e-2"
    assert t.other("e-2") == "e-1"
    assert t.touches("e-1") and t.touches("e-2")
    assert not t.touches("e-3")


def test_the_ends_are_stored_in_one_order_only():
    # Stored one way round, like Ties. Two rows for one pairing is two things
    # that can disagree.
    forward = shared_scenes([("c-1", "Elara found Garrick.")], WORLD)
    backward = shared_scenes([("c-1", "Garrick found Elara.")], WORLD)
    assert (forward[0].a, forward[0].b) == (backward[0].a, backward[0].b)


# ── The floor ────────────────────────────────────────────────────────────────

def test_the_floor_is_stated_rather_than_hidden_in_a_condition():
    # Whatever raises Untied stops reads this. One shared scene is two
    # strangers passing on a street; the Unspun pass already taught what a
    # rule with no floor does to a real manuscript.
    assert MIN_SHARED_SCENES == 2


# ── The scene splitter's two honest answers ─────────────────────────────────
#
# split_into_scenes() drops a short block before the first HR, on the grounds
# that it is a chapter title and an epigraph rather than a scene. That is right
# for the thing it was written for -- summarising -- and wrong here, where
# dropping prose means two characters who shared a scene quietly did not.
#
# So the caller says which answer it wants, and these hold both.

def test_the_summary_path_still_drops_a_cosmetic_preamble():
    from app.utils.scene_parser import split_into_scenes

    chapter = "# Chapter One\n\n*All rivers run.*\n\n---\n\nRain fell.\n"
    assert split_into_scenes(chapter) == ["Rain fell."]


def test_the_weave_keeps_it_instead():
    from app.utils.scene_parser import split_into_scenes

    chapter = "# Chapter One\n\n*All rivers run.*\n\n---\n\nRain fell.\n"
    kept = split_into_scenes(chapter, drop_preamble=False)
    assert len(kept) == 2
    assert "All rivers run" in kept[0]


def test_a_short_opening_scene_still_counts_as_shared():
    # The failure this flag exists to prevent: a two-line opening scene naming
    # both of them, silently discarded as an epigraph.
    prose = ("Elara found Garrick.\n\n"
             "---\n\n"
             "Later, Elara and Garrick argued about it.\n")
    assert _pair(shared_scenes([("c-1", prose)], WORLD), "e-1", "e-2").scenes == 2
