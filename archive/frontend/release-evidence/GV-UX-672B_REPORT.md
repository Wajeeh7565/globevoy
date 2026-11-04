# GV-UX-672B — Honest profile, deterministic city imagery and step-by-step booking handoff

## Scope
- Removed password and confirmation fields from the browser-only travel profile.
- Renamed the experience clearly as a local travel profile, not a secure production account.
- Replaced the misleading combined multi-city search action with an in-page “Start booking” flow.
- Kept every flight/transport leg and hotel visible with separate partner links.
- Added explicit language that one combined partner payment is not currently supported.
- Added deterministic local images for Toronto, Cancún, Fort Lauderdale, Ottawa and Montréal.
- Bumped the city-image cache key so previously cached wrong images are discarded.
- Ensured authoritative city images are not replaced by generic discovery/fallback images.

## Production boundaries
- No payments are processed by Globevoy.
- No passport number, scan, expiry date or password is collected.
- Passport country is context only; real visa filtering still requires a verified rules source/API.
- Existing backend and route-generation logic are unchanged.
