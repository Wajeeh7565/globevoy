# Main consolidation release — 2026-11-09

**Environment-limit fix:** account activation now uses explicit build-time nonsecret configuration. See [ACCOUNT_BUILD_CONFIG.md](ACCOUNT_BUILD_CONFIG.md); earlier environment-change instructions below are historical and superseded.


**Classic Save correction (source only):** see [CLASSIC_SAVE_FIX.md](CLASSIC_SAVE_FIX.md) for shared compact snapshots and offline browser regression coverage. This is not deployment approval.

**Production-only packaging:** see [PRODUCTION_FRONTEND_PACKAGING.md](PRODUCTION_FRONTEND_PACKAGING.md). The current packager writes and validates the complete ZIP automatically, including React chunks. Source staging behavior is preserved.

## Status and source

**Full new product: BLOCKED.** Main promotion is prepared; no merge or deployment is authorized by this preparation task. The conservative static candidate retains the classic website and production API, disables production accounts and the React workflow, and keeps both sets of assets in one artifact. It still needs browser acceptance against production before deployment approval. Leaving deployment job 240 untouched is the smallest completely verified way to preserve the current public website while merging source organization.

Source: staging `721652d0a2feacdcd885076e1c5b863f69f32869`, including merged cleanup PR #120. Main `9554653cfb567b073ed79521037e3aed77847c67` is an ancestor, 692 commits behind this staging source. Temporary branch: `release/globevoy-main-consolidation`. Use a normal merge commit (or a controlled fast-forward) after approval; do not squash or rebase the integrated history. Annotated tag `gv-main-backup-20261109` resolves to that main commit and must remain.

## Implementation

- `frontend/runtime/environment-policy.js` and its TypeScript declaration: one public origin policy shared by classic and React. Production selects only the production API; staging keeps its own API and public Cognito identifiers. Unknown origins fail closed. Development overrides accept loopback URLs only and cannot override production.
- `frontend/runtime/config.js`, `auth-config-705b-r3.js`, `api-client.js`: use that policy, disable unsupported worldwide registry and production accounts. No private credentials are included.
- HTML pages using runtime config/auth or the shared shell load the policy before consumers. `frontend/scripts/auth-session-705b-r3.js` and `shell-670f.js` reject cached production sessions and disable sign-in.
- `web/lib/public-config.ts`, `auth.ts`, `api.ts`: shared selection, reject production cached sessions/private API calls, disable unsupported automatic dates. `web/components/production-boundary.tsx` and `web/app/layout.tsx` keep newer workflows from mounting on production and provide a classic-site link. `web/scripts/dev-staging.cjs` reuses development constants.
- `tests/release/production-config.test.mjs`, `scripts/run-tests.mjs`, `package.json`: focused environment/auth/load-order tests and release commands. The existing account validator follows the centralized public configuration rather than requiring literals in its old file.
- `.github/workflows/validate.yml` and `web/package-lock.json`: main CI, reproducible dependency installation, environment tests, typecheck and static build. The first CI attempt exposed the missing lockfile; it was generated and committed rather than bypassing the install check. No deployment automation.
- `ops/release/package-production.mjs`: repeatable composite artifact, required public Maps key supplied outside Git, expected routes/assets checked, evidence/test folders excluded, SHA-256 file manifest. Refuses to overwrite an existing artifact.

## Verification and production compatibility

Local: all 52 commands across repo, backend, frontend, account, providers, syntax, web and performance passed. Five focused release tests passed, including three production origins, stale-session rejection without network access, staging preservation, hostile override rejection and script order. React typecheck and production static export passed. Composite packaging also passed: 273 files with verified SHA-256 hashes, expected classic/React pages, fallback content, and zero missing local HTML script/style/image references. These are not full live provider/booking or browser acceptance tests.

Read-only AWS inspection on November 9:

