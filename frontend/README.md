# GlobeVoy frontend layout

Edit classic HTML in `pages/`. The frontend root contains this guide, the favicon and folders, with no loose HTML files.

```text
frontend/
  pages/       All 23 active HTML files (homepage and results are GV-WEB-2)
  assets/      Images, icons, fonts, media (homepage films, city scenes), map data, Leaflet
  scripts/     Classic browser behavior and authentication
  styles/      CSS
  runtime/     Public configuration and API policy
  validation/  Tests, fixtures and recorded release metadata
  screenshots/ Visual evidence
web/           React account, My Trips and travel profile source
archive/frontend/design-pages/  Unused historical mockups; never published
```

## Active pages versus archived designs

`pages/about.html` is the current About page. The older About mockup in the archive is not used by the website. The same applies to the 31 archived settings, sign-in, loading and error designs: they are retained only as historical reference. Do not import, publish or move them back into active source merely because their filenames resemble current pages.

All 23 public entry pages live in `pages/`. The three legacy screens (`explore-curated.html`, `multi-city-results.html`, `trip-detail-single.html`) were removed in GV-WEB-2; `scripts/clean-routing.js` now sends those buttons to the homepage.

## GV-WEB-2: homepage and results page (November 2026)

| Page | Design | Files |
| --- | --- | --- |
| `pages/index.html` | `globevoy_fresh_B_v9` homepage | `styles/home.css`, `scripts/home.js`, `assets/media/scenes`, `assets/media/cards` |
| `pages/results.html` | GlobeVoy Route Preview (map-first journey) + option tabs from the multi-city concepts | `styles/results.css`, `scripts/results.js`, `assets/map/countries.geo.json`, `assets/vendor/leaflet` |
| both | shared search logic | `scripts/trip-search.js`, fonts in `assets/fonts/archivo` |

Rules the new pages follow:

- Only trips where every flight and hotel was priced live are shown (`GlobevoyTripSearch.isFullyLive`). No estimates.
- Dates stay open (about six months ahead) unless the traveller picks a month under More Options.
- Guests see one trip; signed-in travellers see three ("Best use of your budget", "Lowest cost", "Something different"). "Lowest cost" is always the cheapest trip shown.
- "View trip & book" hands the trip to `multi-city-trip.html`, which links to `booking.html` (both redesigned in GV-WEB-3).
- `multicity-visualizer.html`, `mixed-results.html`, `multi-city.html`, `explore.html` and `ask.html` are now redirects: searches with a budget open `results.html`, everything else the homepage.

Tests: `tests/frontend/trip-search.test.cjs` (fixture `tests/frontend/fixtures/generated-tour-sample.json`, built from a real API trip).

## GV-WEB-3: itinerary and booking pages (November 2026)

| Page | Design | Files |
| --- | --- | --- |
| `pages/multi-city-trip.html` | Cinematic Scroll Journey: stop-by-stop stream, map that follows the scroll, budget, sticky Book bar | `styles/itinerary.css`, `scripts/itinerary.js` |
| `pages/booking.html` | Editorial Travel Booking: checklist, one step per flight and stay, booking summary | `styles/booking.css`, `scripts/booking-trip-v2.js` (list, prices, partner links), `scripts/booking-page.js` (header links) |
| both | shared header, footer, buttons and colours; reading the handed-over trip | `styles/site.css`, `scripts/trip-handoff.js` |

- The old itinerary script (`multi-city-trip-673a.js`) and the old booking workspace (booking hub, workspace, Duffel sandbox proof, entry check, `booking-live-673d.js`) were removed with their styles. The booking list keeps its tested logic: prices from the trip's `displayBudget`, live labels only while the signed quote is valid, Ignav links on demand, booked ticks.
- Trips reopened from Saved Trips (`accountTrip`) show saved prices and open no partner links until revalidated (GV-BOOK-706A).
- Save on the itinerary keeps `#gv-mtd-save`, so `saved-trips-705c-r3-route-details.js` saves signed-in trips to the account.

`pages/create-account.html` is the existing browser-local travel-profile flow. Real account signup/sign-in and private trip/profile pages use the React/Cognito implementation in `web/`. This organization does not change those features.

## Source paths and website addresses

Source folders are for navigation; the build controls public URLs. For example:

| Edit source | Published address |
| --- | --- |
| `pages/index.html` | `/index.html` |
| `pages/about.html` | `/about.html` |
| `pages/auth-callback.html` | `/auth-callback.html` |
| `pages/results.html` | `/results.html` |
| `pages/multicity-visualizer.html` | `/multicity-visualizer.html` (redirect) |
| `../web/app/account/page.tsx` | `/react/account/` |

The shared composer in `../ops/frontend/source-layout.cjs` copies source pages to these existing addresses without editing their bytes. HTML relative asset paths and `data-depth` refer to the published address. Do not change them to match the source directory. The production packager and composite Amplify build use the same composer. Compatibility redirects for 36 older design URLs retain queries and fragments.

`../ops/frontend/page-layout.json` records source moves, byte hashes and URL mappings. Its earlier promotion/archive entries describe historical moves; `publicPageSources` describes the current source locations.

## Local preview and checks

Do not serve `frontend/` directly: it is organized source, not the finished website. Build and compose a local site:

```sh
npm ci --prefix web --no-audit --no-fund
npm run build:web
node ops/frontend/compose-site.mjs .cache/frontend-preview
python -m http.server 8000 --bind 127.0.0.1 --directory .cache/frontend-preview
```

Open `http://127.0.0.1:8000/`. Existing origin policy still controls authentication; this preview does not enable production accounts locally. Use a new empty output path when composing again. Run `npm test` and the account/web/release groups; browser tests also verify the composed production artifact. Production packaging uses the separately reviewed production configuration and restricted public Maps key.

Changing or merging source does not authorize deployment.

## GV-WEB-4: sign-in, Account and Travel Profile (November 2026)

| Page | Design | Files |
| --- | --- | --- |
| `pages/sign-in.html` | Cinematic Explorer sign-in (Lake Bled) | `styles/sign-in.css`, `scripts/sign-in-page.js` |
| `/react/account/`, `/react/travel-profile/` | Cinematic Explorer Account and Travel Profile | `web/app/cinematic-account.css`, `web/components/account/*` |
| header on every page | Sign In for guests; Account menu (Account, Travel Profile, Sign out) for members | `scripts/account-menu.js`, `styles/account-menu.css`, `web/components/account/account-nav.tsx` |

- Every Sign In opens `sign-in.html`; its buttons use the existing Cognito PKCE flow in `auth-session-705b-r3.js` (`data-gv-auth-signin`, and `data-gv-auth-signup`, which opens Cognito's `/signup` page with the same request). Cognito, the user pool, the app client and OAuth settings are unchanged.
- Saved trips were removed from the website: no Save buttons, no My Trips page (`my-trips.html`, `saved-trips.html` and `/react/my-trips/` open Account). The saved-trips backend and stored data are unchanged.
- Photos in `assets/images/cinematic/` are Pexels-licensed; sources in `sources.json`.
- Tests: `tests/frontend/account-lifecycle-browser.test.cjs` (sign-in, sign-up, callback, session persistence, sign-out, guest-to-member, removed saved trips).
