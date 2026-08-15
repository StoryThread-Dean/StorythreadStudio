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

# HOW MUCH THE MODEL MAY WRITE BACK. Every other pass in this app leaves this
# to the model's own default, which is right for a reply about one chapter and
# wrong here: this asks for proposals covering a whole novel, and the answer is
# the largest any pass produces.
#
# Left unset, the second live run returned an EMPTY message. Gemini 2.5
# Flash-Lite is a reasoning model, and a reasoning model spends output budget
# on thinking before it writes a word -- so a default budget can be exhausted
# mid-thought and return nothing at all, which arrives looking exactly like a
# model that had nothing to say.
EXTRACT_MAX_OUTPUT = 32_000


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


async def _resolve_for_display() -> tuple[str, int, str]:
    """
    (model id, its context window in tokens, an error to show instead).

    Read-only and best-effort: this runs on a screen that has not spent
    anything yet, so every failure degrades to "we could not find out" rather
    than blocking the writer.

    A 0 window means unknown, which the caller must treat as different from
    "it fits". Claiming a fit we did not verify is exactly how a writer ends up
    paying for a request that overflows.
    """
    from app.routers.ai import _resolve_model_and_key

    try:
        provider, api_key, model_id = _resolve_model_and_key("long_context")
    except Exception as exc:                      # noqa: BLE001 - see docstring
        # An ASSIGNED role that cannot run raises rather than substituting, and
        # that message is the useful one: it names the missing key or the
        # unreachable server. Passed through rather than swallowed.
        detail = getattr(exc, "detail", None)
        return "", 0, str(detail or exc)

    return model_id, await _context_window(provider, api_key, model_id), ""


# Cached per process. This screen is opened repeatedly while a writer decides
# what to tick, and a network round trip per open would make it feel broken for
# something that changes about once a month.
_CONTEXT_CACHE: dict[str, int] = {}


async def _context_window(provider, api_key: str, model_id: str) -> int:
    """How much the model can hold, in tokens. 0 when we cannot find out."""
    if model_id in _CONTEXT_CACHE:
        return _CONTEXT_CACHE[model_id]
    window = 0
    try:
        from app.ai.openrouter import list_models

        for entry in await list_models(api_key, provider):
            if entry.get("id") == model_id:
                window = int(entry.get("context_length") or 0)
                break
    except Exception:                             # noqa: BLE001 - best effort
        window = 0
    _CONTEXT_CACHE[model_id] = window
    return window


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

    # WHICH MODEL, RESOLVED, AND WHETHER THE BOOK WILL EVEN FIT IN IT.
    #
    # Both added after the first live run, which failed in the worst possible
    # way: the writer believed they were using one model, the unassigned role
    # fell through to the Default Model, the request was about 69,000 tokens
    # against a 64,000-token window, and the answer came back unreadable. The
    # screen then said "an empty result usually means the book already says
    # what your entries say" -- a confident, reassuring, wrong explanation for
    # a request that had simply overflowed.
    #
    # Naming the model before the button is the fix for half of that. Sizing
    # the request against its context window is the fix for the rest.
    model_id, context_tokens, model_error = await _resolve_for_display()
    # ~4 characters per token is the usual rough figure for English prose. It
    # does not need to be exact: it needs to tell a 69k request from a 20k one.
    estimated_tokens = total_chars // 4

    current = store.load(project_path)
    return {
        "chapters": chapters,
        "manuscript_chars": total_chars,
        "known": known,
        # What will actually run this, so "which model just read my novel?" has
        # an answer BEFORE it reads it rather than after.
        "model_id": model_id,
        "model_error": model_error,
        "context_tokens": context_tokens,
        "estimated_tokens": estimated_tokens,
        # 0 means we could not find out, which is different from "it fits".
        "fits": (context_tokens == 0
                 or estimated_tokens < context_tokens * 0.8),
        # So the setup screen can say "you have 0 entries -- run Weaving first"
        # rather than letting the writer spend money discovering it.
        "has_world": bool(known),
        # What a new run would cost them in work already paid for.
        "unreviewed": store.unreviewed_count(current),
        "has_current": current is not None,
    }


