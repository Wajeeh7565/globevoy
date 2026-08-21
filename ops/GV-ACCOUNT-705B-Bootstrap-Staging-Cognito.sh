#!/usr/bin/env bash
set -euo pipefail

# GV-ACCOUNT-705B — staging-only Cognito Managed Login bootstrap.
#
# Creates or safely reuses ONLY the staging identity resources needed for the
# next Globevoy account implementation step. It does not deploy Lambda/Amplify,
# does not touch production/main, does not create DynamoDB, and never creates a
# browser client secret.

export AWS_PAGER=""

VERSION="GV-ACCOUNT-705B"
REGION="${AWS_REGION:-us-east-2}"
POOL_NAME="globevoy-staging-users"
CLIENT_NAME="globevoy-staging-web"
RESOURCE_SERVER_IDENTIFIER="globevoy"
RESOURCE_SERVER_NAME="Globevoy staging API"
TRIPS_SCOPE_NAME="trips.write"
TRIPS_SCOPE="${RESOURCE_SERVER_IDENTIFIER}/${TRIPS_SCOPE_NAME}"
CALLBACK_URL="https://staging.dy4fw8gx1ccie.amplifyapp.com/auth-callback.html"
LOGOUT_URL="https://staging.dy4fw8gx1ccie.amplifyapp.com/index.html"
OUTPUT_FILE="${OUTPUT_FILE:-GV-ACCOUNT-705B-Staging-Cognito-Public.json}"

CREATED_POOL=false
CREATED_RESOURCE_SERVER=false
CREATED_CLIENT=false
CREATED_DOMAIN=false
CREATED_BRANDING=false

fail() {
  printf '[STOP] %s\n' "$*" >&2
  exit 1
}

info() {
  printf '[INFO] %s\n' "$*"
}

pass() {
  printf '[PASS] %s\n' "$*"
}

none_or_empty() {
  local value="${1:-}"
  [[ -z "$value" || "$value" == "None" || "$value" == "null" ]]
}

on_error() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    printf '[STOP] %s stopped with exit code %s. Safe resources created earlier in this run are not deleted automatically. Re-run the same script after fixing the reported issue; it validates/reuses matching resources and fails closed on conflicts.\n' "$VERSION" "$code" >&2
  fi
}
trap on_error EXIT

command -v aws >/dev/null 2>&1 || fail 'AWS CLI is required.'
command -v jq >/dev/null 2>&1 || fail 'jq is required (AWS CloudShell includes it).'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum is required.'

# Managed Login v2 branding commands are required. --generate-cli-skeleton is
# local validation only and sends no AWS request.
aws cognito-idp create-managed-login-branding --generate-cli-skeleton input >/dev/null 2>&1 \
  || fail 'AWS CLI is too old for Cognito Managed Login branding. Update AWS CLI v2 and retry.'
aws cognito-idp describe-managed-login-branding-by-client --generate-cli-skeleton input >/dev/null 2>&1 \
  || fail 'AWS CLI is too old for DescribeManagedLoginBrandingByClient. Update AWS CLI v2 and retry.'

# The AWS account number is used only inside this process to derive a globally
# unique, non-identifying domain suffix. It is never printed or written to the
# public config returned for frontend wiring.
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]] || fail 'Could not resolve the AWS account context.'
DOMAIN_SUFFIX="$(printf '%s:%s' "$ACCOUNT_ID" "$REGION" | sha256sum | awk '{print substr($1,1,10)}')"
[[ "$DOMAIN_SUFFIX" =~ ^[0-9a-f]{10}$ ]] || fail 'Could not derive a safe staging domain suffix.'
DOMAIN_PREFIX="globevoy-stg-${DOMAIN_SUFFIX}"
DOMAIN_BASE="https://${DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com"
ISSUER_BASE="https://cognito-idp.${REGION}.amazonaws.com"

printf '\n%s staging bootstrap\n' "$VERSION"
printf 'Region: %s\n' "$REGION"
printf 'Pool name: %s\n' "$POOL_NAME"
printf 'Client name: %s\n' "$CLIENT_NAME"
printf 'Callback: %s\n' "$CALLBACK_URL"
printf 'Domain prefix: %s\n\n' "$DOMAIN_PREFIX"

