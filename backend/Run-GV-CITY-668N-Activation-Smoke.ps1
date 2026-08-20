param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668N merged 393-city activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668N") {
    throw "Expected GV-CITY-668N but received '$($summary.version)'. Deploy the 668N backend and enable its flag first."
}
if (-not $summary.enabled) {
    throw "668N is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668N=true."
}
if ($summary.summary.auditedCount -ne 695) { throw "Expected 695 audited cities but received $($summary.summary.auditedCount)." }
if ($summary.summary.productionActiveCount -ne 393) { throw "Expected 393 production-active cities but received $($summary.summary.productionActiveCount)." }
if ($summary.summary.auditedInactiveCount -ne 302) { throw "Expected 302 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)." }
if ($summary.summary.unauditedCount -ne 305) { throw "Expected 305 unaudited cities but received $($summary.summary.unauditedCount)." }
if ($summary.summary.estimateOnlyCount -ne 607) { throw "Expected 607 estimate-only cities but received $($summary.summary.estimateOnlyCount)." }
if ($summary.summary.directOrMetroCount -ne 366) { throw "Expected 366 direct/metro active cities but received $($summary.summary.directOrMetroCount)." }
if ($summary.summary.gatewaySupportedCount -ne 27) { throw "Expected 27 gateway-supported active cities but received $($summary.summary.gatewaySupportedCount)." }
if ($summary.summary.current500.audited -ne 500) { throw "Expected the Current-500 audit to remain complete at 500/500." }
if ($summary.summary.expansion500.audited -ne 195) { throw "Expected 195 audited Expansion-500 cities." }
if ($summary.summary.expansion500.productionActive -ne 84) { throw "Expected 84 active Expansion-500 cities." }

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$expansion = Get-GvJson "/api/verified-city-activation?tier=expansion-500&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$baku = Get-GvJson "/api/verified-city-activation?q=Baku&includeEvidence=true&limit=1"
$bucharest = Get-GvJson "/api/verified-city-activation?q=Bucharest&includeEvidence=true&limit=1"
$nadi = Get-GvJson "/api/verified-city-activation?q=Nadi&includeEvidence=true&limit=1"
$lagos = Get-GvJson "/api/verified-city-activation?q=Lagos&limit=1"
$kyiv = Get-GvJson "/api/verified-city-activation?q=Kyiv&limit=1"
$moscow = Get-GvJson "/api/verified-city-activation?q=Moscow&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"
$expansionPlan = Get-GvJson "/api/expansion-500-priority-audit"

if ($active.totalMatches -ne 393) { throw "Active search returned $($active.totalMatches), expected 393." }
if ($review.totalMatches -ne 302) { throw "Review search returned $($review.totalMatches), expected 302." }
if ($expansion.totalMatches -ne 500) { throw "Expansion-500 search returned $($expansion.totalMatches), expected 500." }
if ($registryLive.totalMatches -ne 393) { throw "City registry live filter returned $($registryLive.totalMatches), expected 393." }
if (-not $baku.records[0].liveRecommendationEligible) { throw "Baku should be newly verified active." }
if ($baku.records[0].evidence.travelpayouts.destinationCode -ne "BAK") { throw "Baku should retain BAK flight evidence." }
if (-not $bucharest.records[0].liveRecommendationEligible) { throw "Bucharest should be newly verified active." }
if ($bucharest.records[0].evidence.travelpayouts.destinationCode -ne "BUH") { throw "Bucharest should retain BUH flight evidence." }
if (-not $nadi.records[0].liveRecommendationEligible) { throw "Nadi should be newly verified active." }
if ($lagos.records[0].liveRecommendationEligible) { throw "Lagos should remain estimate-only after flight-comfort failure." }
if ($kyiv.records[0].liveRecommendationEligible) { throw "Kyiv should remain estimate-only after missing flight observations." }
if ($moscow.records[0].auditStatus -ne "unaudited") { throw "Moscow should remain unaudited." }
if ($retry.queues.'missing-flight-observations'.count -ne 249) { throw "Expected 249 missing-flight retry items." }
if ($retry.queues.'unresolved-agoda-mapping'.count -ne 25) { throw "Expected 25 unresolved-Agoda retry items." }
if ($retry.queues.'no-live-hotel-rate'.count -ne 8) { throw "Expected 8 no-live-hotel-rate retry items." }
if ($retry.queues.'hotel-quality-failure'.count -ne 17) { throw "Expected 17 hotel-quality retry items." }
if ($retry.queues.'flight-comfort-failure'.count -ne 43) { throw "Expected 43 flight-comfort retry items." }
if ($expansionPlan.version -ne "GV-CITY-668M") { throw "The 668M expansion audit endpoint was not preserved." }

Write-Host "Version: $($summary.version)"
Write-Host "Audited: $($summary.summary.auditedCount)/1000"
Write-Host "Production-active: $($summary.summary.productionActiveCount)"
Write-Host "Reviewed inactive: $($summary.summary.auditedInactiveCount)"
Write-Host "Unaudited: $($summary.summary.unauditedCount)"
Write-Host "Estimate-only total: $($summary.summary.estimateOnlyCount)"
Write-Host "Current-500 audited: $($summary.summary.current500.audited)/500"
Write-Host "Expansion-500 audited: $($summary.summary.expansion500.audited)/500"
Write-Host "Expansion-500 active: $($summary.summary.expansion500.productionActive)"
Write-Host "Direct/metro active: $($summary.summary.directOrMetroCount)"
Write-Host "Gateway-supported active: $($summary.summary.gatewaySupportedCount)"
Write-Host "Missing-flight retry queue: $($retry.queues.'missing-flight-observations'.count)"
Write-Host "Unresolved-Agoda retry queue: $($retry.queues.'unresolved-agoda-mapping'.count)"
Write-Host "No-live-hotel-rate retry queue: $($retry.queues.'no-live-hotel-rate'.count)"
Write-Host "Hotel-quality retry queue: $($retry.queues.'hotel-quality-failure'.count)"
Write-Host "Flight-comfort retry queue: $($retry.queues.'flight-comfort-failure'.count)"
Write-Host "`nGV-CITY-668N smoke test passed."
