const SUPPORTED_AGODA_CURRENCIES = Object.freeze(['CAD', 'USD', 'EUR', 'GBP', 'AUD']);
const DEFAULT_AGODA_CURRENCY = 'CAD';
const AGODA_PROVIDER_STAY_VERSION_679A = 'GV-HOTEL-679A';
const AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1 = 'GV-HOTEL-679A-R1';
const BOOKING_TRUST_VERSION_680A = 'GV-QUALITY-680A';

function providerStayIntegration679AEnabled() {
  return String(process.env.ENABLE_AGODA_PROVIDER_STAY_679A || '').trim().toLowerCase() === 'true';
}

function priceLinkIntegrity679AR1Enabled() {
  return String(process.env.ENABLE_AGODA_PRICE_LINK_INTEGRITY_679A_R1 || '').trim().toLowerCase() === 'true';
}

const DEFAULT_AGODA_AUDIT_MAX_RESULT = 30;
const HARD_MAX_AGODA_AUDIT_MAX_RESULT = 30;
const DEFAULT_AGODA_QUALITY_STRATEGY_COUNT = 2;
const HARD_MAX_AGODA_QUALITY_STRATEGY_COUNT = 3;
const AGODA_QUALITY_STRATEGIES = Object.freeze([
  { id: 'recommended-quality', sortBy: 'Recommended' },
  { id: 'guest-review-quality', sortBy: 'AllGuestsReviewScore' },
  { id: 'star-rating-quality', sortBy: 'StarRatingDesc' }
]);
const {
  PRICE_AUDIT_VERSION,
  isPriceAudit610DEnabled,
  auditAgodaHotelSample,
  buildPlanningEstimateEvidence
} = require('../../../domain/pricing/price-audit');

function normalizeAgodaCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return SUPPORTED_AGODA_CURRENCIES.includes(code) ? code : DEFAULT_AGODA_CURRENCY;
}

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


function parseHotelId(hotel = {}) {
  const value = hotel.hotelId ?? hotel.hotel_id ?? hotel.propertyId ?? hotel.property_id ?? hotel.id;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function secureHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/^http:\/\//i, 'https://');
}

function parseHotelImageUrl(hotel = {}) {
  const candidates = [
    hotel.imageURL,
    hotel.imageUrl,
    hotel.image_url,
    hotel.photoURL,
    hotel.photoUrl,
    hotel.photo,
    hotel.thumbnailURL,
    hotel.thumbnailUrl,
    hotel?.content?.imageURL,
    hotel?.content?.imageUrl
  ];
  for (const candidate of candidates) {
    const url = secureHttpUrl(candidate);
    if (url) return url;
  }
  return null;
}

function parseOptionalBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return null;
}

function classifyAgodaLandingUrl679AR1(value, expectedHotelId = null) {
  const url = secureHttpUrl(value);
  if (!url) return {
    url: null,
    linkType: 'none',
    directPropertyLink: false,
    finalDestinationRequiresPartnerConfirmation: true
  };
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if ((host !== 'agoda.com' && !host.endsWith('.agoda.com')) || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
      return { url: null, linkType: 'none', directPropertyLink: false, finalDestinationRequiresPartnerConfirmation: true, reason: 'untrusted-agoda-url' };
    }
    const path = String(parsed.pathname || '').toLowerCase();
    const isPartnerSearch = path.includes('/partners/partnersearch.aspx') || path.includes('/partnersearch.aspx');
    const ids = [...parsed.searchParams].filter(([key]) => ['hid','hotelid','hotel_id'].includes(key.toLowerCase())).map(([,id])=>id);
    const hasHotelId = ids.length > 0;
    if (ids.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) ||
        new Set(ids.map(Number)).size > 1 || (expectedHotelId && ids.some(id => Number(id) !== Number(expectedHotelId)))) {
      return { url: null, linkType: 'none', directPropertyLink: false, finalDestinationRequiresPartnerConfirmation: true, reason: 'hotel-identity-conflict' };
    }
    const looksPropertyPage = !isPartnerSearch && /\/hotel\//i.test(path) && /\.html$/i.test(path);
    return {
      url,
      linkType: looksPropertyPage ? 'provider-property-page' : (isPartnerSearch ? 'provider-search-results' : 'provider-link-unverified'),
      directPropertyLink: looksPropertyPage,
      providerHotelIdInLink: hasHotelId,
      identityMatch: hasHotelId && expectedHotelId ? 'provider-id-match' : 'provider-supplied-url',
      finalDestinationRequiresPartnerConfirmation: !looksPropertyPage
    };
  } catch (_) {
    return {
      url: null,
      linkType: 'none',
      directPropertyLink: false,
      finalDestinationRequiresPartnerConfirmation: true
    };
  }
}

