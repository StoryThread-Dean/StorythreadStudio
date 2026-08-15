# ai/roles.py -- Model Roles: one model per KIND of job
# ======================================================
# Storythread Studio asks an AI to do very different things. Critiquing a
# chapter, brainstorming, holding a whole manuscript in mind, and actually
# writing prose are not the same skill, and the models available today are
# not equally good at all four. Before this module, every one of those jobs
# went to a single configured model -- whatever it happened to be.
#
# A ROLE is a kind of job. The writer assigns one model to each role, and
# every AI feature in the app declares which role it belongs to. Assigning
# "critique" once therefore points the Smart Advisor, chapter summaries,
# scene summaries and the importance audit all at the same model, because
# they are all the same kind of work.
#
# Think of it like a small workshop rather than a single all-purpose tool:
# you keep one good chisel and one good saw, and every job reaches for the
# right one without you deciding again each time.
#
# This module is modelled directly on audiobook/tts_providers.py's
# resolve_narration_selection(), and for the same stated reason: several
# surfaces need this answer (the settings screen, each AI endpoint, and
# error messages), and duplicating the precedence rules in TypeScript would
# let them quietly disagree about which model -- and whose money -- is in
# play.
#
# ---------------------------------------------------------------------------
# THE ONE RULE THAT MATTERS MOST
# ---------------------------------------------------------------------------
# Configuration fallback and runtime failure are different things, and this
# module never confuses them:
#
#   An UNCONFIGURED role walks the documented precedence chain down to the
#   writer's Default Model. That is normal, expected, and quiet.
#
#   A CONFIGURED role that cannot run -- no API key, unreachable local
#   server, a model the provider does not offer -- reports usable=False and
#   says why. It NEVER substitutes a different model.
#
# Without that split, a writer assigns Claude to prose, something goes
# wrong, and they silently get GPT-4o-mini instead: same button, different
# author, no indication. The audiobook side made the same call for the same
# reason ("a silent fallback would spend on the wrong account").

from app.ai.providers import PROVIDERS, ProviderConfig, active_provider, base_url_for

# The eight kinds of job. NOTE: "fallback" is deliberately NOT here. The
# writer's Default Model is not a role -- it is the setting a role falls
# back TO when it has not been assigned one. Keeping it out of this list is
# what stops the Settings screen from showing nine pickers and implying the
# app has nine kinds of work.
ROLES = [
    "critique",
    "character_reasoning",
    "long_context",
    "brainstorm",
    "structure",
    "research",
    "prose",
    "extraction",
]

