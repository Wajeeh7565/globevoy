# Fare-map two-destination MVP — disabled, not deployed

This continues the table/model from #151–153. The optimizer and collector are
separate PRs based on main. Neither changes AWS, provider settings, IAM or schedules.
The old routing engine is still selected unless ENABLE_FARE_MAP_OPTIMIZER=true.
No login is required to search.

## Demonstrating the algorithm

Imagine London is the origin. The table has a dated cached fare to Amsterdam and
one to Berlin. The first beam keeps promising covered cities, not a fixed four.
For each retained city it reads dated outgoing fares. Amsterdam to Prague is only
usable when the departure leaves enough nights in Amsterdam. The second beam keeps
promising two-city paths, including their flight and hotel costs. Finally, Prague
must have a dated fare back to London matching the requested duration. Without that
third observation the route is rejected: no distance-based return fare is invented.

The final choices protect a 10% reserve and penalize repeated cities so the top three
are different ideas. Cached fares remain estimates, not available or reserved flights.
The database is an adjacency map: each origin/month partition supplies the outgoing
edges. Beam search limits the number of partial paths kept between expansion stages.
It is an approximation, not an exhaustive search or guarantee of the cheapest trip.

## Code map

- `backend/services/domain/fare-map/fare-map-optimizer.js`: reads existing partitions,
  validates observations/dates, expands and prunes paths, applies business rules,
  calculates party/room costs and selects diverse complete routes.
- `fare-map-store.js`: optional bounded, cancellable Query pagination and logical TTL
  filtering. Existing pk/sk data model and public reader signature remain compatible.
- `multicity-routes.js`: opt-in dispatch before the existing adaptive/legacy engine.
- `generated-tour.js`: opt-in classic response composition through the existing
  visualizer builder. No legacy date scanner is allowed to move a cached fare to a
  different date. Existing final Ignav verification is reused once for the selected
  tour; Nuitee is only reached after actual arrival dates are validated.
- `global-route-graph.js`: adds a response-only evaluated-pair diagnostic for the
  existing engine. Its selection/provider behavior is unchanged.
- `tests/backend/fare-map-fixtures.cjs`: synthetic fares over real registry cities;
  not production data. `fare-map-optimizer.test.cjs` verifies contracts and safeguards.
- `tests/frontend/classic-save-browser.test.cjs`: a guest visualizer regression
  consumes the new engine's real offline output through the current frontend format.
- `ops/analytics/benchmark-fare-map.cjs`: actual legacy provider-driven engine versus
  the new engine, with all HTTP and DynamoDB access replaced by synthetic fixtures.

## Bounds and policies

The candidate surface is the 1,000-city registry, filtered through existing production
activation, destination/provider readiness, travel-entry and route-feasibility rules.
The MVP excludes gateway-transfer origins/destinations rather than invent transfer
fares. Shared metro codes are not treated as separate flight destinations. User
region/preferred stops, recommended stay bounds, exact departure/return constraints
and party/room pricing are respected. Unknown currencies, impossible dates and
unresolved origins fail closed.

Default beam width 32 (maximum 64), read concurrency 4, maximum 64 unique partitions,
maximum 100,000 examined edges and 1.8-second search budget. Each partition has at
most two Query pages of 1,000 rows. Concurrent identical reads coalesce. Reads are
abortable; no provider request takes place during expansion. Diagnostics expose
reads, cache hits, examined edges, expanded pairs, complete routes, rejected fares,
rejected rules, diversity, time and whether a bound was reached. Optional test bounds
are internal, not customer-controlled query parameters.

Every leg needs a real stored departure date, positive USD amount, expected partition
identity, cached source, unexpired TTL and observation no older than 72 hours by
default. A retrieval timestamp does not establish freshness of the provider's original
cached search. No date is invented for a missing monthly observation. Missing/stale
return coverage returns no complete tour, with the established tours-array response
shape and a reason. Disable the flag to use the unchanged old engine; it is not
silently mixed into a supposedly fully covered fare-map result.

## Arrival times, hotels and final verification

The existing table contains one cheapest date per route/month, not a daily fare
matrix, flight schedule, arrival time, seat inventory or live quote. Route dates are
therefore departure-calendar-compatible planning observations. They are **not** proof
of an operationally possible connection or a booking-ready itinerary.

Until flight arrivals are known, hotel estimates conservatively cover every night
between inbound departure and onward departure. `arrivalDatesVerified=false` and
`hotelDatesRequireVerification=true` remain explicit. This can overestimate hotel
nights around overnight flights; it deliberately avoids an under-budget claim by
dropping unknown nights. Do not represent those check-in dates as verified.

After selecting one route, the existing Ignav adapter may run only under its existing
flag/key, quotas, transport/identity/date and partial-coverage protections. No flags
are changed here. Complete live results must include valid destination-local arrival
dates, leave at least two nights in each city, preserve the next priced departure and
still fit the protected budget. Over-budget or inconsistent live results are rejected.
Actual arrival dates then replace the conservative hotel dates. Only then can the
unchanged gated Nuitee final-tour pipeline run, preserving its account/identity,
currency, occupancy, sandbox and price-evidence restrictions. No booking, PREBOOK,
payment or reservation is introduced. Provider failure keeps honest cached estimates;
partial verification never labels the complete itinerary live.

