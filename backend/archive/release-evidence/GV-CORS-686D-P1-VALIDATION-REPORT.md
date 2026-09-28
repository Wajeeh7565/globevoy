# GV-CORS-686D-P1 — Validation report

Status: **PASS — packaged only; not deployed.**

## Baseline authentication

The source was taken from the code ZIP whose SHA-256 exactly matches the supplied current-production artifact:

`FC14E98AE35D2EFB581A1D32EB40C333B5C948E3C57B83F5B37D3CC50EDA4E9D`

## CORS behavior

Fixture-only Lambda handler validation: **18/18 PASS**.

- `https://globevoy.com` is echoed exactly.
- `https://686d-preview.dttux5e6ddtzb.amplifyapp.com` is echoed exactly.
- an unapproved Origin receives no `Access-Control-Allow-Origin` header;
- no allowed response uses wildcard or comma-separated origins;
- OPTIONS remains `204` with the existing methods and headers;
- ordinary GET and POST responses receive the request-appropriate CORS header;
- origin-varying responses include `Vary: Origin`;
- a non-browser request preserves the existing production-origin header.

## Inherited regression validation

The complete GV-FLIGHT-685C-R3-R1 portable validation runner passed after inserting the patched `lambda.js` into the authenticated R3-R1 audit package.

- R3-R1: 10/10
- R3: 16/16
- R2: 11/11
- R1: 13/13
- 685C: 15/15
- 684B-R3: 31/31
- 684A: 16/16
- 683M-R4: 108/108
- 683H: 141/141
- 683D: 18/18
- P2 parity: 2/2
- 683G-R1: 49/49
- 683C: 13/13
- backend trust: 9/9 and 7/7
- syntax/module checks: PASS

No live provider call, AWS configuration write, deployment, booking, payment, order, or transaction was performed.

## Exact functional boundary

The only runtime delta is CORS response-origin selection in `lambda.js`. Provider, flight, hotel, recommendation, FX, metro, budget, quota, concurrency, request caps, environment gates, and transaction behavior are unchanged.

AWS Function URL managed CORS was not enabled or modified.
