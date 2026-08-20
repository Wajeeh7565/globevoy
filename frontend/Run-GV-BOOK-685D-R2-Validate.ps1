$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '=== GV-BOOK-685D-R2 immediate trust repair validation ==='
Write-Host 'Local fixtures only. No provider call, backend change, deployment, payment or transaction.'
Write-Host ('Node: ' + (& node --version))

function Run-Node([string]$script) {
    & node $script
    if ($LASTEXITCODE -ne 0) { throw "Validation failed: $script" }
}

Push-Location $root
try {
    Write-Host "`n--- GV-BOOK-685D-R2 trust repair ---"
    Run-Node '.\validate-gv-book-685d-r2-trust-repair.js'

    Write-Host "`n--- GV-BOOK-685D and inherited protections ---"
    & '.\Run-GV-BOOK-685D-Validate.ps1'
    if ($LASTEXITCODE -ne 0) { throw 'Inherited GV-BOOK-685D validation failed.' }

    Write-Host "`n--- R2 syntax/module checks ---"
    & node --check '.\scripts\booking-hub-685d.js'
    if ($LASTEXITCODE -ne 0) { throw 'R2 runtime syntax failed.' }
    & node --check '.\validate-gv-book-685d-r2-trust-repair.js'
    if ($LASTEXITCODE -ne 0) { throw 'R2 validator syntax failed.' }
    & node -e "const h=require('./scripts/booking-hub-685d.js'); if(h.VERSION!=='GV-BOOK-685D-R2'||typeof h.groundUrl!=='function'||typeof h.groundEvidence!=='function')process.exit(1); console.log('PASS R2 module load and exports')"
    if ($LASTEXITCODE -ne 0) { throw 'R2 module load failed.' }

    Write-Host "`nPASS - GV-BOOK-685D-R2 immediate trust repair validation."
    Write-Host 'Validated: R2 18/18; 685D 17/17; 685B 12/12; 681A-R1 7/7; 680B-R1 inherited; 676A 24/24; 676A-R1 14/14; 676A browser fixture 13/13; syntax/module PASS.'
}
finally {
    Pop-Location
}
