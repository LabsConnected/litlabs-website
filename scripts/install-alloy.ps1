#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install and configure Grafana Alloy for LiTTreeLabStudio observability.
.DESCRIPTION
  This script:
    1. Downloads and installs the Alloy agent (Windows amd64)
    2. Prompts securely for the Grafana Cloud API key (never hardcoded)
    3. Sets the GCLOUD_RW_API_KEY machine-level env var
    4. Copies config.alloy to the Alloy config directory
    5. Installs and starts the Alloy Windows service

  The Grafana Cloud username (3425326) and Prometheus push URL are
  baked into config.alloy — only the API key needs to be provided
  at install time via secure prompt.

  Stack: prometheus-prod-56-prod-us-east-2.grafana.net
  User:  3425326
.NOTES
  MUST be run as Administrator.
#>

param(
  # Path to the config.alloy file (defaults to scripts/config.alloy)
  [string]$ConfigPath = (Join-Path $PSScriptRoot "config.alloy"),

  # Alloy version to install
  [string]$AlloyVersion = "1.8.0"
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== Grafana Alloy Install ===" -ForegroundColor Cyan
Write-Host "Stack: prometheus-prod-56-prod-us-east-2.grafana.net" -ForegroundColor DarkGray
Write-Host "User:  3425326" -ForegroundColor DarkGray
Write-Host "Scope: metrics only (no Loki)" -ForegroundColor DarkGray

# ─── 1. Prompt for API key securely ────────────────────────────────
Write-Host "`n[1/4] Grafana Cloud API key" -ForegroundColor Yellow
Write-Host "Enter your Grafana Cloud access policy token (input hidden):"
$secureKey = Read-Host -AsSecureString "API Key"
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$apiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($apiKey)) {
  Write-Error "API key is required"
  exit 1
}

# ─── 2. Set machine-level env var ──────────────────────────────────
Write-Host "`n[2/4] Setting environment variable" -ForegroundColor Yellow
[Environment]::SetEnvironmentVariable("GCLOUD_RW_API_KEY", $apiKey, "Machine")
Write-Host "  Set: GCLOUD_RW_API_KEY (machine-level)"

# Clear plaintext key from memory
$apiKey = $null
[GC]::Collect()

# ─── 3. Download + install Alloy ───────────────────────────────────
Write-Host "`n[3/4] Installing Alloy v$AlloyVersion" -ForegroundColor Yellow
$alloyDir = "C:\Program Files\GrafanaLabs\Alloy"
$alloyExe = Join-Path $alloyDir "alloy.exe"

if (Test-Path $alloyExe) {
  Write-Host "  Alloy already installed at $alloyExe — skipping download"
} else {
  $downloadUrl = "https://github.com/grafana/alloy/releases/download/v$AlloyVersion/alloy-windows-amd64.exe.zip"
  $zipPath = "$env:TEMP\alloy-windows-amd64.zip"

  Write-Host "  Downloading from $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

  if (!(Test-Path $alloyDir)) {
    New-Item -ItemType Directory -Path $alloyDir -Force | Out-Null
  }

  Write-Host "  Extracting to $alloyDir"
  Expand-Archive -Path $zipPath -DestinationPath $alloyDir -Force
  Remove-Item $zipPath -Force

  # The zip may contain alloy-windows-amd64.exe — rename to alloy.exe
  $downloadedExe = Join-Path $alloyDir "alloy-windows-amd64.exe"
  if (Test-Path $downloadedExe) {
    Move-Item $downloadedExe $alloyExe -Force
  }

  if (!(Test-Path $alloyExe)) {
    Write-Error "Alloy binary not found after extraction. Check the zip contents."
    exit 1
  }
  Write-Host "  Alloy installed at $alloyExe"
}

# ─── 4. Copy config + install service ──────────────────────────────
Write-Host "`n[4/4] Installing config + service" -ForegroundColor Yellow
$configDir = "C:\ProgramData\GrafanaLabs\Alloy"
if (!(Test-Path $configDir)) {
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}
$configDest = Join-Path $configDir "config.alloy"

if (!(Test-Path $ConfigPath)) {
  Write-Error "Config file not found: $ConfigPath"
  exit 1
}

Copy-Item $ConfigPath $configDest -Force
Write-Host "  Config installed at $configDest"

# Check if service already exists
$existingService = Get-Service "Alloy" -ErrorAction SilentlyContinue
if ($existingService) {
  Write-Host "  Alloy service already exists — restarting with new config"
  Stop-Service "Alloy" -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "  Installing Alloy service..."
  & $alloyExe install `
    --config.file $configDest `
    --config.format "alloy" `
    2>&1 | Write-Host

  if ($LASTEXITCODE -ne 0) {
    Write-Error "Alloy service install failed (exit $LASTEXITCODE)"
    exit 1
  }
}

# Restart to pick up new config + env vars
Write-Host "  Starting Alloy service..."
Restart-Service "Alloy" -Force
Start-Sleep -Seconds 3

# ─── Verify ────────────────────────────────────────────────────────
Write-Host "`n=== Verification ===" -ForegroundColor Cyan
$svc = Get-Service "Alloy"
if ($svc.Status -eq "Running") {
  Write-Host "  Alloy service: RUNNING" -ForegroundColor Green
} else {
  Write-Host "  Alloy service: $($svc.Status)" -ForegroundColor Red
  Write-Host "  Check: Get-EventLog -LogName Application -Source Alloy -Newest 10"
  exit 1
}

$machineKey = [Environment]::GetEnvironmentVariable("GCLOUD_RW_API_KEY", "Machine")
if ($machineKey) {
  Write-Host "  GCLOUD_RW_API_KEY: set (machine-level)" -ForegroundColor Green
} else {
  Write-Host "  GCLOUD_RW_API_KEY: NOT SET" -ForegroundColor Red
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Metrics should appear in Grafana Cloud within 60 seconds."
Write-Host "Verify: https://grafana.com → your stack → Explore → Prometheus"
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Get-Service Alloy"
Write-Host "  & '$alloyExe' components"
Write-Host "  Get-EventLog -LogName Application -Source Alloy -Newest 10"
