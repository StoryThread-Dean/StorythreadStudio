# codex/threads.py -- a Thread on disk
# =====================================
# A Thread (the writer's word; "entity" in code) is one entry in the Weave:
# a character, a faction, an object, a concept. It is a Markdown file, and
# Markdown stays the source of truth -- copying the project folder takes the
# whole world model with it, and everything in here is readable and editable
# without the app.
#
# The format is deliberately additive over today's profile files, so the
# migration is close to a rename:
#
#     ---
#     type: character
#     entity_id: e-8f3c1a2b
#     name: Elara Voss
#     aliases: [Elara, the Thread-daughter]
#     tags: [noble]
#     fields:
#       born: 1247
#     ties:
#       - rel: mentored_by
#         target: e-77b1e044        # Garrick Vale
#         at: c-aaa/s-a1
#     ---
#
#     # Overview
#     ...the writer's own prose, unchanged...
#     ## AI Summary: Overview
#     ...
#
#     # Run                          <- NEW
#     - id: f-a91c3d
#       at: c-aaa/s-a2               # Chapter 1, Scene 2
#       axis: belief.father
#       value: "Believes her father died in the raid."
#       frame: e-8f3c1a2b            # Elara Voss
#       revealed_at: c-aaa/s-a2
#       ai_scope: always
#
# TWO PROPERTIES THAT MATTER MORE THAN ELEGANCE
#
# 1. NOTHING IS EVER LOST. A section body that does not parse as expected
#    round-trips as raw text rather than vanishing -- the same tolerance the
#    existing profile parser has, and for the same reason: a writer hand-edits
#    these files, and a parser that silently drops what it does not recognise
#    is a parser that eats work.
#
# 2. IDS ARE AUTHORITATIVE, NAMES ARE COMMENTARY. A tie's target and a fact's
#    frame are entity ids; the trailing "# Garrick Vale" is regenerated on
#    save for human readers and carries no weight. Renaming a character
#    therefore cannot invalidate the epistemic state of the book.

import datetime as _datetime
import re
from typing import Callable

import yaml

from app.codex.normalize import normalize_ai_scope, normalize_fact, normalize_tie

RUN_HEADING = "Run"
FULL_SUMMARY_HEADING = "Full AI Summary"

# Fields a fact may carry. Anything else a writer adds is preserved as-is.
FACT_KEYS = ("id", "at", "axis", "value", "frame", "revealed_at", "ai_scope",
             "supersedes", "intentional")
TIE_KEYS = ("rel", "rel_inverse", "target", "reason", "reason_inverse",
            "at", "until", "frame", "revealed_at", "ai_scope")
TRAIT_KEYS = ("trait", "description", "importance", "ai_scope")

_SECTION_SPLIT_RE = re.compile(r"^# (.+)$", re.MULTILINE)
_AI_SUMMARY_RE = re.compile(r"^## AI Summary:.*$", re.MULTILINE)


# ── Reading ──────────────────────────────────────────────────────────────────

def _split_frontmatter(raw: str) -> tuple[dict, str]:
    """(frontmatter, body). A file without frontmatter is all body."""
    if not raw.startswith("---"):
        return {}, raw
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {}, raw
    try:
        data = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        # Unreadable frontmatter must not cost the writer the whole file.
        return {}, parts[2]
    return (data if isinstance(data, dict) else {}), parts[2]


def _split_ai_summary(body: str) -> tuple[str, str]:
    """(content, ai_summary) for one section."""
    match = _AI_SUMMARY_RE.search(body)
    if not match:
        return body.strip(), ""
    return body[:match.start()].strip(), body[match.end():].strip()


