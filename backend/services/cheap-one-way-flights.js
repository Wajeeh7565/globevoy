'use strict';
// GV-FLIGHT-650B: Provider-backed cheapest one-way date scanner with timing guardrails.
// Private provider token is read from process.env only and never returned to the browser.
// The scanner returns provider observations for backend route planning; final availability
// must still be confirmed on partner websites.

const BASE_URL = 'https://api.travelpayouts.com';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_OBS = 31;
const MAX_TIMING_PENALTY_FOR_PRIMARY = 3;
const PRICE_PREMIUM_FOR_BETTER_TIMING = 1.18;
const SMART_FLIGHT_SELECTION_VERSION_677A = 'GV-REC-677A';
const SMART_FLIGHT_DATE_SELECTION_VERSION_677B = 'GV-REC-677B';
const SMART_FLIGHT_QUALITY_GUARDRAIL_VERSION_677B_R2 = 'GV-REC-677B-R2';
const SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3 = 'GV-REC-677B-R3';
const ALLOWED_BOOKING_HOSTS = new Set(['www.aviasales.com', 'aviasales.com', 'tp.media']);
const { SOURCE_TYPES, normalizeFlightEvidence } = require('./domain/pricing/price-evidence-integrity');

const CURRENCY_PARAMS = {
  CAD: { currency: 'cad', market: 'ca' },
  USD: { currency: 'usd', market: 'us' },
  AUD: { currency: 'aud', market: 'au' },
  EUR: { currency: 'eur', market: 'de' },
  GBP: { currency: 'gbp', market: 'gb' }
};

const _cache = new Map();

