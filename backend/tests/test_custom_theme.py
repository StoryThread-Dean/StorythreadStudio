"""The custom theme: what a stored palette is allowed to contain.

WHY THIS IS VALIDATED AT ALL, given the writer is typing their own colours
into their own app: every value here is written straight into a `style`
attribute on `<html>` by the frontend. An unvalidated string in that position
is a CSS injection into the app's own chrome -- and the path in is not
necessarily the colour picker. `settings.json` is a plain file a writer can
hand-edit, sync between machines, or paste from a forum post, and a
"theme pack" shared as JSON is an obvious thing for people to start doing.

So the shape is checked on the way IN and again on the way OUT, and the check
is the same one both times.

WHY IT DROPS ENTRIES RATHER THAN REJECTING THE REQUEST: this arrives from a
screen with fifty-six inputs. One malformed row must not cost the writer the
other fifty-five, and a dropped token falls back to the shipped value, which is
visible on screen rather than silent.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.settings import _clean_custom_theme
from app.settings_store import DEFAULT_SETTINGS


client = TestClient(app)


# ── What a colour may look like ──────────────────────────────────────────────

@pytest.mark.parametrize("value", [
    "#1E1E1E",                    # the ordinary case, 45 of the 56 tokens
    "#abc",                       # shorthand a writer will type
    "#FFFFFF8C",                  # 8-digit, colour plus alpha
    "rgb(255 255 255 / 0.55)",    # the form App.css uses for the inks
    "rgb(0 0 0 / 0.66)",
    "rgba(10, 20, 30, 0.5)",      # commas, from anywhere else
    "rgb(0 0 0 / 50%)",           # percentage alpha
    "rgb(1 2 3)",                 # no alpha at all
])
def test_accepts_every_shape_the_app_and_a_writer_produce(value):
    assert _clean_custom_theme({"--st-bg-panel": value}) == {"--st-bg-panel": value}


@pytest.mark.parametrize("value", [
    # The reason this function exists. Each of these would otherwise be written
    # verbatim into a style attribute.
    "red; background-image: url(http://evil/x)",
    "#fff; position: fixed",
    "url(javascript:alert(1))",
    "var(--st-bg-panel)",          # indirection: harmless-looking, and a cycle
    "expression(alert(1))",
    "#fff}",
    "</style><script>",
    # Merely malformed, which is the far more likely case.
    "#12",
    "#GGGGGG",
    "rebeccapurple",               # a real CSS colour, but not a shape we store
    "",
    "   ",
])
def test_refuses_anything_that_is_not_plainly_a_colour(value):
    assert _clean_custom_theme({"--st-bg-panel": value}) == {}


def test_refuses_a_key_that_is_not_a_role_token():
    # The key is used as a custom property NAME. Anything outside the --st-*
    # namespace either does nothing or reaches a property the app did not mean
    # to expose.
    for key in ["color", "--evil", "--st-", "background", "--st-x;color:red", "" ]:
        assert _clean_custom_theme({key: "#ffffff"}) == {}, key


def test_keeps_the_good_rows_and_drops_only_the_bad_one():
    # THE BEHAVIOUR THAT MATTERS. Fifty-six inputs; one typo must not cost the
    # writer the rest.
    cleaned = _clean_custom_theme({
        "--st-bg-panel":   "#23232D",
        "--st-bg-primary": "not a colour",
        "--st-faint":      "rgb(255 255 255 / 0.55)",
    })
    assert cleaned == {
        "--st-bg-panel": "#23232D",
        "--st-faint":    "rgb(255 255 255 / 0.55)",
    }


def test_survives_rubbish_instead_of_raising():
    # This comes off the wire and out of a hand-editable file. A 500 here would
    # make Settings unreachable, which is where the writer would go to fix it.
    assert _clean_custom_theme(None) == {}
    assert _clean_custom_theme("nope") == {}
    assert _clean_custom_theme([1, 2, 3]) == {}
    assert _clean_custom_theme({1: "#fff", "--st-bg-panel": 2}) == {}


def test_trims_surrounding_whitespace():
    assert _clean_custom_theme({"--st-bg-panel": "  #23232D  "}) \
        == {"--st-bg-panel": "#23232D"}


# ── Over HTTP ────────────────────────────────────────────────────────────────

def test_default_settings_ship_an_empty_palette():
    # Empty, not absent, and not a copy of dark: the editor seeds every token
    # from whatever theme is live when it opens, so a stored palette is always
    # complete rather than a sparse set of overrides. A pre-filled default here
    # would be a 56-value second copy of App.css to drift out of step.
    assert DEFAULT_SETTINGS["custom_theme"] == {}


def test_the_theme_field_accepts_custom():
    # Before this, "custom" would have been silently dropped by the same
    # forward-compatible tolerance that drops an unknown ui_scale -- the PUT
    # returns 200 and stores nothing, so the writer's theme would come back as
    # dark on the next launch with nothing to diagnose.
    res = client.get("/api/settings")
    assert res.status_code == 200
    assert "custom_theme" in res.json()


def test_a_palette_round_trips_through_the_api(tmp_path, monkeypatch):
    import app.settings_store as store
    monkeypatch.setattr(store, "SETTINGS_DIR", tmp_path)
    monkeypatch.setattr(store, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(store, "SETTINGS_BACKUP", tmp_path / "settings.json.bak")
    monkeypatch.setattr(store, "SETTINGS_TMP", tmp_path / "settings.json.tmp")

    put = client.put("/api/settings", json={
        "theme": "custom",
        "custom_theme": {
            "--st-bg-panel": "#101010",
            "--st-faint":    "rgb(255 255 255 / 0.6)",
            "--st-nope":     "#ffffff",           # well-formed name, kept here
            "--st-border":   "red; float: left",  # not a colour, dropped
        },
    })
    assert put.status_code == 200

    got = client.get("/api/settings").json()
    assert got["theme"] == "custom"

    # THE DIVISION OF LABOUR, and it is deliberate rather than an oversight.
    #
    # This layer validates the SHAPE of a name (--st-* and nothing exotic) and
    # the shape of a value. It does NOT check the name against the app's real
    # list of 56 tokens, because that list lives in TypeScript beside the
    # editor that renders it, and copying it into Python would be a second
    # cross-language list to keep in step for no benefit -- the frontend's
    # sanitizeCustomTheme() drops anything it does not recognise before it can
    # reach the DOM, and themeTokens.test.ts already pins that registry
    # against App.css.
    #
    # So --st-nope survives storage and is ignored on the way to the screen.
    # What matters here is that the INJECTION attempt did not survive.
    assert got["custom_theme"] == {
        "--st-bg-panel": "#101010",
        "--st-faint":    "rgb(255 255 255 / 0.6)",
        "--st-nope":     "#ffffff",
    }
    assert "--st-border" not in got["custom_theme"]
