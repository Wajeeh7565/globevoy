# GV-FLIGHT-IGNAV — Ignav live flight fares

Status: merged to `main`, **off by default**. No booking, payment or ticketing.

## What it does
- `backend/services/providers/flights/ignav/ignav.js` — Ignav one-way live fares and booking links.
- `backend/services/domain/live-fares/ignav-live-fares.js` — prices the **final selected tour** with Ignav when the Duffel 684A pilot did not price it (for example, non-YYZ origins). All flight legs must get a verified fare in the requested currency, or nothing is applied (atomic, fail-closed).
- Applied evidence is LIVE / DECISION_GRADE, so 667A verification keeps it instead of re-querying Travelpayouts.
- `POST /api/flight-booking-links` with `{"ignavId": "..."}` returns booking links for one priced leg. Each Ignav-priced leg carries `booking.liveBookingLinks.ignavId`.
- Ignav booking links **do not earn commission**; the existing Aviasales affiliate comparison link stays on each leg.

## Enable (staging first)
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
- `/api/flight-booking-links` is public and spends one request per call; add rate limiting before wide traffic.
