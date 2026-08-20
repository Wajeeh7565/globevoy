# GV-GLOBAL-665B — Provider-Driven Route Discovery and Travel-Time Guardrails

## Outcome

GV-GLOBAL-665B makes the global route engine more serious about the traveller's actual experience. It keeps arbitrary global origins, but it no longer treats geographic novelty and budget fit as sufficient. Candidate routes must also preserve useful destination time, sensible nights, manageable transit burden, and realistic flight connectivity.

## Provider-driven route discovery

- Scans inexpensive one-way destinations from the resolved origin across the next six months when Travelpayouts data is available.
- Expands a bounded set of the strongest first destinations using provider-observed onward destinations.
- Keeps provider calls bounded: six origin-month discovery calls, then at most four onward discovery calls in the relevant travel month.
- Records provider-discovered flight legs, departure dates, duration evidence, fare observations, and booking links without claiming that the complete trip price is confirmed.
- Falls back to the deterministic global graph when provider discovery is unavailable, empty, rate-limited, or does not produce a comfortable route.

## Travel-time and comfort guardrails

- A route may contain one destination when that is more enjoyable than forcing a weak multi-city itinerary.
- Minimum two nights remains the baseline for every destination.
- Long-haul destinations generally require at least three nights; ultra-long-haul destinations require four.
- Five-night trips cannot chain long-haul cities and may only use two cities when the cities are genuinely close and transit time remains modest.
- Validates estimated door-to-door travel time, connection count, usable destination hours, total travel-burden ratio, geographic backtracking, airport integrity, and allocated nights.
- Rejects examples such as Algiers → Kigali → Maun and Lima → Chicago → Quebec for five-night trips.
- Revalidates the selected tour after AI curation and provider enrichment.

## AI ranking boundary

- Gemini and the deterministic curator only rank routes that passed the feasibility guard.
- Ranking now rewards provider-discovered connectivity and usable vacation time instead of simply rewarding more stops or greater distance.
- AI still cannot invent destinations, airports, fares, dates, hotels, or availability.

## Customer-facing trust update

- Planning-heavy routes show **Estimated to fit budget** rather than **Fits budget**.
- Provider-informed routes still distinguish provider fare evidence from planning estimates.
- Exact final price and availability remain subject to confirmation on partner websites.

## Environment variables

Recommended:

```text
ENABLE_GLOBAL_ROUTE_GRAPH_665B=true
ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B=true
ENABLE_ROUTE_FEASIBILITY_GUARD_664A=true
ENABLE_DETERMINISTIC_ROUTE_CURATOR_662A=true
TRAVELPAYOUTS_TOKEN=<secure Lambda environment value>
```

The existing `ENABLE_GLOBAL_ROUTE_GRAPH_665A=true` remains a compatible fallback switch.

Rollback only the provider-discovery layer with:

```text
ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B=false
```

The guarded deterministic global graph can remain enabled.

## Validation

29/29 focused checks passed, including:

- rejection of exhausting five-night Algiers and Lima routes;
- single-destination comfort fallback;
- global origins Faisalabad, Rabat, Algiers, Lima, and Toronto;
- stop/night limits and travel-burden metrics;
- honest estimate confidence labels;
- mocked provider discovery of Faisalabad → Dubai → Muscat;
- provider evidence retained without claiming an exact complete-trip price;
- six-month calendar navigation preserved;
- frontend cache version updated.

See `VALIDATION_GV_GLOBAL_665B.json` for complete results.

## Honest boundary

Provider discovery improves candidate quality only when the flight API returns useful observations. Hotel values remain estimates unless Agoda/provider rate evidence is available. Globevoy must continue to label estimates honestly and should prefer a strong single-destination result over a bad multi-city route when data or time is insufficient.
