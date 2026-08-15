# routers/extractor.py -- the Profile Extractor's HTTP surface
# =============================================================
# `The Weave > Weaving | Profile Extractor`. Weaving finds the NAMES in a
# manuscript and asks the writer to describe them; this reads the prose and
# proposes the CONTENT.
#
# Its own router rather than more of codex.py, which is already 2,400 lines.
#
# ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────
#
# Nothing reaches a profile except through `POST /part`, one part at a time,
# each with an explicit action the writer chose. There is deliberately no
# apply-all, no "accept this entry", and no default.
#
# That is not caution for its own sake. This pass carries NO EVIDENCE -- an
# Overview is synthesis and has no source sentence to quote, so the
# verification `speaker_analysis.py` performs cannot exist here (roadmap
# decision 4). With nothing checking the proposals, the writer's click is the
# only thing standing between a model's guess and their story bible. Every
# convenience that removes a click removes the whole safeguard.
#
# ── AND THE ONE THAT PROTECTS THEIR WORDS ───────────────────────────────────
#
# `merge` APPENDS. If the writer has two paragraphs and the proposal has one,
# they end with three in that order. Nothing of theirs is rewritten, reordered
# or interleaved. Roadmap decision 2, stated by the writer, and the reason
# `overwrite` is a separate button they have to choose on purpose.

import asyncio
import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app import codex_store
from app.codex import extract
from app.codex import extraction_store as store
from app.codex.errors import CodexError
from app.codex.migrate import entries_home
from app.codex.threads import parse_thread, render_thread
from app.codex.types_registry import load_registry, type_by_id
from app.utils.atomic import replace_atomic
from app.utils.paths import validate_project_path
from app.utils.structure_store import ordered_chapter_ids

router = APIRouter(prefix="/api/extractor", tags=["extractor"])

# A whole novel in one request is the point of the feature, so the ceiling is
# high -- but not absent. Past this the request is likelier to be a mistake (a
# folder of the wrong kind of file) than a book, and a model that refuses after
# ten minutes costs more than one that refuses now.
MAX_MANUSCRIPT_CHARS = 900_000

# Longer than the speaker pass's ceiling and for the opposite reason: this is
# reading an entire book, and a large model legitimately takes minutes over it.
EXTRACT_TIMEOUT = 600.0


# ── Reading the project ─────────────────────────────────────────────────────

def _registry(project_path: str) -> dict:
    registry, _ = load_registry(project_path)
    return registry


def _thread_dir(project_path: str, registry: dict, type_id: str) -> str:
    type_entry = type_by_id(registry, type_id)
    folder = (type_entry or {}).get("folder") or type_id
    return os.path.join(project_path, entries_home(project_path), folder)


def _all_threads(project_path: str, registry: dict) -> list[dict]:
    """
    Every entry the writer has, read from the FILES.

    From the folder the project actually uses -- `entries_home` decides, the
    same single answer the sidebar and the editor ask for. An unconverted
    project still has a world, and reading the wrong folder would tell this
    pass the writer has nothing and make it propose one from scratch.
    """
    threads: list[dict] = []
    for type_entry in registry.get("types") or []:
        folder = _thread_dir(project_path, registry, type_entry["id"])
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".md"):
                continue
            try:
                with open(os.path.join(folder, name), "r", encoding="utf-8") as f:
                    thread = parse_thread(f.read(), registry)
            except OSError:
                continue
            thread["filename"] = name
            threads.append(thread)
    return threads


def _written_chars(thread: dict) -> int:
    """How much the writer has actually put into an entry."""
    total = 0
    for section in (thread.get("sections") or {}).values():
        total += len((section.get("content") or "").strip())
        for block in section.get("trait_blocks") or []:
            total += len((block.get("description") or "").strip())
    return total


# How much writing counts as "you have already done this one". Deliberately
# generous: the tick is only a DEFAULT and every one is reversible, so the cost
# of being wrong is one click either way. A low bar would pre-tick entries with
# a single line in them, which is exactly the sort this pass helps most.
FULLY_WRITTEN_CHARS = 600


