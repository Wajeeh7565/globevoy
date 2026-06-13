# Globevoy Marketing-Ready MVP QA Checklist

Status: live QA checklist for the marketing-ready MVP, 65-destination release, and backend count hotfix
Last updated: 2026-06-08

## Purpose

Use this checklist before sharing the current MVP candidate. The goal is to confirm that Globevoy feels clear, trustworthy, mobile-presentable, and referral-safe without changing backend behavior.

## Core Smoke Test

- Homepage loads.
- Explore loads.
- Ask loads.
- Toronto origin works.
- New York origin works.
- Los Angeles / LAX origin works.
- Fakecity returns `INVALID_ORIGIN`.
- Tehran returns unsupported-origin behavior and does not become Toronto.
- Auckland returns unsupported-origin behavior and does not become Toronto.
- Unsupported origins do not silently become Toronto.
- No `Book now` wording appears.
- Explore high-budget Toronto searches show `65 matches`.
- Explore high-budget New York searches show `64 matches` because same-origin New York/NYC is intentionally excluded.
- Explore high-budget Los Angeles/LAX searches show `64 matches` because same-origin Los Angeles/LAX is intentionally excluded.

## Nearby-Origin Prototype

- On the homepage, typing Hamilton shows the Toronto Pearson confirmation prompt.
- Hamilton does not navigate unless the user clicks `Use Toronto Pearson (YYZ)`.
- After confirmation, Hamilton uses the existing Toronto/YYZ supported-origin flow.
- On the homepage, typing Mississauga shows the Toronto Pearson confirmation prompt.
- Mississauga does not navigate unless the user clicks `Use Toronto Pearson (YYZ)`.
- Hamilton and Mississauga are not direct supported origins.

## Result Clarity

- Result cards show estimated flight cost.
- Result cards show estimated stay cost.
- Result cards show estimated full-trip total.
- Result cards show whether the trip fits or stretches the budget.
- Result cards explain why the destination is being shown.
- Copy makes clear that prices are estimates.

## 50-Destination Explore QA

- Backend API high-budget Toronto test returns `50` recommendations.
- Explore high-budget Toronto test shows `50 matches`.
- Explore drops `0` backend recommendations in the guarded fallback path.
- Curated frontend cards continue to render normally.
- Guarded generic fallback cards render safely when complete backend fields are available.
- Edmonton remains visible as a legacy-live review-debt card.
- Moncton remains visible as a legacy-live review-debt card.
- Orlando remains visible as a legacy-live review-debt card.
- Edmonton, Moncton, and Orlando are not treated as new expansion recommendations.
- New York renders safely.
- Cancun renders safely.
- London renders safely.
- Paris renders safely.
- Barcelona renders safely.
- Vancouver renders safely.
- Miami renders safely.
- Generic fallback cards do not invent missing booking links.
- Missing flight or stay partner links use the existing unavailable/disabled CTA behavior.

## Currency Check

- Toronto, Montreal, and Vancouver display `CAD`.
- New York, Los Angeles, Dubai, and Singapore display `USD`.
- London displays `GBP`.
- Paris displays `EUR`.
- Sydney displays `AUD`.
- Footer popular-origin links open Explore with the matching display currency.

## Partner-Link Safety

- Flight buttons say `Compare flights`.
- Stay buttons say `Compare stays`.
- General partner CTAs say `Compare on partner sites` or similar.
- Flight links preserve Travelpayouts / Aviasales / `tp.media` behavior.
- Stay links preserve Agoda partner behavior.
- No partner/tracking parameters are removed.
- No direct booking or payment flow appears.
- Globevoy does not claim to issue tickets or process hotel bookings.

## Backend 30-to-40 Expansion QA

Status: live release passed QA.

- Backend destination metadata count is `40`.
- Cartagena appears in valid high-budget recommendation tests.
- Medellin appears in valid high-budget recommendation tests.
- Madrid appears in valid high-budget recommendation tests.
- Seville appears in valid high-budget recommendation tests.
- Krakow appears in valid high-budget recommendation tests.
- Marrakech appears in valid high-budget recommendation tests.
- Budapest appears in valid high-budget recommendation tests.
- Palermo appears in valid high-budget recommendation tests.
- Lyon appears in valid high-budget recommendation tests.
- Valencia appears in valid high-budget recommendation tests.
- The second five are still MVP provisional estimates and should be reviewed carefully in QA.
- Toronto origin still returns recommendations.
- New York origin still returns recommendations.
- Los Angeles / LAX origin still returns recommendations.
- Fakecity still returns `INVALID_ORIGIN`.
- Unsupported origins do not silently become Toronto.
- Flight links still use Travelpayouts / Aviasales / `tp.media` behavior.
- Stay links still preserve Agoda partner behavior when available.
- No `Book now` wording appears.

## Backend 40-to-50 Expansion QA

Status: live release passed QA.

