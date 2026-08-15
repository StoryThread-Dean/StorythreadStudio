# codex/extract.py -- reading the book and proposing what the entries should say
# ==============================================================================
# The Profile Extractor. Weaving finds the NAMES in a manuscript and asks the
# writer to describe them; this reads the prose and proposes the CONTENT. The
# writer's own framing, recorded in docs/roadmap.md:
#
#   "the Weaving does the first pass at creating the initial characters first
#    through the walkthrough, then B is the Profile Generator which picks up the
#    details and attaches them in segments to which a character / faction /
#    creature / government / lore can be built."
#
# WHAT IT IS FOR, WHICH DECIDES EVERYTHING ELSE:
#
#   "The true purpose of this is NOT the true accuracy that AI is literally going
#    to build the profile for the writer. Instead, this feature is to give
#    something to the writer for which he will edit / fine-tune / build from and
#    hone ... Simplify the Profile building process as this can be EXTREMELY time
#    consuming, just as long, if not longer than it takes for other writers to
#    write the entire book itself."
#
# A starting point, not an answer. Speed and editability outrank precision, and
# the review screen is the feature -- this module only makes its raw material.
#
# ── WHY THIS PASS DOES NOT VERIFY ITSELF, AND WHAT REPLACES THAT ─────────────
#
# `speaker_analysis.py` drops any proposal it cannot find in the source text
# character for character, because it wraps markup around the writer's own
# prose. That rule cannot apply here and it would be an error to copy it: an
# Overview is SYNTHESIS. "A guarded woman who counts exits" has no single source
# sentence, so quote-matching would discard nearly every proposal and the
# feature would look broken.
#
# So there is no evidence, no citation and no dropped count (roadmap decision 4),
# and the safeguard moves entirely to two other places:
#
#   1. THE WRITE BOUNDARY IS THE WHOLE PROTECTION. Nothing here reaches a
#      profile without a per-item click. No apply-all, nothing pre-ticked.
#   2. THE SCREEN SAYS IT IS UNCHECKED, in its own words rather than a footnote.
#
# ── WHAT IT CAN SEE THAT WEAVING CANNOT ─────────────────────────────────────
#
# Two whole classes of character, both found in live testing of a real book:
#
#   - DESCRIBED, NEVER NAMED. "The hulking figure", "the tall man". These are
#     real characters with roles and reveals, and no capitalisation rule will
#     ever find them, because deciding "the tall man" is a person while "the long
#     hallway" is not is a reading rather than arithmetic.
#   - NAMED, BUT ONLY WHERE A CAPITAL WAS REQUIRED ANYWAY. `"Duncan," he said`
#     is the most ordinary way a name reaches a reader and the scan cannot see
#     it (pinned in test_codex_mentions.py). A model reading the prose gets these
#     right for free while it is already reading for the first case.

import json
import re

# ── The prompt ───────────────────────────────────────────────────────────────
#
# Written as an instruction to a reader, not a writer. Every rule here exists
# because of a specific way this can go wrong, and the ones about NOT inventing
# are the load-bearing ones: with no evidence carried, an invented detail is
# indistinguishable from an observed one by the time the writer sees it.

