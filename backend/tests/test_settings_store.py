# tests/test_settings_store.py -- Settings persistence guardrails
# ================================================================
# These tests exist to lock in the patch-safe write behavior of
# settings_store.py. The original implementation used a plain
# open("w") truncate-then-write, which meant a process kill mid-write
# (taskkill /F during a Tauri updater patch install) could leave
# settings.json empty -- silently wiping the saved OpenRouter API key.
#
# The hardened implementation:
#   1. Writes to settings.json.tmp first, then os.replace() to settings.json.
#   2. Refreshes settings.json.bak before each replace (one-generation backup).
#   3. load_settings() recovers from .bak if the live file is corrupt.
#
# We patch the module-level SETTINGS_DIR / SETTINGS_FILE / SETTINGS_BACKUP /
# SETTINGS_TMP constants to point at a per-test temp directory so each test
# is isolated and the developer's real ~/.storythread is never touched.

import json

import pytest

from app import settings_store


@pytest.fixture
def isolated_settings(tmp_path, monkeypatch):
    """
    Redirect settings_store's file paths into a tmp_path so each test gets
    a fresh empty ~/.storythread sandbox. Yields the tmp dir for assertions.
    """
    sandbox = tmp_path / ".storythread"
    monkeypatch.setattr(settings_store, "SETTINGS_DIR",    sandbox)
    monkeypatch.setattr(settings_store, "SETTINGS_FILE",   sandbox / "settings.json")
    monkeypatch.setattr(settings_store, "SETTINGS_BACKUP", sandbox / "settings.json.bak")
    monkeypatch.setattr(settings_store, "SETTINGS_TMP",    sandbox / "settings.json.tmp")
    return sandbox


def test_load_returns_defaults_when_no_file(isolated_settings):
    """Fresh-install scenario: no settings.json yet -> defaults."""
    loaded = settings_store.load_settings()
    assert loaded["openrouter_api_key"] == ""
    assert loaded["default_model"] == settings_store.DEFAULT_SETTINGS["default_model"]
    # Provider fields (added with the NanoGPT provider feature).
    assert loaded["ai_provider"] == "openrouter"
    assert loaded["nanogpt_api_key"] == ""


def test_provider_fields_persist(isolated_settings):
    """ai_provider + nanogpt_api_key survive a save/load round trip.

    save_settings() only persists keys present in DEFAULT_SETTINGS, so this
    also proves the new keys were properly registered there -- a missing
    registration would silently drop them on save.
    """
    settings = settings_store.load_settings()
    settings["ai_provider"] = "nanogpt"
    settings["nanogpt_api_key"] = "nano-test-key"
    settings_store.save_settings(settings)

    loaded = settings_store.load_settings()
    assert loaded["ai_provider"] == "nanogpt"
    assert loaded["nanogpt_api_key"] == "nano-test-key"


def test_save_then_load_roundtrip(isolated_settings):
    """A saved key survives a load."""
    settings_store.save_settings({"openrouter_api_key": "sk-or-test-123"})
    loaded = settings_store.load_settings()
    assert loaded["openrouter_api_key"] == "sk-or-test-123"


def test_save_creates_backup_of_previous_file(isolated_settings):
    """Second save should snapshot the previous good file to .bak."""
    settings_store.save_settings({"openrouter_api_key": "sk-or-first"})
    settings_store.save_settings({"openrouter_api_key": "sk-or-second"})

    backup_path = isolated_settings / "settings.json.bak"
    assert backup_path.exists()
    with open(backup_path, encoding="utf-8") as f:
        backup_contents = json.load(f)
    # .bak should hold the PREVIOUS value, not the latest one
    assert backup_contents["openrouter_api_key"] == "sk-or-first"


