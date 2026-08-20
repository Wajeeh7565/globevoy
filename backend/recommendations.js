const { resolveOrigin, getDestination, fallbackFlightCandidates, is500CityDiscoveryEnabled } = require('./data/destination-meta');
const { PERSONAL_EXPENSE_RESERVE_PERCENT, buildBudgetReserve } = require('./data/daily-budget');
const { fetchTravelpayoutsCandidates, convertFlightValueToUsd, buildAviasalesLink } = require('./services/travelpayouts');
const { fetchFlexDateWindows, isSupportedRoute, flexWindowsSourceWording } = require('./services/flexible-dates');
const { fetchAgodaStayEstimate } = require('./services/agoda');
const { getCityIntelligence, groupRoleCounts, normalizePreference } = require('./city-intelligence');
const {
  buildCompositeScore,
  calculateHotelValueAndEvidence,
  scoreBudgetFitAndValue,
  evaluateEligibility,
  selectRankedRecommendations
} = require('./recommendation-quality');
const {
  buildDisplayBudget,
  attachRecommendationPresentation,
  presentationPolicy
} = require('./budget-presentation');

const DEFAULT_LIMIT = 30;
const INVALID_ORIGIN_MESSAGE = 'Please enter a supported origin city or airport.';

class InvalidOriginError extends Error {
  constructor() {
    super(INVALID_ORIGIN_MESSAGE);
    this.name = 'InvalidOriginError';
    this.code = 'INVALID_ORIGIN';
    this.statusCode = 400;
  }
}

class RecommendationValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RecommendationValidationError';
    this.code = code;
    this.statusCode = 400;
    this.details = details;
  }
}

function buildValidationErrorResponse(error) {
  return {
    ok: false,
    error: {
      code: error.code || 'INVALID_REQUEST',
      message: error.message || 'The recommendation request is invalid.',
      ...(error.details && Object.keys(error.details).length ? { details: error.details } : {})
    },
    recommendations: []
  };
}

function isRecommendationValidationError(error) {
  return Boolean(error && (error instanceof RecommendationValidationError || error.statusCode === 400));
}

function buildInvalidOriginResponse() {
  return {
    ok: false,
    error: {
      code: 'INVALID_ORIGIN',
      message: INVALID_ORIGIN_MESSAGE
    },
    recommendations: []
  };
}

function isInvalidOriginError(error) {
  return Boolean(error && (error.code === 'INVALID_ORIGIN' || error instanceof InvalidOriginError));
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const raw = String(value).trim();
    if (raw) return raw;
  }
  return '';
}

function requireOrigin(query = {}) {
  const requestedOrigin = firstNonBlank(query.origin, query.originCode);
  const origin = resolveOrigin(requestedOrigin);
  if (!origin) throw new InvalidOriginError();
  return origin;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNights(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 5;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 14) {
    throw new RecommendationValidationError(
      'UNSUPPORTED_DURATION',
      'Trip duration must be a whole number from 2 to 14 nights.',
      { requestedNights: value, supportedMinimumNights: 2, supportedMaximumNights: 14 }
    );
  }
  return parsed;
}

function normalizeBudgetUsd(query) {
  if (query.budgetUsd) return Math.max(1, number(query.budgetUsd, 1500));
  const budget = number(query.budget, 1500);
  const currency = String(query.currency || 'USD').toUpperCase();
  if (currency === 'CAD') return budget * number(process.env.CAD_TO_USD, 0.735);
  if (currency === 'AUD') return budget * number(process.env.AUD_TO_USD, 0.66);
  if (currency === 'EUR') return budget * 1.08;
  if (currency === 'GBP') return budget * 1.27;
  return budget;
}

function normalizeNearMissUsd() {
  // GV-REC-510C: near misses are excluded from the normal ranked pool so the
  // full 10% personal-expense reserve remains protected.
  return 0;
}

function normalizeMonth(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  return target.toISOString().slice(0, 7);
}

function budgetFitScore(total, budget) {
  // Compatibility field only: use the same smooth GV-REC-510C value curve as
  // the weighted component so the retired 96-point cheap-result plateau does
  // not survive anywhere in the public recommendation response.
  return Math.round(scoreBudgetFitAndValue({
    estimatedFlightAndStayTotal: total,
    usableTripBudget: budget
  }).rawScore);
}

function budgetFitLabel(total, budget) {
  const safeBudget = Math.max(1, Number(budget) || 1);
  const use = total / safeBudget;
  if (use <= 0.90) return 'Good fit';
  if (use <= 1.00) return 'Tight';
  return 'Over budget';
}

