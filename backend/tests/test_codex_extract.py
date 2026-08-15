# tests/test_codex_extract.py -- the pass that reads the book, and its store
# ==========================================================================
# The Profile Extractor's raw material. Weaving finds the NAMES in a manuscript;
# this reads the prose and proposes the CONTENT, which is the work a writer
# would otherwise do by re-reading their own book.
#
# WHAT THESE TESTS ARE REALLY PROTECTING. This pass carries no evidence: an
# Overview is synthesis and has no source sentence to quote, so the verification
# `speaker_analysis.py` uses cannot apply (roadmap decision 4). That moves the
# entire safeguard onto two things, and both are tested here:
#
#   - nothing reaches a profile without a per-item click, so the run has to be
#     split into parts the size of the decisions the writer actually makes
#   - a proposal that could land in the WRONG PLACE is never quietly bound
#
# The second is the dangerous one. A proposal shown under John Vale that lands
# on John Thorne's page is invisible: the writer pressed a button, something
# happened, and nothing anywhere says it went to the wrong man.

import json

from app.codex import extract, extraction_store as store

TYPES = [
    {"id": "character", "label": "Characters", "folder": "characters",
     "sections": [
         {"id": "overview", "heading": "Overview", "trait_blocks": False},
         {"id": "physical_traits", "heading": "Physical Traits",
          "trait_blocks": True},
         {"id": "motivations", "heading": "Motivations", "trait_blocks": True},
     ]},
    {"id": "location", "label": "Locations", "folder": "locations",
     "sections": [
         {"id": "overview", "heading": "Overview", "trait_blocks": False},
     ]},
]


def _thread(entity_id, name, type_id="character", aliases=None, sections=None):
    return {
        "entity_id": entity_id, "name": name, "type": type_id,
        "aliases": list(aliases or []),
        "sections": sections or {},
        "ties": [], "run": [],
    }


def _answer(entries) -> str:
    return json.dumps({"entries": entries})


# ── Reading the model's answer ───────────────────────────────────────────────

def test_a_plain_proposal_survives_intact():
    proposals, dropped = extract.parse_response(_answer([{
        "type": "character", "name": "Rosie",
        "sections": [{"id": "overview", "text": "A courier who counts exits."}],
    }]), TYPES)
    assert dropped == []
    assert proposals[0]["name"] == "Rosie"
    assert proposals[0]["sections"][0]["text"] == "A courier who counts exits."
    # The heading comes from the REGISTRY, not from the model. A model-supplied
    # heading would drift from the writer's own section names the first time
    # they renamed one.
    assert proposals[0]["sections"][0]["heading"] == "Overview"


def test_json_wrapped_in_a_markdown_fence_is_still_read():
    # Models fence JSON perhaps a third of the time whatever the prompt says.
    # Throwing the answer away over three backticks would read to the writer as
    # a pass that found nothing, after they had paid for it.
    fenced = "```json\n" + _answer([{
        "type": "character", "name": "Rosie",
        "sections": [{"id": "overview", "text": "A courier."}],
    }]) + "\n```"
    proposals, dropped = extract.parse_response(fenced, TYPES)
    assert [p["name"] for p in proposals] == ["Rosie"]
    assert dropped == []


def test_a_sentence_before_the_json_is_tolerated():
    chatty = "Here is what I found:\n" + _answer([{
        "type": "character", "name": "Rosie",
        "sections": [{"id": "overview", "text": "A courier."}],
    }])
    proposals, _ = extract.parse_response(chatty, TYPES)
    assert [p["name"] for p in proposals] == ["Rosie"]


def test_an_unreadable_answer_is_reported_rather_than_crashing():
    proposals, dropped = extract.parse_response("I could not do that.", TYPES)
    assert proposals == []
    assert dropped and "JSON" in dropped[0]


# ── Refusing what cannot land ────────────────────────────────────────────────

def test_a_kind_this_project_does_not_have_is_dropped_BY_NAME():
    # Registry-driven means the model's answer is checked against the writer's
    # OWN types.json. A proposal typed "spaceship" in a fantasy project has
    # nowhere to go, and a button that fails when pressed is worse than a
    # proposal that never appears.
    proposals, dropped = extract.parse_response(_answer([{
        "type": "spaceship", "name": "The Kestrel",
        "sections": [{"id": "overview", "text": "Fast."}],
    }]), TYPES)
    assert proposals == []
    assert "The Kestrel" in dropped[0] and "spaceship" in dropped[0]


