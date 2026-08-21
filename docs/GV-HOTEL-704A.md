# GV-HOTEL-704A — Agoda Demand Readiness Audit

## Scope

704A is a research + deterministic contract task. It does **not** call Agoda, deploy AWS code, enable hotel traffic, copy credentials, change production, or replace the existing `backend/services/agoda.js` path.

The goal is to answer one question before implementation: **what must Globevoy change to use the current Agoda Demand Search API safely and truthfully?**

## Current Globevoy state

The existing Agoda service is a legacy affiliate integration:

- file: `backend/services/agoda.js`
- default endpoint: `https://affiliateapi7643.agoda.com/affiliateservice/lt_v1`
- credentials: `AGODA_SITE_ID` + `AGODA_API_KEY`
- request identity: destination `agodaCityId`
- existing recommendation code already fails closed to labelled hotel planning estimates when Agoda is unavailable or errors
- existing trust logic deliberately does not claim current availability or final landing-page price confirmation

This code should **not** be pointed at the new Demand endpoint as-is.

## Current Agoda Demand contract researched for 704A

Authoritative documentation reviewed on 2026-08-21:

- Agoda Demand Getting Started: `https://developer.agoda.com/demand/docs/getting-started`
- Search API: `https://developer.agoda.com/demand/docs/json-search-api`
- Authentication: `https://developer.agoda.com/demand/docs/authentication`
- API Key: `https://developer.agoda.com/demand/docs/api-key`
- Content API: `https://developer.agoda.com/demand/docs/content-api`

Important findings:

1. The current JSON Search API uses `POST /api/v4/property/availability`.
2. Search is **property-ID based**, not city-ID based. A request carries `criteria.propertyIds` and supports up to 100 hotel IDs.
3. Search criteria include check-in, check-out, rooms, adults, children/ages, language, currency and user country.
4. Agoda returns explicit room availability plus `totalPayment.inclusive`, taxes, fees and `perRoomPerNightRate`.
5. `totalPayment.inclusive` is the safest canonical search-occupancy stay total. Globevoy must not rebuild or re-multiply that number from a nightly value.
6. Search results do not replace property-content ingestion. Agoda directs partners to Content API/feed for hotel content/property identifiers.
7. OAuth 2.0 is the recommended authentication path. API-key authentication is still documented but is scheduled for deprecation by the end of 2026 and requires IP whitelisting for partners onboarding with that method.
8. Partner onboarding/site credentials and certification are part of Agoda's stated path before switching to Live.
9. Agoda recommends Pre-check before booking because rate and allotment can change. Globevoy 704 does not add booking or pre-check capability; that remains a future commercial/transaction task.

## Main architecture consequence

Globevoy's existing `agodaCityId` coverage work is still useful as historical provider mapping evidence, but it is **not sufficient to drive the modern Search API**.

Modern live hotel pricing needs a property catalog layer:

`Globevoy destination -> relevant Agoda property IDs -> bounded Search API call -> room/rate observations`

Therefore the correct migration boundary is a **new Agoda Demand adapter**, not a silent edit of the old 679A legacy adapter.

## 704A code added

`backend/services/agoda-demand-readiness-704a.js` is pure and provider-call-free. It:

- validates modern Search request inputs;
- enforces max 100 property IDs;
- builds current JSON Search request shape;
- parses synthetic current Search responses;
- treats `totalPayment.inclusive` as one canonical party/search-occupancy stay total;
- preserves nightly, tax and fee evidence separately;
- requires an actually returned room/block/rate before calling evidence LIVE;
- keeps order/payment/booking capabilities false;
- exposes the migration blockers/status without reading credentials.

`backend/validate-gv-hotel-704a.js` proves the request and response semantics deterministically with no provider call.

## User-trust requirements carried into 704B+

Reddit/user reports are not authoritative API documentation, but they reinforce why the product boundary matters. Recent travel/developer discussions repeatedly mention API-access difficulty, price volatility, and price/listing mismatch concerns. That supports these Globevoy requirements:

- display the provider-observed total and evidence time/basis clearly;
- never imply a planning estimate is live availability;
- never reconstruct Agoda's party/search total by multiplying it again;
- preserve taxes/fees separately when returned;
- keep final price/availability verification language until a future pre-check/booking integration exists;
- fall back cleanly instead of substituting stale or incomparable provider evidence.

## 704A conclusion

**Current legacy Agoda adapter != current Agoda Demand Search contract.**

704B should only begin once we decide how to obtain the modern property-ID catalog and confirm partner credential/onboarding status. Then 704B can implement a new provider adapter behind a staging-only flag and injected-fake CI before any real operator QA.

## 704B proposed scope

1. Property catalog ingestion/mapping contract (Content API/feed or approved dataset).
2. New `agoda-demand-adapter-704b.js` with no dependency on legacy city-ID request shape.
3. Staging-only Search call cap and timeout.
4. Exact stay dates + occupancy.
5. Canonical `totalPayment.inclusive` party/search total.
6. Taxes/fees and cancellation evidence preserved.
7. Fail closed to existing planning estimate on auth, rate, property-map or availability failure.
8. No Book/Pre-check/payment/order capability.
9. Public production remains off until operator QA and explicit approval.
