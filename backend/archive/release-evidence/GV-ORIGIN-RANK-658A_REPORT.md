# GV-ORIGIN/RANK-658A — Airport, Transfer Wording, and Route Clarity Polish

## Scope
Narrow stabilization patch after GV-FLIGHT-657C.

## Frontend changes
- Normalizes Montreal origin display to the practical airport code `YUL` instead of showing metro code `YMQ`.
- Uses the same origin display code in the summary card, origin itinerary card, and origin subtitle.
- Changes return ground legs from `Return flight` to `Return transfer` when the leg is rail/bus/ground.
- Keeps `Adjust date options` language from GV-FLIGHT-657C.
- Cache-bumps `multicity-visualizer.html` assets to `v=658a`.

## Backend changes
- Normalizes global fallback origins for selected metro-city records:
  - Montreal/YMQ → YUL
  - New York/NYC → JFK
  - London/LON → LHR
- Canonicalizes origin and leg endpoint display codes before returning the generated-tour payload.
- Keeps automatic cheap-date tour builder behavior from GV-FLIGHT-657B/657C.
- Gently increases final-tour ranking preference for country/diversity/distance when the budget can support it, while preserving budget guardrail.

## Preserved behavior
- No direct booking/payment.
- No fake live-price claim.
- No over-budget promotion.
- Flexible-date calendar remains an adjustment feature, not the main flow.