def test_a_section_that_kind_does_not_have_is_dropped_and_the_rest_kept():
    # Partial credit on purpose. One bad section should not cost the writer the
    # other three they paid for.
    proposals, dropped = extract.parse_response(_answer([{
        "type": "location", "name": "Huffington City",
        "sections": [
            {"id": "overview", "text": "A port town."},
            {"id": "motivations", "traits": [{"name": "x", "description": "y"}]},
        ],
    }]), TYPES)
    assert [s["id"] for s in proposals[0]["sections"]] == ["overview"]
    assert any("motivations" in d for d in dropped)


def test_an_entry_with_nothing_usable_left_is_dropped():
    proposals, dropped = extract.parse_response(_answer([{
        "type": "character", "name": "Nobody",
        "sections": [{"id": "not_a_section", "text": "..."}],
    }]), TYPES)
    assert proposals == []
    assert any("Nobody" in d for d in dropped)


def test_prose_sent_for_a_trait_section_is_kept_as_prose():
    # A model will sometimes answer a trait section with a paragraph. Dropping
    # it would be tidy and wrong: the section holds both, and a paragraph the
    # writer can cut down is worth more than nothing.
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "Rosie",
        "sections": [{"id": "physical_traits",
                      "text": "Short, fast, always in motion."}],
    }]), TYPES)
    section = proposals[0]["sections"][0]
    assert section["text"] == "Short, fast, always in motion."
    assert section["traits"] == []


def test_a_trait_missing_its_description_is_left_out():
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "Rosie",
        "sections": [{"id": "motivations", "traits": [
            {"name": "Wants out", "description": "Saving to leave the city."},
            {"name": "Half a trait"},
        ]}],
    }]), TYPES)
    traits = proposals[0]["sections"][0]["traits"]
    assert [t["name"] for t in traits] == ["Wants out"]


# ── The characters Weaving structurally cannot see ───────────────────────────

def test_a_described_but_unnamed_character_keeps_the_description_as_its_name():
    # The reported case: "the hulking figure", "the tall man". The description
    # IS the character, and the one thing that must never happen is the app
    # inventing a name to fill the field.
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "The tall man", "unnamed": True,
        "sections": [{"id": "overview",
                      "text": "Handles two powerful men with a word."}],
    }]), TYPES)
    assert proposals[0]["name"] == "The tall man"
    assert proposals[0]["unnamed"] is True


def test_a_reveal_is_carried_as_an_offer_not_a_merge():
    threads = [_thread("e-altas", "Altas")]
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "The hulking figure", "unnamed": True,
        "same_as": "Altas",
        "sections": [{"id": "overview", "text": "Rests in a blackened room."}],
    }]), TYPES)
    run = extract.build_run(proposals, threads)
    entry = run["entries"][0]
    # Resolved to an id so the screen can offer the fold ...
    assert entry["same_as"] == "e-altas"
    # ... and NOT folded. Two labels becoming one person is the writer's call;
    # the app does not merge on a hunch.
    assert entry["entity_id"] == ""
    assert entry["name"] == "The hulking figure"


def test_a_reveal_naming_somebody_the_writer_does_not_have_is_dropped():
    # An offer to merge into nothing is a dead button.
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "The tall man", "unnamed": True,
        "same_as": "Someone Never Recorded",
        "sections": [{"id": "overview", "text": "Dangerous."}],
    }]), TYPES)
    run = extract.build_run(proposals, [])
    assert run["entries"][0]["same_as"] == ""


# ── Matching against the world the writer already has ────────────────────────

def test_a_proposal_attaches_to_the_entry_it_names():
    threads = [_thread("e-rosie", "Rosie")]
    proposals, _ = extract.parse_response(_answer([{
        "match": "Rosie", "type": "character", "name": "Rosie",
        "sections": [{"id": "overview", "text": "A courier."}],
    }]), TYPES)
    run = extract.build_run(proposals, threads)
    assert run["entries"][0]["entity_id"] == "e-rosie"