function safeIata(v) {
  const s = String(v || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function safeCurrency(v) {
  const s = String(v || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_PARAMS, s) ? s : null;
}

function safeMonth(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

function currentMonthUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month, offset) {
  const safe = safeMonth(month) || currentMonthUtc();
  const d = new Date(`${safe}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Number(offset || 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthWindow(startMonth, count) {
  const n = Math.max(1, Math.min(Number(count) || 6, 6));
  const start = safeMonth(startMonth) || currentMonthUtc();
  return Array.from({ length: n }, (_, index) => addMonths(start, index));
}

function buildCacheKey(origin, destination, currency, month) {
  return `ow:${origin}:${destination}:${currency}:${month}`;
}

function sanitizeRawBookingLink(rawLink) {
  if (!rawLink || typeof rawLink !== 'string') return null;
  const s = rawLink.trim();
  if (/^\/search\/|^\/flights\//.test(s)) return `https://www.aviasales.com${s}`;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:') return null;
      if (!ALLOWED_BOOKING_HOSTS.has(u.hostname)) return null;
      return s;
    } catch (_) {
      return null;
    }
  }
  if (/^[A-Z]{3}\d{4}[A-Z]{3}/.test(s)) return `https://www.aviasales.com/search/${s}`;
  return null;
}

async function callEndpoint(endpoint, params, _fetchFn) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) throw new Error('TRAVELPAYOUTS_TOKEN not set');
  const fetchFn = _fetchFn || global.fetch;
  if (!fetchFn) throw new Error('fetch not available');
  const url = new URL(BASE_URL + endpoint);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  let resp;
  try {
    resp = await fetchFn(url.toString(), {
      headers: { 'X-Access-Token': token, Accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError') throw new Error('Provider request timed out');
    throw err;
  }
  const text = await resp.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { throw new Error(`Provider returned non-JSON (HTTP ${resp.status})`); }
  if (!resp.ok) throw new Error(`Provider error: ${parsed?.message || 'HTTP ' + resp.status}`);
  return parsed;
}

function minutesFromDuration(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0 && n < 3000) return Math.round(n);
  return null;
}


function formatDuration(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function qualityLabel(timingQuality) {
  const q = Number(timingQuality);
  if (!Number.isFinite(q)) return 'unknown-timing';
  if (q <= 1) return 'good-timing';
  if (q <= MAX_TIMING_PENALTY_FOR_PRIMARY) return 'acceptable-timing';
  return 'weak-timing';
}

function smartFlightSelection677AEnabled() {
  const raw = String(process.env.ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A || '').trim().toLowerCase();
  return raw ? raw === 'true' : false;
}


function smartFlightDateSelection677BEnabled() {
  const raw = String(process.env.ENABLE_SMART_FLIGHT_DATE_SELECTION_677B || '').trim().toLowerCase();
  return raw ? raw === 'true' : false;
}

function smartFlightQualityGuardrails677BR2Enabled() {
  return String(process.env.ENABLE_FLIGHT_QUALITY_GUARDRAILS_677B_R2 || '').trim().toLowerCase() === 'true';
}

function smartRouteRelativeFlightQuality677BR3Enabled() {
  return String(process.env.ENABLE_ROUTE_RELATIVE_FLIGHT_QUALITY_677B_R3 || '').trim().toLowerCase() === 'true';
}

function expectedJourneyMinutes677BR2(distanceKm) {
  const km = Number(distanceKm || 0);
  if (!Number.isFinite(km) || km <= 0) return null;
  // Planning heuristic, not a schedule claim: cruise time plus airport/taxi/connection overhead.
  const cruiseKmh = km < 900 ? 600 : 760;
  const overhead = km < 900 ? 95 : (km < 4000 ? 150 : 180);
  return Math.max(105, Math.round((km / cruiseKmh) * 60 + overhead));
}

function flightQualityAssessment677BR2(row = {}, context = {}, fastestDuration = null) {
  const duration = Number(row.durationMinutes || 0);
  const transfers = Math.max(0, Number.isFinite(Number(row.transfers)) ? Number(row.transfers) : 0);
  const distanceKm = Number(context.distanceKm || 0);
  const expected = expectedJourneyMinutes677BR2(distanceKm);
  const warnings = [];

  let cautionThreshold = null;
  let severeThreshold = null;
  if (expected) {
    cautionThreshold = Math.max(expected * 1.5, expected + 240);
    severeThreshold = Math.max(expected * 1.9, expected + 360);
  }
  if (Number.isFinite(fastestDuration) && fastestDuration > 0) {
    const fastestCaution = Math.max(fastestDuration * 1.75, fastestDuration + 240);
    const fastestSevere = Math.max(fastestDuration * 2.25, fastestDuration + 420);
    cautionThreshold = cautionThreshold ? Math.min(cautionThreshold, fastestCaution) : fastestCaution;
    severeThreshold = severeThreshold ? Math.min(severeThreshold, fastestSevere) : fastestSevere;
  }

  let status = 'guardrail-pass';
  if (transfers >= 3) { status = 'severe'; warnings.push('too-many-connections'); }
  else if (transfers >= 2) { status = 'caution'; warnings.push('multiple-connections'); }

  if (duration > 0 && severeThreshold && duration > severeThreshold) {
    status = 'severe'; warnings.push('excessive-duration-for-route');
  } else if (duration > 0 && cautionThreshold && duration > cautionThreshold && status !== 'severe') {
    status = 'caution'; warnings.push('long-duration-for-route');
  }

  // Short/medium-haul itineraries consuming most of a day are never presented as a
  // confident smart choice merely because the fare is cheap.
  if (duration > 1080 && distanceKm > 0 && distanceKm < 4000) {
    status = 'severe';
    if (!warnings.includes('excessive-duration-for-route')) warnings.push('excessive-duration-for-route');
  }

  return {
    status,
    warnings,
    expectedJourneyMinutes: expected,
    cautionDurationThresholdMinutes: cautionThreshold ? Math.round(cautionThreshold) : null,
    severeDurationThresholdMinutes: severeThreshold ? Math.round(severeThreshold) : null,
    durationRatioVsExpected: expected && duration > 0 ? Number((duration / expected).toFixed(2)) : null,
    distanceKm: Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null
  };
}


function routeRelativeExpectedFlightMinutes677BR3(distanceKm) {
  const km = Number(distanceKm || 0);
  if (!Number.isFinite(km) || km <= 0) return null;
  // Direct-ish block-time planning baseline. This is intentionally tighter than
  // R2's end-to-end journey heuristic so a 9-10h observation cannot look normal
  // on a route where a typical nonstop/efficient one-stop flight is ~4h.
  let cruiseKmh;
  let fixedMinutes;
  if (km < 900) { cruiseKmh = 620; fixedMinutes = 55; }
  else if (km < 4000) { cruiseKmh = 800; fixedMinutes = 65; }
  else if (km < 8000) { cruiseKmh = 840; fixedMinutes = 75; }
  else { cruiseKmh = 860; fixedMinutes = 90; }
  return Math.max(75, Math.round((km / cruiseKmh) * 60 + fixedMinutes));
}

function routeRelativeFlightQualityAssessment677BR3(row = {}, context = {}, fastestDuration = null) {
  const duration = Number(row.durationMinutes || 0);
  const transfers = Math.max(0, Number.isFinite(Number(row.transfers)) ? Number(row.transfers) : 0);
  const distanceKm = Number(context.distanceKm || 0);
  const routeBaseline = routeRelativeExpectedFlightMinutes677BR3(distanceKm);
  const r2 = flightQualityAssessment677BR2(row, context, fastestDuration);
  const warnings = Array.from(new Set(Array.isArray(r2.warnings) ? r2.warnings : []));

  let cautionThreshold = null;
  let severeThreshold = null;
  let band = 'unknown';
  if (routeBaseline) {
    if (distanceKm < 900) {
      band = 'short-haul';
      cautionThreshold = Math.max(routeBaseline * 1.75, routeBaseline + 150);
      severeThreshold = Math.max(routeBaseline * 2.60, routeBaseline + 300);
    } else if (distanceKm < 4000) {
      band = 'short-medium-haul';
      cautionThreshold = Math.max(routeBaseline * 1.45, routeBaseline + 120);
      severeThreshold = Math.max(routeBaseline * 1.80, routeBaseline + 210);
    } else if (distanceKm < 8000) {
      band = 'long-haul';
      cautionThreshold = Math.max(routeBaseline * 1.55, routeBaseline + 180);
      severeThreshold = Math.max(routeBaseline * 2.05, routeBaseline + 300);
    } else {
      band = 'ultra-long-haul';
      cautionThreshold = Math.max(routeBaseline * 1.50, routeBaseline + 210);
      severeThreshold = Math.max(routeBaseline * 1.95, routeBaseline + 390);
    }
  }

  // When provider evidence contains a clearly efficient option, also use it as
  // an empirical sanity anchor; never loosen the route-relative thresholds.
  if (Number.isFinite(fastestDuration) && fastestDuration > 0) {
    const empiricalCaution = Math.max(fastestDuration * 1.55, fastestDuration + 150);
    const empiricalSevere = Math.max(fastestDuration * 1.95, fastestDuration + 240);
    cautionThreshold = cautionThreshold ? Math.min(cautionThreshold, empiricalCaution) : empiricalCaution;
    severeThreshold = severeThreshold ? Math.min(severeThreshold, empiricalSevere) : empiricalSevere;
  }

  let status = 'guardrail-pass';
  if (transfers >= 3) { status = 'severe'; warnings.push('too-many-connections'); }
  else if (transfers >= 2) { status = 'caution'; warnings.push('multiple-connections'); }

  if (duration > 0 && severeThreshold && duration > severeThreshold) {
    status = 'severe';
    warnings.push('route-relative-duration-severe');
  } else if (duration > 0 && cautionThreshold && duration > cautionThreshold && status !== 'severe') {
    status = 'caution';
    warnings.push('route-relative-duration-caution');
  }

  // R3's explicit short/medium-haul ratio gate catches cases like CUN->NYC
  // ~9h55 against a roughly 4h route baseline even when R2 only called it caution.
  const ratio = routeBaseline && duration > 0 ? duration / routeBaseline : null;
  if (ratio && distanceKm >= 900 && distanceKm < 4000 && ratio >= 1.90 && duration >= routeBaseline + 180) {
    status = 'severe';
    warnings.push('route-relative-duration-ratio-severe');
  }

  return {
    ...r2,
    status,
    warnings: Array.from(new Set(warnings)),
    expectedJourneyMinutes: routeBaseline || r2.expectedJourneyMinutes || null,
    routeRelativeExpectedFlightMinutes: routeBaseline,
    routeRelativeCautionThresholdMinutes: cautionThreshold ? Math.round(cautionThreshold) : null,
    routeRelativeSevereThresholdMinutes: severeThreshold ? Math.round(severeThreshold) : null,
    cautionDurationThresholdMinutes: cautionThreshold ? Math.round(cautionThreshold) : r2.cautionDurationThresholdMinutes,
    severeDurationThresholdMinutes: severeThreshold ? Math.round(severeThreshold) : r2.severeDurationThresholdMinutes,
    durationRatioVsExpected: routeBaseline && duration > 0 ? Number((duration / routeBaseline).toFixed(2)) : r2.durationRatioVsExpected,
    routeDistanceBand: band
  };
}

function activeFlightQualityAssessment677B(row = {}, context = {}, fastestDuration = null) {
  if (smartRouteRelativeFlightQuality677BR3Enabled()) return routeRelativeFlightQualityAssessment677BR3(row, context, fastestDuration);
  if (smartFlightQualityGuardrails677BR2Enabled()) return flightQualityAssessment677BR2(row, context, fastestDuration);
  return null;
}

function dateDiffDays677B(a, b) {
  const aa = String(a || '').slice(0, 10);
  const bb = String(b || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(aa) || !/^\d{4}-\d{2}-\d{2}$/.test(bb)) return 0;
  const ms = Date.parse(`${aa}T00:00:00Z`) - Date.parse(`${bb}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : 0;
}

function timeHour677B(value) {
  const raw = String(value || '');
  if (!/^\d{2}:\d{2}/.test(raw)) return null;
  const hour = Number(raw.slice(0, 2));
  return Number.isFinite(hour) ? hour : null;
}

function usefulTimePenalty677B(row = {}) {
  const depHour = timeHour677B(row.departureTime);
  const arrHour = timeHour677B(row.arrivalTime);
  let penalty = 0;
  const reasons = [];

  if (depHour !== null) {
    if (depHour < 5) { penalty += 10; reasons.push('very-early-departure'); }
    else if (depHour < 7) { penalty += 5; reasons.push('early-departure'); }
    else if (depHour >= 23) { penalty += 4; reasons.push('late-departure'); }
  }
  if (arrHour !== null) {
    if (arrHour < 5) { penalty += 13; reasons.push('overnight-arrival'); }
    else if (arrHour < 7) { penalty += 7; reasons.push('very-early-arrival'); }
    else if (arrHour >= 23) { penalty += 10; reasons.push('overnight-arrival'); }
    else if (arrHour >= 21) { penalty += 5; reasons.push('late-arrival'); }
  }
  return { penalty, reasons };
}

function smartObservationScore677B(row = {}, cheapest = {}, fastestDuration = null, context = {}) {
  const price = Number(row.price || 0);
  const cheapestPrice = Math.max(1, Number(cheapest.price || price || 1));
  const pricePremiumPct = Math.max(0, price / cheapestPrice - 1);
  const transfers = Math.max(0, Number.isFinite(Number(row.transfers)) ? Number(row.transfers) : 0);
  const duration = Number(row.durationMinutes || 0);
  const durationPenaltyHours = Number.isFinite(duration) && duration > 0 && Number.isFinite(fastestDuration) && fastestDuration > 0
    ? Math.max(0, duration - fastestDuration) / 60
    : 0;
  const timing = Math.max(0, Number(row.timingQuality || 0));
  const targetDate = context.targetDate || null;
  const shiftDays = targetDate ? Math.abs(dateDiffDays677B(row.departureDate, targetDate)) : 0;
  const budgetPressure = Math.max(0, Math.min(1.25, Number(context.budgetPressure || 0)));
  const priceWeight = budgetPressure >= 0.9 ? 92 : budgetPressure >= 0.78 ? 78 : 68;
  const usefulTime = usefulTimePenalty677B(row);
  const quality = activeFlightQualityAssessment677B(row, context, fastestDuration);
  const qualityPenalty = quality?.status === 'severe' ? 80 : quality?.status === 'caution' ? 18 : 0;

  // 677B ranks the travel experience, not just the raw fare. Price remains a
  // strong input, but direct/shorter flights and humane arrival times can win
  // when the premium is modest. A date shift is allowed but mildly penalized
  // so the itinerary only moves when the value improvement is meaningful.
  return Number((
    pricePremiumPct * priceWeight
    + transfers * 11
    + durationPenaltyHours * 2.35
    + timing * 1.7
    + usefulTime.penalty
    + shiftDays * 2.8
    + qualityPenalty
  ).toFixed(3));
}

function selectionTradeoff677B(selected = {}, cheapest = {}, context = {}) {
  const selectedDuration = Number(selected.durationMinutes || 0);
  const cheapestDuration = Number(cheapest.durationMinutes || 0);
  const selectedTransfers = Math.max(0, Number(selected.transfers || 0));
  const cheapestTransfers = Math.max(0, Number(cheapest.transfers || 0));
  const targetDate = context.targetDate || null;
  const shiftDays = targetDate ? dateDiffDays677B(selected.departureDate, targetDate) : 0;
  const usefulTime = usefulTimePenalty677B(selected);
  return {
    dateShiftDays: shiftDays,
    durationMinutesSavedVsCheapest: selectedDuration > 0 && cheapestDuration > 0 ? Math.max(0, cheapestDuration - selectedDuration) : 0,
    connectionsSavedVsCheapest: Math.max(0, cheapestTransfers - selectedTransfers),
    pricePremiumVsCheapest: Number((Number(selected.price || 0) - Number(cheapest.price || 0)).toFixed(2)),
    usefulTimeWarnings: usefulTime.reasons,
    targetDate: targetDate || null
  };
}

function smartObservationScore677A(row = {}, cheapest = {}, fastestDuration = null) {
  const price = Number(row.price || 0);
  const cheapestPrice = Math.max(1, Number(cheapest.price || price || 1));
  const pricePremiumPct = Math.max(0, price / cheapestPrice - 1);
  const transfers = Math.max(0, Number.isFinite(Number(row.transfers)) ? Number(row.transfers) : 0);
  const duration = Number(row.durationMinutes || 0);
  const durationPenaltyHours = Number.isFinite(duration) && duration > 0 && Number.isFinite(fastestDuration) && fastestDuration > 0
    ? Math.max(0, duration - fastestDuration) / 60
    : 0;
  const timing = Math.max(0, Number(row.timingQuality || 0));
  // Price still matters most, but a small price premium can be worth it when it
  // removes a connection or several hours of travel. This is a ranking score,
  // not a fare claim.
  return Number((pricePremiumPct * 100 + transfers * 8 + durationPenaltyHours * 1.8 + timing * 2.4).toFixed(3));
}

function selectBestUsableObservation(observations = [], context = {}) {
  const rows = Array.isArray(observations) ? observations.filter((row) => Number(row?.price) > 0) : [];
  if (!rows.length) return null;
  const byPrice = rows.slice().sort((a, b) => Number(a.price) - Number(b.price) || Number(a.timingQuality || 0) - Number(b.timingQuality || 0) || String(a.departureDate).localeCompare(String(b.departureDate)));
  const cheapest = byPrice[0];

  if (smartFlightDateSelection677BEnabled()) {
    const budgetPressure = Math.max(0, Number(context.budgetPressure || 0));
    const relativePremium = budgetPressure >= 0.9 ? 0.16 : budgetPressure >= 0.78 ? 0.20 : 0.26;
    const targetDate = context.targetDate || null;
    const maxDateShiftDays = Math.max(0, Math.min(30, Number.isFinite(Number(context.maxDateShiftDays)) ? Number(context.maxDateShiftDays) : 3));
    const windowRows = targetDate ? byPrice.filter((row) => {
      const shift = dateDiffDays677B(row.departureDate, targetDate);
      return shift >= 0 && shift <= maxDateShiftDays;
    }) : byPrice;
    const baselinePool = windowRows.length ? windowRows : byPrice;
    const cheapest677B = baselinePool.slice().sort((a, b) => Number(a.price) - Number(b.price) || Number(a.timingQuality || 0) - Number(b.timingQuality || 0))[0] || cheapest;
    const absolutePremium = Math.max(35, Number(cheapest677B.price) * relativePremium);
    const priceCeiling = Number(cheapest677B.price) + absolutePremium;
    const usableCandidates = baselinePool.filter((row) => Number(row.price) <= priceCeiling);
    const durations = usableCandidates.map(row => Number(row.durationMinutes || 0)).filter(value => Number.isFinite(value) && value > 0);
    const fastestDuration = durations.length ? Math.min(...durations) : null;
    const qualityR3Enabled = smartRouteRelativeFlightQuality677BR3Enabled();
    const qualityEnabled = qualityR3Enabled || smartFlightQualityGuardrails677BR2Enabled();
    const assessed = usableCandidates.map(row => ({ row, quality: qualityEnabled ? activeFlightQualityAssessment677B(row, { ...context, targetDate }, fastestDuration) : null }));
    const qualityPool = qualityEnabled ? assessed.filter(item => item.quality?.status !== 'severe') : assessed;
    const allProviderOptionsLimited = qualityEnabled && assessed.length > 0 && qualityPool.length === 0;
    let rankingPool = qualityPool.length ? qualityPool : assessed;

    // If every observed option is poor, do not move the trip date just to chase a
    // misleadingly cheap all-day itinerary. Prefer the canonical date when the
    // provider has evidence for it, and label the evidence as limited.
    if (allProviderOptionsLimited && targetDate) {
      const canonical = rankingPool.filter(item => dateDiffDays677B(item.row.departureDate, targetDate) === 0);
      if (canonical.length) rankingPool = canonical;
    }

    const ranked = rankingPool
      .map(item => ({ row: item.row, quality: item.quality, score: smartObservationScore677B(item.row, cheapest677B, fastestDuration, { ...context, targetDate }) }))
      .sort((a, b) => a.score - b.score || Number(a.row.price) - Number(b.row.price) || String(a.row.departureDate).localeCompare(String(b.row.departureDate)));
    const lowestCostRole = String(context.pickRole || '').trim().toLowerCase() === 'lowest-cost';
    const lowestCostChoice = lowestCostRole
      ? rankingPool.slice().sort((a, b) => Number(a.row.price) - Number(b.row.price) || Number(a.row.durationMinutes || Infinity) - Number(b.row.durationMinutes || Infinity) || String(a.row.departureDate).localeCompare(String(b.row.departureDate)))[0]
      : null;
    const choice = lowestCostChoice
      ? { row: lowestCostChoice.row, quality: lowestCostChoice.quality, score: smartObservationScore677B(lowestCostChoice.row, cheapest677B, fastestDuration, { ...context, targetDate }) }
      : (ranked[0] || { row: cheapest677B, quality: qualityEnabled ? activeFlightQualityAssessment677B(cheapest677B, { ...context, targetDate }, fastestDuration) : null, score: 0 });
    const selected = { ...choice.row };
    const tradeoff = selectionTradeoff677B(selected, cheapest677B, { ...context, targetDate });
    selected.cheapestPrice = cheapest677B.price;
    selected.pricePremiumVsCheapest = tradeoff.pricePremiumVsCheapest;
    selected.timingLabel = qualityLabel(selected.timingQuality);
    selected.smartFlightSelectionVersion = SMART_FLIGHT_DATE_SELECTION_VERSION_677B;
    selected.smartFlightDateSelectionVersion = SMART_FLIGHT_DATE_SELECTION_VERSION_677B;
    selected.smartFlightScore = choice.score;
    selected.alternativesConsidered = usableCandidates.length;
    selected.dateShiftDays = tradeoff.dateShiftDays;
    selected.durationMinutesSavedVsCheapest = tradeoff.durationMinutesSavedVsCheapest;
    selected.connectionsSavedVsCheapest = tradeoff.connectionsSavedVsCheapest;
    selected.usefulTimeWarnings = tradeoff.usefulTimeWarnings;
    selected.smartFlightTradeoff = tradeoff;
    if (qualityEnabled) {
      const selectedQuality = choice.quality || activeFlightQualityAssessment677B(selected, { ...context, targetDate }, fastestDuration);
      selected.flightQualityGuardrailVersion = qualityR3Enabled ? SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3 : SMART_FLIGHT_QUALITY_GUARDRAIL_VERSION_677B_R2;
      selected.flightQualityStatus = allProviderOptionsLimited ? 'limited-provider-options' : (selectedQuality?.status || 'guardrail-pass');
      selected.flightQualityWarnings = selectedQuality?.warnings || [];
      selected.expectedJourneyMinutes = selectedQuality?.expectedJourneyMinutes || null;
      selected.cautionDurationThresholdMinutes = selectedQuality?.cautionDurationThresholdMinutes || null;
      selected.severeDurationThresholdMinutes = selectedQuality?.severeDurationThresholdMinutes || null;
      selected.durationRatioVsExpected = selectedQuality?.durationRatioVsExpected || null;
      selected.routeRelativeExpectedFlightMinutes = selectedQuality?.routeRelativeExpectedFlightMinutes || null;
      selected.routeRelativeCautionThresholdMinutes = selectedQuality?.routeRelativeCautionThresholdMinutes || null;
      selected.routeRelativeSevereThresholdMinutes = selectedQuality?.routeRelativeSevereThresholdMinutes || null;
      selected.routeDistanceBand = selectedQuality?.routeDistanceBand || null;
    }
    const keptCheapest = Number(selected.price) === Number(cheapest677B.price) && String(selected.departureDate) === String(cheapest677B.departureDate);
    const comfortGain = tradeoff.durationMinutesSavedVsCheapest >= 90 || tradeoff.connectionsSavedVsCheapest >= 1;
    const dateMoved = tradeoff.dateShiftDays !== 0;
    selected.selectionReason = allProviderOptionsLimited
      ? (qualityR3Enabled ? 'limited-flight-options-provider-evidence-677b-r3' : 'limited-flight-options-provider-evidence-677b-r2')
      : keptCheapest
      ? 'smart-flight-date-selection-kept-cheapest-677b'
      : (dateMoved && comfortGain
        ? 'smart-date-shift-improved-flight-quality-677b'
        : dateMoved
          ? 'smart-date-shift-improved-trip-value-677b'
          : comfortGain
            ? 'smart-flight-comfort-within-budget-677b'
            : 'smart-flight-total-trip-value-677b');
    if (lowestCostRole && !allProviderOptionsLimited) selected.selectionReason = 'lowest-cost-provider-backed-681b-p1';
    return selected;
  }

  if (!smartFlightSelection677AEnabled()) {
    const priceCeiling = Number(cheapest.price) * PRICE_PREMIUM_FOR_BETTER_TIMING;
    const timingAware = byPrice
      .filter((row) => Number(row.price) <= priceCeiling)
      .sort((a, b) => Number(a.timingQuality || 0) - Number(b.timingQuality || 0) || Number(a.price) - Number(b.price) || String(a.departureDate).localeCompare(String(b.departureDate)))[0] || cheapest;
    const selected = { ...timingAware };
    selected.cheapestPrice = cheapest.price;
    selected.pricePremiumVsCheapest = Number((Number(selected.price) - Number(cheapest.price)).toFixed(2));
    selected.timingLabel = qualityLabel(selected.timingQuality);
    selected.selectionReason = selected.departureDate === cheapest.departureDate && Number(selected.price) === Number(cheapest.price)
      ? 'cheapest-provider-date'
      : 'timing-aware-cheap-date';
    return selected;
  }

  const absolutePremium = Math.max(35, Number(cheapest.price) * 0.22);
  const priceCeiling = Number(cheapest.price) + absolutePremium;
  const candidates = byPrice.filter((row) => Number(row.price) <= priceCeiling);
  const durations = candidates.map(row => Number(row.durationMinutes || 0)).filter(value => Number.isFinite(value) && value > 0);
  const fastestDuration = durations.length ? Math.min(...durations) : null;
  const ranked = candidates
    .map(row => ({ row, score: smartObservationScore677A(row, cheapest, fastestDuration) }))
    .sort((a, b) => a.score - b.score || Number(a.row.price) - Number(b.row.price) || String(a.row.departureDate).localeCompare(String(b.row.departureDate)));
  const choice = ranked[0] || { row: cheapest, score: 0 };
  const selected = { ...choice.row };
  selected.cheapestPrice = cheapest.price;
  selected.pricePremiumVsCheapest = Number((Number(selected.price) - Number(cheapest.price)).toFixed(2));
  selected.timingLabel = qualityLabel(selected.timingQuality);
  selected.smartFlightSelectionVersion = SMART_FLIGHT_SELECTION_VERSION_677A;
  selected.smartFlightScore = choice.score;
  selected.alternativesConsidered = candidates.length;
  selected.selectionReason = Number(selected.price) === Number(cheapest.price)
    && String(selected.departureDate) === String(cheapest.departureDate)
    ? 'smart-flight-selection-kept-cheapest-677a'
    : 'smart-price-duration-connection-balance-677a';
  return selected;
}

function normalizeObservations(rawData, currency, metadata = {}) {
  const rows = Array.isArray(rawData?.data) ? rawData.data : Array.isArray(rawData) ? rawData : [];
  const cheapestByDep = new Map();
  for (const r of rows) {
    const dep = String(r.departure_at || r.departureDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dep)) continue;
    const price = Number(r.price ?? r.value ?? r.amount ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const existing = cheapestByDep.get(dep);
    if (!existing || price < existing.price) cheapestByDep.set(dep, { r, price });
  }

  const out = [];
  for (const [dep, { r, price }] of cheapestByDep) {
    const durationMinutes = minutesFromDuration(r.duration || r.duration_minutes || r.duration_to);
    const transfers = Number.isFinite(Number(r.transfers)) ? Number(r.transfers) : null;
    const depTime = String(r.departure_at || '').slice(11, 16) || null;
    const arrTime = String(r.return_at || r.arrival_at || '').slice(11, 16) || null;
    out.push({
      origin: metadata.origin || null,
      destination: metadata.destination || null,
      departureDate: dep,
      departureTime: depTime,
      arrivalTime: arrTime,
      price,
      currency,
      airline: r.airline || null,
      flightNumber: r.flight_number || null,
      transfers,
      durationMinutes,
      durationLabel: formatDuration(durationMinutes),
      timingQuality: scoreTiming({ durationMinutes, transfers, departureTime: depTime, arrivalTime: arrTime }),
      bookingLink: sanitizeRawBookingLink(String(r.link || r.ticket_link || '')),
      source: 'travelpayouts-aviasales-one-way',
      observedAt: metadata.observedAt || null,
      providerFetchedAt: metadata.fetchedAt || metadata.observedAt || null,
      providerEndpoint: metadata.endpointUsed || null
    });
    const normalized = out[out.length - 1];
    normalized.priceEvidence = normalizeFlightEvidence({
      ...normalized,
      amount: price,
      sourceType: SOURCE_TYPES.CACHED,
      retrievedAt: metadata.fetchedAt,
      cacheHit: Boolean(metadata.cacheHit),
      providerBacked: true,
      productionEligible: true
    }, { origin: metadata.origin, destination: metadata.destination, departureDate: dep, currency });
    normalized.evidenceId = normalized.priceEvidence.evidenceId;
    normalized.sourceType = normalized.priceEvidence.sourceType;
  }
  out.sort((a, b) => a.price - b.price || a.timingQuality - b.timingQuality || a.departureDate.localeCompare(b.departureDate));
  return out.slice(0, MAX_OBS);
}

function scoreTiming({ durationMinutes, transfers, departureTime, arrivalTime }) {
  let penalty = 0;
  if (Number.isFinite(durationMinutes)) {
    if (durationMinutes > 900) penalty += 3;
    else if (durationMinutes > 540) penalty += 2;
    else if (durationMinutes > 360) penalty += 1;
  }
  if (Number.isFinite(transfers)) penalty += Math.min(3, transfers);
  const badTime = (t) => {
    if (!/^\d{2}:\d{2}$/.test(String(t || ''))) return false;
    const h = Number(String(t).slice(0, 2));
    return h < 6 || h >= 23;
  };
  if (badTime(departureTime)) penalty += 1;
  if (badTime(arrivalTime)) penalty += 1;
  return penalty;
}

async function fetchCheapOneWayFlightDates({ origin, destination, currency, month, limit, _fetchFn } = {}) {
  const safeOriginVal = safeIata(origin);
  const safeDestVal = safeIata(destination);
  const safeCurrVal = safeCurrency(currency || 'CAD');
  const safeMonthVal = safeMonth(month);
  const safeLimit = Math.max(1, Math.min(Number(limit) || MAX_OBS, MAX_OBS));
  if (!safeOriginVal) return { supported: false, reason: 'invalid-origin', observations: [] };
  if (!safeDestVal) return { supported: false, reason: 'invalid-destination', observations: [] };
  if (!safeCurrVal) return { supported: false, reason: 'invalid-currency', observations: [] };
  if (!safeMonthVal) return { supported: false, reason: 'invalid-month', observations: [] };
  if (!process.env.TRAVELPAYOUTS_TOKEN) return { supported: false, reason: 'provider-unavailable', observations: [], cacheHit: false };

  const ck = buildCacheKey(safeOriginVal, safeDestVal, safeCurrVal, safeMonthVal);
  const cached = _cache.get(ck);
  if (cached && Date.now() < cached.expiresAt) return { ...cached.data, cacheHit: true, observations: cached.data.observations.slice(0, safeLimit) };

  const { currency: tpCurr, market } = CURRENCY_PARAMS[safeCurrVal];
  let observations = [];
  let endpointUsed = null;
  try {
    const raw = await callEndpoint('/aviasales/v3/prices_for_dates', {
      origin: safeOriginVal,
      destination: safeDestVal,
      departure_at: safeMonthVal,
      currency: tpCurr,
      market,
      one_way: 'true',
      sorting: 'price',
      show_to_affiliates: 'true',
      limit: MAX_OBS
    }, _fetchFn);
    endpointUsed = 'prices_for_dates';
    const fetchedAt = new Date().toISOString();
    observations = normalizeObservations(raw, safeCurrVal, { observedAt: fetchedAt, fetchedAt, endpointUsed, origin: safeOriginVal, destination: safeDestVal, cacheHit: false });
  } catch (error) {
    return { supported: false, reason: 'provider-error', error: error.message, observations: [], cacheHit: false };
  }

  const selectedObservation = selectBestUsableObservation(observations);
  const result = {
    supported: true,
    origin: safeOriginVal,
    destination: safeDestVal,
    currency: safeCurrVal,
    month: safeMonthVal,
    observations,
    cheapestObservation: observations[0] || null,
    cheapestSuitableObservation: observations[0] || null,
    bestObservation: selectedObservation || observations[0] || null,
    bestBalanceObservation: selectedObservation || observations[0] || null,
    selectedObservation,
    selectionPolicy: {
      version: 'GV-FLIGHT-650B',
      pricePremiumForBetterTiming: PRICE_PREMIUM_FOR_BETTER_TIMING,
      maxTimingPenaltyForPrimary: MAX_TIMING_PENALTY_FOR_PRIMARY,
      rawFlightSearchHiddenFromUser: true,
      smartFlightDateSelection: smartFlightDateSelection677BEnabled() ? SMART_FLIGHT_DATE_SELECTION_VERSION_677B : null
    },
    endpointUsed,
    fetchedAt: observations[0]?.providerFetchedAt || new Date().toISOString(),
    source: 'travelpayouts-provider-cache',
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    cacheHit: false
  };
  _cache.set(ck, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...result, observations: observations.slice(0, safeLimit) };
}

async function fetchCheapestOneWayAcrossMonths({ origin, destination, currency, startMonth, month, months, limitPerMonth, limit, _fetchFn } = {}) {
  const safeOriginVal = safeIata(origin);
  const safeDestVal = safeIata(destination);
  const safeCurrVal = safeCurrency(currency || 'CAD');
  if (!safeOriginVal) return { supported: false, reason: 'invalid-origin', observations: [], scannedMonths: [] };
  if (!safeDestVal) return { supported: false, reason: 'invalid-destination', observations: [], scannedMonths: [] };
  if (!safeCurrVal) return { supported: false, reason: 'invalid-currency', observations: [], scannedMonths: [] };

  const scanMonths = monthWindow(startMonth || month, months || 6);
  const perMonthLimit = Math.max(1, Math.min(Number(limitPerMonth) || 8, MAX_OBS));
  const finalLimit = Math.max(1, Math.min(Number(limit) || 12, MAX_OBS));

  // Keep provider calls bounded but run the month window concurrently so Lambda latency stays reasonable.
  const monthResults = await Promise.all(scanMonths.map(async (m) => {
    const result = await fetchCheapOneWayFlightDates({
      origin: safeOriginVal,
      destination: safeDestVal,
      currency: safeCurrVal,
      month: m,
      limit: perMonthLimit,
      _fetchFn
    });
    return { month: m, result };
  }));

  const observationsByDate = new Map();
  let firstUnsupportedReason = null;
  let supportedMonthCount = 0;
  let providerErrorCount = 0;
  let cacheHitCount = 0;

  for (const entry of monthResults) {
    const result = entry.result || {};
    if (result.cacheHit) cacheHitCount += 1;
    if (result.supported) supportedMonthCount += 1;
    if (!result.supported && !firstUnsupportedReason) firstUnsupportedReason = result.reason || 'provider-unavailable';
    if (result.reason === 'provider-error') providerErrorCount += 1;
    for (const row of (Array.isArray(result.observations) ? result.observations : [])) {
      if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.departureDate || ''))) continue;
      const current = observationsByDate.get(row.departureDate);
      if (!current || Number(row.price) < Number(current.price)) observationsByDate.set(row.departureDate, row);
    }
  }

  const observations = [...observationsByDate.values()]
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0)
      || Number(a.timingQuality || 0) - Number(b.timingQuality || 0)
      || String(a.departureDate).localeCompare(String(b.departureDate)))
    .slice(0, MAX_OBS);
  const selectedObservation = selectBestUsableObservation(observations);

  return {
    supported: observations.length > 0,
    reason: observations.length > 0 ? null : (firstUnsupportedReason || 'no-observations'),
    origin: safeOriginVal,
    destination: safeDestVal,
    currency: safeCurrVal,
    startMonth: scanMonths[0],
    months: scanMonths.length,
    scannedMonths: monthResults.map((entry) => ({
      month: entry.month,
      supported: Boolean(entry.result?.supported),
      reason: entry.result?.reason || null,
      observationCount: Array.isArray(entry.result?.observations) ? entry.result.observations.length : 0,
      cacheHit: Boolean(entry.result?.cacheHit)
    })),
    supportedMonthCount,
    providerErrorCount,
    cacheHitCount,
    observations: observations.slice(0, finalLimit),
    cheapestObservation: observations[0] || null,
    cheapestSuitableObservation: observations[0] || null,
    bestObservation: selectedObservation || observations[0] || null,
    bestBalanceObservation: selectedObservation || observations[0] || null,
    selectedObservation,
    selectionPolicy: {
      version: 'GV-FLIGHT-657A',
      window: 'next-six-months',
      pricePremiumForBetterTiming: PRICE_PREMIUM_FOR_BETTER_TIMING,
      maxTimingPenaltyForPrimary: MAX_TIMING_PENALTY_FOR_PRIMARY,
      rawFlightSearchHiddenFromUser: true,
      smartFlightDateSelection: smartFlightDateSelection677BEnabled() ? SMART_FLIGHT_DATE_SELECTION_VERSION_677B : null
    },
    endpointUsed: 'prices_for_dates-month-window',
    fetchedAt: monthResults.map((entry) => entry.result?.fetchedAt).filter(Boolean).sort().slice(-1)[0] || new Date().toISOString(),
    source: 'travelpayouts-provider-cache-month-window',
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    cacheHit: cacheHitCount === scanMonths.length
  };
}

function _clearCache() { _cache.clear(); }
function _getCacheSize() { return _cache.size; }

module.exports = {
  fetchCheapOneWayFlightDates,
  fetchCheapestOneWayAcrossMonths,
  buildCacheKey,
  monthWindow,
  addMonths,
  sanitizeRawBookingLink,
  normalizeObservations,
  selectBestUsableObservation,
  smartFlightSelection677AEnabled,
  smartObservationScore677A,
  SMART_FLIGHT_SELECTION_VERSION_677A,
  smartFlightDateSelection677BEnabled,
  smartObservationScore677B,
  selectionTradeoff677B,
  SMART_FLIGHT_DATE_SELECTION_VERSION_677B,
  smartFlightQualityGuardrails677BR2Enabled,
  smartRouteRelativeFlightQuality677BR3Enabled,
  flightQualityAssessment677BR2,
  routeRelativeFlightQualityAssessment677BR3,
  routeRelativeExpectedFlightMinutes677BR3,
  expectedJourneyMinutes677BR2,
  SMART_FLIGHT_QUALITY_GUARDRAIL_VERSION_677B_R2,
  SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3,
  scoreTiming,
  _clearCache,
  _getCacheSize
};
