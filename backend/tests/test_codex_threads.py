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
        "reason": "", "reason_inverse": "", "rel_inverse": "",
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


def test_the_other_end_can_be_a_DIFFERENT_relation():
    # Asked for exactly this way: "Alexandra friends of Lara Croft / in reverse /
    # Lara Croft business partners with Alexandra." The registry's own inverse is
    # the default; this overrides it for one connection, because a relationship
    # can genuinely be one thing to one person and another to the other and
    # neither of them is wrong.
    md = """---
type: character
entity_id: e-1
name: Alexandra Langford
ties:
  - rel: friend_of
    rel_inverse: partners_with
    target: e-lara
    reason: "Ran into her and quickly became friends"
    reason_inverse: "Was researching a cure and ran into her"
---

# Overview
A tall woman.
"""
    tie = parse_thread(md, REGISTRY)["ties"][0]
    assert tie["rel"] == "friend_of"
    assert tie["rel_inverse"] == "partners_with"
    again = parse_thread(render_thread(parse_thread(md, REGISTRY)), REGISTRY)
    assert again["ties"][0]["rel_inverse"] == "partners_with"


def test_an_unstated_reverse_relation_stays_empty():
    # Empty means "use the registry's inverse", which is right almost always.
    # Writing a default in would make every connection in the book claim the
    # writer had thought about its reverse.
    tie = parse_thread(FULL, REGISTRY)["ties"][0]
    assert tie["rel_inverse"] == ""
    assert "rel_inverse:" not in render_thread(parse_thread(FULL, REGISTRY))


# ── A section may hold trait blocks AND prose ───────────────────────────────
#
# The profile editor gives every section a prose box and a trait list, so a
# writer filling in both is doing something ordinary. YAML cannot: a list
# followed by a sentence is not one document. The first version parsed the
# whole section body at once, so ONE trailing line under the traits made the
# entire list read back as prose -- every trait's importance gone, every word
# still on screen, nothing looking broken.
#
# Found by writing the route-level test that did not exist while pointing the
# profile editor at this format.

BOTH = """---
type: character
entity_id: e-both
name: Elara Voss
---

# Overview
- trait: guarded
  description: "Keeps her own counsel."
  importance: core

- trait: haunted
  description: "Will not say what she saw."
  importance: hidden
  ai_scope: on-request

She is taller than her mother was, and says so often.

## AI Summary: Overview
_Generated on demand._
"""


def test_traits_and_the_paragraph_under_them_both_survive():
    thread = parse_thread(BOTH, REGISTRY)
    section = thread["sections"]["overview"]
    assert [b["trait"] for b in section["trait_blocks"]] == ["guarded", "haunted"]
    assert "taller than her mother" in section["content"]


def test_the_importance_of_each_trait_survives_the_paragraph():
    # The half that used to disappear silently.
    section = parse_thread(BOTH, REGISTRY)["sections"]["overview"]
    # `importance: hidden` in the file said two things at once: this is a secret,
    # AND this barely matters. It reads now as the first plus a weight, because
    # the second was untrue of most secrets -- the writer's villain avoids
    # hospitals for a reason that drives half his scenes.
    assert [b["importance"] for b in section["trait_blocks"]] == ["core", "present"]
    assert section["trait_blocks"][1]["subtext"] is True
    # And NOT withheld: an earlier pass set on-request here, which stops the
    # model naming the secret by stopping it knowing the secret.
    assert not section["trait_blocks"][1]["ai_scope"]


def test_a_file_can_be_read_exactly_as_written():
    # The comparison a writer sees after converting has to show what changed, so
    # it needs the file as WRITTEN rather than as understood. Healing both sides
    # would make the one content change invisible.
    section = parse_thread(BOTH, REGISTRY, heal_legacy=False)["sections"]["overview"]
    assert section["trait_blocks"][1]["importance"] == "hidden"


def test_it_round_trips_through_a_render():
    once = parse_thread(BOTH, REGISTRY)
    twice = parse_thread(render_thread(once, REGISTRY), REGISTRY)
    assert twice["sections"]["overview"]["trait_blocks"] == \
        once["sections"]["overview"]["trait_blocks"]
    assert twice["sections"]["overview"]["content"] == \
        once["sections"]["overview"]["content"]


def test_prose_that_merely_starts_with_a_dash_is_still_prose():
    # The tolerance that stops a hand-edited file losing a section: only a
    # real "- trait:" opener is treated as a list.
    raw = BOTH.replace("- trait: guarded", "- she was never guarded")
    section = parse_thread(raw, REGISTRY)["sections"]["overview"]
    assert section["trait_blocks"] == []
    assert "never guarded" in section["content"]