def test_it_matches_on_an_alias_too():
    threads = [_thread("e-lexa", "Alexandra Langford", aliases=["Lexa"])]
    proposals, _ = extract.parse_response(_answer([{
        "match": "Lexa", "type": "character", "name": "Lexa",
        "sections": [{"id": "overview", "text": "A thief."}],
    }]), TYPES)
    run = extract.build_run(proposals, threads)
    assert run["entries"][0]["entity_id"] == "e-lexa"


def test_AN_AMBIGUOUS_NAME_IS_NEVER_SILENTLY_BOUND():
    """
    The dangerous one, and the same rule mentions.py already enforces.

    "John" answers to John Vale and John Thorne. Binding to whichever sorted
    first would put a proposal on one man's page while the screen showed it
    under the other, and NOTHING would look wrong: the writer pressed a button
    and something happened.

    So it falls through to "new", where the writer sees it as unplaced and
    decides. A visible extra question beats a silent wrong answer.
    """
    threads = [_thread("e-vale", "John Vale", aliases=["John"]),
               _thread("e-thorne", "John Thorne", aliases=["John"])]
    proposals, _ = extract.parse_response(_answer([{
        "match": "John", "type": "character", "name": "John",
        "sections": [{"id": "overview", "text": "Someone."}],
    }]), TYPES)
    run = extract.build_run(proposals, threads)
    assert run["entries"][0]["entity_id"] == ""


def test_a_genuinely_new_entry_is_marked_as_new():
    proposals, _ = extract.parse_response(_answer([{
        "type": "location", "name": "Huffington City",
        "sections": [{"id": "overview", "text": "A port town."}],
    }]), TYPES)
    run = extract.build_run(proposals, [_thread("e-rosie", "Rosie")])
    assert run["entries"][0]["entity_id"] == ""
    assert store.progress(run)["new_entries"] == 1


def test_a_new_character_arrives_as_SIDE():
    # Roadmap decision 9, same reasoning as R2.10a: a name the prose mentions is
    # far more often a shopkeeper than a viewpoint character, and the two
    # mistakes do not cost the same.
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "Mayor Bloomfield",
        "sections": [{"id": "overview", "text": "Runs the city badly."}],
    }]), TYPES)
    run = extract.build_run(proposals, [])
    assert run["entries"][0]["character_kind"] == "side"


# ── Parts: the unit the writer clicks ────────────────────────────────────────

def test_every_trait_is_its_own_part():
    # Not cosmetic. With no evidence carried, the per-item click is the whole
    # of the write protection, so the parts have to be the size of the
    # decisions the writer is actually making.
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "Rosie",
        "sections": [
            {"id": "overview", "text": "A courier."},
            {"id": "motivations", "traits": [
                {"name": "Wants out", "description": "Saving to leave."},
                {"name": "Owes a debt", "description": "To the wrong people."},
            ]},
        ],
    }]), TYPES)
    run = extract.build_run(proposals, [])
    parts = run["entries"][0]["parts"]
    assert len(parts) == 3
    assert sum(1 for p in parts if p["form"] == store.FORM_TRAIT) == 2
    assert all(p["state"] == store.PART_OPEN for p in parts)


def test_nothing_arrives_already_ticked():
    # The rule Sweep.tsx follows, and here it is the entire safeguard.
    proposals, _ = extract.parse_response(_answer([{
        "type": "character", "name": "Rosie",
        "sections": [{"id": "overview", "text": "A courier."}],
    }]), TYPES)
    run = extract.build_run(proposals, [])
    assert all(e["state"] == store.ENTRY_OPEN for e in run["entries"])
    assert store.progress(run)["parts_applied"] == 0


# ── What the request carries ─────────────────────────────────────────────────

def test_the_request_carries_a_snippet_of_each_existing_entry():
    # Roadmap decision 3, and the reason matching works at all: without it the
    # model proposes Rosie from scratch, ignorant of the two paragraphs the
    # writer already wrote, and every proposal arrives as a rewrite of finished
    # work.
    thread = _thread("e-rosie", "Rosie", sections={
        "overview": {"heading": "Overview", "content": "A courier from the docks.",
                     "trait_blocks": []},
    })
    snippet = extract.entry_snippet(thread)
    assert "courier from the docks" in snippet

    message = extract.build_user_message(
        [("Chapter One", "Rosie ran.")],
        [{"name": "Rosie", "type": "character", "aliases": [],
          "snippet": snippet}],
        TYPES)
    assert "Rosie" in message
    assert "courier from the docks" in message
    assert "Chapter One" in message


