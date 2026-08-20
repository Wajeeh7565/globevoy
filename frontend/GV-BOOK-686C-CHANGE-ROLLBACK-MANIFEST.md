# GV-BOOK-686C — Change and Rollback Manifest

## Changed runtime file

| File | Change |
|---|---|
| `booking.html` | Activates the 686C release marker and loads the booking-workspace style and controller after the protected booking engines. |

## Added runtime files

| File | Purpose |
|---|---|
| `scripts/booking-workspace-686c.js` | Builds the five-step guided workspace, sticky summary, evidence breakdown and local reviewed-status progress. |
| `styles/booking-workspace-686c.css` | Desktop 70/30 layout, task panels, sticky context, collapsible mobile tray and reduced-motion styling. |

## Added validation files

- `gv-book-686c-browser-fixture.html`
- `gv-book-686c-partner-fixture.html`
- `validation/validate-gv-book-686c.js`
- `GV-BOOK-686C-FINAL-REPORT.md`
- `GV-BOOK-686C-VALIDATION-LOG.txt`
- `GV-BOOK-686C-CHECKSUMS.sha256`
- `GV-BOOK-686C-CHANGE-ROLLBACK-MANIFEST.md`

## Explicitly unchanged protected surfaces

- `scripts/booking-hub-685d.js`
- `scripts/booking-live-673d.js`
- `scripts/budget-confidence-685b.js`
- `scripts/booking-entry-675a.js`
- `scripts/booking-duffel-676a.js`
- `scripts/shell-670f.js`
- `runtime/api-client.js`
- `runtime/config.js`
- all GV-JOURNEY-686B runtime files
- all backend/Lambda/provider code

## Rollback

To return to GV-JOURNEY-686B:

1. Restore `booking.html` from the authenticated 686B package.
2. Remove `scripts/booking-workspace-686c.js`.
3. Remove `styles/booking-workspace-686c.css`.
4. Validation/report artifacts may be retained for audit or removed; they are not loaded by production pages.
5. Re-run the 686B deployment gates before any release action.

No data migration, backend rollback, environment-variable rollback or provider rollback is required. Local `Provider result reviewed` state is non-transactional browser metadata and may be discarded safely.

