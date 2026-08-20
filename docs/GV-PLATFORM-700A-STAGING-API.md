# GV-PLATFORM-700A — Isolated staging backend

Status: staging-only infrastructure. No production deployment is performed by this work.

## Goal

Give the Amplify `staging` frontend its own Lambda Function URL so feature work can be tested without changing the production Lambda used by `https://globevoy.com`.

Target shape:

`GitHub feature/* → CI → staging → Amplify staging → isolated staging Lambda`

Production remains:

`main → production Amplify → existing production Lambda`

## Staging entrypoint

The staging package includes `backend/staging-lambda.js`.

Configure the new staging Lambda handler as:

`staging-lambda.handler`

Do not change the production Lambda handler.

The wrapper imports the verified `backend/lambda.js` and leaves that production runtime unchanged. It accepts only the HTTPS browser origin configured in the existing `CORS_ORIGIN` environment variable. Unknown browser origins fail before the production handler executes.

Because GV-REC-687B-P3 uses a trusted production browser Origin as its activation gate, the isolated staging wrapper maps the already-validated staging origin to the production marker only for internal execution inside the staging Lambda. The browser response is then rewritten back to the staging origin. This preserves the current 687B behavior without adding another Lambda environment variable.

The wrapper refuses to start if `CORS_ORIGIN` is missing, invalid, non-HTTPS, contains a path, or equals `https://globevoy.com`.

## Artifact build

`.github/workflows/build-staging-backend.yml`:

1. runs the repository secret guard;
2. runs the exact 687B-P3 backend validator;
3. runs the 687B recommendation regression validator;
4. validates the staging wrapper boundary;
5. performs syntax checks;
6. packages the backend directory with files at the ZIP root;
7. verifies required runtime files exist in the ZIP;
8. rejects a ZIP above the 50 MB direct-upload limit;
9. emits a SHA-256 file and deployment note;
10. uploads a 14-day GitHub Actions artifact named `globevoy-staging-backend`.

The workflow has `contents: read` permission only and performs no AWS deployment.

## AWS staging function requirements

Create a separate Lambda function, for example:

`globevoy-staging-api`

Recommended first-pass configuration is to match the production function's runtime, architecture, memory and timeout, but use a separate function name and Function URL.

Required differences:

- Handler: `staging-lambda.handler`
- `CORS_ORIGIN`: exact Amplify staging origin, for example `https://staging.<app-id>.amplifyapp.com`
- Function URL: separate from production
- No custom production domain

Provider credentials and permissions should be copied only when a staging test genuinely needs them. Prefer provider sandbox/test credentials or provider-off defaults where available. Do not store credentials in GitHub.

## Frontend connection

After the staging Function URL exists, change only the GitHub `staging` frontend runtime config so `apiBaseUrl` points to the staging Function URL. Do not change the production `main` runtime config as part of staging setup.

## Acceptance checks

Before any 701+ feature work starts, prove:

1. Production `globevoy.com` still calls the original production Lambda.
2. Amplify staging calls only the staging Lambda URL.
3. Staging OPTIONS request returns the staging Amplify origin.
4. An unrelated browser Origin is rejected.
5. Staging generated-tour calls no longer show `Failed to fetch`.
6. 687B route-role behavior is available in staging.
7. No production Lambda configuration or code changed.

## Rollback

If staging fails, disconnect or delete the new staging Lambda/Function URL and point the staging frontend back to a disabled/non-live API state. Production requires no rollback because this task does not modify production.
