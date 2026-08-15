# codex/extraction_store.py -- the one saved extraction, and why it is a file
# ============================================================================
# The Profile Extractor reads a whole manuscript with a model and comes back
# with proposed content for every entry it can see. On a real novel that is not
# a sitting, it is a JOB. The writer's own words when they scoped it:
#
#   "that process is saved locally for processing to which the writer can do all
#    in one go, or if its extremely large, might take multiple sessions. The data
#    remains until a brand new process request is made, to which the previous one
#    is overwritten as the new one supersedes it."
#
# So: exactly ONE current extraction, held on disk, worked through over as many
# evenings as it takes. No history, because the writer said the new one
# supersedes the old and a history nobody asked for is a folder that grows
# forever.
#
# WHY A FILE AND NOT app.db. Same reason `findings.py` keeps answers in a file:
# everything in the SQLite cache is rebuildable from Markdown, and this is not.
# A proposal was PAID FOR in tokens. Deleting the cache must never cost the
# writer money they already spent, and the cache is documented as safe to
# delete, so anything expensive that cannot be recomputed has no business in it.
#
# THE ONE RULE THAT MAKES SUPERSEDING SAFE. Overwriting is what the writer
# asked for, but a new run started on top of forty unreviewed proposals throws
# away forty things they bought. So `unreviewed_count` exists, and the route
# refuses to start a second run without explicit consent. Same shape as the
# accidental-close guard (R11.5): the destructive act is fine, doing it without
# saying so is not.
#
# WHAT THIS DELIBERATELY DOES NOT DO. It does not detect that the manuscript
# moved under a long review. That is a direct consequence of one-run-until-
# superseded and it is the writer's choice rather than an oversight -- the
# screen says WHEN the run was made and leaves re-running to them. Recorded here
# so a later session does not "fix" it by adding staleness machinery nobody
# asked for; with no evidence carried (roadmap decision 4) there is nothing to
# hash against anyway.

import json
import os
import re
import uuid
from datetime import datetime, timezone

from app.utils.atomic import replace_atomic

SCHEMA_VERSION = 1

EXTRACTION_FILE = "extraction.json"

# A part is one thing the writer can click: a section's prose, or one trait.
FORM_PROSE = "prose"
FORM_TRAIT = "trait"

# Part states. `open` is untouched; the other two are both "dealt with", kept
# apart because a dismissed proposal and an applied one look identical in a
# count and mean opposite things to a writer scanning the rail.
PART_OPEN = "open"
PART_APPLIED = "applied"
PART_DISMISSED = "dismissed"

# Entry states. `done` is the writer ticking the row off in the rail; it is
# theirs to set and is NOT inferred from the parts, because "I have looked at
# this and want nothing from it" is a real answer that leaves every part open.
ENTRY_OPEN = "open"
ENTRY_DONE = "done"

_RUN_ID_RE = re.compile(r"^ext-[0-9a-f]{12}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def extraction_path(project_path: str) -> str:
    """Beside the Weaving answers, for the same reason: not a cache."""
    return os.path.join(project_path, ".storythread", "weave", EXTRACTION_FILE)


def new_run(*, model_used: str = "", scope: dict | None = None) -> dict:
    """An empty extraction. Entries are added by the pass."""
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": "ext-" + uuid.uuid4().hex[:12],
        "created_at": _now(),
        "model_used": model_used,
        # What was asked for, kept so the screen can say "chapters 9 to 11"
        # rather than making the writer remember what they ticked a week ago.
        "scope": dict(scope or {}),
        "entries": [],
    }


