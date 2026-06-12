# Perf benchmark script for LiTTree Lab Studios
# Run: .\scripts\perf.ps1

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$report = "perf/benchmark-$stamp.md"

New-Item -ItemType Directory -Force -Path "perf" | Out-Null

function Log($msg) { Write-Host "[perf] $msg" -ForegroundColor Cyan }

Log "Starting benchmark..."

# 1. Build time
Log "Measuring build time..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
npm run build *> $null
$sw.Stop()
$buildTime = [math]::Round($sw.Elapsed.TotalSeconds, 2)
Log "Build completed in ${buildTime}s"

# 2. Bundle size
$staticSize = (Get-ChildItem -Recurse .next/static | Measure-Object -Property Length -Sum).Sum
$staticMB = [math]::Round($staticSize / 1MB, 2)
$nextSize = (Get-ChildItem -Recurse .next | Measure-Object -Property Length -Sum).Sum
$nextMB = [math]::Round($nextSize / 1MB, 2)

# 3. Route count
$routeCount = (Select-String -Path ".next/routes-manifest.json" -Pattern '"page"' -AllMatches).Matches.Count

# 4. Generate report
@"
# Performance Benchmark — $stamp

## Build
- **Duration**: ${buildTime}s
- **Total .next size**: ${nextMB} MB
- **Static assets**: ${staticMB} MB
- **Route count**: ~$routeCount

## Files
| Metric | Value |
|--------|-------|
| Build time | ${buildTime}s |
| .next total | ${nextMB} MB |
| Static only | ${staticMB} MB |
| Routes | ~$routeCount |

## Notes
- Run with: npm run build
- TypeScript incremental: enabled
- Bundle analyzer: .next/analyze/client.html
"@ | Out-File -FilePath $report -Encoding UTF8

Log "Report written to $report"
