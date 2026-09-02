"""Appearance settings: the numbers that live in two languages at once.

WHY THIS FILE EXISTS
--------------------
Three appearance settings are defined once in TypeScript and once in Python,
and every one of them fails SILENTLY when the two copies drift. There is no
exception, no 400, no log line -- the writer makes a choice, watches it apply,
and finds it gone or altered later with nothing to diagnose.

    1. The Interface size steps.
       PUT /api/settings ignores an unknown ui_scale rather than rejecting it,
       which is deliberate (an older backend must not break on a newer client's
       value). The cost of that tolerance is that a step the frontend offers
       and ``_UI_SCALES`` omits returns 200 and stores nothing. This is not
       hypothetical: the frontend's own reader had the same shape of bug -- a
       ternary chain ending in "default" -- and adding a step without updating
       it produced exactly this disappearing-setting behaviour.

    2. The editor font-size bounds.
       A frontend offering 24pt against a backend clamping at 20 stores a size
       the writer did not choose, and the Settings screen goes on printing the
       one they did.

    3. The editor font-size default.
       If the two defaults disagree, a fresh install and an upgraded one render
       the manuscript at different sizes -- and the whole point of 12pt is that
       it is exactly the 16px the editor hardcoded for its entire life, so an
       upgrade reflows nobody's book.

The pattern is test_explain_costs.py's: Python reads the real TypeScript source
and fails the build on disagreement, rather than a comment in each file asking
the other one nicely.
"""

import re
from pathlib import Path

import pytest

from app.routers.settings import (
    _EDITOR_PT_DEFAULT,
    _EDITOR_PT_MAX,
    _EDITOR_PT_MIN,
    _UI_SCALES,
)
from app.settings_store import DEFAULT_SETTINGS


# repo/backend/tests/this_file.py -> repo/app/src/hooks
_HOOKS = Path(__file__).resolve().parents[2] / "app" / "src" / "hooks"
_UI_SCALE_TS = _HOOKS / "useUiScale.ts"
_EDITOR_FONT_TS = _HOOKS / "useEditorFontSize.ts"


def _read(path: Path) -> str:
    """Read a TypeScript source file, or fail loudly rather than skip.

    A missing file must not make this suite pass quietly -- that would be the
    same class of silence the file exists to prevent.
    """
    assert path.exists(), f"expected to find {path}; has the hook moved or been renamed?"
    text = path.read_text(encoding="utf-8")
    assert len(text) > 500, f"{path} read back as {len(text)} chars -- the read is broken"
    return text


# ── The Interface size steps ─────────────────────────────────────────────────


def _frontend_ui_scales() -> set[str]:
    """Every key in UI_SCALE_PX, which is a Record<UiScale, number>.

    Read from the MAP rather than from the type union on purpose: the map is
    what ``parseUiScale`` consults at runtime, and TypeScript already refuses
    to compile a map missing a union member. So the map is the authoritative
    list of what the app can actually store.
    """
    source = _read(_UI_SCALE_TS)
    match = re.search(
        r"export const UI_SCALE_PX:\s*Record<UiScale,\s*number>\s*=\s*\{(.*?)\}",
        source,
        re.DOTALL,
    )
    assert match, "could not find UI_SCALE_PX in useUiScale.ts -- has it been renamed?"
    body = re.sub(r"//[^\n]*", " ", match.group(1))
    keys = set(re.findall(r"([a-z_][a-z0-9_]*)\s*:", body))
    assert keys, "parsed UI_SCALE_PX but found no keys -- the regex is wrong, not the map"
    return keys


def test_every_ui_scale_the_app_offers_is_one_the_backend_will_store():
    """The failure this catches is invisible at every other layer."""
    frontend = _frontend_ui_scales()
    backend = set(_UI_SCALES)

    dropped = sorted(frontend - backend)
    assert not dropped, (
        f"useUiScale.ts offers {dropped} but _UI_SCALES in app/routers/settings.py "
        "does not accept them. The PUT will return 200 and store NOTHING, so the "
        "writer's choice survives until the next launch and then vanishes."
    )


def test_the_backend_accepts_no_scale_the_app_cannot_offer():
    """The other direction, which is harmless at runtime but means one list moved."""
    frontend = _frontend_ui_scales()
    backend = set(_UI_SCALES)

    orphaned = sorted(backend - frontend)
    assert not orphaned, (
        f"_UI_SCALES accepts {orphaned}, which useUiScale.ts no longer offers. "
        "Harmless today, but the two lists have drifted and the next edit to "
        "either one is being made against a stale picture."
    )


def test_the_scale_list_is_not_trivially_small():
    """Guard the guard: a regex that matched nothing would pass both tests above."""
    assert len(_UI_SCALES) >= 4
    assert len(_frontend_ui_scales()) >= 4


def test_parse_ui_scale_is_driven_by_the_map_not_a_ternary_chain():
    """The bug this replaced, pinned so it cannot come back.

    ``initUiScale`` used to name each id in a ternary chain ending in
    "default". Adding a step and forgetting that chain compiled cleanly, saved
    correctly, and read back as Default on the next launch.
    """
    source = _read(_UI_SCALE_TS)
    assert "export function parseUiScale" in source, (
        "parseUiScale is gone; if the parsing moved, this contract moved with it"
    )
    assert "in UI_SCALE_PX" in source, (
        "parseUiScale must test membership against UI_SCALE_PX, so that adding a "
        "step to the Record teaches the parser automatically. A hand-written list "
        "of ids here is the exact bug this function exists to remove."
    )


# ── The editor font-size bounds ──────────────────────────────────────────────


def _ts_number(source: str, name: str) -> float:
    match = re.search(rf"export const {name}\s*=\s*(-?[\d.]+)\s*;", source)
    assert match, f"could not find `export const {name}` in useEditorFontSize.ts"
    return float(match.group(1))


@pytest.mark.parametrize(
    "ts_name, py_value, what",
    [
        ("EDITOR_PT_MIN", _EDITOR_PT_MIN, "the floor"),
        ("EDITOR_PT_MAX", _EDITOR_PT_MAX, "the ceiling"),
        ("EDITOR_PT_DEFAULT", _EDITOR_PT_DEFAULT, "the default"),
    ],
)
def test_editor_font_bounds_agree_across_languages(ts_name, py_value, what):
    source = _read(_EDITOR_FONT_TS)
    assert _ts_number(source, ts_name) == py_value, (
        f"{what} for the editor font size disagrees: useEditorFontSize.ts says "
        f"{_ts_number(source, ts_name)}, app/routers/settings.py says {py_value}. "
        "The backend clamps on write, so the writer would be silently given a "
        "size they did not pick."
    )


def test_the_stored_default_matches_the_frontend_default():
    """A fresh install and an upgraded one must render at the same size."""
    assert DEFAULT_SETTINGS["editor_font_pt"] == _EDITOR_PT_DEFAULT

    source = _read(_EDITOR_FONT_TS)
    assert _ts_number(source, "EDITOR_PT_DEFAULT") == DEFAULT_SETTINGS["editor_font_pt"]


def test_twelve_points_is_sixteen_pixels():
    """The reason the default is 12 and not something rounder.

    12pt at CSS's 96dpi is exactly 16px, which is the literal MarkdownEditor
    hardcoded before this setting existed. That equality is what lets the
    control ship without reflowing a single existing manuscript, so it is
    pinned on both sides -- the frontend asserts it too.
    """
    assert _EDITOR_PT_DEFAULT * (4 / 3) == 16.0
