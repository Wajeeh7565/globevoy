# GV-SHELL-686A change and rollback manifest

## Change boundary

This is a frontend-only product-shell release derived from the authenticated GV-BOOK-685D-R2 package.

Runtime additions:

- `styles/product-info-686a.css`

Runtime modifications:

- shared shell: `scripts/shell-670f.js`, `styles/shell.css`;
- primary entry surfaces: `index.html`, `explore.html`, `mixed-results.html`, `multicity-visualizer.html`, `multi-city-trip.html`, `trip.html`, `booking.html`;
- honest guest/profile boundaries: `sign-in.html`, `create-account.html`, `saved-trips.html`;
- canonical information pages: `about.html`, `how-it-works.html`, `trust.html`;
- legacy route compatibility: `multi-city.html`;
- profile-return integration: `scripts/mixed-results-674a.js`.

`scripts/multi-city-live.js` differs only by an end-of-file newline normalization and has no semantic delta.

## Explicit non-changes

- no backend or Lambda;
- no provider adapter or provider request;
- no booking-handoff construction;
- no flight/hotel evidence classification;
- no budget-confidence calculation;
- no FX or currency conversion;
- no environment variables or activation flags;
- no payments, tickets, orders or transaction capabilities.

## Rollback

Preferred atomic rollback:

1. Restore the authenticated R2 frontend package:
   `frontend-staging-gv-book-685d-r2-immediate-trust-repair-portable.zip`
2. Verify its SHA-256:
   `8dc5a10d555f47ed9d52f4772f49462e72b200a2bef60c5dbf956ac59e49121f`
3. Re-run the established R2 frontend checks before any deployment.

Targeted rollback is possible by restoring the modified runtime files listed above and removing `styles/product-info-686a.css`, but full-package rollback is safer because it preserves a single authenticated baseline.