EXTRACT_PROMPT = """You read a novel and propose what the author's story-bible entries should say about the people, places and things in it.

The author already has some entries. You will be given a short extract of each. Build on those rather than starting over: propose what is MISSING or what the manuscript shows more clearly, and do not restate what the extract already says.

Return JSON in exactly this shape:

{
  "entries": [
    {
      "match": "the exact name of an existing entry, or empty if this is new",
      "type": "one of the type ids you were given",
      "name": "what to call this",
      "aliases": ["other names the prose uses for it"],
      "unnamed": false,
      "same_as": "an existing entry name, if this turns out to BE that one",
      "sections": [
        {"id": "a section id you were given", "text": "prose for that section"},
        {"id": "a section id that takes traits",
         "traits": [{"name": "a short label", "description": "one or two sentences"}]}
      ]
    }
  ]
}

RULES

1. GROUND EVERYTHING IN THE MANUSCRIPT. Every proposal must come from what the text actually shows. Do not invent a backstory, a motive, an appearance or a name that is not there. If the book does not say, leave the field out -- an empty section is useful and a plausible invention is not.

2. CHARACTERS THE PROSE DESCRIBES BUT NEVER NAMES ARE STILL CHARACTERS. "The tall man", "the hulking figure", "the woman with the burned hands". Propose them, set "unnamed": true, and USE THE DESCRIPTION AS THE NAME exactly as the prose phrases it. Never invent a name for them. Never call them "Unknown Man 1".

3. IF THE BOOK LATER REVEALS ONE OF THOSE TO BE SOMEBODY, say so with "same_as" and keep the description as the name. Do not merge them yourself. The author decides whether two labels are one person.

4. NAMES YOU FIND ONLY IN DIALOGUE COUNT. A name that only ever appears as someone being spoken to -- "Duncan," he said -- is a real character.

5. WRITE FOR THE AUTHOR, NOT ABOUT THE BOOK. "Keeps his sleeves down and his hands out of sight" is useful. "This character is portrayed as secretive" is a book report. No literary analysis, no themes, no praise.

6. TRAITS ARE SHORT. A trait is a label of two to five words and a description of one or two sentences. Not a paragraph.

7. STAY INSIDE THE SECTION IDS AND TYPE IDS YOU ARE GIVEN. Each type has its OWN sections and they are not the same: a character has no "abilities", a government has no "goals". Check the list for THAT type before you use a section id. If something you want to say does not fit any of that type's sections, put it in "notes".

8. SPOILERS ARE FINE. This is the author's own reference, not a reader's. Say what happens.

9. Never use em dash or en dash characters. Use a double hyphen instead.

10. Return only the JSON object. No commentary before or after it.

You are reading and summarising. You are not writing the book, continuing it, or improving it."""


