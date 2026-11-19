# GV-HOTEL-NUITEE-WL — live Nuitee hotel rates with White Label hand-off

Status: on `main`, **off by default**. Search only: no Prebook, no booking, no payment in GlobeVoy.

## What it does
- `backend/services/domain/live-fares/nuitee-live-stays.js` prices each stay of the **final selected tour** with Nuitee `POST /hotels/rates` (city + exact stay dates + occupancy, request currency).
- Picks the cheapest hotel rated 7.0+ (when any are rated) from up to 50 results; refundable only breaks exact ties; skips offers with excluded/payable-at-hotel fees.
- Per stop, fail-closed: no usable production rate → the stop keeps its previous hotel, estimate and Agoda link.
- The stay gets `hotel.nuiteeWhitelabel.url` → `https://<whitelabel>/hotels/{hotelId}?checkin&checkout&occupancies=<base64>`; `partner-links.js` exposes it as `hotel.booking.whitelabel`. Agoda remains as "Compare stays on Agoda".
- Booking page v2 (`frontend/scripts/booking-trip-v2.js`): **Book this room ↗** opens White Label checkout (`/booking?offerId=…`) while the rate is under 30 minutes old; otherwise **Book this hotel ↗** opens the hotel page. "See hotel page" and "Compare on Agoda" stay as secondary links.
- Nuitee is merchant of record on the White Label; GlobeVoy earns its configured commission.

## Enable
Lambda environment:
- `NUITEE_SECRET_ID=globevoy/production/nuitee` (Secrets Manager, JSON `{"apiKey":"prod_..."}`; Lambda role needs `secretsmanager:GetSecretValue` on it)
- `ENABLE_NUITEE_LIVE_STAYS=true`
- Optional: `NUITEE_WHITELABEL_DOMAIN` (default `wajeeh-4443-racp8.nuitee.link`), `NUITEE_GUEST_NATIONALITY` (default `CA`).

Sandbox keys are refused; only `prod_` keys apply live prices.

## Cost / load
One rates request per stay of the final tour (max 4).

## Known limits
- Guest nationality defaults to CA when the user does not provide it; rates can vary by nationality.
- White Label deep-link parameters follow Nuitee's documented hotel-details format; confirm the landing page shows the same dates/guests after deploy.
- Users pay on the White Label domain; consider a custom domain for trust.
