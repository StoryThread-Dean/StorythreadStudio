# codex/mentions.py -- finding the world inside the prose
# ========================================================
# Weaving starts by reading what the writer has actually written and asking
# which Threads it names. That question sounds easy and is not, because
# fiction is full of people who share a name.
#
#     Two Johns in the same book.
#     "the King" meaning a different man after chapter twenty.
#     A character and a city both called Vale.
#     "Mother" fitting three people depending on who is speaking.
#
# THE RULE THIS MODULE IS BUILT AROUND
# ------------------------------------
# An ambiguous mention NEVER silently binds to a Thread. It is reported as
# ambiguous with its candidates, and it stays that way until something
# genuinely settles it. This matters beyond tidiness: a bound mention is what
# pulls a Thread into the AI's context, so a wrong bind quietly feeds the AI
# the wrong character's beliefs and the writer has no way to see it happen.
#
# Two deterministic things are allowed to settle it, both cheap and both
# free of guesswork:
#
#   1. A UNIQUE ALIAS NEARBY. If "John" is ambiguous but "John Vale" appears
#      unambiguously in the same scene, the bare "John" is John Vale.
#   2. A TIE TO SOMEONE PRESENT. If one candidate is connected to a Thread
#      that IS unambiguously in the scene and the others are not, that is
#      evidence rather than a coin toss.
#
# Anything the two rules cannot settle waits for the writer, whose answer is
# recorded as a scoped disambiguation (this alias, in these chapters, is this
# Thread) so it is never asked twice.
#
# HOW A NAME IS RECOGNISED
# ------------------------
# Matching is case-insensitive, with one guard: a match written entirely in
# lower case is rejected unless the alias itself is entirely lower case. A
# name in prose is written like a name. Without that guard an alias of "Will"
# matches every "he will go", and an alias of "Vale" matches nothing worse --
# but the first one alone would bury the writer in false stops on their own
# character's name.
#
# The failure direction is chosen deliberately: MISSING a mention costs one
# stop that could have been offered. Inventing one costs trust in every stop
# after it.

import re
from dataclasses import dataclass, field

__all__ = [
    "Mention", "NOT_A_NAME", "alias_display", "build_alias_map",
    "find_mentions", "parse_markup", "unbound_names",
]

# Words that are never a name however a writer registers them. Shared in
# spirit with speakerScan.ts, which learned the same lesson out loud: the
# cost of one of these binding is a stop on literally every paragraph.
NOT_A_NAME = frozenset({
    "the", "a", "an", "he", "she", "they", "it", "i", "we", "you", "his",
    "her", "their", "that", "this", "there", "then", "but", "and", "so",
    "when", "what", "why", "how", "who", "if", "as", "at", "in", "on",
    "one", "both", "neither", "someone", "nobody", "everyone", "nothing",
})

BOUND = "bound"
AMBIGUOUS = "ambiguous"

# How a bind was reached, which the walkthrough shows as its evidence.
BY_UNIQUE = "unique"                    # only one Thread answers to the name
BY_NEARBY_ALIAS = "nearby_alias"        # a fuller name of one candidate is here
BY_TIE = "tie"                          # only one candidate is tied to someone here
BY_WRITER = "writer"                    # they told us, and we wrote it down

# Explicit markup, used OUTSIDE the manuscript. The manuscript itself stays
# clean prose -- a writer should never have to decorate their novel to make
# the app work.
_MARKUP_RE = re.compile(r"\[\[([^\]\n]{1,80})\]\]|@([A-Za-z][\w'\-]{0,40})")


@dataclass(frozen=True)
class Mention:
    """One place in the text where a Thread appears to be named."""
    alias: str
    start: int
    end: int
    status: str
    entity_id: str | None = None
    candidates: tuple[str, ...] = ()
    resolved_by: str = ""
    explicit: bool = False

    @property
    def bound(self) -> bool:
        return self.status == BOUND and bool(self.entity_id)


@dataclass
class _Hit:
    """A raw match, before anything has been decided about it."""
    alias: str
    start: int
    end: int
    candidates: list[str]
    explicit: bool = False
    resolved_by: str = ""
    entity_id: str | None = None
    extras: dict = field(default_factory=dict)


# ── Building the vocabulary ──────────────────────────────────────────────────

def build_alias_map(threads: list[dict]) -> dict[str, list[str]]:
    """
    {alias (lower-cased) -> [entity_id, ...]} over every Thread.

    A name maps to a LIST because more than one Thread answering to it is a
    normal state of the world, not an error to be resolved away at load time.
    Sorted for determinism -- the same book must scan the same way twice.
    """
    mapping: dict[str, set[str]] = {}
    for thread in threads:
        entity_id = str(thread.get("entity_id") or "")
        if not entity_id:
            continue
        names = [thread.get("name") or ""] + list(thread.get("aliases") or [])
        for name in names:
            key = str(name).strip()
            if not key or key.lower() in NOT_A_NAME:
                continue
            mapping.setdefault(key.lower(), set()).add(entity_id)
    return {alias: sorted(ids) for alias, ids in mapping.items()}


