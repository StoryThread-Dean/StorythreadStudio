# utils/paths.py -- where the app is allowed to read and write
# =============================================================
# Every endpoint in this app takes a `folder_path` or `project_path` from the
# frontend. That is fine -- it is a local desktop app and the writer chose
# the folder -- but "the request said so" is not a reason to touch a path,
# and a filename that arrives from anywhere is never allowed to escape the
# folder it belongs to.
#
# Until now there was no shared answer to either question. The only guard in
# the codebase was profiles.py's _safe_path(), which contains a FILENAME
# inside a profile directory and says nothing about whether the project path
# itself is real. New routers were each free to invent their own rules, and
# a rule that exists in six places is a rule with six behaviours.
#
# So: one containment check, one project check, both here.

import os

from fastapi import HTTPException


def safe_child(parent: str, name: str, label: str = "filename") -> str:
    """
    Resolve `name` inside `parent` and refuse anything that escapes it.

    Blocks the obvious "../../etc/passwd" and the less obvious cases that
    string checks miss -- a symlink pointing out of the folder, or a Windows
    short name -- because the comparison happens after realpath() has
    resolved both sides.

    Moved from profiles.py::_safe_path, whose behaviour this preserves
    exactly.
    """
    full = os.path.realpath(os.path.join(parent, name))
    safe = os.path.realpath(parent)
    if not full.startswith(safe + os.sep) and full != safe:
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return full


def validate_project_path(project_path: str) -> str:
    """
    Confirm a path really is a Storythread project, and return it resolved.

    The project.json test is what makes this meaningful: an arbitrary
    directory is not a project, and endpoints that create folders inside one
    should not be pointed at a writer's Documents root by a typo or a stale
    path from a moved project.

    Raises 400 for a missing or malformed value and 404 for a path that is
    not a project -- different problems with different fixes, so different
    codes.
    """
    if not project_path or not isinstance(project_path, str) or not project_path.strip():
        raise HTTPException(status_code=400, detail="No project folder was given.")

    resolved = os.path.realpath(project_path.strip())
    if not os.path.isdir(resolved):
        raise HTTPException(
            status_code=404,
            detail=f"That folder does not exist: {project_path}",
        )
    if not os.path.isfile(os.path.join(resolved, "project.json")):
        raise HTTPException(
            status_code=404,
            detail="That folder is not a Storythread project (no project.json).",
        )
    return resolved
