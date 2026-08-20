# GV-RANK-659B — Stretch Ambition Band (on 659A)

## Status
Staging candidate. Flag-gated: `ENABLE_STRETCH_AMBITION_659B=true`. Default OFF — behavior byte-identical to 659A until enabled (regression-tested).

## Motivation
Dr. Masoumi's stated benchmark: "I put Montréal and a budget of 1500 CAD… what amazing tours in the next 6 months?" Under 659A that budget lands in the regional band → Quebec City + Boston, exactly the expected-trip pattern he wants to avoid.

## Change
New `stretch-value` band for $1,000–1,349 USD budgets (C$1500 ≈ $1,102): international ambition, 1,500–5,200 km preferred range, up to 3 flight legs, leaner hotel assumption. Safety: generation runs two-pass — if no international plan fits inside the protected budget, it regenerates with the regional band, so output can never be worse than today.

## Test results (offline, all flags on)
- Regression guard: flag OFF reproduces 659A exactly (YUL C$1500 → Quebec City + Boston). PASS.
- USD $1,300–1,349: stretch band activates → Atlanta + Nashville (international, within budget).
- YUL C$1500 ($1,102 USD): stretch pass finds zero feasible international plans under the current fare model → falls back to regional. Feasibility floor sits near $1,250 USD.

## Honest finding + recommended next step (do NOT skip this)
The binding constraint is the fallback fare model, whose long-haul per-leg estimates are conservative relative to (a) the cheap one-way fares Dr. Masoumi's strategy is built on and (b) the repository's own approved estimates (a least-squares fit of the 272 approved records gives ≈ $283 + $0.054/km round-trip). Making Montreal-C$1500 reach Mexico/Central America honestly requires *calibrating* that model against evidence — cached one-way observations or the approved-estimate regression — not lowering numbers until the demo looks good. That calibration should be its own reviewed change (suggest GV-FARE-661A) validated against live scanner output with the provider token.

## Rollback
Unset the flag. No other behavior paths touched.
