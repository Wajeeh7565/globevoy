# GV-PROD-673F-R2 Manual Browser Checklist

## Required photo regression

1. Hard-refresh `https://globevoy.com`.
2. Generate a Cairo trip with two stops.
3. Confirm the origin, stop 1, stop 2 and return cards all begin resolving photographs immediately.
4. Confirm a visible third card such as Warsaw does not remain on green generated artwork after the other cards have loaded.
5. Switch between all three trip options and confirm newly rendered stop cards also resolve photographs.
6. Repeat in a private/incognito window to test without existing cache.
7. Repeat at mobile width and scroll the horizontal card row.

## Preserved regressions

- Main action says `Book each flight separately`.
- All flight legs and hotel stays appear on the booking page.
- Flight links use displayed dates.
- Shared booking links restore on another browser.
- `Lowest cost` is actually the lowest safe final total.
- Ambiguous origins require country-specific selection.
- No Kiwi beta or combined-checkout claim appears.

## Acceptance record

- Frontend: `GV-PROD-673F-R2`
- Backend: unchanged from the currently deployed GV-PROD-673F-R1 backend / GV-CITY-668T activation
- Automated deployment smoke: PASS / FAIL
- Manual photo regression: PASS / FAIL
- Desktop: PASS / FAIL
- Mobile: PASS / FAIL
