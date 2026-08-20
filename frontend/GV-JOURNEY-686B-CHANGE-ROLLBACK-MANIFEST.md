# GV-JOURNEY-686B — Change and Rollback Manifest

## Changed runtime files

| File | Change |
|---|---|
| `multicity-visualizer.html` | Adds the journey player, synchronized rail, sticky price/evidence context, journey-first copy and 686B assets. |
| `scripts/multicity-visualizer-674a.js` | Adds narrow map-focus/render hooks, offline-fixture isolation, journey-first itinerary copy and traveler-facing recommendation roles. |

## Added runtime files

| File | Purpose |
|---|---|
| `scripts/journey-experience-686b.js` | Builds and controls the optional synchronized journey experience. |
| `styles/journey-experience-686b.css` | Journey player, rail, destination-story, desktop/mobile context and reduced-motion styling. |

## Added validation files

- `gv-journey-686b-browser-fixture.html`
- `validation/validate-gv-journey-686b.js`
- `GV-JOURNEY-686B-FINAL-REPORT.md`
- `GV-JOURNEY-686B-VALIDATION-LOG.txt`
- `GV-JOURNEY-686B-CHECKSUMS.sha256`
- `GV-JOURNEY-686B-CHANGE-ROLLBACK-MANIFEST.md`

## Explicitly unchanged protected surfaces

- `scripts/booking-hub-685d.js`
- `scripts/budget-confidence-685b.js`
- `scripts/shell-670f.js`
- `runtime/api-client.js`
- `runtime/config.js`
- `booking.html`
- all backend/Lambda/provider code

## Rollback

To return to GV-SHELL-686A:

1. Restore `multicity-visualizer.html` from the authenticated 686A package.
2. Restore `scripts/multicity-visualizer-674a.js` from the authenticated 686A package.
3. Remove the two 686B runtime additions: `scripts/journey-experience-686b.js` and `styles/journey-experience-686b.css`.
4. Validation/report artifacts may be retained for audit or removed; they are not loaded by production pages.
5. Re-run the 686A deployment gates before any release action.

No data migration, backend rollback, environment-variable rollback or provider rollback is required.

