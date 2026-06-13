const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.TRAVELPAYOUTS_AVIASALES_CAMPAIGN_ID = 'YOUR_CAMPAIGN_ID';
process.env.TRAVELPAYOUTS_AVIASALES_MARKER = 'YOUR_MARKER';
process.env.TRAVELPAYOUTS_AVIASALES_PARTNER_ID = 'YOUR_PARTNER_ID';
process.env.TRAVELPAYOUTS_AVIASALES_TRS = 'YOUR_TRS';

const {
  getRecommendations,
  calculateFullTripCost,
  budgetFitLabel,
  budgetFitScore,
  buildFlightBudgetMetadata,
  buildHotelScoringMetadata,
  formatBestDepartureDate
} = require('./recommendations');
const { DESTINATIONS, getDestination, fallbackFlightCandidates } = require('./data/destination-meta');
const { fetchAgodaStayEstimate } = require('./services/agoda');
const { handler: lambdaHandler } = require('./lambda');

const SIXTY_FIVE_TO_115_SUBSET = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'test-fixtures', 'city-expansion-65-to-115-approved-subset.review.json'),
    'utf8'
  )
).records;

function expectedDefaultMonth() {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  return target.toISOString().slice(0, 7);
}

function assertSortedByBudgetFit(recommendations) {
  for (let index = 1; index < recommendations.length; index += 1) {
    assert.ok(
      recommendations[index - 1].score >= recommendations[index].score,
      'recommendations should be sorted by Budget Fit descending'
    );
  }
}

