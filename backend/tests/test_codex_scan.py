# tests/test_codex_scan.py -- what Weaving finds before it spends anything
# =========================================================================
# The deterministic pass. It runs first, it costs nothing, and its count is
# REAL -- which is what lets the walkthrough say "this found 340 stops, that
# is many sessions of work" instead of an estimate that turns out wrong two
# hours in.
#
# The property these tests exist to protect is that NOTHING IS STORED. Every
# stop is re-derived from source and destination state on every run, so a
# Thread that gets its Overview filled in stops being Frayed the moment the
# file is saved -- not because a finding was marked applied, but because the
# condition is no longer true. There is no bookkeeping to get wrong.

import json
import os

from app.codex.scan import (
    DEPTH_QUICK, STOP_EARLY, STOP_FRAYED, STOP_LOOSE, STOP_SNAG, STOP_UNPLACED,
    STOP_UNSPUN, ScanRequest, scan,
)
from app.utils.structure_store import ensure_chapter_ids

REGISTRY = {
    "types": [
        {"id": "character", "label": "Character", "folder": "characters",
         "icon": "User", "required_fields": ["overview"],
         "sections": [{"id": "overview", "heading": "Overview",
                       "trait_blocks": False}]},
        {"id": "concept", "label": "Concept", "folder": "concepts",
         "icon": "Lightbulb", "required_fields": [],
         "sections": [{"id": "overview", "heading": "Overview",
                       "trait_blocks": False}]},
    ],
    "relations": [],
}


def _project(tmp_path, chapters: dict[str, str]) -> str:
    root = tmp_path / "MyNovel"
    (root / "manuscript").mkdir(parents=True)
    (root / "project.json").write_text(json.dumps({"title": "N"}), encoding="utf-8")
    for name, text in chapters.items():
        (root / "manuscript" / name).write_text(text, encoding="utf-8")
    return str(root)


def _chapter_ids(folder: str) -> dict[str, str]:
    return ensure_chapter_ids(folder)


def _thread(entity_id, name, **kw):
    thread = {
        "entity_id": entity_id, "name": name, "type": "character",
        "aliases": [], "sections": {"overview": {"heading": "Overview",
                                                 "content": "Someone.",
                                                 "trait_blocks": []}},
        "ties": [], "run": [],
    }
    thread.update(kw)
    return thread


def _kinds(result):
    return sorted({s.kind for s in result.stops})


# ── Frayed ───────────────────────────────────────────────────────────────────

def test_an_empty_required_section_is_frayed(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    thin = _thread("e-1", "Elara",
                   sections={"overview": {"heading": "Overview", "content": "",
                                          "trait_blocks": []}})
    result = scan(folder, [thin], REGISTRY)
    frayed = result.by_kind(STOP_FRAYED)
    assert len(frayed) == 1
    assert "Overview" in frayed[0].title      # the heading, not the field id


def test_a_filled_section_stops_being_frayed_with_no_bookkeeping(tmp_path):
    # The whole point of deriving rather than storing.
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    assert scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_FRAYED) == []


def test_a_type_that_requires_nothing_is_never_frayed(tmp_path):
    # A Concept and a Character are not thin in the same way, and the
    # registry is where a world says what it values.
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    concept = _thread("e-c", "Thread-sight", type="concept",
                      sections={"overview": {"heading": "Overview",
                                             "content": "", "trait_blocks": []}})
    assert scan(folder, [concept], REGISTRY).by_kind(STOP_FRAYED) == []


# ── Loose threads ────────────────────────────────────────────────────────────

