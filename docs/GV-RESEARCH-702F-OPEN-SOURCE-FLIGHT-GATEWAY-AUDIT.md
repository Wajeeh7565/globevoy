# GV-RESEARCH-702F — Open-source flight and gateway architecture audit

Status: research-only
Date: 2026-08-20
Base: staging @ b5da4d0268d30cee927bf62593d8caf321408410
Production/runtime impact: none

## Executive conclusion

Globevoy should **not** replace its current flight stack with a random open-source flight-search project. The strongest useful pieces are narrower:

1. **Keep Globevoy's existing provider-neutral evidence contract.** It already distinguishes LIVE_PROVIDER, CACHED_PROVIDER, TEST_ONLY and UNAVAILABLE.
2. **Keep Duffel as the exact-date live verification layer.** Globevoy's existing 683D adapter already implements a guarded, search-only Duffel offer-request flow with live-mode validation, offer-expiry checks and rate-limit metadata.
3. **Correct the meaning of a Travelpayouts miss.** Positive Travelpayouts observations are already stored as CACHED evidence, but the 668E coverage verifier currently turns a cache miss into `providerMappingVerified:false` and production ineligibility. That conflates “no recent cached observation” with “invalid provider mapping.”
4. **Use OurAirports as an airport/gateway enrichment source, not a flight-availability source.** Its public-domain airport data includes coordinates, IATA/ICAO identifiers, municipality, airport type and scheduled-service signals.
5. **Improve gateway selection with a geographic candidate index and explicit scoring.** Globevoy already has a nearest-gateway fallback and several hand-authored gateway overrides, but the current automatic fallback is mostly distance + same-country preference. A static KNN index such as KDBush/geographic helpers can cheaply generate better candidate sets.
6. **Do not use OpenFlights routes as current-service evidence.** Its route database stopped being updated in June 2014.
7. **Do not build the production core around scraped Google Flights/Kiwi/Skiplagged community wrappers.** They can be useful for experiments, but they are brittle and create avoidable operational/terms-of-service risk.

Recommended next implementation task: **GV-REC-702F — cache-miss semantics + gateway candidate enrichment**, staging-only first.

---

## What Globevoy already has

### Provider-neutral evidence model

`backend/services/flight-provider-contract-683c.js` already models:

- `LIVE_PROVIDER` → decision-grade
- `CACHED_PROVIDER` → planning-only
- `TEST_ONLY`
- `UNAVAILABLE`

This is the correct conceptual model. A new architecture does not need to be invented.

### Travelpayouts positive-result semantics

`backend/services/cheap-one-way-flights.js` already writes Travelpayouts observations with:

- `sourceType: SOURCE_TYPES.CACHED`
- provider-backed evidence
- retrieval timestamps / cache metadata

So the positive-result side is already honest.

### Actual weak point

`backend/services/provider-live-coverage.js` currently does this when Travelpayouts returns no observations:

- status: `no-live-observations`
- `productionEligible: false`
- `providerMappingVerified: false`

This is too strong for a cache-based provider. A missing cache observation does not prove the static destination mapping is wrong and does not prove no flight can be booked.

### Existing Duffel implementation

`backend/services/duffel-live-adapter-683d.js` is already a good foundation:

- exact-date `/air/offer_requests`
- live-token enforcement
- `live_mode` verification
- exact origin/destination/date matching
- expiring-offer safety margin
- no order/payment/ticket capability
- rate-limit metadata capture
- fail-closed behavior

The official Duffel SDK is useful as a reference, but adopting it is not necessary just to get sound live-search behavior.

### Existing gateway logic

Globevoy already has two gateway mechanisms:

1. `route-feasibility.js` contains explicit practical gateway overrides, e.g. Lucca→Pisa, Tulum→Cancun, Caye Caulker→Belize City.
2. `global-route-graph.js` has automatic `nearestGateway()` logic that searches the wider catalogue, preferring same-country candidates and scoring mainly by geographic distance plus a small quality penalty.

This is a strong starting point, but not yet enough for global small-destination coverage.

---

## Repository / project audit

### 1. duffelhq/duffel-api-javascript
URL: https://github.com/duffelhq/duffel-api-javascript
License: MIT
Status: active; recent 2026 releases
Usefulness: **HIGH**

Useful for:
- canonical request/response patterns
- versioning and error handling
- current Stays and Flights model changes
- regression reference for Duffel payloads

Recommendation:
- use as a reference and test oracle;
- do not replace Globevoy's current guarded adapter just to use the SDK.

### 2. duffelhq/duffel-api-python examples
URL: https://github.com/duffelhq/duffel-api-python
Usefulness: **MEDIUM-HIGH**

Useful for:
- simple end-to-end offer-request examples
- confirming the intended search → inspect offer → order lifecycle

