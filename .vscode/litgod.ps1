# Aliases for Lightning Fast Development
# Add to $PROFILE: notepad $PROFILE

# Project shortcuts
Set-Alias -Name "lb" -Value "pnpm build"
Set-Alias -Name "lt" -Value "pnpm test"
Set-Alias -Name "ld" -Value "pnpm dev"
Set-Alias -Name "lp" -Value "pnpm lint"
Set-Alias -Name "lc" -Value "pnpm terminal:dev"

# Git shortcuts
Set-Alias -Name "gs" -Value "git status"
Set-Alias -Name "ga" -Value "git add"
Set-Alias -Name "gc" -Value "git commit"
Set-Alias -Name "gp" -Value "git push"
Set-Alias -Name "gco" -Value "git checkout"

# TypeScript
Set-Alias -Name "tc" -Value "npx tsc --noEmit --incremental"

# Cleanup
Set-Alias -Name "clean" -Value "Remove-Item .next -Recurse -Force -ErrorAction SilentlyContinue"

# Quick navigation
Function litlab { Set-Location "C:\Users\litbi\CascadeProjects\litlab" }

Write-Host "⚡ LiTT God Mode Enabled - Type 'lb', 'lt', 'ld', 'lp' for magic"