# What each role is, in the writer's terms, plus exactly which features use
# it. This lives here rather than in the frontend so the Settings screen
# cannot drift from what the call sites actually do -- there is one list,
# the UI renders it, and tests/test_role_call_sites.py checks it against
# the real source code.
#
# `reserved` marks a role no feature uses YET. Those still appear in
# Settings, because the writer should be able to see the whole shape of the
# system, but they say plainly that nothing uses them so far. Showing a
# picker that silently does nothing would be worse than showing none.
# `blurb` is the one line shown on the collapsed row. `detail` is the longer
# "What's this?" answer: what the job is, why it matters to the writer, that
# assigning is optional, and what a better model actually buys them here.
ROLE_INFO: dict[str, dict] = {
    "critique": {
        "label": "Critique",
        "blurb": "Reading your work and telling you what is not landing.",
        "detail": "Critique reads what you have already written and reports back: "
                  "a limp sentence, a scene that stalls, a description doing no "
                  "work. It never rewrites your prose unless you ask -- it points. "
                  "This is the role where model quality shows most obviously, "
                  "because a weaker model tends to flag surface tics (adverbs, "
                  "sentence length) while a stronger one notices that a scene has "
                  "no tension in it. Optional: leave it unassigned and your "
                  "Default Model does the work.",
        "features": ["Smart Advisor pass", "Writing Companion review categories",
                     "Chapter summaries", "Scene summaries",
                     "Importance audit", "AI Trim"],
        "reserved": False,
    },
    "character_reasoning": {
        "label": "Character reasoning",
        "blurb": "Would this character do this -- what they want, know, and fear.",
        "detail": "Character reasoning is the job of holding a person in mind: what "
                  "they want, what they know at this point in the story, and "
                  "whether the thing on the page is something they would actually "
                  "do. Models differ a lot here. A weaker one describes a "
                  "character back to you in the words you already used; a stronger "
                  "one catches that your protagonist is acting on information she "
                  "has not been given yet. Worth pointing at a capable model if "
                  "you use the Profile Builder seriously.",
        "features": ["Profile Builder chat", "Interview mode",
                     "Full profile summaries", "Dialogue speaker analysis"],
        "reserved": False,
    },
    "long_context": {
        "label": "Long-context analysis",
        "blurb": "Taking in whole chapters, a manuscript, or a series at once.",
        "detail": "Some questions cannot be answered from one chapter -- whether a "
                  "subplot ever resolves, whether a character's voice drifts "
                  "between books, whether a thread you planted in chapter two is "
                  "ever picked up. That needs a model that can hold an enormous "
                  "amount of text at once, which is a different strength from "
                  "writing well. This is where a very large context window earns "
                  "its cost.",
        # NO LONGER RESERVED, as of v2.0.1. The note here said "it arrives with
        # the Weave's AI passes" for two releases, which was an honest promise
        # and an unkept one -- a writer could assign a model to this role and
        # have it do nothing at all. The Profile Extractor is the pass it was
        # waiting for: it reads an entire manuscript in one request, which is
        # exactly the strength this role exists to buy.
        "features": ["Profile Extractor"],
        "reserved": False,
    },
    "brainstorm": {
        "label": "Brainstorming",
        "blurb": "Open conversation and generating possibilities to choose from.",
        "detail": "Brainstorming is the open conversation: what if the sister "
                  "survived, what else could be behind that door, give me ten "
                  "names for a river. You are looking for range and surprise "
                  "rather than polish, and you are going to throw most of it away "
                  "-- which makes this a good place for a model that is inventive "
                  "and cheap rather than the most expensive one you have. Nothing "
                  "here is written to your manuscript.",
        "features": ["Writing Companion chat"],
        "reserved": False,
    },
    "structure": {
        "label": "Structural analysis",
        "blurb": "Shape and pacing -- acts, chapters, scenes, beats.",
        "detail": "Structural analysis looks at shape rather than sentences: where "
                  "a chapter should break, whether a scene earns its place, how "
                  "pacing moves across an act. It is reasoning about architecture, "
                  "so it rewards a model that is good at holding a plan in mind. "
                  "You can leave this on your Default Model without much loss "
                  "until you are working at chapter scale.",
        "features": ["Scene break suggestions"],
        "reserved": False,
    },
    "research": {
        "label": "Research transformation",
        "blurb": "Turning notes and source material into something usable in the story.",
        "detail": "Research transformation takes what you have gathered -- notes, "
                  "articles, historical detail -- and turns it into something you "
                  "can actually write from, without it reading like an "
                  "encyclopaedia entry dropped into a scene. Accuracy matters more "
                  "than flourish here, so a model that stays close to its source "
                  "and does not embroider is the right pick.",
        "features": [],
        "reserved": True,
        "reserved_note": "Nothing uses this yet. Assign it now if you like -- "
                         "it will be used as research tools arrive.",
    },
    "prose": {
        "label": "Prose",
        "blurb": "Actually writing sentences. The most style-sensitive job here.",
        "detail": "Prose is the only role that writes sentences you might keep, "
                  "which makes it the most style-sensitive choice on this screen. "
                  "Cheap models are usually recognisable here in a way they are "
                  "not when summarising: flat rhythm, stock imagery, dialogue that "
                  "all sounds like one person. It is also the role most worth "
                  "pointing at a local model if you have one, since drafting is "
                  "where writers burn the most tokens. Everything it produces "
                  "lands in the side panel for you to accept or discard -- it "
                  "never writes into your manuscript on its own.",
        "features": ["Draft mode", "Enhance mode", "Revise suggestion"],
        "reserved": False,
    },
    "extraction": {
        "label": "Extraction (cheap work)",
        "blurb": "Mechanical passes where a small fast model is the right call.",
        "detail": "Extraction is the mechanical work: compressing a section into a "
                  "summary, pulling traits out of what you already wrote, "
                  "assembling an overview from filled-in fields. There is little "
                  "judgement involved, so an expensive model buys you almost "
                  "nothing -- this is the one role where deliberately choosing a "
                  "small, fast, cheap model is the RIGHT answer rather than a "
                  "compromise. It also runs often, so the saving adds up.",
        "features": ["Usage previews", "Generate Overview", "Section summaries"],
        "reserved": False,
    },
}


