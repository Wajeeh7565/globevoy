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
- **Decided by real data (see Task 5 results):** the planner should use the complete-stay level. On real Barcelona calendars, per-night numbers understate complete stays and only about half the hotels can take a whole stay.

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

## Task 5 results: first production test (Nov 25, 2026)

Barcelona, 2026-11-25 to 2027-05-26. Run locally by Wajeeh.

- **Cost:** 2 requests = **US$0.04** (no retry needed). Shared counter `PI#budget/2026-11`: 0 → 2. Nothing stored.
- **Sample:** 1,000 hotels in the free sandbox list → 50 hotels: 8 affordable, 18 mid, 17 upper-mid, 7 high.

| | Result |
|---|---|
| `prices/hotels` | 50/50 hotels answered, 6,615 daily prices over 183 days (72% of hotel-days priced), every day has ≥5 hotels, 1.4 s |
| `prices/city` | 183 days, 1.8 s |
| Median USD/night by band | affordable 121 · mid 170 · upper-mid 195 · high 364; sample median 189 |
| City average vs sample median | 250 vs 189 (×1.32): the city endpoint averages in expensive hotels |
| Hotels with every night of a stay priced | 3 nights 54% · 5 nights 50% · 7 nights 48% |
| Per-night p25 vs complete-stay p25 | −3.2% / −4.4% / −5.0% at the median (3/5/7 nights); under by 5%+ in 29% / 44% / 49% of check-ins |

**What it means:**

- **Hotel prices are far above today's planning model.** Today's model plans southern Europe at US$84/night × 1.3 = **US$109**. Even the affordable band's median is US$121, and the sample median is US$189. This matches the live finding that hotel guesses are 30–60% too low.
- **Per-night city numbers do lose information about complete stays.** Real calendars have many more gaps than the synthetic data (54% vs 90% complete for 3 nights), and per-night p25 understates a bookable one-hotel stay by 3–5%. Summary v2's complete-stay levels and `stayCoverage` are needed. Per-hotel calendars are still not: the summary keeps the stay-level answer.
- **Use the hotel sample, not the city endpoint, for the level.** The city average is pulled up by expensive hotels. It can still give the date shape for cities without a sample.
- **Price basis:** see the basis check below.

### Price-basis check (Nov 25, 2026; 1 request, US$0.02; counter 2 → 3)

Compared 10 sampled Barcelona hotels (3 affordable, 3 mid, 2 upper-mid, 2 high) with Nuitée live rates on 4 stays (Dec 15, Jan 8 and Mar 10 for 1 night; Jan 25 for 3 nights) at 1 and 2 adults. 34 hotel-stays had both an index price and a live room.

| Index ÷ live cheapest room, per night | Median | Middle half | Within 15% |
|---|---|---|---|
| 1 adult, taxes included | 1.26 | 1.18–1.42 | 15% |
| 1 adult, before taxes | 1.38 | 1.29–1.56 | 3% |
| **1 adult, plus fees paid at the hotel** | **1.16** | 1.10–1.31 | 47% |
| 2 adults, taxes included | 1.26 | 1.15–1.41 | 24% |
| 2 adults, before taxes | 1.37 | 1.26–1.55 | 6% |

**What it means:**

