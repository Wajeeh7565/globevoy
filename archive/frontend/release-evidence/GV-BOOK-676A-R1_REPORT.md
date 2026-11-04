# GV-BOOK-676A-R1 — Scrollable Origin Search Repair

## Problem

The homepage origin field used the browser's native HTML `datalist`. Chromium controlled the popup, rendered it as a tall dark panel, and did not allow Globevoy to control its height, colours, or scrollbar.

## Repair

This frontend-only repair replaces the native datalist popup with a Globevoy-owned accessible combobox/listbox.

- The menu stays attached to the origin field.
- Desktop height is capped at 286 px.
- Mobile height is capped at 240 px.
- The menu scrolls vertically inside the search card.
- Typing continues to filter worldwide origin results.
- Mouse, touch, Arrow Up/Down, Enter, Tab, Escape, and outside-click behaviour are supported.
- Country and airport details remain visible for ambiguous cities.
- The native browser-controlled full-height popup is removed.

## Protected behaviour

No Lambda, Duffel, entry-rule, booking, duration, route, city-activation, photo, currency, or recommendation logic changed.

## Validation

- GV-BOOK-676A-R1 origin-search checks: 14/14
- GV-BOOK-676A frontend checks: 24/24
- GV-BOOK-676A browser fixture: 13/13
- GV-ENTRY-675A frontend checks: 20/20
- GV-ENTRY-675A browser fixture: 8/8
- GV-UX-674A frontend checks: 16/16
- GV-PROD-673F-R2 frontend checks: 28/28
- Photo hydration checks: 5/5
- JavaScript syntax: 84 files, 0 failures
- Root HTML local references: 185 checked, 0 missing

Total deterministic functional checks: 128/128.

## Deployment

Deploy only the new complete frontend ZIP. Keep the current GV-BOOK-676A Lambda unchanged.

The Duffel sandbox section still requires the existing server-side `duffel_test_...` token and feature flag. This repair does not configure or expose that token.