def test_load_recovers_from_corrupt_live_file(isolated_settings):
    """
    The patch-kill scenario: settings.json got truncated to empty mid-write.
    load_settings() must read from .bak instead of returning defaults.
    """
    # Establish a good baseline so .bak gets created
    settings_store.save_settings({"openrouter_api_key": "sk-or-keep-me"})
    settings_store.save_settings({"openrouter_api_key": "sk-or-keep-me-too"})

    # Simulate a taskkill-mid-write: settings.json is now empty bytes
    live = isolated_settings / "settings.json"
    live.write_text("", encoding="utf-8")

    loaded = settings_store.load_settings()
    # Should have recovered from .bak (which holds the first value, since
    # the second save's .bak snapshot was the first save's content).
    assert loaded["openrouter_api_key"] == "sk-or-keep-me"


def test_load_recovers_from_partial_json(isolated_settings):
    """A half-written JSON file (curly brace but no closing) is treated as corrupt."""
    settings_store.save_settings({"openrouter_api_key": "sk-or-good"})
    settings_store.save_settings({"openrouter_api_key": "sk-or-newer"})

    live = isolated_settings / "settings.json"
    live.write_text('{"openrouter_api_key": "sk-or-trun', encoding="utf-8")

    loaded = settings_store.load_settings()
    assert loaded["openrouter_api_key"] == "sk-or-good"


def test_load_restores_backup_to_live_path(isolated_settings):
    """
    After recovering from .bak, the live settings.json should be repaired
    so subsequent saves have a valid baseline to update from.
    """
    settings_store.save_settings({"openrouter_api_key": "sk-or-baseline"})
    settings_store.save_settings({"openrouter_api_key": "sk-or-later"})

    live = isolated_settings / "settings.json"
    live.write_text("", encoding="utf-8")

    settings_store.load_settings()  # triggers recovery

    # Live file should now hold the .bak contents, not be empty
    with open(live, encoding="utf-8") as f:
        restored = json.load(f)
    assert restored["openrouter_api_key"] == "sk-or-baseline"


def test_load_falls_through_to_defaults_when_both_corrupt(isolated_settings):
    """If both files are unreadable, fall back to defaults (no crash)."""
    isolated_settings.mkdir(parents=True, exist_ok=True)
    (isolated_settings / "settings.json").write_text("garbage{", encoding="utf-8")
    (isolated_settings / "settings.json.bak").write_text("also garbage", encoding="utf-8")

    loaded = settings_store.load_settings()
    assert loaded["openrouter_api_key"] == ""


def test_save_does_not_overwrite_backup_with_corrupt_live(isolated_settings):
    """
    If the live file is somehow already corrupt at save time, the .bak
    must NOT be overwritten with garbage -- we only refresh the backup
    when the current live file parses successfully.
    """
    settings_store.save_settings({"openrouter_api_key": "sk-or-precious"})
    settings_store.save_settings({"openrouter_api_key": "sk-or-newer"})

    # Now both live (sk-or-newer) and .bak (sk-or-precious) are good.
    # Corrupt the live file.
    live = isolated_settings / "settings.json"
    live.write_text("not json", encoding="utf-8")

    # A new save should NOT clobber .bak with the corrupt live content.
    settings_store.save_settings({"openrouter_api_key": "sk-or-newest"})

    backup_path = isolated_settings / "settings.json.bak"
    with open(backup_path, encoding="utf-8") as f:
        bak = json.load(f)
    # .bak should still hold the older good value (sk-or-precious),
    # not the garbage that briefly lived at settings.json.
    assert bak["openrouter_api_key"] == "sk-or-precious"


def test_save_writes_via_temp_file_then_replaces(isolated_settings):
    """
    After save_settings returns, settings.json should exist and the
    .tmp sibling should be gone (os.replace consumed it).
    """
    settings_store.save_settings({"openrouter_api_key": "sk-or-x"})

    assert (isolated_settings / "settings.json").exists()
    assert not (isolated_settings / "settings.json.tmp").exists()


def test_get_api_key_returns_saved_value(isolated_settings):
    """The convenience getter reflects what was saved."""
    settings_store.save_settings({"openrouter_api_key": "sk-or-getter"})
    assert settings_store.get_api_key() == "sk-or-getter"