function assertTrackedAviasalesLink(link) {
  const url = new URL(link);
  assert.strictEqual(url.protocol, 'https:');
  assert.strictEqual(url.hostname, 'tp.media');
  assert.strictEqual(url.pathname, '/r');
  assert.strictEqual(url.searchParams.get('campaign_id'), 'YOUR_CAMPAIGN_ID');
  assert.strictEqual(url.searchParams.get('marker'), 'YOUR_MARKER');
  assert.strictEqual(url.searchParams.get('p'), 'YOUR_PARTNER_ID');
  assert.strictEqual(url.searchParams.get('trs'), 'YOUR_TRS');

  const target = url.searchParams.get('u');
  assert.ok(target && target.startsWith('https://www.aviasales.com/search/'), 'wrapped Aviasales target should preserve the deep search URL');
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function testBasicMockRecommendations() {
  process.env.GLOBEVOY_USE_MOCKS = 'true';

  const result = await getRecommendations({
    origin: 'YTO',
    budgetUsd: '1500',
    month: '2026-07',
    nights: '5'
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.mode, 'mock');
  assert.ok(Array.isArray(result.recommendations));
  assert.ok(result.recommendations.length > 0);

  const first = result.recommendations[0];
  for (const field of ['city', 'country', 'flight', 'lodging', 'dailySpend', 'activitiesLocal', 'dailyBudget', 'total', 'budgetBuffer', 'score', 'budgetFitLabel', 'budgetFitStatus', 'whyItFits']) {
    assert.ok(first[field] !== undefined, `missing ${field}`);
  }
  for (const field of ['bestDepartureDate', 'dateStrategy', 'flexibleDateSource', 'flightBudgetShare', 'flightBudgetStatus']) {
    assert.ok(first[field] !== undefined, `missing ${field}`);
  }
  for (const field of ['hotelScore', 'hotelBudgetShare', 'hotelBudgetStatus', 'hotelSourceConfidence', 'hotelQualitySignals', 'hotelFitReason', 'hotelWarnings', 'stayStrategy']) {
    assert.ok(first[field] !== undefined, `missing ${field}`);
  }

  assert.ok(first.total > 0);
  assert.strictEqual(first.bestDepartureDate, null);
  assert.strictEqual(first.dateStrategy, 'fallback-route-model');
  assert.strictEqual(first.flexibleDateSource, 'fallback-route-model');
  assert.ok(typeof first.flightBudgetShare === 'number' || first.flightBudgetShare === null);
  assert.ok(['within-target', 'near-target', 'expensive-flight', 'unknown'].includes(first.flightBudgetStatus));
  assert.ok(typeof first.hotelScore === 'number' || first.hotelScore === null);
  assert.ok(first.hotelScore === null || first.hotelScore <= 65, 'fallback hotel score should stay capped');
  assert.ok(typeof first.hotelBudgetShare === 'number' || first.hotelBudgetShare === null);
  assert.ok(['comfortable', 'reasonable', 'tight', 'expensive-stay', 'unknown'].includes(first.hotelBudgetStatus));
  assert.strictEqual(first.hotelSourceConfidence, 'fallback-estimate');
  assert.strictEqual(first.stayStrategy, 'fallback-nightly-destination-average');
  assert.ok(first.hotelQualitySignals && typeof first.hotelQualitySignals === 'object');
  assert.ok(Array.isArray(first.hotelWarnings));
  assert.ok(first.hotelWarnings.includes('fallback-stay-estimate'));
  assert.ok(first.hotelWarnings.includes('availability-not-guaranteed'));
  assert.ok(first.whyItFits.includes('$'));
  assert.ok(first.dailyBudget.perDay.food > 0, 'daily budget should include food estimate');
  assert.ok(first.dailyBudget.perDay.localTransport > 0, 'daily budget should include local transport estimate');
  assert.ok(first.dailyBudget.trip.basicActivities >= 0, 'daily budget should include trip activity estimate');
  assert.strictEqual(
    first.dailyBudget.trip.total,
    first.dailySpend + first.activitiesLocal,
    'daily budget total should match recommendation daily + local activity totals'
  );

  // v11.3+: response envelope adds version + servedAt
  assert.ok(typeof result.version === 'string' && result.version.length > 0, 'response should include version');
  assert.ok(typeof result.servedAt === 'string' && result.servedAt.length > 0, 'response should include servedAt ISO timestamp');
  assert.ok(!Number.isNaN(Date.parse(result.servedAt)), 'servedAt should be a parseable date');

  // v11.3: each recommendation has a bookingLinks shape (flight always present
  // in mock mode; hotel only when an Agoda link is available — fine to be null).
  assert.ok(first.bookingLinks && typeof first.bookingLinks === 'object', 'recommendation should include bookingLinks');
  if (first.bookingLinks.flight) {
    assert.ok(typeof first.bookingLinks.flight.url === 'string' && first.bookingLinks.flight.url.length > 0);
    assert.ok(typeof first.bookingLinks.flight.partner === 'string' && first.bookingLinks.flight.partner.length > 0);
    assert.strictEqual(first.bookingLinks.flight.kind, 'flight');
    assertTrackedAviasalesLink(first.bookingLinks.flight.url);
  }
  if (first.bookingLinks.hotel) {
    assert.ok(typeof first.bookingLinks.hotel.url === 'string' && first.bookingLinks.hotel.url.length > 0);
    assert.ok(typeof first.bookingLinks.hotel.partner === 'string' && first.bookingLinks.hotel.partner.length > 0);
    assert.strictEqual(first.bookingLinks.hotel.kind, 'hotel');
  }

  console.log(`OK: ${result.recommendations.length} mock recommendations generated.`);
  console.log(`${first.city}: $${first.total} total, Budget Fit ${first.score}`);
}

function testBudgetFitThresholds() {
  assert.strictEqual(budgetFitLabel(900, 1000), 'Good fit');
  assert.strictEqual(budgetFitLabel(901, 1000), 'Tight');
  assert.strictEqual(budgetFitLabel(1000, 1000), 'Tight');
  assert.strictEqual(budgetFitLabel(1001, 1000), 'Over budget');
  assert.ok(budgetFitScore(900, 1000) >= budgetFitScore(1000, 1000));
  assert.ok(budgetFitScore(1000, 1000) >= budgetFitScore(1100, 1000));
}

function testFlexibleDateFormatting() {
  assert.strictEqual(formatBestDepartureDate('2026-09-13T10:00:00+00:00'), '2026-09-13');
  assert.strictEqual(formatBestDepartureDate('2026-09-13'), '2026-09-13');
  assert.strictEqual(formatBestDepartureDate('2026-99-99'), null);
  assert.strictEqual(formatBestDepartureDate(''), null);
  assert.strictEqual(formatBestDepartureDate(null), null);
}

function testFlightBudgetMetadata() {
  const within = buildFlightBudgetMetadata(350, 1000);
  assert.strictEqual(within.flightBudgetShare, 0.35);
  assert.strictEqual(within.flightBudgetStatus, 'within-target');

  const near = buildFlightBudgetMetadata(450, 1000);
  assert.strictEqual(near.flightBudgetShare, 0.45);
  assert.strictEqual(near.flightBudgetStatus, 'near-target');

  const expensive = buildFlightBudgetMetadata(550, 1000);
  assert.strictEqual(expensive.flightBudgetShare, 0.55);
  assert.strictEqual(expensive.flightBudgetStatus, 'expensive-flight');

  const unknown = buildFlightBudgetMetadata(0, 1000);
  assert.strictEqual(unknown.flightBudgetShare, null);
  assert.strictEqual(unknown.flightBudgetStatus, 'unknown');
}

function testHotelScoringMetadata() {
  const destination = getDestination('CUN');
  const liveStay = {
    source: 'agoda',
    totalStayUsd: 300,
    hotelName: 'Sample Cancun Hotel',
    hotelUrl: 'https://example.com/hotel',
    sampleSize: 5,
    qualitySignals: {
      rating: 8.6,
      stars: 4,
      reviewCount: 230,
      sampleSize: 5,
      hotelName: 'Sample Cancun Hotel'
    }
  };

  const comfortable = buildHotelScoringMetadata({ stay: liveStay, destination, budgetUsd: 1000, nights: 5, style: 'coast' });
  assert.strictEqual(comfortable.hotelBudgetShare, 0.3);
  assert.strictEqual(comfortable.hotelBudgetStatus, 'comfortable');
  assert.strictEqual(comfortable.hotelSourceConfidence, 'live-agoda');
  assert.strictEqual(comfortable.stayStrategy, 'agoda-quality-filtered-price-average');
  assert.strictEqual(comfortable.hotelQualitySignals.rating, 8.6);
  assert.strictEqual(comfortable.hotelQualitySignals.stars, 4);
  assert.strictEqual(comfortable.hotelQualitySignals.reviewCount, 230);
  assert.ok(!comfortable.hotelWarnings.includes('no-agoda-link'));
  assert.ok(comfortable.hotelWarnings.includes('resort-claim-unverified'));

  assert.strictEqual(
    buildHotelScoringMetadata({ stay: { ...liveStay, totalStayUsd: 400 }, destination, budgetUsd: 1000, nights: 5 }).hotelBudgetStatus,
    'reasonable'
  );
  assert.strictEqual(
    buildHotelScoringMetadata({ stay: { ...liveStay, totalStayUsd: 550 }, destination, budgetUsd: 1000, nights: 5 }).hotelBudgetStatus,
    'tight'
  );
  assert.strictEqual(
    buildHotelScoringMetadata({ stay: { ...liveStay, totalStayUsd: 650 }, destination, budgetUsd: 1000, nights: 5 }).hotelBudgetStatus,
    'expensive-stay'
  );
  assert.strictEqual(
    buildHotelScoringMetadata({ stay: { source: 'unknown', totalStayUsd: 0 }, destination, budgetUsd: 0, nights: 5 }).hotelBudgetStatus,
    'unknown'
  );

  const fallback = buildHotelScoringMetadata({
    stay: {
      source: 'fallback',
      totalStayUsd: 300,
      hotelName: null,
      hotelUrl: null,
      sampleSize: 0,
      qualitySignals: { rating: null, stars: null, reviewCount: null, sampleSize: 0, hotelName: null }
    },
    destination,
    budgetUsd: 1000,
    nights: 5
  });
  assert.ok(fallback.hotelScore <= 65, 'fallback score should be capped');
  assert.strictEqual(fallback.hotelSourceConfidence, 'fallback-estimate');
  assert.ok(fallback.hotelWarnings.includes('fallback-stay-estimate'));
  assert.ok(fallback.hotelWarnings.includes('no-agoda-link'));
  assert.ok(fallback.hotelWarnings.includes('rating-unavailable'));
  assert.ok(fallback.hotelWarnings.includes('review-count-unavailable'));
  assert.ok(fallback.hotelWarnings.includes('star-rating-unavailable'));
}

function testProviderMetadataMergeForSafeOverlapRecords() {
  const expected = {
    MEX: {
      globevoyCityId: 'mexico-city-mx',
      cityCode: 'MEX',
      agodaCityId: 2086,
      agodaHotelCount: 987
    },
    LIS: {
      globevoyCityId: 'lisbon-pt',
      cityCode: 'LIS',
      agodaCityId: 16364,
      agodaHotelCount: 1140
    },
    OPO: {
      globevoyCityId: 'porto-pt',
      cityCode: 'OPO',
      agodaCityId: 8738,
      agodaHotelCount: 1201
    }
  };

  for (const [code, values] of Object.entries(expected)) {
    const destination = getDestination(code);
    assert.ok(destination, `${code} should exist in the live backend dataset`);
    assert.strictEqual(destination.globevoyCityId, values.globevoyCityId);
    assert.strictEqual(destination.travelpayoutsCityCode, values.cityCode);
    assert.deepStrictEqual(destination.travelpayoutsAirportCodes, [values.cityCode]);
    assert.strictEqual(destination.primaryAirportCode, values.cityCode);
    assert.strictEqual(destination.agodaCityId, values.agodaCityId);
    assert.strictEqual(destination.agodaHotelCount, values.agodaHotelCount);
    assert.strictEqual(destination.agodaCoverageStatus, 'strong');
    assert.strictEqual(destination.providerCoverage.travelpayouts.status, 'strong');
    assert.strictEqual(destination.providerCoverage.agoda.status, 'strong');
    assert.strictEqual(destination.registryValidationStatus, 'draft-needs-provider-review');
    assert.ok(Array.isArray(destination.aliases));
    assert.ok(Array.isArray(destination.normalizedSearchNames));
  }

  assert.strictEqual(getDestination('PRG').globevoyCityId, undefined, 'Prague should stay deferred in this patch');
  assert.strictEqual(getDestination('KEF').globevoyCityId, undefined, 'Reykjavik should stay deferred in this patch');
}

function testFortyDestinationExpansionMetadata() {
  const expected = {
    CTG: {
      city: 'Cartagena',
      country: 'Colombia',
      globevoyCityId: 'cartagena-co',
      agodaCityId: 10838,
      agodaHotelCount: 511,
      fallbackFlightUsd: 400,
      fallbackNightlyUsd: 70
    },
    MDE: {
      city: 'Medellin',
      country: 'Colombia',
      globevoyCityId: 'medellin-co',
      agodaCityId: 10309,
      agodaHotelCount: 566,
      fallbackFlightUsd: 410,
      fallbackNightlyUsd: 58
    },
    MAD: {
      city: 'Madrid',
      country: 'Spain',
      globevoyCityId: 'madrid-es',
      agodaCityId: 5531,
      agodaHotelCount: 1371,
      fallbackFlightUsd: 500,
      fallbackNightlyUsd: 98
    },
    SVQ: {
      city: 'Seville',
      country: 'Spain',
      globevoyCityId: 'seville-es',
      agodaCityId: 16577,
      agodaHotelCount: 655,
      fallbackFlightUsd: 510,
      fallbackNightlyUsd: 82
    },
    KRK: {
      city: 'Krakow',
      country: 'Poland',
      globevoyCityId: 'krakow-pl',
      agodaCityId: 15790,
      agodaHotelCount: 774,
      fallbackFlightUsd: 560,
      fallbackNightlyUsd: 68,
      agodaCoverageStatus: 'strong'
    },
    RAK: {
      city: 'Marrakech',
      country: 'Morocco',
      globevoyCityId: 'marrakech-ma',
      agodaCityId: 11825,
      agodaHotelCount: 1546,
      fallbackFlightUsd: 540,
      fallbackNightlyUsd: 70,
      agodaCoverageStatus: 'strong'
    },
    BUD: {
      city: 'Budapest',
      country: 'Hungary',
      globevoyCityId: 'budapest-hu',
      agodaCityId: 10647,
      agodaHotelCount: 953,
      fallbackFlightUsd: 570,
      fallbackNightlyUsd: 72,
      agodaCoverageStatus: 'strong'
    },
    PMO: {
      city: 'Palermo',
      country: 'Italy',
      globevoyCityId: 'palermo-it',
      agodaCityId: 14810,
      agodaHotelCount: 677,
      fallbackFlightUsd: 580,
      fallbackNightlyUsd: 75,
      agodaCoverageStatus: 'strong'
    },
    LYS: {
      city: 'Lyon',
      country: 'France',
      globevoyCityId: 'lyon-fr',
      agodaCityId: 11361,
      agodaHotelCount: 319,
      fallbackFlightUsd: 520,
      fallbackNightlyUsd: 95,
      agodaCoverageStatus: 'partial'
    },
    VLC: {
      city: 'Valencia',
      country: 'Spain',
      globevoyCityId: 'valencia-es',
      agodaCityId: 1623,
      agodaHotelCount: 414,
      fallbackFlightUsd: 520,
      fallbackNightlyUsd: 88,
      agodaCoverageStatus: 'partial'
    },
    SJU: {
      city: 'San Juan',
      country: 'Puerto Rico',
      globevoyCityId: 'san-juan-pr',
      agodaCityId: 17823,
      agodaHotelCount: 196,
      fallbackFlightUsd: 380,
      fallbackNightlyUsd: 115,
      agodaCoverageStatus: 'partial'
    },
    PTY: {
      city: 'Panama City',
      country: 'Panama',
      globevoyCityId: 'panama-city-pa',
      agodaCityId: 3356,
      agodaHotelCount: 178,
      fallbackFlightUsd: 410,
      fallbackNightlyUsd: 85,
      agodaCoverageStatus: 'partial'
    },
    SJO: {
      city: 'San Jose',
      country: 'Costa Rica',
      globevoyCityId: 'san-jose-cr',
      agodaCityId: 6576,
      agodaHotelCount: 139,
      fallbackFlightUsd: 410,
      fallbackNightlyUsd: 82,
      agodaCoverageStatus: 'partial'
    },
    LIM: {
      city: 'Lima',
      country: 'Peru',
      globevoyCityId: 'lima-pe',
      agodaCityId: 7082,
      agodaHotelCount: 430,
      fallbackFlightUsd: 530,
      fallbackNightlyUsd: 72,
      agodaCoverageStatus: 'partial'
    },
    BLQ: {
      city: 'Bologna',
      country: 'Italy',
      globevoyCityId: 'bologna-it',
      agodaCityId: 1002,
      agodaHotelCount: 403,
      fallbackFlightUsd: 550,
      fallbackNightlyUsd: 96,
      agodaCoverageStatus: 'partial'
    },
    LJU: {
      city: 'Ljubljana',
      country: 'Slovenia',
      globevoyCityId: 'ljubljana-si',
      agodaCityId: 14313,
      agodaHotelCount: 173,
      fallbackFlightUsd: 570,
      fallbackNightlyUsd: 86,
      agodaCoverageStatus: 'partial'
    },
    IST: {
      city: 'Istanbul',
      country: 'Turkey',
      globevoyCityId: 'istanbul-tr',
      agodaCityId: 14932,
      agodaHotelCount: 4836,
      fallbackFlightUsd: 610,
      fallbackNightlyUsd: 72,
      agodaCoverageStatus: 'strong'
    },
    CAI: {
      city: 'Cairo',
      country: 'Egypt',
      globevoyCityId: 'cairo-eg',
      agodaCityId: 7923,
      agodaHotelCount: 1009,
      fallbackFlightUsd: 670,
      fallbackNightlyUsd: 65,
      agodaCoverageStatus: 'strong'
    },
    TYO: {
      city: 'Tokyo',
      country: 'Japan',
      globevoyCityId: 'tokyo-jp',
      agodaCityId: 5085,
      agodaHotelCount: 5891,
      fallbackFlightUsd: 770,
      fallbackNightlyUsd: 118,
      agodaCoverageStatus: 'strong',
      cityCode: 'TYO',
      airportCodes: ['NRT'],
      primaryAirportCode: 'NRT'
    },
    BKK: {
      city: 'Bangkok',
      country: 'Thailand',
      globevoyCityId: 'bangkok-th',
      agodaCityId: 9395,
      agodaHotelCount: 6480,
      fallbackFlightUsd: 880,
      fallbackNightlyUsd: 50,
      agodaCoverageStatus: 'strong'
    }
  };

  assert.ok(Object.keys(DESTINATIONS).length >= 50, 'backend destination metadata should include at least the 50 local MVP destinations');

  const fallbackCodes = fallbackFlightCandidates('YTO').map(candidate => candidate.destination_city_iata);
  for (const [code, values] of Object.entries(expected)) {
    const cityCode = values.cityCode || code;
    const airportCodes = values.airportCodes || [code];
    const primaryAirportCode = values.primaryAirportCode || code;
    const destination = getDestination(code);
    assert.ok(destination, `${code} should exist in the live backend dataset`);
    assert.strictEqual(destination.city, values.city);
    assert.strictEqual(destination.country, values.country);
    assert.strictEqual(destination.code, code);
    assert.strictEqual(destination.globevoyCityId, values.globevoyCityId);
    assert.strictEqual(destination.travelpayoutsCityCode, cityCode);
    assert.deepStrictEqual(destination.travelpayoutsAirportCodes, airportCodes);
    assert.strictEqual(destination.primaryAirportCode, primaryAirportCode);
    assert.strictEqual(destination.agodaCityId, values.agodaCityId);
    assert.strictEqual(destination.agodaHotelCount, values.agodaHotelCount);
    assert.strictEqual(destination.agodaCoverageStatus, values.agodaCoverageStatus || 'strong');
    assert.strictEqual(destination.providerCoverage.travelpayouts.status, 'strong');
    assert.strictEqual(destination.providerCoverage.agoda.status, values.agodaCoverageStatus || 'strong');
    assert.strictEqual(destination.fallbackFlightUsd, values.fallbackFlightUsd);
    assert.strictEqual(destination.fallbackNightlyUsd, values.fallbackNightlyUsd);
    assert.ok(destination.dailySpendUsd > 0);
    assert.ok(destination.activitiesLocalUsd > 0);
    assert.ok(Array.isArray(destination.aliases));
    assert.ok(Array.isArray(destination.normalizedSearchNames));
    assert.ok(fallbackCodes.includes(code), `${code} should be included in Toronto fallback candidates`);
  }
}

function testSixtyFiveDestinationGroupAMetadata() {
  const expected = {
    ALC: { city: 'Alicante', country: 'Spain', globevoyCityId: 'alicante-es', agodaCityId: 14186, agodaHotelCount: 213, fallbackFlightUsd: 700, fallbackNightlyUsd: 115, dailySpendUsd: 75, activitiesLocalUsd: 75, estimateDecision: 'approve-provisional' },
    BIO: { city: 'Bilbao', country: 'Spain', globevoyCityId: 'bilbao-es', agodaCityId: 7413, agodaHotelCount: 141, fallbackFlightUsd: 690, fallbackNightlyUsd: 130, dailySpendUsd: 85, activitiesLocalUsd: 80, estimateDecision: 'approve-provisional' },
    BOD: { city: 'Bordeaux', country: 'France', globevoyCityId: 'bordeaux-fr', agodaCityId: 12838, agodaHotelCount: 261, fallbackFlightUsd: 690, fallbackNightlyUsd: 135, dailySpendUsd: 85, activitiesLocalUsd: 85, estimateDecision: 'approve-provisional' },
    BRS: { city: 'Bristol', country: 'United Kingdom', globevoyCityId: 'bristol-gb', agodaCityId: 6084, agodaHotelCount: 277, fallbackFlightUsd: 660, fallbackNightlyUsd: 125, dailySpendUsd: 80, activitiesLocalUsd: 75, estimateDecision: 'approve-provisional' },
    CTA: { city: 'Catania', country: 'Italy', globevoyCityId: 'catania-it', agodaCityId: 5596, agodaHotelCount: 518, fallbackFlightUsd: 760, fallbackNightlyUsd: 115, dailySpendUsd: 75, activitiesLocalUsd: 80, estimateDecision: 'approve-with-warning' },
    CLT: { city: 'Charlotte', country: 'United States', globevoyCityId: 'charlotte-us', agodaCityId: 12113, agodaHotelCount: 215, fallbackFlightUsd: 350, fallbackNightlyUsd: 145, dailySpendUsd: 80, activitiesLocalUsd: 75, estimateDecision: 'approve-provisional' },
    CGN: { city: 'Cologne', country: 'Germany', globevoyCityId: 'cologne-de', agodaCityId: 16190, agodaHotelCount: 299, fallbackFlightUsd: 680, fallbackNightlyUsd: 130, dailySpendUsd: 85, activitiesLocalUsd: 75, estimateDecision: 'approve-provisional' },
    DBV: { city: 'Dubrovnik', country: 'Croatia', globevoyCityId: 'dubrovnik-hr', agodaCityId: 4839, agodaHotelCount: 877, fallbackFlightUsd: 760, fallbackNightlyUsd: 150, dailySpendUsd: 80, activitiesLocalUsd: 90, estimateDecision: 'approve-with-warning' },
    AGP: { city: 'Malaga', country: 'Spain', globevoyCityId: 'malaga-es', agodaCityId: 12521, agodaHotelCount: 541, fallbackFlightUsd: 690, fallbackNightlyUsd: 125, dailySpendUsd: 80, activitiesLocalUsd: 80, estimateDecision: 'approve-provisional' },
    MRS: { city: 'Marseille', country: 'France', globevoyCityId: 'marseille-fr', agodaCityId: 1030, agodaHotelCount: 261, fallbackFlightUsd: 700, fallbackNightlyUsd: 135, dailySpendUsd: 85, activitiesLocalUsd: 80, estimateDecision: 'approve-provisional' },
    BNA: { city: 'Nashville', country: 'United States', globevoyCityId: 'nashville-us', agodaCityId: 2703, agodaHotelCount: 396, fallbackFlightUsd: 360, fallbackNightlyUsd: 160, dailySpendUsd: 85, activitiesLocalUsd: 95, estimateDecision: 'approve-provisional' },
    NCE: { city: 'Nice', country: 'France', globevoyCityId: 'nice-fr', agodaCityId: 5277, agodaHotelCount: 314, fallbackFlightUsd: 720, fallbackNightlyUsd: 170, dailySpendUsd: 95, activitiesLocalUsd: 90, estimateDecision: 'approve-with-warning' },
    SLC: { city: 'Salt Lake City', country: 'United States', globevoyCityId: 'salt-lake-city-us', agodaCityId: 8052, agodaHotelCount: 139, fallbackFlightUsd: 410, fallbackNightlyUsd: 155, dailySpendUsd: 85, activitiesLocalUsd: 95, estimateDecision: 'approve-provisional' },
    TLS: { city: 'Toulouse', country: 'France', globevoyCityId: 'toulouse-fr', agodaCityId: 14562, agodaHotelCount: 200, fallbackFlightUsd: 690, fallbackNightlyUsd: 125, dailySpendUsd: 80, activitiesLocalUsd: 75, estimateDecision: 'approve-provisional' },
    VIE: { city: 'Vienna', country: 'Austria', globevoyCityId: 'vienna-at', agodaCityId: 16582, agodaHotelCount: 717, fallbackFlightUsd: 650, fallbackNightlyUsd: 150, dailySpendUsd: 85, activitiesLocalUsd: 90, estimateDecision: 'approve-provisional' }
  };

  assert.ok(Object.keys(DESTINATIONS).length >= 65, 'backend destination metadata should include at least the 65 local MVP destinations');

  const fallbackCodes = fallbackFlightCandidates('YTO').map(candidate => candidate.destination_city_iata);
  for (const [code, values] of Object.entries(expected)) {
    const destination = getDestination(code);
    assert.ok(destination, `${code} should exist in the 50-to-65 backend dataset`);
    assert.strictEqual(destination.city, values.city);
    assert.strictEqual(destination.country, values.country);
    assert.strictEqual(destination.code, code);
    assert.strictEqual(destination.globevoyCityId, values.globevoyCityId);
    assert.strictEqual(destination.travelpayoutsCityCode, code);
    assert.deepStrictEqual(destination.travelpayoutsAirportCodes, [code]);
    assert.strictEqual(destination.primaryAirportCode, code);
    assert.strictEqual(destination.agodaCityId, values.agodaCityId);
    assert.strictEqual(destination.agodaHotelCount, values.agodaHotelCount);
    assert.strictEqual(destination.agodaCoverageStatus, 'strong');
    assert.strictEqual(destination.providerCoverage.travelpayouts.status, 'strong');
    assert.strictEqual(destination.providerCoverage.agoda.status, 'strong');
    assert.strictEqual(destination.fallbackFlightUsd, values.fallbackFlightUsd);
    assert.strictEqual(destination.fallbackNightlyUsd, values.fallbackNightlyUsd);
    assert.strictEqual(destination.dailySpendUsd, values.dailySpendUsd);
    assert.strictEqual(destination.activitiesLocalUsd, values.activitiesLocalUsd);
    assert.strictEqual(destination.estimateDecision, values.estimateDecision);
    assert.strictEqual(destination.frontendFallbackEligible, true);
    assert.ok(Array.isArray(destination.aliases));
    assert.ok(Array.isArray(destination.normalizedSearchNames));
    assert.ok(fallbackCodes.includes(code), `${code} should be included in Toronto fallback candidates`);
  }
}

function testOneHundredFifteenDestinationExpansionMetadata() {
  assert.strictEqual(SIXTY_FIVE_TO_115_SUBSET.length, 50, '65-to-115 approval subset should contain exactly 50 records');
  assert.strictEqual(Object.keys(DESTINATIONS).length, 115, 'backend destination metadata should include exactly 115 local MVP destinations');

  const fallbackCodes = fallbackFlightCandidates('YTO').map(candidate => candidate.destination_city_iata);
  for (const values of SIXTY_FIVE_TO_115_SUBSET) {
    const code = values.travelpayoutsCityCode;
    const destination = getDestination(code);
    assert.ok(destination, `${code} should exist in the 65-to-115 backend dataset`);
    assert.strictEqual(destination.city, values.city);
    assert.strictEqual(destination.country, values.country);
    assert.strictEqual(destination.code, code);
    assert.strictEqual(destination.globevoyCityId, values.globevoyCityId);
    assert.strictEqual(destination.travelpayoutsCityCode, code);
    assert.deepStrictEqual(destination.travelpayoutsAirportCodes, [code]);
    assert.strictEqual(destination.primaryAirportCode, code);
    assert.strictEqual(destination.agodaCityId, Number(values.agodaCityId));
    assert.strictEqual(destination.agodaHotelCount, Number(values.agodaHotelCount));
    assert.strictEqual(destination.agodaCoverageStatus, values.agodaCoverageStatus || 'strong');
    assert.strictEqual(destination.providerCoverage.travelpayouts.status, 'strong');
    assert.strictEqual(destination.providerCoverage.agoda.status, values.agodaCoverageStatus || 'strong');
    assert.strictEqual(destination.fallbackFlightUsd, values.fallbackFlightUsd);
    assert.strictEqual(destination.fallbackNightlyUsd, values.fallbackNightlyUsd);
    assert.strictEqual(destination.dailySpendUsd, values.dailySpendUsd);
    assert.strictEqual(destination.activitiesLocalUsd, values.activitiesLocalUsd);
    assert.strictEqual(destination.estimateDecision, values.estimateDecision);
    assert.strictEqual(destination.frontendFallbackEligible, true);
    assert.ok(Array.isArray(destination.aliases));
    assert.ok(Array.isArray(destination.normalizedSearchNames));
    assert.ok(fallbackCodes.includes(code), `${code} should be included in Toronto fallback candidates`);
  }
}

function testFullTripCostCase({ label, budgetUsd, flightUsd, stayUsd, dailySpendUsd, activitiesLocalUsd, expectedLabel }) {
  const cost = calculateFullTripCost({
    flightUsd,
    stayUsd,
    dailySpendUsd,
    activitiesLocalUsd,
    budgetUsd
  });
  assert.strictEqual(cost.budgetFitLabel, expectedLabel, `${label} should be ${expectedLabel}`);
  assert.strictEqual(cost.total, flightUsd + stayUsd + dailySpendUsd + activitiesLocalUsd);
  assert.strictEqual(cost.budgetBuffer, budgetUsd - cost.total);
  assert.ok(cost.score >= 25 && cost.score <= 98, `${label} Budget Fit score should stay in range`);
}

function testFullTripCostExamples() {
  testFullTripCostCase({
    label: 'Toronto to Cancun',
    budgetUsd: 1500,
    flightUsd: 330,
    stayUsd: 275,
    dailySpendUsd: 330,
    activitiesLocalUsd: 130,
    expectedLabel: 'Good fit'
  });
  testFullTripCostCase({
    label: 'Toronto to Lisbon',
    budgetUsd: 1300,
    flightUsd: 430,
    stayUsd: 340,
    dailySpendUsd: 348,
    activitiesLocalUsd: 95,
    expectedLabel: 'Tight'
  });
  testFullTripCostCase({
    label: 'Toronto to New York',
    budgetUsd: 1500,
    flightUsd: 260,
    stayUsd: 775,
    dailySpendUsd: 630,
    activitiesLocalUsd: 125,
    expectedLabel: 'Over budget'
  });
}

async function testLowBudgetDoesNotCrash() {
  const result = await getRecommendations({
    origin: 'YTO',
    budgetUsd: '300',
    month: '2026-07',
    nights: '5'
  });

  assert.strictEqual(result.ok, true);
  assert.ok(Array.isArray(result.recommendations));
  result.recommendations.forEach(item => {
    assert.ok(item.score <= 64 || item.total > result.requested.budgetUsd * 0.85);
  });
}

async function testHighBudgetSorting() {
  const result = await getRecommendations({
    origin: 'YTO',
    budgetUsd: '10000',
    month: '2026-07',
    nights: '5',
    limit: '115'
  });

  assert.strictEqual(result.ok, true);
  assert.ok(result.recommendations.length > 0);
  assert.strictEqual(result.recommendations.length, 115, 'high budget searches should expose the full 115-destination local MVP dataset');
  const recommendationCodes = new Set(result.recommendations.map(item => item.code));
  for (const code of [
    'CTG', 'MDE', 'MAD', 'SVQ', 'KRK', 'RAK', 'BUD', 'PMO', 'LYS', 'VLC', 'SJU', 'PTY', 'SJO', 'LIM', 'BLQ', 'LJU', 'IST', 'CAI', 'TYO', 'BKK',
    'ALC', 'BIO', 'BOD', 'BRS', 'CTA', 'CLT', 'CGN', 'DBV', 'AGP', 'MRS', 'BNA', 'NCE', 'SLC', 'TLS', 'VIE',
    ...SIXTY_FIVE_TO_115_SUBSET.map(item => item.travelpayoutsCityCode)
  ]) {
    assert.ok(recommendationCodes.has(code), `${code} should be present when the full 115-destination set is requested`);
  }
  assert.ok(result.recommendations[0].score >= 90);
  assertSortedByBudgetFit(result.recommendations);
}

async function testNearMissBudgetLimit() {
  const result = await getRecommendations({
    origin: 'YTO',
    budgetUsd: '1500',
    nearMissUsd: '50',
    month: '2026-07',
    nights: '5',
    limit: '50'
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.requested.nearMissUsd, 50);
  assert.strictEqual(result.requested.budgetCeilingUsd, 1550);
  result.recommendations.forEach(item => {
    assert.ok(
      item.total <= 1550,
      `${item.city} should not be more than $50 over budget; got $${item.total}`
    );
  });
}

async function testMissingMonthDefault() {
  const result = await getRecommendations({
    origin: 'YTO',
    budgetUsd: '1500',
    nights: '5'
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.requested.month, expectedDefaultMonth());
}

async function assertInvalidOrigin(query, label) {
  await assert.rejects(
    () => getRecommendations({
      budgetUsd: '1500',
      month: '2026-07',
      nights: '5',
      ...query
    }),
    error => {
      assert.strictEqual(error.code, 'INVALID_ORIGIN', `${label} should expose INVALID_ORIGIN`);
      assert.strictEqual(error.statusCode, 400, `${label} should map to HTTP 400`);
      assert.strictEqual(error.message, 'Please enter a supported origin city or airport.');
      return true;
    }
  );
}

async function testStrictInvalidOriginHandling() {
  await assertInvalidOrigin({}, 'missing origin');
  await assertInvalidOrigin({ origin: '' }, 'empty origin');
  await assertInvalidOrigin({ origin: '   ' }, 'whitespace origin');
  await assertInvalidOrigin({ origin: 'XXX' }, 'unknown origin');
  await assertInvalidOrigin({ origin: 'Fakecity' }, 'fake city origin');
  await assertInvalidOrigin({ origin: 'Tehran' }, 'unsupported Tehran origin');
  await assertInvalidOrigin({ origin: 'Auckland' }, 'unsupported Auckland origin');
  await assertInvalidOrigin({ origin: 'MAP' }, 'placeholder origin');
}

async function testSupportedOriginsStillWork() {
  process.env.GLOBEVOY_USE_MOCKS = 'true';

  const supportedCases = [
    ['Toronto', 'YTO'],
    ['YTO', 'YTO'],
    ['YYZ', 'YTO'],
    ['New York', 'NYC'],
    ['NYC', 'NYC'],
    ['JFK', 'NYC'],
    ['Los Angeles', 'LAX'],
    ['LA', 'LAX'],
    ['LAX', 'LAX']
  ];

  for (const [origin, expectedCode] of supportedCases) {
    const result = await getRecommendations({
      origin,
      budgetUsd: '1500',
      month: '2026-07',
      nights: '5'
    });

    assert.strictEqual(result.ok, true, `${origin} should still return recommendations`);
    assert.strictEqual(result.requested.origin.code, expectedCode, `${origin} should resolve to ${expectedCode}`);
    assert.ok(Array.isArray(result.recommendations));
  }

  const originCodeResult = await getRecommendations({
    originCode: 'JFK',
    budgetUsd: '1500',
    month: '2026-07',
    nights: '5'
  });

  assert.strictEqual(originCodeResult.ok, true);
  assert.strictEqual(originCodeResult.requested.origin.code, 'NYC');

  const laxOriginCodeResult = await getRecommendations({
    originCode: 'LAX',
    budgetUsd: '1500',
    month: '2026-07',
    nights: '5'
  });

  assert.strictEqual(laxOriginCodeResult.ok, true);
  assert.strictEqual(laxOriginCodeResult.requested.origin.code, 'LAX');
}

async function testLambdaInvalidOriginResponse() {
  const response = await lambdaHandler({
    queryStringParameters: {
      origin: 'MAP',
      budgetUsd: '1500',
      month: '2026-07',
      nights: '5'
    }
  });

  assert.strictEqual(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.deepStrictEqual(body, {
    ok: false,
    error: {
      code: 'INVALID_ORIGIN',
      message: 'Please enter a supported origin city or airport.'
    },
    recommendations: []
  });
}

async function testLiveStyleDepartureDateMetadata() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalToken = process.env.TRAVELPAYOUTS_TOKEN;
  const originalPriceCurrency = process.env.TRAVELPAYOUTS_PRICE_CURRENCY;
  const originalAgodaSiteId = process.env.AGODA_SITE_ID;
  const originalAgodaApiKey = process.env.AGODA_API_KEY;
  let requests = 0;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  process.env.TRAVELPAYOUTS_TOKEN = 'test-token';
  process.env.TRAVELPAYOUTS_PRICE_CURRENCY = 'USD';
  delete process.env.AGODA_SITE_ID;
  delete process.env.AGODA_API_KEY;

  global.fetch = async (url, options = {}) => {
    requests += 1;
    assert.ok(String(url).includes('api.travelpayouts.com'), 'live-style test should call Travelpayouts endpoint');
    const body = JSON.parse(options.body || '{}');
    assert.ok(body.query.includes('prices_one_way'), 'query should use current one-way monthly flow');
    assert.ok(body.query.includes('depart_months: "2026-09-01"'), 'query should send the selected month');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          prices_one_way: [
            {
              destination_city_iata: 'CUN',
              departure_at: '2026-09-13T10:00:00+00:00',
              value: 350,
              trip_duration: 0,
              ticket_link: '/search/YTO1309CUN1'
            }
          ]
        }
      })
    };
  };

  try {
    const result = await getRecommendations({
      origin: 'YTO',
      budgetUsd: '2000',
      month: '2026-09',
      nights: '5',
      limit: '5'
    });

    assert.strictEqual(requests, 1);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'live');
    const offer = result.recommendations.find(item => item.code === 'CUN');
    assert.ok(offer, 'live-style CUN candidate should be returned');
    assert.strictEqual(offer.bestDepartureDate, '2026-09-13');
    assert.strictEqual(offer.dateStrategy, 'monthly-one-way-cheapest-returned');
    assert.strictEqual(offer.flexibleDateSource, 'travelpayouts-graphql-prices-one-way');
    assert.strictEqual(offer.flightBudgetShare, 0.175);
    assert.strictEqual(offer.flightBudgetStatus, 'within-target');
    assert.strictEqual(offer.raw.departureAt, '2026-09-13T10:00:00+00:00');
    assertTrackedAviasalesLink(offer.bookingLinks.flight.url);
  } finally {
    global.fetch = originalFetch;
    restoreEnv('GLOBEVOY_USE_MOCKS', originalUseMocks);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalToken);
    restoreEnv('TRAVELPAYOUTS_PRICE_CURRENCY', originalPriceCurrency);
    restoreEnv('AGODA_SITE_ID', originalAgodaSiteId);
    restoreEnv('AGODA_API_KEY', originalAgodaApiKey);
  }
}

