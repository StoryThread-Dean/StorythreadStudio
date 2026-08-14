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
from functools import lru_cache
import re
from dataclasses import dataclass, field

from app.codex.anchors import AnchorIndex
from app.codex.mentions import (
    NameEvidence, alias_display, build_alias_map, find_mentions,
    group_by_containment, parse_markup, unbound_names,
)
from app.codex.snags import Snag, check_facts, check_ties, group_tangles
from app.codex.threads import is_placeholder
from app.codex.types_registry import is_active
from app.codex.together import (
    MIN_SHARED_SCENES,
    Together,
    shared_scenes,
)
from app.codex.visibility import HIDDEN_FUTURE, Lens, thread_visibility
from app.codex.world_rules import (
    DOMAINS, answered_domains, corpus_order, open_questions,
)
from app.utils.structure_store import ordered_chapter_ids

__all__ = [
    "Stop", "STOP_KINDS",
    "PASSES", "PASS_KINDS", "PASS_WARP", "PASS_WEFT", "PASS_CLOTH",
    "PASS_UNWOVEN", "kinds_for_pass", "normalize_pass",
    "DEPTH_FULL", "DEPTH_TARGETED", "DEPTH_QUICK",
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
STOP_UNTIED = "untied"              # two Threads the prose keeps putting together
STOP_SNAG = "snag"                  # two facts that disagree
STOP_TANGLE = "tangle"              # several Snags with one cause behind them
STOP_EARLY = "early_mention"        # named before the reader is meant to know
STOP_UNWOVEN = "unwoven"            # ground rules not worked out yet
STOP_PINNED = "pinned"              # the writer marked this by hand

STOP_KINDS = (STOP_UNSPUN, STOP_FRAYED, STOP_UNPLACED, STOP_LOOSE,
              STOP_UNTIED, STOP_SNAG, STOP_TANGLE, STOP_EARLY, STOP_UNWOVEN,
              STOP_PINNED)

# ── FOUR PASSES, WHICH REPLACED THREE SIZES ─────────────────────────────────
#
# What was here before was Full / Targeted / Quick: three amounts of the same
# thing. The writer replaced it with four DIFFERENT QUESTIONS, which is a much
# better division, and named them out of the same loom vocabulary as the rest:
#
#   Dress the Loom      what is here, and what relates to what
#   Weave the Chapters  did anything change in this chapter
#   Read the Cloth      where does the book contradict itself
#   Unwoven             the ground rules of the world, which is its own job
#
# The metaphor carries the dependency, which is why it was chosen: you cannot
# weave a weft without a warp. Dressing the loom comes first because a chapter
# pass has nothing to ask about until entries exist and relate to each other.
#
# THE ORDERING IS A TEACHING FACT, NOT A LOCK, and that distinction came out of
# the writer's own earlier point: "the codex is written, expanded, changed,
# reformed, repurposed, evolving constantly throughout the story's progress."
# Dressing the loom is therefore NEVER complete, so a global gate would never
# open. The dependency is local, per pair -- a chapter pass that finds two
# entries with nothing recorded asks the dress-the-loom question inline rather
# than sending the writer away.
#
# Unwoven is separate on the writer's call: "Unwoven to me sounds like it needs
# its own pass done separately because its done outside the other two." It is
# world invention rather than tidying, and mixing it in would bury the
# connection work under questions about how succession functions.
PASS_WARP = "warp"          # Dress the Loom
PASS_WEFT = "weft"          # Weave the Chapters
PASS_CLOTH = "cloth"        # Read the Cloth
PASS_UNWOVEN = "unwoven_pass"   # the world's ground rules, on their own

PASSES = (PASS_WARP, PASS_WEFT, PASS_CLOTH, PASS_UNWOVEN)

# Which stops belong to which pass.
#
# Every kind appears exactly once, and a contract test enforces that: a kind in
# two passes gets asked twice, and a kind in none silently stops being findable.
#
# Unplaced sits in Read the Cloth on the writer's decision. A fact with no point
# in the story never takes effect, so it is invisible to everything -- which
# reads as a review finding ("this is in your world and doing nothing") rather
# than as setup work.
PASS_KINDS: dict[str, frozenset[str]] = {
    # What is here, and what relates to what.
    PASS_WARP: frozenset({STOP_UNSPUN, STOP_FRAYED, STOP_LOOSE, STOP_PINNED}),
    # Did anything change here. Scoped to chapters, which is what makes the
    # anchor free: run it FROM chapter eight and the app already knows when.
    PASS_WEFT: frozenset({STOP_UNTIED}),
    # Where the book contradicts itself. A report to read, not a queue to clear.
    # Tangle belongs here rather than to a pass of its own: it IS Snags, several
    # of them with one cause behind them, so a writer looking for contradictions
    # is looking for both.
    PASS_CLOTH: frozenset({STOP_SNAG, STOP_TANGLE, STOP_EARLY, STOP_UNPLACED}),
    # Its own job.
    PASS_UNWOVEN: frozenset({STOP_UNWOVEN}),
}

# The old names, still accepted off the wire so a client mid-update is not
# broken by a rename. Full became Dress the Loom because that is where a writer
# starting out belongs; Quick was problems-only, which IS Read the Cloth.
_LEGACY_PASSES = {"full": PASS_WARP, "targeted": PASS_WARP, "quick": PASS_CLOTH}

# Kept as aliases so nothing importing them breaks in one commit.
DEPTH_FULL = PASS_WARP
DEPTH_TARGETED = PASS_WARP
DEPTH_QUICK = PASS_CLOTH


def normalize_pass(name: str | None) -> str:
    """
    Which pass was asked for, tolerating the names this used to have.

    An unknown name becomes Dress the Loom rather than an error: a scan is free
    and read-only, so the friendly failure is to show the writer the first pass
    rather than refuse to look at their book.
    """
    value = str(name or "").strip().lower()
    if value in PASSES:
        return value
    return _LEGACY_PASSES.get(value, PASS_WARP)


def kinds_for_pass(name: str) -> frozenset[str]:
    return PASS_KINDS.get(normalize_pass(name), frozenset())

# How many likely answers a connection question offers up front.
#
# The list behind the question is every entry in the book, which for a real
# manuscript is hundreds and, in the writer's words about the first version,
# meant "3 profiles and 1 location appear in a list" with no sense of which
# mattered. Six is about as many as reads as a suggestion rather than a menu.
# The full list stays one click away; this is the shortcut, not a filter.
_LIKELY_ANSWERS = 6

_HEADING_RE = re.compile(r"^#{1,6} .*$", re.MULTILINE)
# A single-bracket marker only. The lookarounds spare `[[Ashfall]]`, which is the
# writer TALKING TO THIS FEATURE -- stripping it as chrome is how the markup pass
# came to find nothing in a note that plainly contained a link.
_MARKER_RE = re.compile(r"(?<!\[)\[[^\[\]\n]{1,40}\](?!\])")


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
    # Which of the four passes. Still called `depth` on the wire because a
    # client mid-update should not break over a field rename; normalize_pass
    # takes the old values too.
    depth: str = PASS_WARP
    types: list[str] = field(default_factory=list)
    chapter_ids: list[str] = field(default_factory=list)
    kinds: list[str] = field(default_factory=list)
    # Phrases retired with "not a connection", and stops muted by kind.
    retired: set[str] = field(default_factory=set)
    muted_kinds: set[str] = field(default_factory=set)
    # Phrases the writer marked by hand: [{phrase, note, where}]. Unlike every
    # other stop these are not found by a rule -- the writer asked.
    pinned: list[dict] = field(default_factory=list)
    # Unwoven only: which parts of the world this sitting is about. Empty means
    # all of them, which is what the walk sends; the board (R6.4) sends one,
    # because a writer who clicks Religion has said what they want to do.
    domains: list[str] = field(default_factory=list)

    def wants(self, kind: str) -> bool:
        """
        Is this kind of stop wanted in this pass?

        Three filters, narrowest last: the pass decides what the sitting is
        ABOUT, `kinds` lets a caller narrow further, and `muted_kinds` is the
        writer saying never ask me this again.
        """
        if kind in self.muted_kinds:
            return False
        if kind not in kinds_for_pass(self.depth):
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
    # Unwoven only: every part of the world with how much of it is still open,
    # WHETHER OR NOT this sitting asks about it. The board is built from this,
    # and it is what stops a bounded sitting from reading as the whole list.
    domains: list[dict] = field(default_factory=list)

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


# An HTML comment, across lines. The outline template puts its seed metadata in
# one of these and labels it, in the app's own words, "TREAT AS SEED METADATA --
# NOT ESTABLISHED STORY FACTS ... AI assistants: do NOT assume these lines are
# canon." The scan then read it as prose anyway.
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

# A FIELD LABEL at the start of a line, bold or plain, with its colon:
#
#     - **Working Title:** Cult of the Pathicus
#     - **Inciting Incident:** The team's capture by the cult
#       Genre:       (not set)
#     Chapter 1 Title: The Altars of Sodom and Pathicus
#
# The label is the TEMPLATE's word and the value after the colon is the
# writer's. Capped at five words so it cannot swallow a sentence that happens to
# contain a colon, and anchored to the line start so mid-sentence colons ("she
# had one rule: never look back") are untouched.
_FIELD_LABEL_RE = re.compile(
    r"^[ \t]*(?:[-*+]\s+)?(?:\*\*|__)?"      # optional bullet, optional bold
    r"[A-Za-z][A-Za-z0-9]*(?:[ \t]+[A-Za-z0-9]+){0,4}"   # up to five words
    r"(?:\*\*|__)?:[ \t]*",                  # the colon that makes it a field
    re.MULTILINE)

# A BOLD SPAN, anywhere on the line. The label rule above is anchored to the line
# start and so misses the template's instruction voice, which references its own
# fields mid-sentence: "Describe the **Inciting Incident**: ...", "Move on to the
# **Status Quo**: ...".
#
# Checked against a real outline before trusting it: of the 31 distinct bold
# spans in it, every single one was a template label -- Protagonist, Logline,
# Premise, Theme, Tone, Genre, Target Length, POV / Tense, Working Title, and the
# beat names. Not one was a character, a place or anything the writer invented.
# That is what bold IS in a form: the name of the box, not what is in it.
_BOLD_SPAN_RE = re.compile(r"(?:\*\*|__)(.+?)(?:\*\*|__)")

# THE FIELDS WHOSE VALUE IS ALSO CHROME.
#
# The label rule keeps the value, which is right almost everywhere: "**Status
# Quo:** The 3 teams (Alpha, Bravo, Charlie) have been captured" must still yield
# the writer's three invented names. But a handful of fields are BOOK metadata,
# and their values are classification tags rather than anything in the story.
# The writer's words: "Examples being Genre: Fiction, Sciences Fiction, Thriller.
# Other book specific grouping tags that are definitely not part of any words
# that need to be tagged, ever."
#
# Named from the app's OWN field list -- `OutlineMetadata` in outline_templates.py
# declares title, series_name, genre, tone and description, and the template
# renders those labels plus the length and point-of-view fields. So this is the
# app recognising its own form, not a guess about English.
_METADATA_FIELDS = (
    "title", "working title", "series", "genre", "tone", "description",
    "target length", "pov", "tense", "pov / tense", "status", "template",
)

# The whole line, label and value, for those fields only.
_METADATA_LINE_RE = re.compile(
    r"^[ \t]*(?:[-*+]\s+)?(?:\*\*|__)?"
    r"(?:" + "|".join(re.escape(f) for f in _METADATA_FIELDS) + r")"
    r"(?:\*\*|__)?[ \t]*:.*$",
    re.MULTILINE | re.IGNORECASE)


@lru_cache(maxsize=1)
def _template_vocabulary() -> frozenset[str]:
    """
    Every name the SHIPPED outline templates contain, lower-cased.

    THE APP WROTE THE TEMPLATE, SO IT DOES NOT HAVE TO GUESS. This is the
    difference between a heuristic and a fact: the regex rules above infer that
    a bold span or a leading label is scaffolding, and they are right most of the
    time. This knows. Every template is rendered with EMPTY metadata and read
    with the same extractor the scan uses on the writer's own text, so the two
    sets are directly comparable -- anything in the result is the app's word, not
    the writer's, by construction.

    It catches the class the regexes cannot: the template's instruction prose
    ("Replace every italic example", "Detailed Section", "Template", "Stage"),
    its beat names wherever they appear, and any example content it ships. A
    writer who has not replaced an example should not be asked about the
    example's invented names as though they were their own.

    ONLY EVER APPLIED TO PLANNING DOCUMENTS. If a writer really does have a
    character called Setup, the manuscript still finds them -- and the manuscript
    is where a character being real gets decided. Filtering prose by this list
    would be the app telling a novelist which words they are allowed to use.

    Cached: the templates are constants, so this is computed once per process.
    Rendered defensively, because a template that raises must not take the whole
    scan down with it -- a missing filter costs noise, an exception costs the
    writer their walk.
    """
    words: set[str] = set()
    try:
        from app.outline_templates import TEMPLATES, render_outline
        for template_type in TEMPLATES:
            try:
                rendered = render_outline(template_type, None)
            except Exception:          # noqa: BLE001 -- see the docstring
                continue
            # HARVESTED RAW, and that is the whole trick. Running the planning
            # strip over the template first is the obvious thing to write and it
            # is self-defeating: the strip exists to REMOVE scaffolding, so it
            # discards the very words this set is for. Measured: 32 words with
            # the strip, 158 without.
            #
            # Headings are kept too, and cost nothing: the writer's own headings
            # are stripped from their document before it is scanned, so a heading
            # word can never reach them either way.
            #
            # Also tried and removed: harvesting both the raw and stripped forms
            # and unioning them. It added nothing measurable for the templates as
            # they ship, so it was complexity buying a benefit it did not deliver.
            #
            # No alias map and no floor: every candidate the extractor can see,
            # which is exactly the set that would otherwise reach the writer.
            words.update(n.lower()
                         for n in unbound_names(rendered, {}, minimum=1)
                         if n)
    except Exception:                  # noqa: BLE001
        return frozenset()
    return frozenset(words)


def _strip_planning_chrome(text: str) -> str:
    """
    The outline's scaffolding out, the writer's own words in.

    WHY THIS EXISTS. R5.1 made the planning documents a place a stop can COME
    FROM, which was right and which turned the outline TEMPLATE into a source of
    candidate names. Reported from live testing: "it is picking a slew of
    Capitalized Words That Are Actually Part Of The process of the outline
    formating. Examples being Genre: Fiction, Sciences Fiction, Thriller. Other
    book specific grouping tags that are definitely not part of any words that
    need to be tagged, ever."

    Measured on a real outline before this: 53 planned names, of which about six
    were real. The rest were Protagonist, Antagonist, Logline, Premise, Theme,
    Tone, Genre, Setup, Resolution, Inciting Incident, Midpoint Reversal, Status
    Quo, Target Length, Working Title, Supporting Cast -- the template's own
    headings for the boxes the writer fills in.

    THE VALUE IS KEPT, ONLY THE LABEL GOES, and that distinction is the whole
    design. "**Status Quo:** The 3 teams (Alpha, Bravo, Charlie) have been
    captured" must still yield Alpha, Bravo and Charlie: those are the writer's
    invented names, sitting in the writer's own sentence, and they are exactly
    what R5.1 was built to find. A rule that dropped whole lines would have
    thrown them out with the label.

    Applied to planning documents ONLY. The manuscript is never touched by this:
    a novel legitimately contains "Ashfall: the city fell in one night", and
    prose is not a form.
    """
    without = _COMMENT_RE.sub(" ", text)
    # Whole metadata lines next: label AND value, for the few fields whose value
    # is a classification tag rather than anything in the story.
    without = _METADATA_LINE_RE.sub(" ", without)
    # BOLD SPANS BEFORE LABELS, and the order is load-bearing -- the comment here
    # used to say it was only cosmetic and that was wrong. The label rule matches
    # the OPENING half of a bold span ("- **Chapter 5:") and strips it, which
    # leaves the closing ** unpaired so the bold rule can no longer match the
    # pair, and the rest of the span survives as prose. That is where "Half
    # Limit" and "Margin" came from: chapter titles inside bold, cut in half.
    without = _BOLD_SPAN_RE.sub(" ", without)
    # Labels last, for the plain unbolded ones.
    return _FIELD_LABEL_RE.sub(" ", without)


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
    # Who the prose keeps putting in the same scene. Computed once here because
    # two separate things want it: the Untied stop, and the short list of likely
    # answers a connection question offers.
    together = shared_scenes(chapters, threads)

    result.stops.extend(_thread_stops(wanted, registry, index, request,
                                      label_for=label_for,
                                      mentioned=mentioned,
                                      together=together))
    result.stops.extend(_untied_stops(together, threads, request, registry))
    result.stops.extend(_manuscript_stops(project_path, chapters, threads,
                                          request, index))
    result.stops.extend(_unwoven_stops(threads, request, result.domains))
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


# ── R6.2: how much of a world to ask about in one sitting ────────────────────
#
# The corpus reaches three levels deep and every answer opens the questions it
# implies, so a writer who spends an evening on their government can walk back
# to a list that has GROWN. That is the feature working -- a world does get
# bigger as you decide things -- and it is also exactly how a tool teaches
# somebody that it can never be finished.
#
# The ruling: a sitting is bounded, the bound is per DOMAIN as well as overall,
# and the walk says what it is holding back. Nothing is dropped, hidden or
# reordered away; the rest is there the next time, and the board (R6.4) shows
# every domain's real count whether or not this sitting asks about it.
#
# Three per domain, because a domain is a subject and three questions is a
# thought about a subject rather than a form about one. Twelve overall, because
# a walk a writer abandons halfway teaches them not to start it.
_UNWOVEN_PER_DOMAIN = 3
_UNWOVEN_PER_SITTING = 12

# Every level of the corpus. The gate is `unlocks` -- a child is offered once
# its parent is answered -- so a ceiling here would only ever hide questions
# the writer has already earned.
_MAX_DEPTH = 3


def _pace_unwoven(items: list, domains: list[str] | None,
                  touched: set[str] | None = None):
    """
    Which open questions this sitting asks, and how many it is holding back.

    A ROUND AT A TIME, ONE QUESTION PER PART OF THE WORLD, and both halves of
    that were arrived at by getting it wrong first.

    Taking three from a domain before moving on sounds focused and is not: with
    a hundred questions and ten domains, twelve slots filled three at a time
    show four domains, always the same four, because ties broke alphabetically.
    A writer would have been asked about economy and geography until they were
    exhausted and never once about war. So the rounds go across the world first
    and deepen only if slots are left.

    Inside a domain, WHAT THE WRITER'S OWN ANSWER OPENED COMES FIRST -- that is
    what `because` marks. Sorting plainly trunk-first reinstates R6.1 by
    another route: there are always undecided trunk questions, so a bounded
    sitting sorted by depth alone would never reach a branch and every depth-2
    question would be unreachable again, by arithmetic this time instead of a
    broken comparison. It was a test written for R6.1 that caught it. Beyond
    that the trunk comes first, because ground the story stands on outranks a
    consequence of something already decided.

    Asking about ONE domain is not a cap at all beyond the sitting total: a
    writer who opens the board and picks Religion has said what they want to
    work on, and rationing it after they asked would be the app arguing.
    """
    if domains:
        items = [i for i in items if i.question.domain in domains]
    worked_in = touched or set()
    if domains and len(domains) == 1:
        # One domain asked for by name: give them the domain.
        ordered = sorted(items, key=_within_domain)
        return ordered[:_UNWOVEN_PER_SITTING], max(
            0, len(ordered) - _UNWOVEN_PER_SITTING)

    # Group by domain, each group in the order that domain should be asked in.
    by_domain: dict[str, list] = {}
    for item in items:
        by_domain.setdefault(item.question.domain, []).append(item)
    for group in by_domain.values():
        group.sort(key=_within_domain)

    # Domains the writer has worked in lead, so the first thing they see is the
    # consequence of the last thing they decided.
    order = sorted(by_domain, key=lambda d: (0 if d in worked_in else 1, d))

    taken: list = []
    for round_no in range(_UNWOVEN_PER_DOMAIN):
        for domain in order:
            group = by_domain[domain]
            if round_no >= len(group):
                continue
            if len(taken) >= _UNWOVEN_PER_SITTING:
                return taken, len(items) - len(taken)
            taken.append(group[round_no])
    return taken, len(items) - len(taken)


def _within_domain(item):
    """
    The order questions get asked in inside one part of the world.

    `because` is non-empty exactly when the writer answered the question that
    opened this one, so putting those first is how "you answered X, which
    raises this" actually reaches the screen.
    """
    return (0 if item.because else 1, item.question.depth,
            corpus_order(item.question.id))


def _unwoven_stops(threads: list[dict], request: ScanRequest,
                   board: list[dict] | None = None) -> list[Stop]:
    """
    Ground rules this world has not decided yet.

    The one stop kind that is not about a mistake -- everything else finds
    something wrong, this finds something absent. It is excluded from the
    quick pass for exactly that reason: "problems only" means nothing that
    asks the writer to invent anything.

    R6.1 -- THE BRANCHES WERE UNREACHABLE. This read
    `max_depth = 3 if request.depth == DEPTH_FULL else 1`, and DEPTH_FULL is an
    old wire name for the Warp pass. Unwoven stops are only ever produced by
    the Unwoven pass, whose depth is "unwoven_pass", so the comparison could
    not be true in the one place it ran: the ceiling was always 1, and every
    branch and capillary question in the corpus was dead code. Nothing failed.
    The walk just quietly asked the same dozen trunk questions forever, which
    is the shape of bug that this recovery keeps finding.

    There is no depth dial now, and there should not be one: a session size was
    the wrong control for this. What a writer is ready to be asked is decided by
    what they have already answered, which is what `unlocks` does -- "what stops
    every heir being murdered" appears when, and only when, they have said how
    succession works. Depth is a property of the corpus, not a setting.

    Pacing is R6.2 and it is a different problem: see `_pace_unwoven`.
    """
    if not request.wants(STOP_UNWOVEN):
        return []

    # Retired FIRST, then paced. The other order would let a question the
    # writer has permanently dismissed take up one of the few slots a sitting
    # has, so "never ask this" would make the walk shorter instead of moving
    # the next question up.
    every = [item for item in open_questions(threads, max_depth=_MAX_DEPTH)
             if item.question.id not in request.retired]
    asked, held = _pace_unwoven(every, request.domains,
                                answered_domains(threads))

    # How many are open in each domain, whether or not this sitting shows them.
    # The board (R6.4) is built from this, and a stop that knows its domain's
    # real total can say "six more here" instead of pretending it is the last.
    open_by_domain: dict[str, int] = {}
    for item in every:
        d = item.question.domain
        open_by_domain[d] = open_by_domain.get(d, 0) + 1

    if board is not None:
        # EVERY domain, including the ones with nothing left. A part of the
        # world the writer has finished is worth seeing finished; dropping it
        # from the board would make their own progress invisible.
        for domain_id, label in DOMAINS.items():
            board.append({
                "id": domain_id, "label": label,
                "open": open_by_domain.get(domain_id, 0),
                "asked_now": sum(1 for i in asked
                                 if i.question.domain == domain_id),
            })

    stops: list[Stop] = []
    for item in asked:
        question = item.question
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
                # What this sitting is NOT showing, said on the stop itself.
                # A capped list that presents itself as the whole list is a lie
                # the writer cannot see, and this walk's whole job is to be
                # believable about how much is left.
                "domain_open": open_by_domain.get(question.domain, 0),
                "held_back": held,
            },
        ))
    return stops


