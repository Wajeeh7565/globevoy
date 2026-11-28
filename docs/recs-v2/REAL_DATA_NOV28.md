# Recs v2 on REAL data (Nov 28, 2026): release candidate and date coverage

Replaces the synthetic conclusions of [OVERNIGHT_NOV28.md](OVERNIGHT_NOV28.md) where they differ. Nothing was deployed and no Lambda setting was changed.

## Data
`ops/fare-map/record-snapshot.mjs` (new, read-only: Query/GetItem/BatchGetItem only, capped and paced) recorded everything the search reads, for production settings and each variant (`ops/fare-map/replay-settings.json`): 10 origins x 8 budgets x 1 and 2 travellers, taken 2026-11-28 11:25 UTC. 2,250 fare partitions (195,145 fares), 18,353 daily-date rows asked (6,621 with dates), 467 Price Index cities, 94 hotel-memory cities. 2,645 DynamoDB calls, ~12,800 read units (under US$0.01), 0 throttled. Saved outside the repo (`~/Downloads/globevoy-fare-snapshot-v3.json.gz`).

Replay: `recommendation-investigation.cjs --fare-snapshot <v3 file>` uses the recorded fares, dates (two months after the reference date, as `readRouteDates`), the real Price Index for planning and hotel memory; hotel truth of the live check = each city's measured Price Index level (region median for unmeasured cities), as in the Step 2 benchmark. 0 missing partitions and 0 missing date rows for every setting compared below.

## Why daily dates are missing (19 of 392 in the first test)
Not expired data (rows 0-1 days old, none past TTL), not keys or code mapping (`D#<from>#<month>` / `<to>` with the metro code, e.g. YTO, the code the search uses; no Toronto return is filed under YYZ either), not the optimizer's access (it asks the right keys). It is **route selection in the collector's date pass**: per origin and month it fetches the 30 cheapest destinations in both directions. A flight home such as Prague > Toronto is collected only if Toronto is among Prague's 30 cheapest (never) or Prague among Toronto's (Toronto's are US/Canada). Measured on the snapshot: flights between cities 66% covered, flights home 15% (Toronto 85 of 1,133, Vancouver 59 of 1,053; London and Paris 39%).

Prepared, **not deployed**: `--home-origins YTO,YVR,...` (`runDatePass({ homeOrigins, homeRoutes })`) first fetches the way home to each listed city from every destination of its monthly fares (default up to 200 per city and month, cheapest first), then the usual pass. Free Travelpayouts endpoint, same pacing, request cap and freshness skip. Turning it on means changing the collector's ExecStart (approval needed). Estimate for 20 home cities x 6 months x 200: 24,000 requests, ~1.6 h at 250/min.

## Results (production vs release = FARE_MAP_BEST_USE_TOPUP + FARE_MAP_GUEST_ORDER + FARE_MAP_MULTI_CITY_HINT)
Live Best Use = share of the entered budget on the simulated live page.

| C$ | found | live Best Use signed in | live Best Use guest | 2 travellers live / guest |
|---|---|---|---|---|
| 1,500 | 100 | 86 -> 86 | 84 -> 84 | 82 / 86 -> 82 / 86 |
| 2,000 | 70 | 79 -> 85 | 79 -> 85 | 84 / 83 -> 87 / 88 |
| 3,000 | 100 | 78 -> 84 | 74 -> 82 | 85 / 80 -> 86 / 86 |
| 4,000 | 100 | 82 -> 85 | 81 -> 85 | 86 / 78 -> 86 / 84 |
| 5,000 | 100 | 85 -> 86 | 79 -> 86 | 83 / 72 -> 86 / 86 |
| 7,500 | 100 | **54 -> 86** | **58 -> 86** | 71 / 66 -> 86 / 86 |
| 10,000 | 100 | 56 -> 75 | 66 -> 78 | 68 / 68 -> 86 / 86 |
| 15,000 | 100 | 59 -> 60 | 55 -> 56 | 53 / 53 -> 54 / 59 |

Everything else unchanged (trips abroad 98-100%, multi-country 100% from C$2,000, no same-country pairs, Lowest Cost 48-79%). Paid Ignav requests per search 20.75 -> 20.57 (guest 6.00 -> 5.76); Nuitee 12.9 -> 12.8; search median 0.72 s.

## Each switch alone on real data
| Switch | Result | In release |
|---|---|---|
| `FARE_MAP_BEST_USE_TOPUP` | the big gain above | yes |
| `FARE_MAP_GUEST_ORDER` (new) | with top-up: guest C$10,000 66 -> 78, guest Ignav 5.92 -> 5.76 | yes |
| `FARE_MAP_MULTI_CITY_HINT` | message only (C$2,000: 30% of searches still no 2-city trip) | yes |
| `FARE_MAP_VISITOR_VARIETY` | 1.1-1.8 distinct guest trips per 3 visitors (production: 1); quality within a few points (C$15,000 live 60 -> 64, guest C$10,000 78 -> 71) | optional |
| `FARE_MAP_LUXURY_TIERS` | C$15,000 plan 79 -> 84 but live 60 -> 56 | no |
| `FARE_MAP_LEG_DATES` on / fallback | on: worse at several budgets; fallback ran 8 times, found no extra trip (C$2,000 misses are "flights": the missing flights home) | no (useful after the date-pass change) |
| `FARE_MAP_DOMESTIC_LAST` | nothing to fix (98-100% abroad already), guest C$10,000 66 -> 60 | no |
| `FARE_MAP_DYNAMIC_MAX_PER_TRIP=2` | no change (17 vs 14 trips with a discovered city) | no |
| looser discovered cities (min routes 8, min hotels 3) | asks for 34 partitions not recorded; not reliable, looked worse | no |

## Guest Best Use without more Ignav requests
A guest gets no spare checks (one at a time). When the first trip failed, the queue moved the safest trip forward, often the pool's Lowest Cost slot or a short trip, and the guest was shown it as Best Use (C$7,500: 62% of the entered budget). `FARE_MAP_GUEST_ORDER` checks the Lowest Cost slot last for guests and, after a failure, takes the next three viable trips' most budget-using one (pool score within 0.1, no more risk); the top-up now also applies to the Lowest Cost slot when a guest is shown it. Same or fewer checks.

## Proposed production stage (awaiting approval)
1. Package `main` (ops/release/package-backend.cjs) and deploy as a new Lambda version (switches off: identical behaviour), then add `FARE_MAP_BEST_USE_TOPUP=on`, `FARE_MAP_GUEST_ORDER=on`, `FARE_MAP_MULTI_CITY_HINT=on` with the current settings saved to ~/rollback first.
2. Live checks (few): Toronto C$7,500 guest and signed in, Vancouver C$2,000, London C$10,000. Roll back if Best Use or trip quality is worse.
3. Separately: the date-pass `--home-origins` change on the collector, then re-record and re-test `FARE_MAP_LEG_DATES`.
