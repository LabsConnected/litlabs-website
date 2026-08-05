#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install and configure Grafana Alloy for LiTTreeLabStudio observability.
.DESCRIPTION
  This script:
    1. Prompts securely for the Grafana Cloud API key (never hardcoded)
    2. Sets the GCLOUD_RW_API_KEY machine-level env var
    3. Copies config.alloy to the Alloy config directory
    4. Installs Alloy via winget (preferred) or direct download
    5. Starts the Alloy Windows service

  Stack: prometheus-prod-56-prod-us-east-2.grafana.net
  User:  3425326
.NOTES
  MUST be run as Administrator.
#>

param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot "config.alloy"),
  [string]$AlloyVersion = "1.18.0"
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
$apiKey = $null
[GC]::Collect()

# ─── 3. Copy config ────────────────────────────────────────────────
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

# ─── 4. Install Alloy ──────────────────────────────────────────────
Write-Host "`n[4/4] Installing Alloy" -ForegroundColor Yellow
$alloyDir = "C:\Program Files\GrafanaLabs\Alloy"
$alloyExe = Join-Path $alloyDir "alloy-windows-amd64.exe"

# Clean up any broken partial install from previous attempts
if ((Test-Path $alloyExe) -and !(Get-Service "Alloy" -ErrorAction SilentlyContinue)) {
  Write-Host "  Cleaning up previous partial install..."
  Remove-Item $alloyDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Check if service already exists
$existingService = Get-Service "Alloy" -ErrorAction SilentlyContinue
if ($existingService) {
  Write-Host "  Alloy service already exists — stopping for reconfiguration"
  Stop-Service "Alloy" -Force -ErrorAction SilentlyContinue
}

# Method 1: Try winget (cleanest)
$installed = $false
if (Get-Command winget -ErrorAction SilentlyContinue) {
  Write-Host "  Trying winget install..."
  try {
    winget install GrafanaLabs.Alloy --accept-package-agreements --accept-source-agreements 2>&1 | Write-Host
    if (Test-Path $alloyExe) {
      Write-Host "  Alloy installed via winget"
      $installed = $true
    }
  } catch {
    Write-Host "  winget install failed, falling back to direct download" -ForegroundColor DarkYellow
  }
}

# Method 2: Direct download of installer binary
if (!$installed) {
  Write-Host "  Downloading Alloy installer v$AlloyVersion..."
  $installerUrl = "https://github.com/grafana/alloy/releases/download/v$AlloyVersion/alloy-installer-windows-amd64.exe"
  $installerPath = "$env:TEMP\alloy-installer.exe"

  try {
    # Use -MaximumRedirection to follow GitHub release redirects
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing -MaximumRedirection 10

    # Verify we got a real executable, not an HTML 404 page
    $fileInfo = Get-Item $installerPath
    if ($fileInfo.Length -lt 1MB) {
      $content = Get-Content $installerPath -Raw -ErrorAction SilentlyContinue
      if ($content -match "<html" -or $content -match "Page not found") {
        Remove-Item $installerPath -Force
        Write-Error "Downloaded file is not a valid executable (got HTML 404 page). Check the version URL: $installerUrl"
        exit 1
      }
    }

    Write-Host "  Running silent install..."
    # /S = silent, /CONFIG= path to config.alloy
    Start-Process -FilePath $installerPath -ArgumentList "/S", "/CONFIG=`"$configDest`"" -Wait -NoNewWindow
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

    if (Test-Path $alloyExe) {
      Write-Host "  Alloy installed at $alloyExe"
      $installed = $true
    } else {
      Write-Error "Alloy binary not found after install. Installer may have failed."
      exit 1
    }
  } catch {
    Write-Error "Failed to download installer: $_"
    exit 1
  }
}

# ─── Start/restart service ─────────────────────────────────────────
Write-Host "`n  Starting Alloy service..." -ForegroundColor Yellow
$svc = Get-Service "Alloy" -ErrorAction SilentlyContinue
if ($svc) {
  Restart-Service "Alloy" -Force
} else {
  # Fallback: create service manually with sc.exe using the service wrapper
  $serviceExe = Join-Path $alloyDir "alloy-service-windows-amd64.exe"
  if (Test-Path $serviceExe) {
    Write-Host "  Service not found — creating with sc.exe..."
    & sc.exe create "Alloy" binPath= "`"$serviceExe`"" start= "auto"
    & sc.exe description "Alloy" "Grafana Alloy observability agent"
    Start-Service "Alloy"
  } else {
    Write-Error "Alloy service not created by installer and service wrapper binary missing."
    Write-Host "  Try manual install: winget install GrafanaLabs.Alloy" -ForegroundColor Yellow
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
