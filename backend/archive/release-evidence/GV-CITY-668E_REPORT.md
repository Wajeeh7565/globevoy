# GV-CITY-668E — Agoda Quality Candidate Retrieval

## Status

Backend implementation and offline validation are complete.

This task was created from the GV-CITY-668D Review66 audit. That audit completed all 66 cities, found 24 with live coverage from both providers, and found 13 provider-covered cities that still failed recommendation readiness because the Agoda sample did not contain a quality-qualified property. Two of those 13 also failed the existing flight-comfort policy.

No production-provider rerun was performed while packaging this release. The authoritative outcome for the 13-city repair must come from the deployed Lambda using the supplied audit runner and the credentials already stored in AWS.

## Problem

GV-CITY-668D judged Agoda stay quality from a narrow city-search result slice. The audit request used `PriceAsc` and a maximum of 10 properties. In large cities, that slice can be dominated by hostels, private rooms, thin-review listings, or rates rejected by the price-integrity audit even when the city has substantial hotel inventory.

This created avoidable false negatives for cities such as Lahore, Islamabad, Bangkok, Nairobi, Delhi, Mumbai, Karachi, Colombo, Jakarta, Antananarivo, and Ayutthaya.

## Implementation

### Audit-only diversified Agoda retrieval

When `ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E=true`, the coverage audit now uses a bounded quality-oriented candidate strategy:

1. `Recommended`, up to 30 properties.
2. `AllGuestsReviewScore`, up to 30 properties.
3. Optional third fallback: `StarRatingDesc`, up to 30 properties.

The default is two strategies. The hard maximum is three strategies and 30 results per strategy.

The search stops as soon as a property passes both:

- the existing structural quality floor; and
- the existing price-integrity audit.

The customer-facing Agoda stay estimator was not changed. It continues using its existing price-sorted request and booking flow.

### Quality standards were not weakened

The existing rejection rules remain active:

- low-trust property type or name;
- review score below 7 when provided;
- star rating below 3 when provided;
- fewer than 25 reviews when provided;
- missing or unsupported price field;
- ambiguous price unit;
- unsupported or missing currency;
- implausibly low live rate.

### Diagnostic evidence

Each Agoda audit attempt now records:

- candidate retrieval mode;
- sort strategy;
- requested maximum result count;
- raw, priced, structurally qualified, and price-qualified counts;
- selected strategy;
- rejection reasons;
- whether provider quality filters were accepted or required a fallback request.

This makes a city-level failure explainable instead of returning only `no-qualified-live-rate`.

### Existing protections retained

- Provider mapping and live inventory remain separate from recommendation readiness.
- Injected/mock provider responses cannot activate a city in production.
- The GV-CITY-668D multi-month flight verification remains intact.
- Gateway repairs for Tulum/CUN and Caye Caulker/BZE remain intact.
- Flight duration and transfer-count comfort requirements remain intact.
- The private verifier remains protected by `GV_PROVIDER_COVERAGE_ADMIN_TOKEN`.

## Feature flag

Add:

```text
ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E=true
```

Optional tuning values:

```text
GV_AGODA_QUALITY_STRATEGY_COUNT=2
GV_AGODA_QUALITY_MAX_RESULT=30
```

Keep all earlier 668A–668D flags and provider credentials configured.

Rollback is immediate: set `ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E=false`. The audit then returns to the legacy `PriceAsc`, 10-result candidate method while retaining the 668D verifier.

## Audit sequence

After deploying the backend:

1. Run `Smoke3` for Lahore, Bangkok, and Delhi.
2. Run `Quality13` for all provider-covered but not recommendation-ready cities from Review66.
3. Review which cities were recovered and why the remainder failed.
4. Run `Pilot100` so all 100 pilot cities are evaluated under one consistent 668E policy.
5. Build the production activation snapshot only from that final consistent run.

## Validation

Focused GV-CITY-668E validation: **40/40 passed**.

Validated behavior includes:

- supported Agoda sort strategies;
- hard 30-result cap;
- default two-strategy cap;
- second-strategy recovery after an unqualified first slice;
- structural and price rejection diagnostics;
- unchanged customer-facing price-sorted estimator;
- production-safety treatment of injected responses;
- endpoint version and admin protection;
- snapshot merge and policy metadata;
- Tulum and Caye Caulker gateway regressions;
- multi-window date regressions;
- flight-comfort regression;
- flag-off rollback to the legacy candidate method.

Inherited checks also passed during packaging:

- GV-CITY-668B: 30/30
- GV-CITY-668A: 46/46
- GV-EVIDENCE-667E: 12/12
- GV-CONTROL-667D: 21/21
- GV-CONTROL-667C: 20/20
- GV-MVP-666A: 11/11

## Files added or changed

Changed:

- `services/agoda.js`
- `services/provider-live-coverage.js`

Added:

- `data/provider-live-quality-review-13-668e.json`
- `run-gv-city-668e-live-audit.js`
- `Run-GV-CITY-668E-Agoda-Quality-Audit.ps1`
- `validate-gv-city-668e.js`
- `VALIDATION_GV_CITY_668E.json`
- `GV-CITY-668E_REPORT.md`
- `MANIFEST_GV_CITY_668E.txt`
