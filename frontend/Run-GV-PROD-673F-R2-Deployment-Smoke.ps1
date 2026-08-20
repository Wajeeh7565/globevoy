param(
  [Parameter(Mandatory=$true)]
  [string]$BaseUrl
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Write-Host "=== GV-PROD-673F-R2 deployed smoke ==="

$index = Invoke-WebRequest -UseBasicParsing "$BaseUrl/index.html?cb=$cb"
if ($index.StatusCode -ne 200) { throw "index.html returned $($index.StatusCode)" }
if ($index.Content -notmatch 'GV-PROD-673F-R2') { throw 'Homepage release marker is missing.' }
if ($index.Content -notmatch 'favicon-64\.png\?v=673f-r2') { throw 'Current favicon cache version is missing.' }

$booking = Invoke-WebRequest -UseBasicParsing "$BaseUrl/booking.html?cb=$cb"
if ($booking.StatusCode -ne 200) { throw "booking.html returned $($booking.StatusCode)" }
if ($booking.Content -notmatch 'GV-PROD-673F-R2') { throw 'Booking release marker is missing.' }
if ($booking.Content -notmatch 'Book each flight separately') { throw 'Honest primary action is missing.' }
if ($booking.Content -match 'View every flight and hotel') { throw 'The broad 673F primary action still appears.' }
if ($booking.Content -match 'Try all .*Kiwi|Try full route on Kiwi|kiwi-multicity') { throw 'A failed Kiwi beta action remains active.' }
if ($booking.Content -notmatch 'Copy route and dates') { throw 'Copy route and dates is missing.' }

$bookingScript = Invoke-WebRequest -UseBasicParsing "$BaseUrl/scripts/booking-live-673d.js?cb=$cb"
if ($bookingScript.StatusCode -ne 200) { throw "booking-live-673d.js returned $($bookingScript.StatusCode)" }
if ($bookingScript.Content -notmatch 'GV-BOOK-673F-R2') { throw 'Current booking script version is missing.' }
if ($bookingScript.Content -notmatch 'No combined payment') { throw 'Honest separate-checkout copy is missing.' }
if ($bookingScript.Content -notmatch 'async function restoreTour') { throw 'Shared route restoration code is missing.' }

$visualizer = Invoke-WebRequest -UseBasicParsing "$BaseUrl/multicity-visualizer.html?cb=$cb"
if ($visualizer.StatusCode -ne 200) { throw "multicity-visualizer.html returned $($visualizer.StatusCode)" }
if ($visualizer.Content -notmatch 'GV-PROD-673F-R2') { throw 'Visualizer release marker is missing.' }

$visualizerScript = Invoke-WebRequest -UseBasicParsing "$BaseUrl/scripts/multicity-visualizer-673c.js?cb=$cb"
if ($visualizerScript.Content -notmatch 'cards\.forEach\(\(card,index\)=>') { throw 'Immediate all-card photo hydration is missing.' }
if ($visualizerScript.Content -notmatch 'resolveCard\(card,index\)') { throw 'Every itinerary card is not being resolved immediately.' }
if ($visualizerScript.Content -match 'IntersectionObserver') { throw 'The broken deferred route-card photo observer is still active.' }

$cityImages = Invoke-WebRequest -UseBasicParsing "$BaseUrl/scripts/city-images-673c.js?cb=$cb"
if ($cityImages.Content -notmatch 'gv-city-images-v12-673f-r2') { throw 'R2 city-image cache is missing.' }
if ($cityImages.Content -notmatch 'gv-city-images-v10-673f') { throw 'Legacy Codex photo-cache reuse is missing.' }

$origins = Invoke-WebRequest -UseBasicParsing "$BaseUrl/runtime/supported-origins.js?cb=$cb"
if ($origins.StatusCode -ne 200) { throw "supported-origins.js returned $($origins.StatusCode)" }
if ($origins.Content -notmatch 'GV-ORIGIN-673F-R2') { throw 'Origin integrity catalogue is missing.' }
if ($origins.Content -match '"city":"Georgetown","countryCode":"CA".*"airportCode":"AUS"') { throw 'Unsafe Georgetown Canada to AUS mapping remains.' }
if ($origins.Content -match '"city":"Zwara".*"airportCode":"YAY"') { throw 'Unsafe Zwara to YAY mapping remains.' }

$config = Invoke-WebRequest -UseBasicParsing "$BaseUrl/runtime/config.js?cb=$cb"
$apiMatch = [regex]::Match($config.Content, 'apiBaseUrl\s*:\s*["''](?<url>https://[^"'']+)')
if (-not $apiMatch.Success) { throw 'Live API base URL could not be read from runtime/config.js.' }
$apiBase = $apiMatch.Groups['url'].Value.TrimEnd('/')
$activation = Invoke-RestMethod -Method Get -Uri "$apiBase/api/verified-city-activation?cb=$cb"
if (-not $activation.ok -or -not $activation.enabled) { throw 'Verified city activation endpoint is not enabled.' }
if ($activation.version -ne 'GV-CITY-668T') { throw "Unexpected activation version: $($activation.version)" }
if ($activation.summary.auditedCount -ne 1000) { throw "Unexpected audited city count: $($activation.summary.auditedCount)" }
if ($activation.summary.productionActiveCount -ne 439) { throw "Unexpected production-active count: $($activation.summary.productionActiveCount)" }
if ($activation.summary.unauditedCount -ne 0) { throw "Unexpected unaudited count: $($activation.summary.unauditedCount)" }

Write-Host 'GV-PROD-673F-R2 deployment smoke passed.'
Write-Host 'Complete the manual browser checklist before recording the release as verified production.'
