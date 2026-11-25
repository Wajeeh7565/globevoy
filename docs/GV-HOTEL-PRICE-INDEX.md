# GV-PRICE-INDEX-001: Nuitée Hotel Price Index collector

Status: built and tested offline. **Collection and storage are off by default.** Not wired into the Lambda, the EC2 collector or the trip search.

## Why

Live tests (Nov 23–25, 2026) found hotel guesses 30–60% too low. That is the main reason trips fail their live check. The hotel price memory learns one ratio per city, but not the date shape (weekends, holidays, seasons). Nuitée's Price Index gives a per-day price calendar for US$0.02 a request.

## Design decision: city summaries, not per-hotel calendars

Study: `node tests/performance/price-index-design-study.cjs` (offline). It runs on sandbox-sized test inputs: 50 hotels, 182 days, 8,789 prices, 96.58% coverage. The prices are synthetic because the raw sandbox file was not kept.

| | Per-hotel calendars | City summary |
|---|---|---|
| Size per city (182 days) | 34 KB | 1.9 KB |
| DynamoDB reads per search (3 cities) | 27 units | 3 units |
| 100 cities | 3.3 MB | 0.19 MB |
| Requests per city per refresh | 1 | 1 (same request) |
| Planning accuracy (median error vs live, with the learned ratio) | 2.1% | 0.7–1.7% |
| Licence risk | Higher: a per-hotel price database; Nuitée has not confirmed storage terms | Lower: aggregated city numbers only, no hotel IDs |

- The planner works at city + date level. Per-hotel calendars add nothing it can use, because the live check prices the actual hotel anyway.
- Accuracy numbers come from synthetic prices and are too good. Only the comparison holds: summaries are as good as calendars for planning. Today's flat model is far off, with a 44% median error. The learned ratio alone leaves 38% of stays too low by 5% or more.
- **Decision:** keep only a city summary per day: p25, p50 and the hotel count from `prices/hotels`, or the average from `prices/city`. Per-hotel answers are summarised in memory and dropped. The planner would use `seasonality()` (that day's level / the period's median) on top of the learned city ratio.
- **Source per city:** `prices/city` needs no hotel IDs and averages up to 1,000 hotels. `prices/hotels` reflects the ≤50 hotels GlobeVoy actually books, which is better when we know them. Both cost one request per city.

## Budget: hard US$2 a month

- 100 requests per calendar month (UTC), **tests and retries included**. `PRICE_INDEX_MONTHLY_REQUEST_CAP` can only lower it, for example to 3 for the first probe.
- **Shared counter:** fare-map table item `pk=PI#budget, sk=<YYYY-MM>`. Each request reserves a slot first with a conditional `ADD calls 1 IF calls < cap`, so parallel runs cannot overshoot. The run stops automatically at the cap.
- **Fails closed:** if the counter can't be reached, no request is sent.
- **Retries:** at most one, only for 429, 5xx or timeout, and the retry reserves its own slot. A 400 is not retried.
- **Suggested use:** about 45 cities refreshed twice a month = 90 requests, plus 10 spare.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `PRICE_INDEX_COLLECTION` | off | `on` allows real (billed) requests |
| `PRICE_INDEX_STORAGE` | off | `on` writes summaries to DynamoDB |
| `PRICE_INDEX_RETENTION_DAYS` | 35 | 1–365; DynamoDB deletes through the existing `ttl` attribute, and expired items are ignored on read |
| `PRICE_INDEX_MONTHLY_REQUEST_CAP` | 100 | Can only be lowered |

Production Nuitée keys (`prod_`) are refused unless the caller passes `allowProduction: true`.

## Files

- `backend/services/providers/stays/nuitee/nuitee-price-index.js`: client, one request per call, no retries.
- `backend/services/domain/pricing/hotel-price-index/budget.js`: monthly cap and shared counter.
- `backend/services/domain/pricing/hotel-price-index/summary.js`: city summaries and `seasonality()`.
- `backend/services/domain/pricing/hotel-price-index/store.js`: optional storage with retention.
- `backend/services/domain/pricing/hotel-price-index/collector.js`: `run()`; fixture mode for tests.
- `tests/backend/hotel-price-index.test.cjs`, `tests/backend/fixtures/price-index-fixture.cjs` (set `PRICE_INDEX_FIXTURE` to use a real sandbox file).

## Not done (needs approval)

1. Task 5: the US$0.02 production probe (`PRICE_INDEX_MONTHLY_REQUEST_CAP=3`), to learn the real currency, tax and occupancy basis.
2. Wiring a trigger (Lambda job or EC2) and IAM.
3. Turning storage on (Nuitée storage terms first).
4. Task 6: using `seasonality()` in the planner, validated by the benchmark.
