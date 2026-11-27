# Production search activity — approval package

Status: implemented and offline-tested; NOT deployed or production-accepted. No real production event has been recorded by this work. Existing uncommitted API_ACCEPTANCE_NOV16_2026.md belongs to the earlier audit and is excluded from this PR.

## What already existed
Public guest searches, production Cognito/private account routes, Saved Trips/profile DynamoDB writes and operational logs existed. There was no central search-event store. These implementations remain in place; Saved Trips is not reused for analytics.

## Components and boundaries
- backend/services/analytics/search-activity.js: wrap invokes the original public handler once, then records completion without changing its body/status or existing headers. Successful recording adds X-GV-Activity-Id, a non-identifying per-request hash, to correlate real acceptance; no user/session identifier is added. configuration validates an opt-in nonsecret build file. sanitize produces only schemaVersion, random/server-request-derived eventId, UTC date/hour, category, outcome, result-count band, duration band, price-evidence category and TTL. persist atomically inserts the unique event and increments daily and hourly counters. No user ID, guest cookie, session ID, headers, IP, travel dates/airports, queries, budgets, credentials or raw error messages are stored.
- backend/lambda.js: one wrapper at the public API boundary. Categories: recommendations, mixed_results, multi_city, generated_tour, date_adjustment, route_adjustment, fare_calendar, flex_windows, one_way_lookup. frontend/runtime/api-client.js and web/lib/api.ts use these public endpoints; legacy explorers also use fare-calendar/flex-windows. Auxiliary lookups/adjustments have separate categories: do not sum them into the count of initial customer searches. Internal generation/provider function calls do not emit separate events. OPTIONS, admin, registry, account/login and unknown routes are excluded.
- production-account-lambda.js forwards actual Lambda invocation context only for public delegation; private auth and ownership remain unchanged. No token is needed for guest analytics.
- Events use PK DAY#YYYY-MM-DD and SK EVENT#hashed-server-request-id. Counter rows share the day and use COUNT#category#outcome and HOUR#HH#category#outcome. A conditional event insert and both counter updates are one transaction: replay cannot increment the count twice. Different HTTP invocations, including browser retries, are distinct events. There is no cross-device/user tracking.
- Price category is conservative: LIVE requires explicit production eligibility and unexpired evidence, otherwise not_assessed; other categories include cached, estimated, unavailable and mixed. A mixed flight/hotel price cannot become a full-trip LIVE claim. No inference from mere provider names. No prices are stored.
- ops/analytics/daily-counts.py: local AWS-IAM-authenticated, consistent Query of COUNT# or HOUR# rows for one UTC day, no scan or public endpoint. Reader policy is separate from the Lambda writer. The operator policy may also inspect approved sanitized event rows with a day Query for acceptance; it has no account-table access.

## Reliability and limits
SDK maxAttempts=1, 200 ms AbortSignal deadline, skip if less than 400 ms invocation time remains, catch all analytics/config/logging errors and preserve the original search response/exception. Fixed operational log records contain only component/status. Event, daily counter and hourly counter writes commit together or not at all, including ambiguous network failures. DynamoDB may finish a timed-out transaction: use its event ID to inspect, not an unconditional retry. Duplicate transaction cancellation cannot double-count. This is best-effort analytics, not guaranteed-lossless delivery during outages; searches take priority. SDK startup overhead and response parsing add small unmeasured CPU cost; the deadline bounds the network operation, not every CPU instruction. No background fire-and-forget Lambda writes.

TTL is eventual, not an exact-time deletion guarantee. Query counts only within the approved retention window; administrators must not promise exact-time erasure. All events and counters for a UTC day share its midnight-based expiry; expiry does not reveal the precise search time. A 30-day setting retains roughly 29–30 days before eligibility for eventual TTL deletion. One per-category/day counter can contend at high rates; this scope targets current small beta traffic, not unbounded high-volume analytics. Monitor write failures and throttle alarm; shard only if measured traffic requires it.