async function testLiveProviderMetadataGapsDoNotBlockProductionFallbackFill() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalToken = process.env.TRAVELPAYOUTS_TOKEN;
  const originalPriceCurrency = process.env.TRAVELPAYOUTS_PRICE_CURRENCY;
  const originalAgodaSiteId = process.env.AGODA_SITE_ID;
  const originalAgodaApiKey = process.env.AGODA_API_KEY;
  let requests = 0;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  process.env.TRAVELPAYOUTS_TOKEN = 'test-token';
  process.env.TRAVELPAYOUTS_PRICE_CURRENCY = 'USD';
  delete process.env.AGODA_SITE_ID;
  delete process.env.AGODA_API_KEY;

  global.fetch = async (url, options = {}) => {
    requests += 1;
    assert.ok(String(url).includes('api.travelpayouts.com'), 'metadata-gap test should call Travelpayouts endpoint');
    const body = JSON.parse(options.body || '{}');
    assert.ok(body.query.includes('paging: { limit: 115 offset: 0 }'), 'query should request the expanded 115-result page');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          prices_one_way: Array.from({ length: 115 }, (_, index) => ({
            destination_city_iata: `X${String(index).padStart(2, '0')}`,
            departure_at: '2026-07-15T10:00:00+00:00',
            value: 199 + index,
            trip_duration: 0,
            ticket_link: `/search/YTO1507X${String(index).padStart(2, '0')}1`
          }))
        }
      })
    };
  };

  try {
    const result = await getRecommendations({
      origin: 'YTO',
      budgetUsd: '30000',
      month: '2026-07',
      nights: '5',
      limit: '115'
    });

    assert.strictEqual(requests, 1);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'live');
    assert.strictEqual(result.diagnostics.candidatesFromFlightSource, 115);
    assert.strictEqual(result.diagnostics.candidatesAfterCuratedFill, 230);
    assert.strictEqual(result.diagnostics.droppedNoMetadata, 115);
    assert.strictEqual(result.diagnostics.filteredByBudget, 0);
    assert.strictEqual(result.diagnostics.finalCount, 115);
    assert.strictEqual(result.recommendations.length, 115, 'metadata-backed fallback destinations should fill behind provider-only live rows');
    const recommendationCodes = new Set(result.recommendations.map(item => item.code));
    for (const code of Object.keys(DESTINATIONS)) {
      assert.ok(recommendationCodes.has(code), `${code} should survive live provider metadata gaps`);
    }
  } finally {
    global.fetch = originalFetch;
    restoreEnv('GLOBEVOY_USE_MOCKS', originalUseMocks);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalToken);
    restoreEnv('TRAVELPAYOUTS_PRICE_CURRENCY', originalPriceCurrency);
    restoreEnv('AGODA_SITE_ID', originalAgodaSiteId);
    restoreEnv('AGODA_API_KEY', originalAgodaApiKey);
  }
}

