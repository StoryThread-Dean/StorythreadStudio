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
    NameEvidence, alias_display, build_alias_map, find_mentions,
    group_by_containment, parse_markup, unbound_names,
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
    # Note both mentions sit MID-SENTENCE. That is the whole test: the
    # capital was the writer's choice, not the full stop's.
    aliases, _ = _world(ELARA)
    found = unbound_names(
        "She waited for Garrick. By dawn Garrick had not come.", aliases)
    assert found == {"Garrick": 2}


def test_a_sentence_start_is_not_a_name():
    # THE case this rule exists for. On a real manuscript the naive version
    # produced All, Any, Because, Before, By, Can, Each, Every, For and
    # dozens more -- swamping the handful of real names among them.
    aliases, _ = _world(ELARA)
    text = ("All of them knew. All of them waited. Because it was late. "
            "Because nobody spoke. Every door was shut. Every window too.")
    assert unbound_names(text, aliases) == {}


def test_a_line_of_dialogue_is_not_a_name():
    # "Enough" and "Bugger" open speech, which capitalises them for free.
    aliases, _ = _world(ELARA)
    text = ('He said, "Enough." She said, "Enough." '
            '"Bugger," he muttered. "Bugger it all."')
    assert unbound_names(text, aliases) == {}


def test_a_closing_quote_does_not_hide_a_real_name():
    # `He said, "Enough!"` and `"Hello," Alexandra said` both have a comma
    # before the quote, and only the first one forces its capital. Deciding
    # by the character before the quote gets this backwards; parity gets it
    # right.
    aliases, _ = _world(ELARA)
    text = '"Hello," Alexandra said. "Wait," Alexandra called.'
    assert unbound_names(text, aliases) == {"Alexandra": 2}


def test_a_possessive_is_not_a_separate_person():
    # Reporting "Alexandra's" alongside "Alexandra" asks the writer to create
    # the same character twice.
    aliases, _ = _world(ELARA)
    found = unbound_names(
        "She took Alexandra's hand. Later Alexandra spoke.", aliases)
    assert found == {"Alexandra": 2}


def test_an_article_is_dropped_rather_than_the_whole_name():
    aliases, _ = _world(ELARA)
    found = unbound_names(
        "They rode the Ash Road east. Nobody walks the Ash Road now.", aliases)
    assert found == {"Ash Road": 2}


def test_a_one_off_capital_is_not_reported():
    # Usually a sentence start the regex could not rule out.
    aliases, _ = _world(ELARA)
    assert unbound_names("Rain fell. Elara waited.", aliases) == {}


def test_a_common_word_is_never_offered_even_mid_sentence():
    # "Will" and "May" are real given names, so they are suppressed as
    # SUGGESTIONS only -- a writer can still create a character called Will
    # by hand, and every mention binds normally after that.
    aliases, _ = _world(ELARA)
    assert unbound_names("It was her Will and her May.", aliases) == {}


def test_the_writers_other_writing_counts_as_evidence():
    # A name used mid-sentence in the outline is a name in the manuscript
    # too. Reading what the writer has already written beats any guess about
    # grammar.
    aliases, _ = _world(ELARA)
    evidence = NameEvidence()
    evidence.observe("The keeper of Ravensmoor is loyal.", source="outline")

    manuscript = "Ravensmoor was cold. Ravensmoor was always cold."
    assert unbound_names(manuscript, aliases) == {}          # no evidence
    assert unbound_names(manuscript, aliases, evidence=evidence) ==         {"Ravensmoor": 2}


def test_evidence_says_where_it_saw_the_name():
    # "You also use this in your outline" is a far better reason to make an
    # entry than a frequency count.
    evidence = NameEvidence()
    evidence.observe("The keeper of Ravensmoor is loyal.", source="outline")
    assert evidence.sources("Ravensmoor") == {"outline"}


def test_a_name_that_has_a_thread_is_not_unspun():
    aliases, _ = _world(ELARA)
    assert unbound_names("Elara waited. Elara left.", aliases) == {}