- Amplify `dttux5e6ddtzb`, branch main, WEB, no Git repository connected. Job 240 SUCCEED.
- Production API `https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws`; GET `/api/city-registry?limit=1` with production Origin returned 200; OPTIONS `/api/generated-tour` returned 204 with production CORS.
- Downloaded production Lambda source includes classic recommendations, generated-tour/control/date, multicity-tours, mixed-results, travel-entry-eligibility, city-registry and fare endpoints. It does **not** include `/api/account/session`, saved-trip CRUD, `/api/account/travel-profile`, `/api/account/booking-revalidate`, `/api/worldwide-city-registry` or `/api/staging/multicity-auto-dates`. Newer response-schema and provider behavior are not proven equivalent merely by route presence.
- Production Cognito, account persistence and permissions are unverified. Accounts remain disabled; no staging login/storage fallback is allowed.
- Lambda reports `src/lambda.handler`, Node 24, while its downloaded package has `lambda.js` at its root and no `src/lambda.js`. The function URL is unqualified and no aliases exist. The live registry still responds. This discrepancy is unresolved: **do not replace this backend or assume the downloaded entry point alone proves live execution behavior.**

A full React/account launch needs a separate backend migration: production Cognito client/callback/logout origins; JWT issuer/audience/scope verification; saved-trip/profile database and IAM; account and booking-revalidation routes; registry and automatic-date support; provider secrets and quotas; production CORS; response contract tests; and resolution of the handler/package discrepancy. Preserve original code, handler, configuration and data snapshots before any authorized backend release. Roll back code AND handler/config together; database changes must be backward compatible. This PR does not deploy any backend code.

## Build and package (PowerShell, repository root)

Use Node 24, Python 3 for ZIP creation, and the committed lockfile. Supply the existing restricted **public browser** Maps key through the environment; never place a server/provider credential here. Do not commit generated artifacts.

```powershell
npm ci --prefix web --no-audit --no-fund
node scripts/run-tests.mjs repo backend frontend account providers syntax web performance release
npm run typecheck:web
# Set $env:GLOBEVOY_MAPS_BROWSER_KEY using your approved local environment.
# Preserve/rename any previous .cache/production-site before this command.
npm run package:production
node ops/release/verify-production-frontend.mjs .cache/production-site.zip
Get-FileHash .cache/production-site.zip -Algorithm SHA256
```

The build itself exports React, copies classic assets plus `web/out` under `/react`, and writes `release-manifest.json`. A release candidate must show `dirty: false` and the approved commit. `index.html` must be at ZIP root. The public key is injected only into artifact `runtime/config.js`. Keep the manifest and ZIP checksum with release approval.

## Rollback evidence and pre-deployment acceptance

The DEPLOY artifact from job 240 was downloaded intact to ignored `.cache/production-inspection/rollback-job-240.zip`. ZIP verified; SHA-256 `52097ac1d5a1aea2e69d83369a19b1a6ad675133860b41dafe32ce6c93ed9b3e`. It contains the previous website at ZIP root. The VERIFY step artifact URL was unavailable; it is not needed to restore the DEPLOY artifact. Copy this rollback ZIP and checksum to durable private operator storage before any deployment. Git's backup tag alone does not restore a manually deployed website.

Before approval: inspect the artifact on a local server; for accurate production behavior use a browser test harness that sets the production origin and fulfills document/assets from the artifact, rather than adding localhost to the production allowlist. Confirm classic search, recommendations, tours, trip detail and map rendering; production requests must use the production API; account links must explain unavailability; `/react/` must show the classic fallback; legal links and nested assets must work. Live paid provider or booking actions need their own authorized test. These browser checks remain an approval prerequisite.

## Manual deployment — ONLY after separate user approval

