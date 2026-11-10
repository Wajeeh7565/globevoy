# GV-EVIDENCE-667E — Transport Evidence and Action Labels

## Scope

Focused backend/frontend cleanup on the protected GV-CONTROL-667D baseline. No route-generation, budget, city-library, map-layout, authentication, or provider-credential changes were made.

## Problem fixed

Regional and gateway-heavy itineraries could incorrectly display **Provider-backed fit** even when rail, bus, ferry, return transfer, or airport-gateway costs were still planning estimates. The visualizer also used flight-only action wording for mixed transport and could render an irrelevant stay action on the return card.

## Backend changes

- Added feature flag: `ENABLE_TRANSPORT_EVIDENCE_ACTION_LABELS_667E`.
- Rail, bus, ferry, shuttle, ground-transfer, origin-airport access, and destination-gateway access now count as critical prices when the flag is enabled.
- Estimated transport components prevent a `provider-backed-fit` claim.
- Production-eligible exact transport evidence can verify a transport component when supplied later by a partner integration.
- Canonical ledger now exposes critical and verified transport counts.
- Live-provider summary includes transport evidence in the same final pricing ledger used by card totals and the header total.
- Expanded transport recognition to ferry, boat, shuttle, and transfer modes.

## Frontend changes

- Mixed, rail, bus, ferry, and gateway routes show **View travel options** instead of **View flight options**.
- Flight-only routes keep **View flight options**.
- Transport actions use route-aware labels such as **View rail options**, **View bus options**, and **View ferry options**.
- Estimated flight legs cannot display an unverified airline name; they show **Estimated flight option**.
- Return cards no longer render an unrelated **View stays** action when no partner URL exists.
- Ground and ferry rows are recognized consistently and remain labelled as estimates unless exact production evidence exists.
- No CSS or visual-layout redesign was performed.

## Evidence semantics

With the 667E flag enabled, every priced component that materially contributes to the itinerary is part of the evidence denominator:

- flight legs;
- rail/bus/ferry/ground legs;
- origin airport access;
- destination gateway transfers;
- destination stays.

A route can show **Provider-backed fit** only when all critical components have production-eligible exact evidence and the final canonical total remains within budget. Otherwise it shows **Estimated to fit budget**.

## Validation

New focused validation: **12/12 passed**.

Covered:

- rail, bus, and ground legs count as critical;
- estimated regional transport blocks provider-backed fit;
- gateway transfer estimates downgrade otherwise verified routes;
- exact production-eligible ferry evidence can verify a transport item;
- mixed routes use travel-option wording;
- ferry actions are recognized;
- estimated airline names are suppressed;
- return cards omit irrelevant actions.

Inherited regression scripts also passed:

- GV-CONTROL-667D;
- GV-CONTROL-667C;
- GV-LIVE-667B;
- GV-LIVE-667A;
- GV-DATE-666B;
- GV-MVP-666A.

## Deployment

Deploy the backend ZIP first, then the frontend ZIP. Add:

```text
ENABLE_TRANSPORT_EVIDENCE_ACTION_LABELS_667E=true
```

Rollback:

```text
ENABLE_TRANSPORT_EVIDENCE_ACTION_LABELS_667E=false
```

Keep the inherited 666A–667D flags unchanged.

## Live QA

Test:

1. Toronto → Ottawa → Montreal → Toronto.
   - Header action should be **View travel options**.
   - Transfer estimates must prevent **Provider-backed fit**.
   - Return card must not show **View stays**.
2. Toronto → Cancun → Caye Caulker → Toronto.
   - Gateway transfer remains part of the critical evidence count.
   - Estimated flight legs must not name an airline.
3. A flight-only route such as Paris → Stockholm → Helsinki → Paris.
   - Header action remains **View flight options**.

Final schedules, inventory, and prices remain confirmed on partner websites.
