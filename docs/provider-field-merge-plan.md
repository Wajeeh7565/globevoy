# Targeted Provider-Field Merge Plan

Created: 2026-06-02

This plan describes a future, small merge patch for overlapping Globevoy city records only. It is documentation only and does not modify live frontend or backend datasets.

The goal is to apply provider-registry improvements without replacing curated content, fallback pricing, images, map placement, recommendation behavior, or partner-link behavior.

## Summary

Do not replace `frontend/destination-data.js` or `backend/src/data/destination-meta.js` with generated preview slices yet.

The safe next implementation should be a small backend-first provider-field merge for overlapping records, followed by tests. Frontend metadata changes should wait unless there is a specific UI/debugging need.

## Overlapping Records

### Strict Triple Overlap

These records exist in the draft registry, live frontend dataset, and live backend dataset with matching city/country names:

| City | Registry ID | Registry code | Frontend code | Backend code | Merge readiness |
| --- | --- | --- | --- | --- | --- |
| Mexico City, Mexico | `mexico-city-mx` | `MEX` | `MEX` | `MEX` | Safer overlap |
| Lisbon, Portugal | `lisbon-pt` | `LIS` | `LIS` | `LIS` | Safer overlap |
| Porto, Portugal | `porto-pt` | `OPO` | `OPO` | `OPO` | Safer overlap |
| Reykjavik, Iceland | `reykjavik-is` | `REK` | `KEF` | `KEF` | Needs code/coordinate review |

### Naming-Normalization Overlap

| City | Registry country | Frontend country | Backend country | Merge readiness |
| --- | --- | --- | --- | --- |
| Prague | Czech Republic | Czechia | Czech Republic | Needs country naming and coordinate review |

Prague should be treated as an overlap after country-name normalization. Do not create a duplicate Prague record.

## Safe Overlap Records

These are the safest candidates for a future provider-field merge because codes and coordinates already align across live frontend/backend and the registry:

- Mexico City
- Lisbon
- Porto

For these records, provider metadata can be considered for backend merge first.

## Records Needing Naming/Coordinate/Code Review

### Prague

Registry/backend use `Czech Republic`; live frontend uses `Czechia`. Registry coordinates were resolved to city-center provider coordinates, while live frontend coordinates are closer to airport placement.

Before frontend merge:

- Decide whether production display should use `Czechia` or `Czech Republic`.
- Preserve live frontend map `x/y` until map QA.
- Do not overwrite live frontend lat/lng without visual map/globe review.

Backend provider merge is lower risk because backend already uses `PRG` and Agoda ID `15977`, but coordinate change should still be reviewed.

### Reykjavik

Registry uses `REK` as the Travelpayouts city/metro code and keeps `KEF` as the primary airport. Live frontend/backend currently use `KEF` as the destination code.

Before backend merge:

- Confirm `recommendations.js` and Travelpayouts `destination_city_iata` matching can handle `REK`.
- Confirm Aviasales fallback/deep links should use broad city `REK` or airport `KEF`.
- Preserve `KEF` as `primaryAirportCode` and practical airport code.

Frontend merge should preserve curated copy and map placement until QA.

## Safe Backend Fields To Merge Later

Only consider these fields for overlapping live backend records:

| Registry field | Backend use | Notes |
| --- | --- | --- |
| `globevoyCityId` | Add as metadata | Safe internal ID; should not affect ranking. |
| `aliases` | Add only if backend resolver will use it later | No behavior change unless resolver changes. |
| `normalizedSearchNames` | Add only as metadata | Useful later for search/alias handling. |
| `travelpayoutsCityCode` | Add or compare against existing `code` | Do not change object key or `code` yet unless tested. |
| `travelpayoutsAirportCodes` | Add as metadata | Safe if not consumed by recommendation logic yet. |
| `primaryAirportCode` | Add as metadata | Useful for future display/fallback links. |
| `agodaCityId` | Update only when registry and live backend agree or product approves | Do not break Agoda lookup. |
| `agodaHotelCount` | Add as metadata | Derived coverage signal only; not live availability. |
| `agodaCoverageStatus` | Add as metadata | Useful for future confidence/debugging. |
| `providerCoverage` | Add as metadata | Should not change ranking. |
| `validationStatus` | Add as metadata | Keep as draft/review until product approval. |
| `validationSources` | Add as metadata | Good audit trail. |

For a first backend patch, prefer adding metadata fields without changing existing `code`, fallback prices, or ranking-related fields.

## Safe Frontend Fields To Merge Later

Only consider these fields for overlapping live frontend records:

