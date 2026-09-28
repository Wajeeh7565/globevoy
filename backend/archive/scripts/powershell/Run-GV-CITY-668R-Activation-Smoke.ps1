param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668R complete 1,000-city activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668R") {
    throw "Expected GV-CITY-668R but received '$($summary.version)'. Deploy the 668R backend and enable its flag first."
}
if (-not $summary.enabled) {
    throw "668R is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668R=true."
}
if ($summary.summary.auditedCount -ne 1000) { throw "Expected 1,000 audited cities but received $($summary.summary.auditedCount)." }
if ($summary.summary.productionActiveCount -ne 421) { throw "Expected 421 production-active cities but received $($summary.summary.productionActiveCount)." }
if ($summary.summary.auditedInactiveCount -ne 579) { throw "Expected 579 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)." }
if ($summary.summary.unauditedCount -ne 0) { throw "Expected zero unaudited cities but received $($summary.summary.unauditedCount)." }
if ($summary.summary.estimateOnlyCount -ne 579) { throw "Expected 579 estimate-only cities but received $($summary.summary.estimateOnlyCount)." }
if ($summary.summary.directOrMetroCount -ne 394) { throw "Expected 394 direct/metro active cities but received $($summary.summary.directOrMetroCount)." }
if ($summary.summary.gatewaySupportedCount -ne 27) { throw "Expected 27 gateway-supported active cities but received $($summary.summary.gatewaySupportedCount)." }
if ($summary.summary.current500.audited -ne 500) { throw "Expected the Current-500 audit to remain complete at 500/500." }
if ($summary.summary.current500.productionActive -ne 309) { throw "Expected 309 active Current-500 cities." }
if ($summary.summary.expansion500.audited -ne 500) { throw "Expected the Expansion-500 audit to be complete at 500/500." }
if ($summary.summary.expansion500.productionActive -ne 112) { throw "Expected 112 active Expansion-500 cities." }

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$unaudited = Get-GvJson "/api/verified-city-activation?status=unaudited&limit=100"
$expansion = Get-GvJson "/api/verified-city-activation?tier=expansion-500&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$eindhoven = Get-GvJson "/api/verified-city-activation?q=Eindhoven&includeEvidence=true&limit=1"
$hargeisa = Get-GvJson "/api/verified-city-activation?q=Hargeisa&limit=1"
$ivalo = Get-GvJson "/api/verified-city-activation?q=Ivalo&limit=1"
$guernsey = Get-GvJson "/api/verified-city-activation?q=Guernsey&limit=1"
$moscow = Get-GvJson "/api/verified-city-activation?q=Moscow&limit=1"
$hatYai = Get-GvJson "/api/verified-city-activation?q=Hat%20Yai&limit=1"
$baku = Get-GvJson "/api/verified-city-activation?q=Baku&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"
$wave1 = Get-GvJson "/api/expansion-500-priority-audit"
$wave2 = Get-GvJson "/api/expansion-500-priority-audit-wave2"
$finalPlan = Get-GvJson "/api/expansion-500-final-audit"

if ($active.totalMatches -ne 421) { throw "Active search returned $($active.totalMatches), expected 421." }
if ($review.totalMatches -ne 579) { throw "Review search returned $($review.totalMatches), expected 579." }
if ($unaudited.totalMatches -ne 0) { throw "Unaudited search returned $($unaudited.totalMatches), expected 0." }
if ($expansion.totalMatches -ne 500) { throw "Expansion-500 search returned $($expansion.totalMatches), expected 500." }
if ($registryLive.totalMatches -ne 421) { throw "City registry live filter returned $($registryLive.totalMatches), expected 421." }
if (-not $eindhoven.records[0].liveRecommendationEligible) { throw "Eindhoven should be newly verified active." }
if ($eindhoven.records[0].evidence.travelpayouts.destinationCode -ne "EIN") { throw "Eindhoven should retain EIN flight evidence." }
if ($hargeisa.records[0].liveRecommendationEligible) { throw "Hargeisa should remain estimate-only after hotel-quality failure." }
if ($ivalo.records[0].liveRecommendationEligible) { throw "Ivalo should remain estimate-only after flight-comfort failure." }
if ($guernsey.records[0].liveRecommendationEligible) { throw "Guernsey should remain estimate-only after hotel-quality failure." }
if ($moscow.records[0].auditStatus -ne "reviewed-inactive") { throw "Moscow should now be audited and reviewed inactive." }
if (-not $hatYai.records[0].liveRecommendationEligible) { throw "Hat Yai should remain active from Wave 2." }
if (-not $baku.records[0].liveRecommendationEligible) { throw "Baku should remain active from Wave 1." }
if ($retry.queues.'missing-flight-observations'.count -ne 463) { throw "Expected 463 missing-flight retry items." }
if ($retry.queues.'unresolved-agoda-mapping'.count -ne 130) { throw "Expected 130 unresolved-Agoda retry items." }
if ($retry.queues.'no-live-hotel-rate'.count -ne 50) { throw "Expected 50 no-live-hotel-rate retry items." }
if ($retry.queues.'hotel-quality-failure'.count -ne 52) { throw "Expected 52 hotel-quality retry items." }
if ($retry.queues.'flight-comfort-failure'.count -ne 66) { throw "Expected 66 flight-comfort retry items." }
if ($wave1.version -ne "GV-CITY-668M") { throw "The 668M Wave 1 endpoint was not preserved." }
if ($wave2.version -ne "GV-CITY-668O") { throw "The 668O Wave 2 endpoint was not preserved." }
if ($finalPlan.version -ne "GV-CITY-668Q") { throw "The 668Q Final155 endpoint was not preserved." }

Write-Host "Version: $($summary.version)"
Write-Host "Audited: $($summary.summary.auditedCount)/1000"
Write-Host "Production-active: $($summary.summary.productionActiveCount)"
Write-Host "Reviewed inactive: $($summary.summary.auditedInactiveCount)"
Write-Host "Unaudited: $($summary.summary.unauditedCount)"
Write-Host "Estimate-only total: $($summary.summary.estimateOnlyCount)"
Write-Host "Current-500 audited: $($summary.summary.current500.audited)/500"
Write-Host "Current-500 active: $($summary.summary.current500.productionActive)"
Write-Host "Expansion-500 audited: $($summary.summary.expansion500.audited)/500"
Write-Host "Expansion-500 active: $($summary.summary.expansion500.productionActive)"
Write-Host "Direct/metro active: $($summary.summary.directOrMetroCount)"
Write-Host "Gateway-supported active: $($summary.summary.gatewaySupportedCount)"
Write-Host "Missing-flight retry queue: $($retry.queues.'missing-flight-observations'.count)"
Write-Host "Unresolved-Agoda retry queue: $($retry.queues.'unresolved-agoda-mapping'.count)"
Write-Host "No-live-hotel-rate retry queue: $($retry.queues.'no-live-hotel-rate'.count)"
Write-Host "Hotel-quality retry queue: $($retry.queues.'hotel-quality-failure'.count)"
Write-Host "Flight-comfort retry queue: $($retry.queues.'flight-comfort-failure'.count)"
Write-Host "`nGV-CITY-668R smoke test passed."
