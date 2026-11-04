# Globevoy GV-IMG-673A + GV-BOOK-673B Release Report

## Scope

This frontend release combines two focused improvements on top of GV-UX-672B.

### GV-IMG-673A — Global city-image registry

- Adds a registry for all 1,000 audited Globevoy cities.
- Marks the 439 production-active cities separately.
- Matches 963 cities to a city coordinate from the existing city dataset.
- Uses city + country exact-entity lookup through Wikidata/Wikipedia first.
- Uses coordinate-matched Wikipedia/Wikimedia results when a reliable city article image is not available.
- Keeps verified local overrides for the already repaired cities.
- Rejects generic Unsplash search URLs in the new resolver.
- Uses neutral generated Globevoy artwork when no reliable city photo can be selected, rather than displaying an unrelated place.
- Resets the browser image cache through a new `gv-city-images-v7-673a` namespace.

This is an automated correctness-first image system, not a claim that 1,000 photos were manually reviewed. A manual-curation workflow can later promote selected remote images into approved local assets.

### GV-BOOK-673B — Complete multi-city flight search

- Builds one Kiwi.com multi-city deep link from every dated flight leg in the selected route.
- Example fixture:
  - Toronto → Cancún — 2026-08-29
  - Cancún → Fort Lauderdale — 2026-09-01
  - Fort Lauderdale → Toronto — 2026-09-03
- Shows `Search all 3 flights together` when every leg is a dated flight.
- Preserves separate flight-comparison links as backup.
- Leaves mixed/ground routes in the existing step-by-step partner flow.
- Clearly states that Kiwi.com controls whether a returned itinerary can be purchased in one checkout.
- Hotels remain separate partner bookings.
- Globevoy still does not process payments, issue tickets or collect passport numbers.

## Files added

- `assets/data/city-image-registry-673a.json`
- `scripts/city-images-673a.js`
- `scripts/multicity-visualizer-673a.js`
- `scripts/multi-city-trip-673a.js`
- `scripts/kiwi-multicity-673b.js`
- `scripts/booking-live-673b.js`

## Core pages updated

- `index.html`
- `explore.html`
- `mixed-results.html`
- `multi-city.html`
- `trip.html`
- `multicity-visualizer.html`
- `multi-city-trip.html`
- `booking.html`

## Validation

- JavaScript syntax: PASS — 64 files checked.
- Local references: PASS — 436 references checked, zero missing.
- Registry: PASS — 1,000 unique cities, 439 active, 963 coordinate-matched.
- Kiwi multi-city fixture: PASS.
- ZIP root: `index.html` is at archive root.
- Backend: unchanged.

## Known limitations

1. Remote Wikipedia/Wikimedia availability can vary. Globevoy falls back to neutral artwork instead of guessing.
2. Some images may require attribution review before being copied into permanent local assets.
3. The Kiwi.com button creates one complete flight search. It does not guarantee one ticket, one protected itinerary or one payment; that depends on the provider result.
4. Hotels are still opened separately.
5. Affiliate tracking is not added to the direct Kiwi.com deep link. Connect the Kiwi.com program and wrap the link with the approved Travelpayouts affiliate template before monetizing it.
6. Direct in-Globevoy checkout still requires approved booking APIs, payment infrastructure, servicing, refund handling and security controls.

## Deployment

Frontend-only deployment through AWS Amplify. No Lambda code or configuration change is required.
