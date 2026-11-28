# Stage 6 candidate: experience ranking without stay padding (Nov 28)

Live baseline after the night's changes: price-index hotels, no hostels for couples, parallel reads, role rules, Lambda memory 512 -> 1,769 MB (search 5.4 s -> 1.6 s, page 20 s -> 4.7 s at C$1,500; reads 400 ms -> 120 ms average).

Candidate settings (`stage.sh 6`): `FARE_MAP_EXPERIENCE=on`, `FARE_MAP_COMFORT_MODE=adaptive`, `FARE_MAP_REFRESH_ROTATION=on`, `FARE_MAP_HUGE_MAX_CITIES=4`, `FARE_MAP_DYNAMIC_DESTINATIONS=on`. Left out on purpose: `FARE_MAP_BIG_STAY_EXTRA` and long stays (they produced 13 nights in Dhaka on Nov 27) and the 7-day fare age.

Offline replay (production data + 467-city hotel truth, 4 origins x 8 budgets, 30 ms reads):

| C$ | Best Use now -> stage 6 | In 85-90% | Multi-country | Same-country pairs |
|---|---|---|---|---|
| 1,500 | 86 -> 85 | 75 -> 75 | 25 -> 25 | 0 -> 0 |
| 2,000 | 73 -> 86 | 25 -> 50 | 38 -> 38 | 0 |
| 3,000 | 87 -> 87 | 50 -> 75 | 100 -> 100 | 0 |
| 5,000 | 76 -> 85 | 0 -> 25 | 94 -> 100 | 6 -> 0 |
| 7,500 | 74 -> 88 | 25 -> 75 | 100 -> 100 | 0 |
| 10,000 | 64 -> 85 | 0 -> 50 | 100 -> 100 | 0 |
| 15,000 | 42 -> 77 | 0 -> 0 | 100 -> 100 | 0 |

Live checks passed 96/96 -> 96/98; search 0.56 -> 0.65 s offline; Lowest Cost median 47% -> 50% of budget; distinct routes 103 -> 108.

C$1,500 stays mostly single-city: with live-priced hotels few 2-city international trips fit US$990 spendable, which the requirements allow (single city forgivable up to C$2,000); the trips are international (Lisbon, Tirana, Medellin, Antalya) except some Lowest Cost picks.
