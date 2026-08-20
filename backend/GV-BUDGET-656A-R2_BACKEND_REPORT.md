# GV-BUDGET-656A-R2 Backend Report

Scope: generated-tour minimum 2-stop preference.

Changed files:
- `global-generated-tour-fallback.js`
- `generated-tour.js`

Behavior:
- Global fallback now ranks feasible 2+ stop plans ahead of feasible 1-stop plans.
- 1-stop fallback is still allowed only as a labelled simple route when no budget-fit 2-stop plan exists.
- Generated visualizer response carries `simpleRouteFallback` metadata when applicable.
- Budget guardrail remains preserved; no over-budget route is promoted as valid.
