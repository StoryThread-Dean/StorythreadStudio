# codex/scan.py -- what Weaving finds before it spends anything
# ==============================================================
# The deterministic pass. It reads the manuscript and the Weave, compares
# them, and produces STOPS: the places a walkthrough will take the writer.
#
# It runs FIRST, it costs nothing, and it is never stored.
#
# ---------------------------------------------------------------------------
# WHY "NEVER STORED" IS THE IMPORTANT WORD
# ---------------------------------------------------------------------------
# Every stop in here is re-derived from source AND destination state on every
# run. A Thread that got its Overview filled in stops being Frayed the moment
# the file is saved -- not because something marked the finding applied, but
# because the condition is no longer true. Nothing can drift, nothing can go
# stale, and there is no bookkeeping to get wrong.
#
# What IS stored is the writer's answers: what they retired ("not a
# connection"), what they deferred ("not yet"), what they muted. Those are
# facts about the writer, not about the book, and they cannot be re-derived.
# That split is the whole architecture of the findings ledger.
#
# ---------------------------------------------------------------------------
# THE COUNT IS REAL
# ---------------------------------------------------------------------------
# Because this is free, the walkthrough can say "this found 340 stops, that
# is many sessions of work" and mean it, rather than showing an estimate that
# turns out to be wrong two hours in.

import hashlib
import os
import re
from dataclasses import dataclass, field

from app.codex.anchors import AnchorIndex
from app.codex.mentions import (
    NameEvidence, alias_display, build_alias_map, find_mentions,
    group_by_containment, unbound_names,
)
from app.codex.snags import Snag, check_facts, check_ties
from app.codex.threads import is_placeholder
from app.codex.visibility import HIDDEN_FUTURE, Lens, thread_visibility
from app.codex.world_rules import DOMAINS, open_questions
from app.utils.structure_store import ordered_chapter_ids

__all__ = [
    "Stop", "STOP_KINDS", "DEPTH_FULL", "DEPTH_TARGETED", "DEPTH_QUICK",
    "ScanRequest", "ScanResult", "scan",
]

# The writer-facing names live in the frontend Lexicon; these are the codes
# the two sides agree on. A contract test pins that every one of them has an
# entry there -- a stop that can appear on screen with nothing explaining it
# is a stop that teaches nothing.
STOP_UNSPUN = "unspun"              # a name in the prose with no Thread
STOP_FRAYED = "frayed"              # a Thread too thin to be useful
STOP_UNPLACED = "unplaced"          # a fact with no point in the story
STOP_LOOSE = "loose_thread"         # a Thread nothing connects to
STOP_SNAG = "snag"                  # two facts that disagree
STOP_EARLY = "early_mention"        # named before the reader is meant to know
STOP_UNWOVEN = "unwoven"            # ground rules not worked out yet
STOP_PINNED = "pinned"              # the writer marked this by hand

STOP_KINDS = (STOP_UNSPUN, STOP_FRAYED, STOP_UNPLACED, STOP_LOOSE,
              STOP_SNAG, STOP_EARLY, STOP_UNWOVEN, STOP_PINNED)

# How much of this the writer wants in one sitting. The scan is the same
# work either way; depth decides what survives into the walk.
DEPTH_FULL = "full"
DEPTH_TARGETED = "targeted"
DEPTH_QUICK = "quick"

# Quick pass = problems only. No world-building questions, nothing that asks
# the writer to invent anything -- just the things that are already wrong.
_QUICK_KINDS = frozenset({STOP_SNAG, STOP_LOOSE, STOP_FRAYED, STOP_EARLY,
                          STOP_UNPLACED, STOP_PINNED})

_HEADING_RE = re.compile(r"^#{1,6} .*$", re.MULTILINE)
_MARKER_RE = re.compile(r"\[[^\]\n]{1,40}\]")


@dataclass
class Stop:
    """
    One place the walkthrough will take the writer.

    `why` is not decoration. Every stop must be able to answer "why am I
    seeing this?" with the rule that fired and the text that triggered it,
    because a walkthrough that cannot explain itself is a walkthrough that
    trains the writer to click through it.
    """
    kind: str
    key: str                    # stable across runs; the ledger's identity
    title: str
    why: str
    entity_id: str = ""
    chapter_id: str = ""
    quote: str = ""
    evidence_hash: str = ""
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind, "key": self.key, "title": self.title,
            "why": self.why, "entity_id": self.entity_id,
            "chapter_id": self.chapter_id, "quote": self.quote,
            "evidence_hash": self.evidence_hash, "detail": self.detail,
        }