def alias_display(threads: list[dict]) -> dict[str, str]:
    """
    {lower-cased alias -> the alias as the writer typed it}.

    Needed for two things: showing a mention back in the writer's own
    spelling, and knowing whether an alias was REGISTERED in lower case,
    which is what licenses matching a lower-case word (see the header). Pass
    it wherever you pass an alias map; without it matching stays strict.
    """
    forms: dict[str, str] = {}
    for thread in threads:
        for name in [thread.get("name") or ""] + list(thread.get("aliases") or []):
            key = str(name).strip()
            if key:
                forms.setdefault(key.lower(), key)
    return forms


def _alias_regex(aliases: list[str]) -> re.Pattern | None:
    """
    One pattern matching any known alias, longest first.

    Longest-first matters: with "John" and "John Vale" both registered, a
    shortest-first alternation would match "John" inside "John Vale" and lose
    the very evidence that disambiguates it.
    """
    usable = [a for a in aliases if a.strip()]
    if not usable:
        return None
    usable.sort(key=lambda a: (-len(a), a))
    body = "|".join(re.escape(a) for a in usable)
    # Trailing lookahead allows an apostrophe so "Elara's" matches Elara --
    # a possessive is the character, not a different word.
    return re.compile(rf"(?<![\w'])(?:{body})(?!\w)", re.IGNORECASE)


def _looks_like_a_name(matched: str, registered: str | None) -> bool:
    """
    A name in prose is written like a name -- see the header.

    `registered` is the alias as the writer typed it, or None when the caller
    did not supply the display map. NOT KNOWING MEANS BEING STRICT: an
    unknown registration is treated as capitalised, so a caller that forgets
    the map gets fewer stops rather than a flood of false ones on every
    "he will go".
    """
    if registered is not None and registered.lower() == registered:
        return True                     # the writer registered it lower case
    return matched != matched.lower()


# ── Finding them ─────────────────────────────────────────────────────────────

def find_mentions(
    text: str,
    alias_map: dict[str, list[str]],
    *,
    ties: dict[str, set[str]] | None = None,
    disambiguations: dict[str, str] | None = None,
    display: dict[str, str] | None = None,
) -> list[Mention]:
    """
    Every Thread named in one span of prose -- a scene, or a chapter.

    Pass ONE SCENE at a time where scenes exist. The disambiguation rules are
    proximity rules: "John Vale is also in this scene" is evidence, and "John
    Vale is somewhere in this 4,000-word chapter" is much weaker. Passing a
    whole chapter still works, it just settles fewer of them -- which is the
    honest failure, since an unsettled mention is reported rather than guessed.

    `ties` is {entity_id -> {connected entity_id, ...}} and is optional;
    without it, rule 2 simply does not fire.
    `disambiguations` is {lower-cased alias -> entity_id}, already narrowed by
    the caller to the chapter range being scanned.
    """
    if not text or not alias_map:
        return []

    pattern = _alias_regex(list(alias_map.keys()))
    if pattern is None:
        return []
    display = display or {}
    disambiguations = disambiguations or {}

    hits: list[_Hit] = []
    for match in pattern.finditer(text):
        raw = match.group(0)
        key = raw.lower()
        candidates = alias_map.get(key)
        if not candidates:
            continue
        if not _looks_like_a_name(raw, display.get(key)):
            continue
        hits.append(_Hit(alias=display.get(key, raw), start=match.start(),
                         end=match.end(), candidates=list(candidates)))

    _settle(hits, ties or {}, disambiguations)
    return [
        Mention(
            alias=hit.alias, start=hit.start, end=hit.end,
            status=BOUND if hit.entity_id else AMBIGUOUS,
            entity_id=hit.entity_id,
            candidates=tuple(hit.candidates),
            resolved_by=hit.resolved_by,
            explicit=hit.explicit,
        )
        for hit in hits
    ]


