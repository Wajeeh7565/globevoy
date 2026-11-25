# GLOBEVOY-104 Ignav cost controls and release preparation

GV-COST-001 is implemented and offline-tested on recs-v2, based on 84d3b40. The recommended first trial uses the read plan, balanced pool scoring, the guest arrival-risk check, and adaptive member spares. The new shared lease and account quota remain off in the trial configuration until the provider contract and AWS setup are approved.

## Implementation and test coverage

| Area | Implementation | Offline verification |
|---|---|---|
| Usage | Allowlisted event logs at the upstream send boundary count fare and booking-link requests, cache hits by layer, active joins, failures, timeouts and quota blocks. Tour completion reports requested guest/member page size, checks, rounds, spares started, successful unused spares, shown count and verification time. Each candidate owns its counters and results are aggregated independently of completion order. | Mock responses checked event ownership, multiple candidates completing out of order, and redaction. The audience describes the requested page size, with no identity or route stored in the usage event. |
| Fare reuse | Credential- and tenant-scoped identity includes canonical request endpoint, exact airport pair, date, adults, children, requested currency, market, cabin and stop limit. Identical in-flight calls join one promise. The optional DynamoDB lease extends the existing fare-map cache. Followers poll within a 1.25-second lease wait after the initial cache lookup. The leader lease expires after 45 seconds, and conditional deletion protects a successor. | Separate module instances shared a fake DynamoDB store. Coverage includes one send on a concurrent miss, bounded waiting, lease expiry, a failed leader, and unavailable DynamoDB. Verified fares and well-formed empty results keep the existing 15-minute reuse and three-hour observation limits. Malformed or failed responses are retriable without reusing them as empty fares. |
| Account quota | A single DynamoDB transaction checks an emergency-stop row and the approved configuration fingerprint, then reserves units in the daily and billing-period counters. The allowance, period, UTC renewal anchor, weights and warning percentages are explicit. One stable transaction token is reused after an ambiguous storage acknowledgement. Failed or timed-out provider calls retain their reservation. State errors block new sends. | Mocked concurrency, exhaustion, day rollover, fixed-period and month-end rollover, endpoint weights, warning events, retry idempotency, emergency stop, configuration mismatch, timeout accounting and storage outage passed. A valid cache hit remained usable while the upstream stop was closed. |
| Booking | The selected flight’s link lookup starts on click. Browser and server join concurrent requests and remove the shared promise when it settles. The server validates a signed, expiring proof for every caller before joining. A generic link remains a comparison action. Flight evidence is checked against the selected route, date and traveller count when present. Hotel room checkout requires a fresh live offer and matching property, dates, and occupancy. A stale or incomplete offer is a property or comparison handoff. | Chromium ran offline. Opening the page sent zero link requests, rapid repeated clicks sent one, and the generic response rendered as a comparison. Backend mocks cover concurrent clicks, proof expiry, tenant scope and the difference between exact and generic links. |
| Hotel integrity | One cheapest-room retry now applies when all live rooms push the total above the protected limit, including quotes still below the entered budget. The retry shares the stay rate cache, and final pricing retains the same protected cap. | Coverage includes the 90%–100% gap, all-in fees, room and traveller totals, role-specific discretionary caps, verified dates, stale offers and unavailable rates. No protected-budget violation occurred in the Toronto replay. |

Existing owner-private booking revalidation uses the Duffel pilot in this checkout. It remains a distinct explicit action. The booking change eliminates an eager Ignav link lookup and does not add another fare revalidation. The partner still confirms inventory, final price, selected flight and room on handoff. No persistent booking-link cache is used.

## Eight-budget Toronto replay

Request counts are mocked upstream **fare** sends on cold recommendation pages. An Ignav pair is guest / member. The historical column comes from the 84d3b40 replay. The optimizer trial uses the updated implementation with two spares and fare joining off as a comparison. The cost trial adds guest arrival-risk ordering, adaptive member spares and fare joining. The booking action is a separately measured request.