The following commands are a runbook, not actions performed by this task. No Lambda or hosting-setting changes are involved. Amplify create/start must occur within eight hours. Upload the ZIP contents, not a surrounding directory. See [AWS manual deployments](https://docs.aws.amazon.com/amplify/latest/userguide/manual-deploys.html) and [StartDeployment API](https://docs.aws.amazon.com/amplify/latest/APIReference/API_StartDeployment.html).

```powershell
$releaseZip = (Resolve-Path .cache/production-site.zip).Path
$deployment = aws amplify create-deployment --app-id dttux5e6ddtzb --branch-name main --region us-east-2 --output json | ConvertFrom-Json
curl.exe --fail --silent --show-error --request PUT --upload-file "$releaseZip" "$($deployment.zipUploadUrl)"
if ($LASTEXITCODE -ne 0) { throw 'Artifact upload failed; do not start deployment.' }
aws amplify start-deployment --app-id dttux5e6ddtzb --branch-name main --job-id $deployment.jobId --region us-east-2
aws amplify get-job --app-id dttux5e6ddtzb --branch-name main --job-id $deployment.jobId --region us-east-2 --query 'job.summary'
```

Poll get-job until SUCCEED, then verify `https://globevoy.com/release-manifest.json` matches the approved commit and repeat the acceptance checks above, including CORS and no staging network traffic. A successful hosting job alone is insufficient.

To roll back after an approved deployment, run the same create/upload/start sequence with `$releaseZip` pointing to the preserved `rollback-job-240.zip` instead. Verify the original classic pages and API. This does not alter the production Lambda. If a deploy job fails, inspect its status and current served site before deciding whether rollback is needed.

## Branch retirement inventory

Snapshot relative to the integrated release source, before this preparation commit. No branches deleted. A zero unique count means fully reachable, not permission to delete. Retire these only after release history is merged into main; first coordinate any deployment settings tied to staging. Keep main permanently and keep the backup tag.

| Remote branch | Commits not reachable from release | Recommendation |
| --- | ---: | --- |
| `codex/remaining-repository-cleanup` | 0 | Eligible after main promotion |
| `feature/cleanup-frontend-backend-audit-20261008` | 6 | Review unique work; retain |
| `feature/globevoy-feature-inventory-frontend-tidy-20261008` | 6 | Review unique work; retain |
| `feature/gv-dist-709a-claude-mcp-local` | 17 | Review unique work; retain |
| `feature/gv-infra-docker-poc-713a` | 2 | Review unique work; retain |
| `feature/gv-perf-684b-684a-reuse-diagnostic` | 5 | Review unique work; retain |
| `feature/gv-refactor-r2a-validation-results` | 0 | Eligible after main promotion |
| `feature/gv-refactor-r2b-audit-scripts` | 0 | Eligible after main promotion |
| `feature/gv-refactor-r2c-release-evidence` | 0 | Eligible after main promotion |
| `feature/gv-refactor-r2d-historical-validators` | 0 | Eligible after main promotion |
| `feature/gv-refactor-r3a-frontend-evidence` | 0 | Eligible after main promotion |
| `feature/gv-refactor-r3b1-frontend-tools` | 0 | Eligible after main promotion |
| `feature/gv-test-708c-clock-fixture` | 0 | Eligible after main promotion |
| `feature/gv-website-parity-classic-20261008` | 1 | Review unique work; retain |
| `feature/gv-website-parity-react-20261008` | 2 | Review unique work; retain |
| `feature/unified-globevoy-account-design` | 12 | Review unique work; retain |
| `staging` | 0 | Eligible after main promotion |

The temporary release branch itself becomes eligible only after its final commit is reachable from main. Re-fetch and re-check reachability before any later deletion.

## Hybrid staging-to-production promotion (2026-11-09 follow-up)

**Desired product:** keep the classic HTML/CSS/JavaScript homepage and existing trip pages, with the React account/trip workflow available under `/react/`, matching the current staging design. This is not a full React rewrite. Do not publish a conservative build and represent it as a complete staging-to-production migration.

The source can now read an explicit, **artifact-only** public production release declaration from the top of `runtime/environment-policy.js`. `ops/release/package-production.mjs` injects that declaration into the built site, not into Git, so classic and React use the same origin policy. React loads the browser policy before hydration. No deployment is performed by this change.

Without production release flags, the existing behavior stays: classic uses the established production Lambda, while React and accounts remain unavailable. Staging still has its existing Cognito and staging API integration.

**Do not set the following opt-in variables until the corresponding production infrastructure has been provisioned, tested, and approved:**

- `GLOBEVOY_ENABLE_PRODUCTION_REACT=true` and `GLOBEVOY_PRODUCTION_REACT_VERIFIED=yes` enable the React interface only after public API contract and browser acceptance tests have passed. An authorization check is NOT accomplished by these UI flags.
- `GLOBEVOY_ENABLE_PRODUCTION_ACCOUNTS=true` and `GLOBEVOY_PRODUCTION_ACCOUNTS_VERIFIED=yes` additionally request account functionality. This requires React enabled and a verified production backend with owner-private APIs and correct token checks.
- `GLOBEVOY_PRODUCTION_API_BASE_URL` is the dedicated production Lambda Function URL. Never use `globevoy-staging-api` or its URL for production customers.
- `GLOBEVOY_PRODUCTION_USER_POOL_ID`, `GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID`, and `GLOBEVOY_PRODUCTION_COGNITO_DOMAIN` are **public identifiers** for a separate production Cognito app client/user pool (no client secret). The generator refuses staging URL/pool identities. Login callback and logout URLs use the actual page origin.

**Remaining production prerequisites:**
1. Verify/provision a production Lambda handler/package that implements the required React and account API contracts; test authenticated and unauthenticated routes, error handling, quotas, provider boundaries and CORS for `https://globevoy.com` (and `www` only if served without redirect).
2. Provision and configure production Cognito, including authorization-code PKCE, expected JWT audience/issuer/scope, callback `https://globevoy.com/auth-callback.html`, logout `https://globevoy.com/index.html`, and separate storage and least-privilege IAM. Do not reuse staging users/data implicitly.
3. Verify account session, saved-trip CRUD, profile, booking revalidation and any newer journey APIs against the *production* backend. Confirm no staging Lambda or Cognito network requests from the production origin.
4. Resolve the existing production Lambda handler/package discrepancy **before** changing production Lambda code or handler. Preserve the deployed Lambda and hosting rollback artifacts at deployment time.
5. Build and inspect the candidate, run browser acceptance of the classic homepage, React login/account/saved trip flows, maps and recommendations, then approve a manual Amplify release. Production is still **BLOCKED** for full staging parity until these checks pass.

This is an opt-in mechanism for a future verified release, **not** evidence that the production backend/auth migration is complete. PR #121 remains source-only until approved.

### Cognito provisioning automation (preview-first)

The latest staging pool inspection confirmed: email as username and auto-verified attribute; one public OAuth authorization-code client; scope `globevoy/trips.write`; minimum-8 complex passwords; MFA OFF; recovery by verified email; deletion protection INACTIVE. The separate production configuration uses a minimum-12 password and ACTIVE deletion protection.

`ops/release/provision-production-cognito.ps1` consolidates production pool, custom scope, public app client, and prefixed hosted-login domain creation. It is **read-only by default**. The `-Apply` parameter prompts for an exact interactive confirmation before creating AWS resources. The script never touches staging user pools, Lambda, IAM, database, DNS or Amplify. Review Cognito pricing and outgoing verification email limits before launching sign-up.

From a checkout of the approved release branch:

```powershell
.\ops\release\provision-production-cognito.ps1
# After AWS account/name/security review and explicit creation approval:
.\ops\release\provision-production-cognito.ps1 -Apply
```

The script outputs public pool/client/domain identifiers for later deployment configuration. It configures **hosted UI classic (managed-login version 1)** for lower-complexity setup; verify the authentication page styling against staging before declaring visual parity. Production accounts must remain OFF until the protected API is migrated, dedicated database and IAM prepared, Cognito token validation and browser user flows tested, and production release approved. The code-path toggle never replaces backend authorization.

## Launch-first package completion

The current local package resolves the reported handler/layout mismatch by providing `src/lambda.js`, a compatibility entry point exporting the existing production account wrapper. Its expected AWS handler is **src/lambda.handler**. The root `lambda.js` remains the classic public handler and `production-account-lambda.js` remains the account wrapper. Both entry points are import-tested; this fixes the new artifact only and does not establish why the old live package appeared inconsistent.

Backend dependencies are pinned in `ops/release/backend-dependencies/package-lock.json` and installed with `npm ci` into the ignored artifact folder. The package contains services and runtime data, excluding archived evidence and validators. Run `./ops/release/package-launch-first-backend.ps1 -OutputName launch-candidate` from a clean commit. It makes no AWS calls. CI builds and checks the same ZIP.

The React account navigation now follows the shared production accounts configuration. Hosted Cognito supplies sign-in and account creation; classic homepage/navigation stays primary. Production features remain disabled until real production public identifiers and verified API flags are supplied to the site packager.

Storage contract: dedicated DynamoDB table with string partition key `PK` and sort key `SK`; keys are derived from verified Cognito `sub`. Travel profile uses `PROFILE#TRAVEL`; saved trips use the shared saved-trip service keys. Never take an owner ID from a browser payload. PUT saved trips requires integer `version` for optimistic concurrency; stale or foreign-owner writes return 409. GET foreign trips returns 404. Stored prices remain snapshots requiring revalidation. Booking revalidation is outside this account launch and must not be presented as live booking readiness. Use least-privilege Query/GetItem/PutItem/UpdateItem/DeleteItem permissions restricted to this dedicated table; never point production at staging storage.

### Concise approval checklist

1. Locally: run the unified test groups, production account validator, typecheck, both packagers; preserve ZIP SHA-256 hashes and source manifests. Use synthetic public identifiers for offline tests only.
2. With separate AWS authorization: confirm billing, provision/verify production Cognito and dedicated storage/IAM, preserve original Lambda code/config and Amplify job 240 ZIP. Do not run provisioning `-Apply` during preparation.
3. Review the backend ZIP with handler `src/lambda.handler`, dependencies, production origin, pool/client/scope/table environment values. A Function URL CORS layer must agree with application CORS: exact canonical origin, Authorization and Content-Type, required CRUD methods, no duplicate contradictory headers. Choose one canonical web origin (redirect www if it is not separately configured).
4. Authorize backend deployment separately; test real Cognito PKCE login/create-account/logout, rejected staging/expired tokens, owner-private saved-trip CRUD/profile, classic recommendations and CORS. These live tests have not been performed.
5. Only then enable verified production React/accounts build flags, inspect classic home and `/react/account/`, `/react/my-trips/`, `/react/travel-profile/`, confirm no staging traffic, and approve the manual Amplify deployment described above.
6. Rollback: restore the preserved hosting ZIP and previous Lambda code **with matching handler and environment**. Disable account feature flags first if rolling back the account backend. Preserve user data; do not delete the production table or Cognito pool. No merge, deployment or branch retirement is automatic.

### Latest local verification

All 53 registered commands across nine groups passed, along with the expanded production JWT/storage validator and React typecheck. The actual backend ZIP built successfully and imported both entry points. Static export and composite packaging passed (274 files). Offline Edge browser checks passed for classic homepage rendering, enabled production account sign-in/create-account UI, saved-trips and travel-profile routes, and absence of staging traffic. Synthetic identifiers were injected in the browser harness only; **no real signup, live provider search, AWS database operation or production deployment was performed**.

Reproduce browser checks after packaging: `npm install --prefix .cache/browser-tools playwright --ignore-scripts --no-audit --no-fund`, set `GLOBEVOY_SITE_ARTIFACT` to the artifact directory, then `node tests/release/browser-smoke.cjs`. Requires installed Microsoft Edge at the Windows default path. Every external request is intercepted/blocked, including Maps, Cognito and backend URLs. Backend recommendation regressions are covered by the grouped backend suite, not by a live paid search. Actual hosted authentication and browser CRUD remain deployment acceptance requirements.

One local build attempt failed when two Next builds overlapped in the same checkout. The completed build and browser run were rerun after that overlap ended; do not build simultaneously in a shared checkout. No test assertion was removed to resolve the failure.

See [workflow review](WORKFLOW_REVIEW.md) for the retained historical workflows and retirement criteria.
