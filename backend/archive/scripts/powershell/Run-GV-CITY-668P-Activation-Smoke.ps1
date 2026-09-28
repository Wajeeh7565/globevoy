param(
    [string]$BaseUrl = "https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Get-GvJson([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl$Path" -TimeoutSec 60
}

Write-Host "`n=== Checking GV-CITY-668P merged 420-city activation snapshot ==="
$summary = Get-GvJson "/api/verified-city-activation"

if ($summary.version -ne "GV-CITY-668P") {
    throw "Expected GV-CITY-668P but received '$($summary.version)'. Deploy the 668P backend and enable its flag first."
}
if (-not $summary.enabled) {
    throw "668P is deployed but disabled. Set ENABLE_VERIFIED_CITY_ACTIVATION_668P=true."
}
if ($summary.summary.auditedCount -ne 845) { throw "Expected 845 audited cities but received $($summary.summary.auditedCount)." }
if ($summary.summary.productionActiveCount -ne 420) { throw "Expected 420 production-active cities but received $($summary.summary.productionActiveCount)." }
if ($summary.summary.auditedInactiveCount -ne 425) { throw "Expected 425 reviewed inactive cities but received $($summary.summary.auditedInactiveCount)." }
if ($summary.summary.unauditedCount -ne 155) { throw "Expected 155 unaudited cities but received $($summary.summary.unauditedCount)." }
if ($summary.summary.estimateOnlyCount -ne 580) { throw "Expected 580 estimate-only cities but received $($summary.summary.estimateOnlyCount)." }
if ($summary.summary.directOrMetroCount -ne 393) { throw "Expected 393 direct/metro active cities but received $($summary.summary.directOrMetroCount)." }
if ($summary.summary.gatewaySupportedCount -ne 27) { throw "Expected 27 gateway-supported active cities but received $($summary.summary.gatewaySupportedCount)." }
if ($summary.summary.current500.audited -ne 500) { throw "Expected the Current-500 audit to remain complete at 500/500." }
if ($summary.summary.expansion500.audited -ne 345) { throw "Expected 345 audited Expansion-500 cities." }
if ($summary.summary.expansion500.productionActive -ne 111) { throw "Expected 111 active Expansion-500 cities." }

$active = Get-GvJson "/api/verified-city-activation?status=active&limit=100"
$review = Get-GvJson "/api/verified-city-activation?status=review&limit=100"
$expansion = Get-GvJson "/api/verified-city-activation?tier=expansion-500&limit=100"
$retry = Get-GvJson "/api/verified-city-activation/retry-queues"
$hatYai = Get-GvJson "/api/verified-city-activation?q=Hat%20Yai&includeEvidence=true&limit=1"
$belgrade = Get-GvJson "/api/verified-city-activation?q=Belgrade&includeEvidence=true&limit=1"
$dili = Get-GvJson "/api/verified-city-activation?q=Dili&includeEvidence=true&limit=1"
$kutaisi = Get-GvJson "/api/verified-city-activation?q=Kutaisi&limit=1"
$bhubaneswar = Get-GvJson "/api/verified-city-activation?q=Bhubaneswar&limit=1"
$grodno = Get-GvJson "/api/verified-city-activation?q=Grodno&limit=1"
$baku = Get-GvJson "/api/verified-city-activation?q=Baku&limit=1"
$moscow = Get-GvJson "/api/verified-city-activation?q=Moscow&limit=1"
$registryLive = Get-GvJson "/api/city-registry?live=true&limit=100"
$wave1 = Get-GvJson "/api/expansion-500-priority-audit"
$wave2 = Get-GvJson "/api/expansion-500-priority-audit-wave2"

if ($active.totalMatches -ne 420) { throw "Active search returned $($active.totalMatches), expected 420." }
if ($review.totalMatches -ne 425) { throw "Review search returned $($review.totalMatches), expected 425." }
if ($expansion.totalMatches -ne 500) { throw "Expansion-500 search returned $($expansion.totalMatches), expected 500." }
if ($registryLive.totalMatches -ne 420) { throw "City registry live filter returned $($registryLive.totalMatches), expected 420." }
if (-not $hatYai.records[0].liveRecommendationEligible) { throw "Hat Yai should be newly verified active." }
if ($hatYai.records[0].evidence.travelpayouts.destinationCode -ne "HDY") { throw "Hat Yai should retain HDY flight evidence." }
if (-not $belgrade.records[0].liveRecommendationEligible) { throw "Belgrade should be newly verified active." }
if ($belgrade.records[0].evidence.travelpayouts.destinationCode -ne "BEG") { throw "Belgrade should retain BEG flight evidence." }
if (-not $dili.records[0].liveRecommendationEligible) { throw "Dili should be newly verified active." }
if ($kutaisi.records[0].liveRecommendationEligible) { throw "Kutaisi should remain estimate-only after flight-comfort failure." }
if ($bhubaneswar.records[0].liveRecommendationEligible) { throw "Bhubaneswar should remain estimate-only after missing flight observations." }
if ($grodno.records[0].liveRecommendationEligible) { throw "Grodno should remain estimate-only after a provider error." }
if (-not $baku.records[0].liveRecommendationEligible) { throw "Baku should remain active from Wave 1." }
if ($moscow.records[0].auditStatus -ne "unaudited") { throw "Moscow should remain unaudited." }
if ($retry.queues.'missing-flight-observations'.count -ne 348) { throw "Expected 348 missing-flight retry items." }
if ($retry.queues.'unresolved-agoda-mapping'.count -ne 25) { throw "Expected 25 unresolved-Agoda retry items." }
if ($retry.queues.'no-live-hotel-rate'.count -ne 31) { throw "Expected 31 no-live-hotel-rate retry items." }
if ($retry.queues.'hotel-quality-failure'.count -ne 42) { throw "Expected 42 hotel-quality retry items." }
if ($retry.queues.'flight-comfort-failure'.count -ne 61) { throw "Expected 61 flight-comfort retry items." }
if ($wave1.version -ne "GV-CITY-668M") { throw "The 668M Wave 1 endpoint was not preserved." }
if ($wave2.version -ne "GV-CITY-668O") { throw "The 668O Wave 2 endpoint was not preserved." }

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
Write-Host "`nGV-CITY-668P smoke test passed."
