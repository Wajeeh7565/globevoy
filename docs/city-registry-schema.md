# Globevoy Provider-Neutral City Registry Schema

Draft status: planning document only.

This file defines the proposed future city registry for Globevoy. It does not
represent the current live frontend or backend destination datasets.

## 1. Purpose

Globevoy currently has separate frontend and backend city datasets. The backend
dataset supports live recommendations, Agoda city IDs, fallback flight costs,
and stay estimates. The frontend dataset supports local fallback behavior, map
placement, Ask/Explore content, and curated trip framing. Because these files
are not aligned, city coverage can drift: a city may appear in the UI but not be
eligible for backend live pricing, or it may work in the backend but be missing
from frontend map and fallback experiences.

The provider-neutral city registry should become the single canonical source
for city identity, provider mappings, validation status, and product
classification. Frontend and backend datasets should eventually be generated
from this registry instead of maintained independently.

## 2. Registry Principles

- Globevoy owns the canonical city record.
- Agoda, Travelpayouts, Aviasales, and future partners are provider mappings,
  not the source of truth.
- Raw provider feeds should not be committed to the frontend or repository.
- Provider feeds should be converted into compact derived fields, such as
  verified IDs, hotel counts, coverage status, coordinates, and aliases.
- Every city should carry a validation status before it is used in live
  recommendation flows.
- Product labels such as Group 1 and Group 2 should be reviewed by humans before
  they affect ranking or user-facing recommendations.
- Provider availability, prices, routes, hotels, and bookability should always
  be treated as dynamic and rechecked through live integrations when needed.

## 3. Proposed City Registry Schema

| Field | Type | Purpose | Example value | Required | Validation rule |
| --- | --- | --- | --- | --- | --- |
| `globevoyCityId` | string | Stable internal city ID used across frontend, backend, provider mappings, and future generated datasets. | `valencia-es` | Required now | Must be unique, lowercase, URL-safe, and stable after approval. |
| `displayCity` | string | User-facing city name. | `Valencia` | Required now | Must be reviewed for spelling, language, and disambiguation. |
| `country` | string | User-facing country name. | `Spain` | Required now | Must match a reviewed country name and provider country mapping. |
| `countryCode` | string | ISO-style country code for matching and future integrations. | `ES` | Required soon | Must be verified against a country-code source. |
| `region` | string or null | State, province, island, or administrative region when useful for disambiguation. | `Valencian Community` | Useful soon | Required when city names are ambiguous across countries or regions. |
| `latitude` | number | Canonical map latitude. | `39.49` | Required now | Must be valid latitude and reviewed against provider or curated source. |
| `longitude` | number | Canonical map longitude. | `-0.48` | Required now | Must be valid longitude and reviewed against provider or curated source. |
| `aliases` | string[] | Searchable names, spelling variants, and common user inputs. | `["Valencia", "Valencia Spain", "Valencia, Spain", "Valencia ES", "València", "Valensia"]` | Required now | Must not create duplicate canonical cities; typo aliases require review. |
| `normalizedSearchNames` | string[] | Lowercase, accent-free, punctuation-light search tokens derived from aliases. | `["valencia", "valencia spain", "valensia"]` | Required now | Must be generated consistently from approved aliases. |
| `mapCoordinatesSource` | string | Source of canonical coordinates. | `frontend-curated-needs-review` | Required now | Allowed values should be controlled, such as `travelpayouts`, `agoda`, `manual-reviewed`, `frontend-curated-needs-review`. |
| `travelpayoutsCityCode` | string or null | Travelpayouts/Aviasales city IATA code used for flight-side matching. | `VLC` | Required for live flight recommendations | Must be verified against Travelpayouts city data or autocomplete. |
| `travelpayoutsAirportCodes` | string[] | Airport codes associated with the city or practical flight search area. | `["VLC"]` | Required for live flight recommendations | Each code must be verified as an airport code or accepted city-airport code. |
| `agodaCityId` | number or null | Agoda city identifier used for hotel/stay searches. | `null` | Required for live Agoda coverage, otherwise explicitly null | Must be verified from Agoda city/content data before use. |
| `agodaHotelCount` | number or null | Derived active hotel count or verified coverage count. | `null` | Useful soon | Must be derived from Agoda data, not guessed. |
| `agodaCoverageStatus` | string | Hotel provider coverage status. | `missing-needs-review` | Required now | Allowed values: `strong`, `partial`, `missing`, `missing-needs-review`, `unverified`. |
| `primaryAirportCode` | string or null | Main practical airport used for trip planning. | `VLC` | Required for supported flight cities | Must be reviewed for practical routing, not only literal proximity. |
| `nearestMajorAirportCode` | string or null | Nearby larger airport used for suggestion logic when relevant. | `MAD` | Later | Must require user confirmation if used as an origin or route suggestion. |
| `providerCoverage` | object | Compact status summary for each provider. | `{ "travelpayouts": "needs-review", "agoda": "missing-needs-review" }` | Required now | Each provider status must be one of the approved status values. |
| `groupRole` | string | Product classification for Group 1 / Group 2 route strategy. | `group2-secondary` | Useful soon | Draft labels must be product-reviewed before ranking use. |
| `hubScore` | number or null | 0-100 score for airport/connectivity strength. | `45` | Later | Must be based on reviewed rules or provider-derived evidence. |
| `hiddenGemScore` | number or null | 0-100 score for secondary/value uniqueness. | `70` | Later | Must be product-reviewed; LLM suggestions are not final. |
| `popularityScore` | number or null | 0-100 score for broad traveler recognition or demand. | `65` | Later | Must cite source or product review basis. |
| `validationStatus` | string | Overall readiness state for using the city in generated frontend/backend data. | `draft-needs-provider-review` | Required now | Allowed values: `draft`, `draft-needs-provider-review`, `provider-matched`, `product-reviewed`, `ready`, `hold-back`. |
| `validationSources` | object | Source names and dates used during validation. | `{ "frontend": "2026-06-01", "travelpayouts": null, "agoda": null }` | Required soon | Must record source/date for each approved provider mapping. |
| `notes` | string | Human-readable review comments and cautions. | `Frontend-only record; verify Agoda city ID before backend use.` | Required for draft records | Must be concise and avoid exposing credentials or raw feed data. |

