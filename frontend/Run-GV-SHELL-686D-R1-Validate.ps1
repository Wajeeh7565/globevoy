$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  node --check scripts/shell-670f.js
  node --check validation/validate-gv-shell-686d-r1.js
  node validation/validate-gv-shell-686d-r1.js
  if ($LASTEXITCODE -ne 0) { throw 'GV-SHELL-686D-R1 validator failed.' }

  .\Run-GV-RC-686D-Validate.ps1

  foreach ($line in Get-Content -LiteralPath 'GV-SHELL-686D-R1-INTERNAL-SHA256.txt') {
    if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Malformed checksum line: $line" }
    $expected = $Matches[1]
    $file = $Matches[2] -replace '/', '\'
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower()
    if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
  }
  Write-Host 'GV-SHELL-686D-R1 extracted-package validation PASS.'
}
finally {
  Pop-Location
}