def test_the_snippet_is_short_because_it_is_orientation_not_context():
    long_thread = _thread("e-x", "X", sections={
        "overview": {"heading": "Overview", "content": "word " * 500,
                     "trait_blocks": []},
    })
    assert len(extract.entry_snippet(long_thread)) < 450


def test_the_message_names_every_section_the_writer_actually_has():
    # Registry-driven: whatever types.json holds, including a kind invented
    # this afternoon. The model cannot propose into a section it was not told
    # about, so this is what makes a custom kind work at all.
    message = extract.build_user_message([("One", "text")], [], TYPES)
    for section in ("overview", "physical_traits", "motivations"):
        assert section in message
    assert "(traits)" in message


def test_an_empty_world_is_said_out_loud_rather_than_left_blank():
    # Otherwise the model reads the silence as "there is no world" and proposes
    # one from nothing. It also matches what the setup screen tells the writer.
    message = extract.build_user_message([("One", "text")], [], TYPES)
    assert "NO ENTRIES YET" in message


def test_every_ticked_chapter_goes_up_in_ONE_request():
    # Roadmap decision 1. Per-chapter requests could not see that a character
    # from chapter two has come back in chapter eleven, which is the writer's
    # own example of what they want this for.
    message = extract.build_user_message(
        [("Chapter Nine", "a"), ("Chapter Ten", "b"), ("Chapter Eleven", "c")],
        [], TYPES)
    for title in ("Chapter Nine", "Chapter Ten", "Chapter Eleven"):
        assert title in message


# ── The prompt's own promises ────────────────────────────────────────────────

def test_the_prompt_forbids_inventing_and_forbids_naming_the_unnamed():
    prompt = extract.EXTRACT_PROMPT
    assert "Do not invent" in prompt
    assert "Never invent a name for them" in prompt
    # The app's locked punctuation rule, stated in the prompt as well as
    # enforced by the sanitizer.
    assert "em dash" in prompt


def test_the_prompt_contains_no_em_dashes_itself():
    # A prompt that breaks the rule it states is the one thing a model will
    # reliably copy.
    assert "—" not in extract.EXTRACT_PROMPT
    assert "–" not in extract.EXTRACT_PROMPT


# ── The saved run, and the one rule that makes superseding safe ──────────────
#
# Roadmap decision 8, in the writer's words: "The data remains until a brand new
# process request is made, to which the previous one is overwritten as the new
# one supersedes it." Exactly one current extraction, no history.
#
# It lives in a FILE rather than app.db for the same reason findings.py does:
# everything in the cache is rebuildable from Markdown and this is not. A
# proposal was paid for in tokens, and the cache is documented as safe to
# delete, so nothing expensive and unrecomputable belongs in it.

def _run_with(open_parts=2, applied=0, done_entries=0):
    run = store.new_run(model_used="test/model")
    for index in range(1 + done_entries):
        entry = store.new_entry(type_id="character", name=f"Person {index}")
        for _ in range(open_parts):
            entry["parts"].append(store.new_part(
                section_id="overview", heading="Overview",
                form=store.FORM_PROSE, content="text"))
        for _ in range(applied):
            part = store.new_part(section_id="overview", heading="Overview",
                                  form=store.FORM_PROSE, content="text")
            part["state"] = store.PART_APPLIED
            entry["parts"].append(part)
        if index < done_entries:
            entry["state"] = store.ENTRY_DONE
        run["entries"].append(entry)
    return run


def test_a_run_survives_a_round_trip_to_disk(tmp_path):
    project = str(tmp_path)
    run = _run_with()
    store.save(project, run)
    loaded = store.load(project)
    assert loaded["run_id"] == run["run_id"]
    assert loaded["entries"][0]["parts"][0]["content"] == "text"


def test_it_lives_beside_the_weaving_answers_not_in_the_cache(tmp_path):
    # Stated as a path assertion because the reasoning is the whole point:
    # `app.db` is documented as safe to delete, and deleting it must never cost
    # the writer proposals they paid real money for.
    project = str(tmp_path)
    store.save(project, store.new_run())
    path = store.extraction_path(project)
    assert path.endswith("extraction.json")
    assert ".storythread" in path and "weave" in path
    assert "app.db" not in path


