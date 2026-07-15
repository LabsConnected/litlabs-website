#Requires -Version 7.0
<#
.SYNOPSIS
    Install the LiTTree PowerShell 7 module locally.
.DESCRIPTION
    Downloads cli/LiTTree.psm1 from the repo and copies it into a local PowerShell module path.
    Run from PowerShell 7 with:
        irm https://raw.githubusercontent.com/LabsConnected/litlabs-website/main/cli/install.ps1 | iex
#>
param(
    [string]$Branch = "main",
    [string]$Scope = "CurrentUser" # CurrentUser or AllUsers
)

$ErrorActionPreference = "Stop"

$moduleName = "LiTTree"
$moduleDir = Join-Path ($Scope -eq "AllUsers" ? $env:ProgramFiles : $env:USERPROFILE) "Documents\PowerShell\Modules\$moduleName"
$moduleFile = Join-Path $moduleDir "LiTTree.psm1"
$manifestFile = Join-Path $moduleDir "LiTTree.psd1"

$repoUrl = "https://raw.githubusercontent.com/LabsConnected/litlabs-website/$Branch/cli"

New-Item -ItemType Directory -Force -Path $moduleDir | Out-Null

Write-Host "Installing LiTTree module to $moduleDir ..." -ForegroundColor Cyan

Invoke-RestMethod -Uri "$repoUrl/LiTTree.psm1" -OutFile $moduleFile -ErrorAction Stop

$manifest = @"
@{
    RootModule        = 'LiTTree.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = 'b3d9e2f4-8c1a-4e5b-9f6d-7a8b9c0d1e2f'
    Author            = 'LiTTree Lab Studios'
    CompanyName       = 'LiTTree Lab Studios'
    Description       = 'Core LiTTree agents for PowerShell 7: Director and Builder.'
    PowerShellVersion = '7.0'
    FunctionsToExport = @('Set-LiTTreeConfig','Get-LiTTreeConfig','Get-LiTTreeAgent','Invoke-LiTTreeAgent','Invoke-Director','Invoke-Builder')
    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
}
"@
$manifest | Out-File -FilePath $manifestFile -Encoding utf8 -Force

Write-Host "LiTTree module installed." -ForegroundColor Green
Write-Host "Import it with: Import-Module LiTTree -Force" -ForegroundColor Yellow
Write-Host "Get started with: Get-LiTTreeAgent" -ForegroundColor Yellow