# ---------------------------------------------------------------------------
# 1. User pool: public email self-sign-up, email verification, Essentials tier.
# ---------------------------------------------------------------------------
POOLS_JSON="$(aws cognito-idp list-user-pools --max-results 60 --max-items 200 --region "$REGION" --output json)"
POOL_MATCH_COUNT="$(jq --arg name "$POOL_NAME" '[.UserPools[]? | select(.Name == $name)] | length' <<<"$POOLS_JSON")"
[[ "$POOL_MATCH_COUNT" -le 1 ]] || fail "More than one Cognito user pool is named '$POOL_NAME'. Refusing ambiguous reuse."

POOL_ID="$(jq -r --arg name "$POOL_NAME" '.UserPools[]? | select(.Name == $name) | .Id' <<<"$POOLS_JSON")"
if none_or_empty "$POOL_ID"; then
  info 'Creating staging Cognito user pool...'
  POOL_INPUT="$(jq -n \
    --arg poolName "$POOL_NAME" \
    '{
      PoolName: $poolName,
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
      AdminCreateUserConfig: {AllowAdminCreateUserOnly: false},
      AccountRecoverySetting: {RecoveryMechanisms: [{Priority: 1, Name: "verified_email"}]},
      UserPoolTier: "ESSENTIALS",
      DeletionProtection: "INACTIVE",
      UserPoolTags: {Project: "Globevoy", Environment: "staging", Release: "GV-ACCOUNT-705B"}
    }')"
  POOL_ID="$(aws cognito-idp create-user-pool \
    --cli-input-json "$POOL_INPUT" \
    --region "$REGION" \
    --query 'UserPool.Id' \
    --output text)"
  CREATED_POOL=true
else
  info "Reusing existing staging user pool $POOL_ID."
fi

[[ "$POOL_ID" =~ ^[A-Za-z0-9_-]+$ ]] || fail 'Resolved user pool ID is invalid.'

POOL_DESC="$(aws cognito-idp describe-user-pool --user-pool-id "$POOL_ID" --region "$REGION" --output json)"
jq -e --arg name "$POOL_NAME" '.UserPool.Name == $name' <<<"$POOL_DESC" >/dev/null \
  || fail 'Existing user pool name does not match the 705B contract.'
jq -e '.UserPool.UsernameAttributes | index("email") != null' <<<"$POOL_DESC" >/dev/null \
  || fail 'Existing user pool is not email-as-username.'
jq -e '.UserPool.AutoVerifiedAttributes | index("email") != null' <<<"$POOL_DESC" >/dev/null \
  || fail 'Existing user pool does not auto-verify email.'
jq -e '.UserPool.AdminCreateUserConfig.AllowAdminCreateUserOnly == false' <<<"$POOL_DESC" >/dev/null \
  || fail 'Existing user pool has self-service sign-up disabled.'
jq -e '.UserPool.UserPoolTier == "ESSENTIALS" or .UserPool.UserPoolTier == "PLUS"' <<<"$POOL_DESC" >/dev/null \
  || fail 'Existing user pool is not on a Managed-Login-capable Essentials/Plus tier.'
pass "Staging user pool contract validated: $POOL_ID"

# ---------------------------------------------------------------------------
# 2. Resource server + custom saved-trip write scope.
# ---------------------------------------------------------------------------
RESOURCE_SERVER_JSON=""
if RESOURCE_SERVER_JSON="$(aws cognito-idp describe-resource-server \
  --user-pool-id "$POOL_ID" \
  --identifier "$RESOURCE_SERVER_IDENTIFIER" \
  --region "$REGION" \
  --output json 2>/dev/null)"; then
  info "Reusing resource server '$RESOURCE_SERVER_IDENTIFIER'."