def _shown_name_teller(threads: list[dict]):
    """
    How an entry's name is SHOWN, given that names can collide.

    Two entries sharing a display name make anything about them
    INDISTINGUISHABLE -- which reads as the walk repeating itself. Found the
    hard way: an old one-click create and a hand-made profile left two empty
    Deans, and "Dean is missing Overview" twice in a row read as "the save did
    not work". When a name collides, the filename rides along so the writer
    can see there are two. One teller, used by every stop kind that names an
    entry -- a title that disambiguates while the detail row does not is half
    a fix.
    """
    tally: dict[str, int] = {}
    for t in threads:
        key = str(t.get("name") or "").strip().lower()
        if key:
            tally[key] = tally.get(key, 0) + 1

    def shown(thread: dict | None) -> str:
        if not thread:
            return "(unnamed)"
        base = thread.get("name") or "(unnamed)"
        if tally.get(str(base).strip().lower(), 0) > 1:
            return f"{base} ({thread.get('filename') or '?'})"
        return str(base)

    return shown


def _thread_stops(threads: list[dict], registry: dict, index: AnchorIndex,
                  request: ScanRequest, *, label_for=None,
                  mentioned: dict[str, int] | None = None,
                  together: list[Together] | None = None) -> list[Stop]:
    """Everything answerable from the Weave alone -- no manuscript needed."""
    stops: list[Stop] = []
    mentioned = mentioned or {}
    together = together or []
    names = {str(t.get("entity_id")): t for t in threads if t.get("entity_id")}

    shown_name = _shown_name_teller(threads)
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
        name = shown_name(thread)
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
                    # A bare stub gets a why that says where it CAME from,
                    # because the generic wording left a real tester asking
                    # "What IS this asking me to do?" at the very first stop.
                    # The entry's identity is settled -- the ask is a line or
                    # two of writing, and the wording has to say only that.
                    why=(("Weaving made this entry from a name in your "
                          "writing, and nothing is written in it yet. A line "
                          "or two is enough to make it useful.")
                         if bare else
                         ("This entry's kind says these are the parts worth "
                          "having, and they are empty. Anything reading it "
                          "later -- you included -- gets very little.")),
                    detail={**where, "missing": sorted(missing),
                            # Nothing in it at all, so the walk can ask what it
                            # IS rather than telling the writer to go and type.
                            "placeholder": bare},
                ))

        # ONLY A KIND WITH AGENCY IS ASKED HOW IT CONNECTS. Croft Manor's way
        # into the story is through Lara -- she inherited it -- and asking the
        # manor produced a dropdown where "logically none of the entries make
        # sense". A passive thing (location, lore, faction, deity, government,
        # religion, culture) becomes connected when someone active is tied to
        # it; until then, an unconnected one is not a problem, so it is not a
        # stop. See types_registry.is_active -- writer-overridable per type.
        active = is_active(registry, str(thread.get("type") or ""))

        if (request.wants(STOP_LOOSE) and entity_id not in connected
                and not bare and active):
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
                detail={**where, "mentioned": times,
                        # THE SHORT LIST, so the question is answerable rather
                        # than merely askable. Every entry in the book is still
                        # one click away; these are the ones the prose has
                        # already put in the room with this one.
                        "likely": _likely_answers(entity_id, together, names,
                                                  shown=shown_name)},
            ))

        if request.wants(STOP_SNAG) or request.wants(STOP_UNPLACED):
            found = check_facts(entity_id, thread.get("run") or [], index,
                                label_for=label_for)
            found += check_ties(entity_id, thread.get("ties") or [], registry,
                                index, label_for=label_for)
            stops.extend(_snag_stops(found, where, request,
                                     names=names, shown=shown_name))

    return stops