def _settle(hits: list[_Hit], ties: dict[str, set[str]],
            disambiguations: dict[str, str]) -> None:
    """
    Decide what can be decided, in strict order of how much it is worth.

    Mutates the hits in place. Everything left over stays ambiguous, which is
    a result rather than a failure -- the walkthrough asks about those, and
    the answer is remembered.
    """
    # Round one: the ones that were never in doubt, plus anything the writer
    # has already answered. These become the evidence for round two, so they
    # have to be settled first.
    for hit in hits:
        if len(hit.candidates) == 1:
            hit.entity_id = hit.candidates[0]
            hit.resolved_by = BY_UNIQUE
            continue
        chosen = disambiguations.get(hit.alias.lower())
        if chosen and chosen in hit.candidates:
            hit.entity_id = chosen
            hit.resolved_by = BY_WRITER

    present = {hit.entity_id for hit in hits if hit.entity_id}

    # Round two: rule 1 -- a fuller name of exactly one candidate is here.
    for hit in hits:
        if hit.entity_id:
            continue
        narrowed = [c for c in hit.candidates if c in present]
        if len(narrowed) == 1:
            hit.entity_id = narrowed[0]
            hit.resolved_by = BY_NEARBY_ALIAS

    present = {hit.entity_id for hit in hits if hit.entity_id}

    # Round three: rule 2 -- exactly one candidate is connected to somebody
    # who IS here. Weaker than rule 1, so it runs after it and only on what
    # is still open.
    for hit in hits:
        if hit.entity_id:
            continue
        connected = [
            c for c in hit.candidates
            if (ties.get(c) or set()) & (present - {c})
        ]
        if len(connected) == 1:
            hit.entity_id = connected[0]
            hit.resolved_by = BY_TIE


# ── Explicit markup, outside the manuscript ──────────────────────────────────

def parse_markup(
    text: str,
    alias_map: dict[str, list[str]],
    *,
    disambiguations: dict[str, str] | None = None,
) -> list[Mention]:
    """
    `@Elara` and `[[Garrick Vale]]` in notes, outlines, summaries and fields.

    Deliberately NOT run over the manuscript. Asking a novelist to decorate
    their prose with markup to make a feature work is asking them to write
    for the app instead of for the reader.

    An explicit mention naming something with no Thread is still returned --
    as ambiguous with no candidates -- because "you wrote [[Ashfall]] and
    there is no Ashfall" is one of the more useful things Weaving can say.
    """
    if not text:
        return []
    disambiguations = disambiguations or {}
    mentions: list[Mention] = []
    for match in _MARKUP_RE.finditer(text):
        name = (match.group(1) or match.group(2) or "").strip()
        if not name:
            continue
        candidates = alias_map.get(name.lower(), [])
        chosen = None
        resolved_by = ""
        if len(candidates) == 1:
            chosen, resolved_by = candidates[0], BY_UNIQUE
        else:
            picked = disambiguations.get(name.lower())
            if picked and picked in candidates:
                chosen, resolved_by = picked, BY_WRITER
        mentions.append(Mention(
            alias=name, start=match.start(), end=match.end(),
            status=BOUND if chosen else AMBIGUOUS,
            entity_id=chosen, candidates=tuple(candidates),
            resolved_by=resolved_by, explicit=True,
        ))
    return mentions


# ── Names with nothing behind them ───────────────────────────────────────────

# A capitalised word, or a run of them: "Garrick", "Garrick Vale", "the Vale
# of Ash" is deliberately not matched -- lower-case connectives would make
# this fire on the start of every sentence.
_CANDIDATE_NAME_RE = re.compile(r"\b[A-Z][a-z'’\-]{1,}(?:\s+[A-Z][a-z'’\-]{1,}){0,2}\b")


def unbound_names(
    text: str,
    alias_map: dict[str, list[str]],
    *,
    minimum: int = 2,
    ignore: set[str] | None = None,
) -> dict[str, int]:
    """
    {name -> how often} for capitalised names no Thread answers to.

    This is the Unspun stop: somebody or somewhere is in the book with no
    entry behind it. Three guards keep it from becoming noise:

      - a name must appear at least `minimum` times. A one-off capitalised
        word is usually a sentence start the regex could not rule out, and a
        genuinely one-off name rarely needs a Thread.
      - anything already in the alias map is not unspun by definition.
      - `ignore` carries the phrases the writer has retired with "not a
        connection", which must never be raised again.

    Sentence-initial words are the known weakness and are handled by the
    frequency floor rather than by a parts-of-speech guess, which would need
    a language model to be right and would still be wrong in dialogue.
    """
    ignore = {i.lower() for i in (ignore or set())}
    counts: dict[str, int] = {}
    for match in _CANDIDATE_NAME_RE.finditer(text):
        name = match.group(0).strip()
        key = name.lower()
        if key in alias_map or key in ignore or key in NOT_A_NAME:
            continue
        if key.split()[0] in NOT_A_NAME:
            continue
        counts[name] = counts.get(name, 0) + 1
    return {name: n for name, n in sorted(counts.items()) if n >= minimum}