function budgetFitStatus(label) {
  if (label === 'Good fit') return 'good';
  if (label === 'Tight') return 'tight';
  return 'over';
}

function formatBestDepartureDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const datePrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (datePrefix) {
    const parsedPrefix = new Date(`${datePrefix[1]}T00:00:00Z`);
    if (!Number.isNaN(parsedPrefix.getTime()) && parsedPrefix.toISOString().slice(0, 10) === datePrefix[1]) {
      return datePrefix[1];
    }
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeRequestedDate(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = formatBestDepartureDate(raw);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new RecommendationValidationError(
      'INVALID_DATE',
      `${fieldName} must use YYYY-MM-DD format.`,
      { field: fieldName, value: raw }
    );
  }
  return normalized;
}

function buildFlexibleDateMetadata(flight, flexDateWindows) {
  const source = String(flight?.source || '').toLowerCase();
  const bestDepartureDate = formatBestDepartureDate(flight?.departureAt);

  if (flexDateWindows && flexDateWindows.windowCount > 0) {
    const best = flexDateWindows.windows[0];
    return {
      bestDepartureDate: best.departure_at || bestDepartureDate,
      dateStrategy: 'provider-rest-round-trip-observation',
      flexibleDateSource: `travelpayouts-${flexDateWindows.endpointUsed || 'rest'}`
    };
  }
  if (source === 'travelpayouts') {
    return {
      bestDepartureDate,
      dateStrategy: 'monthly-one-way-cheapest-returned',
      flexibleDateSource: 'travelpayouts-graphql-prices-one-way'
    };
  }
  return {
    bestDepartureDate: null,
    dateStrategy: 'fallback-route-model',
    flexibleDateSource: 'fallback-route-model'
  };
}

function buildFlightBudgetMetadata(flightUsd, budgetUsd) {
  const flight = number(flightUsd, 0);
  const budget = number(budgetUsd, 0);
  if (!Number.isFinite(flight) || !Number.isFinite(budget) || flight <= 0 || budget <= 0) {
    return {
      flightBudgetShare: null,
      flightBudgetStatus: 'unknown'
    };
  }
  const flightBudgetShare = Number((flight / budget).toFixed(3));
  let flightBudgetStatus = 'expensive-flight';
  if (flightBudgetShare <= 0.40) flightBudgetStatus = 'within-target';
  else if (flightBudgetShare <= 0.50) flightBudgetStatus = 'near-target';
  return {
    flightBudgetShare,
    flightBudgetStatus
  };
}

function positiveNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hotelBudgetStatusFromShare(hotelBudgetShare) {
  if (hotelBudgetShare === null || hotelBudgetShare === undefined || !Number.isFinite(Number(hotelBudgetShare))) {
    return 'unknown';
  }
  if (hotelBudgetShare <= 0.30) return 'comfortable';
  if (hotelBudgetShare <= 0.45) return 'reasonable';
  if (hotelBudgetShare <= 0.60) return 'tight';
  return 'expensive-stay';
}

function normalizeHotelQualitySignals(stay = {}) {
  const raw = stay.qualitySignals || {};
  return {
    rating: positiveNumberOrNull(raw.rating),
    stars: positiveNumberOrNull(raw.stars),
    reviewCount: positiveNumberOrNull(raw.reviewCount),
    sampleSize: Math.max(0, Math.round(number(raw.sampleSize ?? stay.sampleSize, 0))),
    hotelName: raw.hotelName || stay.hotelName || null
  };
}

function hotelSourceConfidenceFor(source) {
  const normalized = String(source || '').toLowerCase();
  if (normalized === 'agoda') return 'live-agoda';
  if (normalized.includes('fallback-after')) return 'fallback-after-error';
  if (normalized.includes('fallback-price-audit')) return 'fallback-price-audit';
  if (normalized.includes('fallback')) return 'fallback-estimate';
  return 'unknown';
}

function stayStrategyFor(stay = {}) {
  const confidence = hotelSourceConfidenceFor(stay.source);
  if (confidence === 'live-agoda' && stay.priceAudit?.selectionMethod) {
    return 'agoda-price-audited-median-qualified-rate';
  }
  if (confidence === 'live-agoda') return 'agoda-quality-filtered-price-average';
  if (confidence === 'fallback-after-error') return 'fallback-after-agoda-error';
  if (confidence === 'fallback-price-audit') return 'fallback-after-price-audit-rejection';
  if (confidence === 'fallback-estimate') return 'fallback-nightly-destination-average';
  return 'unknown';
}

