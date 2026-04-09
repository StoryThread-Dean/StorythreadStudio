# routers/settings.py -- App Settings API
# ==========================================
# Exposes endpoints to read and write global app settings
# (API key, default model, content mode, cost tier).
#
# Settings are stored in ~/.storyforge/settings.json via settings_store.py.
#
# Routes:
#   GET  /api/settings        -- return current settings (API key is masked)
#   PUT  /api/settings        -- update one or more settings fields
#   POST /api/settings/test-connection  -- verify the OpenRouter API key works

from fastapi import APIRouter
from pydantic import BaseModel

from app.settings_store import load_settings, save_settings
from app.ai.openrouter import test_connection

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Pydantic Models ───────────────────────────────────────────────────────────

class SettingsResponse(BaseModel):
    """What we return to the frontend. API key is partially masked for display."""
    openrouter_api_key:     str        # Masked: "sk-or-...abc" or "" if not set
    openrouter_api_key_set: bool       # True if a key has been saved
    default_model:          str
    content_mode:           str
    cost_tier:              str
    text_only_filter:       bool
    starred_models:         list[str]


class UpdateSettingsRequest(BaseModel):
    """Fields the frontend can update. All optional -- only provided fields are changed."""
    openrouter_api_key: str | None       = None
    default_model:      str | None       = None
    content_mode:       str | None       = None
    cost_tier:          str | None       = None
    text_only_filter:   bool | None      = None
    starred_models:     list[str] | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=SettingsResponse)
async def get_settings():
    """
    Return the current settings. The full API key is never sent to the frontend --
    only a masked preview ("sk-or-...xyz") is shown in the UI. This prevents the
    key from appearing in browser dev tools or network logs.
    """
    settings = load_settings()
    key = settings.get("openrouter_api_key", "")

    return SettingsResponse(
        openrouter_api_key     = _mask_key(key),
        openrouter_api_key_set = bool(key),
        default_model          = settings.get("default_model", ""),
        content_mode           = settings.get("content_mode", "general"),
        cost_tier              = settings.get("cost_tier", "standard"),
        text_only_filter       = settings.get("text_only_filter", True),
        starred_models         = settings.get("starred_models", []),
    )


@router.put("", response_model=SettingsResponse)
async def update_settings(request: UpdateSettingsRequest):
    """
    Update one or more settings fields. Only provided fields are changed.
    If openrouter_api_key is provided and non-empty, it replaces the stored key.
    If it's an empty string, it clears the stored key.
    """
    settings = load_settings()

    if request.openrouter_api_key is not None:
        settings["openrouter_api_key"] = request.openrouter_api_key.strip()
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

    save_settings(settings)

    key = settings.get("openrouter_api_key", "")
    return SettingsResponse(
        openrouter_api_key     = _mask_key(key),
        openrouter_api_key_set = bool(key),
        default_model          = settings.get("default_model", ""),
        content_mode           = settings.get("content_mode", "general"),
        cost_tier              = settings.get("cost_tier", "standard"),
        text_only_filter       = settings.get("text_only_filter", True),
        starred_models         = settings.get("starred_models", []),
    )


@router.post("/test-connection")
async def test_openrouter_connection():
    """
    Test whether the stored OpenRouter API key is valid.
    Calls the OpenRouter models endpoint and reports success or failure.
    The frontend calls this when the user clicks 'Test Connection' in Settings.
    """
    api_key = load_settings().get("openrouter_api_key", "")

    if not api_key:
        return {"ok": False, "error": "No API key saved. Enter your OpenRouter key in Settings first."}

    result = await test_connection(api_key)
    return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mask_key(key: str) -> str:
    """
    Partially mask an API key for safe display in the UI.
    "sk-or-v1-abcdefghijklmnop" -> "sk-or-...mnop"
    Returns "" if the key is empty.
    """
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return key[:6] + "..." + key[-4:]
