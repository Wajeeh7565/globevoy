# Globevoy Deployment State

Last updated: 2026-06-08

## Current Live Backend

- Backend version: `11.10.1`
- AWS Lambda backend is live.
- LAX / Los Angeles supported-origin hotfix is live and QA passed.
- Supported live origins:
  - Toronto
  - New York
  - Los Angeles
  - London
  - Dubai
  - Singapore
  - Montreal
  - Vancouver
  - Sydney
  - Paris
- Unsupported origins return `INVALID_ORIGIN`.
- Unsupported origins must not silently become Toronto/YTO.
- Backend destination metadata count is `65` in the live 65-destination release.
- The 65-destination expansion has been deployed and live QA passed.
- A backend-only 65-count hotfix was uploaded manually and live QA passed.
- Toronto high-budget Explore/API QA shows `65 matches`.
- New York high-budget Explore/API QA shows `64 matches` because the same-origin New York/NYC destination is intentionally excluded.
- Los Angeles/LAX high-budget Explore/API QA shows `64 matches` because the same-origin Los Angeles/LAX destination is intentionally excluded.

## Current Live Frontend

- Frontend origin autocomplete and layout fixes are live.
- Frontend supported-origin source-of-truth refactor is live.
- Homepage, Explore, and Ask use `supported-origins.js`.
- Homepage-only Hamilton/Mississauga nearby-origin confirmation prototype is live or ready for the next frontend upload, depending on the deployed frontend package.
  - Hamilton and Mississauga are not direct supported origins.
  - The user must confirm `Use Toronto Pearson (YYZ)` before Toronto/YYZ is used.
- Unsupported-origin messaging works for unsupported entries such as Tehran, Auckland, and fake city names.
- Confirmed flow: `tehran -> clear -> Toronto -> See destinations` works.
- Partner/referral wording remains referral-first:
  - Compare flights
  - Compare stays
  - Compare on partner sites
- `Book now` wording should not appear.
- Guarded generic fallback cards are live on Explore.
- Explore high-budget Toronto searches have been verified at `65 matches`.
- No frontend redeploy was needed for the backend-only 65-count hotfix.
- Edmonton, Moncton, and Orlando remain visible as legacy-live review-debt cards.
  - Internal status: `fallbackCardStatus: "legacy-live-review-debt"`
  - Internal status: `productReviewStatus: "needs-review"`
  - These cities are not treated as new expansion recommendations.
- Generated frontend replacement data is not live yet; fallback cards are a safe bridge while the registry pipeline matures.

## QA Passed

- Toronto API test passed.
- New York API test passed.
- LAX API test passed.
- Los Angeles API test passed.
- Fakecity API test returned `INVALID_ORIGIN`.
- Homepage loads.
- Explore loads.
- Ask loads.
- No silent Toronto fallback.
- No `Book now` wording.
- Compare flights / Compare stays wording remains.
- `tp.media` Travelpayouts/Aviasales wrapping remains present.
- Agoda links remain present.
- Toronto high-budget Explore QA passed with `65 matches`.
- New York high-budget Explore QA passed with `64 matches`; same-origin NYC is intentionally excluded.
- Los Angeles/LAX high-budget Explore QA passed with `64 matches`; same-origin LAX is intentionally excluded.
- Edmonton, Moncton, and Orlando remain visible.
- Fakecity, Tehran, and Auckland do not silently become Toronto.
- Guarded generic fallback card QA passed.
- No rollback was needed.

## Latest Deployment Packages

Latest backend package:

- `globevoy_backend_65_count_hotfix_v11_10_1_ready_for_manual_upload_20260608_014546_forwardslash.zip`

Latest frontend package:

- `globevoy_frontend_guarded_generic_fallback_cards_v11_10_1_ready_for_upload_20260607_003526_forwardslash.zip`

Older frontend/backend ZIPs should not be used unless intentionally rolling back to a previous known-good version.

## Draft-Only Files Not Wired Into Production

The following files are review or planning artifacts only. They are not production sources of truth and are not imported by the live app:

- `backend/src/data/city-registry.draft.json`
- `backend/src/data/origin-airport-mapping.draft.json`
- Generated preview destination files
- Registry/provider reports in `docs/`

Do not wire these into production without a separate reviewed implementation and QA pass.

## 50-Destination Release Status

- The backend 50-destination release is live and QA passed.
- The 30-to-40 expansion cities are live:
  - Cartagena
  - Medellin
  - Madrid
  - Seville
  - Krakow
  - Marrakech
  - Budapest
  - Palermo
  - Lyon
  - Valencia
- The 40-to-50 expansion cities are live:
  - San Juan
  - Panama City
  - San Jose
  - Lima
  - Bologna
  - Ljubljana
  - Istanbul
  - Cairo
  - Tokyo
  - Bangkok
