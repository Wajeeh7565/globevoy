# GV-SHELL-686A — Product-shell consolidation

Status: complete, validated, packaged for staging review. **Not deployed.**

## Outcome

Globevoy now presents one coherent product shell across the primary planning journey:

- shared desktop navigation: Plan a trip, Explore, How it works and Trust;
- accessible full-viewport mobile navigation with Escape support and body-scroll lock;
- one Travel profile account action instead of a fake Sign in promise;
- consolidated design tokens, header, footer, spacing, borders, radii and responsive behaviour;
- canonical How it works, Trust and About entry pages instead of redirects into the design-reference library;
- an honest guest boundary with no password field or simulated authentication;
- an honest browser-local saved-trip boundary;
- query- and hash-preserving migration from the legacy multi-city URL to the current visualizer;
- a staged generation message that explains route, city and evidence checks;
- consistent “Preparing route map…” fallback language.

## Trusted baseline

- Package: `frontend-staging-gv-book-685d-r2-immediate-trust-repair-portable.zip`
- SHA-256: `8dc5a10d555f47ed9d52f4772f49462e72b200a2bef60c5dbf956ac59e49121f`
- Baseline file count: 294

## Exact production runtime delta

Added:

- `styles/product-info-686a.css`

Changed:

- `about.html`
- `booking.html`
- `create-account.html`
- `explore.html`
- `how-it-works.html`
- `index.html`
- `mixed-results.html`
- `multi-city-trip.html`
- `multi-city.html`
- `multicity-visualizer.html`
- `saved-trips.html`
- `scripts/mixed-results-674a.js`
- `scripts/shell-670f.js`
- `sign-in.html`
- `styles/shell.css`
- `trip.html`
- `trust.html`

Packaging also normalizes the final newline in the unused legacy helper `scripts/multi-city-live.js`; it has no semantic runtime change.

Validation and release-document files are package evidence, not production runtime.

## Protected behaviour

The following trusted R2 engines are byte-identical:

- `scripts/booking-hub-685d.js` — `6344ffad400d52dbce0d5d104ea41b86e6bd39394377e028936ba5be7809236a`
- `scripts/budget-confidence-685b.js` — `3ed77e95f240096f6d241499c1e0b517a1f97c77ae855bb9c85d0098f54eb832`
- `scripts/multicity-visualizer-674a.js` — `4f8705b65d44e276b1502fd35d110af1a15c7e09b98a95753911ef78e4d8ba17`

There is no backend, Lambda, provider-adapter, pricing-model, FX, quota, transaction, payment, booking-handoff or environment-variable change.

## Validation

- GV-SHELL-686A static regression: 21/21 PASS.
- JavaScript syntax: shared shell, mixed results, booking hub, budget confidence and generated-tour engine PASS.
- Desktop browser QA at 1280×720: navigation visible, correct active state, four-column footer, no console errors, no horizontal overflow.
- Mobile browser QA at 375×812: burger visible, desktop navigation/profile action hidden, full-height menu, Escape-capable state, body locked while open, no horizontal overflow.
- Canonical information/account pages: correct shell, no console errors, no password input and no fake login form.
- Legacy `multi-city.html`: redirects to `multicity-visualizer.html` while preserving query and hash.
- Booking regression: complete-trip page renders, Plan a trip is active, trusted booking copy remains present and there is no horizontal overflow on desktop or 375px mobile.

## Deliberate limits

- No authentication backend was invented. The product now says secure accounts are unavailable and supports guest/local-profile continuation.
- Existing Privacy, Terms and Affiliate draft/reference content was not rewritten as approved legal copy. Legal/commercial approval remains a separate pre-production gate.
- No deployment and no live provider request were performed.

## Recommendation

Use this package for staging review. After legal-link content is approved, run the normal frontend deployment gates and a controlled production smoke.
