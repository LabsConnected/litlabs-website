#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install and configure Grafana Alloy for LiTTreeLabStudio observability.
.DESCRIPTION
  This script:
    1. Downloads and installs the Alloy agent (Windows amd64)
    2. Prompts securely for the Grafana Cloud API key (never hardcoded)
    3. Sets machine-level env vars for the Alloy service to read
    4. Copies the config.alloy file to the Alloy config directory
    5. Installs and starts the Alloy Windows service
.NOTES
  MUST be run as Administrator.
  The API key is read via Read-Host -AsSecureString and stored as a
  machine-level environment variable — it never appears in the script
  or in the config file on disk.
#>

param(
  # Grafana Cloud stack user ID (numeric, e.g. 1867290)
  [Parameter(Mandatory = $true)]
  [string]$GrafanaUser,

  # Prometheus remote_write URL
  [Parameter(Mandatory = $true)]
  [string]$MetricsUrl,

  # Loki push URL
  [Parameter(Mandatory = $true)]
  [string]$LogsUrl,

  # Path to the config.alloy file (defaults to scripts/config.alloy)
  [string]$ConfigPath = (Join-Path $PSScriptRoot "config.alloy"),

  # Alloy version to install
  [string]$AlloyVersion = "1.8.0"
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== Grafana Alloy Install ===" -ForegroundColor Cyan

# ─── 1. Prompt for API key securely ────────────────────────────────
Write-Host "`n[1/5] Grafana Cloud API key" -ForegroundColor Yellow
Write-Host "Enter your Grafana Cloud access policy token (input hidden):"
$secureKey = Read-Host -AsSecureString "API Key"
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$apiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($apiKey)) {
  Write-Error "API key is required"
  exit 1
}

# ─── 2. Set machine-level env vars ─────────────────────────────────
Write-Host "`n[2/5] Setting environment variables" -ForegroundColor Yellow
[Environment]::SetEnvironmentVariable("GCLOUD_RW_API_KEY", $apiKey, "Machine")
[Environment]::SetEnvironmentVariable("GCLOUD_USER", $GrafanaUser, "Machine")
[Environment]::SetEnvironmentVariable("GCLOUD_METRICS_URL", $MetricsUrl, "Machine")
[Environment]::SetEnvironmentVariable("GCLOUD_LOGS_URL", $LogsUrl, "Machine")
Write-Host "  Set: GCLOUD_RW_API_KEY, GCLOUD_USER, GCLOUD_METRICS_URL, GCLOUD_LOGS_URL"

# Clear the plaintext key from memory ASAP
$apiKey = $null
[GC]::Collect()

# ─── 3. Download Alloy ─────────────────────────────────────────────
Write-Host "`n[3/5] Downloading Alloy v$AlloyVersion" -ForegroundColor Yellow
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

# ─── 4. Copy config ────────────────────────────────────────────────
Write-Host "`n[4/5] Installing config" -ForegroundColor Yellow
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

# ─── 5. Install and start service ──────────────────────────────────
Write-Host "`n[5/5] Installing Alloy service" -ForegroundColor Yellow

# Check if service already exists
$existingService = Get-Service "Alloy" -ErrorAction SilentlyContinue
if ($existingService) {
  Write-Host "  Alloy service already exists — stopping for reconfiguration"
  Stop-Service "Alloy" -Force -ErrorAction SilentlyContinue
} else {
  # Install the service using Alloy's built-in install command
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
  Write-Host "  Check event log: Get-EventLog -LogName Application -Source Alloy -Newest 10"
  exit 1
}

# Check env vars are visible to the service
$machineKey = [Environment]::GetEnvironmentVariable("GCLOUD_RW_API_KEY", "Machine")
if ($machineKey) {
  Write-Host "  GCLOUD_RW_API_KEY: set (machine-level)" -ForegroundColor Green
} else {
  Write-Host "  GCLOUD_RW_API_KEY: NOT SET" -ForegroundColor Red
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Metrics and logs should appear in Grafana Cloud within 60 seconds."
Write-Host "Verify at: https://grafana.com → your stack → Explore"
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Get-Service Alloy              # check service status"
Write-Host "  & '$alloyExe' components        # list running components"
Write-Host "  Get-EventLog -LogName Application -Source Alloy -Newest 10  # check errors"