| Budget CAD | Original Ignav | Optimizer trial Ignav | Cost trial Ignav | Cost trial guest / member budget use |
|---:|---:|---:|---:|---:|
| 1,500 | 4 / 10 | 2 / 10 | 2 / 8 | 75% / 81% |
| 2,000 | 2 / 10 | 2 / 10 | 2 / 8 | 53% / 80% |
| 3,000 | 3 / 12 | 3 / 12 | 3 / 10 | 83% / 83% |
| 4,000 | 3 / 15 | 8 / 17 | 4 / 14 | 84% / 84% |
| 5,000 | 3 / 15 | 8 / 18 | 4 / 14 | 66% / 68% |
| 7,500 | 3 / 15 | 4 / 19 | 4 / 12 | 53% / 53% |
| 10,000 | 3 / 15 | 4 / 20 | 4 / 12 | 46% / 46% |
| 15,000 | 3 / 15 | 4 / 20 | 4 / 16 | 31% / 31% |
| **Total** | **24 / 107** | **35 / 126** | **27 / 94** | |

The C$1,500 guest now passes on the first candidate after the cheapest-room re-selection. In the prior baseline it had to move to another candidate. Holding the original optimizer settings constant on the updated code produced **22 / 107** requests. In the C$4,000 and C$5,000 optimizer trial, the first candidate used four requests before an overnight arrival reduced the Casablanca stay below its three-night minimum. The final date plan was consistent, but the stay failed the travel-burden and usable-time guards. The cost trial tried the safer three-city candidate first and left the original available as a backup. The displayed guest route stayed Phuket → Da Nang → Kuala Lumpur at C$4,000 and Phuket → Da Nang → Bangkok at C$5,000.

Guest checks and rounds fell from 10 to 8 each versus the optimizer trial. Member checks fell from 40 to 30, and all eight member pages still filled in one round. Successful unused member spares fell from 12 to 3. Each trial returned eight guest and 24 member cards. The original optimizer covered 4 distinct guest cities and 13 member cities, versus 10 and 27 in both optimizer and cost trials. No shown routes triggered the benchmark detour, spread, or stay flags. All selected replay cases had complete partition coverage, with zero protected-budget violations. The optimizer trial made one duplicate upstream send in cold pages. Independent lookups with joining enabled removed it when both candidates were checked. The adaptive cost trial made no duplicates on these cold pages.

The warm study cleared the local cache between repeated member pages. It reused **94 shared responses with zero new upstream requests** over the eight budgets. Changing the seen-route list still produced diversified trips. Those refreshes used 75 new sends, 21 shared hits and one in-flight join. Normal-mock member verification median was 10 ms for the optimizer trial and 6 ms for the cost trial. These are local compute timings with immediate provider stubs.

## Spare strategy under failures

The stress replay injected one hard missing-flight result for the first candidate and staggered flight and hotel delays. The short mock delays model relative waits and do not estimate provider seconds. Each policy filled all 24 member slots with the same member budget results and geographic quality.

| Spares | Mock member fare requests | Candidate checks | Verification rounds across eight pages | Median mocked verification |
|---|---:|---:|---:|---:|
| Zero | 104 | 33 | 16 | 74.5 ms |
| One | 106 | 34 | 9 | 44 ms |
| Two | 125 | 40 | 8 | 37.5 ms |
| Adaptive | 104 | 33 | 11 | 45 ms |

Adaptive is the cost-first trial setting. It starts one spare if a multi-card batch has a vulnerable first stay, mirrored return, or candidate near the protected limit. Fixed one spare is the immediate latency fallback if the observed second-round rate is too high. Guests get zero spares with every setting. The guest ordering flag changes only the first candidate when the next two contain a comparable city count with a safer first stay.

## Release configuration, prerequisites and rollback

