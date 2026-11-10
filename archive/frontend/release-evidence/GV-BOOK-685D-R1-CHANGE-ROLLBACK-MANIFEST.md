# GV-BOOK-685D-R1 — Change and Rollback Manifest

## Production runtime changes

| File | Change | Rollback |
|---|---|---|
| `scripts/booking-hub-685d.js` | Metro evidence disclosure, resolved-airport fallback handoff and cached Duffel classification | Restore the file from authenticated GV-BOOK-685D package |
| `styles/booking-hub-685d.css` | Small metro disclosure presentation | Restore the file from authenticated GV-BOOK-685D package |
| `booking.html` | R1 release marker and cache-busting references only | Restore the file from authenticated GV-BOOK-685D package |

## Validation and evidence changes

- Added `validate-gv-book-685d-r1-frontend.js`.
- Added `Run-GV-BOOK-685D-R1-Validate.ps1`.
- Added `VALIDATION_GV_BOOK_685D_R1_FRONTEND.json`.
- Updated the local browser fixture to the production 685C-R3/R3-R1 metro evidence shape.
- Updated inherited validation-only release/version allowances for the superseding R1 marker.
- Regenerated inherited validation JSON records.
- Added R1 final report, validation record, changed-file list and checksum manifest.

## Full rollback

Redeploy the authenticated GV-BOOK-685D frontend ZIP with SHA-256:

`d42522a0140a7ec646b5e1f7dffb7e94acce3407f6426342e2748882ce35bf58`

No backend rollback, database migration, environment-variable change, provider rollback or transaction cleanup is required.
