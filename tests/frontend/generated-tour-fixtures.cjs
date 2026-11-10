const assert = require('node:assert/strict');
const plain = value => JSON.parse(JSON.stringify(value));

// Use the maintained route planner and visualizer builder, with no providers or AWS.
// The extra enrichment has the shapes that made the production Save exceed 64 KiB.
async function generatedTours() {
  // Any accidental provider call must fail offline instead of reaching a service.
  const priorFetch = global.fetch;
  global.fetch = async () => { throw new Error('Unexpected network request in generated-tour fixtures'); };
  const priorFlag = process.env.ENABLE_MULTICITY_ROUTE_610B;
  try {
    process.env.ENABLE_MULTICITY_ROUTE_610B = 'true';
    const { getMultiCityTours } = require('../../backend/services/domain/routing/multicity-routes');
    const { buildVisualizerTour } = require('../../backend/services/domain/tours/generated-tour');
    const tours = [];
    for (const query of [
      { origin: 'YYZ', currency: 'CAD', budget: '2500', month: '2027-03', passengers: '1', nights: '7' },
      { origin: 'LHR', currency: 'GBP', budget: '5000', month: '2027-04', passengers: '3', nights: '10' }
    ]) {
      const result = await getMultiCityTours(query);
      assert.ok(result.tours.length, 'Local route planner must produce representative tours');
      const tour = buildVisualizerTour(result.tours[0], query);
      tour.entryEligibility = { profile: { passportCountryCode: 'CA' } };
      tour.cheapFlightScanner.monthlyObservations = Array.from({ length: 6 }, () => plain(tour.backendLegs));
      // Provider results include repeated legs and hotel details; retain this large input.
      tour.cheapFlightScanner.candidateEvidence = Array.from({ length: 5 }, () => plain(tour.stops));
      assert.ok(Buffer.byteLength(JSON.stringify(tour)) > 64 * 1024);
      tours.push(tour);
    }
    return tours;
  } finally {
    global.fetch = priorFetch;
    if (priorFlag === undefined) delete process.env.ENABLE_MULTICITY_ROUTE_610B;
    else process.env.ENABLE_MULTICITY_ROUTE_610B = priorFlag;
  }
}

module.exports = { generatedTours };
