# GV-DOCKER-004 — Lambda reuse and parity report

Source/local validation only: no AWS resources, credentials, provider settings or
production website changed. This PR depends on unmerged PR #131; it does not merge it.

## Verified deployment

Read-only audit matched the expected account (suffix 3409), us-east-2 and zero
running/pending Fargate demo tasks. Downloaded code ZIPs were checked against AWS
CodeSha256 before examining handlers/modules. ZIPs and detailed evidence stay ignored.

| Environment | Function / handler | Revision | API |
| --- | --- | --- | --- |
| Production | globevoy-recommendations / src/lambda.handler | 61e921bd-f822-4f88-8415-3457cf7baae5 | https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws |
| Active staging | globevoy-staging-api / staging-lambda-702d.handler | 52b2ba60-fc42-414e-94f0-f794ef019f4c | https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws |
| Older clone, not selected | globevoy-recommendations-staging / lambda.handler | 2033b56b-2b48-490c-b4d1-dbd138ab9cd5 | https://coif6q5jgbszk7vl2vdzgy4l6y0ayzrb.lambda-url.us-east-2.on.aws |

Only nonsecret flags, public OAuth settings, code and metadata were inspected.
No secret values, users, customer records or tokens were read. No live recommendation,
generated-tour/provider search or hotel PREBOOK was invoked. Configured flags do not
prove provider credential validity or successful pricing.

## Capability matrix

| Capability | Production | Active staging | Fargate demo origin |
| --- | --- | --- | --- |
| Recommendations/multi-city/generated tour | Deployed; generation, discovery and integrity flags on | Deployed; staged recovery/automatic-date overlays configured | Browser CORS blocked |
| Cognito/session | Enabled embedded production build; canonical session without bearer returns 401 | Separate staging identity; staging session without bearer returns 401 | Origin rejected; callback not allowlisted |
| Saved trips/profile | Production wrapper, JWT verification, ownership and dedicated production table selection present | Separate existing staging implementations | No in-place access; explicit canonical-site navigation only |
| Agoda/Aviasales handoffs | Existing partner links and Agoda handoff/price-integrity flags on | Existing links and guest-context rules retained | Local guest estimates retain checks; live booking untested |
| Booking-time revalidation | Packaged module is NOT routed by production entry; safe GET falls through legacy validation (400, no booking header) | Handler installed; safe GET is 405 with GV-WEB-707B header | Unavailable; no proxy or promotion |
| Duffel final-schedule pilot 684A | Public/live/shadow flags on; airport allowlist YYZ; provider results not tested | Pilot/live/shadow flags on; staged origin/budget/adult overlays installed | No calls enabled here |
| Duffel P2 683H | Explicit enable/activation flags unset; canary authorization still required | Explicit enable/activation flags unset; exact-three performance flag is independent | Disabled; no canary spoofing |
| Nuitee 712 | Packaged, flag unset, secret-reference keys absent | Flag on and sandbox secret-reference key present; Rates/PREBOOK untested | Disabled; no secret access |
| React Leaflet/OSM | Existing repository/export component | Same component | Actual Leaflet 1.9.4 rendered with markers, zoom and attribution; fixture tiles |
| Classic Google Maps | Existing restricted-key deployment path | Unchanged | Unconfigured; no new key or maps service |

Production's embedded account build selects the production table. Staging installs
the ordered overlays; production's wrapper delegates public routes to legacy Lambda
and privately routes only session/saved trips/profile. Both packages contain Nuitee
GV-LIVE-712 code, demonstrating why packaged presence alone is insufficient.
Existing caps, bounded concurrency/retries, party restrictions, cache/freshness,
offer sanitization, price labels and revalidation rules are untouched. P2 keeps its
hard request cap 12 and concurrency 2. Nuitee keeps five-minute freshness and no
BOOK/payment/reservation implementation. No staging-only capability is promoted.

## Live, provider-free boundary probes

| Origin | Production registry | Production session | Saved-trip OPTIONS |
| --- | --- | --- | --- |
| http://globevoy-demo.test:8787 | 200 with no Allow-Origin (browser cannot read) | 403 origin-not-allowed | 403 |
| https://globevoy.com | 200, matching Allow-Origin | 401 without bearer | 204 |

Staging rejects all three demo-origin probes with 403. At its approved HTTPS origin,
registry is 200, session without bearer is 401 and saved-trip OPTIONS is 204.
Function URL AuthType NONE does not remove application JWT checks.
Production Cognito allows existing canonical/WWW callback and logout URLs; staging
allows its existing Amplify URLs. Both retain code/PKCE and existing scopes. No demo
callback is allowed. Production account CORS is canonical, so WWW must redirect before
PKCE state. No fresh authenticated CRUD, signup, expiry/revocation or provider test
was run against AWS; maintained offline security/provider regressions ran instead.

