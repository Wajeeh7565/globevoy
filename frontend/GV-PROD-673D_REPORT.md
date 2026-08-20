# GV-PROD-673D — Honest separate-leg booking repair

## Baseline

- Frontend baseline: GV-PROD-673C
- Baseline ZIP SHA-256: `6656a3040c84995a16b1bb7e9db873f15abff03e18eaae789dc18d2528e7c708`
- Backend remains unchanged: GV-UX-670A-R2 / GV-CITY-668T
- Backend ZIP SHA-256: `ebd9884acc477ccb5482afbbe677afc3511f34bdbe93d33b0194f3e056e31da8`

## User-visible repair

The real browser test showed that the Kiwi beta handoff did not preserve the prepared multi-city route. GV-PROD-673D removes that failed active handoff from the booking page and makes the reliable workflow explicit:

1. The main multi-city action now says **Book each flight separately**.
2. **Copy route and dates** remains available.
3. Every exact flight leg and date remains visible with its own comparison button.
4. Every hotel stay remains visible with its own partner button.
5. The secondary handoff begins with the first flight instead of opening a claimed full-route search.
6. The page clearly states that there is no combined checkout or protected multi-ticket itinerary.

## Active files changed

- `booking.html`
- `scripts/booking-live-673d.js` (new active booking script based on 673C)

## Intentionally not changed

- Lambda/backend code
- GV-CITY-668T activation data
- 1,000-city registry and 439-city active allowlist
- Recommendation logic and three-pick roles
- Currency and total-group budget behaviour
- Passport/residence profile behaviour
- City-image resolver and local photo repairs
- Individual flight/hotel partner URLs
- Map, route, trip-detail and visualizer layouts

## Removed from the active page

- `Try all flights on Kiwi (beta)`
- `Try full route on Kiwi (beta)`
- Active loading of `scripts/kiwi-multicity-673c.js`
- Any active claim that a full route can be handed off in one search or checkout

Historical 673B/673C scripts remain in the complete rollback-capable frontend package, but they are no longer referenced by `booking.html`.

## Validation

- JavaScript syntax: PASS
- Active booking page contains no Kiwi or beta text: PASS
- Active booking page loads `booking-live-673d.js`: PASS
- Active booking page does not load a Kiwi multi-city script: PASS
- Browser fixture route rendered as Toronto → Fort Lauderdale → Cancún → Toronto: PASS
- Three separate flight buttons rendered: PASS
- Two separate hotel buttons rendered: PASS
- Copy route and dates preserved all three dated legs: PASS
- Main action rendered as Book each flight separately: PASS
- Backend change required: NO

## Known limitation

Separate flight purchases can create separate tickets and may not protect the traveller when a delay causes a missed onward flight. Globevoy must continue showing this honestly until a provider returns a confirmed protected or single-order itinerary.
