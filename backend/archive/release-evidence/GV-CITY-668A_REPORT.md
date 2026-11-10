# GV-CITY-668A — Unified 1,000-City Origin and Destination Registry

## Objective

Create one canonical city registry that can support both trip origins and generated-tour destinations without manually hard-coding route combinations for each city.

## Result

A unified registry of **1,000 city records** is now included in the backend and frontend.

- **500 current foundation cities** retained from the existing approved/provider-mapping foundation.
- **500 automatically selected expansion cities** added from the static global city/airport catalogue.
- **1,000/1,000** have a practical airport or validated gateway-airport mapping.
- **1,000/1,000** are marked origin-eligible and destination-eligible.
- **237 countries and territories** are represented.
- **53 gateway-city records** use a nearby practical airport rather than pretending the city has a direct international airport.
- **444 cities** currently have both Travelpayouts and Agoda mappings in the inherited provider foundation.

## Important activation policy

The registry does **not** claim that every city has live fares or live hotel inventory.

- The current 500 remain eligible for deterministic fallback route generation.
- The new 500 expansion cities are **provider-gated**: they can enter generated routes when provider discovery supports them, while live fares, hotel inventory, and bookability still require partner verification.
- The wider 9,665-city catalogue remains available for global origin resolution and nearest-airport fallback.
- Expansion records remain marked for product/taxonomy review rather than being silently promoted as fully production-approved destinations.

This avoids multiplying weak routes merely to advertise a larger city count.

## Canonical record fields

Each registry record includes:

- stable Globevoy city ID;
- display name, country, country code, currency, coordinates, and time zone;
- aliases and normalized search names;
- origin eligibility and provider location code;
- preferred airport and alternate airport codes;
- nearby/gateway airport metadata when required;
- destination eligibility and recommended minimum/maximum nights;
- Group 1 / Group 2 role where available;
- provider mapping status for Travelpayouts and Agoda;
- static validation status;
- live-provider-check and product-review requirements;
- deterministic or provider-gated activation status.

## Airport integrity examples

- Toronto → **YYZ** by default.
- Paris → **CDG** by default.
- Tehran international origin → **IKA**.
- Suwon → **ICN** with a Seoul/Incheon gateway transfer.
- Lucca → **PSA** with a Pisa ground transfer.
- Rabat → **RBA**.
- Faisalabad → **LYP**.
- Algiers → **ALG**.

## Backend changes

- Added `data/unified-city-registry-1000.json`.
- Added `services/city-registry.js`.
- Added `GET /api/city-registry`:
  - no query: registry summary;
  - `q=<city>`: search;
  - `mode=origin|destination|all`;
  - optional `countryCode`, `tier`, and `limit` filters.
- The global route graph reads the unified registry when the feature flag is enabled.
- The raw global catalogue remains active for origin fallback.
- The route graph keeps the expansion 500 provider-gated rather than blindly using all of them in deterministic fallback.

## Frontend changes

- Added `runtime/city-registry-1000.js`.
- Loaded the registry before `supported-origins.js` on the homepage, Explore, mixed results, and trip pages.
- Existing worldwide origin autocomplete remains available.
- Matches from the validated 1,000-city registry receive a small autocomplete priority boost.
- Exposed `window.GlobevoyCityRegistry` with `find`, `search`, and `hasOrigin` helpers.

## Feature flag

```text
ENABLE_UNIFIED_CITY_REGISTRY_668A=true
```

Setting the flag to `false` keeps the inherited destination candidate behavior. The frontend registry remains available for search metadata, but the backend route graph does not switch to the 1,000-city destination surface.

## Validation

Focused GV-CITY-668A validation: **46/46 passed**.

Validation covered:

- exact 500 + 500 composition;
- 1,000 unique city IDs;
- airport/gateway integrity;
- coordinates, country, and currency fields;
- 237-country coverage;
- Toronto, Rabat, Faisalabad, Algiers, Lima, Tehran, Suwon, and Lucca resolution;
- Suwon → ICN and Lucca → PSA gateway behavior;
- backend registry summary/search API;
- registry-powered route graph activation;
- preservation of the wider global origin fallback;
- frontend load order and autocomplete prioritization;
- automatic candidate generation from Rabat.

Inherited regression validations also passed:

- GV-EVIDENCE-667E;
- GV-CONTROL-667D;
- GV-CONTROL-667C;
- GV-LIVE-667B;
- GV-LIVE-667A;
- GV-DATE-666B;
- GV-MVP-666A.

## Honest production boundary

This task creates the scalable registry foundation. It does not prove live fare or hotel coverage for all 1,000 cities. Final prices, schedules, rooms, transfers, and booking availability remain confirmed on partner websites. The next city-data stage should resolve more Agoda mappings, run provider coverage audits, and promote expansion cities in reviewed batches rather than switching all 500 on blindly.
