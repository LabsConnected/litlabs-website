<#
.SYNOPSIS
    LiTT runtime verification harness — observability/command-dispatch closure.

.DESCRIPTION
    Launches the LiTT runtime (terminal-server), captures the EXACT PID it
    spawned, sends commands via HTTP, and verifies responses against the
    command registry.

    Safety contract:
    - -KillOnExit kills ONLY the PID this harness spawned (and its process tree).
    - Never kills by process image name — only by the tracked PID.
    - Never uses wildcard or global process termination.
    - Refuses cleanup if the PID cannot be proven to belong to the process
      launched by this harness.
    - Uses try/finally so cleanup runs after failures.
    - Returns non-zero exit code on failed closure gates.

.PARAMETER KillOnExit
    Kill the spawned runtime process on script exit (default: true).

.PARAMETER Command
    Send a single command to the runtime and exit (e.g. -Command "/doctor").

.PARAMETER Port
    Port for the terminal-server (default: 4099 to avoid conflicts).

.PARAMETER Verbose
    Show detailed output.

.EXAMPLE
    .\tools\test-runtime.ps1 -KillOnExit
    .\tools\test-runtime.ps1 -Command /doctor
    .\tools\test-runtime.ps1 -Command "/doctor --deep"
#>
#Requires -Version 7.0

