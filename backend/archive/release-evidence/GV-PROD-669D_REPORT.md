# GV-PROD-669D - Exact-Date and Family-Occupancy Integrity

## Purpose

GV-PROD-669D repairs the final three blockers found by the GV-PROD-669A Full12 automated MVP matrix after GV-PROD-669C reached 10/12 passing scenarios:

- Los Angeles family planning returned one room for two adults and one child.
- San Diego exact-date planning moved the requested departure from 2026-11-05 to 2027-04-18.
- San Diego exact-date planning moved the requested return from 2026-11-11 to 2027-04-24.

## Repair

### Conservative family room planning

When the new 669D feature flag is enabled and children are included, the planning occupancy defaults to no more than two sleeping guests per room. Two adults plus one child therefore produces two planning rooms. This prevents the MVP from presenting an artificially low hotel total based on one standard room. A user-supplied larger room count is still honoured. Provider inventory remains responsible for confirming whether a larger family room can accommodate the party at booking time.

### Exact dates are hard itinerary boundaries

For `dateMode=exact` requests with valid departure and return dates, the backend now:

1. calculates the exact trip duration from the requested boundaries;
2. allocates city nights inside that fixed window;
3. assigns every route leg and stay window chronologically from the requested departure;
4. forces the final return leg to the requested return date;
5. applies provider fare evidence only when the provider observation matches the exact requested leg date;
6. removes stale provider evidence from another date instead of relabelling it as exact-date evidence;
7. preserves the exact dates with estimate/partner-confirmation labelling when no exact provider observation is available.

The six-month cheap-date scanner remains available for flexible-date requests. It is no longer permitted to replace a user's exact dates with a cheaper date months later.

## Safety properties

- No city-activation, flight-comfort, hotel-quality, provider-evidence, or budget threshold is relaxed.
- GV-CITY-668T remains the activation baseline: 1,000 audited, 439 production-active, 561 reviewed inactive, zero unaudited.
- GV-PROD-669B remains active, preserving production-active destination filtering and the New York/JFK origin repair.
- GV-PROD-669C remains active, preserving bounded lower-stop recovery for provider-verified routes that exceed budget.
- Exact-date prices are not falsely described as live when provider evidence exists only for another date.
- Family hotel totals are conservatively planned with two rooms for the Full12 Los Angeles party.
- No frontend deployment is required.

## Deployment

Deploy `lambda-gv-prod-669d-exact-date-family-occupancy.zip` to the existing Lambda and set:

`ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D=true`

Optional override, normally not needed:

`GV_MAX_GUESTS_PER_ROOM_669D=2`

Keep these enabled:

- `ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C=true`
- `ENABLE_MVP_VALIDATION_REPAIRS_669B=true`
- `ENABLE_VERIFIED_CITY_ACTIVATION_668T=true`

## Validation performed

- GV-PROD-669D targeted validation: 35/35
- GV-PROD-669C regression: 22/22
- GV-PROD-669B regression: 16/16
- GV-CITY-668T regression: 76/76
- GV-CITY-668S regression: 52/52
- GV-CITY-668R regression: 73/73
- GV-CITY-668Q regression: 67/67
- GV-CITY-668P regression: 73/73
- GV-CITY-668O regression: 53/53
- GV-CITY-668N regression: 70/70
- GV-CITY-668M regression: 50/50
- GV-CITY-668E regression: 40/40
- GV-CITY-668B regression: 30/30
- JavaScript syntax checks: 93/93
- Synthetic exact-date chronology and stale-evidence tests
- Synthetic family traveller, room and stay-total tests
- ZIP integrity and secret-pattern scans

The time-sensitive Los Angeles and San Diego outcomes must be confirmed against the deployed providers. The included PowerShell smoke test checks the two-room family result, exact San Diego dates, chronological legs, and date-prefilled partner links.
