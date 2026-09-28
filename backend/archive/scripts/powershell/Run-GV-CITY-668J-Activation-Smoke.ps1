param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668J merged activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668J") {
    throw "Expected GV-CITY-668J but received '$($summary.version)'. Deploy the 668J backend first."
}
if (-not $summary.enabled) {
    throw "668J is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668J=true."
}
if ($summary.summary.auditedCount -ne 400) { throw "Expected 400 audited cities but received $($summary.summary.auditedCount)." }
if ($summary.summary.productionActiveCount -ne 259) { throw "Expected 259 production-active cities but received $($summary.summary.productionActiveCount)." }
if ($summary.summary.auditedInactiveCount -ne 141) { throw "Expected 141 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)." }
if ($summary.summary.unauditedCount -ne 600) { throw "Expected 600 unaudited cities but received $($summary.summary.unauditedCount)." }
if ($summary.summary.estimateOnlyCount -ne 741) { throw "Expected 741 estimate-only cities but received $($summary.summary.estimateOnlyCount)." }
if ($summary.summary.directOrMetroCount -ne 250) { throw "Expected 250 direct/metro active cities but received $($summary.summary.directOrMetroCount)." }
if ($summary.summary.gatewaySupportedCount -ne 9) { throw "Expected 9 gateway-supported active cities but received $($summary.summary.gatewaySupportedCount)." }

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$toronto = Get-GvJson "/api/verified-city-activation?q=Toronto&limit=1"
$philadelphia = Get-GvJson "/api/verified-city-activation?q=Philadelphia&includeEvidence=true&limit=1"
$hoiAn = Get-GvJson "/api/verified-city-activation?q=Hoi%20An&includeEvidence=true&limit=1"
$puertoVallarta = Get-GvJson "/api/verified-city-activation?q=Puerto%20Vallarta&limit=1"
$durban = Get-GvJson "/api/verified-city-activation?q=Durban&limit=1"
$brighton = Get-GvJson "/api/verified-city-activation?q=Brighton&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"

if ($active.totalMatches -ne 259) { throw "Active search returned $($active.totalMatches), expected 259." }
if ($review.totalMatches -ne 141) { throw "Review search returned $($review.totalMatches), expected 141." }
if ($registryLive.totalMatches -ne 259) { throw "City registry live filter returned $($registryLive.totalMatches), expected 259." }
if (-not $toronto.records[0].liveRecommendationEligible) { throw "Toronto should remain verified active." }
if (-not $philadelphia.records[0].liveRecommendationEligible) { throw "Philadelphia should be newly verified active." }
if ($philadelphia.records[0].evidence.travelpayouts.destinationCode -ne "PHL") { throw "Philadelphia should retain PHL flight evidence." }
if (-not $hoiAn.records[0].liveRecommendationEligible) { throw "Hoi An should be verified active." }
if ($hoiAn.records[0].activation.mode -ne "gateway-supported") { throw "Hoi An should be gateway-supported." }
if ($hoiAn.records[0].evidence.travelpayouts.gateway.airportCode -ne "DAD") { throw "Hoi An should retain DAD gateway evidence." }
if ($puertoVallarta.records[0].liveRecommendationEligible) { throw "Puerto Vallarta should remain estimate-only after missing flight observations." }
if ($durban.records[0].liveRecommendationEligible) { throw "Durban should remain estimate-only after its flight-comfort failure." }
if ($brighton.records[0].auditStatus -ne "unaudited") { throw "Brighton should remain unaudited in the 400-city snapshot." }
if ($retry.queues.'missing-flight-observations'.count -ne 112) { throw "Expected 112 missing-flight retry items." }
if ($retry.queues.'unresolved-agoda-mapping'.count -ne 25) { throw "Expected 25 unresolved-Agoda retry items." }
if ($retry.queues.'flight-comfort-failure'.count -ne 23) { throw "Expected 23 flight-comfort retry items." }

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
Write-Host "`nGV-CITY-668J smoke test passed."