def _split_leading_list(body: str) -> tuple[str, str]:
    """
    Split a leading YAML list off whatever prose follows it.

    A section is allowed to hold trait blocks AND a paragraph -- the profile
    editor gives every section both -- but YAML cannot: a list followed by a
    sentence is not one document, and parsing the whole body fails, which
    used to make the entire section read back as prose. So the list is cut
    off first, at the first non-blank line in column 1 that does not open a
    new item, and only that part is handed to the parser.

    Blank lines BETWEEN items belong to the list; blank lines before the
    prose belong to the prose. Which is why they are buffered rather than
    decided on sight.
    """
    lines = body.split("\n")
    taken: list[str] = []
    pending: list[str] = []
    rest_at = len(lines)
    for index, line in enumerate(lines):
        if not line.strip():
            pending.append(line)
            continue
        if line.startswith("- ") or line.startswith((" ", "\t")):
            taken.extend(pending)          # those blanks were inside the list
            pending = []
            taken.append(line)
            continue
        rest_at = index - len(pending)     # the prose starts at its own blanks
        break
    return "\n".join(taken), "\n".join(lines[rest_at:])


def _parse_list_block(body: str, keys: tuple[str, ...]) -> tuple[list[dict], str]:
    """
    Parse a YAML list of records, keeping anything unrecognised.

    Returns (records, leftover_raw). Leftover is whatever followed the list --
    prose a writer put under their trait blocks, kept rather than swallowed.
    When the block does not parse as a list at all, records is empty and the
    ENTIRE body comes back as leftover so the caller can round-trip it
    untouched. Losing a writer's hand-edited Run because of one bad indent
    would be unforgivable.
    """
    if not body.strip():
        return [], ""
    text, rest = _split_leading_list(body)
    text = text.strip()
    if not text:
        return [], body
    try:
        loaded = yaml.safe_load(text)
    except yaml.YAMLError:
        return [], body
    if not isinstance(loaded, list):
        return [], body

    records: list[dict] = []
    for item in loaded:
        if not isinstance(item, dict):
            continue
        record = {k: item.get(k) for k in keys}
        # Keep any extra keys the writer invented rather than dropping them.
        for k, v in item.items():
            if k not in keys:
                record[k] = v
        records.append(record)
    return records, rest


def parse_thread(raw: str, registry: dict | None = None) -> dict:
    """
    Read a Thread file into a dict. Never raises on malformed content --
    the worst case is that a section round-trips as raw text.
    """
    front, body = _split_frontmatter(raw)

    thread: dict = {
        "type": str(front.get("type") or ""),
        "entity_id": str(front.get("entity_id") or front.get("profile_id") or ""),
        "name": str(front.get("name") or ""),
        "role": str(front.get("role") or ""),
        "status": str(front.get("status") or "active"),
        # Whether AI may see this entry AT ALL. Distinct from a fact's scope:
        # "never" here means the whole Thread is author-only, however
        # ordinary its individual facts are.
        "ai_scope": normalize_ai_scope(front.get("ai_scope")),
        "aliases": [str(a) for a in (front.get("aliases") or []) if a],
        # WHAT THE WRITER WANTS TO SEE THIS CALLED, which is not always its
        # name. Alexandra Langford may be the official name on the profile
        # while the story, and everyone in it, only ever says Lexa -- so the
        # map should say Lexa. Empty means "use the name", which is the
        # ordinary case and writes nothing to the file.
        "display_name": str(front.get("display_name") or ""),
        "tags": [str(t) for t in (front.get("tags") or []) if t],
        "fields": dict(front.get("fields") or {}),
        "created_at": _stamp(front.get("created_at")),
        "updated_at": _stamp(front.get("updated_at")),
        # Only written when "side" -- same rule the profile format uses, so
        # a Main character's file stays byte-identical through migration.
        "character_kind": str(front.get("character_kind") or ""),
        "full_ai_summary": "",
        "sections": {},
        "ties": [],
        "run": [],
    }

    ties = front.get("ties")
    if isinstance(ties, list):
        for tie in ties:
            if isinstance(tie, dict) and tie.get("rel") and tie.get("target"):
                record = {k: tie.get(k) for k in TIE_KEYS}
                for k, v in tie.items():
                    if k not in TIE_KEYS:
                        record[k] = v
                # Normalized on the way in, so no consumer downstream has to
                # decide what an unwritten frame or ai_scope means.
                thread["ties"].append(normalize_tie(record))

    # Sections. re.split with a capture group yields [pre, head1, body1, ...].
    chunks = _SECTION_SPLIT_RE.split(body)
    for i in range(1, len(chunks) - 1, 2):
        heading = chunks[i].strip()
        section_body = chunks[i + 1]

        if heading == RUN_HEADING:
            facts, leftover = _parse_list_block(section_body, FACT_KEYS)
            thread["run"] = [normalize_fact(f) for f in facts]
            if leftover.strip():
                thread["run_raw"] = leftover
            continue

        if heading == FULL_SUMMARY_HEADING:
            thread["full_ai_summary"] = section_body.strip()
            continue

        content, ai_summary = _split_ai_summary(section_body)
        section_id, heading = _canonical_section(heading)

        # Trait blocks are a YAML list; ordinary sections are prose. Try the
        # list, and on ANY doubt keep the text as content -- the tolerance
        # that stops a hand-edited file from losing a section.
        #
        # A SECTION MAY HOLD BOTH, and it has to: the profile editor's own
        # model gives every section a prose box AND a trait list, so a writer
        # who fills in both is doing something ordinary. The first version
        # required the section to be trait blocks and NOTHING else -- one
        # trailing sentence under the traits and the whole list read back as
        # prose, losing every trait's importance while keeping the words, so
        # nothing looked broken. Now the parsed run of traits is taken and
        # whatever follows stays as content.
        trait_blocks: list[dict] = []
        if _looks_like_trait_list(content):
            parsed, leftover = _parse_list_block(content, TRAIT_KEYS)
            if parsed:
                trait_blocks = parsed
                content = leftover.strip()

        thread["sections"][section_id] = {
            "heading": heading,
            "content": content,
            "trait_blocks": trait_blocks,
            "ai_summary": ai_summary,
        }

    return thread


