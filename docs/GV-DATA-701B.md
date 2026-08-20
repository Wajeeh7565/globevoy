# GV-DATA-701B — Worldwide Registry Staging API

## Objective

Expose the GV-DATA-701A layered worldwide registry through the isolated Globevoy staging Lambda so the new contract can be tested safely before any production routing or frontend integration.

## Endpoint

```text
GET /api/worldwide-city-registry
```

This endpoint exists only in `staging-lambda.js` for 701B. The verified production `lambda.js` is intentionally unchanged.

### Summary

With no query parameters the endpoint returns the layered registry summary:

- worldwide identity/origin count;
- curated destination count;
- selected verified-activation snapshot count;
- trust-layer descriptions;
- exact-verification disclaimer.

### Resolve one city

```text
GET /api/worldwide-city-registry?resolve=Toronto&countryCode=CA
```

Resolution can return worldwide identity/origin metadata even when a city is outside the curated destination layer. The response clearly indicates whether the city is curated and whether it is activation-approved.

### Search

```text
GET /api/worldwide-city-registry?q=Toronto&scope=all
GET /api/worldwide-city-registry?scope=origin&limit=25
GET /api/worldwide-city-registry?scope=destination&limit=25
GET /api/worldwide-city-registry?scope=active&limit=25
```

The underlying 701A service clamps result limits to 100.

## Feature boundary

The query/resolve API is enabled with:

```text
ENABLE_WORLDWIDE_CITY_REGISTRY_701A=true
```

When the flag is off, query/resolve requests fail closed with `status: feature-disabled` and return no worldwide records. The no-query summary remains available as a read-only diagnostic so operators can see the registry layers without activating lookup behavior.

## Staging isolation

701B deliberately intercepts only `/api/worldwide-city-registry` inside the isolated staging entrypoint.

All existing paths continue through the verified production handler after the existing exact-origin CORS validation and internal staging-origin rewrite.

The endpoint:

- requires the configured staging browser Origin;
- accepts GET only;
- makes no live-provider request;
- changes no generated-tour path;
- changes no recommendation ranking;
- contains no provider/API credential;
- adds `X-Globevoy-Data: GV-DATA-701B` for diagnostics.

## Trust boundary

Worldwide registry membership never means live travel inventory.

The API preserves these separate meanings:

1. worldwide identity/origin;
2. curated destination candidate;
3. production-active sampled provider capability;
4. mandatory exact itinerary verification.

A raw worldwide city outside the curated 1,000 remains `origin-only` and cannot become a destination merely because it resolves through this endpoint.

## Validation

`validate-gv-data-701b.js` checks:

- API/version markers;
- 9,665 worldwide identity records;
- 1,000 curated destination records;
- 439 production-active records under the focused 668T validation environment;
- staging CORS and diagnostic headers;
- Toronto → YYZ integrity;
- Lahore worldwide origin resolution;
- destination and active scope filtering;
- GET-only behavior;
- unknown/missing browser-origin rejection;
- feature-off fail-closed behavior;
- delegation of existing staging routes back to the verified production handler.

Both normal GitHub validation and staging-backend packaging run the 701A/701B validations before an artifact is accepted.

## Deployment boundary

701B is not an automatic deployment.

After feature → staging CI is green, a staging backend package may be deployed to `globevoy-staging-api` and the single staging variable `ENABLE_WORLDWIDE_CITY_REGISTRY_701A=true` may be added for API smoke testing.

Do not deploy `staging-lambda.js` to production. Production promotion of the worldwide API should be a separate reviewed task after the staging contract is proven.
