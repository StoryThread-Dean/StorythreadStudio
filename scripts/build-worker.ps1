# scripts/build-worker.ps1 -- build the kokoro-worker release artifact.
# ======================================================================
# Freezes the local narrator (PyInstaller onedir), packages it WITH the
# model files into one zip, and writes the SHA256 the app verifies at
# install time. The worker is versioned INDEPENDENTLY of app releases --
# it only rebuilds when the worker itself changes.
#
#   .\scripts\build-worker.ps1
#
# Output (in release-artifacts/):
#   kokoro-worker-<version>-win64.zip
#   kokoro-worker-<version>-win64.zip.sha256
#
# Publish as assets on a PRERELEASE tagged kokoro-worker-v<version>.
# PRERELEASE MATTERS: a normal release would become releases/latest and
# break the auto-updater's latest.json lookup for every installed app.
# After publishing, update WORKER_RELEASE in backend/app/audiobook/
# local_worker.py with the version, URL, and SHA256.

$ErrorActionPreference = "Stop"
$repoRoot  = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $repoRoot "kokoro-worker"
$artifacts = Join-Path $repoRoot "release-artifacts"

# Version comes from the worker's own source -- single source of truth.
$mainPy  = Get-Content (Join-Path $workerDir "main.py") -Raw
if ($mainPy -notmatch 'WORKER_VERSION = "kokoro-worker ([\d\.]+)"') {
    throw "Could not read WORKER_VERSION from kokoro-worker/main.py"
}
$version = $Matches[1]
Write-Host "==> Building kokoro-worker $version"

# Models must exist locally (they are gitignored; download once from the
# kokoro-onnx model-files release).
$models = Join-Path $workerDir "models"
foreach ($file in @("kokoro-v1.0.onnx", "voices-v1.0.bin")) {
    if (-not (Test-Path (Join-Path $models $file))) {
        throw "Missing $file in kokoro-worker/models -- download the model files first."
    }
}

# Freeze.
Push-Location $workerDir
try {
    uv run pyinstaller kokoro-worker.spec --noconfirm
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed." }
} finally {
    Pop-Location
}

# Stage: exe + _internal + models side by side, exactly the layout the
# install dir expects (~/.storythread/kokoro-worker/).
$stage = Join-Path $env:TEMP "kokoro-worker-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
Copy-Item (Join-Path $workerDir "dist\kokoro-worker\*") $stage -Recurse
Copy-Item $models (Join-Path $stage "models") -Recurse

# Zip + hash.
New-Item -ItemType Directory -Force $artifacts | Out-Null
$zipName = "kokoro-worker-$version-win64.zip"
$zipPath = Join-Path $artifacts $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Write-Host "==> Compressing (this takes a few minutes -- the models are ~340MB)"
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
Set-Content -Path "$zipPath.sha256" -Value $hash -Encoding ascii
$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)

Write-Host ""
Write-Host "==> Done: $zipName ($sizeMb MB)"
Write-Host "    SHA256: $hash"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. gh release create kokoro-worker-v$version --prerelease --title `"Kokoro Worker $version`" `"$zipPath`" `"$zipPath.sha256`""
Write-Host "  2. Update WORKER_RELEASE in backend/app/audiobook/local_worker.py (version, sha256, size_mb)."
