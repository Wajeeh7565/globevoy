# Recommendation engine v2, Step 1: one budget-use target, recorded miss reasons

Switch: `FARE_MAP_TARGET_BAND=85-90` (off when unset; nothing changes without it).

- Every ranking layer (best-use order, balanced pool, experience score, pool fit) aims at the same band, expressed as a share of the **entered** budget. Planning costs are measured on spendable (entered minus the 10% reserve), so 85-90% entered is 94.4-100% of spendable. The reserve stays a hard limit.
- `diagnostics.requirementCheck` on every search: the required shape (multi-city from about C$1,500, multi-country from about C$2,000), how many complete, multi-city, multi-country and in-band trips the search built, the largest budget use reached, rejection counts (flights, budget, duration, city limit, registry, beam, blocked reads), and `missReason` when no trip of the required shape exists.

## Benchmark (offline replay, Nov 26 snapshot, Toronto / Vancouver / New York / London x 8 budgets)

`tests/performance/requirements-scorecard.cjs` against the production settings. Flag off reproduces production exactly (all 32 searches identical).

| C$ | Best Use (base -> step 1) | In 85-90% | Multi-city | Multi-country |
|---|---|---|---|---|
| 1,500 | 85 -> 86 | 50 -> 50 | 27 -> 27 | 27 -> 20 |
| 4,000 | 66 -> 79 | 0 -> 25 | 100 -> 100 | 100 -> 100 |
| 10,000 | 44 -> 41 | 0 -> 0 | 100 | 94 -> 81 |
| 15,000 | 28 -> 27 | 0 -> 0 | 100 | 88 -> 94 |

Finding: aiming alone barely moves the result. The recorded counts show why:
- C$1,500-2,000 from North America: the search completes only 6-19 trips and **no** multi-city trip, while the fare data holds hundreds of 2-3 country European routes in that price range; the dominant loss is fare validity/freshness and beam pruning at the second city.
- C$10,000-15,000: no candidate reaches the band at all (largest use 51-82% of spendable), so no ranking can pick one.

Steps 2-6 address candidate generation and the action space.
