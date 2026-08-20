# GV-CITY-668B — Provider Mapping Completion and Coverage Audit

## Objective

Extend the unified 1,000-city registry with a documented Travelpayouts and Agoda mapping strategy for every city, while refusing unsafe city substitutions and avoiding false live-inventory claims.

## Result

- **1000/1,000** cities now have a documented provider strategy.
- **1000/1,000** have a statically validated Travelpayouts city, metro, airport, or gateway mapping.
- **870/1,000** have an accepted Agoda exact, alias, coordinate-confirmed, inherited, or explicitly reviewed nearby-market mapping.
- **870/1,000** have both provider mappings configured statically.
- **130** remain Agoda-unresolved rather than being force-matched.
- **43** unresolved records are in countries or territories absent from the uploaded Agoda feed.

The audit processed **1,264,371 Agoda hotel rows** into **51,282 city-market clusters**.

Of the original 500-city foundation, **494** now have both static mappings. This is higher than the 668A count of 444 because **50 existing non-airport destinations** now carry an explicit, statically validated gateway-airport strategy rather than an unresolved Travelpayouts status. Those gateways are still not treated as live-fare evidence.

Of the 500 expansion cities, **376** now have both static mappings. The remaining Agoda gaps are exported in `GV-CITY-668B_UNRESOLVED_AGODA_REVIEW.csv` for later provider or manual review.

## Mapping policy

Travelpayouts mappings are classified as direct city/airport codes, metro codes, validated airport fallbacks, or gateway airports. All 1,000 require a live fare check before a fare claim.

Agoda mappings are accepted only through:

- inherited verified mapping;
- exact normalized city + country;
- reviewed alias + country;
- high-similarity name + coordinates;
- safe same-country coordinate confirmation;
- an explicit nearby/regional-market rule.

The implementation does **not** select an arbitrary nearest Agoda city merely to reach 1,000/1,000. Unresolved cities remain clearly marked.

## Files added

- `data/provider-mappings-1000-668b.json`
- `data/unified-city-registry-1000-668b.json`
- `services/provider-mapping-audit.js`
- `validate-gv-city-668b.js`
- `VALIDATION_GV_CITY_668B.json`

## API

Added `GET /api/provider-coverage`.

Without filters it returns the mapping summary. Supported filters include:

- `q`
- `countryCode`
- `provider=agoda|travelpayouts|both`
- `status`
- `mappingType`
- `tier`
- `unresolved=true`
- `limit`

## Feature flag

```text
ENABLE_PROVIDER_MAPPING_COMPLETION_668B=true
```

The flag switches `services/city-registry.js` from the original 668A registry to the provider-enriched 668B registry. Turning it off restores the 668A provider subset and counts.

## Production boundary

This is a static mapping and data-coverage audit. No package contains API credentials, and no record is marked live-verified. Fare availability, hotel inventory, room rates, schedules, and booking availability still require deployed provider calls and partner-page confirmation.