@router.get("/models")
async def get_models_for_this_screen():
    """
    The catalog, with the numbers this screen actually needs, biggest first.

    THIS EXISTS BECAUSE THE SETTINGS PICKER CANNOT ANSWER THE QUESTION ASKED
    HERE. It groups models as budget / pricier and never shows a context
    window, which is fine when the request is one chapter and useless when it
    is an entire manuscript: the writer's own words were that the roles list
    does "not list the limits at all", leaving them to discover a bad choice by
    paying for it.

    So this is the same catalog, ordered by the number that decides the
    outcome, with the cost beside it. Nothing is written; picking a model here
    saves the app-wide Long-context role like the Settings screen does, because
    two places storing the same choice differently is how they drift apart.
    """
    from app.ai.providers import active_provider
    from app.ai.roles import role_api_key
    from app.settings_store import load_settings

    settings = load_settings()
    provider = active_provider(settings)
    api_key = role_api_key(settings, provider)
    if provider.requires_api_key and not api_key:
        return {"models": [], "error": f"No {provider.label} API key yet."}

    try:
        from app.ai.openrouter import list_models
        catalog = await list_models(api_key, provider)
    except Exception as exc:                      # noqa: BLE001 - best effort
        return {"models": [], "error": f"Could not read the model list: {exc}"}

    models = [
        {
            "id": entry.get("id", ""),
            "name": entry.get("name") or entry.get("id", ""),
            "context_length": int(entry.get("context_length") or 0),
            "cost_input_per_million": entry.get("cost_input_per_million") or 0,
            "cost_output_per_million": entry.get("cost_output_per_million") or 0,
            "is_free": bool(entry.get("is_free")),
            # Surfaced because it is the exact trap the second live run fell
            # into: a reasoning model spends its reply budget thinking and can
            # return nothing at all.
            "supports_reasoning": bool(entry.get("supports_reasoning")),
        }
        for entry in catalog
        if entry.get("id")
    ]
    # Biggest window first, because on this screen that is the whole question.
    models.sort(key=lambda m: (-m["context_length"], m["id"]))
    return {"models": models, "provider": provider.key, "error": ""}


class ChooseModelBody(BaseModel):
    """Assign the Long-context role from this screen."""
    model_id: str


@router.post("/model")
async def choose_model(body: ChooseModelBody):
    """
    Point Long-context analysis at a model, from here.

    Writes the SAME app-wide setting the Settings screen writes. A per-screen
    copy would be a second place storing one choice, and this app has already
    paid for that mistake once -- the per-book role assignment that was
    documented, never worked, and had to be deleted in R8.6.
    """
    from app.ai.providers import active_provider
    from app.settings_store import load_settings, save_settings

    settings = load_settings()
    roles = dict(settings.get("model_roles") or {})
    model_id = (body.model_id or "").strip()
    if model_id:
        roles["long_context"] = {
            "provider": active_provider(settings).key,
            "model_id": model_id,
        }
    else:
        # Empty means "unassign", which falls back to the Default Model -- the
        # documented behaviour of an unassigned role, not a special case.
        roles.pop("long_context", None)
    settings["model_roles"] = roles
    save_settings(settings)
    _CONTEXT_CACHE.clear()
    return {"ok": True, "model_id": model_id}


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

