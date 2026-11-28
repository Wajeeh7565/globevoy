# Recs v2 overnight (Nov 28, 2026): strict multi-city coverage, Best Use after the live check, abroad first, variety

All switches are **off by default**; with them off the search and the page are unchanged (tests: `tests/backend/recs-v2-overnight.test.cjs`). Nothing was deployed and no Lambda setting was changed.

## Benchmark inputs (read this first)
The Nov 26 fare snapshot, the 467-city price export and D# rows were not on this machine, and the AWS session had expired, so the replay ran on the **synthetic** fare model (`recommendation-benchmark.cjs`) with two new production-like inputs (`recommendation-investigation.cjs`):
- `--synthetic-prices`: a Price Index level for ~60% of cities (simulated truth level ±5%), planning only; the live check keeps the simulated truth with its date pattern.
- `--synthetic-dates`: daily dates like the collector's date pass (30 cheapest routes per origin and month, both directions; 8-20 dates per route-month at 1.0-1.5x the monthly fare), for any pair.
- The mocked hotel step now honours `hotelBudgetUsd` (better-rated offers at +25%...+200% steps whose depth follows the city's 3-4 star supply), as `upgradeHotels` does live. Before, it ignored upgrades.

Production settings = `lambda-settings.json` FARE_MAP values + the 20 Lambda overrides of Nov 28. 10 origins (Toronto, Vancouver, New York, Los Angeles, Mexico City, London, Paris, Dubai, Singapore, Sydney) x 8 budgets, 1 traveller, 30 ms simulated reads. Synthetic fares scale with distance, so absolute numbers (and the "wow" of routes) differ from live; the comparison between settings is the point. **Re-run on a real snapshot before deciding.**

The scorecard now also reports `found` (searches with a trip; no-result searches are counted), `liveBest` / `guestUse` (Best Use on the simulated live page, after hotel choice and upgrades), `lowUse` / `lowAbr` (Lowest Cost share of budget, abroad).

## Findings
1. **C$2,000 "no trip"**: the 2-city trips the search builds are just over budget (Toronto: cheapest US$1,435 vs US$1,323 spendable) because each stay length is fixed by the one cached onward date per pair and month (3+3 nights). Daily dates for onward legs find the cheaper and shorter stays.
2. **Best Use falls after the live check** (replay reproduces live: C$7,500 67%, C$15,000 44%): the plan prices a comfort tier (+25-150% hotels) but the live step books the cheapest well-rated room unless planned use was under 75%, so the planned quality and budget are dropped.
3. **Domestic picks** come from pool positions after the first five (role rules reorder only those) and from a domestic Lowest Cost slot when nothing abroad is under 60% of spendable.
4. Same inputs gave every visitor the same pool (deterministic).
5. Pre-existing bug (not changed, production behaviour): `!(cheapestOverUsd<=safeCost)` is never true while the value is null (`null<=x` is true in JavaScript), so "trips start at about C$X" always comes from the slower wide re-search instead of the cheapest over-budget trip.
6. Destination expansion (issue 6) cannot be measured on the synthetic model (it has fares only for registry cities); 517 catalogue cities with 5+ good hotels are already candidates with `FARE_MAP_DYNAMIC_DESTINATIONS=on`. Needs the real snapshot.

## Switches
| Switch | What it does |
|---|---|
| `FARE_MAP_LEG_DATES=fallback` (or `on`) | Daily dates (D# rows, GetItem) for the cheapest 6 onward cities of each kept partial trip: cheapest date in the stay window + earliest (or `FARE_MAP_LEG_DATES_MODE=mid|missing`). `fallback` runs them only when the first pass built no multi-city trip from about C$1,500. Caps: `FARE_MAP_LEG_DATE_READS` (160), `FARE_MAP_LEG_DATE_PAIRS` (6). DynamoDB reads only, no paid API. |
| `FARE_MAP_BEST_USE_TOPUP=on` | After roles are known, a Best Use trip (and the guest's trip) under 85% of the entered budget re-prices hotels from the cached rate replies (no new Nuitee requests) with better-rated hotels (+0.5 review or breakfast), aiming at ~87% of entered, never over spendable. Per stay +50%, +150% from US$5,000 entered. Lowest Cost slot never (signed in). |
| `FARE_MAP_LUXURY_TIERS=on` | From US$9,000 entered (C$12,000+): plan tiers +200%/+250% in cities with 150+ good 3-4 star hotels; the top-up allows +250%. |
| `FARE_MAP_DOMESTIC_LAST=on` | With role rules, from about C$1,500: trips touching the home country move behind 3+ trips abroad; from C$2,000 same-country pairs move behind 3+ multi-country trips; a domestic Lowest Cost slot is replaced by the cheapest abroad trip at standard hotels within 75% of spendable. |
| `FARE_MAP_VISITOR_VARIETY=on` | Pool picks choose at random (seeded by `varietySeed`/`visitorId`) among trips within 0.03 of the best diversity-adjusted value; propensity logged (`poolPropensity`, analytics `poolCandidates[].propensity`). |
| `FARE_MAP_MULTI_CITY_HINT=on` | Strict multi-city with no 2-city trip: the page says what a 2-city trip needs ("Two-city trips from Toronto start a little higher ... about CAD X"). |

Tried and dropped: a return-aware beam (A*-style cost to go on partial trips). Ranked or prune-only, it lowered C$2,000 found (60 -> 50%) and Best Use at big budgets; removed. A guest pick among passed spares never triggered (no spare passed in the replay); removed.

## Results (production vs production + leg-date fallback + top-up + luxury + domestic last + hint)
| C$ | found | Best Use plan | live Best Use (signed in) | guest Best Use | trips abroad | Lowest Cost abroad | same-country |
|---|---|---|---|---|---|---|---|
| 1,500 | 100 -> 100 | 85 -> 85 | 81 -> 83 | 81 -> 84 | 89 -> 94 | 88 -> 100 | 0 -> 0 |
| 2,000 | **60 -> 80** | 89 -> 89 | 89 -> 89 | 88 -> 88 | 95 -> 96 | 100 -> 100 | 5 -> 4 |
| 3,000 | 100 | 87 -> 87 | 85 -> 85 | 84 -> 85 | 98 -> 100 | 90 -> 100 | 3 -> 0 |
| 4,000 | 100 | 87 -> 87 | 80 -> 86 | 80 -> 86 | 100 | 90 -> 100 | 0 -> 5 * |
| 5,000 | 100 | 82 -> 82 | 84 -> 86 | 84 -> 86 | 100 | 100 | 8 -> 8 |
| 7,500 | 100 | 86 -> 86 | **67 -> 86** | 60 -> 67 | 100 | 100 | 0 |
| 10,000 | 100 | 85 -> 85 | 62 -> 74 | 56 -> 64 | 100 | 100 | 0 |
| 15,000 | 100 | 73 -> 81 | 44 -> 53 | 35 -> 35 | 100 | 100 | 0 |

\* Los Angeles: Houston > Cartagena and Guadalajara > Tampa (touching the US) became Mexico City > Puerto Vallarta (> Cabo San Lucas), abroad but one country (only 2 multi-country trips abroad, below the 3 needed to reorder).

Search median 0.82 -> 0.89 s, max 1.2 -> 3.6 s (12 of 80 searches ran the leg-date second pass); page median 0.69 -> 0.74 s offline. Paid Ignav requests per search 13.9 -> 13.8, Nuitee requests 8.2 -> 8.1 (top-up reuses cached rates).

With `FARE_MAP_VISITOR_VARIETY=on` (5 visitor seeds): distinct guest trips per search 1.2-1.7 of 5 (production: always the same trip), distinct signed-in pages 1.2-2.1; scorecard per seed within a few points (Best Use plan at C$10,000 85 -> 81-85, live 74 -> 80).

Remaining gaps: guests at C$7,500+ (the guest's one trip is often a flight-heavy trip after pool #1 fails its flight check; closing it needs more live checks per guest), C$15,000 still ~53% live, C$1,500 multi-city 3% (single city is allowed there), and C$2,000 20% no trip (now with the 2-city budget hint).

## Suggested stage (not applied)
Add to the Lambda (save the current settings to ~/rollback first): `FARE_MAP_LEG_DATES=fallback`, `FARE_MAP_BEST_USE_TOPUP=on`, `FARE_MAP_LUXURY_TIERS=on`, `FARE_MAP_DOMESTIC_LAST=on`, `FARE_MAP_MULTI_CITY_HINT=on`; optionally `FARE_MAP_VISITOR_VARIETY=on`. Live checks (few): Toronto C$2,000 and C$7,500 guest + signed in, Vancouver C$2,000, London C$15,000.
