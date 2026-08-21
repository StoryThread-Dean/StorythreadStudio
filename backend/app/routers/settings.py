# routers/settings.py -- App Settings API
# ==========================================
# Exposes endpoints to read and write global app settings
# (API key, default model, content mode, cost tier).
#
# Settings are stored in ~/.storythread/settings.json via settings_store.py.
#
# Routes:
#   GET  /api/settings        -- return current settings (API key is masked)
#   PUT  /api/settings        -- update one or more settings fields
#   POST /api/settings/test-connection  -- verify the OpenRouter API key works

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.settings_store import load_settings, mask_key, save_settings, get_vault_root
from app.ai.openrouter import test_connection
from app.ai.local_endpoint import LOCAL_API_STYLES, validate_local_base_url
from app.ai.providers import PROVIDERS, active_provider, base_url_for
from app.ai.roles import ROLE_INFO, ROLES

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Pydantic Models ───────────────────────────────────────────────────────────

class SettingsResponse(BaseModel):
    """What we return to the frontend. API keys are partially masked for display."""
    # Which AI service requests go to: "openrouter" or "nanogpt".
    # Each provider keeps its own stored key -- switching never loses one.
    ai_provider:            str
    openrouter_api_key:     str        # Masked: "sk-or-...abc" or "" if not set
    openrouter_api_key_set: bool       # True if a key has been saved
    nanogpt_api_key:        str        # Masked, same rules as the OpenRouter key
    nanogpt_api_key_set:    bool
    # Prompt caching (OpenRouter only): mark the static part of each request
    # as cacheable so repeat requests re-bill a fraction for it. Default on.
    prompt_caching:         bool
    default_model:          str
    content_mode:           str
    cost_tier:              str
    text_only_filter:       bool
    starred_models:         list[str]
    model_allowlist:        list[str]
    model_blocklist:        list[str]
    model_content_modes:    dict[str, list[str]]
    # Parent folder where new projects and series are placed. Defaults to
    # ~/Documents/Storythread Studio. Returned to the frontend so the Settings screen
    # can show the current path (and change it).
    vault_root:             str
    # UI theme: "dark" or "light". Drives the runtime color palette.
    theme:                  str
    # UI font scale for chrome (menus, chat, settings, About, profile labels).
    # One of "default" | "larger" | "larger_plus" | "largest". Drives the
    # root <html> font-size at runtime so every Tailwind text-* rem-based
    # utility scales proportionally. The editor uses its own pixel-sized
    # font so it is unaffected by this setting (writers control editor
    # font via the existing font picker in the editor toolbar).
    ui_scale:               str
    # How far apart lines sit in the Markdown editors, named the way a word
    # processor names it: "single" | "one_half" | "double" | "multiple".
    # Separate from ui_scale on purpose -- that one sizes the CHROME, this
    # one spaces the writer's own prose, and wanting dense menus above a
    # roomy manuscript is an ordinary preference.
    line_spacing:           str
    # The custom multiplier used when line_spacing is "multiple". Kept even
    # while another option is selected, so switching away and back does not
    # lose the number the writer typed.
    line_spacing_multiple:  float
    # Gap above and below each paragraph, in typography points. Answers a
    # different question from line_spacing: that one spaces the wrapped lines
    # inside a paragraph, these space one paragraph from the next.
    paragraph_space_before: float
    paragraph_space_after:  float
    # Writing Progress: writer's chosen skill level. Drives the daily
    # word + task targets in the Writing Progress tracker.
    writing_skill_level:    str
    # Writing Progress: hour at which "today" rolls over. 0 = midnight
    # (default), 4 = Night Owl. See progress_store.local_date_for().
    day_rollover_hour:      int
    # Model Roles: one model per KIND of job. {role: {provider, model}}.
    # An empty dict means every role uses default_model above, which is how
    # the app behaved before roles existed. See app/ai/roles.py.
    model_roles:            dict[str, dict[str, str]]
    # Address of a model running on the writer's own machine, and which API
    # shape it speaks. Restricted to local destinations -- see
    # app/ai/local_endpoint.py.
    local_base_url:         str
    local_api_style:        str


