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
from pathlib import Path

# The directory and file where settings are stored
SETTINGS_DIR  = Path.home() / ".storyforge"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"

# Default values used when settings.json doesn't exist yet or is missing a key
DEFAULT_SETTINGS: dict = {
    "openrouter_api_key": "",
    "default_model": "openai/gpt-4o-mini",
    "content_mode": "general",
    "cost_tier": "balanced",
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
