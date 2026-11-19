# GV-FAREMAP — nightly fare map (step 1: data collection)

Source default: **off**. Existing deployed settings have not been changed. Collects planning fares only; the separate opt-in optimizer PR adds the read path. See FARE_MAP_RELIABILITY.md for the reliability follow-up and controlled staging gate.

## What it stores
DynamoDB table `FARE_MAP_TABLE` (partition key `pk` String, sort key `sk` String, TTL attribute `ttl`):
- `pk = F#<ORIGIN>#<YYYY-MM>`, `sk = <DEST>` → cheapest one-way fare that month: `priceUsd`, `departureDate`, `stops`, `durationMinutes`, `source = travelpayouts-cached`, `observedAt`. Rows expire after 14 days.
- `pk = META#job`, `sk = cursor` → where the rolling job is up to.

All destinations from one origin in one month = one Query (what the route search will use to expand a stop).

## Where the data comes from
Travelpayouts Data API (GraphQL `prices_one_way`, grouped by direction): cached Aviasales search results, free with the existing `TRAVELPAYOUTS_TOKEN`. Planning prices, not quotes — final trips are still live-checked (Ignav / Nuitee).

## How it runs
`backend/services/domain/fare-map/fare-map-job.js`, called from the existing Lambda when it receives a scheduled event `{"globevoyJob":"fare-map"}` (never an HTTP route).
- Tasks: every origin-eligible city's Travelpayouts code × next 6 months. The original 972-origin example gives 5,832 tasks, NOT requests: pagination and retries add HTTP attempts.
- Each run works within a 45 s budget (`FARE_MAP_TIME_BUDGET_MS`) and checkpoints its task/page offset. Cycle time depends on actual page counts, provider throttling and database latency; the old 12-hour estimate was not measured. Measure a controlled staging cycle before relying on freshness/coverage targets.
- Stops on HTTP 429 and persists cooldown before resuming. Failed tasks remain retryable; overlapping new workers use an owner-fenced cursor lease.

## Enable (AWS)
1. Create DynamoDB table `globevoy-fare-map` (us-east-2), keys `pk` (S) / `sk` (S), on-demand capacity, TTL on `ttl`.
2. Lambda role: `dynamodb:BatchWriteItem`, `PutItem`, `GetItem`, `Query` on that table.
3. Lambda env: `FARE_MAP_TABLE=globevoy-fare-map`, `ENABLE_FARE_MAP_JOB=true`.
4. Schedule every 5 minutes: either an EventBridge rule named `globevoy-fare-map…` (Lambda → Add trigger → EventBridge, `rate(5 minutes)`), or EventBridge Scheduler with input `{"globevoyJob":"fare-map"}`.

Cost: a few dollars/month (on-demand writes of ~100k rows/cycle, small storage).

## Next
Step 2: route search reads this map (stop-by-stop beam search over all cities), then live-checks the top routes.
