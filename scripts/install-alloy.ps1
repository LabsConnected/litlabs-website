#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install and configure Grafana Alloy for LiTTreeLabStudio observability.
.DESCRIPTION
  This script:
    1. Prompts securely for the Grafana Cloud API key (never hardcoded)
    2. Sets the GCLOUD_RW_API_KEY machine-level env var
    3. Copies config.alloy to the Alloy config directory
    4. Downloads the Alloy installer and runs it silently with our config
    5. Starts the Alloy Windows service

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

# ─── 3. Copy config to Alloy config dir ────────────────────────────
Write-Host "`n[3/4] Installing config" -ForegroundColor Yellow
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

# ─── 4. Download + run Alloy installer ─────────────────────────────
Write-Host "`n[4/4] Installing Alloy v$AlloyVersion" -ForegroundColor Yellow
$alloyDir = "C:\Program Files\GrafanaLabs\Alloy"
$alloyExe = Join-Path $alloyDir "alloy-windows-amd64.exe"

# Check if Alloy is already installed
$existingService = Get-Service "Alloy" -ErrorAction SilentlyContinue
if ($existingService) {
  Write-Host "  Alloy service already exists — stopping for reconfiguration"
  Stop-Service "Alloy" -Force -ErrorAction SilentlyContinue
}

if (Test-Path $alloyExe) {
  Write-Host "  Alloy already installed at $alloyExe — skipping download"
} else {
  # Download the INSTALLER (not the plain binary) — it handles service registration
  $installerUrl = "https://github.com/grafana/alloy/releases/download/v$AlloyVersion/alloy-installer-windows-amd64.exe"
  $installerPath = "$env:TEMP\alloy-installer-windows-amd64.exe"

  Write-Host "  Downloading installer from $installerUrl"
  Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

  # Run silent install with our config file
  # /S = silent, /CONFIG= path to config.alloy
  Write-Host "  Running silent install with config: $configDest"
  $installArgs = "/S /CONFIG=`"$configDest`""
  Start-Process -FilePath $installerPath -ArgumentList $installArgs -Wait -NoNewWindow

  Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

  if (!(Test-Path $alloyExe)) {
    Write-Error "Alloy binary not found after install. Check the installer output."
    exit 1
  }
  Write-Host "  Alloy installed at $alloyExe"
}

# ─── Start/restart service ─────────────────────────────────────────
Write-Host "`n  Starting Alloy service..." -ForegroundColor Yellow

# If service exists, restart it. If not, the installer should have created it.
$svc = Get-Service "Alloy" -ErrorAction SilentlyContinue
if ($svc) {
  Restart-Service "Alloy" -Force
} else {
  # Fallback: if the installer didn't create the service, create it manually
  # using sc.exe with the service wrapper
  $serviceExe = Join-Path $alloyDir "alloy-service-windows-amd64.exe"
  if (Test-Path $serviceExe) {
    Write-Host "  Service not found — creating manually with sc.exe"
    & sc.exe create "Alloy" binPath= "`"$serviceExe`"" start= "auto"
    & sc.exe description "Alloy" "Grafana Alloy observability agent"
    Start-Service "Alloy"
  } else {
    Write-Error "Alloy service not found and service wrapper binary missing. Installation may have failed."
    exit 1
  }
}

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
