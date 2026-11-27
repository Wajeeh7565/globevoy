# Release candidate 2: data-expansion

This is pull request #203 on the `data-expansion` branch. Nothing is deployed to the website yet.

Every new behaviour is behind a Lambda setting that is off by default. Merging and deploying the code with no settings changed leaves globevoy.com behaving as it does today.

## Flight-date collection (running in AWS)

**What changed on the collector machine `globevoy-fare-map-collector`** (i-0d13709c171561f0a, t3.micro):
- `globevoy-fare-map.service` now runs the main pass, then the date pass. The previous unit file is kept as `globevoy-fare-map.service.bak-20261127`.
- `FARE_MAP_DATE_PASS=on` was added to `/etc/globevoy/fare-map.env`.
- The date-pass code runs from a checkout of this branch at `/opt/globevoy-rc` until the branch is merged. After merging, `git pull` in `/opt/globevoy` and remove `/opt/globevoy-rc`. The service falls back to `/opt/globevoy` on its own.

**What stayed the same:**
- The every-two-days schedule.
- The main-pass code in `/opt/globevoy`.
- The `F#` fare rows.
- The automatic power-off at the end of each run.

**First run:** started 2026-11-27 at 11:27 UTC as a separate background job (`globevoy-date-pass-first`). A second job (`globevoy-date-pass-poweroff`) switches the machine off when the date pass ends, whether it finishes or fails.

**First minutes of the run:**
- 25 of 972 origins done.
- 2,702 requests sent.
- 1,584 route-months stored.
- No errors.

**Dry run on YTO and LHE (6 requests):**
- 161 dates collected, about 27 per route-month.
- Stops known on 100% of dates.
- Flight duration known on 39% of dates.

**Expected for a full run:** about 147,000 requests and about 10 hours.

**Monthly cost (estimate):**

| Item | Cost |
|---|---|
| Travelpayouts month-matrix | Free |
| EC2, extra hours (about 10 h per run, 15 runs a month, t3.micro at US$0.0104/h) | about US$1.60 |
| DynamoDB writes (at most 147,000 items per run, one write each) | about US$1.40 |
| DynamoDB storage | under US$0.10 |
| **Total** | **about US$3 a month** |

## Ready to switch on after deploying

| Setting | What it does |
|---|---|
| `FARE_MAP_ROUTE_DATES=on` | Real return dates, stops and duration from the date pass. Needs a finished date pass. |
| `FARE_MAP_EXPERIENCE=on` | The joint ranking: destinations, countries, hotels, flights, stay and cost. |
| `FARE_MAP_DYNAMIC_DESTINATIONS=on` | Destinations found in the fare map, kept only if they have enough good hotels. |
| `FARE_MAP_COMFORT_MODE=adaptive` | Hotel upgrades, limited by how many good hotels each city has. |
| `FARE_MAP_EXPERIENCE_LONG_STAYS=on` | Longer stays for large budgets. |
| `FARE_MAP_REFRESH_ROTATION=on` | "Show other trips" avoids cities already shown. |
| `FARE_MAP_MAX_AGE_DAYS=7`, `FARE_MAP_HUGE_MAX_CITIES=4`, `FARE_MAP_BIG_STAY_EXTRA=8` | Search space for large budgets. |

## Blocked by provider permissions

| Item | Blocked until |
|---|---|
| `PRICE_INDEX_STORAGE=on` and `PRICE_INDEX_PLANNING=on` (Nuitée city price levels stored in DynamoDB and used for planning) | Nuitée confirms in writing that aggregated city summaries may be stored and reused. The 467-city import is prepared: `ops/providers/nuitee-price-index-refresh.mjs --from-pilot <both files>`. |
| Monthly Nuitée refresh (at most 500 requests, about US$10) | The same Nuitée confirmation, plus your approval of the recurring cost. |
| `backend/data/agoda-city-accommodation-summary.json` (hotel counts per city, used for the good-hotel check) | Confirmation that the Agoda affiliate feed terms allow storing derived counts. Without this file, discovered destinations and hotel upgrades fall back to neutral values. |

Without the Price Index settings, planning uses the existing hotel memory. The benchmark below already uses the stored-summary path, so expect somewhat lower budget use until those settings can be switched on.

## Rollout, one stage at a time

**0. Snapshot.** Save the production Lambda's current code and configuration:
- `aws lambda get-function-configuration --function-name globevoy-recommendations > rollback-config.json`
- `aws lambda publish-version --function-name globevoy-recommendations --description "before data-expansion"`
- Record the version number.

**1. Deploy the code with every new setting off.** Check globevoy.com: a search, live prices, booking links, sign-in and saved trips.

**2. Turn on `FARE_MAP_ROUTE_DATES=on`.** Compare real-date legs and latency over a few searches.

**3. Turn on the experience settings** listed above, all together.

**4. Later, once Nuitée allows it:** the Price Index settings, after the import.

**Rolling back:**
- A single stage: remove its settings (`aws lambda update-function-configuration`). This takes effect immediately and changes no code.
- Everything: point the function back to the saved version's code and restore `rollback-config.json`.
- Collector: `FARE_MAP_DATE_PASS=off`, or restore the `.bak` unit file.
