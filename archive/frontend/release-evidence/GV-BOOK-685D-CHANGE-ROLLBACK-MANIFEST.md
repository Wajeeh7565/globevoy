# GV-BOOK-685D Change / Rollback Manifest

## Production frontend changes

- `booking.html`
  - adds the complete-journey timeline mount;
  - clarifies whole-group budget and trust state;
  - loads GV-TRUST-685B before the booking hub;
  - loads the new booking-specific CSS and JS.
- `scripts/booking-hub-685d.js` — chronological model, trust/provenance copy, handoff preservation and rendering.
- `styles/booking-hub-685d.css` — timeline/card design, evidence states, focus treatment and responsive layout.

No existing production JavaScript or CSS implementation file is modified.

## Validation-only changes

- `validate-gv-book-685d-frontend.js`
- `gv-book-685d-browser-fixture.html`
- `Run-GV-BOOK-685D-Validate.ps1`
- generated 685D validation JSON
- inherited 676A validators accept the newer release/cache-busting markers
- inherited validation JSON files were refreshed by local test execution
- release notes, manifest, validation record and checksums

## Rollback

Restore the GV-TRUST-685B copy of `booking.html`. The new `scripts/booking-hub-685d.js` and `styles/booking-hub-685d.css` then become unreferenced and may remain safely or be removed from a later package.

No backend, database, environment, credential, affiliate-ID or infrastructure rollback is required.

No deployment is included in this package.