def test_no_current_extraction_reads_as_None(tmp_path):
    assert store.load(str(tmp_path)) is None


def test_a_damaged_file_reads_as_None_rather_than_taking_the_screen_down(tmp_path):
    # The writer's world is not in here. Losing this costs a re-run; raising
    # would cost them the feature.
    project = str(tmp_path)
    store.save(project, store.new_run())
    with open(store.extraction_path(project), "w", encoding="utf-8") as handle:
        handle.write("{ this is not json")
    assert store.load(project) is None


def test_UNREVIEWED_COUNT_IS_WHAT_A_NEW_RUN_WOULD_COST():
    """
    The guard, and the reason it counts PARTS rather than entries.

    An entry with nine untouched traits is nine losses, not one. A count that
    said "1" there would understate what the writer is about to throw away by
    an order of magnitude, on the one screen where the number is the whole
    basis for the decision.
    """
    assert store.unreviewed_count(_run_with(open_parts=9)) == 9
    assert store.unreviewed_count(None) == 0


def test_an_entry_the_writer_ticked_off_counts_as_reviewed():
    # "I have looked at this and want nothing from it" is a real answer that
    # leaves every part open. Counting those as losses would make the guard cry
    # wolf, and a warning that is usually wrong gets clicked through.
    run = _run_with(open_parts=3, done_entries=1)
    # Two entries, three open parts each; one of them is ticked done.
    assert store.unreviewed_count(run) == 3


def test_applied_and_dismissed_are_both_reviewed_but_kept_apart():
    run = _run_with(open_parts=0, applied=2)
    assert store.unreviewed_count(run) == 0
    counts = store.progress(run)
    assert counts["parts_applied"] == 2
    assert counts["parts_dismissed"] == 0


def test_marking_a_part_records_HOW_it_landed():
    # So the screen can say what was done rather than only that something was.
    run = _run_with(open_parts=1)
    entry = run["entries"][0]
    part = entry["parts"][0]
    assert store.mark_part(run, entry["item_id"], part["part_id"],
                           store.PART_APPLIED, applied_as="merge")
    assert part["state"] == store.PART_APPLIED
    assert part["applied_as"] == "merge"


def test_marking_something_that_is_not_there_is_False_not_an_exception():
    run = _run_with()
    assert store.mark_part(run, "x-nope", "p-nope", store.PART_APPLIED) is False


def test_discarding_removes_the_run(tmp_path):
    project = str(tmp_path)
    store.save(project, store.new_run())
    assert store.discard(project) is True
    assert store.load(project) is None
    # And discarding nothing is not an error -- the screen may offer it either way.
    assert store.discard(project) is False


def test_a_new_run_replaces_rather_than_accumulates(tmp_path):
    # No history, because the writer said the new one supersedes the old and a
    # history nobody asked for is a folder that grows forever.
    project = str(tmp_path)
    first = store.new_run()
    store.save(project, first)
    second = store.new_run()
    store.save(project, second)
    assert store.load(project)["run_id"] == second["run_id"]
    import os
    weave_dir = os.path.dirname(store.extraction_path(project))
    assert [f for f in os.listdir(weave_dir) if f.startswith("extraction")] \
        == ["extraction.json"]


def test_the_run_records_when_it_was_made(tmp_path):
    # Deliberately the ONLY thing said about freshness. The manuscript may move
    # under a long review and nothing flags it -- that is the direct consequence
    # of one-run-until-superseded and it is the writer's choice, so the screen
    # says WHEN and leaves re-running to them. Recorded here so a later session
    # does not "fix" it by adding staleness detection nobody asked for.
    run = store.new_run()
    assert run["created_at"]
    assert "scope" in run


# ── "LEAVE THIS ONE ALONE" MEANS TWO DIFFERENT THINGS, AND ONLY ONE IS RIGHT ──
#
# Found by running the real route against the writer's own project rather than
# by any test, which is why it is worth the space.
#
# The setup screen pre-ticks entries that are already written up, as "leave
# alone". My first implementation took that to mean "do not send this entry to
# the model", which is the obvious reading and the wrong one.
#
# On a well-kept project EVERY entry is written up enough to be ticked. So the
# default would have hidden the entire world from the pass, the model would have
# read the prose, met a cast it had never been told about, and proposed all of
# them as NEW -- eleven duplicate proposals on a project whose only sin was
# being well maintained. The feature would have failed worst exactly where it
# was working best.
#
# "Leave alone" means propose no CHANGES to it. The entry is still named, so the
# model recognises it in the prose and does not offer it back.

