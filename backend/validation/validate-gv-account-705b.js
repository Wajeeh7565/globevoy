'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const account705A = require('../services/accounts/architecture/account-architecture-705a');

const ROOT = path.join(BACKEND_ROOT, '..');
const SCRIPT = path.join(ROOT, 'ops', 'GV-ACCOUNT-705B-Bootstrap-Staging-Cognito.sh');
const script = fs.readFileSync(SCRIPT, 'utf8');

assert.equal(account705A.VERSION, 'GV-ACCOUNT-705A');
assert(script.startsWith('#!/usr/bin/env bash\nset -euo pipefail'));
assert(script.includes('VERSION="GV-ACCOUNT-705B"'));
assert(script.includes('REGION="${AWS_REGION:-us-east-2}"'));
assert(script.includes('POOL_NAME="globevoy-staging-users"'));
assert(script.includes('CLIENT_NAME="globevoy-staging-web"'));
assert(script.includes('RESOURCE_SERVER_IDENTIFIER="globevoy"'));
assert(script.includes('TRIPS_SCOPE_NAME="trips.write"'));
assert(script.includes('TRIPS_SCOPE="${RESOURCE_SERVER_IDENTIFIER}/${TRIPS_SCOPE_NAME}"'));
assert(script.includes('CALLBACK_URL="https://staging.dy4fw8gx1ccie.amplifyapp.com/auth-callback.html"'));
assert(script.includes('LOGOUT_URL="https://staging.dy4fw8gx1ccie.amplifyapp.com/index.html"'));

// CloudShell compatibility proved by the real operator run.
assert(script.includes('aws cognito-idp list-user-pools --max-results 60 --region "$REGION" --output json'));
const listPoolsLine = script.split('\n').find(line => line.includes('aws cognito-idp list-user-pools')) || '';
assert.equal(listPoolsLine.includes('--max-items'), false);

// Public browser client: code grant only, with no generated client secret.
assert(script.includes('GenerateSecret: false'));
assert.equal(script.includes('GenerateSecret: true'), false);
assert.equal(script.includes('--generate-secret'), false);
assert(script.includes('AllowedOAuthFlows: ["code"]'));
assert(script.includes('AllowedOAuthFlowsUserPoolClient: true'));
assert(script.includes('AllowedOAuthScopes: ["openid", "email", "profile", $customScope]'));
assert(script.includes('SupportedIdentityProviders: ["COGNITO"]'));
assert(script.includes('PreventUserExistenceErrors: "ENABLED"'));
assert(script.includes('EnableTokenRevocation: true'));
assert(script.includes('ClientSecret == null'));

// User-pool contract: email identity/verification, self-signup, managed-login tier.
assert(script.includes('UsernameAttributes: ["email"]'));
assert(script.includes('AutoVerifiedAttributes: ["email"]'));
assert(script.includes('AllowAdminCreateUserOnly: false'));
assert(script.includes('Name: "verified_email"'));
assert(script.includes('UserPoolTier: "ESSENTIALS"'));
assert(script.includes('DeletionProtection: "INACTIVE"'));

// Managed Login v2 domain + branding.
assert(script.includes('create-user-pool-domain'));
assert(script.includes('--managed-login-version 2'));
assert(script.includes('describe-user-pool-domain'));
assert(script.includes('ManagedLoginVersion'));
assert(script.includes('create-managed-login-branding'));
assert(script.includes('describe-managed-login-branding-by-client'));
assert(script.includes('--use-cognito-provided-values'));

// Resource server scope exists before the app client requests it.
assert(script.includes('create-resource-server'));
assert(script.includes('describe-resource-server'));
assert(script.includes('ScopeName: $scope'));

// Idempotence/fail-closed behavior.
assert(script.includes('POOL_MATCH_COUNT'));
assert(script.includes('CLIENT_MATCH_COUNT'));
assert(script.includes('Refusing ambiguous reuse'));
assert(script.includes('Refusing reuse'));
assert(script.includes('Refusing to replace it'));
assert(script.includes('Refusing silent mutation'));
assert(script.includes('Re-run the same script'));

