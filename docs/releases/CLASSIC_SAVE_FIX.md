# Classic generated-tour account Save fix

This source change does not merge or deploy a release. Hosting remains on the previously restored content until separate publication approval.

## Behavior

Both the classic visualizer and multi-city route-details account Save now use the existing compact serializer, moved into `frontend/scripts/saved-trips-705c.js`. The route-details bridge delegates to that synchronously initialized runtime. No new script, loader, duplicated serializer or backend change is required.

The full generated tour remains in guest browser storage. Only the compact copy is posted to the account API. It retains cities, leg/stay dates, canonical departure and return dates, pricing labels and route-restoration fields, and excludes full provider/eligibility metadata. Account snapshots remain historical prices requiring revalidation before booking.

The client caps the compact snapshot at 40 KiB and the complete POST at 60 KiB, below the unchanged backend limits of 48 KiB and 64 KiB. A successful HTTP response must contain a saved trip ID before the UI reports account success. Failed saves clear account-success styling, retain the local tour and allow retry. Stale list refreshes cannot overwrite a newer Save result.

## Regression checks

The tests generate Toronto and London tours through the repository's route planner and visualizer builder without provider access, then add representative repeated scan/provider evidence and eligibility fields. Raw payloads exceed 64 KiB and fail the unchanged body/sensitive-data validators. The compact payloads are approximately 8.5-9.4 KB across the contract and full-browser flows and pass both limits and validators.

- `npm test`: includes nine Save contract/state/guest/restore regression tests.
- `npm run test:account`: includes the updated shared-serializer guard, preserving all backend security checks.
- `npm run test:providers`, `npm run test:web`, `npm run test:release`.
- `npm run typecheck:web` and `npm run build:web`.
- `node web/node_modules/playwright/cli.js install --with-deps chromium`, then `npm run test:browser`.

The six Chromium tests use the actual classic assets and exported React My Trips page. They cover both Save buttons through React listing and Delete, delayed API confirmation, network failure, HTTP 413, malformed success responses and signed-out local saving. Every browser request is intercepted; authentication and storage use offline test doubles backed by the unchanged saved-trip parser/normalizer. No AWS resource, customer data, real token or credentials are used. On Windows an existing Chromium-based browser can be selected with `GLOBEVOY_TEST_BROWSER_PATH`.

CI builds React, installs Chromium and runs this browser group after the existing suites. Run checks in a fresh checkout with `npm ci --prefix web --no-audit --no-fund`; do not disable repository validation to accommodate ignored local SDK files.

## Remaining release boundary

These are offline regression checks. They do not establish live Cognito, Amplify redirects, Google Maps or deployed account acceptance for a future artifact. Rebuild from reviewed merged source and obtain separate deployment approval; then repeat the real production Save -> React My Trips -> Delete journey with an authorized synthetic identity. Keep backend validation and the previous hosting rollback ZIP unchanged.
