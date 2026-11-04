param(
  [Parameter(Mandatory=$true)]
  [string]$BaseUrl,
  [ValidateSet('Contract','Sandbox')]
  [string]$Mode = 'Contract'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

Write-Host "=== GV-BOOK-676A-R1 deployed smoke ($Mode mode) ==="


$home = Invoke-WebRequest -UseBasicParsing "$BaseUrl/index.html?cb=$cb"
if ($home.StatusCode -ne 200) { throw "index.html returned $($home.StatusCode)" }
if ($home.Content -notmatch 'GV-BOOK-676A-R1') { throw '676A-R1 origin-search release marker is missing.' }
if ($home.Content -match 'id="gv-origin"[^>]+\slist=') { throw 'The browser-controlled origin datalist is still active.' }
if ($home.Content -notmatch 'id="gv-origin-menu"' -or $home.Content -notmatch 'role="listbox"') { throw 'The scrollable origin listbox is missing.' }
if ($home.Content -notmatch 'home-live-674a\.js\?v=676a-r1') { throw 'The R1 origin-search script is not active.' }
if ($home.Content -notmatch 'live\.css\?v=676a-r1') { throw 'The R1 origin-search stylesheet is not active.' }

$homeScript = Invoke-WebRequest -UseBasicParsing "$BaseUrl/scripts/home-live-674a.js?cb=$cb"
if ($homeScript.StatusCode -ne 200) { throw "home-live-674a.js returned $($homeScript.StatusCode)" }
if ($homeScript.Content -match "createElement\('datalist'\)") { throw 'Native datalist creation remains in the active homepage script.' }
if ($homeScript.Content -notmatch 'scrollIntoView' -or $homeScript.Content -notmatch 'ArrowDown') { throw 'Scrollable keyboard origin navigation is missing.' }

$homeCss = Invoke-WebRequest -UseBasicParsing "$BaseUrl/styles/live.css?cb=$cb"
if ($homeCss.StatusCode -ne 200) { throw "styles/live.css returned $($homeCss.StatusCode)" }
if ($homeCss.Content -notmatch 'gv-origin-menu' -or $homeCss.Content -notmatch 'overflow-y:auto') { throw 'Bounded scroll styling for the origin menu is missing.' }

$booking = Invoke-WebRequest -UseBasicParsing "$BaseUrl/booking.html?cb=$cb"
if ($booking.StatusCode -ne 200) { throw "booking.html returned $($booking.StatusCode)" }
if ($booking.Content -notmatch 'GV-BOOK-676A') { throw 'Booking 676A release marker is missing.' }
if ($booking.Content -notmatch 'DUFFEL SANDBOX PROOF') { throw 'Duffel sandbox proof section is missing.' }
if ($booking.Content -notmatch 'booking-duffel-676a\.js\?v=676a') { throw 'Duffel sandbox browser script is missing.' }
if ($booking.Content -notmatch 'booking-duffel-676a\.css\?v=676a') { throw 'Duffel sandbox stylesheet is missing.' }
if ($booking.Content -notmatch 'No real order, hotel booking, card payment or single atomic') { throw 'Sandbox safety boundary is missing.' }
if ($booking.Content -notmatch 'Book each flight separately') { throw 'Honest production booking action regressed.' }
if ($booking.Content -match 'Try all .*Kiwi|Try full route on Kiwi|kiwi-multicity') { throw 'A failed Kiwi beta action remains active.' }

$duffelScript = Invoke-WebRequest -UseBasicParsing "$BaseUrl/scripts/booking-duffel-676a.js?cb=$cb"
if ($duffelScript.StatusCode -ne 200) { throw "booking-duffel-676a.js returned $($duffelScript.StatusCode)" }
if ($duffelScript.Content -notmatch 'runDuffelSandboxProof') { throw 'Duffel sandbox API action is missing.' }
if ($duffelScript.Content -match 'DUFFEL_ACCESS_TOKEN|api\.duffel\.com') { throw 'Private Duffel configuration leaked into the browser package.' }
if ($duffelScript.Content -notmatch 'Currency match needed') { throw 'Currency mismatch guard is missing.' }

$entryScript = Invoke-WebRequest -UseBasicParsing "$BaseUrl/scripts/booking-entry-675a.js?cb=$cb"
if ($entryScript.StatusCode -ne 200) { throw "booking-entry-675a.js returned $($entryScript.StatusCode)" }
if ($entryScript.Content -notmatch '#gv-duffel-run') { throw 'Entry restriction does not guard the Duffel action.' }

$apiClient = Invoke-WebRequest -UseBasicParsing "$BaseUrl/runtime/api-client.js?cb=$cb"
if ($apiClient.StatusCode -ne 200) { throw "runtime/api-client.js returned $($apiClient.StatusCode)" }
if ($apiClient.Content -notmatch 'getDuffelSandboxStatus' -or $apiClient.Content -notmatch 'runDuffelSandboxProof') { throw 'Duffel API client methods are missing.' }

$config = Invoke-WebRequest -UseBasicParsing "$BaseUrl/runtime/config.js?cb=$cb"
if ($config.Content -notmatch 'frontendVersion:\s*["'']GV-BOOK-676A["'']') { throw 'Frontend configuration version is not GV-BOOK-676A.' }
$apiMatch = [regex]::Match($config.Content, 'apiBaseUrl\s*:\s*["''](?<url>https://[^"'']+)')
if (-not $apiMatch.Success) { throw 'Live API base URL could not be read from runtime/config.js.' }
$apiBase = $apiMatch.Groups['url'].Value.TrimEnd('/')

$activation = Invoke-RestMethod -Method Get -Uri "$apiBase/api/verified-city-activation?cb=$cb" -TimeoutSec 60
if (-not $activation.ok -or -not $activation.enabled) { throw 'Verified city activation is not enabled.' }
if ($activation.version -ne 'GV-CITY-668T') { throw "Unexpected activation version: $($activation.version)" }
if ($activation.summary.auditedCount -ne 1000 -or $activation.summary.productionActiveCount -ne 439 -or $activation.summary.unauditedCount -ne 0) { throw 'City activation baseline changed.' }

$status = Invoke-RestMethod -Method Get -Uri "$apiBase/api/duffel-sandbox-proof?cb=$cb" -TimeoutSec 60
if ($status.version -ne 'GV-BOOK-676A') { throw "Unexpected Duffel proof version: $($status.version)" }
if (-not $status.sandboxOnly) { throw 'Duffel proof is not sandbox-only.' }
if ($status.orderCreationEnabled -or $status.paymentCollectionEnabled) { throw 'Order or payment creation was unexpectedly enabled.' }
if ($status.capabilities.oneAtomicFlightAndHotelTransactionProven) { throw 'Atomic flight-and-hotel transaction was incorrectly claimed.' }

$badPayload = @{ tour = @{ origin = @{ code = 'YYZ' }; cities = @(); legs = @() } } | ConvertTo-Json -Depth 8
try {
  Invoke-RestMethod -Method Post -Uri "$apiBase/api/duffel-sandbox-proof" -ContentType 'application/json' -Body $badPayload -TimeoutSec 60 | Out-Null
  throw 'Invalid Duffel proof route was unexpectedly accepted.'
} catch {
  if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -ne 400) { throw }
}

