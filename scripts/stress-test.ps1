$ErrorActionPreference = "Stop"
$testFiles = @(
  "packages/litt-agent-core/src/__tests__/phase1.test.ts",
  "packages/litt-agent-core/src/__tests__/phase2.test.ts",
  "packages/litt-agent-core/src/__tests__/phase2c.test.ts",
  "packages/litt-agent-core/src/__tests__/phase2d.test.ts",
  "packages/litt-agent-core/src/__tests__/phase3a.test.ts",
  "packages/litt-agent-core/src/__tests__/phase1-contracts.test.ts"
)
$fileArgs = $testFiles -join " "
$results = @()
for ($i = 1; $i -le 10; $i++) {
  $output = node --test --import tsx $testFiles 2>&1
  $testsLine = ($output | Select-String "^# tests").ToString()
  $passLine = ($output | Select-String "^# pass").ToString()
  $failLine = ($output | Select-String "^# fail").ToString()
  $tests = [regex]::Match($testsLine, "(\d+)").Groups[1].Value
  $pass = [regex]::Match($passLine, "(\d+)").Groups[1].Value
  $fail = [regex]::Match($failLine, "(\d+)").Groups[1].Value
  $line = "RUN $i`: tests=$tests pass=$pass fail=$fail"
  Write-Output $line
  $results += $line
  if ($fail -ne "0") {
    Write-Output "FAILURE DETECTED — capturing error output:"
    $output | Select-String "not ok|Error|expected|actual" | Select-Object -First 10
    break
  }
}
Write-Output ""
Write-Output "=== SUMMARY ==="
$results | ForEach-Object { Write-Output $_ }