async function testExpandedFallbackCoverageForSupportedOrigins() {
  process.env.GLOBEVOY_USE_MOCKS = 'true';

  for (const origin of ['YTO', 'NYC', 'LAX']) {
    const result = await getRecommendations({
      origin,
      budgetUsd: '30000',
      month: '2026-07',
      nights: '5',
      limit: '115'
    });
    const expectedCount = DESTINATIONS[origin] ? Object.keys(DESTINATIONS).length - 1 : Object.keys(DESTINATIONS).length;
    assert.strictEqual(result.ok, true);
    assert.strictEqual(
      result.recommendations.length,
      expectedCount,
      `${origin} high-budget fallback search should expose every production destination except the origin itself`
    );
    assert.strictEqual(result.diagnostics.droppedNoMetadata, 0);
  }
}

async function testAgodaZeroQualityResultsFallback() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalSiteId = process.env.AGODA_SITE_ID;
  const originalApiKey = process.env.AGODA_API_KEY;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  process.env.AGODA_SITE_ID = 'test-site';
  process.env.AGODA_API_KEY = 'test-key';

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      results: [
        {
          hotelName: 'Too Cheap To Trust Inn',
          dailyRate: 42,
          reviewScore: 5.8,
          starRating: 2,
          landingURL: 'https://example.com/hotel'
        }
      ]
    })
  });

  try {
    const destination = getDestination('NYC');
    const stay = await fetchAgodaStayEstimate({ destination, nights: 3, month: '2026-07' });
    assert.strictEqual(stay.source, 'fallback');
    assert.strictEqual(stay.totalStayUsd, destination.fallbackNightlyUsd * 3);
  } finally {
    global.fetch = originalFetch;
    process.env.GLOBEVOY_USE_MOCKS = originalUseMocks;
    process.env.AGODA_SITE_ID = originalSiteId;
    process.env.AGODA_API_KEY = originalApiKey;
  }
}

