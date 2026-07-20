# tests/conftest.py -- Shared pytest fixtures for the backend test suite
# ======================================================================
# A "fixture" in pytest is a reusable piece of test setup. Any fixture
# defined here is automatically available to every test file without an
# explicit import -- pytest injects them by name.
#
# The session-scoped TestClient is the main fixture here: it spins up the
# FastAPI app once per test session (not once per test) so the overhead is
# paid a single time. Tests that need to inspect the filesystem use pytest's
# built-in `tmp_path` fixture instead (fresh temp directory per test).

import pytest
from fastapi.testclient import TestClient

from app import recent_projects
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def isolated_recent_projects(tmp_path_factory) -> None:
    """
    Redirect the recent-projects file into a session temp directory.

    recent_projects.py stores its list at ~/.storythread/storythread.json --
    the USER'S real file. Tests that create or open projects through the API
    (POST /api/projects/create etc.) call track_project(), which would append
    every throwaway test project to the real dashboard list. That actually
    happened: a pytest run filled the Recent Projects screen with 130+ dead
    "Struct Novel" entries pointing at deleted pytest temp folders.

    autouse + session scope means NO test can touch the real file, including
    future tests nobody has written yet. (Same idea as test_settings_store's
    per-test isolated_settings fixture, but suite-wide because project
    creation happens all over the suite.)
    """
    sandbox = tmp_path_factory.mktemp("storythread-home")
    recent_projects.STORYTHREAD_DIR = sandbox
    recent_projects.RECENT_FILE = sandbox / "storythread.json"


@pytest.fixture(scope="session")
def client() -> TestClient:
    """
    A FastAPI TestClient for the full app, shared across the entire test session.

    TestClient wraps the ASGI app in a thread so sync test code can call it
    without starting a real server. All routes, middleware, and routers registered
    in main.py are active -- same as production, minus the real network.

    Scope is "session" (not "function") because creating the app has some startup
    cost (router registration, middleware setup) and we don't need isolation
    between test functions at that level.
    """
    return TestClient(app)