def _looks_like_trait_list(text: str) -> bool:
    """Cheap gate before attempting a YAML parse: a trait section starts with
    '- trait:'. Anything else is prose and must not be run through a parser
    that might mangle it."""
    return text.lstrip().startswith("- trait:")


# WHERE AN OLDER SECTION NAME LANDS NOW.
#
# A section's id is DERIVED FROM ITS HEADING, so changing what a kind's
# sections are called silently splits a world in two: entries written before
# the change keep the old heading and get the old id, and the editor -- which
# looks up the new one -- shows their content as missing while it sits safely
# on disk. That is what happened when the Weave shipped a shorter set of
# sections than the Profile Builder had been using.
#
# Normalising on READ rather than rewriting every file is deliberate. A bulk
# rewrite can fail half way and has to be got exactly right the first time,
# across worlds nobody has seen; this cannot, and it takes effect the moment
# the file is opened. The canonical heading is restored with the id, so a file
# quietly heals the next time the writer saves it -- no pass to run, nothing
# to schedule, and an untouched file stays byte-identical until then.
_SECTION_ALIASES: dict[str, tuple[str, str]] = {
    # character: the heading gained a word.
    "hidden_and_foreshadowing":
        ("hidden_and_foreshadowing_traits", "Hidden and Foreshadowing Traits"),
    # location: the Weave's four became the Profile Builder's seven.
    "appearance": ("physical_description", "Physical Description"),
    "significance": ("historical_significance", "Historical Significance"),
    # lore.
    "details": ("rule_or_concept", "Rule or Concept"),
}


def _stamp(value) -> str:
    """
    A date, as the ISO string every other layer expects.

    YAML is helpful about dates: an unquoted `2026-08-12T13:01:38+00:00` comes
    back as a real datetime, and `str()` of one of those puts a SPACE where the
    T was. So a timestamp written as ISO read back as not-quite-ISO, which is
    the kind of drift that is invisible until something parses it strictly.
    Timestamps are quoted on the way out now, and anything already on disk is
    normalized here on the way in.
    """
    if isinstance(value, (_datetime.datetime, _datetime.date)):
        return value.isoformat()
    return str(value or "")


def _section_id(heading: str) -> str:
    """'Physical Traits' -> 'physical_traits'. Matches the registry's ids."""
    return re.sub(r"[^a-z0-9]+", "_", heading.strip().lower()).strip("_")


def _canonical_section(heading: str) -> tuple[str, str]:
    """The id and heading a section is FILED under, old names included."""
    section_id = _section_id(heading)
    if section_id in _SECTION_ALIASES:
        return _SECTION_ALIASES[section_id]
    return section_id, heading