function uniqueWarnings(warnings) {
  return Array.from(new Set(warnings.filter(Boolean)));
}

function buildHotelFitReason({ sourceConfidence, hotelBudgetStatus, nights }) {
  const nightLabel = `${nights} night${Number(nights) === 1 ? '' : 's'}`;
  if (hotelBudgetStatus === 'unknown') {
    return 'Stay budget fit is unknown because the hotel estimate or budget was unavailable.';
  }
  if (sourceConfidence === 'live-agoda') {
    return `Live Agoda stay estimate is ${hotelBudgetStatus.replace('-', ' ')} for ${nightLabel}.`;
  }
  if (sourceConfidence === 'fallback-after-error') {
    return `Agoda stay data was unavailable, so a fallback stay estimate is used for ${nightLabel}.`;
  }
  if (sourceConfidence === 'fallback-price-audit') {
    return `The live hotel rate did not pass Globevoy's price-unit audit, so a labelled planning estimate is used for ${nightLabel}.`;
  }
  return `Fallback stay estimate is usable for budget math, but live hotel quality data was not available.`;
}

function buildHotelScoringMetadata({ stay = {}, destination = {}, budgetUsd, nights }) {
  const stayTotal = number(stay.totalStayUsd, 0);
  const budget = number(budgetUsd, 0);
  const hotelBudgetShare = stayTotal > 0 && budget > 0
    ? Number((stayTotal / budget).toFixed(3))
    : null;
  const hotelBudgetStatus = hotelBudgetStatusFromShare(hotelBudgetShare);
  const hotelSourceConfidence = hotelSourceConfidenceFor(stay.source);
  const hotelQualitySignals = normalizeHotelQualitySignals(stay);
  const stayStrategy = stayStrategyFor(stay);
  const warnings = [];

  if (hotelSourceConfidence === 'fallback-estimate') warnings.push('fallback-stay-estimate');
  if (hotelSourceConfidence === 'fallback-after-error') warnings.push('fallback-after-agoda-error', 'fallback-stay-estimate');
  if (hotelSourceConfidence === 'fallback-price-audit') warnings.push('fallback-after-price-audit-rejection', 'fallback-stay-estimate');
  if (stay.priceEvidence?.warnings) warnings.push(...stay.priceEvidence.warnings);
  if (hotelQualitySignals.sampleSize > 0 && hotelQualitySignals.sampleSize < 3) warnings.push('low-sample-size');
  if (!stay.hotelUrl) warnings.push('no-agoda-link');
  if (hotelQualitySignals.rating === null) warnings.push('rating-unavailable');
  if (hotelQualitySignals.reviewCount === null) warnings.push('review-count-unavailable');
  if (hotelQualitySignals.stars === null) warnings.push('star-rating-unavailable');
  if (hotelBudgetStatus === 'tight' || hotelBudgetStatus === 'expensive-stay') warnings.push('hotel-budget-tight');
  warnings.push('location-quality-unverified', 'cleanliness-evidence-unavailable', 'availability-not-guaranteed');

  const interim = {
    hotelBudgetShare,
    hotelBudgetStatus,
    hotelSourceConfidence,
    hotelQualitySignals
  };
  const evidenceScore = calculateHotelValueAndEvidence(interim);

  return {
    hotelScore: evidenceScore.rawScore,
    hotelBudgetShare,
    hotelBudgetStatus,
    hotelSourceConfidence,
    hotelQualitySignals,
    hotelFitReason: buildHotelFitReason({ sourceConfidence: hotelSourceConfidence, hotelBudgetStatus, nights }),
    hotelWarnings: uniqueWarnings([...warnings, ...evidenceScore.missing]),
    hotelEvidenceTrace: evidenceScore.evidence,
    stayStrategy,
    hotelPriceEvidence: stay.priceEvidence || null,
    hotelPriceAudit: stay.priceAudit || null
  };
}

function candidateDestinationCode(candidate) {
  return String(candidate?.destination_city_iata || candidate?.destination || candidate?.code || '')
    .trim()
    .toUpperCase();
}

function candidateDestinationKey(candidate) {
  return String(candidate?.destination_city_id || candidateDestinationCode(candidate)).trim().toLowerCase();
}


