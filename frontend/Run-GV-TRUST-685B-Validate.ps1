$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Write-Host '=== GV-TRUST-685B portable frontend validation ==='
Write-Host 'Frontend-only. No AWS call. No Lambda change. No provider call.'
Write-Host 'Checks evidence-aware budget confidence and inherited frontend trust/UX protections.'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
    $node = (Get-Command node -ErrorAction Stop).Source
    Write-Host "Node: $(& $node --version)"
    Write-Host ''

    Write-Host '--- validate-gv-trust-685b-frontend.js ---'
    & $node '.\validate-gv-trust-685b-frontend.js'
    if ($LASTEXITCODE -ne 0) { throw 'GV-TRUST-685B validator failed.' }

    Write-Host ''
    Write-Host '--- inherited GV-TRUST-681A-R1 ---'
    & $node '.\validate-gv-trust-681a-r1-frontend.js'
    if ($LASTEXITCODE -ne 0) { throw 'Inherited GV-TRUST-681A-R1 validator failed.' }

    Write-Host ''
    Write-Host '--- inherited GV-QUALITY-680B-R1 ---'
    & $node '.\validate-gv-quality-680b-r1-frontend.js'
    if ($LASTEXITCODE -ne 0) { throw 'Inherited GV-QUALITY-680B-R1 validator failed.' }

    Write-Host ''
    Write-Host '--- syntax checks ---'
    & $node --check '.\scripts\budget-confidence-685b.js'
    if ($LASTEXITCODE -ne 0) { throw '685B confidence module syntax failed.' }
    & $node --check '.\scripts\multicity-visualizer-674a.js'
    if ($LASTEXITCODE -ne 0) { throw 'Active visualizer syntax failed.' }

    Write-Host ''
    Write-Host 'PASS - GV-TRUST-685B portable frontend validation.'
    Write-Host 'Validated: 685B 12/12; 681A-R1 7/7; 680B-R1 inherited; syntax PASS.'
}
finally {
    Pop-Location
}