Recommendation:
- reference only; Globevoy is Node-based and already has a stronger safety boundary.

### 3. davidmegginson/ourairports-data
URL: https://github.com/davidmegginson/ourairports-data
License: Unlicense / public domain
Status: active, community-maintained; data published through OurAirports
Usefulness: **VERY HIGH**

Important fields:
- airport type
- latitude / longitude
- municipality
- ISO country / region
- IATA / ICAO / GPS / local codes
- `scheduled_service`
- runway and frequency companion datasets

Best use in Globevoy:
- enrich airport identity and gateway candidates;
- generate candidate airports around a destination;
- distinguish scheduled-service airports from tiny/private/non-service facilities;
- pin a dated snapshot + checksum in the repo/build pipeline.

Do **not** treat the dataset as proof of current airline inventory.

### 4. mourner/kdbush (+ geographic KNN helpers)
URL: https://github.com/mourner/kdbush
License: ISC
Usefulness: **HIGH**

Why it fits:
- airport coordinates are static points;
- index is compact and immutable;
- fast radius / nearby queries;
- ideal for precomputing nearby airport candidates for 1,000 curated cities.

Recommendation:
- either use KDBush/geographic KNN at build time, or copy the conceptual approach and precompute a small `gateway-candidates-*.json` artifact.
- prefer build-time candidate generation over scanning tens of thousands of airports on every Lambda request.

### 5. mourner/flatbush / geoflatbush
URL: https://github.com/mourner/flatbush
Usefulness: **MEDIUM**

Useful if Globevoy later indexes geographic boxes or regions. For airports (points), KDBush is simpler.

### 6. travelpayouts/api-docs
URL: https://github.com/travelpayouts/api-docs
Usefulness: **VERY HIGH as semantics reference; LOW as live availability source**

Official docs explicitly describe Flight Data API results as cached data and recommend the API for travel insights/static pages. Some endpoints are based on prices found by users during recent search windows.

Recommendation:
- keep Travelpayouts as cheap discovery / cached planning evidence;
- cache miss should mean `NO_RECENT_CACHE_OBSERVATION`, not invalid mapping and not global unavailability;
- use its nearest-places endpoint only as another cached discovery hint, never as live truth.

### 7. jpatokal/openflights
URL: https://github.com/jpatokal/openflights
License: AGPL-3.0
Usefulness: **LOW for current routing; MEDIUM for historical/testing**

Critical limitation:
- OpenFlights warns that the third-party route source stopped updates in June 2014.

Recommendation:
- do not use `routes.dat` to claim that a route currently operates;
- potentially useful as a synthetic/historical graph for algorithm tests only.

### 8. amadeus4dev/amadeus-node + amadeus-code-examples
URLs:
- https://github.com/amadeus4dev/amadeus-node
- https://github.com/amadeus4dev/amadeus-code-examples
License: MIT
Status: archived / no longer a strategic active SDK path
Usefulness: **MEDIUM as reference only**

Useful for:
- provider abstraction patterns
- OAuth/token lifecycle examples
- flight offer normalization examples

Recommendation:
- do not make this a new Globevoy dependency/provider strategy.

### 9. openskynetwork/opensky-api
URL: https://github.com/openskynetwork/opensky-api
License: GPL-3.0
Usefulness: **LOW for shopping; potentially useful later for operational/research context**

It provides ADS-B/state/track observations, not bookable fares or commercial schedules. Documentation also notes non-commercial/research constraints for the live data service.

Recommendation:
- not part of 702F and not a replacement for Duffel/Travelpayouts.

### 10. adsblol/api
URL: https://github.com/adsblol/api
License: BSD-3-Clause
Usefulness: **LOW for shopping; MEDIUM for future flight-status/reality checks**

Useful for live aircraft / plausible route observation, not fare inventory.

Recommendation:
- future operational enrichment only, never booking evidence.

### 11. borski/travel-hacking-toolkit
URL: https://github.com/borski/travel-hacking-toolkit
License: MIT
Usefulness: **MEDIUM as architecture inspiration**

Interesting idea:
- explicitly treats flight search as multi-source and documents fallback/resilience rules.

Caution:
- includes browser automation and unofficial/keyless data paths that are not appropriate as Globevoy's production truth layer.

Recommendation:
- borrow the provider-priority/fallback thinking, not the scraping stack.

### 12. bokangsibolla/duffel-mcp
URL: https://github.com/bokangsibolla/duffel-mcp
Usefulness: **MEDIUM as safety-pattern reference**

Good pattern:
- read-only flight/stay search tools;
- booking intentionally excluded pending explicit human confirmation.

Recommendation:
- aligns with Globevoy's current referral/search-first safety model; no need to adopt the MCP server itself.

---

## Reddit / developer-community signal

Recent developer discussions reinforce three themes:

1. Small travel products struggle to get broad, low-friction access to a single complete booking API.
2. Duffel is repeatedly described as relatively straightforward for live flight search, but developers still encounter airline/content gaps.
3. Multi-source normalization and fallback logic are more important than finding one “perfect” API.

Community reports are anecdotal and must not override provider documentation, but they support a multi-provider evidence architecture.

---

## Recommended Globevoy architecture

### Layer A — destination/airport foundation

Curated Globevoy city registry
→ OurAirports enrichment
→ candidate airports / metro codes / practical gateways

A gateway candidate should carry:
- airport IATA
- distance from destination
- scheduled-service flag
- airport type
- same-country / cross-border status
- whether it is the city's own airport or a gateway
- estimated access mode/time when known
- provenance/version

### Layer B — cached discovery

Travelpayouts

Positive result:
- `CACHED_PROVIDER`
- planning-only evidence

Empty result:
- `NO_RECENT_CACHE_OBSERVATION`
- static provider mapping remains independently valid if 668B mapping is valid
- do not infer “no flights exist”

Provider/network error:
- `PROVIDER_ERROR`
- separate from cache miss

### Layer C — exact live verification

Duffel exact-date offer request

Positive valid live offer:
- `LIVE_PROVIDER`
- decision-grade for the searched itinerary

No live offer:
- `NO_LIVE_OFFER_FOR_SEARCHED_ITINERARY`
- scoped to origin/destination/date/passengers
- not global destination unavailability

### Layer D — ranking/trust

Discovery can include cities with planning-only evidence.
Before a route is presented as live/verified:
- exact itinerary verification must pass;
- live pricing evidence must match dates/currency/party;
- gateway access burden must pass comfort limits.

---

## Gateway candidate scoring proposal

Do not choose the nearest airport by distance alone.

Generate 3–8 nearby candidates, then score using:

1. valid IATA code required for commercial flight search;
2. `scheduled_service=yes` strongly preferred;
3. large/medium airport preferred over small airport when distance difference is reasonable;
4. exact/local airport bonus;
5. practical known gateway bonus;
6. same-country preference, but **not a hard rule**;
7. ground/ferry transfer time penalty;
8. cross-border/visa complexity penalty when applicable;
9. provider mapping support bonus;
10. live Duffel offer availability only at exact-itinerary verification time.

This avoids errors such as choosing a geographically close but impractical airport while also allowing a nearby cross-border hub when it is genuinely the practical gateway.

---

## Concrete 702F implementation proposal

### 702F-A — semantics correction (highest priority)

Change the Travelpayouts verification result model so a cache miss does not set static mapping verification to false.

Suggested split:

- `staticProviderMappingVerified`
- `cacheObservationStatus`
  - `cached-observation`
  - `no-recent-cache-observation`
  - `provider-error`
- `liveExactVerificationStatus`
  - `not-run`
  - `live-offer-found`
  - `no-live-offer-for-searched-itinerary`
  - `provider-error`

No production activation change in the first PR.

### 702F-B — airport/gateway enrichment

Research/build-time only:
- ingest a pinned OurAirports snapshot;
- filter/normalize candidate airports;
- build a static nearest-airport index;
- generate candidate gateways for the curated 1,000 cities;
- compare against existing manual gateway overrides;
- output review CSV/JSON, no runtime selection change yet.

### 702F-C — controlled gateway QA

Use a bounded set of difficult destinations:
- islands
- small regional airports
- border cities
- destinations with prior `missing-flight-observations`

For each city compare:
- old destination code
- existing manual/static gateway
- new candidate list
- Travelpayouts cached signals
- Duffel exact-date live verification where authorized

### 702F-D — staging route integration

Only after reviewed candidate accuracy is high:
- expose the reviewed gateway candidates to staging route generation;
- exact itinerary verification still required;
- no automatic city activation solely from OurAirports or cached Travelpayouts data.

---

## What not to do

- Do not promote all 1,000 cities simply because an airport mapping exists.
- Do not turn a Travelpayouts cache miss into “flight unavailable.”
- Do not use OpenFlights 2014 route data as current service evidence.
- Do not scrape Google Flights or airline websites as Globevoy's core provider layer.
- Do not add OpenSky/ADSB data to ranking as if aircraft movement proves bookable inventory.
- Do not replace existing manual gateway overrides until the generated candidates have been compared against them.
- Do not copy third-party repositories wholesale; reuse ideas and permissively licensed components only where they reduce complexity.

---

## Decision

Proceed with **702F-A first**, followed by **702F-B**.

This gives Globevoy a larger improvement than continuing city-by-city activation recovery because it fixes the root interpretation problem and improves the gateway foundation for the entire 1,000-city surface.

Production remains unchanged until separate staging validation and explicit promotion approval.