@dataclass
class ScanRequest:
    """What the writer asked for. Everything optional means "all of it"."""
    depth: str = DEPTH_FULL
    types: list[str] = field(default_factory=list)
    chapter_ids: list[str] = field(default_factory=list)
    kinds: list[str] = field(default_factory=list)
    # Phrases retired with "not a connection", and stops muted by kind.
    retired: set[str] = field(default_factory=set)
    muted_kinds: set[str] = field(default_factory=set)
    # Phrases the writer marked by hand: [{phrase, note, where}]. Unlike every
    # other stop these are not found by a rule -- the writer asked.
    pinned: list[dict] = field(default_factory=list)

    def wants(self, kind: str) -> bool:
        if kind in self.muted_kinds:
            return False
        if self.depth == DEPTH_QUICK and kind not in _QUICK_KINDS:
            return False
        return not self.kinds or kind in self.kinds


@dataclass
class ScanResult:
    stops: list[Stop] = field(default_factory=list)
    counts: dict = field(default_factory=dict)
    # Chapters that could not be read. Said out loud rather than quietly
    # scanned around -- "we found 4 stops" reads very differently when three
    # chapters were skipped.
    unreadable: list[str] = field(default_factory=list)

    def by_kind(self, kind: str) -> list[Stop]:
        return [s for s in self.stops if s.kind == kind]


def _hash(text: str) -> str:
    """A fingerprint of the evidence, so a resumed session can tell locally
    whether the text moved under it -- no AI call, no tokens."""
    return hashlib.sha256(" ".join(text.split()).encode("utf-8")).hexdigest()[:16]


def _key(*parts: str) -> str:
    return "|".join(p for p in parts)


def _strip_chrome(text: str) -> str:
    """
    Headings and bracket markers out, prose in.

    Headings are titles, not narration -- "Chapter Seven" is not a character
    however many times it appears. Bracket markers are the audiobook's
    ([pause], [voice:NAME]) and belong to a different feature entirely.
    """
    without = _HEADING_RE.sub("", text)
    return _MARKER_RE.sub(" ", without)