@router.get("/plan")
async def get_plan(project_path: str = Query(...)):
    """
    What a run would cover, and what it would cost, before anything is spent.

    Two lists. The chapters, because whole-manuscript is the recommended path
    and per-chapter is for addenda afterwards. And every established entry with
    a SUGGESTED tick against the ones that already look written.

    The ticks are suggestions and nothing else (roadmap decision 7). Automatic
    skipping was considered and rejected for a reason from the writer's own
    example: nothing here can know that a character who appeared briefly in
    chapter two has returned for the rest of the book, so it would skip exactly
    the entry they wanted revisited.
    """
    project_path = validate_project_path(project_path)
    registry = _registry(project_path)

    chapters = []
    total_chars = 0
    for chapter_id, filename in ordered_chapter_ids(project_path):
        path = os.path.join(project_path, "manuscript", filename)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except (OSError, UnicodeDecodeError):
            continue
        total_chars += len(text)
        chapters.append({
            "chapter_id": chapter_id,
            "filename": filename,
            "title": os.path.splitext(filename)[0].replace("-", " ").strip(),
            "chars": len(text),
        })

    known = []
    for thread in _all_threads(project_path, registry):
        written = _written_chars(thread)
        known.append({
            "entity_id": thread.get("entity_id", ""),
            "name": thread.get("name", ""),
            "type": thread.get("type", ""),
            "written_chars": written,
            "suggest_exclude": written >= FULLY_WRITTEN_CHARS,
        })
    known.sort(key=lambda k: (k["type"], k["name"].lower()))

    current = store.load(project_path)
    return {
        "chapters": chapters,
        "manuscript_chars": total_chars,
        "known": known,
        # So the setup screen can say "you have 0 entries -- run Weaving first"
        # rather than letting the writer spend money discovering it.
        "has_world": bool(known),
        # What a new run would cost them in work already paid for.
        "unreviewed": store.unreviewed_count(current),
        "has_current": current is not None,
    }


@router.get("/current")
async def get_current(project_path: str = Query(...)):
    """The saved extraction, or nothing. Read-only; costs nothing."""
    project_path = validate_project_path(project_path)
    run = store.load(project_path)
    return {"run": run, "progress": store.progress(run)}


@router.delete("/current")
async def delete_current(project_path: str = Query(...)):
    project_path = validate_project_path(project_path)
    return {"discarded": store.discard(project_path)}


# ── Running the pass ────────────────────────────────────────────────────────

class RunBody(BaseModel):
    project_path: str
    # Empty means the whole manuscript, which is the recommended path.
    chapter_ids: list[str] = []
    # Entries to leave alone. Ticked by the writer on the setup screen.
    exclude: list[str] = []
    # The writer has been told how many unreviewed proposals a new run would
    # replace, and said go. Without this a run REFUSES rather than overwriting
    # work they paid for -- same shape as the accidental-close guard.
    replace_existing: bool = False


