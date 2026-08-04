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
import sys
from datetime import datetime, timezone

LOCK_NAME = ".storythread-audiobook.lock"


class WorkspaceLockedError(Exception):
    """Another live process holds this workspace's lock."""


def _lock_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, LOCK_NAME)


def _windows_process_image(pid: int) -> tuple[bool, str | None]:
    """
    (alive, image basename) for a PID -- READ-ONLY. Never use
    os.kill(pid, 0) on Windows: CPython maps it to TerminateProcess, so
    "probing" a reused PID would MURDER an innocent process (live
    finding: a reboot-stale lock could not be broken, and the naive fix
    would have been worse than the bug).

    alive=True with image=None means the PID exists but belongs to a
    process we cannot even query -- our own backend always runs as the
    user, so an unqueryable holder is a REUSED pid, not ours.
    """
    import ctypes

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    ERROR_ACCESS_DENIED = 5
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return (ctypes.get_last_error() == ERROR_ACCESS_DENIED, None)
    try:
        code = ctypes.c_ulong()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return (True, None)
        if code.value != STILL_ACTIVE:
            return (False, None)
        buffer = ctypes.create_unicode_buffer(1024)
        size = ctypes.c_ulong(len(buffer))
        if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return (True, os.path.basename(buffer.value))
        return (True, None)
    finally:
        kernel32.CloseHandle(handle)


def _holder_alive(pid: int, expected_image: str | None) -> bool:
    """Is the LOCK HOLDER still running? A live PID with a different
    executable image is a reused PID after a reboot, not the holder."""
    if os.name == "nt":
        alive, image = _windows_process_image(pid)
        if not alive:
            return False
        if image is None:
            # Exists but unqueryable: a system process wearing a reused
            # PID. Our holder is always user-queryable.
            return False
        if expected_image and image.lower() != expected_image.lower():
            return False
        return True
    # POSIX: signal 0 is a true no-op probe.
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


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
    if not isinstance(pid, int):
        return True
    return not _holder_alive(pid, lock.get("image"))


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
            # The holder's executable name defeats PID reuse: a reboot
            # can hand 37372 to svchost, but svchost is not python.
            "image": os.path.basename(sys.executable),
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


def force_release(workspace_path: str) -> None:
    """The writer's explicit reclaim (the Cancel-and-start-over path):
    remove the lock regardless of owner. Only ever called from the reset
    endpoint, which first verifies no run is active in THIS process."""
    try:
        os.remove(_lock_path(workspace_path))
    except OSError:
        pass
