'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { verifyTourWithLiveProviders, LIVE_PROVIDER_VERIFICATION_VERSION } = require('./services/live-provider-verification');
const { buildVisualizerTour } = require('./generated-tour');
const { _clearCache } = require('./services/cheap-one-way-flights');

process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = 'true';
process.env.ENABLE_CANONICAL_TOTAL_EVIDENCE_INTEGRITY_667B = 'true';
process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';
process.env.ENABLE_PASSENGER_ROOM_PRICING_666A = 'true';
process.env.TRAVELPAYOUTS_TOKEN = 'test-token';
process.env.AGODA_SITE_ID = 'test-site';
process.env.AGODA_API_KEY = 'test-key';
process.env.ENABLE_PRICE_AUDIT_610D = 'false';
process.env.CAD_TO_USD = '0.735';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

function providerFetch({ flightPrices = {}, includeExact = true, hotelRate = 80 } = {}) {
  return async (url, options = {}) => {
    if (String(url).includes('/aviasales/v3/prices_for_dates')) {
      const parsed = new URL(url);
      const origin = parsed.searchParams.get('origin');
      const destination = parsed.searchParams.get('destination');
      const key = `${origin}-${destination}`;
      const date = key === 'YYZ-HAV' ? '2026-10-31' : key === 'TQO-YYZ' ? '2026-11-05' : '2026-11-03';
      const rows = includeExact ? [{
        departure_at: `${date}T09:30:00Z`,
        price: flightPrices[key] || 100,
        airline: 'XX',
        duration: 240,
        transfers: 0,
        link: `/search/${origin}${date.slice(8,10)}${date.slice(5,7)}${destination}1`
      }] : [{
        departure_at: '2026-12-01T09:30:00Z',
        price: 90,
        airline: 'XX',
        duration: 240,
        transfers: 0,
        link: `/search/${origin}0112${destination}1`
      }];
      return response({ data: rows });
    }
    if (String(url).includes('affiliateapi')) {
      const body = JSON.parse(options.body || '{}');
      assert(body.criteria.checkInDate, 'Agoda check-in must be exact');
      assert(body.criteria.checkOutDate, 'Agoda check-out must be exact');
      return response({ results: [{
        hotelName: 'Verified Central Hotel',
        dailyRate: hotelRate,
        landingURL: 'https://www.agoda.com/verified-central-hotel.html',
        reviewScore: 8.6,
        starRating: 4,
        reviewCount: 850
      }] });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
}

function sampleTour() {
  return {
    totalBudgetUsd: 1470,
    origin: { city: 'Toronto', code: 'YYZ', airportCode: 'YYZ' },
    legs: [
      { mode: 'flight', from: { city: 'Toronto', code: 'YYZ' }, to: { city: 'Havana', code: 'HAV' }, departureDate: '2026-10-31', estimatedTransportUsd: 220 },
      { mode: 'flight', from: { city: 'Havana', code: 'HAV' }, to: { city: 'Tulum', code: 'TQO' }, departureDate: '2026-11-03', estimatedTransportUsd: 180 },
      { mode: 'flight', from: { city: 'Tulum', code: 'TQO' }, to: { city: 'Toronto', code: 'YYZ' }, departureDate: '2026-11-05', estimatedTransportUsd: 230 }
    ],
    stops: [
      { city: 'Havana', code: 'HAV', agodaCityId: 123, nights: 3, arrivalDate: '2026-10-31', departureDate: '2026-11-03', hotel: { estimatedNightlyUsd: 70, estimatedStayUsd: 210 } },
      { city: 'Tulum', code: 'TQO', agodaCityId: 456, nights: 2, arrivalDate: '2026-11-03', departureDate: '2026-11-05', hotel: { estimatedNightlyUsd: 75, estimatedStayUsd: 150 } }
    ]
  };
}

async function run() {
  const checks = [];
  const check = (name, condition) => {
    assert(condition, name);
    checks.push({ name, passed: true });
  };

  _clearCache();
  const query = { budget: 2000, currency: 'CAD', adults: 2, children: 0, infants: 0, rooms: 1 };
  const verified = await verifyTourWithLiveProviders(sampleTour(), query, { _fetchFn: providerFetch() });
  check('version', verified.summary.version === LIVE_PROVIDER_VERIFICATION_VERSION);
  check('all critical items verified', verified.summary.allCriticalVerified === true && verified.summary.verifiedCount === 5);
  check('provider-backed budget claim', verified.summary.budgetClaim === 'provider-backed-fit');
  check('two-person flight pricing applied', verified.tour.legs[0].pricingIntegrity.multiplier === 2 && verified.tour.legs[0].estimatedTransportUsd === 147);
  check('exact flight date retained', verified.tour.legs[0].providerVerification.exactDateMatch === true && verified.tour.legs[0].departureDate === '2026-10-31');
  check('provider evidence timestamp recorded', Boolean(verified.tour.legs[0].providerDateEvidence.observedAt));
  check('hotel exact dates and occupancy recorded', verified.tour.stops[0].hotel.providerVerification.exactStayDates === true && verified.tour.stops[0].hotel.providerVerification.party.adults === 2);
  check('hotel rate scales by one room', verified.tour.stops[0].hotel.estimatedStayUsd === 177);
  const visual = buildVisualizerTour(verified.tour, query, { summary: { month: '2026-10' }, liveProviderVerification: verified.summary });
  check('flight partner link carries exact route date and party', visual.backendLegs[0].booking.route.departureDate === '2026-10-31' && visual.backendLegs[0].booking.passengers.seatCount === 2 && visual.backendLegs[0].booking.url.startsWith('https://'));
  check('Agoda link carries stay dates rooms and guests', visual.stays[0].hotel.booking.checkIn === '2026-10-31' && visual.stays[0].hotel.booking.checkOut === '2026-11-03' && visual.stays[0].hotel.booking.passengers.rooms === 1);
  check('live verification is exposed in provenance', visual.priceProvenance.liveProviderVerification?.version === LIVE_PROVIDER_VERIFICATION_VERSION);

  _clearCache();
  const missingTour = sampleTour(); missingTour.totalBudgetUsd = 2205;
  const missing = await verifyTourWithLiveProviders(missingTour, { ...query, budget: 3000 }, { _fetchFn: providerFetch({ includeExact: false }) });
  check('missing exact flight date remains estimate', missing.summary.flightVerified === 0 && missing.summary.budgetClaim === 'estimated-to-fit-budget');
  check('comparison links remain partner-confirmed later', missing.summary.finalAvailabilityRequiresPartnerConfirmation === true);

  _clearCache();
  const expensive = await verifyTourWithLiveProviders(sampleTour(), query, {
    _fetchFn: providerFetch({ flightPrices: { 'YYZ-HAV': 900, 'HAV-TQO': 700, 'TQO-YYZ': 900 }, hotelRate: 250 })
  });
  check('provider verification can invalidate budget', expensive.summary.overBudget === true && expensive.summary.budgetClaim === 'over-budget-after-provider-verification');

  const frontendRoot = path.join(__dirname, '..', 'gv_live_667b_frontend');
  const frontendScript = fs.readFileSync(path.join(frontendRoot, 'scripts', 'multicity-visualizer-651b.js'), 'utf8');
  const frontendHtml = fs.readFileSync(path.join(frontendRoot, 'multicity-visualizer.html'), 'utf8');
  check('frontend shows provider-backed fit only for fully verified critical prices', frontendScript.includes("providerBackedFit=live.budgetClaim==='provider-backed-fit'&&live.allCriticalVerified===true"));
  check('frontend distinguishes exact-date evidence from estimates', frontendScript.includes('Exact-date provider evidence') && frontendScript.includes('Exact-date Agoda evidence'));
  check('frontend cache version is bumped to 667a', frontendHtml.includes('multicity-visualizer-651b.js?v=667b'));

  const output = {
    version: LIVE_PROVIDER_VERIFICATION_VERSION,
    passed: checks.length,
    total: checks.length,
    checks,
    notes: [
      'Tests use deterministic provider-shaped responses; no production credentials were used.',
      'Final inventory and price remain confirmed on partner websites.'
    ]
  };
  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