else
  info "Creating resource server '$RESOURCE_SERVER_IDENTIFIER'..."
  RESOURCE_SERVER_INPUT="$(jq -n \
    --arg pool "$POOL_ID" \
    --arg identifier "$RESOURCE_SERVER_IDENTIFIER" \
    --arg name "$RESOURCE_SERVER_NAME" \
    --arg scope "$TRIPS_SCOPE_NAME" \
    '{
      UserPoolId: $pool,
      Identifier: $identifier,
      Name: $name,
      Scopes: [{ScopeName: $scope, ScopeDescription: "Create and manage the signed-in user saved trips"}]
    }')"
  aws cognito-idp create-resource-server \
    --cli-input-json "$RESOURCE_SERVER_INPUT" \
    --region "$REGION" \
    --query 'ResourceServer.Identifier' \
    --output text >/dev/null
  CREATED_RESOURCE_SERVER=true
  RESOURCE_SERVER_JSON="$(aws cognito-idp describe-resource-server \
    --user-pool-id "$POOL_ID" \
    --identifier "$RESOURCE_SERVER_IDENTIFIER" \
    --region "$REGION" \
    --output json)"
fi

jq -e --arg scope "$TRIPS_SCOPE_NAME" '.ResourceServer.Scopes | map(.ScopeName) | index($scope) != null' <<<"$RESOURCE_SERVER_JSON" >/dev/null \
  || fail "Resource server exists but required scope '$TRIPS_SCOPE' is missing. Refusing silent mutation."
pass "OAuth resource scope validated: $TRIPS_SCOPE"

# ---------------------------------------------------------------------------
# 3. Public browser app client: code grant only, no client secret.
# ---------------------------------------------------------------------------
CLIENTS_JSON="$(aws cognito-idp list-user-pool-clients \
  --user-pool-id "$POOL_ID" \
  --max-results 60 \
  --region "$REGION" \
  --output json)"
CLIENT_MATCH_COUNT="$(jq --arg name "$CLIENT_NAME" '[.UserPoolClients[]? | select(.ClientName == $name)] | length' <<<"$CLIENTS_JSON")"
[[ "$CLIENT_MATCH_COUNT" -le 1 ]] || fail "More than one app client is named '$CLIENT_NAME'. Refusing ambiguous reuse."

CLIENT_ID="$(jq -r --arg name "$CLIENT_NAME" '.UserPoolClients[]? | select(.ClientName == $name) | .ClientId' <<<"$CLIENTS_JSON")"
if none_or_empty "$CLIENT_ID"; then
  info 'Creating public staging browser app client (no secret)...'
  CLIENT_INPUT="$(jq -n \
    --arg pool "$POOL_ID" \
    --arg name "$CLIENT_NAME" \
    --arg callback "$CALLBACK_URL" \
    --arg logout "$LOGOUT_URL" \
    --arg customScope "$TRIPS_SCOPE" \
    '{
      UserPoolId: $pool,
      ClientName: $name,
      GenerateSecret: false,
      RefreshTokenValidity: 1,
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      TokenValidityUnits: {AccessToken: "minutes", IdToken: "minutes", RefreshToken: "days"},
      SupportedIdentityProviders: ["COGNITO"],
      CallbackURLs: [$callback],
      LogoutURLs: [$logout],
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "email", "profile", $customScope],
      AllowedOAuthFlowsUserPoolClient: true,
      PreventUserExistenceErrors: "ENABLED",
      EnableTokenRevocation: true
    }')"
  CLIENT_ID="$(aws cognito-idp create-user-pool-client \
    --cli-input-json "$CLIENT_INPUT" \
    --region "$REGION" \
    --query 'UserPoolClient.ClientId' \
    --output text)"
  CREATED_CLIENT=true
else
  info "Reusing existing app client $CLIENT_ID."
fi

[[ "$CLIENT_ID" =~ ^[A-Za-z0-9_+]+$ ]] || fail 'Resolved app client ID is invalid.'

CLIENT_DESC="$(aws cognito-idp describe-user-pool-client \
  --user-pool-id "$POOL_ID" \
  --client-id "$CLIENT_ID" \
  --region "$REGION" \
  --output json)"

