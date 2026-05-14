# scripts/build-backend.ps1 -- Bundle the FastAPI backend into a single .exe
# ============================================================================
# Run from the repo root:
#   .\scripts\build-backend.ps1
#
# Prerequisites:
#   - Python toolchain set up via uv (uv sync --dev in backend/)
#   - The dev group in pyproject.toml installs PyInstaller for you
#
# What this does:
#   1. Runs PyInstaller against backend/backend.spec, producing a single
#      dist/storythread-backend.exe with the FastAPI server inside.
#   2. Copies that exe to app/src-tauri/binaries/ with the platform-suffixed
#      filename Tauri's externalBin sidecar mechanism expects.
#
# After this runs successfully, `npm run tauri build` from app/ will pick
# up the sidecar and embed it in the Windows installer.

$ErrorActionPreference = "Stop"

$repoRoot    = Resolve-Path "$PSScriptRoot\.."
$backendDir  = Join-Path $repoRoot "backend"
$tauriBinDir = Join-Path $repoRoot "app\src-tauri\binaries"

Write-Host ""
Write-Host "==> Building backend with PyInstaller..." -ForegroundColor Cyan
Write-Host "    backend/ -> dist/storythread-backend.exe"
Write-Host ""


# Pre-clean build/ and dist/ from PowerShell before PyInstaller starts.
# ============================================================================
# PyInstaller's own --clean step runs `shutil.rmtree` on backend/build/ at the
# start of every run. On Windows that fails intermittently with "Access is
# denied" on the build\backend\localpycs subfolder because Windows Defender
# (or another scanner) holds a handle open right when PyInstaller tries to
# rmdir it. The lock comes from a real-time scan of a .pyc that PyInstaller
# wrote during the previous run.
#
# This pre-clean retries with a short backoff so the scanner has time to let
# go before we give up. If all retries fail we surface a clear actionable
# error rather than dumping the long Python traceback.
function Remove-WithRetry($path, $maxAttempts = 8) {
    if (-not (Test-Path $path)) { return $true }
    for ($i = 1; $i -le $maxAttempts; $i++) {
        try {
            Remove-Item -Recurse -Force $path -ErrorAction Stop
            return $true
        } catch {
            if ($i -eq $maxAttempts) { return $false }
            Start-Sleep -Milliseconds (250 * $i)  # 0.25s, 0.5s, 0.75s, ...
        }
    }
    return $false
}

$buildDir = Join-Path $backendDir "build"
$distDir  = Join-Path $backendDir "dist"

if (-not (Remove-WithRetry $buildDir)) {
    Write-Error "Could not remove $buildDir after multiple attempts. Likely Windows Defender (or another antivirus) is holding a file handle. Pause Real-time protection briefly and rerun, or add $backendDir to the antivirus exclusion list."
    exit 1
}
if (-not (Remove-WithRetry $distDir)) {
    Write-Error "Could not remove $distDir after multiple attempts. Same antivirus root cause as above."
    exit 1
}


Push-Location $backendDir
try {
    # --clean wipes PyInstaller's caches so stale hidden-imports don't carry
    # over from a previous build. --noconfirm bypasses the "overwrite?" prompt
    # so the script doesn't hang in CI.
    #
    # Note: we already pre-cleaned build/ and dist/ above, but --clean ALSO
    # wipes PyInstaller's user-cache directory under AppData/Local/pyinstaller,
    # which catches hidden-import state we don't see here. Leaving it in.
    uv run pyinstaller backend.spec --clean --noconfirm
    if ($LASTEXITCODE -ne 0) {
        Write-Error "PyInstaller exited with code $LASTEXITCODE"
        exit 1
    }
}
finally {
    Pop-Location
}

# Tauri's sidecar mechanism uses platform-specific filenames so the same
# config can target Windows / macOS / Linux. We only build Windows x64
# right now, so the suffix is hardcoded. If you ever cross-compile, you'd
# add macOS-arm64 and linux-x86_64 variants here.
$tripleName = "storythread-backend-x86_64-pc-windows-msvc.exe"
$source     = Join-Path $backendDir "dist\storythread-backend.exe"
$dest       = Join-Path $tauriBinDir $tripleName

if (-not (Test-Path $source)) {
    Write-Error "Expected output not found: $source"
    exit 1
}

if (-not (Test-Path $tauriBinDir)) {
    New-Item -ItemType Directory -Path $tauriBinDir | Out-Null
}

Copy-Item -Path $source -Destination $dest -Force

# Report the final size so you can spot it if the bundle suddenly balloons.
$sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)

Write-Host ""
Write-Host "==> Backend bundled successfully" -ForegroundColor Green
Write-Host "    $dest"
Write-Host "    Size: $sizeMB MB"
Write-Host ""
Write-Host "Next step: cd app && npm run tauri build" -ForegroundColor Yellow
Write-Host ""