## Exact proposed AWS changes — DO NOT APPLY before explicit approval
CloudFormation ops/analytics/activity-stack.json creates:
1. globevoy-production-activity-events, PK/SK String, PAY_PER_REQUEST, AWS-owned server-side encryption, TTL expiresAt, deletion protection, Retain on delete/replace. Propose 30-day retention (parameter 1–90); requires privacy/notice approval. No Streams, GSI, backup service, queues, new Lambda, NAT, API Gateway or SNS.
2. GlobeVoyActivityWrite inline policy attached to existing globevoy-recommendations-role-tdjd59uh: only dynamodb:PutItem and dynamodb:UpdateItem on this table ARN (the underlying permissions for the transactional writes). Existing policies preserved. Before applying, reverify whether role is shared and confirm consumers; do not expand scope silently.
3. Unattached analyst managed policy: dynamodb:Query only for this table and DAY# partitions. Attaching it to a named approved operator principal needs approval; no credentials or public read endpoint.
4. One AWS/DynamoDB WriteThrottleEvents CloudWatch alarm plus one metric filter on the existing Lambda log group and one WriteFailures custom-metric alarm, five-minute Sum >0, no actions/new notification service. Fixed search_activity/write_failed logs are reviewed in existing CloudWatch log group for permission/network/config failures as well; throttle alarm alone does not cover every dropped event. Alarm is not a spending cap.

No Lambda environment change: production already has a tight 4 KB environment limit. The stack outputs the exact nonsecret build configuration; package-launch-first-backend.ps1 accepts -ActivityConfigPath and validates it before copying services/analytics/activity-build.json into the ZIP only. Without that file logging is disabled. Example config in ops/analytics is intentionally disabled/privacyApproved false. Do not add generated config to source. This is an explicit build-time substitute for environment activation, not a runtime feature-flag mutation.

## Costs requiring approval
Assuming event/counter each <=1 KB, each search consumes six transactional write units (three items, two units each). At the published illustrative Standard on-demand US East rate $0.625/million WRUs, 10,000 events cost about $0.0375 in writes; 1,000,000 cost $3.75. Confirm Ohio regional rates on approval. Storage, count queries, existing log ingestion and added Lambda duration are extra; two standard alarms total approximately $0.20/month plus approximately $0.30/month for the custom failure metric before free allowances. Budget conservatively $1/month at 10k events and $5–10/month at 1m, dependent on response sizes, logs and added duration, not a cap. No charges incurred by provisioning in this task because none was applied.
Sources: https://aws.amazon.com/dynamodb/pricing/ ; https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html ; https://aws.amazon.com/cloudwatch/pricing/ .

## Release / rollback after approval
1. Reverify main merge/CI, AWS account/region, shared role consumers, environment byte size, existing handler/config, current deployment hash and rollback package; review CloudFormation change set without executing it. Privacy approval must explicitly accept retention and notice. No current-source merge is authorized by implementation alone.
2. Apply only approved stack/table/policy/alarm. Verify ACTIVE table, key schema, TTL, exact policies and monitoring. Reader attachment only to approved principal. No existing production resource replacement.
3. Save stack output as an ignored local nonsecret config; package clean merged source with existing -EnableProductionAccounts and -ActivityConfigPath. Verify SDK, src/lambda.handler, config, hash and default-off rollback artifact. Separate production approval covers exact artifact hash and one code-only rollback. No frontend change is required.
4. Code-only update to existing Lambda, with current revision guard; preserve full environment/handler/runtime. Guest/account/CORS/security acceptance first. Failures trigger approved previous code ZIP rollback; no configuration edits.
5. REAL acceptance (pending): use isolated browser context on globevoy.com, intercept/block every search-capable API call except exactly one selected primary search. For the selected request, forward it unchanged to production (never fulfill with fixtures), capture X-GV-Activity-Id from the Playwright network response headers, require genuine non-empty trip results. Other registry/static/auth calls may continue. Real travel provider search allowance is a separate approval: inspect the selected route's gates/request ceiling before allowing it. If provider calls are not approved, do not fake or run this step.
6. Query the day's EVENT# row using python ops/analytics/daily-counts.py --day YYYY-MM-DD --event-id <X-GV-Activity-Id>. Playwright reads the raw response header without changing CORS; ordinary frontend JavaScript need not access it. Confirm precisely one matching event and schema-only fields, counter +1 in a quiet controlled test window, replay ID under offline tests. Unrelated public traffic can increase other counters; never claim total table delta equals one during concurrent traffic. Review logs for write failure. Preserve sanitized acceptance evidence; never retain raw requests, tokens or customer events beyond the approved schema.
7. If genuine event cannot be correlated or stored, stop: feature is not accepted. Do not claim production completion from mocks. If critical searches fail, code rollback immediately. For telemetry-only failure, preserve searches and report partial acceptance; disable through a separately approved default-off code artifact if necessary.
8. Vamsi demo after real acceptance: perform one guest search, show its genuine results and exact sanitized event, run python ops/analytics/daily-counts.py --day YYYY-MM-DD. Explain that the event is a coarse counter of a backend request, not a customer profile.