@router.post("/run")
async def post_run(body: RunBody):
    """
    Read the manuscript and propose content. Writes proposals, never profiles.

    The endpoint saves the run to `.storythread/weave/extraction.json` and
    returns it. Nothing lands in an entry here; that is `POST /part`, one
    click at a time.
    """
    from app.ai.openrouter import run_completion
    from app.routers.ai import (
        TEMPERATURE_DEFAULTS, _prompt_cache_enabled, _provider_exc,
        _resolve_model_and_key,
    )

    project_path = validate_project_path(body.project_path)
    registry = _registry(project_path)

    # THE GUARD. A new run supersedes the old one, which is what the writer
    # asked for -- but silently discarding proposals they bought is not.
    existing = store.load(project_path)
    outstanding = store.unreviewed_count(existing)
    if existing is not None and outstanding > 0 and not body.replace_existing:
        raise CodexError(
            "extraction_would_replace",
            f"You have {outstanding} proposal{'s' if outstanding != 1 else ''} "
            f"you have not looked at yet. Starting a new run replaces them.",
            str(outstanding),
        )

    wanted = set(body.chapter_ids or [])
    chapters: list[tuple[str, str]] = []
    total = 0
    for chapter_id, filename in ordered_chapter_ids(project_path):
        if wanted and chapter_id not in wanted:
            continue
        path = os.path.join(project_path, "manuscript", filename)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except (OSError, UnicodeDecodeError):
            # Named rather than silently skipped would be better; this pass
            # reports the count instead, since a chapter it cannot read is a
            # chapter the proposals will not reflect.
            continue
        total += len(text)
        chapters.append((os.path.splitext(filename)[0].replace("-", " "), text))

    if not chapters:
        raise CodexError("extraction_empty",
                         "There are no chapters to read in that selection.")
    if total > MAX_MANUSCRIPT_CHARS:
        raise CodexError(
            "extraction_too_long",
            f"That is {total:,} characters, past the {MAX_MANUSCRIPT_CHARS:,} "
            f"this pass will send in one request. Run it over part of the book "
            f"and then over the rest.",
        )

    excluded = set(body.exclude or [])
    threads = _all_threads(project_path, registry)
    # EVERY entry goes up, including the ones being left alone -- see the note
    # in extract.build_user_message. "Leave alone" means propose no changes to
    # it, not hide it: a model that is not told a character exists proposes
    # them as new, and on a well-kept project (where every entry is written up
    # enough to be ticked by default) that would turn the sensible default into
    # a screen full of duplicates.
    known = [
        {
            "name": thread.get("name", ""),
            "type": thread.get("type", ""),
            "aliases": list(thread.get("aliases") or []),
            "snippet": extract.entry_snippet(thread),
            "leave_alone": thread.get("entity_id") in excluded,
        }
        for thread in threads
    ]

    provider, api_key, model_id = _resolve_model_and_key("long_context")

    try:
        result = await asyncio.wait_for(
            run_completion(
                provider=provider, api_key=api_key, model_id=model_id,
                cache_prompts=_prompt_cache_enabled(provider),
                system_prompt=extract.EXTRACT_PROMPT,
                user_message=extract.build_user_message(
                    chapters, known, registry.get("types") or []),
                # Reading, not writing. Invention is the failure mode, and with
                # no evidence carried an invented detail is indistinguishable
                # from an observed one by the time the writer sees it.
                temperature=TEMPERATURE_DEFAULTS["critique"],
            ),
            timeout=EXTRACT_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"{model_id} did not answer within "
                   f"{int(EXTRACT_TIMEOUT)} seconds. A whole manuscript is a "
                   f"lot to read at once -- try a range of chapters, or a "
                   f"model with a larger context window in Settings.",
        )
    except httpx.HTTPStatusError as exc:
        raise _provider_exc(exc, provider)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503,
                            detail=f"Could not reach {provider.label}: {exc}")

    raw = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    proposals, dropped = extract.parse_response(raw, registry.get("types") or [])

    run = extract.build_run(
        proposals, threads, model_used=model_id, leave_alone=excluded,
        scope={
            "chapter_ids": [c for c in (body.chapter_ids or [])],
            "chapter_count": len(chapters),
            "whole_manuscript": not body.chapter_ids,
            "excluded": sorted(excluded),
        },
    )
    # Said out loud rather than hidden. A pass that quietly discarded half its
    # answer, with nothing in a position to notice, is the failure this repo
    # keeps finding.
    run["dropped"] = dropped
    store.save(project_path, run)
    return {"run": run, "progress": store.progress(run), "dropped": dropped}


# ── Applying one part, which is the only way anything is written ────────────

class PartBody(BaseModel):
    project_path: str
    item_id: str
    part_id: str
    # overwrite | merge | add | merge_trait | dismiss
    action: str
    # Which entry it lands on. Sent explicitly rather than taken from the
    # proposal, because a proposal for a NEW entry only gains an id once the
    # writer has created one, and guessing at that point would write a profile
    # nobody asked for.
    entity_id: str = ""
    # merge_trait only: the writer's existing trait to fold this into. Required,
    # never guessed -- merging into a trait the app picked is how a writer's own
    # wording gets overwritten.
    merge_into: str = ""


def _load_thread_by_id(project_path: str, registry: dict,
                       entity_id: str) -> tuple[dict, str]:
    """(thread, path). Raises if the entry is not there."""
    for type_entry in registry.get("types") or []:
        folder = _thread_dir(project_path, registry, type_entry["id"])
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".md"):
                continue
            path = os.path.join(folder, name)
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    thread = parse_thread(handle.read(), registry)
            except OSError:
                continue
            if thread.get("entity_id") == entity_id:
                thread["filename"] = name
                return thread, path
    raise CodexError("entity_not_found",
                     "That entry could not be found, so there is nowhere to "
                     "put this.")


def _save_thread(path: str, registry: dict, thread: dict) -> None:
    thread["updated_at"] = datetime.now(timezone.utc).isoformat()
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        handle.write(render_thread(thread, registry))
    replace_atomic(temp, path)


