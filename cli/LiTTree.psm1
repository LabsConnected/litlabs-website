#Requires -Version 7.0
<#
.SYNOPSIS
    LiTTree Lab Studios PowerShell 7 Agent Module
.DESCRIPTION
    Core agents for your terminal: Director (planning) and Builder (shipping).
    Install with: Install-Module -Name LiTTree -Scope CurrentUser
    Or run the installer from https://litlabs.net/marketplace
#>

$script:LiTTreeApiBase = $env:LITTREE_API_BASE ?? "https://litlabs.net"
$script:LiTTreeApiKey = $env:LITTREE_API_KEY ?? ""

function Set-LiTTreeConfig {
    <#
    .SYNOPSIS
        Configure the LiTTree API endpoint and optional API key.
    #>
    param(
        [string]$BaseUrl,
        [string]$ApiKey
    )
    if ($BaseUrl) { $script:LiTTreeApiBase = $BaseUrl.TrimEnd('/') }
    if ($ApiKey) { $script:LiTTreeApiKey = $ApiKey }
}

function Get-LiTTreeConfig {
    [PSCustomObject]@{
        BaseUrl = $script:LiTTreeApiBase
        HasKey  = [bool]$script:LiTTreeApiKey
    }
}

$script:CoreAgents = @{
    Director = [PSCustomObject]@{
        Slug        = "director"
        Name        = "Director"
        Role        = "orchestrator"
        Model       = "gemini-2.5-flash"
        Personality = "Strategic, decisive, concise"
        SystemPrompt = @"
You are Director, the strategic orchestrator for LiTTree Lab Studios.
Analyze the user's goal, break it into clear steps, and assign each step to the right agent.
Return output in this exact format:

GOAL: <restated goal>
PLAN:
1. [Agent] - [Action] - [Expected output]
2. [Agent] - [Action] - [Expected output]
SUCCESS CRITERIA: <how we know it's done>

Keep it concise. No filler.
"@
    }
    Builder = [PSCustomObject]@{
        Slug        = "builder"
        Name        = "Builder"
        Role        = "developer"
        Model       = "gemini-2.5-flash"
        Personality = "Pragmatic, precise, shipping-focused"
        SystemPrompt = @"
You are Builder, the hands-on engineer at LiTTree Lab Studios.
Write clean, production-ready code. When given a task, produce the file(s), commands, or edits needed.
Prefer complete, working examples with minimal commentary.

Output format:
FILES:
- path/to/file.ext: <description of contents>

COMMANDS:
- <command to run>

NOTES: <any important caveats>
"@
    }
}

function Get-LiTTreeAgent {
    <#
    .SYNOPSIS
        List the built-in LiTTree core agents.
    #>
    $script:CoreAgents.Values
}

function Invoke-LiTTreeAgent {
    <#
    .SYNOPSIS
        Send a prompt to a core LiTTree agent via the API or local echo mode.
    .PARAMETER Agent
        Agent slug: director or builder.
    .PARAMETER Prompt
        The task or question.
    .PARAMETER Local
        If set, print the structured prompt instead of calling the API.
    #>
    param(
        [Parameter(Mandatory)]
        [ValidateSet("director", "builder")]
        [string]$Agent,

        [Parameter(Mandatory)]
        [string]$Prompt,

        [switch]$Local
    )

    $agentMeta = $script:CoreAgents[$Agent]
    if (-not $agentMeta) { throw "Unknown agent: $Agent" }

    if ($Local) {
        return [PSCustomObject]@{
            Agent        = $agentMeta.Name
            SystemPrompt = $agentMeta.SystemPrompt
            UserPrompt   = $Prompt
            Hint         = "Use -Local to preview. Remove -Local to call the LiTTree API (requires API key)."
        }
    }

    if (-not $script:LiTTreeApiKey) {
        Write-Warning "No LITTREE_API_KEY set. Get one from https://litlabs.net/settings/keys then run Set-LiTTreeConfig -ApiKey '...'"
        return
    }

    $uri = "$script:LiTTreeApiBase/api/agents/chat"
    $body = @{
        agent    = $Agent
        message  = $Prompt
        stream   = $false
    } | ConvertTo-Json -Depth 3

    try {
        $response = Invoke-RestMethod -Uri $uri -Method POST -Headers @{
            Authorization = "Bearer $script:LiTTreeApiKey"
            "Content-Type" = "application/json"
        } -Body $body -ErrorAction Stop
        return $response
    } catch {
        Write-Error "Failed to call LiTTree API: $_"
    }
}

# Convenience aliases
function Invoke-Director {
    <#
    .SYNOPSIS
        Plan and orchestrate with Director.
    .EXAMPLE
        Invoke-Director "Build a React login page"
    #>
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Goal,
        [switch]$Local
    )
    Invoke-LiTTreeAgent -Agent director -Prompt $Goal -Local:$Local
}

function Invoke-Builder {
    <#
    .SYNOPSIS
        Ship code with Builder.
    .EXAMPLE
        Invoke-Builder "Create a PowerShell function that lists recent git commits"
    #>
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Task,
        [switch]$Local
    )
    Invoke-LiTTreeAgent -Agent builder -Prompt $Task -Local:$Local
}

Export-ModuleMember -Function Set-LiTTreeConfig, Get-LiTTreeConfig, Get-LiTTreeAgent, Invoke-LiTTreeAgent, Invoke-Director, Invoke-Builder