Rollback stops new collection by restoring verified prior code without activity config. Keep table/data under approved retention; do not delete or loosen deletion protection automatically. Detach only the new policy/remove alarm on separately approved infrastructure rollback. Retain preserves privacy-governed data rather than destroying it on stack deletion.

## Tests and current completion boundary
Focused sanitizer/route/default-off/timeout/failure/idempotency/IaC tests plus existing backend/account/frontend/release groups are required. SDK and real DynamoDB integration, IAM transactional permissions,  CloudFormation application and real guest event verification remain deployment-stage gates, not claimed offline passes. No real DynamoDB acceptance yet. This PR is for review; production approval remains outstanding.


## PR 135 review clarification
Counts measure backend search actions, NOT unique users, sessions, human visits or confirmed bookings. A single person can generate several initial requests, calendar lookups and adjustments; bots also count. Auxiliary categories must not be summed as unique initial searches. No durable identifier links events to a person.

Price classification now inspects returned products and actual legs/backendLegs plus stops/stays. Every component contributes a category: missing flight evidence and estimated hotels prevent an all-live label. Discovery diagnostics are not authoritative. Tests exercise maintained route-planner/buildVisualizerTour outputs and the actual public generated-tour handler offline, not only hand-written stays fixtures.

Exact retention: expiresAt = midnight UTC of utcDate + retentionDays*86400. For November 16, 2026, expiry is December 16, 2026 at 00:00 UTC for ALL events that day. This is approximately 29–30 elapsed days, not a per-event rolling 720-hour guarantee; actual physical deletion is eventual. Operator queries filter expiresAt > current epoch time, even while expired rows remain physically present. See https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html .

Privacy publication is a launch gate: docs/SEARCH_ACTIVITY_PRIVACY_REVIEW.md identifies the existing public draft and provides proposed disclosure for owner/legal review. The HTML and production site have not been changed.

Billing alert proposal: ops/analytics/billing-alert-stack.json prepares a separate US$10/month AWS Budgets COST budget with email notifications above 80% actual and 100% forecast. It covers all account DynamoDB, Lambda and CloudWatch service costs, including existing applications, not only incremental analytics costs. It is an alert, not an enforcement cap; data/notifications are delayed. Recipient approval is required; no budget, email subscription or notification was created. The main activity change set excludes this separate, unapproved billing stack. No SNS topic or budget action is introduced. Analytics-only attribution of shared Lambda cost is not available without a separately reviewed allocation method.


### Exact unexecuted change set
Stack: globevoy-search-activity (review metadata only, REVIEW_IN_PROGRESS).
Change set: pr135-review-20261116T075315Z, CREATE_COMPLETE / AVAILABLE; NOT executed.
Parameters: LambdaRoleName=globevoy-recommendations-role-tdjd59uh; RetentionDays=30; PrivacyRetentionApproved=true is the proposed preview configuration only, not authority to enable collection or a legal approval.
Adds exactly ActivityTable, WriterPolicy, ReaderPolicy, ThrottleAlarm, WriteFailureFilter, WriteFailureAlarm. No Lambda, Saved Trips table, Cognito or hosting resource appears in this change set. Billing budget is a separate prepared template, excluded until recipient and scope approval. Change-set preparation created only CloudFormation metadata, not workload resources.
Inspect with: aws cloudformation describe-change-set --stack-name globevoy-search-activity --change-set-name pr135-review-20261116T075315Z --region us-east-2 . Do not execute it before explicit approval. Any template/parameter edit requires a fresh reviewed change set.

Ohio pricing checked against https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/us-east-2/index.json : Standard on-demand WRU $0.625/million, RRU $0.125/million, storage $0.25/GB-month beyond applicable free allowance. Three transactional <=1KB items consume six WRUs per action: 10k actions ~$0.0375; 1m ~$3.75 in writes. Monitoring, Lambda duration, logs and storage are additional; previous illustrative ~$1/month at 10k or $5–10 at 1m remains a budget estimate, not a cap. Do not attribute all service-budget alerts to analytics; the budget includes other applications' existing usage.


## Vamsi requirements: hourly reporting (no production activation)
Each event now has utcHour, an integer 0–23 derived from the same UTC clock value as utcDate. No minute, second or exact search timestamp is added. The SAME DynamoDB transaction inserts the conditional EVENT# row, increments COUNT#category#outcome and increments HOUR#HH#category#outcome. All three share the original UTC-day expiry. A duplicate event cancels both counter increments. IAM/table schema and the prepared change set are unchanged; no index, table or service added.

