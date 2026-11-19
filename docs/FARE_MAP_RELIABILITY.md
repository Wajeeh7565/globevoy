# Fare-map collector reliability (review only)

This continues PRs #151–153 and preserves the fare and cursor keys. Nothing has
been deployed, enabled or provisioned by this work. The production table is untouched.

## Findings and limits of the evidence

Confirmed in code: pages of 250 exceeded Travelpayouts' documented maximum of 30;
250ms per task did not pace pagination or retries against 60 requests per minute.
Failed tasks advanced the cursor, partial GraphQL results could look successful,
and unprocessed DynamoDB writes could be silently exhausted. PR #153's first-of-month
syntax and existing RUB-to-USD conversion are retained.

Sources: [page size](https://support.travelpayouts.com/hc/en-us/articles/203755406-Price-Map-API),
[rate limits](https://support.travelpayouts.com/hc/en-us/articles/4402565416594-API-rate-limits).

The precise attribution of the historical 80 failures out of 135 remains unconfirmed:
read-only AWS inspection encountered expired authentication. No provider request was
made to reconstruct the incident. Passing mocks is not a measured production SLO.

## Changes

- Minimum 1100ms between every HTTP attempt, including pages and retries. Two retries
  for network/timeouts/5xx, exponential 500/1000ms backoff, no redirects, bounded abort.
- HTTP 429 is recognized before JSON parsing (including HTML responses), stops the
  worker immediately and persists a bounded Retry-After cooldown for subsequent runs.
- Authentication, GraphQL, HTTP, invalid JSON/schema, network, timeout and DynamoDB
  failures have separate sanitized categories. No raw errors, queries or tokens logged.
- Empty arrays succeed. Incomplete pages do not complete a task. Three-page chunks
  persist fares before advancing the page offset. A failed write replays the same
  chunk; existing fare keys make this idempotent. Unprocessed writes eventually fail
  explicitly. Completed tasks are checkpointed individually.
- The existing META#job/cursor item carries a conditional PutItem lease, revision,
  owner, offset, task identity and cooldown. Consistent reads and owner-fenced writes
  prevent two new workers advancing the cursor together. Lease expiry is 120 seconds;
  staging must verify the shared Lambda still has its existing 60-second timeout.
- Task identity survives rolling-month index changes. Past-month tasks leaving the
  supported rolling window retire. No valid current task is skipped after a failure.
  Persistent unsupported/auth/schema errors block that task until an operator resolves
  the cause; do not skip them merely to improve reported success rates.
- USD/CAD/RUB use the existing configured FX rates; unsupported/invalid configuration
  fails closed. This is not a live FX quote. Logical TTL/observation filtering excludes
  expired and future records on reads. Collection time does not establish how recently
  the original cached provider search occurred; records remain planning estimates.

Offset pagination can shift when the provider dataset changes between invocations.
Subsequent cycles refresh gaps. The original one-cheapest-date-per-route/month model
is preserved; this cannot represent all daily fares or promise flight availability.

## Observability and the 99% target

One sanitized structured summary and persisted lastRun expose done, partial, empty,
requests, retries, dynamoRetries, written, coveredDestinations, failureCategories,
rateLimited, successRate, start/end cursor, cycle completion and elapsed milliseconds.
Written means acknowledged write operations, not unique lifetime rows; coverage is
distinct destinations in this invocation. A partial task is not a completion. A
per-invocation success ratio is not eventual unique-task reliability.

Target >=99% successful processing of valid supported tasks under normal provider
conditions. Measure a complete controlled staging cycle and report denominators,
unique task recovery, empty responses, throttling and persistent failures separately.
No numerical reliability claim is made from the offline tests. Traffic elsewhere
using the same provider token can still consume the account limit.

## Controlled staging instructions (separate approval required)

Use an existing approved isolated staging Lambda and fare-map table; never point a
test worker at the production cursor. If none exists, obtain owner approval for the
specific infrastructure, costs and provider request ceiling first. Check table-scoped
GetItem, PutItem, BatchWriteItem and Query permissions; conditional PutItem does not
require a new IAM action. No new indexes or changes to keys/TTL are required.

Build with the existing release packager, initially keeping both collector and
optimizer disabled. Verify offline import/account/release tests. After explicit
provider-test authorization, run a small supported origin/month sample; verify USD
records, dates, cooldown, recovery after partial writes, lease expiry and two concurrent
invocations. All overlapping old workers must drain before relying on the new lease.
Then measure a full cycle before considering production activation. Stop the controlled
experiment on authentication or persistent schema errors.

Rollback is a separately reviewed staging-only operation: stop collection, allow
in-flight work and lease expiry, restore the saved code/cursor and verify idle state.
Never remove a live lease or reset the production cursor during this experiment.