async function testAgodaLowTrustStayNamesFallback() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalSiteId = process.env.AGODA_SITE_ID;
  const originalApiKey = process.env.AGODA_API_KEY;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  process.env.AGODA_SITE_ID = 'test-site';
  process.env.AGODA_API_KEY = 'test-key';

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      results: [
        {
          hotelName: 'London Backpackers Youth Hostel',
          dailyRate: 38,
          reviewScore: 8.5,
          starRating: 4,
          accommodationType: 'Hostel',
          landingURL: 'https://example.com/hostel'
        },
        {
          hotelName: 'Modern Basement Suite with Comforts',
          dailyRate: 55,
          reviewScore: 9.2,
          starRating: 4,
          accommodationType: 'Private room',
          landingURL: 'https://example.com/private-room'
        }
      ]
    })
  });

  try {
    const destination = getDestination('LON');
    const stay = await fetchAgodaStayEstimate({ destination, nights: 4, month: '2026-07' });
    assert.strictEqual(stay.source, 'fallback');
    assert.strictEqual(stay.totalStayUsd, destination.fallbackNightlyUsd * 4);
  } finally {
    global.fetch = originalFetch;
    process.env.GLOBEVOY_USE_MOCKS = originalUseMocks;
    process.env.AGODA_SITE_ID = originalSiteId;
    process.env.AGODA_API_KEY = originalApiKey;
  }
}