def test_a_thread_nothing_connects_to_is_loose(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    assert len(result.by_kind(STOP_LOOSE)) == 1


def test_being_the_TARGET_of_a_tie_counts_as_connected(tmp_path):
    # Only one direction is ever stored. Counting what a Thread owns would
    # report every mentored character in the book as loose.
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    elara = _thread("e-1", "Elara",
                    ties=[{"rel": "mentored_by", "target": "e-2"}])
    garrick = _thread("e-2", "Garrick")
    assert scan(folder, [elara, garrick], REGISTRY).by_kind(STOP_LOOSE) == []


# A LOOSE THREAD ASKS A QUESTION, AND SAYS WHAT IT IS NOT ASKING ABOUT.
#
# From live testing, on the first of 57 stops:
#
#     "LOOSE THREAD - Nothing connects to Alexandra Langford. That's not true.
#      Alexandra Langford connects to the Character profile Alexandra Langford,
#      which exists. So from my perspective there is either a glitch or
#      something isn't right."
#
# The writer was right, and so was the stop -- about two different things called
# "connected". Her name appearing in the prose and finding her entry is
# automatic and needs nothing from anyone. Her entry relating to any OTHER entry
# is what was missing. Stating a bare absence sent the writer off to check the
# half that was already working.
#
# The wording below is the fix, and these tests hold it: the stop is a QUESTION,
# and it says the mentions are already fine before naming what is not.

def test_a_loose_thread_is_phrased_as_a_question(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    stop = result.by_kind(STOP_LOOSE)[0]
    assert stop.title == "How is Elara connected to the story?"


def test_it_never_says_nothing_connects(tmp_path):
    # The exact sentence that was read as a bug report about the app.
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    stop = scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_LOOSE)[0]
    assert "Nothing connects to" not in stop.title
    assert "Nothing connects to" not in stop.why


def test_it_says_the_mentions_already_work(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    stop = scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_LOOSE)[0]
    assert "already find this entry" in stop.why
    assert "needs nothing from you" in stop.why


def test_it_counts_the_mentions_as_proof(tmp_path):
    # A number is what turns reassurance into evidence: the writer can check it.
    folder = _project(tmp_path, {
        "01.md": "# One\nElara waited. Later, Elara left.\n",
        "02.md": "# Two\nElara returned.\n",
    })
    stop = scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_LOOSE)[0]
    assert stop.detail["mentioned"] == 3
    assert "3 of them so far" in stop.why


def test_a_thread_the_prose_never_names_claims_no_count(tmp_path):
    # Nothing to reassure about, so the sentence drops the number rather than
    # boasting of zero mentions.
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    stop = scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_LOOSE)[0]
    assert stop.detail["mentioned"] == 0
    assert "of them so far" not in stop.why


def test_it_names_the_entry_so_the_walk_can_show_it(tmp_path):
    # The walk puts the entry's own icon and name above the question. It reads
    # both out of detail; without them there is nothing to stand on.
    folder = _project(tmp_path, {"01.md": "# One\nRain fell.\n"})
    stop = scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_LOOSE)[0]
    assert stop.detail["name"] == "Elara"
    assert stop.detail["type"] == "character"
    assert stop.entity_id == "e-1"


def test_counting_mentions_does_not_reread_the_manuscript(tmp_path, monkeypatch):
    # The count and the prose stops need the same text. Reading each chapter
    # twice would double the cost of the free pass on a full-length novel.
    from app.codex import scan as scan_mod
    reads: list[str] = []
    real = scan_mod._read_chapter

    def counted(project_path, filename):
        reads.append(filename)
        return real(project_path, filename)

    monkeypatch.setattr(scan_mod, "_read_chapter", counted)
    folder = _project(tmp_path, {"01.md": "# One\nElara waited.\n",
                                 "02.md": "# Two\nElara left.\n"})
    scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    assert sorted(reads) == ["01.md", "02.md"]


# ── Snags come through the scan ──────────────────────────────────────────────