function fillWithCuratedCandidates(candidates, originCode, targetLimit) {
  const merged = [];
  const seenCodes = new Set();
  const seenUnidentifiedCodes = new Set();
  const seenIds = new Set();

  function add(candidate, fallback = false) {
    const code = candidateDestinationCode(candidate);
    const id = String(candidate?.destination_city_id || '').trim().toLowerCase();
    if (!code && !id) return;
    if (id) {
      if (seenIds.has(id)) return;
      // A provider row without a registry ID already represents this live city.
      // Keep it and skip its later fallback duplicate. Distinct registry cities
      // may legitimately share one metro/location code (for example RDU), so
      // identified fallback rows are otherwise deduped by city ID, not code.
      if (code && seenUnidentifiedCodes.has(code)) return;
      seenIds.add(id);
      if (code) seenCodes.add(code);
    } else {
      if (seenCodes.has(code)) return;
      seenCodes.add(code);
      seenUnidentifiedCodes.add(code);
    }
    merged.push(fallback ? { ...candidate, source: 'fallback-route-model' } : candidate);
  }

  (Array.isArray(candidates) ? candidates : []).forEach(candidate => add(candidate, false));
  fallbackFlightCandidates(originCode).forEach(candidate => add(candidate, true));

  // Keep the whole deduped live + fallback pool until after buildRecommendation
  // removes provider-only destinations without Globevoy metadata. Slicing here
  // lets live provider rows with no metadata push valid production fallback
  // destinations out of the pool, which undercounts high-budget Explore runs.
  return merged;
}

/**
 * Build a normalized bookingLinks object so the frontend doesn't have to
 * reconstruct partner attribution from raw URLs. Backwards-compatible: the
 * original partnerUrl / hotelUrl fields are still emitted alongside this.
 *
 * Partner name is inferred from the `source` string of each service. We
 * intentionally only label partners we actually contracted with — anything
 * else falls back to a generic "Partner site" label.
 */
function inferFlightPartner(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('travelpayouts') || s.includes('aviasales')) return 'Aviasales';
  if (s.startsWith('mock')) return 'Aviasales';
  if (s.includes('fallback')) return 'Aviasales';
  return 'Partner site';
}

function inferHotelPartner(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('agoda')) return 'Agoda';
  if (s.includes('fallback')) return 'Agoda';
  return 'Partner site';
}

function buildBookingLinks(flight, stay) {
  const out = { flight: null, hotel: null };
  if (flight && flight.bookingLink) {
    out.flight = {
      url: flight.bookingLink,
      partner: inferFlightPartner(flight.source),
      kind: 'flight'
    };
  }
  if (stay && stay.hotelUrl) {
    out.hotel = {
      url: stay.hotelUrl,
      partner: inferHotelPartner(stay.source),
      kind: 'hotel',
      hotelName: stay.hotelName || null
    };
  }
  return out;
}

function calculateFullTripCost({ flightUsd, stayUsd, dailySpendUsd, activitiesLocalUsd, budgetUsd }) {
  const flight = Math.round(number(flightUsd, 0));
  const lodging = Math.round(number(stayUsd, 0));
  const budget = buildBudgetReserve(budgetUsd);
  const estimatedFlightAndStayTotal = Math.round(flight + lodging);
  const remainingUsableBudget = Math.round(budget.usableTripBudget - estimatedFlightAndStayTotal);
  const score = budgetFitScore(estimatedFlightAndStayTotal, budget.usableTripBudget);
  const fitLabel = budgetFitLabel(estimatedFlightAndStayTotal, budget.usableTripBudget);

  return {
    ...budget,
    flight,
    lodging,
    flightEstimate: flight,
    accommodationEstimate: lodging,
    estimatedFlightAndStayTotal,
    remainingUsableBudget,
    affordabilityStatus: remainingUsableBudget >= 0 ? 'affordable' : 'over-usable-budget',
    // Compatibility aliases. Personal/variable expenses are no longer estimated.
    dailySpend: 0,
    activitiesLocal: 0,
    total: estimatedFlightAndStayTotal,
    budgetBuffer: remainingUsableBudget,
    budgetUse: Number((estimatedFlightAndStayTotal / Math.max(1, budget.usableTripBudget)).toFixed(3)),
    score,
    budgetFitLabel: fitLabel,
    budgetFitStatus: budgetFitStatus(fitLabel),
    deprecatedFields: {
      dailySpend: 'Deprecated: always 0; personal expenses are not estimated.',
      activitiesLocal: 'Deprecated: always 0; activities are not estimated.',
      dailyBudget: 'Deprecated: null; food, local travel, shopping, and personal spending are not estimated.'
    }
  };
}

