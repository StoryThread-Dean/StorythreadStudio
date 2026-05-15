"""
run_backend.py -- Frozen-binary entry point for the FastAPI backend.

When Storythread Studio is packaged for release, Tauri spawns a bundled
.exe of this file as a sidecar at app startup. The exe boots uvicorn on
localhost:8000 -- the same port the dev backend uses -- so the React
frontend's API calls work identically whether you're running 'uv run
uvicorn' in dev or the packaged Tauri app in production.

Why this file exists rather than calling 'uvicorn app.main:app' directly:
  PyInstaller freezes a single Python entry point. We can't pass a
  module-string-style argument to uvicorn from a CLI in a frozen build,
  so we import the FastAPI app object and hand it to uvicorn programmatically.

Why not import inside __main__: PyInstaller's import-graph analysis runs
the file top-to-bottom; module-level imports get caught reliably. Putting
'from app.main import app' inside __main__ has historically caused
'No module named app' errors in some PyInstaller setups.
"""
import os
import sys
import uvicorn
from app.main import app

# When running as a PyInstaller frozen exe, certifi.where() resolves
# correctly because PyInstaller copies cacert.pem into the bundle and
# patches the path. Setting these env vars explicitly ensures httpx and
# any other HTTP library in the process also find the bundled certs,
# even if they do their own SSL path resolution before importing certifi.
if getattr(sys, 'frozen', False):
    import certifi
    os.environ.setdefault('SSL_CERT_FILE', certifi.where())
    os.environ.setdefault('REQUESTS_CA_BUNDLE', certifi.where())


if __name__ == "__main__":
    # Bind to 127.0.0.1 only -- the backend is local-only by design and
    # should never accept connections from outside the user's machine.
    # Reload is OFF (it watches files, which makes no sense in a frozen
    # exe and would crash on missing __file__ paths). Access log is OFF
    # to keep the backend quiet; errors still log normally.
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
        access_log=False,
    )