if ($Mode -eq 'Sandbox') {
  if (-not $status.enabled) { throw 'ENABLE_DUFFEL_SANDBOX_676A is not true.' }
  if (-not $status.configured -or $status.mode -ne 'test') { throw 'A server-side Duffel test token beginning with duffel_test_ is required.' }

  $start = (Get-Date).ToUniversalTime().Date.AddDays(70)
  $d1 = $start.ToString('yyyy-MM-dd')
  $d2 = $start.AddDays(4).ToString('yyyy-MM-dd')
  $d3 = $start.AddDays(8).ToString('yyyy-MM-dd')
  $payload = @{
    tour = @{
      origin = @{ city = 'London'; countryCode = 'GB'; code = 'LHR' }
      cities = @(
        @{ city = 'New York'; countryCode = 'US'; code = 'JFK'; hotel = @{ estimatedDisplayTotal = 500 } },
        @{ city = 'Los Angeles'; countryCode = 'US'; code = 'LAX'; hotel = @{ estimatedDisplayTotal = 600 } }
      )
      legs = @(
        @{ from = @{ city = 'London'; code = 'LHR' }; to = @{ city = 'New York'; code = 'JFK' }; departureDate = $d1 },
        @{ from = @{ city = 'New York'; code = 'JFK' }; to = @{ city = 'Los Angeles'; code = 'LAX' }; departureDate = $d2 },
        @{ from = @{ city = 'Los Angeles'; code = 'LAX' }; to = @{ city = 'London'; code = 'LHR' }; departureDate = $d3 }
      )
      budget = @{ total = @{ currency = 'GBP' } }
    }
    travellers = 1
    rooms = 1
    currency = 'GBP'
    hotelSubtotal = 1100
    transferSubtotal = 0
    maxConnections = 1
  }
  Write-Host 'Running live Duffel test-mode multi-city search...'
  $proof = Invoke-RestMethod -Method Post -Uri "$apiBase/api/duffel-sandbox-proof" -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 15) -TimeoutSec 120
  if (-not $proof.providerRequestMade) { throw "Duffel provider request was not made. Reason: $($proof.reason)" }
  if ($proof.liveMode) { throw 'Duffel response unexpectedly used live mode.' }
  if ($proof.requestSummary.sliceCount -ne 3) { throw "Expected 3 slices, received $($proof.requestSummary.sliceCount)." }
  if (@($proof.offers).Count -lt 1 -or -not $proof.selectedOffer) { throw 'Duffel test mode returned no complete three-slice offer. Retry with later dates or check the Duffel sandbox.' }
  if ($proof.selectedOffer.sliceCount -ne 3) { throw 'Selected offer does not contain every route slice.' }
  if ($proof.bookingArchitecture.oneAtomicTransactionProven) { throw 'Proof incorrectly claims one atomic transaction.' }
  Write-Host "Duffel test offer returned: $($proof.selectedOffer.owner.name) $($proof.selectedOffer.totalCurrency) $($proof.selectedOffer.totalAmount)"
}

Write-Host 'GV-BOOK-676A-R1 deployment smoke passed.'
if ($Mode -eq 'Contract') {
  Write-Host 'Run again with -Mode Sandbox after adding the Duffel test token to prove a real test-mode multi-city offer.'
} else {
  Write-Host 'Complete the manual browser checklist before recording the release as verified production.'
}
