# GV-HOTEL-708B — Nuitee Connect / LiteAPI live-hotel provider evaluation

## Status

Research + sandbox proof only. No Globevoy runtime integration, production credential, payment, booking, or reservation change is part of 708B.

## Why this provider is being evaluated

Globevoy needs provider-backed hotel price/availability evidence. Stay22 accommodation API access is paused, while the current Agoda path is blocked by the mismatch between the legacy city-ID adapter and modern property-ID availability requirements.

Nuitee Connect / LiteAPI is worth testing because its current v3 hotel rates endpoint supports direct geographic searches as a valid main query, including `cityName + countryCode`, coordinates, IATA code, Place ID, or AI search. A first Globevoy proof therefore does not require a preloaded Nuitee property-ID mapping catalog.

## Provider claims verified from current documentation

Sources reviewed 2026-08-30:

- Rates endpoint: https://docs.liteapi.travel/reference/post_hotels-rates
- Rate query guide: https://docs.liteapi.travel/docs/rate-request-parameters-guide
- Prebook endpoint: https://docs.liteapi.travel/reference/post_rates-prebook
- Hotel rate response structure: https://docs.liteapi.travel/docs/hotel-rates-api-json-data-structure
- Sandbox key guide: https://docs.liteapi.travel/docs/getting-a-sandbox-key
- API overview: https://docs.liteapi.travel/reference/overview
- Rate limits: https://docs.liteapi.travel/reference/rate-limiting
- API pricing: https://docs.liteapi.travel/reference/api-pricing-usage-costs

Current documentation says:

1. `POST https://api.liteapi.travel/v3.0/hotels/rates` is the primary hotel rate/availability endpoint and returns real-time pricing and availability.
2. Required rate inputs are check-in, check-out, currency, guest nationality, occupancies, and one supported location method.
3. Filter-based rate searches can include hotel names, photos, address and rating in the response; `includeHotelData=true` also requests hotel content explicitly.
4. Search results contain `offerId`, room/rate data, cancellation policy data, taxes/fees data and offer-level retail prices.
5. `POST https://book.liteapi.travel/v3.0/rates/prebook` verifies availability and final pricing before payment and returns final pricing, taxes/fees, cancellation terms and room details.
6. A free sandbox key is available after account creation and does not require a credit card to get started.
7. Sandbox keys are documented at 5 requests/second. The 708B harness is sequential and deliberately stays far below that limit.
8. Core Rates -> Prebook -> Book API usage is documented as free when used within the Terms of Service and a reasonable look-to-book ratio. 708B does not call Book.

## Trust interpretation for Globevoy

Do not treat a search result as a guaranteed booking price.

Proposed evidence semantics if Nuitee passes evaluation:

- Rates search succeeded: `Provider-backed hotel rate — recheck before booking`
- Prebook succeeded: `Price and availability rechecked by provider`
- Prebook failed/outdated: `Price needs verification`
- No provider result: preserve estimate/fail closed; never silently promote an estimate to live evidence.

Prebook is the stronger trust boundary because Nuitee documents it as the live availability/final-price verification step before payment.

## 708B sandbox cohort

Three intentionally different markets:

| City | Country | Purpose |
| --- | --- | --- |
| Toronto | CA | North American major city / home-market baseline |
| Dublin | IE | European capital already used in Globevoy live flight testing |
| Antalya | TR | Leisure destination and non-North-American inventory check |

Default proof request:

- Check-in: 2026-10-13
- Check-out: 2026-10-16
- 1 adult / 1 room
- Guest nationality: CA
- Display currency: CAD
- Maximum hotels searched: 8 per city
- One cheapest rate per hotel
- Room mapping enabled
- Hotel data requested
- 10-second provider timeout

Dates and currency are command-line overridable.

## Safety boundary

`ops/Run-GV-HOTEL-708B-Nuitee-Sandbox.mjs`:

- reads the sandbox key only from `NUITEE_SANDBOX_API_KEY`;
- never prints or writes that key;
- does not persist raw provider responses;
- does not print or save offer IDs;
- does not print or save prebook IDs or payment secrets;
- contains no hotel Book endpoint;
- performs no payment or reservation;
- defaults to search-only;
- only calls PREBOOK when the operator explicitly supplies `--prebook`;
- writes a sanitized summary JSON suitable for sharing back for review.

## Decision gates

708B is a candidate PASS only if live sandbox evidence supports all of the following:

1. **Direct-search viability** — city/country rate search works without Globevoy supplying provider property IDs.
2. **Coverage** — at least two of the three markets return multiple priced hotel offers; three of three is preferred.
3. **Price evidence** — selected offers contain numeric amount + currency.
4. **Policy evidence** — cancellation and taxes/fees fields are usable enough to distinguish refundable/non-refundable and included/excluded fees when provided.
5. **Content** — hotel identity is usable and image/content evidence is present in a meaningful portion of results.
6. **Prebook** — at least two markets successfully recheck the selected offer and return final pricing; three of three is preferred.
7. **Price-change handling** — the proof records search-vs-prebook deltas rather than assuming the search amount is final.
8. **Safety** — no booking/payment action occurs.

A single sandbox miss is not automatically a provider failure; the result must distinguish no inventory, expired offer, schema mismatch, authorization failure, and network/provider failure.

## If 708B passes

The next engineering task should be a separate staging-only integration (proposed `GV-HOTEL-708C`) that:

- stores the Nuitee credential in AWS Secrets Manager, never Lambda source/env plaintext or browser code;
- introduces a bounded provider adapter behind a feature flag;
- uses direct geographic hotel search for the first cohort;
- surfaces provider evidence separately from planning estimates;
- uses explicit user-triggered prebook/revalidation rather than automatic booking;
- does not add payment/order/reservation behavior unless separately approved and designed;
- preserves Agoda/estimate fallback and rollback behavior until Nuitee earns production confidence.