function normalizeFlight(candidate, originCode, destinationCode, dateOptions = {}) {
  const rawValue = number(candidate.normalizedFlightUsd || candidate.value || 0);
  const flightUsd = candidate.normalizedFlightUsd
    ? rawValue
    : convertFlightValueToUsd(rawValue, candidate.normalizedCurrency || process.env.TRAVELPAYOUTS_PRICE_CURRENCY);
  const source = candidate.source || 'travelpayouts';
  const isFallbackSource = /^(mock|fallback)/i.test(source);

  return {
    source,
    flightUsd: Math.round(flightUsd),
    departureAt: candidate.departure_at || null,
    duration: candidate.trip_duration || null,
    bookingLink: candidate.bookingLink || buildAviasalesLink(
      isFallbackSource ? null : candidate.ticket_link,
      originCode,
      destinationCode,
      {
        ...dateOptions,
        bestDepartureDate: candidate.bestDepartureDate || candidate.departure_at,
        bestReturnDate: candidate.bestReturnDate || candidate.return_at || candidate.returnDate
      }
    ),
    rawValue: candidate.value || null
  };
}

function buildWhy({ destination, cost, flight, stay, nights, scoreTrace, preference }) {
  const remaining = Math.max(0, Math.round(cost.remainingUsableBudget));
  const preferenceText = preference
    ? ` The ${preference} preference uses canonical city-theme evidence only.`
    : ' No preference bonus was applied.';
  const evidenceText = String(flight.source || '').includes('fallback') || String(flight.source || '').includes('mock') || String(stay.source || '').includes('fallback')
    ? ' At least one price is a labelled planning fallback, not verified availability.'
    : ' Provider evidence is used, but final price and availability still require partner confirmation.';
  return `${destination.city} fits the protected budget because the flight and stay estimate is about $${Math.round(cost.estimatedFlightAndStayTotal)} ($${Math.round(flight.flightUsd)} flight and $${Math.round(stay.totalStayUsd)} stay for ${nights} nights), leaving about $${remaining} inside the 90% trip-planning budget. The full $${Math.round(cost.reserveAmount)} personal-expense reserve remains untouched. Recommendation score: ${scoreTrace ? scoreTrace.total : 'not scored'}.${preferenceText}${evidenceText}`;
}

