#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Fix Alloy config path + env vars in registry after winget install.
.DESCRIPTION
  Repoints Alloy to our config at C:\ProgramData\GrafanaLabs\Alloy\config.alloy
  and injects env vars (API key + Loki URL) into the service.
.PARAMETER LokiUrl
  The Loki push URL from Grafana Cloud (e.g. https://logs-prod-XXX-us-east-2.grafana.net/loki/api/v1/push)
#>

param(
  [string]$LokiUrl = ""
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== Fixing Alloy Registry ===" -ForegroundColor Cyan

# ─── 0. Copy fixed config to ProgramData ───────────────────────────
$configSrc = Join-Path $PSScriptRoot "config.alloy"
$configDest = "C:\ProgramData\GrafanaLabs\Alloy\config.alloy"

Write-Host "[0/5] Copying fixed config..." -ForegroundColor Yellow
if (!(Test-Path "C:\ProgramData\GrafanaLabs\Alloy")) {
  New-Item -ItemType Directory -Path "C:\ProgramData\GrafanaLabs\Alloy" -Force | Out-Null
}
Copy-Item $configSrc $configDest -Force
Write-Host "  Config copied to $configDest"

# ─── 1. Update config path in registry ─────────────────────────────
$regPath = "HKLM:\SOFTWARE\GrafanaLabs\Alloy"
$newArgs = @("run", "C:\ProgramData\GrafanaLabs\Alloy\config.alloy", "--storage.path=C:\ProgramData\GrafanaLabs\Alloy\data")

Write-Host "[1/5] Updating config path..." -ForegroundColor Yellow
Set-ItemProperty $regPath -Name "Arguments" -Value $newArgs -Type MultiString
Write-Host "  Arguments set to: run C:\ProgramData\GrafanaLabs\Alloy\config.alloy"

# ─── 2. Inject API key into service environment ────────────────────
Write-Host "[2/5] Injecting API key into service env..." -ForegroundColor Yellow
$apiKey = [Environment]::GetEnvironmentVariable("GCLOUD_RW_API_KEY", "Machine")
if (!$apiKey) {
  Write-Error "GCLOUD_RW_API_KEY not set at machine level. Run install-alloy.ps1 first."
  exit 1
}

# Build env var array for the service
$envArray = @("GCLOUD_RW_API_KEY=$apiKey")

# ─── 3. Set Loki URL if provided ───────────────────────────────────
if ($LokiUrl) {
  Write-Host "[3/5] Setting Loki URL..." -ForegroundColor Yellow
  [Environment]::SetEnvironmentVariable("GCLOUD_LOKI_URL", $LokiUrl, "Machine")
  $envArray += "GCLOUD_LOKI_URL=$LokiUrl"
  Write-Host "  GCLOUD_LOKI_URL set to: $LokiUrl"
} else {
  Write-Host "[3/5] Skipping Loki URL (not provided)" -ForegroundColor DarkGray
  Write-Host "  To add Loki later: .\scripts\fix-alloy-config.ps1 -LokiUrl 'https://logs-prod-XXX.grafana.net/loki/api/v1/push'" -ForegroundColor DarkGray
}

Set-ItemProperty $regPath -Name "Environment" -Value $envArray -Type MultiString
Write-Host "  Environment set in registry"

# ─── 4. Restart service ────────────────────────────────────────────
Write-Host "[4/5] Restarting Alloy service..." -ForegroundColor Yellow
Stop-Service "Alloy" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Service "Alloy"
Start-Sleep -Seconds 5

# ─── 5. Verify ─────────────────────────────────────────────────────
Write-Host "[5/5] Verifying..." -ForegroundColor Yellow
$svc = Get-Service "Alloy"
Write-Host "  Service: $($svc.Status)" -ForegroundColor $(if ($svc.Status -eq "Running") {"Green"} else {"Red"})

if ($svc.Status -ne "Running") {
  Write-Host "`n  Service failed to start. Checking event log..." -ForegroundColor Red
  Get-EventLog -LogName Application -Source "Alloy" -Newest 3 -ErrorAction SilentlyContinue | Select-Object Message | Format-List
  exit 1
}

# Check metrics are flowing
try {
  $r = Invoke-WebRequest -Uri "http://localhost:12345/metrics" -UseBasicParsing -TimeoutSec 5
  $lines = $r.Content -split "`n"
  $winMetrics = ($lines | Select-String "windows_").Count
  $rwMetrics = ($lines | Select-String "prometheus_remote_write").Count
  $lokiMetrics = ($lines | Select-String "loki").Count
  Write-Host "  windows_ metrics: $winMetrics" -ForegroundColor $(if ($winMetrics -gt 0) {"Green"} else {"Red"})
  Write-Host "  remote_write metrics: $rwMetrics" -ForegroundColor $(if ($rwMetrics -gt 0) {"Green"} else {"Red"})
  Write-Host "  loki metrics: $lokiMetrics" -ForegroundColor $(if ($lokiMetrics -gt 0) {"Green"} else {"Yellow"})

  if ($winMetrics -gt 0 -and $rwMetrics -gt 0) {
    Write-Host "`n  SUCCESS — metrics are flowing!" -ForegroundColor Green
    if ($lokiMetrics -gt 0) {
      Write-Host "  Loki logs also flowing!" -ForegroundColor Green
    }
    Write-Host "  Check Grafana Cloud → Explore" -ForegroundColor Green
  } else {
    Write-Host "`n  Metrics not flowing yet — may need 60s for first scrape." -ForegroundColor Yellow
  }
} catch {
  Write-Host "  Could not reach Alloy metrics endpoint: $_" -ForegroundColor Red
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps for Grafana Assistant:"
Write-Host "  1. Enable Assistant: Administration → Plugins → grafana-assistant-app → Enable"
Write-Host "  2. Add GitHub MCP: Assistant → Settings → MCP servers → Add GitHub"
Write-Host "  3. Add Vercel MCP: Assistant → Settings → MCP servers → Add Vercel"
Write-Host "  4. Import dashboards: Dashboards → Import → upload grafana/*.json"
