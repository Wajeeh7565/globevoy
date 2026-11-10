param(
  [string]$OutputName = 'globevoy-launch-first-backend'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$source = Join-Path $repo 'backend'
$cache = Join-Path $repo '.cache'
$stage = Join-Path $cache $OutputName
$zipPath = Join-Path $cache ($OutputName + '.zip')
if ($OutputName -notmatch '^[a-zA-Z0-9_-]+$') { throw 'OutputName must be letters, numbers, hyphens or underscores.' }
if ((Test-Path $stage) -or (Test-Path $zipPath)) { throw "Refusing to overwrite existing output. Move/remove manually after preserving it: $stage or $zipPath" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24 is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required.' }
$nodeVersion = (node -p 'process.versions.node').Trim()
if ($LASTEXITCODE -ne 0 -or -not $nodeVersion.StartsWith('24.')) { throw "Node.js 24 required; found: $nodeVersion" }
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
# The package uses the production handler at the ZIP root. The existing public
# handler remains ./lambda.js and is required by production-account-lambda.js.
$package = @{
  name = 'globevoy-launch-first-backend';
  version = '1.0.0';
  private = $true;
  description = 'Local production Lambda packaging; never deployed by this script';
  dependencies = @{ '@aws-sdk/client-dynamodb' = '^3.0.0' }
} | ConvertTo-Json -Depth 5
Set-Content -LiteralPath (Join-Path $stage 'package.json') -Value $package -Encoding UTF8
Write-Host 'Installing DynamoDB SDK into isolated build folder (not AWS)...'
& npm install --prefix $stage --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed. No ZIP created.' }
Write-Host 'Verifying packaged entrypoints can be imported...'
& node --check (Join-Path $stage 'lambda.js')
if ($LASTEXITCODE -ne 0) { throw 'Public handler syntax invalid.' }
& node --check (Join-Path $stage 'production-account-lambda.js')
if ($LASTEXITCODE -ne 0) { throw 'Account handler syntax invalid.' }
& node -e 'const api=require(process.argv[1]); if(typeof api.handler!=="function") process.exit(3); console.log("Handler export OK")' (Join-Path $stage 'production-account-lambda.js')
if ($LASTEXITCODE -ne 0) { throw 'Bundled handler import failed.' }
$sdkVersion = (& node -p 'require(process.argv[1]).version' (Join-Path $stage 'node_modules/@aws-sdk/client-dynamodb/package.json')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Bundled DynamoDB SDK version missing.' }
$manifest = @{
  sourceCommit = $commit
  expectedLambdaHandler = 'production-account-lambda.handler'
  legacyLambdaHandler = 'lambda.handler'
  nodeVersion = $nodeVersion
  dynamodbSdkVersion = $sdkVersion
  createdAtUtc = [DateTime]::UtcNow.ToString('o')
  awsResourcesModified = $false
  outputMode = 'local-zip-only'
} | ConvertTo-Json -Depth 5
Set-Content -LiteralPath (Join-Path $stage 'launch-manifest.json') -Value $manifest -Encoding UTF8
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($zip.Entries | ForEach-Object { $_.FullName })
  foreach ($required in @('lambda.js','production-account-lambda.js','launch-manifest.json','package.json')) {
    if ($entries -notcontains $required) { throw "Backend ZIP missing root entry: $required" }
  }
  if (@($entries | Where-Object { $_ -match '(^|/)(archive|validation)/' }).Count -gt 0) { throw 'Backend ZIP unexpectedly includes archive or validation files.' }
} finally { $zip.Dispose() }
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
Write-Host ''
Write-Host ('Local build ready: ' + $zipPath)
Write-Host ('SHA256: ' + $hash)
Write-Host 'Expected handler for this ZIP: production-account-lambda.handler'
Write-Host 'AWS resources/deployments modified: NONE'
Write-Host 'Do not upload or change Lambda handler before billing authorization, rollback backup and browser acceptance.'
