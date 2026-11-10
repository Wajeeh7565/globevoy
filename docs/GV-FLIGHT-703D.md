# GV-FLIGHT-703D — Bounded Affordable-Flight Discovery Expansion

Status: staging-only implementation candidate. No production deployment, no provider calls in CI, and no booking/payment/order/ticketing capability.

## Goal

Expand `GV-REC-684B-R3` affordable-flight discovery from its default `YYZ`-only boundary to the same five origins already proven by 703B final-schedule live QA:

- `YYZ`
- `JFK`
- `LAX`
- `DUB`
- `DXB`

The expansion is allowed only inside the isolated staging runtime and only after the 703B five-origin policy is installed.

## Why 703D comes after 703C

684B may inspect up to two candidate routes and each candidate may contain up to three flight legs. Before 703C, multiple 684A phases inside one generated-tour request could each receive fresh local Duffel request budgets.

703C now gives the entire staging generated-tour HTTP request one shared physical Duffel budget of **8 requests**. Real operator QA proved the limiter actively clamps later phases (`3 + 3 + 2 + 0 = 8`) and blocks a ninth request.

703D therefore expands origin coverage without increasing the request-scoped provider ceiling.

## Runtime design

`backend/services/affordable-flight-discovery-684b.js` keeps its default:

```text
YYZ only
```

A new staging-only overlay, `staging-affordable-flight-five-origin-703d.js`, injects an in-process 684B origin allowlist only when:

1. `CORS_ORIGIN` is exactly the Globevoy staging Amplify origin;
2. the 703B five-origin final-schedule policy is already installed;
3. the requested 684B list is exactly the reviewed five-origin cohort.

Outside that exact staging boundary, 684B remains `YYZ` only.

No new AWS Lambda environment variable is required. The overlay mutates only the current staging process environment before generated-tour loads.

## Preserved safeguards

703D does not change:

- 703C shared physical request cap: **8**;
- 684B candidate cap: **2**;
- 684B maximum flight legs per candidate: **3**;
- single-adult pilot;
- 15% planning-overage candidate ceiling;
- exact-date complete 684A LIVE evidence requirement;
- fail-closed behavior when complete LIVE coverage is unavailable;
- lowest-cost ground-option preservation;
- provider live-offer quality gates;
- no order/payment/booking/ticketing capability.

703D also does **not** enable the public 684A Duffel gate or add/copy `DUFFEL_ACCESS_TOKEN`.

## CI acceptance

The deterministic validator must prove:

- 703D reuses exactly `YYZ,JFK,LAX,DUB,DXB`;
- 703D fails closed if 703B was not installed first;
- a conflicting staging 684B allowlist fails closed;
- all five origins become 684B-eligible only when the pre-existing 684A live gate is explicitly enabled for operator QA;
- a sixth origin remains rejected;
- multiple adults remain rejected;
- lowest-cost role remains excluded;
- four-flight-leg candidates remain excluded;
- 703C cap remains 8;
- outside staging, the default 684B allowlist remains `YYZ`;
- production handler has no 703D wiring;
- CI performs no Duffel provider requests and no AWS deployment.

## Staging deployment boundary

The CI package handler remains:

```text
staging-lambda-702d.handler
```

The staging wrapper installs in this order:

1. 702D reviewed recovery;
2. 702F-D gateway foundation;
3. 703B five-origin final-schedule policy;
4. 703C shared Duffel request budget;
5. 703D five-origin affordable-discovery policy;
6. ordinary staging Lambda / generated-tour runtime.

A successful staging response exposes:

```text
X-Globevoy-Staging-Duffel-Discovery: GV-FLIGHT-703D
```

alongside the existing 703B and 703C diagnostics.

## Operator-only live QA plan

Initial live QA should remain deliberately small. Public staging Duffel traffic stays OFF.

For operator QA only:

1. load the Duffel live token into the CloudShell process without printing it;
2. enable the existing 684A/683D live gates only in the operator process;
3. run bounded affordable-discovery checks for the newly expanded origins;
4. verify total physical Duffel requests never exceed the shared 703C cap of 8;
5. verify incomplete live coverage fails closed;
6. verify no order/payment/booking/ticketing action exists;
7. unset `DUFFEL_ACCESS_TOKEN` and confirm removal.

The first provider QA should prioritize `JFK`, `LAX`, `DUB`, and `DXB`, because `YYZ` was already the 684B baseline.

## Rollback

Restore the verified 703C staging backend artifact. 703D adds no AWS environment configuration, so rollback does not require deleting an AWS environment variable.

Production `main` remains untouched until a separate promotion decision.