def new_entry(*, entity_id: str = "", type_id: str, name: str,
              aliases: list[str] | None = None, unnamed: bool = False,
              same_as: str = "", character_kind: str = "") -> dict:
    """
    One proposed entry, which may or may not already exist in the world.

    `entity_id` empty means the pass found something the writer does not have.
    `unnamed` marks a character the prose describes without naming -- "the tall
    man" -- where the description IS the working name and must never be
    replaced by a name the model invented.

    `same_as` is the pass saying "this looks like another label for that entry
    you already have". It is an OFFER and nothing more: folding two labels
    together is `POST /alias`, and it happens only if the writer says so.
    """
    return {
        "item_id": "x-" + uuid.uuid4().hex[:10],
        "entity_id": entity_id,
        "type": type_id,
        "name": name,
        "aliases": list(aliases or []),
        "unnamed": bool(unnamed),
        "same_as": same_as,
        "character_kind": character_kind,
        "state": ENTRY_OPEN,
        # Set once the writer presses [Add to Characters]. From then on the
        # parts apply to THIS entity rather than creating another one, which
        # is what stops a double-click producing two profiles.
        "created_entity_id": "",
        "parts": [],
    }


def new_part(*, section_id: str, heading: str, form: str, content: str,
             trait_name: str = "") -> dict:
    """One clickable thing. See the module note on why nothing is bulk."""
    return {
        "part_id": "p-" + uuid.uuid4().hex[:10],
        "section_id": section_id,
        "heading": heading,
        "form": form,
        "trait_name": trait_name,
        "content": content,
        "state": PART_OPEN,
        # How it landed: overwrite / merge / add / merged-into-<trait>. Kept so
        # the screen can say what was done rather than only that something was.
        "applied_as": "",
    }


# ── Reading and writing ──────────────────────────────────────────────────────

def load(project_path: str) -> dict | None:
    """
    The current extraction, or None.

    A damaged file reads as None rather than raising. The writer's world is not
    in here -- losing this costs them a re-run, and taking the whole screen down
    over a truncated JSON file would cost them the feature.
    """
    path = extraction_path(project_path)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(loaded, dict):
        return None
    if not isinstance(loaded.get("entries", []), list):
        return None
    loaded.setdefault("entries", [])
    loaded.setdefault("scope", {})
    loaded.setdefault("model_used", "")
    return loaded