def _clip(text: str, limit: int) -> str:
    """Cut to a length without slicing a word in half."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "..."


def entry_snippet(thread: dict, *, limit: int = 400) -> str:
    """
    A short extract of what an entry already says.

    THIS IS THE MATCHING MECHANISM, and it is roadmap decision 3 rather than an
    optimisation: the request carries a taste of every established entry so the
    pass has something to attach to. Without it the model proposes "Rosie" from
    scratch, ignorant of the two paragraphs the writer already wrote, and every
    proposal arrives as a rewrite of work they had finished.

    Deliberately SHORT. The whole point is orientation, not context: sending
    every entry in full would double the cost of the request to tell the model
    things it is not being asked about.
    """
    parts: list[str] = []
    for section in (thread.get("sections") or {}).values():
        content = (section.get("content") or "").strip()
        if content:
            parts.append(content)
        for block in section.get("trait_blocks") or []:
            name = (block.get("name") or "").strip()
            if name:
                parts.append(name)
        if sum(len(p) for p in parts) > limit:
            break
    return _clip(" / ".join(parts), limit)


def build_user_message(chapters: list[tuple[str, str]],
                       known: list[dict],
                       types: list[dict]) -> str:
    """
    The manuscript, the entries that already exist, and the shape to answer in.

    `chapters` is [(title, prose)] in reading order. Whole-manuscript is the
    recommended path and per-chapter is for addenda afterwards, but either way
    the ticked chapters go up as ONE request rather than one request each --
    the writer asked for that explicitly, and it is also the only way the pass
    can see that a character from chapter two has come back in chapter eleven.
    """
    lines: list[str] = []

    lines.append("TYPES YOU MAY PROPOSE, and the sections each one has.")
    lines.append("Use these ids exactly. Sections marked (traits) take a list "
                 "of short labelled traits; the others take prose.")
    lines.append("")
    for type_entry in types:
        section_bits = []
        for section in type_entry.get("sections") or []:
            mark = " (traits)" if section.get("trait_blocks") else ""
            section_bits.append(f"{section['id']}{mark}")
        lines.append(f"- {type_entry['id']} ({type_entry.get('label', '')}): "
                     + ", ".join(section_bits))
    lines.append("")

    if known:
        lines.append("ENTRIES THE AUTHOR ALREADY HAS. Build on these. Propose "
                     "what is missing rather than restating what is here, and "
                     "use \"match\" with the exact name to attach to one.")
        lines.append("")
        # LEAVE-ALONE ENTRIES ARE STILL LISTED, and getting this wrong is a
        # trap I walked into and only found by running the route against a real
        # book. "Leave this one alone" means do not propose CHANGES to it. It
        # does not mean hide it, and hiding it is actively harmful: the model
        # reads the prose, sees a character it was never told about, and
        # proposes them as NEW. On the writer's own project every entry was
        # substantial enough to be ticked by default, so hiding them would have
        # turned a sensible default into eleven duplicate proposals -- the
        # feature failing worst exactly where it was working best.
        for item in known:
            snippet = item.get("snippet") or "(nothing written yet)"
            alias_note = ""
            if item.get("aliases"):
                alias_note = "  [also called: " + ", ".join(item["aliases"]) + "]"
            mark = "  [LEAVE ALONE]" if item.get("leave_alone") else ""
            lines.append(f"- {item['name']} ({item['type']}){alias_note}{mark}: "
                         f"{snippet}")
        lines.append("")
        if any(item.get("leave_alone") for item in known):
            lines.append("Entries marked [LEAVE ALONE] are finished. Do not "
                         "propose anything for them. They are listed so you "
                         "recognise them in the prose and do not offer them "
                         "back as new.")
            lines.append("")
    else:
        # Said out loud so the model does not read the absence as "there is no
        # world" and propose one from nothing. It also matches what the setup
        # screen tells the writer: run Weaving first.
        lines.append("THE AUTHOR HAS NO ENTRIES YET. Propose what the "
                     "manuscript shows, and expect everything to be new.")
        lines.append("")

    lines.append("THE MANUSCRIPT")
    lines.append("")
    for title, prose in chapters:
        lines.append(f"--- BEGIN {title} ---")
        lines.append(prose.strip())
        lines.append(f"--- END {title} ---")
        lines.append("")

    return "\n".join(lines)


# ── Reading the answer back ──────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.MULTILINE)


def _loads(raw: str) -> dict | None:
    """
    The JSON, however the model wrapped it.

    Models fence JSON in Markdown perhaps a third of the time whatever the
    prompt says, and a pass that threw the whole answer away over three
    backticks would look like a model that found nothing.
    """
    if not raw or not raw.strip():
        return None
    text = _FENCE_RE.sub("", raw).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Last resort: the outermost braces. Covers a model that prefaced its
    # answer with a sentence despite being told not to.
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


def _fallback_section(type_entry: dict) -> dict | None:
    """
    Where content lands when the model proposes a section this kind lacks.

    THE PROBLEM THIS SOLVES, reported from live use: the model proposed `goals`
    for a government and `abilities` for a character. Neither kind has those, so
    the whole section was thrown away -- and the writer lost real observations
    about their own book to a schema mismatch.

    The mistake is a reasonable one, which is worth noticing before blaming the
    model: `goals` IS a section, on factions. A government is close enough to a
    faction that the confusion is almost sensible, and no prompt will reliably
    stop it.

    So the content is kept and MOVED rather than dropped. Notes first, because
    it is the section every kind has and the one that means "things about this
    that do not fit anywhere else" -- which is exactly what this is. Overview if
    a custom kind has no notes; the first section if it somehow has neither.
    """
    sections = type_entry.get("sections") or []
    for wanted in ("notes", "overview"):
        for section in sections:
            if section.get("id") == wanted:
                return section
    return sections[0] if sections else None


def _section_index(types: list[dict]) -> dict[str, dict[str, dict]]:
    """{type id -> {section id -> section}}, so a proposal can be checked."""
    index: dict[str, dict[str, dict]] = {}
    for type_entry in types:
        index[type_entry["id"]] = {
            section["id"]: section
            for section in (type_entry.get("sections") or [])
        }
    return index


def salvage_entries(raw: str) -> list:
    """
    The complete entries out of an answer that was cut off part way.

    WHY THIS EXISTS. A live run against a seven-chapter novel used its entire
    32,000-token reply budget and was still truncated mid-sentence:

        ... now works for the City Cleanup operation alongside Owen Hask

    Everything before that point was perfectly good JSON describing a dozen
    characters the writer had paid real money for, and the app threw all of it
    away because the closing brackets were missing. An all-or-nothing parser
    turns a partial success into a total loss at the exact moment the writer
    can least afford it.

    So: walk the text, take every entry object that CLOSED, and stop at the one
    that did not. Deliberately conservative -- a half-written object is dropped
    rather than repaired, because inventing the missing half of a proposal is
    the one thing this feature must never do.
    """
    start = raw.find('"entries"')
    if start == -1:
        return []
    bracket = raw.find("[", start)
    if bracket == -1:
        return []

    entries = []
    depth = 0
    in_string = False
    escaped = False
    object_start = -1

    for index in range(bracket + 1, len(raw)):
        char = raw[index]

        # Strings first: a brace inside a description is not structure, and a
        # writer's prose is full of them.
        if in_string:
            if escaped:
                escaped = False
            elif char == chr(92):
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue

        if char == "{":
            if depth == 0:
                object_start = index
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0 and object_start != -1:
                chunk = raw[object_start:index + 1]
                try:
                    entries.append(json.loads(chunk))
                except json.JSONDecodeError:
                    pass
                object_start = -1
        elif char == "]" and depth == 0:
            break

    return entries


def parse_response(raw: str, types: list[dict]) -> tuple[list[dict], list[str]]:
    """
    ([proposal dicts], [reasons things were dropped]).

    Strict about SHAPE and permissive about CONTENT, which is the right split
    here. A section id that does not exist, or a type the writer's registry has
    never heard of, would produce a proposal with nowhere to land and a button
    that fails when pressed -- so those are dropped and counted. What is NOT
    checked is whether the prose is any good or true, because the writer is
    about to rewrite it anyway and there is nothing to check it against.

    Drops are returned rather than swallowed. The screen does not have to show
    them, but a pass that silently discarded half its answer with nothing in a
    position to notice is the failure this repo keeps finding.
    """
    payload = _loads(raw)
    if not isinstance(payload, dict):
        return [], ["The model did not return readable JSON."]

    raw_entries = payload.get("entries")
    if not isinstance(raw_entries, list):
        return [], ["The answer had no entries list."]

    return parse_proposals(raw_entries, types)


def parse_proposals(raw_entries: list, types: list[dict]) -> tuple[list[dict], list[str]]:
    """
    The same checks, starting from an entries list somebody else already parsed.

    Split out because `run_completion` parses the model's JSON itself and hands
    back the object. Re-serialising it just to parse it again here would be two
    chances to lose something, and this pass has already been bitten once by
    reading the answer out of the wrong place.
    """
    sections_for = _section_index(types)
    type_by_id = {t["id"]: t for t in types}
    proposals: list[dict] = []
    dropped: list[str] = []

    for item in raw_entries:
        if not isinstance(item, dict):
            dropped.append("An entry was not an object.")
            continue

        type_id = str(item.get("type") or "").strip()
        name = str(item.get("name") or "").strip()
        if not name:
            dropped.append("An entry had no name.")
            continue
        if type_id not in sections_for:
            dropped.append(f"{name}: proposed as '{type_id}', which is not a "
                           f"kind in this project.")
            continue

        parsed_sections: list[dict] = []
        for section in item.get("sections") or []:
            if not isinstance(section, dict):
                continue
            section_id = str(section.get("id") or "").strip()
            known = sections_for[type_id].get(section_id)
            adapted_from = ""
            if known is None:
                # MOVED, NOT LOST. See _fallback_section: a government has no
                # `goals` and a character has no `abilities`, and throwing the
                # content away costs the writer real observations about their
                # own book over a schema mismatch they did not make.
                known = _fallback_section(type_by_id.get(type_id) or {})
                if known is None:
                    dropped.append(f"{name}: nowhere to put '{section_id}'.")
                    continue
                adapted_from = section_id
                section_id = known["id"]

            if adapted_from and not known.get("trait_blocks"):
                # A trait list proposed for a section this kind lacks becomes
                # prose in the fallback. Guessing WHICH of the writer's real
                # trait sections the model meant would be inventing structure
                # they did not ask for, and a paragraph they can cut up is
                # honest about where it came from.
                lines = [str(section.get("text") or "").strip()]
                for trait in section.get("traits") or []:
                    if not isinstance(trait, dict):
                        continue
                    label = str(trait.get("name") or "").strip()
                    body_text = str(trait.get("description") or "").strip()
                    if label and body_text:
                        lines.append(f"{label}: {body_text}")
                    elif body_text:
                        lines.append(body_text)
                joined = chr(10).join(line for line in lines if line)
                if joined:
                    parsed_sections.append({
                        "id": section_id, "heading": known["heading"],
                        "traits": [], "text": joined, "trait_blocks": False,
                        "adapted_from": adapted_from,
                    })
                continue

            if known.get("trait_blocks"):
                traits = []
                for trait in section.get("traits") or []:
                    if not isinstance(trait, dict):
                        continue
                    trait_name = str(trait.get("name") or "").strip()
                    description = str(trait.get("description") or "").strip()
                    if not trait_name or not description:
                        continue
                    traits.append({"name": trait_name,
                                   "description": description})
                # A model will sometimes send prose for a trait section. Rather
                # than drop it, keep it as prose -- the section holds both, and
                # a paragraph the writer can cut is worth more than nothing.
                text = str(section.get("text") or "").strip()
                if traits or text:
                    parsed_sections.append({
                        "id": section_id, "heading": known["heading"],
                        "traits": traits, "text": text,
                        "trait_blocks": True,
                        "adapted_from": adapted_from,
                    })
            else:
                text = str(section.get("text") or "").strip()
                if text:
                    parsed_sections.append({
                        "id": section_id, "heading": known["heading"],
                        "traits": [], "text": text, "trait_blocks": False,
                        "adapted_from": adapted_from,
                    })

        if not parsed_sections:
            dropped.append(f"{name}: nothing usable in it.")
            continue

        aliases = [str(a).strip() for a in (item.get("aliases") or [])
                   if str(a).strip()]
        proposals.append({
            "match": str(item.get("match") or "").strip(),
            "type": type_id,
            "name": name,
            "aliases": aliases,
            "unnamed": bool(item.get("unnamed")),
            "same_as": str(item.get("same_as") or "").strip(),
            "sections": parsed_sections,
        })

    return proposals, dropped


# ── Turning proposals into the run the writer reviews ────────────────────────

def _match_existing(proposal: dict, alias_map: dict, by_id: dict) -> str:
    """
    Which existing entry this proposal is about, or "" for a new one.

    THE AMBIGUITY RULE IS THE ONE FROM mentions.py AND IT IS NOT NEGOTIABLE
    HERE EITHER: a name that answers to two entries binds to neither. Getting
    this wrong is invisible in the worst way -- the writer sees a proposal
    sitting under John Vale, presses Add, and it lands on John Thorne's page
    with nothing to suggest anything went wrong.

    So an ambiguous match falls through to "new", where the writer is shown the
    proposal as something unplaced and decides for themselves. A visible extra
    question beats a silent wrong answer.
    """
    for candidate in (proposal.get("match"), proposal.get("name")):
        key = str(candidate or "").strip().lower()
        if not key:
            continue
        ids = alias_map.get(key) or []
        if len(ids) == 1 and ids[0] in by_id:
            return ids[0]
    return ""


def build_run(proposals: list[dict], threads: list[dict], *,
              model_used: str = "", scope: dict | None = None,
              leave_alone: set[str] | None = None) -> dict:
    """
    Assemble the storable run: proposals matched to the world, split into parts.

    One part per clickable thing -- a section's prose is one, each trait is one.
    That granularity is roadmap decision 4 made concrete: with no evidence
    carried, the per-item click IS the safeguard, so the parts have to be the
    size of the decisions the writer is actually making.
    """
    from app.codex.extraction_store import (
        FORM_PROSE, FORM_TRAIT, new_entry, new_part, new_run,
    )
    from app.codex.mentions import build_alias_map

    run = new_run(model_used=model_used, scope=scope)
    alias_map = build_alias_map(threads)
    by_id = {str(t.get("entity_id") or ""): t for t in threads}
    by_name = {str(t.get("name") or "").strip().lower(): t for t in threads}

    excluded = set(leave_alone or ())

    for proposal in proposals:
        entity_id = _match_existing(proposal, alias_map, by_id)

        # THE GUARANTEE, not the hope. The prompt asks the model to leave these
        # alone and a model will sometimes propose for them anyway. Filtering
        # here is what makes the tick mean something: the writer said do not
        # touch this entry, so nothing about it reaches the review screen where
        # a click could put it into their finished work.
        if entity_id and entity_id in excluded:
            continue

        # "This described figure turns out to be somebody you have." Resolved to
        # an id here so the screen can offer the fold; left empty if it names
        # somebody the writer does not have, because an offer to merge into
        # nothing is a dead button.
        same_as = ""
        same_key = str(proposal.get("same_as") or "").strip().lower()
        if same_key:
            revealed = by_name.get(same_key)
            if revealed is None:
                ids = alias_map.get(same_key) or []
                if len(ids) == 1:
                    revealed = by_id.get(ids[0])
            if revealed is not None and str(revealed.get("entity_id")) != entity_id:
                same_as = str(revealed.get("entity_id") or "")

        entry = new_entry(
            entity_id=entity_id,
            type_id=proposal["type"],
            name=proposal["name"],
            aliases=proposal.get("aliases") or [],
            unnamed=bool(proposal.get("unnamed")),
            same_as=same_as,
            # Roadmap decision 9, and the same reasoning as R2.10a: a name the
            # prose mentions is far more often a shopkeeper than a viewpoint
            # character, and the two mistakes do not cost the same.
            character_kind="side" if proposal["type"] == "character" else "",
        )

        for section in proposal["sections"]:
            if section.get("text"):
                entry["parts"].append(new_part(
                    section_id=section["id"], heading=section["heading"],
                    form=FORM_PROSE, content=section["text"],
                    adapted_from=section.get("adapted_from", ""),
                ))
            for trait in section.get("traits") or []:
                entry["parts"].append(new_part(
                    section_id=section["id"], heading=section["heading"],
                    form=FORM_TRAIT, trait_name=trait["name"],
                    content=trait["description"],
                ))

        if entry["parts"]:
            run["entries"].append(entry)

    return run


# ── Splitting a book into requests that can be answered ─────────────────────
#
# A novel's worth of proposals does not fit in one reply, and no output budget
# fixes that. Measured on the writer's own book: 44,227 input tokens produced
# more than 32,000 output tokens and was still cut off. The answer is roughly
# three quarters the size of the prose that produced it, and it grows with the
# book while the reply budget does not.
#
# So the book is split. Each batch is one request, its results are merged into
# one run, and the writer sees a single list at the end.

# Input tokens per batch. Chosen from the measurement above with room to spare:
# at roughly 0.75 output tokens per input token, 25,000 in should produce about
# 19,000 out, comfortably inside a 64,000 budget even when a chapter is unusually
# dense with new characters.
#
# DELIBERATELY CONSERVATIVE. Making batches too small costs a few more requests,
# which is cheap and invisible. Making them too big costs a truncated answer,
# which the writer pays for twice: once in tokens and once in the work of
# noticing. When in doubt, more batches.
BATCH_INPUT_TOKENS = 25_000

# Never split so finely that a chapter is its own request purely because the
# arithmetic said so. A chapter always travels whole -- half a scene tells a
# model nothing useful about who is in it.
CHARS_PER_TOKEN = 4


def plan_batches(chapters: list[dict], *,
                 budget_tokens: int = BATCH_INPUT_TOKENS) -> list[list[str]]:
    """
    [[chapter_id, ...], ...] -- the chapters grouped into answerable requests.

    Chapters stay whole and stay in order: a batch is a run of consecutive
    chapters, so the model reads a continuous stretch of the book rather than
    an arbitrary selection of it. That matters for exactly the reason the
    writer wanted whole-book runs in the first place -- a character introduced
    in one chapter and returning three later is only visible if both are in the
    same reading.

    A single chapter larger than the budget still gets its own batch rather
    than being split. It may truncate, and salvage handles that; cutting a
    chapter in half would guarantee a worse answer.
    """
    batches: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0

    for chapter in chapters:
        chapter_tokens = int(chapter.get("chars", 0)) // CHARS_PER_TOKEN
        if current and current_tokens + chapter_tokens > budget_tokens:
            batches.append(current)
            current, current_tokens = [], 0
        current.append(chapter["chapter_id"])
        current_tokens += chapter_tokens

    if current:
        batches.append(current)
    return batches
