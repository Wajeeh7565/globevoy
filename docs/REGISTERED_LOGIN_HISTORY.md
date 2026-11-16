# Registered-user authentication history — review, NOT enabled

This change is separate from PR #135. It does not modify the customer API, frontend,
Saved Trips table or anonymous search analytics. Guests still search without signing in.

## What is trustworthy and what is NOT an exact login count

The classic client in `frontend/scripts/auth-session-705b-r3.js` exchanges a hosted
Cognito authorization code with PKCE, then verifies the access token through
`/api/account/session`. Loading a page, verifying a token and refreshing a token
are not sign-ins. We deliberately add no tracking to these browser/API paths.
The production provisioning script configures the existing public code-flow client
with the COGNITO identity provider. Current live configuration must be rechecked:
the AWS session expired during this task, so no current trigger inventory is asserted.

AWS documents PostAuthentication_Authentication as occurring after authentication,
before tokens are delivered. A dedicated Lambda accepts only that source, the
approved production pool/client/region, and Cognito userAttributes.sub. It never
accepts a browser-supplied identity or clientMetadata. A resource policy restricts
invocation to that pool/account; the runtime cannot authenticate an arbitrary forged
Lambda event by itself, so direct InvokeFunction permissions must remain restricted.
Federated providers and remembered hosted-SSO sessions are not claimed as covered.

**Important limit:** Cognito's documented post-auth event has no stable authentication
event ID or original sign-in timestamp. Lambda awsRequestId prevents duplicate writes
for a replay of the SAME invocation while its row is retained only. A new invocation caused by a Cognito retry
has a different ID and may count twice. A failed writer is intentionally not retried
and may undercount. Authentication can succeed at the trigger but token delivery or
the browser callback can subsequently fail. The server timestamp is observation time,
not a guarantee of the exact original authentication time.

Consequently the report calls the metric **observed post-authentication events**,
not exact unique logins, active users, sessions or completed OAuth logins. It includes
`exactUniqueLoginCount: false`. No time-window heuristic merges two legitimate logins.
A requirement for exactly-once successful completed-logins needs a separately verified
upstream success event with a stable event ID (for example a suitable audited service
event). That integration is NOT established here. Do not enable this under an exact
login-count claim. The trigger also cannot promise failure-proof authentication:
ordinary DDB errors return the original event, but a Lambda/platform timeout or broken
trigger attachment can block Cognito. Detaching the trigger is the recovery path.

Source: [AWS post-auth trigger documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-authentication.html).

## Code and data

- `backend/services/accounts/login-history/post-authentication.cjs`: isolated Lambda
  entry point, disabled unless explicitly enabled. Validates source and writes a
  whitelist of attributes; ignores all other event fields. One bounded DDB request,
  zero SDK retries. Returns the original Cognito event after handled write failures.
- Separate `globevoy-production-login-history` on-demand encrypted table. No access to
  Saved Trips or search analytics. PK is USER# plus Cognito sub (a **personal/pseudonymous
  identifier**, not anonymous data). SK is AUTH# plus invocation UUID.
- Each record has UTC `authenticatedAt`, expiry seconds, kind and schema version.
  No email/name/password/token/IP/device/clientMetadata or raw event is stored/logged.
- `ops/login-history/counts.py`: IAM-controlled operator-only Query, no HTTP endpoint.
  Counts unexpired observations for one verified sub since a UTC boundary, paginates,
  filters expired rows even before DynamoDB deletes them. No lifetime counter is kept.
  Concurrent writes can make paginated reporting non-snapshot-consistent; this is an
  operational summary, not a billing/audit ledger.
- Sanitized operational statuses only: Recorded, Duplicate, Rejected, WriteFailed.
  Logs retained 14 days; provisioned error/WriteFailed alarms have no notification
  destination until an owner approves one. No raw exception logging.

Example record (synthetic; never acceptance evidence):

```json
{"PK":{"S":"USER#11111111-1111-4111-8111-111111111111"},"SK":{"S":"AUTH#22222222-2222-4222-8222-222222222222"},"authenticatedAt":{"S":"2026-11-16T23:59:59.999Z"},"expiresAt":{"N":"1797465599"},"kind":{"S":"cognito_post_authentication_observed"},"schemaVersion":{"N":"1"}}
```

## Privacy/retention approval required

Proposed 30 days, configurable 1–90 days only after owner privacy approval. This is
**not covered by approval of anonymous analytics retention**. Expiry is based on UTC
epoch seconds; DynamoDB TTL deletion is asynchronous, typically within a few days.
Reporting excludes expired records immediately. TTL is not exact scheduled deletion.
Reducing retention only affects NEW records; existing records need a separately
approved expiry update/deletion. Increasing retention must not silently extend old
records. No backups/PITR/export are enabled by this template. Retain deletion policy
prevents accidental stack deletion destroying records; explicit privacy erasure and
complete teardown require a reviewed table deletion/targeted user-erasure procedure.
Before enabling, update the published privacy notice (`frontend/pages/privacy.html`)
to disclose account authentication history, purpose, sub identifier, retention,
operator access, request-for-erasure process and delayed physical TTL deletion.
No privacy wording is published by this PR.