def test_a_left_alone_entry_is_STILL_named_to_the_model():
    message = extract.build_user_message(
        [("One", "Rosie ran.")],
        [{"name": "Rosie", "type": "character", "aliases": [],
          "snippet": "A courier.", "leave_alone": True}],
        TYPES)
    assert "Rosie" in message


def test_and_is_marked_so_the_model_knows_not_to_propose_for_it():
    message = extract.build_user_message(
        [("One", "Rosie ran.")],
        [{"name": "Rosie", "type": "character", "aliases": [],
          "snippet": "A courier.", "leave_alone": True}],
        TYPES)
    assert "[LEAVE ALONE]" in message
    assert "Do not propose anything for them" in message
    # And it says WHY they are listed at all, or the next reader of this prompt
    # removes them again for the same reason I did.
    assert "do not offer them back as new" in message


def test_nothing_is_marked_when_nothing_was_excluded():
    # The instruction must not appear when it applies to nobody: a prompt that
    # explains a rule with no instances is spent budget teaching noise.
    message = extract.build_user_message(
        [("One", "Rosie ran.")],
        [{"name": "Rosie", "type": "character", "aliases": [],
          "snippet": "A courier."}],
        TYPES)
    assert "[LEAVE ALONE]" not in message


def test_a_proposal_for_a_left_alone_entry_is_DROPPED_not_trusted():
    """
    The guarantee rather than the hope.

    The prompt asks; a model sometimes proposes anyway. Filtering at assembly is
    what makes the tick mean something -- the writer said do not touch this
    entry, so nothing about it should reach a screen where one click could put
    it into work they had already finished.
    """
    threads = [_thread("e-rosie", "Rosie"), _thread("e-lou", "Lou")]
    proposals, _ = extract.parse_response(_answer([
        {"match": "Rosie", "type": "character", "name": "Rosie",
         "sections": [{"id": "overview", "text": "Ignore me."}]},
        {"match": "Lou", "type": "character", "name": "Lou",
         "sections": [{"id": "overview", "text": "Keep me."}]},
    ]), TYPES)

    run = extract.build_run(proposals, threads, leave_alone={"e-rosie"})
    assert [e["name"] for e in run["entries"]] == ["Lou"]


def test_leaving_an_entry_alone_does_not_suppress_a_genuinely_new_one():
    # The filter is keyed on the matched entity, so a NEW proposal that happens
    # to share nothing with the excluded entry must still come through. A
    # filter that over-reached here would silently cost the writer the exact
    # thing they ran the pass for.
    threads = [_thread("e-rosie", "Rosie")]
    proposals, _ = extract.parse_response(_answer([
        {"type": "location", "name": "Huffington City",
         "sections": [{"id": "overview", "text": "A port town."}]},
    ]), TYPES)
    run = extract.build_run(proposals, threads, leave_alone={"e-rosie"})
    assert [e["name"] for e in run["entries"]] == ["Huffington City"]


# ── Reading an answer that stops mid-word ───────────────────────────────────

def test_salvage_takes_every_entry_that_closed():
    raw = ('{"entries": ['
           '{"type": "character", "name": "A"},'
           '{"type": "character", "name": "B"},'
           '{"type": "character", "name": "C')
    assert [e["name"] for e in extract.salvage_entries(raw)] == ["A", "B"]


def test_salvage_is_not_confused_by_braces_inside_the_writers_prose():
    # A description is prose, and prose contains braces, quotes and backslashes.
    # A brace-counting parser that did not understand strings would end an
    # entry early and lose the rest of a perfectly good answer.
    raw = ('{"entries": ['
           '{"type": "character", "name": "A", "sections": '
           '[{"id": "overview", "text": "He said {this} and \\"that\\"."}]},'
           '{"type": "character", "name": "B')
    got = extract.salvage_entries(raw)
    assert [e["name"] for e in got] == ["A"]
    assert "{this}" in got[0]["sections"][0]["text"]


