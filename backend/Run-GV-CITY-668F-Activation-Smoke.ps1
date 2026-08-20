param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668F activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668F") {
    throw "Expected GV-CITY-668F but received '$($summary.version)'. Deploy the 668F backend first."
}
if (-not $summary.enabled) {
    throw "668F is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668F=true."
}
if ($summary.summary.productionActiveCount -ne 56) {
    throw "Expected 56 production-active cities but received $($summary.summary.productionActiveCount)."
}
if ($summary.summary.auditedInactiveCount -ne 44) {
    throw "Expected 44 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)."
}

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$toronto = Get-GvJson "/api/verified-city-activation?q=Toronto&includeEvidence=true&limit=1"
$tehran = Get-GvJson "/api/verified-city-activation?q=Tehran&limit=1"
$ankara = Get-GvJson "/api/verified-city-activation?q=Ankara&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"

if ($active.totalMatches -ne 56) { throw "Active search returned $($active.totalMatches), expected 56." }
if ($review.totalMatches -ne 44) { throw "Review search returned $($review.totalMatches), expected 44." }
if ($registryLive.totalMatches -ne 56) { throw "City registry live filter returned $($registryLive.totalMatches), expected 56." }
if (-not $toronto.records[0].liveRecommendationEligible) { throw "Toronto should be verified active." }
if ($tehran.records[0].liveRecommendationEligible) { throw "Tehran should remain estimate-only." }
if ($ankara.records[0].auditStatus -ne "unaudited") { throw "Ankara should be unaudited in the Pilot100 snapshot." }

Write-Host "Version: $($summary.version)"
Write-Host "Production-active: $($summary.summary.productionActiveCount)"
Write-Host "Reviewed inactive: $($summary.summary.auditedInactiveCount)"
Write-Host "Unaudited: $($summary.summary.unauditedCount)"
Write-Host "Estimate-only total: $($summary.summary.estimateOnlyCount)"
Write-Host "Direct/metro active: $($summary.summary.directOrMetroCount)"
Write-Host "Gateway-supported active: $($summary.summary.gatewaySupportedCount)"
Write-Host "Missing-flight retry queue: $($retry.queues.'missing-flight-observations'.count)"
Write-Host "Unresolved-Agoda retry queue: $($retry.queues.'unresolved-agoda-mapping'.count)"
Write-Host "`nGV-CITY-668F smoke test passed."
