param(
    [string]$BaseUrl = 'https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')

function Build-Url {
    param([string]$Root, [hashtable]$Parameters)
    $Pairs = New-Object System.Collections.Generic.List[string]
    foreach ($Key in ($Parameters.Keys | Sort-Object)) {
        $Name = [uri]::EscapeDataString([string]$Key)
        $Value = [uri]::EscapeDataString([string]$Parameters[$Key])
        [void]$Pairs.Add($Name + '=' + $Value)
    }
    return $Root + '?' + ($Pairs -join '&')
}

function Invoke-JsonGet {
    param([string]$Uri, [int]$TimeoutSec = 240)
    return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec $TimeoutSec -Headers @{ 'Cache-Control' = 'no-cache'; Accept = 'application/json' }
}

function Get-Tour {
    param($Payload)
    if ($null -ne $Payload.tour) { return $Payload.tour }
    if (@($Payload.tours).Count -gt 0) { return @($Payload.tours)[0] }
    return $null
}

function Invoke-Scenario {
    param([string]$Name, [hashtable]$Parameters)
    Write-Host ''
    Write-Host ('=== ' + $Name + ' ===') -ForegroundColor Cyan
    $Payload = Invoke-JsonGet -Uri (Build-Url ($BaseUrl + '/api/generated-tour') $Parameters) -TimeoutSec 240
    if ($Payload.ok -ne $true) { throw "$Name returned ok=false." }
    if ($Payload.supported -eq $false) { throw "$Name was not supported: $($Payload.reason)" }
    $Tour = Get-Tour $Payload
    if ($null -eq $Tour) { throw "$Name did not return a tour." }
    return [pscustomobject]@{ Payload = $Payload; Tour = $Tour }
}

function Get-LegDate {
    param($Leg)
    foreach ($Candidate in @(
        $Leg.booking.route.departureDate,
        $Leg.cheapestOneWay.departureDate,
        $Leg.automaticTourDate.departureDate,
        $Leg.departureDate
    )) {
        $Text = ([string]$Candidate).Trim()
        if ($Text -match '^\d{4}-\d{2}-\d{2}$') { return $Text }
    }
    return ''
}

function Test-HttpsUrl {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $Parsed = $null
    return [uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$Parsed) -and $Parsed.Scheme -eq 'https'
}

Write-Host '=== Checking GV-PROD-669D exact-date and family-occupancy repairs ===' -ForegroundColor Yellow
$Activation = Invoke-JsonGet -Uri ($BaseUrl + '/api/verified-city-activation') -TimeoutSec 60
if ($Activation.version -ne 'GV-CITY-668T') { throw "Expected activation GV-CITY-668T but received $($Activation.version)." }
if ([int]$Activation.summary.productionActiveCount -ne 439) { throw "Expected 439 active cities but received $($Activation.summary.productionActiveCount)." }
if ([int]$Activation.summary.auditedCount -ne 1000 -or [int]$Activation.summary.unauditedCount -ne 0) { throw 'The 1,000-city audited baseline is not intact.' }
Write-Host 'Activation baseline: GV-CITY-668T, 1000 audited, 439 active.' -ForegroundColor Green

$LosAngeles = Invoke-Scenario 'Los Angeles family room regression' @{
    mode = 'generated-tour'
    recommendationScope = 'generated-multicity-tour'
    origin = 'Los Angeles (LAX)'
    budget = '3600'
    currency = 'USD'
    passengers = '3'
    adults = '2'
    children = '1'
    nights = '9'
    totalNights = '9'
    maxStops = '4'
    dateMode = 'flexible'
    flexible = 'true'
    preferredMonth = '2026-12'
    month = '2026-12'
    adaptiveDuration = 'true'
    generated = 'true'
    variant = '669d-lax-family-smoke'
}

$Rooms = [int]$LosAngeles.Tour.passengerPricing.rooms
$Travellers = [int]$LosAngeles.Tour.passengerPricing.travellers
if ($Travellers -ne 3) { throw "Los Angeles family request returned $Travellers travellers instead of 3." }
if ($Rooms -lt 2) { throw "Los Angeles family request returned only $Rooms room(s)." }
$StayRoomFailures = @($LosAngeles.Tour.stays | Where-Object {
    $RoomCount = [int]$_.hotel.pricingIntegrity.roomCount
    if ($RoomCount -le 0) { $RoomCount = [int]$_.hotel.rooms }
    $RoomCount -lt 2
})
if ($StayRoomFailures.Count -gt 0) { throw ('Los Angeles stay pricing did not apply two rooms for: ' + (($StayRoomFailures | ForEach-Object { $_.city }) -join ', ')) }
Write-Host ("Los Angeles family pricing: travellers=$Travellers; rooms=$Rooms") -ForegroundColor Green

