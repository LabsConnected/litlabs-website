# LiTTree PowerShell 7 CLI

Core LiTTree agents available in your terminal.

## Install

Open **PowerShell 7** and run:

```powershell
irm https://raw.githubusercontent.com/LabsConnected/litlabs-website/main/cli/install.ps1 | iex
```

Then import the module:

```powershell
Import-Module LiTTree -Force
```

## Agents

- `Invoke-Director "<goal>"` — strategic planning and orchestration
- `Invoke-Builder "<task>"` — hands-on code and shipping

## Examples

```powershell
# Plan a feature
Invoke-Director "Build a React login page with Clerk" -Local

# Ship code
Invoke-Builder "Create a PowerShell function that lists recent git commits" -Local

# List agents
Get-LiTTreeAgent
```

## API mode

To call the live LiTTree API instead of echoing prompts:

```powershell
Set-LiTTreeConfig -ApiKey "your_key_from_settings"
Invoke-Builder "Add a dark mode toggle to the dashboard"
```

Get an API key from: https://litlabs.net/settings