# ── Writing ──────────────────────────────────────────────────────────────────

def _quote(value: str) -> str:
    """A YAML-safe double-quoted scalar on one line."""
    collapsed = " ".join(str(value).split())
    escaped = collapsed.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _comment_for(value, label_for) -> str:
    """The trailing '# Elara Voss' that makes an id readable. Regenerated on
    every save, so a rename updates it and never the id itself."""
    if not value or label_for is None:
        return ""
    label = label_for(str(value))
    return f"  # {label}" if label else ""


def render_thread(
    thread: dict,
    registry: dict | None = None,
    label_for: Callable[[str], str | None] | None = None,
) -> str:
    """
    Serialize a Thread back to Markdown.

    `label_for` turns an id into a human name for the trailing comments. It
    is optional and purely cosmetic -- the file is complete and correct
    without it.
    """
    lines: list[str] = ["---", f"type: {thread.get('type', '')}"]
    lines.append(f"entity_id: {thread.get('entity_id', '')}")
    lines.append(f"name: {thread.get('name', '')}")
    if thread.get("role"):
        lines.append(f"role: {thread['role']}")
    lines.append(f"status: {thread.get('status') or 'active'}")
    # Only written when it is not the default, so an ordinary Thread's file
    # stays as short as it was -- but an author-only one says so on disk,
    # where the writer can see it without opening the app.
    scope = normalize_ai_scope(thread.get("ai_scope"))
    if scope != "always":
        lines.append(f"ai_scope: {scope}")
    if thread.get("character_kind") == "side":
        lines.append("character_kind: side")

    if thread.get("display_name") and thread["display_name"] != thread.get("name"):
        lines.append(f"display_name: {thread['display_name']}")
    if thread.get("aliases"):
        lines.append("aliases:")
        lines += [f"  - {a}" for a in thread["aliases"]]
    if thread.get("tags"):
        lines.append("tags:")
        lines += [f"  - {t}" for t in thread["tags"]]
    if thread.get("fields"):
        lines.append("fields:")
        for key, value in thread["fields"].items():
            lines.append(f"  {key}: {value}")

    if thread.get("ties"):
        lines.append("ties:")
        for tie in thread["ties"]:
            lines.append(f"  - rel: {tie.get('rel', '')}")
            lines.append(f"    target: {tie.get('target', '')}"
                         f"{_comment_for(tie.get('target'), label_for)}")
            # WHY, in the writer's own words, and the single most valuable
            # thing on the connection. Quoted because a reason is prose and
            # will contain colons ("she is hiding one thing: the theft").
            if tie.get("reason"):
                lines.append(f'    reason: {_quote(tie["reason"])}')
            if tie.get("reason_inverse"):
                lines.append(f'    reason_inverse: {_quote(tie["reason_inverse"])}')
            if tie.get("rel_inverse"):
                lines.append(f"    rel_inverse: {tie['rel_inverse']}")
            # Defaults are NOT written back. Normalizing on read fills frame
            # and ai_scope on every tie, so writing them unconditionally would
            # add two lines to every connection in the book the first time it
            # was saved -- a diff of pure noise over files that had not
            # changed in any way the writer would recognise.
            for key in ("at", "until", "revealed_at"):
                if tie.get(key):
                    lines.append(f"    {key}: {tie[key]}")
            if tie.get("frame") and tie["frame"] != "truth":
                lines.append(f"    frame: {tie['frame']}"
                             f"{_comment_for(tie['frame'], label_for)}")
            if tie.get("ai_scope") and tie["ai_scope"] != "always":
                lines.append(f"    ai_scope: {tie['ai_scope']}")

    # Quoted, so YAML hands them back as the strings they were written as
    # rather than as datetimes -- see _stamp.
    if thread.get("created_at"):
        lines.append(f"created_at: {_quote(_stamp(thread['created_at']))}")
    if thread.get("updated_at"):
        lines.append(f"updated_at: {_quote(_stamp(thread['updated_at']))}")
    lines += ["---", ""]

    # Sections, in the registry's declared order where one is available so
    # every Thread of a type reads the same way.
    order = _section_order(thread, registry)
    for section_id in order:
        section = thread["sections"].get(section_id)
        if section is None:
            continue
        heading = section.get("heading") or section_id.replace("_", " ").title()
        lines.append(f"# {heading}")
        for block in section.get("trait_blocks") or []:
            lines.append(f"- trait: {block.get('trait', '')}")
            lines.append(f"  description: {_quote(block.get('description', ''))}")
            lines.append(f"  importance: {block.get('importance', 'background')}")
            # Only written when it is not the default, so an ordinary trait
            # block round-trips exactly as the profile format wrote it.
            if block.get("ai_scope") and block["ai_scope"] != "always":
                lines.append(f"  ai_scope: {block['ai_scope']}")
            lines.append("")
        if section.get("content"):
            lines += [section["content"], ""]
        lines.append(f"## AI Summary: {heading}")
        lines += [section.get("ai_summary") or "_Generated on demand. Editable by writer._", ""]

    # The Run last: it is the machine-facing part, and a writer opening the
    # file should meet their own prose first.
    lines.append(f"# {RUN_HEADING}")
    if thread.get("run"):
        for fact in thread["run"]:
            lines.append(f"- id: {fact.get('id', '')}")
            for key in ("at", "axis"):
                if fact.get(key):
                    comment = _anchor_comment(fact[key], label_for) if key == "at" else ""
                    lines.append(f"  {key}: {fact[key]}{comment}")
            lines.append(f"  value: {_quote(fact.get('value', ''))}")
            if fact.get("frame"):
                lines.append(f"  frame: {fact['frame']}{_comment_for(fact['frame'], label_for)}")
            if fact.get("revealed_at"):
                lines.append(f"  revealed_at: {fact['revealed_at']}"
                             f"{_anchor_comment(fact['revealed_at'], label_for)}")
            if fact.get("ai_scope"):
                lines.append(f"  ai_scope: {fact['ai_scope']}")
            if fact.get("supersedes"):
                lines.append(f"  supersedes: {fact['supersedes']}")
            # A DELIBERATE contradiction, marked so by the writer. Written only
            # when true -- and it has to be written at all, which it was not:
            # the flag existed in the schema and the index since the checkers
            # were built, but the Markdown round trip dropped it. Nothing could
            # SET it, so nothing noticed the file could not HOLD it.
            if fact.get("intentional"):
                lines.append("  intentional: true")
            lines.append("")
    elif thread.get("run_raw"):
        # Preserved verbatim: a Run we could not parse is still the writer's.
        lines.append(thread["run_raw"].strip())
        lines.append("")

    if thread.get("full_ai_summary"):
        lines.append(f"# {FULL_SUMMARY_HEADING}")
        lines += [thread["full_ai_summary"], ""]

    return "\n".join(lines).rstrip() + "\n"


