# GV-SHELL-686D-R1 — Validation report

Status: **PASS — portable package only; not deployed.**

## Automated validation

- GV-SHELL-686D-R1: **28/28 PASS**
- inherited GV-RC-686D master: **51/51 PASS**
- cumulative 686A shell: **21/21 PASS**
- cumulative 686B journey: **24/24 PASS**
- cumulative 686C booking: **27/27 PASS**
- syntax/module checks: **PASS**

Only assertions intentionally superseded by the required minimal header and cache keys were updated. Protected journey, booking, budget/evidence, API-client, runtime-config, provider-handoff, and legacy-redirect hashes remain fixed.

## Isolated browser walkthrough

Live API was disabled only in a separate QA copy. The packaged runtime configuration is byte-identical to 686D, and no live provider call was made.

Desktop results:

- homepage, Explore, Travel profile, How it works and Trust: PASS;
- generated journey fixture: PASS, including Play your journey and ground-transfer chronology;
- booking fixture: PASS, including all five workspace steps and existing trip evidence;
- footer Privacy, Terms and Affiliate links: PASS and reached their canonical pages;
- logo returned to `index.html`;
- header exposed exactly `Globevoy home` and `Travel profile`;
- no center navigation, active underline, hamburger, or mobile menu;
- page-level horizontal overflow: none;
- browser errors: **0**.

The browser recorded three inherited Tailwind development warnings from the bundled `assets/vendor/tailwind.js` while visiting legal pages. They are not errors and are unchanged by this header release.

375 px results:

- document client/scroll width: `360 / 360` on homepage, journey and booking;
- header height: `61 px` including border;
- header text: `Globevoy` / `Profile` with accessible name `Travel profile`;
- no hamburger or center navigation;
- journey player remained present; rail overflow stayed internally contained (`304 / 626`);
- booking workspace remained present; stepper overflow stayed internally contained (`342 / 669`).

## Screenshots

- `screenshots/gv-shell-686d-r1-desktop-home.jpg`
- `screenshots/gv-shell-686d-r1-mobile-home-375.jpg`

## Functional boundary

No trip generation, recommendation, progressive loading, journey player, map synchronization, budget/evidence, booking workspace, Aviasales, Agoda, ground-transfer, authentication, payment, backend, Lambda, provider, or pricing logic changed.
