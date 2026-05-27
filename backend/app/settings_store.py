# settings_store.py -- Global App Settings
# ==========================================
# Stores and retrieves app-wide settings (API key, default model, etc.)
# in a JSON file at ~/.storythread/settings.json.
#
# Why a file and not SQLite here?
# Settings are global (not per-project), small, and rarely change.
# A plain JSON file is simpler to read, edit, and debug than SQLite
# for this use case. The per-project SQLite DB (app.db) is for caching
# and indexing -- not global config.
#
# Why ~/.storythread/?
# It lives in the user's home directory, not the project folder, so the
# API key doesn't accidentally get committed to a project's git repo.

import json
import logging
import os
import shutil
from pathlib import Path

# The directory and file where settings are stored
SETTINGS_DIR  = Path.home() / ".storythread"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"
# Rolling one-generation backup of the last known-good settings.json.
# Written before each successful save and used by load_settings() to recover
# if settings.json is missing or corrupt (e.g. truncated by a process kill
# during a patch install -- see the patch-safe write logic below).
SETTINGS_BACKUP = SETTINGS_DIR / "settings.json.bak"
# Temp file used for atomic writes. os.replace(tmp, real) is atomic on Windows
# (and POSIX), so a kill mid-write can leave the .tmp in a half state but
# settings.json itself is never seen empty or partial by a future reader.
SETTINGS_TMP    = SETTINGS_DIR / "settings.json.tmp"

log = logging.getLogger(__name__)


def _default_vault_root() -> str:
    """
    The fallback location for the Storythread Studio "vault" -- the parent folder
    where new projects and series are created. Defaults to the user's
    Documents/Storythread Studio so the writer doesn't have to pick a folder
    every time they start a new project.
    """
    return str(Path.home() / "Documents" / "Storythread Studio")


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
    # theme: UI color theme. "dark" (default charcoal/navy) or "light"
    # (warm off-white "paper" feel). Persisted globally so the writer's
    # preference applies across all projects.
    "theme":               "dark",
    # ui_scale: interface font size step. One of:
    # "default" | "larger" | "larger_plus" | "largest"
    # Drives the root <html> font-size so Tailwind rem utilities scale.
    "ui_scale":            "default",
    # writing_skill_level: drives the daily word + task targets shown in the
    # Writing Progress tracker. Values: "newbie" | "beginner" | "novice"
    # | "amateur" | "experienced" | "fulltime" | "professional".
    # Default "novice" (1,250 words/day, 2 tasks/day) is a reasonable middle
    # bar -- ambitious enough to feel meaningful, not so high it discourages.
    "writing_skill_level": "novice",
    # day_rollover_hour: clock hour at which "today" rolls into "tomorrow"
    # for daily-goal accounting. 0 = midnight (default). 4 = Night Owl mode
    # for writers who work past midnight -- anything from 00:00 through 03:59
    # still counts toward yesterday's progress.
    "day_rollover_hour":   0,
}


def _read_settings_file(path: Path) -> dict | None:
    """
    Try to read and parse a settings file. Returns the parsed dict on success,
    or None if the file is missing, unreadable, empty, or not valid JSON.

    "None" is the sentinel for "this file can't be trusted" so the caller can
    decide whether to fall back to the backup or to defaults.
    """
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        if not text.strip():
            # Truncated-to-zero-bytes case: a process kill between truncate
            # and write leaves the file empty. Treat as unreadable.
            return None
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            return None
        return parsed
    except (json.JSONDecodeError, OSError):
        return None