def _likely_answers(entity_id: str, together: list[Together],
                    names: dict[str, dict], *, shown=None) -> list[dict]:
    """
    The entries this one shares most scenes with, strongest first.

    No floor here, deliberately -- unlike the Untied stop, which speaks
    unprompted and therefore has to earn it. By the time this list is read the
    writer has already been asked the question, and one shared scene is a
    genuinely useful thing to be shown when the alternative is an alphabetical
    list of four hundred entries.

    Each entry says how many scenes it shares, because a suggestion that cannot
    show its reasoning is just a guess with better manners.
    """
    likely: list[dict] = []
    for pairing in together:
        if not pairing.touches(entity_id):
            continue
        other_id = pairing.other(entity_id)
        other = names.get(other_id)
        if not other:
            continue
        likely.append({
            "entity_id": other_id,
            # Disambiguated like every other shown name -- two same-named
            # suggestions in one list are one suggestion to the reader.
            "name": shown(other) if shown else (other.get("name") or "(unnamed)"),
            "type": str(other.get("type") or ""),
            "scenes": pairing.scenes,
        })
        if len(likely) >= _LIKELY_ANSWERS:
            break
    return likely


def _untied_stops(together: list[Together], threads: list[dict],
                  request: ScanRequest, registry: dict) -> list[Stop]:
    """
    Pairs the prose keeps putting in the same scene with nothing recorded.

    THE FLOOR IS THE WHOLE DESIGN. One shared scene is two strangers passing on
    a street, and a rule with no floor is exactly what produced 177 junk Unspun
    entries and the verdict that it "makes this app look amateurish". So this
    only speaks when the story has said it more than once.

    It proposes a connection, never a KIND of connection. A knight and the
    dragon he is hunting share a great many scenes; what that relationship IS
    stays the writer's to name.

    AND THE QUESTION STANDS ON THE ACTIVE END. Two rules, both from live use:

      * A pair with no active end -- a location sharing scenes with a faction,
        lore alongside a religion -- is never asked at all. "A location
        wouldn't know anyone or have anything to do with someone." Whatever
        joins them joins them through somebody, and that somebody's own stop
        is where it gets recorded.
      * A pair with ONE active end is asked from that end, so the connect
        sentence reads the way the world works: "Lara Croft lives in Croft
        Manor", never a manor being asked what it thinks of Lara.

    The KEY keeps the pairing's own order either way, so answers given before
    this rule existed still count.
    """
    if not request.wants(STOP_UNTIED) or not together:
        return []

    names = {str(t.get("entity_id")): t for t in threads if t.get("entity_id")}
    shown = _shown_name_teller(threads)

    # Already tied in either direction, so there is nothing to propose. Ties
    # are stored one way round only, which is why both ends go in.
    tied: set[tuple[str, str]] = set()
    for thread in threads:
        src = str(thread.get("entity_id") or "")
        for tie in thread.get("ties") or []:
            dst = str(tie.get("target") or "")
            if src and dst:
                tied.add(tuple(sorted([src, dst])))

    stops: list[Stop] = []
    for pairing in together:
        if pairing.scenes < MIN_SHARED_SCENES:
            continue
        if (pairing.a, pairing.b) in tied:
            continue
        a, b = names.get(pairing.a), names.get(pairing.b)
        if not a or not b:
            continue

        a_active = is_active(registry, str(a.get("type") or ""))
        b_active = is_active(registry, str(b.get("type") or ""))
        if not a_active and not b_active:
            # Two passive things in a room together is scenery, not a
            # relationship the walk should demand a word for.
            continue
        if b_active and not a_active:
            # Stand the question on the one with agency. detail.a is the end
            # the connect editor opens FROM, so this swap is what makes the
            # sentence read "Lara lives in Croft Manor" rather than asking the
            # manor. Presentation only -- the key below keeps pairing order.
            a, b = b, a
            a_id, b_id = pairing.b, pairing.a
        else:
            a_id, b_id = pairing.a, pairing.b

        a_name = shown(a)
        b_name = shown(b)
        stops.append(Stop(
            kind=STOP_UNTIED,
            entity_id=a_id,
            key=_key(STOP_UNTIED, pairing.a, pairing.b),
            chapter_id=pairing.first_chapter,
            quote=pairing.quote,
            evidence_hash=_hash(pairing.quote),
            title=f"How are {a_name} and {b_name} connected?",
            why=(f"Your writing puts them in the same scene "
                 f"{pairing.scenes} times, and nothing in the Weave records "
                 f"any connection between them. What that connection IS is "
                 f"yours to say -- sharing a scene could mean anything from "
                 f"family to a feud."),
            detail={
                "a": {"entity_id": a_id, "name": a_name,
                      "type": str(a.get("type") or ""),
                      "filename": str(a.get("filename") or "")},
                "b": {"entity_id": b_id, "name": b_name,
                      "type": str(b.get("type") or ""),
                      "filename": str(b.get("filename") or "")},
                "scenes": pairing.scenes,
            },
        ))
    return stops


