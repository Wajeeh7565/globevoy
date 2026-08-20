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
    return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec $TimeoutSec -Headers @{ 'Cache-Control' = 'no-cache' }
}

function Get-Tour {
    param($Payload)
    if ($null -ne $Payload.tour) { return $Payload.tour }
    if (@($Payload.tours).Count -gt 0) { return @($Payload.tours)[0] }
    return $null
}

function Get-TourTotal {
    param($Tour)
    foreach ($Candidate in @(
        $Tour.canonicalPricing.canonicalDisplayTotal,
        $Tour.canonicalPricing.visibleCardTotalDisplay,
        $Tour.budget.estimatedCoreTotal.amount,
        $Tour.displayBudget.tripEstimate
    )) {
        $Number = 0.0
        if ([double]::TryParse([string]$Candidate, [ref]$Number) -and $Number -gt 0) { return $Number }
    }
    return 0.0
}

function Get-OriginCode {
    param($Tour)
    foreach ($Value in @($Tour.origin.airportCode, $Tour.origin.code, $Tour.origin.displayCode)) {
        $Text = ([string]$Value).Trim().ToUpperInvariant()
        if ($Text -match '^[A-Z]{3}$') { return $Text }
    }
    return ''
}

function Test-HttpsUrl {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $Parsed = $null
    return [uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$Parsed) -and $Parsed.Scheme -eq 'https'
}

function Get-ActivationRecord {
    param($City)
    $Parameters = @{ q = [string]$City.city; countryCode = [string]$City.countryCode; limit = '10' }
    $Response = Invoke-JsonGet -Uri (Build-Url ($BaseUrl + '/api/verified-city-activation') $Parameters) -TimeoutSec 60
    $CityId = [string]$City.id
    if ([string]::IsNullOrWhiteSpace($CityId)) { $CityId = [string]$City.cityId }
    $Match = @($Response.records | Where-Object {
        ([string]$_.cityId -eq $CityId) -or
        (([string]$_.displayName -eq [string]$City.city) -and ([string]$_.countryCode -eq [string]$City.countryCode))
    } | Select-Object -First 1)
    if ($Match.Count -gt 0) { return $Match[0] }
    return $null
}

function Invoke-Scenario {
    param([string]$Name, [hashtable]$Parameters)
    Write-Host ''
    Write-Host ('=== ' + $Name + ' ===') -ForegroundColor Cyan
    $Url = Build-Url ($BaseUrl + '/api/generated-tour') $Parameters
    $Payload = Invoke-JsonGet -Uri $Url -TimeoutSec 240
    if ($Payload.ok -ne $true) { throw "$Name returned ok=false." }
    if ($Payload.supported -eq $false) { throw "$Name was not supported: $($Payload.reason)" }
    $Tour = Get-Tour $Payload
    if ($null -eq $Tour) { throw "$Name did not return a tour." }
    return [pscustomobject]@{ Payload = $Payload; Tour = $Tour }
}

Write-Host '=== Checking GV-PROD-669C budget-safe route recovery ===' -ForegroundColor Yellow
$Activation = Invoke-JsonGet -Uri ($BaseUrl + '/api/verified-city-activation') -TimeoutSec 60
if ($Activation.version -ne 'GV-CITY-668T') { throw "Expected activation GV-CITY-668T but received $($Activation.version)." }
if ([int]$Activation.summary.productionActiveCount -ne 439) { throw "Expected 439 active cities but received $($Activation.summary.productionActiveCount)." }
if ([int]$Activation.summary.auditedCount -ne 1000 -or [int]$Activation.summary.unauditedCount -ne 0) { throw 'The 1,000-city audited baseline is not intact.' }
Write-Host 'Activation baseline: GV-CITY-668T, 1000 audited, 439 active.' -ForegroundColor Green

$Common = @{
    mode = 'generated-tour'
    recommendationScope = 'generated-multicity-tour'
    passengers = '1'
    adults = '1'
    children = '0'
    flexible = 'true'
    adaptiveDuration = 'true'
    generated = 'true'
    maxStops = '3'
}

$MontrealParameters = @{} + $Common
$MontrealParameters.origin = 'Montreal (YUL)'
$MontrealParameters.budget = '1500'
$MontrealParameters.currency = 'CAD'
$MontrealParameters.nights = '6'
$MontrealParameters.totalNights = '6'
$MontrealParameters.dateMode = 'flexible'
$MontrealParameters.preferredMonth = '2026-11'
$MontrealParameters.month = '2026-11'
$MontrealParameters.variant = '669c-montreal-budget-recovery-smoke'
$Montreal = Invoke-Scenario 'Montreal CAD 1500 budget recovery' $MontrealParameters