## Build/test without AWS

```powershell
node --test tests/backend/login-history.test.cjs
python -B tests/backend/login-history-report.test.py
npm run test:account
node ops/login-history/package.mjs
# Output: .cache/login-history-package.zip plus SHA-256.
# ZIP entry index.cjs; handler index.handler. Existing locked SDK dependencies included.
```

Never include .env, credentials, customer data, repo-wide node_modules or logs.
The isolated package uses the existing locked backend dependency manifest, not
runtime-provided unpinned SDK versions. Packaging does not enable tracking.

Authorized operator example (after approved deployment/reader-policy attachment):

```powershell
python ops/login-history/counts.py --sub <verified-cognito-sub> --since 2026-11-01T00:00:00Z
```

Example output: metric observed_post_authentication_events, count 3,
exactUniqueLoginCount false, scope unexpired retained records only.
No customer-facing cross-user access is introduced. Reader policy is unattached by
default; attach only to approved human/operator role. Query permission is table-wide,
so operators can inspect all login records: review access and do not grant it to users.

## Exact deployment prerequisites — NONE applied by this PR

1. Renew AWS authentication; verify expected account ending 3409, us-east-2, live pool,
   client, providers, hosted flow and complete existing LambdaConfig. Check for existing
   post-auth triggers: do not overwrite one or chain silently. Review all trigger retry,
   SSO and failure semantics with the owner. Obtain acceptance of observation-count
   limitations or stop for a stable upstream event integration.
2. Owner approves privacy disclosure, linked-identity retention, monitoring recipients,
   IAM, costs, artifact location and a controlled real-login acceptance test.
3. Build isolated ZIP, hash/review it; use an approved EXISTING artifact bucket. Template
   creates no bucket. Do not upload or create a new storage service without approval.
4. Review unexecuted CloudFormation change set for `ops/login-history/stack.json`:
   dedicated table, trigger Lambda/role/log group, scoped pool invoke permission,
   unattached reader policy, metric filter and two alarms. Function defaults OFF.
   No Cognito pool, production API/IAM role, hosting or search-table mutation in template.
5. After explicit infrastructure approval execute that change set; verify permissions.
   Enabling requires separate approved LOGIN_HISTORY_ENABLED=true on the NEW function
   only, followed by a reviewed merge of its ARN into existing Cognito LambdaConfig's
   PostAuthentication field. Preserve every other pool setting/trigger. Never run an
   incomplete update-user-pool command: unspecified fields can reset defaults.
6. Conduct real existing synthetic-user sign-in acceptance: exactly one observation
   for one controlled normal invocation, correct sub/UTC/TTL, no sensitive data;
   demonstrate no writes from page/session checks or refresh. Test writer failure,
   trigger behavior and rollback carefully before wider enablement. No users/passwords
   are changed by this PR. Current code/tests provide OFFLINE evidence only.
7. Attach reader policy only to approved operator; configure approved alarm actions,
   billing alert and budget through separate approval. No billing email selected here.

Rollback: restore the complete saved Cognito LambdaConfig (detach only this newly
attached trigger while preserving others), then disable the new function. Do not
replace or disable production API Lambda. Preserve table for approved retention;
explicit deletion requires privacy/owner review. Any new trigger could impair sign-in
if misconfigured; verify sign-in immediately after attachment and detachment.

## Costs and readiness

No charges have been incurred by this change. New paid resources would be one small
Lambda invocation and one <=1KB conditional standard DDB write per observation (larger
records use more units), retained storage, operator Query read units, logs, one custom
metric and two standard alarms. Duplicate conditional failures may consume read units.
At indicative us-east-2 list pricing before free tiers: DDB ~$0.625/million write units,
~$0.125/million read units, storage ~$0.25/GB-month; Lambda ~$0.20/million requests plus
compute, custom metric ~$0.30/month and alarms ~$0.10 each/month plus log ingestion.
For 10,000 small events/month, writes are about $0.0063; monitoring likely dominates
at about $0.50/month plus logs/reads/compute/storage. Recheck AWS published regional
prices before approval. No budgets, notifications or resources are created now.

GO for code review; NO-GO for enabling exact unique-login counts or production tracking
until live configuration, privacy/metric semantics, retention, costs, permissions,
artifact hash and rollback are approved and real-login acceptance succeeds.

References: [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [Cognito trigger deadlines/retries](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html), [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html).
