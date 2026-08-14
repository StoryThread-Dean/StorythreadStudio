# tests/test_role_call_sites.py -- every AI request declares its job
# ===================================================================
# Model Roles only works if every AI call site actually says which kind of
# job it is doing. A single forgotten call site would silently keep using
# whatever the Default Model is, and the writer would have no way to tell
# which feature ignored their choice.
#
# So this test reads the real router source and checks the calls. It is a
# source-text test rather than a runtime one on purpose: the alternative is
# invoking fourteen endpoints with mocked HTTP just to observe an argument,
# and this catches the mistake at the moment it is typed.
#
# It also keeps ROLE_INFO honest. That table is what the Settings screen
# renders, so a role claiming a feature it does not have -- or quietly
# having none at all -- becomes a lie told to the writer in the UI.

import re
from pathlib import Path

from app.ai.roles import ROLE_INFO, ROLES

ROUTERS = Path(__file__).resolve().parents[1] / "app" / "routers"
AI_PY = ROUTERS / "ai.py"
AUDIOBOOK_PY = ROUTERS / "audiobook.py"

# Matches the first argument of each call: _resolve_model_and_key(<this>, ...
# The alternation matters: the argument may be a quoted role, a bare None
# from the old signature, or a nested call like _editor_chat_role(...) whose
# own closing paren would otherwise cut the match short.
CALL_RE = re.compile(
    r"_resolve_model_and_key\(\s*"
    r"(\"[^\"]*\"|'[^']*'|None|[A-Za-z_][A-Za-z0-9_.]*\([^)]*\)|role[^,)]*)"
)


def _call_site_roles(path: Path) -> list[str]:
    """
    Every role argument passed in one file, as written in the source.

    Skips the definition itself and the test-double signature, which both
    mention the name without calling it.
    """
    source = path.read_text(encoding="utf-8")
    found = []
    for match in CALL_RE.finditer(source):
        arg = match.group(1).strip()
        if arg.startswith("role:") or arg == "role":
            continue          # the def line, not a call
        found.append(arg)
    return found


def _all_call_sites() -> list[str]:
    return _call_site_roles(AI_PY) + _call_site_roles(AUDIOBOOK_PY)


def test_every_call_site_names_a_real_role():
    sites = _all_call_sites()
    # Sanity: if this collapses to a handful, the regex broke rather than
    # the code improving.
    assert len(sites) >= 14, f"only found {len(sites)} call sites -- regex drift?"

    allowed = {f'"{role}"' for role in ROLES} | {"'" + r + "'" for r in ROLES}
    # editor-chat picks its role per request; _editor_chat_role is itself
    # covered by test_editor_chat_role_covers_every_category below.
    allowed.add("_editor_chat_role(request.category)")

    for arg in sites:
        assert arg in allowed, (
            f"_resolve_model_and_key({arg}) does not name a known role. "
            f"Every AI call site must declare its job -- see app/ai/roles.py."
        )


def test_no_call_site_passes_none():
    # The old signature took the model override first, so `(None)` used to
    # be the ordinary call. If one survived a merge it would now mean
    # "role=None", which raises -- but catching it here names the file.
    for arg in _all_call_sites():
        assert arg != "None", "a call site still uses the pre-roles signature"


def test_editor_chat_role_covers_every_category():
    # One endpoint, three kinds of work. The mapping must agree with the
    # temperature branch a few dozen lines below it in the same function.
    from app.routers.ai import _editor_chat_role

    assert _editor_chat_role("chat") == "brainstorm"
    assert _editor_chat_role("draft") == "prose"
    assert _editor_chat_role("enhance") == "prose"
    for structured in ("readability", "structure", "context"):
        assert _editor_chat_role(structured) == "critique"


# ── ROLE_INFO must describe reality ──────────────────────────────────────────

def test_roles_with_features_are_actually_used_somewhere():
    used = set()
    for arg in _all_call_sites():
        used.add(arg.strip("\"'"))
    # editor-chat contributes three roles that never appear as literals.
    used |= {"brainstorm", "prose", "critique"}

    for role in ROLES:
        if ROLE_INFO[role]["reserved"]:
            continue
        assert role in used, (
            f"'{role}' is not marked reserved but no call site uses it. "
            f"Settings would show a picker that does nothing."
        )


def test_reserved_roles_have_no_features_and_say_why():
    for role in ROLES:
        info = ROLE_INFO[role]
        if not info["reserved"]:
            continue
        assert info["features"] == [], (
            f"'{role}' is marked reserved but claims features it does not have"
        )
        assert info["reserved_note"].strip(), (
            f"'{role}' is reserved but does not tell the writer why it is empty"
        )


def test_unreserved_roles_list_the_features_that_use_them():
    for role in ROLES:
        info = ROLE_INFO[role]
        if info["reserved"]:
            continue
        assert info["features"], f"'{role}' is in use but lists no features"
