# Six-month vacation optimizer: implementation and acceptance

## Scope and review order

Continue main 4b24a6d with three reviewable changes: Booking v2 CI repair (#156),
collector/beam integration (#157), then this expansion against the integration
branch. Neither original PR #154/#155 nor these changes are merged to main.
The optimizer remains OFF unless ENABLE_FARE_MAP_OPTIMIZER=true. No AWS resources,
provider requests, schedules, secrets, IAM or production deployment were changed.

## How to demonstrate the optimizer independently

From the repository root, use Node 24:

```powershell
node ops/fare-map/demo-six-month.cjs
node ops/fare-map/demo-six-month.cjs --missing-return
node --test tests/backend/six-month-optimizer.test.cjs
node ops/analytics/benchmark-six-month-optimizer.cjs
```

The demo uses a fixed 2027-02-01 clock and synthetic London/Europe fare observations;
its prices are test inputs, never live quotes. Only origin=LHR, budget=5000 USD,
travelers=2 are supplied to search. Walk through its JSON as follows:

1. Normalize origin, display currency, passenger fare units and room occupancy.
   Reserve 10% of the whole party budget before choosing a route.
2. Calculate [today, today plus six calendar months), clamping month-end dates.
   Inspect `requested.departureWindow` and `durationChoices`: 6/8/10/12/14/18/21/28
   nights. An explicit duration supports 4–35 nights. A requested month or departure
   date narrows this window. Returns may extend beyond the departure horizon.
3. Read the origin partitions across every intersecting month, discard stale,
   future-observed, undated, invalid and unsupported-source fares. Read each
   partition once, coalescing concurrent reads. No flight prices or dates are filled
   in when missing.
4. Extend the existing beam to destination A and B. Keep at least one candidate
   per represented departure month before filling the remaining beam slots.
   Apply the existing registry, entry eligibility, region, geography and stay rules.
   Allow at least one transit day per incoming flight (more when duration evidence
   requires it), plus each city's minimum nights. This is a conservative filter;
   actual arrival schedules remain unverified.
5. Require B-to-origin fare evidence on a date matching one duration. Missing a
   return produces no complete itinerary. Hotel budgeting covers all days between
   observed departures, so overnight travel is not treated as a free hotel night.
6. Obtain dated accommodation planning evidence for both cities, scale by rooms,
   include known whole-stay fees, add all three party flight totals, and reject any
   candidate exceeding budget minus reserve. Unknown taxes remain explicit and
   cannot become a tax-inclusive guarantee.
7. Retain distinct destination sequences, choose the cheapest retained route first,
   then cost/interest/quality/comfort/diversity alternatives. Up to three are returned.
   The missing-return demo produces an empty list and an explicit reason.
8. Existing generated-tour presentation supplies cities/stays/backendLegs/budget/
   itineraryDatePlan. Only the selected route can use the existing gated Ignav
   verification. Confirmed arrivals cause accommodation dates/costs to be rebuilt.
   Nuitee final verification requires those verified dates and its existing gate.
   Unavailable/partial provider evidence remains planning evidence.

The three role labels describe retained candidates, not proof of a global optimum.
For comfortable flights, known stops cost 25 score units per stop and known travel
hours add one unit each; missing stops/duration receive uncertainty allowances.
Known hotel review scores subtract two score units per point. Missing quality is
shown as unknown, with requested criteria unverified. Hard minimum quality rejects
known failures. Diversity penalizes reused cities by 75 score units. These weights
are transparent MVP heuristics, not learned user utility or guarantees of comfort.

## Accommodation-cost-map foundation

`backend/services/domain/fare-map/accommodation-cost-map.js` defines a synchronous,
provider-independent lookup over locally available planning evidence. The request
contains cityId, checkIn/checkOut, rooms and minStars/minReviewScore. A quote carries
nightly USD per room, whole-stay taxes/fees when known, source, observedAt/expiresAt,
quality evidence, pricing uncertainty and explicit bookable=false /
availabilityVerified=false. Foreign currency is rejected until an approved adapter
provides a documented conversion. Missing, expired or throwing supplied evidence
returns null and rejects that candidate rather than introducing a zero-cost stay.

The default adapter uses the existing regional nightly model and labels its dates,
quality, taxes and availability as unverified. `fixtureProvider(records)` builds an
indexed offline city/date cost map. Future approved Nuitee/Agoda/Expedia/DataForSEO
adapters can populate this interface asynchronously upstream; search itself accepts
only a synchronous local lookup. This prevents accidental network fanout per beam
candidate. It does not implement or authorize any new provider access. Final live
hotel verification stays in the existing Nuitee adapter, after flight arrival dates
are verified. Planning evidence is retained separately from live room/offer evidence.

## Coverage, bounds and cost

Monthly cheapest-date observations cannot establish a daily fare calendar. The
collector now plans all months intersecting the six-month departure window plus a
35-night return buffer: eight or nine calendar partitions per origin rather than
six. The shared pacing, 45-second run budget, retry policy and task cursor remain.
This increases a full collection cycle by about 33–50%; do not enable collection
in staging until the operator approves that request/usage budget.

Optional FARE_MAP_RETAIN_DATED_OBSERVATIONS=true writes a dated sample alongside
the existing monthly key, using only observations the existing requests already
returned. No new provider query is made for this sampling. Keys remain
pk=F#ORIGIN#YYYY-MM; legacy sk=DEST is preserved; sampled sk=DEST#YYYY-MM-DD is
additive. Legacy reads suppress samples; optimizer reads deduplicate city/date
samples by latest observation. Fourteen-day TTL and logical expiry apply to both.
There are at most 31 date samples plus one summary per destination/month; sampling
increases storage/writes (up to twice the items per collection result). It does not
create absent dates and is OFF by default. Terms/retention approval is required
before enabling any provider-backed persistence beyond the established policy.

Search keeps beam 32 by default (maximum 64), four concurrent partition reads,
64 logical reads, at most two Query pages/read, 1,000 accepted rows/partition,
100,000 edge examinations and 1.8 seconds by default (maximum five). Six-month
search does not multiply a separate query for each duration. Root month reads are
followed by a reserved return-read budget: depth one may use at most 48/64 reads.
Complete candidates are periodically pruned at 129 to 64, so at most 128 are retained.
Time, page, edge, row and read truncation set diagnostics.bounded; page truncation
also increments truncatedPartitions. Partial coverage may miss a viable route.

Worst-case returned database rows before the optimizer's per-partition cap are
bounded by 64 x 2 x 1,000 = 128,000. DynamoDB's byte-page limit may lower that.
Stored date samples may crowd out destinations in capped reads. Before increasing
width/reads, stage real partition sizes and consumed capacity. A future compact
precomputed city/date adjacency index should retain stratified date samples and
coverage metadata; its refresh must use permitted cached observations. Daily
provider fanout and assuming a complete fare calendar are explicitly avoided.

## Measured offline evidence

Windows / Node 24.15.0, 48 synthetic European destinations, seven in-process runs:

| Scenario | Median | Max | Reads | Edges | Complete returned tours |
|---|---:|---:|---:|---:|---:|
| Six departure months, observed 8/14-night options | 38.14 ms | 293.06 ms | 64 | 8,064 | 3 |

Six unique cities appear in the three returned routes; selected routes are 8 nights
because those fixtures are cheaper. Fourteen-night-only fixtures also return tours.
Bounded=true accurately records the exhausted read budget; 17 complete candidates
were retained. Provider calls are zero. The maximum includes the first run and
registry initialization. Heap deltas are GC-sensitive and are not a peak-memory
measurement. This is neither DynamoDB/Lambda latency nor a production SLO.

A separate earlier same-session legacy comparison (same 48-city single-month
fixture, seven runs) measured 29.78 ms legacy / 28.10 ms beam, with 32 / 1,222
expanded pairs, 0 / 3 date-complete three-leg tours and USD130 / USD0 maximum
flight-total error against fixtures. The missing-return scenario returned 24 legacy
candidates / zero beam tours. Timing differences are not evidence of production
speed improvement; rerun the scripts for current machine numbers.

## Controlled AWS staging procedure — not executed

Blocker: no isolated resources or AWS usage/deployment authorization has been
provided for this cycle. No credentials or live AWS resources were inspected.
Docker is installed locally but its daemon is unavailable; CI performs container
validation. All possible deterministic tests, builds and package checks run offline.

1. Review/approve the exact commit, table/function identities, region, usage ceiling
   and stop conditions before any AWS configuration, provisioning or invocation.
   Obtain separate approval for provider requests and any paid final verification.
2. Use a dedicated fare-map DynamoDB table with STRING **pk** and STRING **sk**,
   TTL attribute ttl and no production data. Account tables use different keys and
   must never be reused. Use an isolated staging Lambda with a dedicated role
   limited to Query/GetItem/PutItem/BatchWriteItem on that fare table and logs.
   These resources/IAM must be provisioned/configured by an authorized operator;
   this procedure grants no permission to do so.
3. From a clean checkout, run the checks below and build the existing backend ZIP.
   Preserve its source manifest and SHA-256. The ZIP includes root lambda.js and
   the src compatibility wrapper; explicitly review the chosen handler for the
   staging function (root lambda.handler for this search-only acceptance), runtime,
   layers, environment and existing ordered overlays if reusing an overlay entry.
4. Snapshot the existing staging code/config first. Keep all providers and
   ENABLE_FARE_MAP_JOB off. Point FARE_MAP_TABLE only to the isolated table and
   enable ENABLE_FARE_MAP_OPTIMIZER on that isolated Lambda after approval.
   An empty table must return no complete route without external requests.
5. For storage acceptance, an operator may seed clearly labelled synthetic
   records in the isolated table ONLY with a staging-only synthetic adapter/test
   entry point that preserves fixture provenance and never exposes them as real
   Travelpayouts/LIVE fares. The offline fixtures are not a production seed file.
   Alternatively use provider observations whose collection/storage is separately
   approved. Never label invented synthetic rows as real provider observations.
6. If collection is approved, begin with one origin, one run and a hard request
   ceiling (the job's injected maxTasks=1/time budget in a controlled test entry;
   no schedule). Approve origin expansion only after measured pages, 429 cooldown,
   provider errors, task ownership, partial writes and resume offsets pass. Verify
   actual eight/nine-month cycle task counts, request/refresh cost and freshness;
   monthly completion alone does not prove daily coverage.
7. Invoke origin/budget/travelers-only searches plus explicit month, duration,
   currency and room variants. Preserve request IDs, redacted JSON, invocation
   duration, RSS/memory, actual Query page counts/consumed capacity and diagnostics.
   Test missing-return rows, expired ttl, old observations, denied reads, quota,
   partial writes and simultaneous cursor owners. Stop on any budget/date violation,
   secret leakage, production identity, external request outside approval, retry
   overrun, or unbounded resource use.
8. Require zero fabricated routes, consistent three-leg dates, matched room/party
   totals, reserve protection, honest hotel uncertainty and at most three distinct
   sequences. Measure cold/warm p50/p95/p99 at approved volume; a suggested staging
   target is warm p95 under two seconds within the default 64 reads / 128 pages.
   Treat that as an acceptance target, not achieved performance. Validate classic
   and React response contracts and signed-out/private-route security too.
9. Final selected-tour Ignav/Nuitee checks need separate usage approval and existing
   credentials/gates. Confirm actual arrival dates, hotel occupancy, taxes, price
   changes and failures. No cached itinerary is declared bookable without this.
   Record results and request a separate promotion decision; no merge/deploy is
   automatic.

Offline checks (PowerShell):

```powershell
npm ci --prefix web --no-audit --no-fund
npm test
node scripts/run-tests.mjs account providers release web
npm run typecheck:web
# Build the isolated production fixture FIRST; then restore the normal export.
node tests/release/build-production-frontend-fixture.mjs
npm run build:web
npm run test:browser
$env:GLOBEVOY_TEST_FRONTEND_ROOT='.cache/ci-production-frontend'
npm run test:browser
Remove-Item Env:GLOBEVOY_TEST_FRONTEND_ROOT
# Clean committed source required. These commands make no AWS calls.
./ops/release/package-launch-first-backend.ps1 -OutputName next-cycle-backend
Get-FileHash .cache/next-cycle-backend.zip -Algorithm SHA256
```

## Rollback and remaining gaps

Disable ENABLE_FARE_MAP_OPTIMIZER to restore existing routing. Disable the job and
dated-sample flags if rolling back collection. Preserve cursor and data for audit;
additive samples expire under TTL and must not be destructively migrated. Before
restoring older collector code, keep its job disabled until its weaker ownership/
retry behavior is reviewed. Restore the preserved matching Lambda ZIP, handler,
environment/layers only through a separate authorized staging/production action.
Source rollback is a reviewed revert of the corresponding PR; main is unchanged by
this cycle. No frontend framework or legacy functionality was removed.

Sparse real coverage can honestly yield no result. Exact flight arrival schedules,
flight/airport identity, stop/comfort details, live hotel availability and regional
model seasonality remain incomplete. Regional estimates have no observed timestamp
or verified quality; taxes may be unknown. FX uses existing planning rates rather
than a new live feed. Search bounds can miss the global optimum, and date retention
can enlarge partitions. Existing clients that explicitly send month/nights narrow
the request; origin/budget/travelers-only backend requests use the full window.
Production acceptance, live provider costs, actual database capacity and peak Lambda
memory remain unmeasured. Only two destinations are supported in this MVP.