async function buildRecommendation({ candidate, origin, originDestination, budgetUsd, nights, month, currency, preference, departureDate, returnDate }) {
  const destinationRef = candidate.destination_city_id || candidate.destination_city_iata || candidate.destination || candidate.code;
  const destination = getDestination(destinationRef);
  if (!destination) return null;
  const intelligence = getCityIntelligence(destination);

  const flight = normalizeFlight(candidate, origin.code, destination.code, {
    departureDate,
    returnDate,
    month,
    nights
  });
  if (!flight.flightUsd) flight.flightUsd = destination.fallbackFlightUsd;

  // Fetch REST round-trip windows for the three supported pilot routes only.
  const flexDatesEnabled = String(process.env.GLOBEVOY_FLEX_DATES || '').toLowerCase() === 'true';
  let flexDateWindows = null;
  if (flexDatesEnabled && isSupportedRoute(origin.code, destination.code)) {
    try {
      const flexResult = await fetchFlexDateWindows({ originCode: origin.code, destCode: destination.code, month });
      if (flexResult.supported && flexResult.windowCount > 0) {
        flexDateWindows = flexResult;
        if (!flight.departureAt && flexResult.windows[0]?.departure_at) flight.departureAt = flexResult.windows[0].departure_at;
      }
    } catch {
      // A failed optional flex-window lookup never changes core eligibility.
    }
  }

  let stay;
  try {
    stay = await fetchAgodaStayEstimate({ destination, nights, month, currency });
  } catch (error) {
    stay = {
      source: 'fallback-after-agoda-error',
      averageNightlyUsd: destination.fallbackNightlyUsd,
      totalStayUsd: Math.round(destination.fallbackNightlyUsd * nights),
      hotelName: null,
      hotelUrl: null,
      sampleSize: 0,
      qualitySignals: { rating: null, stars: null, reviewCount: null, sampleSize: 0, hotelName: null },
      error: error.message
    };
  }

  const cost = calculateFullTripCost({
    flightUsd: flight.flightUsd,
    stayUsd: stay.totalStayUsd,
    budgetUsd
  });
  const flexibleDateMetadata = buildFlexibleDateMetadata(flight, flexDateWindows);
  const flightBudgetMetadata = buildFlightBudgetMetadata(flight.flightUsd, cost.usableTripBudget);
  const hotelMetadata = buildHotelScoringMetadata({
    stay,
    destination,
    budgetUsd: cost.usableTripBudget,
    nights
  });
  const eligibility = evaluateEligibility({
    destination,
    originDestination,
    intelligence,
    cost,
    flight,
    stay,
    nights,
    departureDate,
    returnDate
  });

  // Hard rules are resolved before any quality score is calculated.
  const scoreTrace = eligibility.eligible
    ? buildCompositeScore({
        destination,
        originDestination,
        intelligence,
        cost,
        flight,
        stay,
        hotelMetadata,
        preference,
        nights,
        month,
        departureDate
      })
    : null;
  const recommendationScore = scoreTrace ? scoreTrace.total : null;
  const whyItFits = buildWhy({ destination, cost, flight, stay, nights, scoreTrace, preference });
  const tripDays = nights + 1;

  return {
    id: is500CityDiscoveryEnabled() && destination.globevoyCityId
      ? destination.globevoyCityId
      : destination.city.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    ...(is500CityDiscoveryEnabled() && destination.globevoyCityId ? { cityId: destination.globevoyCityId } : {}),
    canonicalCityId: intelligence.canonicalCityId,
    groupRole: intelligence.groupRole,
    metroClusterId: intelligence.metroClusterId,
    gatewayClusterId: intelligence.gatewayClusterId,
    countryKey: intelligence.countryKey,
    city: destination.city,
    country: destination.country,
    code: destination.code,
    region: destination.region,
    ...(is500CityDiscoveryEnabled()
      ? {
          publicDiscoveryEligible: true,
          providerAvailability: destination.providerAvailability || { flight: Boolean(destination.code), hotel: Boolean(destination.agodaCityId) }
        }
      : {
          frontendFallbackEligible: destination.frontendFallbackEligible === true
        }),
    lat: destination.lat,
    lng: destination.lng,
    img: destination.img,
    theme: destination.theme,
    days: destination.days,
    season: destination.season,
    seasonInsight: destination.seasonInsight,
    tripDays,
    nights,
    requestedDepartureDate: departureDate,
    requestedReturnDate: returnDate,
    recommendedMinNights: intelligence.recommendedMinNights,
    recommendedMaxNights: intelligence.recommendedMaxNights,
    durationEvidenceSource: intelligence.durationSource,
    bestDepartureDate: flexibleDateMetadata.bestDepartureDate,
    dateStrategy: flexibleDateMetadata.dateStrategy,
    flexibleDateSource: flexibleDateMetadata.flexibleDateSource,
    flightBudgetShare: flightBudgetMetadata.flightBudgetShare,
    flightBudgetStatus: flightBudgetMetadata.flightBudgetStatus,
    hotelScore: hotelMetadata.hotelScore,
    hotelBudgetShare: hotelMetadata.hotelBudgetShare,
    hotelBudgetStatus: hotelMetadata.hotelBudgetStatus,
    hotelSourceConfidence: hotelMetadata.hotelSourceConfidence,
    hotelQualitySignals: hotelMetadata.hotelQualitySignals,
    hotelFitReason: hotelMetadata.hotelFitReason,
    hotelWarnings: hotelMetadata.hotelWarnings,
    hotelEvidenceTrace: hotelMetadata.hotelEvidenceTrace,
    stayStrategy: hotelMetadata.stayStrategy,
    ...(hotelMetadata.hotelPriceEvidence ? { hotelPriceEvidence: hotelMetadata.hotelPriceEvidence } : {}),
    ...(hotelMetadata.hotelPriceAudit ? { hotelPriceAudit: hotelMetadata.hotelPriceAudit } : {}),
    flight: cost.flight,
    lodging: cost.lodging,
    totalBudget: cost.totalBudget,
    reservePercent: cost.reservePercent,
    reserveAmount: cost.reserveAmount,
    usableTripBudget: cost.usableTripBudget,
    flightEstimate: cost.flightEstimate,
    accommodationEstimate: cost.accommodationEstimate,
    estimatedFlightAndStayTotal: cost.estimatedFlightAndStayTotal,
    remainingUsableBudget: cost.remainingUsableBudget,
    affordabilityStatus: cost.affordabilityStatus,
    deprecatedFields: cost.deprecatedFields,
    dailySpend: cost.dailySpend,
    activitiesLocal: cost.activitiesLocal,
    dailyBudget: null,
    total: cost.total,
    budgetBuffer: cost.budgetBuffer,
    budgetUse: cost.budgetUse,
    budgetFitScore: cost.score,
    budgetFitLabel: cost.budgetFitLabel,
    budgetFitStatus: cost.budgetFitStatus,
    score: recommendationScore,
    recommendationScore,
    scoreTrace,
    rankingReasonCode: scoreTrace?.reasonCode || null,
    eligibility,
    whyItFits,
    travelTime: destination.travelTime,
    walkability: destination.walkability,
    visaNote: destination.visaNote,
    weather: destination.weather,
    localCost: destination.localCost,
    partnerUrl: flight.bookingLink,
    hotelUrl: stay.hotelUrl,
    bookingLinks: buildBookingLinks(flight, stay),
    dataSources: {
      flight: flight.source,
      stay: stay.source,
      cityIntelligence: intelligence.intelligenceRecordFound ? 'canonical-city-intelligence-500' : intelligence.themeSource,
      personalExpenses: 'not-estimated-reserved-budget-only'
    },
    flexDateWindows: flexDateWindows
      ? {
          windowCount: flexDateWindows.windowCount,
          sourceWording: flexWindowsSourceWording(flexDateWindows.windowCount),
          endpointUsed: flexDateWindows.endpointUsed,
          currency: flexDateWindows.currency,
          cacheHit: flexDateWindows.cacheHit,
          windows: flexDateWindows.windows
        }
      : null
  };
}

