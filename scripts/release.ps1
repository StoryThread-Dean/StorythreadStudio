# scripts/release.ps1 -- Cut a Storythread Studio release
# ============================================================================
# Run from the repo root:
#   .\scripts\release.ps1 -Version 1.1.0
#
# What this script does:
#   1. Validates the version string and confirms there are no uncommitted changes.
#   2. Bumps the version in three manifests:
#        - app/package.json
#        - app/src-tauri/tauri.conf.json
#        - app/src-tauri/Cargo.toml
#   3. Builds the backend exe (scripts/build-backend.ps1).
#   4. Builds the Tauri bundle (npm run tauri build).
#   5. Generates the latest.json manifest with the signed signature.
#   6. Prints a checklist of remaining MANUAL steps -- this script does NOT
#      push to GitHub or create a release on its own. The actual upload is
#      manual so you can review the .msi and the latest.json before they
#      go public.
#
# Prerequisites (one-time, see docs/RELEASING.md for setup details):
#   - $env:TAURI_SIGNING_PRIVATE_KEY      -- the private key string
#   - $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -- its password (if you set one)
#
# These come from `npm run tauri signer generate`. Store the private key in
# your password manager; export it into the shell only when running this
# script. Never commit it.

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern("^[0-9]+\.[0-9]+\.[0-9]+$")]
    [string]$Version,

    # Skip the dirty-tree check. Useful when you want to release uncommitted
    # local edits (e.g. a quick CHANGELOG fix between commits) but normally
    # leave this off.
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path "$PSScriptRoot\.."

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" -ForegroundColor Gray }
function OK($msg)   { Write-Host "    ok: $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }


# ── Pre-flight checks ────────────────────────────────────────────────────────

Step "Pre-flight checks"

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Error "TAURI_SIGNING_PRIVATE_KEY is not set in the environment. See docs/RELEASING.md for setup."
    exit 1
}
OK "Signing key is exported"

if (-not $AllowDirty) {
    $gitStatus = git -C $repoRoot status --porcelain
    if ($gitStatus) {
        Write-Error "Working tree has uncommitted changes. Commit or stash them, or rerun with -AllowDirty. Status:`n$gitStatus"
        exit 1
    }
    OK "Working tree is clean"
}

$gitTagExists = git -C $repoRoot tag --list "v$Version"
if ($gitTagExists) {
    Write-Error "Tag v$Version already exists. Pick a new version or delete the existing tag first."
    exit 1
}
OK "Tag v$Version is available"


# ── Bump versions ────────────────────────────────────────────────────────────

Step "Bumping versions to $Version"

# UTF-8 encoder WITHOUT a BOM. Windows PowerShell 5.1's `Set-Content -Encoding
# UTF8` writes a UTF-8 BOM, which Vite's enhanced-resolve cannot parse on
# package.json -- the production build fails with "Unexpected token '', '{...'"
# as soon as the manifest has the BOM bytes (EF BB BF) at the start. Using
# [System.IO.File]::WriteAllText with this encoding produces a BOM-less file
# that every downstream tool (npm, cargo, vite, tauri) parses cleanly.
$noBomUtf8 = New-Object System.Text.UTF8Encoding($false)

# package.json: read+modify+write the JSON in place. Avoids needing jq on
# Windows; keeps the existing key order intact.
$packageJsonPath = Join-Path $repoRoot "app\package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$packageJson.version = $Version
$packageJsonText = $packageJson | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($packageJsonPath, $packageJsonText, $noBomUtf8)
OK "app/package.json"

# tauri.conf.json: same pattern as above. Tauri's config also has a top-level
# 'version' field that the updater compares against.
$tauriConfPath = Join-Path $repoRoot "app\src-tauri\tauri.conf.json"
$tauriConf = Get-Content $tauriConfPath -Raw | ConvertFrom-Json
$tauriConf.version = $Version
$tauriConfText = $tauriConf | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($tauriConfPath, $tauriConfText, $noBomUtf8)
OK "app/src-tauri/tauri.conf.json"