| Registry field | Frontend use | Notes |
| --- | --- | --- |
| `globevoyCityId` | Add as metadata | Safe stable ID for future migration. |
| `aliases` | Add as metadata | Useful later for search/autocomplete. |
| `normalizedSearchNames` | Add as metadata | Useful later for typo/accent handling. |
| `providerCoverage` summary | Add as hidden/debug metadata only | Do not surface as user-facing claim yet. |
| `groupRole` | Add as draft/internal metadata | Do not present as final category. |
| city-center `latitude` / `longitude` | Only after map QA | Can move markers, so not first patch. |

Do not update frontend first unless there is a clear need. Frontend has more curated content at risk.

## Fields To Preserve

Do not overwrite these fields in live frontend records:

- `whyItFits`
- `styleTags`
- `img`
- `safetyNote`
- map `x` / `y`
- `days`
- `recommendedDays`
- `nights`
- `season`
- `seasonInsight`
- `costs`
- `travelTime`
- `walkability`
- `visaNote`
- `weather`
- `localCost`

Do not overwrite these fields in live backend records:

- `theme`
- `days`
- `season`
- `seasonInsight`
- `dailySpendUsd`
- `dailySpendSource`
- `activitiesLocalUsd`
- `fallbackNightlyUsd`
- `fallbackFlightUsd`
- `img`
- `walkability`
- `travelTime`
- `visaNote`
- `weather`
- `localCost`
- destination object keys
- recommendation ranking or scoring behavior

## Recommended Migration Approach

### Step 1: Backend Metadata-Only Patch

Apply provider metadata only to safe overlapping backend records first:

- Mexico City
- Lisbon
- Porto

Optional after review:

- Prague, if country/coordinate policy is accepted.
- Reykjavik, only after confirming `REK` vs `KEF` backend behavior.

Patch scope:

- Add `globevoyCityId`.
- Add `primaryAirportCode`.
- Add `travelpayoutsCityCode`.
- Add `travelpayoutsAirportCodes`.
- Add `agodaHotelCount`.
- Add `agodaCoverageStatus`.
- Add `providerCoverage`.
- Add `validationStatus`.
- Add `validationSources`.

Do not change:

- `code`
- fallback pricing
- destination ordering
- partner links
- Agoda URL behavior
- Travelpayouts/tp.media behavior

### Step 2: Run Backend Tests

Run backend recommendation tests and partner-link checks. Confirm recommendation output remains stable enough for MVP.

### Step 3: Partner-Link Safety Check

Confirm:

- Aviasales/Travelpayouts links still use `https://tp.media/r?`.
- Agoda links/cid behavior is unchanged.
- No direct booking wording is introduced.

### Step 4: Frontend Metadata Patch Only If Needed

If product wants frontend debugging/search metadata, add only:

- `globevoyCityId`
- `aliases`
- `normalizedSearchNames`
- draft `groupRole`

Do not alter visible copy, images, map placement, or cost fields in the first frontend patch.

### Step 5: No Preview-Only Cities Yet

Do not add the 23 preview-only frontend records or 23 preview-only backend records to live datasets yet. They need separate promotion review.

## Risks

| Risk | Mitigation |
| --- | --- |
| Agoda city ID mismatch | Merge only records where live backend and registry agree, or require product/provider approval. |
| Travelpayouts city-vs-airport mistakes | Do not change `code` or backend lookup keys in first metadata-only patch. |
| Frontend curated copy loss | Do not overwrite frontend copy fields. |
| Map marker movement | Do not change frontend lat/lng or `x/y` until visual QA. |
| Recommendation ranking changes | Do not change fallback pricing, theme, season, or ranking inputs. |
| Partner-link breakage | Do not edit `travelpayouts.js`, Agoda service, or referral link builders. |
| Draft records exposed | Do not add preview-only cities or wire generated slices into production. |

## Test Plan For Later Implementation

Run these after a future code patch:

1. `npm test --prefix backend`
2. `node scripts/validate-city-registry.js`
3. Static check that `https://tp.media/r?` wrapping is still used.
4. Static check that Agoda link/cid logic is unchanged.
5. JS syntax parse for modified frontend files if frontend metadata is touched.
6. Explore smoke checks for Lisbon, Mexico City, Porto, Prague, and Reykjavik.
7. Ask smoke checks for Lisbon, Mexico City, Porto, Prague, and Reykjavik.
8. Verify no preview-only cities appear in live UI or backend recommendations.
9. Verify fallback totals remain stable for overlapping backend records.
10. Verify no API keys, tokens, passwords, or raw provider feed data are introduced.

## Final Recommendation

Code next, but only a small backend-only metadata merge patch for the safest overlapping records: Mexico City, Lisbon, and Porto.

Wait on Prague and Reykjavik until product/provider review confirms:

- Prague country display policy: `Czechia` vs `Czech Republic`.
- Prague coordinate/map impact.
- Reykjavik `REK` city code vs `KEF` airport code behavior in backend matching and Aviasales links.

Do not migrate frontend metadata or preview-only cities yet.
