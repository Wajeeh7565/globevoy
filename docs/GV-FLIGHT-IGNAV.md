# GV-FLIGHT-IGNAV — Ignav live flight fares

Status: merged to `main`, **off by default**. No booking, payment or ticketing.

## What it does
- `backend/services/providers/flights/ignav/ignav.js` — Ignav one-way live fares and booking links.
- `backend/services/domain/live-fares/ignav-live-fares.js` — prices the **final selected tour** with Ignav when the Duffel 684A pilot did not price it (for example, non-YYZ origins). All flight legs must get a verified fare in the requested currency, or nothing is applied (atomic, fail-closed).
- Applied evidence is LIVE / DECISION_GRADE, so 667A verification keeps it instead of re-querying Travelpayouts.
- `POST /api/flight-booking-links` with `{"ignavId": "..."}` returns booking links for one priced leg. Each Ignav-priced leg carries `booking.liveBookingLinks.ignavId`.
- Ignav booking links **do not earn commission**; the existing Aviasales affiliate comparison link stays on each leg.

## Enable (approved production release)
Lambda environment:
- `ENABLE_IGNAV_FLIGHTS=true`
- `IGNAV_API_KEY` (prefer Secrets Manager; never commit)

## Cost
One Ignav request per flight leg of the final tour (about 3 per search), plus one per booking-links click. 1,000 free, then $2 per 1,000.

## Live check (local)
`ENABLE_IGNAV_FLIGHTS=true IGNAV_API_KEY=... node ops/providers/live-check-ignav-agoda.mjs`

## Known limits
- Multi-city trips are priced as separate one-way legs.
- Ignav often omits link `specificity`; links may open a search page rather than the exact flight.
- Booking lookups require a server-issued HMAC proof valid for 15 minutes; arbitrary IDs and expired proofs make zero provider calls. The rotated server API key signs proofs and is never returned.
- Shared adapter guard limits each warm Lambda instance to 10 provider requests/minute and 60/hour, with a 60-second cooldown after 429. No retries or redirects. This is NOT a distributed/global billing cap: cold starts and parallel instances have separate budgets. Provider-account billing limits remain necessary for a hard spending ceiling.
- Returned segment endpoints, connecting airports and first local departure date must match before prices are applied. Missing dates fail closed. Standard flat Ignav segment fields and legacy nested fields are supported.
- A three-flight tour makes at most three Ignav search requests (four for a four-flight tour); each explicit booking lookup can make one extra request. No additional live verification is implied by offline tests.
- Existing saved trips without a fresh proof must be regenerated to obtain booking links. Aviasales comparisons remain available.

Provider observations older than 15 minutes, missing or more than 60 seconds in the future fail closed. Retrieval timestamps are not airline quote-expiry guarantees; prices remain subject to confirmation on the booking site.
