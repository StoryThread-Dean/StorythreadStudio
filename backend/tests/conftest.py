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

from app.main import app


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
