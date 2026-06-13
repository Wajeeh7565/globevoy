function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildStayDates(month, nights) {
  const raw = String(month || '').trim();
  let checkIn;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) checkIn = new Date(`${raw}T00:00:00Z`);
  else if (/^\d{4}-\d{2}$/.test(raw)) checkIn = new Date(`${raw}-15T00:00:00Z`);
  else {
    const now = new Date();
    checkIn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 15));
  }
  return {
    checkIn: isoDate(checkIn),
    checkOut: isoDate(addDays(checkIn, nights))
  };
}

function findHotelArrays(value, matches = []) {
  if (!value || typeof value !== 'object') return matches;
  if (Array.isArray(value)) {
    if (value.some(item => item && typeof item === 'object' && ('hotelName' in item || 'dailyRate' in item || 'landingURL' in item))) {
      matches.push(value);
    }
    value.forEach(item => findHotelArrays(item, matches));
    return matches;
  }
  Object.values(value).forEach(child => findHotelArrays(child, matches));
  return matches;
}

function parseRate(hotel) {
  const fields = [
    hotel.dailyRate,
    hotel.price,
    hotel.rate,
    hotel.roomRate,
    hotel.averageNightlyRate,
    hotel?.pricing?.dailyRate
  ];
  for (const field of fields) {
    const value = Number(field);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function parseFirstPositiveNumber(fields) {
  for (const field of fields) {
    const value = Number(field);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function parseReviewScore(hotel) {
  return parseFirstPositiveNumber([
    hotel.reviewScore,
    hotel.review_score,
    hotel.ratingAverage,
    hotel.rating_average,
    hotel.reviewRating,
    hotel.review_rating,
    hotel.rating,
    hotel.score
  ]);
}

function parseStarRating(hotel) {
  return parseFirstPositiveNumber([
    hotel.starRating,
    hotel.star_rating,
    hotel.stars,
    hotel.hotelStarRating,
    hotel.hotel_star_rating
  ]);
}

function parseReviewCount(hotel) {
  return parseFirstPositiveNumber([
    hotel.reviewCount,
    hotel.review_count,
    hotel.numberOfReviews,
    hotel.number_of_reviews,
    hotel.reviewsCount,
    hotel.reviews_count,
    hotel.totalReviews,
    hotel.total_reviews
  ]);
}

// Property name or type contains any of these -> reject. Order doesn't matter.
// These target the patterns we actually saw in production: student housing,
// university residences, basement suites, private rooms/suites posing as hotels,
// and homestay/villa/apartment-style listings without management.
const LOW_TRUST_STAY_TERMS = [
  'backpacker',
  'basement',
  'bed & breakfast',
  'bed and breakfast',
  'b&b',
  'campus',
  'capsule',
  'couchsurf',
  'dorm',
  'guest house',
  'guesthouse',
  'homestay',
  'hostal',
  'hostel',
  'pension',
  'private room',
  'private suite',
  'residence hall',
  'residences',
  'shared room',
  'student',
  'students only',
  'youth hostel'
];

// Structural quality floor on top of name-based filtering. We want a baseline
// signal that this is a real, reviewed hotel — not a one-off listing. A real
// hotel typically has at least a few dozen reviews. Set conservatively to avoid
// blocking small-town hotels with thin review counts.
const MIN_REVIEW_COUNT = 25;

function normalizedText(value) {
  return String(value || '').toLowerCase();
}

function hasLowTrustStayTerm(value) {
  const text = normalizedText(value);
  return LOW_TRUST_STAY_TERMS.some(term => text.includes(term));
}

function parseAccommodationType(hotel) {
  return [
    hotel.accommodationType,
    hotel.accommodation_type,
    hotel.hotelType,
    hotel.hotel_type,
    hotel.propertyType,
    hotel.property_type
  ].find(Boolean) || '';
}

function isTrustworthyStayType(hotel) {
  const name = hotel.hotelName || hotel.name || '';
  const type = parseAccommodationType(hotel);
  return !hasLowTrustStayTerm(name) && !hasLowTrustStayTerm(type);
}

function meetsQualityFloor(hotel) {
  if (!isTrustworthyStayType(hotel)) return false;
  const reviewScore = parseReviewScore(hotel);
  const starRating = parseStarRating(hotel);
  const reviewCount = parseReviewCount(hotel);
  const reviewOk = reviewScore === null || reviewScore >= 7;
  const starOk = starRating === null || starRating >= 3;
  // Only enforce review count when Agoda actually reports it. Some hotel
  // listings omit reviewCount entirely; skipping that filter is preferable
  // to dropping every result. When the count IS present, require at least
  // MIN_REVIEW_COUNT to weed out single-listing apartments and oddities.
  const reviewCountOk = reviewCount === null || reviewCount >= MIN_REVIEW_COUNT;
  return reviewOk && starOk && reviewCountOk;
}

function buildHotelQualitySignals(hotel, sampleSize = 0) {
  const source = hotel || {};
  return {
    rating: hotel ? parseReviewScore(source) : null,
    stars: hotel ? parseStarRating(source) : null,
    reviewCount: hotel ? parseReviewCount(source) : null,
    sampleSize: Number(sampleSize) || 0,
    hotelName: hotel ? (source.hotelName || source.name || null) : null
  };
}

function convertToUsd(amount, currency) {
  const code = String(currency || 'USD').toUpperCase();
  if (code === 'USD') return amount;
  if (code === 'CAD') return amount * Number(process.env.CAD_TO_USD || 0.735);
  return amount;
}

function fallbackStay(destination, nights) {
  const nightlyUsd = Number(destination.fallbackNightlyUsd || 85);
  return {
    source: 'fallback',
    averageNightlyUsd: nightlyUsd,
    totalStayUsd: Math.round(nightlyUsd * nights),
    hotelName: null,
    hotelUrl: null,
    sampleSize: 0,
    qualitySignals: buildHotelQualitySignals(null, 0)
  };
}

function buildAgodaBody({ destination, checkIn, checkOut, includeQualityFields }) {
  const additional = {
    currency: 'CAD',
    maxResult: 10,
    occupancy: {
      numberOfAdult: 1,
      numberOfChildren: 0
    },
    sortBy: 'PriceAsc'
  };

  if (includeQualityFields) {
    // Request the quality floor from Agoda first; local filtering below protects us if the API ignores these fields.
    additional.minimumReviewScore = 7;
    additional.minimumStarRating = 3;
  }

  return {
    criteria: {
      additional,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      cityId: destination.agodaCityId
    }
  };
}

async function requestAgoda({ endpoint, siteId, apiKey, body }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${siteId}:${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Agoda returned non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Agoda request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  return payload;
}

async function fetchAgodaStayEstimate({ destination, nights, month }) {
  const siteId = process.env.AGODA_SITE_ID;
  const apiKey = process.env.AGODA_API_KEY;
  const endpoint = process.env.AGODA_ENDPOINT || 'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';
  const useMocks = String(process.env.GLOBEVOY_USE_MOCKS || '').toLowerCase() === 'true';

  if (!destination?.agodaCityId || !siteId || !apiKey || useMocks) {
    return fallbackStay(destination, nights);
  }

  const { checkIn, checkOut } = buildStayDates(month, nights);
  let payload;
  try {
    payload = await requestAgoda({
      endpoint,
      siteId,
      apiKey,
      body: buildAgodaBody({ destination, checkIn, checkOut, includeQualityFields: true })
    });
  } catch (error) {
    payload = await requestAgoda({
      endpoint,
      siteId,
      apiKey,
      body: buildAgodaBody({ destination, checkIn, checkOut, includeQualityFields: false })
    });
  }

  const hotels = findHotelArrays(payload).flat().filter(meetsQualityFloor);
  if (!hotels.length) return fallbackStay(destination, nights);

  const rated = hotels
    .map(hotel => ({ hotel, nightlyCad: parseRate(hotel) }))
    .filter(item => item.nightlyCad > 0)
    .slice(0, 5);

  if (!rated.length) return fallbackStay(destination, nights);

  const avgNightlyCad = rated.reduce((sum, item) => sum + item.nightlyCad, 0) / rated.length;
  const first = rated[0].hotel;
  const averageNightlyUsd = convertToUsd(avgNightlyCad, 'CAD');
  const hotelName = first.hotelName || first.name || null;

  return {
    source: 'agoda',
    averageNightlyUsd: Math.round(averageNightlyUsd),
    totalStayUsd: Math.round(averageNightlyUsd * nights),
    hotelName,
    hotelUrl: first.landingURL || first.url || null,
    sampleSize: rated.length,
    qualitySignals: {
      ...buildHotelQualitySignals(first, rated.length),
      hotelName
    }
  };
}

module.exports = {
  fetchAgodaStayEstimate,
  buildStayDates,
  fallbackStay
};