- All newly added `fallbackFlightUsd` values are MVP provisional estimates from `release/city-expansion-safe-next-subset.json` / `.csv`.
- The frontend curated dataset is still smaller than the backend live dataset.
- Guarded generic fallback cards are live so Explore can safely display the full 50 while missing curated frontend records are reviewed.
- The full registry and any 100-city candidate remain blocked until a reviewed candidate and generation pipeline exist.

## 65-Destination Release And Count Hotfix Status

- The 65-destination expansion is live and QA passed.
- The backend-only 65-count hotfix has been uploaded manually and QA passed.
- Frontend hotfix packaging/upload was not needed for the backend count hotfix.
- Backend production metadata is live at `65` destinations.
- Explore is live at up to `65` visible matches for Toronto high-budget searches.
- New York and Los Angeles/LAX show `64 matches` by design because same-origin destinations are excluded.
- The 15 Group A cities added in the 65-destination release are:
  - Alicante
  - Bilbao
  - Bordeaux
  - Bristol
  - Catania
  - Charlotte
  - Cologne
  - Dubrovnik
  - Malaga
  - Marseille
  - Nashville
  - Nice
  - Salt Lake City
  - Toulouse
  - Vienna
- Catania, Dubrovnik, and Nice remain approve-with-warning watch cities and should receive extra QA in future release checks.
- Manual city expansion should pause here while the registry pipeline catches up.
- The next destination work should be a non-production 250-city candidate registry and validation/generation pipeline sprint, not a live deployment.

## Local 65-To-115 Candidate Implementation Status

Status: local implementation only; not deployed, not uploaded, and not packaged yet.

- Backend production-shaped metadata has been updated locally to `115` destinations using only `release/city-expansion-65-to-115-implementation-ready-subset.json`.
- The final local subset adds exactly `50` approved cities.
- Approval mix:
  - `27` approve-provisional cities.
  - `23` approve-with-warning cities.
- Zurich uses the adjusted approved warning values:
  - `fallbackFlightUsd: 760`
  - `fallbackNightlyUsd: 220`
  - `dailySpendUsd: 140`
  - `activitiesLocalUsd: 125`
- Local backend smoke checks passed:
  - Toronto high-budget `limit=115` returns `115`.
  - New York high-budget `limit=115` returns `114` because same-origin New York/NYC is excluded.
  - Los Angeles/LAX high-budget `limit=115` returns `114` because same-origin Los Angeles/LAX is excluded.
  - Fakecity, Tehran, and Auckland still return invalid-origin behavior.
- Local Explore simulation now defaults the Region filter to `All current destinations` so visible result count can match the backend response.
- Local Explore browser check passed:
  - Toronto high-budget shows `115 matches`.
  - New York high-budget shows `114 matches`.
  - Los Angeles/LAX high-budget shows `114 matches`.
  - All `50` newly approved cities appear through guarded generic fallback cards.
- `frontend/destination-data.js` was not replaced.
- Candidate/draft/generated/release files are not imported at runtime.
- Package/deployment step is still pending and must run a fresh QA pass before upload.

## Rollback Policy

- If backend origin validation or partner links break, rollback to the previous known-good backend ZIP.
- If frontend origin UI breaks, rollback to the previous known-good frontend ZIP.
- If guarded generic fallback cards regress Explore counts, rollback the frontend package only to the previous known-good frontend ZIP.
- If marketing-ready copy/layout changes create a visual regression, rollback the frontend package only; do not change backend origin validation or partner tracking while debugging.
- While debugging, do not change:
  - Lambda URL
  - AWS environment variables
  - API keys
  - partner tracking
  - Agoda links
  - Travelpayouts/Aviasales `tp.media` wrapping

## Next Recommended Tasks

- Stop manual city expansion for now.
- Continue registry pipeline work.
- Next technical sprint: 250-city non-production candidate registry plus generated frontend/backend validation and parity planning.
- Review `backend/src/data/origin-airport-mapping.draft.json`.
- Keep origin-airport mapping suggestion-and-confirmation based, not silent fallback.
- Do not build full geolocation yet.
- Do not build multi-city yet.
- Do not wire draft registry or preview destination files into production yet.
- Flexible-date flight pricing remains the next algorithm priority if Mehdi wants algorithm work before registry scaling.

## Marketing-Ready MVP Candidate Notes

- Homepage, Explore, and Ask copy now emphasizes that Globevoy compares budget-first trip estimates.
- Results explain that estimates may use partner data or fallback estimates.
- Partner wording stays referral-first: `Compare flights`, `Compare stays`, and `Compare on partner sites`.
- Globevoy does not process payment or issue tickets; partner sites confirm final prices and booking.
- These are frontend clarity changes only. Backend behavior, partner links, and supported-origin resolver behavior are unchanged.
