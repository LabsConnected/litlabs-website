#Requires -Version 7.0
<#
.SYNOPSIS
    Install or update the LiTT shell adapter.

.DESCRIPTION
    Copies the canonical LiTT PowerShell adapter from the repo to:
        $HOME\LiTT\LiTT-Code.ps1

    Also ensures the PowerShell profile defines the `litt` function.

    This makes the Phase 1 wiring reproducible:
        repo source → install → $HOME\LiTT\LiTT-Code.ps1 → litt-cli → @litt/agent-core

    No hardcoded user paths. The adapter resolves the CLI at runtime.

.PARAMETER Force
    Overwrite the existing LiTT-Code.ps1 if it exists.

.EXAMPLE
    pwsh -File packages/litt-cli/scripts/install-litt-cli.ps1

.EXAMPLE
    pwsh -File packages/litt-cli/scripts/install-litt-cli.ps1 -Force
#>

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ── Paths ──────────────────────────────────────────────────────────
# $PSScriptRoot = packages/litt-cli/scripts
# Go up 3 levels to get repo root: scripts → litt-cli → packages → repo
$repoRoot = Split-Path $PSScriptRoot -Parent        # packages/litt-cli
$repoRoot = Split-Path $repoRoot -Parent             # packages
$repoRoot = Split-Path $repoRoot -Parent             # repo root
$adapterSource = Join-Path $repoRoot "packages\litt-cli\scripts\litt-adapter.ps1"
$littDir = Join-Path $HOME "LiTT"
$targetFile = Join-Path $littDir "LiTT-Code.ps1"
$profilePath = $PROFILE.CurrentUserCurrentHost

# ── Validate source ────────────────────────────────────────────────
if (-not (Test-Path $adapterSource)) {
    Write-Host "ERROR: Adapter source not found: $adapterSource" -ForegroundColor Red
    exit 1
}

# ── Install adapter ────────────────────────────────────────────────
if ((Test-Path $targetFile) -and -not $Force) {
    Write-Host "LiTT-Code.ps1 already exists at: $targetFile" -ForegroundColor Yellow
    Write-Host "Use -Force to overwrite." -ForegroundColor Yellow
    Write-Host "The existing file will be used as-is." -ForegroundColor Gray
} else {
    if (-not (Test-Path $littDir)) {
        New-Item -ItemType Directory -Path $littDir -Force | Out-Null
    }

    Copy-Item $adapterSource $targetFile -Force
    Write-Host "Installed LiTT adapter to: $targetFile" -ForegroundColor Green

    # Write CLI path config so the adapter can find the CLI from any directory
    $cliPathConfig = Join-Path $littDir "litt-cli-path.txt"
    $cliDist = Join-Path $repoRoot "packages\litt-cli\dist\index.js"
    Set-Content $cliPathConfig $cliDist -Encoding utf8
    Write-Host "Wrote CLI path config to: $cliPathConfig" -ForegroundColor Green
}

# ── Ensure profile has the litt function ───────────────────────────
$littFunction = 'function global:litt { & "$HOME\LiTT\LiTT-Code.ps1" @args }'

if (Test-Path $profilePath) {
    $profileContent = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
    if ($profileContent -and $profileContent -match 'function global:litt') {
        Write-Host "Profile already defines the 'litt' function." -ForegroundColor Green
    } else {
        Add-Content $profilePath "`n$littFunction"
        Write-Host "Added 'litt' function to profile: $profilePath" -ForegroundColor Green
    }
} else {
    # Create profile directory if needed
    $profileDir = Split-Path $profilePath -Parent
    if (-not (Test-Path $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }
    Set-Content $profilePath $littFunction -Encoding utf8
    Write-Host "Created profile with 'litt' function: $profilePath" -ForegroundColor Green
}

# ── Build the CLI if needed ────────────────────────────────────────
$cliDist = Join-Path $repoRoot "packages\litt-cli\dist\index.js"
if (-not (Test-Path $cliDist)) {
    Write-Host ""
    Write-Host "Building @litlabs/litt-cli..." -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        & pnpm --filter @litlabs/litt-cli build 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host "WARNING: Build failed. Run manually: pnpm --filter @litlabs/litt-cli build" -ForegroundColor Yellow
        } else {
            Write-Host "Build complete." -ForegroundColor Green
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "LiTT CLI already built." -ForegroundColor Green
}

# ── Summary ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "LiTT CLI installation complete." -ForegroundColor Green
Write-Host ""
Write-Host "  Adapter:  $targetFile" -ForegroundColor Gray
Write-Host "  Profile:  $profilePath" -ForegroundColor Gray
Write-Host "  CLI:      $cliDist" -ForegroundColor Gray
Write-Host ""
Write-Host "Restart your PowerShell session (or dot-source your profile) then:" -ForegroundColor Cyan
Write-Host "  litt status" -ForegroundColor White
Write-Host "  litt diff" -ForegroundColor White