async function testAgodaLiveQualitySignals() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalSiteId = process.env.AGODA_SITE_ID;
  const originalApiKey = process.env.AGODA_API_KEY;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  process.env.AGODA_SITE_ID = 'test-site';
  process.env.AGODA_API_KEY = 'test-key';

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      results: [
        {
          hotelName: 'Quality City Hotel',
          dailyRate: 120,
          reviewScore: 8.4,
          starRating: 4,
          reviewCount: 185,
          accommodationType: 'Hotel',
          landingURL: 'https://example.com/agoda-hotel'
        }
      ]
    })
  });

  try {
    const stay = await fetchAgodaStayEstimate({ destination: getDestination('LIS'), nights: 5, month: '2026-07' });
    assert.strictEqual(stay.source, 'agoda');
    assert.strictEqual(stay.hotelName, 'Quality City Hotel');
    assert.strictEqual(stay.hotelUrl, 'https://example.com/agoda-hotel');
    assert.strictEqual(stay.sampleSize, 1);
    assert.strictEqual(stay.qualitySignals.rating, 8.4);
    assert.strictEqual(stay.qualitySignals.stars, 4);
    assert.strictEqual(stay.qualitySignals.reviewCount, 185);
    assert.strictEqual(stay.qualitySignals.hotelName, 'Quality City Hotel');
  } finally {
    global.fetch = originalFetch;
    restoreEnv('GLOBEVOY_USE_MOCKS', originalUseMocks);
    restoreEnv('AGODA_SITE_ID', originalSiteId);
    restoreEnv('AGODA_API_KEY', originalApiKey);
  }
}

