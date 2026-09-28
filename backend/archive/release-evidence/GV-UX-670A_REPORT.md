# GV-UX-670A — Map-First Three Picks

## Outcome

GV-UX-670A converts the generated-tour visualizer from a single selected route into a map-first comparison experience with three distinct recommendation roles:

1. Lowest cost
2. Best balance
3. Most memorable

The selected recommendation controls the map, summary and detailed itinerary. The release preserves the current referral-first booking model and all production activation, budget, date, occupancy and origin-integrity rules.

## Protected baseline

- Frontend baseline: GV-PROD-669E AWS-ready complete frontend
- Backend baseline: GV-PROD-669F
- City activation: GV-CITY-668T
- Audited cities: 1,000
- Production-active cities: 439
- Unaudited cities: 0

## Backend changes

File changed:

- `generated-tour.js`

New backend version:

- `2.7.0-gv-ux-670a-map-first-three-picks`

Feature flag:

- `ENABLE_MAP_FIRST_THREE_PICKS_670A=true`

Behaviour:

- Accepts `routeRole` / `pickRole` requests for `lowest-cost`, `best-balance` and `most-memorable`.
- Scopes already budget-safe and route-feasible candidates to the requested recommendation role.
- Adds explicit role metadata to the selected visualizer tour.
- Exposes `pickRoleMatched=false` when a requested role cannot be satisfied instead of silently pretending that another route matches.
- Leaves legacy selection behaviour unchanged when the feature flag is disabled.

No city activation, provider verification, hotel quality, flight comfort or budget threshold was relaxed.

## Frontend changes

Files changed or added:

- `multicity-visualizer.html`
- `scripts/multicity-visualizer-670a.js`
- `styles/map-first-three-picks-670a.css`
- `runtime/config.js`

Experience:

- Large recommendation cards on the left and a large sticky route map on the right.
- Recommendation roles, large photography, reason for selection, total estimate, nights, stops and traveller count.
- Best balance selected by default when available.
- Selecting a recommendation updates the map, selected summary and itinerary.
- Three role requests run in parallel and duplicate route structures are removed.
- Globevoy shows fewer than three routes when fewer than three distinct routes pass rather than inventing filler recommendations.
- Mobile layout places the map first and the recommendation cards below it.
- Existing route controls, exact-date wording, gateway wording, saved-route restoration, booking links and photo fallbacks are preserved.

## Validation completed locally

- GV-UX-670A backend checks: 29/29 passed.
- GV-CITY-668T regression: 76/76 passed.
- Backend JavaScript syntax: 96/96 passed.
- Frontend JavaScript syntax: 41/41 passed.
- Frontend HTML pages checked: 56.
- Local frontend references checked: 322.
- Missing local references: 0.
- ZIP integrity and package-root checks: passed.

## Important operational note

The three recommendations require up to three generated-tour API calls per page load. They are sent in parallel, but this still increases Lambda and provider workload compared with the one-route visualizer. Production monitoring should track latency, error rate and provider-call volume.

## Honest limitation

A local rendered-browser screenshot was not completed because the build environment blocked browser navigation to local files and localhost. The release therefore still requires the supplied deployment smoke and manual desktop/mobile browser checklist after AWS deployment.

## Rollback

- Frontend rollback: `frontend-staging-gv-prod-669e-aws-ready-complete.zip`
- Backend rollback: `lambda-gv-prod-669f-origin-display-integrity.zip`
- Disable `ENABLE_MAP_FIRST_THREE_PICKS_670A` to restore legacy backend selection while retaining the deployed code.