def _sentence_around(text: str, start: int, end: int, width: int = 160) -> str:
    """The evidence quote: enough context to recognise, not a wall of prose."""
    left = max(0, start - width // 2)
    right = min(len(text), end + width // 2)
    snippet = text[left:right].strip()
    return ("..." if left > 0 else "") + " ".join(snippet.split()) + \
           ("..." if right < len(text) else "")


# ── The scan ─────────────────────────────────────────────────────────────────

def scan(
    project_path: str,
    threads: list[dict],
    registry: dict,
    request: ScanRequest | None = None,
    *,
    label_for=None,
) -> ScanResult:
    """
    Everything findable without asking a model anything.

    `threads` are already-parsed Threads (codex_store.load_threads). Passing
    them in rather than reading them here keeps this function pure enough to
    test against a hand-built world, which is what the interesting cases are.
    """
    request = request or ScanRequest()
    index = AnchorIndex.for_project(project_path)
    result = ScanResult()

    wanted = [t for t in threads
              if not request.types or t.get("type") in request.types]

    # The manuscript is read FIRST, and read once, because two different stops
    # need it: the ones about the prose, and the count of how often an entry is
    # named -- which is what lets a question about connections say plainly that
    # the mentions themselves are already fine.
    chapters, result.unreadable = _read_manuscript(project_path, request)
    mentioned = _mention_counts(chapters, threads)

    result.stops.extend(_thread_stops(wanted, registry, index, request,
                                      label_for=label_for,
                                      mentioned=mentioned))
    result.stops.extend(_manuscript_stops(project_path, chapters, threads,
                                          request, index))
    result.stops.extend(_unwoven_stops(threads, request))
    result.stops.extend(_pinned_stops(project_path, threads, request))

    counts: dict[str, int] = {kind: 0 for kind in STOP_KINDS}
    for stop in result.stops:
        counts[stop.kind] = counts.get(stop.kind, 0) + 1
    result.counts = counts
    return result


def _pinned_stops(project_path: str, threads: list[dict],
                  request: ScanRequest) -> list[Stop]:
    """
    The phrases the writer marked by hand.

    THE ONE STOP KIND NOT FOUND BY A RULE. Every other stop exists because a
    condition in the book is true; this one exists because the writer pointed
    at something and said "ask me about this". Two consequences:

      - it is raised until they ANSWER it, not until some condition ends. A
        rule cannot know when a hand-made mark is dealt with, and quietly
        dropping it would lose the one thing here that was never derivable.
      - the action it offers depends on whether the phrase already names
        something. With no entry, the useful next step is to make one; with an
        entry, the entry exists and the open question is what it connects to.
    """
    if not request.wants(STOP_PINNED) or not request.pinned:
        return []

    alias_map = build_alias_map(threads)
    by_name = {}
    for thread in threads:
        for name in [thread.get("name") or ""] + list(thread.get("aliases") or []):
            if name:
                by_name.setdefault(str(name).lower(), thread)

    stops: list[Stop] = []
    for pinned in request.pinned:
        phrase = str(pinned.get("phrase") or "").strip()
        if not phrase:
            continue
        note = str(pinned.get("note") or "").strip()
        thread = by_name.get(phrase.lower())
        known = phrase.lower() in alias_map

        why = ("You marked this yourself, so it is here until you say what to "
               "do with it. Nothing found it -- you pointed at it.")
        if note:
            why = f'You wrote: "{note}". ' + why

        stops.append(Stop(
            kind=STOP_PINNED, key=_key(STOP_PINNED, phrase.lower()),
            entity_id=str(thread.get("entity_id") or "") if thread else "",
            title=(f"'{phrase}' -- what should this connect to?" if known
                   else f"'{phrase}' has no entry yet"),
            quote=str(pinned.get("where") or ""),
            evidence_hash=_hash(phrase),
            why=why,
            detail={
                "name": phrase,
                "note": note,
                "has_entry": known,
                "type": str(thread.get("type") or "") if thread else "",
                "filename": str(thread.get("filename") or "") if thread else "",
            },
        ))
    return stops


def _unwoven_stops(threads: list[dict], request: ScanRequest) -> list[Stop]:
    """
    Ground rules this world has not decided yet.

    The one stop kind that is not about a mistake -- everything else finds
    something wrong, this finds something absent. It is excluded from the
    quick pass for exactly that reason: "problems only" means nothing that
    asks the writer to invent anything.

    Depth follows the session. A full weave reaches the branches; anything
    else stays on the trunk, because a writer who has not decided how power
    passes should not be asked what stops the heirs being murdered.
    """
    if not request.wants(STOP_UNWOVEN):
        return []

    max_depth = 3 if request.depth == DEPTH_FULL else 1
    stops: list[Stop] = []
    for item in open_questions(threads, max_depth=max_depth):
        question = item.question
        if question.id in request.retired:
            continue
        # "You said X, which raises this." A question arriving with no reason
        # behind it is what makes worldbuilding prompts feel like homework.
        why = question.why
        if item.because:
            why = (f"You answered: \"{item.because[0]}\" -- which raises this. "
                   + why)
        stops.append(Stop(
            kind=STOP_UNWOVEN, key=_key(STOP_UNWOVEN, question.id),
            title=question.prompt, why=why,
            detail={
                "question_id": question.id,
                "domain": question.domain,
                "domain_label": DOMAINS.get(question.domain, question.domain),
                "lands_as": list(question.lands_as),
                "touches": item.touches,
                "depth": question.depth,
            },
        ))
    return stops


def _thread_stops(threads: list[dict], registry: dict, index: AnchorIndex,
                  request: ScanRequest, *, label_for=None,
                  mentioned: dict[str, int] | None = None) -> list[Stop]:
    """Everything answerable from the Weave alone -- no manuscript needed."""
    stops: list[Stop] = []
    mentioned = mentioned or {}
    type_index = {t.get("id"): t for t in registry.get("types", [])}

    # A Thread is connected if it owns a Tie OR is the target of one. Only one
    # direction is stored, so counting only what a Thread owns would report
    # every mentored character as a loose thread.
    connected: set[str] = set()
    for thread in threads:
        for tie in thread.get("ties") or []:
            if tie.get("target"):
                connected.add(str(thread.get("entity_id") or ""))
                connected.add(str(tie.get("target")))

    for thread in threads:
        entity_id = str(thread.get("entity_id") or "")
        name = thread.get("name") or "(unnamed)"
        if not entity_id:
            continue
        # AN EMPTY STUB GETS ONE QUESTION, NOT TWO.
        #
        # Weaving creates entries from names in the prose, and one of those has
        # no prose, no connections and no facts by definition. Reporting it as
        # BOTH "too thin to be useful" AND "nothing connects to this" describes
        # two symptoms of the same thing and asks the writer to answer it twice
        # -- and neither wording is the real question, which is simply: what is
        # this? Is it something you already have, or is it its own thing?
        #
        # So the thin stop carries the fact, and the connection stop is left
        # out entirely until the entry is something.
        bare = is_placeholder(thread)
        # WHERE the thing lives, carried on every stop about it. Without this
        # the walkthrough can only say "open it" and then switch to some
        # screen, which is not the same thing and reads as a dead end.
        where = {"name": name, "type": str(thread.get("type") or ""),
                 "filename": str(thread.get("filename") or "")}

        if request.wants(STOP_FRAYED):
            missing = _missing_required(thread, type_index.get(thread.get("type"), {}))
            if missing:
                stops.append(Stop(
                    kind=STOP_FRAYED, entity_id=entity_id,
                    key=_key(STOP_FRAYED, entity_id, ",".join(sorted(missing))),
                    title=f"{name} is missing {_and_list(missing)}",
                    why=("This Thread's type says these are the parts worth "
                         "having, and they are empty. Anything reading it "
                         "later -- you included -- gets very little."),
                    detail={**where, "missing": sorted(missing),
                            # Nothing in it at all, so the walk can ask what it
                            # IS rather than telling the writer to go and type.
                            "placeholder": bare},
                ))

        if request.wants(STOP_LOOSE) and entity_id not in connected and not bare:
            # ASKED AS A QUESTION, FROM SOMETHING THE WRITER RECOGNISES.
            #
            # The first wording was "Nothing connects to Alexandra Langford",
            # and a writer whose Alexandra Langford profile plainly exists read
            # that as the app having lost track of her:
            #
            #     "That's not true. Alexandra Langford connects to the Character
            #      profile Alexandra Langford. So why is this showing up?"
            #
            # They were right, about a different sense of the word. A mention of
            # her name finding her entry is automatic. A connection between her
            # entry and ANOTHER entry is what was missing. Stating an absence
            # invited the writer to check the thing that was already fine.
            #
            # So it is a question now, and the walk shows the entry it is asking
            # ABOUT -- its own kind's icon and name -- so the starting point is
            # never in doubt.
            times = mentioned.get(entity_id, 0)
            stops.append(Stop(
                kind=STOP_LOOSE, entity_id=entity_id,
                key=_key(STOP_LOOSE, entity_id),
                title=f"How is {name} connected to the story?",
                why=("Mentions of this name in your writing already find this "
                     "entry"
                     + (f" -- {times} of them so far" if times else "")
                     + ", and that needs nothing from you. What is missing is "
                       "how it relates to the REST of your world: who it knows, "
                       "where it belongs, what it serves or worships. Nothing "
                       "records any of that yet."),
                detail={**where, "mentioned": times},
            ))

        if request.wants(STOP_SNAG) or request.wants(STOP_UNPLACED):
            found = check_facts(entity_id, thread.get("run") or [], index,
                                label_for=label_for)
            found += check_ties(entity_id, thread.get("ties") or [], registry,
                                index, label_for=label_for)
            stops.extend(_snag_stops(found, where, request))

    return stops


def _snag_stops(snags: list[Snag], where: dict, request: ScanRequest) -> list[Stop]:
    """A structural finding becomes a stop, unless its kind is muted."""
    from app.codex.snags import SNAG_UNPLACED

    stops: list[Stop] = []
    for snag in snags:
        kind = STOP_UNPLACED if snag.kind == SNAG_UNPLACED else STOP_SNAG
        if not request.wants(kind):
            continue
        stops.append(Stop(
            kind=kind, entity_id=snag.entity_id, key=_key(kind, snag.key()),
            title=f"{where['name']}: {snag.summary}",
            why=("Found by comparing the Run against itself -- no model was "
                 "asked, and this is the same answer every time."),
            detail={**where, "snag": snag.kind, "sides": snag.sides,
                    "axis": snag.axis},
        ))
    return stops


def _missing_required(thread: dict, type_entry: dict) -> list[str]:
    """
    Which of this type's declared sections have nothing in them.

    Reads `required_fields` from the type registry rather than assuming every
    Thread needs an Overview: a Concept and a Character are not thin in the
    same way, and the registry is where a world says what it values.
    """
    required = type_entry.get("required_fields") or []
    if not required:
        return []
    missing: list[str] = []
    for field_id in required:
        section = (thread.get("sections") or {}).get(field_id) or {}
        has_prose = bool(str(section.get("content") or "").strip())
        has_blocks = bool(section.get("trait_blocks"))
        if not has_prose and not has_blocks:
            missing.append(_section_label(type_entry, field_id))
    return missing


def _section_label(type_entry: dict, field_id: str) -> str:
    """The heading the writer actually sees, so a stop says "Overview" and
    not "overview" at them."""
    for section in type_entry.get("sections") or []:
        if section.get("id") == field_id:
            return str(section.get("heading") or field_id)
    return field_id.replace("_", " ")


def _and_list(items: list[str]) -> str:
    ordered = sorted(items)
    if len(ordered) == 1:
        return ordered[0]
    return ", ".join(ordered[:-1]) + " and " + ordered[-1]


# ── Against the manuscript ───────────────────────────────────────────────────

def _read_manuscript(project_path: str,
                     request: ScanRequest) -> tuple[list[tuple[str, str]], list[str]]:
    """
    [(chapter id, prose)] in reading order, plus what could not be read.

    Every chapter is read ONCE and kept. A novel's prose is a few megabytes;
    re-reading every file for each pass that wants it would cost more than
    holding it.
    """
    chapters: list[tuple[str, str]] = []
    unreadable: list[str] = []
    for chapter_id, filename in ordered_chapter_ids(project_path):
        if request.chapter_ids and chapter_id not in request.chapter_ids:
            continue
        text = _read_chapter(project_path, filename)
        if text is None:
            unreadable.append(filename)
            continue
        chapters.append((chapter_id, _strip_chrome(text)))
    return chapters, unreadable


def _mention_counts(chapters: list[tuple[str, str]],
                    threads: list[dict]) -> dict[str, int]:
    """
    {entity_id -> how often the prose names it}, counting BOUND mentions only.

    This exists because of a question asked out loud: "Nothing connects to
    Alexandra Langford. That's not true. Alexandra Langford connects to the
    Character profile Alexandra Langford."

    The writer was right and the stop was right -- about two different things.
    A mention of her name finding her entry is automatic and needs nothing from
    anyone. What was missing was any connection between her entry and ANY OTHER
    entry. Counting the mentions lets the question say the first part is already
    working, with a number as proof, instead of leaving the writer to suspect
    the app has lost track of her.
    """
    if not threads:
        return {}
    alias_map = build_alias_map(threads)
    display = alias_display(threads)
    counts: dict[str, int] = {}
    for _chapter_id, prose in chapters:
        for mention in find_mentions(prose, alias_map, display=display):
            if mention.bound and mention.entity_id:
                counts[mention.entity_id] = counts.get(mention.entity_id, 0) + 1
    return counts


def _manuscript_stops(project_path: str, chapters: list[tuple[str, str]],
                      threads: list[dict], request: ScanRequest,
                      index: AnchorIndex) -> list[Stop]:
    """
    What the prose says that the Weave does not know.

    Two questions, both cheap: which capitalised names have no Thread, and
    which Threads are named in the book at a point where the map would be
    hiding them.

    Returns the stops AND the chapters that could not be read, because "we
    found 4 stops" reads very differently when three chapters were skipped.
    """
    wants_unspun = request.wants(STOP_UNSPUN)
    wants_early = request.wants(STOP_EARLY)
    if not (wants_unspun or wants_early):
        return []

    alias_map = build_alias_map(threads)
    display = alias_display(threads)
    by_id = {str(t.get("entity_id")): t for t in threads if t.get("entity_id")}

    stops: list[Stop] = []
    unspun_totals: dict[str, int] = {}
    unspun_first: dict[str, tuple[str, str]] = {}

    # What the writer's own prose says about which words are names. Built
    # from the manuscript AND from their notes, outline and existing entries:
    # a name used mid-sentence in the outline is a name in the manuscript
    # too, and what the writer has already written is a better source of
    # truth about their world than any guess about grammar.
    evidence = NameEvidence()
    if wants_unspun:
        for _chapter_id, prose in chapters:
            evidence.observe(prose)
        for label, text in _writer_vocabulary(project_path, threads):
            evidence.observe(text, source=label)

    for chapter_id, prose in chapters:
        if wants_unspun:
            # Counted across the whole book before anything is raised: a name
            # appearing once per chapter in twelve chapters is a character,
            # and per-chapter counting would never notice.
            # Retirement is NOT applied here. Dropping a retired name before
            # grouping fragments its group: retiring "Lara Croft" would leave
            # "Lara" and "Croft" behind to be asked about separately, which
            # is the opposite of what the writer said. Groups are filtered
            # below instead.
            for name, count in unbound_names(prose, alias_map, minimum=1,
                                             evidence=evidence).items():
                unspun_totals[name] = unspun_totals.get(name, 0) + count
                unspun_first.setdefault(name, (chapter_id, prose))

        if wants_early:
            stops.extend(_early_mentions(prose, alias_map, display, by_id,
                                         chapter_id, index))

    if wants_unspun:
        # Grouped BEFORE anything is asked. "Lara Croft", "Lara" and "Croft"
        # are one question, not three -- see group_by_containment for why
        # asking three times was the actual bug.
        # GROUPED FIRST, then the frequency floor -- and that order matters.
        # "Lara Croft" once plus "Lara" twice is one thing mentioned three
        # times; filtering each name on its own would drop the full name for
        # being rare and leave the nickname standing alone.
        retired = {r.lower() for r in request.retired}
        for group in group_by_containment(unspun_totals):
            if group.count < 2:
                continue
            # "Not a connection" is about the THING, so any of its names
            # having been retired retires the group. Matching on members as
            # well as the primary also honours an answer given before grouping
            # existed, when a nickname could have been what the writer saw.
            if any(n.lower() in retired for n in group.names):
                continue
            name = group.primary
            chapter_id, prose = unspun_first[name]
            position = prose.find(name)
            written_in = sorted(evidence.sources(name))
            stops.append(Stop(
                kind=STOP_UNSPUN,
                # Keyed on the primary alone. A group that gains a nickname
                # later must stay the same question, or a writer's "not a
                # connection" would be forgotten the moment their prose used
                # one more variant of the name.
                key=_key(STOP_UNSPUN, name.lower()),
                title=(f"'{name}' has no entry" if not group.also
                       else f"'{name}' has no entry, and neither do its "
                            f"other names"),
                chapter_id=chapter_id,
                quote=_sentence_around(prose, position, position + len(name))
                      if position >= 0 else "",
                evidence_hash=_hash(name),
                why=_unspun_why(name, group.count, written_in, group.also),
                detail={"name": name, "count": group.count,
                        # Every word this one entry should answer to, so
                        # creating it once settles all of them.
                        "also": group.also,
                        "also_written_in": written_in},
            ))

    return stops


def _unspun_why(name: str, count: int, written_in: list[str],
                also: list[str] | None = None) -> str:
    """
    The rule that fired, in the writer's terms.

    Saying "it appears N times" was the old wording and it was not the
    reason -- "All" appears hundreds of times. The reason is that the writer
    capitalised it somewhere punctuation did not require, or never wrote it
    in lower case at all. Where their notes back that up, that is said too,
    because it is the strongest argument for making an entry.
    """
    why = (f"You write '{name}' like a name -- capitalised where a sentence "
           f"did not force it -- and it appears {count} times with nothing in "
           f"the Weave answering to it.")
    if also:
        # Said out loud, because one entry settling several names is the part a
        # writer would otherwise be surprised by.
        words = ", ".join(f"'{w}'" for w in also)
        why += (f" Your prose also calls it {words}, which look like the same "
                f"thing, so one entry covers all of them.")
    if written_in:
        where = written_in[0] if len(written_in) == 1 else \
            ", ".join(written_in[:-1]) + " and " + written_in[-1]
        why += f" You also use it in your {where}."
    return why


def _writer_vocabulary(project_path: str,
                       threads: list[dict]) -> list[tuple[str, str]]:
    """
    [(where it came from, its prose)] for everything the writer has written
    OUTSIDE the manuscript.

    Their notes, outline and existing entries are the best available record
    of which words in this world are names -- they are where a writer lists
    the factions and spells things out. Reading them makes the manuscript
    pass better AND lets a stop say "you use this in your outline", which is
    a far more convincing reason than a frequency count.

    Failures are skipped silently: this is evidence that improves the answer,
    not data the scan depends on, and one unreadable note must not cost the
    whole pass.
    """
    corpora: list[tuple[str, str]] = []

    notes_dir = os.path.join(project_path, "notes")
    if os.path.isdir(notes_dir):
        for name in sorted(os.listdir(notes_dir)):
            if not name.endswith(".md"):
                continue
            try:
                with open(os.path.join(notes_dir, name), "r",
                          encoding="utf-8") as f:
                    corpora.append((_note_label(name), _strip_chrome(f.read())))
            except (OSError, UnicodeDecodeError):
                continue

    entries: list[str] = []
    for thread in threads:
        for section in (thread.get("sections") or {}).values():
            content = str(section.get("content") or "").strip()
            if content:
                entries.append(content)
            for block in section.get("trait_blocks") or []:
                entries.append(str(block.get("description") or ""))
    if entries:
        corpora.append(("entries", "\n\n".join(entries)))

    return corpora


def _note_label(filename: str) -> str:
    """'style-guide.md' -> 'style guide', so a stop reads like a sentence."""
    return filename[:-3].replace("-", " ").replace("_", " ")


def _early_mentions(prose: str, alias_map: dict, display: dict,
                    by_id: dict[str, dict], chapter_id: str,
                    index: AnchorIndex) -> list[Stop]:
    """
    A Thread the map would be HIDING at this point, named in the prose here.

    The question this asks is exactly the one the map answers, so it asks it
    with the map's own function rather than a fourth reimplementation of the
    visibility rules -- the divergence between two copies of those rules is
    the bug visibility.py was written to close.

    Two properties keep it from becoming noise:

      - `thread_visibility` returns VISIBLE for a Thread with nothing
        anchored, so this can only fire on Threads the writer has actually
        dated. A writer who has anchored nothing is never nagged.
      - it fires only on a BOUND mention. An ambiguous one might be the other
        character of that name, and accusing a writer of a spoiler they did
        not write is worse than missing one they did.
    """
    here = index.ordinal(chapter_id)
    if here is None:
        return []
    lens = Lens(at=chapter_id, hide_spoilers=True)

    stops: list[Stop] = []
    seen: set[str] = set()
    for mention in find_mentions(prose, alias_map, display=display):
        entity_id = mention.entity_id or ""
        if not mention.bound or entity_id in seen:
            continue
        thread = by_id.get(entity_id)
        if thread is None:
            continue
        if thread_visibility(thread, index, lens) != HIDDEN_FUTURE:
            continue
        seen.add(entity_id)
        who = thread.get("name") or mention.alias
        stops.append(Stop(
            kind=STOP_EARLY, entity_id=entity_id,
            key=_key(STOP_EARLY, entity_id, chapter_id),
            title=f"{who} is named before the Weave says they appear",
            chapter_id=chapter_id,
            quote=_sentence_around(prose, mention.start, mention.end),
            evidence_hash=_hash(prose[mention.start:mention.end]),
            why=("Everything anchored about this Thread happens later than "
                 "this chapter, so the map hides it here -- yet the prose "
                 "names it. Either the mention is early, or the anchors are."),
            detail={"name": who, "type": str(thread.get("type") or ""),
                    "filename": str(thread.get("filename") or "")},
        ))
    return stops


def _read_chapter(project_path: str, filename: str) -> str | None:
    """
    None when a chapter cannot be read -- the caller reports it rather than
    quietly scanning a smaller book.

    UnicodeDecodeError is caught alongside OSError and is NOT a theoretical
    case: a chapter pasted in from an old editor, or recovered from a backup
    written in a Windows code page, decodes as anything but UTF-8. It is a
    ValueError rather than an OSError, so catching only OSError would let one
    bad file take the entire scan down with it.
    """
    path = os.path.join(project_path, "manuscript", filename)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None
