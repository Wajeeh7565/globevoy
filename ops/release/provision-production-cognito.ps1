<#
.SYNOPSIS
  Prepare a separate GlobeVoy production Cognito user pool and OAuth web client.
.DESCRIPTION
  DEFAULT IS READ-ONLY. Run -Apply only after reviewing proposed resource names,
  AWS account, region, pricing, and the backend migration plan.
  Does NOT change Amplify, DNS, IAM, Lambda, databases or staging resources.
  Safe to rerun after partial completion: reuses resources with matching names;
  it never rewrites an existing pool, app client, scope or domain.
.EXAMPLE
  .\ops\release\provision-production-cognito.ps1
.EXAMPLE
  .\ops\release\provision-production-cognito.ps1 -Apply
#>
[CmdletBinding()]
param([switch]$Apply)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$region = 'us-east-2'
$poolName = 'globevoy-production-users'
$clientName = 'globevoy-production-web'
$stagingPoolId = 'us-east-2_MSd9RRHD8'
$stagingClientId = 'o2ohbv50253hjli5s34rbvv79'
$callback = 'https://globevoy.com/auth-callback.html'
$wwwCallback = 'https://www.globevoy.com/auth-callback.html'
$logout = 'https://globevoy.com/index.html'
$wwwLogout = 'https://www.globevoy.com/index.html'

function Invoke-Aws {
  param([Parameter(Mandatory=$true)][string[]]$AwsArguments)
  $result = & aws @AwsArguments --region $region --no-cli-pager --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS request failed: $($AwsArguments[0..1] -join ' ')" }
  $raw = ($result | Out-String).Trim()
  if (!$raw) { return $null }
  return ($raw | ConvertFrom-Json)
}

$identity = Invoke-Aws -AwsArguments @('sts','get-caller-identity')
if ($identity.Account -notmatch '^\d{12}$') { throw 'Could not establish AWS account.' }
$prefix = 'globevoy-prod-' + $identity.Account.Substring(6)
$pools = @(Invoke-Aws -AwsArguments @('cognito-idp','list-user-pools','--max-results','60'))
# list-user-pools returns an object containing UserPools, not a plain array.
$pools = @($pools[0].UserPools)
$existing = @($pools | Where-Object { $_.Name -eq $poolName })
if ($existing.Count -gt 1) { throw 'Multiple production pools match; manual review required.' }

Write-Host "AWS account: $($identity.Account)   Region: $region"
Write-Host "Production pool: $poolName"
Write-Host "Production client: $clientName (public OAuth code+PKCE; no client secret)"
Write-Host "Custom scope: globevoy/trips.write"
Write-Host "Redirect: $callback and $wwwCallback"
Write-Host "Logout: $logout and $wwwLogout"
Write-Host "Cognito hosted-login prefix: $prefix"
Write-Host 'Cognito Lite tier, classic hosted UI; email login/verification, 12+complex password and ACTIVE deletion protection.'
Write-Host 'MFA OFF for initial parity; review MFA, email sending, threat protection and Cognito costs before public launch.'
Write-Host 'No staging users/data are copied. AWS backend and website are NOT changed.'
if ($existing.Count -gt 0) { Write-Host "Existing production pool: $($existing[0].Id) (will not update its settings)" }

if (-not $Apply) {
  Write-Host ''
  Write-Host 'DRY RUN ONLY. No AWS resources were created.'
  Write-Host 'After reviewing this plan, run with -Apply to create/reuse the Cognito resources.'
  exit 0
}

$answer = Read-Host 'To authorize AWS resource creation, type CREATE PRODUCTION COGNITO'
if ($answer -cne 'CREATE PRODUCTION COGNITO') { throw 'Not confirmed; no changes made.' }

if ($existing.Count -eq 1) {
  $poolId = [string]$existing[0].Id
  $existingPool = Invoke-Aws -AwsArguments @('cognito-idp','describe-user-pool','--user-pool-id',$poolId)
  if ($existingPool.UserPool.PSObject.Properties.Name -contains 'UserPoolTier' -and $existingPool.UserPool.UserPoolTier -ne 'LITE') {
    throw 'Existing production pool is not Lite; review pricing and configuration before continuing.'
  }
} else {
  $newPool = Invoke-Aws -AwsArguments @(
    'cognito-idp','create-user-pool',
    '--pool-name',$poolName,
    '--username-attributes','email',
    '--auto-verified-attributes','email',
    '--deletion-protection','ACTIVE',
    '--user-pool-tier','LITE',
    '--mfa-configuration','OFF',
    '--policies','PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true,TemporaryPasswordValidityDays=7}',
    '--account-recovery-setting','RecoveryMechanisms=[{Priority=1,Name=verified_email}]'
  )
  $poolId = [string]$newPool.UserPool.Id
  Write-Host "Created production pool: $poolId"
}
if ($poolId -eq $stagingPoolId) { throw 'Refusing to modify staging user pool.' }