- Use [release.env.example](../ops/ignav/release.env.example) as review input. FARE_MAP_READ_PLAN and FARE_MAP_BALANCED_POOL are on for the proposed trial. Leave the global city override and stay override unset for standard behavior. Keep four-city verification, route variants, targeted beam and all other experiments separate. FARE_MAP_GUEST_ARRIVAL_RISK is optional. FARE_MAP_POOL_SPARE_STRATEGY accepts 0, 1, 2 and adaptive. An explicit server setting takes precedence over the request. The existing two-spare policy is the default. IGNAV_USAGE_LOG enables structured operational events. IGNAV_FARE_COALESCE is on when unset and can be switched off for a controlled comparison.
- Provider approval must establish permissible cached evidence retention and cross-instance coordination, billing units and renewal anchor, endpoint-specific rates, treatment of empty responses, failures, timeouts and provider cache hits, and booking-link identity and expiry. Confirm account-wide spend independently with provider usage records. Scope all credentials sharing a bill to the same quota account. For shared credentials across tenants, set a stable IGNAV_TENANT_SCOPE consistently. Changing it invalidates the old cache key namespace and previous booking proofs for that tenant.
- Review [control-template.yml](../ops/ignav/control-template.yml) before provisioning. It defines one retained DynamoDB ledger and separate unattached quota and existing fare-map lease policies. The quota runtime role checks the control partition and updates counters only within transactions. A separately authorized operator controls the stop row. The lease policy extends the existing cache role with restricted conditional put/delete rights on IGNAVLEASE# partitions. Fare reads and result writes still use the existing LIVE#ignav partition and permissions. The new fare key namespace has a cold-cache period after release.
- For authorized quota activation, configure all values in the environment example and calculate the nonsecret fingerprint with ignav-quota._internal.config(env).fingerprint on the release configuration. Seed the row with pk IGNAVSTOP#<account>, sk control, a string configuration equal to the fingerprint, and enabled=false. Confirm role scope, stopped-state behavior, warning delivery, and quotas before enabling the row and guard in the approved environment. Set the quota toggle on with an explicit approved configuration, and enable sends only once every relevant Ignav client is covered by the same controller. Day resets are at UTC midnight. Monthly periods clamp a 29th–31st anchor to the last day of shorter months. Fixed-day periods follow the supplied UTC anchor. The stop prevents new reservations and leaves already admitted work and valid cache reuse intact.
- Review integration on a fresh authorized target reference before packaging. Against the local origin/main ref at the start of this task, 84d3b40 was 24 commits ahead with no commits behind. Its ancestry already contains hotel fee handling, hotel planning, hotel memory and the recommendation work. No separate dependency needs to be copied from those branches. The Task 9A branch has a distinct commit outside this work. Review the ancestry and full diff for the proposed integration because these counts are local refs. Use the repo’s production-only packaging and retained backend version. Release the compatible client booking scripts together and account for caching of their existing URLs.
- During an approved rollout, first test the new optimizer and logging with lease and quota off in the approved environment. Compare page fill, first verified card latency, spare failures, verified geography, cache reuse and real upstream usage. Test quota and lease separately. To roll back recommendation behavior, turn off the arrival-risk flag and set spares to one or two, or remove the two optimizer flags. Disable shared leases independently if coordination fails. For an account incident or rollback to a build without central quota, keep the shared stop closed while the guard is active and use the provider-side stop or disable Ignav before reverting to a version without the guard. Keep ledger records through the billing window. Blocking new provider spends is preferable to silently removing hard protection.

## Reproduction and status

Run the investigation harness with the original private file paths and put JSON in the ignored .cache directory.

    node tests/performance/recommendation-investigation.cjs --fare-snapshot <local-gzip> --memory-file <local-memory> --cost-release
    node tests/performance/recommendation-investigation.cjs --fare-snapshot <local-gzip> --memory-file <local-memory> --json --cost-study --env FARE_MAP_READ_PLAN=on --env FARE_MAP_BALANCED_POOL=on --env FARE_MAP_GUEST_ARRIVAL_RISK=on --env FARE_MAP_POOL_SPARE_STRATEGY=adaptive

The implementation, operational events, booking flow, configuration validation, concurrency and fault paths were tested with local mocks and offline Chromium. The CloudFormation file was parsed locally. Provider billing, live inventory, quota enforcement in AWS, and production latency remain unverified. No cloud resources or Lambda settings changed.

## Files changed

- Ignav [adapter](../backend/services/providers/flights/ignav/ignav.js), [usage events](../backend/services/providers/flights/ignav/ignav-usage.js), [quota](../backend/services/providers/flights/ignav/ignav-quota.js), [fare cache](../backend/services/domain/live-fares/ignav-fare-cache.js) and [live fare diagnostics](../backend/services/domain/live-fares/ignav-live-fares.js).
- Candidate verification and hotel retry in [generated-tour.js](../backend/services/domain/tours/generated-tour.js).
- Booking click path in [lambda.js](../backend/lambda.js), [partner-links.js](../backend/services/providers/links/partner-links.js), [booking-ignav-links.js](../frontend/scripts/booking-ignav-links.js) and [booking-trip-v2.js](../frontend/scripts/booking-trip-v2.js).
- Offline [cost replay](../tests/performance/recommendation-investigation.cjs), [quota and lease tests](../tests/backend/ignav-cost-controls.test.cjs), [pool and retry tests](../tests/backend/recommendation-pool.test.cjs), booking [link](../tests/frontend/booking-ignav-links.test.cjs), [pricing](../tests/frontend/booking-trip-v2.test.cjs), and [Chromium](../tests/frontend/booking-cost-browser.test.cjs) tests, and [test registration](../scripts/run-tests.mjs).
