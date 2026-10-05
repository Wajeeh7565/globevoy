'use strict';

const fs = require('fs');
const path = require('path');

process.env.AGODA_SITE_ID = process.env.AGODA_SITE_ID || '123456';
process.env.AGODA_API_KEY = process.env.AGODA_API_KEY || 'test-key';
process.env.ENABLE_AGODA_PROVIDER_STAY_679A = 'true';
process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = 'true';
process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';
process.env.ENABLE_PRICE_AUDIT_610D = 'false';
process.env.CAD_TO_USD = process.env.CAD_TO_USD || '0.735';

const agoda = require('./services/providers/stays/agoda/agoda');
const live = require('./services/domain/live-fares/live-provider-verification');

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail: detail ?? null });
  if (!pass) process.exitCode = 1;
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

const richHotel = {
  hotelId: 896,
  hotelName: 'The Shelburne Sonesta New York',
  starRating: 4,
  reviewScore: 8.4,
  reviewCount: 912,
  currency: 'CAD',
  dailyRate: 220,
  crossedOutRate: 265,
  discountPercentage: 17,
  imageURL: 'http://pix1.agoda.net/hotelimages/896/example.jpg?s=312x',
  landingURL: 'https://www.agoda.com/partners/partnersearch.aspx?hid=896&cid=1953464',
  includeBreakfast: false,
  freeWifi: true
};

async function mockAgodaFetch(_url, options = {}) {
  const body = JSON.parse(options.body || '{}');
  if (!body?.criteria?.cityId) return response({ error: 'missing city' }, 400);
  return response({ results: [richHotel] });
}

(async () => {
  check('679A flag active', agoda.providerStayIntegration679AEnabled() === true);
  check('679A version exported', agoda.AGODA_PROVIDER_STAY_VERSION_679A === 'GV-HOTEL-679A', agoda.AGODA_PROVIDER_STAY_VERSION_679A);

  const destination = { city: 'New York', agodaCityId: 318, fallbackNightlyUsd: 180 };
  const stay = await agoda.fetchAgodaStayEstimate({ destination, nights: 3, month: '2026-10-10', currency: 'CAD', adults: 2, children: 0, rooms: 1, _fetchFn: mockAgodaFetch });
  check('Agoda provider response remains provider-backed', stay.source === 'agoda' && stay.providerBacked === true, { source: stay.source, providerBacked: stay.providerBacked });
  check('679A rich hotel object attached', stay.providerHotel?.integrationVersion === 'GV-HOTEL-679A' && stay.providerHotel?.provider === 'Agoda', stay.providerHotel);
  check('679A carries provider hotel ID', stay.providerHotel?.hotelId === 896, stay.providerHotel?.hotelId);
  check('679A carries hotel name', stay.providerHotel?.hotelName === richHotel.hotelName, stay.providerHotel?.hotelName);
  check('679A upgrades Agoda image to HTTPS', stay.providerHotel?.imageUrl === richHotel.imageURL.replace('http://', 'https://'), stay.providerHotel?.imageUrl);
  check('679A carries deep link', stay.providerHotel?.bookingUrl === richHotel.landingURL, stay.providerHotel?.bookingUrl);
  check('679A carries review evidence', stay.providerHotel?.reviewScore === 8.4 && stay.providerHotel?.reviewCount === 912 && stay.providerHotel?.starRating === 4, stay.providerHotel);
  check('679A carries useful amenity evidence', stay.providerHotel?.freeWifi === true && stay.providerHotel?.includeBreakfast === false, stay.providerHotel);
  check('679A keeps existing stay total semantics', Number(stay.averageNightlyUsd) > 0 && Math.abs(Number(stay.totalStayUsd) - Number(stay.averageNightlyUsd) * 3) <= 1, { nightly: stay.averageNightlyUsd, total: stay.totalStayUsd });

  const tour = {
    origin: { city: 'Toronto', code: 'YYZ', airportCode: 'YYZ' },
    cities: [{ city: 'New York', code: 'JFK', airportCode: 'JFK', nights: 3 }],
    stops: [{ city: 'New York', code: 'JFK', airportCode: 'JFK', arrivalDate: '2026-10-10', departureDate: '2026-10-13', nights: 3, hotel: {} }],
    legs: [],
    totalBudgetUsd: 2000,
    estimatedTotalUsd: 500,
    passengerPricing: { adults: 2, children: 0, rooms: 1, travellers: 2 }
  };
  const verified = await live.verifyTourWithLiveProviders(tour, { currency: 'CAD', adults: 2, passengers: 2, rooms: 1, budgetUsd: 2000 }, { _fetchFn: mockAgodaFetch });
  const hotel = verified.tour?.stops?.[0]?.hotel || {};
  check('live verification propagates rich Agoda hotel', hotel.providerHotel?.hotelId === 896 && hotel.imageUrl?.startsWith('https://'), hotel);
  check('live verification exposes rating fields for frontend', hotel.reviewScore === 8.4 && hotel.reviewCount === 912 && hotel.starRating === 4, { reviewScore: hotel.reviewScore, reviewCount: hotel.reviewCount, starRating: hotel.starRating });
  check('live verification preserves exact-stay evidence', hotel.providerVerification?.verified === true && hotel.providerVerification?.integrationVersion === 'GV-HOTEL-679A', hotel.providerVerification);
  check('summary advertises 679A integration', verified.summary?.agodaProviderStay?.enabled === true && verified.summary?.agodaProviderStay?.version === 'GV-HOTEL-679A', verified.summary?.agodaProviderStay);
  check('summary counts enriched stay', Number(verified.summary?.agodaProviderStay?.enrichedStayCount) === 1, verified.summary?.agodaProviderStay);

  process.env.ENABLE_AGODA_PROVIDER_STAY_679A = 'false';
  const legacy = await agoda.fetchAgodaStayEstimate({ destination, nights: 3, month: '2026-10-10', currency: 'CAD', adults: 1, rooms: 1, _fetchFn: mockAgodaFetch });
  check('flag-off preserves legacy response shape', !legacy.providerHotel && !legacy.hotelImageUrl, { providerHotel: legacy.providerHotel, hotelImageUrl: legacy.hotelImageUrl });

  const result = {
    release: 'GV-HOTEL-679A',
    generatedAt: new Date().toISOString(),
    checkCount: checks.length,
    passedCount: checks.filter(x => x.pass).length,
    failedCount: checks.filter(x => !x.pass).length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_HOTEL_679A_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-HOTEL-679A backend validation failed.');
  console.log(`GV-HOTEL-679A backend validation passed (${result.passedCount}/${result.checkCount}).`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