def test_a_structural_snag_becomes_a_stop(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    chapter_id = list(_chapter_ids(folder).values())[0]
    elara = _thread("e-1", "Elara", run=[
        {"id": "f-1", "at": chapter_id, "axis": "eyes", "value": "Green."},
        {"id": "f-2", "at": chapter_id, "axis": "eyes", "value": "Blue."},
    ])
    result = scan(folder, [elara], REGISTRY)
    assert len(result.by_kind(STOP_SNAG)) == 1
    assert "no model was asked" in result.by_kind(STOP_SNAG)[0].why


def test_an_unplaced_fact_is_its_own_kind(tmp_path):
    # Different stop, different question: this one is not a disagreement, it
    # is a fact that can never take effect anywhere.
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    elara = _thread("e-1", "Elara", run=[
        {"id": "f-1", "at": "c-deleted", "axis": "eyes", "value": "Green."}])
    assert len(scan(folder, [elara], REGISTRY).by_kind(STOP_UNPLACED)) == 1


# ── Unspun ───────────────────────────────────────────────────────────────────

def test_a_repeated_name_with_no_thread_is_unspun(tmp_path):
    # Both mentions sit MID-SENTENCE. That is the whole rule: the capital was
    # the writer's choice, not the full stop's. A name that only ever begins
    # a sentence is indistinguishable from "Because" or "Every".
    folder = _project(tmp_path, {
        "01.md": "# One\nShe waited for Garrick.\n",
        "02.md": "# Two\nBy dawn Garrick had not come.\n",
    })
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    unspun = result.by_kind(STOP_UNSPUN)
    assert [s.detail["name"] for s in unspun] == ["Garrick"]
    assert unspun[0].detail["count"] == 2


def test_unspun_counts_across_the_whole_book_not_per_chapter(tmp_path):
    # A name appearing once in each of twelve chapters is a character.
    # Per-chapter counting would never notice.
    chapters = {f"{i:02d}.md": f"# {i}\nShe waited for Garrick.\n"
                for i in range(1, 4)}
    folder = _project(tmp_path, chapters)
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    assert result.by_kind(STOP_UNSPUN)[0].detail["count"] == 3


def test_a_chapter_heading_is_not_a_character(tmp_path):
    # "Chapter Seven" is a title however many times it appears.
    folder = _project(tmp_path, {
        "01.md": "# Chapter Seven\nRain fell.\n",
        "02.md": "# Chapter Seven\nMore rain.\n",
    })
    names = {s.detail["name"] for s in
             scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_UNSPUN)}
    assert "Chapter Seven" not in names


def test_an_unspun_stop_quotes_the_prose_it_came_from(tmp_path):
    # Every stop has to answer "why am I seeing this?" with the text that
    # triggered it. A walkthrough that cannot explain itself trains the
    # writer to click through it.
    folder = _project(tmp_path, {
        "01.md": "# One\nShe rode north with Garrick through the ash.\n",
        "02.md": "# Two\nBy dawn Garrick had not come.\n",
    })
    stop = scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_UNSPUN)[0]
    assert "rode north with Garrick" in stop.quote
    assert stop.chapter_id and stop.evidence_hash


def test_a_retired_phrase_never_comes_back(tmp_path):
    folder = _project(tmp_path, {
        "01.md": "# One\nShe waited for Garrick.\n",
        "02.md": "# Two\nBy dawn Garrick had not come.\n",
    })
    request = ScanRequest(retired={"Garrick"})
    assert scan(folder, [_thread("e-1", "Elara")], REGISTRY, request) \
        .by_kind(STOP_UNSPUN) == []


# ── Early mention ────────────────────────────────────────────────────────────

def test_a_thread_the_map_would_hide_here_but_the_prose_names(tmp_path):
    folder = _project(tmp_path, {
        "01.md": "# One\nElara thought of Garrick.\n",
        "02.md": "# Two\nRain fell.\n",
        "03.md": "# Three\nGarrick appeared.\n",
    })
    ids = _chapter_ids(folder)
    late = ids["03.md"]
    garrick = _thread("e-2", "Garrick", run=[
        {"id": "f-1", "at": late, "axis": "arrival", "value": "Arrives."}])
    elara = _thread("e-1", "Elara", ties=[{"rel": "knows", "target": "e-2"}])

    result = scan(folder, [elara, garrick], REGISTRY)
    early = result.by_kind(STOP_EARLY)
    assert [s.entity_id for s in early] == ["e-2"]
    assert early[0].chapter_id == ids["01.md"]


def test_a_thread_with_nothing_anchored_never_fires_this(tmp_path):
    # Self-limiting on purpose: only a writer who has actually done the
    # anchoring work can be nagged about it.
    folder = _project(tmp_path, {"01.md": "# One\nElara thought of Garrick.\n"})
    elara = _thread("e-1", "Elara", ties=[{"rel": "knows", "target": "e-2"}])
    garrick = _thread("e-2", "Garrick")
    assert scan(folder, [elara, garrick], REGISTRY).by_kind(STOP_EARLY) == []


def test_an_ambiguous_name_is_never_accused_of_being_early(tmp_path):
    # It might be the other character of that name. Accusing a writer of a
    # spoiler they did not write is worse than missing one they did.
    folder = _project(tmp_path, {
        "01.md": "# One\nJohn waited.\n",
        "02.md": "# Two\nRain.\n",
    })
    ids = _chapter_ids(folder)
    late = ids["02.md"]
    a = _thread("e-a", "John Vale", aliases=["John"], run=[
        {"id": "f-1", "at": late, "axis": "x", "value": "v"}])
    b = _thread("e-b", "John Thorne", aliases=["John"], run=[
        {"id": "f-2", "at": late, "axis": "x", "value": "v"}])
    assert scan(folder, [a, b], REGISTRY).by_kind(STOP_EARLY) == []


