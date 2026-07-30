# audiobook/locking.py -- the workspace lockfile (spec 8.2).
# ===========================================================
# A workspace is a folder full of state that is expensive to regenerate;
# two processes mutating it concurrently could corrupt a run. The lockfile
# is cheap insurance: PID + hostname + timestamp, MANDATORY around
# generation runs, with a staleness check so a crashed app never bricks a
# workspace.

import json
import os
import socket
from datetime import datetime, timezone

LOCK_NAME = ".storythread-audiobook.lock"


class WorkspaceLockedError(Exception):
    """Another live process holds this workspace's lock."""


def _lock_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, LOCK_NAME)


def _pid_alive(pid: int) -> bool:
    """
    Best-effort liveness probe. On Windows, os.kill(pid, 0) maps to
    OpenProcess: no exception or PermissionError means the PID exists;
    OSError means it does not. Unknown errors err on 'alive' -- a false
    'stale' verdict is the dangerous direction.
    """
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False
    except Exception:
        return True


def read_lock(workspace_path: str) -> dict | None:
    try:
        with open(_lock_path(workspace_path), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def is_stale(lock: dict) -> bool:
    """A lock is stale when its holder is provably gone (same machine)."""
    if lock.get("hostname") != socket.gethostname():
        return False                 # cannot probe a foreign machine's PID
    pid = lock.get("pid")
    return not (isinstance(pid, int) and _pid_alive(pid))


def acquire(workspace_path: str) -> None:
    """
    Take the lock or raise WorkspaceLockedError with who holds it. Our own
    PID re-acquiring is fine (resume after pause in the same app session);
    a stale lock is broken automatically -- the crashed holder cannot
    object, and generation start is an explicit user action.
    """
    existing = read_lock(workspace_path)
    if existing and existing.get("pid") != os.getpid() and not is_stale(existing):
        raise WorkspaceLockedError(
            f"This audiobook workspace is in use by another Storythread instance "
            f"(process {existing.get('pid')} on {existing.get('hostname')}). "
            "Close it there first, or wait for its run to finish."
        )
    with open(_lock_path(workspace_path), "w", encoding="utf-8") as f:
        json.dump({
            "pid": os.getpid(),
            "hostname": socket.gethostname(),
            "acquired_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }, f)


def release(workspace_path: str) -> None:
    """Release only OUR lock -- never delete a lock some other process owns."""
    lock = read_lock(workspace_path)
    if lock and lock.get("pid") == os.getpid():
        try:
            os.remove(_lock_path(workspace_path))
        except OSError:
            pass
