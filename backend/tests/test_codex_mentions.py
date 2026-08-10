# tests/test_codex_mentions.py -- finding the world inside the prose
# ===================================================================
# The rule under test, above all others:
#
#     AN AMBIGUOUS MENTION NEVER SILENTLY BINDS.
#
# It matters beyond tidiness. A bound mention is what pulls a Thread into the
# AI's context, so a wrong bind quietly feeds the model the wrong character's
# beliefs -- and the writer has no way to see it happen. Two Johns in a book
# is normal; guessing which one is not.

from app.codex.mentions import (
    AMBIGUOUS, BOUND, BY_NEARBY_ALIAS, BY_TIE, BY_UNIQUE, BY_WRITER,
    alias_display, build_alias_map, find_mentions, parse_markup, unbound_names,
)


def _thread(entity_id: str, name: str, aliases: list[str] | None = None) -> dict:
    return {"entity_id": entity_id, "name": name, "aliases": aliases or []}


ELARA = _thread("e-elara", "Elara Voss", ["Elara"])
GARRICK = _thread("e-garrick", "Garrick Vale", ["Garrick"])
JOHN_VALE = _thread("e-jv", "John Vale", ["John"])
JOHN_THORNE = _thread("e-jt", "John Thorne", ["John"])


def _world(*threads):
    return build_alias_map(list(threads)), alias_display(list(threads))


# ── The ordinary case ────────────────────────────────────────────────────────

def test_a_name_with_one_thread_binds():
    aliases, display = _world(ELARA)
    found = find_mentions("Elara crossed the bridge.", aliases, display=display)
    assert [(m.entity_id, m.status, m.resolved_by) for m in found] == [
        ("e-elara", BOUND, BY_UNIQUE)]


def test_a_possessive_is_the_character():
    # "Elara's hand" is Elara, not a different word.
    aliases, display = _world(ELARA)
    found = find_mentions("Elara's hand shook.", aliases, display=display)
    assert found[0].entity_id == "e-elara"


def test_a_full_name_wins_over_the_short_one():
    # Shortest-first alternation would match "John" inside "John Vale" and
    # destroy the very evidence that disambiguates it.
    aliases, display = _world(JOHN_VALE, JOHN_THORNE)
    found = find_mentions("John Vale spoke.", aliases, display=display)
    assert len(found) == 1
    assert found[0].alias == "John Vale"


def test_a_name_inside_a_longer_word_is_not_a_mention():
    aliases, display = _world(_thread("e-vale", "Vale"))
    assert find_mentions("The valediction ended.", aliases, display=display) == []


# ── Ambiguity, and the two things allowed to settle it ───────────────────────

def test_two_threads_of_one_name_do_not_bind():
    aliases, display = _world(JOHN_VALE, JOHN_THORNE)
    found = find_mentions("John waited alone.", aliases, display=display)
    assert found[0].status == AMBIGUOUS
    assert found[0].entity_id is None
    assert set(found[0].candidates) == {"e-jv", "e-jt"}


def test_a_fuller_name_in_the_same_scene_settles_it():
    aliases, display = _world(JOHN_VALE, JOHN_THORNE)
    found = find_mentions("John Vale entered. John sat down.", aliases,
                          display=display)
    bare = [m for m in found if m.alias == "John"][0]
    assert bare.entity_id == "e-jv"
    assert bare.resolved_by == BY_NEARBY_ALIAS


def test_two_fuller_names_in_the_scene_settle_nothing():
    # Both Johns are here. Narrowing to "candidates present" gives two, and
    # two is exactly as unresolved as none.
    aliases, display = _world(JOHN_VALE, JOHN_THORNE)
    found = find_mentions("John Vale and John Thorne argued. John left.",
                          aliases, display=display)
    bare = [m for m in found if m.alias == "John"][0]
    assert bare.status == AMBIGUOUS


def test_a_tie_to_someone_present_settles_it():
    aliases, display = _world(JOHN_VALE, JOHN_THORNE, ELARA)
    found = find_mentions("Elara turned. John did not answer.", aliases,
                          display=display, ties={"e-jv": {"e-elara"}})
    bare = [m for m in found if m.alias == "John"][0]
    assert bare.entity_id == "e-jv"
    assert bare.resolved_by == BY_TIE


def test_ties_on_both_candidates_settle_nothing():
    aliases, display = _world(JOHN_VALE, JOHN_THORNE, ELARA)
    found = find_mentions("Elara turned. John did not answer.", aliases,
                          display=display,
                          ties={"e-jv": {"e-elara"}, "e-jt": {"e-elara"}})
    assert [m for m in found if m.alias == "John"][0].status == AMBIGUOUS


