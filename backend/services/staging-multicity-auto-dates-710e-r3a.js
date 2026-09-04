'use strict';

// GV-FLIGHT-710E-R3A — staging-only automatic date materialization for an
// already-selected multi-city route. The browser asks for one route outcome;
// provider credentials and fare-calendar orchestration stay server-side.
//
// This endpoint does NOT book, reserve, order or ticket anything. It uses
// cached/provider fare observations to choose dates, and fails closed when a
// complete exact-date chain cannot be supported by provider evidence.

const { getMultiCityTours } = require('../multicity-routes');
const {
  fetchCheapestOneWayAcrossMonths,
  selectBestUsableObservation
} = require('./cheap-one-way-flights');
const { automaticDateFloor } = require('./price-evidence-integrity');

const VERSION = 'GV-FLIGHT-710E-R3A';
const ROUTE_PATH = '/api/staging/multicity-auto-dates';
const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const MINIMUM_LEAD_DAYS = 14;
const MAX_PROVIDER_CALL_MONTHS_FIRST_LEG = 6;
const MAX_PROVIDER_CALL_MONTHS_FOLLOWING_LEG = 2;

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
    'X-Globevoy-Automatic-Dates': VERSION
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
      'X-Globevoy-Automatic-Dates': VERSION
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
    targetDate,
    evidence: row.priceEvidence || null,
    evidenceId: row.evidenceId || row.priceEvidence?.evidenceId || null,
    sourceType: row.sourceType || row.priceEvidence?.sourceType || 'CACHED',
    availabilityVerified: false,
    bookingCreated: false
  };
}

async function materializeRouteDates({ tour, query = {}, now = new Date() } = {}) {
  const legs = Array.isArray(tour?.legs) ? tour.legs : [];
  const stops = Array.isArray(tour?.stops) ? tour.stops : [];
  if (!legs.length || legs.length !== stops.length + 1) {
    return { complete: false, reason: 'route-structure-incomplete', selectedLegs: [] };
  }

  const currency = String(query.currency || tour?.displayBudget?.currency || 'CAD').trim().toUpperCase();
  const automaticFloor = automaticDateFloor({ now, minimumLeadDays: MINIMUM_LEAD_DAYS });
  const floorMonth = automaticFloor.slice(0, 7);
  const requestedMonth = safeMonth(query.month || query.preferredMonth);
  const firstMonth = requestedMonth && requestedMonth >= floorMonth ? requestedMonth : floorMonth;
  const horizonEnd = addMonths(firstMonth, 6);
  if (!horizonEnd) return { complete: false, reason: 'invalid-planning-horizon', selectedLegs: [] };

  const selectedLegs = [];
  const diagnostics = [];
  const budgetPressure = routeBudgetPressure(tour);
  let targetDate = null;

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index] || {};
    const origin = String(leg?.from?.code || '').trim().toUpperCase();
    const destination = String(leg?.to?.code || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
      return {
        complete: false,
        reason: 'provider-route-code-missing',
        failedLegNumber: index + 1,
        selectedLegs,
        diagnostics
      };
    }

    const scanStartMonth = targetDate ? targetDate.slice(0, 7) : firstMonth;
    const months = targetDate ? MAX_PROVIDER_CALL_MONTHS_FOLLOWING_LEG : MAX_PROVIDER_CALL_MONTHS_FIRST_LEG;
    const provider = await fetchCheapestOneWayAcrossMonths({
      origin,
      destination,
      currency,
      startMonth: scanStartMonth,
      months,
      limitPerMonth: 10,
      limit: 24
    });

    let observations = Array.isArray(provider?.observations) ? provider.observations : [];
    observations = observations.filter((row) => dateWithinHorizon(row?.departureDate, automaticFloor, horizonEnd));
    if (targetDate) observations = exactDateRows(observations, targetDate);

    diagnostics.push({
      legNumber: index + 1,
      origin,
      destination,
      targetDate,
      providerSupported: Boolean(provider?.supported),
      providerReason: provider?.reason || null,
      scannedMonths: provider?.scannedMonths || [],
      eligibleObservationCount: observations.length,
      cacheHit: Boolean(provider?.cacheHit)
    });

    if (!observations.length) {
      return {
        complete: false,
        reason: targetDate ? 'no-provider-observation-for-required-date' : 'no-automatic-date-observation',
        failedLegNumber: index + 1,
        targetDate,
        automaticFloor,
        horizonStartMonth: firstMonth,
        horizonMonths: 6,
        selectedLegs,
        diagnostics
      };
    }

    const selected = selectBestUsableObservation(observations, {
      pickRole: tour.tourRole,
      targetDate,
      maxDateShiftDays: 0,
      budgetPressure,
      distanceKm: Number(leg.distanceKm || 0)
    });
    if (!selected?.departureDate) {
      return {
        complete: false,
        reason: 'no-acceptable-provider-observation',
        failedLegNumber: index + 1,
        selectedLegs,
        diagnostics
      };
    }

    selectedLegs.push(publicSelection(selected, leg, targetDate));

    if (index < stops.length) {
      const nights = Math.max(1, Math.round(Number(stops[index]?.nights || 0)));
      targetDate = addDays(selected.departureDate, nights);
      if (!targetDate) {
        return { complete: false, reason: 'night-allocation-date-error', failedLegNumber: index + 1, selectedLegs, diagnostics };
      }
    }
  }

  const totalObservedFlightPrice = selectedLegs.reduce((sum, leg) => sum + (Number(leg.price) || 0), 0);
  return {
    complete: true,
    reason: null,
    automaticFloor,
    horizonStartMonth: firstMonth,
    horizonMonths: 6,
    currency,
    departureDate: selectedLegs[0]?.departureDate || null,
    returnDate: selectedLegs[selectedLegs.length - 1]?.departureDate || null,
    selectedLegs,
    totalObservedFlightPrice: Number(totalObservedFlightPrice.toFixed(2)),
    sourceType: 'CACHED',
    sourceWording: 'Provider-observed fare dates — current availability still requires revalidation',
    currentAvailabilityVerified: false,
    diagnostics
  };
}

async function handle(event = {}) {
  const origin = headerValue(event.headers || {}, 'origin');
  if (origin !== STAGING_ORIGIN) return json(403, { ok: false, error: 'staging-origin-not-allowed' }, origin);
  if (eventMethod(event) !== 'GET') return json(405, { ok: false, error: 'GET required' }, origin);
  if (!enabled()) return json(200, { ok: true, supported: false, version: VERSION, reason: 'feature-disabled' }, origin);

  const query = queryParams(event);
  const routeId = String(query.routeId || '').trim();
  if (!routeId) return json(400, { ok: false, supported: true, version: VERSION, error: 'routeId-required' }, origin);

  try {
    const routePayload = await getMultiCityTours(query);
    const tours = Array.isArray(routePayload?.tours) ? routePayload.tours : [];
    const tour = tours.find((item) => String(item?.tourId || '') === routeId) || null;
    if (!tour) {
      return json(200, {
        ok: true,
        supported: true,
        version: VERSION,
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
  ROUTE_PATH,
  STAGING_ORIGIN,
  MINIMUM_LEAD_DAYS,
  enabled,
  preflight,
  handle,
  materializeRouteDates,
  _internal: { safeDate, safeMonth, addDays, addMonths, dateWithinHorizon, exactDateRows, routeBudgetPressure }
};
