Write-Host "Checking terminal server deployment setup..." -ForegroundColor Cyan
$err = 0

if (Test-Path .github/workflows/deploy-terminal.yml) {
  Write-Host "OK: GitHub Actions workflow exists" -ForegroundColor Green
} else {
  Write-Host "FAIL: .github/workflows/deploy-terminal.yml missing" -ForegroundColor Red
  $err++
}

if (Test-Path terminal-server/Dockerfile) {
  Write-Host "OK: terminal-server/Dockerfile exists" -ForegroundColor Green
} else {
  Write-Host "FAIL: terminal-server/Dockerfile missing" -ForegroundColor Red
  $err++
}

if (Test-Path terminal-server/railway.json) {
  Write-Host "OK: terminal-server/railway.json exists" -ForegroundColor Green
} else {
  Write-Host "FAIL: terminal-server/railway.json missing" -ForegroundColor Red
  $err++
}

if (Test-Path scripts/deploy-terminal.ps1) {
  Write-Host "OK: deploy script exists" -ForegroundColor Green
} else {
  Write-Host "FAIL: scripts/deploy-terminal.ps1 missing" -ForegroundColor Red
  $err++
}

if ($env:RAILWAY_TOKEN) {
  Write-Host "OK: RAILWAY_TOKEN environment variable is set" -ForegroundColor Green
} else {
  Write-Host "WARN: RAILWAY_TOKEN not set in this shell (only needed for local deploy)" -ForegroundColor Yellow
}

$remote = git remote -v 2>&1 | Select-String "origin.*github.com"
if ($remote) {
  Write-Host "OK: GitHub origin remote configured" -ForegroundColor Green
  Write-Host "    $remote" -ForegroundColor DarkGray
} else {
  Write-Host "WARN: no GitHub origin remote found" -ForegroundColor Yellow
}

Write-Host ""
if ($err -eq 0) {
  Write-Host "All files are in place. Next: add RAILWAY_TOKEN to GitHub Actions secrets and run the workflow." -ForegroundColor Green
} else {
  Write-Host "Found $err issue(s)." -ForegroundColor Red
}
