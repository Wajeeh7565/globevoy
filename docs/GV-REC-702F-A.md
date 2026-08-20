# GV-REC-702F-A — Travelpayouts cache-miss semantics

## Purpose

Correct the evidence model before changing any production activation logic.

Globevoy already distinguishes provider evidence classes (`LIVE_PROVIDER`, `CACHED_PROVIDER`, `UNAVAILABLE`). Travelpayouts observations produced by `cheap-one-way-flights.js` are already tagged `CACHED` in price evidence.

The remaining problem is historical coverage semantics: `provider-live-coverage.js` currently treats a zero-result Travelpayouts verification as `providerMappingVerified:false`. That conflates two separate facts:

1. **Static mapping validity** — whether the destination has a reviewed Travelpayouts location/gateway mapping.
2. **Recent cache observation** — whether the Travelpayouts Data API returned a cached observation in the bounded query window.

A cache miss does not prove that the static mapping is invalid, that the route does not exist, or that an exact-date itinerary is unavailable.

## 702F-A model

702F-A introduces a pure, read-only semantics layer:

- `staticProviderMappingVerified`
- `cacheObservationStatus`
- `evidenceClass`
- `rankingGrade`
- `exactDateLiveVerificationSatisfied`
- `availabilityConclusion`
- `liveVerificationRecommended`

### Positive Travelpayouts observation

Interpreted as:

- `CACHED_PROVIDER`
- `PLANNING_ONLY`
- exact-date live verification **not** satisfied
- never decision-grade from Travelpayouts cache alone

### Zero Travelpayouts observation

Interpreted as:

- `NO_RECENT_CACHE_OBSERVATION`
- static mapping remains valid when the reviewed mapping exists
- availability conclusion is `unknown-not-proven-unavailable`
- Duffel exact-date verification is recommended
- no activation is written

### Provider error / missing credentials

These also do not erase a reviewed static mapping. They mean the cache query was not successfully completed.

## Deterministic baseline finding

The current reviewed 1,000-city coverage state contains:

- 1,000 curated destinations
- 1,000 reviewed Travelpayouts static mappings
- 423 cities in the historical `missing-flight-observations` retry queue
- 335 cities where missing flight observations are the primary gap
- 439 production-active cities in the immutable GV-CITY-668T baseline

Therefore all 423 historical `missing-flight-observations` cities still have reviewed static Travelpayouts mappings. Their historical blocker is lack of cached observation evidence, not lack of provider mapping.

## Safety boundary

702F-A:

- performs **no network/provider calls**;
- does **not** modify `provider-live-coverage.js` yet;
- does **not** import into Lambda/runtime code;
- does **not** change GV-CITY-668T;
- does **not** activate or deactivate any city;
- does **not** change ranking/pricing/booking behavior;
- does **not** relax any threshold.

The follow-up integration should be small and feature-gated: the 668E verifier can consume this semantics model while preserving the existing production baseline until staging QA proves the new interpretation is safe.

## Recommended follow-up

**GV-REC-702F-A-R1**

Integrate these semantics into the staging verifier behind an explicit QA flag:

- cache miss => keep static mapping valid;
- cache hit => expose cached/planning evidence rather than exact-live semantics;
- Duffel exact-date offers => separate live-verification state;
- production activation remains unchanged until a new reviewed policy is approved.

After that, proceed to **702F-B** for OurAirports-based gateway candidate enrichment.