function buildProviderRateObservation679AR1(audit = null, hotel = {}, requestCurrency) {
  const evidence = audit?.priceEvidence || null;
  if (evidence) {
    return {
      integrityVersion: AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1,
      status: 'provider-observation-unconfirmed-at-landing',
      sourceField: evidence.sourceField || null,
      providerContract: evidence.providerContract || null,
      unit: evidence.unit || null,
      taxBasis: evidence.taxBasis || 'unknown',
      taxesAndFeesIncluded: evidence.taxesAndFeesIncluded === true,
      providerCurrency: evidence.providerCurrency || normalizeAgodaCurrency(requestCurrency),
      providerAmount: Number(evidence.providerAmount || 0) || null,
      providerStayTotal: Number(evidence.providerStayTotal || 0) || null,
      currentLandingPriceConfirmed: false,
      availabilityConfirmed: false,
      priceParityVerified: false,
      finalPriceRequiresPartnerConfirmation: true,
      warnings: Array.isArray(evidence.warnings) ? evidence.warnings : ['final-price-requires-partner-confirmation']
    };
  }
  const nightlyRate = parseRate(hotel) || null;
  return {
    integrityVersion: AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1,
    status: nightlyRate ? 'provider-observation-unconfirmed-at-landing' : 'provider-price-unavailable',
    sourceField: nightlyRate ? 'legacy-rate-field' : null,
    providerContract: null,
    unit: nightlyRate ? 'per-room-per-night-unverified-contract' : null,
    taxBasis: 'unknown',
    taxesAndFeesIncluded: false,
    providerCurrency: normalizeAgodaCurrency(hotel.currency || requestCurrency),
    providerAmount: nightlyRate,
    providerStayTotal: null,
    currentLandingPriceConfirmed: false,
    availabilityConfirmed: false,
    priceParityVerified: false,
    finalPriceRequiresPartnerConfirmation: true,
    warnings: ['final-price-requires-partner-confirmation']
  };
}

