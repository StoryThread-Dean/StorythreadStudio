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


def normalize_tie(tie: dict) -> dict:
    """
    One Tie, with the same three switches as a fact.

    Ties carry them for a reason: two characters secretly married, a spy's
    real allegiance, an alliance the reader learns of in chapter 20. Without
    these, spoiler mode would hide the secret fact while drawing a labelled
    edge that announces it.
    """
    out = dict(tie or {})
    out["rel"] = str(out.get("rel") or "").strip()
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
