#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Fix Alloy config path + env var in registry after winget install.
.DESCRIPTION
  The winget installer created the service with the default empty config
  at C:\Program Files\GrafanaLabs\Alloy\config.alloy. This script
  repoints it to our real config at C:\ProgramData\GrafanaLabs\Alloy\config.alloy
  and injects the GCLOUD_RW_API_KEY env var into the service.
#>

$ErrorActionPreference = "Stop"

Write-Host "`n=== Fixing Alloy Registry ===" -ForegroundColor Cyan

# ─── 1. Update config path in registry ─────────────────────────────
$regPath = "HKLM:\SOFTWARE\GrafanaLabs\Alloy"
$newArgs = @("run", "C:\ProgramData\GrafanaLabs\Alloy\config.alloy", "--storage.path=C:\ProgramData\GrafanaLabs\Alloy\data")

Write-Host "[1/3] Updating config path..." -ForegroundColor Yellow
Set-ItemProperty $regPath -Name "Arguments" -Value $newArgs -Type MultiString
Write-Host "  Arguments set to: run C:\ProgramData\GrafanaLabs\Alloy\config.alloy"

# ─── 2. Inject API key into service environment ────────────────────
Write-Host "[2/3] Injecting API key into service env..." -ForegroundColor Yellow
$apiKey = [Environment]::GetEnvironmentVariable("GCLOUD_RW_API_KEY", "Machine")
if (!$apiKey) {
  Write-Error "GCLOUD_RW_API_KEY not set at machine level. Run install-alloy.ps1 first."
  exit 1
}
$envArray = @("GCLOUD_RW_API_KEY=$apiKey")
Set-ItemProperty $regPath -Name "Environment" -Value $envArray -Type MultiString
Write-Host "  Environment set with GCLOUD_RW_API_KEY"

# ─── 3. Restart service ────────────────────────────────────────────
Write-Host "[3/3] Restarting Alloy service..." -ForegroundColor Yellow
Stop-Service "Alloy" -Force
Start-Sleep -Seconds 2
Start-Service "Alloy"
Start-Sleep -Seconds 5

# ─── Verify ────────────────────────────────────────────────────────
Write-Host "`n=== Verification ===" -ForegroundColor Cyan
$svc = Get-Service "Alloy"
Write-Host "  Service: $($svc.Status)" -ForegroundColor $(if ($svc.Status -eq "Running") {"Green"} else {"Red"})

# Check metrics are flowing
try {
  $r = Invoke-WebRequest -Uri "http://localhost:12345/metrics" -UseBasicParsing -TimeoutSec 5
  $lines = $r.Content -split "`n"
  $winMetrics = ($lines | Select-String "windows_").Count
  $rwMetrics = ($lines | Select-String "prometheus_remote_write").Count
  Write-Host "  windows_ metrics: $winMetrics" -ForegroundColor $(if ($winMetrics -gt 0) {"Green"} else {"Red"})
  Write-Host "  remote_write metrics: $rwMetrics" -ForegroundColor $(if ($rwMetrics -gt 0) {"Green"} else {"Red"})

  if ($winMetrics -gt 0 -and $rwMetrics -gt 0) {
    Write-Host "`n  SUCCESS — metrics are flowing!" -ForegroundColor Green
    Write-Host "  Check Grafana Cloud → Explore → Prometheus for windows_* metrics" -ForegroundColor Green
  } else {
    Write-Host "`n  Metrics not flowing yet — may need 60s for first scrape." -ForegroundColor Yellow
    Write-Host "  Re-check in a minute: Invoke-WebRequest http://localhost:12345/metrics" -ForegroundColor Yellow
  }
} catch {
  Write-Host "  Could not reach Alloy metrics endpoint: $_" -ForegroundColor Red
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
