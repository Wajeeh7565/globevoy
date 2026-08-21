#!/usr/bin/env bash
set -euo pipefail

# GV-ACCOUNT-705C — staging-only DynamoDB + least-privilege Lambda bootstrap.
# Creates/reuses only the staging saved-trips table, grants the staging Lambda
# exact-table CRUD/query permissions, and adds one table-name environment var.
# It never touches production/main and never creates or prints credentials.

export AWS_PAGER=""

VERSION="GV-ACCOUNT-705C"
REGION="${AWS_REGION:-us-east-2}"
TABLE_NAME="globevoy-staging-saved-trips"
FUNCTION_NAME="globevoy-staging-api"
EXPECTED_HANDLER="staging-lambda-702d.handler"
POLICY_NAME="GlobevoyStagingSavedTrips705C"
ENV_KEY="GLOBEVOY_SAVED_TRIPS_TABLE"
BACKUP_FILE="${HOME}/GV-ACCOUNT-705C-Staging-Lambda-Before.json"

fail(){ printf '[STOP] %s\n' "$*" >&2; exit 1; }
info(){ printf '[INFO] %s\n' "$*"; }
pass(){ printf '[PASS] %s\n' "$*"; }

command -v aws >/dev/null 2>&1 || fail 'AWS CLI is required.'
command -v jq >/dev/null 2>&1 || fail 'jq is required.'

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]] || fail 'Could not resolve AWS account.'

LAMBDA_JSON="$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" --region "$REGION" --output json)"
printf '%s\n' "$LAMBDA_JSON" > "$BACKUP_FILE"
HANDLER="$(jq -r '.Handler // empty' <<<"$LAMBDA_JSON")"
[[ "$HANDLER" == "$EXPECTED_HANDLER" ]] || fail "Unexpected staging handler '$HANDLER'. Refusing mutation."
ROLE_ARN="$(jq -r '.Role // empty' <<<"$LAMBDA_JSON")"
ROLE_NAME="${ROLE_ARN##*/}"
[[ -n "$ROLE_NAME" && "$ROLE_ARN" == arn:aws:iam::*:role/* ]] || fail 'Could not resolve staging Lambda execution role.'

TABLE_EXISTED=false
if TABLE_JSON="$(aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" --output json 2>/dev/null)"; then
  TABLE_EXISTED=true
  info "Reusing existing staging table $TABLE_NAME."
else
  info "Creating staging table $TABLE_NAME in on-demand mode..."
  aws dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --sse-specification Enabled=true,SSEType=KMS \
    --tags Key=Project,Value=Globevoy Key=Environment,Value=staging Key=Release,Value="$VERSION" \
    --region "$REGION" \
    --output json >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
  TABLE_JSON="$(aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" --output json)"
fi

jq -e '.Table.KeySchema == [{"AttributeName":"PK","KeyType":"HASH"},{"AttributeName":"SK","KeyType":"RANGE"}]' <<<"$TABLE_JSON" >/dev/null \
  || fail 'Existing table key schema conflicts with 705C.'
jq -e '.Table.AttributeDefinitions == [{"AttributeName":"PK","AttributeType":"S"},{"AttributeName":"SK","AttributeType":"S"}]' <<<"$TABLE_JSON" >/dev/null \
  || fail 'Existing table attribute definitions conflict with 705C.'
BILLING="$(jq -r '.Table.BillingModeSummary.BillingMode // "PROVISIONED"' <<<"$TABLE_JSON")"
[[ "$BILLING" == "PAY_PER_REQUEST" ]] || fail "Existing table billing mode is '$BILLING', expected PAY_PER_REQUEST."
TABLE_ARN="$(jq -r '.Table.TableArn // empty' <<<"$TABLE_JSON")"
[[ "$TABLE_ARN" == "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE_NAME}" ]] || fail 'Resolved table ARN is not the expected staging table.'
pass "Table schema validated: $TABLE_NAME"

info 'Enabling point-in-time recovery...'
aws dynamodb update-continuous-backups \
  --table-name "$TABLE_NAME" \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --region "$REGION" \
  --output json >/dev/null
PITR="$(aws dynamodb describe-continuous-backups --table-name "$TABLE_NAME" --region "$REGION" --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' --output text)"
[[ "$PITR" == "ENABLED" || "$PITR" == "ENABLING" ]] || fail "Point-in-time recovery status is '$PITR'."
pass "Point-in-time recovery: $PITR"

POLICY_FILE="/tmp/gv-account-705c-ddb-policy.json"
jq -n --arg table "$TABLE_ARN" '{
  Version:"2012-10-17",
  Statement:[{
    Sid:"GlobevoyStagingSavedTrips705C",
    Effect:"Allow",
    Action:[
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem"
    ],
    Resource:$table
  }]
}' > "$POLICY_FILE"

info "Applying exact-table inline policy to staging Lambda role $ROLE_NAME..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document file://"$POLICY_FILE"

POLICY_READBACK="$(aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --query PolicyDocument --output json)"
jq -e --arg table "$TABLE_ARN" '
  .Statement | length == 1 and
  .[0].Effect == "Allow" and
  .[0].Resource == $table and
  ((.[0].Action | sort) == (["dynamodb:Query","dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem"] | sort))
' <<<"$POLICY_READBACK" >/dev/null || fail 'IAM policy readback does not match the exact 705C contract.'
pass 'Least-privilege DynamoDB policy validated.'

CURRENT_VARS="$(jq -c '.Environment.Variables // {}' <<<"$LAMBDA_JSON")"
NEXT_VARS="$(jq -c --arg key "$ENV_KEY" --arg table "$TABLE_NAME" '. + {($key):$table}' <<<"$CURRENT_VARS")"
ENV_FILE="/tmp/gv-account-705c-lambda-env.json"
jq -n --argjson vars "$NEXT_VARS" '{Variables:$vars}' > "$ENV_FILE"

info "Adding $ENV_KEY while preserving every existing Lambda environment variable..."
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --environment file://"$ENV_FILE" \
  --region "$REGION" \
  --output json >/dev/null
aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"

AFTER="$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" --region "$REGION" --output json)"
[[ "$(jq -r '.Handler' <<<"$AFTER")" == "$EXPECTED_HANDLER" ]] || fail 'Lambda handler changed unexpectedly.'
[[ "$(jq -r --arg key "$ENV_KEY" '.Environment.Variables[$key] // empty' <<<"$AFTER")" == "$TABLE_NAME" ]] || fail 'Saved-trips table environment variable was not installed.'
BEFORE_COUNT="$(jq '.Environment.Variables // {} | length' <<<"$LAMBDA_JSON")"
AFTER_COUNT="$(jq '.Environment.Variables // {} | length' <<<"$AFTER")"
[[ "$AFTER_COUNT" -ge "$BEFORE_COUNT" ]] || fail 'Lambda environment variable count decreased unexpectedly.'

printf '\n%s bootstrap complete\n' "$VERSION"
printf 'Table: %s\n' "$TABLE_NAME"
printf 'PITR: %s\n' "$PITR"
printf 'Lambda: %s\n' "$FUNCTION_NAME"
printf 'Handler: %s\n' "$EXPECTED_HANDLER"
printf 'Environment variable: %s=%s\n' "$ENV_KEY" "$TABLE_NAME"
printf 'Prior Lambda configuration backup: %s\n' "$BACKUP_FILE"
printf 'Table existed before this run: %s\n' "$TABLE_EXISTED"
printf 'Production/main changed: false\n'
