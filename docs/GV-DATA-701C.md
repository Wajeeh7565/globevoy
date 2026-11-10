# GV-DATA-701C — Frontend Worldwide Registry Contract

## Objective

Expose the read-only GV-DATA-701B worldwide city registry through the existing browser API client without replacing Globevoy's proven local origin autocomplete or changing recommendation behavior.

## Why this is intentionally small

The homepage already loads `runtime/supported-origins.js`, which contains the worldwide origin-search surface. A second autocomplete implementation would duplicate data, create competing ranking rules, and risk visible regressions.

701C therefore adds a reusable frontend contract only.

## Browser API

`window.GlobevoyApi` now exposes:

- `getWorldwideCityRegistry(params)`
- `searchWorldwideCities(params)`
- `resolveWorldwideCity(input, countryCode)`
- `worldwideRegistryContractVersion = "GV-DATA-701C"`

All calls use Globevoy's configured backend URL and the existing GET-only JSON helper.

## Trust boundaries

701C does not:

- change `supported-origins.js`;
- change homepage autocomplete ranking or rendering;
- promote worldwide origin-only cities into the curated 1,000 destinations;
- change destination activation;
- change generated-tour ranking, prices, dates, or itinerary construction;
- call provider APIs directly;
- store provider credentials in the browser.

The backend remains authoritative for worldwide/curated/activation distinctions, and exact itinerary verification remains mandatory.

## Validation

`frontend/validation/validate-gv-data-701c.js` confirms:

- the 701C contract marker;
- both search and resolve methods;
- the exact `/api/worldwide-city-registry` path;
- GET-only behavior;
- country-code normalization for resolve;
- blank resolve fails before network access;
- no DOM mutation was added to the API client;
- existing generated-tour API method remains present;
- no obvious credential literals are introduced.

## Deployment boundary

This change is frontend contract plumbing only. It does not deploy production or staging by itself. On the isolated staging Amplify app, the existing `apiBaseUrl` points to the staging Lambda where GV-DATA-701B is available.

## Next step

GV-DATA-701D or GV-REC-702 can consume this contract for carefully scoped worldwide UI features. Any visible autocomplete change should be separately validated rather than bundled into the data-foundation work.
