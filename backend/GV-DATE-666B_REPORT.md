# GV-DATE-666B — Canonical Itinerary Date Synchronization

## Baseline

- Backend: `lambda-gv-mvp-666a-passenger-room-price-integrity.zip`
- Frontend: `frontend-staging-gv-mvp-666a-passenger-room-price-integrity.zip`

This is a narrow date-integrity release. Passenger/room pricing, provider-driven route discovery, route feasibility, map rendering, partner links, and the six-month calendar UI are preserved.

## Problem fixed

A rejected provider fare observation could leak into the presentation layer as the calendar's selected date even though the route cards continued to use the automatic budget-safe date. Example: route cards displayed July 16 while the calendar selected October 31.

The frontend also changed only the first leg locally after a user selected another date. Later legs, hotel windows, totals, and partner links were not rebuilt from the new departure date.

## Backend changes

- Introduced one canonical official departure-date rule:
  - an applied provider observation may become the official date;
  - rejected provider evidence remains evidence only;
  - otherwise the automatic itinerary date remains official.
- Reordered visualizer assembly so official leg dates are established before stay windows are generated.
- Added `itineraryDatePlan` containing:
  - canonical departure date;
  - canonical return date;
  - original six-month scan start;
  - scan-window length;
  - consistency status and any detected issues.
- Added a final stale/mixed-date safety rejection.
- Added `POST /api/generated-tour-date`.
- The date endpoint:
  - receives the currently validated tour;
  - preserves the exact route cities;
  - clears stale date-specific evidence;
  - applies the selected departure date;
  - derives every later leg from each stay length;
  - rescans provider evidence where available;
  - recalculates party pricing, hotel windows, totals, and partner links;
  - reruns route feasibility and budget checks.
- Added rollback flag:
  - `ENABLE_CANONICAL_ITINERARY_DATE_SYNC_666B=true`

## Frontend changes

- Calendar selection now uses the same official date rule as the cards.
- The calendar window remains anchored to the original six-month scan start, so an October selected date can correctly appear as month 4 of a July–December window.
- Selecting a date now calls the backend recalculation endpoint instead of mutating only the first card locally.
- The route is replaced only when the backend returns a fully synchronized, feasible, budget-safe itinerary.
- Route cities are preserved during date adjustment.
- Script cache version bumped from `666a` to `666b`.

## Validation

- GV-DATE-666B: **12/12 passed**.
- Inherited GV-MVP-666A passenger/room pricing: **11/11 passed**.
- Node syntax validation passed for all modified JavaScript files.
- Integration case:
  - Toronto route initially dated July 16 → July 19 → July 21.
  - User-selected October 31 recalculated to October 31 → November 3 → November 5.
  - Route cities remained unchanged.
  - Stay windows and Aviasales search dates matched the recalculated itinerary.

## Deployment

1. Deploy the GV-DATE-666B backend ZIP.
2. Add:

```text
ENABLE_CANONICAL_ITINERARY_DATE_SYNC_666B=true
```

3. Deploy the GV-DATE-666B frontend ZIP.
4. Hard-refresh the website.
5. Test a route where provider evidence is in a different month from the automatic route date.

## Live QA checklist

- Route card and calendar initially show the same departure date.
- Provider evidence that was rejected by the budget guardrail is not shown as selected.
- Month position reflects the original six-month scan window.
- Selecting a new date updates every later leg and stay window.
- Flight comparison links contain the recalculated dates.
- Route cities do not change after date adjustment.
- If the new date becomes over budget or infeasible, the existing route remains unchanged.

## Boundary

Provider observations remain cached evidence rather than guaranteed live inventory. Final availability and price are confirmed on partner websites.
