$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  node --check lambda.js
  node --check validate-gv-cors-686d-p1.js
  node validate-gv-cors-686d-p1.js
  if ($LASTEXITCODE -ne 0) { throw 'GV-CORS-686D-P1 validator failed.' }

  foreach ($line in Get-Content -LiteralPath 'GV-CORS-686D-P1-INTERNAL-SHA256.txt') {
    if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Malformed checksum line: $line" }
    $expected = $Matches[1]
    $file = $Matches[2] -replace '/', '\'
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower()
    if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
  }
  Write-Host 'GV-CORS-686D-P1 extracted-package validation PASS.'
}
finally {
  Pop-Location
}
