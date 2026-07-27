$files = @("loader.js","emulator.min.js","emulator.min.css","version.json","cores/fceumm-wasm.data","cores/nestopia-wasm.data","cores/snes9x-wasm.data","compression/extract7z.js","compression/extractzip.js")
foreach ($f in $files) {
  $url = "https://litlabs.net/emulatorjs/4.2.3/data/$f"
  try {
    $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    $bytes = $res.Content[0..5]
    $hex = ($bytes | ForEach-Object { $_.ToString("X2") }) -join " "
    $ct = $res.Headers["Content-Type"]
    $size = $res.Content.Length
    $is7z = $bytes[0] -eq 0x37 -and $bytes[1] -eq 0x7A
    $isHtml = $ct -match "text/html"
    if ($isHtml) { $status = "HTML-FALLBACK" }
    elseif ($f.EndsWith(".data") -and -not $is7z) { $status = "WRONG-SIG" }
    else { $status = "OK" }
    Write-Output "$status $f | $size b | ct:$ct | sig:$hex"
  } catch {
    Write-Output "FAIL $f : $($_.Exception.Message)"
  }
}
