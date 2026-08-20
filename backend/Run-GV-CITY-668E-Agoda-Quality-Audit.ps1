param(
    [ValidateSet('Smoke3', 'Quality13', 'Pilot100')]
    [string]$Mode = 'Smoke3',

    [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Downloads\GV-668E-Audit')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BaseUrl = 'https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws'.TrimEnd('/')
$VerifyUrl = "$BaseUrl/api/provider-live-coverage/verify"
$SummaryUrl = "$BaseUrl/api/provider-live-coverage"
$ChunkSize = 2

$SmokeCities = @(
    'lahore-pk',
    'bangkok-th',
    'delhi-in'
)

$QualityCities = @(
    'lahore-pk',
    'islamabad-pk',
    'bangkok-th',
    'nairobi-ke',
    'delhi-in',
    'mumbai-in',
    'karachi-pk',
    'colombo-lk',
    'jakarta-id',
    'abuja-ng',
    'aitutaki-ck',
    'antananarivo-mg',
    'ayutthaya-th'
)

$PilotCities = @(
    'toronto-ca',
    'paris-fr',
    'london-gb',
    'lahore-pk',
    'islamabad-pk',
    'cairo-eg',
    'istanbul-tr',
    'tokyo-jp',
    'bangkok-th',
    'rabat-ma',
    'algiers-dz',
    'suwon-kr',
    'tulum-mx',
    'caye-caulker-bz',
    'faisalabad-pk',
    'tehran-ir',
    'havana-cu',
    'lucca-it',
    'new-york-us',
    'singapore-sg',
    'sydney-au',
    'dubai-ae',
    'mexico-city-mx',
    'cancun-mx',
    'rome-it',
    'lisbon-pt',
    'cape-town-za',
    'nairobi-ke',
    'delhi-in',
    'mumbai-in',
    'karachi-pk',
    'seoul-kr',
    'aarhus-dk',
    'accra-gh',
    'auckland-nz',
    'buenos-aires-ar',
    'casablanca-ma',
    'colombo-lk',
    'dublin-ie',
    'jakarta-id',
    'aberdeen-gb',
    'palma-de-mallorca-es',
    'aalborg-dk',
    'adler-sochi-ru',
    'abu-dhabi-ae',
    'abha-sa',
    'abadan-ir',
    'addis-ababa-et',
    'diani-beach-ke',
    'abidjan-ci',
    'bangui-cf',
    'albuquerque-us',
    'iqaluit-ca',
    'aasiaat-gl',
    'barcelona-ve',
    'adelaide-au',
    'ahe-pf',
    'arona-sb',
    'akureyri-is',
    'al-wakrah-qa',
    'anjouan-km',
    'boa-vista-cv',
    'alghero-it',
    'aalesund-no',
    'basel-switzerland-mulhouse-ch',
    'al-ain-ae',
    'aktau-kz',
    'aden-ye',
    'agadir-ma',
    'abuja-ng',
    'beida-ly',
    'anchorage-us',
    'muskoka-ca',
    'abymes-gp',
    'camaguey-cu',
    'alice-springs-au',
    'aitutaki-ck',
    'arutua-pf',
    'antigua-guatemala-gt',
    'antananarivo-mg',
    'christmas-island-cx',
    'alicante-es',
    'arad-ro',
    'bol-hr',
    'amman-jo',
    'aktobe-kz',
    'ahwaz-ir',
    'alexandria-eg',
    'adrar-dz',
    'benghazi-ly',
    'arequipa-pe',
    'acapulco-mx',
    'camiri-bo',
    'brisbane-au',
    'alotau-pg',
    'atuona-pf',
    'ayutthaya-th',
    'antsiranana-mg',
    'dharavandhoo-island-mv',
    'amsterdam-nl'
)

function Write-Section([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Save-Json([object]$Value, [string]$Path) {
    $Value | ConvertTo-Json -Depth 100 | Set-Content -Path $Path -Encoding UTF8
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

Write-Section 'Checking the deployed 668E endpoint'
try {
    $publicSummary = Invoke-RestMethod -Uri $SummaryUrl -Method Get -TimeoutSec 60
    Write-Host 'Public endpoint is responding.' -ForegroundColor Green
    Write-Host ("Version: " + $publicSummary.version)
    Write-Host ("Status: " + $publicSummary.status)
    if ($publicSummary.version -ne 'GV-CITY-668E') {
        Write-Host 'The endpoint is not running GV-CITY-668E yet. Deploy the 668E backend ZIP first.' -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host 'The 668E endpoint did not respond correctly.' -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

Write-Section 'Enter the private audit token'
Write-Host 'Paste the exact value stored in GV_PROVIDER_COVERAGE_ADMIN_TOKEN.'
Write-Host 'The token will be masked and will not be saved.'
$SecureToken = Read-Host 'Admin token' -AsSecureString
$TokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPointer)
}
if ([string]::IsNullOrWhiteSpace($PlainToken)) { Write-Host 'No token entered.' -ForegroundColor Red; exit 1 }

$Headers = @{ 'x-gv-admin-token' = $PlainToken }
$CityIds = if ($Mode -eq 'Pilot100') { $PilotCities } elseif ($Mode -eq 'Quality13') { $QualityCities } else { $SmokeCities }
$RunStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Prefix = "GV-CITY-668E-$Mode-$RunStamp"
$CheckpointPath = Join-Path $OutputDirectory "$Prefix-CHECKPOINT.json"
$FinalJsonPath = Join-Path $OutputDirectory "$Prefix-LIVE-RESULTS.json"
$AllCsvPath = Join-Path $OutputDirectory "$Prefix-ALL.csv"
$ActiveCsvPath = Join-Path $OutputDirectory "$Prefix-PRODUCTION-ACTIVE.csv"
$ReviewCsvPath = Join-Path $OutputDirectory "$Prefix-REVIEW.csv"

$AllRecords = @()
$BatchSummaries = @()

Write-Section "Running $Mode multi-window audit for $($CityIds.Count) cities"
Write-Host "Output folder: $OutputDirectory"
Write-Host 'Policy: 3 flight months, regional origin anchors, 3 Agoda date windows, and diversified Agoda quality candidates (Recommended + guest review, up to 30 each).'

for ($Offset = 0; $Offset -lt $CityIds.Count; $Offset += $ChunkSize) {
    $LastIndex = [Math]::Min($Offset + $ChunkSize - 1, $CityIds.Count - 1)
    $Chunk = @($CityIds[$Offset..$LastIndex])
    $Body = @{
        cityIds = $Chunk
        concurrency = 2
        currency = 'CAD'
        nights = 2
        adults = 2
        rooms = 1
        monthCount = 3
        stayWindowCount = 3
        maxFlightAttempts = 12
        maxComfortDurationMinutes = 1080
        maxComfortTransfers = 1
        agodaQualityStrategyCount = 2
        agodaQualityMaxResult = 30
    } | ConvertTo-Json -Depth 10

    Write-Host ("Checking {0}-{1} of {2}: {3}" -f ($Offset + 1), ($LastIndex + 1), $CityIds.Count, ($Chunk -join ', '))
    try {
        $Response = Invoke-RestMethod -Uri $VerifyUrl -Method Post -Headers $Headers -ContentType 'application/json' -Body $Body -TimeoutSec 420
    } catch {
        Write-Host 'This batch failed.' -ForegroundColor Red
        Write-Host $_.Exception.Message
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
        Write-Host "Checkpoint: $CheckpointPath"
        $PlainToken = $null
        exit 1
    }
    if ($Response.ok -ne $true) {
        Write-Host 'Lambda returned an unsuccessful audit response.' -ForegroundColor Red
        $Response | ConvertTo-Json -Depth 30 | Write-Host
        $PlainToken = $null
        exit 1
    }

    $AllRecords += @($Response.records)
    $BatchSummaries += [pscustomobject]@{
        batchStart = $Offset + 1
        batchEnd = $LastIndex + 1
        requestedCount = $Response.requestedCount
        completedCount = $Response.completedCount
        failedCount = $Response.failedCount
        providerCoverageEligibleCount = $Response.providerCoverageEligibleCount
        productionActiveCount = $Response.productionActiveCount
        classificationCounts = $Response.classificationCounts
        verificationPolicy = $Response.verificationPolicy
        generatedAt = $Response.generatedAt
    }

    $Checkpoint = [pscustomobject]@{
        taskId = 'GV-CITY-668E'
        mode = $Mode
        baseUrl = $BaseUrl
        startedOrUpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
        completedCount = $AllRecords.Count
        requestedCount = $CityIds.Count
        credentialsAvailable = $Response.credentialsAvailable
        records = $AllRecords
        batches = $BatchSummaries
    }
    Save-Json $Checkpoint $CheckpointPath
    Write-Host ("Completed {0}/{1}; provider-covered: {2}; production-ready: {3}" -f $AllRecords.Count, $CityIds.Count, $Response.providerCoverageEligibleCount, $Response.productionActiveCount) -ForegroundColor Green
    Start-Sleep -Seconds 2
}

$ClassificationGroups = @($AllRecords | Group-Object classification | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ classification = $_.Name; count = $_.Count }
})
$ProviderCovered = @($AllRecords | Where-Object { $_.providerCoverage.eligible -eq $true })
$ProductionActive = @($AllRecords | Where-Object { $_.productionActivation.eligible -eq $true })
$ReviewRecords = @($AllRecords | Where-Object { $_.productionActivation.eligible -ne $true })

$Final = [pscustomobject]@{
    taskId = 'GV-CITY-668E'
    mode = $Mode
    baseUrl = $BaseUrl
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    requestedCount = $CityIds.Count
    completedCount = $AllRecords.Count
    providerCoverageEligibleCount = $ProviderCovered.Count
    productionActiveCount = $ProductionActive.Count
    reviewCount = $ReviewRecords.Count
    classificationCounts = $ClassificationGroups
    batches = $BatchSummaries
    records = $AllRecords
}
Save-Json $Final $FinalJsonPath

$CsvRows = $AllRecords | Select-Object cityId, displayName, country, countryCode, classification,
    @{Name='providerCoverageEligible'; Expression={$_.providerCoverage.eligible}},
    @{Name='productionActive'; Expression={$_.productionActivation.eligible}},
    @{Name='comfortQualified'; Expression={$_.recommendationReadiness.comfortQualifiedFlightObserved}},
    @{Name='stayQualityQualified'; Expression={$_.recommendationReadiness.qualityQualifiedStayObserved}},
    @{Name='flightDestinationCode'; Expression={$_.live.travelpayouts.destinationCode}},
    @{Name='gatewayFallbackUsed'; Expression={$_.live.travelpayouts.gatewayFallbackUsed}},
    @{Name='travelpayoutsStatus'; Expression={$_.live.travelpayouts.status}},
    @{Name='agodaStatus'; Expression={$_.live.agoda.status}},
    @{Name='agodaCandidateMode'; Expression={$_.live.agoda.candidateRetrievalMode}},
    @{Name='agodaSelectedStrategy'; Expression={$_.live.agoda.selectedStrategy.strategyId}},
    @{Name='agodaRawHotels'; Expression={$_.live.agoda.rawHotelCount}},
    @{Name='agodaQualifiedHotels'; Expression={$_.live.agoda.qualityQualifiedCount}},
    @{Name='activationReason'; Expression={$_.productionActivation.reason}}, lastVerifiedAt
$CsvRows | Export-Csv -Path $AllCsvPath -NoTypeInformation -Encoding UTF8
$CsvRows | Where-Object { $_.productionActive -eq $true } | Export-Csv -Path $ActiveCsvPath -NoTypeInformation -Encoding UTF8
$CsvRows | Where-Object { $_.productionActive -ne $true } | Export-Csv -Path $ReviewCsvPath -NoTypeInformation -Encoding UTF8

$PlainToken = $null
$Headers = $null

Write-Section 'Audit complete'
Write-Host ("Checked: {0}" -f $AllRecords.Count) -ForegroundColor Green
Write-Host ("Provider-covered: {0}" -f $ProviderCovered.Count)
Write-Host ("Production-ready: {0}" -f $ProductionActive.Count)
Write-Host ("Needs review: {0}" -f $ReviewRecords.Count)
Write-Host 'Classification counts:'
$ClassificationGroups | Format-Table -AutoSize
Write-Host "`nUpload this file to ChatGPT:"
Write-Host $FinalJsonPath -ForegroundColor Yellow
Write-Host "`nOther files:"
Write-Host $AllCsvPath
Write-Host $ActiveCsvPath
Write-Host $ReviewCsvPath
