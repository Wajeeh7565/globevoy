# GV-FLIGHT-703B — Five-Origin Final-Schedule Live Policy

## Purpose

703B is the first implementation step after the 703A Duffel expansion audit.
It expands only the **684A final-selected-schedule origin policy** on the isolated
staging runtime to these five airports:

- YYZ — Toronto
- JFK — New York
- LAX — Los Angeles
- DUB — Dublin
- DXB — Dubai

## What changes

`backend/services/staging-duffel-five-origin-703b.js` installs the exact five-code
684A allowlist before the ordinary staging Lambda loads.

The policy is active only when `CORS_ORIGIN` resolves exactly to:

`https://staging.dy4fw8gx1ccie.amplifyapp.com`

It sets only the process-local staging value:

`GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A=YYZ,JFK,LAX,DUB,DXB`

No AWS environment variable is required for this policy.

## What does NOT change

703B deliberately does not:

- enable `ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A`;
- enable the 683D Duffel adapter;
- inject or copy `DUFFEL_ACCESS_TOKEN`;
- expand 684B affordable discovery beyond YYZ;
- increase the 3-flight-leg cap;
- change the single-adult pilot;
- weaken exact-date verification;
- weaken exact-airport-first / same-city metro fallback rules;
- weaken the all-flight-legs-LIVE atomic rule;
- add order, payment, booking or ticketing capability;
- modify `backend/lambda.js`;
- change `main` or production.

The existing 684B code remains hard-allowlisted to `YYZ` only.

## Fail-closed behavior

If staging already contains a non-empty 684A origin allowlist that does not match
exactly `YYZ,JFK,LAX,DUB,DXB`, 703B refuses to install and the staging QA wrapper
fails closed. This prevents a hidden configuration from silently overriding the
reviewed policy.

A non-staging CORS origin does not receive the 703B allowlist.

## Diagnostic header

When the staging wrapper installs the policy, responses expose:

`X-Globevoy-Staging-Duffel: GV-FLIGHT-703B`

This header means the **origin policy** is installed. It does not by itself mean
that Duffel live dependencies or credentials are enabled.

## Validation sequence

1. CI validates the five-code 684A allowlist.
2. CI proves 684B remains YYZ-only.
3. CI proves 703B does not switch the 684A pilot on by itself.
4. CI proves single-adult, three-leg, atomic-LIVE and no-booking safeguards remain.
5. CI proves the staging policy installs before the normal staging Lambda loads.
6. Merge to `staging` only.
7. Build/deploy the staging backend package.
8. Verify the 703B header and 684A status without provider credentials first.
9. Run a separate bounded live-provider QA for the newly added origins before any
   production promotion is considered.

## Rollback

Because the change is staging-only, rollback is either:

- deploy the previous staging backend package; or
- set the staging Lambda handler back to `staging-lambda.handler`.

Production is not part of the 703B deployment path.

## Next gate

703B is not complete for production merely because CI passes. Before any future
promotion, controlled live Duffel evidence should be collected for JFK, LAX, DUB
and DXB (YYZ already has prior pilot evidence), while keeping 684B discovery YYZ-only.