def load_settings() -> dict:
    """
    Read settings from disk. Returns defaults if no readable file exists.

    Recovery order:
      1. settings.json (the live file)
      2. settings.json.bak (last known-good snapshot)
      3. DEFAULT_SETTINGS (fresh-install behavior)

    Step 2 protects against the patch-install scenario: if the backend was
    killed mid-write (taskkill /F during an update), settings.json may be
    empty or partial JSON. The .bak file -- written before each successful
    save -- still holds the previous good content, including the API key.

    Always merges with defaults so new keys added in future versions
    are available even on old settings files.
    """
    primary = _read_settings_file(SETTINGS_FILE)
    if primary is not None:
        return {**DEFAULT_SETTINGS, **primary}

    backup = _read_settings_file(SETTINGS_BACKUP)
    if backup is not None:
        # Log to stderr so the recovery shows up in the sidecar drain --
        # useful for diagnosing future patch-related bug reports.
        log.warning(
            "settings.json unreadable; recovered from %s", SETTINGS_BACKUP
        )
        # Restore the backup as the live file so subsequent saves have a
        # valid baseline to update from. Best-effort: if the restore fails
        # we still return the parsed backup so the current request works.
        try:
            shutil.copy2(SETTINGS_BACKUP, SETTINGS_FILE)
        except OSError as exc:
            log.warning("Could not restore settings.json from backup: %s", exc)
        return {**DEFAULT_SETTINGS, **backup}

    return dict(DEFAULT_SETTINGS)


def save_settings(settings: dict) -> None:
    """
    Write settings to disk atomically, with a rolling one-generation backup.

    Sequence:
      1. Write the new content to settings.json.tmp.
      2. If the current settings.json exists and parses as JSON, copy it to
         settings.json.bak first -- so the .bak always holds the previous
         known-good state, never garbage from a partial write.
      3. os.replace(tmp, settings.json) -- atomic on Windows and POSIX.

    Why atomic? open("w") truncates the file before writing. If the process
    is killed (e.g. taskkill /F during a Tauri updater install) between the
    truncate and the json.dump, settings.json is left empty. os.replace
    swaps the file in one filesystem operation: a future reader either sees
    the old file or the new one, never an empty/partial file.
    """
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)

    # Only persist keys we know about -- avoids storing garbage from bad requests
    safe = {k: settings.get(k, v) for k, v in DEFAULT_SETTINGS.items()}

    # 1. Write the new content to a sibling temp file. Same directory so the
    #    replace below is a rename within one filesystem (required for atomic
    #    replace on Windows).
    with open(SETTINGS_TMP, "w", encoding="utf-8") as f:
        json.dump(safe, f, indent=2)
        # Flush + fsync so the bytes are on disk before we swap. Without
        # this, a power-loss event after replace() could still leave an
        # empty file if the OS hadn't flushed the temp's contents yet.
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            # fsync isn't available on every Windows filesystem (e.g. some
            # network drives). The atomic replace alone is still a big
            # improvement over the previous truncate-and-write approach.
            pass

    # 2. Snapshot the current live file as backup, but ONLY if it parses --
    #    we don't want to overwrite a good backup with a corrupted live file.
    if _read_settings_file(SETTINGS_FILE) is not None:
        try:
            shutil.copy2(SETTINGS_FILE, SETTINGS_BACKUP)
        except OSError as exc:
            # Non-fatal: if the backup copy fails we still proceed with the
            # main write. Worst case we lose one generation of history.
            log.warning("Could not refresh settings.json.bak: %s", exc)

    # 3. Atomic swap: tmp becomes the new settings.json.
    os.replace(SETTINGS_TMP, SETTINGS_FILE)


def get_api_key() -> str:
    """Convenience function: just return the OpenRouter API key."""
    return load_settings().get("openrouter_api_key", "")


def get_default_model() -> str:
    """Convenience function: just return the default model ID."""
    return load_settings().get("default_model", DEFAULT_SETTINGS["default_model"])


def get_rollover_hour() -> int:
    """
    Return the configured day-rollover hour for daily-progress accounting.

    Valid values: 0 (midnight, default) or 4 (Night Owl). Anything else is
    clamped to 0 so a stray bad value doesn't shift the gauge unexpectedly.
    """
    raw = load_settings().get("day_rollover_hour", 0)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return 0
    return value if value in (0, 4) else 0


def get_vault_root() -> str:
    """
    Return the resolved vault root path and ensure the directory exists.

    Falls back to the default location (Documents/Storythread Studio) if the saved
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
