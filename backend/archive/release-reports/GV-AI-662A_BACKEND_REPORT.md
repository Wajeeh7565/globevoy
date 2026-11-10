# GV-AI-662A — LLM-assisted Route Curator

## Purpose
Adds a safe route-curation layer for Globevoy generated tours.

The backend still owns all source-of-truth travel logic:
- origin/airport resolution
- candidate route generation
- flight/stay estimates
- provider-backed fare evidence when available
- budget guardrails
- city-night/date alignment
- final feasibility verification

The LLM layer is optional and may only rank already-valid backend candidates. It cannot create new cities, prices, dates, airports, hotels, or routes.

## Files changed
- `generated-tour.js`
  - version bumped to `1.7.0-gv-ai-662a-llm-route-curator`
  - candidate selection now passes through the route curator before provider-evidence ranking
  - diagnostics now include `aiRouteCurator`
- `services/route-curator.js`
  - new optional LLM route curator
  - deterministic wow-curator fallback
  - strict candidate-only JSON ranking contract
  - safe timeout and fallback behavior

## Environment flags
Optional LLM mode:

```text
ENABLE_LLM_ROUTE_CURATOR_662A=true
GV_LLM_ROUTE_CURATOR_ENDPOINT=<secure endpoint>
GV_LLM_ROUTE_CURATOR_API_KEY=<secure key if required>
GV_LLM_ROUTE_CURATOR_TIMEOUT_MS=2500
```

Safe deterministic curator fallback:

```text
ENABLE_DETERMINISTIC_ROUTE_CURATOR_662A=true
```

If the LLM endpoint is missing, fails, times out, or returns unusable JSON, the backend falls back to deterministic ranking.

## Safety rules
- LLM receives only budget-safe backend candidates.
- LLM returns only candidate IDs.
- Backend ignores unknown IDs.
- Backend performs final budget/date/route validation before returning a tour.
- No user-visible route is built directly from LLM prose.

## Local validation
Ran backend smoke tests with deterministic fallback enabled:

- Toronto / CAD 2000 → Panama City + Cartagena
- Montreal / CAD 1500 → Quebec City + Boston
- Tehran / CAD 1500 → Doha + Batumi via global fallback
- San Diego / USD 1500 → Guatemala City + Caye Caulker

JS syntax and JSON parsing passed.

## Honest limitation
This does not magically make provider fare coverage complete. The LLM can help choose the coolest valid route from candidates, but fare calibration/provider evidence is still needed for stronger Montreal CAD 1500 international results.
