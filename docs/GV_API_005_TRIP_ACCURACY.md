# GV-API-005: selected-trip prices and hotel referrals

This source-only change depends on PR #132's date and Docker/Lambda profile work.
It targets that updated Docker feature branch; #132 is not yet present on main.
No deployment, provider request, AWS configuration change or credential change is
part of this release. Existing environment flags and allowlists still decide
whether the live pilot can run.

## Feature status

| Capability | Status and evidence |
| --- | --- |
| Flexible flight discovery | Preserved: existing Travelpayouts/Aviasales planning/cache router |
| Selected exact-date flights | Working in mocked tests: existing Duffel pilot first, only after eligibility; all legs applied atomically |
| Duffel availability and production price accuracy | Untested live in this change; credentials, approved environment, request budget and expected cost must be reviewed first |
| Flight booking handoff | Partial: Aviasales comparison, never a guarantee of the Duffel itinerary/price; no orders or payment |
| Agoda property handoff | Working locally when the selected provider record already contains a trusted property URL; final redirect/property/price not live verified |
| Agoda partner/city results | Supported but explicitly labelled results/search, never an exact-property promise |
| Nuitee Rates/PREBOOK | Existing implementation retained; staging restrictions unchanged, no calls or production activation |
| Overnight hotel dates | Tested: check-in follows destination-local arrival; inconsistent onward fixed flights fail chronology checks |
| Account, CORS and maps | Existing policies and Leaflet/OpenStreetMap retained; no new map service or account-origin bypass |

## Changes and examples

Only a final selected exact-date schedule tries Duffel before cached enrichment.
Candidate ranking and flexible date discovery keep their existing provider. The
existing pilot still owns airport/party gates, exact-first/approved metro behavior,
quota reservations, caps, concurrency, retry rules, FX and whole-trip budget
reconciliation. Request-local promise reuse avoids repeating the same selected
schedule's search. Failed attempts are carried to final verification without a
second pilot invocation. No cross-request live-offer cache is introduced.

An offline three-flight fixture formerly starts with USD 100 planning amounts per
leg. With eligible mocked Duffel offers of USD 120 per party per leg, it now uses
USD 360 total, not USD 300 and not a second passenger multiplier. A USD 320 budget
remains over budget; the real price is not replaced with the cheap estimate.
Missing/expired, sandbox, wrong-route/date/party or unusable FX evidence cannot
retain a LIVE claim. Offers must be refreshed before booking.

For a Toronto-to-London flight leaving March 20 and arriving March 21, hotel check-in
is March 21. Three nights means checkout March 24. An already priced March 23
onward flight is not shifted: the itinerary fails the consistency check. PR #132's
planning-date allocation remains intact for Toronto and London representative tours.

Previously, a provider search URL could be labelled a specific hotel, a non-Agoda
`.html` URL could be accepted as a property, and a desired zero-child request could
retain `NumberofChildren=2`. Now only a trusted Agoda provider-supplied URL is used;
conflicting numeric IDs, userinfo and nonstandard ports are rejected. A supplied
property path is preferred over partner-search results. Existing selected hotel ID,
affiliate attribution, path and encoded values are preserved, with current dates,
rooms, guests and currency updated without contradictory aliases. Stale stay-date
price evidence loses LIVE status. No property URL, hotel ID or new affiliate format
is invented. Nuitee IDs are not treated as Agoda IDs.

Agoda's [official Lite API contract](https://partners.agoda.com/Content/Documents/AffiliateLiteApi/Affiliate_Lite_API_V2.0.pdf)
pairs `hotelId` and `landingURL`; a supplied partner-search URL does not prove the
final landing page is that property. Exact-property availability needs a supported
property URL from the partner record or partner-generated link/mapping and live
redirect confirmation. Child ages/infant handoff are not guaranteed by the current
URL contract; confirm these on Agoda. Existing Nuitee evidence includes identity,
dates, currency, final amount and expiry, but supplies neither an Agoda mapping nor
an Agoda referral URL. Retain its adapter rather than building another.

[Duffel offers](https://duffel.com/docs/api/v2/offers) provide a total for all
passengers and an expiry; availability and final charges still require revalidation.
They do not create an Aviasales referral guarantee.

## Repeatable validation and demonstration

```powershell
npm test
npm run test:providers
npm run test:account
npm run test:release
npm run test:web
npm run typecheck:web
node --test tests/backend/trip-accuracy-005.test.cjs
```

The focused tests prohibit network access and exercise the real pilot with mocked
offers/FX, selected-request reuse, caps/concurrency, party-total arithmetic,
over-budget results, expiry/conflicts, hotel IDs/URLs, occupancy and overnight dates.
Existing generated-tour regressions use representative Toronto and London routes.
Browser Save/My Trips/Delete and composed-site/map tests remain required alongside
the existing frontend build. Their API/provider requests are intercepted locally.

For Mehdi and Vamsi: show the focused tests, price/source labels, preserved hotel
path and guest/date query, then the existing isolated demo. Do not describe the
isolated Fargate hostname as connected to private production APIs. A live provider
demo needs separately approved credentials/environment and request/cost budget,
partner link validation and an approved HTTPS origin; no such approval is inferred.
No warning banner is removed for unverified capabilities. Revert this source commit
to restore prior selection/referral behavior; no data migration or AWS rollback is
needed because nothing has been deployed.

## Local validation evidence

Node 24: unified baseline (43 commands), provider/account/release/web groups (19
commands), production account handler regression, React typecheck, normal and
production-only static builds passed. All 18 trip-accuracy tests and eight browser
regressions (including actual hotel CTA URL/context and classic Save through React
My Trips/Delete) passed against packaged assets with external requests intercepted.
The composed Node site passed six HTTP/security checks, browser navigation and real
Leaflet rendering with intercepted OSM tiles. Existing historical release hashes
were not replaced to obtain a pass.

Docker image rebuild was blocked locally because the Docker Desktop Linux engine
was unavailable. The same composition and Node entry point were tested directly;
CI's existing Docker matrix is still required before container acceptance. No live
provider price, partner redirect, production account or Fargate acceptance is claimed.