# ── A colon in a value, which the app's own content puts there ───────────────
#
# THE BUG THIS PINS WAS OURS, and it was reported by the writer as "Personality
# traits no longer create individual tiles -- saving groups them all into notes".
# That is exactly what it looked like from outside, and nothing raised anything.
#
# `render_thread` wrote a trait name as a bare YAML scalar. The Story Role picker
# in the Profile Builder inserts a trait called "Story role: Comic Relief", and a
# colon-space ends the key -- so that line stopped being a mapping and the WHOLE
# list failed to parse. The tolerant fallback then did its job perfectly and kept
# every word as prose, which is why six trait cards became one paragraph.
#
# Personality Traits was the only section affected because it is the only section
# the spine pickers write into. That is the shape of this class of bug: one
# section, one writer, no error, and the words all still there.

def _one_trait(name: str) -> dict:
    return {
        "type": "character", "entity_id": "e-1", "name": "Newton",
        "sections": {"personality_traits": {
            "heading": "Personality Traits", "content": "",
            "trait_blocks": [
                {"trait": name, "description": "d", "importance": "core"},
                {"trait": "Highly Anxious", "description": "d2",
                 "importance": "present"},
            ]}},
    }


def test_a_trait_name_with_a_colon_survives_a_round_trip():
    # "Story role: Comic Relief" is canned content this app ships, so this is not
    # an exotic hand-edit -- it is what the Story Role button produces.
    thread = _one_trait("Story role: Comic Relief")
    back = parse_thread(render_thread(thread, REGISTRY), REGISTRY)
    section = back["sections"]["personality_traits"]
    assert [b["trait"] for b in section["trait_blocks"]] == [
        "Story role: Comic Relief", "Highly Anxious"]
    # And nothing fell through into prose, which is how the failure showed.
    assert section["content"] == ""


def test_one_bad_trait_does_not_take_the_whole_list_with_it():
    # The cost of the bug was never one trait. YAML fails on the document, so a
    # single colon cost the writer every card in the section.
    thread = _one_trait("Story role: Comic Relief")
    assert len(parse_thread(render_thread(thread, REGISTRY),
                            REGISTRY)["sections"]["personality_traits"]
               ["trait_blocks"]) == 2


def test_other_characters_yaml_minds_are_quoted_too():
    for name in ("- leading dash", "#hash first", "trailing colon:",
                 "colon: inside", "*star", "{brace}", "[bracket]",
                 "quote\" inside", "hash # comment"):
        thread = _one_trait(name)
        back = parse_thread(render_thread(thread, REGISTRY), REGISTRY)
        got = back["sections"]["personality_traits"]["trait_blocks"]
        assert [b["trait"] for b in got][0] == name, name


def test_the_written_file_quotes_a_colon_rather_than_relying_on_the_repair():
    # ASSERTED ON THE FILE, not on a round trip. The read-time repair catches a
    # badly written trait on the way back in, so a round-trip test passes whether
    # or not the write side is fixed -- and that repair exists only for the files
    # already on disk. Without this, the app would go on writing files that need
    # repairing forever and every test would stay green.
    text = render_thread(_one_trait("Story role: Comic Relief"), REGISTRY)
    assert '- trait: "Story role: Comic Relief"' in text


def test_an_ordinary_trait_name_is_still_written_bare():
    # Quoting only when needed is the point. These files are the writer's own
    # Markdown and they open them elsewhere; quoting everything would also
    # rewrite every entry in every project on its next save, which is a diff of
    # pure noise over content that did not change.
    text = render_thread(_one_trait("Genuinely Concerned"), REGISTRY)
    assert "- trait: Genuinely Concerned" in text
    assert '- trait: "Genuinely Concerned"' not in text


def test_a_file_already_broken_on_disk_is_repaired_on_read():
    # The write side is fixed, so no NEW file can be written this way. This is
    # for the ones already on disk -- read-time repair, for the same reason
    # section aliases are read-time: it takes effect the moment the file is
    # opened, and heals for good on the next save.
    broken = """---
type: character
entity_id: e-1
name: Newton
---

# Personality Traits
- trait: Genuinely Concerned
  description: "Cares, awkwardly."
  importance: background

- trait: Story role: Comic Relief
  description: "The pressure gauge disguised as a punchline."
  importance: core

## AI Summary: Personality Traits
_Generated on demand._
"""
    section = parse_thread(broken, REGISTRY)["sections"]["personality_traits"]
    assert [b["trait"] for b in section["trait_blocks"]] == [
        "Genuinely Concerned", "Story role: Comic Relief"]
    assert section["content"] == ""


def test_the_repair_gives_up_rather_than_guessing():
    # A repair that guessed harder could change what a hand-edited file MEANS,
    # which is worse than leaving it as prose. One retry, then the words are
    # kept verbatim -- which is the parser's founding promise.
    hopeless = """---
type: character
entity_id: e-1
name: Newton
---

# Personality Traits
- trait: fine
   description: "indented wrongly"
  importance: core
    - and then this

## AI Summary: Personality Traits
_x_
"""
    section = parse_thread(hopeless, REGISTRY)["sections"]["personality_traits"]
    assert "indented wrongly" in section["content"]