jq -e '.UserPoolClient.ClientSecret == null' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing staging browser app client has a client secret. Refusing reuse.'
jq -e '.UserPoolClient.AllowedOAuthFlowsUserPoolClient == true' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing app client does not have the Cognito OAuth authorization server enabled.'
jq -e '.UserPoolClient.AllowedOAuthFlows == ["code"]' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing app client is not code-grant-only.'
jq -e --arg callback "$CALLBACK_URL" '.UserPoolClient.CallbackURLs == [$callback]' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing app client callback allowlist conflicts with 705B.'
jq -e --arg logout "$LOGOUT_URL" '.UserPoolClient.LogoutURLs == [$logout]' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing app client logout allowlist conflicts with 705B.'
jq -e --arg custom "$TRIPS_SCOPE" '(["openid","email","profile",$custom] - .UserPoolClient.AllowedOAuthScopes) | length == 0' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing app client is missing one or more required OAuth scopes.'
jq -e '.UserPoolClient.SupportedIdentityProviders | index("COGNITO") != null' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing app client does not support native Cognito users.'
jq -e '.UserPoolClient.PreventUserExistenceErrors == "ENABLED"' <<<"$CLIENT_DESC" >/dev/null \
  || fail 'Existing app client does not prevent user-existence disclosure.'
pass "Public code-grant app client validated: $CLIENT_ID (no secret)"

# ---------------------------------------------------------------------------
# 4. Prefix domain with Managed Login v2.
# ---------------------------------------------------------------------------
POOL_DOMAIN="$(jq -r '.UserPool.Domain // empty' <<<"$POOL_DESC")"
if [[ -n "$POOL_DOMAIN" && "$POOL_DOMAIN" != "$DOMAIN_PREFIX" ]]; then
  fail "User pool already has a different domain '$POOL_DOMAIN'. Refusing to replace it."
fi

DOMAIN_DESC="$(aws cognito-idp describe-user-pool-domain \
  --domain "$DOMAIN_PREFIX" \
  --region "$REGION" \
  --output json)"
DOMAIN_OWNER="$(jq -r '.DomainDescription.UserPoolId // empty' <<<"$DOMAIN_DESC")"

if [[ -n "$DOMAIN_OWNER" && "$DOMAIN_OWNER" != "$POOL_ID" ]]; then
  fail "Desired domain prefix '$DOMAIN_PREFIX' is already owned by another user pool."
fi

if [[ -z "$DOMAIN_OWNER" ]]; then
  info 'Creating Cognito Managed Login v2 prefix domain...'
  aws cognito-idp create-user-pool-domain \
    --user-pool-id "$POOL_ID" \
    --domain "$DOMAIN_PREFIX" \
    --managed-login-version 2 \
    --region "$REGION" \
    --query 'ManagedLoginVersion' \
    --output text >/dev/null
  CREATED_DOMAIN=true
fi

# Prefix domains can take about a minute to propagate; configuration metadata is
# normally available immediately. Retry description briefly without browsing it.
DOMAIN_OWNER=""
DOMAIN_VERSION=""
for _ in {1..12}; do
  DOMAIN_DESC="$(aws cognito-idp describe-user-pool-domain --domain "$DOMAIN_PREFIX" --region "$REGION" --output json)"
  DOMAIN_OWNER="$(jq -r '.DomainDescription.UserPoolId // empty' <<<"$DOMAIN_DESC")"
  DOMAIN_VERSION="$(jq -r '.DomainDescription.ManagedLoginVersion // empty' <<<"$DOMAIN_DESC")"
  if [[ "$DOMAIN_OWNER" == "$POOL_ID" && "$DOMAIN_VERSION" == "2" ]]; then
    break
  fi
  sleep 5
done

[[ "$DOMAIN_OWNER" == "$POOL_ID" ]] || fail 'Cognito domain did not attach to the staging user pool.'
[[ "$DOMAIN_VERSION" == "2" ]] || fail 'Cognito domain is not Managed Login version 2.'
pass "Managed Login v2 domain validated: $DOMAIN_BASE"

# ---------------------------------------------------------------------------
# 5. Default Managed Login branding assigned to the public app client.
# ---------------------------------------------------------------------------
BRANDING_JSON=""
if BRANDING_JSON="$(aws cognito-idp describe-managed-login-branding-by-client \
  --user-pool-id "$POOL_ID" \
  --client-id "$CLIENT_ID" \
  --region "$REGION" \
  --output json 2>/dev/null)"; then
  BRANDING_ID="$(jq -r '.ManagedLoginBranding.ManagedLoginBrandingId // empty' <<<"$BRANDING_JSON")"