async function testAgodaMissingQualityAndNoUrlMetadata() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalSiteId = process.env.AGODA_SITE_ID;
  const originalApiKey = process.env.AGODA_API_KEY;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  process.env.AGODA_SITE_ID = 'test-site';
  process.env.AGODA_API_KEY = 'test-key';

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      results: [
        {
          hotelName: 'Sparse Data Hotel',
          dailyRate: 90,
          accommodationType: 'Hotel'
        }
      ]
    })
  });

  try {
    const destination = getDestination('OPO');
    const stay = await fetchAgodaStayEstimate({ destination, nights: 4, month: '2026-07' });
    assert.strictEqual(stay.source, 'agoda');
    assert.strictEqual(stay.hotelUrl, null);
    assert.strictEqual(stay.qualitySignals.rating, null);
    assert.strictEqual(stay.qualitySignals.stars, null);
    assert.strictEqual(stay.qualitySignals.reviewCount, null);

    const metadata = buildHotelScoringMetadata({ stay, destination, budgetUsd: 1000, nights: 4 });
    assert.strictEqual(metadata.hotelSourceConfidence, 'live-agoda');
    assert.ok(metadata.hotelWarnings.includes('no-agoda-link'));
    assert.ok(metadata.hotelWarnings.includes('rating-unavailable'));
    assert.ok(metadata.hotelWarnings.includes('review-count-unavailable'));
    assert.ok(metadata.hotelWarnings.includes('star-rating-unavailable'));
  } finally {
    global.fetch = originalFetch;
    restoreEnv('GLOBEVOY_USE_MOCKS', originalUseMocks);
    restoreEnv('AGODA_SITE_ID', originalSiteId);
    restoreEnv('AGODA_API_KEY', originalApiKey);
  }
}