def test_the_nearby_alias_rule_beats_the_tie_rule():
    # Being named in the scene is stronger evidence than being connected to
    # somebody who is, so it has to run first.
    aliases, display = _world(JOHN_VALE, JOHN_THORNE, ELARA)
    found = find_mentions("John Vale nodded. Elara waited. John spoke.",
                          aliases, display=display, ties={"e-jt": {"e-elara"}})
    bare = [m for m in found if m.alias == "John"][0]
    assert (bare.entity_id, bare.resolved_by) == ("e-jv", BY_NEARBY_ALIAS)


def test_the_writer_can_say_which_one():
    aliases, display = _world(JOHN_VALE, JOHN_THORNE)
    found = find_mentions("John waited.", aliases, display=display,
                          disambiguations={"john": "e-jt"})
    assert (found[0].entity_id, found[0].resolved_by) == ("e-jt", BY_WRITER)


def test_a_stale_disambiguation_is_ignored_not_obeyed():
    # The Thread they picked has been deleted. Binding to a dead id would be
    # worse than asking again.
    aliases, display = _world(JOHN_VALE, JOHN_THORNE)
    found = find_mentions("John waited.", aliases, display=display,
                          disambiguations={"john": "e-gone"})
    assert found[0].status == AMBIGUOUS


# ── A name in prose is written like a name ───────────────────────────────────

def test_a_lowercase_word_is_not_a_capitalised_name():
    # The alias "Will" would otherwise match every "he will go" in the book.
    aliases, display = _world(_thread("e-will", "Will"))
    assert find_mentions("He said he will go.", aliases, display=display) == []


def test_a_lowercase_alias_the_writer_registered_still_matches():
    aliases, display = _world(_thread("e-m", "Mara", ["mother"]))
    found = find_mentions("She went to see mother.", aliases, display=display)
    assert found[0].entity_id == "e-m"


def test_without_the_display_map_matching_stays_strict():
    # A caller that forgets it should get FEWER stops, never a flood of false
    # ones. Not knowing means being strict.
    aliases, _ = _world(_thread("e-m", "Mara", ["mother"]))
    assert find_mentions("She went to see mother.", aliases) == []


def test_a_title_alias_matches_when_it_is_capitalised():
    aliases, display = _world(_thread("e-k", "Aldric", ["the King"]))
    found = find_mentions("The King rose.", aliases, display=display)
    assert found[0].entity_id == "e-k"


# ── Words that are never a name ──────────────────────────────────────────────

def test_a_pronoun_registered_as_an_alias_is_refused():
    # The cost of "Her" binding is a stop on literally every paragraph.
    aliases = build_alias_map([_thread("e-x", "Someone", ["Her", "They"])])
    assert "her" not in aliases and "they" not in aliases
    assert "someone" not in aliases


# ── Explicit markup, outside the manuscript ──────────────────────────────────

def test_markup_binds_a_known_name():
    aliases, _ = _world(ELARA)
    found = parse_markup("See [[Elara Voss]] for this.", aliases)
    assert (found[0].entity_id, found[0].explicit) == ("e-elara", True)


def test_the_at_form_works_too():
    aliases, _ = _world(GARRICK)
    assert parse_markup("ask @Garrick", aliases)[0].entity_id == "e-garrick"


def test_markup_naming_nothing_still_comes_back():
    # "You wrote [[Ashfall]] and there is no Ashfall" is one of the more
    # useful things Weaving can say, so it must not be silently dropped.
    aliases, _ = _world(ELARA)
    found = parse_markup("The fall of [[Ashfall]].", aliases)
    assert (found[0].alias, found[0].status, found[0].candidates) == \
        ("Ashfall", AMBIGUOUS, ())


def test_markup_does_not_guess_between_two_johns():
    aliases, _ = _world(JOHN_VALE, JOHN_THORNE)
    assert parse_markup("[[John]] was there.", aliases)[0].status == AMBIGUOUS


# ── Names with nothing behind them ───────────────────────────────────────────

def test_a_repeated_unknown_name_is_reported():
    aliases, _ = _world(ELARA)
    found = unbound_names("Garrick rode north. Garrick did not return.", aliases)
    assert found == {"Garrick": 2}


def test_a_one_off_capital_is_not_reported():
    # Usually a sentence start the regex could not rule out.
    aliases, _ = _world(ELARA)
    assert unbound_names("Rain fell. Elara waited.", aliases) == {}


def test_a_name_that_has_a_thread_is_not_unspun():
    aliases, _ = _world(ELARA)
    assert unbound_names("Elara waited. Elara left.", aliases) == {}


def test_a_retired_phrase_is_never_raised_again():
    # "Not a connection" has to mean permanently, or the walkthrough asks the
    # same dead question every session and stops being worth opening.
    aliases, _ = _world(ELARA)
    found = unbound_names("The Ash Road ran east. The Ash Road was empty.",
                          aliases, ignore={"Ash Road"})
    assert "Ash Road" not in found
