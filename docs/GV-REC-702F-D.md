# GV-REC-702F-D — High-Confidence Preferred-Airport QA Overlay

## Purpose

Apply the nine strongest GV-REC-702F-C airport-foundation corrections to the **dedicated staging QA runtime only** so Globevoy can test real route-graph behavior before any base-registry or production promotion is considered.

This task does not rewrite the 1,000-city registry JSON.

## Scope

The overlay contains exactly nine `strong-replacement-candidate` rows from the corrected 702F-C triage:

| City | Current preferred | Staging QA preferred |
| --- | --- | --- |
| Beijing | NAY | PEK |
| Cambridge | CBG | STN |
| Detroit | DET | DTW |
| Diani Beach | UKA | MBA |
| Kansas City | MKC | MCI |
| Orlando | ORL | MCO |
| Pretoria | PRY | HLA |
| Sacramento | SAC | SMF |
| Sedona | SDX | FLG |

The change is deliberately additive. The new airport is prepended to `origin.airportCodes`, while existing airport codes remain available for compatibility during QA. Only `origin.preferredAirportCode` changes.

## Source evidence

The candidates come from:

- `GV-REC-702F-C` corrected 50-city triage;
- `GV-REC-702F-B-R1` OurAirports gateway audit;
- pinned OurAirports commit `55fd4071c99668a29f9d3625d72405c44074ef2f`;
- pinned `airports.csv` Git blob `b95a254e2d970ecb37320d645abced90c6d1a95f`.

Dedicated CI re-downloads that exact immutable snapshot and verifies:

- every old preferred code exists but has `scheduled_service=no`;
- every proposed preferred code exists with `scheduled_service=yes`;
- every proposed airport is a large or medium airport;
- every proposed airport is in the same country;
- every proposed airport is within 40 km of the curated destination coordinates.

This is airport-foundation evidence only. It is not proof that a particular itinerary/date/fare is available.

## Runtime design

`backend/services/staging-gateway-foundation-702f-d.js` mutates only the in-memory `GV-CITY-668B` registry object in the dedicated staging Lambda process.

It is installed by `staging-lambda-702d.js` **before** the ordinary staging Lambda loads `city-registry.js` and `generated-tour.js`.

The overlay requires all of:

- `ENABLE_STAGING_GATEWAY_FOUNDATION_702F_D=true`
- `ENABLE_UNIFIED_CITY_REGISTRY_668A=true`
- `ENABLE_PROVIDER_MAPPING_COMPLETION_668B=true`
- exact staging `CORS_ORIGIN=https://staging.dy4fw8gx1ccie.amplifyapp.com/`

If the explicit 702F-D flag is absent, the overlay changes nothing.

If preflight sees an unexpected base preferred-airport code, missing city, wrong country, or a non-1,000-city registry, it fails closed before applying any partial corrections.

## What changes

For the nine selected rows only:

- `origin.preferredAirportCode` becomes the reviewed airport;
- the reviewed airport is prepended to `origin.airportCodes`;
- `origin.stagingGatewayFoundation` records staging-only provenance.

## What does not change

- the committed `unified-city-registry-1000-668b.json` file;
- city coordinates;
- Travelpayouts provider-mapping objects;
- Agoda mappings;
- 668T activation snapshot;
- 702D reviewed-recovery activation overlay;
- production/main;
- thresholds;
- exact-itinerary verification requirements.

The four 702F-C registry-integrity holds remain explicitly untouched:

- Saint Martin
- Umueri
- Sun City
- Khost

Ukraine operational/airspace holds and all manual gateway-review rows are also untouched.

## Validation contract

`backend/validation/validate-gv-rec-702f-d.js` requires:

- exact nine-city manifest;
- exact source commit/blob provenance;
- flag-off behavior makes zero changes;
- wrong origin or missing registry switches makes zero changes;
- exact nine records change under the QA conditions;
- the other 991 records remain deep-equal to the base registry;
- provider objects and coordinates remain unchanged for all nine;
- all prior airport codes are preserved;
- the route-graph conversion uses the new preferred airport as `primaryAirportCode`;
- the staging entrypoint installs 702F-D before loading the ordinary staging Lambda;
- a cold-start integration test sees all nine corrections on the 1,000-city route surface;
- the imported 668T production-active baseline remains 439.

## Staging QA diagnostic

When enabled, responses from `staging-lambda-702d.handler` include:

`X-Globevoy-Staging-Gateway: GV-REC-702F-D`

When disabled, the same header reports `disabled`.

## Safety and rollback

This task is staging-only. It does not authorize production promotion.

Rollback options:

1. remove `ENABLE_STAGING_GATEWAY_FOUNDATION_702F_D`; or
2. restore the previous staging backend artifact.

No production environment variable is required or recommended.

## Follow-up

After deployment to the isolated staging Lambda, QA should verify:

1. `/api/city-registry` returns the new preferred airports for all nine cities;
2. representative generated-tour/global-route-graph flows use the corrected primary airport codes;
3. 702D still reports 441 staging-QA live-eligible destinations;
4. unrelated city mappings and existing gateway behavior are unchanged.

Only after staging QA should a separate task decide whether any corrections belong in a new immutable base-registry revision.