# ── Scope, depth and honesty about what was skipped ──────────────────────────

def test_quick_pass_asks_no_world_building_questions(tmp_path):
    # Problems only. Nothing that asks the writer to invent anything.
    folder = _project(tmp_path, {
        "01.md": "# One\nShe waited for Garrick.\n",
        "02.md": "# Two\nBy dawn Garrick had not come.\n",
    })
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY,
                  ScanRequest(depth=DEPTH_QUICK))
    assert STOP_UNSPUN not in _kinds(result)
    assert STOP_LOOSE in _kinds(result)


def test_a_muted_kind_is_not_scanned_for(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY,
                  ScanRequest(muted_kinds={STOP_LOOSE}))
    assert STOP_LOOSE not in _kinds(result)


def test_scanning_one_type_leaves_the_others_alone(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    concept = _thread("e-c", "Thread-sight", type="concept")
    result = scan(folder, [_thread("e-1", "Elara"), concept], REGISTRY,
                  ScanRequest(types=["concept"]))
    assert {s.entity_id for s in result.by_kind(STOP_LOOSE)} == {"e-c"}


def test_a_chapter_range_narrows_the_manuscript_pass(tmp_path):
    folder = _project(tmp_path, {
        "01.md": "# One\nShe waited for Garrick.\n",
        "02.md": "# Two\nBy dawn Garrick had not come.\n",
    })
    ids = _chapter_ids(folder)
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY,
                  ScanRequest(chapter_ids=[ids["01.md"]]))
    # One occurrence in range, and the floor is two -- so nothing is raised
    # rather than a half-counted stop being presented as whole.
    assert result.by_kind(STOP_UNSPUN) == []


def test_a_chapter_that_is_not_utf8_is_skipped_and_named(tmp_path):
    # Not theoretical: a chapter pasted from an old editor or recovered from
    # a Windows-code-page backup decodes as anything but UTF-8. That raises
    # UnicodeDecodeError, which is a ValueError and NOT an OSError -- so
    # catching only OSError would let one bad file take the whole scan down.
    #
    # And it is REPORTED. "We found 4 stops" reads very differently when a
    # chapter was silently skipped.
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n",
                                 "02.md": "# Two\nRain.\n"})
    with open(os.path.join(folder, "manuscript", "02.md"), "wb") as f:
        f.write(b"# Two\nCaf\xe9 in Windows-1252.\n")

    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    assert result.unreadable == ["02.md"]
    assert result.by_kind(STOP_LOOSE)        # the rest of the scan still ran


def test_the_count_is_real(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    assert result.counts[STOP_LOOSE] == len(result.by_kind(STOP_LOOSE))
    assert sum(result.counts.values()) == len(result.stops)


def test_the_same_book_scans_the_same_way_twice(tmp_path):
    folder = _project(tmp_path, {
        "01.md": "# One\nShe waited for Garrick.\n",
        "02.md": "# Two\nBy dawn Garrick had not come.\n",
    })
    threads = [_thread("e-1", "Elara")]
    first = [s.key for s in scan(folder, threads, REGISTRY).stops]
    second = [s.key for s in scan(folder, threads, REGISTRY).stops]
    assert first == second


# ── The noise problem, pinned with the shape of a real manuscript ────────────
# Reported from a live full walkthrough: 177 stops, of which well over a
# hundred were words like All, Any, Because, Before, By, Can, Each, Every,
# Everything, Exactly, For and Plus -- ordinary words that begin sentences.
# The frequency floor could never have caught them; "All" appears hundreds of
# times. These tests use prose shaped like the manuscript that produced them.

_REAL_PROSE = """# Chapter One

"Can I ask something? About last night." Alexandra shifted in her chair.

Plus, they were all women. All of them. Another thing entirely. Any of them
could have said it. Are you certain? Because before the exposure, the
footsteps were controlled. Curiosity is dangerous, Alexandra's mother had
said. Every daughter learns that. Everything else is confusion.

"Bugger," she said. "Enough. Exactly the sort of clinical dark nonsense."

For each of them, Alexandra was the one they called. By then Kessler had
gone, and Kessler would not come back. Fine.
"""


def test_ordinary_words_that_begin_sentences_are_not_offered(tmp_path):
    folder = _project(tmp_path, {"01.md": _REAL_PROSE})
    found = {s.detail["name"] for s in
             scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)}
    for word in ["All", "Any", "Are", "About", "Another", "Because", "Bugger",
                 "By", "Can", "Curiosity", "Enough", "Every", "Everything",
                 "Exactly", "Fine", "For", "Plus"]:
        assert word not in found, f"{word} should not be offered as a name"