## Implemented integration

Three explicit Docker build targets reuse the maintained policy factory, release
identifiers and existing classic/React API, auth, snapshot and booking clients:

| Target | Required frontend origin | Destination |
| --- | --- | --- |
| isolated (default) | Exact configured local/demo origin | Local prototype; accounts off |
| production | https://globevoy.com | Existing production Lambda/Cognito |
| staging | https://staging.dy4fw8gx1ccie.amplifyapp.com | Existing active staging Lambda/Cognito |

Selection occurs before Next compilation and classic composition. Actual chunks and
files are scanned for opposite-environment destinations, distinguishing descriptive
guard text from endpoints. Connected builds reject demo HTTP origins, mismatched
manifests and unknown Host values; WWW redirects before HTML. TLS termination must
preserve Host. Both connected profiles disable local development API overrides.

There is NO proxy, Origin spoofing, token forwarding, CORS relaxation, credential
injection or silent backend fallback. Connected local /api requests return JSON 409;
/health stays local. Isolated mode explicitly links to the existing secure canonical
account site with noopener/noreferrer and no trip/query/token transfer. The banner
distinguishes verified React Leaflet from unconfigured classic Google Maps. Connected
banners describe selection/checks, not untested production parity.

## Date fix

The YYZ/CAD 2500/March 2027/one passenger/seven nights case has four- and three-night
stays. Missing leg dates previously used two-day offsets (March 8/10/12), conflicting
with those stays. Missing planning dates now follow allocated nights (March 8/12/15).
Official/provider dates retain precedence and incompatible observations still fail
the unchanged consistency guard. Tests cover representative routes, a month boundary
and conflicting evidence. Budget/pricing rules are unchanged. This fixes source/local
images; the deployed Lambda remains unchanged pending a separate backend release.

## Build/test without deployment

```powershell
docker build -f Dockerfile.fargate-demo --build-arg GLOBEVOY_LAMBDA_TARGET=isolated -t globevoy-gv004:isolated .
docker run --rm --name gv004-local -p 127.0.0.1:18804:8787 -e GLOBEVOY_DEMO_ORIGIN=http://127.0.0.1:18804 globevoy-gv004:isolated
```

Open http://127.0.0.1:18804/. In a second terminal:

```powershell
New-Item -ItemType Directory -Force .cache/gv004-site | Out-Null
docker cp gv004-local:/app/.cache/fargate-demo-site/. .cache/gv004-site
$env:GLOBEVOY_DOCKER_ARTIFACT=(Resolve-Path .cache/gv004-site).Path
$env:GLOBEVOY_SITE_ROOT=$env:GLOBEVOY_DOCKER_ARTIFACT
$env:GLOBEVOY_DEMO_TEST_URL='http://127.0.0.1:18804'
$env:GLOBEVOY_DEMO_BROWSER_CHANNEL='msedge'
node ops/docker/cache-map-test-assets.mjs
node --test tests/release/docker-artifact.test.mjs
node scripts/run-tests.mjs demo demo-browser
docker stop gv004-local
```

Map tests cache the existing Leaflet 1.9.4 JS/CSS with release SRI checks and intercept
OSM tiles; no live/bulk tile test. [Pinned Leaflet guide](https://github.com/Leaflet/Leaflet/blob/v1.9.4/docs/examples/quick-start/index.md).
Build connected artifacts for offline validation only:

```powershell
docker build -f Dockerfile.fargate-demo --build-arg GLOBEVOY_LAMBDA_TARGET=production -t globevoy-gv004:production .
docker build -f Dockerfile.fargate-demo --build-arg GLOBEVOY_LAMBDA_TARGET=staging -t globevoy-gv004:staging .
node --test tests/release/docker-lambda-targets.test.mjs
node --test tests/backend/generated-tour-planning-dates.test.cjs
npm test
npm run test:account
npm run test:providers
npm run test:release
```

CI builds/scans all three images and runs Save/My Trips/Delete against the actual
production-target artifact with all API/auth requests intercepted; it calls no AWS.

## Remaining approval gates

Current safest demo: isolated frontend plus explicit canonical account navigation.
In-place parity at demo.test is intentionally blocked by CORS, application origin
checks and callbacks. Changing Function URL CORS alone cannot enable private routes.
A future connection needs reviewed HTTPS hosting at the existing approved origin,
or separately approved narrow backend/callback support for a new HTTPS preview.
Neither is an AWS change here. Preserve current Amplify/Lambda and DNS until then.
Later publication needs pinned hashes, real PKCE/CRUD/ownership acceptance with existing
synthetic users, provider-specific approval and a content/task rollback plan.
No production/provider/full-security acceptance is claimed by this source-only PR.