def save(project_path: str, run: dict) -> str:
    """Atomically, through the retrying rename -- see app/utils/atomic.py."""
    path = extraction_path(project_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(run, handle, indent=2, ensure_ascii=False)
    replace_atomic(temp, path)
    return path


def discard(project_path: str) -> bool:
    """Throw the current extraction away. True if there was one."""
    path = extraction_path(project_path)
    try:
        os.remove(path)
        return True
    except OSError:
        return False


# ── What a new run would cost the writer ─────────────────────────────────────

def unreviewed_count(run: dict | None) -> int:
    """
    How many proposals would be lost if a new run replaced this one.

    Counts PARTS rather than entries, because a part is the unit the writer
    acts on and an entry with nine untouched traits is nine losses, not one.
    An entry the writer ticked `done` is counted as reviewed however many parts
    they left alone -- they said they were finished with it.
    """
    if not run:
        return 0
    total = 0
    for entry in run.get("entries") or []:
        if entry.get("state") == ENTRY_DONE:
            continue
        for part in entry.get("parts") or []:
            if part.get("state") == PART_OPEN:
                total += 1
    return total


def progress(run: dict | None) -> dict:
    """Counts for the rail and the header. Derived, never stored."""
    if not run:
        return {"entries": 0, "entries_done": 0, "parts": 0,
                "parts_open": 0, "parts_applied": 0, "parts_dismissed": 0,
                "new_entries": 0}
    entries = run.get("entries") or []
    parts = [p for e in entries for p in (e.get("parts") or [])]
    return {
        "entries": len(entries),
        "entries_done": sum(1 for e in entries if e.get("state") == ENTRY_DONE),
        "parts": len(parts),
        "parts_open": sum(1 for p in parts if p.get("state") == PART_OPEN),
        "parts_applied": sum(1 for p in parts if p.get("state") == PART_APPLIED),
        "parts_dismissed": sum(1 for p in parts
                               if p.get("state") == PART_DISMISSED),
        # The pass's other half: things the writer does not have yet.
        "new_entries": sum(1 for e in entries if not e.get("entity_id")),
    }


# ── Finding things inside a run ──────────────────────────────────────────────

def find_entry(run: dict, item_id: str) -> dict | None:
    for entry in run.get("entries") or []:
        if entry.get("item_id") == item_id:
            return entry
    return None


def find_part(entry: dict, part_id: str) -> dict | None:
    for part in entry.get("parts") or []:
        if part.get("part_id") == part_id:
            return part
    return None


def mark_part(run: dict, item_id: str, part_id: str, state: str,
              applied_as: str = "") -> bool:
    """Record what happened to one proposal. False if it is not there."""
    entry = find_entry(run, item_id)
    if entry is None:
        return False
    part = find_part(entry, part_id)
    if part is None:
        return False
    part["state"] = state
    part["applied_as"] = applied_as
    return True


# ── Putting several batches back together ───────────────────────────────────

def _identity(entry: dict) -> tuple:
    """
    What makes two proposals the same thing across batches.

    The entity id when the pass matched one, because that is certain. Otherwise
    the kind and the name, folded for case and spacing -- "The Tall Man" and
    "the tall man" from two different batches are one character.
    """
    entity_id = str(entry.get("entity_id") or "").strip()
    if entity_id:
        return ("id", entity_id)
    name = " ".join(str(entry.get("name") or "").split()).lower()
    return ("name", str(entry.get("type") or ""), name)


def merge_entries(run: dict, new_entries: list[dict]) -> dict:
    """
    Fold a batch's entries into the run, combining rather than duplicating.

    A character who appears in chapters one and six is proposed by both
    batches. Appending blindly would give the writer the same person twice,
    which is the failure the whole feature exists to avoid -- R11.6's grouping
    problem, arriving by a different route.

    THE RULE FOR PARTS: a batch's parts are ADDED to the entry, and a part the
    writer has already dealt with is never disturbed. Two batches proposing an
    overview for the same character give two overview proposals, and that is
    correct -- they were written from different chapters and the writer picks.
    What must not happen is a later batch resetting a part they already applied.

    Returns counts: {"added": n, "merged": n, "parts": n}.
    """
    existing = {_identity(entry): entry for entry in run.get("entries") or []}
    counts = {"added": 0, "merged": 0, "parts": 0}

    for incoming in new_entries:
        key = _identity(incoming)
        target = existing.get(key)
        if target is None:
            run.setdefault("entries", []).append(incoming)
            existing[key] = incoming
            counts["added"] += 1
            counts["parts"] += len(incoming.get("parts") or [])
            continue

        # Same thing, seen again. Keep what the writer has already done to it
        # and add what this batch found.
        counts["merged"] += 1
        seen = {
            (part.get("section_id"), part.get("form"),
             (part.get("trait_name") or "").strip().lower(),
             (part.get("content") or "").strip())
            for part in target.get("parts") or []
        }
        for part in incoming.get("parts") or []:
            signature = (part.get("section_id"), part.get("form"),
                         (part.get("trait_name") or "").strip().lower(),
                         (part.get("content") or "").strip())
            # A batch that proposes word-for-word what another already did is
            # not new information, and two identical cards is a worse screen.
            if signature in seen:
                continue
            target.setdefault("parts", []).append(part)
            seen.add(signature)
            counts["parts"] += 1

        # An entry the writer has ticked DONE stays done. A later batch adding
        # something to it must not silently reopen a row they finished with --
        # it would reappear at the bottom of their list with no explanation.
        # The new parts are there when they choose to look.

        # A reveal found by a later batch is worth keeping if the earlier one
        # had none: it is an offer, and an offer is only ever additive.
        if incoming.get("same_as") and not target.get("same_as"):
            target["same_as"] = incoming["same_as"]
        for alias in incoming.get("aliases") or []:
            if alias not in (target.get("aliases") or []):
                target.setdefault("aliases", []).append(alias)

    return counts