def test_a_writers_own_quoting_is_left_alone():
    # If they already quoted it, the repair must not double-quote it.
    already = """---
type: character
entity_id: e-1
name: Newton
---

# Personality Traits
- trait: "Story role: Comic Relief"
  description: "Fine as written."
  importance: core

## AI Summary: Personality Traits
_x_
"""
    section = parse_thread(already, REGISTRY)["sections"]["personality_traits"]
    assert section["trait_blocks"][0]["trait"] == "Story role: Comic Relief"


def test_a_name_or_axis_with_a_colon_also_survives():
    # Same class, other fields. A character called "Doctor: The Return" and an
    # axis typed as "belief: father" are both things a writer can produce.
    thread = {
        "type": "character", "entity_id": "e-1", "name": "Doctor: The Return",
        "role": "Antagonist: reformed",
        "aliases": ["The Doctor: mk II"],
        "sections": {},
        "run": [{"id": "f-1", "axis": "belief: father", "value": "Dead."}],
    }
    back = parse_thread(render_thread(thread, REGISTRY), REGISTRY)
    assert back["name"] == "Doctor: The Return"
    assert back["role"] == "Antagonist: reformed"
    assert back["aliases"] == ["The Doctor: mk II"]
    assert back["run"][0]["axis"] == "belief: father"


# ── Ruling 6, the half that can be done today: one legacy repair, not two ─────
#
# The 2026-08-11 audit ordered the two Markdown dialects converged: "port its
# legacy-YAML repair across, then delete it once nothing calls it." The deletion
# is blocked -- `profiles/` is still a live home for unconverted projects, the
# same thing blocking R1.5b -- but the PORT is not, and it was hiding real data
# loss.
#
# Before v1.0.10 a trait's weight was `influence` on a five-value scale.
# profiles.py had translated it since the scale changed; THIS parser had never
# heard of it, so `importance` read as absent and every caller defaulted it to
# `background` -- the faintest weight. Converting an older project moved every
# carefully weighted trait to the bottom of the prompt, and `foreshadowing`,
# which meant SECRET rather than unimportant, lost its weight AND its secrecy.
#
# Nothing raised anything, because a weight is a number and there is no such
# thing as an obviously wrong one.

def _legacy(influence: str) -> dict:
    raw = f"""---
type: character
entity_id: e-1
name: Elara Voss
---

# Personality Traits
- trait: Fiercely loyal
  description: "She will not leave anyone behind."
  influence: {influence}

## AI Summary: Personality Traits
_x_
"""
    return parse_thread(raw, REGISTRY)["sections"]["personality_traits"][
        "trait_blocks"][0]


def test_the_old_influence_scale_becomes_a_weight():
    # The whole point: a trait the writer marked `major` must not arrive as the
    # faintest thing in the prompt.
    assert _legacy("major")["importance"] == "present"
    assert _legacy("core")["importance"] == "core"
    assert _legacy("minor")["importance"] == "background"
    assert _legacy("background")["importance"] == "contextual"


def test_the_old_foreshadowing_level_meant_secret_and_still_does():
    # It said "secret by intent", not "unimportant". Read as a weight alone it
    # lost the only thing it was actually claiming.
    block = _legacy("foreshadowing")
    assert block["subtext"] is True
    assert block["importance"] == "present"


def test_an_influence_this_build_does_not_know_is_not_a_secret():
    # A hand-typed or future value gets the cautious weight and NOT the secret
    # flag: guessing a secret wrong leaks it, and guessing a weight wrong only
    # mis-sorts it.
    block = _legacy("whatever-this-is")
    assert block["importance"] == "background"
    assert block["subtext"] is False


def test_a_modern_importance_wins_over_a_stale_influence():
    # A file part-way through the change carries both. The new field is the one
    # the writer has actually been editing, so it must not be overwritten.
    raw = """---
type: character
entity_id: e-1
name: Elara Voss
---

# Personality Traits
- trait: Fiercely loyal
  description: "d"
  importance: core
  influence: minor

## AI Summary: Personality Traits
_x_
"""
    block = parse_thread(raw, REGISTRY)["sections"]["personality_traits"][
        "trait_blocks"][0]
    assert block["importance"] == "core"


def test_the_old_field_is_kept_rather_than_stripped():
    # Nothing is ever lost is this parser's founding promise, and it applies to a
    # field we have finished with as much as to one we understand.
    assert _legacy("major")["influence"] == "major"


def test_both_dialects_read_the_same_map():
    # Ruling 6 in one assertion. The map used to live only in profiles.py, which
    # is exactly how the Weave's parser came not to know about it.
    from app.codex.normalize import INFLUENCE_TO_IMPORTANCE
    from app.routers.profiles import _INFLUENCE_TO_IMPORTANCE
    assert _INFLUENCE_TO_IMPORTANCE is INFLUENCE_TO_IMPORTANCE