- Backend destination metadata count is `50`.
- San Juan appears in valid high-budget recommendation tests.
- Panama City appears in valid high-budget recommendation tests.
- San Jose appears in valid high-budget recommendation tests.
- Lima appears in valid high-budget recommendation tests.
- Bologna appears in valid high-budget recommendation tests.
- Ljubljana appears in valid high-budget recommendation tests.
- Istanbul appears in valid high-budget recommendation tests.
- Cairo appears in valid high-budget recommendation tests.
- Tokyo appears in valid high-budget recommendation tests.
- Bangkok appears in valid high-budget recommendation tests.
- All ten new `fallbackFlightUsd` values are treated as MVP provisional estimates.
- Explore shows `50 matches` for a high-budget request when the backend returns 50 recommendations.
- Guarded generic fallback cards are live and preserve the 50-match Explore count.
- Edmonton, Moncton, and Orlando remain visible as legacy-live review-debt cards.
- Toronto origin still returns recommendations.
- New York origin still returns recommendations.
- Los Angeles / LAX origin still returns recommendations.
- Fakecity, Tehran, and Auckland still return unsupported-origin behavior.
- Unsupported origins do not silently become Toronto.
- Flight links still use Travelpayouts / Aviasales / `tp.media` behavior.
- Stay links still preserve Agoda partner behavior when available.
- No `Book now` wording appears.
- Do not proceed with 100 live destinations until the 100-city candidate and generation pipeline are reviewed.

## 65-Destination Expansion And Count Hotfix QA

Status: live release passed QA.

- Backend destination metadata count is `65`.
- Backend-only 65-count hotfix was uploaded manually and live QA passed.
- Frontend hotfix package was not needed for the backend count hotfix.
- Explore requests up to `65` recommendations.
- Explore high-budget Toronto test shows `65 matches`.
- Explore high-budget New York test shows `64 matches` because same-origin New York/NYC is intentionally excluded.
- Explore high-budget Los Angeles/LAX test shows `64 matches` because same-origin Los Angeles/LAX is intentionally excluded.
- Explore should drop `0` backend recommendations when all required generic fallback fields are present.
- Alicante appears in high-budget Toronto recommendations.
- Bilbao appears in high-budget Toronto recommendations.
- Bordeaux appears in high-budget Toronto recommendations.
- Bristol appears in high-budget Toronto recommendations.
- Catania appears in high-budget Toronto recommendations and remains an approve-with-warning extra QA/watch city.
- Charlotte appears in high-budget Toronto recommendations.
- Cologne appears in high-budget Toronto recommendations.
- Dubrovnik appears in high-budget Toronto recommendations and remains an approve-with-warning extra QA/watch city.
- Malaga appears in high-budget Toronto recommendations.
- Marseille appears in high-budget Toronto recommendations.
- Nashville appears in high-budget Toronto recommendations.
- Nice appears in high-budget Toronto recommendations and remains an approve-with-warning extra QA/watch city.
- Salt Lake City appears in high-budget Toronto recommendations.
- Toulouse appears in high-budget Toronto recommendations.
- Vienna appears in high-budget Toronto recommendations.
- Generic fallback cards render the 15 Group A cities safely.
- No new curated frontend records were required for the 65-destination release.
- Partner-link behavior must remain unchanged.
- Unsupported origins must not silently become Toronto.
- Compare flights / Compare stays wording remains.
- No `Book now` wording appears.
- Stop manual city expansion after this milestone; the next destination sprint should be a non-production 250-city candidate registry.

## Local 65-To-115 Candidate QA

Status: local implementation passed checks; not deployed, not uploaded, and not packaged yet.

- Backend metadata count is `115`.
- The local 65-to-115 patch adds only the approved `50` cities from `release/city-expansion-65-to-115-implementation-ready-subset.json`.
- Zurich uses the approved adjusted estimates: flight `760`, nightly stay `220`, daily spend `140`, local activities `125`.
- Backend Toronto high-budget `limit=115` returns `115` recommendations.
- Backend New York high-budget `limit=115` returns `114` recommendations because same-origin New York/NYC is intentionally excluded.
- Backend Los Angeles/LAX high-budget `limit=115` returns `114` recommendations because same-origin Los Angeles/LAX is intentionally excluded.
- Explore defaults Region to `All current destinations` for this local 115-candidate flow.
- Explore local browser test shows `115 matches` for Toronto high-budget search.
- Explore local browser test shows `114 matches` for New York high-budget search.
- Explore local browser test shows `114 matches` for Los Angeles/LAX high-budget search.
- All `50` newly approved cities appear through guarded generic fallback cards.
- `frontend/destination-data.js` remains unchanged and was not replaced.
- Candidate, draft, generated, and release artifacts are not imported into production runtime.
- Fakecity, Tehran, and Auckland still show invalid/unsupported-origin behavior.
- Unsupported origins must not silently become Toronto.
- Partner-link behavior must remain unchanged.
- Compare flights / Compare stays wording remains.
- No `Book now` wording appears.
- Before upload, create fresh backend/frontend packages and rerun live-style QA against the package contents.

## Mobile Check

Check homepage, Explore, and Ask around mobile width:

- Sticky nav does not cover headings.
- Origin dropdown and nearby-origin confirmation do not collide with nearby cards.
- Result cards do not overflow horizontally.
- Compare buttons are large enough to tap.
- Partner/trust notes remain readable.
- Ask result cards are not too dense.

## Demo Script

1. Start on the homepage.
2. Enter `Toronto`, budget `1500`, a future month, and `5` nights.
3. Open Explore results.
4. Point out that Globevoy is budget-first and shows full-trip estimates.
5. Open one result and explain flight, stay, daily spend, local fun, and full estimate.
6. Click `Compare flights` and confirm it opens a partner/referral flight link.
7. Click `Compare stays` and confirm it opens a partner stay link when available.
8. Try `Fakecity` and confirm Globevoy does not silently fall back to Toronto.
9. On the homepage, try `Hamilton` or `Mississauga`.
10. Confirm the user must click `Use Toronto Pearson (YYZ)` before Toronto/YYZ is used.

## Go / No-Go Rule

Go for early feedback if the core smoke test, partner-link safety, and mobile check pass. Do not share the candidate if origin handling, partner links, or result-card readability fail.
