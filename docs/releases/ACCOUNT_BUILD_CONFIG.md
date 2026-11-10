# Account configuration without Lambda environment growth

This supersedes the environment-variable account activation instructions in the earlier release handoff. Production remains on verified rollback revision `814e174c-fbab-444a-aac4-09df7f7e2bbf`; this change does not deploy anything.

## Mechanism

`ops/release/production-account-config.json` contains only schema version, explicit account enablement, canonical origin, production pool/client identifiers and dedicated table name. These are nonsecret resource identifiers. The packager copies it into `services/accounts/auth/production-account-build.json` **only** with `-EnableProductionAccounts`. The generated runtime file must never exist in backend source. Ordinary builds omit it and private endpoints return 503, even if old account environment flags happen to be set.

The production verifier reads this file once at cold start and validates a closed schema. Missing, malformed, disabled or unsupported configuration fails closed. Unknown properties (including credential fields), invalid identifiers, staging pool/client/origins and any table other than the dedicated production table are rejected. Well-formed pool/client identifiers must still be verified against AWS at deployment approval; format validation cannot prove the identity of an arbitrary new resource.

JWT issuer is derived from the configured pool. Exact client, access-token use, scope, expiration, RSA signature and verified token subject remain mandatory. Account requests use only the configured table. Staging-named modules provide shared validation/serialization routines, not staging authentication or staging database configuration. The wrapper delegates all public routes unchanged to lambda.js. It does not assign to process.env or consume account settings from Lambda environment variables.

## Build and verify

Use Node 24, npm, PowerShell, a clean commit, and existing locked dependencies:

```powershell
node scripts/run-tests.mjs repo backend frontend account providers syntax web performance release
node backend/validation/validate-gv-production-account.js
# Default off / rollback build:
./ops/release/package-launch-first-backend.ps1 -OutputName accounts-disabled
# Explicitly enabled production candidate:
./ops/release/package-launch-first-backend.ps1 -OutputName accounts-build-config -EnableProductionAccounts
Get-FileHash .cache/accounts-build-config.zip -Algorithm SHA256
```

Both ZIPs use src/lambda.handler and include the pinned SDK. The packager runs the full production JWT/CRUD regression against assembled modules, checks expected opt-in status and public API delegation, and asserts the process environment is unchanged. CI builds both variants. Tests exercise missing config, malformed/extra fields, staging rejection, auth/security, owner-private CRUD, stale versions, profiles and default-off rollback behavior. Existing public regression groups remain enabled.

The manifest records source commit, inclusion status and **additionalEnvironmentBytes: 0**. Generated timestamps mean a new build can have a different ZIP checksum; record the exact approved ZIP hash. Existing Lambda configuration, environment and provider credentials must remain byte-for-byte unchanged at deployment. This fixes the 4 KB issue with a **code-only** update; do not issue update-function-configuration or add any environment setting.

No release script reads provider credentials or Lambda environment snapshots. Only the reviewed nonsecret schema enters the artifact; unknown keys are rejected before packaging. Generated output, dependencies and AWS snapshots remain ignored under .cache.

## Change, disable and rollback

Change public identifiers only by reviewing the JSON in a focused PR, verifying the actual AWS resources/permissions, rebuilding and approving a new code artifact. Do not edit a live ZIP. Build without the switch to disable accounts; public API remains enabled. No environment toggle is required or supported for this mechanism.

For the first deployment, preserve the current compatible rollback ZIP and exact Lambda environment/configuration. After separate approval: verify account, unchanged revision/environment, ZIP hash and resources; update function code only with RevisionId protection; wait; confirm original environment and handler remain unchanged. Test public endpoints first, then real production tokens/PKCE, CORS and owner-private CRUD/profile operations. Roll back the code if critical acceptance fails.

Restore `.cache/deployment-main-preflight/backend-approval/rollback-compatible.zip` (SHA-256 `1e256c15b358098ad1a530db0cacb971a278a449375a0b2f2fb452699c1e1c0f`) with the unchanged src/lambda.handler to restore the previous public implementation. Original environment remains intact throughout, so no environment restore call is needed. Preserve Cognito/table data and IAM. The untouched original ZIP is also retained. Website deployment is a separate approval gate.

## Limits and risks

This PR is offline-tested preparation, not production deployment or live account acceptance. Configuration is trusted build input, not an authorization token. Enabling the artifact activates private endpoints after a future approved deployment; incorrect pool/client settings will reject real users. Configuration updates require rebuilding. Existing live signup, email delivery, account UI and provider behavior still need production acceptance. No new AWS service or environment storage is introduced.
