# LiTTree Terminal Server Auto-Start
# This script starts the terminal server when you run pnpm dev

Write-Host "[LiTTree] Checking terminal server..." -ForegroundColor Cyan

$port = 4001
$terminalProcess = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if (-not $terminalProcess) {
    Write-Host "[LiTTree] Terminal server not running. Starting..." -ForegroundColor Yellow
    
    # Start terminal server in background
    $terminalJob = Start-Job -ScriptBlock {
        Set-Location "$using:PWD"
        pnpm terminal:dev 2>&1 | ForEach-Object {
            Write-Host $_
            $_
        }
    }
    
    # Wait for it to start
    $maxRetries = 10
    $retryCount = 0
    $started = $false
    
    while ($retryCount -lt $maxRetries -and -not $started) {
        Start-Sleep -Seconds 1
        $terminalProcess = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($terminalProcess) {
            $started = $true
            Write-Host "[LiTTree] ✓ Terminal server started on port $port" -ForegroundColor Green
        }
        $retryCount++
    }
    
    if (-not $started) {
        Write-Warning "[LiTTree] ⚠ Terminal server failed to start. You can start it manually with: pnpm terminal:dev"
    }
} else {
    Write-Host "[LiTTree] ✓ Terminal server already running on port $port" -ForegroundColor Green
}