$serverList = Invoke-Aws -AwsArguments @('cognito-idp','list-resource-servers','--user-pool-id',$poolId,'--page-size','25')
$servers = @($serverList.ResourceServers | Where-Object { $_.Identifier -eq 'globevoy' })
if ($servers.Count -eq 0) {
  $null = Invoke-Aws -AwsArguments @(
    'cognito-idp','create-resource-server','--user-pool-id',$poolId,
    '--identifier','globevoy','--name','Globevoy production API',
    '--scopes','ScopeName=trips.write,ScopeDescription=Create_and_manage_saved_trips'
  )
  Write-Host 'Created resource-server scope: globevoy/trips.write'
} elseif (-not @($servers[0].Scopes | Where-Object { $_.ScopeName -eq 'trips.write' }).Count) {
  throw 'Existing resource server is missing trips.write; inspect manually.'
}

$clients = Invoke-Aws -AwsArguments @('cognito-idp','list-user-pool-clients','--user-pool-id',$poolId,'--max-results','60')
$matchingClients = @($clients.UserPoolClients | Where-Object { $_.ClientName -eq $clientName })
if ($matchingClients.Count -gt 1) { throw 'Duplicate production client names; manual review required.' }
if ($matchingClients.Count -eq 1) {
  $clientId = [string]$matchingClients[0].ClientId
  $clientDetail = Invoke-Aws -AwsArguments @('cognito-idp','describe-user-pool-client','--user-pool-id',$poolId,'--client-id',$clientId)
  $client = $clientDetail.UserPoolClient
  if (@($client.CallbackURLs) -notcontains $callback -or @($client.CallbackURLs) -notcontains $wwwCallback -or
      @($client.LogoutURLs) -notcontains $logout -or @($client.LogoutURLs) -notcontains $wwwLogout -or
      @($client.AllowedOAuthFlows) -notcontains 'code' -or
      @($client.AllowedOAuthScopes) -notcontains 'globevoy/trips.write' -or
      ($client.PSObject.Properties.Name -contains 'ClientSecret' -and [bool]$client.ClientSecret)) {
    throw 'Existing production client differs from approved public OAuth configuration; do not overwrite automatically.'
  }
} else {
  $newClient = Invoke-Aws -AwsArguments @(
    'cognito-idp','create-user-pool-client','--user-pool-id',$poolId,
    '--client-name',$clientName,'--no-generate-secret',
    '--allowed-o-auth-flows-user-pool-client',
    '--allowed-o-auth-flows','code',
    '--allowed-o-auth-scopes','openid','email','profile','globevoy/trips.write',
    '--callback-urls',$callback,$wwwCallback,'--logout-urls',$logout,$wwwLogout,
    '--supported-identity-providers','COGNITO',
    '--prevent-user-existence-errors','ENABLED',
    '--enable-token-revocation'
  )
  $clientId = [string]$newClient.UserPoolClient.ClientId
  Write-Host "Created public OAuth client: $clientId"
}
if ($clientId -eq $stagingClientId) { throw 'Refusing to reuse the staging Cognito client.' }

$poolDetail = Invoke-Aws -AwsArguments @('cognito-idp','describe-user-pool','--user-pool-id',$poolId)
$domain = if ($poolDetail.UserPool.PSObject.Properties.Name -contains 'Domain') { [string]$poolDetail.UserPool.Domain } else { '' }
if (!$domain) {
  $null = Invoke-Aws -AwsArguments @(
    'cognito-idp','create-user-pool-domain','--user-pool-id',$poolId,
    '--domain',$prefix,'--managed-login-version','1'
  )
  $domain = $prefix
  Write-Host "Created Cognito hosted-UI prefix: $domain"
} elseif ($domain -ne $prefix) {
  throw "Existing pool domain $domain differs from expected prefix $prefix; review before continuing."
}

Write-Host ''
Write-Host 'PRODUCTION COGNITO RESOURCES PREPARED (frontend and backend NOT activated).'
Write-Host "GLOBEVOY_PRODUCTION_USER_POOL_ID=$poolId"
Write-Host "GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID=$clientId"
Write-Host "GLOBEVOY_PRODUCTION_COGNITO_DOMAIN=https://$domain.auth.$region.amazoncognito.com"
Write-Host 'Do not enable production accounts until JWT validation, owner-private API, storage, CORS and browser login tests pass.'
