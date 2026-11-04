'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const adapter = require('./services/providers/stays/nuitee/nuitee-hotel-708c');
const wrapper = require('./services/booking/revalidation/staging-booking-revalidation-708c');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: error?.stack || error?.message || String(error) }); }
}

const ORIGIN = wrapper.STAGING_ORIGIN;
const TRIP_ID = 'trip708c01';
const baseEnv = {
  CORS_ORIGIN: ORIGIN,
  GLOBEVOY_COGNITO_USER_POOL_ID: 'us-east-2_MSd9RRHD8',
  GLOBEVOY_COGNITO_APP_CLIENT_ID: 'o2ohbv50253hjli5s34rbvv79',
  GLOBEVOY_SAVED_TRIPS_TABLE: 'globevoy-staging-saved-trips',
  ENABLE_NUITEE_HOTEL_708C: 'true',
  NUITEE_GUEST_NATIONALITY: 'CA',
  NUITEE_SANDBOX_SECRET_ID: 'globevoy/staging/nuitee/sandbox'
};

function event() {
  return {
    rawPath: wrapper.ROUTE_PATH,
    requestContext: { http: { method: 'POST' } },
    headers: { origin: ORIGIN, authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ tripId: TRIP_ID })
  };
}

function savedTrip() {
  return {
    tripId: TRIP_ID,
    name: 'Toronto + Dublin',
    status: 'planned',
    version: 1,
    updatedAt: '2026-09-02T20:00:00.000Z',
    tripSnapshot: {
      schemaVersion: 1,
      kind: 'multi',
      clientSaveKey: 'multi-708c',
      origin: 'Montreal',
      cities: [{ city: 'Toronto' }, { city: 'Dublin' }],
      tour: {
        schemaVersion: 1,
        savedSnapshotMode: 'compact-account-route',
        origin: { city: 'Montreal', code: 'YUL', airportCode: 'YUL' },
        cities: [
          { city: 'Toronto', country: 'Canada', countryCode: 'CA', code: 'YYZ', airportCode: 'YYZ', nights: 3, hotel: { estimatedStayUsd: 300 } },
          { city: 'Dublin', country: 'Ireland', countryCode: 'IE', code: 'DUB', airportCode: 'DUB', nights: 3, hotel: { estimatedStayUsd: 320 } }
        ],
        backendLegs: [
          { from: { city: 'Montreal', code: 'YUL', airportCode: 'YUL' }, to: { city: 'Toronto', code: 'YYZ', airportCode: 'YYZ' }, mode: 'flight', departureDate: '2026-10-10', estimatedTransportUsd: 180, estimatedDisplayTotal: 240 },
          { from: { city: 'Toronto', code: 'YYZ', airportCode: 'YYZ' }, to: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' }, mode: 'flight', departureDate: '2026-10-13', estimatedTransportUsd: 420, estimatedDisplayTotal: 560 },
          { from: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' }, to: { city: 'Montreal', code: 'YUL', airportCode: 'YUL' }, mode: 'flight', departureDate: '2026-10-16', estimatedTransportUsd: 440, estimatedDisplayTotal: 590 }
        ],
        stays: [
          { city: 'Toronto', country: 'Canada', countryCode: 'CA', nights: 3, hotel: { estimatedStayUsd: 300 } },
          { city: 'Dublin', country: 'Ireland', countryCode: 'IE', nights: 3, hotel: { estimatedStayUsd: 320 } }
        ],
        displayBudget: { currency: 'CAD', totalBudget: 3000, tripEstimate: 2300, reserveAmount: 300, exchangeRateFromUsd: 1.35 },
        canonicalPricing: { canonicalDisplayTotal: 2300, transportDisplayTotal: 1390, stayDisplayTotal: 910, exchangeRateFromUsd: 1.35 },
        passengerPricing: { adults: 1, children: 0, infants: 0, travellers: 1, passengers: 1, rooms: 1 }
      }
    },
    priceSnapshot: { currency: 'CAD', totalBudget: 3000, reserve: 300, flightEstimate: 1390, stayEstimate: 910, tripEstimate: 2300, capturedAt: '2026-09-02T20:00:00.000Z' }
  };
}

function tourForAdapter() {
  return {
    stops: [
      { city: 'Toronto', country: 'Canada', countryCode: 'CA', code: 'YYZ', nights: 3 },
      { city: 'Dublin', country: 'Ireland', countryCode: 'IE', code: 'DUB', nights: 3 }
    ],
    legs: [
      { departureDate: '2026-10-10' },
      { departureDate: '2026-10-13' },
      { departureDate: '2026-10-16' }
    ]
  };
}

function response(status, payload) {
  return { status, async text() { return JSON.stringify(payload); } };
}

function ratesPayload(city) {
  return {
    data: [{
      hotelId: `hotel-${city}`,
      roomTypes: [{
        offerId: `opaque-offer-${city}`,
        offerRetailRate: { amount: city === 'Toronto' ? 600 : 500, currency: 'CAD' },
        rates: [{
          name: 'Standard Room',
          boardName: 'Breakfast Included',
          cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [] },
          retailRate: { taxesAndFees: [{ name: 'city fee', included: city === 'Toronto' }] }
        }]
      }]
    }],
    hotels: [{
      id: `hotel-${city}`,
      name: `${city} Test Hotel`,
      address: `1 ${city} Street`,
      rating: 8.8,
      main_photo: `https://images.example/${city.toLowerCase()}.jpg`
    }]
  };
}

function prebookPayload(amount) {
  return {
    data: {
      prebookId: 'opaque-prebook-fixture',
      price: amount,
      currency: 'CAD',
      roomTypes: [{ rates: [{
        cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [] },
        retailRate: { taxesAndFees: [{ name: 'city fee', included: amount === 600 }] }
      }] }]
    }
  };
}

