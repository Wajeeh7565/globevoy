# GV-REC-702F-C — Gateway Foundation Triage 50

## Purpose

Turn the corrected GV-REC-702F-B-R1 50-city airport/gateway review queue into a deterministic triage report before any mapping correction is proposed.

702F-C is **not a route rewrite**. It separates different failure modes so Globevoy does not respond to every airport-data warning by simply choosing the nearest scheduled-service airport.

## Input

702F-C regenerates the 702F-B-R1 review from the same immutable OurAirports snapshot:

- repository: `davidmegginson/ourairports-data`
- commit: `55fd4071c99668a29f9d3625d72405c44074ef2f`
- `airports.csv` Git blob: `b95a254e2d970ecb37320d645abced90c6d1a95f`
- size: `12,703,718` bytes

The corrected R1 audit includes scheduled passenger heliports and produces exactly **50** review rows. Tasiilaq/AGM is no longer in the queue.

## Triage buckets

Rows can be assigned to:

- `registry-integrity-hold`
- `operational-airspace-hold`
- `strong-replacement-candidate`
- `local-service-revalidation`
- `regional-gateway-manual-review`
- `long-distance-gateway-manual-review`
- `cross-border-gateway-manual-review`
- `preserve-existing-gateway-review`
- `nearby-alternative-review`
- `alternative-gateway-manual-review`
- `source-disagreement-or-code-retirement`
- `no-nearby-candidate`
- `manual-review`

No bucket automatically changes a route.

## Reviewed special-case context

Eight rows use reviewed context before the generic geographic rules.

### Registry-integrity holds

#### Saint Martin

Globevoy's stored destination coordinates are around `-26.234987,28.200738`, while Grand Case-l'Espérance Airport (`SFG`) is in Saint Martin at approximately `18.100057,-63.047444` and OurAirports reports airline service. The apparent Johannesburg alternative is therefore a coordinate artifact.

Evidence: <https://ourairports.com/airports/TFFG/>

#### Umueri

Globevoy stores Umueri with a west-negative longitude and preferred code `ANA`, which resolves to an unrelated airport in the pinned data. Chinua Achebe International Cargo Airport is in Umueri, uses ICAO `DNAN`, and the airport authority reports scheduled commercial passenger service. OurAirports places DNAN at approximately `6.267167,6.871333` and does not list an IATA code.

Evidence:

- <https://caica.anambrastate.gov.ng/about-us/>
- <https://caica.anambrastate.gov.ng/flights/>
- <https://ourairports.com/airports/DNAN/>

This requires coordinate and provider-code strategy review; 702F-C does not invent an IATA code.

#### Sun City

The registry coordinates make Pilanesberg International Airport (`NTY`) appear roughly 108 km away. Sun International's current fact finder states Pilanesberg International Airport is **8 km** from Sun City. The destination coordinates must therefore be reviewed before replacing NTY with a different airport.

Evidence: <https://www.suninternational.com/content/dam/approved/customer-zone/fact-sheets/sun-city-fact-finder.pdf>

#### Khost

Globevoy stores Khost near `35,72`, while OurAirports places Khost International Airport (`KHT`) at approximately `33.284605,69.807340` and reports airline service. The large apparent distance between Khost and KHT is a registry-coordinate problem.

Evidence: <https://ourairports.com/airports/OAKS/>

### Operational airspace holds

The following four Ukrainian rows are held rather than remapped:

- `kharkov-ua`
- `kyiv-ua`
- `odessa-ua`
- `vinnytsia-ua`

On 10 July 2026, the Cabinet of Ministers of Ukraine stated that Ukraine's airspace remains closed to civil aviation and that the adopted aviation decisions prepare for future reopening rather than near-term resumption.

Evidence: <https://www.kmu.gov.ua/en/news/uriad-ukhvalyv-stratehichni-rishennia-dlia-rozvytku-tsyvilnoi-aviatsii-ukrainy>

A geographically nearby airport, especially across a border, must not be treated as an automatic substitute for a closed-airspace destination.

## Generic triage rules

After reviewed holds:

1. no bounded candidate → `no-nearby-candidate`;
2. documented scheduled-service gateway plus a new alternative → preserve the existing gateway for review;
3. preferred code absent from the pinned source → source/code-status review;
4. preferred airport reports no scheduled service:
   - same-country large/medium candidate within 40 km → `strong-replacement-candidate`;
   - cross-border candidate → manual border/gateway review;
   - candidate over 200 km → long-distance gateway review;
   - same-country candidate within 120 km → local service revalidation;
   - otherwise → regional gateway review;
5. when the current preferred airport is itself scheduled-service confirmed, nearby alternatives remain review-only.

Examples expected to become strong replacement candidates include Beijing (`NAY → PEK` candidate), Detroit (`DET → DTW`), Kansas City (`MKC → MCI`), Orlando (`ORL → MCO`), and Sacramento (`SAC → SMF`). These are **proposals for later staging review**, not changes made by 702F-C.

## Evidence semantics

OurAirports `scheduled_service=yes` is airport-foundation metadata. It does not prove:

- that a route exists from the user's origin;
- that a flight operates on the requested date;
- that a fare is currently available;
- that a ticket can be booked.

Exact itinerary verification remains a separate live-provider responsibility, with Duffel preferred for exact-date flight verification.

## CI safety

The dedicated workflow:

1. downloads and verifies the exact pinned OurAirports blob;
2. regenerates the corrected 702F-B-R1 report;
3. requires the review queue to equal exactly 50;
4. requires Tasiilaq to remain absent;
5. builds exactly 50 triage rows with no duplicate city IDs;
6. requires four registry-integrity holds and four Ukraine airspace holds;
7. verifies representative strong replacements, preserved existing gateways, and Kalabo's no-nearby-candidate state;
8. requires every row to keep routing, activation, provider calls, and automatic overrides disabled;
9. uploads a triage JSON and compact summary artifact.

## Safety boundary

GV-REC-702F-C performs no provider calls and changes no:

- city mapping;
- route selection;
- generated-tour behavior;
- activation snapshot;
- Lambda code/configuration;
- environment variable;
- production/main state.

## Follow-up

After the triage report is inspected, a later **702F-D** may create a small, explicit staging-only correction proposal for high-confidence registry fixes and major-airport mapping corrections. It must remain separate from production promotion and must preserve exact-itinerary verification.
