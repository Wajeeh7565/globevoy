# GV-WEB-710C — Homepage / Discovery Reconstruction Reference Notes

## Product source of truth
- Keep the proven Globevoy budget-first homepage idea: origin + total budget + travellers first.
- Do not ask Single vs Multi-city before results. Globevoy decides and can return a small mix.
- Keep Advanced options secondary.
- Guests can search and experience the product before sign-in.
- Use a cinematic background slideshow as atmosphere, not as a content carousel.
- Keep copy short and visual.

## Internal Globevoy references
- `frontend/index.html` — current production hero/search structure and scenic background set.
- `frontend/scripts/home-slideshow-631b.js` — preload, reduced-motion, visibility-aware slideshow behavior.

## External GitHub references reviewed
- `Adarsh-Chaubey03/TravelGrid` `HeroSection.jsx` — useful reference for full-bleed hero composition, overlay, responsive split layout, and form-card treatment.
- We intentionally do **not** copy its auth-gated search behavior: Globevoy guest search remains open.
- We intentionally do **not** add Typewriter/animated headline behavior; the visual motion belongs in the background only.

## Implementation rules
1. No new carousel dependency.
2. Crossfade background only; no arrows/dots required for the first pass.
3. `prefers-reduced-motion: reduce` keeps a single static image.
4. Pause rotation while the document is hidden.
5. Preload subsequent hero images without blocking first paint.
6. Search routes to existing `/react/results/` contract; no backend changes.
7. Origin is not pre-filled with Toronto.
8. Default budget may remain CAD 1000 and default travellers 1 adult.
9. No provider credentials, no AWS changes, no booking/payment changes.
