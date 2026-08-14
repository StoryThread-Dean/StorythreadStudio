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
