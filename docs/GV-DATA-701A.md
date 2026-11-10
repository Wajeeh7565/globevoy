# GV-DATA-701A — Worldwide City Registry Foundation

## Objective

Create one clear worldwide city architecture without duplicating the large datasets Globevoy already has.

Globevoy currently has three useful but separate trust layers:

1. the global city/airport catalogue used for worldwide origin resolution;
2. the curated 1,000-city origin/destination registry;
3. the verified city activation snapshots used to gate production recommendation capability.

GV-DATA-701A adds a read-only overlay service that makes those layers explicit and queryable while preserving their different meanings.

## Existing data preserved

701A does **not** generate or import another giant city list.

It reuses:

- `data/global-destination-catalogue.json` — the existing 9,665-city worldwide identity/origin catalogue;
- `data/unified-city-registry-1000-668b.json` — the existing 1,000-city curated destination registry with provider-mapping metadata;
- `services/verified-city-activation.js` — the reviewed activation layer, currently capable of selecting the GV-CITY-668T snapshot with 439 production-active cities.

This avoids divergent city IDs, duplicate airport ownership, duplicate provider mappings, and inconsistent destination-approval rules.

## Trust layers

### 1. Worldwide identity and origin layer

All 9,665 global catalogue records remain available for city identity, airport resolution, worldwide origins, and gateway/nearest-airport logic.

A record at this layer is **not automatically a Globevoy destination**.

### 2. Curated destination layer

The existing 1,000-city unified registry remains the reviewed destination-candidate surface.

A curated city can be used for deterministic/estimate-based discovery according to the existing product rules, but static registry/provider mappings do not prove current availability.

### 3. Production-active layer

When the verified activation feature is enabled, only records accepted by the selected activation snapshot receive the `production-active` recommendation tier.

The current GV-CITY-668T snapshot represents 439 production-active cities. This is sampled provider capability, not a guarantee for every route/date combination.

### 4. Exact itinerary verification

Every 701A record keeps `requiresExactItineraryVerification: true`.

A city being production-active does not by itself prove a current fare, room, schedule, transfer, or bookable itinerary. Exact route/date/price checks remain mandatory before live claims.

## New service

`services/worldwide-city-registry-701a.js`

The service provides:

- `worldwideRegistrySummary()`
- `resolveWorldwideCity(input, options)`
- `searchWorldwideRegistry(query)`

Search scopes:

- `all` — worldwide identity surface;
- `origin` — records with usable airport/origin resolution;
- `destination` — only curated destination records;
- `active` — only activation-approved production-active destination records.

The returned record exposes the layers separately:

- identity metadata;
- origin/airport metadata;
- curated destination metadata;
- static provider/validation metadata when available;
- verified activation state;
- recommendation tier.

A raw worldwide record outside the curated 1,000 is returned as `origin-only`; it is never silently promoted to a destination and does not inherit curated provider approval objects.

## Feature flag

```text
ENABLE_WORLDWIDE_CITY_REGISTRY_701A=true
```

The service is additive in 701A. Existing generated-tour and route-graph behavior is not switched to this service by this task.

## Validation

`validate-gv-data-701a.js` verifies the current architecture, including:

- the 9,665-city worldwide catalogue baseline;
- exactly 1,000 curated destination records;
- 439 production-active records when GV-CITY-668T is selected;
- worldwide country/territory breadth;
- Toronto → YYZ airport integrity;
- worldwide origin resolution for Lahore and Rabat;
- destination searches excluding raw non-curated cities;
- active searches requiring activation approval;
- raw worldwide cities remaining `origin-only`;
- exact-itinerary verification remaining mandatory.

The focused validation is included in the normal GitHub Actions validation workflow alongside the existing 687B regression checks.

## Scope boundary

701A is an architecture and trust-boundary task. It does not:

- promote all 9,665 cities to destination status;
- change production or staging Lambda configuration;
- add provider credentials;
- call live providers;
- change ranking or route generation;
- claim live fare or hotel coverage;
- modify the current frontend experience.

## Rollback

No current runtime path depends on the new service. Removing the service/validator or leaving `ENABLE_WORLDWIDE_CITY_REGISTRY_701A` disabled restores the pre-701A code surface without changing existing production behavior.

## Next step

GV-DATA-701B should expose this layered registry through a bounded read-only API and, after validation, let staging consumers use one consistent worldwide lookup contract. Runtime destination expansion should remain a separate reviewed step rather than enabling all worldwide identities as destinations at once.
