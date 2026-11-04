# GV-TRUST-685B — Evidence-Aware Budget Confidence

## Scope
Frontend-only trust repair on the current GV-TRUST-681A-R1 / GV-UX-674A visualizer baseline. No Lambda, provider, ranking, route discovery, affiliate, booking, payment, or environment-variable change.

## Problem
The route detail page could show `Estimated to fit budget` when only a minority of critical prices had exact-date provider evidence (for example 1 of 5 or 2 of 3). That wording was too confident because unverified hotel/transport components could still move the final price materially.

## Policy
- Final visible total above entered budget → `Over budget`.
- Backend explicitly says `provider-backed-fit` **and** every critical price is verified → `Provider-backed fit`.
- At least one, but not all, critical prices verified → `Planning estimate — verify price`.
- No verified critical price evidence (or no critical evidence summary) → `Price verification required`.
- Even if every critical component is marked verified, the UI does not independently promote a budget-fit claim unless the backend explicitly supplies the provider-backed budget claim.

This intentionally avoids an arbitrary percentage/headroom threshold. Confidence follows evidence completeness and the backend's explicit budget claim.

## Changed runtime files
- `multicity-visualizer.html`
- `scripts/multicity-visualizer-674a.js`
- `scripts/budget-confidence-685b.js`

## Safety
- Frontend-only.
- No API/provider calls added.
- No booking/order/payment/ticketing capability.
- No price mutation.
- No route/ranking mutation.
- Existing exact-date evidence count copy remains visible.
