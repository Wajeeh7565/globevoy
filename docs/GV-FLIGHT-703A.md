# GV-FLIGHT-703A — Expanded Duffel Live Flight Coverage Audit

Status: research-only audit. No runtime wiring, provider calls, AWS deployment, `main` change, or production change.

## Goal

Determine the safest way to expand Duffel LIVE exact-date flight evidence beyond the current narrow production pilot without weakening evidence quality, budget integrity, quota safety, or rollback.

## Existing pipeline

Globevoy already has a mature guarded path:

1. `GV-PROVIDER-683D` — Duffel live search adapter. Only `POST /air/offer_requests`; no order/payment/ticketing path.
2. `GV-PROVIDER-683M-R4` — bounded request scheduler, request-scoped dedupe, concurrency <= 2, rate-limit metadata, one bounded 429 retry, hard state cap 12.
3. `GV-FLIGHT-684A` — public final-selected-schedule live-fare verification.
4. `GV-REC-684B-R3` — bounded affordable-flight discovery that may call 684A on up to two plausible candidate routes.
5. `GV-FLIGHT-685C` — deterministic live-offer quality and fare selection.

### 684A current code boundary

- code-level default origins: `YYZ`, `JFK`, `LAX`, `DUB`, `DXB`;
- deployment may further restrict the list with existing `GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A`;
- one adult only;
- maximum three flight legs;
- exact date and exact airport first;
- one same-city metro fallback per failed-quality leg;
- all flight legs must resolve LIVE or none of the Duffel prices are applied;
- no booking/order/payment/ticketing capability.

A three-flight-leg tour therefore has a bounded 684A search envelope of six Duffel offer requests: three exact searches plus at most three same-city metro fallback searches.

### 684B current code boundary

- hard origin allowlist: `YYZ` only;
- at most two candidate routes;
- at most three flight legs per candidate;
- one adult only;
- candidate may be at most 15% over planning budget;
- exact-date complete 684A evidence is required before selection;
- lowest-cost role preserves a genuinely cheaper ground trip.

Two full candidates can therefore account for up to twelve Duffel searches.

## Main risk found

The main scaling risk is not the number of origin codes. It is aggregate provider-call amplification.

Each 683M request state has strong local quota protections, but generated-tour can create multiple 684A states during one request. A selected flight route can first consume up to six searches; if live pricing proves it over budget, 684B's bounded rescue can inspect two further candidates, up to twelve more searches. Theoretical worst-case envelope: 18 searches in one generated-tour request.

The scheduler also has no cross-Lambda shared quota coordinator. Two separate Lambda invocations can each obey concurrency <= 2 while still consuming the same Duffel account quota at the same time.

## Current Duffel documentation checked 2026-08-20

Official sources:

- Offer Requests: https://duffel.com/docs/api/v2/offer-requests
- Response handling / rate limiting: https://duffel.com/docs/api/overview/response-handling
- Offers: https://duffel.com/docs/api/offers/get-offers
- Search best practices: https://duffel.com/docs/guides/following-search-best-practices
- Pricing: https://duffel.com/pricing

Observed documentation facts:

- Duffel creates an offer request to search airlines and returns offers for the requested slices.
- `supplier_timeout` accepts 2–60 seconds; default is 20 seconds. Globevoy currently uses 10 seconds, which is within Duffel's documented range and aligns with their advice to keep supplier timeout below the caller HTTP timeout.
- Duffel currently documents `ratelimit-limit: 60` with an interval currently set to 60 seconds, explicitly subject to change.
- `ratelimit-remaining` and `ratelimit-reset` are returned; Globevoy already parses and acts on them.
- Search offers expire and may change before booking. Duffel recommends retrieving the offer again when the traveller is ready to book. Globevoy must continue to call these values LIVE provider evidence, not guaranteed booking prices.
- Public pricing currently lists fees per confirmed order rather than a per-search fee. 703 remains search-only and does not add order capability.

## Recommended 703B

**Five-Origin Final-Schedule Live Verification**

Expand only the lower-amplification 684A final-selected-schedule path first:

- `YYZ`
- `JFK`
- `LAX`
- `DUB`
- `DXB`

These five origins already exist as 684A's code-level default, so this is a natural controlled cohort.

Keep unchanged in 703B:

- 684B affordable discovery remains `YYZ` only;
- one adult only;
- maximum three flight legs;
- exact-date requirement;
- all-flight-legs-live atomicity;
- same-city metro fallback boundary;
- live-offer quality guardrails;
- no order/payment/booking/ticketing capability.

This isolates one variable: origin coverage.

## Required before broad 684B expansion

Create a request-scoped aggregate Duffel budget shared by all live-flight phases of one generated-tour request:

- 684B candidate discovery;
- final 684A verification;
- over-budget rescue;
- any future live-route reranking.

A conservative first ceiling is 12 provider searches per generated-tour request, matching the existing 683H hard state ceiling. The final value should be based on live telemetry, not assumption.

A shared in-process request budget is the minimum requirement. Broader public traffic may additionally need a cross-invocation/account-level limiter because Lambda instances do not share 683M state.

## Not recommended in the same release

Do not combine origin expansion with:

- multiple adults or children;
- 684B expansion to 10–25 origins;
- removal of exact-date verification;
- relaxation of all-flight-legs-live atomicity;
- orders, payment, booking or ticketing;
- treating Duffel search prices as guaranteed booking prices.

## Proposed sequence

1. **703A** — this architecture audit. No provider calls.
2. **703B** — five-origin 684A-only controlled live coverage proof.
3. **703C** — aggregate generated-tour Duffel request budget + telemetry.
4. **703D** — bounded expansion of 684B affordable discovery after 703C proves quota safety.
5. **703E** — separately evaluate multi-adult pricing; children remain another independent scope unless explicitly validated.

## Production boundary

703A performs no production deployment. Any 703B production rollout must be a separate promotion with explicit approval, rollback, provider-quota smoke, and evidence checks.