else
  BRANDING_ID=""
fi

if [[ -z "$BRANDING_ID" ]]; then
  info 'Assigning Cognito-provided Managed Login branding to the app client...'
  BRANDING_ID="$(aws cognito-idp create-managed-login-branding \
    --user-pool-id "$POOL_ID" \
    --client-id "$CLIENT_ID" \
    --use-cognito-provided-values \
    --region "$REGION" \
    --query 'ManagedLoginBranding.ManagedLoginBrandingId' \
    --output text)"
  CREATED_BRANDING=true
fi

[[ "$BRANDING_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || fail 'Managed Login branding ID could not be validated.'
pass "Managed Login branding assigned: $BRANDING_ID"

# ---------------------------------------------------------------------------
# 6. Export ONLY public, non-secret frontend/bootstrap values.
# ---------------------------------------------------------------------------
ISSUER="${ISSUER_BASE}/${POOL_ID}"
AUTHORIZE_ENDPOINT="${DOMAIN_BASE}/oauth2/authorize"
TOKEN_ENDPOINT="${DOMAIN_BASE}/oauth2/token"
LOGOUT_ENDPOINT="${DOMAIN_BASE}/logout"

jq -n \
  --arg version "$VERSION" \
  --arg region "$REGION" \
  --arg userPoolId "$POOL_ID" \
  --arg clientId "$CLIENT_ID" \
  --arg issuer "$ISSUER" \
  --arg domainPrefix "$DOMAIN_PREFIX" \
  --arg domainBaseUrl "$DOMAIN_BASE" \
  --arg authorizeEndpoint "$AUTHORIZE_ENDPOINT" \
  --arg tokenEndpoint "$TOKEN_ENDPOINT" \
  --arg logoutEndpoint "$LOGOUT_ENDPOINT" \
  --arg callbackUrl "$CALLBACK_URL" \
  --arg logoutUrl "$LOGOUT_URL" \
  --arg customScope "$TRIPS_SCOPE" \
  --arg brandingId "$BRANDING_ID" \
  --argjson createdPool "$CREATED_POOL" \
  --argjson createdResourceServer "$CREATED_RESOURCE_SERVER" \
  --argjson createdClient "$CREATED_CLIENT" \
  --argjson createdDomain "$CREATED_DOMAIN" \
  --argjson createdBranding "$CREATED_BRANDING" \
  '{
    version: $version,
    environment: "staging",
    region: $region,
    userPoolId: $userPoolId,
    clientId: $clientId,
    clientSecretPresent: false,
    issuer: $issuer,
    domainPrefix: $domainPrefix,
    domainBaseUrl: $domainBaseUrl,
    authorizeEndpoint: $authorizeEndpoint,
    tokenEndpoint: $tokenEndpoint,
    logoutEndpoint: $logoutEndpoint,
    callbackUrl: $callbackUrl,
    logoutUrl: $logoutUrl,
    oauth: {
      flow: "authorization-code-pkce",
      pkceMethod: "S256",
      scopes: ["openid", "email", "profile", $customScope],
      apiTokenUse: "access"
    },
    managedLogin: {
      version: 2,
      brandingId: $brandingId
    },
    createdByThisRun: {
      userPool: $createdPool,
      resourceServer: $createdResourceServer,
      appClient: $createdClient,
      domain: $createdDomain,
      branding: $createdBranding
    },
    safety: {
      productionChanged: false,
      lambdaChanged: false,
      amplifyChanged: false,
      dynamodbChanged: false,
      clientSecretCreated: false,
      awsCredentialsExposedToBrowser: false
    }
  }' > "$OUTPUT_FILE"

chmod 600 "$OUTPUT_FILE" 2>/dev/null || true

printf '\n===== %s PUBLIC CONFIG =====\n' "$VERSION"
cat "$OUTPUT_FILE"
printf '\n'
pass "Public staging config written to $OUTPUT_FILE"
printf '[NEXT] Return this PUBLIC JSON to ChatGPT. It intentionally contains no client secret and no AWS account number. Do not paste AWS access keys, session tokens, passwords or unrelated credentials.\n'

trap - EXIT
