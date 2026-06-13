# Globevoy City Registry Scaling Architecture

Created: 2026-06-02

This is a documentation-only architecture plan. It does not change live frontend
or backend datasets, does not wire preview files into production, and does not
change provider integrations.

## A. Summary

Globevoy can scale beyond the current 50-city draft only if city identity,
provider mappings, coordinates, validation status, and generated frontend/backend
slices are managed from one canonical registry. Manual edits to separate
frontend and backend city files will not scale to 100, 250, or thousands of
cities because each provider has its own city names, IDs, airport-code rules,
coverage gaps, aliases, and coordinate conventions.

The recommended architecture is:

1. Globevoy owns the canonical city registry.
2. Provider data is ingested into reviewable mapping tables.
3. Raw provider feeds stay outside the repo.
4. Only compact derived fields are saved in the registry.
5. Validators and generated preview slices catch problems before production.
6. Human review decides product labels, ambiguous matches, and production
   readiness.

## B. Scaling Problem

The current live system has historically had separate frontend and backend
destination data. That creates repeated drift:

- A frontend city can exist on the map but not be eligible for backend live
  recommendations.
- A backend city can have provider IDs and fallback pricing but no frontend map
  placement, Ask copy, image, or style tags.
- Provider names and country labels can differ, such as `Czechia` vs
  `Czech Republic`, or `Istanbul` vs `Istanbul` / `Turkiye` variants.
- City and airport codes can be the same for some cities and different for
  metro areas, such as `NYC`, `LON`, `PAR`, `REK` / `KEF`.
- Agoda coverage does not prove flight route quality, and Travelpayouts city
  codes do not prove hotel coverage.

At 50 cities, these issues can be reviewed manually. At 250 or 1000+ cities,
manual maintenance becomes a steady source of duplicate cities, wrong airport
mapping, broken provider IDs, and inconsistent frontend/backend behavior.

## C. Scaling Architecture

### 1. Canonical Globevoy City Registry

The canonical registry should be the stable source for:

- `globevoyCityId`
- display city and country
- region/country disambiguation
- city-center latitude/longitude
- aliases and normalized search names
- provider coverage summary
- Travelpayouts/Aviasales mapping
- Agoda mapping
- validation status
- Group 1 / Group 2 draft role
- notes and validation sources

The canonical record should describe the Globevoy city, not a provider-specific
hotel zone or airport.

### 2. Provider Mapping Tables

Provider mappings should be stored as compact derived data, either nested in the
registry or as separate tables keyed by `globevoyCityId`.

Recommended provider mapping families:

| Mapping | Purpose |
| --- | --- |
| Agoda city mapping | Agoda city ID, hotel count, coverage status, candidate city name, match confidence. |
| Travelpayouts city/airport mapping | City/metro code, airport codes, primary airport, code review status. |
| Future provider mapping | Provider-specific city/location IDs, status, confidence, last verified date. |

Provider records should not replace the canonical Globevoy city record.

### 3. Raw Provider Feeds Outside The Repo

Raw Agoda hotel feeds and bulk provider files should be downloaded and parsed in
a temp or external data-processing location. They should not be committed to the
frontend, backend, docs, or source repo.

Safe derived outputs can include:

- Agoda city ID
- candidate Agoda city name
- hotel count
- coverage status
- match type
- match confidence
- validation date
- compact notes

Do not store hotel-level feed rows in the project unless there is a reviewed,
separate data-governance plan.

### 4. Compact Derived Registry Fields

The registry should store only fields that are useful for matching,
validation, generation, and debugging:

- provider IDs
- coverage status
- counts
- airport code lists
- aliases
- validation sources
- warning flags

It should not store raw provider payloads, API keys, affiliate secrets, live
prices, or unreviewed bookability claims.

### 5. Validation Scripts

Validation scripts should run before any generated slice is used in production.
They should check:

- unique city IDs
- required fields
- invalid coordinates
- duplicate aliases
- duplicate provider mappings
- missing Agoda mappings
- missing Travelpayouts mappings
- city-vs-airport review cases
- hold-back records
- raw feed or credential leakage

The current validator is a good starting point. Scaling requires adding more
provider-specific duplicate and readiness checks over time.

### 6. Generated Frontend And Backend Slices

Generated files should remain preview-only until QA passes.

Frontend slice purpose:

- map/globe placement
- display city/country
- aliases/search metadata
- style tags and curated copy when available
- safe fallback content
- internal provider readiness metadata, if useful

Backend slice purpose:

- destination lookup
- Travelpayouts city and airport codes
- Agoda city ID and hotel coverage
- fallback pricing and daily-spend estimates after review
- validation status
- provider coverage metadata

Generated production slices should be filtered by readiness gates, not by simply
dumping every registry record.

## D. Provider Ingestion Workflow