## 4. Provider Mapping Model

One Globevoy city should map to zero or more provider records. Provider records
should be nested or stored in a separate provider-mapping table keyed by
`globevoyCityId`.

### Agoda Mapping

Agoda should provide hotel-side coverage signals:

- `agodaCityId`
- hotel count or active hotel coverage
- hotel coordinate sanity checks
- star/review/rating coverage where available
- city/country matching signals
- hotel URL availability through live search

Agoda should not define the canonical city by itself. A large Agoda city may not
match the exact practical flight destination, and Agoda hotel coverage does not
prove flight route viability.

### Travelpayouts/Aviasales Mapping

Travelpayouts/Aviasales should provide flight-side identity signals:

- city IATA code
- airport IATA codes
- autocomplete names and query variants
- city and airport coordinates
- country code
- route and price availability signals through live APIs

Travelpayouts should not define hotel coverage, Group 1 / Group 2 labels, or
local destination quality by itself.

### Future Provider Mapping

Future providers should be added without changing the canonical city ID. Each
provider mapping should include:

- provider name
- provider city/location ID
- provider airport/region IDs if applicable
- match confidence
- last verified date
- coverage status
- notes

## 5. Search and Alias Rules

Search should resolve user input to one canonical `globevoyCityId` before any
provider-specific lookup happens.

Rules:

- Normalize case.
- Remove accents for matching while preserving proper display names.
- Remove extra punctuation and repeated whitespace.
- Compare against approved `aliases` and generated `normalizedSearchNames`.
- Treat typo aliases as reviewable records, not automatic truths.
- Use country or region disambiguation when a city name exists in multiple
  places.
- Do not create a second city record just because a provider uses a different
  name, spelling, or coordinate.

Example:

- Display city: `Valencia`
- Also accepted: `València`
- Common typo alias: `Valensia`
- Canonical ID: `valencia-es`
- Ambiguity rule: if search only says `Valencia`, prefer the reviewed Spain
  record only when product scope or country context makes that safe; otherwise
  ask for clarification or use country context from the trip flow.

## 6. Group 1 / Group 2 Rules

These labels are draft planning labels. They should not affect live ranking
until product review is complete.

### `group1-famous-anchor`

Famous, high-recognition destination that attracts users and works well as the
main hook of a trip.

Examples: Paris, New York, London, Rome, Barcelona.

### `group1-airport-hub`

City or metro area with strong airport connectivity and practical routing value,
even if the destination is not always the main emotional hook.

Examples: Amsterdam, Madrid, Milan, Istanbul, Singapore.

### `group2-secondary`

Secondary city that pairs well with a major hub or can work as a less obvious
single-destination recommendation.

Examples: Porto, Lyon, Quebec City, Valencia, Bologna.

### `group2-hidden-gem-value`

City with strong budget/value or uniqueness potential. These should become a
large part of Globevoy's differentiated dataset, but they require careful data
validation before scaling.

Examples: Krakow, Ljubljana, Seville, Palermo, Tbilisi.

### Future `group3`

If needed later, Group 3 can represent experimental, low-confidence, seasonal,
or niche destinations that are held back from core recommendations until enough
provider and product evidence exists.

LLMs may help draft candidate classifications and explanations, but final labels
must be reviewed by product/data owners and backed by provider or curated data.

## 7. Validation Checklist

Before a city becomes `ready`, confirm:

