param(
  [string]$OutputName = 'globevoy-launch-first-backend',
  [switch]$EnableProductionAccounts,
  [string]$ActivityConfigPath
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$source = Join-Path $repo 'backend'
$cache = Join-Path $repo '.cache'
$stage = Join-Path $cache $OutputName
$zipPath = Join-Path $cache ($OutputName + '.zip')
if ($OutputName -notmatch '^[a-zA-Z0-9_-]+$') { throw 'OutputName must be letters, numbers, hyphens or underscores.' }
if ((Test-Path $stage) -or (Test-Path $zipPath)) { throw "Refusing to overwrite existing output. Move/remove manually after preserving it: $stage or $zipPath" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or newer is required (production uses 24).' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required.' }
$nodeVersion = (node -p 'process.versions.node').Trim()
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.Split('.')[0]) -lt 22) { throw "Node.js 22 or newer required; found: $nodeVersion" }
$commit = (git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source commit.' }
$dirty = (git -C $repo status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Release source has uncommitted changes. Use a clean checkout first.' }
Write-Host 'Running offline production account API checks (no AWS calls)...'
& node (Join-Path $source 'validation/validate-gv-production-account.js')
if ($LASTEXITCODE -ne 0) { throw 'Offline production account API tests failed.' }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($name in @('lambda.js','production-account-lambda.js')) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $stage $name)
}
foreach ($folder in @('services','data')) {
  if (Test-Path (Join-Path $source $folder)) {
    Copy-Item -LiteralPath (Join-Path $source $folder) -Destination (Join-Path $stage $folder) -Recurse
  }
}
# Reject an accidentally committed/generated runtime artifact in the source tree.
if (Test-Path (Join-Path $source 'services/accounts/auth/production-account-build.json')) { throw 'Generated account config must not exist in backend source.' }
if ($EnableProductionAccounts) {
  $configFile = Join-Path $PSScriptRoot 'production-account-config.json'
  & node -e 'const a=require(process.argv[1]),c=require(process.argv[2]);if(!a.config(c))process.exit(2)' (Join-Path $source 'services/accounts/auth/production-cognito-auth.js') $configFile
  if ($LASTEXITCODE -ne 0) { throw 'Invalid nonsecret production account configuration.' }
  Copy-Item -LiteralPath $configFile -Destination (Join-Path $stage 'services/accounts/auth/production-account-build.json')
}
if (Test-Path (Join-Path $source 'services/analytics/activity-build.json')) { throw 'Generated activity config must not exist in source.' }
# Optional nonsecret build-time activation avoids the existing 4 KB environment limit.
if ($ActivityConfigPath) {
  & node -e 'const fs=require("fs"),a=require(process.argv[1]),c=JSON.parse(fs.readFileSync(process.argv[2]));if(!a.configuration(c))process.exit(2)' (Join-Path $source 'services/analytics/search-activity.js') $ActivityConfigPath
  if ($LASTEXITCODE -ne 0) { throw 'Activity configuration requires explicit privacy approval.' }
  Copy-Item -LiteralPath $ActivityConfigPath -Destination (Join-Path $stage 'services/analytics/activity-build.json')
}
# The package uses the production handler at the ZIP root. The existing public
# handler remains ./lambda.js and is required by production-account-lambda.js.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'backend-dependencies/package.json') -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'backend-dependencies/package-lock.json') -Destination $stage
New-Item -ItemType Directory -Path (Join-Path $stage 'src') | Out-Null
[System.IO.File]::WriteAllText((Join-Path $stage 'src/lambda.js'), "'use strict';`nmodule.exports = require('../production-account-lambda');`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Installing locked DynamoDB dependencies locally (no AWS calls)...'
& npm ci --prefix $stage --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed. No ZIP created.' }
Write-Host 'Verifying packaged entrypoints can be imported...'
& node --check (Join-Path $stage 'lambda.js')
if ($LASTEXITCODE -ne 0) { throw 'Public handler syntax invalid.' }
& node --check (Join-Path $stage 'production-account-lambda.js')
if ($LASTEXITCODE -ne 0) { throw 'Account handler syntax invalid.' }
& node -e 'const api=require(process.argv[1]); if(typeof api.handler!=="function") process.exit(3); console.log("Handler export OK")' (Join-Path $stage 'production-account-lambda.js')
if ($LASTEXITCODE -ne 0) { throw 'Bundled handler import failed.' }
& node -e 'const a=require(process.argv[1]),b=require(process.argv[2]); if(a.handler!==b.handler) process.exit(3)' (Join-Path $stage 'src/lambda.js') (Join-Path $stage 'production-account-lambda.js')
if ($LASTEXITCODE -ne 0) { throw 'Compatibility handler export mismatch.' }
$packageCheck = @((Join-Path $repo 'tests/release/validate-account-package.cjs'), $stage)
if ($EnableProductionAccounts) { $packageCheck += '--enabled' }
& node @packageCheck
if ($LASTEXITCODE -ne 0) { throw 'Packaged configuration/JWT/CRUD regression failed.' }
$sdkVersion = (& node -p 'require(process.argv[1]).version' (Join-Path $stage 'node_modules/@aws-sdk/client-dynamodb/package.json')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Bundled DynamoDB SDK version missing.' }
$manifest = @{
  sourceCommit = $commit
  expectedLambdaHandler = 'src/lambda.handler'
  legacyLambdaHandler = 'lambda.handler'
  nodeVersion = $nodeVersion
  dynamodbSdkVersion = $sdkVersion
  createdAtUtc = [DateTime]::UtcNow.ToString('o')
  productionAccountsIncluded = [bool]$EnableProductionAccounts
  additionalEnvironmentBytes = 0
  awsResourcesModified = $false
  outputMode = 'local-zip-only'
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $stage 'launch-manifest.json'), $manifest, (New-Object System.Text.UTF8Encoding($false)))
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($zip.Entries | ForEach-Object { $_.FullName })
  foreach ($required in @('lambda.js','production-account-lambda.js','src/lambda.js','launch-manifest.json','package.json')) {
    if ($entries -notcontains $required) { throw "Backend ZIP missing root entry: $required" }
  }
  if (@($entries | Where-Object { $_ -match '(^|/)(archive|validation)/' }).Count -gt 0) { throw 'Backend ZIP unexpectedly includes archive or validation files.' }
} finally { $zip.Dispose() }
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
Write-Host ''
Write-Host ('Local build ready: ' + $zipPath)
Write-Host ('SHA256: ' + $hash)
Write-Host 'Expected handler for this ZIP: src/lambda.handler'
Write-Host 'AWS resources/deployments modified: NONE'
Write-Host 'Do not upload or change Lambda handler before billing authorization, rollback backup and browser acceptance.'
