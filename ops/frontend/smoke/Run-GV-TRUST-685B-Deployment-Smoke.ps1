param(
    [Parameter(Mandatory=$false)]
    [string]$BaseUrl = 'https://globevoy.com'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$BaseUrl = $BaseUrl.TrimEnd('/')
Write-Host '=== GV-TRUST-685B deployed frontend smoke ==='
Write-Host "Base URL: $BaseUrl"

function Get-Text([string]$Url) {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 30
    if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode): $Url" }
    return [string]$r.Content
}

$html = Get-Text "$BaseUrl/multicity-visualizer.html?gv=685b"
if ($html -notmatch 'budget-confidence-685b\.js\?v=685b') { throw '685B confidence asset is not referenced by deployed visualizer.' }
if ($html -notmatch 'multicity-visualizer-674a\.js\?v=685b') { throw 'Active visualizer cache-buster is not 685B.' }
Write-Host '[PASS] multicity visualizer references 685B assets'

$confidence = Get-Text "$BaseUrl/scripts/budget-confidence-685b.js?gv=685b"
if ($confidence -notmatch 'GV-TRUST-685B') { throw '685B confidence module version marker missing.' }
if ($confidence -notmatch 'Planning estimate — verify price') { throw '685B partial evidence label missing.' }
if ($confidence -notmatch 'Price verification required') { throw '685B verification-required label missing.' }
Write-Host '[PASS] evidence-aware confidence module deployed'

$visualizer = Get-Text "$BaseUrl/scripts/multicity-visualizer-674a.js?gv=685b"
if ($visualizer -notmatch 'GV_TRUST_685B_BUDGET_CONFIDENCE') { throw 'Active visualizer is not wired to 685B confidence module.' }
if ($visualizer -match 'Estimated to fit budget') { throw 'Old overconfident label remains in active visualizer.' }
Write-Host '[PASS] active visualizer uses 685B and removes old confidence wording'

Write-Host ''
Write-Host 'PASS - GV-TRUST-685B deployed frontend smoke.'
Write-Host 'Next: manually open one partial-evidence route and confirm the visible badge.'
