$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../../frontend')).Path

Write-Host '=== GV-BOOK-685D portable frontend validation ==='
Write-Host 'Local fixtures only. No provider call, Lambda change, deployment or transaction.'
Write-Host ('Node: ' + (& node --version))

function Run-Node([string]$script) {
    & node $script
    if ($LASTEXITCODE -ne 0) { throw "Validation failed: $script" }
}

Push-Location $root
try {
    Write-Host "`n--- GV-BOOK-685D complete-trip hub ---"
    Run-Node '.\validation\validate-gv-book-685d-frontend.js'

    Write-Host "`n--- GV-TRUST-685B and inherited trust baseline ---"
    & '.\..\ops\frontend\validation\Run-GV-TRUST-685B-Validate.ps1'
    if ($LASTEXITCODE -ne 0) { throw 'GV-TRUST-685B validation failed.' }

    Write-Host "`n--- inherited booking protections ---"
    Run-Node '.\validation\validate-gv-book-676a.js'
    Run-Node '.\validation\validate-gv-book-676a-r1.js'
    Run-Node '.\validation\validate-gv-book-676a-browser-fixture.js'

    Write-Host "`n--- syntax/module checks ---"
    & node --check '.\scripts\booking-hub-685d.js'
    if ($LASTEXITCODE -ne 0) { throw '685D script syntax failed.' }
    & node --check '.\validation\validate-gv-book-685d-frontend.js'
    if ($LASTEXITCODE -ne 0) { throw '685D validator syntax failed.' }
    & node -e "const h=require('./scripts/booking-hub-685d.js'); if(!['GV-BOOK-685D','GV-BOOK-685D-R1','GV-BOOK-685D-R2'].includes(h.VERSION))process.exit(1); console.log('PASS module load and version check')"
    if ($LASTEXITCODE -ne 0) { throw '685D module load failed.' }

    Write-Host "`nPASS - GV-BOOK-685D portable frontend validation."
    Write-Host 'Validated: 685D 17/17; 685B 12/12; 681A-R1 7/7; 680B-R1 inherited; 676A 24/24; 676A-R1 14/14; 676A browser fixture 13/13; syntax/module PASS.'
}
finally {
    Pop-Location
}
