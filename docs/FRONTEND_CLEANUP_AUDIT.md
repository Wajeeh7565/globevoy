# Frontend cleanup audit — safe first pass

**Branch:** `staging`  
**Goal:** Make `frontend/` easier to navigate without breaking the current website, signed-in account flow, tests, URLs, or AWS Amplify build.

## Current inventory (source tree)

At the time of this audit, `frontend/` has **375 tracked files** (about **15.9 MB** of tracked content), including **67 HTML files**, **125 JavaScript files**, **35 CSS files**, **53 Markdown files**, plus JSON data, images, fonts, PowerShell scripts, and other assets. These numbers describe tracked file names/extensions; they do not represent an audited dependency graph.

The source tree contains:
- **Core site:** `index.html`, `explore.html`, `mixed-results.html`, `multicity-visualizer.html`, `multi-city-trip.html`, `booking.html`, and important supporting pages.
- **Shared site header:** `scripts/shell-670f.js`, `styles/shell.css`. **Protect these** — recent visual unification depends on them.
- **Auth/Saved Trips:** `scripts/auth-session-705b-r3.js`, `scripts/saved-trips-705c.js`, auth callback, and bridge scripts. **Protect these**.
- **Many old numbered JS/CSS versions:** e.g. `booking-live-670c.js` through `booking-live-673d.js`; `multicity-visualizer-640a.js` through `multicity-visualizer-687b.js`. **Do not infer they are safe to delete from filenames alone.**
- **Legacy page mockups:** `pages/` contains many alternative loading, empty, signed-in, error, and selected-state HTML snapshots. Their current role as demos/tests/public URLs must be checked.
- **Browser fixtures:** `gv-*-browser-fixture.html` and `validation/` support regression testing and must not be deleted just to reduce file count.
- **Historical release files:** Markdown/TXT/JSON/PowerShell reports and rollout/checksum notes are scattered at the `frontend/` root. These generally belong in a documentation/archive area after checking links/tests.
- **Large runtime data:** `runtime/supported-origins.js` is about 5.1 MB. Investigate provenance and consumers before reducing, moving, or regenerating it.

## Protected files / folders during cleanup

Do not modify or delete until tests prove it is safe:
- `frontend/index.html`
- `frontend/scripts/shell-670f.js`
- `frontend/styles/shell.css`
- `frontend/runtime/`, `frontend/assets/`, `frontend/validation/`
- Main results, multi-city, booking and authentication pages/scripts
- `web/` React pages, because Account, Travel Profile and My Trips still rely on them
- `amplify.yml` build composition (`frontend/` plus `web/out/` under `/react/`)

## First cleanup action (limited and reversible)

Move only these superseded historical documentation files out of the web-serving `frontend/` root into `docs/archive/frontend/`, preserving Git contents and history:
- `GV-QUALITY-680A-FRONTEND.md`
- `GV-QUALITY-680B-FRONTEND.md`
- `GV-QUALITY-680B-R1-FRONTEND.md`

No app code, HTML, CSS, JavaScript, auth, image, or runtime-data files are removed in this first pass. The purpose is a **small, testable cleanup** rather than mass deletion.

## Next cleanup batches — only after review

1. **Route and import audit:** enumerate references from current HTML, JS dynamic imports, validations, build workflows, and any published deep links.
2. **Historical reports:** group old `frontend/*.md`, `*.txt`, `*.sha256`, `*.ps1` into `docs/archive/frontend/` in small batches; fix references before moving.
3. **Versioned JS and CSS:** mark files as `active`, `test/fixture`, `historical`, or `unknown`; remove historical versions only after the team verifies no usage.
4. **Page mockups and fixture HTML:** if tests/deep links rely on them, keep them in source but consider excluding non-runtime files from Amplify's publish artifact **only with explicit test coverage**.
5. **Runtime datasets:** measure page weight and decide whether older `destination-data` and large origins datasets need compression, S3 storage or code-splitting; treat as a separate performance task.
6. **Staging smoke test:** compare homepage, Explore, multi-city, results, booking, login, My Trips, Travel Profile, and mobile navigation before merge.

## Definition of done

- All required CI tests pass.
- Existing `staging` URLs still work.
- No change to existing auth/storage behaviour.
- Existing homepage appearance and theme preserved.
- No production or AWS resource changes.
- Team confirms which old paths can be retired.

**Note:** Zero code-search results alone cannot prove a file is unused; code may construct paths dynamically or reference older published URLs.
