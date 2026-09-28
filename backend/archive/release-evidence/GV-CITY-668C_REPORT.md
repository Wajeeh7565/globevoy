# GV-CITY-668C — Live Provider Coverage Verification and Production Activation

**Baseline:** `lambda-gv-city-668b-provider-mapping-completion-audit.zip`  
**Scope:** backend only  
**Status:** implementation complete; production provider audit still requires execution with the deployed Travelpayouts and Agoda credentials.

## Why this task exists

GV-CITY-668B documented static Travelpayouts and Agoda strategies for the 1,000-city registry. Static mapping alone does not prove that a provider currently returns fares, qualified hotel rates, or a usable partner result. GV-CITY-668C adds a bounded, authenticated live-verification workflow and a conservative production-activation policy.

## Important truth about the packaged result

The package does **not** claim that any city has already passed a production live-provider audit. No production provider credentials were available in the packaging environment.

The packaged snapshot therefore starts with:

- 1,000 registry cities
- 1,000 pending live verification
- 0 production-active cities
- 0 falsely claimed live fares or live hotel rates

Actual counts are generated only after the verifier is run in a trusted environment with real provider credentials.

## Added capabilities

### 1. Live coverage service

Added `services/provider-live-coverage.js`.

For each selected city it:

- resolves the accepted Travelpayouts city/airport/gateway code from 668B;
- samples Travelpayouts from bounded regional anchor origins;
- checks for provider observations in a future month;
- resolves the accepted Agoda city ID;
- requests a two-night future stay with existing hotel-quality guardrails;
- records provider status, timestamps, result counts, route/gateway strategy and limited non-secret sample evidence;
- refuses to treat injected or mock responses as production evidence;
- creates an activation recommendation without changing route generation automatically.

### 2. Conservative classifications

Each checked city is classified as one of:

- `live-both`
- `gateway-supported`
- `live-flights-only`
- `live-stays-only`
- `estimate-only`
- `unresolved`
- `provider-error`
- `pending-provider-credentials`
- `pending`

A city becomes `productionActivation.eligible=true` only when both Travelpayouts and Agoda return **production-eligible** live evidence. A gateway mapping may be active, but remains labelled `gateway-supported`.

A city-level activation proves sampled provider coverage only. Exact route dates and final prices still require the existing GV-LIVE-667A/667B itinerary-level verification.

### 3. Safe API endpoints

Added:

- `GET /api/provider-live-coverage`
  - packaged snapshot summary
- `GET /api/provider-live-coverage?q=Toronto`
  - searchable snapshot
- `GET /api/provider-live-coverage?classification=live-both`
- `GET /api/provider-live-coverage?active=true`
- `POST /api/provider-live-coverage/verify`
  - bounded live verification for selected cities
  - requires `X-GV-Admin-Token` or bearer token
  - defaults to 5 cities per request
  - hard maximum is 10 cities per request
  - response is intentionally not persisted by Lambda

The admin token must never be exposed in frontend JavaScript.

### 4. Checkpointed 100/500/1,000-city audit runner

Added `run-gv-city-668c-live-audit.js`.

It supports:

- deterministic 100-city pilot;
- explicit city IDs;
- 500-city or 1,000-city ranges;
- bounded chunks and concurrency;
- checkpoint/resume;
- JSON snapshot output;
- production-active CSV output;
- manual-review CSV output;
- no credential values in logs or artifacts.

Example:

```bash
node run-gv-city-668c-live-audit.js \
  --pilot 100 \
  --chunk-size 5 \
  --concurrency 2 \
  --output ./GV-CITY-668C_LIVE_COVERAGE_RESULTS.json
```

Resume the next range:

```bash
node run-gv-city-668c-live-audit.js \
  --all \
  --start 100 \
  --limit 400 \
  --resume \
  --output ./GV-CITY-668C_LIVE_COVERAGE_RESULTS.json
```

### 5. Packaged data artifacts

- `data/provider-live-coverage-1000-668c.json`
  - honest pending template for all 1,000 cities
- `data/provider-live-pilot-100-668c.json`
  - balanced pilot across regions, current/expansion tiers, gateways and unresolved Agoda cases

The pilot includes examples such as Toronto, Paris, Lahore, Islamabad, Cairo, Istanbul, Tokyo, Bangkok, Rabat, Algiers, Suwon, Tulum, Caye Caulker, Faisalabad, Tehran, Havana and Lucca.

## Environment configuration

Keep the existing flags:

```text
ENABLE_UNIFIED_CITY_REGISTRY_668A=true
ENABLE_PROVIDER_MAPPING_COMPLETION_668B=true
```

Add:

```text
ENABLE_LIVE_PROVIDER_COVERAGE_668C=true
GV_PROVIDER_COVERAGE_ADMIN_TOKEN=<long-random-secret>
```

Existing production credentials are also required:

```text
TRAVELPAYOUTS_TOKEN
AGODA_SITE_ID
AGODA_API_KEY
```

Optional limits:

```text
GV_PROVIDER_COVERAGE_MAX_BATCH=5
GV_PROVIDER_COVERAGE_CONCURRENCY=2
GV_PROVIDER_COVERAGE_MONTH_OFFSET=2
GV_PROVIDER_COVERAGE_STAY_OFFSET_DAYS=60
```

Do not set `GLOBEVOY_USE_MOCKS=true` for a production audit.

## Validation

Focused GV-CITY-668C validation:

- **40/40 passed**
- 1,000-record pending snapshot integrity
- 100-city pilot integrity
- bounded batches and concurrency
- feature flag rollback
- admin authentication
- Travelpayouts/Agoda response handling
- gateway classification
- unresolved Agoda handling
- provider error handling
- injected evidence never activates production
- merge/checkpoint integrity
- Lambda summary/search/authorization behavior

Inherited regression validations passed:

- GV-CITY-668B: 30/30
- GV-CITY-668A: 46/46
- GV-EVIDENCE-667E: 12/12
- GV-CONTROL-667D
- GV-CONTROL-667C
- GV-LIVE-667B
- GV-LIVE-667A
- GV-DATE-666B
- GV-MVP-666A

The inherited frontend-aware validators were run against their matching previously packaged frontend fixtures. GV-CITY-668C itself contains no frontend changes.

## Deliberately not changed

- no automatic activation of all 1,000 cities;
- no frontend changes;
- no route-ranking changes;
- no login/account changes;
- no provider credentials embedded;
- no claim that a static mapping equals current inventory;
- no permanent quarantine after one transient provider failure;
- no attempt to verify all 1,000 cities inside one Lambda invocation.

## Recommended rollout

1. Deploy the 668C backend with the feature flag and a private admin token.
2. Verify 5 important cities through the authenticated endpoint as a smoke test.
3. Run the supplied 100-city checkpointed pilot with production credentials.
4. Review `PRODUCTION_ACTIVE.csv` and `REVIEW.csv`.
5. Run cities 100–499, then 500–999.
6. Import the completed live snapshot in a narrow follow-up release before using it as a production route-generation allowlist.

The follow-up release should be **GV-CITY-668D — Verified Activation Snapshot and Mapping Repairs**. It should import the real 668C audit result, repair false mappings, and gate production route generation using the reviewed activation list.
