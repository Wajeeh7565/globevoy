param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668T merged 439-city activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668T") {
    throw "Expected GV-CITY-668T but received '$($summary.version)'. Deploy the 668T backend and enable its flag first."
}
if (-not $summary.enabled) {
    throw "668T is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668T=true."
}
if ($summary.summary.auditedCount -ne 1000) { throw "Expected 1,000 audited cities but received $($summary.summary.auditedCount)." }
if ($summary.summary.productionActiveCount -ne 439) { throw "Expected 439 production-active cities but received $($summary.summary.productionActiveCount)." }
if ($summary.summary.auditedInactiveCount -ne 561) { throw "Expected 561 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)." }
if ($summary.summary.unauditedCount -ne 0) { throw "Expected zero unaudited cities but received $($summary.summary.unauditedCount)." }
if ($summary.summary.estimateOnlyCount -ne 561) { throw "Expected 561 estimate-only cities but received $($summary.summary.estimateOnlyCount)." }
if ($summary.summary.directOrMetroCount -ne 412) { throw "Expected 412 direct/metro active cities but received $($summary.summary.directOrMetroCount)." }
if ($summary.summary.gatewaySupportedCount -ne 27) { throw "Expected 27 gateway-supported active cities but received $($summary.summary.gatewaySupportedCount)." }
if ($summary.summary.current500.audited -ne 500) { throw "Expected the Current-500 audit to remain complete at 500/500." }
if ($summary.summary.current500.productionActive -ne 318) { throw "Expected 318 active Current-500 cities." }
if ($summary.summary.expansion500.audited -ne 500) { throw "Expected the Expansion-500 audit to remain complete at 500/500." }
if ($summary.summary.expansion500.productionActive -ne 121) { throw "Expected 121 active Expansion-500 cities." }
if ($summary.summary.recoveredActiveCount -ne 18) { throw "Expected 18 recovered active cities." }

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$unaudited = Get-GvJson "/api/verified-city-activation?status=unaudited&limit=100"
$expansion = Get-GvJson "/api/verified-city-activation?tier=expansion-500&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$honolulu = Get-GvJson "/api/verified-city-activation?q=Honolulu&includeEvidence=true&limit=1"
$luxor = Get-GvJson "/api/verified-city-activation?q=Luxor&includeEvidence=true&limit=1"
$cusco = Get-GvJson "/api/verified-city-activation?q=Cusco&limit=1"
$brasilia = Get-GvJson "/api/verified-city-activation?q=Brasilia&limit=1"
$recife = Get-GvJson "/api/verified-city-activation?q=Recife&limit=1"
$taormina = Get-GvJson "/api/verified-city-activation?q=Taormina&limit=1"
$eindhoven = Get-GvJson "/api/verified-city-activation?q=Eindhoven&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"
$recoveryPlan = Get-GvJson "/api/inactive-city-recovery-wave1"

if ($active.totalMatches -ne 439) { throw "Active search returned $($active.totalMatches), expected 439." }
if ($review.totalMatches -ne 561) { throw "Review search returned $($review.totalMatches), expected 561." }
if ($unaudited.totalMatches -ne 0) { throw "Unaudited search returned $($unaudited.totalMatches), expected 0." }
if ($expansion.totalMatches -ne 500) { throw "Expansion-500 search returned $($expansion.totalMatches), expected 500." }
if ($registryLive.totalMatches -ne 439) { throw "City registry live filter returned $($registryLive.totalMatches), expected 439." }
if (-not $honolulu.records[0].liveRecommendationEligible) { throw "Honolulu should be recovered active." }
if ($honolulu.records[0].evidence.travelpayouts.destinationCode -ne "HNL") { throw "Honolulu should retain HNL flight evidence." }
if (-not $luxor.records[0].liveRecommendationEligible) { throw "Luxor should be recovered active." }
if ($luxor.records[0].evidence.travelpayouts.destinationCode -ne "LXR") { throw "Luxor should retain LXR flight evidence." }
if (-not $cusco.records[0].liveRecommendationEligible) { throw "Cusco should be recovered active." }
if ($brasilia.records[0].liveRecommendationEligible) { throw "Brasilia should remain estimate-only under the unchanged comfort limits." }
if ($recife.records[0].liveRecommendationEligible) { throw "Recife should remain estimate-only under the unchanged comfort limits." }
if ($taormina.records[0].liveRecommendationEligible) { throw "Taormina should remain estimate-only." }
if (-not $eindhoven.records[0].liveRecommendationEligible) { throw "Eindhoven should remain active from 668Q." }
if ($retry.queues.'missing-flight-observations'.count -ne 423) { throw "Expected 423 missing-flight retry items." }
if ($retry.queues.'unresolved-agoda-mapping'.count -ne 130) { throw "Expected 130 unresolved-Agoda retry items." }
if ($retry.queues.'no-live-hotel-rate'.count -ne 51) { throw "Expected 51 no-live-hotel-rate retry items." }
if ($retry.queues.'hotel-quality-failure'.count -ne 50) { throw "Expected 50 hotel-quality retry items." }
if ($retry.queues.'flight-comfort-failure'.count -ne 54) { throw "Expected 54 flight-comfort retry items." }
if ($recoveryPlan.version -ne "GV-CITY-668S") { throw "The 668S recovery-plan endpoint was not preserved." }

Write-Host "Version: $($summary.version)"
Write-Host "Audited: $($summary.summary.auditedCount)/1000"
Write-Host "Production-active: $($summary.summary.productionActiveCount)"
Write-Host "Recovered active in Wave 1: $($summary.summary.recoveredActiveCount)"
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
Write-Host "`nGV-CITY-668T smoke test passed."