$Total = Get-TourTotal $Montreal.Tour
if ($Total -le 0 -or $Total -gt 1507.5) { throw "Montreal returned an invalid or over-budget total: $Total CAD." }
$Cities = @($Montreal.Tour.cities)
if ($Cities.Count -lt 1 -or $Cities.Count -gt 2) { throw "Montreal returned an unexpected destination count: $($Cities.Count)." }
$Inactive = New-Object System.Collections.Generic.List[string]
foreach ($City in $Cities) {
    $Record = Get-ActivationRecord $City
    if ($null -eq $Record -or $Record.liveRecommendationEligible -ne $true) { [void]$Inactive.Add([string]$City.city) }
    Start-Sleep -Milliseconds 100
}
if ($Inactive.Count -gt 0) { throw ('Montreal returned inactive destinations: ' + ($Inactive -join ', ')) }
if (@($Cities | Where-Object { [string]$_.city -eq 'Havana' }).Count -gt 0) { throw 'Havana is still present in the Montreal result.' }

$Stays = @($Montreal.Tour.stays)
$BadStayLinks = New-Object System.Collections.Generic.List[string]
foreach ($Stay in $Stays) {
    $Url = [string]$Stay.hotel.booking.url
    if ([string]::IsNullOrWhiteSpace($Url)) { $Url = [string]$Stay.hotel.bookingUrl }
    $CheckIn = [string]$Stay.hotel.booking.checkIn
    $CheckOut = [string]$Stay.hotel.booking.checkOut
    if (-not (Test-HttpsUrl $Url) -or $CheckIn -notmatch '^\d{4}-\d{2}-\d{2}$' -or $CheckOut -notmatch '^\d{4}-\d{2}-\d{2}$') {
        [void]$BadStayLinks.Add([string]$Stay.city)
    }
}
if ($BadStayLinks.Count -gt 0 -or $Stays.Count -ne $Cities.Count) { throw ('Montreal has invalid date-prefilled hotel links: ' + ($BadStayLinks -join ', ')) }
$Recovery = $Montreal.Payload.diagnostics.budgetSafeRouteRecovery
if ($null -ne $Recovery -and $Recovery.enabled -eq $true) {
    Write-Host ("669C recovery used: stop cap $($Recovery.originalStopCap) -> $($Recovery.recoveredStopCap); thresholdsRelaxed=$($Recovery.thresholdsRelaxed)") -ForegroundColor Green
} else {
    Write-Host 'Montreal fit the budget without needing the reduced-stop fallback on this run.' -ForegroundColor DarkGreen
}
Write-Host ('Montreal destinations: ' + (($Cities | ForEach-Object { $_.city }) -join ' | ')) -ForegroundColor Green
Write-Host ("Montreal visible total: CAD $Total") -ForegroundColor Green

$NewYorkParameters = @{} + $Common
$NewYorkParameters.origin = 'New York (JFK)'
$NewYorkParameters.budget = '1800'
$NewYorkParameters.currency = 'USD'
$NewYorkParameters.nights = '7'
$NewYorkParameters.totalNights = '7'
$NewYorkParameters.dateMode = 'flexible'
$NewYorkParameters.preferredMonth = '2026-10'
$NewYorkParameters.month = '2026-10'
$NewYorkParameters.variant = '669c-new-york-regression-smoke'
$NewYork = Invoke-Scenario 'New York origin regression' $NewYorkParameters
$OriginCode = Get-OriginCode $NewYork.Tour
$OriginCity = [string]$NewYork.Tour.origin.city
if ($OriginCode -notin @('JFK','NYC','EWR','LGA') -and $OriginCity -notmatch '(?i)new york') { throw "New York resolved incorrectly to $OriginCity ($OriginCode)." }
if ($OriginCity -match '(?i)new orleans' -or $OriginCode -eq 'MSY' -or $OriginCode -eq 'NEW') { throw "New York still resolves to New Orleans: $OriginCity ($OriginCode)." }
Write-Host ("New York resolved to: $OriginCity ($OriginCode)") -ForegroundColor Green

Write-Host ''
Write-Host 'GV-PROD-669C budget recovery smoke passed.' -ForegroundColor Green
