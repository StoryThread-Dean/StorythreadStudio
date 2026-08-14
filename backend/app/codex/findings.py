# codex/findings.py -- what the writer already answered
# ======================================================
# The scan re-derives every stop from the book on every run, so nothing about
# the WORLD needs storing. What does need storing is everything about the
# WRITER: what they applied, what they retired, what they deferred, what they
# muted. None of that is derivable from anything, and losing it means asking
# the same dead questions next session until they stop opening the panel.
#
# ---------------------------------------------------------------------------
# WHY THIS IS NOT IN app.db
# ---------------------------------------------------------------------------
# app.db is documented, correctly, as a rebuildable cache -- delete it and
# nothing is lost. Findings are promised the opposite: never re-bought. Those
# two contracts cannot both hold for the same file, so findings live under
# `.storythread/weave/` in two files, both written atomically through
# `replace_atomic` -- which RETRIES, because on Windows a rename fails while
# a scanner or a sync client holds the file for a moment. The Weave got that
# treatment first (R2.5b, after a real WinError 5); settings_store,
# structure_store and the audiobook store followed in R10.6:
#
#   answers.json          the BOOK's permanent record -- applied, dismissed,
#                         retired phrases, muted kinds, settled names
#   runs/<run-id>.json    one SITTING -- what was staged, what was deferred
#
# The split is not tidiness; see "a session is not the right scope for
# permanently" below.
#
# There is deliberately NO SQLite mirror. A novel's worth of findings is a
# few hundred records and JSON answers every question this feature asks; a
# second store would be a second thing to keep in step, for a query nobody is
# making. If querying ever needs it, an index can be added over this -- but it
# must never become the only copy.
#
# ---------------------------------------------------------------------------
# TWO-PHASE, BECAUSE SAVING IS MANUAL
# ---------------------------------------------------------------------------
# The app has no autosave. Without two phases:
#
#     writer clicks Apply  ->  finding marked applied
#     the Thread changes in the editor buffer only
#     writer closes without saving
#     the edit is gone AND the finding never comes back
#
# So APPLIED means the file was saved. STAGED means it is sitting in an
# unsaved buffer. Discarding returns staged findings to whatever they were
# before -- pending, or deferred if the writer had already put them off.
# Only applied and dismissed are permanent.

import json
import os

from app.utils.atomic import replace_atomic
import re
import uuid
from datetime import datetime, timezone

__all__ = [
    "STATE_PENDING", "STATE_STAGED", "STATE_APPLIED", "STATE_DEFERRED",
    "STATE_DISMISSED", "STATE_STALE", "SCHEMA_VERSION",
    "answer", "book_path", "discard_staged", "empty_book", "is_permanent",
    "list_runs", "load_book", "load_run", "merge", "mute_kind", "mute_target",
    "new_run", "open_stops", "pin", "refresh", "remember_choice", "retire",
    "run_dir", "save_book", "save_run", "unpin",
]

SCHEMA_VERSION = 1

STATE_PENDING = "pending"        # not answered yet
STATE_STAGED = "staged"          # accepted into an UNSAVED buffer
STATE_APPLIED = "applied"        # the file was saved; permanent
STATE_DEFERRED = "deferred"      # "not yet" -- comes back
STATE_DISMISSED = "dismissed"    # "not a connection" -- permanent
STATE_STALE = "stale"            # the evidence text moved under it

# Answers that mean "never raise this again". Everything else returns.
_PERMANENT = frozenset({STATE_APPLIED, STATE_DISMISSED})

_RUN_ID_RE = re.compile(r"^run-[0-9a-f]{12}$")


# ── Where it lives ───────────────────────────────────────────────────────────

def run_dir(project_path: str) -> str:
    return os.path.join(project_path, ".storythread", "weave", "runs")


def _run_path(project_path: str, run_id: str) -> str:
    """
    The file for one run.

    The id is validated rather than trusted: it arrives over HTTP, and a
    run_id of "../../project.json" would otherwise be a path traversal
    dressed up as a session identifier.
    """
    if not _RUN_ID_RE.match(run_id or ""):
        raise ValueError(f"not a run id: {run_id!r}")
    return os.path.join(run_dir(project_path), f"{run_id}.json")


