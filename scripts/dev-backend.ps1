# scripts/dev-backend.ps1 -- Start the FastAPI backend for development
# ============================================================================
# Run from ANYWHERE in the repo:
#   .\scripts\dev-backend.ps1
#
# What it does: starts uvicorn with auto-reload on http://localhost:8000, from
# the one directory it works in.
#
# WHY THIS SCRIPT EXISTS, which is worth knowing before you delete it as
# unnecessary. The repo has two things called `app`:
#
#   app/           the React frontend  (app/src, app/package.json)
#   backend/app/   the Python package  (backend/app/main.py)
#
# `uvicorn app.main:app` therefore means two different things depending on where
# you are standing. From `backend/` it is the API. From the repo root, Python
# resolves `app` to the FRONTEND folder as a namespace package, finds no
# `main.py` inside it, and uvicorn reports:
#
#   ERROR:    Error loading ASGI app. Could not import module "app.main".
#
# That message names the module and not the mistake, so it reads like a broken
# import in the backend rather than a wrong working directory -- and with
# --reload it repeats on every file save, which makes it look like a code
# problem getting worse. It is neither. This script removes the choice.

[CmdletBinding()]
param(
    # The port the frontend expects. Only change it if you are running two
    # copies at once, and remember API_BASE in the frontend is hardcoded to 8000.
    [int]$Port = 8000,

    # Start without --reload. Useful when you are debugging startup itself:
    # the reloader runs the app in a child process, which hides some errors
    # and makes breakpoints harder to land.
    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

# The backend directory, resolved from THIS script's location rather than from
# the caller's -- which is the whole point of the script.
$backend = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"

if (-not (Test-Path (Join-Path $backend "app/main.py"))) {
    throw "Could not find backend/app/main.py next to this script. Is the repo laid out as expected?"
}

if ($null -eq (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is not on PATH. Install it (https://docs.astral.sh/uv/) then run this again."
}

Push-Location $backend
try {
    # Fail EARLY and READABLY on a genuine import error. Without this, a real
    # broken import inside the app produces the same "Could not import module"
    # line as a wrong directory did, and the two are hard to tell apart. Here
    # the Python traceback prints in full, naming the actual file and line.
    Write-Host "Checking the app imports..." -ForegroundColor DarkGray
    uv run python -c "from app.main import app"
    if ($LASTEXITCODE -ne 0) {
        throw "The backend did not import. The traceback above names the real cause."
    }

    # NOT $args: that is an automatic variable in PowerShell, and
    # assigning to it works right up until it quietly does not.
    $uvArgs = @("run", "uvicorn", "app.main:app", "--port", $Port)
    if (-not $NoReload) { $uvArgs += "--reload" }

    Write-Host ""
    Write-Host "Backend on http://localhost:$Port" -ForegroundColor Green
    Write-Host "Docs on    http://localhost:$Port/docs" -ForegroundColor DarkGray
    Write-Host "Ctrl+C to stop." -ForegroundColor DarkGray
    Write-Host ""

    & uv @uvArgs
}
finally {
    # Runs on Ctrl+C too, so the shell is left where it was found.
    Pop-Location
}
