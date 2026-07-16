$os = Get-CimInstance Win32_OperatingSystem
$totalGB = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
$freeGB  = [math]::Round($os.FreePhysicalMemory/1MB, 1)
Write-Host ("SYSTEM: Total {0} GB | Free {1} GB | Used {2} GB" -f $totalGB, $freeGB, [math]::Round($totalGB-$freeGB,1))

Write-Host "`nPROCESSES BY RAM (MB):"
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('vmmem','vmmemWSL','devenv','Devin','kilo','cline','AnyDesk','node','ollama') } | Sort-Object WorkingSet -Descending | ForEach-Object {
  "{0,-12} {1,7} MB" -f $_.ProcessName, [math]::Round($_.WorkingSet/1MB,0)
} | Out-String -Width 200

# group Devin total
$devin = Get-Process -Name Devin -ErrorAction SilentlyContinue | Measure-Object WorkingSet -Sum
if ($devin.Count) { Write-Host ("`nDevin TOTAL: {0} MB ({1} procs)" -f [math]::Round($devin.Sum/1MB,0), $devin.Count) }
$wsl = Get-Process -Name vmmem* -ErrorAction SilentlyContinue | Measure-Object WorkingSet -Sum
if ($wsl.Count) { Write-Host ("WSL vmmem TOTAL: {0} MB" -f [math]::Round($wsl.Sum/1MB,0)) } else { Write-Host "`nWSL vmmem: not running (good)" }

# Network optimizations already applied
Write-Host "`nNETWORK OPTIMIZATIONS APPLIED:"
Write-Host "1. TCP chimney: disabled"
Write-Host "2. NetDMA: disabled"  
Write-Host "3. Auto-tuning level: normal"
Write-Host "4. RSS: enabled"
Write-Host "5. DisableLastAccess: enabled"
Write-Host "6. Disable8dot3: enabled"
Write-Host "NOTE: Enable write cache manually in Device Manager > Disk drives > Properties > Policies"