# tests/test_world_rules.py -- the questions a world has not answered
# ====================================================================
# Canned content, so the tests are contracts about the CONTENT rather than
# about logic -- the same shape as characterSpines.test.ts. A broken id or a
# question with no reason behind it does not crash anything; it just quietly
# makes the feature worse, which is exactly the sort of rot a test suite is
# for.
#
# Plus the one piece of real logic: a child question is never asked before
# its parent is answered. "What stops every heir being murdered in childhood"
# makes no sense to somebody who has not yet said how succession works, and
# asking it anyway is how a tool teaches somebody to ignore it.

import re

from app.codex.world_rules import (
    DOMAINS, WORLD_RULES, by_id, open_questions,
)
from app.codex.types_registry import DEFAULT_TYPES


def _thread(type_id: str, section_id: str, content: str) -> dict:
    return {"entity_id": f"e-{type_id}", "type": type_id, "name": "X",
            "sections": {section_id: {"heading": section_id,
                                      "content": content, "trait_blocks": []}}}


# ── The corpus holds together ────────────────────────────────────────────────

def test_every_id_is_unique():
    ids = [q.id for q in WORLD_RULES]
    assert len(ids) == len(set(ids))


def test_every_domain_named_is_a_real_domain():
    for question in WORLD_RULES:
        assert question.domain in DOMAINS, question.id


def test_every_domain_has_questions_in_it():
    # A domain listed with nothing behind it shows up as an empty heading.
    used = {q.domain for q in WORLD_RULES}
    assert set(DOMAINS) == used


def test_every_unlock_points_at_a_real_question():
    for question in WORLD_RULES:
        for child in question.unlocks:
            assert by_id(child) is not None, f"{question.id} unlocks {child}"


def test_every_crosslink_points_at_a_real_question():
    for question in WORLD_RULES:
        for other in question.crosslinks:
            assert by_id(other) is not None, f"{question.id} crosses {other}"


def test_a_crosslink_always_leaves_its_own_domain():
    # A crosslink INSIDE a domain is just an unlock written the wrong way.
    # The whole point of them is that succession reaches into law.
    for question in WORLD_RULES:
        for other in question.crosslinks:
            assert by_id(other).domain != question.domain, \
                f"{question.id} crosses to its own domain via {other}"


def test_nothing_unlocks_itself():
    for question in WORLD_RULES:
        assert question.id not in question.unlocks


def test_every_deeper_question_has_a_parent():
    # An orphaned depth-2 question can never be reached, because a child is
    # only offered once something unlocked it.
    children = {child for q in WORLD_RULES for child in q.unlocks}
    for question in WORLD_RULES:
        if question.depth > 1:
            assert question.id in children, f"{question.id} is unreachable"


def test_every_trunk_question_is_reachable_from_nothing():
    # And the reverse: a depth-1 question must NOT be somebody's child, or it
    # would be offered before and after its parent.
    children = {child for q in WORLD_RULES for child in q.unlocks}
    for question in WORLD_RULES:
        if question.depth == 1:
            assert question.id not in children, \
                f"{question.id} is both a trunk question and a child"


def test_every_answer_lands_somewhere_the_app_understands():
    # lands_as is what makes an answer part of the Weave rather than a
    # separate pile of notes nothing else can read. A typo here means the
    # question can never be marked answered.
    types = {t["id"]: {s["id"] for s in t["sections"]} for t in DEFAULT_TYPES}
    for question in WORLD_RULES:
        type_id, section_id = question.lands_as
        assert type_id in types, f"{question.id} lands in unknown type {type_id}"
        assert section_id in types[type_id], \
            f"{question.id} lands in {type_id} with no '{section_id}' section"


# ── The words themselves ─────────────────────────────────────────────────────

def test_every_question_is_a_question():
    for question in WORLD_RULES:
        assert question.prompt.endswith("?"), question.id


def test_every_question_says_why_it_is_worth_answering():
    # Without the why, this is a list of homework. The why is what turns
    # "decide your calendar" into "your dates will contradict each other".
    for question in WORLD_RULES:
        assert len(question.why.split()) >= 12, question.id


def test_no_em_dashes_anywhere():
    # The locked product rule. These strings are shown to the writer and are
    # also read back by the AI as context.
    for question in WORLD_RULES:
        for text in (question.prompt, question.why):
            assert "—" not in text and "–" not in text, question.id


def test_the_prompts_are_in_plain_second_person():
    # "What is the worst thing a person can be accused of here?" -- not
    # "define the juridical taxonomy". A novelist should never need a glossary
    # to answer a worldbuilding question.
    jargon = re.compile(r"\b(taxonomy|schema|entity|attribute|framework)\b", re.I)
    for question in WORLD_RULES:
        assert not jargon.search(question.prompt), question.id


# ── Which ones get asked ─────────────────────────────────────────────────────

def test_an_empty_world_is_asked_only_the_trunk():
    depths = {item.question.depth for item in open_questions([])}
    assert depths == {1}


def test_a_child_appears_once_its_parent_is_answered():
    # gov_succession is unlocked by gov_power, which lands in a government's
    # Overview.
    answered = [_thread("government", "overview", "A council of nine.")]
    ids = {item.question.id for item in open_questions(answered)}
    assert "gov_succession" in ids
    assert "gov_power" not in ids          # answered, so no longer asked


def test_a_child_says_what_opened_it():
    # A question arriving with no reason behind it is what makes
    # worldbuilding prompts feel like homework.
    answered = [_thread("government", "overview", "A council of nine.")]
    child = next(i for i in open_questions(answered)
                 if i.question.id == "gov_succession")
    assert child.because and child.because[0].endswith("?")


def test_a_grandchild_waits_for_its_own_parent():
    answered = [_thread("government", "overview", "A council of nine.")]
    ids = {i.question.id for i in open_questions(answered, max_depth=3)}
    assert "gov_heirs" not in ids         # gov_succession is still unanswered


def test_depth_can_be_held_to_the_trunk():
    answered = [_thread("government", "overview", "A council of nine.")]
    ids = {i.question.id for i in open_questions(answered, max_depth=1)}
    assert "gov_succession" not in ids


def test_a_crosslink_never_gates_anything():
    # A world is a web, not a tree. Two questions that each imply the other
    # would deadlock.
    ids = {i.question.id for i in open_questions([])}
    crossed = {c for q in WORLD_RULES for c in q.crosslinks
               if by_id(c).depth == 1}
    assert crossed <= ids


def test_an_answered_crosslink_is_offered_as_context():
    # "You have already decided your worst crime -- this touches it."
    answered = [
        _thread("government", "overview", "A council of nine."),
        _thread("lore", "overview", "Kinslaying, above all."),
    ]
    item = next(i for i in open_questions(answered)
                if i.question.id == "gov_succession")
    assert item.touches


def test_one_answer_is_enough_to_settle_a_question():
    # Asking again because a SECOND government has an empty succession field
    # would be pedantry rather than help.
    answered = [_thread("government", "overview", "A council of nine."),
                {"entity_id": "e-2", "type": "government", "name": "Y",
                 "sections": {"overview": {"content": "", "trait_blocks": []}}}]
    assert "gov_power" not in {i.question.id for i in open_questions(answered)}


def test_deleting_the_answer_brings_the_question_back():
    # Answered is DERIVED, never recorded. A writer who removes that section
    # no longer has an answer, and should be asked again.
    assert "gov_power" in {i.question.id for i in open_questions([])}


def test_a_domain_can_be_scanned_on_its_own():
    domains = {i.question.domain for i in open_questions([], domains=["religion"])}
    assert domains == {"religion"}