$SanDiego = Invoke-Scenario 'San Diego exact-date regression' @{
    mode = 'generated-tour'
    recommendationScope = 'generated-multicity-tour'
    origin = 'San Diego (SAN)'
    budget = '1900'
    currency = 'USD'
    passengers = '1'
    adults = '1'
    children = '0'
    nights = '6'
    totalNights = '6'
    maxStops = '3'
    dateMode = 'exact'
    flexible = 'false'
    departureDate = '2026-11-05'
    returnDate = '2026-11-11'
    startDate = '2026-11-05'
    endDate = '2026-11-11'
    preferredMonth = '2026-11'
    month = '2026-11'
    adaptiveDuration = 'true'
    generated = 'true'
    variant = '669d-san-exact-date-smoke'
}

$Departure = [string]$SanDiego.Tour.itineraryDatePlan.canonicalDepartureDate
$Return = [string]$SanDiego.Tour.itineraryDatePlan.canonicalReturnDate
if ($Departure -ne '2026-11-05') { throw "San Diego exact departure drifted to $Departure." }
if ($Return -ne '2026-11-11') { throw "San Diego exact return drifted to $Return." }
if ($SanDiego.Tour.itineraryDatePlan.consistent -ne $true) { throw 'San Diego exact-date itinerary is not internally consistent.' }

$Legs = if (@($SanDiego.Tour.backendLegs).Count -gt 0) { @($SanDiego.Tour.backendLegs) } else { @($SanDiego.Tour.legs) }
$LegDates = @($Legs | ForEach-Object { Get-LegDate $_ })
if ($LegDates.Count -eq 0 -or $LegDates[0] -ne '2026-11-05' -or $LegDates[$LegDates.Count - 1] -ne '2026-11-11') {
    throw ('San Diego leg dates do not preserve the exact window: ' + ($LegDates -join ' | '))
}
for ($Index = 1; $Index -lt $LegDates.Count; $Index += 1) {
    if ([datetime]$LegDates[$Index] -lt [datetime]$LegDates[$Index - 1]) { throw ('San Diego leg dates are not chronological: ' + ($LegDates -join ' | ')) }
}

$BadFlightLinks = New-Object System.Collections.Generic.List[string]
foreach ($Leg in $Legs) {
    $Url = [string]$Leg.booking.url
    if ([string]::IsNullOrWhiteSpace($Url)) { $Url = [string]$Leg.bookingUrl }
    $Date = [string]$Leg.booking.route.departureDate
    if (-not (Test-HttpsUrl $Url) -or $Date -notmatch '^\d{4}-\d{2}-\d{2}$') { [void]$BadFlightLinks.Add($Date) }
}
if ($BadFlightLinks.Count -gt 0) { throw ('San Diego has invalid date-prefilled flight links: ' + ($BadFlightLinks -join ', ')) }

$BadStayLinks = New-Object System.Collections.Generic.List[string]
foreach ($Stay in @($SanDiego.Tour.stays)) {
    $Url = [string]$Stay.hotel.booking.url
    if ([string]::IsNullOrWhiteSpace($Url)) { $Url = [string]$Stay.hotel.bookingUrl }
    $CheckIn = [string]$Stay.hotel.booking.checkIn
    $CheckOut = [string]$Stay.hotel.booking.checkOut
    if (-not (Test-HttpsUrl $Url) -or $CheckIn -notmatch '^\d{4}-\d{2}-\d{2}$' -or $CheckOut -notmatch '^\d{4}-\d{2}-\d{2}$') {
        [void]$BadStayLinks.Add([string]$Stay.city)
    }
}
if ($BadStayLinks.Count -gt 0) { throw ('San Diego has invalid exact-date hotel links: ' + ($BadStayLinks -join ', ')) }

Write-Host ('San Diego exact dates: ' + $Departure + ' to ' + $Return) -ForegroundColor Green
Write-Host ('San Diego leg dates: ' + ($LegDates -join ' | ')) -ForegroundColor Green
Write-Host ''
Write-Host 'GV-PROD-669D exact-date and family-occupancy smoke passed.' -ForegroundColor Green
