# GlobeVoy frontend layout

Edit classic HTML in `pages/`. The frontend root contains this guide, the favicon and folders, with no loose HTML files.

```text
frontend/
  pages/       All 25 active classic HTML files
  assets/      Images, icons and fonts
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

All 22 public entry pages now live alongside the three still-linked legacy screens in `pages/`. The three legacy screens are `explore-curated.html`, `multi-city-results.html` and `trip-detail-single.html`; they remain active because `scripts/clean-routing.js` still reaches them.

`pages/create-account.html` is the existing browser-local travel-profile flow. Real account signup/sign-in and private trip/profile pages use the React/Cognito implementation in `web/`. This organization does not change those features.

## Source paths and website addresses

Source folders are for navigation; the build controls public URLs. For example:

| Edit source | Published address |
| --- | --- |
| `pages/index.html` | `/index.html` |
| `pages/about.html` | `/about.html` |
| `pages/auth-callback.html` | `/auth-callback.html` |
| `pages/multicity-visualizer.html` | `/multicity-visualizer.html` |
| `pages/explore-curated.html` | `/pages/explore-curated.html` (existing legacy address) |
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
