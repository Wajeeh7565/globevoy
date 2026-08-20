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

## Observed 702A baseline

The focused CI audit reconciled all 1,000 curated destinations and produced this deterministic snapshot:

- curated destinations: **1,000**;
- destination-eligible: **1,000**;
- usable route identity: **1,000**;
- Travelpayouts static mapping: **1,000**;
- Agoda static mapping: **870**;
- both static provider mappings: **870**;
- audited in GV-CITY-668T: **1,000**;
- production-active: **439**;
- reviewed-inactive: **561**;
- gateway-dependent: **53**;
- mapped + reviewed-inactive: **431**;
- foundation-gap: **130**.

The key finding is that the next expansion bottleneck is **not city identity, route identity, or flight mapping**. All 1,000 already have those foundations. The largest immediate pools are:

1. **431 mapped/reviewed-inactive cities** that already have both static provider mappings and need targeted evidence/re-audit work rather than blind mapping expansion;
2. **130 foundation-gap cities**, all represented by missing stay-provider mapping in the current data.

Primary blocker classification across the 561 reviewed-inactive cities is mutually exhaustive:

- `retry-queue:missing-flight-observations`: **335**;
- `missing-stay-provider-mapping`: **130**;
- `retry-queue:flight-comfort-failure`: **44**;
- `reviewed-not-production-active`: **30**;
- `retry-queue:hotel-quality-failure`: **14**;
- `retry-queue:no-live-hotel-rate`: **8**.

Retry-queue membership can overlap, so operational queue counts are larger than primary-blocker counts:

- missing flight observations: **423**;
- unresolved Agoda mapping: **130**;
- flight comfort failure: **54**;
- hotel quality failure: **50**;
- no live hotel rate: **51**.

Regional production-active coverage in the reviewed 668T snapshot:

- Europe: **139 / 225 (61.8%)**;
- Asia: **126 / 238 (52.9%)**;
- Americas: **95 / 266 (35.7%)**;
- Other: **21 / 58 (36.2%)**;
- Oceania: **20 / 72 (27.8%)**;
- Africa: **38 / 141 (27.0%)**.

Selection-tier coverage shows the strongest imbalance:

- current-500: **318 / 500 (63.6%)** production-active;
- expansion-500: **121 / 500 (24.2%)** production-active.

This means later 702 work should prioritize evidence recovery and regional/expansion-tier balance before simply widening the recommendation candidate pool.

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

The audit changes the recommended sequence for later 702 phases. The highest-leverage next pool is the **431 mapped/reviewed-inactive cities**, especially the 335 whose primary blocker is missing flight observations. Those cities have more supporting foundation than the 130 cities still missing stay mappings.

No city should become production-active merely because it appears in this pool. Later work must preserve the reviewed activation gate and exact route/date/price verification.

## Deployment

This change is designed for the isolated staging backend first. Merging to `staging` does not deploy or modify the production Lambda. A staging Lambda code deployment and explicit staging-only feature flag are required before live smoke testing the endpoint.
