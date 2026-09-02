# app/version.py -- what the backend says it is, in one place
# ============================================================
# R10.3. This existed as the string "0.1.0" typed into three separate files, and
# it had said 0.1.0 since the project began -- through eleven releases. The app
# reported it at `GET /health` and in the API docs at /docs, so the backend was
# telling anything that asked that it was pre-1.0 while the writer was running
# v1.1.0.
#
# Nothing broke, because nothing compares it to anything yet. That is exactly why
# it drifted: a version is a number, and there is no such thing as an obviously
# wrong one. The moment something DOES compare it -- a mismatch check between the
# Tauri shell and the sidecar it launched, say -- the wrong answer would be
# confidently wrong.
#
# WHY NOT READ IT FROM pyproject.toml. Two reasons. The release build is a
# PyInstaller one-file bundle, where `importlib.metadata` cannot be relied on to
# find package metadata that was never installed as a package. And reading and
# parsing a TOML file at import time to learn a constant is a runtime dependency
# on a build artefact being present, which the bundle does not guarantee either.
#
# So: this file is the definition, `pyproject.toml` carries a copy for packaging,
# `scripts/release.ps1` bumps both, and `tests/test_version.py` fails the build if
# they disagree. Two copies bound by a test, which is the pattern this repo
# already uses where one copy is genuinely not possible.

__version__ = "2.0.4"
