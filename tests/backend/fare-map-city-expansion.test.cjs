'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const expansion = require('../../backend/services/domain/fare-map/city-expansion');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const ingest = require('../../backend/services/domain/fare-map/fare-map-ingest');
const collector = require('../../backend/services/domain/fare-map/fare-map-full-pass')._internal;
const rolling = require('../../backend/services/domain/fare-map/fare-map-job')._internal;
const { collectionMonthCount } = require('../../backend/services/domain/fare-map/search-window');
const registry = require('../../backend/data/unified-city-registry-1000.json');
const { rows, code, eligible, plus } = optimizer._internal;
const now = Date.parse('2027-03-01T00:00:00Z');
const query = { origin: 'YYZ', budget: 2500, currency: 'USD', departureDate: '2027-03-10',
  returnDate: '2027-03-16', destinationCount: 1, nights: 6, travellers: 1 };
const env = { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_CITY_EXPANSION: 'on' };
const fare = (origin, destination, departureDate, priceUsd = 240) => ({
  origin, destination, departureDate, month: departureDate.slice(0, 7), priceUsd,
  observedAt: new Date(now).toISOString(), source: 'travelpayouts-cached'
});

test('reviews the exact 503-city gap, preserves legacy rows and corrects evidenced geography', () => {
  const review = expansion.reviewExpansion();
  assert.equal(review.size, 503);
  const admitted = rows().map(row => expansion.admit(row, review)).filter(Boolean);
  assert.equal(admitted.length, 368);
  assert.equal(new Set(admitted.map(code)).size, admitted.length);
  assert.equal([...review.values()].filter(row => row.reasons.includes('hotel-market-unresolved')).length, 128);
  assert.equal([...review.values()].filter(row => row.reasons.includes('hotel-market-outside-destination')).length, 7);
  const praia = admitted.find(row => row.unifiedRegistry.cityId === 'praia-cv');
  assert.equal(praia.unifiedRegistry.worldRegion, 'Africa');
  assert.equal(optimizer._internal.regionFamily(praia), 'africa');
  assert.equal(praia.unifiedRegistry.providers.agoda.cityId, null, 'historical hotel mapping is not a live hotel ID');
  assert.equal(rows().find(row => row.unifiedRegistry.cityId === 'praia-cv').unifiedRegistry.worldRegion, 'Other');
  assert.equal(expansion.admit({ ...praia, countryCode: 'GB' }, review), null);
  assert.equal(expansion.admit({ ...praia, primaryAirportCode: 'LHR' }, review), null);
});

test('Nuitee catalogue evidence admits a blocked market only with an exact, local production property', () => {
  const { catalogueMarkets } = require('../../backend/services/providers/stays/nuitee/nuitee-market');
  const city = registry.records.find(row => row.cityId === 'palma-de-mallorca-es');
  const original = expansion.reviewExpansion().get(city.cityId);
  assert.deepEqual(original.reasons, ['hotel-market-unresolved']);
  const property = { id: 'lp-test-only', city: city.displayName, country: 'ES',
    latitude: city.latitude, longitude: city.longitude };
  const evidence = hotels => ({ schema: 1, source: 'nuitee-production-data-hotels',
    records: [{ cityId: city.cityId, observedAt: new Date(now).toISOString(), hotels }] });
  const recovered = expansion.reviewExpansion(evidence([property]));
  assert.deepEqual(recovered.get(city.cityId).reasons, []);
  const row = rows().find(row => row.unifiedRegistry.cityId === city.cityId);
  assert.equal(expansion.admit(row, recovered).nuiteeMarket.cityName, city.displayName);
  assert.equal([...recovered.values()].filter(row => !row.reasons.length).length, 369);
  for (const bad of [
    { ...property, city: 'Calvia' }, { ...property, country: 'PT' },
    { ...property, latitude: 0 }, { ...property, longitude: null }, { ...property, id: '../id' }
  ]) assert.equal(catalogueMarkets(evidence([bad]), registry.records).size, 0);
  const sandbox = evidence([property]);
  sandbox.records[0].sandbox = true;
  assert.equal(catalogueMarkets(sandbox, registry.records).size, 0);
  assert.equal(expansion.reviewExpansion().get(city.cityId), original);
});

test('collectors already schedule every reviewed route code in every collection month', () => {
  const origins = ingest.originCodesFromRegistry(registry);
  const months = ingest.upcomingMonths(collectionMonthCount(now), now);
  for (const buildTasks of [collector.buildTasks, rolling.buildTasks]) {
    const tasks = buildTasks(origins, months);
    assert.equal(tasks.length, origins.length * months.length);
    const keys = new Set(tasks.map(task => task.origin + '#' + task.month));
    for (const row of expansion.reviewExpansion().values()) {
      for (const month of months) assert.ok(keys.has(row.code + '#' + month), row.cityId + '#' + month);
    }
  }
});

