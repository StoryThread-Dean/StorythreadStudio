# codex/normalize.py -- "absent" means one thing, in one place
# =============================================================
# A fact has three switches (frame, revealed_at, ai_scope) and every one has
# a documented default. The trouble is where that default gets applied.
#
# It used to be applied at each consumer, with `.get("frame", TRUTH)`. That
# reads correctly and is wrong, because a fact does not arrive with the key
# MISSING -- it arrives with the key present and set to None:
#
#   - the Markdown parser fills every known key, so an unwritten frame is None
#   - the API posts JSON where an omitted field is null
#   - the index reads a NULL column back as None
#
# and `.get(key, default)` returns None for all three. The default never
# fired. Every fact added through the API resolved to nothing, silently, and
# the unit tests all passed because their fixtures set frames by hand.
#
# That is the failure mode this whole feature exists to prevent: output that
# is confidently wrong and looks like a working feature. So the fix is not to
# change one `.get` -- it is to make sure no consumer ever decides this
# question again.
#
# EVERY fact and tie passes through here on the way in: parsing, indexing,
# saving, and resolving. Downstream code can then read fields directly and
# trust them.

TRUTH = "truth"
AI_SCOPE_ALWAYS = "always"
AI_SCOPE_ON_REQUEST = "on-request"
AI_SCOPE_NEVER = "never"

VALID_AI_SCOPES = {AI_SCOPE_ALWAYS, AI_SCOPE_ON_REQUEST, AI_SCOPE_NEVER}


# ── The oldest legacy scale, and why it lives HERE ───────────────────────────
#
# Before v1.0.10 a trait's weight was `influence` on a five-value scale. Both
# Markdown parsers have to heal it, and for a long time only one of them did:
# `profiles.py` translated it and `codex/threads.py` had never heard of it, so
# converting an older project read `importance` as absent and every caller then
# defaulted it to `background` -- the FAINTEST weight. A trait the writer had
# marked `major` arrived at the bottom of the prompt, and `foreshadowing`, which
# meant SECRET rather than unimportant, lost its weight AND its secrecy.
#
# Nothing raised anything: a weight is a number and there is no obviously wrong
# one. So the map moved here, where the module that owns "what absent means"
# owns it, and both dialects read the same one. Ruling 6, which asked for one
# parser -- this is the part of it that can be done while `profiles/` is still a
# live home for unconverted projects.
#
# Old: foreshadowing | background | minor | major | core
# New: core | present | background | contextual  (plus `subtext` for secrecy)
INFLUENCE_TO_IMPORTANCE: dict[str, str] = {
    "core":           "core",
    "major":          "present",
    "minor":          "background",
    "background":     "contextual",
    # An old foreshadowing trait was secret by intent, which is now two fields.
    "foreshadowing":  "present",
}

# Old influence values that meant "secret" rather than "unimportant".
INFLUENCE_MEANT_SECRET = frozenset({"foreshadowing"})


# ── WHEN A TRAIT IS TRUE ─────────────────────────────────────────────────────
#
# A trait used to be a claim about a character full stop. That is wrong for any
# character who changes, and the writer's own example is the plainest case
# there is: Serena opens the book scrawny and average-looking, and after her
# transformation she is taller and built like an athlete. Both descriptions are
# true. Neither is true throughout, and sending both to a model at once
# produces a character with two bodies.
#
# So a trait may carry `true_in`, a list of anchors, exactly as an ENTRY may
# carry `appears_in`. Same shape, same authored-not-derived rule, same
# chapter-level comparison -- because it is the same question one level down:
# "where in the book does this hold?"
#
# THREE STATES, and the third is the one a `.get(key) or []` would destroy:
#
#   absent          always true. The default, and what every trait ever written
#                   before today means. Nothing in an existing file changes.
#   ["c-a", "c-b"]  true in those chapters and nowhere else.
#   []              TRUE NOWHERE. The writer turned the switch off and has not
#                   said where yet, or deliberately shelved the trait.
#
# That last one has to survive, which is why this returns None-or-list rather
# than a list. Collapsing empty into absent would silently re-arm a trait the
# writer had just switched off -- and it would do it on the save AFTER the one
# they were watching, which is the worst kind of wrong.