function buildProviderHotel679A(hotel = {}, requestCurrency, auditedRate = null) {
  if (!providerStayIntegration679AEnabled() || !hotel || typeof hotel !== 'object') return null;
  const hotelName = hotel.hotelName || hotel.name || hotel.propertyName || null;
  const candidates = [hotel.landingURL, hotel.landingUrl, hotel.url].filter(Boolean)
    .map(url => classifyAgodaLandingUrl679AR1(url, parseHotelId(hotel))).filter(link => link.url);
  const landing = candidates.find(link => link.directPropertyLink) || candidates[0] || classifyAgodaLandingUrl679AR1(null);
  const bookingUrl = landing.url;
  const imageUrl = parseHotelImageUrl(hotel);
  const nightlyRate = parseRate(hotel) || null;
  const crossedOutRate = parseFirstPositiveNumber([hotel.crossedOutRate, hotel.crossed_out_rate]);
  const discountPercentage = parseFirstPositiveNumber([hotel.discountPercentage, hotel.discountPercent, hotel.discount_percentage]);
  const providerCurrency = normalizeAgodaCurrency(hotel.currency || requestCurrency);
  return {
    integrationVersion: AGODA_PROVIDER_STAY_VERSION_679A,
    provider: 'Agoda',
    hotelId: parseHotelId(hotel),
    hotelName,
    imageUrl,
    bookingUrl,
    reviewScore: parseReviewScore(hotel),
    reviewCount: parseReviewCount(hotel),
    starRating: parseStarRating(hotel),
    accommodationType: parseAccommodationType(hotel) || null,
    providerCurrency,
    nightlyRate,
    crossedOutRate,
    discountPercentage,
    includeBreakfast: parseOptionalBoolean(hotel.includeBreakfast ?? hotel.include_breakfast),
    freeWifi: parseOptionalBoolean(hotel.freeWifi ?? hotel.free_wifi),
    selectedForStayEstimate: true,
    ...(priceLinkIntegrity679AR1Enabled() ? {
      priceLinkIntegrityVersion: AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1,
      rateObservation: buildProviderRateObservation679AR1(auditedRate, hotel, requestCurrency),
      linkType: landing.linkType,
      directPropertyLink: landing.directPropertyLink,
      providerHotelIdInLink: landing.providerHotelIdInLink === true,
      finalDestinationRequiresPartnerConfirmation: landing.finalDestinationRequiresPartnerConfirmation === true
    } : {}),
    bookingTrust: {
      version: BOOKING_TRUST_VERSION_680A,
      priceState: nightlyRate ? 'provider-rate-observed' : 'provider-price-unavailable',
      currentPriceConfirmed: false,
      availabilityConfirmed: false,
      baggageOrTaxBasis: 'tax-basis-must-be-confirmed-on-agoda',
      handoffState: landing.directPropertyLink ? 'property-page' : landing.linkType,
      finalPriceRequiresPartnerConfirmation: true
    }
  };
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
  'apartment',
  'apartamento',
  'condo',
  'entire home',
  'entire house',
  'habitacion',
  'habitación',
  'holiday home',
  'pension',
  'private room',
  'private suite',
  'rental home',
  'rooftop terrace',
  'residence hall',
  'residences',
  'shared room',
  'student',
  'students only',
  'vacation home',
  'villa',
  'walk-up',
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

function hotelQualityScore(hotel = {}) {
  const reviewScore = parseReviewScore(hotel) || 0;
  const starRating = parseStarRating(hotel) || 0;
  const reviewCount = parseReviewCount(hotel) || 0;
  const type = normalizedText(parseAccommodationType(hotel));
  const conventionalHotelBonus = /(^|\b)(hotel|resort|inn)(\b|$)/.test(type) ? 18 : 0;
  return reviewScore * 12
    + Math.min(35, Math.log10(reviewCount + 1) * 13)
    + starRating * 5
    + conventionalHotelBonus;
}

function rankQualifiedHotels(hotels = [], hotelStyle = '') {
  const bestBalance = normalizedText(hotelStyle).includes('best');
  if (!bestBalance) return hotels;
  return [...hotels].sort((a, b) => hotelQualityScore(b) - hotelQualityScore(a) || parseRate(a) - parseRate(b));
}

function qualityCandidateRetrievalEnabled() {
  return String(process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E || '').trim().toLowerCase() === 'true';
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function hotelKey(hotel = {}) {
  const id = hotel.hotelId || hotel.hotel_id || hotel.id;
  if (id) return `id:${id}`;
  const name = String(hotel.hotelName || hotel.name || '').trim().toLowerCase();
  const rate = Number(parseRate(hotel) || 0).toFixed(2);
  return `name:${name}|rate:${rate}`;
}

function qualityRejectionReasons(hotel = {}, options = {}) {
  const reasons = [];
  if (options.requireRate !== false && !(parseRate(hotel) > 0)) reasons.push('missing-or-invalid-rate');
  if (!isTrustworthyStayType(hotel)) reasons.push('low-trust-property-type');
  const reviewScore = parseReviewScore(hotel);
  const starRating = parseStarRating(hotel);
  const reviewCount = parseReviewCount(hotel);
  if (reviewScore !== null && reviewScore < 7) reasons.push('review-score-below-7');
  if (starRating !== null && starRating < 3) reasons.push('star-rating-below-3');
  if (reviewCount !== null && reviewCount < MIN_REVIEW_COUNT) reasons.push('review-count-below-25');
  return reasons;
}

function addReasonCounts(target, reasons = []) {
  for (const reason of reasons) target[reason] = (target[reason] || 0) + 1;
  return target;
}

function buildQualityCandidateStrategies(options = {}) {
  if (!qualityCandidateRetrievalEnabled() && options.forceQualityCandidateRetrieval !== true) {
    return [{ id: 'legacy-price-asc', sortBy: 'PriceAsc', maxResult: 10 }];
  }
  const count = boundedInt(
    options.strategyCount || process.env.GV_AGODA_QUALITY_STRATEGY_COUNT,
    DEFAULT_AGODA_QUALITY_STRATEGY_COUNT,
    1,
    HARD_MAX_AGODA_QUALITY_STRATEGY_COUNT
  );
  const maxResult = boundedInt(
    options.maxResult || process.env.GV_AGODA_QUALITY_MAX_RESULT,
    DEFAULT_AGODA_AUDIT_MAX_RESULT,
    10,
    HARD_MAX_AGODA_AUDIT_MAX_RESULT
  );
  return AGODA_QUALITY_STRATEGIES.slice(0, count).map(strategy => ({ ...strategy, maxResult }));
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
  const code = normalizeAgodaCurrency(currency);
  if (code === 'USD') return amount;
  if (code === 'CAD') return amount * Number(process.env.CAD_TO_USD || 0.735);
  if (code === 'AUD') return amount * Number(process.env.AUD_TO_USD || 0.66);
  if (code === 'EUR') return amount * 1.08;
  if (code === 'GBP') return amount * 1.27;
  return amount;
}

function fallbackStay(destination, nights, options = {}) {
  const nightlyUsd = Number(destination.fallbackNightlyUsd || 85);
  const auditEnabled = isPriceAudit610DEnabled();
  return {
    source: options.source || 'fallback',
    averageNightlyUsd: nightlyUsd,
    totalStayUsd: Math.round(nightlyUsd * nights),
    hotelName: null,
    hotelUrl: null,
    sampleSize: 0,
    qualitySignals: buildHotelQualitySignals(null, 0),
    ...(auditEnabled ? {
      priceEvidence: buildPlanningEstimateEvidence({
        destination,
        nights,
        reason: options.reason || 'provider-price-unavailable'
      }),
      priceAudit: options.priceAudit || {
        auditVersion: PRICE_AUDIT_VERSION,
        acceptedCount: 0,
        rejectedCount: 0,
        rejectionReasons: {}
      }
    } : {})
  };
}

function buildAgodaBody({
  destination,
  checkIn,
  checkOut,
  currency,
  includeQualityFields,
  adults = 1,
  children = 0,
  rooms = 1,
  sortBy = 'PriceAsc',
  maxResult = 10,
  minimumReviewScore = 7,
  minimumStarRating = 3
}) {
  const additional = {
    currency: normalizeAgodaCurrency(currency),
    maxResult: boundedInt(maxResult, 10, 1, HARD_MAX_AGODA_AUDIT_MAX_RESULT),
    occupancy: {
      numberOfAdult: Math.max(1, Math.ceil((Number(adults) || 1) / Math.max(1, Number(rooms) || 1))),
      numberOfChildren: Math.max(0, Math.ceil((Number(children) || 0) / Math.max(1, Number(rooms) || 1)))
    },
    sortBy: String(sortBy || 'Recommended')
  };

  if (includeQualityFields) {
    // Affiliate Lite supports these city-search filters. Local filtering below
    // remains authoritative in case the provider ignores or partially applies them.
    additional.minimumReviewScore = Number(minimumReviewScore) || 7;
    additional.minimumStarRating = Number(minimumStarRating) || 3;
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

async function requestAgoda({ endpoint, siteId, apiKey, body, _fetchFn }) {
  const fetchFn = _fetchFn || global.fetch;
  if (!fetchFn) throw new Error('fetch not available');
  const response = await fetchFn(endpoint, {
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

async function fetchAgodaStayEstimate({ destination, nights, month, currency, hotelStyle = '', adults = 1, children = 0, rooms = 1, _fetchFn }) {
  const providerResponseMode = _fetchFn ? 'injected-provider-response' : 'live-agoda-api';
  const siteId = process.env.AGODA_SITE_ID;
  const apiKey = process.env.AGODA_API_KEY;
  const endpoint = process.env.AGODA_ENDPOINT || 'https://affiliateapi7643.agoda.com/affiliateservice/lt_v1';
  const useMocks = String(process.env.GLOBEVOY_USE_MOCKS || '').toLowerCase() === 'true';
  const requestCurrency = normalizeAgodaCurrency(currency);

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
      body: buildAgodaBody({ destination, checkIn, checkOut, currency: requestCurrency, includeQualityFields: true, adults, children, rooms }),
      _fetchFn
    });
  } catch (error) {
    payload = await requestAgoda({
      endpoint,
      siteId,
      apiKey,
      body: buildAgodaBody({ destination, checkIn, checkOut, currency: requestCurrency, includeQualityFields: false, adults, children, rooms }),
      _fetchFn
    });
  }

  const hotels = rankQualifiedHotels(findHotelArrays(payload).flat().filter(meetsQualityFloor), hotelStyle);
  if (!hotels.length) return fallbackStay(destination, nights, {
    source: isPriceAudit610DEnabled() ? 'fallback-price-audit' : 'fallback',
    reason: 'no-quality-qualified-agoda-results'
  });

  if (isPriceAudit610DEnabled()) {
    const audit = auditAgodaHotelSample({
      hotels,
      requestCurrency,
      nights,
      destination,
      limit: 5
    });
    if (!audit.selected) {
      return fallbackStay(destination, nights, {
        source: 'fallback-price-audit',
        reason: 'no-audited-agoda-rate-accepted',
        priceAudit: {
          auditVersion: audit.auditVersion,
          acceptedCount: audit.acceptedCount,
          rejectedCount: audit.rejectedCount,
          rejectionReasons: audit.rejectionReasons
        }
      });
    }

    const selectedHotel = audit.selected.hotel;
    const selectedAudit = audit.selected.audit;
    const hotelName = selectedHotel.hotelName || selectedHotel.name || null;
    const providerHotel = buildProviderHotel679A(selectedHotel, requestCurrency, selectedAudit);
    return {
      source: 'agoda',
      averageNightlyUsd: Math.round(selectedAudit.averageNightlyUsd),
      totalStayUsd: Math.round(selectedAudit.totalStayUsd),
      hotelName,
      hotelUrl: selectedHotel.landingURL || selectedHotel.url || null,
      sampleSize: audit.acceptedCount,
      qualitySignals: {
        ...buildHotelQualitySignals(selectedHotel, audit.acceptedCount),
        hotelName
      },
      priceEvidence: selectedAudit.priceEvidence,
      priceAudit: {
        auditVersion: audit.auditVersion,
        selectionMethod: 'median-qualified-audited-rate',
        acceptedCount: audit.acceptedCount,
        rejectedCount: audit.rejectedCount,
        rejectionReasons: audit.rejectionReasons
      },
      livePriceVerified: true,
      providerBacked: true,
      bookingTrustVersion: BOOKING_TRUST_VERSION_680A,
      availabilityStatus: 'observed-not-guaranteed',
      ...(providerHotel ? {
        providerHotel,
        hotelId: providerHotel.hotelId,
        hotelImageUrl: providerHotel.imageUrl,
        reviewScore: providerHotel.reviewScore,
        reviewCount: providerHotel.reviewCount,
        starRating: providerHotel.starRating,
        providerRateCurrency: providerHotel.providerCurrency,
        providerNightlyRate: providerHotel.nightlyRate
      } : {}),
      observedAt: new Date().toISOString(),
      requestEvidence: { checkIn, checkOut, currency: requestCurrency, adults: Math.max(1, Number(adults) || 1), children: Math.max(0, Number(children) || 0), rooms: Math.max(1, Number(rooms) || 1), exactStayDates: true },
      providerResponseMode
    };
  }

  const rated = hotels
    .map(hotel => ({ hotel, nightlyProviderCurrency: parseRate(hotel) }))
    .filter(item => item.nightlyProviderCurrency > 0)
    .slice(0, 5);

  if (!rated.length) return fallbackStay(destination, nights);

  const averageNightlyProviderCurrency = rated.reduce((sum, item) => sum + item.nightlyProviderCurrency, 0) / rated.length;
  const first = rated[0].hotel;
  const averageNightlyUsd = convertToUsd(averageNightlyProviderCurrency, requestCurrency);
  const hotelName = first.hotelName || first.name || null;
  const providerHotel = buildProviderHotel679A(first, requestCurrency, null);

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
    },
    livePriceVerified: true,
    providerBacked: true,
    bookingTrustVersion: BOOKING_TRUST_VERSION_680A,
    availabilityStatus: 'observed-not-guaranteed',
    ...(providerHotel ? {
      providerHotel,
      hotelId: providerHotel.hotelId,
      hotelImageUrl: providerHotel.imageUrl,
      reviewScore: providerHotel.reviewScore,
      reviewCount: providerHotel.reviewCount,
      starRating: providerHotel.starRating,
      providerRateCurrency: providerHotel.providerCurrency,
      providerNightlyRate: providerHotel.nightlyRate
    } : {}),
    observedAt: new Date().toISOString(),
    requestEvidence: { checkIn, checkOut, currency: requestCurrency, adults: Math.max(1, Number(adults) || 1), children: Math.max(0, Number(children) || 0), rooms: Math.max(1, Number(rooms) || 1), exactStayDates: true },
    providerResponseMode
  };
}


// GV-CITY-668E: audit-only Agoda coverage probe. This deliberately separates
// raw provider inventory from Globevoy's stricter quality-qualified rate floor.
// When 668E is enabled it searches a bounded, diversified candidate set rather
// than judging an entire city from only the cheapest ten properties.
async function fetchAgodaCoverageProbe({
  destination,
  nights,
  checkIn,
  currency,
  adults = 1,
  children = 0,
  rooms = 1,
  qualityCandidateStrategyCount,
  qualityCandidateMaxResult,
  forceQualityCandidateRetrieval = false,
  _fetchFn
}) {
  const providerResponseMode = _fetchFn ? 'injected-provider-response' : 'live-agoda-api';
  const siteId = process.env.AGODA_SITE_ID;
  const apiKey = process.env.AGODA_API_KEY;
  const endpoint = process.env.AGODA_ENDPOINT || 'https://affiliateapi7643.agoda.com/affiliateservice/lt_v1';
  const useMocks = String(process.env.GLOBEVOY_USE_MOCKS || '').toLowerCase() === 'true';
  const requestCurrency = normalizeAgodaCurrency(currency);
  if (!destination?.agodaCityId || !siteId || !apiKey || useMocks) {
    return {
      supported: false,
      reason: 'provider-unavailable',
      providerResponseMode,
      rawHotelCount: 0,
      pricedHotelCount: 0,
      qualityQualifiedCount: 0,
      qualityQualifiedRate: false,
      candidateRetrievalMode: 'unavailable',
      strategyAttempts: []
    };
  }

  const dates = buildStayDates(checkIn, nights);
  const strategies = buildQualityCandidateStrategies({
    strategyCount: qualityCandidateStrategyCount,
    maxResult: qualityCandidateMaxResult,
    forceQualityCandidateRetrieval
  });
  const uniqueHotels = new Map();
  const strategyAttempts = [];
  let selectedHotel = null;
  let selectedAudit = null;
  let selectedStrategy = null;
  let providerErrorCount = 0;

  for (const strategy of strategies) {
    let payload;
    let qualityFieldsRequested = true;
    let fallbackWithoutQualityFields = false;
    try {
      payload = await requestAgoda({
        endpoint,
        siteId,
        apiKey,
        body: buildAgodaBody({
          destination,
          checkIn: dates.checkIn,
          checkOut: dates.checkOut,
          currency: requestCurrency,
          includeQualityFields: true,
          adults,
          children,
          rooms,
          sortBy: strategy.sortBy,
          maxResult: strategy.maxResult
        }),
        _fetchFn
      });
    } catch (firstError) {
      qualityFieldsRequested = false;
      fallbackWithoutQualityFields = true;
      try {
        payload = await requestAgoda({
          endpoint,
          siteId,
          apiKey,
          body: buildAgodaBody({
            destination,
            checkIn: dates.checkIn,
            checkOut: dates.checkOut,
            currency: requestCurrency,
            includeQualityFields: false,
            adults,
            children,
            rooms,
            sortBy: strategy.sortBy,
            maxResult: strategy.maxResult
          }),
          _fetchFn
        });
      } catch (secondError) {
        providerErrorCount += 1;
        strategyAttempts.push({
          strategyId: strategy.id,
          sortBy: strategy.sortBy,
          maxResult: strategy.maxResult,
          status: 'provider-error',
          error: secondError.message,
          firstError: firstError.message,
          qualityFieldsRequested,
          fallbackWithoutQualityFields
        });
        continue;
      }
    }

    const strategyHotels = findHotelArrays(payload).flat().filter(Boolean);
    for (const hotel of strategyHotels) if (!uniqueHotels.has(hotelKey(hotel))) uniqueHotels.set(hotelKey(hotel), hotel);
    const allSeen = [...uniqueHotels.values()];
    const pricedSeen = allSeen.filter(hotel => parseRate(hotel) > 0);
    const qualitySeen = pricedSeen.filter(meetsQualityFloor);
    const qualityRejections = {};
    for (const hotel of allSeen) addReasonCounts(qualityRejections, qualityRejectionReasons(hotel));

    let audit = null;
    let acceptedCount = qualitySeen.length;
    let priceAuditRejections = {};
    if (qualitySeen.length && isPriceAudit610DEnabled()) {
      audit = auditAgodaHotelSample({
        hotels: qualitySeen,
        requestCurrency,
        nights,
        destination,
        limit: 10
      });
      selectedHotel = audit.selected?.hotel || null;
      selectedAudit = audit.selected?.audit || null;
      acceptedCount = Number(audit.acceptedCount || 0);
      priceAuditRejections = audit.rejectionReasons || {};
    } else if (qualitySeen.length) {
      selectedHotel = qualitySeen[0];
      selectedAudit = null;
    }

    const rate = selectedAudit?.averageNightlyUsd || (selectedHotel ? convertToUsd(parseRate(selectedHotel), requestCurrency) : 0);
    const qualified = Boolean(selectedHotel && Number(rate) > 0);
    const combinedRejections = { ...qualityRejections };
    for (const [reason, count] of Object.entries(priceAuditRejections)) combinedRejections[reason] = (combinedRejections[reason] || 0) + Number(count || 0);
    strategyAttempts.push({
      strategyId: strategy.id,
      sortBy: strategy.sortBy,
      maxResult: strategy.maxResult,
      status: qualified ? 'quality-qualified-live-rate' : (pricedSeen.length ? 'live-inventory-unqualified' : 'no-live-rate'),
      qualityFieldsRequested,
      fallbackWithoutQualityFields,
      rawHotelCount: allSeen.length,
      pricedHotelCount: pricedSeen.length,
      structuralQualityCount: qualitySeen.length,
      qualityQualifiedCount: acceptedCount,
      rejectionReasons: combinedRejections
    });
    if (qualified) {
      selectedStrategy = strategy;
      break;
    }
    selectedHotel = null;
    selectedAudit = null;
  }

  const allHotels = [...uniqueHotels.values()];
  const pricedHotels = allHotels.filter(hotel => parseRate(hotel) > 0);
  const qualityHotels = pricedHotels.filter(meetsQualityFloor);
  const aggregateRejectionReasons = {};
  for (const hotel of allHotels) addReasonCounts(aggregateRejectionReasons, qualityRejectionReasons(hotel));
  let aggregateAudit = null;
  if (qualityHotels.length && isPriceAudit610DEnabled()) {
    aggregateAudit = auditAgodaHotelSample({
      hotels: qualityHotels,
      requestCurrency,
      nights,
      destination,
      limit: 10
    });
    for (const [reason, count] of Object.entries(aggregateAudit.rejectionReasons || {})) {
      aggregateRejectionReasons[reason] = (aggregateRejectionReasons[reason] || 0) + Number(count || 0);
    }
    if (!selectedHotel && aggregateAudit.selected) {
      selectedHotel = aggregateAudit.selected.hotel;
      selectedAudit = aggregateAudit.selected.audit;
      selectedStrategy = { id: 'aggregate-candidate-pool', sortBy: null, maxResult: allHotels.length };
    }
  }

  const rate = selectedAudit?.averageNightlyUsd || (selectedHotel ? convertToUsd(parseRate(selectedHotel), requestCurrency) : 0);
  const acceptedCount = aggregateAudit ? Number(aggregateAudit.acceptedCount || 0) : qualityHotels.length;
  return {
    supported: providerErrorCount < strategies.length || allHotels.length > 0,
    reason: providerErrorCount === strategies.length && !allHotels.length ? 'provider-error' : null,
    providerResponseMode,
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    candidateRetrievalMode: qualityCandidateRetrievalEnabled() || forceQualityCandidateRetrieval
      ? 'quality-diversified-668e'
      : 'legacy-price-asc',
    selectedStrategy: selectedStrategy ? {
      strategyId: selectedStrategy.id,
      sortBy: selectedStrategy.sortBy,
      maxResult: selectedStrategy.maxResult
    } : null,
    strategiesRequested: strategies.length,
    strategyAttempts,
    rawHotelCount: allHotels.length,
    pricedHotelCount: pricedHotels.length,
    structuralQualityCount: qualityHotels.length,
    qualityQualifiedCount: acceptedCount,
    rejectedCount: Math.max(0, allHotels.length - acceptedCount),
    rejectionReasons: aggregateRejectionReasons,
    inventoryObserved: pricedHotels.length > 0,
    qualityQualifiedRate: Boolean(selectedHotel && Number(rate) > 0),
    sample: selectedHotel ? {
      averageNightlyUsd: Math.round(Number(rate) || 0) || null,
      totalStayUsd: Math.round((Number(rate) || 0) * Math.max(1, Number(nights) || 1)) || null,
      hotelName: selectedHotel.hotelName || selectedHotel.name || null,
      hotelUrlPresent: Boolean(selectedHotel.landingURL || selectedHotel.url),
      rating: parseReviewScore(selectedHotel),
      stars: parseStarRating(selectedHotel),
      reviewCount: parseReviewCount(selectedHotel)
    } : null
  };
}

module.exports = {
  AGODA_PROVIDER_STAY_VERSION_679A,
  AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1,
  BOOKING_TRUST_VERSION_680A,
  providerStayIntegration679AEnabled,
  priceLinkIntegrity679AR1Enabled,
  classifyAgodaLandingUrl679AR1,
  buildProviderHotel679A,
  fetchAgodaStayEstimate,
  fetchAgodaCoverageProbe,
  buildStayDates,
  fallbackStay,
  normalizeAgodaCurrency,
  SUPPORTED_AGODA_CURRENCIES,
  DEFAULT_AGODA_CURRENCY,
  qualityCandidateRetrievalEnabled,
  buildQualityCandidateStrategies,
  qualityRejectionReasons,
  hotelQualityScore,
  rankQualifiedHotels,
  AGODA_QUALITY_STRATEGIES,
  isPriceAudit610DEnabled,
  PRICE_AUDIT_VERSION
};