# Cargo.toml: TOML doesn't have a built-in PowerShell parser, so we use a
# regex on the version line. Safe here because the version line is
# distinctive and we own the file format.
$cargoTomlPath = Join-Path $repoRoot "app\src-tauri\Cargo.toml"
$cargoToml = Get-Content $cargoTomlPath -Raw
$cargoToml = $cargoToml -replace '(?m)^version\s*=\s*".*"$', "version = `"$Version`""
[System.IO.File]::WriteAllText($cargoTomlPath, $cargoToml, $noBomUtf8)
OK "app/src-tauri/Cargo.toml"


# ── Build the backend sidecar ────────────────────────────────────────────────

Step "Building backend (PyInstaller)"
& (Join-Path $PSScriptRoot "build-backend.ps1")
if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend build failed."
    exit 1
}


# ── Build the Tauri bundle ────────────────────────────────────────────────────

Step "Building Tauri bundle (npm run tauri build)"
Push-Location (Join-Path $repoRoot "app")
try {
    npm run tauri build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Tauri build failed."
        exit 1
    }
}
finally {
    Pop-Location
}


# ── Locate build outputs ─────────────────────────────────────────────────────

Step "Locating build outputs"

$bundleDir = Join-Path $repoRoot "app\src-tauri\target\release\bundle"
$msiDir    = Join-Path $bundleDir "msi"
$nsisDir   = Join-Path $bundleDir "nsis"

# Tauri produces .msi (Windows Installer) and/or .exe (NSIS) depending on
# config. Prefer the .msi when both exist; fall back to .exe.
#
# Filter by $Version so we never pick up a leftover bundle from a previous
# release. Tauri does NOT clean the bundle/ directory between builds, so
# without this filter `Select-Object -First 1` would pick the alphabetically
# earliest file (e.g. v1.0.0 wins over v1.0.1).
$installer = $null
if (Test-Path $msiDir) {
    $installer = Get-ChildItem $msiDir -Filter "*${Version}*.msi" | Select-Object -First 1
}
if (-not $installer -and (Test-Path $nsisDir)) {
    $installer = Get-ChildItem $nsisDir -Filter "*${Version}*-setup.exe" | Select-Object -First 1
}
if (-not $installer) {
    Write-Error "Could not find a built installer in $bundleDir. Check the Tauri build output."
    exit 1
}
OK "Installer: $($installer.FullName)"

# The signature file is generated next to the installer when signing is
# enabled. It's a small text file the updater verifies against the public
# key embedded in the app.
$sigPath = "$($installer.FullName).sig"
if (-not (Test-Path $sigPath)) {
    Write-Error "Signature file missing: $sigPath. Did Tauri sign the bundle? Check that TAURI_SIGNING_PRIVATE_KEY is set."
    exit 1
}
OK "Signature: $sigPath"


# ── Generate latest.json manifest ────────────────────────────────────────────

Step "Generating latest.json"

# Pull the [<Version>] section out of CHANGELOG.md and use it as release
# notes. Prefers the tagged section (e.g. [1.0.1]) since that's what's
# moved into place before cutting the release. Falls back to [Unreleased]
# for forward-compatibility, then to a generic message.
#
# Regex notes:
# - (?m)^## anchors the heading to the start of a line so we don't match
#   inline references to "## [Unreleased]" inside the file's preamble
#   paragraph. (We hit this bug in v1.0.1: the preamble text mentions
#   "## [Unreleased]" inside backticks, and the un-anchored regex
#   captured everything from that mention through the next real heading.)
$changelogPath = Join-Path $repoRoot "CHANGELOG.md"
$notesBody = "Bug fixes and improvements."
if (Test-Path $changelogPath) {
    $changelogText = Get-Content $changelogPath -Raw
    $versionPattern = '(?ms)^## \[' + [regex]::Escape($Version) + '\][^\n]*\n(.*?)(?=\n## \[|\z)'
    $versionMatch = [regex]::Match($changelogText, $versionPattern)
    if ($versionMatch.Success) {
        $extracted = $versionMatch.Groups[1].Value.Trim()
        $extracted = $extracted -replace '(?m)^###\s+\w+\s*\r?\n\s*(?=\r?\n)', ''
        if ($extracted) { $notesBody = $extracted.Trim() }
    } else {
        # Fall back to [Unreleased] only if no version section exists yet.
        $unreleasedMatch = [regex]::Match(
            $changelogText,
            '(?ms)^## \[Unreleased\][^\n]*\n(.*?)(?=\n## \[|\z)'
        )
        if ($unreleasedMatch.Success) {
            $extracted = $unreleasedMatch.Groups[1].Value.Trim()
            $extracted = $extracted -replace '(?m)^###\s+\w+\s*\r?\n\s*(?=\r?\n)', ''
            if ($extracted) { $notesBody = $extracted.Trim() }
        }
    }
}

$signature = Get-Content $sigPath -Raw

# GitHub Releases URL pattern: when you upload an asset, GitHub REPLACES
# spaces in the filename with dots in the download URL. The asset on disk
# may be "Storythread Studio_1.0.1_x64_en-US.msi" but the live URL serves
# it as "Storythread.Studio_1.0.1_x64_en-US.msi". URL-encoding the space
# as %20 also fails -- GitHub doesn't decode it back, and a 404 results.
# So we rewrite spaces to dots here for the manifest URL.
$repo = "dataguydpeterson-cmyk/StorythreadStudio"
$urlFilename = $installer.Name -replace ' ', '.'
$installerUrl = "https://github.com/$repo/releases/download/v$Version/$urlFilename"

$manifest = [ordered]@{
    version  = $Version
    notes    = $notesBody
    pub_date = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature.Trim()
            url       = $installerUrl
        }
    }
}

$manifestPath = Join-Path $repoRoot "release-artifacts\latest.json"
$artifactsDir = Split-Path $manifestPath
if (-not (Test-Path $artifactsDir)) {
    New-Item -ItemType Directory -Path $artifactsDir | Out-Null
}
# BOM-less UTF-8 write -- Set-Content -Encoding UTF8 in Windows PowerShell 5.1
# emits a BOM, which Tauri's JSON parser rejects on latest.json (the auto-
# updater silently fails to find an update because the manifest can't be
# parsed). [System.IO.File]::WriteAllText with UTF8Encoding($false) produces
# a clean BOM-less file.
$manifestText = $manifest | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($manifestPath, $manifestText, $noBomUtf8)

# Copy the installer + signature next to the manifest so all upload
# artifacts live in one folder.
Copy-Item $installer.FullName -Destination $artifactsDir
Copy-Item $sigPath -Destination $artifactsDir

OK "release-artifacts/latest.json"
OK "release-artifacts/$($installer.Name)"
OK "release-artifacts/$($installer.Name).sig"


# ── Done -- print the manual checklist ───────────────────────────────────────

Step "Manual upload checklist"
Write-Host ""
Write-Host "  All artifacts ready in: $artifactsDir" -ForegroundColor Green
Write-Host ""
Write-Host "  Remaining steps (manual):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Move the [Unreleased] CHANGELOG entries into a [v$Version] section,"
Write-Host "     fill in the date, and commit:"
Write-Host "       git add CHANGELOG.md app/package.json app/src-tauri/tauri.conf.json app/src-tauri/Cargo.toml"
Write-Host "       git commit -m `"Release v$Version`""
Write-Host ""
Write-Host "  2. Tag and push:"
Write-Host "       git tag v$Version"
Write-Host "       git push origin main --tags"
Write-Host ""
Write-Host "  3. Create the GitHub Release:"
Write-Host "       gh release create v$Version \``"
Write-Host "         --title `"Storythread Studio v$Version`" \``"
Write-Host "         --notes-file CHANGELOG.md \``"
Write-Host "         release-artifacts/$($installer.Name) \``"
Write-Host "         release-artifacts/$($installer.Name).sig \``"
Write-Host "         release-artifacts/latest.json"
Write-Host ""
Write-Host "  4. Verify the auto-update endpoint serves the new manifest:"
Write-Host "       curl -L https://github.com/$repo/releases/latest/download/latest.json"
Write-Host ""