def _anchor_comment(anchor: str, label_for) -> str:
    """'# Chapter 7, Scene 3' beside a stored anchor id."""
    return _comment_for(anchor, label_for)


def _section_order(thread: dict, registry: dict | None) -> list[str]:
    """Registry order first, then anything the file had that the registry
    does not know about -- an unknown section is kept, never dropped."""
    known: list[str] = []
    if registry:
        from app.codex.types_registry import type_by_id
        entry = type_by_id(registry, thread.get("type", ""))
        if entry:
            known = [s["id"] for s in entry.get("sections", [])]
    extra = [sid for sid in thread.get("sections", {}) if sid not in known]
    return [sid for sid in known if sid in thread.get("sections", {})] + extra

def is_placeholder(thread: dict) -> bool:
    """
    Nothing in it yet: no prose, no connections, no dated facts.

    Weaving makes entries like this from names it finds in the prose, so a
    fresh project is full of them and the writer's job is to say what each one
    actually IS. That question -- "what is this?" -- is a different question
    from "this entry is thin" or "nothing connects to this", and asking those
    two of an empty stub instead is what made the walkthrough feel like it was
    talking past the writer.

    Derived, never recorded. An entry stops being a placeholder the moment it
    holds anything.
    """
    if thread.get("ties") or thread.get("run"):
        return False
    for section in (thread.get("sections") or {}).values():
        if str(section.get("content") or "").strip():
            return False
        if section.get("trait_blocks"):
            return False
    return True