### Agoda Feed Workflow

1. Download the Agoda feed into a temp location outside committed source paths.
2. Inspect file names and headers only first.
3. Parse city, country, city ID, hotel ID, coordinates, rating/review fields,
   and hotel URL availability if present.
4. Aggregate by city/country/provider city ID.
5. Produce a compact candidate table:
   - `globevoyCityId`
   - candidate Agoda city ID
   - candidate Agoda city name
   - candidate hotel count
   - match type
   - match confidence
   - notes
6. Review ambiguous matches manually.
7. Apply only high-confidence reviewed fields to the draft registry.

Agoda can help with hotel-side city coverage, but it should not determine the
canonical city on its own. A hotel market may represent a broader zone than the
Globevoy destination.

### Travelpayouts / Aviasales Workflow

1. Ingest public/static Travelpayouts city and airport data into a derived
   candidate table.
2. Match by city name, country code, airport code, metro code, and aliases.
3. Classify code semantics:
   - city/metro code
   - airport code
   - code that is both practical city code and airport code
   - needs city-vs-airport review
4. Assign:
   - `travelpayoutsCityCode`
   - `travelpayoutsAirportCodes`
   - `primaryAirportCode`
   - `nearestMajorAirportCode`, only when reviewed
5. Keep metro-airport policies explicit for cities such as New York, London,
   Paris, Rome, Milan, Chicago, Tokyo, Seoul, Osaka, Montreal, and Reykjavik.

Travelpayouts can help with flight-side identity and airport codes, but code
existence does not guarantee route availability, price availability, or booking
quality.

### Future Provider Workflow

Every future provider should plug into the same pattern:

- ingest outside repo
- derive compact candidate mapping
- match to `globevoyCityId`
- validate conflicts
- apply reviewed fields
- generate reports and slices

No future provider should create a second canonical city just because its name,
region, or coordinate differs from Globevoy's reviewed city record.

## E. Duplicate Prevention

Duplicate prevention should happen before records become production-ready.

Recommended checks:

- Normalize names by lowercasing, trimming whitespace, removing accents, and
  reducing punctuation.
- Compare aliases and normalized names across all records.
- Require country or region disambiguation for ambiguous names.
- Check provider city IDs for one-to-many and many-to-one mappings.
- Check airport code reuse across city records.
- Compare city-center coordinates against provider and curated coordinates.
- Flag large coordinate deltas for review.
- Treat fuzzy matches as candidates only, never automatic truth.
- Preserve display names even when normalized search names collapse variants.

Example:

`Valencia`, `Valencia Spain`, `Valencia, Spain`, `Valencia ES`, `Valencia`,
and `Valensia` can all resolve to `valencia-es` only after alias review.
If another `Valencia` is added in another country or region, the matcher must
require country/region context or ask for clarification.

## F. Validation Gates

Before a city can enter production generated slices, confirm:

- `globevoyCityId` is unique and stable.
- Display city, country, and region are reviewed.
- Latitude and longitude represent city-center display coordinates.
- Travelpayouts city/metro code is verified or explicitly unavailable.
- Travelpayouts airport code list is verified and practical.
- Primary airport is reviewed.
- Agoda city ID is verified or explicitly missing.
- Agoda hotel count and coverage status are derived from reviewed data.
- Aliases and normalized search names are reviewed.
- No risky duplicate aliases exist.
- No duplicate provider mapping exists without review.
- Group 1 / Group 2 role is product-reviewed before ranking use.
- City is not marked `hold-back`.
- Validation sources and dates are recorded.
- No raw provider feed data is committed.
- No API keys, tokens, passwords, or credentials are committed.
- Partner-link tests pass.
- Generated frontend/backend slices exclude unapproved records.

Recommended readiness states:

| Status | Meaning |
| --- | --- |
| `draft` | Basic city candidate only. |
| `draft-needs-provider-review` | Needs Agoda and/or Travelpayouts review. |
| `provider-matched` | Provider fields are matched but product review is incomplete. |
| `product-reviewed` | Product labels and destination usefulness reviewed. |
| `ready` | Safe for generated production slices. |
| `hold-back` | Do not expose until a named issue is resolved. |

## G. Scaling Stages

### Stage 1: 50 Cities

Current state:

- 50 draft registry records.
- Agoda matched for all 50.
- Travelpayouts/Aviasales code policy validated for draft use.
- Generated preview frontend/backend slices exist.
- Live datasets are still not replaced.
- Small backend metadata merge applied for Lisbon, Mexico City, and Porto.

Goal:

- Keep this as the controlled pilot set.
- Use it to prove validation, diffing, and preview generation workflows.
- Do not promote all 50 at once.

### Stage 2: 100 Cities

Priority:

- North America and Europe first.
- Add practical Group 1 anchors/hubs and nearby Group 2 cities.
- Prefer cities with strong Agoda coverage and clear Travelpayouts codes.

Workflow:

- Add candidates to the registry only.
- Run provider matching.
- Produce provider gap report.
- Product-review Group 1 / Group 2 labels.
- Generate preview slices.
- Promote only reviewed records.

### Stage 3: 250 Cities

Priority:

- More Group 2 and hidden-gem/value cities.
- More regional clusters for future multi-city planning.
- More coastal, nature, culture, food, and short-break destinations.

Workflow:

- Start using batch ingestion and review queues.
- Require duplicate detection before review.
- Use region clusters and nearest airport mapping review.
- Add route-pair validation later, separately from city validation.

### Stage 4: 1000+ Cities

Priority:

- Automated ingestion pipeline.
- Human review queue for exceptions and product labels.
- Provider refresh jobs.
- Generated artifacts for frontend/backend slices.
- Production allowlist or readiness filter.

Workflow:

- Provider feeds create candidate records.
- Matching system suggests canonical mappings.
- Validator blocks duplicates and unsafe records.
- Human review resolves ambiguity.
- Production generator emits only `ready` cities.

At this scale, the registry should behave like a curated data product, not a
static hand-edited file.

## H. Human Review Workflow

Human/product review is required for:

- Group 1 / Group 2 classification.
- Ambiguous city names.
- Country/region display choices.
- Metro-airport policy.
- Nearest-major-airport suggestions.
- Hotel coverage quality.
- Destination usefulness for budget-first recommendations.
- Hidden-gem/value positioning.
- Duplicate city risk.
- Map placement and visual spot checks.
- Whether a city belongs in the next production cohort.

Suggested review decision values:

- approve for draft registry
- approve for production slice
- hold for provider review
- hold for product review
- reject duplicate
- reject low practical value
- reject unsupported provider coverage

## I. Automation Ideas

Recommended future scripts:

| Script | Purpose |
| --- | --- |
| `ingest-agoda-city-candidates` | Parse raw Agoda feed outside repo and output compact city candidates. |
| `ingest-travelpayouts-static-data` | Read cities/airports data and create code candidates. |
| `match-provider-candidates` | Match provider candidates to registry records using exact, alias, and reviewed fuzzy rules. |
| `detect-duplicate-city-aliases` | Flag duplicate aliases and normalized search names. |
| `detect-coordinate-mismatches` | Compare city-center, airport, frontend, and provider coordinates. |
| `detect-provider-id-conflicts` | Find Agoda or Travelpayouts IDs mapped to multiple city records. |
| `generate-registry-gap-report` | Summarize missing provider fields and validation blockers. |
| `generate-preview-slices` | Create frontend/backend preview files without production imports. |
| `compare-preview-vs-live` | Diff generated preview slices against current live files. |
| `generate-production-slices` | Emit production-ready slices from `ready` records only. |

Automation should produce review artifacts first. It should not auto-promote
cities to production without readiness gates.

## J. LLM Role

LLMs can help with:

- drafting Group 1 / Group 2 labels
- suggesting aliases and spelling variants
- summarizing destination style
- identifying hidden-gem candidate cities
- drafting safe user-facing copy
- highlighting likely duplicate risks for human review

LLMs should not be the final source of truth for:

- provider IDs
- airport codes
- Agoda city IDs
- hotel counts
- route availability
- prices
- bookability
- coordinates
- legal/visa claims
- final production readiness

LLM output should be treated as candidate research. Provider data, validation
scripts, and human/product review should determine what becomes production data.

## K. Jira-Ready Note

Globevoy should scale city coverage through a provider-neutral city registry,
not by manually editing separate frontend and backend datasets. The registry
should own canonical city identity, aliases, coordinates, provider mappings,
coverage status, validation state, and draft Group 1 / Group 2 labels. Agoda and
Travelpayouts/Aviasales should be ingestion sources that produce compact
derived fields, not raw source-of-truth datasets. Raw provider feeds must stay
outside the repo. Every expansion stage should run validators, duplicate checks,
provider gap reports, generated preview slices, and human review before any
record becomes production-ready. The next safe direction is to harden the
registry pipeline from the current 50-city pilot, then expand to 100 cities in
North America and Europe before moving toward 250 and eventually 1000+.

## L. Final Recommendation

Next Codex task should be documentation or tooling, not live dataset migration.

Recommended next task:

Create a preview-only registry generation script that reads the draft registry
and writes the existing preview frontend/backend slices repeatably, without
importing them into production.

Alternative next task:

Create a provider-ingestion design note for the future Agoda and Travelpayouts
candidate tables, including exact columns and review statuses.

Do not add the next 50 cities to live datasets yet. First, make the 50-city
registry workflow repeatable enough that adding 50 more records does not create
new frontend/backend drift.