def test_the_real_names_survive(tmp_path):
    # The point of the exercise. Two people, out of a passage that used to
    # produce eighteen stops.
    folder = _project(tmp_path, {"01.md": _REAL_PROSE})
    found = {s.detail["name"] for s in
             scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)}
    assert found == {"Alexandra", "Kessler"}


def test_a_possessive_is_not_a_second_person(tmp_path):
    # "Alexandra's" was offered separately from "Alexandra", which asks the
    # writer to create the same character twice.
    folder = _project(tmp_path, {"01.md": _REAL_PROSE})
    found = {s.detail["name"] for s in
             scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)}
    assert "Alexandra's" not in found


def test_creating_the_entry_settles_every_form_of_the_name(tmp_path):
    # Including the possessive, which is what made it feel unfinished.
    folder = _project(tmp_path, {"01.md": _REAL_PROSE})
    alexandra = _thread("e-a", "Alexandra")
    found = {s.detail["name"] for s in
             scan(folder, [alexandra], REGISTRY).by_kind(STOP_UNSPUN)}
    assert found == {"Kessler"}


def test_the_writers_notes_are_read_as_evidence(tmp_path):
    # The suggestion from the walkthrough: look at what the writer has
    # already written elsewhere. A name used mid-sentence in the outline is a
    # name in the manuscript too, even where the manuscript only ever starts
    # sentences with it.
    folder = _project(tmp_path, {
        "01.md": "# One\nRavensmoor was cold.\n",
        "02.md": "# Two\nRavensmoor was always cold.\n",
    })
    assert scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN) == []

    os.makedirs(os.path.join(folder, "notes"), exist_ok=True)
    with open(os.path.join(folder, "notes", "outline.md"), "w",
              encoding="utf-8") as f:
        f.write("The keeper of Ravensmoor is loyal to the house.\n")

    stops = scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)
    assert [s.detail["name"] for s in stops] == ["Ravensmoor"]
    # And it SAYS so, because "you use this in your outline" is a far better
    # reason to make an entry than a frequency count.
    assert "outline" in stops[0].why


def test_existing_entries_count_as_evidence_too(tmp_path):
    folder = _project(tmp_path, {
        "01.md": "# One\nRavensmoor was cold.\n",
        "02.md": "# Two\nRavensmoor was always cold.\n",
    })
    keeper = _thread("e-k", "Mira", sections={
        "overview": {"heading": "Overview", "trait_blocks": [],
                     "content": "She keeps Ravensmoor for them."}})
    stops = scan(folder, [keeper], REGISTRY).by_kind(STOP_UNSPUN)
    assert [s.detail["name"] for s in stops] == ["Ravensmoor"]


def test_the_reason_given_is_the_rule_that_fired(tmp_path):
    # It used to say "appears N times", which was never the reason -- "All"
    # appears hundreds of times.
    folder = _project(tmp_path, {"01.md": _REAL_PROSE})
    stop = scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)[0]
    assert "capitalised where a sentence did not force it" in stop.why

# ── One question per thing, not per name ─────────────────────────────────────
# Reported after a live walkthrough: accepting "Lara Croft", "Lara" and "Croft"
# produced three entries where the writer meant one. The fix is upstream of the
# answer -- ask once.

_MANY_NAMES = """# Chapter One

She waited for Lara Croft. By dawn Lara had not come, and nobody had seen
Croft since the fire. They said Lara would be back.
"""


def test_one_stop_covers_a_name_and_its_variants(tmp_path):
    folder = _project(tmp_path, {"01.md": _MANY_NAMES})
    unspun = scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)
    assert [s.detail["name"] for s in unspun] == ["Lara Croft"]
    assert unspun[0].detail["also"] == ["Croft", "Lara"]


