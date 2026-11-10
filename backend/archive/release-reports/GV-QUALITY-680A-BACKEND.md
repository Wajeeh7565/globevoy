# GV-QUALITY-680A backend handoff repair

This release changes booking evidence from an implied live quote into an explicit observation or planning estimate.

- Flight observations never claim a ticket is reserved, current, baggage-inclusive, or still available.
- Exact provider URLs are labelled itinerary hints; generated URLs are labelled route searches.
- Agoda rates never claim current availability. Results-page and direct-property handoffs remain distinct.
- Best-balance stays are quality-ranked and apartment/private-room style listings are rejected.
- The three recommendation roles penalize repeated stops when diverse safe candidates exist.
- The trust contract is versioned as `GV-QUALITY-680A` for frontend rendering and QA.

Production should retain these existing flags:

```text
ENABLE_AGODA_PROVIDER_STAY_679A=true
ENABLE_AGODA_PRICE_LINK_INTEGRITY_679A_R1=true
ENABLE_AGODA_HANDOFF_INTEGRITY_679A_R2=true
ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E=true
ENABLE_MAP_FIRST_THREE_PICKS_670A=true
```

Run `node validate-gv-quality-680a.js` and `node validate-gv-quality-680a-city-fixtures.js` before deployment.
