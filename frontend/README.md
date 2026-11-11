# GlobeVoy frontend layout

The HTML files in this directory are the public classic entry points. Their location preserves URLs such as `/index.html`, `/about.html`, `/auth-callback.html` and `/trip.html`; it is not a second copy of `pages/`.

| Location | Role |
| --- | --- |
| Root HTML | Current public pages and intentional React/auth entry redirects |
| `pages/` | Only three still-linked legacy screens: `explore-curated.html`, `multi-city-results.html`, `trip-detail-single.html` |
| `runtime/` | Public environment selection and API configuration |
| `scripts/`, `styles/`, `assets/` | Browser behavior, CSS and public assets |
| `validation/`, `screenshots/` | Validation/evidence, excluded from production packaging |
| `../web/` | React account, My Trips, travel profile and journey implementation, exported under `/react/` |
| `../archive/frontend/design-pages/` | Older design/state screens, preserved for reference and excluded from deployment |

There is one active About implementation: `about.html`. The older `pages/about.html` design now lives in the archive. Other unused login/settings/loading/error mockups are archived too.

Affiliate, privacy, terms, stays and advanced-search content were previously behind root redirects. Their actual HTML now lives at `affiliate.html`, `privacy.html`, `terms.html`, `stays.html` and `ask.html`. Asset paths and shell depth were adjusted; their content and existing legacy button behavior are retained. `create-account.html` remains the browser-only travel-profile flow; real account sign-in/signup belongs to the React/Cognito flow.

Old `/pages/...` URLs remain available in release output as small generated redirects to current pages. `ops/frontend/page-layout.json` records the complete mapping and archive hashes; `ops/frontend/page-layout.mjs` generates compatibility pages during packaging. Do not recreate copies of archived designs to restore old links.

The three retained legacy screens are still reached by `scripts/clean-routing.js`; converting them into newer application flows is separate feature work. They were not silently deleted or replaced with unrelated routes.

Run `npm run test:repo` and `npm run test:frontend`. For deployment-layout preview, build the normal production artifact and serve the generated output over HTTP; this includes compatibility URLs and React assets. A raw source-folder server is sufficient for root/retained legacy HTML, but does not generate old URL aliases or build React. Source changes do not deploy the live website.