def test_the_stop_says_it_covers_them_all(tmp_path):
    # The part a writer would otherwise be surprised by.
    folder = _project(tmp_path, {"01.md": _MANY_NAMES})
    stop = scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)[0]
    assert "one entry covers all of them" in stop.why
    assert "'Lara'" in stop.why


def test_creating_it_once_settles_every_name(tmp_path):
    # The whole point. Three names, one entry, and none of them comes back.
    folder = _project(tmp_path, {"01.md": _MANY_NAMES})
    lara = _thread("e-lara", "Lara Croft", aliases=["Lara", "Croft"])
    assert scan(folder, [lara], REGISTRY).by_kind(STOP_UNSPUN) == []


def test_two_people_sharing_a_first_name_stay_two_questions(tmp_path):
    # Grouping them would be a wrong answer the writer could not see.
    folder = _project(tmp_path, {
        "01.md": "# One\nShe waited for John Vale. John Vale did not come.\n",
        "02.md": "# Two\nShe waited for John Thorne. John Thorne did not come.\n",
    })
    names = {s.detail["name"] for s in scan(folder, [], REGISTRY).by_kind(STOP_UNSPUN)}
    assert names == {"John Vale", "John Thorne"}


def test_a_retired_group_stays_retired_when_the_prose_gains_a_variant(tmp_path):
    # The stop is keyed on the primary alone. Keying it on the whole group
    # would forget a writer's "not a connection" the moment one more nickname
    # turned up in the text.
    folder = _project(tmp_path, {"01.md": _MANY_NAMES})
    request = ScanRequest(retired={"Lara Croft"})
    assert scan(folder, [], REGISTRY, request).by_kind(STOP_UNSPUN) == []


# ── One question per empty stub ───────────────────────────────────────────────
# Reported from live testing: a stop reading "Dean is missing Overview" sent the
# writer to the Profile Builder and stopped. An entry Weaving made from a name
# has no prose BY DEFINITION, so telling them to go and type is describing a
# symptom -- and reporting the same stub as both "too thin" and "nothing
# connects to this" asks them to answer one thing twice.

def _bare(entity_id, name):
    return _thread(entity_id, name, sections={
        "overview": {"heading": "Overview", "content": "", "trait_blocks": []}})


def test_an_empty_stub_is_not_also_reported_as_unconnected(tmp_path):
    # Both were true, and neither was the real question.
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    result = scan(folder, [_bare("e-dean", "Dean")], REGISTRY)
    assert result.by_kind(STOP_LOOSE) == []
    assert len(result.by_kind(STOP_FRAYED)) == 1


def test_the_stop_says_it_is_a_stub_so_the_walk_can_ask_what_it_is(tmp_path):
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    stop = scan(folder, [_bare("e-dean", "Dean")], REGISTRY).by_kind(STOP_FRAYED)[0]
    assert stop.detail["placeholder"] is True


def test_an_entry_with_writing_is_NOT_a_stub(tmp_path):
    # It genuinely needs prose typed into it, and the walk should say so.
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    thin = _thread("e-mira", "Mira", sections={
        "overview": {"heading": "Overview", "content": "Someone.",
                     "trait_blocks": []},
        "goals": {"heading": "Goals", "content": "", "trait_blocks": []}})
    registry = {**REGISTRY, "types": [
        {**REGISTRY["types"][0], "required_fields": ["overview", "goals"],
         "sections": [{"id": "overview", "heading": "Overview", "trait_blocks": False},
                      {"id": "goals", "heading": "Goals", "trait_blocks": False}]},
        REGISTRY["types"][1],
    ]}
    stop = scan(folder, [thin], registry).by_kind(STOP_FRAYED)[0]
    assert stop.detail["placeholder"] is False


def test_an_entry_with_a_connection_is_no_longer_a_stub(tmp_path):
    # A writer who tied it to something has said what it is, even with no prose.
    folder = _project(tmp_path, {"01.md": "# One\nRain.\n"})
    tied = _bare("e-dean", "Dean")
    tied["ties"] = [{"rel": "knows", "target": "e-other"}]
    stop = scan(folder, [tied], REGISTRY).by_kind(STOP_FRAYED)[0]
    assert stop.detail["placeholder"] is False
