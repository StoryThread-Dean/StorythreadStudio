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

from app.utils.atomic import replace_atomic
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
    # ai_provider: which AI service requests are sent to. "openrouter"
    # (default) or "nanogpt". Each provider keeps its own API key below, so
    # switching back and forth never loses a key. See app/ai/providers.py.
    "ai_provider":        "openrouter",
    "openrouter_api_key": "",
    # nanogpt_api_key: NanoGPT's key, stored separately from OpenRouter's.
    # Same handling rules: never sent to the frontend unmasked, empty = unset.
    "nanogpt_api_key":    "",
    # Audiobook narration keys. The writing side and the narration side
    # are different jobs with different budgets: a writer may want a
    # top-tier drafting model AND a cheap narration account, or the
    # reverse. By default narration BORROWS the keys above (one key,
    # nothing to set up); turning that off reveals its own key fields.
    "audiobook_use_writing_keys": True,
    "audiobook_openrouter_api_key": "",
    "audiobook_nanogpt_api_key":    "",
    # Which hosted engine narrates the final pass, and its default voice.
    # Empty means "not chosen" -- narration then falls back to the writing
    # side's model and says out loud that it is probably wrong (see
    # audiobook/tts_providers.resolve_narration_selection). A single book
    # can override all three in its own manifest.
    "audiobook_tts_provider": "",
    "audiobook_tts_model":    "",
    "audiobook_tts_voice":    "",
    "default_model":      "openai/gpt-4o-mini",
    # prompt_caching: when True (default), OpenRouter requests mark the
    # system prompt as cacheable so supported models (Anthropic-family)
    # charge a fraction for the unchanged part of repeat requests. OpenAI
    # models cache automatically either way; providers that don't understand
    # the marker ignore it. Only applies to OpenRouter -- see ai/providers.py.
    "prompt_caching":     True,
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
    # model_roles: one model per KIND of job. Maps a role id from
    # ai/roles.py ROLES to {"provider": "...", "model": "..."} -- a PAIR,
    # because different roles may live on different services (critique on
    # one, prose on a local model). An empty dict means every role falls
    # back to default_model above, which is exactly how the app behaved
    # before roles existed. See ai/roles.resolve_role_model.
    "model_roles":        {},
    # local_base_url: the address of a model running on the writer's own
    # machine (Ollama, LM Studio, llama.cpp). Deliberately restricted to
    # loopback / private / .local addresses -- see ai/local_endpoint.py for
    # why "Local model" must not become a way to add arbitrary remote
    # providers. Empty means no local model is configured.
    "local_base_url":     "",
    # local_api_style: "openai" (the OpenAI-compatible API, which LM Studio
    # and llama.cpp speak and Ollama also offers) or "ollama" (Ollama's own
    # native API). Chosen explicitly by the writer, never sniffed -- see
    # ai/local_endpoint.LOCAL_API_STYLES.
    "local_api_style":    "openai",
    # vault_root: parent folder where new projects and series get placed.
    # The default keeps the writer's library inside their Documents folder
    # so it lands somewhere familiar, gets backed up by their existing
    # Documents-folder backups, and never asks where to put a new project.
    # Writers can change this in the Settings screen.
    "vault_root":          _default_vault_root(),
    # theme: UI color theme. "dark" (default charcoal/navy), "light" (warm
    # off-white "paper" feel), or "custom" -- the writer's own palette, held
    # in custom_theme below. Persisted globally so the choice applies across
    # all projects.
    "theme":               "dark",
    # ui_scale: interface font size step. The accepted values are _UI_SCALES
    # in routers/settings.py, which is pinned to the frontend's UiScale union
    # by tests/test_appearance_bounds.py. Seven steps as of v2.0.4, 16px to
    # 24px. Drives the root <html> font-size so Tailwind rem utilities scale.
    "ui_scale":            "default",
    # line_spacing: how far apart lines sit in the Markdown editors, named
    # the way a word processor names it. One of:
    #   "single" | "one_half" | "double" | "multiple"
    #
    # Word measures Single from the font's own metrics (ascender + descender
    # + line gap), which lands around 116% of the font size for the faces
    # writers use. CSS line-height: normal does the same thing, but "normal"
    # cannot be multiplied by 1.5, so the app needs one explicit basis
    # number. It lives in the frontend next to the dropdown that uses it
    # (SINGLE_BASIS in hooks/useLineSpacing.ts); the backend only stores the
    # writer's choice.
    #
    # Default "one_half" rather than "single": the editor shipped at a
    # line-height of 1.8 for its whole life, and 1.5 lines works out at 1.75,
    # so nobody's manuscript reflows on upgrade. It also means the default is
    # a name a writer recognises instead of a number nobody chose.
    # custom_theme: the writer's own palette, used when theme == "custom".
    # One entry per --st-* role token, e.g. {"--st-bg-panel": "#23232D"}.
    #
    # HERE AND NOT IN app.db, deliberately. app.db is per-PROJECT, documented
    # as safe to delete, and holds only what can be rebuilt from Markdown. A
    # theme is none of those things: it is global, it is not derivable from
    # anything, and a writer who cleared a cache should not lose the palette
    # they spent an evening on.
    #
    # Empty by default. The editor seeds every token from whichever theme is
    # active when the writer first opens it, so a saved palette is always
    # complete rather than a sparse set of overrides.
    "custom_theme":           {},
    # audiobook_theme / audiobook_custom_theme: the Audiobook Converter's own
    # look, INDEPENDENT of the writing app's theme above.
    #
    # Spec 5.0 originally fixed the Converter at charcoal in both app themes,
    # so the writer would always know which side of the app they were standing
    # in. That is still the default; it is now a choice rather than a rule, on
    # the writer's ruling. Independent rather than inherited because one switch
    # restyling a feature the writer is not looking at is worse than two
    # switches, and a dark editor beside a paper Converter is a combination
    # somebody can reasonably want.
    "audiobook_theme":        "dark",
    "audiobook_custom_theme": {},
    "line_spacing":           "one_half",
    # editor_font_pt: how big the writer's own prose is, in TYPOGRAPHY POINTS,
    # in the manuscript / outline / notes / summary editors. Clamped 9-24 at
    # the edge.
    #
    # Points for the same reason paragraph spacing below is in points: this is
    # the writer's document, and 12pt is the size they already know standard
    # manuscript to be. It also happens to be exact -- 12pt is 16px at CSS's
    # 96dpi.
    #
    # Default 12.0 is load-bearing, not a shrug. The editor hardcoded
    # `fontSize: "16px"` for its entire life, which no setting could reach, so
    # 12pt reproduces the app the writer had yesterday. Same rule as
    # line_spacing defaulting to "one_half" above: an upgrade must never
    # silently reflow somebody's book.
    #
    # Separate from ui_scale because the writer asked for it separately: chrome
    # is "more difficult to freely change without triggering other
    # window/tile/card issues", while prose in a wrapping editor has no layout
    # to break.
    "editor_font_pt":         12.0,
    # line_spacing_multiple: the custom multiplier used when line_spacing is
    # "multiple". Read for that value alone and otherwise left sitting, so
    # switching to Double and back does not lose what was typed. Clamped
    # 0.8-5.0 at the edge: under about 0.8 the lines physically collide.
    "line_spacing_multiple":  1.15,
    # paragraph_space_before / paragraph_space_after: the gap above and below
    # each paragraph, in TYPOGRAPHY POINTS, named and defaulted the way a word
    # processor does it (0pt before, 8pt after).
    #
    # Separate from line_spacing because they answer different questions.
    # Line spacing is the gap between the wrapped lines INSIDE a paragraph;
    # this is the gap BETWEEN paragraphs. A manuscript that ends paragraphs
    # with a single newline -- which is how real ones are written -- has no
    # blank line for line spacing to stretch, so no amount of it will ever
    # separate two paragraphs. That was reported as the line spacing control
    # being broken, twice, and it was the missing measurement rather than a
    # broken one.
    #
    # Points rather than pixels or ems because a writer who has set paragraph
    # spacing before has set it in points, and 8pt means the same thing here
    # as it does in the document they are used to. CSS takes pt natively.
    "paragraph_space_before": 0.0,
    "paragraph_space_after":  8.0,
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
    # RETRIED, NOT BARE. On Windows a rename fails while a virus scanner, the
    # search indexer, a cloud-sync client or the writer's own editor holds the
    # file open for a moment -- so a save fails at random with no cause the
    # writer could diagnose. R2.5b saw this happen for real (WinError 5) and
    # fixed the Weave's writes; these are the same one-line change in code the
    # recovery does not own, which is why they were recorded rather than swept
    # up. replace_atomic retries for ~150ms and then raises honestly.
    replace_atomic(SETTINGS_TMP, SETTINGS_FILE)


def mask_key(key: str) -> str:
    """
    A key as it may be shown back to the frontend: enough to recognize,
    never enough to use. Lives here (not in a router) because two
    surfaces mask keys now -- the writing Settings and the audiobook
    narration settings -- and two copies of this rule would drift.
    """
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return key[:6] + "..." + key[-4:]


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