# THE WORDS A MODEL SEES when a trait is limited, and the reason they are a
# constant rather than a literal in two files.
#
# A brief assembled AT a chapter can simply drop what is not true there. Two
# paths cannot: the whole-book brief, and a profile the writer attached by hand
# as a context chip, which carries no point in the story at all. Those paths
# send both of Serena's builds, and if they send them as flat equals the model
# has no way to know they are alternatives -- it will merge them, and describe
# a scrawny woman with an athlete's shoulders.
#
# So they mark instead of filtering. Same shape as the SUBTEXT marker beside
# it, for the same reason: one token for the prompt to recognise. R2.12g is
# what happens when two serialisers of one idea drift -- a secret arrived
# protected or exposed depending purely on which path had sent it.
TRAIT_WINDOW_MARK = "ONLY IN"


def normalize_trait_window(value) -> list[str] | None:
    """
    A trait's `true_in`, with "absent" and "empty" kept apart.

    Anything that is not a list reads as absent: a hand-edited `true_in: yes`
    means the writer was trying to say "always", and refusing to guess in the
    restrictive direction would hide a trait they never meant to hide.
    """
    if value is None or isinstance(value, (str, bytes)):
        return None
    if not isinstance(value, (list, tuple, set)):
        return None
    return [text for text in (_clean(a) for a in value) if text]


def chapter_of(anchor: str) -> str:
    """The chapter half of an anchor. `c-abc/s-def` -> `c-abc`.

    Presence and trait windows are both compared by CHAPTER even though both
    are stored as anchors, so scene-level answers extend them later instead of
    replacing them -- and so a writer who answers at a scene is not excluded
    from every question asked about the chapter around it."""
    return str(anchor or "").split("/", 1)[0]


def trait_is_true_at(block: dict, at: str | None) -> bool:
    """
    Is this trait in force at this point in the story?

    True when there is no window, which is the ordinary state of every trait
    in every project that has never used this. True as well when `at` is None:
    no point in the story means the question has no answer, and filtering on a
    question with no answer is inventing one.
    """
    window = normalize_trait_window(block.get("true_in"))
    if window is None or not at:
        return True
    here = chapter_of(at)
    return any(chapter_of(anchor) == here for anchor in window)


