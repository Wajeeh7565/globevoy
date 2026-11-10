# GV-QUALITY-680A frontend booking repair

This release makes the booking experience truthful and consistent across the route visualizer, selected-trip page, and booking page.

- Fares and hotel rates are labelled as observations or planning estimates, never live quotes.
- Calls to action state whether the partner opens an itinerary hint, selected-property results, or a general search.
- The protected reserve is visible and the remaining amount is explicitly after reserve.
- Saved-route restoration waits up to 20 seconds and can reuse the already-rendered booking state.
- Duffel sandbox controls are hidden in production unless `showSandbox=1` is intentionally supplied.
- Synthetic hotel ratings and default four-star claims are removed.

Run `node validate-gv-quality-680a-frontend.js` before deployment.