async function getRecommendations(query = {}) {
  const origin = requireOrigin(query);
  const originDestination = getDestination(origin.destinationCode || origin.code);
  const budgetUsd = normalizeBudgetUsd(query);
  const requestedNearMissUsd = Math.max(0, Math.min(500, Math.round(number(query.nearMissUsd, 0))));
  const nearMissUsd = normalizeNearMissUsd(query);
  const budgetModel = buildBudgetReserve(budgetUsd);
  const budgetCeilingUsd = budgetModel.usableTripBudget;
  const nights = normalizeNights(firstNonBlank(query.nights, query.tripLength));
  const month = normalizeMonth(query.month || query.departMonth);
  const departureDate = normalizeRequestedDate(firstNonBlank(query.departureDate, query.departDate), 'departureDate');
  const returnDate = normalizeRequestedDate(firstNonBlank(query.returnDate, query.returningDate), 'returnDate');
  if (departureDate && returnDate && returnDate <= departureDate) {
    throw new RecommendationValidationError(
      'INVALID_DATE_RANGE',
      'returnDate must be after departureDate.',
      { departureDate, returnDate }
    );
  }

  const requestedStyle = String(firstNonBlank(query.style, query.preference) || 'any').trim().toLowerCase();
  const preference = normalizePreference(requestedStyle);
  const unsupportedPreference = requestedStyle !== 'any' && requestedStyle !== 'none' && !preference;
  const maxLimit = is500CityDiscoveryEnabled() ? 500 : 250;
  const limit = Math.max(5, Math.min(maxLimit, Math.round(number(query.limit, DEFAULT_LIMIT))));

  let flightResult;
  let flightError = null;
  try {
    flightResult = await fetchTravelpayoutsCandidates({
      originCode: origin.code,
      month,
      limit
    });
  } catch (error) {
    flightError = error.message || String(error);
    flightResult = {
      source: 'fallback-after-travelpayouts-error',
      candidates: fallbackFlightCandidates(origin.code)
    };
  }

  const candidatePool = fillWithCuratedCandidates(flightResult.candidates, origin.code, limit);
  const built = await Promise.all(
    candidatePool.map(candidate => buildRecommendation({
      candidate,
      origin,
      originDestination,
      budgetUsd,
      nights,
      month,
      currency: query.currency,
      preference,
      departureDate,
      returnDate
    }))
  );

  const candidatesAsked = flightResult.candidates.length;
  const candidatesAfterCuratedFill = candidatePool.length;
  const builtNonNull = built.filter(Boolean).length;
  const droppedNoMetadata = candidatesAfterCuratedFill - builtNonNull;
  const eligibilityFailures = {};
  for (const item of built.filter(Boolean)) {
    for (const reason of item.eligibility.failed) eligibilityFailures[reason] = (eligibilityFailures[reason] || 0) + 1;
  }
  const eligible = built.filter(item => item?.eligibility?.eligible);
  const selected = selectRankedRecommendations(eligible, {
    limit,
    preferenceActive: Boolean(preference)
  });
  const recommendations = selected.recommendations.map(item => attachRecommendationPresentation(item, query));

  const isMock = flightResult.source.startsWith('mock');
  const isFallback = flightResult.source.startsWith('fallback');
  const responseWarnings = [];
  if (flightError) responseWarnings.push(`Travelpayouts unavailable: ${flightError}`);
  if (requestedNearMissUsd > 0) responseWarnings.push('near-miss-excluded-from-normal-ranked-pool');
  if (unsupportedPreference) responseWarnings.push('unsupported-preference-treated-as-neutral');

  return {
    ok: true,
    mode: isMock ? 'mock' : (isFallback ? 'fallback' : 'live'),
    version: '11.13.0-gv-data-500c',
    servedAt: new Date().toISOString(),
    requested: {
      origin,
      budgetUsd,
      totalBudget: budgetModel.totalBudget,
      reservePercent: budgetModel.reservePercent,
      reserveAmount: budgetModel.reserveAmount,
      usableTripBudget: budgetModel.usableTripBudget,
      nearMissRequestedUsd: requestedNearMissUsd,
      nearMissUsd,
      nearMissPolicy: 'excluded-from-normal-ranked-pool',
      budgetCeilingUsd,
      month,
      nights,
      supportedMinimumNights: 2,
      supportedMaximumNights: 14,
      departureDate,
      returnDate,
      style: requestedStyle,
      preference,
      displayBudget: buildDisplayBudget({
        query,
        totalBudgetUsd: budgetModel.totalBudget,
        reservePercent: budgetModel.reservePercent,
        flightUsd: 0,
        accommodationUsd: 0,
        tripUsd: 0
      })
    },
    presentationPolicy: presentationPolicy(),
    sources: {
      flights: flightResult.source,
      stays: process.env.AGODA_SITE_ID && process.env.AGODA_API_KEY ? 'agoda-or-fallback' : 'fallback-no-agoda-credentials',
      cityIntelligence: 'canonical-city-intelligence-500-backend-snapshot',
      personalExpenses: 'not-estimated-reserved-budget-only'
    },
    budgetModel: {
      reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
      reservePurpose: 'Safety reserve for personal and variable expenses; not an expense estimate.',
      affordabilityBasis: 'flight-and-accommodation-only',
      normalPoolCeiling: 'exactly-90-percent-of-total-budget'
    },
    scoringPolicy: {
      version: 'GV-REC-510C-1',
      stages: ['hard-eligibility', 'quality-scoring', 'diversity-selection'],
      weights: scoreWeightsForResponse()
    },
    selectionPolicy: selected.selectionPolicy,
    qualityDiagnostics: {
      activeDestinationPoolLimit: maxLimit,
      candidatesFromFlightSource: candidatesAsked,
      candidatesAfterCuratedFill,
      droppedNoMetadata,
      builtNonNull,
      eligibleBeforeDeduplication: eligible.length,
      eligibilityFailures,
      finalCount: recommendations.length,
      groupRoleCounts: groupRoleCounts(built.filter(Boolean).map(item => ({ groupRole: item.groupRole })))
    },
    ...(!is500CityDiscoveryEnabled() ? { diagnostics: {
      candidatesFromFlightSource: candidatesAsked,
      candidatesAfterCuratedFill,
      droppedNoMetadata,
      filteredByBudget: eligibilityFailures.withinUsableBudget || 0,
      finalCount: recommendations.length
    }} : {}),
    ...(responseWarnings.length === 1 ? { warning: responseWarnings[0] } : {}),
    ...(responseWarnings.length > 1 ? { warnings: responseWarnings } : {}),
    recommendations
  };
}

function scoreWeightsForResponse() {
  return {
    budgetFitAndValue: 22,
    preferenceMatch: 24,
    travelPracticality: 18,
    tripDurationFit: 12,
    hotelValueAndEvidence: 12,
    providerDataConfidence: 7,
    seasonalDateSuitability: 5
  };
}

module.exports = {
  getRecommendations,
  calculateFullTripCost,
  budgetFitScore,
  budgetFitLabel,
  buildFlightBudgetMetadata,
  buildHotelScoringMetadata,
  buildInvalidOriginResponse,
  buildValidationErrorResponse,
  formatBestDepartureDate,
  InvalidOriginError,
  RecommendationValidationError,
  isInvalidOriginError,
  isRecommendationValidationError,
  normalizeBudgetUsd,
  normalizeNearMissUsd,
  normalizeNights,
  normalizeMonth,
  scoreWeightsForResponse
};
