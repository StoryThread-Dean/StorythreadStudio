# tests/test_codex_threads.py -- a Thread on disk
# ================================================
# Markdown stays the source of truth for the Weave: copying the project
# folder takes the whole world model with it, and every file is readable and
# editable without the app.
#
# Which means these files get hand-edited, and the parser's most important
# property is not correctness on well-formed input -- it is that NOTHING IS
# EVER LOST on malformed input. A parser that silently drops what it does not
# recognise is a parser that eats a writer's work, and they will not notice
# until much later.
#
# The second property: ids are authoritative and names are commentary. A
# tie's target and a fact's frame are entity ids; the trailing "# Garrick
# Vale" is regenerated on save. Renaming a character must not be able to
# invalidate the epistemic state of the book.

from app.codex.threads import parse_thread, render_thread
from app.codex.types_registry import default_registry

REGISTRY = default_registry()

FULL = """---
type: character
entity_id: e-8f3c1a2b
name: Elara Voss
role: Protagonist
status: active
aliases:
  - Elara
  - the Thread-daughter
tags:
  - noble
fields:
  born: 1247
ties:
  - rel: mentored_by
    target: e-77b1e044
    at: c-aaa/s-a1
created_at: 2026-01-01T00:00:00+00:00
updated_at: 2026-01-02T00:00:00+00:00
---

# Overview
A tall woman with her father's hands.
## AI Summary: Overview
_Generated on demand. Editable by writer._

# Run
- id: f-a91c3d
  at: c-aaa/s-a2
  axis: belief.father
  value: "Believes her father died in the raid."
  frame: e-8f3c1a2b
  revealed_at: c-aaa/s-a2
  ai_scope: always

- id: f-77b1e0
  at: c-aaa/s-a1
  axis: fact.father
  value: "Garrick is alive, in hiding."
  frame: truth
  revealed_at: c-ccc/s-c1
  ai_scope: on-request
"""


# ── Reading ──────────────────────────────────────────────────────────────────

def test_the_frontmatter_is_read():
    thread = parse_thread(FULL, REGISTRY)
    assert thread["type"] == "character"
    assert thread["entity_id"] == "e-8f3c1a2b"
    assert thread["name"] == "Elara Voss"
    assert thread["aliases"] == ["Elara", "the Thread-daughter"]
    assert thread["tags"] == ["noble"]
    assert thread["fields"]["born"] == 1247


def test_the_writers_own_prose_is_read_separately_from_the_ai_summary():
    thread = parse_thread(FULL, REGISTRY)
    overview = thread["sections"]["overview"]
    assert overview["content"] == "A tall woman with her father's hands."
    assert "Generated on demand" in overview["ai_summary"]


def test_ties_are_read_with_their_anchor():
    thread = parse_thread(FULL, REGISTRY)
    assert thread["ties"] == [{
        "rel": "mentored_by", "target": "e-77b1e044", "at": "c-aaa/s-a1",
        "until": None,
        # Normalized on the way in: an unwritten frame IS objective truth and
        # an unwritten scope IS visible. Leaving these as None let every
        # consumer decide for itself, and they disagreed -- see
        # codex/normalize.py.
        "frame": "truth", "revealed_at": None, "ai_scope": "always",
        # This file predates the reason line, and an old project's connections
        # must not fail to load for lacking one. Empty, never None -- same
        # argument as frame and ai_scope above.
        "reason": "", "reason_inverse": "",
    }]


def test_the_run_is_read_as_facts():
    thread = parse_thread(FULL, REGISTRY)
    assert len(thread["run"]) == 2
    belief = thread["run"][0]
    assert belief["axis"] == "belief.father"
    assert belief["frame"] == "e-8f3c1a2b"
    assert belief["ai_scope"] == "always"
    assert thread["run"][1]["revealed_at"] == "c-ccc/s-c1"


def test_a_profile_id_is_accepted_as_an_entity_id():
    # Migration reads today's files, which say profile_id.
    thread = parse_thread("---\ntype: character\nprofile_id: 8f3c\nname: X\n---\n")
    assert thread["entity_id"] == "8f3c"


# ── Round trip ───────────────────────────────────────────────────────────────

