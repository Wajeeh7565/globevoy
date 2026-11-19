# GV-FAREMAP — nightly fare map (step 1: data collection)

Status: on `main`, **off by default**. Collects planning fares only; the route search does not read it yet (step 2).

## What it stores
DynamoDB table `FARE_MAP_TABLE` (partition key `pk` String, sort key `sk` String, TTL attribute `ttl`):
- `pk = F#<ORIGIN>#<YYYY-MM>`, `sk = <DEST>` → cheapest one-way fare that month: `priceUsd`, `departureDate`, `stops`, `durationMinutes`, `source = travelpayouts-cached`, `observedAt`. Rows expire after 14 days.
- `pk = META#job`, `sk = cursor` → where the rolling job is up to.

All destinations from one origin in one month = one Query (what the route search will use to expand a stop).

## Where the data comes from
Travelpayouts Data API (GraphQL `prices_one_way`, grouped by direction): cached Aviasales search results, free with the existing `TRAVELPAYOUTS_TOKEN`. Planning prices, not quotes — final trips are still live-checked (Ignav / Nuitee).

## How it runs
`backend/services/domain/fare-map/fare-map-job.js`, called from the existing Lambda when it receives a scheduled event `{"globevoyJob":"fare-map"}` (never an HTTP route).
- Tasks: every origin-eligible city's Travelpayouts code (972) × next 6 months = 5,832 requests per cycle.
- Each run works ~45 s (`FARE_MAP_TIME_BUDGET_MS`), saves its cursor, the next run continues. Every 5 minutes → a full cycle in ~12 h.
- Stops early on HTTP 429 and resumes next run.

## Enable (AWS)
1. Create DynamoDB table `globevoy-fare-map` (us-east-2), keys `pk` (S) / `sk` (S), on-demand capacity, TTL on `ttl`.
2. Lambda role: `dynamodb:BatchWriteItem`, `PutItem`, `GetItem`, `Query` on that table.
3. Lambda env: `FARE_MAP_TABLE=globevoy-fare-map`, `ENABLE_FARE_MAP_JOB=true`.
4. Schedule every 5 minutes: either an EventBridge rule named `globevoy-fare-map…` (Lambda → Add trigger → EventBridge, `rate(5 minutes)`), or EventBridge Scheduler with input `{"globevoyJob":"fare-map"}`.

Cost: a few dollars/month (on-demand writes of ~100k rows/cycle, small storage).

## Next
Step 2: route search reads this map (stop-by-stop beam search over all cities), then live-checks the top routes.
