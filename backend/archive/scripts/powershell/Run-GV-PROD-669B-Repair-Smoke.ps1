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
    param([string]$Uri, [int]$TimeoutSec = 180)
    return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec $TimeoutSec -Headers @{ 'Cache-Control' = 'no-cache' }
}

function Get-Tour {
    param($Payload)
    if ($null -ne $Payload.tour) { return $Payload.tour }
    if (@($Payload.tours).Count -gt 0) { return @($Payload.tours)[0] }
    return $null
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
    $Payload = Invoke-JsonGet -Uri $Url -TimeoutSec 180
    if ($Payload.ok -ne $true) { throw "$Name returned ok=false." }
    if ($Payload.supported -eq $false) { throw "$Name was not supported: $($Payload.reason)" }
    $Tour = Get-Tour $Payload
    if ($null -eq $Tour) { throw "$Name did not return a tour." }
    return [pscustomobject]@{ Payload = $Payload; Tour = $Tour }
}

Write-Host '=== Checking GV-PROD-669B targeted MVP repairs ===' -ForegroundColor Yellow
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
$MontrealParameters.variant = '669b-montreal-repair-smoke'
$Montreal = Invoke-Scenario 'Montreal production-active destination and hotel-link regression' $MontrealParameters

$Inactive = New-Object System.Collections.Generic.List[string]
foreach ($City in @($Montreal.Tour.cities)) {
    $Record = Get-ActivationRecord $City
    if ($null -eq $Record -or $Record.liveRecommendationEligible -ne $true) {
        [void]$Inactive.Add([string]$City.city)
    }
    Start-Sleep -Milliseconds 100
}
if ($Inactive.Count -gt 0) { throw ('Montreal returned inactive destinations: ' + ($Inactive -join ', ')) }
if (@($Montreal.Tour.cities | Where-Object { [string]$_.city -eq 'Havana' }).Count -gt 0) { throw 'Havana is still present in the Montreal result.' }

$BadStayLinks = New-Object System.Collections.Generic.List[string]
foreach ($Stay in @($Montreal.Tour.stays)) {
    $Url = [string]$Stay.hotel.booking.url
    if ([string]::IsNullOrWhiteSpace($Url)) { $Url = [string]$Stay.hotel.bookingUrl }
    $CheckIn = [string]$Stay.hotel.booking.checkIn
    $CheckOut = [string]$Stay.hotel.booking.checkOut
    if (-not (Test-HttpsUrl $Url) -or $CheckIn -notmatch '^\d{4}-\d{2}-\d{2}$' -or $CheckOut -notmatch '^\d{4}-\d{2}-\d{2}$') {
        [void]$BadStayLinks.Add([string]$Stay.city)
    }
}
if ($BadStayLinks.Count -gt 0 -or @($Montreal.Tour.stays).Count -ne @($Montreal.Tour.cities).Count) {
    throw ('Montreal has invalid date-prefilled hotel links: ' + ($BadStayLinks -join ', '))
}
Write-Host ('Montreal destinations: ' + ((@($Montreal.Tour.cities) | ForEach-Object { $_.city }) -join ' | ')) -ForegroundColor Green
Write-Host 'Montreal active-destination and hotel-link checks passed.' -ForegroundColor Green

$NewYorkParameters = @{} + $Common
$NewYorkParameters.origin = 'New York (JFK)'
$NewYorkParameters.budget = '1800'
$NewYorkParameters.currency = 'USD'
$NewYorkParameters.nights = '7'
$NewYorkParameters.totalNights = '7'
$NewYorkParameters.dateMode = 'flexible'
$NewYorkParameters.preferredMonth = '2026-10'
$NewYorkParameters.month = '2026-10'
$NewYorkParameters.variant = '669b-new-york-origin-repair-smoke'
$NewYork = Invoke-Scenario 'New York origin resolution regression' $NewYorkParameters
$OriginCode = Get-OriginCode $NewYork.Tour
$OriginCity = [string]$NewYork.Tour.origin.city
if ($OriginCode -notin @('JFK','NYC','EWR','LGA') -and $OriginCity -notmatch '(?i)new york') {
    throw "New York resolved incorrectly to $OriginCity ($OriginCode)."
}
if ($OriginCity -match '(?i)new orleans' -or $OriginCode -eq 'MSY' -or $OriginCode -eq 'NEW') {
    throw "New York still resolves to New Orleans: $OriginCity ($OriginCode)."
}
Write-Host ("New York resolved to: $OriginCity ($OriginCode)") -ForegroundColor Green

Write-Host ''
Write-Host 'GV-PROD-669B repair smoke passed.' -ForegroundColor Green