def test_a_thread_survives_a_round_trip():
    once = parse_thread(FULL, REGISTRY)
    twice = parse_thread(render_thread(once, REGISTRY), REGISTRY)
    assert twice["name"] == once["name"]
    assert twice["aliases"] == once["aliases"]
    assert twice["ties"] == once["ties"]
    assert twice["run"] == once["run"]
    assert twice["sections"]["overview"]["content"] == \
        once["sections"]["overview"]["content"]


def test_rendering_is_stable_so_saving_twice_changes_nothing():
    # A file that churns on every save makes git history useless.
    once = parse_thread(FULL, REGISTRY)
    first = render_thread(once, REGISTRY)
    second = render_thread(parse_thread(first, REGISTRY), REGISTRY)
    assert first == second


def test_a_value_containing_quotes_survives():
    thread = parse_thread(FULL, REGISTRY)
    thread["run"][0]["value"] = 'She said "no" -- and meant it.'
    reparsed = parse_thread(render_thread(thread, REGISTRY), REGISTRY)
    assert reparsed["run"][0]["value"] == 'She said "no" -- and meant it.'


def test_a_multiline_value_is_collapsed_rather_than_breaking_the_file():
    thread = parse_thread(FULL, REGISTRY)
    thread["run"][0]["value"] = "line one\nline two"
    reparsed = parse_thread(render_thread(thread, REGISTRY), REGISTRY)
    assert reparsed["run"][0]["value"] == "line one line two"


# ── Nothing is ever lost ─────────────────────────────────────────────────────

def test_an_unparseable_run_is_preserved_verbatim():
    # THE rule. A bad indent must not cost the writer their Run.
    raw = FULL.replace('  axis: belief.father', '\tthis is not: valid: yaml: at all')
    thread = parse_thread(raw, REGISTRY)
    assert thread["run"] == []
    assert "this is not" in thread.get("run_raw", "")
    # And it comes back out again.
    assert "this is not" in render_thread(thread, REGISTRY)


def test_unreadable_frontmatter_does_not_cost_the_body():
    raw = "---\n\tbad: [unclosed\n---\n\n# Overview\nKeep this prose.\n"
    thread = parse_thread(raw, REGISTRY)
    assert thread["sections"]["overview"]["content"] == "Keep this prose."


def test_a_section_the_registry_does_not_know_about_is_kept():
    raw = FULL + "\n# Writer's Own Heading\nSomething personal.\n"
    thread = parse_thread(raw, REGISTRY)
    assert "writer_s_own_heading" in thread["sections"]
    assert "Writer's Own Heading" in render_thread(thread, REGISTRY)


def test_extra_keys_on_a_fact_are_not_dropped():
    raw = FULL.replace("  ai_scope: always", "  ai_scope: always\n  confidence: 0.8")
    thread = parse_thread(raw, REGISTRY)
    assert thread["run"][0]["confidence"] == 0.8


def test_an_author_only_thread_says_so_on_disk_and_survives_a_save():
    # A scope that cannot be persisted is no protection at all: the Thread
    # would read as ordinary the moment the file was written back.
    thread = parse_thread(FULL, REGISTRY)
    thread["ai_scope"] = "never"
    rendered = render_thread(thread, REGISTRY)
    assert "ai_scope: never" in rendered
    assert parse_thread(rendered, REGISTRY)["ai_scope"] == "never"


def test_an_ordinary_thread_writes_no_scope_line():
    # The default stays invisible, so an ordinary file is as short as it was.
    assert "ai_scope:" not in render_thread(parse_thread(FULL, REGISTRY), REGISTRY) \
        .split("---")[1]


def test_a_file_with_no_run_reads_as_a_thread_with_no_facts():
    raw = "---\ntype: lore\nentity_id: e-1\nname: The Weave\n---\n\n# Overview\nText.\n"
    thread = parse_thread(raw, REGISTRY)
    assert thread["run"] == []
    assert thread["name"] == "The Weave"


# ── Ids are authoritative, names are commentary ──────────────────────────────

def test_names_are_written_as_comments_beside_the_ids():
    thread = parse_thread(FULL, REGISTRY)
    rendered = render_thread(thread, REGISTRY, label_for=lambda i: {
        "e-77b1e044": "Garrick Vale", "e-8f3c1a2b": "Elara Voss",
    }.get(i))
    assert "target: e-77b1e044  # Garrick Vale" in rendered
    assert "frame: e-8f3c1a2b  # Elara Voss" in rendered