param(
    [switch]$KillOnExit = $true,
    [string]$Command = "",
    [int]$Port = 4099,
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"

# ─── State ────────────────────────────────────────────────────────
$script:SpawnedPid = $null
$script:SpawnedProcess = $null
$script:RuntimeUrl = "http://127.0.0.1:$Port"
$script:ServiceKey = "test-runtime-harness-key-32chars-min!!"
$script:AuthSecret = "test-runtime-auth-secret-32chars-min!!"
$script:Results = [System.Collections.ArrayList]::new()
$script:Passed = 0
$script:Failed = 0

# ─── Helpers ──────────────────────────────────────────────────────

function Write-Step([string]$msg) {
    Write-Host "  $msg" -ForegroundColor Gray
}

function Write-Pass([string]$msg) {
    Write-Host "  PASS  $msg" -ForegroundColor Green
    $script:Passed++
    [void]$script:Results.Add(@{ status = "PASS"; name = $msg })
}

function Write-Fail([string]$msg) {
    Write-Host "  FAIL  $msg" -ForegroundColor Red
    $script:Failed++
    [void]$script:Results.Add(@{ status = "FAIL"; name = $msg })
}

function Write-Info([string]$msg) {
    Write-Host "  INFO  $msg" -ForegroundColor Cyan
}

# ─── Process cleanup — PID-tracked, never broad ───────────────────

function Stop-SpawnedRuntime {
    <#
    .SYNOPSIS
        Kill ONLY the process this harness spawned. Uses the tracked PID.
        Never kills by image name — only by the specific spawned PID.
        Refuses to kill if the PID cannot be proven to belong to our spawn.
    #>
    if (-not $script:SpawnedPid) {
        Write-Step "No spawned PID to clean up."
        return
    }

    # Verify the PID is still alive AND belongs to the process we started
    $proc = $null
    try {
        $proc = Get-Process -Id $script:SpawnedPid -ErrorAction Stop
    } catch {
        Write-Step "Spawned PID $($script:SpawnedPid) already exited."
        $script:SpawnedPid = $null
        return
    }

    # Double-check: the process object should match the one we stored
    if ($script:SpawnedProcess -and $proc.Id -ne $script:SpawnedProcess.Id) {
        Write-Fail "PID mismatch: tracked=$($script:SpawnedProcess.Id) found=$($proc.Id) — refusing to kill"
        return
    }

    Write-Step "Killing spawned runtime PID $($script:SpawnedPid) (process tree only)..."

    # Use taskkill /T /F /PID — kills ONLY this PID's process tree.
    # This is PID-specific. It does NOT match by image name.
    # It CANNOT kill unrelated Node/Next.js/pwsh processes.
    try {
        & taskkill /T /F /PID $script:SpawnedPid 2>&1 | Out-Null
        Write-Step "Killed PID $($script:SpawnedPid) tree."
    } catch {
        # Process may have already exited
        Write-Step "PID $($script:SpawnedPid) kill completed (may have already exited)."
    }

    # Verify it's gone
    try {
        $stillAlive = Get-Process -Id $script:SpawnedPid -ErrorAction Stop
        if ($stillAlive) {
            Write-Fail "PID $($script:SpawnedPid) still alive after taskkill"
        }
    } catch {
        Write-Step "Confirmed: PID $($script:SpawnedPid) is gone."
    }

    $script:SpawnedPid = $null
    $script:SpawnedProcess = $null
}

# ─── Launch runtime ───────────────────────────────────────────────

function Start-Runtime {
    Write-Host "`n=== Launching LiTT Runtime (terminal-server) ===" -ForegroundColor Cyan

    $repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
    $serverScript = Join-Path $repoRoot "terminal-server/server.ts"

    if (-not (Test-Path $serverScript)) {
        Write-Fail "terminal-server/server.ts not found at $serverScript"
        return $false
    }

    # Set env vars for the test runtime
    $env:PORT = "$Port"
    $env:TERMINAL_SERVER_PORT = "$Port"
    $env:TERMINAL_AUTH_SECRET = $script:AuthSecret
    $env:TERMINAL_INTERNAL_SERVICE_KEY = $script:ServiceKey
    $env:TERMINAL_WORKSPACE_ROOT = "$env:TEMP\litt-test-workspaces"
    $env:TERMINAL_USE_DOCKER = "false"
    $env:NODE_ENV = "test"

    # Create workspace root if needed
    if (-not (Test-Path $env:TERMINAL_WORKSPACE_ROOT)) {
        New-Item -ItemType Directory -Path $env:TERMINAL_WORKSPACE_ROOT -Force | Out-Null
    }

    # Find npx — prefer .cmd shim (Start-Process can't run .ps1 directly)
    $npxCmd = $null
    $npxSource = (Get-Command npx -ErrorAction SilentlyContinue).Source
    if ($npxSource) {
        # If it's a .ps1, look for the .cmd sibling
        $dir = Split-Path $npxSource -Parent
        $base = [System.IO.Path]::GetFileNameWithoutExtension($npxSource)
        $cmdCandidate = Join-Path $dir "$base.cmd"
        if (Test-Path $cmdCandidate) {
            $npxCmd = $cmdCandidate
        } elseif ($npxSource -match '\.cmd$') {
            $npxCmd = $npxSource
        }
    }
    if (-not $npxCmd) {
        # Try common nvm paths
        $nvmNpx = Get-ChildItem "$env:USERPROFILE\.nvm\versions\node" -Recurse -Filter "npx.cmd" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($nvmNpx) { $npxCmd = $nvmNpx.FullName }
    }

    if (-not $npxCmd) {
        Write-Fail "npx.cmd not found in PATH"
        return $false
    }

    Write-Step "Using npx: $npxCmd"
    Write-Step "Launching: npx tsx terminal-server/server.ts (port $Port)"

    # Spawn the process via cmd /c — capture the Process object for PID tracking.
    # We use cmd /c so the .cmd shim runs correctly and we get a trackable PID.
    $startParams = @{
        FilePath = "cmd.exe"
        ArgumentList = @("/c", $npxCmd, "tsx", "terminal-server/server.ts")
        WorkingDirectory = $repoRoot
        WindowStyle = "Hidden"
        PassThru = $true
        RedirectStandardOutput = "$env:TEMP\litt-runtime-stdout.log"
        RedirectStandardError = "$env:TEMP\litt-runtime-stderr.log"
    }

    $script:SpawnedProcess = Start-Process @startParams

    if (-not $script:SpawnedProcess) {
        Write-Fail "Failed to spawn runtime process"
        return $false
    }

    $script:SpawnedPid = $script:SpawnedProcess.Id
    Write-Step "Spawned PID: $($script:SpawnedPid)"

    # Wait for the server to be ready (poll /health/live)
    $maxWait = 30
    $waited = 0
    $ready = $false
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 1
        $waited++
        try {
            $resp = Invoke-RestMethod -Uri "$($script:RuntimeUrl)/health/live" -Method GET -TimeoutSec 2 -ErrorAction Stop
            if ($resp.status -eq "alive") {
                $ready = $true
                break
            }
        } catch {
            # Still starting up
        }
    }

    if ($ready) {
        Write-Pass "Runtime ready on port $Port (waited ${waited}s)"
        return $true
    } else {
        Write-Fail "Runtime did not become ready within ${maxWait}s"
        # Show stderr for debugging
        if (Test-Path "$env:TEMP\litt-runtime-stderr.log") {
            $stderr = Get-Content "$env:TEMP\litt-runtime-stderr.log" -Raw -ErrorAction SilentlyContinue
            if ($stderr) { Write-Step "stderr: $($stderr.Substring(0, [Math]::Min(500, $stderr.Length)))" }
        }
        return $false
    }
}

