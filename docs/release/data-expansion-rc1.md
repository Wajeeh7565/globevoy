# Release candidate: data-expansion (RC1)

Branch `data-expansion`, rebased on main 21a3231. Not deployed. Everything below is **off by default**; production behaviour is unchanged until the flags are set on the Lambda.

## Flags for the candidate

| Flag | Value | What it does |
|---|---|---|
| `FARE_MAP_EXPERIENCE` | `on` | Joint score: budget fit (80–90% of entered budget), abroad, countries, same-country penalty, hotel quality, flight convenience, stay length, real dates, detours |
| `FARE_MAP_DYNAMIC_DESTINATIONS` | `on` | Destinations found in the fare map, gated by connectivity and ≥5 good 3–4★ hotels (Agoda summary) |
| `FARE_MAP_COMFORT_MODE` | `adaptive` | Hotel tier upgrades only below 89% of spendable, capped by local supply; above +50% only from US$5,000 |
| `FARE_MAP_EXPERIENCE_LONG_STAYS` | `on` | 35-night option for large budgets |
| `FARE_MAP_REFRESH_ROTATION` | `on` | "Show other trips" avoids cities, countries and months already shown |
| `FARE_MAP_ROUTE_DATES` | `on` | Reads D# real-date rows (max 24 reads per search); needs the date pass to have run |
| `FARE_MAP_MAX_AGE_DAYS` / `FARE_MAP_HUGE_MAX_CITIES` / `FARE_MAP_BIG_STAY_EXTRA` | `7` / `4` / `8` | Search space for large budgets |
| `PRICE_INDEX_PLANNING` + `PRICE_INDEX_STORAGE` | **off** | Plans with Nuitée city price levels from DynamoDB. Stays off until permitted usage of stored Nuitée data is confirmed |

Hotel-quality weights (experience mode): 0.22 for hotel quality, 0.12 penalty for cities with fewer than 20 good 3–4★ hotels (`FARE_MAP_EXPERIENCE_HOTEL_WEIGHT`, `FARE_MAP_EXPERIENCE_THIN_HOTEL`).

## Prepared, not scheduled

- `ops/fare-map/run-date-pass.cjs`: Travelpayouts month-matrix dates for the cheapest routes per origin-month, both directions, paced under the rate limit.
- `ops/providers/nuitee-price-index-refresh.mjs`: monthly Nuitée refresh, dry run by default, at most 500 requests (US$10 at US$0.02). Writes to DynamoDB only with `PRICE_INDEX_STORAGE=on`.

## Benchmark (15 origins × 6 budgets, real Nuitée prices for 467 cities as the truth)

Before = current production settings. After = candidate flags plus Price Index planning and route dates.

Best Use, share of the entered budget:

| Budget | Before | After |
|---|---|---|
| C$1,500 | 65% | 81% |
| C$2,500 | 65% | 81% |
| C$4,000 | 69% | 81% |
| C$6,000 | 57% | 80% |
| C$10,000 | 43% | 80% |
| C$15,000 | 28% | 74% |

Other measures, before → after:

- **International at C$1,500 / C$2,500:** 33% → 63%, and 72% → 100%.
- **Same-country multi-city (C$1,500):** 30% → 0%.
- **Countries per Best Use trip:** 1.1–2.5 → 1.2–3.2.
- **Good-hotel share:** 63–75% → 70–79%.
- **Real-date legs:** 66–93% → 81–93%.
- **Direct legs where stops are known:** 63–97% (after).

Known gaps:

- **Refresh repetition:** some city appears in more than one of four refreshes in 37% of searches, up from 20%. Repeated city slots are 5% (was 3%) and there are no identical trips.
- **Thin trip pools:** some low-budget searches pass only one trip, so all three roles show the same itinerary.
- **High budgets lean on hotel upgrades:** C$15,000 often reuses the C$10,000 route with upgraded hotels.

Not measured here:

- Live latency and live Ignav/Nuitée success. The offline harness simulates them.
- Agoda terms for the committed city summary.
