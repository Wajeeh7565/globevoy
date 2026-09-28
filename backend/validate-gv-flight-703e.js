'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com/';
const EXPECTED_ORIGINS = ['YYZ', 'JFK', 'LAX', 'DUB', 'DXB'];

process.env.CORS_ORIGIN = STAGING_ORIGIN;
delete process.env.ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A;
delete process.env.ENABLE_DUFFEL_LIVE_683D;
delete process.env.ENABLE_DUFFEL_SHADOW_683D;
delete process.env.DUFFEL_ACCESS_TOKEN;
delete process.env.GV_DUFFEL_MAX_ADULTS_703E;

// Mirror the staging wrapper installation order. 703C intentionally loads 684A
// before 703E; the adult scope is read dynamically so the later staging-only
// ceiling change is still safe and does not alter production/default behavior.
const policy703B = require('./services/staging-duffel-five-origin-703b');
const install703B = policy703B.install();
assert.equal(install703B.ok, true);
assert.equal(install703B.applied, true);

const shared703C = require('./services/staging-duffel-shared-budget-703c');
const install703C = shared703C.install();
assert.equal(install703C.ok, true);
assert.equal(install703C.applied, true);
assert.equal(shared703C.SHARED_PHYSICAL_REQUEST_CAP, 8);

const policy703D = require('./services/staging-affordable-flight-five-origin-703d');
const install703D = policy703D.install();
assert.equal(install703D.ok, true);
assert.equal(install703D.applied, true);

const policy703E = require('./services/staging-duffel-two-adult-703e');
const install703E = policy703E.install();
assert.equal(policy703E.VERSION, 'GV-FLIGHT-703E');
assert.equal(install703E.ok, true);
assert.equal(install703E.applied, true);
assert.equal(install703E.maxAdults, 2);
assert.deepEqual(install703E.origins, EXPECTED_ORIGINS);
assert.equal(install703E.sharedBudgetCap, 8);
assert.equal(install703E.publicLiveFarePilotEnabledBy703E, false);
assert.equal(install703E.providerCredentialsChanged, false);
assert.equal(install703E.awsEnvironmentVariablesAdded, 0);
assert.equal(install703E.productionChanged, false);
assert.equal(process.env.ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A, undefined);
assert.equal(process.env.DUFFEL_ACCESS_TOKEN, undefined);

const adultScope = require('./services/providers/flights/duffel/duffel-adult-scope-703e');
const adapter683D = require('./services/providers/flights/duffel/duffel-live-adapter-683d');
const live684A = require('./services/domain/live-fares/public-live-fare-pilot-684a');
const discovery684B = require('./services/domain/live-fares/affordable-flight-discovery-684b');
const fareSelection685C = require('./services/domain/live-fares/live-fare-selection-685c');
const travellerPricing = require('./services/domain/pricing/traveller-pricing');

assert.equal(adultScope.configuredMaxAdults703E(process.env), 2);
assert.equal(live684A.status684A(process.env).maxAdults, 2);
assert.equal(live684A.status684A(process.env).singleAdultOnly, false);
assert.equal(discovery684B.status684B(process.env).maxAdults, 2);
assert.equal(discovery684B.status684B(process.env).singleAdultOnly, false);
assert.deepEqual(discovery684B.status684B(process.env).originAllowlist, EXPECTED_ORIGINS);
assert.equal(fareSelection685C.VERSION_685C, 'GV-FLIGHT-685C');

function tour(origin = 'JFK', destination = 'MIA', date = '2026-10-15', planningFlightUsd = 300, budgetUsd = 500) {
  return {
    origin: { airportCode: origin },
    totalBudgetUsd: budgetUsd,
    estimatedTotalUsd: planningFlightUsd,
    legs: [{
      mode: 'flight',
      transportType: 'flight',
      from: { airportCode: origin },
      to: { airportCode: destination },
      departureDate: date,
      distanceKm: 1757,
      estimatedTransportUsd: planningFlightUsd,
      estimatedFlightUsd: planningFlightUsd,
      amountUsd: planningFlightUsd
    }],
    stops: [{ cityId: `${destination.toLowerCase()}-703e`, airportCode: destination }]
  };
}