def test_salvage_returns_nothing_when_the_cut_came_too_early():
    assert extract.salvage_entries('{"entries": [{"type": "cha') == []
    assert extract.salvage_entries("not json at all") == []


def test_salvage_handles_a_COMPLETE_answer_identically():
    # It must not be a special path that behaves differently on healthy input,
    # or the failure case becomes the only one anybody tests.
    raw = _answer([{"type": "character", "name": "A"},
                   {"type": "character", "name": "B"}])
    assert [e["name"] for e in extract.salvage_entries(raw)] == ["A", "B"]


# -- SPLITTING A BOOK INTO REQUESTS THAT CAN BE ANSWERED ---------------------
#
# Measured, not guessed: the writer's own run put 44,227 input tokens in and
# produced more than 32,000 output tokens before being cut off. The answer is
# roughly three quarters the size of the prose, and it grows with the book while
# the reply budget does not. No single request can cover a novel.

def _chapter(cid, chars):
    return {"chapter_id": cid, "chars": chars}


def test_a_short_book_is_one_request():
    # Batching must not tax the ordinary case. A novella that fits should go up
    # in one piece, because that is what lets the pass see the whole story.
    batches = extract.plan_batches([_chapter("c1", 20000), _chapter("c2", 20000)])
    assert batches == [["c1", "c2"]]


def test_a_real_novel_is_split_into_answerable_pieces():
    # Becoming a Hero: seven chapters, 275,535 characters.
    chapters = [_chapter("c1", 49618), _chapter("c2", 34587),
                _chapter("c3", 43902), _chapter("c4", 30597),
                _chapter("c5", 30774), _chapter("c6", 32278),
                _chapter("c7", 53779)]
    batches = extract.plan_batches(chapters)
    assert len(batches) == 4
    # Every chapter travels exactly once.
    assert [c for batch in batches for c in batch] == \
        [c["chapter_id"] for c in chapters]


def test_every_batch_is_inside_the_budget():
    chapters = [_chapter(f"c{i}", 40000) for i in range(10)]
    for batch in extract.plan_batches(chapters):
        chars = 40000 * len(batch)
        assert chars // extract.CHARS_PER_TOKEN <= extract.BATCH_INPUT_TOKENS


def test_CHAPTERS_STAY_WHOLE_AND_IN_ORDER():
    """
    A batch is a run of CONSECUTIVE chapters, and no chapter is ever split.

    Both halves matter. Consecutive, because the reason the writer wanted whole
    book runs is that a character introduced in chapter two and returning in
    chapter six is only visible when both are in one reading -- scattering
    chapters across batches would destroy exactly that. Whole, because half a
    scene tells a model nothing useful about who is in it.
    """
    chapters = [_chapter(f"c{i}", 30000) for i in range(6)]
    batches = extract.plan_batches(chapters)
    flat = [c for batch in batches for c in batch]
    assert flat == [c["chapter_id"] for c in chapters]
    for batch in batches:
        numbers = [int(c[1:]) for c in batch]
        assert numbers == list(range(numbers[0], numbers[0] + len(numbers)))


def test_a_chapter_bigger_than_the_budget_still_travels_whole():
    # It may truncate, and salvage handles that. Cutting a chapter in half would
    # guarantee a worse answer rather than risk one.
    batches = extract.plan_batches([_chapter("huge", 500000)])
    assert batches == [["huge"]]


def test_no_chapters_is_no_batches():
    assert extract.plan_batches([]) == []


# -- PUTTING THE BATCHES BACK TOGETHER ---------------------------------------

def _entry_with(name, content, entity_id="", type_id="character"):
    entry = store.new_entry(entity_id=entity_id, type_id=type_id, name=name)
    entry["parts"].append(store.new_part(
        section_id="overview", heading="Overview",
        form=store.FORM_PROSE, content=content))
    return entry


