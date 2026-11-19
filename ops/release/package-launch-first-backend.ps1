param(
  [string]$OutputName = 'globevoy-launch-first-backend',
  [switch]$EnableProductionAccounts,
  [switch]$AccountsDisabledForTesting,
  [string]$ActivityConfigPath
)
# Thin wrapper. All checks and the ZIP itself are done by package-backend.cjs in
# Node, so Windows PowerShell 5.1 never has to pass quoted JavaScript to node -e
# (it strips the inner quotes) and Compress-Archive never writes `\` into ZIP
# entry names (which breaks the src/lambda.handler lookup on Lambda).
#
# Production:  .\ops\release\package-launch-first-backend.ps1 -OutputName <name> -EnableProductionAccounts
# CI/testing:  .\ops\release\package-launch-first-backend.ps1 -OutputName <name> -AccountsDisabledForTesting
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or newer is required (production uses 24).' }
$builder = Join-Path $PSScriptRoot 'package-backend.cjs'
$arguments = @($builder, '--output', $OutputName)
if ($EnableProductionAccounts) { $arguments += '--enable-production-accounts' }
if ($AccountsDisabledForTesting) { $arguments += '--accounts-disabled-for-testing' }
if ($ActivityConfigPath) { $arguments += @('--activity-config', $ActivityConfigPath) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Backend packaging failed. No ZIP should be deployed.' }
Write-Host 'Do not upload or change the Lambda handler before rollback backup and approval.'
