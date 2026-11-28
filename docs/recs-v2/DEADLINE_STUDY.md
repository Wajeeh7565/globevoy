# Search deadline study (Nov 28, offline)

New switches (off by default): `FARE_MAP_SEARCH_MS` (search deadline, 1-15 s; default 5 s) and `FARE_MAP_BEAM_WIDTH` now also applies when the deadline is above 5 s. Role rules (`FARE_MAP_ROLE_RULES`) now also prefer trips entirely abroad from about C$1,500 (any continent).

Replay with production settings + fast reads + role rules, 300 ms simulated per DynamoDB read, 4 origins x 8 budgets:

| Deadline | Reads | Beam | Search time median | Hit the limit | Complete trips built (median) | Paid live checks / search |
|---|---|---|---|---|---|---|
| 5 s | 96 | 48 | 3.6 s | 20 of 32 (read cap) | 240 | 3.0 |
| 10 s | 192 | 64 | 5.7 s | 0 | 398 | 3.03 |
| 15 s | 256 | 64 | 5.8 s | 0 | 408 | 3.03 |

Requirement scorecard: international 88-100%, multi-city and multi-country essentially unchanged; Best Use unchanged or 1-5 points lower at C$7,500-15,000; stays of 2-10 nights per stop fall (88% -> 63-69%) with the wider beam.

Finding: more search time builds ~70% more complete trips but does not improve what is recommended. The ranking and the trip shapes (cities, nights, hotel tier) decide quality; Steps 4-6 change those. Live, C$1,500-2,000 searches still hit the 5 s limit with 83-96 reads; offline 300 ms reads do not reproduce that, so the live slowness is likely CPU (Lambda memory) or slower reads. The read timing added in PR #214 (`readMsTotal`, `readMsMax`, `readRows`) will show which.
