'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const service = require('./services/staging-booking-revalidation-707b');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: error?.message || String(error) }); }
}

const ORIGIN = service.STAGING_ORIGIN;
const TRIP_ID = 'trip707b01';
const baseEnv = {
  GLOBEVOY_COGNITO_USER_POOL_ID: 'us-east-2_MSd9RRHD8',
  GLOBEVOY_COGNITO_APP_CLIENT_ID: 'o2ohbv50253hjli5s34rbvv79',
  GLOBEVOY_SAVED_TRIPS_TABLE: 'globevoy-staging-saved-trips'
};

function event(body = { tripId: TRIP_ID }, origin = ORIGIN, method = 'POST') {
  return {
    rawPath: service.ROUTE_PATH,
    requestContext: { http: { method } },
    headers: { origin, authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function savedTrip(kind = 'multi') {
  if (kind === 'single') {
    return {
      tripId: TRIP_ID,
      name: 'Single trip',
      status: 'planned',
      version: 1,
      updatedAt: '2026-08-21T20:00:00.000Z',
      tripSnapshot: { schemaVersion: 1, kind: 'single', clientSaveKey: 'single', origin: 'Dublin', city: 'Paris', travellers: 1 },
      priceSnapshot: { currency: 'EUR', tripEstimate: 500, capturedAt: '2026-08-21T20:00:00.000Z' }
    };
  }
  return {
    tripId: TRIP_ID,
    name: 'Alexandria + Antalya',
    status: 'planned',
    version: 1,
    updatedAt: '2026-08-21T20:00:00.000Z',
    tripSnapshot: {
      schemaVersion: 1,
      kind: 'multi',
      clientSaveKey: 'multi-707b',
      origin: 'Dublin',
      cities: [{ city: 'Alexandria' }, { city: 'Antalya' }],
      tour: {
        schemaVersion: 1,
        savedSnapshotMode: 'compact-account-route',
        origin: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' },
        cities: [
          { city: 'Alexandria', country: 'Egypt', code: 'HBE', airportCode: 'HBE', nights: 3, hotel: { estimatedStayUsd: 180 } },
          { city: 'Antalya', country: 'Türkiye', code: 'AYT', airportCode: 'AYT', nights: 3, hotel: { estimatedStayUsd: 195 } }
        ],
        backendLegs: [
          { from: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' }, to: { city: 'Alexandria', code: 'HBE', airportCode: 'HBE' }, mode: 'flight', departureDate: '2026-09-05', estimatedTransportUsd: 260, estimatedDisplayTotal: 240 },
          { from: { city: 'Alexandria', code: 'HBE', airportCode: 'HBE' }, to: { city: 'Antalya', code: 'AYT', airportCode: 'AYT' }, mode: 'flight', departureDate: '2026-09-08', estimatedTransportUsd: 100, estimatedDisplayTotal: 92 },
          { from: { city: 'Antalya', code: 'AYT', airportCode: 'AYT' }, to: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' }, mode: 'flight', departureDate: '2026-09-11', estimatedTransportUsd: 245, estimatedDisplayTotal: 225 }
        ],
        stays: [
          { city: 'Alexandria', country: 'Egypt', nights: 3, hotel: { estimatedStayUsd: 180 } },
          { city: 'Antalya', country: 'Türkiye', nights: 3, hotel: { estimatedStayUsd: 195 } }
        ],
        displayBudget: { currency: 'EUR', totalBudget: 1000, tripEstimate: 935, reserveAmount: 65, exchangeRateFromUsd: 0.92 },
        canonicalPricing: { canonicalDisplayTotal: 935, transportDisplayTotal: 557, stayDisplayTotal: 378, exchangeRateFromUsd: 0.92 },
        passengerPricing: { adults: 1, children: 0, infants: 0, travellers: 1, passengers: 1, rooms: 1 }
      }
    },
    priceSnapshot: { currency: 'EUR', totalBudget: 1000, reserve: 65, flightEstimate: 557, stayEstimate: 378, tripEstimate: 935, capturedAt: '2026-08-21T20:00:00.000Z' }
  };
}

function liveResult(tour, amounts = [250, 110, 245]) {
  const legs = tour.legs.map((leg, index) => ({
    ...leg,
    liveFareVerified: true,
    providerDateEvidence: {
      sourceType: 'LIVE',
      providerBacked: true,
      productionEligible: true,
      appliedToEstimate: true,
      requestedOrigin: leg.from.airportCode,
      requestedDestination: leg.to.airportCode,
      resolvedOrigin: leg.from.airportCode,
      resolvedDestination: leg.to.airportCode,
      departureDate: leg.departureDate,
      displayPrice: amounts[index],
      displayCurrency: 'EUR',
      rankingPriceUsd: amounts[index] / 0.92,
      fareAmountBasis: 'party-total',
      providerPassengerCount: 1,
      providerReference: `offer-${index + 1}`,
      observedAt: '2026-08-22T00:30:00.000Z',
      expiresAt: '2026-08-22T00:45:00.000Z',
      airportMode683H: 'EXACT'
    }
  }));
  return {
    tour: { ...tour, legs },
    summary: {
      attempted: true,
      applied: true,
      allFlightLegsLive: true,
      requiredFlightLegCount: 3,
      liveFlightLegCount: 3,
      providerRequests: 3,
      exactRequests: 3,
      metroRequests: 0,
      afterTotalUsd: 1000,
      overBudget: false
    }
  };
}

function options(overrides = {}) {
  return {
    env: baseEnv,
    bearerToken: () => 'test-token',
    verifyToken: async () => ({ sub: 'owner-sub-707b' }),
    getTrip: async () => savedTrip(),
    applyLiveFarePilot: async (tour) => liveResult(tour),
    enrichFlightLeg: (leg) => ({ ...leg, bookingUrl: `https://www.aviasales.com/search/${leg.from.airportCode}-${leg.to.airportCode}`, booking: { trust: { ctaLabel: 'Search this route on Aviasales' } } }),
    enrichStay: (stop) => ({ ...stop, hotel: { ...(stop.hotel || {}), bookingUrl: `https://www.agoda.com/search?city=${encodeURIComponent(stop.city)}` } }),
    ...overrides
  };
}

(async () => {
  await check('version and route are exact', async () => {
    assert.equal(service.VERSION, 'GV-WEB-707B');
    assert.equal(service.ROUTE_PATH, '/api/account/booking-revalidate');
  });

  await check('correct origin preflight is isolated to POST and Authorization', async () => {
    const out = service.preflight(event({}, ORIGIN, 'OPTIONS'));
    assert.equal(out.statusCode, 204);
    assert.equal(out.headers['Access-Control-Allow-Origin'], ORIGIN);
    assert.equal(out.headers['Access-Control-Allow-Methods'], 'POST,OPTIONS');
    assert.match(out.headers['Access-Control-Allow-Headers'], /Authorization/);
  });

  await check('wrong origin fails closed without allow-origin', async () => {
    const out = await service.handleBookingRevalidation707B(event({ tripId: TRIP_ID }, 'https://evil.example'), options());
    assert.equal(out.statusCode, 403);
    assert.equal(out.headers['Access-Control-Allow-Origin'], undefined);
  });

  await check('request accepts tripId only', async () => {
    const out = await service.handleBookingRevalidation707B(event({ tripId: TRIP_ID, ownerSub: 'attacker', tour: {} }), options());
    assert.equal(out.statusCode, 400);
    assert.match(out.body, /trip-id-only-request-required/);
  });

  await check('invalid token fails before Saved Trip lookup', async () => {
    let read = false;
    const out = await service.handleBookingRevalidation707B(event(), options({
      verifyToken: async () => { throw new Error('bad-token'); },
      getTrip: async () => { read = true; return savedTrip(); }
    }));
    assert.equal(out.statusCode, 401);
    assert.equal(read, false);
  });

  await check('verified Cognito sub owns the exact DynamoDB read', async () => {
    let owner = null;
    let requested = null;
    const out = await service.handleBookingRevalidation707B(event(), options({
      verifyToken: async () => ({ sub: 'verified-owner-only' }),
      getTrip: async (sub, tripId) => { owner = sub; requested = tripId; return savedTrip(); }
    }));
    assert.equal(out.statusCode, 200);
    assert.equal(owner, 'verified-owner-only');
    assert.equal(requested, TRIP_ID);
  });

  await check('compact Saved Trip is reconstructed for 684A without client route data', async () => {
    let seenTour = null;
    let seenQuery = null;
    const out = await service.handleBookingRevalidation707B(event(), options({
      applyLiveFarePilot: async (tour, query) => { seenTour = tour; seenQuery = query; return liveResult(tour); }
    }));
    assert.equal(out.statusCode, 200);
    assert.equal(seenTour.legs.length, 3);
    assert.equal(seenTour.stops.length, 2);
    assert.equal(seenTour.legs[0].from.airportCode, 'DUB');
    assert.equal(seenTour.legs[0].departureDate, '2026-09-05');
    assert.equal(seenQuery.adults, 1);
    assert.equal(seenQuery.currency, 'EUR');
    assert.equal(seenQuery.budget, 1000);
  });

  await check('complete LIVE evidence reports changed state and unlocks comparison only', async () => {
    const out = await service.handleBookingRevalidation707B(event(), options());
    assert.equal(out.statusCode, 200);
    const body = JSON.parse(out.body);
    assert.equal(body.version, 'GV-WEB-707B');
    assert.equal(body.revalidation.applied, true);
    assert.equal(body.revalidation.allFlightLegsLive, true);
    assert.equal(body.revalidation.state, 'changed');
    assert.equal(body.revalidation.handoffEnabled, true);
    assert.equal(body.revalidation.orderCapability, false);
    assert.equal(body.revalidation.paymentCapability, false);
    assert.equal(body.revalidation.bookingCapability, false);
    assert.equal(body.revalidation.ticketingCapability, false);
    assert.equal(body.flights.length, 3);
    assert.equal(body.flights.every((row) => row.sourceType === 'LIVE' && row.productionEligible === true && row.handoffEnabled === true), true);
    assert.equal(body.hotels.every((row) => row.state === 'estimate' && row.availabilityVerified === false), true);
  });

  await check('incomplete provider coverage keeps all flight handoffs locked', async () => {
    const out = await service.handleBookingRevalidation707B(event(), options({
      applyLiveFarePilot: async (tour) => ({ tour, summary: { attempted: true, applied: false, allFlightLegsLive: false, reason: '684a-incomplete-live-flight-coverage-fail-closed' } })
    }));
    const body = JSON.parse(out.body);
    assert.equal(out.statusCode, 200);
    assert.equal(body.revalidation.state, 'unavailable');
    assert.equal(body.revalidation.handoffEnabled, false);
    assert.equal(body.flights.length, 0);
  });

  await check('single destination stays fail-closed in this bounded pilot', async () => {
    const out = await service.handleBookingRevalidation707B(event(), options({ getTrip: async () => savedTrip('single') }));
    const body = JSON.parse(out.body);
    assert.equal(out.statusCode, 200);
    assert.equal(body.revalidation.state, 'unavailable');
    assert.equal(body.revalidation.reason, '707b-multi-city-live-revalidation-pilot-only');
    assert.equal(body.revalidation.handoffEnabled, false);
  });

  await check('missing owner-private trip returns 404', async () => {
    const out = await service.handleBookingRevalidation707B(event(), options({ getTrip: async () => null }));
    assert.equal(out.statusCode, 404);
  });

  await check('response contains no raw provider or credentials', async () => {
    const out = await service.handleBookingRevalidation707B(event(), options());
    assert.doesNotMatch(out.body, /rawProvider|providerResponse|accessToken|refreshToken|DUFFEL_ACCESS_TOKEN|client_secret/i);
  });

  await check('staging wrapper owns exact 707B route and production handler is untouched', async () => {
    const wrapper = read('backend/staging-lambda-702d.js');
    const production = read('backend/lambda.js');
    assert.match(wrapper, /staging-booking-revalidation-707b/);
    assert.match(wrapper, /isBookingRevalidationRoute/);
    assert.match(wrapper, /handleBookingRevalidation707B/);
    assert.doesNotMatch(production, /GV-WEB-707B|booking-revalidate|staging-booking-revalidation-707b/);
  });

  await check('React workspace requires explicit user-triggered revalidation and no direct Duffel token', async () => {
    const workspace = read('web/components/booking/booking-workspace-client.tsx');
    const api = read('web/lib/api.ts');
    const trips = read('web/components/account/my-trips-client.tsx');
    assert.match(workspace, /Check current flight prices/);
    assert.match(workspace, /does not process payment/);
    assert.match(workspace, /Handoff locked/);
    assert.match(api, /\/api\/account\/booking-revalidate/);
    assert.match(api, /\{ tripId: id \}/);
    assert.match(trips, /\/react\/booking\/\?tripId=/);
    assert.doesNotMatch(`${workspace}\n${api}`, /DUFFEL_ACCESS_TOKEN|client_secret|sk_live_/i);
  });

  checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.error ? `: ${item.error}` : ''}`));
  const passed = checks.filter((item) => item.pass).length;
  console.log(`GV-WEB-707B: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exitCode = 1;
})();