test('collector pagination retains the full registry-sized destination response', async () => {
  const destinations = ingest.originCodesFromRegistry(registry).filter(code => code !== 'YTO');
  let offset = 0;
  const result = await ingest.ingestOriginMonth({
    origin: 'YTO', month: '2027-03', token: 'offline', toUsd: Number, clock: () => now, pace: async () => {},
    fetch: async (_url, { body }) => {
      assert.match(JSON.parse(body).query, new RegExp('offset: ' + offset + ' '));
      const response = destinations.slice(offset, offset + 30).map(destination => ({
        destination_city_iata: destination, departure_at: '2027-03-10', value: 100
      }));
      offset += 30;
      return { status: 200, ok: true, text: async () => JSON.stringify({ data: { prices_one_way: response } }) };
    }
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.requests, 33);
  assert.deepEqual(new Set(result.records.map(row => row.destination)), new Set(destinations));
});

test('flag admits cached eligible routes, still blocks unmatched hotel markets and respects region and budget', async () => {
  const byPartition = new Map([
    ['YTO#2027-03', [fare('YTO', 'RAI', query.departureDate), fare('YTO', 'UKA', query.departureDate, 50)]],
    ['RAI#2027-03', [fare('RAI', 'YTO', query.returnDate)]],
    ['UKA#2027-03', [fare('UKA', 'YTO', query.returnDate, 50)]]
  ]);
  const options = { now, allowCityExpansion: true, readRoutes: async (o, m) => byPartition.get(o + '#' + m) || [] };
  const off = await optimizer.search(query, { ...options, env: { ENABLE_FARE_MAP_OPTIMIZER: 'true' } });
  assert.equal(off.tours.length, 0);
  assert.deepEqual((await optimizer.search(query, { ...options, allowCityExpansion: false, env })).tours, off.tours);
  const on = await optimizer.search({ ...query, region: 'Africa' }, { ...options, env });
  assert.equal(on.diagnostics.expansionEligibleCities, 368);
  assert.equal(on.tours.length, 1, on.reason);
  assert.equal(on.tours[0].stops[0].cityId, 'praia-cv');
  assert.equal(on.tours[0].fareMap.expansionCandidate, true);
  assert.equal(on.tours[0].stops[0].airportCode, 'RAI');
  assert.equal(on.tours[0].legs.at(-1).departureDate, query.returnDate);
  assert.ok(on.tours[0].legs.every(leg => leg.providerDateEvidence.sourceType === 'CACHED'));
  assert.equal((await optimizer.search({ ...query, budget: 100 }, { ...options, env })).tours.length, 0);
  assert.equal((await optimizer.search({ ...query, region: 'Europe' }, { ...options, env })).tours.length, 0);
});

test('expansion verification fails closed and only publishes a trip after live flights and hotel pricing', async t => {
  const generated = require('../../backend/services/domain/tours/generated-tour');
  const prior = process.env.ENABLE_GENERATED_TOUR_651A;
  process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  t.after(() => {
    if (prior === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A;
    else process.env.ENABLE_GENERATED_TOUR_651A = prior;
  });
  const config = { ...env, ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline',
    ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline-reference',
    FARE_MAP_REQUIRE_LIVE: 'false', FARE_MAP_SHOW_ESTIMATES: 'true' };
  const options = {
    env: config, fareMap: { env: config, now, readRoutes: async (origin, month) =>
      month !== '2027-03' ? [] : origin === 'YTO' ? [fare('YTO', 'RAI', query.departureDate)] :
        origin === 'RAI' ? [fare('RAI', 'YTO', query.returnDate)] : [] },
    applyIgnavLiveFares: async tour => ({
      tour: { ...tour, legs: tour.legs.map(leg => ({
        ...leg, liveFareVerified: true, providerDateEvidence: {
          ...leg.providerDateEvidence, provider: 'ignav', source: 'ignav-live-one-way',
          sourceType: 'LIVE', productionEligible: true,
          segments: [{ arriveLocal: plus(leg.departureDate, 1) + 'T09:00:00' }]
        }
      })) },
      summary: { applied: true, providerRequests: 2 }
    })
  };
  let hotels = 0;
  const missing = await generated.getGeneratedTour(query, { ...options, applyNuiteeLiveStays: async tour => {
    hotels++;
    return { tour, summary: { applied: false, reason: 'offline-unavailable' } };
  } });
  assert.ok(hotels > 0, JSON.stringify(missing.diagnostics));
  assert.equal(missing.tour, null);
  assert.deepEqual(missing.tours, []);
  assert.deepEqual(Object.values(missing.roleCandidates || {}).flat(), []);
  const requests = [];
  const rateResponse = amount => ({
    status: 200,
    text: async () => JSON.stringify({
      hotels: [{ id: 'lp-expansion', name: 'Test stay', city_name: 'Praia', country_code: 'CV',
        latitude: 14.92, longitude: -23.5, rating: 8.5 }],
      data: [{ hotelId: 'lp-expansion', roomTypes: [{ offerId: 'test-offer', offerRetailRate: { amount, currency: 'USD' },
        rates: [{ adultCount: 1, childCount: 0, retailRate: { total: [{ amount, currency: 'USD' }],
          taxesAndFees: [{ included: false, amount: 10, currency: 'USD' }] } }] }] }]
    })
  });
  const fetchFor = amount => async (url, request) => {
    assert.match(url, /\/hotels\/rates$/);
    const body = JSON.parse(request.body);
    requests.push(body);
    assert.equal(body.countryCode, 'CV');
    assert.equal(body.checkin, '2027-03-11');
    assert.equal(body.checkout, query.returnDate);
    assert.deepEqual(body.occupancies, [{ adults: 1, children: [] }]);
    return rateResponse(amount);
  };
  const liveOptions = { ...options, apiKey: 'prod_test_not_real', fetch: fetchFor(180) };
  const poolQuery = { ...query, pool: 1, poolShow: 1 };
  const result = await generated.getGeneratedTour(poolQuery, liveOptions);
  assert.equal(requests.length, 1);
  assert.equal(result.tour?.stops[0].hotel.nuiteeLiveRate.marketVerified, true, JSON.stringify(result.diagnostics));
  assert.equal(result.tour.stops[0].hotel.nuiteeLiveRate.payAtHotelAmount, 10);
  const rejected = await generated.getGeneratedTour(poolQuery, { ...liveOptions, fetch: fetchFor(2200) });
  assert.equal(rejected.tour, null);
  assert.equal(requests.length, 2, 'over-budget retry shares the same rate response');
  const mismatch = await generated.getGeneratedTour(poolQuery, { ...liveOptions,
    fetch: () => assert.fail('Mismatched flights must not start stay pricing'),
    applyIgnavLiveFares: async tour => {
      const priced = await options.applyIgnavLiveFares(tour);
      priced.tour.legs[0].to = { ...priced.tour.legs[0].to, airportCode: 'LHR' };
      return priced;
    }
  });
  assert.equal(mismatch.tour, null);
  assert.equal(mismatch.reason, 'fare-map-incomplete-or-mismatched-live-evidence');
  assert.equal(result.tour?.stops[0].cityId, 'praia-cv', result.reason);
  assert.equal(result.tour.tourRole, 'best-balance');
  assert.equal(result.diagnostics.ignavCalls, 2);
  assert.ok(result.tour.estimatedTotalUsd <= result.tour.usableTripBudgetUsd);
});

test('dense full-registry partitions retain the deployed read, edge and concurrency ceilings', async () => {
  const destinations = [...new Set(rows().map(code))].filter(value => value !== 'YTO');
  const outbound = destinations.map((value, i) => fare('YTO', value, query.departureDate, 150 + i % 150));
  for (const flag of ['off', 'on']) {
    let active = 0, peak = 0;
    const seen = new Set();
    const result = await optimizer.search(query, {
      env: { ...env, FARE_MAP_CITY_EXPANSION: flag }, now, allowCityExpansion: true, maxReads: 10, maxEdges: 1020,
      readRoutes: async (origin, month) => {
        const key = origin + '#' + month;
        assert.ok(!seen.has(key), 'partition read must be coalesced');
        seen.add(key);
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return origin === 'YTO' ? outbound : [fare(origin, 'YTO', query.returnDate)];
      }
    });
    assert.ok(result.tours.length);
    assert.ok(result.diagnostics.reads <= 10);
    assert.ok(result.diagnostics.examinedEdges <= 1020);
    assert.ok(peak <= 4);
    assert.equal(result.diagnostics.bounded, true);
    assert.equal(result.diagnostics.liveProviderCallsMade, 0);
    assert.equal(result.diagnostics.eligibleCities, new Set(rows().filter(eligible).map(code)).size +
      (flag === 'on' ? 368 : 0) - 1);
  }
});
