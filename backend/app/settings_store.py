# settings_store.py -- Global App Settings
# ==========================================
# Stores and retrieves app-wide settings (API key, default model, etc.)
# in a JSON file at ~/.storyforge/settings.json.
#
# Why a file and not SQLite here?
# Settings are global (not per-project), small, and rarely change.
# A plain JSON file is simpler to read, edit, and debug than SQLite
# for this use case. The per-project SQLite DB (app.db) is for caching
# and indexing -- not global config.
#
# Why ~/.storyforge/?
# It lives in the user's home directory, not the project folder, so the
# API key doesn't accidentally get committed to a project's git repo.

import json
import os
from pathlib import Path

# The directory and file where settings are stored
SETTINGS_DIR  = Path.home() / ".storyforge"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"


def _default_vault_root() -> str:
    """
    The fallback location for the StoryForge "vault" -- the parent folder
    where new projects and series are created. Defaults to the user's
    Documents/StoryForge so the writer doesn't have to pick a folder every
    time they start a new project.
    """
    return str(Path.home() / "Documents" / "StoryForge")


# Default values used when settings.json doesn't exist yet or is missing a key
DEFAULT_SETTINGS: dict = {
    "openrouter_api_key": "",
    "default_model":      "openai/gpt-4o-mini",
    "content_mode":       "general",
    # cost_tier: which price tier to filter models by in the Settings picker.
    # Values: "free" | "budget" | "standard" | "premium"
    # "standard" is the default -- shows all models up to ~$15/M input tokens.
    "cost_tier":          "standard",
    # text_only_filter: when True, the model picker hides models that output
    # non-text content (images, audio, video). Writers don't need these.
    "text_only_filter":   True,
    # starred_models: list of model IDs the writer has pinned as favorites.
    # Stored as a JSON array (list of strings).
    "starred_models":     [],
    # model_allowlist: if non-empty, ONLY these models can be used.
    # Takes precedence over blocklist. Empty = no restriction.
    "model_allowlist":    [],
    # model_blocklist: these models are excluded from selection.
    # Ignored if allowlist is non-empty.
    "model_blocklist":    [],
    # model_content_modes: maps model IDs to their allowed content modes.
    # e.g. {"anthropic/claude-3.5-sonnet": ["general", "mature"]}
    # Models not listed default to ["general"] only.
    "model_content_modes": {},
    # vault_root: parent folder where new projects and series get placed.
    # The default keeps the writer's library inside their Documents folder
    # so it lands somewhere familiar, gets backed up by their existing
    # Documents-folder backups, and never asks where to put a new project.
    # Writers can change this in the Settings screen.
    "vault_root":          _default_vault_root(),
}


def load_settings() -> dict:
    """
    Read settings from disk. Returns defaults if the file doesn't exist.
    Always merges with defaults so new keys added in future versions
    are available even on old settings files.
    """
    if not SETTINGS_FILE.exists():
        return dict(DEFAULT_SETTINGS)

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            stored = json.load(f)
        # Merge: start with defaults, overlay what's stored
        # This means new keys added to DEFAULT_SETTINGS are always present
        return {**DEFAULT_SETTINGS, **stored}
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULT_SETTINGS)


def save_settings(settings: dict) -> None:
    """
    Write settings to disk. Creates ~/.storyforge/ if it doesn't exist.
    Only saves known keys (ignores unknown fields from the request).
    """
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)

    # Only persist keys we know about -- avoids storing garbage from bad requests
    safe = {k: settings.get(k, v) for k, v in DEFAULT_SETTINGS.items()}

    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(safe, f, indent=2)


def get_api_key() -> str:
    """Convenience function: just return the OpenRouter API key."""
    return load_settings().get("openrouter_api_key", "")


def get_default_model() -> str:
    """Convenience function: just return the default model ID."""
    return load_settings().get("default_model", DEFAULT_SETTINGS["default_model"])


def get_vault_root() -> str:
    """
    Return the resolved vault root path and ensure the directory exists.

    Falls back to the default location (Documents/StoryForge) if the saved
    value is empty or whitespace. Always creates the directory tree if it's
    missing, so callers don't have to worry about first-run setup.
    """
    raw = (load_settings().get("vault_root") or "").strip()
    if not raw:
        raw = _default_vault_root()
    # Create the folder lazily on first access. exist_ok=True is idempotent
    # and a missing parent (e.g. a moved Documents folder on Windows) bubbles
    # up as a real error so the writer knows their vault path is broken.
    os.makedirs(raw, exist_ok=True)
    return raw
