# GV-PROD-673F-R2 Frontend Photo-Hydration Repair

## Problem reproduced

GV-PROD-673F-R1 delayed photo resolution for route cards after the first two cards. In the horizontally clipped itinerary row, a visible third stop such as Warsaw could remain on neutral generated artwork instead of resolving its real city photograph. R1 also started a new image cache namespace, so browsers could not immediately reuse valid photographs already cached by the Codex 673F frontend.

## Narrow repair

- Every itinerary card now starts real-photo resolution immediately.
- Route-card image loading is eager because a generated tour normally contains only a small number of visible cards.
- Valid image results from the 673F and 673F-R1 browser caches are reused and migrated into the R2 cache.
- Neutral generated artwork remains only as a temporary loading state or an honest fallback when no verified photograph can be resolved.
- All GV-PROD-673F-R1 booking, route-integrity, origin-integrity and wording repairs are preserved.
- Lambda is unchanged and must not be redeployed for this repair.

## Scope

Primary functional changes:
- `scripts/multicity-visualizer-673c.js`
- `scripts/city-images-673c.js`

Release/cache markers were updated in production HTML and active scripts to `GV-PROD-673F-R2`.

## Known limitation

A real city photograph still depends on a verified local asset, a valid cached result, or a successful Wikipedia/Wikimedia lookup. Neutral artwork may remain when no trustworthy photograph is available.
