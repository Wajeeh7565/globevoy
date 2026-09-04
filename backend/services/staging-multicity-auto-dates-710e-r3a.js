'use strict';

// GV-FLIGHT-710E-R3A — staging-only automatic date materialization for an
// already-selected multi-city route. The browser asks for one route outcome;
// provider credentials and fare-calendar orchestration stay server-side.
//
// This endpoint does NOT book, reserve, order or ticket anything. It uses
// cached/provider fare observations to choose dates, and fails closed when a
// complete exact-date chain cannot be supported by provider evidence.
//
// R1 chain-search correction: a greedy first-leg choice can strand a later
// exact-date leg even when another cheap provider-observed start date produces
// a complete chain. We now try a bounded set of cheap/practical first-leg dates,
// preserve every saved stop-night allocation exactly, and choose the cheapest
// complete provider-backed chain. No dates are invented or shifted silently.

const { getMultiCityTours } = require('../multicity-routes');
const {
  fetchCheapestOneWayAcrossMonths,
  selectBestUsableObservation
} = require('./cheap-one-way-flights');
const { automaticDateFloor } = require('./price-evidence-integrity');

const VERSION = 'GV-FLIGHT-710E-R3A';
const REVISION = 'GV-FLIGHT-710E-R3A-R1';
const ROUTE_PATH = '/api/staging/multicity-auto-dates';
const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const MINIMUM_LEAD_DAYS = 14;
const MAX_PROVIDER_CALL_MONTHS_FIRST_LEG = 6;
const MAX_CHAIN_START_CANDIDATES = 18;
const MAX_PROVIDER_OBSERVATIONS_PER_MONTH = 31;

function enabled(env = process.env) {
  return String(env.ENABLE_STAGING_MULTICITY_AUTO_DATES_710E_R3A || '').trim().toLowerCase() === 'true';
}

function headerValue(headers = {}, name = '') {
  const wanted = String(name).trim().toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).trim().toLowerCase() === wanted) return String(value || '').trim();
  }
  return '';
}

function eventMethod(event = {}) {
  return String(event?.requestContext?.http?.method || event?.httpMethod || 'GET').toUpperCase();
}

function queryParams(event = {}) {
  return event.queryStringParameters && typeof event.queryStringParameters === 'object'
    ? { ...event.queryStringParameters }
    : {};
}

function json(statusCode, body, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Globevoy-Automatic-Dates': VERSION,
    'X-Globevoy-Automatic-Dates-Revision': REVISION
  };
  if (origin === STAGING_ORIGIN) headers['Access-Control-Allow-Origin'] = STAGING_ORIGIN;
  return { statusCode, headers, body: JSON.stringify(body) };
}

function preflight(event = {}) {
  const origin = headerValue(event.headers || {}, 'origin');
  if (origin !== STAGING_ORIGIN) return json(403, { ok: false, error: 'staging-origin-not-allowed' }, origin);
  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Origin': STAGING_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      'X-Globevoy-Automatic-Dates': VERSION,
      'X-Globevoy-Automatic-Dates-Revision': REVISION
    },
    body: ''
  };
}

function safeDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(`${raw}T12:00:00Z`)) ? raw : null;
}

function safeMonth(value) {
  const raw = String(value || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(raw) ? raw : null;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Math.round(Number(days) || 0));
  return date.toISOString().slice(0, 10);
}

function addMonths(monthString, count) {
  const month = safeMonth(monthString);
  if (!month) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + Math.round(Number(count) || 0), 1, 12));
  return date.toISOString().slice(0, 7);
}

function dateWithinHorizon(dateString, floor, horizonEnd) {
  const date = safeDate(dateString);
  return Boolean(date && date >= floor && date < `${horizonEnd}-01`);
}

function exactDateRows(observations = [], dateString) {
  return observations.filter((row) => safeDate(row?.departureDate) === dateString);
}