def test_the_comment_carries_no_authority():
    # Parsing must ignore it entirely -- a stale name beside a correct id
    # must never change what the id means.
    thread = parse_thread(FULL, REGISTRY)
    with_comments = render_thread(thread, REGISTRY, label_for=lambda i: "WRONG NAME")
    reparsed = parse_thread(with_comments, REGISTRY)
    assert reparsed["ties"][0]["target"] == "e-77b1e044"
    assert reparsed["run"][0]["frame"] == "e-8f3c1a2b"


def test_a_rename_changes_only_the_comment():
    thread = parse_thread(FULL, REGISTRY)
    before = render_thread(thread, REGISTRY, label_for=lambda i: "Garrick Vale")
    after = render_thread(thread, REGISTRY, label_for=lambda i: "Garrick Thorne")
    assert before != after
    assert parse_thread(before, REGISTRY)["ties"] == parse_thread(after, REGISTRY)["ties"]


def test_sections_are_written_in_the_registrys_order():
    # Every Thread of a type reads the same way, whatever order the writer's
    # file happened to have.
    raw = ("---\ntype: character\nentity_id: e-1\nname: X\n---\n\n"
           "# Notes\nLater.\n\n# Overview\nFirst.\n")
    rendered = render_thread(parse_thread(raw, REGISTRY), REGISTRY)
    assert rendered.index("# Overview") < rendered.index("# Notes")


# ── WHY two things are connected ─────────────────────────────────────────────
#
# The field that changed the Weave's direction. The app could already record
# that Alexandra and Dean are connected; what it could not record was that she
# is hiding her theft from him -- and only the second is worth the tokens it
# costs in an AI brief. A relation id is a category a model could mostly have
# guessed from the prose. A sentence in the writer's words is the scene.

WITH_REASON = """---
type: character
entity_id: e-1
name: Alexandra Langford
ties:
  - rel: connected_to
    target: e-2
    reason: "She is hiding her theft from him"
    reason_inverse: "Does not know she stole from him"
---

# Overview
A tall woman.
"""


def test_the_reason_is_read():
    tie = parse_thread(WITH_REASON, REGISTRY)["ties"][0]
    assert tie["reason"] == "She is hiding her theft from him"


def test_the_other_end_can_read_differently():
    # "Alexandra is hiding her theft from Dean" does not reverse cleanly -- from
    # Dean's end it is "does not know she stole from him". Optional, because a
    # writer mid-thought should not be made to answer twice.
    tie = parse_thread(WITH_REASON, REGISTRY)["ties"][0]
    assert tie["reason_inverse"] == "Does not know she stole from him"


def test_a_reason_survives_a_round_trip():
    thread = parse_thread(WITH_REASON, REGISTRY)
    again = parse_thread(render_thread(thread), REGISTRY)
    assert again["ties"][0]["reason"] == "She is hiding her theft from him"
    assert again["ties"][0]["reason_inverse"] == "Does not know she stole from him"


def test_prose_punctuation_survives_the_round_trip():
    # A reason is PROSE, so it will contain the things prose contains: colons,
    # quotes, and the app's own -- in place of an em dash. Written unquoted, a
    # colon would end the YAML value early and silently truncate the writer.
    messy = 'She hides one thing: the "theft" -- and he would fire her'
    thread = parse_thread(WITH_REASON, REGISTRY)
    thread["ties"][0]["reason"] = messy
    again = parse_thread(render_thread(thread), REGISTRY)
    assert again["ties"][0]["reason"] == messy


def test_a_connection_with_no_reason_still_loads():
    # Every connection made before this field existed. Refusing to load them
    # would be the app breaking the writer's files to enforce its own new rule.
    tie = parse_thread(FULL, REGISTRY)["ties"][0]
    assert tie["reason"] == ""


def test_an_empty_reason_is_not_written_back():
    # Nothing is gained by adding `reason: ""` to every connection in a book the
    # first time it saves, and a diff of pure noise over unchanged files costs
    # trust.
    thread = parse_thread(FULL, REGISTRY)
    assert "reason:" not in render_thread(thread)
