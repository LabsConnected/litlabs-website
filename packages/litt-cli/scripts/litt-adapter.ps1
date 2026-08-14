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

# ── Dispatch ───────────────────────────────────────────────────────
$cliPath = Resolve-LittCli

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

if (-not $Command -or $Command -eq "--help" -or $Command -eq "-h") {
    & node $cliPath --help
    exit $LASTEXITCODE
}

$allArgs = @($Command) + $Rest
& node $cliPath @allArgs
exit $LASTEXITCODE