function routeBudgetPressure(tour = {}) {
  const total = Number(tour.estimatedTotalUsd || 0);
  const usable = Number(tour.usableTripBudgetUsd || 0);
  return total > 0 && usable > 0 ? Math.max(0, Math.min(1.25, total / usable)) : 0;
}

function routeCodes(leg = {}) {
  return {
    origin: String(leg?.from?.code || '').trim().toUpperCase(),
    destination: String(leg?.to?.code || '').trim().toUpperCase()
  };
}

function sameObservation(a = {}, b = {}) {
  if (a?.evidenceId && b?.evidenceId) return a.evidenceId === b.evidenceId;
  return safeDate(a?.departureDate) === safeDate(b?.departureDate)
    && Number(a?.price || 0) === Number(b?.price || 0)
    && String(a?.flightNumber || '') === String(b?.flightNumber || '');
}

function orderedStartCandidates(observations = [], context = {}) {
  const rows = Array.isArray(observations)
    ? observations.filter((row) => safeDate(row?.departureDate) && Number(row?.price) > 0)
    : [];
  const sorted = rows.slice().sort((a, b) => Number(a.price) - Number(b.price)
    || Number(a.timingQuality || 0) - Number(b.timingQuality || 0)
    || String(a.departureDate).localeCompare(String(b.departureDate)));
  const preferred = selectBestUsableObservation(sorted, context);
  const ordered = preferred
    ? [preferred, ...sorted.filter((row) => !sameObservation(row, preferred))]
    : sorted;
  return ordered.slice(0, MAX_CHAIN_START_CANDIDATES);
}

function publicSelection(row = {}, leg = {}, targetDate = null) {
  return {
    legNumber: leg.legNumber || null,
    from: leg.from || null,
    to: leg.to || null,
    departureDate: safeDate(row.departureDate),
    departureTime: row.departureTime || null,
    arrivalTime: row.arrivalTime || null,
    price: Number(row.price || 0) || null,
    currency: row.currency || null,
    airline: row.airline || null,
    flightNumber: row.flightNumber || null,
    transfers: Number.isFinite(Number(row.transfers)) ? Number(row.transfers) : null,
    durationMinutes: Number.isFinite(Number(row.durationMinutes)) ? Number(row.durationMinutes) : null,
    durationLabel: row.durationLabel || null,
    selectionReason: row.selectionReason || null,
    timingLabel: row.timingLabel || null,
    pricePremiumVsCheapest: Number.isFinite(Number(row.pricePremiumVsCheapest)) ? Number(row.pricePremiumVsCheapest) : null,
    flightQualityStatus: row.flightQualityStatus || null,
    flightQualityWarnings: Array.isArray(row.flightQualityWarnings) ? row.flightQualityWarnings : [],
    targetDate,
    evidence: row.priceEvidence || null,
    evidenceId: row.evidenceId || row.priceEvidence?.evidenceId || null,
    sourceType: row.sourceType || row.priceEvidence?.sourceType || 'CACHED',
    availabilityVerified: false,
    bookingCreated: false
  };
}

function totalObservedPrice(selectedLegs = []) {
  return Number(selectedLegs.reduce((sum, leg) => sum + (Number(leg?.price) || 0), 0).toFixed(2));
}

function chainQualityPenalty(selectedLegs = []) {
  return selectedLegs.reduce((sum, leg) => {
    const status = String(leg?.flightQualityStatus || '').toLowerCase();
    if (status === 'limited-provider-options' || status === 'severe') return sum + 250;
    if (status === 'caution') return sum + 60;
    return sum;
  }, 0);
}

