const { resolveOrigin, getDestination, fallbackFlightCandidates } = require('./data/destination-meta');
const { buildDailyBudget } = require('./data/daily-budget');
const { fetchTravelpayoutsCandidates, convertFlightValueToUsd, buildAviasalesLink } = require('./services/travelpayouts');
const { fetchAgodaStayEstimate } = require('./services/agoda');

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
  return Math.max(2, Math.min(14, Math.round(number(value, 5))));
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

function normalizeNearMissUsd(query) {
  return Math.max(0, Math.min(500, Math.round(number(query.nearMissUsd, 50))));
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
  const safeBudget = Math.max(1, Number(budget) || 1);
  const use = total / safeBudget;
  let score;
  if (use <= 0.70) score = 96;
  else if (use <= 0.85) score = 95 - ((use - 0.70) / 0.15) * 10;
  else if (use <= 1.00) score = 84 - ((use - 0.85) / 0.15) * 19;
  else if (use <= 1.15) score = 64 - ((use - 1.00) / 0.15) * 24;
  else score = 39 - ((Math.min(use, 1.30) - 1.15) / 0.15) * 14;
  return Math.max(25, Math.min(98, Math.round(score)));
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

function buildFlexibleDateMetadata(flight) {
  const source = String(flight?.source || '').toLowerCase();
  const bestDepartureDate = formatBestDepartureDate(flight?.departureAt);
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
  if (normalized.includes('fallback')) return 'fallback-estimate';
  return 'unknown';
}

function stayStrategyFor(source) {
  const confidence = hotelSourceConfidenceFor(source);
  if (confidence === 'live-agoda') return 'agoda-quality-filtered-price-average';
  if (confidence === 'fallback-after-error') return 'fallback-after-agoda-error';
  if (confidence === 'fallback-estimate') return 'fallback-nightly-destination-average';
  return 'unknown';
}

function scoreHotelBudgetFit(status) {
  if (status === 'comfortable') return 95;
  if (status === 'reasonable') return 80;
  if (status === 'tight') return 55;
  if (status === 'expensive-stay') return 25;
  return 0;
}

function scoreHotelSourceConfidence(confidence) {
  if (confidence === 'live-agoda') return 90;
  if (confidence === 'fallback-estimate') return 45;
  if (confidence === 'fallback-after-error') return 35;
  return 25;
}

function scoreHotelQuality(signals, sourceConfidence) {
  const scores = [];
  if (signals.rating !== null) scores.push(Math.max(0, Math.min(100, signals.rating * 10)));
  if (signals.stars !== null) scores.push(Math.max(0, Math.min(100, (signals.stars / 5) * 100)));
  if (signals.reviewCount !== null) {
    if (signals.reviewCount >= 500) scores.push(100);
    else if (signals.reviewCount >= 100) scores.push(85);
    else if (signals.reviewCount >= 25) scores.push(70);
    else scores.push(35);
  }
  if (!scores.length) return sourceConfidence === 'live-agoda' ? 40 : 25;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function scoreDestinationStyleCompatibility(destination = {}, style = 'any') {
  const requested = String(style || 'any').toLowerCase();
  if (!requested || requested === 'any') return 70;
  const haystack = [
    destination.theme,
    destination.city,
    destination.country,
    destination.localCost,
    destination.walkability
  ].join(' ').toLowerCase();
  return haystack.includes(requested) ? 85 : 55;
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
  return `Fallback stay estimate is usable for budget math, but live hotel quality data was not available.`;
}

function buildHotelScoringMetadata({ stay = {}, destination = {}, budgetUsd, nights, style = 'any' }) {
  const stayTotal = number(stay.totalStayUsd, 0);
  const budget = number(budgetUsd, 0);
  const hotelBudgetShare = stayTotal > 0 && budget > 0
    ? Number((stayTotal / budget).toFixed(3))
    : null;
  const hotelBudgetStatus = hotelBudgetStatusFromShare(hotelBudgetShare);
  const hotelSourceConfidence = hotelSourceConfidenceFor(stay.source);
  const hotelQualitySignals = normalizeHotelQualitySignals(stay);
  const stayStrategy = stayStrategyFor(stay.source);
  const warnings = [];

  if (hotelSourceConfidence === 'fallback-estimate') warnings.push('fallback-stay-estimate');
  if (hotelSourceConfidence === 'fallback-after-error') warnings.push('fallback-after-agoda-error', 'fallback-stay-estimate');
  if (hotelQualitySignals.sampleSize > 0 && hotelQualitySignals.sampleSize < 3) warnings.push('low-sample-size');
  if (!stay.hotelUrl) warnings.push('no-agoda-link');
  if (hotelQualitySignals.rating === null) warnings.push('rating-unavailable');
  if (hotelQualitySignals.reviewCount === null) warnings.push('review-count-unavailable');
  if (hotelQualitySignals.stars === null) warnings.push('star-rating-unavailable');
  if (hotelBudgetStatus === 'tight' || hotelBudgetStatus === 'expensive-stay') warnings.push('hotel-budget-tight');

  const styleScore = scoreDestinationStyleCompatibility(destination, style);
  if (String(style || 'any').toLowerCase() !== 'any' && styleScore < 80) warnings.push('style-match-unverified');

  const destinationTheme = String(destination.theme || '').toLowerCase();
  const requestedStyle = String(style || '').toLowerCase();
  if (destinationTheme.includes('coast') || requestedStyle.includes('coast') || requestedStyle.includes('beach')) {
    warnings.push('resort-claim-unverified');
  }
  warnings.push('location-quality-unverified', 'availability-not-guaranteed');

  const canScore = hotelBudgetShare !== null || hotelSourceConfidence !== 'unknown';
  let hotelScore = null;
  if (canScore) {
    const score =
      scoreHotelBudgetFit(hotelBudgetStatus) * 0.35 +
      scoreHotelSourceConfidence(hotelSourceConfidence) * 0.20 +
      scoreHotelQuality(hotelQualitySignals, hotelSourceConfidence) * 0.15 +
      (stay.hotelUrl ? 100 : 35) * 0.10 +
      (hotelSourceConfidence === 'live-agoda' ? 85 : 55) * 0.10 +
      styleScore * 0.10;
    const cap = hotelSourceConfidence === 'live-agoda'
      ? 100
      : (hotelSourceConfidence === 'fallback-after-error' ? 60 : 65);
    hotelScore = Math.max(0, Math.min(cap, Math.round(score)));
  }

  return {
    hotelScore,
    hotelBudgetShare,
    hotelBudgetStatus,
    hotelSourceConfidence,
    hotelQualitySignals,
    hotelFitReason: buildHotelFitReason({ sourceConfidence: hotelSourceConfidence, hotelBudgetStatus, nights }),
    hotelWarnings: uniqueWarnings(warnings),
    stayStrategy
  };
}

function candidateDestinationCode(candidate) {
  return String(candidate?.destination_city_iata || candidate?.destination || candidate?.code || '')
    .trim()
    .toUpperCase();
}

function fillWithCuratedCandidates(candidates, originCode, targetLimit) {
  const merged = [];
  const seen = new Set();

  (Array.isArray(candidates) ? candidates : []).forEach(candidate => {
    const code = candidateDestinationCode(candidate);
    if (!code || seen.has(code)) return;
    seen.add(code);
    merged.push(candidate);
  });

  fallbackFlightCandidates(originCode).forEach(candidate => {
    const code = candidateDestinationCode(candidate);
    if (!code || seen.has(code)) return;
    seen.add(code);
    merged.push({
      ...candidate,
      source: 'fallback-route-model'
    });
  });

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
  const dailySpend = Math.round(number(dailySpendUsd, 0));
  const activitiesLocal = Math.round(number(activitiesLocalUsd, 0));
  const safeBudget = Math.round(Math.max(1, number(budgetUsd, 1)));
  const total = Math.round(flight + lodging + dailySpend + activitiesLocal);
  const budgetBuffer = Math.round(safeBudget - total);
  const score = budgetFitScore(total, safeBudget);
  const fitLabel = budgetFitLabel(total, safeBudget);

  return {
    flight,
    lodging,
    dailySpend,
    activitiesLocal,
    total,
    budgetBuffer,
    budgetUse: Number((total / safeBudget).toFixed(3)),
    score,
    budgetFitLabel: fitLabel,
    budgetFitStatus: budgetFitStatus(fitLabel)
  };
}

function normalizeFlight(candidate, originCode, destinationCode) {
  const rawValue = number(candidate.normalizedFlightUsd || candidate.value || 0);
  const flightUsd = candidate.normalizedFlightUsd
    ? rawValue
    : convertFlightValueToUsd(rawValue, candidate.normalizedCurrency || process.env.TRAVELPAYOUTS_PRICE_CURRENCY);

  return {
    source: candidate.source || 'travelpayouts',
    flightUsd: Math.round(flightUsd),
    departureAt: candidate.departure_at || null,
    duration: candidate.trip_duration || null,
    bookingLink: candidate.bookingLink || buildAviasalesLink(candidate.ticket_link, originCode, destinationCode),
    rawValue: candidate.value || null
  };
}

function buildWhy({ destination, budgetUsd, total, buffer, flight, stay, dailyBudget, nights }) {
  const fitText = buffer >= 0
    ? `leaves about $${Math.round(buffer)} of the $${Math.round(budgetUsd)} budget`
    : `is about $${Math.round(Math.abs(buffer))} over the $${Math.round(budgetUsd)} budget`;
  const daily = dailyBudget.trip.food + dailyBudget.trip.localTransport + dailyBudget.trip.everydayBuffer;
  const activities = dailyBudget.trip.basicActivities;
  const dailyDetail = `$${Math.round(dailyBudget.trip.food)} food, $${Math.round(dailyBudget.trip.localTransport)} local transport, and $${Math.round(dailyBudget.trip.everydayBuffer)} everyday buffer`;

  return `${destination.city} ${buffer >= 0 ? 'fits' : 'is close but tight'} because the estimate combines a $${Math.round(flight.flightUsd)} flight, $${Math.round(stay.totalStayUsd)} stay for ${nights} nights, $${Math.round(daily)} daily budget (${dailyDetail}), and $${Math.round(activities)} for basic activities. The full trip is about $${Math.round(total)}, which ${fitText}.`;
}

function passesStyle(destination, style) {
  if (!style || style === 'any') return true;
  const haystack = [
    destination.theme,
    destination.city,
    destination.country,
    destination.localCost,
    destination.walkability
  ].join(' ').toLowerCase();
  return haystack.includes(String(style).toLowerCase());
}

async function buildRecommendation({ candidate, origin, budgetUsd, nights, month, style }) {
  const destinationCode = candidate.destination_city_iata || candidate.destination || candidate.code;
  const destination = getDestination(destinationCode);
  if (!destination) return null;
  if (!passesStyle(destination, style)) return null;

  const flight = normalizeFlight(candidate, origin.code, destination.code);
  if (!flight.flightUsd) flight.flightUsd = destination.fallbackFlightUsd;

  let stay;
  try {
    stay = await fetchAgodaStayEstimate({ destination, nights, month });
  } catch (error) {
    stay = {
      source: 'fallback-after-agoda-error',
      averageNightlyUsd: destination.fallbackNightlyUsd,
      totalStayUsd: Math.round(destination.fallbackNightlyUsd * nights),
      hotelName: null,
      hotelUrl: null,
      sampleSize: 0,
      error: error.message
    };
  }

  const tripDays = nights + 1;
  const dailyBudget = buildDailyBudget(destination, tripDays);
  const daily = Math.round(dailyBudget.trip.food + dailyBudget.trip.localTransport + dailyBudget.trip.everydayBuffer);
  const activities = Math.round(dailyBudget.trip.basicActivities);
  const cost = calculateFullTripCost({
    flightUsd: flight.flightUsd,
    stayUsd: stay.totalStayUsd,
    dailySpendUsd: daily,
    activitiesLocalUsd: activities,
    budgetUsd
  });
  const whyItFits = buildWhy({
    destination,
    budgetUsd,
    total: cost.total,
    buffer: cost.budgetBuffer,
    flight,
    stay,
    dailyBudget,
    nights
  });
  const flexibleDateMetadata = buildFlexibleDateMetadata(flight);
  const flightBudgetMetadata = buildFlightBudgetMetadata(flight.flightUsd, budgetUsd);
  const hotelMetadata = buildHotelScoringMetadata({
    stay,
    destination,
    budgetUsd,
    nights,
    style
  });

  return {
    id: destination.city.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    city: destination.city,
    country: destination.country,
    code: destination.code,
    lat: destination.lat,
    lng: destination.lng,
    img: destination.img,
    theme: destination.theme,
    days: destination.days,
    season: destination.season,
    seasonInsight: destination.seasonInsight,
    tripDays,
    nights,
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
    stayStrategy: hotelMetadata.stayStrategy,
    flight: cost.flight,
    lodging: cost.lodging,
    dailySpend: cost.dailySpend,
    activitiesLocal: cost.activitiesLocal,
    dailyBudget,
    total: cost.total,
    budgetBuffer: cost.budgetBuffer,
    score: cost.score,
    budgetUse: cost.budgetUse,
    budgetFitLabel: cost.budgetFitLabel,
    budgetFitStatus: cost.budgetFitStatus,
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
      dailySpend: destination.dailySpendSource || 'globevoy-manual-dataset',
      dailyBudget: dailyBudget.method
    },
    raw: {
      flightRawValue: flight.rawValue,
      departureAt: flight.departureAt,
      hotelName: stay.hotelName,
      agodaSampleSize: stay.sampleSize
    }
  };
}

async function getRecommendations(query = {}) {
  const origin = requireOrigin(query);
  const budgetUsd = Math.round(normalizeBudgetUsd(query));
  const nearMissUsd = normalizeNearMissUsd(query);
  const budgetCeilingUsd = budgetUsd + nearMissUsd;
  const nights = normalizeNights(query.nights || query.tripLength);
  const month = normalizeMonth(query.month || query.departMonth);
  const style = String(query.style || 'any').toLowerCase();
  const limit = Math.max(5, Math.min(115, Math.round(number(query.limit, DEFAULT_LIMIT))));

  // Travelpayouts can fail for valid reasons (transient API outage, rate
  // limit). When that happens, fall
  // back to our static destination candidates and surface the error in the
  // response so the frontend can still render trips while logging the issue.
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
      budgetUsd,
      nights,
      month,
      style
    }))
  );

  /* v11.8.1: track the dataset-gap funnel so we can see exactly where results
     drop off. Travelpayouts returns destinations like BKK, SFO, BOS that don't
     have metadata in destination-meta.js — these silently become null in
     buildRecommendation. Without diagnostics we can't tell if a low result
     count is a budget filter, a dataset gap, or something else. */
  const candidatesAsked = flightResult.candidates.length;
  const candidatesAfterCuratedFill = candidatePool.length;
  const builtNonNull = built.filter(Boolean).length;
  const droppedNoMetadata = candidatesAfterCuratedFill - builtNonNull;
  const filteredByBudget = built.filter(Boolean)
    .filter(item => !(item.code !== origin.code && item.total <= budgetCeilingUsd))
    .length;

  const recommendations = built
    .filter(Boolean)
    .filter(item => item.code !== origin.code && item.total <= budgetCeilingUsd)
    .sort((a, b) => b.score - a.score || a.total - b.total)
    .slice(0, limit);

  const isMock = flightResult.source.startsWith('mock');
  const isFallback = flightResult.source.startsWith('fallback');

  return {
    ok: true,
    mode: isMock ? 'mock' : (isFallback ? 'fallback' : 'live'),
    version: '11.10.1',
    servedAt: new Date().toISOString(),
    requested: {
      origin,
      budgetUsd,
      nearMissUsd,
      budgetCeilingUsd,
      month,
      nights,
      style
    },
    sources: {
      flights: flightResult.source,
      stays: process.env.AGODA_SITE_ID && process.env.AGODA_API_KEY ? 'agoda-or-fallback' : 'fallback-no-agoda-credentials',
      dailySpend: 'globevoy-manual-dataset'
    },
    /* v11.8.1: funnel diagnostics — debug-only, frontend can ignore. */
    diagnostics: {
      candidatesFromFlightSource: candidatesAsked,
      candidatesAfterCuratedFill,
      droppedNoMetadata,
      filteredByBudget,
      finalCount: recommendations.length
    },
    ...(flightError ? { warning: `Travelpayouts unavailable: ${flightError}` } : {}),
    recommendations
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
  formatBestDepartureDate,
  InvalidOriginError,
  isInvalidOriginError,
  normalizeBudgetUsd,
  normalizeNearMissUsd,
  normalizeMonth
};
