# GV-REC-702F-E — Permanent Airport Foundation Candidate

Status: review-only candidate on `staging`.

## Purpose

GV-REC-702F-D proved nine preferred-airport corrections live on the isolated staging Lambda and then proved three representative origins end-to-end through `/api/generated-tour`:

- Beijing → PEK
- Detroit → DTW
- Orlando → MCO

The registry-level staging validation passed 9/9 and the generated-tour origin validation passed 3/3. The effective staging activation count remained 441 before and after the airport correction overlay.

702F-E converts those proven staging semantics into a deterministic permanent-foundation projection candidate without editing the committed 1,000-city registry or wiring the candidate into runtime.

## Candidate corrections

- Beijing: NAY → PEK
- Cambridge: CBG → STN
- Detroit: DET → DTW
- Diani Beach: UKA → MBA
- Kansas City: MKC → MCI
- Orlando: ORL → MCO
- Pretoria: PRY → HLA
- Sacramento: SAC → SMF
- Sedona: SDX → FLG

## Exact data-change boundary

For the nine records only, the projected permanent registry may change:

1. `origin.preferredAirportCode`
2. `origin.airportCodes` ordering/content only by adding the new preferred airport first while preserving every existing airport code.

It does **not** change:

- city coordinates;
- `origin.providerLocationCode`;
- provider mapping objects;
- activation state;
- destination eligibility;
- evidence semantics;
- exact-itinerary verification requirements.

All other 991 registry records must remain deep-equal to GV-CITY-668B.

The four 702F-C registry-integrity holds remain untouched:

- Saint Martin
- Umueri
- Sun City
- Khost

## Why projection instead of editing the large registry now

The 668B registry is a large canonical source file. 702F-E deliberately generates the proposed full registry as a CI artifact rather than committing a second large copy or silently rewriting the existing source.

This provides a reproducible promotion package while preserving a zero-runtime-change review stage.

## Provenance

- source staging QA: `GV-REC-702F-D`
- source correction manifest: `GV-REC-702F-D-CORRECTIONS`
- pinned correction-manifest Git blob: `af91dcd1b0e4558710fd030c6a687322a771e2ea`
- staging merge commit: `e22db6a05e6c5985613741699950b35e52b0068c`
- OurAirports commit: `55fd4071c99668a29f9d3625d72405c44074ef2f`
- OurAirports `airports.csv` Git blob: `b95a254e2d970ecb37320d645abced90c6d1a95f`

## Validation contract

CI must prove:

- base registry contains exactly 1,000 records;
- exactly 9 records change;
- exactly 991 records remain deep-equal;
- the permanent projection matches the already-proven 702F-D staging behavior after staging-only metadata is removed;
- provider mappings remain unchanged;
- coordinates remain unchanged;
- historical GV-CITY-668T production baseline remains 439;
- the four integrity-hold cities remain untouched;
- no Lambda/runtime file imports 702F-E;
- exact itinerary verification remains required;
- a full candidate registry artifact and SHA-256 are generated for review.

## Safety

702F-E is **not a deployment** and is **not production approval**.

It does not modify `main`, production Lambda, staging Lambda configuration, provider credentials, provider quotas, activation snapshots, or the live website.

A later promotion step must be a separate explicit decision with its own rollback and smoke-test plan.