- Airport code verified.
- City vs airport code semantics reviewed.
- Primary airport is practical for the city, not merely literal.
- Nearest major airport reviewed if applicable.
- Travelpayouts city code verified or explicitly marked missing.
- Travelpayouts airport codes verified.
- Agoda city ID verified or explicitly marked missing.
- Agoda hotel count or coverage status reviewed.
- Coordinates reviewed.
- Coordinate source recorded.
- Frontend map placement reviewed.
- Aliases reviewed, including common misspellings and accented variants.
- Duplicate city risk reviewed.
- Country/region disambiguation reviewed.
- Group role reviewed by product.
- Hotel coverage status reviewed.
- Validation source and date recorded.
- No raw provider feed committed.
- No API keys, tokens, passwords, or credentials stored in registry files.
- Partner referral behavior remains external and comparison-first.

Recommended validation status flow:

1. `draft`
2. `draft-needs-provider-review`
3. `provider-matched`
4. `product-reviewed`
5. `ready`

Use `hold-back` for cities that should remain out of generated live datasets
until route, hotel, or product concerns are resolved.

## 8. Migration Plan

### Stage 1: Current 55 Crosswalk Review

Review the 55 unique candidates from the current frontend and backend datasets.
Confirm canonical IDs, provider mapping gaps, coordinate mismatches, and draft
Group 1 / Group 2 labels.

### Stage 2: First 50 Validated Registry Records

Promote approximately 50 reviewed cities into the draft registry. Hold back
ambiguous or low-confidence records until product/provider review is complete.

### Stage 3: Generate Frontend and Backend Datasets From Registry

Create generated frontend/backend slices from the registry:

- Backend recommendation slice: live provider IDs, airport codes, fallback costs,
  coordinates, and validation status.
- Frontend display slice: map placement, trip framing, tags, notes, and safe
  fallback content.

Generated files should preserve current behavior until explicitly migrated.

### Stage 4: Expand to 100

Add reviewed North America and Europe cities first. Prioritize cities with clear
Travelpayouts airport mapping and Agoda hotel coverage.

### Stage 5: Expand to 250+

Add more secondary and hidden-gem cities after validation scripts exist. Start
tracking route-pair and nearest-hub relationships for future multi-city work.

### Later: Build-Time Ingestion for Thousands of Cities

Build an ingestion pipeline that reads provider feeds outside the repo, validates
or aggregates them, and writes compact derived registry records. Raw Agoda hotel
feeds and full provider datasets should stay outside the committed project.

## 9. Example Record: Valencia, Spain

This example uses known frontend fields and placeholder provider fields. Values
marked `needs-review` must not be treated as verified.

```json
{
  "globevoyCityId": "valencia-es",
  "displayCity": "Valencia",
  "country": "Spain",
  "countryCode": "ES",
  "region": "Valencian Community",
  "latitude": 39.49,
  "longitude": -0.48,
  "aliases": [
    "Valencia",
    "Valencia Spain",
    "Valencia, Spain",
    "València",
    "Valensia"
  ],
  "normalizedSearchNames": [
    "valencia",
    "valencia spain",
    "valensia"
  ],
  "mapCoordinatesSource": "frontend-curated-needs-review",
  "travelpayoutsCityCode": "VLC",
  "travelpayoutsAirportCodes": ["VLC"],
  "agodaCityId": null,
  "agodaHotelCount": null,
  "agodaCoverageStatus": "missing-needs-review",
  "primaryAirportCode": "VLC",
  "nearestMajorAirportCode": null,
  "providerCoverage": {
    "travelpayouts": "needs-review",
    "agoda": "missing-needs-review"
  },
  "groupRole": "group2-secondary",
  "hubScore": null,
  "hiddenGemScore": 70,
  "popularityScore": null,
  "validationStatus": "draft-needs-provider-review",
  "validationSources": {
    "frontend": "2026-06-01",
    "backend": null,
    "travelpayouts": null,
    "agoda": null,
    "productReview": null
  },
  "notes": "Frontend-only current candidate. Verify Travelpayouts city/airport mapping and Agoda city ID before backend promotion."
}
```

## 10. Tests and Automation Later

Do not implement these yet. Recommended future validation scripts:

- Validate unique `globevoyCityId` values.
- Validate latitude and longitude ranges.
- Validate allowed enum values for `groupRole`, `validationStatus`, and provider
  coverage fields.
- Detect duplicate aliases across multiple cities.
- Detect likely typo aliases that are not explicitly approved.
- Compare registry codes against Travelpayouts city and airport data snapshots.
- Confirm every backend-generated record has required live recommendation fields.
- Confirm every frontend-generated record has map coordinates and display-safe
  content.
- Flag city-vs-airport code mismatches for review.
- Flag missing Agoda city IDs for records expected to support live stays.
- Confirm no raw provider feeds or credentials are present in generated files.

## 11. Non-Goals

This document does not:

- Modify the current live destination datasets.
- Add new cities to Globevoy.
- Change recommendation ranking.
- Change frontend UI.
- Change backend API behavior.
- Change Agoda or Travelpayouts/Aviasales partner links.
- Build multi-city recommendations.
- Build ML recommendations.