def _snag_stops(snags: list[Snag], where: dict, request: ScanRequest, *,
                names: dict[str, dict] | None = None,
                shown=None) -> list[Stop]:
    """A structural finding becomes a stop, unless its kind is muted."""
    from app.codex.snags import SNAG_UNPLACED

    def enriched(sides: list[dict]) -> list[dict]:
        # A tie-based side carries the other end as a raw entity id, which is
        # what the fixer used to SHOW -- "leads e-4f2a91" is not a sentence a
        # writer can decide anything from. The name rides along; the id stays,
        # because the fixer's delete still needs it.
        out: list[dict] = []
        for side in sides:
            target = str(side.get("target") or "")
            if target and names is not None:
                other = names.get(target)
                out.append({**side,
                            "target_name": (shown(other) if shown and other
                                            else target)})
            else:
                out.append(side)
        return out

    def as_snag_stop(snag: Snag, kind: str) -> Stop:
        return Stop(
            kind=kind, entity_id=snag.entity_id, key=_key(kind, snag.key()),
            title=f"{where['name']}: {snag.summary}",
            why=("Found by comparing the Run against itself -- no model was "
                 "asked, and this is the same answer every time."),
            detail={**where, "snag": snag.kind, "sides": enriched(snag.sides),
                    "axis": snag.axis},
        )

    stops: list[Stop] = []

    # Unplaced first, and NEVER grouped. It is a different question -- "where
    # does this belong?" rather than "which of these is right?" -- and the fixer
    # answers it with a chapter picker rather than by choosing a side. Bundling
    # one into a Tangle about the same axis would put two unrelated decisions
    # behind one button.
    for snag in snags:
        if snag.kind != SNAG_UNPLACED:
            continue
        if request.wants(STOP_UNPLACED):
            stops.append(as_snag_stop(snag, STOP_UNPLACED))

    # ── R8.2: the Tangle finally has a producer ──────────────────────────────
    #
    # `group_tangles` was written, unit-tested and called by nothing, so every
    # Snag was asked separately. That matters more than it sounds: moving one
    # date can produce eleven Snags on one axis, and eleven questions about one
    # mistake teaches the writer that the checker does not understand their
    # book. The grouping is by (entity, axis), which is the shape a single
    # mistake actually takes.
    #
    # A GROUP OF ONE STAYS A SNAG. group_tangles returns it as a group of one so
    # its caller can have a single code path, and the temptation is to take that
    # literally -- but "Tangle: 1 contradiction" is a worse sentence than the
    # Snag it is wrapping, and the fixer would show exactly the same screen with
    # an extra click in front of it.
    #
    # Muting is checked against SNAG, not tangle. A Tangle is Snags; a writer who
    # silenced contradictions did not mean "unless there are several".
    contradictions = [s for s in snags if s.kind != SNAG_UNPLACED]
    if request.wants(STOP_SNAG):
        for group in group_tangles(contradictions):
            if len(group) == 1:
                stops.append(as_snag_stop(group[0], STOP_SNAG))
                continue
            first = group[0]
            axis = first.axis or "this"
            stops.append(Stop(
                kind=STOP_TANGLE, entity_id=first.entity_id,
                # Keyed on the CAUSE rather than on the members, so answering it
                # stays answered while the writer works through the group -- a
                # key built from every member's key would change the moment one
                # of them was fixed, and the ledger would call it a new stop.
                key=_key(STOP_TANGLE, first.entity_id, axis),
                title=(f"{where['name']}: {len(group)} problems with "
                       f"'{axis}', probably one mistake"),
                why=(f"{len(group)} separate contradictions all concern "
                     f"'{axis}' on this entry. Several findings on one axis are "
                     "usually one mistake seen from different angles -- a date "
                     "moved, a fact replaced twice -- so they are gathered here "
                     "rather than asked one at a time. Found by comparing the "
                     "Run against itself; no model was asked."),
                detail={
                    **where, "axis": axis,
                    # Each member is a whole snag, so the fixer can work through
                    # them without another round trip -- and each carries its own
                    # key, because answering the group has to be able to say
                    # WHICH parts of it were dealt with.
                    "members": [
                        {"key": _key(STOP_SNAG, s.key()), "snag": s.kind,
                         "summary": s.summary, "axis": s.axis,
                         "sides": enriched(s.sides)}
                        for s in group
                    ],
                },
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
    # What the writer wrote OUTSIDE the manuscript, kept rather than only
    # observed -- see the loop after the chapters for why that changed.
    vocabulary: list[tuple[str, str]] = []
    if wants_unspun:
        for _chapter_id, prose in chapters:
            evidence.observe(prose)
        vocabulary = _writer_vocabulary(project_path, threads)
        for label, text in vocabulary:
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

    # ── NAMES THAT ONLY EXIST IN THE PLANNING SO FAR ─────────────────────
    #
    # The spec says the Weave "reads the AVAILABLE documents", and the audit
    # found this half missing: notes, outline, style guide and themes were read
    # as CORROBORATION -- evidence that a word found in the manuscript is a name
    # -- and never as a place a question could come from. So a writer who lists
    # nine factions in their outline and has written two of them into a chapter
    # got asked about two.
    #
    # That is backwards for how people work. The outline is where a world is
    # decided; the manuscript is where it arrives, later, and one chapter at a
    # time.
    #
    # THEY ARE A SOFTER STOP, which is R5.4's ruling made concrete in three
    # ways. A planning name needs no frequency floor, because a faction named
    # once in an outline is as real as one named twice in a chapter and the
    # floor exists to filter prose noise. Its stop SAYS where it came from, in
    # the document's own name. And it carries `from_planning`, so anything that
    # reasons about what the BOOK contains can tell the difference between a
    # thing the writer has written and a thing they intend to.
    planning_first: dict[str, tuple[str, str]] = {}
    planning_counts: dict[str, int] = {}
    # Names the writer marked up by hand, and where. Kept apart from the rest
    # because the reason given for them is different in kind: they are not a
    # guess that turned out well, they are an instruction.
    marked: dict[str, str] = {}
    # THE TEMPLATE'S OWN WORDS ARE NOT THE WRITER'S. See _template_vocabulary:
    # the app SHIPPED the outline, so it knows exactly which capitalised words
    # are its own scaffolding, and does not have to guess.
    scaffolding = _template_vocabulary()

    if wants_unspun:
        for label, text in vocabulary:
            if label == "entries":
                # The Weave's own entries. A name in one of those has an entry
                # by definition, so asking about it would be a loop.
                continue
            for name, count in unbound_names(text, alias_map, minimum=1,
                                             evidence=evidence).items():
                if name.lower() in scaffolding:
                    continue
                planning_counts[name] = planning_counts.get(name, 0) + count
                planning_first.setdefault(name, (label, text))

        # ── WHAT THE WRITER MARKED ON PURPOSE ────────────────────────
        #
        # `[[Ashfall]]` and `@Garrick` in a note or an outline. parse_markup has
        # existed since the mentions work and had no caller at all -- its own
        # docstring names the thing it makes possible, that "you wrote
        # [[Ashfall]] and there is no Ashfall" is one of the more useful
        # sentences Weaving can say, and nothing was saying it.
        #
        # This is the strongest signal in the whole scan and it is treated as
        # such. Everything else here is inference -- a capitalised word, a
        # frequency, a shape that looks like a name. Markup is the writer
        # pointing at something and telling the app it matters. It needs no
        # floor, no corroboration and no guessing at grammar, and it is never
        # run over the manuscript, because asking a novelist to decorate their
        # prose to make a feature work is asking them to write for the app.
        for label, text in vocabulary:
            if label == "entries":
                continue
            for mention in parse_markup(text, alias_map):
                if mention.bound or not mention.explicit:
                    continue
                name = mention.alias.strip()
                if not name:
                    continue
                marked[name] = label
                planning_first.setdefault(name, (label, text))
                # MARKS rather than counts. The pass above has usually already
                # seen this occurrence as an ordinary name, and adding to the
                # tally there would report one `[[Ashfall]]` as two Ashfalls.
                # The setdefault is for the case it did NOT see -- a marked name
                # the grammar rules would have passed over -- where one is right.
                planning_counts.setdefault(name, 1)

        # Only the ones the manuscript has NOT already raised. A name in both
        # is one question, and the chapter is the better place to ask it from
        # because that is where the writer can see it in a sentence.
        for name, count in planning_counts.items():
            if name not in unspun_totals:
                unspun_totals[name] = count

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
            # The frequency floor filters prose noise, and a name the writer
            # DECIDED on in their outline is not noise even once. Applied to
            # planning names it would silently drop exactly the entries a writer
            # most wants: the ones they have planned and not yet written.
            from_planning = all(n not in unspun_first for n in group.names)
            if group.count < 2 and not from_planning:
                continue
            # "Not a connection" is about the THING, so any of its names
            # having been retired retires the group. Matching on members as
            # well as the primary also honours an answer given before grouping
            # existed, when a nickname could have been what the writer saw.
            if any(n.lower() in retired for n in group.names):
                continue
            name = group.primary
            if name in unspun_first:
                chapter_id, prose = unspun_first[name]
                planning_source = ""
            else:
                # Planned, not yet written. The "chapter" it belongs to is
                # nothing, and saying so is better than attaching it to a
                # chapter it never appears in.
                planning_source, prose = planning_first.get(
                    name, next(iter(planning_first.values()),
                               ("your notes", "")))
                chapter_id = ""
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
                why=(_marked_why(name, marked[name], group.also)
                     if name in marked
                     else _planning_why(name, planning_source, group.also)
                     if planning_source
                     else _unspun_why(name, group.count, written_in,
                                      group.also)),
                detail={"name": name, "count": group.count,
                        # Every word this one entry should answer to, so
                        # creating it once settles all of them.
                        "also": group.also,
                        "also_written_in": written_in,
                        # Where the question came from, and whether the book
                        # contains this yet. A caller reasoning about what is
                        # WRITTEN must be able to tell the two apart.
                        "source": planning_source or "manuscript",
                        "from_planning": bool(planning_source),
                        # The writer pointed at this one by hand. Worth saying,
                        # because it is the difference between the app noticing
                        # something and the app being told.
                        "marked_up": name in marked},
            ))

    return stops