@router.post("/part")
async def post_part(body: PartBody):
    """
    Apply, or dismiss, exactly one proposal.

    THE WRITE BOUNDARY, and with no evidence carried it is the whole of the
    protection. One part, one explicit action, one click. See the module note.
    """
    project_path = validate_project_path(body.project_path)
    registry = _registry(project_path)

    run = store.load(project_path)
    if run is None:
        raise CodexError("extraction_missing",
                         "There is no extraction to work through.")

    entry = store.find_entry(run, body.item_id)
    if entry is None:
        raise CodexError("extraction_missing", "That proposal is not in this run.")
    part = store.find_part(entry, body.part_id)
    if part is None:
        raise CodexError("extraction_missing", "That proposal is not in this run.")

    action = (body.action or "").strip().lower()

    if action == "dismiss":
        store.mark_part(run, body.item_id, body.part_id, store.PART_DISMISSED)
        store.save(project_path, run)
        return {"ok": True, "progress": store.progress(run)}

    entity_id = (body.entity_id or entry.get("created_entity_id")
                 or entry.get("entity_id") or "")
    if not entity_id:
        raise CodexError(
            "extraction_no_target",
            "That proposal is for an entry you do not have yet. Create it "
            "first, then add the pieces you want.",
        )

    thread, path = _load_thread_by_id(project_path, registry, entity_id)
    section_id = part["section_id"]
    section = (thread.get("sections") or {}).get(section_id)
    if section is None:
        raise CodexError(
            "type_invalid",
            f"That entry has no '{part['heading']}' section, so there is "
            f"nowhere to put this.",
        )

    applied_as = action

    if part["form"] == store.FORM_PROSE:
        existing = (section.get("content") or "").strip()
        if action == "overwrite":
            section["content"] = part["content"]
        elif action == "merge":
            # APPEND. Roadmap decision 2, in the writer's words: two paragraphs
            # of theirs plus one of the proposal's is three paragraphs, theirs
            # first and untouched. Merge is the answer that must never lose a
            # word they wrote.
            section["content"] = (existing + "\n\n" + part["content"]).strip() \
                if existing else part["content"]
        else:
            raise CodexError("type_invalid",
                             f"'{action}' is not something you can do with a "
                             f"section of writing.")
    else:
        blocks = section.setdefault("trait_blocks", [])
        if action == "add":
            blocks.append({
                "trait": part["trait_name"],
                "description": part["content"],
                # The pass proposes weight nowhere and must not invent one.
                # `present` is the neutral middle -- and a trait the writer
                # keeps is one they will weigh themselves.
                "importance": "present",
                "subtext": False,
            })
        elif action == "merge_trait":
            target = (body.merge_into or "").strip()
            if not target:
                raise CodexError(
                    "type_invalid",
                    "Say which of your traits this should be folded into. "
                    "Merging into one the app picked is how your own wording "
                    "gets overwritten.",
                )
            match = next((b for b in blocks
                          if str(b.get("trait") or "").strip().lower()
                          == target.lower()), None)
            if match is None:
                raise CodexError("type_invalid",
                                 f"There is no trait called '{target}' to fold "
                                 f"this into.")
            existing = str(match.get("description") or "").strip()
            match["description"] = (existing + " " + part["content"]).strip()
            applied_as = f"merged into {match.get('trait')}"
        else:
            raise CodexError("type_invalid",
                             f"'{action}' is not something you can do with a "
                             f"trait.")

    _save_thread(path, registry, thread)
    await codex_store.reindex(project_path)

    store.mark_part(run, body.item_id, body.part_id, store.PART_APPLIED,
                    applied_as=applied_as)
    store.save(project_path, run)
    return {"ok": True, "applied_as": applied_as,
            "progress": store.progress(run)}


class EntryStateBody(BaseModel):
    project_path: str
    item_id: str
    # done | open
    state: str = store.ENTRY_DONE
    # Set once the writer has created the entry a NEW proposal describes, so
    # its parts know where to land and a second click cannot make a second
    # profile.
    created_entity_id: str = ""


@router.post("/entry")
async def post_entry_state(body: EntryStateBody):
    """
    Tick an entry off in the rail, or record the entry a new proposal became.

    Ticking is the writer's own act and is NOT inferred from the parts: "I have
    looked at this and want nothing from it" is a real answer that leaves every
    part open, and inferring it would either nag them forever or hide work.
    """
    project_path = validate_project_path(body.project_path)
    run = store.load(project_path)
    if run is None:
        raise CodexError("extraction_missing",
                         "There is no extraction to work through.")
    entry = store.find_entry(run, body.item_id)
    if entry is None:
        raise CodexError("extraction_missing", "That proposal is not in this run.")

    state = (body.state or "").strip().lower()
    if state not in (store.ENTRY_OPEN, store.ENTRY_DONE):
        raise CodexError("type_invalid", f"'{state}' is not a state.")
    entry["state"] = state
    if body.created_entity_id:
        entry["created_entity_id"] = body.created_entity_id

    store.save(project_path, run)
    return {"ok": True, "entry": entry, "progress": store.progress(run)}
