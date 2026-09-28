param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668L Current-500 completion activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668L") {
    throw "Expected GV-CITY-668L but received '$($summary.version)'. Deploy the 668L backend first."
}
if (-not $summary.enabled) {
    throw "668L is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668L=true."
}
if ($summary.summary.auditedCount -ne 545) { throw "Expected 545 audited cities but received $($summary.summary.auditedCount)." }
if ($summary.summary.productionActiveCount -ne 322) { throw "Expected 322 production-active cities but received $($summary.summary.productionActiveCount)." }
if ($summary.summary.auditedInactiveCount -ne 223) { throw "Expected 223 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)." }
if ($summary.summary.unauditedCount -ne 455) { throw "Expected 455 unaudited cities but received $($summary.summary.unauditedCount)." }
if ($summary.summary.estimateOnlyCount -ne 678) { throw "Expected 678 estimate-only cities but received $($summary.summary.estimateOnlyCount)." }
if ($summary.summary.directOrMetroCount -ne 295) { throw "Expected 295 direct/metro active cities but received $($summary.summary.directOrMetroCount)." }
if ($summary.summary.gatewaySupportedCount -ne 27) { throw "Expected 27 gateway-supported active cities but received $($summary.summary.gatewaySupportedCount)." }
if ($summary.summary.current500.audited -ne 500) { throw "Expected the Current-500 audit to be complete at 500/500." }
if ($summary.summary.current500.productionActive -ne 309) { throw "Expected 309 active Current-500 cities but received $($summary.summary.current500.productionActive)." }

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$current500 = Get-GvJson "/api/verified-city-activation?tier=current-500&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$sapporo = Get-GvJson "/api/verified-city-activation?q=Sapporo&includeEvidence=true&limit=1"
$kyoto = Get-GvJson "/api/verified-city-activation?q=Kyoto&includeEvidence=true&limit=1"
$brighton = Get-GvJson "/api/verified-city-activation?q=Brighton&includeEvidence=true&limit=1"
$kuantan = Get-GvJson "/api/verified-city-activation?q=Kuantan&limit=1"
$chefchaouen = Get-GvJson "/api/verified-city-activation?q=Chefchaouen&limit=1"
$moscow = Get-GvJson "/api/verified-city-activation?q=Moscow&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"
$completion = Get-GvJson "/api/current-500-completion-audit"

if ($active.totalMatches -ne 322) { throw "Active search returned $($active.totalMatches), expected 322." }
if ($review.totalMatches -ne 223) { throw "Review search returned $($review.totalMatches), expected 223." }
if ($current500.totalMatches -ne 500) { throw "Current-500 search returned $($current500.totalMatches), expected 500." }
if ($registryLive.totalMatches -ne 322) { throw "City registry live filter returned $($registryLive.totalMatches), expected 322." }
if (-not $sapporo.records[0].liveRecommendationEligible) { throw "Sapporo should be newly verified active." }
if ($sapporo.records[0].evidence.travelpayouts.destinationCode -ne "SPK") { throw "Sapporo should retain SPK flight evidence." }
if (-not $kyoto.records[0].liveRecommendationEligible) { throw "Kyoto should be newly verified active." }
if ($kyoto.records[0].activation.mode -ne "gateway-supported") { throw "Kyoto should be gateway-supported." }
if ($kyoto.records[0].evidence.travelpayouts.gateway.airportCode -ne "KIX") { throw "Kyoto should retain KIX gateway evidence." }
if (-not $brighton.records[0].liveRecommendationEligible) { throw "Brighton should be newly verified active." }
if ($brighton.records[0].evidence.travelpayouts.gateway.airportCode -ne "LHR") { throw "Brighton should retain LHR gateway evidence." }
if ($kuantan.records[0].liveRecommendationEligible) { throw "Kuantan should remain estimate-only after missing flight observations." }
if ($chefchaouen.records[0].liveRecommendationEligible) { throw "Chefchaouen should remain estimate-only after flight-comfort failure." }
if ($moscow.records[0].auditStatus -ne "unaudited") { throw "Moscow should remain unaudited in the expansion cohort." }
if ($retry.queues.'missing-flight-observations'.count -ne 189) { throw "Expected 189 missing-flight retry items." }
if ($retry.queues.'unresolved-agoda-mapping'.count -ne 25) { throw "Expected 25 unresolved-Agoda retry items." }
if ($retry.queues.'hotel-quality-failure'.count -ne 7) { throw "Expected 7 hotel-quality retry items." }
if ($retry.queues.'flight-comfort-failure'.count -ne 27) { throw "Expected 27 flight-comfort retry items." }
if ($completion.version -ne "GV-CITY-668K") { throw "The 668K completion plan endpoint was not preserved." }

Write-Host "Version: $($summary.version)"
Write-Host "Audited: $($summary.summary.auditedCount)"
Write-Host "Current-500 audited: $($summary.summary.current500.audited)/500"
Write-Host "Production-active: $($summary.summary.productionActiveCount)"
Write-Host "Current-500 active: $($summary.summary.current500.productionActive)"
Write-Host "Reviewed inactive: $($summary.summary.auditedInactiveCount)"
Write-Host "Unaudited expansion cities: $($summary.summary.unauditedCount)"
Write-Host "Estimate-only total: $($summary.summary.estimateOnlyCount)"
Write-Host "Direct/metro active: $($summary.summary.directOrMetroCount)"
Write-Host "Gateway-supported active: $($summary.summary.gatewaySupportedCount)"
Write-Host "Missing-flight retry queue: $($retry.queues.'missing-flight-observations'.count)"
Write-Host "Unresolved-Agoda retry queue: $($retry.queues.'unresolved-agoda-mapping'.count)"
Write-Host "Hotel-quality retry queue: $($retry.queues.'hotel-quality-failure'.count)"
Write-Host "Flight-comfort retry queue: $($retry.queues.'flight-comfort-failure'.count)"
Write-Host "`nGV-CITY-668L smoke test passed."