- **The index is a per-room price.** 1 adult and 2 adults give the same ratio (1.26), so occupancy barely changes it.
- **It includes taxes and the fees paid at the hotel.** That basis is the closest, but still 16% above the cheapest bookable room. The index is an average across rooms and searches, not the cheapest room on the day.
- **For planning, use the index for the date shape (weekends, holidays, seasons) and take the level from the learned live ratio** (hotel price memory). The ratio is what absorbs this +16–26% gap. Using the index level directly would overestimate hotels.
- **New finding: all 34 cheapest live rooms had a fee paid at the hotel** (Barcelona's tourist tax). GlobeVoy currently drops every offer with an excluded fee (`excludedFeesPresent`). In cities with a tourist tax it therefore skips the cheapest rooms and picks pricier ones, or none. That is likely part of why live hotel prices come out 30–60% above plan and why trips fail. Fix (needs approval): keep those offers, add the at-hotel fee to the trip total, and show it as "pay at the hotel: €X". Don't drop them.

## Task 5: production test script

`ops/providers/nuitee-price-index-probe.mjs`, run locally. It sends nothing without `--run`.

- **Plan:** a free sandbox hotel list → a representative sample of 50 Barcelona hotels → `prices/hotels` (US$0.02) and `prices/city` (US$0.02). One slot is kept for a single retry.
- **Maximum:** 3 requests = **US$0.06, retries included.** Capped twice: by the script itself, and by the shared counter (capped at 3 for the run).
- **Writes to AWS:** only the counter item. Prices are printed, not stored.

## Task 6: using it in planning (GV-HOTEL-PLAN-002)

Planned hotel cost per stay = model estimate × **level** × **shape**:

- **Level:** the city's learned live/model ratio (hotel price memory) × 1.05. A city never checked live gets its **region's** learned ratios (75th percentile, ≥3 learned cities), else × 1.3. `FARE_MAP_REGION_COLD_START=off` turns the regional level off.
  - Memory learns the **all-in price of the cheap-but-good room**: taxes, plus fees paid at the hotel since GV-HOTEL-FEES-001, minus any budget-upgrade extra.
  - Entries older than 60 days are ignored. The average is rolling (window ~5).
  - Observations before GV-HOTEL-FEES-001 came from rooms without at-hotel fees. In tourist-tax cities those were pricier rooms, so those cities' learned ratios lean high until about 5 new checks replace them.
- **Shape (off):** the Price Index date pattern for the stay's own nights, clamped 0.7–1.8. It is loaded only with **both** `PRICE_INDEX_STORAGE=on` and `PRICE_INDEX_PLANNING=on`, so it stays off until Nuitée confirms storage. **Collection stays disabled** (`PRICE_INDEX_COLLECTION` off, not wired to any trigger).

**Benchmark** (truth model v2; **simulated** regional and seasonal prices, not verified live prices) — share of trips failing the live check:

| Setup | Fails |
|---|---|
| Memory only | 18% |
| + regional level | 11% |
| + date shape | 8% |

### Live validation plan (5 searches, needs approval before running)

Same inputs as the earlier production tests: 1 adult, CAD, flexible dates, pool request, signed-in (3 trips).

| Search | Earlier result (for comparison) |
|---|---|
| Toronto C$1,500 | 3 trips (86/77/78%), 5 checks, 29 s (Nov 25, after task 2) |
| Toronto C$2,500 | 3 trips (86/84/85%), 5 checks / 2 failed, 27 s (after fees fix) |
| Toronto C$4,000 | 3 trips (86/75/86%), 5 checks / 1 failed, 23 s (after fees fix) |
| Toronto C$10,000 | 3 trips (80/64/79%), 4 checks / 1 failed, 33 s (after odd-route fix) |
| London C$4,000 | 3 trips (86/53/86%), 8 checks / 4 failed, 2 rounds, 33 s (after fees fix) |

- **Compare:** failed checks ÷ checks (by reason), trips returned, response time, budget use of each trip, and API calls (live checks; Ignav and Nuitée requests from diagnostics). Also how many stays were planned with a learned or a regional level.
- **Cost:** about 20–30 live checks in total, a few cents of Ignav. No Price Index or Jinko requests.
- **Rollback:** the previous backend package (`globevoy-backend-d796465.zip`, live before task 6; `globevoy-backend-74eda83.zip` before the fees fix) is kept for re-upload. `FARE_MAP_REGION_COLD_START=off` and `NUITEE_DROP_PAY_AT_HOTEL=true` undo the two behaviours without a redeploy.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `PRICE_INDEX_COLLECTION` | off | `on` allows real (billed) collector runs |
| `PRICE_INDEX_STORAGE` | off | `on` writes summaries to DynamoDB |
| `PRICE_INDEX_PLANNING` | off | `on` (together with `PRICE_INDEX_STORAGE=on`) lets the trip search read summaries |
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
