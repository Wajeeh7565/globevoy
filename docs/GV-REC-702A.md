# GV-REC-702A — Global Recommendation Coverage Audit

## Purpose

GV-REC-702A measures recommendation readiness across the existing curated 1,000-city registry before any global candidate-pool expansion is attempted.

The audit is deliberately read-only. It answers:

- how many curated cities have usable route identity;
- how many have static flight-provider mappings;
- how many have static stay-provider mappings;
- how many are present in the reviewed GV-CITY-668T activation snapshot;
- how many are currently production-active in that snapshot;
- what evidence-backed gap code remains for each non-active city;
- which mapped/reviewed inactive cities form the best later re-audit pool;
- how coverage differs by world region and selection tier.

## Source datasets

702A reads reviewed repository data only:

- `backend/data/unified-city-registry-1000-668b.json`
- `backend/data/provider-mappings-1000-668b.json`
- `backend/data/verified-city-activation-1000-668t.json`

It does not call providers while calculating the audit.

The known 668T baseline remains 439 production-active cities out of the curated 1,000. The remaining 561 are not automatically activated by 702A.

## Readiness tiers

Each curated city receives exactly one audit tier:

- `production-active` — 668T sampled activation allows live recommendation, while exact itinerary verification still remains mandatory;
- `mapped-reviewed-inactive` — destination, route identity, and both static provider mappings are present, but reviewed activation still does not allow production-active recommendation;
- `mapped-needs-audit` — static foundation is present but reviewed activation evidence is absent;
- `foundation-gap` — curated destination is eligible but at least one route/provider foundation signal is missing;
- `not-destination-ready` — curated record is not currently destination-eligible.

## Gap classification

702A uses conservative evidence-backed codes rather than guessing at provider behavior:

- `destination-ineligible`
- `missing-route-identity`
- `missing-flight-provider-mapping`
- `missing-stay-provider-mapping`
- `not-in-668t-audit`
- `reviewed-not-production-active`
- `retry-queue:<reviewed queue name>`

The original activation reason, classification, retry queues, provider coverage, and recommendation-readiness evidence are preserved on each record when present.

A retry queue is an operational worklist, not proof that inventory never exists.

## Staging API

The isolated staging Lambda exposes:

`GET /api/global-recommendation-coverage`

No query returns the global summary.

Supported read filters include:

- `resolve=<city or cityId>` with optional `countryCode=<CC>`;
- `q=<text>`;
- `countryCode=<CC>`;
- `region=<world region>`;
- `tier=<selection tier>`;
- `readiness=<readiness tier>`;
- `gap=<gap code>`;
- `active=true|false`;
- `mapped=true|false`;
- `gateway=true|false`;
- bounded `offset` and `limit`.

The endpoint is GET-only, requires the exact configured staging browser Origin, and is enabled only when:

`ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A=true`

## Trust boundary

702A does **not**:

- change `backend/lambda.js`;
- change the recommendation candidate pool;
- change route ranking or diversity logic;
- activate any city;
- call Duffel, Travelpayouts, Agoda, Stay22, or another provider;
- claim that a static provider mapping is live availability;
- claim that an activation sample is a current exact fare or hotel room;
- change traveller-specific passport/visa decisions;
- remove exact route/date/price verification.

Every 702A record therefore exposes:

`requiresExactItineraryVerification: true`

## Intended next use

702A should identify the highest-value expansion pools for later 702 phases. In particular, `mapped-reviewed-inactive` cities are candidates for targeted provider re-audit because their static foundation is already present. They are not automatic activation candidates.

## Deployment

This change is designed for the isolated staging backend first. Merging to `staging` does not deploy or modify the production Lambda. A staging Lambda code deployment and explicit staging-only feature flag are required before live smoke testing the endpoint.
