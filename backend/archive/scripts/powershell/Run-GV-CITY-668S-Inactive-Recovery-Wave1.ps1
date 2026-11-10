param(
    [ValidateSet('Smoke5', 'Recovery150')]
    [string]$Mode = 'Smoke5',

    [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Downloads\GV-668S-Recovery'),

    [switch]$Resume,

    [string]$RunId = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BaseUrl = 'https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws'.TrimEnd('/')
$VerifyUrl = "$BaseUrl/api/provider-live-coverage/verify"
$PlanUrl = "$BaseUrl/api/inactive-city-recovery-wave1"
$ChunkSize = 2

# Covers comfort, quality, stay, flight, and gateway recovery behavior.
$SmokeCities = @(
    'honolulu-us',
    'bamako-ml',
    'asmara-er',
    'cusco-pe',
    'taormina-it'
)

function Write-Section([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Save-Json([object]$Value, [string]$Path) {
    $Value | ConvertTo-Json -Depth 100 | Set-Content -Path $Path -Encoding UTF8
}

function Load-Json([string]$Path) {
    return Get-Content -Path $Path -Raw | ConvertFrom-Json
}

function Find-LatestCheckpoint([string]$Directory, [string]$ModeName) {
    $Pattern = "GV-CITY-668S-$ModeName-*-CHECKPOINT.json"
    return Get-ChildItem -Path $Directory -Filter $Pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

Write-Section 'Checking the deployed 668S inactive-city recovery plan'
try {
    $PlanSummary = Invoke-RestMethod -Uri $PlanUrl -Method Get -TimeoutSec 60
    if ($PlanSummary.version -ne 'GV-CITY-668S') {
        throw "Expected GV-CITY-668S but received $($PlanSummary.version)."
    }
    if ($PlanSummary.enabled -ne $true) {
        throw '668S is deployed but disabled. Set ENABLE_INACTIVE_CITY_RECOVERY_668S=true.'
    }
    if ($PlanSummary.summary.selectedCount -ne 150) {
        throw "The deployed 668S plan has $($PlanSummary.summary.selectedCount) cities instead of 150."
    }
    if ($PlanSummary.summary.readinessRecoveryCount -ne 64 -or $PlanSummary.summary.stayRecoveryCount -ne 6 -or $PlanSummary.summary.flightRecoveryCount -ne 80) {
        throw 'The deployed 668S recovery lanes do not match 64 readiness, 6 stay, and 80 flight targets.'
    }
    if ($PlanSummary.activationState.auditedCount -ne 1000 -or $PlanSummary.activationState.productionActiveCount -ne 421) {
        throw 'The deployed 668S plan is not based on the verified 668R 1,000-city / 421-active snapshot.'
    }
    Write-Host 'Inactive City Recovery Wave 1 plan is responding.' -ForegroundColor Green
    Write-Host ("Version: " + $PlanSummary.version)
    Write-Host ("Selected: " + $PlanSummary.summary.selectedCount)
    Write-Host ("Readiness recovery: " + $PlanSummary.summary.readinessRecoveryCount)
    Write-Host ("Stay recovery: " + $PlanSummary.summary.stayRecoveryCount)
    Write-Host ("Flight recovery: " + $PlanSummary.summary.flightRecoveryCount)
    Write-Host ("Production-active baseline: " + $PlanSummary.activationState.productionActiveCount)
    Write-Host ("Reviewed-inactive baseline: " + $PlanSummary.activationState.reviewedInactiveCount)
    Write-Host ("Audited baseline: " + $PlanSummary.activationState.auditedCount + '/1000')
} catch {
    Write-Host 'The 668S inactive-city recovery plan did not respond correctly.' -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

$PlanRecords = @()
try {
    $PlanResult = Invoke-RestMethod -Uri "${PlanUrl}?limit=150" -Method Get -TimeoutSec 60
    $PlanRecords = @($PlanResult.records | Sort-Object rank)
    if ($PlanRecords.Count -ne 150) { throw "Received $($PlanRecords.Count) recovery records instead of 150." }
} catch {
    Write-Host 'Could not load the 150-city 668S recovery list.' -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

$PlanById = @{}
foreach ($PlanRecord in $PlanRecords) { $PlanById[$PlanRecord.cityId] = $PlanRecord }

$CityIds = if ($Mode -eq 'Smoke5') {
    $SmokeCities
} else {
    @($PlanRecords | ForEach-Object { $_.cityId })
}

$CheckpointPath = $null
$AllRecords = @()
$BatchSummaries = @()
$CompletedIds = @{}

if ($Resume) {
    $CheckpointFile = $null
    if (-not [string]::IsNullOrWhiteSpace($RunId)) {
        $Candidate = Join-Path $OutputDirectory "GV-CITY-668S-$Mode-$RunId-CHECKPOINT.json"
        if (Test-Path $Candidate) { $CheckpointFile = Get-Item $Candidate }
    } else {
        $CheckpointFile = Find-LatestCheckpoint $OutputDirectory $Mode
    }
    if ($null -eq $CheckpointFile) {
        Write-Host 'No matching checkpoint was found. Start without -Resume first.' -ForegroundColor Red
        exit 1
    }
    $CheckpointPath = $CheckpointFile.FullName
    $Checkpoint = Load-Json $CheckpointPath
    $RunId = $Checkpoint.runId
    $AllRecords = @($Checkpoint.records)
    $BatchSummaries = @($Checkpoint.batches)
    foreach ($Record in $AllRecords) { $CompletedIds[$Record.cityId] = $true }
    Write-Host ("Resuming run {0}; {1}/{2} records already complete." -f $RunId, $AllRecords.Count, $CityIds.Count) -ForegroundColor Yellow
} else {
    if ([string]::IsNullOrWhiteSpace($RunId)) { $RunId = Get-Date -Format 'yyyyMMdd-HHmmss' }
    $CheckpointPath = Join-Path $OutputDirectory "GV-CITY-668S-$Mode-$RunId-CHECKPOINT.json"
}

$Prefix = "GV-CITY-668S-$Mode-$RunId"
$FinalJsonPath = Join-Path $OutputDirectory "$Prefix-LIVE-RESULTS.json"
$AllCsvPath = Join-Path $OutputDirectory "$Prefix-ALL.csv"
$ActiveCsvPath = Join-Path $OutputDirectory "$Prefix-PRODUCTION-ACTIVE.csv"
$ReviewCsvPath = Join-Path $OutputDirectory "$Prefix-REVIEW.csv"

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

$PendingIds = @($CityIds | Where-Object { -not $CompletedIds.ContainsKey($_) })
Write-Section "Running $Mode audit for $($CityIds.Count) cities"
Write-Host "Output folder: $OutputDirectory"
Write-Host "Run ID: $RunId"
Write-Host 'Policy: four flight months, six regional/country anchors, up to 20 flight attempts, four stay windows, and three Agoda quality strategies. Existing flight-comfort and hotel-quality thresholds are not relaxed.'
if ($Resume) { Write-Host ("Remaining: {0}" -f $PendingIds.Count) }

for ($Offset = 0; $Offset -lt $PendingIds.Count; $Offset += $ChunkSize) {
    $LastIndex = [Math]::Min($Offset + $ChunkSize - 1, $PendingIds.Count - 1)
    $Chunk = @($PendingIds[$Offset..$LastIndex])
    $Body = @{
        cityIds = $Chunk
        concurrency = 2
        currency = 'CAD'
        nights = 2
        adults = 2
        rooms = 1
        recoveryMode = $true
        monthCount = 4
        anchorCount = 6
        maxFlightAttempts = 20
        flightResultLimit = 12
        stayWindowCount = 4
        stayWindowSpacingDays = 30
        maxComfortDurationMinutes = 1080
        maxComfortTransfers = 1
        maxGatewayTransferMinutes = 180
        agodaQualityStrategyCount = 3
        agodaQualityMaxResult = 30
        forceAgodaQualityCandidateRetrieval = $true
    } | ConvertTo-Json -Depth 10

    $CompletedBefore = $AllRecords.Count
    Write-Host ("Checking {0}-{1} of {2}: {3}" -f ($CompletedBefore + 1), ($CompletedBefore + $Chunk.Count), $CityIds.Count, ($Chunk -join ', '))
    try {
        $Response = Invoke-RestMethod -Uri $VerifyUrl -Method Post -Headers $Headers -ContentType 'application/json' -Body $Body -TimeoutSec 480
    } catch {
        Write-Host 'This batch failed.' -ForegroundColor Red
        Write-Host $_.Exception.Message
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
        Write-Host 'Resume later with:'
        Write-Host "& `"$PSCommandPath`" -Mode $Mode -Resume -RunId $RunId" -ForegroundColor Yellow
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
    if ($Response.verificationPolicy.recoveryMode -ne $true -or $Response.verificationPolicy.flightMonths.Count -ne 4 -or $Response.verificationPolicy.regionalAnchorCount -ne 6) {
        Write-Host 'The deployed verifier did not apply the 668S recovery policy.' -ForegroundColor Red
        $Response.verificationPolicy | ConvertTo-Json -Depth 10 | Write-Host
        $PlainToken = $null
        exit 1
    }

    foreach ($Record in @($Response.records)) {
        $PlanRecord = $PlanById[$Record.cityId]
        $Record | Add-Member -NotePropertyName recoveryLane -NotePropertyValue $PlanRecord.recoveryLane -Force
        $Record | Add-Member -NotePropertyName previousClassification -NotePropertyValue $PlanRecord.previousClassification -Force
        $Record | Add-Member -NotePropertyName previousActivationReason -NotePropertyValue $PlanRecord.previousActivationReason -Force
        $Record | Add-Member -NotePropertyName previousRetryQueues -NotePropertyValue @($PlanRecord.retryQueues) -Force
    }

    $AllRecords += @($Response.records)
    $BatchSummaries += [pscustomobject]@{
        batchStart = $CompletedBefore + 1
        batchEnd = $AllRecords.Count
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
        taskId = 'GV-CITY-668S'
        mode = $Mode
        runId = $RunId
        baseUrl = $BaseUrl
        planVersion = $PlanSummary.version
        planGeneratedAt = $PlanSummary.generatedAt
        startedOrUpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
        completedCount = $AllRecords.Count
        requestedCount = $CityIds.Count
        activationBaseline = $PlanSummary.activationState
        recoveryPolicy = $PlanSummary.policy.recoveryAuditPolicy
        credentialsAvailable = $Response.credentialsAvailable
        cityIds = $CityIds
        records = $AllRecords
        batches = $BatchSummaries
    }
    Save-Json $Checkpoint $CheckpointPath
    Write-Host ("Completed {0}/{1}; provider-covered in batch: {2}; production-ready in batch: {3}" -f $AllRecords.Count, $CityIds.Count, $Response.providerCoverageEligibleCount, $Response.productionActiveCount) -ForegroundColor Green
    Start-Sleep -Seconds 1
}

$ClassificationGroups = @($AllRecords | Group-Object classification | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ classification = $_.Name; count = $_.Count }
})
$LaneGroups = @($AllRecords | Group-Object recoveryLane | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{
        recoveryLane = $_.Name
        checked = $_.Count
        providerCovered = @($_.Group | Where-Object { $_.providerCoverage.eligible -eq $true }).Count
        productionReady = @($_.Group | Where-Object { $_.productionActivation.eligible -eq $true }).Count
    }
})
$ProviderCovered = @($AllRecords | Where-Object { $_.providerCoverage.eligible -eq $true })
$ProductionActive = @($AllRecords | Where-Object { $_.productionActivation.eligible -eq $true })
$ReviewRecords = @($AllRecords | Where-Object { $_.productionActivation.eligible -ne $true })
$BaselineActive = [int]$PlanSummary.activationState.productionActiveCount
$BaselineInactive = [int]$PlanSummary.activationState.reviewedInactiveCount
$ProjectedActive = $BaselineActive + $ProductionActive.Count
$ProjectedInactive = $BaselineInactive - $ProductionActive.Count

$Final = [pscustomobject]@{
    taskId = 'GV-CITY-668S'
    engineVersion = 'GV-CITY-668E'
    mode = $Mode
    runId = $RunId
    baseUrl = $BaseUrl
    planVersion = $PlanSummary.version
    planGeneratedAt = $PlanSummary.generatedAt
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    requestedCount = $CityIds.Count
    completedCount = $AllRecords.Count
    providerCoverageEligibleCount = $ProviderCovered.Count
    productionActiveCount = $ProductionActive.Count
    reviewCount = $ReviewRecords.Count
    activationBaselineProductionActiveCount = $BaselineActive
    activationBaselineReviewedInactiveCount = $BaselineInactive
    projectedMergedProductionActiveCount = $ProjectedActive
    projectedReviewedInactiveCount = $ProjectedInactive
    auditedCount = 1000
    unauditedCount = 0
    recoveryWave = 1
    planLaneCounts = [pscustomobject]@{
        readinessRecovery = [int]$PlanSummary.summary.readinessRecoveryCount
        stayRecovery = [int]$PlanSummary.summary.stayRecoveryCount
        flightRecovery = [int]$PlanSummary.summary.flightRecoveryCount
    }
    recoveryPolicy = $PlanSummary.policy.recoveryAuditPolicy
    thresholdsRelaxed = $false
    activationImportRequired = $true
    classificationCounts = $ClassificationGroups
    laneResults = $LaneGroups
    batches = $BatchSummaries
    records = $AllRecords
}
Save-Json $Final $FinalJsonPath

$CsvRows = $AllRecords | Select-Object cityId, displayName, country, countryCode, selectionTier, recoveryLane,
    previousClassification, previousActivationReason,
    @{Name='previousRetryQueues'; Expression={($_.previousRetryQueues -join '|')}}, classification,
    @{Name='providerCoverageEligible'; Expression={$_.providerCoverage.eligible}},
    @{Name='productionActive'; Expression={$_.productionActivation.eligible}},
    @{Name='comfortQualified'; Expression={$_.recommendationReadiness.comfortQualifiedFlightObserved}},
    @{Name='stayQualityQualified'; Expression={$_.recommendationReadiness.qualityQualifiedStayObserved}},
    @{Name='flightDestinationCode'; Expression={$_.live.travelpayouts.destinationCode}},
    @{Name='verifiedOrigin'; Expression={$_.live.travelpayouts.verifiedOrigin}},
    @{Name='verificationMonth'; Expression={$_.live.travelpayouts.verificationMonth}},
    @{Name='gatewayFallbackUsed'; Expression={$_.live.travelpayouts.gatewayFallbackUsed}},
    @{Name='flightDurationMinutes'; Expression={$_.live.travelpayouts.comfort.durationMinutes}},
    @{Name='flightTransfers'; Expression={$_.live.travelpayouts.comfort.transfers}},
    @{Name='travelpayoutsStatus'; Expression={$_.live.travelpayouts.status}},
    @{Name='agodaStatus'; Expression={$_.live.agoda.status}},
    @{Name='agodaSelectedStrategy'; Expression={$_.live.agoda.selectedStrategy.strategyId}},
    @{Name='agodaRawHotels'; Expression={$_.live.agoda.rawHotelCount}},
    @{Name='agodaQualifiedHotels'; Expression={$_.live.agoda.qualityQualifiedCount}},
    @{Name='activationReason'; Expression={$_.productionActivation.reason}}, lastVerifiedAt
$CsvRows | Export-Csv -Path $AllCsvPath -NoTypeInformation -Encoding UTF8
$CsvRows | Where-Object { $_.productionActive -eq $true } | Export-Csv -Path $ActiveCsvPath -NoTypeInformation -Encoding UTF8
$CsvRows | Where-Object { $_.productionActive -ne $true } | Export-Csv -Path $ReviewCsvPath -NoTypeInformation -Encoding UTF8

$PlainToken = $null
$Headers = $null

Write-Section 'Recovery audit complete'
Write-Host ("Checked: {0}" -f $AllRecords.Count) -ForegroundColor Green
Write-Host ("Provider-covered: {0}" -f $ProviderCovered.Count)
Write-Host ("Production-ready recoveries: {0}" -f $ProductionActive.Count)
Write-Host ("Still needs review: {0}" -f $ReviewRecords.Count)
Write-Host ("Projected active after reviewed import: {0}" -f $ProjectedActive)
Write-Host ("Projected reviewed inactive after import: {0}" -f $ProjectedInactive)
Write-Host 'Lane results:'
$LaneGroups | Format-Table -AutoSize
Write-Host 'Classification counts:'
$ClassificationGroups | Format-Table -AutoSize
Write-Host "`nUpload this file to ChatGPT:"
Write-Host $FinalJsonPath -ForegroundColor Yellow
Write-Host "`nOther files:"
Write-Host $AllCsvPath
Write-Host $ActiveCsvPath
Write-Host $ReviewCsvPath
Write-Host $CheckpointPath
