#!/usr/bin/env bash
# GV-ANALYTICS-V1: create the Users + Searches tables, the hash-key secret and the Lambda's
# write-only policy. Safe to re-run: every step skips what already exists. Run in CloudShell
# (us-east-2). Touches nothing else: no Lambda code or settings, no other tables or roles.
set -euo pipefail
REGION=us-east-2
ROLE=globevoy-recommendations-role-tdjd59uh
USERS=globevoy-analytics-users
SEARCHES=globevoy-analytics-searches
SECRET=globevoy/analytics-hash-key
ACCT=$(aws sts get-caller-identity --query Account --output text)

exists() { aws dynamodb describe-table --region $REGION --table-name "$1" >/dev/null 2>&1; }

if ! exists $USERS; then
  aws dynamodb create-table --region $REGION --table-name $USERS --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=userId,AttributeType=S --key-schema AttributeName=userId,KeyType=HASH \
    --deletion-protection-enabled --tags Key=app,Value=globevoy Key=purpose,Value=analytics-v1 >/dev/null
  echo "created $USERS"
else echo "$USERS exists"; fi

if ! exists $SEARCHES; then
  aws dynamodb create-table --region $REGION --table-name $SEARCHES --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=searchId,AttributeType=S AttributeName=userId,AttributeType=S AttributeName=createdAt,AttributeType=S \
    --key-schema AttributeName=searchId,KeyType=HASH \
    --global-secondary-indexes '[{"IndexName":"userId-createdAt","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"KEYS_ONLY"}}]' \
    --deletion-protection-enabled --tags Key=app,Value=globevoy Key=purpose,Value=analytics-v1 >/dev/null
  echo "created $SEARCHES"
else echo "$SEARCHES exists"; fi

aws dynamodb wait table-exists --region $REGION --table-name $USERS
aws dynamodb wait table-exists --region $REGION --table-name $SEARCHES
# Auto-delete: Searches rows expire after 13 months (expiresAt). Users rows have no TTL;
# they are deleted with the account.
if [ "$(aws dynamodb describe-time-to-live --region $REGION --table-name $SEARCHES --query TimeToLiveDescription.TimeToLiveStatus --output text)" != "ENABLED" ]; then
  aws dynamodb update-time-to-live --region $REGION --table-name $SEARCHES --time-to-live-specification Enabled=true,AttributeName=expiresAt >/dev/null
fi
echo "TTL: $(aws dynamodb describe-time-to-live --region $REGION --table-name $SEARCHES --query TimeToLiveDescription.TimeToLiveStatus --output text)"

# Hash key for user IDs: random, generated inside AWS, never printed.
if ! aws secretsmanager describe-secret --region $REGION --secret-id $SECRET >/dev/null 2>&1; then
  KEY=$(aws secretsmanager get-random-password --region $REGION --password-length 64 --exclude-punctuation --query RandomPassword --output text)
  aws secretsmanager create-secret --region $REGION --name $SECRET --description "GlobeVoy analytics: HMAC key for hashed user IDs" --secret-string "$KEY" >/dev/null
  unset KEY; echo "created secret $SECRET"
else echo "secret $SECRET exists"; fi
SECRET_ARN=$(aws secretsmanager describe-secret --region $REGION --secret-id $SECRET --query ARN --output text)

# Lambda: write and read-own-row only on these two tables; read this one secret. No Scan, no Delete.
cat > /tmp/gv-analytics-v1-policy.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"AnalyticsV1Write","Effect":"Allow","Action":["dynamodb:UpdateItem","dynamodb:PutItem","dynamodb:GetItem"],
  "Resource":["arn:aws:dynamodb:$REGION:$ACCT:table/$USERS","arn:aws:dynamodb:$REGION:$ACCT:table/$SEARCHES"]},
 {"Sid":"AnalyticsV1HashKey","Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":"$SECRET_ARN"}]}
JSON
aws iam put-role-policy --role-name $ROLE --policy-name GlobeVoyAnalyticsV1 --policy-document file:///tmp/gv-analytics-v1-policy.json
echo "policy GlobeVoyAnalyticsV1 on $ROLE"
for t in $USERS $SEARCHES; do aws dynamodb describe-table --region $REGION --table-name $t --query 'Table.[TableName,TableStatus,BillingModeSummary.BillingMode,DeletionProtectionEnabled]' --output text; done