class UpdateSettingsRequest(BaseModel):
    """Fields the frontend can update. All optional -- only provided fields are changed."""
    # "openrouter" or "nanogpt". Unknown values are silently ignored (same
    # forward-compatible pattern as theme below).
    ai_provider:         str | None                   = None
    openrouter_api_key:  str | None                   = None
    # NanoGPT key: non-empty replaces, empty string clears -- identical
    # handling to the OpenRouter key.
    nanogpt_api_key:     str | None                   = None
    prompt_caching:      bool | None                  = None
    default_model:       str | None                   = None
    content_mode:        str | None                   = None
    cost_tier:           str | None                   = None
    text_only_filter:    bool | None                  = None
    starred_models:      list[str] | None             = None
    model_allowlist:     list[str] | None             = None
    model_blocklist:     list[str] | None             = None
    model_content_modes: dict[str, list[str]] | None  = None
    # Empty string resets to the default location (~/Documents/Storythread Studio).
    # Any non-empty value is taken as-is. The directory is created on next
    # use; we don't validate it exists at save time so writers can set a
    # not-yet-created folder if they want.
    vault_root:          str | None                   = None
    # "dark" or "light". Anything else is ignored.
    theme:               str | None                   = None
    # One of "default" | "larger" | "larger_plus" | "largest". Anything else
    # is ignored. Forward-compatible if more steps are added later.
    ui_scale:            str | None                   = None
    # One of "single" | "one_half" | "double" | "multiple". Anything else
    # is ignored, same forward-compatible pattern as theme and ui_scale.
    line_spacing:        str | None                   = None
    # Clamped to 0.8-5.0 at write time. Below roughly 0.8 the lines
    # physically overlap and the prose stops being readable.
    line_spacing_multiple: float | None                = None
    # Points. Clamped 0-72 (an inch) at write time.
    paragraph_space_before: float | None                = None
    paragraph_space_after:  float | None                = None
    # One of the seven skill levels. Anything else is silently coerced to
    # "novice" (the default) when written.
    writing_skill_level: str | None                   = None
    # Only 0 or 4 are accepted. Anything else is clamped to 0 at write time.
    day_rollover_hour:   int | None                   = None
    # {role: {provider, model}}. Entries naming an unknown role or provider
    # are dropped on write (the response echoes what was actually stored, so
    # the UI shows the truth rather than a value that did not stick).
    model_roles:         dict[str, dict[str, str]] | None = None
    # A local model's address. Unlike most fields here, an invalid value is
    # a 400 rather than a silent ignore: the writer typed an address and
    # needs to be told why it was refused. Empty string clears it.
    local_base_url:      str | None                   = None
    # "openai" or "ollama". Anything else is ignored.
    local_api_style:     str | None                   = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=SettingsResponse)
async def get_settings():
    """
    Return the current settings. The full API key is never sent to the frontend --
    only a masked preview ("sk-or-...xyz") is shown in the UI. This prevents the
    key from appearing in browser dev tools or network logs.
    """
    return _settings_response(load_settings())


@router.put("", response_model=SettingsResponse)
async def update_settings(request: UpdateSettingsRequest):
    """
    Update one or more settings fields. Only provided fields are changed.
    If openrouter_api_key is provided and non-empty, it replaces the stored key.
    If it's an empty string, it clears the stored key.
    """
    settings = load_settings()

    if request.ai_provider is not None and request.ai_provider in PROVIDERS:
        # Silently ignore unknown providers rather than 400 -- same
        # forward-compatible pattern as theme/ui_scale below.
        settings["ai_provider"] = request.ai_provider
    if request.openrouter_api_key is not None:
        settings["openrouter_api_key"] = request.openrouter_api_key.strip()
    if request.nanogpt_api_key is not None:
        settings["nanogpt_api_key"] = request.nanogpt_api_key.strip()
    if request.prompt_caching is not None:
        settings["prompt_caching"] = request.prompt_caching
    if request.default_model is not None:
        settings["default_model"] = request.default_model
    if request.content_mode is not None:
        settings["content_mode"] = request.content_mode
    if request.cost_tier is not None:
        settings["cost_tier"] = request.cost_tier
    if request.text_only_filter is not None:
        settings["text_only_filter"] = request.text_only_filter
    if request.starred_models is not None:
        settings["starred_models"] = request.starred_models
    if request.model_allowlist is not None:
        settings["model_allowlist"] = request.model_allowlist
    if request.model_blocklist is not None:
        settings["model_blocklist"] = request.model_blocklist
    if request.model_content_modes is not None:
        settings["model_content_modes"] = request.model_content_modes
    if request.vault_root is not None:
        # Empty string is a sentinel for "reset to default" -- store as ""
        # and let get_vault_root() substitute the default at read time.
        settings["vault_root"] = request.vault_root.strip()
    if request.theme is not None and request.theme in ("dark", "light"):
        # Silently ignore unknown values rather than 400 -- forward-compatible
        # in case future themes are added in newer clients.
        settings["theme"] = request.theme
    if request.ui_scale is not None and request.ui_scale in ("default", "larger", "larger_plus", "largest"):
        # Same silent-ignore pattern as theme. Lets us add more steps later
        # without older clients breaking on the new values.
        settings["ui_scale"] = request.ui_scale
    if request.line_spacing is not None and request.line_spacing in (
        "single", "one_half", "double", "multiple",
    ):
        # Silently ignore unknown values, as above.
        settings["line_spacing"] = request.line_spacing
    if request.line_spacing_multiple is not None:
        # Clamp rather than reject: this arrives from a numeric input the
        # writer is still typing in, and a 400 on the way to a valid number
        # is worse than storing the nearest usable one.
        settings["line_spacing_multiple"] = max(0.8, min(5.0, float(request.line_spacing_multiple)))
    if request.paragraph_space_before is not None:
        settings["paragraph_space_before"] = max(0.0, min(72.0, float(request.paragraph_space_before)))
    if request.paragraph_space_after is not None:
        settings["paragraph_space_after"] = max(0.0, min(72.0, float(request.paragraph_space_after)))
    if request.writing_skill_level is not None:
        # Coerce unknown levels to "novice" (the documented default) rather
        # than 400'ing -- forward-compatible if more steps are added later.
        valid_levels = ("newbie", "beginner", "novice", "amateur",
                        "experienced", "fulltime", "professional")
        settings["writing_skill_level"] = (
            request.writing_skill_level
            if request.writing_skill_level in valid_levels
            else "novice"
        )
    if request.day_rollover_hour is not None:
        # Only midnight (0) and Night Owl (4) are valid. Anything else clamps
        # to 0 so a stray value doesn't shift the gauge unexpectedly.
        settings["day_rollover_hour"] = (
            request.day_rollover_hour
            if request.day_rollover_hour in (0, 4)
            else 0
        )
    if request.model_roles is not None:
        settings["model_roles"] = _clean_model_roles(request.model_roles)
    if request.local_base_url is not None:
        raw = request.local_base_url.strip()
        if not raw:
            settings["local_base_url"] = ""      # clearing it is always fine
        else:
            # A 400 rather than a silent ignore: the writer typed an address
            # and the refusal message explains the rule (loopback / private /
            # .local only). Silently dropping it would look like a save bug.
            try:
                validate_local_base_url(raw)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            settings["local_base_url"] = raw
    if request.local_api_style is not None and request.local_api_style in LOCAL_API_STYLES:
        settings["local_api_style"] = request.local_api_style

    save_settings(settings)
    return _settings_response(settings)