// The account number is used only to make the domain prefix unique and must not
// be printed or written to the public JSON.
assert(script.includes('ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"'));
assert(script.includes('DOMAIN_SUFFIX="$(printf \'%s:%s\' "$ACCOUNT_ID" "$REGION" | sha256sum'));
assert.equal(script.includes("printf 'AWS account:"), false);
assert.equal(script.includes("printf 'Caller:"), false);
assert.equal(script.includes('accountId: $accountId'), false);
assert.equal(script.includes('--arg accountId'), false);
assert(script.includes('no AWS account number'));

// Public operator output is deliberately non-secret.
for (const marker of [
  'userPoolId: $userPoolId',
  'clientId: $clientId',
  'clientSecretPresent: false',
  'issuer: $issuer',
  'domainBaseUrl: $domainBaseUrl',
  'authorizeEndpoint: $authorizeEndpoint',
  'tokenEndpoint: $tokenEndpoint',
  'logoutEndpoint: $logoutEndpoint',
  'flow: "authorization-code-pkce"',
  'pkceMethod: "S256"',
  'apiTokenUse: "access"',
  'clientSecretCreated: false',
  'awsCredentialsExposedToBrowser: false'
]) assert(script.includes(marker), `missing public-config safety marker: ${marker}`);

// 705B bootstrap is allowed to create Cognito staging resources only.
const forbiddenAwsCommands = [
  /aws\s+lambda\b/,
  /aws\s+amplify\b/,
  /aws\s+dynamodb\b/,
  /aws\s+iam\b/,
  /aws\s+cloudformation\b/,
  /aws\s+cognito-idp\s+delete-/,
  /aws\s+cognito-idp\s+update-/
];
for (const pattern of forbiddenAwsCommands) {
  assert.equal(pattern.test(script), false, `forbidden AWS command matched: ${pattern}`);
}

for (const forbidden of [
  'DUFFEL_ACCESS_TOKEN',
  'AGODA_API_KEY',
  'STAY22_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'https://globevoy.com/auth-callback.html',
  'https://globevoy.com/index.html'
]) {
  assert.equal(script.includes(forbidden), false, `bootstrap contains forbidden secret/production marker: ${forbidden}`);
}

// 705B-R3 is now allowed to wire the verified staging resources into the
// staging wrapper and frontend. The shared production handler must remain free
// of account runtime changes, and unrelated provider/runtime surfaces stay clean.
const productionLambda = fs.readFileSync(path.join(ROOT, 'backend', 'lambda.js'), 'utf8');
const generatedTour = fs.readFileSync(path.join(ROOT, 'backend', 'services/domain/tours/generated-tour.js'), 'utf8');
const runtimeConfig = fs.readFileSync(path.join(ROOT, 'frontend', 'runtime', 'config.js'), 'utf8');
const travelProfileScript = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'travel-profile-675a.js'), 'utf8');
assert.equal(/GV-ACCOUNT-705B|globevoy-staging-users|globevoy-staging-web|\/api\/account\/session/.test(productionLambda), false);
assert.equal(/GV-ACCOUNT-705B|globevoy-staging-users|globevoy-staging-web/.test(generatedTour), false);
assert.equal(/globevoy-staging-users|globevoy-staging-web/.test(runtimeConfig), false);
assert.equal(/globevoy-staging-users|globevoy-staging-web/.test(travelProfileScript), false);

// Guest/local travel profile remains a separate, explicitly non-secure surface.
const indexHtml = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
const profileHtml = fs.readFileSync(path.join(ROOT, 'frontend', 'create-account.html'), 'utf8');
assert(indexHtml.includes('You can continue as a guest.'));
assert(profileHtml.includes('It is not a secure Globevoy account'));

console.log('GV-ACCOUNT-705B validation PASS');
console.log(JSON.stringify({
  version: 'GV-ACCOUNT-705B',
  phase: 'staging-cognito-infrastructure-provisioned',
  region: 'us-east-2',
  auth: 'Cognito-Managed-Login-v2',
  oauthFlow: 'authorization-code-pkce',
  clientSecret: false,
  callback: 'staging-only-exact-url',
  customScope: 'globevoy/trips.write',
  cloudShellListUserPoolsCompatibility: true,
  productionHandlerChanged: false,
  dynamodbChanged: false,
  productionChanged: false
}, null, 2));