def test_THE_SAME_CHARACTER_IN_TWO_BATCHES_IS_ONE_ENTRY():
    """
    The failure this exists to prevent, arriving by a new road.

    A character in chapters one and six is proposed by both batches. Appending
    blindly gives the writer the same person twice, which is R11.6's grouping
    problem all over again -- and this time the app would have created it.
    """
    run = store.new_run()
    run["entries"].append(_entry_with("Rosie", "From chapter one.",
                                      entity_id="e-rosie"))
    counts = store.merge_entries(
        run, [_entry_with("Rosie", "From chapter six.", entity_id="e-rosie")])

    assert len(run["entries"]) == 1
    assert counts["merged"] == 1
    # Both proposals are kept, because they were written from different
    # chapters and the writer picks between them.
    assert len(run["entries"][0]["parts"]) == 2


def test_it_matches_on_the_name_when_there_is_no_entry_yet():
    # A described character has no entity id in either batch. "The Tall Man"
    # and "the tall man" are one person.
    run = store.new_run()
    run["entries"].append(_entry_with("The Tall Man", "Seen in chapter two."))
    store.merge_entries(run, [_entry_with("the tall man", "Again in six.")])
    assert len(run["entries"]) == 1


def test_two_different_people_stay_two_entries():
    run = store.new_run()
    run["entries"].append(_entry_with("Rosie", "A courier."))
    store.merge_entries(run, [_entry_with("Lou", "A mechanic.")])
    assert [e["name"] for e in run["entries"]] == ["Rosie", "Lou"]


def test_the_same_name_of_two_DIFFERENT_KINDS_stays_apart():
    # A city and a faction can share a name, and folding them would be a
    # silent, unrecoverable mistake in the writer's world.
    run = store.new_run()
    run["entries"].append(_entry_with("Ashfall", "A city.", type_id="location"))
    store.merge_entries(run, [_entry_with("Ashfall", "A faction.",
                                          type_id="faction")])
    assert len(run["entries"]) == 2


def test_a_batch_repeating_itself_word_for_word_adds_nothing():
    # Two identical cards is a worse screen, and it is not new information.
    run = store.new_run()
    run["entries"].append(_entry_with("Rosie", "A courier.", entity_id="e-r"))
    counts = store.merge_entries(
        run, [_entry_with("Rosie", "A courier.", entity_id="e-r")])
    assert len(run["entries"][0]["parts"]) == 1
    assert counts["parts"] == 0


def test_A_LATER_BATCH_NEVER_DISTURBS_WORK_THE_WRITER_HAS_DONE():
    """
    The rule that makes batching safe to leave running.

    The writer works through batch one's proposals while batches two and three
    are still arriving. A merge that reset a part they had already applied --
    or reopened an entry they ticked done -- would undo their work in front of
    them, and they would have no way to tell what had happened.
    """
    run = store.new_run()
    entry = _entry_with("Rosie", "From chapter one.", entity_id="e-rosie")
    entry["parts"][0]["state"] = store.PART_APPLIED
    entry["parts"][0]["applied_as"] = "merge"
    entry["state"] = store.ENTRY_DONE
    run["entries"].append(entry)

    store.merge_entries(
        run, [_entry_with("Rosie", "From chapter six.", entity_id="e-rosie")])

    survivor = run["entries"][0]
    assert survivor["state"] == store.ENTRY_DONE
    assert survivor["parts"][0]["state"] == store.PART_APPLIED
    assert survivor["parts"][0]["applied_as"] == "merge"
    # And the new proposal is there when they choose to look.
    assert len(survivor["parts"]) == 2
    assert survivor["parts"][1]["state"] == store.PART_OPEN


def test_a_reveal_found_by_a_later_batch_is_kept():
    # Chapter six is where "the hulking figure" turns out to be Altas. The
    # earlier batch could not have known.
    run = store.new_run()
    run["entries"].append(_entry_with("The hulking figure", "Silent."))
    incoming = _entry_with("The hulking figure", "Revealed.")
    incoming["same_as"] = "e-altas"
    store.merge_entries(run, [incoming])
    assert run["entries"][0]["same_as"] == "e-altas"


def test_aliases_accumulate_across_batches():
    run = store.new_run()
    first = _entry_with("Major Pain", "A hero.", entity_id="e-mp")
    first["aliases"] = ["Pain"]
    run["entries"].append(first)
    later = _entry_with("Major Pain", "Retired.", entity_id="e-mp")
    later["aliases"] = ["Pain", "The Major"]
    store.merge_entries(run, [later])
    assert run["entries"][0]["aliases"] == ["Pain", "The Major"]
