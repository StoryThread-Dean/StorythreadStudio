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
    folder = _project(tmp_path, {
        "01.md": "# One\nGarrick rode north.\n",
        "02.md": "# Two\nGarrick did not return.\n",
    })
    result = scan(folder, [_thread("e-1", "Elara")], REGISTRY)
    unspun = result.by_kind(STOP_UNSPUN)
    assert [s.detail["name"] for s in unspun] == ["Garrick"]
    assert unspun[0].detail["count"] == 2


def test_unspun_counts_across_the_whole_book_not_per_chapter(tmp_path):
    # A name appearing once in each of twelve chapters is a character.
    # Per-chapter counting would never notice.
    chapters = {f"{i:02d}.md": f"# {i}\nGarrick waited.\n" for i in range(1, 4)}
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
        "01.md": "# One\nGarrick rode north through the ash.\n",
        "02.md": "# Two\nGarrick did not return.\n",
    })
    stop = scan(folder, [_thread("e-1", "Elara")], REGISTRY).by_kind(STOP_UNSPUN)[0]
    assert "Garrick rode north" in stop.quote
    assert stop.chapter_id and stop.evidence_hash


def test_a_retired_phrase_never_comes_back(tmp_path):
    folder = _project(tmp_path, {
        "01.md": "# One\nGarrick rode north.\n",
        "02.md": "# Two\nGarrick did not return.\n",
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
        "01.md": "# One\nGarrick rode north.\n",
        "02.md": "# Two\nGarrick did not return.\n",
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
        "01.md": "# One\nGarrick rode north.\n",
        "02.md": "# Two\nGarrick did not return.\n",
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
        "01.md": "# One\nGarrick rode north.\n",
        "02.md": "# Two\nGarrick did not return.\n",
    })
    threads = [_thread("e-1", "Elara")]
    first = [s.key for s in scan(folder, threads, REGISTRY).stops]
    second = [s.key for s in scan(folder, threads, REGISTRY).stops]
    assert first == second
