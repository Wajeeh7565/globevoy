param(
  [Parameter(Mandatory=$true)]
  [string]$BaseUrl
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
Write-Host "=== GV-PROD-673D deployed frontend smoke ==="

$booking = Invoke-WebRequest -UseBasicParsing "$BaseUrl/booking.html?cb=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
if ($booking.StatusCode -ne 200) { throw "booking.html returned $($booking.StatusCode)" }
if ($booking.Content -notmatch 'GV-PROD-673D') { throw 'GV-PROD-673D release marker is missing.' }
if ($booking.Content -notmatch 'booking-live-673d\.js') { throw 'The 673D booking script is not active.' }
if ($booking.Content -match 'kiwi-multicity') { throw 'A Kiwi multi-city script is still active.' }
if ($booking.Content -notmatch 'Book each flight separately') { throw 'Honest main action is missing.' }
if ($booking.Content -notmatch 'Copy route and dates') { throw 'Copy route and dates is missing.' }
if ($booking.Content -match 'Try all .*Kiwi|Try full route on Kiwi') { throw 'A failed Kiwi beta button remains active.' }

$script = Invoke-WebRequest -UseBasicParsing "$BaseUrl/scripts/booking-live-673d.js?cb=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
if ($script.StatusCode -ne 200) { throw "booking-live-673d.js returned $($script.StatusCode)" }
if ($script.Content -match 'Kiwi|\bbeta\b') { throw 'Active 673D script still contains Kiwi beta behaviour.' }
if ($script.Content -notmatch 'Compare this flight') { throw 'Separate flight comparison action is missing.' }
if ($script.Content -notmatch 'Compare this stay') { throw 'Separate hotel comparison action is missing.' }
if ($script.Content -notmatch 'No combined payment') { throw 'Honest no-combined-payment text is missing.' }

Write-Host 'GV-PROD-673D deployment smoke passed.'
Write-Host 'Complete the manual browser checklist for route rendering, copy, links, profile, currency, photos and mobile.'
