# Package Manifest

This manifest describes the sanitized private source-review snapshot. Paths are relative to the package root.

## Included Files

- `.env.example`
- `.gitignore`
- `backend/package.json`
- `backend/src/data/daily-budget.js`
- `backend/src/data/destination-meta.js`
- `backend/src/lambda.js`
- `backend/src/recommendations.js`
- `backend/src/recommendations.test.js`
- `backend/src/server.js`
- `backend/src/services/agoda.js`
- `backend/src/services/travelpayouts.js`
- `backend/test-fixtures/city-expansion-65-to-115-approved-subset.review.json`
- `docs/city-registry-scaling-architecture.md`
- `docs/city-registry-schema.md`
- `docs/city-registry-validation-generation-pipeline-plan.md`
- `docs/DEPLOYMENT_STATE.md`
- `docs/DESTINATION_DATA_SOURCES.md`
- `docs/destination-data-schema.md`
- `docs/FULL_TRIP_COST_LOGIC.md`
- `docs/GLOBEVOY_BACKEND_ALGORITHM_FLOWCHARTS.md`
- `docs/MARKETING_READY_MVP_QA.md`
- `docs/provider-field-merge-plan.md`
- `frontend/a11y.css`
- `frontend/api-client.js`
- `frontend/ask.html`
- `frontend/assets/globevoy-logo.png`
- `frontend/assets/globevoy-mark.png`
- `frontend/assets/globevoy-mark-fallback.png`
- `frontend/assets/globevoy-wordmark.png`
- `frontend/config.js`
- `frontend/destination-data.js`
- `frontend/explore.html`
- `frontend/index.html`
- `frontend/nearby-origin-suggestions.js`
- `frontend/polish.css`
- `frontend/supported-origins.js`
- `frontend/transitions.css`
- `frontend/trust.css`
- `MANIFEST.md`
- `README.md`
- `REVIEW_GUIDE.md`
- `samples/city-registry.sample.json`
- `scripts/registry-pipeline-utils.js`
- `scripts/validate-100-city-intake-providers.js`
- `scripts/validate-production-registry.js`

## Excluded Categories

- Git metadata and local editor settings.
- `.env` files, credentials, API keys, tokens, passwords, private endpoints, and real partner account identifiers.
- `node_modules`, caches, logs, coverage, temporary files, browser profiles, and build artifacts.
- Deployment ZIPs, rollback ZIPs, old source ZIPs, and staging folders.
- Raw Agoda feeds, hotel-level records, Travelpayouts `cities.json`/`airports.json`, and other large provider datasets.
- Draft city registries, origin-airport draft mappings, generated preview files, production candidates, and large approval/review registries.
- Screenshots and unrelated personal files.

## Sanitized Items

- `frontend/config.js`: Google Maps key replaced with a placeholder; live API disabled; API base set to localhost.
- `backend/src/services/travelpayouts.js`: affiliate account identifiers replaced with placeholders.
- `frontend/explore.html`: fallback affiliate wrapper identifiers replaced with placeholders.
- `backend/src/recommendations.test.js`: assertions use placeholders and load a compact local test fixture.
- `scripts/validate-100-city-intake-providers.js`: personal absolute paths replaced with generic `path/to/...` examples.

## Test Fixture

`backend/test-fixtures/city-expansion-65-to-115-approved-subset.review.json` is a compact, derived test-only snapshot containing only fields needed to validate the current 115-destination metadata. It is not a raw provider feed or a production registry.
