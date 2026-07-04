#Requires -Version 7
param(
  [string]$Service = "litlabs-terminal-server"
)

$ErrorActionPreference = "Stop"

if (-not $env:RAILWAY_TOKEN) {
  Write-Error "RAILWAY_TOKEN environment variable is required. Get it from https://railway.app/account/tokens"
  exit 1
}

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Railway CLI..."
  npm install -g @railway/cli
}

Push-Location terminal-server
railway up --service $Service
Pop-Location
