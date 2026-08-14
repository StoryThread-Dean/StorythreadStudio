# tests/test_version.py -- the backend agrees with itself about what it is
# =========================================================================
# R10.3. The backend reported version "0.1.0" from `GET /health` and from the API
# docs for the whole of the project's life, through eleven releases, because the
# string was typed into three files and none of them was ever bumped.
#
# Nothing broke, and that is the point: a version is a number, and there is no
# such thing as an obviously wrong one, so nothing noticed. The moment something
# DOES compare it -- a mismatch check between the Tauri shell and the sidecar it
# launched, an updater, a support question about which build is running -- the
# wrong answer is confidently wrong.
#
# One definition now lives in `app/version.py`. `pyproject.toml` keeps a copy
# because packaging metadata cannot import Python, and `scripts/release.ps1` bumps
# both. This is the test that stops those two drifting, which is the same pattern
# the repo uses everywhere one copy is genuinely not possible.

import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.version import __version__

client = TestClient(app)

BACKEND = Path(__file__).resolve().parents[1]


def _pyproject_version() -> str:
    text = (BACKEND / "pyproject.toml").read_text(encoding="utf-8")
    # The FIRST `version = "..."` under [project]. Read with a regex rather than a
    # TOML parser so this test has no dependency the app does not already have.
    match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    assert match, "pyproject.toml has no [project] version"
    return match.group(1)


def test_the_packaging_metadata_agrees_with_the_code():
    # THE drift guard. Two copies, one test.
    assert _pyproject_version() == __version__, (
        f"pyproject.toml says {_pyproject_version()} and app/version.py says "
        f"{__version__}. scripts/release.ps1 bumps both; one of them was edited "
        f"by hand."
    )


def test_health_reports_the_real_version():
    # What anything asking the backend what it is actually gets. This returned
    # "0.1.0" while the writer was running v1.1.0.
    body = client.get("/health").json()
    assert body["version"] == __version__
    assert body["status"] == "ok"


def test_the_api_docs_report_it_too():
    # The other place the string was hardcoded, and the one a developer reads.
    assert app.version == __version__


def test_it_is_no_longer_pre_one_point_oh():
    # A specific guard against the exact stale value, because "0.1.0" is what a
    # fresh `uv init` writes and it is easy to reintroduce by regenerating the
    # file. Not a general version-format assertion: the repo's rule is three
    # tiers rather than semver, so what a version MEANS is the writer's business.
    assert __version__ != "0.1.0"
    assert re.fullmatch(r"\d+\.\d+\.\d+", __version__), (
        f"{__version__} is not the X.Y.Z shape release.ps1 validates"
    )


# ── The script that does the bumping, checked without running it ─────────────
#
# R10.3 added the two backend bumps to scripts/release.ps1, and one of them was
# written as:
#
#     Join-Path $repoRoot "backend<BEL>pp<VT>ersion.py"
#
# because I edited the script through a Python string where `\a` and `\v` are
# escape sequences, so "backend\app\version.py" arrived on disk carrying two
# control characters. PowerShell reported "Illegal characters in path" and the
# release stopped half way through bumping, on the writer's machine, mid-cut.
#
# WHY NOTHING CAUGHT IT. This script runs exactly once per release. There is no
# CI here and no reason for anything else to open it, so a break in it stays
# invisible until the moment it matters most. I did write a check at the time --
# and it passed, because I typed the path into the CHECK by hand instead of
# reading it from the script. The test built the world instead of observing it,
# which this repo already has a note about, and I did it anyway.
#
# So these read the REAL file. They are cheap, they need no PowerShell, and they
# would have failed the moment the damage was introduced.

RELEASE_SCRIPT = BACKEND.parent / "scripts" / "release.ps1"


def _control_characters(path):
    """Byte offset -> value, for anything that is not text, tab or newline."""
    return {
        index: hex(byte) for index, byte in enumerate(path.read_bytes())
        if byte < 9 or 10 < byte < 13 or 13 < byte < 32
    }


def test_no_script_or_test_carries_a_stray_control_character():
    """
    The general form of the bug rather than the one path that broke it.

    Widened from release.ps1 alone after the SAME mistake happened a second time
    within the hour, in the very test written to catch the first one -- its error
    message spelled out the two escapes by name and so contained them. Any file
    edited through a language where backslash opens an escape can pick these up
    silently, and a Windows path is the likeliest carrier: a, b, f, v and t all
    mean something other than themselves after a backslash.

    The damage is invisible in an editor and invisible in a git diff. Only the
    bytes show it, so only a byte-level check finds it.

    This test names no escape sequence, for the obvious reason.
    """
    repo = BACKEND.parent
    watched = sorted(
        list((repo / "scripts").glob("*.ps1"))
        + list((repo / "backend" / "tests").glob("*.py"))
    )
    assert watched, "nothing found to check -- has the layout changed?"

    damaged = {
        str(path.relative_to(repo)): list(_control_characters(path))[:5]
        for path in watched
        if _control_characters(path)
    }
    assert not damaged, (
        "control characters found: " + repr(damaged) + ". Most likely a Windows "
        "path written through a language where backslash starts an escape."
    )



def test_every_file_the_release_script_edits_actually_exists():
    """
    The consequence, not the cause -- so a path that is merely WRONG is caught
    as well as one that is mangled.

    Only the paths pointing at files that exist in a clean checkout. Build
    outputs are deliberately excluded: the bundle directory and the artifacts
    folder are created by the release itself, so asserting on them would fail
    on every machine that has not built yet.
    """
    text = RELEASE_SCRIPT.read_text(encoding="utf-8")
    repo = BACKEND.parent

    built_at_release_time = ("target", "release-artifacts")
    referenced = re.findall(r'Join-Path \$repoRoot "([^"]+)"', text)
    assert referenced, "no repo-relative paths found -- has the script changed shape?"

    missing = []
    for relative in referenced:
        if any(part in relative for part in built_at_release_time):
            continue
        if not (repo / Path(relative.replace("\\", "/"))).exists():
            missing.append(relative)

    assert not missing, (
        f"scripts/release.ps1 points at files that do not exist: {missing}. "
        f"The script runs once per release with nothing else exercising it, so "
        f"a bad path here surfaces mid-cut or not at all."
    )


def test_the_script_bumps_both_backend_version_copies():
    # The two files test_the_packaging_metadata_agrees_with_the_code pins are
    # only kept in step by this script. If a future edit drops one, that test
    # starts failing at the NEXT release rather than here, and by then the
    # half-bumped tree is already on someone's machine.
    # NORMALISED TO FORWARD SLASHES BEFORE COMPARING, and that is not a style
    # choice. The first draft of this assertion was written with backslashes and
    # reintroduced the exact bug it exists to catch: the tooling that wrote the
    # file turned `\a` and `\v` into control characters again, so the test was
    # searching for `backend<BEL>pp<VT>ersion.py` and failing on a correct
    # script. A test about a backslash hazard must not itself contain one.
    text = RELEASE_SCRIPT.read_text(encoding="utf-8").replace(chr(92), "/")
    assert "backend/app/version.py" in text
    assert "backend/pyproject.toml" in text
