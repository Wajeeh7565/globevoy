'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.ENABLE_GENERATED_TOUR_651A = 'true';
process.env.ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B = 'true';
process.env.ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B = 'true';
process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A = 'true';
process.env.ENABLE_ROUTE_FEASIBILITY_GUARD_664A = 'true';
process.env.ENABLE_PASSENGER_ROOM_PRICING_666A = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B = 'true';
process.env.ENABLE_CANONICAL_ITINERARY_DATE_SYNC_666B = 'true';
delete process.env.TRAVELPAYOUTS_TOKEN;

const generated = require('./generated-tour');
const dateModule = require('./generated-tour-dates');
const lambda = require('./lambda');

const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}

(async () => {
  await check('rejected provider date cannot overwrite official automatic route date', () => {
    const leg = {
      departureDate: '2026-10-31',
      automaticTourDate: { departureDate: '2026-07-16', providerBacked: false },
      providerDateEvidence: { departureDate: '2026-10-31', providerBacked: true, appliedToEstimate: false }
    };
    assert.equal(generated._internal.officialDepartureDateForLeg(leg), '2026-07-16');
  });

  await check('applied provider date remains the official route date', () => {
    const leg = {
      departureDate: '2026-07-16',
      automaticTourDate: { departureDate: '2026-07-16' },
      providerDateEvidence: { departureDate: '2026-10-31', providerBacked: true, appliedToEstimate: true },
      liveFareVerified: true
    };
    assert.equal(generated._internal.officialDepartureDateForLeg(leg), '2026-10-31');
  });

  await check('presentation layer uses official date instead of stale evidence date', () => {
    const legs = generated._internal.enrichLegsForPresentation([{
      mode: 'flight',
      departureDate: '2026-10-31',
      automaticTourDate: { departureDate: '2026-07-16' },
      cheapestOneWay: { departureDate: '2026-10-31', providerBacked: true, appliedToEstimate: false }
    }], { month: '2026-07' });
    assert.equal(legs[0].departureDate, '2026-07-16');
    assert.equal(legs[0].dateLabel, '2026-07-16');
  });

  let initial;
  await check('baseline generated tour is available for integration validation', async () => {
    initial = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '2', passengers: '2', totalNights: '5', maxStops: '2' });
    assert.equal(initial.supported, true);
    assert(initial.tour);
    assert.equal(initial.tour.itineraryDatePlan.consistent, true);
  });

  let recalculated;
  await check('date recalculation preserves the exact route cities', async () => {
    const before = initial.tour.cities.map(city => city.city);
    recalculated = await dateModule.recalculateGeneratedTourDate({
      tour: initial.tour,
      departureDate: '2026-10-31',
      query: { origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '2', passengers: '2', totalNights: '5' }
    });
    assert.equal(recalculated.supported, true);
    assert.deepEqual(recalculated.tour.cities.map(city => city.city), before);
    assert.equal(recalculated.routeControl.routeCitiesPreserved, true);
  });

  await check('selected date becomes the canonical first-leg date', () => {
    assert.equal(recalculated.tour.backendLegs[0].departureDate, '2026-10-31');
    assert.equal(recalculated.tour.itineraryDatePlan.canonicalDepartureDate, '2026-10-31');
  });

  await check('all later legs and stay windows are derived chronologically', () => {
    const legs = recalculated.tour.backendLegs;
    const stays = recalculated.tour.stays;
    assert.equal(legs[1].departureDate, '2026-11-03');
    assert.equal(legs[2].departureDate, '2026-11-05');
    assert.equal(stays[0].dateLabel, '2026-10-31 to 2026-11-03');
    assert.equal(stays[1].dateLabel, '2026-11-03 to 2026-11-05');
    assert.equal(recalculated.tour.itineraryDatePlan.consistent, true);
    assert.deepEqual(recalculated.tour.itineraryDatePlan.issues, []);
  });

  await check('partner flight searches use the recalculated official dates', () => {
    const routes = recalculated.tour.backendLegs.map(leg => leg.booking && leg.booking.route);
    assert.equal(routes[0].departureDate, '2026-10-31');
    assert.equal(routes[1].departureDate, '2026-11-03');
    assert.equal(routes[2].departureDate, '2026-11-05');
  });

  await check('six-month calendar keeps original scan-window month position', () => {
    assert.equal(recalculated.tour.itineraryDatePlan.scanStartMonth, '2026-07');
    assert.equal(recalculated.tour.itineraryDatePlan.scanMonths, 6);
  });

  await check('POST Lambda endpoint returns synchronized route', async () => {
    const event = {
      rawPath: '/api/generated-tour-date',
      requestContext: { http: { method: 'POST' } },
      body: JSON.stringify({
        tour: initial.tour,
        departureDate: '2026-10-31',
        query: { origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '2', passengers: '2', totalNights: '5' }
      })
    };
    const response = await lambda.handler(event);
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.supported, true);
    assert.equal(body.tour.backendLegs[0].departureDate, '2026-10-31');
  });

  await check('frontend calls backend date recalculation instead of mutating one leg locally', () => {
    const frontend = fs.readFileSync(path.join(__dirname, '..', 'gv_live_667b_frontend', 'scripts', 'multicity-visualizer-651b.js'), 'utf8');
    const apiClient = fs.readFileSync(path.join(__dirname, '..', 'gv_live_667b_frontend', 'runtime', 'api-client.js'), 'utf8');
    assert(frontend.includes('recalculateGeneratedTourDate({tour:t,departureDate:valid,query})'));
    assert(frontend.includes('officialLegDate(leg)'));
    assert(apiClient.includes("'/api/generated-tour-date'"));
    assert(apiClient.includes("method: 'POST'"));
  });

  await check('frontend calendar cache version preserves canonical date sync in 667b', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'gv_live_667b_frontend', 'multicity-visualizer.html'), 'utf8');
    assert(html.includes('multicity-visualizer-651b.js?v=667b'));
  });

  const output = {
    task: 'GV-DATE-666B',
    version: dateModule.GENERATED_TOUR_DATE_VERSION,
    passed: checks.filter(item => item.passed).length,
    failed: checks.filter(item => !item.passed).length,
    checks
  };
  console.log(JSON.stringify(output, null, 2));
  if (output.failed) process.exit(1);
})().catch(error => { console.error(error); process.exit(1); });
