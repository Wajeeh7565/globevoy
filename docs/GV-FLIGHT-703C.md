# GV-FLIGHT-703C — Shared Duffel Request Budget

Status: staging-first implementation candidate

## Goal

Prevent one generated-tour request from receiving a fresh Duffel request allowance in each live-flight phase.

The request-scoped shared ceiling is initially **8 physical Duffel searches**.

This follows the GV-FLIGHT-703B live QA on 2026-08-20, where four one-leg exact-date searches from JFK, LAX, DUB and DXB all returned LIVE evidence with zero rate-limit events, while the observed provider remaining-quota signal stepped from 9 to 6 across the four calls.

## Current risk being fixed

684A already has strong per-invocation request caps and quota handling. 684B also limits candidate checks. But generated-tour can invoke 684A more than once across final verification, affordable-flight recovery and over-budget rescue paths. Those invocations historically create separate `requestState683H` objects.

Therefore the theoretical aggregate request count for one generated-tour request can exceed the safety level we want for broader origin expansion even though every individual phase is bounded.

## 703C policy

Inside the isolated staging QA handler:

- each HTTP request gets a new `AsyncLocalStorage` budget context;
- shared physical request cap = **8**;
- every 684A request state is clamped to the budget remaining at state creation;
- the existing `state.requests` physical-request counter decrements the shared budget;
- deduped logical searches do not consume shared budget because they do not increment `state.requests`;
- provider retries do consume shared budget because each physical retry increments `state.requests`;
- when shared remaining reaches zero, subsequent 684A states have cap zero and existing fail-closed request-cap behavior prevents another Duffel launch;
- a new HTTP request receives a fresh budget;
- simultaneous HTTP requests are isolated from one another.

The mechanism is installed before `generated-tour.js` loads 684A so both direct 684A verification and the 684B `applyLiveFare` callback capture the shared-budget-aware 684A path.

## Safety boundaries

703C does **not**:

- enable Duffel;
- copy or add `DUFFEL_ACCESS_TOKEN`;
- add an AWS environment variable;
- increase any existing local request cap;
- expand 684B beyond YYZ;
- change single-adult eligibility;
- change the three-flight-leg cap;
- change exact-date or exact-airport-first behavior;
- change the atomic all-flight-legs-LIVE requirement;
- add order, payment, booking or ticketing capability;
- modify `backend/lambda.js`;
- change `main` or production.

Public staging Duffel traffic remains off until a separate activation decision.

## Diagnostics

Staging responses add:

- `X-Globevoy-Staging-Duffel-Budget: GV-FLIGHT-703C`
- `X-Globevoy-Staging-Duffel-Budget-Cap: 8`
- `X-Globevoy-Staging-Duffel-Budget-Used: <physical requests used>`

684A summaries and patched tours also receive a `sharedDuffelBudget703C` object with cap, used, remaining and state-clamp diagnostics.

## Deterministic validation

`backend/validation/validate-gv-flight-703c.js` proves:

1. exact staging-origin gating;
2. shared cap exactly 8;
3. 6 requests in one phase leave only 2 for the next phase;
4. after 8 physical requests a third state receives cap 0;
5. a new HTTP request resets to 8;
6. a smaller local cap is never expanded by 703C;
7. simultaneous request contexts remain isolated;
8. 684A result diagnostics expose shared-budget state;
9. install fails closed if 684A was loaded before the patch;
10. 684B remains YYZ-only;
11. production handler has no 703C import;
12. no provider call, credential handling, deployment command or booking capability is introduced.

## Rollback

703C requires no new AWS environment variable.

Rollback is code-only:

1. restore the prior staging backend ZIP; or
2. restore the prior `staging-lambda-702d.js` package.

No production rollback is required because 703C is not wired into the production handler.

## Next gate

After deterministic CI and staging deployment, validate:

1. ordinary staging requests show cap 8 / used 0 while Duffel remains disabled;
2. controlled operator-only live QA demonstrates aggregate accounting across multiple 684A invocations;
3. only after that consider public staging activation for the five 703B origins.
