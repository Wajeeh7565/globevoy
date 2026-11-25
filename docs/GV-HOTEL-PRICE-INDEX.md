# GV-PRICE-INDEX-001: Nuitée Hotel Price Index collector

Status: built and tested offline. **Collection and storage are off by default.** Not wired into the Lambda, the EC2 collector or the trip search.

## Why

Live tests (Nov 23–25, 2026) found hotel guesses 30–60% too low. That is the main reason trips fail their live check. The hotel price memory learns one ratio per city, but not the date shape (weekends, holidays, seasons). Nuitée's Price Index gives a per-day price calendar for US$0.02 a request.

## Rules enforced in the client (no caller can skip them)

`backend/services/providers/stays/nuitee/nuitee-price-index.js`:

1. **Budget for every production request**, manual tests included. No budget, no request (`budget-required`). Each request reserves a slot first.
2. **Rate limit:** at most 10 requests in any 60 s per process. The 11th waits; nothing is dropped.
3. **Rolling six-month horizon:** windows are clamped to today … today + 183 days. A window entirely outside it is refused (`outside-six-month-horizon`).
4. **No retries in the client:** one request per call. The collector and the probe retry **once**, only on 429/5xx/timeout, after a backoff (Nuitée's `Retry-After`, else 6 s, max 60 s). The retry pays for its own slot.
5. **Keys:** production `prod_` keys need `allowProduction: true`. The static hotel list (`data/hotels`) is called only with the free sandbox key.

## Budget: hard US$2 a month

- 100 requests per calendar month (UTC), **tests and retries included**. `PRICE_INDEX_MONTHLY_REQUEST_CAP` can only lower it.
- **Shared counter:** fare-map table item `pk=PI#budget, sk=<YYYY-MM>`, reserved with a conditional `ADD calls 1 IF calls < cap`. Parallel runs cannot overshoot, and the run stops automatically at the cap.
- **Fails closed:** if the counter can't be reached, nothing is sent.
- **Suggested use:** about 45 cities refreshed twice a month = 90 requests, plus 10 spare.

## Representative hotel sample

`hotel-sample.js` picks up to 50 hotels per city from the static hotel list, by stars (guest rating when stars are missing):

| Band | Stars | Share |
|---|---|---|
| Affordable | 1–2 | 15% |
| Mid | 3 | 35% |
| Upper-mid | 4 | 35% |
| High | 5 | 15% |

Inside each band it prefers guest rating ≥ 7, then more reviews. A thin band lends its places to the others, so the sample is always as full as the city allows. The test inputs use the same sampler.

## Design study: per-hotel calendars vs city summaries

`node tests/performance/price-index-design-study.cjs [--fixture <prices/hotels JSON>]` reports three separate things.

### A. Storage (sizes are real; prices don't matter)

| | Per-hotel calendars | City summary v2 (with complete stays) | City summary v1 (per night) |
|---|---|---|---|
| Size per city (182 days) | 34.5 KB | 3.9 KB | 2.0 KB |
| DynamoDB reads per 3-city search | 27 units | 3 units | 3 units |

### B. Complete stays at one hotel (works on real files)

A per-night city number can mix hotels night by night. On the sandbox-shaped data:

- **Price:** per-night p25 vs the p25 of complete stays at one hotel: within ±0.3% at the median for 2–7 nights. It is under by 5% or more for 0.6% of 3-night check-ins and 5.7% of 7-night ones.
- **Availability (the bigger effect):** only 90% (3 nights) → 78% (7 nights) of sampled hotels have every night of the stay priced. Per-night numbers overstate how many hotels can take the whole stay.
- **So the summary (v2) also keeps:** the p25 of complete stays for 3, 5 and 7 nights, and the share of hotels with every night (`stayCoverage`).
- **Undecided:** whether the planner should use the complete-stay level. It did not help on synthetic data (see C), and the probe's real calendars will decide (the same analysis runs on them).

### C. Synthetic planning accuracy (NOT live accuracy)

Only on the generated inputs, where "what a live check would find" is known by construction (made-up prices: cheapest good rooms across 200 hidden hotels). On that data:

- Today's flat model has a 59% median error.
- The learned ratio alone leaves 39% of stays 5% or more too low.
- Every index-based option is within about 1–3%.
- These numbers say nothing about real accuracy. With a real file this section is skipped.

### Live hotel pricing accuracy: not measured yet

This needs the Task 5 production probe (price basis: currency, taxes, occupancy) and then Task 6 (index-adjusted plans vs Nuitée live rates on real searches).

### Decision

Store city summaries only (no hotel IDs, no per-hotel prices). They are 9–17× smaller, take 9× fewer reads, and carry lower licence risk while Nuitée hasn't confirmed storage terms. They also keep what the planner needs: the date shape, plus complete-stay levels and availability. Per-hotel answers are summarised in memory and dropped.

## Task 5: production test (prepared, not run)

`ops/providers/nuitee-price-index-probe.mjs`, run locally. It sends nothing without `--run`.

- **Plan:** a free sandbox hotel list → a representative sample of 50 Barcelona hotels → `prices/hotels` (US$0.02) and `prices/city` (US$0.02). One slot is kept for a single retry.
- **Maximum:** 3 requests = **US$0.06, retries included.** Capped twice: by the script itself, and by the shared counter (capped at 3 for the run).
- **Writes to AWS:** only the counter item. Prices are printed, not stored.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `PRICE_INDEX_COLLECTION` | off | `on` allows real (billed) collector runs |
| `PRICE_INDEX_STORAGE` | off | `on` writes summaries to DynamoDB |
| `PRICE_INDEX_RETENTION_DAYS` | 35 | 1–365; DynamoDB deletes through the existing `ttl` attribute, and expired items are ignored on read |
| `PRICE_INDEX_MONTHLY_REQUEST_CAP` | 100 | Can only be lowered |

## Files

- `backend/services/providers/stays/nuitee/nuitee-price-index.js`: client, one request per call, no retries.
- `backend/services/domain/pricing/hotel-price-index/budget.js`: monthly cap and shared counter.
- `backend/services/domain/pricing/hotel-price-index/summary.js`: city summaries and `seasonality()`.
- `backend/services/domain/pricing/hotel-price-index/store.js`: optional storage with retention.
- `backend/services/domain/pricing/hotel-price-index/collector.js`: `run()`; fixture mode runs through the real client.
- `backend/services/domain/pricing/hotel-price-index/hotel-sample.js`: representative 50-hotel sample.
- `backend/services/domain/pricing/hotel-price-index/analysis.js`: complete-stay analysis.
- `ops/providers/nuitee-price-index-probe.mjs`: the Task 5 production test.
- `tests/backend/hotel-price-index.test.cjs`, `tests/backend/fixtures/price-index-fixture.cjs` (set `PRICE_INDEX_FIXTURE` to use a real sandbox file).

## Not done (needs approval)

1. Task 5: run the prepared production probe (US$0.06 max).
2. Wiring a trigger (Lambda job or EC2) and IAM.
3. Turning storage on (Nuitée storage terms first).
4. Task 6: using `seasonality()` in the planner, validated by the benchmark.