def role_label(role: str) -> str:
    """The writer-facing name of a role, for error messages."""
    return ROLE_INFO.get(role, {}).get("label", role)


def role_api_key(settings: dict, provider: ProviderConfig) -> str:
    """The stored API key for a provider, or "" when it needs none."""
    if not provider.requires_api_key:
        return ""
    return str(settings.get(provider.api_key_setting) or "")


def _assignment(source_dict: dict, role: str) -> tuple[str, str] | None:
    """
    Read one role assignment, or None when it is absent or incomplete.

    An assignment is {"provider": "...", "model": "..."} -- a PAIR, not a
    bare model string. Different roles may sit on different services, so
    the provider travels with the model. A half-filled entry (a provider
    with no model) counts as unset rather than broken: it is what a
    half-finished Settings screen leaves behind, and treating it as an
    error would block the writer from the very screen that fixes it.
    """
    entry = (source_dict or {}).get(role)
    if not isinstance(entry, dict):
        return None
    provider_key = str(entry.get("provider") or "").strip()
    model_id = str(entry.get("model") or "").strip()
    if not provider_key or not model_id:
        return None
    return provider_key, model_id


def resolve_role_model(settings: dict, project: dict | None, role: str) -> dict:
    """
    Which provider and model should do this kind of job, and can it run?

    Precedence, highest first:
      1. the app-wide role assignment    settings      model_roles[role]
      2. the Default Model chain         project.default_model
                                         -> settings.default_model
                                         -> provider.fallback_model

    THERE USED TO BE A LEVEL ABOVE THIS ONE -- a per-book `model_roles` in
    project.json -- and it was dead code with a passing test that faked the
    project dict. Deleted on the writer's ruling (R8.6), because it was deader
    than it looked: `_resolve_model_and_key` never read project.json at all. It
    synthesises `{"default_model": override}` from a single field the frontend
    sends, so no per-book assignment could ever have arrived here however
    faithfully projects.py had stored one. Most AI request models carry no
    project_path either.

    Building it properly meant threading a path through about ten request
    models, every frontend caller and a new per-book screen -- and a
    half-threaded version is worse than none, because a writer whose per-book
    choice reaches Draft but not Enhance has an app they cannot explain. Roles
    are app-wide; the spec says so now rather than describing something that was
    never true.

    `project` is still taken, and still carries `default_model`: that is level 2
    and it works.

    Returns one flat, fully-populated dict so every caller sees the same
    shape whatever the source:

      role, provider_key, provider_label, model_id
      source            "role" | "default" | "none"
      configured        True when level 1 supplied the answer
      requires_api_key, has_api_key
      usable            False means DO NOT RUN -- and do not substitute
      unusable_reason   writer-facing, present exactly when usable is False
      fallback_note     quiet explanation that a Default Model is standing in
      caveat            it will run, but here is something worth knowing

    Raises ValueError for a role that is not in ROLES. That is a
    programming mistake (roles come from call sites, never from user
    input), so it should fail loudly in tests rather than silently pick a
    model.
    """
    if role not in ROLES:
        raise ValueError(
            f"Unknown AI role '{role}'. Known roles: {', '.join(ROLES)}."
        )

    project = project or {}
    label = role_label(role)

    result: dict = {
        "role": role,
        "role_label": label,
        "provider_key": "",
        "provider_label": "",
        "model_id": "",
        "source": "none",
        "configured": False,
        "requires_api_key": False,
        "has_api_key": False,
        "usable": False,
        "unusable_reason": None,
        "fallback_note": None,
        "caveat": None,
    }

    # ── Level 1: an explicit assignment for this role ─────────────────────
    assigned = _assignment(settings.get("model_roles"), role)

    if assigned is not None:
        provider_key, model_id = assigned
        result.update({
            "configured": True,
            "source": "role",
            "provider_key": provider_key,
            "model_id": model_id,
        })
        provider = PROVIDERS.get(provider_key)
        if provider is None:
            # A hand-edited settings file, or a provider removed by an
            # update. Say what was asked for; do not quietly pick another.
            result["unusable_reason"] = (
                f"{label} is set to use a provider called '{provider_key}', "
                f"which this version of Storythread Studio does not have. "
                f"Choose a provider for {label} in Settings."
            )
            return result
        result["provider_label"] = provider.label
        return _finish(result, provider, settings, configured=True)

    # ── Level 3: the Default Model chain (today's behaviour, unchanged) ───
    provider = active_provider(settings)
    model_id = (
        str(project.get("default_model") or "")
        or str(settings.get("default_model") or "")
        or (provider.fallback_model or "")
    )
    result.update({
        "provider_key": provider.key,
        "provider_label": provider.label,
        "model_id": model_id,
        "source": "default" if model_id else "none",
    })
    if not model_id:
        result["unusable_reason"] = (
            f"No model is set for {label}, and no Default Model is chosen "
            f"either. Pick a {provider.label} model in Settings."
        )
        return result

    # Not a warning, just honesty about where the model came from -- so a
    # writer who assigned six roles and forgot the seventh can see it.
    result["fallback_note"] = (
        f"No model is assigned to {label}, so it is using your Default "
        f"Model ({model_id})."
    )
    return _finish(result, provider, settings, configured=False)


