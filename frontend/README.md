# GlobeVoy classic frontend — where to edit

This folder contains the **original GlobeVoy website** that is shown at the staging URL root. The React/Next.js code for newer account and other pages is in [`../web/`](../web/). Both parts are composed together by [`../amplify.yml`](../amplify.yml).

**Preferred design:** Keep the approved original homepage, Inter font, shared navy header, GlobeVoy logo, and teal accents. Do not replace it with another redesign as part of cleanup.

## Main pages

| Area | Page | Behaviour |
|---|---|---|
| Homepage / search | [`index.html`](index.html) | [`scripts/home-live-674a.js`](scripts/home-live-674a.js) |
| Explore destinations | [`explore.html`](explore.html) | [`scripts/explore-live.js`](scripts/explore-live.js) |
| Mixed trip results | [`mixed-results.html`](mixed-results.html) | [`scripts/mixed-results-674a.js`](scripts/mixed-results-674a.js) |
| Multi-city routes | [`multicity-visualizer.html`](multicity-visualizer.html) | [`scripts/multicity-visualizer-687b.js`](scripts/multicity-visualizer-687b.js) |
| Selected multi-city trip | [`multi-city-trip.html`](multi-city-trip.html) | [`scripts/multi-city-trip-673a.js`](scripts/multi-city-trip-673a.js) |
| Booking information | [`booking.html`](booking.html) | [`scripts/booking-hub-685d.js`](scripts/booking-hub-685d.js) |

## Shared styling and authentication

- **Header / footer:** [`scripts/shell-670f.js`](scripts/shell-670f.js) and [`styles/shell.css`](styles/shell.css)
- **Homepage appearance:** [`styles/live.css`](styles/live.css)
- **Inter font:** [`assets/fonts/fonts.css`](assets/fonts/fonts.css)
- **Browser auth:** [`scripts/auth-session-705b-r3.js`](scripts/auth-session-705b-r3.js)
- **Saved trips:** [`scripts/saved-trips-705c.js`](scripts/saved-trips-705c.js)
- **API adapter:** [`runtime/api-client.js`](runtime/api-client.js)

The current React Account, My Trips, and Travel Profile screens are maintained in `../web/`. Do not delete them when cleaning up the original frontend.

## What's not safe to delete automatically

- `pages/`: older standalone page examples/snapshots; audit links and test dependencies first.
- `validation/` and `gv-*-browser-fixture.html`: support tests.
- Numbered variants of `scripts/` and `styles/`: compare references before removing.
- `runtime/` data and `assets/`: may be loaded dynamically.

See [feature inventory](../docs/FEATURE_INVENTORY.md) and [cleanup audit](../docs/FRONTEND_CLEANUP_AUDIT.md).

**Safe working rule:** Open a separate feature branch, test locally, run repo checks and review the staging preview before merging. Never delete an old file based only on its name.
