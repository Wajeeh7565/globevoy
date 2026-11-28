# Recommendation engine v2, Step 2: price-index hotel planning, accommodation class

## 2a. Plan hotels with the 467-city price index
Existing code, now benchmarked: `PRICE_INDEX_STORAGE=on` + `PRICE_INDEX_PLANNING=on` plan each city's hotels at its Nuitee level ratio (median nightly of well-reviewed 3-4 star hotels / planning model) instead of the flat margin. Data: 467 city summaries collected 2026-11-27 (aggregates only), imported as `PI#city` items with 35-day expiry.

Offline replay with realistic hotel truth (the same 467 ratios), Toronto / Vancouver / New York / London x 8 budgets:

| | Production planning | Price-index planning |
|---|---|---|
| Live checks passed | 95 / 120 (79%) | 96 / 97 (99%) |
| Live checks per search | 3.75 | 3.03 |
| C$1,500: international / Europe from North America | 67% / 0% | 88% / 17% |
| C$2,000: multi-country | 25% | 31% |
| Best Use C$7,500 / 15,000 | 81% / 35% | 83% / 42% |
| Best Use C$5,000 | 87% | 76% |

Planning on real hotel levels picks trips that survive the live check, so fewer paid checks per search and more international trips at low budgets. Big budgets still lack candidates that can spend (Steps 3-6).

## 2b. Hostels and dorm beds are a separate class (`NUITEE_HOTEL_CLASS=on`, off by default)
Live hotel choice classifies offers from the property name, the room name and the star rating when sent (hostel, backpacker, dorm, capsule, bed in, shared room, bunk, under 1.5 stars). 2+ travellers never get one; one traveller only when no hotel-class offer exists. A stop with only hostels for a couple fails its live check, so the next candidate trip is used. Offline replay cannot measure this (hotel offers are simulated); unit tests cover it, and the live check after deployment confirms it.
