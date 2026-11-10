# Production-only frontend packaging

This change builds a production-only artifact; it does not merge or deploy it, or change AWS/staging resources. The classic Save fix remains intact. Preserve the job 243 rollback ZIP separately and never rewrite it to satisfy the new-package scanner.

## One policy implementation, two build configurations

`frontend/runtime/environment-policy.js` retains the ordinary staging/development defaults and exposes its closure-free policy factory to build tools. The source factory still performs URL, issuer, region, client, feature-enablement and origin validation. Its normal staging and loopback behavior is unchanged.

`ops/release/production-frontend-policy.mjs` generates a production-only instance from that same factory, with the approved production API and Cognito identifiers pinned. Pool/client match the approved backend account configuration; only public configuration enters generated code. A closed input schema rejects extra fields or unapproved destinations. Production rejects staging, unknown origins, localhost overrides and runtime attempts to switch API, issuer, pool, client or domain. Default-disabled accounts/React cannot be enabled by mutating browser configuration.

The packager writes this generated module outside public assets under `.cache/`, supplies its absolute path only to the child Next build, and copies the same module to the classic runtime policy asset. The scoped Next module replacement prevents staging defaults from entering compiled React chunks. No compiled-chunk text replacement, obfuscation, security-check removal or new browser loading dependency is used. Ordinary `npm run build:web` retains the source staging policy; the build override does not persist in the parent environment.

The two classic account fallback links now read `policy.stagingOrigin` instead of duplicating a staging URL. Source development links retain their existing destination; production's empty staging defaults cannot navigate to that service.

## Build and inspect

Use Node 24, Python 3 and `npm ci --prefix web --no-audit --no-fund`. Supply the existing approved restricted public Maps key privately through `GLOBEVOY_MAPS_BROWSER_KEY`; never supply provider tokens or server credentials. Existing production React/account opt-in flags and Cognito environment inputs still apply and must match the approved configuration. The child build pins public API/legacy-asset settings, so a staging developer environment cannot leak them into the production bundle.

```powershell
npm run package:production
node ops/release/verify-production-frontend.mjs .cache/production-site.zip
Get-FileHash .cache/production-site.zip -Algorithm SHA256
```

The packager now produces the directory, ZIP and `.zip.sha256` itself. **Do not re-ZIP or edit an artifact after validation.** Preserve previous output and choose another `GLOBEVOY_OUTPUT_NAME` before rebuilding. The manifest includes `productionOnly: true`, source commit, dirty state, flags and all file hashes. Use a clean reviewed commit for release approval; recompute the checksum for every new build.

The verifier reads every uncompressed ZIP entry, verifies CRC/inventory/hashes and required pages/assets, and rejects exact known staging API/hosting endpoints, Cognito pool/client/issuer/domain and their host/escaped/URL-encoded forms. It also rejects other unapproved Lambda/Cognito endpoints and concrete identity values. Harmless descriptive `staging` text, empty compatibility properties, validation regexes and the production Cognito service hostname are allowed. Failed validation stops packaging before a certified checksum is written; preserve the failed output for diagnosis and do not publish it. Checks remain active with Python optimization enabled.

## Automated verification

- `npm test` and account/provider/web/release groups, including existing authentication/security checks.
- `tests/release/production-only-frontend.test.mjs`: approved pinning; runtime tampering; unknown/staging/loopback rejection; source staging behavior; classic fallback links; mutation of actual ZIPs/React chunks with every forbidden identity and with unapproved/escaped/encoded destinations.
- `tests/release/build-production-frontend-fixture.mjs`: actual Next and classic ZIP build with deliberately staging-configured parent public variables, a dummy public Maps key and no AWS calls.
- `npm run typecheck:web` and normal `npm run build:web`.
- `npm run test:browser`: normal build Save -> React My Trips -> Delete and failure/guest regressions.
- `GLOBEVOY_TEST_FRONTEND_ROOT=.cache/ci-production-frontend npm run test:browser`: the same six tests using actual packaged classic assets and compiled production React pages. All requests are intercepted; no Cognito users, credentials, live tokens or database writes.

CI executes both build/browser modes and scans the actual production ZIP. Local checks confirmed 275 files and 25 compiled React chunks with no known staging destinations or unapproved API/Cognito destinations. Contract/browser Save payloads remain below the unchanged API limits. A normal build after the production build retains staging defaults, proving the replacement is scoped.

## Release boundary

The PR is code/test evidence, not production publication approval. After review and merge, build a fresh clean-main artifact with the real approved Maps key, verify its hash and obtain separate frontend approval. Real hosted callback/login, Save/Open/Delete, two-user/profile privacy, recommendations, Maps and canonical redirects still need live acceptance. Keep Lambda, backend validation, Cognito, IAM, DynamoDB, staging and the job 243 content rollback untouched.
