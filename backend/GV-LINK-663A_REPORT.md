# GV-LINK-663A — Bookable Partner Links + Price Provenance

## Purpose

This release moves the generated-tour prototype from non-functional placeholder actions toward usable partner handoff links, while keeping price claims honest.

## Backend changes

- Added `services/partner-links.js`.
- Every flight leg now receives one of:
  - a provider ticket/deep link when a provider-backed ticket link is present; or
  - a prefilled Aviasales one-way comparison link using the selected origin, destination, departure date, and adult count.
- Every stay now receives one of:
  - a specific Agoda hotel landing link when the API returned one; or
  - a prefilled Agoda city search using city ID, check-in, check-out, travellers, currency, and affiliate ID.
- Added per-leg and per-stay `priceProvenance`:
  - `provider-observation`
  - `planning-estimate`
  - `provider-rate-sample`
  - `ground-transfer-estimate`
- Added tour-level provenance counts and a booking policy.
- Exact ticket/hotel price is claimed only when provider evidence supports it. All prices still require partner confirmation.

## Frontend changes

- Flight actions now open the generated Aviasales partner/comparison link.
- Hotel actions now open the relevant Agoda hotel or city-search link.
- Replaced the non-functional `View details` action with the applicable partner action.
- Added compact visible source labels:
  - Provider fare evidence
  - Planning estimate
  - Agoda rate evidence
  - Stay estimate
  - Transfer estimate
- Added a clear route-level note explaining whether provider evidence is present or the route currently uses planning estimates.
- Preserved the real geographic map, current route cards, budget guardrails, date alignment, AI curator, and photo fallback.

## Validation

Offline smoke tests passed for:

- Toronto / CAD 2,000
- Montreal / CAD 1,500
- Tehran / CAD 1,500
- San Diego / USD 1,500
- London / GBP 1,500

Across the test set:

- every flight leg received a prefilled HTTPS flight comparison link;
- every hotel stay received an HTTPS Agoda link where a validated Agoda city ID was available;
- ground legs did not receive misleading flight links;
- every amount carried explicit provenance and partner-confirmation requirements;
- JavaScript syntax and JSON parsing passed.

## Important limitation

A prefilled comparison/search link is bookable on the partner site, but it is not the same as a guaranteed exact ticket or room. A specific provider ticket/hotel deep link is used only when the provider supplies it. Final price, schedule, room inventory, and availability remain subject to confirmation on Aviasales/Agoda.

## Deployment

Deploy backend first, then frontend, and hard refresh the browser.

No new environment variable is required. Existing affiliate settings are reused. The existing Google Maps browser key remains part of the frontend baseline and should stay restricted to approved Globevoy domains.
