# GV-CONTROL-667D — Date Preservation and Gateway-Transfer Integrity

## Baseline

Built from the verified GV-CONTROL-667C backend and frontend packages.

## Purpose

Finish the remaining generated-tour control issue visible after shuffle:

1. Preserve the user's current itinerary dates when replacing a city whenever the edited route remains feasible and within budget.
2. Change dates only when the original dates cannot support the replacement.
3. Treat gateway airports as transport infrastructure, not extra destinations.
4. Include practical destination-gateway transfer time and cost in the visible route total.

## Backend changes

- Added feature flag: `ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D=true`.
- Route-control requests now accept the current canonical departure date.
- Shuffle, replace, and refresh first attempt the edited route on the existing dates.
- Later leg dates are rebuilt chronologically from the preserved first date and each city's allocated nights.
- If the preserved-date route fails budget, provider, or feasibility checks, the existing automatic cheap-date builder may choose new dates.
- Responses explicitly report:
  - `datesPreserved: true`, or
  - `datesAdjusted: true` with the message: “Dates were adjusted to keep this route feasible and within budget.”
- Added practical gateway rules:
  - Tulum remains the destination, using Cancún (CUN) as the practical international gateway plus ground transfer.
  - Caye Caulker remains the destination, using Belize City (BZE) plus ferry/domestic transfer.
- Gateway airports are not counted as route stops.
- Destination gateway-transfer cost is passenger-aware and included in the canonical pricing ledger.
- Header total and visible card totals remain derived from the same canonical ledger.

## Frontend changes

- Shuffle requests send the current canonical departure date and request preservation.
- Stable stop references include gateway-airport metadata.
- Destination cards show a separate `Gateway transfer · estimate` row when relevant.
- Gateway transfer cost is included in the destination card total.
- Cache version bumped to `667d`.

## Validation

### GV-CONTROL-667D

- 26/26 checks passed.
- Integrated Toronto shuffle test:
  - Before: Toronto → Cancún → Caye Caulker → Toronto
  - Action: shuffle Cancún
  - After: Toronto → Tulum → Caye Caulker → Toronto
  - Preserved dates: 2026-07-25 → 2026-07-28 → 2026-07-30
  - Tulum gateway: CUN
  - Caye Caulker gateway: BZE
  - Canonical display total matched the header total.

### Regressions

- GV-CONTROL-667C: 20/20 passed.
- GV-LIVE-667A: 17/17 passed.
- GV-LIVE-667B: 19/19 passed.
- GV-MVP-666A: 11/11 passed.
- Canonical date synchronization under a gateway-aware budget: 5/5 passed.

The old CAD 2,000 Toronto/Tulum date fixture is no longer a valid unchanged regression fixture because 667D correctly adds the Tulum gateway-transfer cost. At CAD 3,000, the same canonical-date synchronization behavior passes unchanged.

## Deployment

Deploy backend first, then frontend.

Add:

```text
ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D=true
```

Keep the earlier 667C, 667B, 667A, 666B, and 666A flags enabled.

## Rollback

Set:

```text
ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D=false
```

Then redeploy the GV-CONTROL-667C backend/frontend packages if a full artifact rollback is needed.

## Live QA boundary

Automated checks used deterministic/offline provider behavior. Production partner inventory, gateway transfer schedules, and final partner landing pages still require staging browser verification.
