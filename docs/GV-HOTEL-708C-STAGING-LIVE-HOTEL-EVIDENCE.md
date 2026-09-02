# GV-HOTEL-708C — Staging Nuitee live hotel evidence

## Status

Implementation package for staging review only. This branch does **not** create an AWS secret, change Lambda configuration, deploy Lambda, merge to `staging`, or touch production.

708C follows the successful 708B/R1 sandbox proof: Toronto, Dublin and Antalya each returned eight priced hotel offers with hotel identity/photos, and PREBOOK succeeded 3/3 with zero price delta in that proof run.

## Goal

Add provider-backed hotel evidence to the existing owner-private booking-time revalidation workspace without changing Globevoy into a hotel booking/payment system.

The existing GV-WEB-707B-R1 flow stays authoritative for:

- verified Cognito ownership;
- owner-private Saved Trip lookup;
- Duffel exact-date flight evidence;
- flight comparison handoff safety;
- corrected flight/saved-trip arithmetic.

708C adds a second, independent evidence lane:

`Saved Trip stop -> Nuitee Rates -> selected refundable/lowest offer -> Nuitee PREBOOK -> sanitized hotel evidence`

There is deliberately no BOOK, payment, reservation or order path.

## Feature and credential boundary

708C is disabled unless staging Lambda configuration contains:

- `ENABLE_NUITEE_HOTEL_708C=true`
- `NUITEE_SANDBOX_SECRET_ID=<Secrets Manager secret identifier>`

The Lambda environment contains only the secret identifier. The sandbox API key must be stored in AWS Secrets Manager, not in Lambda source, browser code, GitHub, CloudShell command history, or Lambda environment plaintext.

Accepted secret value formats:

- plaintext sandbox key beginning `sand_`; or
- JSON containing one of `apiKey`, `sandboxApiKey`, or `NUITEE_SANDBOX_API_KEY`.

No production Nuitee key is accepted by this staging adapter.

## Stay-date derivation

A live hotel request must use the saved trip's stay duration, not an arbitrary date.

Priority:

1. explicit saved `checkin/checkIn` + `checkout/checkOut` when both exist;
2. otherwise, use the saved outbound flight date for the stop as checkout and subtract the saved number of nights to derive check-in.

The second rule deliberately avoids using an inbound long-haul flight's departure date as hotel check-in, which can be wrong for overnight travel.

The returned hotel row includes `dateBasis` so the source of the dates remains inspectable.

## Provider request boundary

Per stop, maximum request flow is:

1. `POST https://api.liteapi.travel/v3.0/hotels/rates`
2. `POST https://book.liteapi.travel/v3.0/rates/prebook`

Search is bounded to eight hotels and one rate per hotel. A maximum of three saved stops is checked sequentially.

708C selects the cheapest refundable offer when available, otherwise the cheapest valid priced offer. The opaque `offerId` is used only in memory for PREBOOK and is never returned or persisted.

## Evidence states

### PREBOOK succeeded

- `state: verified`
- `availabilityVerified: true`
- label: `Price and availability rechecked by provider`

### Rates succeeded but PREBOOK did not

- `state: provider`
- `availabilityVerified: false`
- label: `Provider-backed hotel rate — recheck before booking`

### Provider/date/country resolution failed

The original Globevoy hotel planning estimate remains visible:

- `state: estimate`
- `availabilityVerified: false`
- label: `Planning estimate only — hotel provider recheck still required before booking.`

A hotel provider failure must not erase a working Duffel flight result.

## Hotel content

When returned by Nuitee, the booking workspace may display:

- hotel name;
- one HTTPS hotel image with descriptive alt text;
- address;
- guest rating;
- room name;
- board/meal plan;
- rate amount and currency;
- refundable status/cancellation evidence;
- taxes/fees evidence;
- explicit warning when provider data indicates excluded fees.

The warning text is:

`Some fees may be payable separately.`

The UI must not say a Nuitee rate is the final out-of-pocket amount merely because PREBOOK succeeded.

## Arithmetic boundary

708C does not rewrite GV-WEB-707B-R1 flight arithmetic.

When **every** hotel stop has successful PREBOOK evidence, 708C can expose an additive `hotelAdjustedTripEstimate`:

`707B-R1 freshTripEstimate + (freshHotelTotal - savedHotelEstimate)`

The saved hotel baseline prefers `priceSnapshot.stayEstimate`. This is intentional: compact per-stop estimates can be reconstructed/rounded and must not become a second arithmetic baseline.

If any hotel stop is unverified, 708C does **not** emit a full fresh-hotel total or hotel-adjusted combined trip estimate.

## Partner handoffs

Existing Agoda URLs remain comparison/referral handoffs only. When Nuitee evidence is shown, the Agoda button is labelled `Compare on Agoda` so the UI does not imply that the Nuitee rate is the Agoda rate.

708C does not create a Nuitee booking handoff, payment flow or reservation.

## Fail-closed rules

- Flag off -> no Nuitee secret read and no Nuitee request.
- Secret missing/invalid -> preserve existing hotel estimates.
- Missing stay dates/country code -> preserve that stop's estimate.
- Rates non-200/no offer -> preserve that stop's estimate.
- PREBOOK non-200/missing final price -> retain provider-backed search evidence but do not mark availability verified.
- Partial hotel coverage -> do not create a fully hotel-adjusted combined total.
- No provider IDs, raw responses or credentials in client output.

## Files

- `backend/services/nuitee-hotel-708c.js` — bounded server-side Nuitee adapter.
- `backend/services/staging-booking-revalidation-708c.js` — additive wrapper around 707B-R1.
- `backend/staging-lambda-702d.js` — staging route delegates to the 708C wrapper.
- `backend/validate-gv-hotel-708c.js` — no-network credential/provider mocks and regression safety checks.
- `web/lib/contracts.ts` — optional additive hotel evidence contract.
- `web/components/booking/booking-workspace-client.tsx` — concise live hotel evidence + image rendering.
- `.github/workflows/validate-708c.yml` — task CI.

## Deployment gate

Do not deploy solely because CI is green.

Before a staging activation, the operator must separately approve:

1. creating the Nuitee sandbox secret in Secrets Manager;
2. granting only `secretsmanager:GetSecretValue` for that secret to the staging Lambda role;
3. adding only the two 708C environment values while preserving all existing variables;
4. deploying the reviewed staging Lambda artifact;
5. running owner-private browser acceptance with the flag on;
6. confirming rollback by restoring the pre-708C environment/artifact if needed.

Production remains out of scope.