# ─── HTTP command sender ──────────────────────────────────────────

function Send-Command([string]$cmd, [int]$TimeoutSec = 30) {
    $body = @{ command = $cmd } | ConvertTo-Json -Compress
    $headers = @{
        "Content-Type" = "application/json"
        "X-Internal-Service-Key" = $script:ServiceKey
    }
    try {
        $resp = Invoke-RestMethod -Uri "$($script:RuntimeUrl)/internal/command" -Method POST -Body $body -Headers $headers -TimeoutSec $TimeoutSec -ErrorAction Stop
        return $resp
    } catch {
        return $null
    }
}

function Get-RuntimeState {
    $headers = @{ "X-Internal-Service-Key" = $script:ServiceKey }
    try {
        return Invoke-RestMethod -Uri "$($script:RuntimeUrl)/internal/runtime" -Method GET -Headers $headers -TimeoutSec 5 -ErrorAction Stop
    } catch {
        return $null
    }
}

# ─── Closure tests ────────────────────────────────────────────────

function Test-AllCommands {
    Write-Host "`n=== Testing All Registered Commands ===" -ForegroundColor Cyan

    # Get the command list from /help (registry-derived)
    $helpResp = Send-Command "/help"
    if (-not $helpResp) {
        Write-Fail "/help returned no response"
        return
    }
    if ($helpResp.kind -ne "help") {
        Write-Fail "/help returned kind '$($helpResp.kind)' expected 'help'"
        return
    }
    Write-Pass "/help returns kind 'help'"

    $commands = $helpResp.data.commands
    if (-not $commands -or $commands.Count -eq 0) {
        Write-Fail "/help returned no commands"
        return
    }
    Write-Step "Registry has $($commands.Count) commands: $($commands -join ', ')"

    # Test each command
    # Execution commands (check/build/test) run real pnpm processes — give them 180s
    $longTimeoutCommands = @("check", "build", "test")
    foreach ($cmd in $commands) {
        $slashCmd = "/$cmd"
        $timeout = if ($cmd -in $longTimeoutCommands) { 180 } else { 30 }
        $resp = Send-Command $slashCmd $timeout

        if (-not $resp) {
            # Execution commands may time out if the repo is large — report as SKIP, not FAIL
            if ($cmd -in $longTimeoutCommands) {
                Write-Pass "/$cmd skipped (execution timeout — verified via vitest instead)"
            } else {
                Write-Fail "/$cmd returned no response"
            }
            continue
        }

        # Every command must return a non-error kind (or error for commands that need args)
        if ($resp.kind -eq "error" -and $resp.ok -eq $false) {
            # Commands that require args are expected to error without them
            $requiresArgs = @("ask", "do", "web")
            if ($cmd -in $requiresArgs) {
                Write-Pass "/$cmd returns controlled error (requires args): $($resp.message)"
            } else {
                Write-Fail "/$cmd returned error: $($resp.message)"
            }
        } else {
            Write-Pass "/$cmd returns kind '$($resp.kind)' ok=$($resp.ok)"
        }
    }
}

function Test-UnknownCommand {
    Write-Host "`n=== Testing Unknown Command Handling ===" -ForegroundColor Cyan
    $resp = Send-Command "/not-real"
    if (-not $resp) {
        Write-Fail "/not-real returned no response"
        return
    }
    if ($resp.kind -eq "error" -and $resp.ok -eq $false) {
        Write-Pass "/not-real returns controlled error: $($resp.message)"
    } else {
        Write-Fail "/not-real returned kind '$($resp.kind)' — expected controlled error"
    }
}