class TestConnectionRequest(BaseModel):
    """Optional body for POST /test-connection.

    provider: which provider to test ("openrouter" | "nanogpt"). When absent,
    the saved ai_provider is tested. Lets the Settings screen test a
    provider's key BEFORE the user saves the switch to it.
    """
    provider: str | None = None


@router.post("/test-connection")
async def test_provider_connection(request: TestConnectionRequest | None = None):
    """
    Test whether a provider's stored API key is valid.
    Calls that provider's models endpoint and reports success or failure.
    The frontend calls this when the user clicks 'Test Connection' in Settings.
    """
    settings = load_settings()

    # Pick the provider under test: explicit request wins, else the active one.
    requested = (request.provider if request else None) or ""
    provider = PROVIDERS.get(requested) or active_provider(settings)

    if provider.endpoint_from_settings:
        return await _test_local_connection(settings, provider)

    api_key = settings.get(provider.api_key_setting, "")
    if not api_key:
        return {"ok": False, "error": f"No API key saved. Enter your {provider.label} key in Settings first."}

    result = await test_connection(api_key, provider=provider)
    return result


async def _test_local_connection(settings: dict, provider) -> dict:
    """
    Test a local model server, and be specific about how it failed.

    Three failures are worth telling apart, because the fix differs:
      - the address is not a valid local one    -> fix the address
      - nothing is listening                    -> start the server
      - it answers, but on the OTHER API shape  -> flip one setting

    That last case is the reason this does not sniff the style up front.
    Guessing would hide the mismatch; testing the writer's choice and then
    checking the alternative lets the app say "you picked Ollama, but it
    answered as OpenAI-compatible -- switch?" and hand back the fix.
    """
    import dataclasses

    chosen = str(settings.get("local_api_style") or "openai")
    other = "ollama" if chosen == "openai" else "openai"

    async def _try(style: str) -> dict:
        probe = dict(settings, local_api_style=style)
        candidate = dataclasses.replace(
            provider, base_url=base_url_for(provider, probe),
            model_list_style="ollama_tags" if style == "ollama" else "openai",
        )
        return await test_connection("", provider=candidate)

    try:
        result = await _try(chosen)
    except ValueError as exc:
        # base_url_for refused the address itself.
        return {"ok": False, "error": str(exc)}

    if result.get("ok"):
        result["style"] = chosen
        if not result.get("model_count"):
            result["error"] = (
                "Connected, but no models are loaded. Pull or load a model in "
                "your local runtime first."
            )
        return result

    # It did not answer the way the writer said it would. Before reporting a
    # dead server, check whether it is simply speaking the other dialect.
    try:
        alt = await _try(other)
    except ValueError:
        alt = {"ok": False}
    if alt.get("ok"):
        return {
            "ok": False,
            "style": other,
            "suggested_style": other,
            "error": (
                f"That address answered, but as a {other} endpoint rather than "
                f"{chosen}. Switch the API style to {other}."
            ),
        }

    return {
        "ok": False,
        "style": chosen,
        "error": result.get("error")
                 or "Nothing answered at that address. Is the server running?",
    }


