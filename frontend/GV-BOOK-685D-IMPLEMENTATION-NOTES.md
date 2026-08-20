# GV-BOOK-685D — Complete Trip Booking Hub V2

## Before and after

Before, `booking.html` rendered every transport leg and every stay, but in two separate collections. The primary continuation action targeted the first route item. That organization made the page feel flight-first and obscured the actual sequence of a multi-city trip.

After, the booking hub presents one chronological journey:

1. flight or transfer;
2. destination stay;
3. next flight or transfer;
4. next stay;
5. return leg.

The older separated transport/stay lists remain in the inherited code for rollback compatibility but are visually superseded only after the complete timeline has rendered successfully.

## Data flow inspected

The generated tour reaches `booking.html` through the existing mechanisms, in this order:

- `globevoy.generated.snapshot.v1.<snapshot>` in `localStorage`;
- `globevoy.multi.selected.v1` in `sessionStorage`;
- the existing `globevoy.trip.handoff.v1:` `window.name` envelope;
- controlled backend restoration from `savedStops`, `savedStopRefs`, snapshot/variant and saved departure parameters when local state is unavailable.

The existing `scripts/booking-live-673d.js` remains the authoritative loader and publishes the restored tour through `window.GlobevoyBooking673FR1.tour` and `globevoy:booking-tour-ready`. The new booking-specific script consumes that same object without changing restoration or backend APIs.

## Data available today

Depending on the generated route, the tour can contain:

- origin, cities, airport codes and ordered `backendLegs`/`legs`;
- official or automatic departure dates;
- `stays`, city hotel objects, nights and check-in/check-out dates;
- party travellers and room count;
- whole-group budget, canonical current total, reserve and remaining room;
- provider evidence, observation timestamps, airline/stops/duration when returned;
- preserved Aviasales/Travelpayouts and Agoda handoff URLs;
- GV-TRUST-685B critical-price coverage and budget confidence.

## Honest degradation and limitations

- Airline, stop count and duration are shown only when present.
- A property name is shown only when the stored hotel mapping is verified; otherwise the card uses a city-stay label.
- Missing prices show `Price to confirm`, not zero or a fabricated amount.
- Duffel fare evidence is labelled `Fare observed via Duffel`; an Aviasales action is separately labelled as external fulfilment.
- Agoda links remain partner searches/property results unless the stored evidence supports a mapped property.
- Globevoy cannot guarantee that the partner price equals an observed or planning amount.
- There is no combined cart, atomic reservation, payment, ticketing, or one-click flight-and-hotel purchase.
- Booking completion across external partner tabs is not tracked by this release.

## Responsive and accessibility behavior

The journey is a semantic ordered list containing card articles and labelled external links. Evidence is written as text and is not colour-only. At mobile widths cards become single-column, actions expand to full width, long routes wrap, and no horizontal scrolling is introduced.

## Scope

Frontend only. Recommendation Lambda, Duffel selection, Agoda backend integration, provider credentials, Stay22, ranking, environment variables and deployment configuration are unchanged.

