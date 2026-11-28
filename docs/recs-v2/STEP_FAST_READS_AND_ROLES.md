# Recommendation engine v2: faster reads, role rules

Live tests on Nov 28 showed every C$1,500-2,000 search stopping at the 5 s search limit ("search-time-limit", 4-14 complete trips, no multi-city trip). Offline replay now simulates DynamoDB latency (`BENCH_READ_LATENCY_MS`, 70-130 ms per Query) and reproduces it: 12 of 32 searches hit the limit, median 5.0 s.

## Switches (all off by default; flags off = identical to main on the replay)
- `FARE_MAP_READ_CONCURRENCY=16`: fare partitions read 16 at a time instead of 4.
- `FARE_MAP_PREFETCH_ROUTE_DATES=on`: real dates home (date-pass rows) for every beam state are read in parallel before the depth, instead of one by one inside it. Same 24-read cap.
- `FARE_MAP_ROLE_RULES=on`: from about C$2,000 the two non-cheap pool slots are international multi-country trips when the pool has them; the Lowest Cost slot (at most 60% of spendable, standard hotels) applies without experience mode.

## Benchmark (production settings incl. dates + price index; 4 origins x 8 budgets; 100 ms simulated reads)

| | Production | + fast reads | + fast reads + role rules |
|---|---|---|---|
| Search time, median / max | 5.0 s / 5.0 s | 1.3 s / 1.5 s | same |
| Searches stopped by the time limit | 12 | 0 | 0 |
| Live checks per search (paid API) | 3.06 | 3.03 | same |
| C$1,500 multi-city | 0% | 25% | 25% |
| C$2,000 multi-country | 0% | 25% | 38% |
| C$3,000 multi-city / multi-country | 0% / 0% | 100% / 100% | 100% / 100% |
| Distinct routes shown | 74 | 101 | 103 |
| Lowest Cost at most 55% of budget | | 15 / 32 | 23 / 32 (median 62% -> 47%) |
| Best Use C$7,500 | 74% | 83% | 74% |