def _now() -> str:
    """
    Full precision, for what that is worth on this platform.

    "Carry on where you left off" sorts by this, so whole seconds are not
    enough. But the wall clock on Windows advances in steps of roughly 15ms
    however many digits it prints, so two runs saved in the same tick DO get
    identical timestamps and there is genuinely no answer to which is newer.
    list_runs breaks that tie stably rather than pretending to know; real
    sessions are minutes apart, so it never arises outside a test.
    """
    return datetime.now(timezone.utc).isoformat()


def is_permanent(state: str) -> bool:
    return state in _PERMANENT


# ── The book's permanent record ──────────────────────────────────────────────
#
# A SESSION IS NOT THE RIGHT SCOPE FOR "PERMANENTLY".
#
# "Not a connection" means never raise this again -- not "not again until you
# open Weaving tomorrow". The first version kept retirements, mutes and
# permanent answers inside the run file, so starting a new session silently
# handed the writer back every question they had already refused. That is the
# single most annoying thing a walkthrough can do, and it is invisible until
# somebody comes back a second time.
#
# So permanence lives here, once per book, and the run files are session logs
# on top of it: what was staged, what was deferred, what was seen. Both are
# under .storythread/weave/ and neither is a cache -- none of it is derivable
# from anything.

BOOK_FILE = "answers.json"


def book_path(project_path: str) -> str:
    return os.path.join(project_path, ".storythread", "weave", BOOK_FILE)


def empty_book() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        # Only ever applied and dismissed. Staged and deferred are session
        # states and belong to a run.
        "answers": {},
        "retired": [],
        "muted_kinds": [],
        # R8.3: {entity_id -> [kind]}. "Never ask" used to have exactly one
        # meaning -- never anywhere -- and the spec's word was "for this target".
        # The difference is not pedantic: a deliberately unreliable narrator's
        # entry SHOULD stop being asked about contradictions, and a writer who
        # only has that one entry in mind turns the check off for their whole
        # book to get it. This is the narrow answer, so the wide one stops being
        # the only one.
        "muted_targets": {},
        "disambiguations": {},
        # Phrases the writer marked by hand. See pin() for why this is a
        # separate list rather than a kind of answer.
        "pinned": [],
    }


