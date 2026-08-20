# GV-REC-702F-B — OurAirports Gateway Enrichment

## Purpose

Generate a read-only airport/gateway review layer for the curated 1,000-city Globevoy registry using a pinned OurAirports snapshot.

This task does **not** change routing, generated-tour behavior, provider selection, city activation, pricing, Lambda configuration, or production.

## Pinned source

- Repository: `davidmegginson/ourairports-data`
- Commit: `55fd4071c99668a29f9d3625d72405c44074ef2f`
- Commit time: `2026-08-20T01:53:15Z`
- File: `airports.csv`
- Git blob SHA: `b95a254e2d970ecb37320d645abced90c6d1a95f`
- Size: `12,703,718` bytes
- License: Public Domain / Unlicense

The raw 12.7 MB CSV is **not** committed to Globevoy. CI downloads the exact commit-pinned file and validates its Git blob SHA before analysis.

## Fields used

Only airport foundation fields are used:

- airport type
- name
- latitude / longitude
- ISO country
- municipality
- `scheduled_service`
- IATA code

No flight schedule, fare, inventory, or booking claim is inferred from OurAirports.

## Candidate rules

A generated gateway candidate must:

1. have a valid three-letter IATA code;
2. have coordinates;
3. be one of `large_airport`, `medium_airport`, `small_airport`, `seaplane_base`, or `heliport`;
4. have `scheduled_service=yes` in the pinned snapshot;
5. be within 400 km when in the same country, or 200 km when cross-border.

Scheduled passenger heliports are included because some destinations, notably in Greenland, legitimately use them as airline-service facilities. A local scheduled-service facility within 25 km whose municipality matches the destination is treated as a strong local match and is not downgraded merely because a larger airport exists nearby.

Candidates are ranked only for **human review** using straight-line distance, airport type, same-country preference, and municipality affinity.

The score is not a route-availability claim and cannot automatically override Globevoy's current mapping.

## Comparison semantics

For each curated city the report records:

- current preferred airport and all known current airport codes;
- whether the preferred code exists in the pinned snapshot;
- whether that airport reports scheduled airline service;
- existing gateway code, if any, and whether it reports scheduled service;
- up to eight nearby scheduled-service candidates;
- review classification and priority.

The important distinction is preserved:

- `scheduled_service=yes` means the source reports scheduled airline service at that facility;
- it does **not** prove a route exists for the user's requested origin/date;
- it does **not** prove a fare is available;
- Duffel remains the preferred exact-date live verification layer.

## Review classifications

- `current-mapping-confirmed`
- `review-alternative-gateway-candidate`
- `review-current-preferred-not-confirmed`
- `review-existing-gateway-not-confirmed`
- `review-missing-preferred-airport`
- `no-nearby-scheduled-service-candidate`

High-priority rows are foundation inconsistencies or missing confirmations. Medium-priority rows are alternative candidates worth human review. No row is automatically promoted.

## 702F-B-R1 audit correction

The first 702F-B report excluded `heliport` records. That incorrectly flagged destinations such as Tasiilaq even though its IATA-coded heliport has scheduled passenger airline service. R1 adds scheduled-service heliports to the passenger-relevant facility set and protects strong local scheduled-service matches from being displaced automatically by a larger but less local airport.

This is an **audit correction only**. It does not modify any Globevoy route mapping.

## CI output

The dedicated `validate-702f-b.yml` workflow:

1. validates the pure algorithm against deterministic fixtures, including a scheduled passenger heliport case;
2. downloads the exact pinned OurAirports CSV;
3. verifies `git hash-object` equals the pinned blob SHA;
4. builds a report for all 1,000 curated destinations;
5. asserts that the report remains review-only and contains all 1,000 rows;
6. uploads the JSON review report as a CI artifact.

## Safety boundary

- no provider credentials;
- no Travelpayouts/Duffel/Agoda calls;
- no Lambda deployment;
- no environment variables;
- no activation snapshot mutation;
- no generated-tour import;
- no automatic airport override;
- no production/main change in this task.

## Follow-up

After reviewing the corrected generated queue, a later task may create a **small, explicit staging-only gateway proposal** for selected cities. Any such proposal must preserve exact-itinerary verification and must not treat airport proximity or scheduled-service metadata as proof of current flight availability.