async function materializeRouteDates({ tour, query = {}, now = new Date() } = {}) {
  const legs = Array.isArray(tour?.legs) ? tour.legs : [];
  const stops = Array.isArray(tour?.stops) ? tour.stops : [];
  if (!legs.length || legs.length !== stops.length + 1) {
    return { complete: false, reason: 'route-structure-incomplete', selectedLegs: [] };
  }

  for (let index = 0; index < legs.length; index += 1) {
    const { origin, destination } = routeCodes(legs[index]);
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      return {
        complete: false,
        reason: 'provider-route-code-missing',
        failedLegNumber: index + 1,
        selectedLegs: [],
        diagnostics: []
      };
    }
  }

  const currency = String(query.currency || tour?.displayBudget?.currency || 'CAD').trim().toUpperCase();
  const automaticFloor = automaticDateFloor({ now, minimumLeadDays: MINIMUM_LEAD_DAYS });
  const floorMonth = automaticFloor.slice(0, 7);
  const requestedMonth = safeMonth(query.month || query.preferredMonth);
  const firstMonth = requestedMonth && requestedMonth >= floorMonth ? requestedMonth : floorMonth;
  const horizonEnd = addMonths(firstMonth, 6);
  if (!horizonEnd) return { complete: false, reason: 'invalid-planning-horizon', selectedLegs: [] };

  const budgetPressure = routeBudgetPressure(tour);
  const firstLeg = legs[0];
  const firstCodes = routeCodes(firstLeg);
  const firstProvider = await fetchCheapestOneWayAcrossMonths({
    origin: firstCodes.origin,
    destination: firstCodes.destination,
    currency,
    startMonth: firstMonth,
    months: MAX_PROVIDER_CALL_MONTHS_FIRST_LEG,
    limitPerMonth: MAX_PROVIDER_OBSERVATIONS_PER_MONTH,
    limit: MAX_PROVIDER_OBSERVATIONS_PER_MONTH
  });

  const firstObservations = (Array.isArray(firstProvider?.observations) ? firstProvider.observations : [])
    .filter((row) => dateWithinHorizon(row?.departureDate, automaticFloor, horizonEnd));

  const firstDiagnostic = {
    legNumber: 1,
    origin: firstCodes.origin,
    destination: firstCodes.destination,
    targetDate: null,
    providerSupported: Boolean(firstProvider?.supported),
    providerReason: firstProvider?.reason || null,
    scannedMonths: firstProvider?.scannedMonths || [],
    eligibleObservationCount: firstObservations.length,
    cacheHit: Boolean(firstProvider?.cacheHit)
  };

  if (!firstObservations.length) {
    return {
      complete: false,
      reason: 'no-automatic-date-observation',
      failedLegNumber: 1,
      automaticFloor,
      horizonStartMonth: firstMonth,
      horizonMonths: 6,
      selectedLegs: [],
      diagnostics: [firstDiagnostic],
      chainSearch: { strategy: 'bounded-exact-chain-search', attemptedStartDates: 0, viableChains: 0 }
    };
  }

  const startCandidates = orderedStartCandidates(firstObservations, {
    pickRole: tour.tourRole,
    targetDate: null,
    budgetPressure,
    distanceKm: Number(firstLeg.distanceKm || 0)
  });

  // Cache one-month provider scans across candidate attempts. A failed greedy
  // start date should not multiply provider traffic for the same route/month.
  const monthlyProviderCache = new Map();
  async function fetchFollowingMonth(leg, month) {
    const { origin, destination } = routeCodes(leg);
    const key = `${origin}:${destination}:${currency}:${month}`;
    if (monthlyProviderCache.has(key)) return monthlyProviderCache.get(key);
    const pending = fetchCheapestOneWayAcrossMonths({
      origin,
      destination,
      currency,
      startMonth: month,
      months: 1,
      limitPerMonth: MAX_PROVIDER_OBSERVATIONS_PER_MONTH,
      limit: MAX_PROVIDER_OBSERVATIONS_PER_MONTH
    });
    monthlyProviderCache.set(key, pending);
    return pending;
  }

  const completeChains = [];
  const attempts = [];
  let bestPartial = null;

  for (const candidate of startCandidates) {
    const selectedLegs = [];
    const diagnostics = [{ ...firstDiagnostic, candidateDepartureDate: safeDate(candidate.departureDate) }];
    const firstSelected = selectBestUsableObservation([candidate], {
      pickRole: tour.tourRole,
      targetDate: null,
      maxDateShiftDays: 0,
      budgetPressure,
      distanceKm: Number(firstLeg.distanceKm || 0)
    }) || candidate;
    selectedLegs.push(publicSelection(firstSelected, firstLeg, null));

    let targetDate = addDays(firstSelected.departureDate, Math.max(1, Math.round(Number(stops[0]?.nights || 0))));
    let failure = null;

    if (!targetDate) {
      failure = { reason: 'night-allocation-date-error', failedLegNumber: 1, targetDate: null };
    }

    for (let index = 1; !failure && index < legs.length; index += 1) {
      const leg = legs[index];
      const { origin, destination } = routeCodes(leg);
      const month = safeMonth(targetDate);
      if (!month) {
        failure = { reason: 'night-allocation-date-error', failedLegNumber: index, targetDate };
        break;
      }

      const provider = await fetchFollowingMonth(leg, month);
      const monthObservations = (Array.isArray(provider?.observations) ? provider.observations : [])
        .filter((row) => dateWithinHorizon(row?.departureDate, automaticFloor, horizonEnd));
      const observations = exactDateRows(monthObservations, targetDate);

      diagnostics.push({
        legNumber: index + 1,
        origin,
        destination,
        targetDate,
        providerSupported: Boolean(provider?.supported),
        providerReason: provider?.reason || null,
        scannedMonths: provider?.scannedMonths || [],
        eligibleObservationCount: observations.length,
        monthObservationCount: monthObservations.length,
        cacheHit: Boolean(provider?.cacheHit)
      });

      if (!observations.length) {
        failure = {
          reason: 'no-provider-observation-for-required-date',
          failedLegNumber: index + 1,
          targetDate
        };
        break;
      }

      const selected = selectBestUsableObservation(observations, {
        pickRole: tour.tourRole,
        targetDate,
        maxDateShiftDays: 0,
        budgetPressure,
        distanceKm: Number(leg.distanceKm || 0)
      });
      if (!selected?.departureDate) {
        failure = { reason: 'no-acceptable-provider-observation', failedLegNumber: index + 1, targetDate };
        break;
      }

      selectedLegs.push(publicSelection(selected, leg, targetDate));

      if (index < stops.length) {
        const nights = Math.max(1, Math.round(Number(stops[index]?.nights || 0)));
        targetDate = addDays(selected.departureDate, nights);
        if (!targetDate) {
          failure = { reason: 'night-allocation-date-error', failedLegNumber: index + 1, targetDate: null };
          break;
        }
      }
    }

    const attempt = {
      startDate: safeDate(firstSelected.departureDate),
      complete: !failure && selectedLegs.length === legs.length,
      observedLegs: selectedLegs.length,
      reason: failure?.reason || null,
      failedLegNumber: failure?.failedLegNumber || null,
      targetDate: failure?.targetDate || null
    };
    attempts.push(attempt);

    if (attempt.complete) {
      const observedPrice = totalObservedPrice(selectedLegs);
      completeChains.push({
        selectedLegs,
        diagnostics,
        totalObservedFlightPrice: observedPrice,
        rankScore: observedPrice + chainQualityPenalty(selectedLegs)
      });
    } else if (!bestPartial || selectedLegs.length > bestPartial.selectedLegs.length) {
      bestPartial = { selectedLegs, diagnostics, failure };
    }
  }

  if (!completeChains.length) {
    const partial = bestPartial || { selectedLegs: [], diagnostics: [firstDiagnostic], failure: null };
    return {
      complete: false,
      reason: 'no-complete-provider-date-chain',
      failedLegNumber: partial.failure?.failedLegNumber || null,
      targetDate: partial.failure?.targetDate || null,
      automaticFloor,
      horizonStartMonth: firstMonth,
      horizonMonths: 6,
      selectedLegs: partial.selectedLegs,
      diagnostics: partial.diagnostics,
      chainSearch: {
        strategy: 'bounded-exact-chain-search',
        preservedStopNights: true,
        attemptedStartDates: attempts.length,
        viableChains: 0,
        attempts: attempts.slice(0, MAX_CHAIN_START_CANDIDATES)
      }
    };
  }

  completeChains.sort((a, b) => a.rankScore - b.rankScore
    || a.totalObservedFlightPrice - b.totalObservedFlightPrice
    || String(a.selectedLegs[0]?.departureDate || '').localeCompare(String(b.selectedLegs[0]?.departureDate || '')));
  const chosen = completeChains[0];

  return {
    complete: true,
    reason: null,
    automaticFloor,
    horizonStartMonth: firstMonth,
    horizonMonths: 6,
    currency,
    departureDate: chosen.selectedLegs[0]?.departureDate || null,
    returnDate: chosen.selectedLegs[chosen.selectedLegs.length - 1]?.departureDate || null,
    selectedLegs: chosen.selectedLegs,
    totalObservedFlightPrice: chosen.totalObservedFlightPrice,
    sourceType: 'CACHED',
    sourceWording: 'Provider-observed fare dates — current availability still requires revalidation',
    currentAvailabilityVerified: false,
    diagnostics: chosen.diagnostics,
    chainSearch: {
      strategy: 'bounded-exact-chain-search',
      preservedStopNights: true,
      attemptedStartDates: attempts.length,
      viableChains: completeChains.length,
      selectedRankScore: Number(chosen.rankScore.toFixed(2))
    }
  };
}

