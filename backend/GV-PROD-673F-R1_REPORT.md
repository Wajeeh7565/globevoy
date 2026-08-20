# GV-PROD-673F-R1 Backend Report

## Status

Built and locally validated. Not deployed.

## Baseline

- Input backend: `lambda-gv-prod-673f-complete-route-integrity-portable.zip`
- City activation: `GV-CITY-668T`
- Audited cities: 1,000
- Production-active cities: 439
- Unaudited cities: 0

## Scope

This release does not change route thresholds, city activation, provider eligibility, budget guardrails, traveller pricing, hotel-quality rules or flight-comfort rules.

It preserves and packages the route-integrity repairs:

1. Rejected or stale provider URLs are not used for displayed dates.
2. Fresh Aviasales comparison URLs are generated from the canonical route and displayed date.
3. Three-pick roles are recalculated from the final safe, priced candidate pool.
4. **Lowest cost** remains the actual minimum-priced safe route.
5. Active package/version metadata is consistent with `GV-PROD-673F-R1`.

Generated-tour version:

`2.7.3-gv-prod-673f-r1-release-integrity`

## Automated validation

- R1 route-integrity contract: **8/8 passed**
- Three-pick/backend UX regression: **30/30 passed**
- City activation regression: **76/76 passed**
- Backend JavaScript syntax: **97/97 files passed**
- Portable Lambda archive: **345 entries, 0 invalid paths**
- Clean extraction validations: **8/8, 30/30 and 76/76 passed**

## Deployment note

Deploy this backend together with the matching R1 frontend. Keep the existing environment variables and `GV-CITY-668T` activation configuration unchanged.
