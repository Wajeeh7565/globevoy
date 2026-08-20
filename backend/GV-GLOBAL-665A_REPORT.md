# GV-GLOBAL-665A — On-Demand Global Route Graph

## Outcome

GV-GLOBAL-665A adds a scalable route-generation foundation for arbitrary origin cities. It does not store handcrafted route pairs. Instead it resolves the origin, generates feasible route combinations from the global city/airport graph, validates them, and then allows the existing deterministic/Gemini curator to rank only the routes that passed.

## What changed

### Unified global origin resolution

- Reads the existing global catalogue of 9,665 city records.
- Resolves direct flightable origins such as Rabat, Lahore, Accra, Lima, Halifax and San Diego.
- Resolves cities without a practical flight airport through a nearby gateway.
- Example: Suwon resolves through Seoul/ICN with a ground-access note.
- Preserves airport-integrity rules such as Toronto → YYZ and international Tehran → IKA.

### Automatic route graph

- Generates route combinations on demand; no fixed itinerary template is required.
- Uses validated/trusted destination anchors and Group 1/Group 2 metadata.
- Combines familiar anchors with nearby hidden-value discoveries automatically.
- Scores budget use, geographic coherence, country diversity, hotel cost, route reach and customer interest.
- Produces up to 24 feasible candidates before deterministic/Gemini curation.

### Comfort and safety

- 4–6 nights: maximum 2 destination cities.
- 7–10 nights: maximum 3 destination cities.
- Minimum 2 nights per destination.
- Rejects excessive backtracking, isolated continent jumps, missing airports and impossible night allocations.
- Every selected route is checked again by GV-GUARD-664A.

### Route editing integrity

The frontend no longer creates random local routes when the backend is unavailable or rejects an edit. Shuffle, replace, add and remove actions now require backend budget/geography/comfort validation. This closes the path that previously produced impossible five-night/four-stop tours.

## Provider and AI boundaries

- The graph generates feasible planning candidates.
- Travelpayouts/Aviasales enrichment runs afterward when provider observations are available.
- Agoda/stay values remain estimates unless provider evidence exists.
- Gemini may rank candidate IDs only; it cannot invent cities, airports, dates, hotels or prices.
- Estimated routes remain labelled as estimates.

## Scope boundary

This release supports arbitrary global origins, but intentionally uses the validated destination foundation for route quality. It does not promote all 9,665 raw city records as destinations. The next city expansion should grow the validated destination set toward 1,000 without allowing small or unsuitable airport records to degrade route quality.

## Deployment

Deploy backend first, then frontend.

Add or confirm:

```text
ENABLE_GLOBAL_ROUTE_GRAPH_665A=true
ENABLE_ROUTE_FEASIBILITY_GUARD_664A=true
ENABLE_DETERMINISTIC_ROUTE_CURATOR_662A=true
```

Gemini remains optional:

```text
ENABLE_LLM_ROUTE_CURATOR_662A=true
GV_LLM_PROVIDER=gemini
GV_LLM_ROUTE_CURATOR_API_KEY=<secure Lambda environment value>
GV_LLM_ROUTE_CURATOR_MODEL=<supported Gemini model>
```

## Validation

53/53 checks passed, including:

- Rabat, Suwon, Lahore, Accra, Lima, Tehran, Halifax, San Diego and Toronto.
- Suwon → ICN nearby-gateway resolution.
- Tehran → IKA and Toronto → YYZ normalization.
- Night allocation and stop caps.
- Route-feasibility acceptance.
- No frontend local random-route fallback.
- JavaScript syntax and JSON parsing.

See `VALIDATION_GV_GLOBAL_665A.json` for complete details.