def _empty_answer_reason(finish_reason: str, model_id: str,
                         usage: dict) -> str:
    """
    Why an empty answer is empty, in a sentence the writer can act on.

    The second live run of this feature came back with nothing at all and the
    app said "the model did not return readable JSON" -- accurate, useless, and
    indistinguishable from a dozen other causes. The provider tells us which
    one it was; we simply were not asking.
    """
    spent = usage.get("completion_tokens") or 0
    if finish_reason == "length":
        return (f"{model_id} ran out of room to answer before it wrote "
                f"anything usable (it used {spent:,} tokens of its reply "
                f"budget). This happens with reasoning models, which spend "
                f"that budget thinking first. Try fewer chapters, or a model "
                f"that is not a reasoning model.")
    if finish_reason == "content_filter":
        return (f"{model_id} refused to answer, which usually means its "
                f"content filter objected to something in the manuscript. A "
                f"model without filters will read it.")
    if finish_reason:
        return (f"{model_id} returned an empty answer and gave "
                f"'{finish_reason}' as the reason.")
    return (f"{model_id} returned an empty answer and gave no reason. It may "
            f"not support being asked for JSON. Try a different model.")


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

    # WILL IT EVEN FIT. Added after the first live run, which spent a request
    # sending about 69,000 tokens to a model with a 64,000-token window and got
    # back an unreadable answer. Nothing checked, so nothing could say why.
    #
    # The 0.8 is deliberate slack rather than timidity: the manuscript is not
    # the whole request. The entry snippets, the prompt and the model's own
    # answer all have to fit alongside it, and an answer that gets truncated
    # halfway is indistinguishable from a model that could not do the job.
    context_tokens = await _context_window(provider, api_key, model_id)
    estimated = total // 4
    if context_tokens and estimated > context_tokens * 0.8:
        raise CodexError(
            "extraction_too_long",
            f"That is about {estimated:,} tokens of manuscript, and {model_id} "
            f"holds {context_tokens:,}. It would not fit, so nothing has been "
            f"sent and nothing has been spent. Run it over fewer chapters, or "
            f"assign a model with a larger context window to Long-context "
            f"analysis in Settings.",
            str(estimated),
        )

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
                max_tokens=EXTRACT_MAX_OUTPUT,
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

    # THE ANSWER, AS TEXT. Read from run_completion's own result rather than
    # from a provider shape it does not return -- which is what this code did
    # for three live runs, reading an empty string every time from a model that
    # was answering correctly. See the note in openrouter.run_completion.
    raw = result.get("raw_text") or ""
    finish_reason = str(result.get("finish_reason") or "")
    usage = result.get("usage") or {}

    # run_completion has already parsed the JSON, so when the model answered in
    # the shape we asked for, the entries are right here and re-parsing the text
    # would be doing the same work twice.
    if isinstance(result.get("entries"), list):
        proposals, dropped = extract.parse_proposals(
            result["entries"], registry.get("types") or [])
    else:
        proposals, dropped = extract.parse_response(
            raw, registry.get("types") or [])


    # An empty answer is its own diagnosis and deserves its own words, rather
    # than the generic "did not return readable JSON" -- which is true, and
    # tells the writer nothing they can act on.
    if not proposals and not (raw or "").strip():
        dropped = [_empty_answer_reason(finish_reason, model_id, usage)]

    # WHEN NOTHING SURVIVES, KEEP THE EVIDENCE. The first live failure threw the
    # model's answer away and left the writer with "nothing was proposed", which
    # is a description of the symptom offered as if it were the cause. A short
    # excerpt of what actually came back is the difference between a mystery and
    # a five-second diagnosis, and it costs nothing to keep.
    raw_excerpt = ""
    if not proposals:
        raw_excerpt = (raw or "").strip()[:600]

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
    run["raw_excerpt"] = raw_excerpt
    run["finish_reason"] = finish_reason
    run["usage"] = {
        "prompt_tokens": usage.get("prompt_tokens") or 0,
        "completion_tokens": usage.get("completion_tokens") or 0,
    }
    run["estimated_tokens"] = estimated
    run["context_tokens"] = context_tokens
    store.save(project_path, run)
    return {"run": run, "progress": store.progress(run), "dropped": dropped,
            "raw_excerpt": raw_excerpt}


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
