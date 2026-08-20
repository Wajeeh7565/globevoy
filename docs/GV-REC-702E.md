# GV-REC-702E — Reviewed 439 → 441 Activation Candidate

## Status

Review-only production activation candidate. **No production activation has been written and no production deployment is performed by this task.**

## Purpose

GV-REC-702C recovered fresh provider evidence for Acapulco and Aalesund. GV-REC-702D then proved both cities inside the isolated staging recommendation gate, and GV-REC-702D-R1 proved the real 1,000-city global route surface sees 441 verified-active destinations while unrelated inactive cities remain blocked.

GV-REC-702E packages that evidence into a deterministic promotion candidate for later review. It does not modify the immutable GV-CITY-668T snapshot or wire itself into Lambda runtime behavior.

## Immutable baseline

- Activation baseline: `GV-CITY-668T`
- Baseline production-active count: `439`
- Baseline activation Git blob SHA: `50079727885aa1c46fb366578917b5eec74b49f9`
- Curated activation records: `1,000`

## Reviewed promotion candidates

Exactly two records are eligible for this candidate:

- `acapulco-mx` — Acapulco, Mexico
- `aalesund-no` — Aalesund, Norway

Both were historically `mapped-reviewed-inactive` with the primary gap `retry-queue:missing-flight-observations` and now have reviewed live flight plus qualified live Agoda stay evidence.

Source reviewed evidence SHA-256:

`ed35ad8ecd64bc3ea4b90b631bb3229abaf0d7aef758e91859038ba3eccb5ea0`

## Proposed semantics if separately approved later

For only those two cities, the candidate projects:

- recommendation eligibility: active
- recommendation mode: `verified-live-provider-capability`
- classification: `live-both`
- activation mode: `direct-or-metro`
- retry queues: cleared for the reviewed missing-flight-observation gap
- exact itinerary verification: still mandatory

Projected active count: `439 → 441`.

## Safety invariants

The validator requires all of the following:

- exactly two records change activation state;
- changed IDs are exactly Acapulco and Aalesund;
- the other 998 projected records are deep-equal to their 668T coverage records;
- Aalborg remains inactive;
- reviewed evidence still satisfies the unchanged qualification boundary;
- no thresholds are relaxed;
- no production activation write or production deployment is claimed;
- `lambda.js`, `staging-lambda.js`, and `verified-city-activation.js` do not import the 702E candidate service or manifest.

## Files

- `backend/data/gv-rec-702e-promotion-manifest.json`
- `backend/services/reviewed-activation-promotion-702e.js`
- `backend/validate-gv-rec-702e.js`

## Promotion boundary

Merging GV-REC-702E into `staging` only records a reviewed candidate and its validation evidence. It does **not** approve a production change.

Any real production promotion must be a separate, explicit task with its own reviewed staging→main PR, rollback plan, production artifact/config review, and post-deployment smoke test. Do not add a production environment flag merely to activate these two records.
