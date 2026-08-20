$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  node --check scripts/multi-city-trip-673a.js
  node --check scripts/multicity-visualizer-674a.js
  node --check scripts/journey-experience-686b.js
  node --check scripts/booking-hub-685d.js
  node --check scripts/booking-workspace-686c.js
  node --check validation/validate-gv-rc-686d.js
  node validation/validate-gv-rc-686d.js
  if ($LASTEXITCODE -ne 0) { throw "GV-RC-686D master validation failed." }

  $manifests = @(
    'GV-SHELL-686A-CHECKSUMS.sha256',
    'GV-JOURNEY-686B-CHECKSUMS.sha256',
    'GV-BOOK-686C-CHECKSUMS.sha256',
    'GV-RC-686D-CHANGED-FILE-HASHES.sha256'
  )
  foreach ($manifest in $manifests) {
    if (-not (Test-Path -LiteralPath $manifest)) { throw "Missing checksum manifest: $manifest" }
    foreach ($line in Get-Content -LiteralPath $manifest) {
      if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Malformed checksum line in ${manifest}: $line" }
      $expected = $Matches[1]
      $file = $Matches[2] -replace '/', '\'
      $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower()
      if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
    }
  }
  Write-Host 'GV-RC-686D extracted-package validation PASS.'
}
finally {
  Pop-Location
}