function liveResult(tour) {
  const amounts = [250, 570, 580];
  return {
    tour: {
      ...tour,
      legs: tour.legs.map((leg, index) => ({
        ...leg,
        providerDateEvidence: {
          sourceType: 'LIVE',
          providerBacked: true,
          productionEligible: true,
          requestedOrigin: leg.from.airportCode,
          requestedDestination: leg.to.airportCode,
          resolvedOrigin: leg.from.airportCode,
          resolvedDestination: leg.to.airportCode,
          departureDate: leg.departureDate,
          displayPrice: amounts[index],
          displayCurrency: 'CAD',
          rankingPriceUsd: amounts[index] / 1.35,
          providerReference: `flight-${index}`,
          observedAt: '2026-09-02T22:00:00.000Z',
          expiresAt: '2026-09-02T22:15:00.000Z',
          airportMode683H: 'EXACT'
        }
      }))
    },
    summary: {
      attempted: true,
      applied: true,
      allFlightLegsLive: true,
      requiredFlightLegCount: 3,
      liveFlightLegCount: 3,
      providerRequests: 3,
      exactRequests: 3,
      metroRequests: 0,
      afterTotalUsd: 1700,
      overBudget: false
    }
  };
}

(async () => {
  await check('708C stays staging-only and contains no booking/payment endpoint', async () => {
    const source = read('backend/services/providers/stays/nuitee/nuitee-hotel-708c.js');
    const production = read('backend/lambda.js');
    assert.match(source, /GV-HOTEL-708C/);
    assert.match(source, /hotels\/rates/);
    assert.match(source, /rates\/prebook/);
    assert.doesNotMatch(source, /rates\/book/);
    assert.doesNotMatch(source, /paymentMethod|credit.?card|TRANSACTION_ID|4242424242424242/i);
    assert.doesNotMatch(production, /GV-HOTEL-708C|NUITEE_SANDBOX_SECRET_ID|nuitee-hotel-708c/);
  });

  await check('feature flag off makes zero secret/provider calls', async () => {
    let secretCalls = 0;
    let fetchCalls = 0;
    const result = await adapter.verifyTourHotels(tourForAdapter(), { adults: 1, currency: 'CAD' }, {
      env: { ENABLE_NUITEE_HOTEL_708C: 'false', NUITEE_SANDBOX_SECRET_ID: 'should-not-read' },
      getSecretValue: async () => { secretCalls += 1; return 'sand_should_not_read'; },
      fetch: async () => { fetchCalls += 1; throw new Error('should-not-fetch'); }
    });
    assert.equal(result.enabled, false);
    assert.equal(result.attempted, false);
    assert.equal(secretCalls, 0);
    assert.equal(fetchCalls, 0);
  });

  await check('stay dates derive from saved nights plus outbound flight date', async () => {
    const tour = tourForAdapter();
    assert.deepEqual(adapter._internal.deriveStayWindow(tour, tour.stops[0], 0), {
      checkin: '2026-10-10', checkout: '2026-10-13', nights: 3, dateBasis: 'saved-nights-plus-outbound-date', dateConfirmed: false
    });
    assert.deepEqual(adapter._internal.deriveStayWindow(tour, tour.stops[1], 1), {
      checkin: '2026-10-13', checkout: '2026-10-16', nights: 3, dateBasis: 'saved-nights-plus-outbound-date', dateConfirmed: false
    });
  });

  await check('sandbox Rates -> PREBOOK returns sanitized verified evidence for every stop', async () => {
    const requests = [];
    let activeCity = '';
    const result = await adapter.verifyTourHotels(tourForAdapter(), { adults: 1, currency: 'CAD' }, {
      env: baseEnv,
      getSecretValue: async (secretId) => {
        assert.equal(secretId, baseEnv.NUITEE_SANDBOX_SECRET_ID);
        return JSON.stringify({ sandboxApiKey: 'sand_unit_test_only' });
      },
      fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ url, body, keyHeaderPresent: Boolean(init.headers['X-API-Key']) });
        if (url === adapter.RATE_URL) {
          activeCity = body.cityName;
          return response(200, ratesPayload(activeCity));
        }
        if (url === adapter.PREBOOK_URL) {
          assert.match(body.offerId, /^opaque-offer-/);
          return response(200, prebookPayload(body.offerId.endsWith('Toronto') ? 600 : 500));
        }
        throw new Error('unexpected-url');
      }
    });
    assert.equal(result.allVerified, true);
    assert.equal(result.verifiedCount, 2);
    assert.equal(result.providerRequests, 4);
    assert.equal(result.freshHotelTotal, null, 'sandbox PREBOOK never becomes a current production hotel total');
    assert.equal(result.allLive, false);
    assert.equal(result.rows[0].hotelName, 'Toronto Test Hotel');
    assert.equal(result.rows[0].photoUrl, 'https://images.example/toronto.jpg');
    assert.equal(result.rows[1].excludedFeesPresent, true);
    assert.equal(result.rows.every((row) => row.evidence === 'Test rate checked ΓÇö not a live booking price'), true);
    const sanitized = JSON.stringify(result);
    assert.doesNotMatch(sanitized, /opaque-offer|sand_unit_test_only|prebookId|rawProvider/i);
    assert.equal(requests.every((item) => item.keyHeaderPresent), true);
  });

  await check('wrapper preserves historical flight arithmetic but refuses a current total from legacy unproven hotel evidence', async () => {
    const hotelResult = {
      version: 'GV-HOTEL-708C', enabled: true, attempted: true, provider: 'Nuitee', reason: null,
      totalCount: 2, providerBackedCount: 2, verifiedCount: 2, allVerified: true, providerRequests: 4,
      freshHotelTotal: 1100, observedAt: '2026-09-02T22:01:00.000Z',
      rows: [
        { index: 0, city: 'Toronto', provider: 'Nuitee', state: 'verified', availabilityVerified: true, hotelName: 'Toronto Test Hotel', freshAmount: 600, currency: 'CAD', evidence: 'Price and availability rechecked by provider', excludedFeesPresent: false },
        { index: 1, city: 'Dublin', provider: 'Nuitee', state: 'verified', availabilityVerified: true, hotelName: 'Dublin Test Hotel', freshAmount: 500, currency: 'CAD', evidence: 'Price and availability rechecked by provider', excludedFeesPresent: true }
      ]
    };
    const out = await wrapper.handleBookingRevalidation707B(event(), {
      env: baseEnv,
      bearerToken: () => 'test-token',
      verifyToken: async () => ({ sub: 'owner-708c' }),
      getTrip: async () => savedTrip(),
      applyLiveFarePilot: async (tour) => liveResult(tour),
      enrichFlightLeg: (leg) => ({ ...leg, bookingUrl: `https://www.aviasales.com/search/${leg.from.airportCode}-${leg.to.airportCode}`, booking: { trust: { ctaLabel: 'Search this route on Aviasales' } } }),
      enrichStay: (stop) => ({ ...stop, hotel: { ...(stop.hotel || {}), bookingUrl: `https://www.agoda.com/search?city=${encodeURIComponent(stop.city)}` } }),
      verifyTourHotels: async () => hotelResult
    });
    assert.equal(out.statusCode, 200);
    assert.equal(out.headers['X-Globevoy-Hotel-Revalidation'], 'GV-LIVE-712');
    const body = JSON.parse(out.body);
    assert.equal(body.version, 'GV-WEB-707B');
    assert.equal(body.revalidation.calculationVersion, 'GV-WEB-707B-R1');
    assert.equal(body.revalidation.freshFlightTotal, 1400);
    assert.equal(body.revalidation.flightDelta, 10);
    assert.equal(body.revalidation.freshTripEstimate, 2310);
    assert.equal(body.hotelRevalidation.savedHotelEstimate, 910);
    assert.equal(body.hotelRevalidation.freshHotelTotal, null);
    assert.equal(body.hotelRevalidation.hotelDelta, null);
    assert.equal(body.hotelRevalidation.hotelAdjustedTripEstimate, null);
    assert.equal(body.currentPricing.currentTotal, null);
    assert.equal(body.currentPricing.status, 'estimate');
    assert.equal(body.hotelRevalidation.allVerified, true);
    assert.equal(body.hotels.every((row) => row.state === 'verified' && row.availabilityVerified === true), true);
    assert.equal(body.hotels[1].excludedFeesPresent, true);
    assert.equal(body.trust.hotelAvailabilityVerified, false);
    assert.deepEqual(body.bookingBoundary, { noBooking: true, noPayment: true, noOrderCreation: true, noReservation: true });
  });

  await check('partial hotel evidence preserves saved estimate and does not create combined hotel-adjusted total', async () => {
    const payload = {
      ok: true,
      hotels: [
        { index: 0, city: 'Toronto', nights: 3, savedEstimate: 400, currency: 'CAD', state: 'estimate', availabilityVerified: false, finalPriceRequiresPartnerConfirmation: true },
        { index: 1, city: 'Dublin', nights: 3, savedEstimate: 500, currency: 'CAD', state: 'estimate', availabilityVerified: false, finalPriceRequiresPartnerConfirmation: true }
      ],
      revalidation: { freshTripEstimate: 2310 },
      trust: { savedPricesAreSnapshots: true, hotelAvailabilityVerified: false, finalPartnerConfirmationRequired: true }
    };
    const result = {
      enabled: true, attempted: true, provider: 'Nuitee', totalCount: 2, verifiedCount: 1, providerBackedCount: 1, allVerified: false, providerRequests: 3, reason: 'prebook-http-409',
      rows: [
        { index: 0, provider: 'Nuitee', state: 'verified', availabilityVerified: true, freshAmount: 600, currency: 'CAD', evidence: 'Price and availability rechecked by provider' },
        { index: 1, provider: 'Nuitee', state: 'unavailable', availabilityVerified: false, reason: 'prebook-http-409' }
      ]
    };
    const next = wrapper._internal.applyHotelEvidence(payload, result, { priceSnapshot: { stayEstimate: 910 } });
    assert.equal(next.hotelRevalidation.allVerified, false);
    assert.equal(next.hotelRevalidation.freshHotelTotal, null);
    assert.equal(next.hotelRevalidation.hotelAdjustedTripEstimate, null);
    assert.equal(next.hotels[0].state, 'verified');
    assert.equal(next.hotels[1].state, 'estimate');
    assert.equal(next.hotels[1].savedEstimate, 500);
    assert.equal(next.trust.hotelAvailabilityVerified, false);
  });

  await check('staging wrapper owns 708C while production and 707B-R1 remain unchanged', async () => {
    const staging = read('backend/staging-lambda-702d.js');
    const r1 = read('backend/services/booking/revalidation/staging-booking-revalidation-707b-r1.js');
    const production = read('backend/lambda.js');
    assert.match(staging, /staging-booking-revalidation-708c/);
    assert.match(staging, /handleBookingRevalidation707B/);
    assert.match(r1, /GV-WEB-707B-R1/);
    assert.doesNotMatch(r1, /GV-HOTEL-708C|Nuitee/);
    assert.doesNotMatch(production, /GV-HOTEL-708C|Nuitee|NUITEE_SANDBOX_SECRET_ID/);
  });

  await check('React UI keeps evidence labels, fee warning, visuals and no booking claim', async () => {
    const component = read('web/components/booking/booking-workspace-client.tsx');
    const contracts = read('web/lib/contracts.ts');
    assert.match(component, /Check current prices/);
    assert.match(component, /Nuitee PREBOOK/);
    assert.match(component, /Some fees may be payable separately/);
    assert.match(component, /alt=\{`\$\{hotel\.hotelName \|\| hotel\.city\} hotel`\}/);
    assert.match(component, /Compare on Agoda/);
    assert.match(component, /does not process payment/);
    assert.match(contracts, /GV-HOTEL-708C/);
    assert.match(contracts, /'estimate' \| 'provider' \| 'verified'/);
  });

  checks.forEach((item, index) => {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.error ? `\n${item.error}` : ''}`);
  });
  const passed = checks.filter((item) => item.pass).length;
  console.log(`GV-HOTEL-708C: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exitCode = 1;
})();
