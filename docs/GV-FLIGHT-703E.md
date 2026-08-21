# GV-FLIGHT-703E — Two-Adult Live Fare Integrity

Status: staging-only implementation candidate. No production deployment, no provider calls in CI, and no booking/payment/order/ticketing capability.

## Goal

Extend the already-proven Duffel LIVE 684A/684B path from one adult to exactly one or two adults in the isolated Globevoy staging runtime, while preserving correct provider price semantics.

703E changes one variable only:

- default/current boundary: one adult;
- exact staging boundary after the 703E overlay: one or two adults;
- children and infants remain out of scope.

The five-origin cohort remains unchanged: `YYZ`, `JFK`, `LAX`, `DUB`, `DXB`.

## Pre-implementation audit finding

The existing Duffel adapter already builds one Duffel passenger object per requested adult:

```text
passengers: Array.from({ length: request.passengers }, () => ({ type: 'adult' }))
```

The critical risk was downstream amount semantics. Duffel's `offer.total_amount` represents the total price of the offer for all requested passengers. Before 703E, Globevoy stored that amount as `totalPrice`, but the generic traveller-pricing layer assumed provider flight amounts were per-passenger unless explicitly marked otherwise.

Simply changing the 684A provider request from `passengers: 1` to `passengers: 2` would therefore have been unsafe: a two-adult Duffel party total could be multiplied by two again.

703E fixes the semantic boundary before enabling two adults.

## Runtime design

### Provider evidence

`duffel-live-adapter-683d.js` now explicitly marks Duffel live offers as:

```text
fareAmountBasis = party-total
providerPartyTotalAmount = offer.total_amount
providerPassengerCount = requested passenger count
```

`flight-provider-contract-683c.js` preserves those explicit fields in canonical live evidence.

### Traveller pricing

`traveller-pricing.js` keeps the existing planning behavior for per-passenger estimates, but recognizes provider party-total evidence. For such evidence:

- the provider party total is applied exactly once;
- the passenger multiplier is `1`;
- a second whole-tour repricing pass preserves the same party total;
- a derived average per fare unit may be recorded for diagnostics, but is never used to multiply the live provider total again.

### 684A / 684B staging scope

A shared staging-only adult-scope helper keeps the default at one adult everywhere. The 703E staging overlay raises the maximum to two only when:

1. the exact staging Amplify origin is present;
2. 703B five-origin final-schedule policy is installed;
3. 703D five-origin affordable-discovery policy is installed;
4. 703C shared physical request cap is still exactly 8.

Outside this exact staging boundary, two adults remain rejected.

684A sends `passengers = party.adults` to Duffel for exact and metro-fallback searches. 685C already checks returned passenger count against requested passenger count and does not multiply provider prices.

684B continues to compare complete live trip totals against the user's full-trip budget. The provider party-total semantics therefore flow into the existing strict budget guard without a second passenger multiplier.

## Preserved safeguards

703E does not change:

- origins: `YYZ,JFK,LAX,DUB,DXB`;
- 703C shared physical Duffel request cap: **8**;
- 684B candidate cap: **2**;
- maximum flight legs: **3**;
- exact-date requirement;
- complete-LIVE-evidence atomicity;
- same-city metro fallback boundary;
- lowest-cost ground-option preservation;
- provider quality and currency safety policies;
- public Duffel activation state;
- booking/payment/order/ticketing capability.

Children and infants remain explicitly unsupported by 703E.

The separate 683H flexible-date P2 optimizer keeps its existing single-adult gate. 703E does not widen that higher-amplification path.

## Deterministic acceptance

CI must prove without provider network calls:

- same JFK → MIA date/currency with one adult creates one adult passenger object;
- same request with two adults creates two separate adult passenger objects;
- adapter captures the returned Duffel amount once as party total;
- two-adult provider total is not assumed to equal exactly 2× the one-adult total;
- planning per-passenger estimates still scale normally;
- live two-adult provider party total is not multiplied again by traveller-pricing;
- re-running whole-tour pricing does not double-count the provider party total;
- 685C passenger matching remains exact;
- a two-adult live party total of 420 fits a 500 USD budget;
- that same 420 total fails a 400 USD budget;
- one/two adults are staging-eligible while three adults, children, and infants fail closed;
- outside staging, the maximum remains one adult;
- 703C cap remains 8;
- 703B/703D origin cohort remains unchanged;
- production handler has no 703E wiring;
- CI performs no AWS deployment or real provider call.

## Staging wrapper order

`staging-lambda-702d.handler` installs:

1. 702D reviewed recovery;
2. 702F-D gateway foundation;
3. 703B five-origin final-schedule policy;
4. 703C shared Duffel request budget;
5. 703D five-origin affordable-discovery policy;
6. 703E two-adult fare-integrity policy;
7. ordinary staging Lambda / generated-tour runtime.

Successful staging responses expose:

```text
X-Globevoy-Staging-Duffel-Adults: GV-FLIGHT-703E
X-Globevoy-Staging-Duffel-Max-Adults: 2
```

alongside the existing 703B/703C/703D headers.

## Operator-only live QA plan

After code-only staging deployment, public staging Duffel remains OFF. Operator QA should load the existing live token only into the CloudShell process and compare the same route/date/currency for one adult and two adults.

Initial live routes:

- `JFK → MIA`;
- `DUB → LHR`.

Pass criteria focus on semantics rather than an exact 2× relationship:

- two adult passenger objects are sent to Duffel;
- returned provider amount is retained as one party total;
- provider passenger count is two;
- no second traveller multiplier appears in the final live leg total;
- budget comparison uses the party total;
- evidence remains LIVE;
- shared request cap remains 8;
- no rate-limit event;
- transactional capabilities remain false;
- token is removed from the shell after QA.

## Rollback

Restore the verified 703D staging backend artifact. 703E adds no AWS Lambda environment variable; its adult-scope key is injected only inside the staging process by the code overlay.

Production `main` remains untouched until a separate promotion decision.