def load_book(project_path: str) -> dict:
    """
    The permanent record. Always returns a usable dict, never None.

    A missing file is the normal state of a book nobody has answered anything
    in. A corrupt one is treated as empty rather than raising -- losing the
    record is bad, refusing to open Weaving at all is worse -- but it is NOT
    overwritten until the writer answers something, so a file that failed to
    parse because of a transient read is still there to be recovered by hand.
    """
    try:
        with open(book_path(project_path), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return empty_book()
    if not isinstance(data, dict):
        return empty_book()
    if int(data.get("schema_version") or 0) > SCHEMA_VERSION:
        return empty_book()
    book = empty_book()
    book.update({k: v for k, v in data.items() if k in book})
    return book


def save_book(project_path: str, book: dict) -> str:
    path = book_path(project_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    book["updated_at"] = _now()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(book, f, indent=2)
    replace_atomic(tmp, path)
    return path


def merge(book: dict, run: dict | None) -> dict:
    """
    The session laid over the permanent record.

    Run states win in general -- a stop deferred five minutes ago is more
    current than anything. But a PERMANENT answer always wins, or a stop the
    writer dismissed for good could be resurrected by a stale staged entry
    and asked again.
    """
    run = run or {}
    answers = dict(run.get("answers") or {})
    for key, entry in (book.get("answers") or {}).items():
        if is_permanent(str(entry.get("state") or "")):
            answers[key] = entry
    return {
        "answers": answers,
        # Retirements accumulate and are never taken back by a new session.
        "retired": sorted(set(book.get("retired") or [])
                          | set(run.get("retired") or [])),
        # Muting is a preference about the book, so the book is authoritative
        # -- otherwise unmuting in one session would be undone by the next.
        "muted_kinds": list(book.get("muted_kinds") or []),
        # Same reasoning, per entry. Book-authoritative for the same reason.
        "muted_targets": {k: list(v) for k, v
                          in (book.get("muted_targets") or {}).items()},
        "disambiguations": {**(book.get("disambiguations") or {}),
                            **(run.get("disambiguations") or {})},
        # Pins are about the book, never about one sitting.
        "pinned": list(book.get("pinned") or []),
    }


# ── Making, reading, writing ─────────────────────────────────────────────────

def new_run(depth: str = "full", *, types: list[str] | None = None,
            chapter_ids: list[str] | None = None) -> dict:
    """A fresh session. Not written to disk until something is answered."""
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": "run-" + uuid.uuid4().hex[:12],
        "created_at": _now(),
        "updated_at": _now(),
        "depth": depth,
        "types": list(types or []),
        "chapter_ids": list(chapter_ids or []),
        # {stop key -> {state, was, evidence_hash, at}}
        "answers": {},
        # Phrases retired with "not a connection". Kept separately from
        # answers because they are about a PHRASE, not about one stop -- the
        # same name in a different chapter must not be asked either.
        "retired": [],
        "muted_kinds": [],
        # {entity_id -> [kind]}. Mirrored from the book so the session log says
        # what happened in it; the book is what is obeyed.
        "muted_targets": {},
        # {lower-cased alias -> entity_id}, so "which John?" is asked once.
        "disambiguations": {},
    }


def load_run(project_path: str, run_id: str) -> dict | None:
    """
    A saved run, or None.

    A corrupt run file is treated as absent rather than raising. Losing a
    session's answers is bad; refusing to open Weaving at all because of it
    would be worse, and the scan itself is unaffected either way.
    """
    try:
        path = _run_path(project_path, run_id)
    except ValueError:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or not data.get("run_id"):
        return None
    if int(data.get("schema_version") or 0) > SCHEMA_VERSION:
        # Written by a newer build. Reading it with older rules could silently
        # discard fields on the next save.
        return None
    data.setdefault("answers", {})
    data.setdefault("retired", [])
    data.setdefault("muted_kinds", [])
    data.setdefault("muted_targets", {})
    data.setdefault("disambiguations", {})
    data.setdefault("pinned", [])
    return data


def save_run(project_path: str, run: dict) -> str:
    """
    Write atomically. Returns the path.

    tmp + os.replace, so a crash mid-write leaves the previous run intact
    rather than a half-written file that loads as nothing.
    """
    path = _run_path(project_path, str(run.get("run_id") or ""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    run["updated_at"] = _now()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(run, f, indent=2)
    replace_atomic(tmp, path)
    return path


def list_runs(project_path: str) -> list[dict]:
    """Summaries, newest first, for "carry on where you left off"."""
    folder = run_dir(project_path)
    if not os.path.isdir(folder):
        return []
    runs: list[dict] = []
    for name in os.listdir(folder):
        if not name.endswith(".json"):
            continue
        run = load_run(project_path, name[:-5])
        if run is None:
            continue
        answers = run.get("answers") or {}
        runs.append({
            "run_id": run["run_id"],
            "created_at": run.get("created_at", ""),
            "updated_at": run.get("updated_at", ""),
            "depth": run.get("depth", ""),
            "answered": sum(1 for a in answers.values()
                            if a.get("state") in _PERMANENT),
            "deferred": sum(1 for a in answers.values()
                            if a.get("state") == STATE_DEFERRED),
        })
    # run_id as a tiebreak, because two runs CAN share a timestamp -- the
    # Windows wall clock moves in ~15ms steps. Arbitrary-but-fixed beats a
    # list that reshuffles between reads.
    runs.sort(key=lambda r: (r["updated_at"], r["run_id"]), reverse=True)
    return runs


# ── Answering ────────────────────────────────────────────────────────────────

def answer(run: dict, key: str, state: str, *, evidence_hash: str = "") -> dict:
    """
    Record what the writer did with one stop.

    `was` remembers the state before staging, which is what makes discarding
    an unsaved buffer able to put a deferred finding back to deferred rather
    than resetting it to pending -- otherwise "not yet" would quietly become
    "ask me again immediately" every time the writer changed their mind.
    """
    answers = run.setdefault("answers", {})
    previous = answers.get(key, {})
    entry = {
        "state": state,
        "evidence_hash": evidence_hash or previous.get("evidence_hash", ""),
        "at": _now(),
    }
    if state == STATE_STAGED:
        was = previous.get("state", STATE_PENDING)
        entry["was"] = STATE_PENDING if was == STATE_STAGED else was
    answers[key] = entry
    return entry


def discard_staged(run: dict) -> int:
    """
    The writer closed without saving. Returns how many findings came back.

    This is the half of the two-phase contract that actually protects them:
    an Apply that never reached disk must return as a question, not sit in
    the ledger claiming to be done.
    """
    returned = 0
    for entry in (run.get("answers") or {}).values():
        if entry.get("state") != STATE_STAGED:
            continue
        entry["state"] = entry.pop("was", STATE_PENDING) or STATE_PENDING
        returned += 1
    return returned


def retire(run: dict, phrase: str) -> None:
    """"Not a connection" -- permanently, for the whole book."""
    retired = run.setdefault("retired", [])
    if phrase and phrase not in retired:
        retired.append(phrase)


def pin(book: dict, phrase: str, note: str = "", where: str = "") -> bool:
    """
    The writer marked a phrase by hand. Returns False if it was already pinned.

    WHY A PIN RATHER THAN A CONNECTION. The obvious version of "let me make a
    connection myself" is a form: pick a relation, pick a direction, pick two
    endpoints. That form has two failure modes with nothing to catch them --
    the writer records the wrong relation, or there is nothing to connect to
    yet and the form cannot be completed at all.
    
    A pin records only "this matters, ask me about it". There is no relation
    to get wrong, and it can wait indefinitely. The walkthrough then handles
    it like any other stop, which means it inherits the evidence quote, the
    "why am I seeing this", and the four ways to answer.

    Stored as a PHRASE, not an offset. Offsets rot the moment the writer
    edits the paragraph above; a phrase is found again by looking for it,
    which is exactly how `retired` already works.
    """
    phrase = " ".join(str(phrase or "").split())
    if not phrase:
        return False
    pinned = book.setdefault("pinned", [])
    if any(p.get("phrase", "").lower() == phrase.lower() for p in pinned):
        return False
    pinned.append({"phrase": phrase, "note": note.strip(), "where": where,
                   "at": _now()})
    return True


def unpin(book: dict, phrase: str) -> None:
    """Take a pin back. The writer marked it; only they can unmark it."""
    key = " ".join(str(phrase or "").split()).lower()
    book["pinned"] = [p for p in (book.get("pinned") or [])
                      if p.get("phrase", "").lower() != key]


def mute_kind(run: dict, kind: str, muted: bool = True) -> None:
    kinds = run.setdefault("muted_kinds", [])
    if muted and kind not in kinds:
        kinds.append(kind)
    elif not muted and kind in kinds:
        kinds.remove(kind)


def mute_target(store: dict, entity_id: str, kind: str,
                muted: bool = True) -> None:
    """
    Never ask THIS kind about THIS entry again.

    R8.3. The narrow half of "never ask", which had no narrow half: the only
    control was the whole book, so a writer who wanted one unreliable character
    left alone had to turn contradiction checking off entirely -- and then never
    hear about the rest of their book either.

    An empty list is removed rather than left behind. This is written to the
    writer's own answers file and read back on every scan; a file that
    accumulates `{"e-1": []}` for every entry they ever unmuted is a file that
    grows forever and says nothing.
    """
    if not entity_id or not kind:
        return
    targets = store.setdefault("muted_targets", {})
    kinds = list(targets.get(entity_id) or [])
    if muted:
        if kind not in kinds:
            kinds.append(kind)
    elif kind in kinds:
        kinds.remove(kind)
    if kinds:
        targets[entity_id] = kinds
    else:
        targets.pop(entity_id, None)


def remember_choice(run: dict, alias: str, entity_id: str) -> None:
    """Which John. Asked once, remembered for the run."""
    if alias and entity_id:
        run.setdefault("disambiguations", {})[alias.lower()] = entity_id


# ── Resuming ─────────────────────────────────────────────────────────────────

def refresh(run: dict, stops: list) -> dict:
    """
    Re-check a resumed run against a fresh scan. Returns a small report.

    STALENESS IS CHECKED LOCALLY AND COSTS NOTHING. Each answer stores a hash
    of the evidence it was about; comparing that to the current scan's hash is
    a string comparison, not an AI call. A writer who edits a chapter between
    sessions gets "12 findings need re-checking, that text changed" rather
    than a silent re-charge.

    An answer whose stop no longer exists is KEPT, not deleted. The condition
    may come back -- a section emptied again, a name re-added -- and a
    dismissal that evaporated the first time the problem went away would
    resurface as a question the writer already refused.

    R8.1: THE REPORT NAMES THINGS, IT DOES NOT ONLY COUNT THEM. A count alone
    is all this returned for months, and a count is not something a screen can
    act on -- so nothing rendered it, and a stop the writer had already put off
    about words that no longer exist came back looking exactly like a fresh
    one. Two extra fields make it usable:

      stale_keys  which stops, so the card itself can say so
      chapters    where they live, so "re-check just those" is one scan

    `chapters` skips stale stops that have no chapter (an entity-shaped stop
    like a Loose thread). That means a chapter-scoped re-check can MISS some of
    what went stale, so the count of those is reported too rather than left for
    the writer to discover as a number that does not add up.
    """
    answers = run.get("answers") or {}
    current = {s.key: s for s in stops}
    report: dict = {"stale": 0, "gone": 0, "answered": 0,
                    "stale_keys": [], "chapters": [], "stale_elsewhere": 0}
    chapters: list[str] = []

    for key, entry in answers.items():
        state = entry.get("state")
        if state in _PERMANENT:
            report["answered"] += 1
        stop = current.get(key)
        if stop is None:
            report["gone"] += 1
            continue
        stored = entry.get("evidence_hash") or ""
        fresh = getattr(stop, "evidence_hash", "") or ""
        # Only meaningful when BOTH sides have one. A stop with no quoted
        # evidence (a Loose thread, say) has nothing that can go stale, and
        # marking it stale because one side is empty would flag every
        # structural finding on every resume.
        if stored and fresh and stored != fresh and state not in _PERMANENT:
            entry["state"] = STATE_STALE
            report["stale"] += 1
            report["stale_keys"].append(key)
            chapter = getattr(stop, "chapter_id", "") or ""
            if chapter:
                if chapter not in chapters:
                    chapters.append(chapter)
            else:
                report["stale_elsewhere"] += 1

    report["chapters"] = chapters
    return report


def open_stops(run: dict, stops: list) -> list:
    """
    The stops still worth showing, in the order the scan produced them.

    Applied and dismissed are gone for good. Deferred comes back -- that is
    what "not yet" means, and a "not yet" that never returned would be a
    dismissal the writer did not choose. Stale comes back too, because the
    text changed and the old answer was about different words.

    Two kinds of mute are honoured here, and per-target is filtered at this
    layer rather than during the scan on purpose: the scan produces stops per
    ENTRY and this is the one place that already knows both the kind and the
    entry it landed on, so there is a single rule rather than two that can drift.
    """
    answers = run.get("answers") or {}
    muted = set(run.get("muted_kinds") or [])
    per_target = run.get("muted_targets") or {}
    return [
        stop for stop in stops
        if stop.kind not in muted
        and stop.kind not in set(per_target.get(stop.entity_id) or ())
        and (answers.get(stop.key, {}).get("state") not in _PERMANENT)
    ]