def _marked_why(name: str, source: str, also: list[str] | None = None) -> str:
    """
    The reason, for a name the writer marked up themselves.

    The shortest and most certain of the three, because there is nothing to
    justify: they wrote [[Ashfall]], and there is no Ashfall.
    """
    why = (f"You wrote '{name}' as a link in your {source}, and there is no "
           f"entry for it. Marking it means you meant it.")
    if also:
        words = ", ".join(f"'{w}'" for w in also)
        why += f" Your writing also calls it {words}."
    return why


def _planning_why(name: str, source: str, also: list[str] | None = None) -> str:
    """
    The reason, for a name the writer has planned and not yet written.

    Deliberately different wording from the manuscript case, because it is a
    different situation and a writer can act on the difference: there is nothing
    to go and look at in a chapter, and an entry made now is groundwork rather
    than catching up.
    """
    why = (f"You name '{name}' in your {source}, and nothing in the Weave "
           f"answers to it yet. It has not reached your manuscript, so this is "
           f"a thing you have planned rather than something you have written.")
    if also:
        words = ", ".join(f"'{w}'" for w in also)
        why += (f" Your writing also calls it {words}, so one entry covers all "
                f"of them.")
    return why


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


# ── The one document the app does not read ───────────────────────────────────
#
# AUTHOR NOTES IS THE WRITER'S OWN ROOM, and until now that was a convention
# rather than a rule. It is the reason a per-trait "never send to AI" control was
# not built: the writer's answer to where private material goes was "Author
# Notes, and I attach it myself when I want it". A promise resting on nothing in
# the code is the same shape as "hidden traits are never sent to the AI", which
# was wrong in three places.
#
# So it is excluded BY NAME here, where the app reads the writer's other
# documents, and `test_author_notes_is_private.py` fails the build if any
# AI-facing corpus builder starts including it.
#
# Note what this does NOT claim. The file is still theirs to attach to a chat by
# hand, and still theirs to export. What it means is that nothing in this app
# reads it on its own initiative.
PRIVATE_NOTES: frozenset[str] = frozenset({"author-notes.md"})


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
            # See PRIVATE_NOTES. The writer's own room, skipped on purpose.
            if name in PRIVATE_NOTES:
                continue
            try:
                with open(os.path.join(notes_dir, name), "r",
                          encoding="utf-8") as f:
                    # Planning documents get the extra pass: they are FORMS the
                    # writer fills in, so the template's labels are chrome in a
                    # way a manuscript's sentences never are.
                    corpora.append((_note_label(name),
                                    _strip_planning_chrome(_strip_chrome(f.read()))))
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