def test_a_retired_phrase_is_never_raised_again():
    # "Not a connection" has to mean permanently, or the walkthrough asks the
    # same dead question every session and stops being worth opening.
    aliases, _ = _world(ELARA)
    found = unbound_names(
        "They rode the Ash Road east. Nobody walks the Ash Road now.",
        aliases, ignore={"Ash Road"})
    assert "Ash Road" not in found

# ── One person, several names ────────────────────────────────────────────────
# Reported from live testing: accepting "Lara Croft", "Lara" and "Croft" left
# three entries where the writer meant one.
#
# Worth being precise about the cause. The app never guessed wrongly -- it
# ASKED three times about one thing, and every answer was individually
# reasonable. So names are grouped before anything is asked.

def _grouped(counts):
    return {g.primary: g.also for g in group_by_containment(counts)}


def test_a_full_name_takes_its_shorter_forms_with_it():
    # THE case. One question, not three.
    assert _grouped({"Lara Croft": 4, "Lara": 9, "Croft": 3}) == \
        {"Lara Croft": ["Croft", "Lara"]}


def test_the_group_is_founded_on_the_FULLEST_form(project=None):
    # Founding it on "Lara" -- which the prose uses most -- would make the
    # writer's entry the nickname.
    groups = group_by_containment({"Lara": 40, "Lara Croft": 2})
    assert groups[0].primary == "Lara Croft"


def test_the_counts_add_up_across_the_group():
    # "Mentioned 16 times" is the true weight of the thing. Reporting 4,
    # because that is how often the full name appears, understates it.
    groups = group_by_containment({"Lara Croft": 4, "Lara": 9, "Croft": 3})
    assert groups[0].count == 16


def test_names_group_by_WORDS_not_by_characters():
    # "Cambridge Library" is not a run of characters inside "Cambridge Campus
    # Library", and is obviously the same place.
    assert _grouped({
        "Cambridge Campus Library": 2, "Cambridge Library": 5,
        "Cambridge": 8, "Library": 6,
    }) == {"Cambridge Campus Library": ["Cambridge", "Cambridge Library",
                                       "Library"]}


def test_a_name_that_fits_TWO_groups_is_left_alone():
    # "John" is inside both "John Vale" and "John Thorne", and they are two
    # different men. Folding it into whichever came first would be a wrong
    # grouping that is invisible once accepted -- the same refusal to guess
    # that binding a mention already makes.
    grouped = _grouped({"John Vale": 3, "John Thorne": 2, "John": 7})
    assert grouped == {"John Vale": [], "John Thorne": [], "John": []}


def test_unrelated_names_stay_apart():
    assert _grouped({"Ravensmoor": 4, "Ash Road": 2}) == \
        {"Ravensmoor": [], "Ash Road": []}


def test_two_names_sharing_one_word_do_not_group():
    # "Ash Road" and "Ash Wood" are two places. Neither contains the other.
    assert _grouped({"Ash Road": 3, "Ash Wood": 2}) == \
        {"Ash Road": [], "Ash Wood": []}


def test_a_shared_word_that_is_also_its_own_name_is_left_alone():
    assert _grouped({"Ash Road": 3, "Ash Wood": 2, "Ash": 9})["Ash"] == []


def test_the_same_book_asks_the_same_questions_in_the_same_order():
    counts = {"Lara": 9, "Ravensmoor": 4, "Lara Croft": 4, "Ash Road": 2}
    first = [g.primary for g in group_by_containment(counts)]
    second = [g.primary for g in group_by_containment(dict(reversed(list(counts.items()))))]
    assert first == second


def test_the_loudest_group_is_offered_first():
    # A writer working down the list should meet the thing their book mentions
    # most before a walk-on part.
    groups = group_by_containment({"Ash Road": 2, "Lara Croft": 4, "Lara": 9})
    assert groups[0].primary == "Lara Croft"


def test_a_group_lists_every_word_it_answers_to():
    group = group_by_containment({"Lara Croft": 4, "Lara": 9})[0]
    assert group.names == ["Lara Croft", "Lara"]