async function handle(event = {}) {
  const origin = headerValue(event.headers || {}, 'origin');
  if (origin !== STAGING_ORIGIN) return json(403, { ok: false, error: 'staging-origin-not-allowed' }, origin);
  if (eventMethod(event) !== 'GET') return json(405, { ok: false, error: 'GET required' }, origin);
  if (!enabled()) return json(200, { ok: true, supported: false, version: VERSION, revision: REVISION, reason: 'feature-disabled' }, origin);

  const query = queryParams(event);
  const routeId = String(query.routeId || '').trim();
  if (!routeId) return json(400, { ok: false, supported: true, version: VERSION, revision: REVISION, error: 'routeId-required' }, origin);

  try {
    const routePayload = await getMultiCityTours(query);
    const tours = Array.isArray(routePayload?.tours) ? routePayload.tours : [];
    const tour = tours.find((item) => String(item?.tourId || '') === routeId) || null;
    if (!tour) {
      return json(200, {
        ok: true,
        supported: true,
        version: VERSION,
        revision: REVISION,
        complete: false,
        reason: 'route-not-in-current-recommendation-set',
        routeId
      }, origin);
    }

    const plan = await materializeRouteDates({ tour, query });
    return json(200, {
      ok: true,
      supported: true,
      version: VERSION,
      revision: REVISION,
      routeId,
      tourRole: tour.tourRole || null,
      route: [tour.origin?.city, ...tour.stops.map((stop) => stop.city), tour.origin?.city].filter(Boolean),
      stopNights: tour.stops.map((stop) => ({ cityId: stop.cityId, city: stop.city, nights: stop.nights })),
      ...plan,
      bookingCapability: false,
      paymentCapability: false,
      reservationCapability: false
    }, origin);
  } catch (error) {
    return json(200, {
      ok: true,
      supported: true,
      version: VERSION,
      revision: REVISION,
      complete: false,
      reason: 'automatic-date-provider-error',
      message: String(error?.message || error),
      routeId,
      bookingCapability: false,
      paymentCapability: false,
      reservationCapability: false
    }, origin);
  }
}

module.exports = {
  VERSION,
  REVISION,
  ROUTE_PATH,
  STAGING_ORIGIN,
  MINIMUM_LEAD_DAYS,
  enabled,
  preflight,
  handle,
  materializeRouteDates,
  _internal: {
    safeDate,
    safeMonth,
    addDays,
    addMonths,
    dateWithinHorizon,
    exactDateRows,
    routeBudgetPressure,
    routeCodes,
    sameObservation,
    orderedStartCandidates,
    totalObservedPrice,
    chainQualityPenalty
  }
};