The depth loop and state representation support additional stops structurally, but
query destinationCount above two is rejected. Three/four-stop cost, date, diversity
and request limits need further review before exposing those modes.

## Reproducible offline walkthrough

From a checkout with the existing web dependencies installed:

```powershell
node --test tests/backend/fare-map-optimizer.test.cjs
node ops/analytics/benchmark-fare-map.cjs
$env:GLOBEVOY_TEST_BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node --test --test-name-pattern='fare-map two-stop' tests/frontend/classic-save-browser.test.cjs
```

The first command proves missing returns, stale/invalid fares, date crossings,
passenger/room costs, eligibility, failures, read bounds and final-verification gates.
The second prints measured comparisons. The last opens the existing guest UI with
offline engine output, without signing in or making provider/database requests.
Ordinary default tests also register the optimizer suite.

### Recorded benchmark

Seven warm-process runs; synthetic complete fare matrix across 48 eligible real
registry destinations, one adult, eight nights, USD. Both actual engine functions run;
provider HTTP/DB are mocked. Results are local measurements, not Lambda latency,
DynamoDB latency, market-price accuracy, production throughput or a reliability SLO.

| Metric | Existing 4 × 8 engine | Beam MVP |
| --- | ---: | ---: |
| Expanded candidate pairs | 32 | 1,504 |
| Edges examined | not instrumented | 3,120 |
| Two-stop tours compared | 3 | 3 |
| Distinct cities in those tours | 3 | 6 |
| Tours with all three cached flight observations | 0 | 3 |
| Tours with all three departure dates | 0 | 3 |
| Tours accounting for all eight hotel nights | 3 | 3 |
| Maximum flight-budget error against synthetic fares | USD 130 | USD 0 |
| Median warm CPU/mocked-I/O time in recorded run | 22.38 ms | 24.39 ms |
| Partition reads per search | 0 | 50 |
| New engine provider calls | — | 0 |

After removing return observations, the old engine returned 24 two-stop planning
candidates using an estimated return; the new engine returned zero. This is an
intentional accuracy/coverage tradeoff. Timing varies between runs; the extra search
does not prove a speed advantage. Existing provider-driven discovery made ten mocked
HTTP calls per benchmark search; the new engine replaces that discovery with table
reads, not live verification. Final selected-route provider calls are not benchmarked.

## Staging gate and release instructions

No merge, deployment or activation is performed. Owner approval must identify an
existing isolated staging Lambda/table and permitted provider request ceiling. If
that environment does not exist, request specific infrastructure/cost approval; do
not create one silently. Production IAM, schedules and environment stay unchanged.

1. Resolve the pre-existing main CI blocker: Booking v2 hides the legacy workspace,
   while 11 old browser regressions still require it to be visible. Main run
   44509737927 failed at that same step before these PRs. Do not weaken or delete
   security assertions to green-light this work. Collector-only PR #154 reproduces
   the same main/browser and production Docker-profile failures.
2. Review/merge the collector and optimizer PRs through normal approval. They both
   extend the store reader; reconcile its TTL filter, abort and pagination options
   together. Run all tests again on the combined tree before any staging build.
3. Verify isolated table GetItem/PutItem/BatchWriteItem/Query access as needed. No
   GSI, schema change or access to account/saved-trip data is required.
4. Collect a controlled supported sample using the corrected collector. Verify currency
   configuration and rebuild records from before #153's currency repair; do not trust
   old rows just because they have not expired. Inspect a complete cycle's measured
   >=99% target, error categories and coverage; no mocked success rate qualifies.
5. Package with the existing release tools. Keep ENABLE_FARE_MAP_OPTIMIZER off during
   initial staging import/account checks. Enable it ONLY in that staging environment
   after approval, using the isolated FARE_MAP_TABLE and existing generated-tour gates.
   Start with cached-only search; verify three real covered legs, dates, hotel totals,
   different budgets/passengers and no-data handling. Measure real Query latency/read
   units and the 1.8-second bound before selecting a production budget.
6. Separately authorize a bounded final Ignav test and, only after flight-arrival
   validation, approved Nuitee access. Never enable live flags merely to pass tests.
   Verify exact returned airports, dates, party/currency, expiry where provided, hotel
   identity, occupancy and honest referrals. There is no booking/payment operation.
7. Production remains disabled until the combined code, CI and controlled staging
   acceptance pass and the owner authorizes its precise release/configuration/costs.

Rollback the optimizer by turning its staging flag off and confirming old routing
resumes; restore prior staging code if necessary. Collector rollback and cursor safety
are described in FARE_MAP_RELIABILITY.md. No website deployment is required to consume
the compatible generated-tour response, but browser acceptance remains mandatory.

## Remaining limitations

Sparse cheapest-date data rejects many otherwise possible trips; this MVP does not
invent alternatives for uncovered dates. No global optimality claim. Arrival-time
uncertainty remains until live verification. Gateway transfers and more than two
destinations are intentionally unsupported. Real DB latency, current table coverage,
historical failure attribution and the 99% target await authorized staging evidence.