Default daily and hourly reporting now uses --scope primary. This intentional operator-output change excludes auxiliary lookups by default; the JSON envelope states unit=backend_actions and scope explicitly. --scope auxiliary or --scope all opts into other categories. --category can select an endpoint category within the chosen scope. Hourly output includes all 24 UTC hours, including zeros. The query reads HOUR# counters only (not raw events), filters expiry server-side and client-side, and refuses incomplete pagination rather than presenting partial results.

| Endpoint category | Interpretation | Scope |
|---|---|---|
| recommendations | Initial recommendation search | primary |
| generated_tour | Initial generated itinerary search | primary |
| multi_city | Explicit multi-city search endpoint | primary |
| mixed_results | Initial combined single/multi-city results search | primary |
| fare_calendar, flex_windows, one_way_lookup | Supporting fare/date lookup | auxiliary |
| date_adjustment, route_adjustment | Changes to an existing generated plan | auxiliary |

These are backend-action categories, not mutually exclusive human intents. A generated itinerary can itself be multi-city: do not interpret only the multi_city endpoint counter as all multi-city demand. Result outcomes are results, empty, unavailable, rejected and error; HTTP and application-level failures are distinguished from empty results. resultCountBand and conservative priceEvidence describe the returned response at completion. All existing invalid/partial/estimated-hotel guards remain.

Unavailable insight: no exact origin, destination, route, travel date, budget, raw preference, unique visitor/session, click conversion or confirmed booking. No hour-to-person linking exists. If Mehdi/Vamsi need destination insight, propose an additional reviewed destination-continent category and itinerary stop-count band with small-cell suppression in reporting. Do not collect these until their business purpose, privacy disclosure and suppression threshold are approved. Current code does not store them.

Cost change: one additional transactional <=1KB counter adds TWO WRUs per action: six instead of four, a 50% write-unit increase. At Ohio $0.625/million WRUs, extra cost is ~$0.0125/10k actions or $1.25/million; totals are ~$0.0375/10k or $3.75/million in writes. Hourly counter storage and Query reads add small traffic-dependent costs; shared counters may contend under high traffic and remain best effort under the 200ms network budget. Earlier $1/month small-beta or $5–10/million estimates remain illustrative, not caps. Mehdi (AWS billing owner) or explicitly authorized delegate must approve final infrastructure, privacy and costs. No budget or alert recipient was selected/created in this hourly task.

Commands:
```powershell
python ops/analytics/daily-counts.py --day 2026-11-16
python ops/analytics/daily-counts.py --day 2026-11-16 --hourly
python ops/analytics/daily-counts.py --day 2026-11-16 --hourly --category multi_city
python ops/analytics/daily-counts.py --day 2026-11-16 --hourly --scope auxiliary
```

Illustrative daily output (NOT production evidence):
```json
{"utcDate":"2026-11-16","scope":"primary","unit":"backend_actions","counts":[{"category":"generated_tour","outcome":"results","count":6},{"category":"generated_tour","outcome":"empty","count":1},{"category":"multi_city","outcome":"results","count":3},{"category":"recommendations","outcome":"results","count":2}]}
```
Illustrative hourly output uses the same envelope plus hours: [{utcHour:0,count:0}, ...]. For the above 12 actions, an example has hour 7 = 2, hour 14 = 7 and hour 23 = 3; all other hours zero. The tool returns every hour, not the abbreviated example. Peaks describe backend completion hours in UTC, not unique people, location or local customer time.

Authorized release sequence remains: Mehdi/delegate privacy/infrastructure/cost sign-off and approved public notice -> PR review/merge and clean-main CI -> reverify the exact prepared change set/template hash/role consumers/retention, execute only after approval -> verify table, TTL, policies and monitoring -> build and verify the nonsecret opt-in backend artifact from merged source -> approve exact hash and code-only rollback -> existing Lambda code-only deployment with revision/configuration guards -> one separately authorized genuine guest search, correlated event and BOTH daily/hourly counter verification -> guest/account/security smoke and synthetic cleanup. Billing budget/recipient remains Mehdi's separate approval; no budget creation is part of this task. If searches regress, restore the approved prior code ZIP; retain table under the approved policy. Do not execute the prepared change set, alter IAM or enable analytics merely to demonstrate this PR.

