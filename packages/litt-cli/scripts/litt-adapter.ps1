#Requires -Version 7.0
<#
.SYNOPSIS
    LiTT shell adapter — thin PowerShell shim that routes deterministic commands
    through @litlabs/litt-cli → @litt/agent-core.

.DESCRIPTION
    This is the canonical, reproducible PowerShell adapter for LiTT.
    It is intentionally thin: status/diff/log/branch go through the Node CLI,
    which calls @litt/agent-core's CommandRouter → ToolRegistry → ShellExecutor.

    The full LiTT-Code.ps1 cockpit (streaming chat, status bar, etc.) is a
    separate, thicker file that lives at $HOME\LiTT\LiTT-Code.ps1 and is NOT
    managed by this installer. This adapter only owns the deterministic
    command path.

    Install with:
        pwsh -File scripts/install-litt-cli.ps1

    Or from the repo root:
        ./scripts/install-litt-cli.ps1

.NOTES
    No hardcoded user paths. The CLI is resolved via:
      1. LITT_CLI_PATH env var
      2. LITT_BRAIN_REPO env var + packages/litt-cli/dist/index.js
      3. Walk up from cwd looking for packages/litt-cli
      4. Clear error
#>

param(
    [Parameter(Position = 0)]
    [string]$Command = "",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"

# ── Resolve the LiTT CLI path ──────────────────────────────────────
function Resolve-LittCli {
    # 1. Explicit env var
    if ($env:LITT_CLI_PATH -and (Test-Path $env:LITT_CLI_PATH)) {
        return $env:LITT_CLI_PATH
    }

    # 2. LITT_BRAIN_REPO + workspace-relative
    if ($env:LITT_BRAIN_REPO) {
        $candidate = Join-Path $env:LITT_BRAIN_REPO "packages\litt-cli\dist\index.js"
        if (Test-Path $candidate) { return $candidate }
    }

    # 3. Config file in $HOME\LiTT\litt-cli-path.txt
    $configPath = Join-Path $HOME "LiTT\litt-cli-path.txt"
    if (Test-Path $configPath) {
        $configured = (Get-Content $configPath -Raw).Trim()
        if ($configured -and (Test-Path $configured)) {
            return $configured
        }
    }

    # 4. Walk up from cwd (works when inside the repo)
    $here = (Get-Location).Path
    for ($i = 0; $i -lt 20; $i++) {
        $candidate = Join-Path $here "packages\litt-cli\dist\index.js"
        if (Test-Path $candidate) { return $candidate }
        $parent = Split-Path $here -Parent
        if ($parent -eq $here) { break }
        $here = $parent
    }

    # 5. Not found
    return $null
}

# ── Runtime state consumer (Phase 2D) ──────────────────────────────
# Polls GET /internal/runtime on terminal-server to get the canonical
# RuntimeStore snapshot. PowerShell is a CLIENT — never the authority.
# The $Sync variable here is only a last-received-snapshot cache, not
# a canonical state source.

function Get-LiTTTerminalUrl {
    # 1. Explicit env var
    if ($env:LITT_TERMINAL_URL) { return $env:LITT_TERMINAL_URL.TrimEnd('/') }
    # 2. Default localhost
    return "http://127.0.0.1:4001"
}

function Get-LiTTInternalKey {
    return $env:TERMINAL_INTERNAL_SERVICE_KEY
}

function Get-LiTTRuntimeState {
    <#
    .SYNOPSIS
        Fetch the canonical runtime state from terminal-server.
    .DESCRIPTION
        Polls GET /internal/runtime on the terminal-server. Returns a
        hashtable with:
          state     — the RuntimeState snapshot (or $null if unreachable)
          freshness — "fresh" | "stale" | "unreachable"
          fetchedAt — epoch ms of the fetch attempt
    .NOTES
        PowerShell is a CLIENT of terminal-server, never the authority.
        If the server is unreachable, the last known snapshot is retained
        and marked stale/unreachable.
    #>
    $baseUrl = Get-LiTTTerminalUrl
    $key = Get-LiTTInternalKey
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    if (-not $key -or $key.Length -lt 32) {
        return @{
            state = $null
            freshness = "unreachable"
            fetchedAt = $now
            error = "TERMINAL_INTERNAL_SERVICE_KEY not set or too short"
        }
    }

    try {
        $res = Invoke-RestMethod -Uri "$baseUrl/internal/runtime" `
            -Method Get `
            -Headers @{ "X-Internal-Service-Key" = $key } `
            -TimeoutSec 5 `
            -ErrorAction Stop

        $snapshot = $res
        $hb = $snapshot.heartbeat
        $lastHb = if ($hb -and $hb.lastHeartbeatAt) { [int64]$hb.lastHeartbeatAt } else { 0 }
        $intervalMs = if ($hb -and $hb.intervalMs) { [int64]$hb.intervalMs } else { 15000 }
        $maxFailures = if ($hb -and $hb.maxFailures) { [int64]$hb.maxFailures } else { 3 }

        # Freshness: fresh if heartbeat within 2x interval, stale otherwise
        $elapsed = $now - $lastHb
        $staleThreshold = $intervalMs * 2
        $freshness = if ($lastHb -eq 0 -or $elapsed -gt $staleThreshold) { "stale" } else { "fresh" }

        # Check heartbeat failures
        $failures = if ($hb -and $hb.failures) { [int64]$hb.failures } else { 0 }
        if ($failures -ge $maxFailures) { $freshness = "stale" }

        return @{
            state = $snapshot
            freshness = $freshness
            fetchedAt = $now
            error = $null
        }
    } catch {
        return @{
            state = $null
            freshness = "unreachable"
            fetchedAt = $now
            error = $_.Exception.Message
        }
    }
}

function Format-LiTTRuntimeState {
    <#
    .SYNOPSIS
        Render the runtime state snapshot as a human-readable summary.
    #>
    param(
        [Parameter(Mandatory)]
        $Snapshot
    )

    $state = $Snapshot.state
    $freshness = $Snapshot.freshness

    if ($freshness -eq "unreachable") {
        $err = $Snapshot.error
        Write-Host "LiTT Runtime: UNREACHABLE" -ForegroundColor Red
        if ($err) { Write-Host "  Error: $err" -ForegroundColor DarkGray }
        Write-Host "  The terminal-server is not responding." -ForegroundColor DarkGray
        Write-Host "  Last known state is stale." -ForegroundColor DarkGray
        return
    }

    $freshnessColor = if ($freshness -eq "fresh") { "Green" } else { "Yellow" }
    Write-Host "LiTT Runtime: $($freshness.ToUpper())" -ForegroundColor $freshnessColor

    if (-not $state) { return }

    # Project
    $proj = $state.project
    $projName = if ($proj -and $proj.name) { $proj.name } else { "(none)" }
    $branch = if ($state.branch) { $state.branch } else { "(no branch)" }
    Write-Host "  Project: $projName" -ForegroundColor Cyan
    Write-Host "  Branch:  $branch" -ForegroundColor Cyan

    # Phase
    $phase = $state.phase
    $phaseColor = switch ($phase) {
        "idle" { "DarkGray" }
        "running" { "Yellow" }
        "complete" { "Green" }
        "failed" { "Red" }
        default { "White" }
    }
    Write-Host "  Phase:   $phase" -ForegroundColor $phaseColor

    # Git changes
    $gitChanges = $state.gitChanges
    if ($gitChanges -gt 0) {
        Write-Host "  Changes: $gitChanges uncommitted" -ForegroundColor Yellow
    } else {
        Write-Host "  Changes: clean" -ForegroundColor DarkGray
    }

    # Online
    $online = $state.online
    $pingMs = $state.pingMs
    if ($online) {
        Write-Host "  Online:  yes (${pingMs}ms)" -ForegroundColor Green
    } else {
        Write-Host "  Online:  no" -ForegroundColor Red
    }

    # Heartbeat
    $hb = $state.heartbeat
    if ($hb) {
        $hbSeq = $hb.seq
        $hbFailures = $hb.failures
        $hbLatency = $hb.latencyMs
        $hbStatus = if ($hbFailures -ge ($hb.maxFailures ?? 3)) { "DEGRADED" } else { "ok" }
        Write-Host "  Heartbeat: seq=$hbSeq failures=$hbFailures latency=${hbLatency}ms [$hbStatus]" -ForegroundColor DarkGray
    }

    # Active command
    $active = $state.activeCommand
    if ($active) {
        $cmd = $active.command
        $cwd = $active.cwd
        Write-Host "  Active:  $cmd ($cwd)" -ForegroundColor Yellow
    }

    # Last result
    $last = $state.lastResult
    if ($last) {
        $lcmd = $last.command
        $lsuccess = $last.success
        $lexit = $last.exitCode
        $ldur = $last.durationMs
        $lrunId = $last.runId
        $lcolor = if ($lsuccess) { "Green" } else { "Red" }
        $lstatus = if ($lsuccess) { "OK" } else { "FAIL(exit=$lexit)" }
        Write-Host "  Last:    $lcmd [$lstatus] ${ldur}ms" -ForegroundColor $lcolor
        if ($lrunId) {
            Write-Host "  RunId:   $lrunId" -ForegroundColor DarkGray
        }
    }
}

# ── Dispatch ───────────────────────────────────────────────────────
$cliPath = Resolve-LittCli

if (-not $Command -or $Command -eq "--help" -or $Command -eq "-h") {
    if ($cliPath) {
        & node $cliPath --help
        exit $LASTEXITCODE
    }
    Write-Host "LiTT — deterministic command router + runtime consumer" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  status    Show project status (Git + runtime)"
    Write-Host "  diff      Show Git diff"
    Write-Host "  check     Run typecheck"
    Write-Host "  test      Run tests"
    Write-Host "  build     Run build"
    Write-Host "  runtime   Show canonical runtime state from terminal-server"
    Write-Host ""
    exit 0
}

# Handle 'runtime' command locally (REST poll, no CLI needed)
if ($Command -eq "runtime") {
    $snapshot = Get-LiTTRuntimeState
    Format-LiTTRuntimeState -Snapshot $snapshot
    if ($snapshot.freshness -eq "unreachable") { exit 1 }
    exit 0
}

if (-not $cliPath) {
    Write-Host "LiTT CLI not found." -ForegroundColor Red
    Write-Host "  Options (in priority order):" -ForegroundColor Yellow
    Write-Host "    1. Set LITT_CLI_PATH env var to the built CLI path" -ForegroundColor Gray
    Write-Host "    2. Set LITT_BRAIN_REPO env var to the repo root" -ForegroundColor Gray
    Write-Host "    3. Run the installer: pwsh -File packages/litt-cli/scripts/install-litt-cli.ps1" -ForegroundColor Gray
    Write-Host "    4. Run from inside the litlabs-website repo" -ForegroundColor Gray
    Write-Host "    5. Build it: pnpm --filter @litlabs/litt-cli build" -ForegroundColor Gray
    exit 1
}

$allArgs = @($Command) + $Rest
& node $cliPath @allArgs
exit $LASTEXITCODE
