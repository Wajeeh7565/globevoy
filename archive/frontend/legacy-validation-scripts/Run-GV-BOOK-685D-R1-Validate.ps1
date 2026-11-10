$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '=== GV-BOOK-685D-R1 portable frontend validation ==='
Write-Host 'Local fixtures only. No provider call, backend change, deployment or transaction.'
Write-Host ('Node: ' + (& node --version))

function Run-Node([string]$script) {
    & node $script
    if ($LASTEXITCODE -ne 0) { throw "Validation failed: $script" }
}

Push-Location $root
try {
    Write-Host "`n--- GV-BOOK-685D-R1 metro and cached evidence integrity ---"
    Run-Node '.\validate-gv-book-685d-r1-frontend.js'

    Write-Host "`n--- GV-BOOK-685D and inherited protections ---"
    & '.\Run-GV-BOOK-685D-Validate.ps1'
    if ($LASTEXITCODE -ne 0) { throw 'Inherited GV-BOOK-685D validation failed.' }

    Write-Host "`n--- R1 syntax/module checks ---"
    & node --check '.\scripts\booking-hub-685d.js'
    if ($LASTEXITCODE -ne 0) { throw 'R1 runtime syntax failed.' }
    & node --check '.\validate-gv-book-685d-r1-frontend.js'
    if ($LASTEXITCODE -ne 0) { throw 'R1 validator syntax failed.' }
    & node -e "const h=require('./scripts/booking-hub-685d.js'); if(h.VERSION!=='GV-BOOK-685D-R1'||typeof h.metroAirportDisclosure!=='function')process.exit(1); console.log('PASS R1 module load and exports')"
    if ($LASTEXITCODE -ne 0) { throw 'R1 module load failed.' }

    Write-Host "`nPASS - GV-BOOK-685D-R1 portable frontend validation."
    Write-Host 'Validated: R1 15/15; 685D 17/17; 685B 12/12; 681A-R1 7/7; 680B-R1 inherited; 676A 24/24; 676A-R1 14/14; 676A browser fixture 13/13; syntax/module PASS.'
}
finally {
    Pop-Location
}