async function testAgodaLiveRecommendationHotelMetadataAndLinkSafety() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
  const originalSiteId = process.env.AGODA_SITE_ID;
  const originalApiKey = process.env.AGODA_API_KEY;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  delete process.env.TRAVELPAYOUTS_TOKEN;
  process.env.AGODA_SITE_ID = 'test-site';
  process.env.AGODA_API_KEY = 'test-key';

  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      results: [
        {
          hotelName: 'Referral Safe Hotel',
          dailyRate: 100,
          reviewScore: 8.8,
          starRating: 4,
          reviewCount: 320,
          accommodationType: 'Hotel',
          landingURL: 'https://example.com/referral-safe-hotel'
        }
      ]
    })
  });

  try {
    const result = await getRecommendations({
      origin: 'YTO',
      budgetUsd: '10000',
      month: '2026-07',
      nights: '5',
      limit: '5'
    });
    const offer = result.recommendations[0];
    assert.ok(offer, 'expected a recommendation with Agoda metadata');
    assert.strictEqual(offer.hotelSourceConfidence, 'live-agoda');
    assert.strictEqual(offer.stayStrategy, 'agoda-quality-filtered-price-average');
    assert.strictEqual(offer.hotelQualitySignals.rating, 8.8);
    assert.strictEqual(offer.hotelQualitySignals.stars, 4);
    assert.strictEqual(offer.hotelQualitySignals.reviewCount, 320);
    assert.strictEqual(offer.hotelUrl, 'https://example.com/referral-safe-hotel');
    assert.strictEqual(offer.bookingLinks.hotel.url, offer.hotelUrl);
    assert.strictEqual(offer.bookingLinks.hotel.partner, 'Agoda');
    assert.strictEqual(offer.bookingLinks.hotel.kind, 'hotel');
    assertTrackedAviasalesLink(offer.bookingLinks.flight.url);
  } finally {
    global.fetch = originalFetch;
    restoreEnv('GLOBEVOY_USE_MOCKS', originalUseMocks);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('AGODA_SITE_ID', originalSiteId);
    restoreEnv('AGODA_API_KEY', originalApiKey);
  }
}

async function testAgodaErrorPathRecommendationHotelMetadata() {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.GLOBEVOY_USE_MOCKS;
  const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
  const originalSiteId = process.env.AGODA_SITE_ID;
  const originalApiKey = process.env.AGODA_API_KEY;

  process.env.GLOBEVOY_USE_MOCKS = 'false';
  delete process.env.TRAVELPAYOUTS_TOKEN;
  process.env.AGODA_SITE_ID = 'test-site';
  process.env.AGODA_API_KEY = 'test-key';

  global.fetch = async () => {
    throw new Error('Agoda unavailable');
  };

  try {
    const result = await getRecommendations({
      origin: 'YTO',
      budgetUsd: '10000',
      month: '2026-07',
      nights: '5',
      limit: '5'
    });
    const offer = result.recommendations[0];
    assert.ok(offer, 'expected fallback recommendations after Agoda error');
    assert.strictEqual(offer.hotelSourceConfidence, 'fallback-after-error');
    assert.strictEqual(offer.stayStrategy, 'fallback-after-agoda-error');
    assert.ok(offer.hotelWarnings.includes('fallback-after-agoda-error'));
    assert.ok(offer.hotelWarnings.includes('fallback-stay-estimate'));
    assert.ok(offer.hotelWarnings.includes('no-agoda-link'));
    assert.strictEqual(offer.hotelUrl, null);
    assert.strictEqual(offer.bookingLinks.hotel, null);
  } finally {
    global.fetch = originalFetch;
    restoreEnv('GLOBEVOY_USE_MOCKS', originalUseMocks);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('AGODA_SITE_ID', originalSiteId);
    restoreEnv('AGODA_API_KEY', originalApiKey);
  }
}

async function main() {
  process.env.GLOBEVOY_USE_MOCKS = 'true';
  testBudgetFitThresholds();
  testFlexibleDateFormatting();
  testFlightBudgetMetadata();
  testHotelScoringMetadata();
  testProviderMetadataMergeForSafeOverlapRecords();
  testFortyDestinationExpansionMetadata();
  testSixtyFiveDestinationGroupAMetadata();
  testOneHundredFifteenDestinationExpansionMetadata();
  testFullTripCostExamples();
  await testBasicMockRecommendations();
  await testLiveStyleDepartureDateMetadata();
  await testLiveProviderMetadataGapsDoNotBlockProductionFallbackFill();
  await testExpandedFallbackCoverageForSupportedOrigins();
  await testLowBudgetDoesNotCrash();
  await testHighBudgetSorting();
  await testNearMissBudgetLimit();
  await testMissingMonthDefault();
  await testStrictInvalidOriginHandling();
  await testSupportedOriginsStillWork();
  await testLambdaInvalidOriginResponse();
  await testAgodaZeroQualityResultsFallback();
  await testAgodaLowTrustStayNamesFallback();
  await testAgodaLiveQualitySignals();
  await testAgodaMissingQualityAndNoUrlMetadata();
  await testAgodaLiveRecommendationHotelMetadataAndLinkSafety();
  await testAgodaErrorPathRecommendationHotelMetadata();
  console.log('OK: edge-case recommendation tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
