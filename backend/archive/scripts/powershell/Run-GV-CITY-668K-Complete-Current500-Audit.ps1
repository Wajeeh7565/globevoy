param(
    [ValidateSet('Smoke5', 'Priority50', 'Final145')]
    [string]$Mode = 'Smoke5',

    [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Downloads\GV-668K-Audit'),

    [switch]$Resume,

    [string]$RunId = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BaseUrl = 'https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws'.TrimEnd('/')
$VerifyUrl = "$BaseUrl/api/provider-live-coverage/verify"
$PlanUrl = "$BaseUrl/api/current-500-completion-audit"
$ChunkSize = 2

$SmokeCities = @(
    'sapporo-jp',
    'orlando-us',
    'kyoto-jp',
    'copenhagen-dk',
    'sharm-el-sheikh-eg'
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
    $Pattern = "GV-CITY-668K-$ModeName-*-CHECKPOINT.json"
    return Get-ChildItem -Path $Directory -Filter $Pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

Write-Section 'Checking the deployed 668K Current-500 completion plan'
try {
    $PlanSummary = Invoke-RestMethod -Uri $PlanUrl -Method Get -TimeoutSec 60
    if ($PlanSummary.version -ne 'GV-CITY-668K') {
        throw "Expected GV-CITY-668K but received $($PlanSummary.version)."
    }
    if ($PlanSummary.enabled -ne $true) {
        throw '668K is deployed but disabled. Set ENABLE_CURRENT_500_COMPLETION_AUDIT_668K=true.'
    }
    if ($PlanSummary.summary.selectedCount -ne 145) {
        throw "The deployed 668K plan has $($PlanSummary.summary.selectedCount) cities instead of 145."
    }
    if ($PlanSummary.summary.projectedCurrent500AuditedAfterRun -ne 500) {
        throw 'The deployed 668K plan does not project 500/500 Current-500 cities audited.'
    }
    Write-Host 'Current-500 completion plan is responding.' -ForegroundColor Green
    Write-Host ("Version: " + $PlanSummary.version)
    Write-Host ("Selected: " + $PlanSummary.summary.selectedCount)
    Write-Host ("Audited baseline: " + $PlanSummary.activationState.auditedCount)
    Write-Host ("Production-active baseline: " + $PlanSummary.activationState.productionActiveCount)
    Write-Host ("Current-500 audited baseline: " + $PlanSummary.activationState.current500AuditedCount)
    Write-Host ("Projected Current-500 audited after run: " + $PlanSummary.completionProjection.current500AuditedAfterRun)
    Write-Host ("Projected total audited after run: " + $PlanSummary.completionProjection.totalAuditedAfterRun)
} catch {
    Write-Host 'The 668K Current-500 completion plan did not respond correctly.' -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

$PlanRecords = @()
try {
    $PlanResult = Invoke-RestMethod -Uri "${PlanUrl}?limit=145" -Method Get -TimeoutSec 60
    $PlanRecords = @($PlanResult.records | Sort-Object rank)
    if ($PlanRecords.Count -ne 145) { throw "Received $($PlanRecords.Count) plan records instead of 145." }
} catch {
    Write-Host 'Could not load the 145-city 668K completion list.' -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

$CityIds = if ($Mode -eq 'Smoke5') {
    $SmokeCities
} elseif ($Mode -eq 'Priority50') {
    @($PlanRecords | Select-Object -First 50 | ForEach-Object { $_.cityId })
} else {
    @($PlanRecords | ForEach-Object { $_.cityId })
}

$CheckpointPath = $null
$FinalJsonPath = $null
$AllCsvPath = $null
$ActiveCsvPath = $null
$ReviewCsvPath = $null
$AllRecords = @()
$BatchSummaries = @()
$CompletedIds = @{}

if ($Resume) {
    $CheckpointFile = $null
    if (-not [string]::IsNullOrWhiteSpace($RunId)) {
        $Candidate = Join-Path $OutputDirectory "GV-CITY-668K-$Mode-$RunId-CHECKPOINT.json"
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
    $CheckpointPath = Join-Path $OutputDirectory "GV-CITY-668K-$Mode-$RunId-CHECKPOINT.json"
}

$Prefix = "GV-CITY-668K-$Mode-$RunId"
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
Write-Host 'Policy: 668E multi-window flights, regional origin anchors, approved gateways, flight comfort, and diversified Agoda quality candidates. This wave completes the Current-500 audit foundation.'
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
        monthCount = 3
        stayWindowCount = 3
        maxFlightAttempts = 12
        maxComfortDurationMinutes = 1080
        maxComfortTransfers = 1
        agodaQualityStrategyCount = 2
        agodaQualityMaxResult = 30
    } | ConvertTo-Json -Depth 10

    $CompletedBefore = $AllRecords.Count
    Write-Host ("Checking {0}-{1} of {2}: {3}" -f ($CompletedBefore + 1), ($CompletedBefore + $Chunk.Count), $CityIds.Count, ($Chunk -join ', '))
    try {
        $Response = Invoke-RestMethod -Uri $VerifyUrl -Method Post -Headers $Headers -ContentType 'application/json' -Body $Body -TimeoutSec 420
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
        taskId = 'GV-CITY-668K'
        mode = $Mode
        runId = $RunId
        baseUrl = $BaseUrl
        planVersion = $PlanSummary.version
        planGeneratedAt = $PlanSummary.generatedAt
        startedOrUpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
        completedCount = $AllRecords.Count
        requestedCount = $CityIds.Count
        activationBaseline = $PlanSummary.activationState
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
$ProviderCovered = @($AllRecords | Where-Object { $_.providerCoverage.eligible -eq $true })
$ProductionActive = @($AllRecords | Where-Object { $_.productionActivation.eligible -eq $true })
$ReviewRecords = @($AllRecords | Where-Object { $_.productionActivation.eligible -ne $true })
$BaselineActive = [int]$PlanSummary.activationState.productionActiveCount
$ProjectedActive = $BaselineActive + $ProductionActive.Count

$Final = [pscustomobject]@{
    taskId = 'GV-CITY-668K'
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
    projectedMergedProductionActiveCount = $ProjectedActive
    activationBaselineCurrent500AuditedCount = [int]$PlanSummary.activationState.current500AuditedCount
    projectedCurrent500AuditedCount = [int]$PlanSummary.completionProjection.current500AuditedAfterRun
    projectedTotalAuditedCount = [int]$PlanSummary.completionProjection.totalAuditedAfterRun
    current500CompletionExpected = $true
    activationImportRequired = $true
    classificationCounts = $ClassificationGroups
    batches = $BatchSummaries
    records = $AllRecords
}
Save-Json $Final $FinalJsonPath

$CsvRows = $AllRecords | Select-Object cityId, displayName, country, countryCode, selectionTier, classification,
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
Write-Host ("Projected total after reviewed import: {0}" -f $ProjectedActive)
Write-Host ("Projected Current-500 audited after this run: {0}/500" -f $PlanSummary.completionProjection.current500AuditedAfterRun)
Write-Host 'Classification counts:'
$ClassificationGroups | Format-Table -AutoSize
Write-Host "`nUpload this file to ChatGPT:"
Write-Host $FinalJsonPath -ForegroundColor Yellow
Write-Host "`nOther files:"
Write-Host $AllCsvPath
Write-Host $ActiveCsvPath
Write-Host $ReviewCsvPath
Write-Host $CheckpointPath
