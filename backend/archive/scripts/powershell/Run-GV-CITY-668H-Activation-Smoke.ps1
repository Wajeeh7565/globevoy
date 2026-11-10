param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668H merged activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668H") {
    throw "Expected GV-CITY-668H but received '$($summary.version)'. Deploy the 668H backend first."
}
if (-not $summary.enabled) {
    throw "668H is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668H=true."
}
if ($summary.summary.productionActiveCount -ne 176) {
    throw "Expected 176 production-active cities but received $($summary.summary.productionActiveCount)."
}
if ($summary.summary.auditedInactiveCount -ne 74) {
    throw "Expected 74 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)."
}
if ($summary.summary.unauditedCount -ne 750) {
    throw "Expected 750 unaudited cities but received $($summary.summary.unauditedCount)."
}
if ($summary.summary.estimateOnlyCount -ne 824) {
    throw "Expected 824 estimate-only cities but received $($summary.summary.estimateOnlyCount)."
}
if ($summary.summary.directOrMetroCount -ne 170) {
    throw "Expected 170 direct/metro active cities but received $($summary.summary.directOrMetroCount)."
}
if ($summary.summary.gatewaySupportedCount -ne 6) {
    throw "Expected 6 gateway-supported active cities but received $($summary.summary.gatewaySupportedCount)."
}

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$toronto = Get-GvJson "/api/verified-city-activation?q=Toronto&limit=1"
$osaka = Get-GvJson "/api/verified-city-activation?q=Osaka&includeEvidence=true&limit=1"
$kampala = Get-GvJson "/api/verified-city-activation?q=Kampala&includeEvidence=true&limit=1"
$honolulu = Get-GvJson "/api/verified-city-activation?q=Honolulu&limit=1"
$ankara = Get-GvJson "/api/verified-city-activation?q=Ankara&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"

if ($active.totalMatches -ne 176) { throw "Active search returned $($active.totalMatches), expected 176." }
if ($review.totalMatches -ne 74) { throw "Review search returned $($review.totalMatches), expected 74." }
if ($registryLive.totalMatches -ne 176) { throw "City registry live filter returned $($registryLive.totalMatches), expected 176." }
if (-not $toronto.records[0].liveRecommendationEligible) { throw "Toronto should remain verified active." }
if (-not $osaka.records[0].liveRecommendationEligible) { throw "Osaka should be newly verified active." }
if ($osaka.records[0].evidence.travelpayouts.destinationCode -ne "OSA") { throw "Osaka should retain OSA flight evidence." }
if (-not $kampala.records[0].liveRecommendationEligible) { throw "Kampala should be verified active." }
if ($kampala.records[0].activation.mode -ne "gateway-supported") { throw "Kampala should be gateway-supported." }
if ($kampala.records[0].evidence.travelpayouts.gateway.airportCode -ne "EBB") { throw "Kampala should retain EBB gateway evidence." }
if ($honolulu.records[0].liveRecommendationEligible) { throw "Honolulu should remain estimate-only after its flight-comfort failure." }
if ($ankara.records[0].auditStatus -ne "unaudited") { throw "Ankara should remain unaudited in the 250-city snapshot." }
if ($retry.queues.'missing-flight-observations'.count -ne 57) { throw "Expected 57 missing-flight retry items." }
if ($retry.queues.'unresolved-agoda-mapping'.count -ne 25) { throw "Expected 25 unresolved-Agoda retry items." }
if ($retry.queues.'flight-comfort-failure'.count -ne 11) { throw "Expected 11 flight-comfort retry items." }

Write-Host "Version: $($summary.version)"
Write-Host "Audited: $($summary.summary.auditedCount)"
Write-Host "Production-active: $($summary.summary.productionActiveCount)"
Write-Host "Reviewed inactive: $($summary.summary.auditedInactiveCount)"
Write-Host "Unaudited: $($summary.summary.unauditedCount)"
Write-Host "Estimate-only total: $($summary.summary.estimateOnlyCount)"
Write-Host "Direct/metro active: $($summary.summary.directOrMetroCount)"
Write-Host "Gateway-supported active: $($summary.summary.gatewaySupportedCount)"
Write-Host "Missing-flight retry queue: $($retry.queues.'missing-flight-observations'.count)"
Write-Host "Unresolved-Agoda retry queue: $($retry.queues.'unresolved-agoda-mapping'.count)"
Write-Host "Flight-comfort retry queue: $($retry.queues.'flight-comfort-failure'.count)"
Write-Host "`nGV-CITY-668H smoke test passed."
