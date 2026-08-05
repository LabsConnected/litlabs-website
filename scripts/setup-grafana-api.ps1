<#
.SYNOPSIS
  Configure Grafana Cloud via HTTP API — data sources, dashboards, alerts.
.DESCRIPTION
  Uses the Grafana HTTP API to:
    1. Add Loki data source
    2. Import all dashboards from grafana/*.json
    3. Verify everything is accessible

  No browser clicking required.
.PARAMETER GrafanaUrl
  Your Grafana instance URL (e.g. https://vastantelope1841.grafana.net)
.PARAMETER ApiKey
  Grafana Cloud API key with admin scope (for data source + dashboard management)
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$GrafanaUrl,

  [Parameter(Mandatory = $true)]
  [string]$ApiKey
)

$ErrorActionPreference = "Stop"

# Normalize URL (remove trailing slash)
$GrafanaUrl = $GrafanaUrl.TrimEnd('/')

$headers = @{
  "Authorization" = "Bearer $ApiKey"
  "Content-Type"  = "application/json"
}

Write-Host "`n=== Grafana Cloud API Setup ===" -ForegroundColor Cyan
Write-Host "Instance: $GrafanaUrl" -ForegroundColor DarkGray

# ─── 1. Add Loki data source ───────────────────────────────────────
Write-Host "`n[1/3] Adding Loki data source..." -ForegroundColor Yellow

$lokiPayload = @{
  name      = "grafanacloud-vastantelope1841-logs"
  type      = "loki"
  url       = "https://logs-prod-036.grafana.net"
  access    = "proxy"
  basicAuth = $true
  jsonData = @{
    httpHeaderName1 = "Authorization"
  }
  secureJsonData = @{
    basicAuthPassword = $ApiKey
  }
  jsonData2 = @{
    basicAuthUser = "3425326"
  }
} | ConvertTo-Json -Depth 5

try {
  $resp = Invoke-RestMethod -Uri "$GrafanaUrl/api/datasources" -Method POST -Headers $headers -Body $lokiPayload
  Write-Host "  Loki data source created (ID: $($resp.id))" -ForegroundColor Green
} catch {
  if ($_.Error.Message -match "already exists" -or $_.Error.Message -match "409") {
    Write-Host "  Loki data source already exists — skipping" -ForegroundColor DarkYellow
  } else {
    Write-Host "  Warning: $($_.Error.Message)" -ForegroundColor DarkYellow
  }
}

# ─── 2. Import dashboards ──────────────────────────────────────────
Write-Host "`n[2/3] Importing dashboards..." -ForegroundColor Yellow

$dashboards = @(
  @{ file = "grafana/dashboard-overview.json";       name = "Host & App Overview" },
  @{ file = "grafana/dashboard-alerts.json";          name = "Alert Rules" },
  @{ file = "grafana/dashboard-project-health.json";  name = "Project Health" }
)

# Resolve paths relative to project root (parent of scripts/)
$projectRoot = Split-Path $PSScriptRoot -Parent

foreach ($db in $dashboards) {
  $dbPath = Join-Path $projectRoot $db.file
  if (!(Test-Path $dbPath)) {
    Write-Host "  Skipping $($db.name) — file not found: $dbPath" -ForegroundColor Red
    continue
  }

  $dbJson = Get-Content $dbPath -Raw | ConvertFrom-Json

  # The import API expects { dashboard: {...}, folderId: 0, overwrite: true }
  $importPayload = @{
    dashboard = $dbJson
    folderId  = 0
    overwrite = $true
  } | ConvertTo-Json -Depth 20

  try {
    $resp = Invoke-RestMethod -Uri "$GrafanaUrl/api/dashboards/db" -Method POST -Headers $headers -Body $importPayload
    Write-Host "  Imported: $($db.name) → URL: $GrafanaUrl/d/$($dbJson.uid)" -ForegroundColor Green
  } catch {
    Write-Host "  Failed to import $($db.name): $($_.Error.Message)" -ForegroundColor Red
  }
}

# ─── 3. Verify data sources ────────────────────────────────────────
Write-Host "`n[3/3] Verifying data sources..." -ForegroundColor Yellow

try {
  $sources = Invoke-RestMethod -Uri "$GrafanaUrl/api/datasources" -Method GET -Headers $headers
  foreach ($src in $sources) {
    Write-Host "  $($src.type): $($src.name) (id=$($src.id))" -ForegroundColor $(if ($src.type -in @("prometheus","loki")) {"Green"} else {"DarkGray"})
  }
} catch {
  Write-Host "  Could not list data sources: $($_.Error.Message)" -ForegroundColor Red
}

# ─── Summary ───────────────────────────────────────────────────────
Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Dashboards:"
Write-Host "  $GrafanaUrl/d/litlabs-overview        — Host & App Overview"
Write-Host "  $GrafanaUrl/d/litlabs-alerts          — Alert Rules"
Write-Host "  $GrafanaUrl/d/litlabs-project-health  — Project Health"
Write-Host ""
Write-Host "Still need to do manually (no API for these):"
Write-Host "  1. Enable Assistant: Administration → Plugins → grafana-assistant-app → Enable"
Write-Host "  2. Add GitHub MCP: Assistant → Settings → MCP servers → Add GitHub"
Write-Host "  3. Add Vercel MCP: Assistant → Settings → MCP servers → Add Vercel"
