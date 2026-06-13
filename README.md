# Globevoy Source Review

Globevoy is a budget-first travel discovery prototype. A traveler supplies an origin, total budget, month, and trip length; the backend combines flight, stay, daily-spend, and activity estimates into ranked full-trip recommendations. The frontend presents those recommendations in Explore and Ask experiences and sends travelers to partner sites for comparison. Globevoy does not take payment or complete bookings.

This package is for **private technical review**. It is a sanitized source snapshot, not a deployment artifact.

## Current State

- Live production state at packaging time: 65 destinations.
- Local tested source in this package: 115 destinations.
- The 115-destination backend/frontend source had passed package QA before this review snapshot.
- Provider prices, availability, and final booking terms remain controlled by Travelpayouts/Aviasales and Agoda.

## Technology

- Backend: Node.js 18+, CommonJS, AWS Lambda-compatible handler, and a small local HTTP server.
- Frontend: static HTML, CSS, and browser JavaScript.
- Data: manually reviewed destination metadata plus non-production registry validation utilities.
- Tests: Node's built-in `assert`; no third-party runtime dependency is required for the current backend tests.

## Structure

- `backend/src/lambda.js`: Lambda request/response adapter.
- `backend/src/server.js`: local HTTP server on port 8787 by default.
- `backend/src/recommendations.js`: origin validation, estimate normalization, scoring, ranking, and response shaping.
- `backend/src/services/`: Travelpayouts/Aviasales and Agoda integrations with mock/fallback behavior.
- `backend/src/data/`: current 115-destination metadata and budget helpers.
- `backend/test-fixtures/`: compact test-only snapshot for the reviewed 65-to-115 expansion.
- `frontend/`: homepage, Explore, Ask, shared supported-origin data, destination display data, styling, and assets.
- `scripts/`: selected registry/provider validators. Raw provider data is intentionally not included.
- `docs/`: selected architecture, registry, QA, and deployment-state documentation.
- `samples/`: small illustrative registry record sample only.

## Recommendation Flow

1. The frontend validates a supported origin and submits origin, currency, budget, month, nights, and filters.
2. The API resolves the origin strictly; unsupported origins return `INVALID_ORIGIN` rather than silently falling back to Toronto.
3. Travelpayouts data is used when configured; otherwise reviewed fallback flight estimates are used.
4. Agoda data is used when configured; otherwise reviewed stay estimates and coverage metadata are used.
5. Full-trip cost and Budget Fit are calculated, filtered, sorted, and returned with partner comparison links.
6. Explore maps API results to curated frontend records or guarded generic fallback cards.

## Local Setup

1. Install Node.js 18 or newer.
2. Copy `.env.example` to a local `.env` outside version control and supply only the credentials you are authorized to use.
3. For offline review, keep `GLOBEVOY_USE_MOCKS=true`; provider credentials are not required.
4. Configure `frontend/config.js` locally if needed. The review copy intentionally uses a placeholder Google Maps browser key, disables the live API, and points to `http://localhost:8787`.

Run the backend:

```powershell
cd backend
npm install
npm start
```

Serve the frontend from the repository root in a second terminal:

```powershell
python -m http.server 8080 --directory frontend
```

Then open `http://localhost:8080/`. The backend health endpoint is `http://localhost:8787/health`.

## Tests

```powershell
npm test --prefix backend
node backend/src/recommendations.test.js
```

Syntax checks can be run with `node --check` on backend and standalone frontend JavaScript files. Inline scripts in the HTML pages should be parsed separately because `node --check` does not parse HTML.

## Environment Variables

See `.env.example`. Important groups are:

- `TRAVELPAYOUTS_TOKEN` and optional Travelpayouts endpoint/currency settings.
- Aviasales affiliate identifiers (`TRAVELPAYOUTS_AVIASALES_*`).
- `AGODA_API_KEY`, `AGODA_SITE_ID`, and `AGODA_ENDPOINT`.
- `GLOBEVOY_USE_MOCKS`, `PORT`, `CORS_ORIGIN`, and exchange-rate overrides.

All values in this review package are empty or explicit placeholders. Do not commit real credentials, account IDs, private endpoints, or browser API keys.

## Registry and Provider Data

The package includes schema and validation guidance plus a small sample. It excludes raw Agoda feeds, Travelpayouts static datasets, draft registries, generated previews, production candidates, and deployment packages. Provider ingestion should happen outside the repository; only compact reviewed derived fields should be committed.

## Review Notes

Start with `REVIEW_GUIDE.md` and `MANIFEST.md`. `docs/DEPLOYMENT_STATE.md` describes the historical live state, while the source itself contains the later tested 115-destination local dataset. No upload, deployment, commit, or push was performed when this package was created.