@router.get("/roles")
async def get_roles():
    """
    The role catalog the Settings screen renders.

    Served from the backend rather than duplicated in TypeScript so the
    list of jobs, and the features each one covers, cannot drift from what
    the AI call sites actually do. tests/test_role_call_sites.py checks this
    same table against the real source.

    `reserved` marks a role no feature uses yet. Those still appear, with
    their reason, because a picker that silently does nothing is worse than
    one that explains itself.
    """
    return {
        "roles": [
            {
                "id":            role,
                "label":         ROLE_INFO[role]["label"],
                "blurb":         ROLE_INFO[role]["blurb"],
                "detail":        ROLE_INFO[role]["detail"],
                "features":      ROLE_INFO[role]["features"],
                "reserved":      ROLE_INFO[role]["reserved"],
                "reserved_note": ROLE_INFO[role].get("reserved_note", ""),
            }
            for role in ROLES
        ]
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean_model_roles(raw: dict) -> dict:
    """
    Keep only role assignments this build can actually honour.

    Drops unknown role ids and unknown providers (a stale client, or a
    hand-edited file), and treats a half-filled entry as unset -- the same
    rule ai/roles.py applies when reading. The PUT response echoes what was
    stored, so anything dropped is visible in the UI immediately rather than
    appearing to save and then quietly not working.
    """
    cleaned: dict[str, dict[str, str]] = {}
    for role, entry in (raw or {}).items():
        if role not in ROLES or not isinstance(entry, dict):
            continue
        provider = str(entry.get("provider") or "").strip()
        model = str(entry.get("model") or "").strip()
        if provider in PROVIDERS and model:
            cleaned[role] = {"provider": provider, "model": model}
    return cleaned


def _settings_response(settings: dict) -> SettingsResponse:
    """
    Build the settings payload the frontend sees.

    One builder for both GET and PUT: they returned byte-identical blocks
    before, and every new field was two edits that could disagree.
    """
    key = settings.get("openrouter_api_key", "")
    nano_key = settings.get("nanogpt_api_key", "")
    return SettingsResponse(
        ai_provider            = active_provider(settings).key,
        openrouter_api_key     = _mask_key(key),
        openrouter_api_key_set = bool(key),
        nanogpt_api_key        = _mask_key(nano_key),
        nanogpt_api_key_set    = bool(nano_key),
        prompt_caching         = bool(settings.get("prompt_caching", True)),
        default_model          = settings.get("default_model", ""),
        content_mode           = settings.get("content_mode", "general"),
        cost_tier              = settings.get("cost_tier", "standard"),
        text_only_filter       = settings.get("text_only_filter", True),
        starred_models         = settings.get("starred_models", []),
        model_allowlist        = settings.get("model_allowlist", []),
        model_blocklist        = settings.get("model_blocklist", []),
        model_content_modes    = settings.get("model_content_modes", {}),
        # get_vault_root() resolves blanks to the default and ensures the
        # directory exists -- frontend always sees a real path.
        vault_root             = get_vault_root(),
        theme                  = settings.get("theme", "dark"),
        ui_scale               = settings.get("ui_scale", "default"),
        line_spacing           = settings.get("line_spacing", "one_half"),
        line_spacing_multiple  = float(settings.get("line_spacing_multiple", 1.15) or 1.15),
        paragraph_space_before = float(settings.get("paragraph_space_before", 0.0) or 0.0),
        paragraph_space_after  = float(settings.get("paragraph_space_after", 8.0) or 8.0),
        writing_skill_level    = settings.get("writing_skill_level", "novice"),
        day_rollover_hour      = int(settings.get("day_rollover_hour", 0) or 0),
        model_roles            = settings.get("model_roles", {}) or {},
        local_base_url         = settings.get("local_base_url", "") or "",
        local_api_style        = settings.get("local_api_style", "openai") or "openai",
    )


def _mask_key(key: str) -> str:
    """
    Partially mask an API key for safe display in the UI.
    "sk-or-v1-abcdefghijklmnop" -> "sk-or-...mnop"

    The rule itself lives in settings_store.mask_key so the audiobook's
    narration-key surface masks identically -- two copies would drift.
    """
    return mask_key(key)
