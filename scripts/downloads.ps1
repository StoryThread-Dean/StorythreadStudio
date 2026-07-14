# downloads.ps1 -- Report GitHub release download counts
# ========================================================
# GitHub tracks how many times each release asset (the .msi installers) has
# been downloaded, but it dropped that number from the Releases web UI, so the
# only way to see it is the API. This script prints a per-release breakdown and
# a grand total of installer (.msi) downloads.
#
# How to read the numbers:
#   - These are TOTAL downloads, not unique users. Re-downloads, your own test
#     pulls, CI, and bots all count.
#   - Auto-updates count too: when an installed copy updates, the updater pulls
#     the newer release's .msi, which increments THAT release's count. So the
#     newest release climbs as existing users update, not just from fresh installs.
#   - We deliberately count only .msi. The latest.json asset has an inflated
#     count because the updater fetches it on every launch to check for updates.
#
# Requires the GitHub CLI (`gh`) to be installed and authenticated.
#
# Usage (from anywhere):
#   .\scripts\downloads.ps1
#
# Note: this parses the API JSON in PowerShell rather than using `gh --jq`,
# because PowerShell mangles jq filters that contain double quotes when it hands
# them to the native gh executable.

$ErrorActionPreference = "Stop"
$repo = "StoryThread-Dean/StorythreadStudio"

# Pull all releases (one page = up to 30; this project has far fewer) and parse
# the JSON with PowerShell's own converter -- no jq, no quoting headaches.
$releases = gh api "repos/$repo/releases" | ConvertFrom-Json

Write-Host ""
Write-Host "Installer (.msi) downloads for $repo" -ForegroundColor Cyan
Write-Host "-------------------------------------------------------------" -ForegroundColor DarkGray

$total = 0
foreach ($r in $releases) {
    $sum = 0
    foreach ($asset in $r.assets) {
        if ($asset.name -like "*.msi") { $sum += [int]$asset.download_count }
    }
    Write-Host ("  {0,-16} {1}" -f $r.tag_name, $sum)
    $total += $sum
}

Write-Host "-------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ("  {0,-16} {1}" -f "TOTAL", $total) -ForegroundColor Green
Write-Host ""
Write-Host "Note: total downloads, not unique users; includes auto-updates." -ForegroundColor DarkGray
Write-Host ""
