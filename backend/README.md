# GlobeVoy backend — working map

This folder contains the Node.js backend for GlobeVoy. **Do not delete code or data simply because a filename has an older version number.** Current and historical components coexist, and staging/production may use different entry points.

## Active surfaces to protect

| Area | Source |
| --- | --- |
| Core API handler | [`lambda.js`](lambda.js) |
| Staging wrapper | [`staging-lambda-702d.js`](staging-lambda-702d.js) and [`staging-lambda.js`](staging-lambda.js) |
| Generated multi-city trips | [`generated-tour.js`](generated-tour.js) |
| Destination recommendations | [`recommendations.js`](recommendations.js) |
| Shared API/server behaviour | [`server.js`](server.js) |
| Account, booking, provider and city logic | [`services/`](services/) |
| Destination and provider snapshots | [`data/`](data/) |
| Historic build evidence, validators and scripts | [`archive/`](archive/) |

**Staging and production handlers:** confirm their configured AWS deployment paths before changing or moving either entry point. This README is a source map, not a statement about the currently deployed Lambda configuration.

## Data and archives

- `data/` contains large JSON/CSV exports, including activation snapshots and provider coverage evidence. Some are loaded at runtime or by validators. **Never delete or reformat them in a folder cleanup PR.**
- `archive/` already keeps historical material out of the active root. Archived validators and scripts may still be needed for reproducible release evidence.
- `validate-*.js` files in the root are part of active regression and provider test coverage. Preserve them until a run of the relevant tests proves a proposed move is safe.

## How to verify changes

From the repository root:

```powershell
npm test
npm run test:backend
npm run test:providers
npm run test:account
npm run test:syntax
node scripts/audit-frontend-backend.mjs
```

All of these are validation or inspection commands; the structure audit is read-only.

## Cleanup policy

1. Mark every candidate as `runtime`, `staging-only`, `test`, `historical-evidence`, or `unknown`.
2. Check static and dynamically built references in the backend, frontend, tests, deployment scripts and workflows.
3. Change small groups in a separate PR; compare behaviour and run CI before merging.
4. Never mix large JSON data reduction with interface design changes or a staging backend deployment.

See [cross-folder audit](../docs/refactor/FRONTEND_BACKEND_CLEANUP.md) for the current safe-first inventory.
