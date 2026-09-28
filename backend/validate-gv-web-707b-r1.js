'use strict';

const assert = require('node:assert/strict');
const service = require('./services/booking/revalidation/staging-booking-revalidation-707b-r1');

const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: error?.message || String(error) }); }
}

function compactTrip() {
  return {
    tripId: 'trip707br1',
    name: 'Alexandria + Antalya',
    tripSnapshot: {
      kind: 'multi',
      tour: {
        savedSnapshotMode: 'compact-account-route',
        origin: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' },
        backendLegs: [
          {
            mode: 'flight',
            from: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' },
            to: { city: 'Alexandria', code: 'HBE', airportCode: 'HBE' },
            departureDate: '2026-09-05',
            estimatedTransportUsd: 255 / 0.92
          },
          {
            mode: 'flight',
            from: { city: 'Alexandria', code: 'HBE', airportCode: 'HBE' },
            to: { city: 'Antalya', code: 'AYT', airportCode: 'AYT' },
            departureDate: '2026-09-08',
            estimatedTransportUsd: 97 / 0.92
          },
          {
            mode: 'flight',
            from: { city: 'Antalya', code: 'AYT', airportCode: 'AYT' },
            to: { city: 'Dublin', code: 'DUB', airportCode: 'DUB' },
            departureDate: '2026-09-11',
            estimatedTransportUsd: 236 / 0.92
          }
        ],
        stays: [
          { city: 'Alexandria', country: 'Egypt', nights: 3, hotel: { estimatedStayUsd: 167 / 0.92 } },
          { city: 'Antalya', country: 'Turkey', nights: 3, hotel: { estimatedStayUsd: 181 / 0.92 } }
        ],
        displayBudget: {
          currency: 'EUR',
          totalBudget: 1000,
          tripEstimate: 935,
          exchangeRateFromUsd: 0.92
        },
        canonicalPricing: {
          canonicalDisplayTotal: 935,
          exchangeRateFromUsd: 0.92
        },
        passengerPricing: { adults: 1, travellers: 1, passengers: 1, rooms: 1 }
      }
    },
    // This mirrors the compact 705C-R3 account snapshot that exposed the bug:
    // no priceSnapshot.flightEstimate and no canonical transportDisplayTotal.
    priceSnapshot: {
      currency: 'EUR',
      totalBudget: 1000,
      tripEstimate: 935,
      capturedAt: '2026-08-21T20:57:00.000Z'
    }
  };
}

function buggy707BPayload() {
  return {
    ok: true,
    version: 'GV-WEB-707B',
    snapshot: {
      currency: 'EUR',
      savedFlightTotal: 0,
      savedTripTotal: 935
    },
    revalidation: {
      state: 'verified',
      applied: true,
      allFlightLegsLive: true,
      freshFlightTotal: 1213,
      flightDelta: 1213,
      freshTripEstimate: 2148,
      handoffEnabled: true
    },
    flights: [
      { index: 0, origin: 'DUB', destination: 'HBE', savedAmount: 0, freshAmount: 550, sourceType: 'LIVE', productionEligible: true },
      { index: 1, origin: 'HBE', destination: 'AYT', savedAmount: 0, freshAmount: 375, sourceType: 'LIVE', productionEligible: true },
      { index: 2, origin: 'AYT', destination: 'DUB', savedAmount: 0, freshAmount: 287, sourceType: 'LIVE', productionEligible: true }
    ],
    hotels: [
      { city: 'Alexandria', savedEstimate: 167, state: 'estimate' },
      { city: 'Antalya', savedEstimate: 181, state: 'estimate' }
    ],
    trust: { savedPricesAreSnapshots: true }
  };
}

(async () => {
  await check('R1 version and route preserve the 707B endpoint', async () => {
    assert.equal(service.VERSION, 'GV-WEB-707B-R1');
    assert.equal(service.ROUTE_PATH, '/api/account/booking-revalidate');
  });

  await check('compact canonical USD legs restore the saved EUR flight baseline', async () => {
    const trip = compactTrip();
    const tour = require('./services/booking/revalidation/staging-booking-revalidation-707b')._internal.hydrateSavedTour(trip);
    assert.equal(Math.round(service._internal.savedFlightDisplayTotal(trip, tour)), 588);
    assert.deepEqual(
      tour.legs.map((leg) => Math.round(service._internal.savedLegDisplayAmount(leg, tour))),
      [255, 97, 236]
    );
  });

  await check('R1 removes the live-flight double count from the combined estimate', async () => {
    const corrected = service._internal.correctSuccessfulPayload(buggy707BPayload(), compactTrip());
    assert.equal(corrected.snapshot.savedFlightTotal, 588);
    assert.equal(corrected.revalidation.freshFlightTotal, 1212);
    assert.equal(corrected.revalidation.flightDelta, 624);
    assert.equal(corrected.revalidation.freshTripEstimate, 1559);
    assert.equal(corrected.revalidation.state, 'changed');
    assert.equal(corrected.revalidation.calculationVersion, 'GV-WEB-707B-R1');
    assert.equal(corrected.trust.bookingRevalidationCalculationVersion, 'GV-WEB-707B-R1');
    assert.deepEqual(corrected.flights.map((row) => Math.round(row.savedAmount)), [255, 97, 236]);
  });

  await check('explicit saved flight snapshot remains authoritative when present', async () => {
    const trip = compactTrip();
    trip.priceSnapshot.flightEstimate = 600;
    const tour = require('./services/booking/revalidation/staging-booking-revalidation-707b')._internal.hydrateSavedTour(trip);
    assert.equal(service._internal.savedFlightDisplayTotal(trip, tour), 600);
  });

  await check('unavailable or partial provider results are not rewritten into success', async () => {
    const payload = buggy707BPayload();
    payload.revalidation.applied = false;
    payload.revalidation.allFlightLegsLive = false;
    payload.revalidation.state = 'unavailable';
    const corrected = service._internal.correctSuccessfulPayload(payload, compactTrip());
    assert.equal(corrected.revalidation.state, 'unavailable');
    assert.equal(corrected.revalidation.freshTripEstimate, 2148);
  });

  checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.error ? `: ${item.error}` : ''}`));
  const passed = checks.filter((item) => item.pass).length;
  console.log(`GV-WEB-707B-R1: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exitCode = 1;
})();