def _finish(result: dict, provider: ProviderConfig, settings: dict,
            configured: bool) -> dict:
    """
    The checks that apply however the model was chosen: is there a key, is
    the endpoint real, and is there anything worth mentioning?

    Split out so the configured and unconfigured paths cannot drift apart
    on the question of what "usable" means.
    """
    label = result["role_label"]
    result["requires_api_key"] = provider.requires_api_key

    # A hosted provider with no key cannot run. The wording differs by
    # source because the FIX differs: an assigned role needs a key for that
    # specific service, while the default path is the older, more general
    # "add your key" case writers already know.
    if provider.requires_api_key:
        api_key = role_api_key(settings, provider)
        result["has_api_key"] = bool(api_key.strip())
        if not result["has_api_key"]:
            result["unusable_reason"] = (
                f"{label} is set to use {provider.label}, but no "
                f"{provider.label} API key is saved. Add it in Settings "
                f"({provider.key_hint})."
                if configured else
                f"No {provider.label} API key found. Add your key in "
                f"Settings first."
            )
            return result

    # A local provider has no key but does have an address, and an address
    # that is missing or not actually local is just as fatal as a missing
    # key. Checking it here means the writer hears about it in Settings
    # rather than at the moment they press Draft.
    if provider.endpoint_from_settings:
        try:
            base_url_for(provider, settings)
        except ValueError as exc:
            result["unusable_reason"] = str(exc)
            return result

    result["usable"] = True

    # Usable, but worth saying out loud. Prompt caching is a real cost
    # difference on repeat requests, and a writer who turned it on in
    # Settings would reasonably assume it applies everywhere -- it does
    # not, because only some services understand the marker.
    if settings.get("prompt_caching", True) and not provider.supports_cache_control:
        result["caveat"] = (
            f"Prompt caching is on, but {provider.label} does not support it, "
            f"so repeat {label.lower()} requests will not be discounted."
        )
    return result