def _clean(value) -> str | None:
    """A trimmed string, or None for anything empty. Treats "" and "   " the
    same as absent -- a blank field in a hand-edited file means the writer
    left it out, not that they meant the empty string."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_ai_scope(value) -> str:
    """
    An unrecognised scope reads as the SAFEST value, not the friendliest.

    A typo like "on request" must not quietly become "always" and start
    volunteering an author-only secret. Erring towards on-request costs the
    writer one click to see it; erring the other way costs them the reveal.
    """
    scope = _clean(value)
    if scope is None:
        return AI_SCOPE_ALWAYS
    if scope not in VALID_AI_SCOPES:
        return AI_SCOPE_ON_REQUEST
    return scope


def normalize_fact(fact: dict) -> dict:
    """
    One fact, with every documented default applied.

    Preserves any extra keys the writer invented -- normalizing is about
    filling blanks, never about discarding what we did not expect.
    """
    out = dict(fact or {})
    out["frame"] = _clean(out.get("frame")) or TRUTH
    out["ai_scope"] = normalize_ai_scope(out.get("ai_scope"))
    out["at"] = _clean(out.get("at"))
    # revealed_at deliberately stays None when unwritten. "The reader learns
    # this where it happens" is a RESOLUTION rule, applied against the
    # anchor at read time -- baking it in here would write a reveal point
    # into every file that never had one.
    out["revealed_at"] = _clean(out.get("revealed_at"))
    out["supersedes"] = _clean(out.get("supersedes"))
    out["intentional"] = bool(out.get("intentional"))
    out["axis"] = str(out.get("axis") or "").strip()
    out["value"] = str(out.get("value") or "")
    return out


# THE LONGEST A CONNECTION'S REASON MAY BE, AND WHY THERE IS A LIMIT AT ALL.
#
# This is arithmetic, not style policing. Every connection's reason goes into
# the brief the app assembles for AI, so the cost is the cap TIMES the number
# of connections in scope:
#
#     20 connections x ~120 characters  ~=    600 tokens   fits in every brief
#     20 connections x  4 paragraphs    ~= 20,000 tokens   the edges alone
#                                                          blow the budget
#
# A wordy reason does not merely read badly. It gets PRUNED OUT of the brief,
# which means the writer did the work and lost the benefit. So the limit is
# derived from what the brief can afford, and the interface uses a single-line
# input rather than a textarea -- the shape of the box does the teaching before
# any character counter has to.
REASON_LIMIT = 140


def normalize_reason(value) -> str:
    """
    A connection's reason, forced onto one line and inside the budget.

    Newlines collapse rather than being rejected: a writer who pastes two lines
    in meant both of them, and silently dropping the second half would be worse
    than joining them.
    """
    text = " ".join(str(value or "").split())
    return text[:REASON_LIMIT].rstrip()


def normalize_tie(tie: dict) -> dict:
    """
    One Tie: WHY these two relate, plus the same three switches as a fact.

    The reason comes first here because it comes first in worth. A relation id
    is a category the model could mostly have guessed from the prose:

        rel: antagonist_of            -> a label
        "she is hiding her theft
         from him"                    -> the scene, the tension, and the thing
                                        he must not notice

    Ties carry the three switches for their own reason: two characters secretly
    married, a spy's real allegiance, an alliance the reader learns of in
    chapter 20. Without them, spoiler mode would hide the secret fact while
    drawing a labelled edge that announces it.
    """
    out = dict(tie or {})
    out["rel"] = str(out.get("rel") or "").strip()
    out["reason"] = normalize_reason(out.get("reason"))
    # What the connection reads as from the OTHER end, when that is not simply
    # the same sentence backwards. Optional: a writer mid-thought should not be
    # made to answer twice.
    out["reason_inverse"] = normalize_reason(out.get("reason_inverse"))
    # WHAT THE CONNECTION IS FROM THE OTHER END, when that is a different
    # relation rather than the same one worded backwards.
    #
    # Asked for exactly that way: "Alexandra friends of Lara Croft / in reverse /
    # Lara Croft business partners with Alexandra." The registry's `inverse` is
    # the DEFAULT (mentored_by reads as mentor_of), and this overrides it per
    # connection -- because a relationship can genuinely be one thing to one
    # person and another to the other, and neither of them is wrong.
    out["rel_inverse"] = str(out.get("rel_inverse") or "").strip()
    # THE DEPTH. Deliberately NOT put through normalize_reason: that caps at
    # REASON_LIMIT, and the whole point of this field is to hold what the line
    # cannot. Nor is it capped here -- silently truncating the writer's own
    # paragraph on LOAD would destroy prose they can still see in the file, and
    # the brief already prunes what will not fit. Whitespace is collapsed so
    # the value stays a single quoted YAML scalar; a paragraph has no newlines
    # in it to lose.
    out["description"] = " ".join(str(out.get("description") or "").split())
    # "Yes, I meant that." Coerced to a real bool so a hand-written
    # `intentional: yes` and the app's own `true` mean the same thing to
    # check_ties, and so the serialiser can decide whether to write it at all.
    out["intentional"] = bool(out.get("intentional"))
    out["frame"] = _clean(out.get("frame")) or TRUTH
    out["ai_scope"] = normalize_ai_scope(out.get("ai_scope"))
    out["at"] = _clean(out.get("at"))
    out["until"] = _clean(out.get("until"))
    out["revealed_at"] = _clean(out.get("revealed_at"))
    return out


def normalize_thread(thread: dict) -> dict:
    """A Thread with its facts and ties normalized, and its own ai_scope
    settled. A Thread-level scope of "never" means the entry itself is
    author-only, whatever its individual facts say."""
    out = dict(thread or {})
    out["ai_scope"] = normalize_ai_scope(out.get("ai_scope"))
    out["run"] = [normalize_fact(f) for f in (out.get("run") or [])]
    out["ties"] = [normalize_tie(t) for t in (out.get("ties") or [])]
    return out
