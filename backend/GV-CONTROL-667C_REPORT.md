# GV-CONTROL-667C — Stable Route-Control Identity

## Purpose

Repair the generated-tour card controls that could incorrectly return:

> A generated tour needs at least two stops.

for a visible two-stop route such as Toronto → Havana → Tulum → Toronto.

## Root cause

The visualizer sent only `cityId`/`id` values in the legacy `currentStops` query. The backend then filtered every current stop through the stricter *new-candidate* eligibility rules. A stop already present in a valid generated route could therefore disappear during control processing when it had limited provider readiness or incomplete identity metadata. The remaining route was then miscounted as one stop.

Havana exposed this failure because it is present in the city foundation but is not currently eligible to be introduced as a new CORE replacement candidate. It still needs to be preserved when it is already part of the generated route.

## Changes

### Frontend

- Sends a structured `currentStopRefs` payload for every visible destination.
- Each reference can carry:
  - canonical city ID;
  - provider location code;
  - airport code;
  - gateway airport code;
  - city and country fallback identity.
- Keeps the legacy `currentStops` field for backward compatibility.
- Separates the route stop index from the transport-leg index, preventing a gateway or transfer leg from targeting the wrong destination card.
- Bumps the visualizer cache version to `667c`.

### Backend

- Resolves existing route stops by:
  1. canonical city ID;
  2. provider/IATA location or airport code;
  3. normalized city + country;
  4. unique normalized city name.
- Preserves an existing valid route stop even when it is not eligible to be introduced as a new replacement candidate.
- Continues to use strict CORE/readiness rules for newly selected replacement cities.
- Treats a gateway airport as stop metadata, not as an additional destination.
- Refuses to mutate the route when any existing destination cannot be safely identified.
- Replaces the false two-stop error with an accurate route-identity message.
- Preserves the unselected destination during shuffle/replace.

## Feature flag

```text
ENABLE_STABLE_ROUTE_CONTROLS_667C=true
```

Rollback:

```text
ENABLE_STABLE_ROUTE_CONTROLS_667C=false
```

## Validation

GV-CONTROL-667C: **20/20 checks passed**.

Key regression:

```text
Before: Havana + Tulum
Action: Shuffle Tulum
After:  Havana + Cancún
Result: supported; Havana preserved; no false minimum-two-stops response
```

Additional checks cover city/country fallback, IATA fallback, gateway metadata, malformed structured references, unresolved-stop safety, legacy compatibility, and an actual one-stop route.

Inherited validation scripts also completed successfully:

- GV-LIVE-667B: 19 checks passed
- GV-LIVE-667A: 17/17 passed
- GV-DATE-666B: 12 checks passed
- GV-MVP-666A: 11/11 passed

## Behaviour boundary

A shuffle can still be rejected when no replacement satisfies budget, comfort, geography, timing, airport, and provider guardrails. In that case the message now explains the actual reason, such as no affordable replacement, instead of falsely claiming that the route has fewer than two stops.