function query(adults, budgetUsd = 500) {
  return {
    origin: 'JFK',
    adults,
    children: 0,
    infants: 0,
    rooms: 1,
    budget: budgetUsd,
    budgetUsd,
    currency: 'USD',
    pickRole: 'best-balance'
  };
}

function headers683D() {
  const rows = {
    'ratelimit-limit': '60',
    'ratelimit-remaining': '50',
    'ratelimit-reset': new Date(Date.now() + 60_000).toUTCString(),
    'x-request-id': 'req_703e_fake'
  };
  return { get(name) { return rows[String(name || '').toLowerCase()] ?? null; } };
}

const capturedOfferRequests = [];
async function fakeDuffelFetch(_url, init = {}) {
  const body = JSON.parse(String(init.body || '{}'));
  capturedOfferRequests.push(body);
  const passengerCount = Array.isArray(body?.data?.passengers) ? body.data.passengers.length : 0;
  const totalAmount = passengerCount === 1 ? '230.00' : passengerCount === 2 ? '420.00' : '999.00';
  const slice = Array.isArray(body?.data?.slices) ? body.data.slices[0] : {};
  const departureDate = String(slice?.departure_date || '2026-10-15');
  const payload = {
    data: {
      live_mode: true,
      offers: [{
        id: `off_703e_${passengerCount}`,
        live_mode: true,
        expires_at: '2099-10-15T12:00:00.000Z',
        total_amount: totalAmount,
        total_currency: 'USD',
        owner: { name: '703E QA Air', iata_code: 'QA' },
        slices: [{
          origin: { iata_code: slice.origin || 'JFK' },
          destination: { iata_code: slice.destination || 'MIA' },
          duration: 'PT3H',
          segments: [{
            origin: { iata_code: slice.origin || 'JFK' },
            destination: { iata_code: slice.destination || 'MIA' },
            departing_at: `${departureDate}T10:00:00.000Z`,
            arriving_at: `${departureDate}T13:00:00.000Z`,
            operating_carrier: { name: '703E QA Air' },
            operating_carrier_flight_number: '703'
          }]
        }]
      }]
    }
  };
  return {
    ok: true,
    status: 200,
    headers: headers683D(),
    async text() { return JSON.stringify(payload); }
  };
}

