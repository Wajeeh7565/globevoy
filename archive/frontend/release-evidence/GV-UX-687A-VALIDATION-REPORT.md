# GV-UX-687A — Validation Report

## Scope

Frontend-only compact journey-card and price-clarity iteration based on the authenticated `GV-SHELL-686D-R1` minimal-header package.

No deployment was performed. No backend, Lambda, CORS, provider, map-provider, payment, authentication, or recommendation-engine change was made.

## User-facing changes

- Desktop destination cards reduced from the 686B override of **520px / 620px minimum height / 275px photo** to a **400px maximum width, no forced minimum height, and 195px photo**.
- Origin card reduced further to **320px maximum width / 175px photo**.
- Mobile destination cards remove the old **570px forced minimum height** and reduce photo height from **245px to 190px**.
- Flight and stay costs are now presented as compact price rows with visible evidence state.
- Consumer-facing evidence labels are:
  - `Provider fare observed`
  - `Cached fare — may have changed`
  - `Flight estimate`
  - `Estimated stay cost`
  - `Current hotel rate not verified`
  - `Current fare unavailable`
  - `Current rate unavailable`
- Destination totals now use `Subtotal` only when every included priced component is provider-observed LIVE; otherwise they use `Estimated subtotal`.
- Persistent journey context changes `Price confidence / X of Y prices checked` to `Pricing evidence / Pricing evidence · X of Y components`.
- The origin card is simplified to starting point, departure/date context, optional airport-access estimate, and date adjustment.

## Preserved behavior

- Minimal Globevoy / Travel profile header remains unchanged.
- Journey playback remains manual; no autoplay was added.
- Map / rail / card synchronization remains intact in source.
- Reduced-motion behavior remains intact.
- Ground legs cannot render flight/Aviasales actions.
- Existing Aviasales and Agoda action builders remain intact.
- Booking workspace, budget-confidence runtime, API client, and runtime configuration remain byte-identical to the approved baseline.
- No hotel planning estimate is upgraded to a live/provider rate merely for presentation.

## Automated validation

`GV-UX-687A`: **35/35 PASS**

Inherited regression checks:

- `GV-RC-686D`: **51/51 PASS**
- `GV-SHELL-686D-R1`: **28/28 PASS**
- `GV-BOOK-686C`: **27/27 PASS**
- `GV-JOURNEY-686B`: **24/24 PASS**
- Node syntax checks for both new 687A scripts: **PASS**

See `GV-UX-687A-VALIDATION-LOG.txt` for the full dedicated result.

## Runtime delta

Only these active frontend runtime files change/add relative to 686D-R1:

1. `multicity-visualizer.html` — changed to activate 687A assets and revised pricing-evidence label.
2. `scripts/multicity-visualizer-687a.js` — added; inherits 674A route behavior and changes journey-card presentation only.
3. `scripts/journey-experience-687a.js` — added; inherits 686B journey controller and changes evidence wording/version only.
4. `styles/journey-experience-687a.css` — added; compact sizing and price hierarchy.

The prior `674a` and `686b` assets remain packaged unchanged for rollback/history and inherited validation.

## Visual QA note

The execution environment used for this build can run static and Node validation but did not produce a reliable browser screenshot render. Therefore this release is **packaged but not deployed**, and a quick desktop + 375px preview review is still recommended before production promotion.
