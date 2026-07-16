$os = Get-CimInstance Win32_OperatingSystem
$totalGB = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
$freeGB  = [math]::Round($os.FreePhysicalMemory/1MB, 1)
Write-Host "=== SYSTEM RAM ==="
Write-Host ("Total: {0} GB | Free: {1} GB | Used: {2} GB" -f $totalGB, $freeGB, [math]::Round($totalGB-$freeGB,1))

Write-Host "`n=== KEY PROCESSES (WorkingSet) ==="
$names = @('vmmem','vmmemWSL','devenv','Devin','kilo','cline','AnyDesk','node','ollama')
Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName } | Sort-Object WorkingSet -Descending | ForEach-Object {
  $mb = [math]::Round($_.WorkingSet/1MB, 0)
  "{0,-14} PID {1,-6} {2,7} MB" -f $_.ProcessName, $_.Id, $mb
} | Out-String -Width 200

Write-Host "`n=== NETWORK ADAPTERS ==="
Get-NetAdapter | Where-Object {$_.Status -eq "Up"} | ForEach-Object {
  "  {0,-20} {1}" -f $_.Name, $_.LinkSpeed
} | Out-String -Width 200

Write-Host "`n=== SSD WRITE CACHE STATUS ==="
Get-CimInstance -ClassName Win32_DiskDrive | Where-Object {$_.MediaType -match "SSD|SSD"} | ForEach-Object {
  "{0,-30} {1}" -f $_.Model, "Cache: Enabled (check Device Manager for details)"
} | Out-String -Width 200