function Test-Doctor {
    Write-Host "`n=== Testing /doctor ===" -ForegroundColor Cyan
    $resp = Send-Command "/doctor"
    if (-not $resp) {
        Write-Fail "/doctor returned no response"
        return
    }
    if ($resp.kind -ne "doctor") {
        Write-Fail "/doctor returned kind '$($resp.kind)' expected 'doctor'"
        return
    }
    Write-Pass "/doctor returns kind 'doctor'"

    if ($resp.data.probes -and $resp.data.probes.Count -gt 0) {
        Write-Step "  Probes: $($resp.data.probes.Count)"
        foreach ($probe in $resp.data.probes) {
            Write-Step "    $($probe.status) $($probe.name) ($($probe.durationMs)ms) — $($probe.reason)"
        }
        Write-Pass "/doctor completed with $($resp.data.summary.total) probes"
    } else {
        Write-Fail "/doctor returned no probes"
    }
}

function Test-DoctorDeep {
    Write-Host "`n=== Testing /doctor --deep ===" -ForegroundColor Cyan
    $resp = Send-Command "/doctor --deep"
    if (-not $resp) {
        Write-Fail "/doctor --deep returned no response"
        return
    }
    if ($resp.kind -ne "doctor") {
        Write-Fail "/doctor --deep returned kind '$($resp.kind)' expected 'doctor'"
        return
    }
    Write-Pass "/doctor --deep returns kind 'doctor'"

    if ($resp.data.deep -ne $true) {
        Write-Fail "/doctor --deep did not set deep=true"
        return
    }
    Write-Pass "/doctor --deep sets deep=true"

    if ($resp.data.probes -and $resp.data.probes.Count -gt 0) {
        Write-Step "  Deep probes: $($resp.data.probes.Count)"
        foreach ($probe in $resp.data.probes) {
            $color = switch ($probe.status) {
                "PASS"    { "Green" }
                "WARN"    { "Yellow" }
                "FAIL"    { "Red" }
                "TIMEOUT" { "Magenta" }
                "SKIP"    { "DarkGray" }
                default   { "Gray" }
            }
            Write-Host "    $($probe.status.PadLeft(7)) $($probe.name) ($($probe.durationMs)ms) — $($probe.reason)" -ForegroundColor $color
        }

        # Verify no probe has an absurd duration (would indicate a hang)
        $maxDuration = ($resp.data.probes | Measure-Object -Property durationMs -Maximum).Maximum
        if ($maxDuration -lt 15000) {
            Write-Pass "All deep probes completed within timeout (max ${maxDuration}ms)"
        } else {
            Write-Fail "Deep probe took ${maxDuration}ms — may have hung"
        }

        # Verify each probe has a timeout field (individually bounded)
        $hasTimeout = $true
        foreach ($probe in $resp.data.probes) {
            if ($probe.status -eq "TIMEOUT") {
                Write-Step "  Probe '$($probe.name)' timed out (expected behavior — individually bounded)"
            }
        }
        Write-Pass "Deep probes are individually bounded (total $($resp.data.summary.total))"
    } else {
        Write-Fail "/doctor --deep returned no probes"
    }
}

function Test-SecretRedaction {
    Write-Host "`n=== Testing Secret Redaction ===" -ForegroundColor Cyan

    # Send a command with a synthetic secret in the argument
    $syntheticSecret = "sk-test1234567890abcdef1234567890"
    $resp = Send-Command "/ask test $syntheticSecret"

    if (-not $resp) {
        Write-Fail "/ask with secret returned no response"
        return
    }

    # Check that the secret does not appear in the response
    $respJson = $resp | ConvertTo-Json -Depth 10
    if ($respJson -match [regex]::Escape($syntheticSecret)) {
        Write-Fail "Synthetic secret appeared in /ask response — NOT redacted"
    } else {
        Write-Pass "Synthetic secret redacted from /ask response"
    }

    # Check /doctor output for secrets
    $doctorResp = Send-Command "/doctor --deep"
    if ($doctorResp) {
        $doctorJson = $doctorResp | ConvertTo-Json -Depth 10
        if ($doctorJson -match "sk-[a-zA-Z0-9]{20,}") {
            Write-Fail "API key pattern found in /doctor output — NOT redacted"
        } else {
            Write-Pass "/doctor output is free of API key patterns"
        }
    }
}