Illustrative sanitized event (NOT collected production data):
```json
{
  "schemaVersion": 1,
  "eventId": "b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4",
  "utcDate": "2026-11-16",
  "utcHour": 14,
  "category": "generated_tour",
  "outcome": "results",
  "resultCountBand": "1-5",
  "durationBand": "1_3s",
  "priceEvidence": "mixed",
  "expiresAt": 1797379200
}
```

## Schema v2: detail and recommendation feedback (GV-ANALYTICS-9A)

For the Nov 23 requirements from Mehdi and Vamsi: budgets, top origins, results shown, clicks on results, and rejected trips as feedback. **Off by default.** Needs `schemaVersion: 2`, `detail: true` and `detailApproved: true` in the build-time `activity-build.json`, on top of the v1 approvals. v1 configs behave exactly as before.

**Trip search events (`generated_tour` only) add:**

| Field | Values | Not stored |
|---|---|---|
| `budgetBand` | under_1000, 1000_1999, 2000_3999, 4000_6999, 7000_plus (CAD-equivalent) | the exact budget |
| `originCode` | IATA code from the origin, e.g. YYZ | city text, user location |
| `travellersBand` | 1, 2, 3_plus | |
| `tripsShown`, `citiesShown` (≤9 city IDs), `roles`, `bestUseBand` | what the page showed | prices, dates |
| `poolSize`, `liveChecks`, `failedChecks` | live-check effort and failures | provider data |
| `searchRef` | SHA-256 of a random token the results page creates for one page view | the token itself, any cookie or ID |

The same transaction adds daily counters `BUDGET#<band>` and `ORIGIN#<code>` (5 items instead of 3, about 10 write units per search).

**Feedback events (`POST /api/trip-feedback`)** come from the results page: `view` (opened a trip), `book_click`, `save`, and `show_other` ("Show other trips": an implicit "not these" for every trip shown).
- **Stored:** action, role, rank, page, ≤4 city IDs, and the same `searchRef`, so each click links to the trips shown.
- **Rows:** `FEEDBACK#<id>`, plus counters `COUNT#feedback#<action>` and `FEEDBACK#<action>#<role>`, with the same retention.
- **Always answers 204 and never blocks the page:** the beacon uses a plain-text body, so there's no preflight.
- **No user, session, IP, headers, budget or dates.**

**Not covered here** (needs Vamsi's analytics tool choice): visits, returning users and country. Those need an analytics tool (Clarity, Google Analytics, CloudWatch RUM or Pinpoint) or a persistent anonymous ID, which would need a privacy-notice change.

**Report:** `node ops/analytics/daily-report.mjs --day YYYY-MM-DD` (read-only Query of one day, analyst policy). It prints:
- searches by outcome, budgets and top origins;
- trips shown per search and live-check failure rate;
- top cities shown;
- feedback by action and role, and how many searches got a click or "show other trips".

**Activation (needs approval):**
1. Execute the prepared change set (table, writer and reader policies, alarms). v2 uses the same table and permissions, so the change set is unchanged.
2. Approve the privacy notice for v1 plus the v2 fields above.
3. Package the backend with `activity-build.json` = `{schemaVersion:2, enabled:true, privacyApproved:true, detail:true, detailApproved:true, table:'globevoy-production-activity-events', retentionDays:30}`.
4. Build the frontend from this branch, so the page reference and beacons are included.

## Analytics v1: Users + Searches tables (GV-ANALYTICS-V1)

Supersedes the 9A single-table writer when on. Schema and privacy decisions: the "GlobeVoy Analytics Schema v1 (Users + Searches)" doc (approved by Vamsi and Mehdi, Nov 27, 2026).

- **Switch:** Lambda setting `GV_ANALYTICS=on` (off when absent). No rebuild needed to turn it on or off.
- **Code:** `backend/services/analytics/analytics-v1.js`. It wraps `/api/generated-tour` (one Searches update per call) and handles `POST /api/trip-feedback` and `POST /api/analytics/identify`. Writes are best-effort with a 400 ms timeout and never change a response.
- **IDs:** `searchId` = `s_` + hash of the page's random `sid`. Guests are `g_` + a hash of a random local-storage ID. Signed-in users are `u_` + HMAC(Cognito sub, key from Secrets Manager `globevoy/analytics-hash-key`), set only after the backend verifies the access token.
- **Setup:** `ops/analytics/setup-v1-tables.sh` creates both tables (on-demand, deletion protection, TTL on Searches `expiresAt`, 13 months), the secret and the `GlobeVoyAnalyticsV1` write policy on the Lambda role.
- **Not yet:** the full candidate pool (shown trips only, propensity 1), exploration, and deleting the Users row on account deletion.