async function main() {
  // Production/non-staging remains one adult even if someone tries to set the
  // staging-only in-process key.
  const productionEnv = {
    CORS_ORIGIN: 'https://globevoy.com/',
    GV_DUFFEL_MAX_ADULTS_703E: '2',
    ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true',
    ENABLE_DUFFEL_LIVE_683D: 'true',
    ENABLE_DUFFEL_SHADOW_683D: 'true',
    DUFFEL_ACCESS_TOKEN: 'duffel_live_703e_fake',
    ENABLE_BOC_FX_683G: 'true',
    ENABLE_FX_NORMALIZATION_683G: 'true'
  };
  assert.equal(adultScope.configuredMaxAdults703E(productionEnv), 1);
  const prodTwoAdult = live684A.eligibility684A(tour(), query(2), productionEnv);
  assert.equal(prodTwoAdult.eligible, false);
  assert.equal(prodTwoAdult.reason, '684a-single-adult-pilot-only');
  assert.equal(discovery684B.status684B(productionEnv).maxAdults, 1);
  assert.deepEqual(discovery684B.status684B(productionEnv).originAllowlist, ['YYZ']);

  // Enable only the already-existing live provider gates in this deterministic
  // test process. The token is synthetic and fakeDuffelFetch prevents network use.
  process.env.ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A = 'true';
  process.env.ENABLE_DUFFEL_LIVE_683D = 'true';
  process.env.ENABLE_DUFFEL_SHADOW_683D = 'true';
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_live_703e_fake';
  process.env.ENABLE_BOC_FX_683G = 'true';
  process.env.ENABLE_FX_NORMALIZATION_683G = 'true';

  const oneAdultEligibility = live684A.eligibility684A(tour(), query(1), process.env);
  const twoAdultEligibility = live684A.eligibility684A(tour(), query(2), process.env);
  assert.equal(oneAdultEligibility.eligible, true);
  assert.equal(twoAdultEligibility.eligible, true);
  assert.equal(twoAdultEligibility.maxAdults, 2);
  assert.equal(twoAdultEligibility.party.travellers, 2);

  const threeAdults = live684A.eligibility684A(tour(), query(3), process.env);
  assert.equal(threeAdults.eligible, false);
  assert.equal(threeAdults.reason, '684a-one-or-two-adults-staging-pilot-only');
  const withChild = live684A.eligibility684A(tour(), { ...query(1), children: 1 }, process.env);
  assert.equal(withChild.eligible, false);
  const withInfant = live684A.eligibility684A(tour(), { ...query(1), infants: 1 }, process.env);
  assert.equal(withInfant.eligible, false);

  const discoveryTwoAdult = discovery684B.eligibility684B([tour()], null, query(2), process.env);
  assert.equal(discoveryTwoAdult.eligible, true);
  assert.equal(discoveryTwoAdult.maxAdults, 2);
  const discoveryThreeAdult = discovery684B.eligibility684B([tour()], null, query(3), process.env);
  assert.equal(discoveryThreeAdult.eligible, false);
  assert.equal(discoveryThreeAdult.reason, '684b-one-or-two-adults-staging-pilot-only');

  // Adapter-level proof: same exact itinerary/date, one adult vs two adults.
  // Duffel request body must contain one passenger object per adult, and the
  // returned total_amount is captured exactly once as PARTY TOTAL semantics.
  const adapterEnv = {
    ENABLE_DUFFEL_LIVE_683D: 'true',
    ENABLE_DUFFEL_SHADOW_683D: 'true',
    DUFFEL_ACCESS_TOKEN: 'duffel_live_703e_fake'
  };
  const adapterOne = await adapter683D.searchExactDate683D({
    origin: 'JFK', destination: 'MIA', departureDate: '2026-10-15', currency: 'USD', passengers: 1
  }, { env: adapterEnv, fetch: fakeDuffelFetch });
  const adapterTwo = await adapter683D.searchExactDate683D({
    origin: 'JFK', destination: 'MIA', departureDate: '2026-10-15', currency: 'USD', passengers: 2
  }, { env: adapterEnv, fetch: fakeDuffelFetch });
  assert.equal(adapterOne.supported, true);
  assert.equal(adapterTwo.supported, true);
  assert.equal(capturedOfferRequests[0].data.passengers.length, 1);
  assert.equal(capturedOfferRequests[1].data.passengers.length, 2);
  assert(capturedOfferRequests[1].data.passengers.every(row => row.type === 'adult'));
  assert.equal(adapterOne.observations[0].totalPrice, 230);
  assert.equal(adapterTwo.observations[0].totalPrice, 420);
  assert.equal(adapterTwo.observations[0].fareAmountBasis, 'party-total');
  assert.equal(adapterTwo.observations[0].providerPartyTotalAmount, 420);
  assert.equal(adapterTwo.observations[0].providerPassengerCount, 2);

  // Traveller-pricing proof: planning per-passenger fares still multiply, while
  // a live Duffel party total is preserved and remains preserved on a second
  // whole-tour pricing pass. This catches both double-counting and under-counting.
  const party2 = travellerPricing.normalizeParty(query(2));
  const planningPriced = travellerPricing.priceTransportLeg({
    mode: 'flight', transportType: 'flight', estimatedFlightUsd: 210
  }, query(2), { party: party2, unitAmountUsd: 210 });
  assert.equal(planningPriced.estimatedFlightUsd, 420);
  assert.equal(planningPriced.pricingIntegrity.amountBasis, 'per-unit');
  assert.equal(planningPriced.pricingIntegrity.multiplier, 2);

  const partyTotalPriced = travellerPricing.priceTransportLeg({
    mode: 'flight',
    transportType: 'flight',
    providerDateEvidence: {
      fareAmountBasis: 'party-total',
      providerPassengerCount: 2,
      passengers: 2,
      rankingPriceUsd: 420
    }
  }, query(2), { party: party2, amountBasis: 'party-total', partyTotalAmountUsd: 420 });
  assert.equal(partyTotalPriced.estimatedFlightUsd, 420);
  assert.equal(partyTotalPriced.pricingIntegrity.amountBasis, 'party-total');
  assert.equal(partyTotalPriced.pricingIntegrity.multiplier, 1);
  assert.equal(partyTotalPriced.pricingIntegrity.partyTotalUsd, 420);
  assert.equal(partyTotalPriced.pricingIntegrity.unitAmountUsd, 210);
  assert.equal(partyTotalPriced.providerDateEvidence.partyTotalAmountUsd, 420);
  assert.equal(partyTotalPriced.providerDateEvidence.passengerMultiplierApplied, false);

  const repriced = travellerPricing.applyTravellerPricingToTour({
    totalBudgetUsd: 500,
    legs: [partyTotalPriced],
    stops: []
  }, query(2));
  assert.equal(repriced.legs[0].estimatedFlightUsd, 420, 'party total must not be multiplied a second time');
  assert.equal(repriced.estimatedTotalUsd, 420);

  // End-to-end 684A proof with the real adapter + fake transport: same route/date,
  // one adult returns 230 and two adults returns provider party total 420 (not 840).
  capturedOfferRequests.length = 0;
  const liveRows = await shared703C.runWithBudget(async () => {
    const one = await live684A.applyPublicLiveFarePilot684A(tour('JFK', 'MIA', '2026-10-15', 300, 500), query(1), {
      env: process.env,
      fetchDuffel: fakeDuffelFetch
    });
    const two = await live684A.applyPublicLiveFarePilot684A(tour('JFK', 'MIA', '2026-10-15', 300, 500), query(2), {
      env: process.env,
      fetchDuffel: fakeDuffelFetch
    });
    return { one, two, budget: shared703C.snapshot() };
  }, { requestId: 'GV-FLIGHT-703E-DETERMINISTIC' });

  assert.equal(liveRows.one.summary.applied, true);
  assert.equal(liveRows.two.summary.applied, true);
  assert.equal(liveRows.one.tour.legs[0].estimatedFlightUsd, 230);
  assert.equal(liveRows.two.tour.legs[0].estimatedFlightUsd, 420);
  assert.notEqual(liveRows.two.tour.legs[0].estimatedFlightUsd, liveRows.one.tour.legs[0].estimatedFlightUsd * 2, 'do not force exact 2x semantics');
  assert.equal(liveRows.two.tour.legs[0].providerDateEvidence.fareAmountBasis, 'party-total');
  assert.equal(liveRows.two.tour.legs[0].providerDateEvidence.providerPassengerCount, 2);
  assert.equal(liveRows.two.tour.legs[0].providerDateEvidence.providerAmount, 420);
  assert.equal(liveRows.two.tour.legs[0].providerDateEvidence.rankingPriceUsd, 420);
  assert.equal(liveRows.two.tour.legs[0].pricingIntegrity.partyTotalUsd, 420);
  assert.equal(liveRows.two.tour.legs[0].pricingIntegrity.multiplier, 1);
  assert.equal(liveRows.two.summary.afterTotalUsd, 420);
  assert.equal(liveRows.two.summary.overBudget, false);
  assert.equal(liveRows.budget.used, 2);
  assert.equal(liveRows.budget.remaining, 6);
  assert.equal(liveRows.budget.cap, 8);
  assert.equal(capturedOfferRequests[0].data.passengers.length, 1);
  assert.equal(capturedOfferRequests[1].data.passengers.length, 2);

  // 684B budget semantics proof. With two adults and a provider party total of
  // 420, a 500 USD trip budget must pass while a 400 USD budget must fail. If
  // the provider total were doubled to 840 or divided to 210, one of these fails.
  async function runDiscovery(budgetUsd) {
    const planning = tour('JFK', 'MIA', '2026-10-15', 390, budgetUsd);
    return shared703C.runWithBudget(() => discovery684B.discoverAffordableFlightTour684B(
      [planning],
      null,
      query(2, budgetUsd),
      {
        env: process.env,
        enrichTour: async candidate => ({ tour: candidate }),
        applyLiveFare: (candidate, q) => live684A.applyPublicLiveFarePilot684A(candidate, q, { env: process.env, fetchDuffel: fakeDuffelFetch }),
        isOverBudget: (candidate, q) => Number(candidate?.estimatedTotalUsd || 0) > Number(q?.budgetUsd || 0),
        normalizeTour: candidate => candidate
      }
    ), { requestId: `GV-FLIGHT-703E-684B-${budgetUsd}` });
  }

  const discovery500 = await runDiscovery(500);
  const discovery400 = await runDiscovery(400);
  assert.equal(discovery500.summary.attempted, true);
  assert.equal(discovery500.summary.applied, true);
  assert.equal(discovery500.summary.selectedLiveTotalUsd, 420);
  assert.equal(discovery500.tour.estimatedTotalUsd, 420);
  assert.equal(discovery400.summary.attempted, true);
  assert.equal(discovery400.summary.applied, false);
  assert.equal(discovery400.summary.reason, '684b-no-complete-live-flight-route-within-budget');
  assert.equal(discovery400.summary.candidateDiagnostics[0].liveTotalUsd, 420);
  assert.equal(discovery400.summary.candidateDiagnostics[0].overBudget, true);

  const wrapperSource = fs.readFileSync(path.join(ROOT, 'staging-lambda-702d.js'), 'utf8');
  const productionSource = fs.readFileSync(path.join(ROOT, 'lambda.js'), 'utf8');
  const adapterSource = fs.readFileSync(path.join(ROOT, 'services', 'providers', 'flights', 'duffel', 'duffel-live-adapter-683d.js'), 'utf8');
  const pricingSource = fs.readFileSync(path.join(ROOT, 'services', 'domain', 'pricing', 'traveller-pricing.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT, 'services', 'staging-duffel-two-adult-703e.js'), 'utf8');

  const install703DIndex = wrapperSource.indexOf('stagingAffordable703D.install()');
  const install703EIndex = wrapperSource.indexOf('stagingAdults703E.install()');
  const stagingLoadIndex = wrapperSource.indexOf("require('./staging-lambda')");
  assert(install703DIndex >= 0);
  assert(install703EIndex > install703DIndex, '703E must install after 703D');
  assert(stagingLoadIndex > install703EIndex, '703E must install before ordinary staging Lambda loads');
  assert.match(wrapperSource, /X-Globevoy-Staging-Duffel-Adults/);
  assert.match(wrapperSource, /X-Globevoy-Staging-Duffel-Max-Adults/);
  assert.doesNotMatch(productionSource, /GV-FLIGHT-703E|staging-duffel-two-adult-703e|GV_DUFFEL_MAX_ADULTS_703E/);
  assert.match(adapterSource, /fareAmountBasis:\s*'party-total'/);
  assert.match(pricingSource, /provider-party-total-flight-fare/);
  assert.match(pricingSource, /providerPartyTotalPreserved/);
  assert.doesNotMatch(overlaySource, /api\.duffel\.com|DUFFEL_ACCESS_TOKEN\s*=|createOrder|paymentIntent|ticketOrder/i);
  assert.doesNotMatch(overlaySource, /ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A\s*=/);

  const output = {
    version: policy703E.VERSION,
    origins: EXPECTED_ORIGINS,
    maxAdultsStaging: 2,
    maxAdultsOutsideStaging: 1,
    childrenAllowed: false,
    infantsAllowed: false,
    providerPassengerArrayOneAdult: capturedOfferRequests[0]?.data?.passengers?.length || null,
    providerPassengerArrayTwoAdults: capturedOfferRequests[1]?.data?.passengers?.length || null,
    adapterOneAdultPartyTotalUsd: adapterOne.observations[0].totalPrice,
    adapterTwoAdultPartyTotalUsd: adapterTwo.observations[0].totalPrice,
    twoAdultLiveFareAppliedUsd: liveRows.two.tour.legs[0].estimatedFlightUsd,
    noSecondTravellerMultiplier: liveRows.two.tour.legs[0].estimatedFlightUsd === 420,
    budget500Applied: discovery500.summary.applied,
    budget400Rejected: discovery400.summary.applied === false,
    sharedDuffelBudgetCap: shared703C.SHARED_PHYSICAL_REQUEST_CAP,
    deterministicProviderCalls: capturedOfferRequests.length,
    realProviderCallsPerformed: false,
    publicDuffelEnabledBy703E: false,
    awsEnvironmentVariablesAdded: 0,
    productionChanged: false,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };

  delete process.env.DUFFEL_ACCESS_TOKEN;
  console.log('GV-FLIGHT-703E validation PASS');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  delete process.env.DUFFEL_ACCESS_TOKEN;
  console.error('GV-FLIGHT-703E validation FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