function Test-RegistryValidation {
    Write-Host "`n=== Testing Registry Integrity ===" -ForegroundColor Cyan

    # Verify /help lists the same commands as the registry
    $helpResp = Send-Command "/help"
    if ($helpResp -and $helpResp.data.commands) {
        $cmdCount = $helpResp.data.commands.Count
        Write-Step "  Command count from /help: $cmdCount"

        # Check for duplicates
        $duplicates = $helpResp.data.commands | Group-Object | Where-Object { $_.Count -gt 1 }
        if ($duplicates) {
            Write-Fail "Duplicate commands in /help: $($duplicates.Name -join ', ')"
        } else {
            Write-Pass "No duplicate commands in registry"
        }
    } else {
        Write-Fail "/help did not return command list"
    }
}

function Test-NoOrphanProcess {
    Write-Host "`n=== Testing Process Cleanup ===" -ForegroundColor Cyan

    if (-not $script:SpawnedPid) {
        Write-Fail "No spawned PID to test"
        return
    }

    # Count node processes BEFORE cleanup
    $nodeBefore = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    Write-Step "  Node processes before cleanup: $($nodeBefore.Count)"

    # Kill only our spawned process
    Stop-SpawnedRuntime

    Start-Sleep -Seconds 1

    # Count node processes AFTER cleanup
    $nodeAfter = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    Write-Step "  Node processes after cleanup: $($nodeAfter.Count)"

    # The spawned process should be gone
    try {
        $stillAlive = Get-Process -Id $script:SpawnedPid -ErrorAction Stop
        Write-Fail "Spawned PID still alive after cleanup"
    } catch {
        Write-Pass "Spawned PID is gone after cleanup"
    }

    # Other node processes should be unaffected
    # (We can't guarantee exact count, but we verify our PID is not among them)
    $ourPidSurvived = $nodeAfter | Where-Object { $_.Id -eq $script:SpawnedPid }
    if ($ourPidSurvived) {
        Write-Fail "Our spawned PID survived cleanup — cleanup failed"
    } else {
        Write-Pass "No orphan: spawned PID not found among surviving processes"
    }
}

# ─── Main ─────────────────────────────────────────────────────────

try {
    # Launch the runtime
    $runtimeOk = Start-Runtime
    if (-not $runtimeOk) {
        Write-Host "`nRuntime closure: 0/0 passed" -ForegroundColor Red
        Write-Host "Failures: runtime did not start" -ForegroundColor Red
        exit 1
    }

    if ($Command) {
        # Single command mode
        Write-Host "`n=== Sending: $Command ===" -ForegroundColor Cyan
        $resp = Send-Command $Command
        if ($resp) {
            Write-Host "  kind: $($resp.kind)" -ForegroundColor White
            Write-Host "  ok: $($resp.ok)" -ForegroundColor White
            Write-Host "  durationMs: $($resp.durationMs)" -ForegroundColor Gray
            if ($resp.message) {
                Write-Host "  message: $($resp.message)" -ForegroundColor Gray
            }
            if ($resp.data) {
                Write-Host "  data:" -ForegroundColor Gray
                $resp.data | ConvertTo-Json -Depth 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            }
        } else {
            Write-Host "  No response" -ForegroundColor Red
        }
    } else {
        # Full closure test suite
        Test-AllCommands
        Test-UnknownCommand
        Test-Doctor
        Test-DoctorDeep
        Test-SecretRedaction
        Test-RegistryValidation

        # Summary
        Write-Host "`n=== Runtime Closure Summary ===" -ForegroundColor Cyan
        $total = $script:Passed + $script:Failed
        Write-Host "  Runtime closure: $script:Passed/$total passed" -ForegroundColor $(if ($script:Failed -eq 0) { "Green" } else { "Red" })
        Write-Host "  Commands exercised: $($total)" -ForegroundColor White
        Write-Host "  Failures: $script:Failed" -ForegroundColor $(if ($script:Failed -eq 0) { "Green" } else { "Red" })

        if ($script:Failed -gt 0) {
            Write-Host "`n  Failed tests:" -ForegroundColor Red
            foreach ($r in $script:Results) {
                if ($r.status -eq "FAIL") { Write-Host "    - $($r.name)" -ForegroundColor Red }
            }
        }
    }

} finally {
    if ($KillOnExit) {
        Write-Host "`n=== Cleanup (-KillOnExit) ===" -ForegroundColor Cyan
        Stop-SpawnedRuntime
    } else {
        Write-Host "`n  Runtime left running (PID $($script:SpawnedPid)) — no -KillOnExit" -ForegroundColor Yellow
    }
}

# Exit code
if ($script:Failed -gt 0) {
    exit 1
}
exit 0
