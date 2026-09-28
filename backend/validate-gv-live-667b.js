'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { verifyTourWithLiveProviders, LIVE_PROVIDER_VERIFICATION_VERSION } = require('./services/live-provider-verification');
const { applyCanonicalIntegrity, CANONICAL_INTEGRITY_VERSION } = require('./services/domain/pricing/canonical-total-evidence');
const { normalizeAirportIntegrity } = require('./services/domain/routing/route-feasibility');
const { applyTravellerPricingToTour } = require('./services/domain/pricing/traveller-pricing');
const { buildVisualizerTour } = require('./generated-tour');
const { _clearCache } = require('./services/cheap-one-way-flights');

process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = 'true';
process.env.ENABLE_CANONICAL_TOTAL_EVIDENCE_INTEGRITY_667B = 'true';
process.env.ENABLE_PASSENGER_ROOM_PRICING_666A = 'true';
process.env.TRAVELPAYOUTS_TOKEN = 'test-token';
process.env.AGODA_SITE_ID = 'test-site';
process.env.AGODA_API_KEY = 'test-key';
process.env.ENABLE_PRICE_AUDIT_610D = 'false';
process.env.CAD_TO_USD = '0.735';

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(payload); } };
}

function providerFetch() {
  return async (url, options = {}) => {
    if (String(url).includes('/aviasales/v3/prices_for_dates')) {
      const parsed = new URL(url);
      const origin = parsed.searchParams.get('origin');
      const destination = parsed.searchParams.get('destination');
      const dates = { 'ALG-AYT': '2026-08-05', 'AYT-CAI': '2026-08-08', 'CAI-ALG': '2026-08-10' };
      const prices = { 'ALG-AYT': 112, 'AYT-CAI': 147, 'CAI-ALG': 225 };
      const key = `${origin}-${destination}`;
      const date = dates[key] || '2026-08-05';
      return response({ data: [{ departure_at: `${date}T09:00:00Z`, price: prices[key] || 100, airline: 'XX', duration: 180, transfers: 0, link: `/search/${origin}${date.slice(8,10)}${date.slice(5,7)}${destination}1` }] });
    }
    if (String(url).includes('affiliateapi')) {
      const body = JSON.parse(options.body || '{}');
      return response({ results: [{ hotelName: 'Verified Hotel', dailyRate: body.criteria.cityId === 100 ? 95 : 55, landingURL: 'https://www.agoda.com/verified-hotel.html', reviewScore: 8.6, starRating: 4, reviewCount: 900 }] });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
}

function sampleTour() {
  return {
    totalBudgetUsd: 1000,
    totalNights: 5,
    displayBudget: { currency: 'USD', totalBudget: 1000, tripEstimate: 745, flightEstimate: 400, accommodationEstimate: 345, usableTripBudget: 900, reserveAmount: 100 },
    origin: { city: 'Algiers', country: 'Algeria', code: 'ALG', airportCode: 'ALG', latitude: 36.75, longitude: 3.04 },
    legs: [
      { mode: 'flight', from: { city: 'Algiers', code: 'ALG' }, to: { city: 'Antalya', code: 'AYT' }, departureDate: '2026-08-05', estimatedTransportUsd: 112 },
      { mode: 'flight', from: { city: 'Antalya', code: 'AYT' }, to: { city: 'Cairo', code: 'CAI' }, departureDate: '2026-08-08', estimatedTransportUsd: 147 },
      { mode: 'flight', from: { city: 'Cairo', code: 'CAI' }, to: { city: 'Algiers', code: 'ALG' }, departureDate: '2026-08-10', estimatedTransportUsd: 225 }
    ],
    stops: [
      { city: 'Antalya', country: 'Turkey', code: 'AYT', agodaCityId: 100, nights: 3, arrivalDate: '2026-08-05', departureDate: '2026-08-08', hotel: { estimatedNightlyUsd: 65, estimatedStayUsd: 195 } },
      { city: 'Cairo', country: 'Egypt', code: 'CAI', agodaCityId: 200, nights: 2, arrivalDate: '2026-08-08', departureDate: '2026-08-10', hotel: { estimatedNightlyUsd: 55, estimatedStayUsd: 110 } }
    ]
  };
}

async function run() {
  const checks = [];
  const check = (name, condition) => { assert(condition, name); checks.push({ name, passed: true }); };

  // Canonical ledger repairs a deliberately stale header total.
  const stale = applyCanonicalIntegrity(applyTravellerPricingToTour(sampleTour(), { currency: 'USD', adults: 1 }), { currency: 'USD', adults: 1, budget: 1000 });
  const componentSum = stale.canonicalPricing.components.reduce((sum, item) => sum + item.amountDisplay, 0);
  check('canonical header total equals visible component total', stale.displayBudget.tripEstimate === componentSum && stale.canonicalPricing.canonicalDisplayTotal === componentSum);
  check('stale display budget is replaced', stale.displayBudget.tripEstimate !== 745);
  check('canonical internal total equals transport plus stays', stale.estimatedTotalUsd === stale.totalTransportEstimateUsd + stale.totalHotelEstimateUsd);

  // Injected provider-shaped data must not count as production evidence by default.
  delete process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION;
  _clearCache();
  const testOnly = await verifyTourWithLiveProviders(sampleTour(), { budget: 1000, currency: 'USD', adults: 1 }, { _fetchFn: providerFetch() });
  check('injected flight and hotel responses are not production evidence', testOnly.summary.verifiedCount === 0 && testOnly.summary.budgetClaim === 'estimated-to-fit-budget');
  check('test-only Agoda response is explicitly ineligible', testOnly.tour.stops[0].hotel.providerVerification.productionEligible === false);

  // Production-shaped validation mode proves the final aggregation path.
  process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';
  _clearCache();
  const verified = await verifyTourWithLiveProviders(sampleTour(), { budget: 1000, currency: 'USD', adults: 1 }, { _fetchFn: providerFetch() });
  check('667b versions are exposed', verified.summary.version === LIVE_PROVIDER_VERIFICATION_VERSION && verified.summary.canonicalIntegrityVersion === CANONICAL_INTEGRITY_VERSION);
  check('evidence counter is derived from final ledger', verified.summary.verifiedCount === verified.tour.canonicalPricing.verifiedCount && verified.summary.criticalCount === verified.tour.canonicalPricing.criticalCount);
  check('summary total equals final visible ledger', verified.summary.estimatedTotalUsd === verified.tour.canonicalPricing.visibleCardTotalUsd && verified.summary.totalsMatchVisibleCards === true);

  const visual = buildVisualizerTour(verified.tour, { budget: 1000, currency: 'USD', adults: 1 }, { summary: { month: '2026-08' }, liveProviderVerification: verified.summary });
  const visualComponentSum = visual.canonicalPricing.components.reduce((sum, item) => sum + item.amountDisplay, 0);
  check('visualizer header uses canonical total', visual.budget.estimatedCoreTotal.amount === visualComponentSum);
  check('visualizer card records carry canonical amounts', visual.backendLegs.every((leg, index) => leg.canonicalPricing?.key === `transport:${index}`) && visual.stays.every((stay, index) => stay.hotel?.canonicalPricing?.key === `stay:${index}`));
  check('provider flight button preserves exact route and date', visual.backendLegs[0].booking.route.origin === 'ALG' && visual.backendLegs[0].booking.route.destination === 'AYT' && visual.backendLegs[0].booking.route.departureDate === '2026-08-05');
  check('provider hotel link preserves exact stay dates', visual.stays[0].hotel.booking.checkIn === '2026-08-05' && visual.stays[0].hotel.booking.checkOut === '2026-08-08');

  // Paris defaults to a practical main airport; deliberate BVA use carries access cost.
  const parisDefault = normalizeAirportIntegrity({ origin: { city: 'Paris', country: 'France', code: 'BVA', airportCode: 'BVA' }, stops: [{ city: 'Stockholm', country: 'Sweden', code: 'ARN' }], legs: [] }, { origin: 'Paris' });
  check('Paris city search defaults to CDG', parisDefault.origin.airportCode === 'CDG');
  const parisBva = normalizeAirportIntegrity({ origin: { city: 'Paris', country: 'France', code: 'BVA', airportCode: 'BVA' }, stops: [{ city: 'Stockholm', country: 'Sweden', code: 'ARN' }], legs: [] }, { origin: 'Paris BVA' });
  const parisBvaPriced = applyTravellerPricingToTour(parisBva, { origin: 'Paris BVA', currency: 'EUR', adults: 2 });
  check('explicit BVA includes airport access estimate', parisBva.origin.airportCode === 'BVA' && parisBvaPriced.originAccessEstimateUsd > 0);
  const parisStop = normalizeAirportIntegrity({ origin: { city: 'London', country: 'United Kingdom', code: 'LHR' }, stops: [{ city: 'Paris', country: 'France', code: 'BVA', airportCode: 'BVA' }], legs: [] }, { origin: 'London' });
  check('Paris destination does not silently default to BVA', parisStop.stops[0].airportCode === 'CDG');

  const frontendRoot = path.join(__dirname, '..', 'gv_live_667b_frontend');
  const frontend = fs.readFileSync(path.join(frontendRoot, 'scripts', 'multicity-visualizer-651b.js'), 'utf8');
  const html = fs.readFileSync(path.join(frontendRoot, 'multicity-visualizer.html'), 'utf8');
  check('frontend total prefers canonical visible total', frontend.includes('t?.canonicalPricing?.canonicalDisplayTotal'));
  check('frontend no longer presents Agoda sample as production evidence', frontend.includes('Exact-date Agoda evidence') && !frontend.includes('Exact-date Agoda sample'));
  check('frontend card amounts use canonical component records', frontend.includes('canonicalComponent(t,`transport:${index}`)') && frontend.includes('canonicalComponent(t,`stay:${index}`)'));
  check('frontend cache version is 667b', html.includes('multicity-visualizer-651b.js?v=667b'));

  const output = {
    task: 'GV-LIVE-667B',
    version: CANONICAL_INTEGRITY_VERSION,
    passed: checks.length,
    failed: 0,
    checks,
    notes: [
      'Provider calls use deterministic injected responses; injected evidence counts only when the validation-only switch is explicitly enabled.',
      'Production evidence requires productionEligible=true and final prices remain confirmed on partner websites.'
    ]
  };
  console.log(JSON.stringify(output, null, 2));
}

run().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
