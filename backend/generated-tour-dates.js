'use strict';
// GV-DATE-666B: canonical itinerary date recalculation.
// Accepts the currently displayed backend-validated tour, applies one chosen
// departure date, rescans/recalculates every later leg, and returns one fully
// synchronized itinerary. The selected route cities are never changed here.

const { enrichTourWithCheapFlights, buildVisualizerTour } = require('./generated-tour');
const { guardEnabled, normalizeAirportIntegrity, evaluateTour } = require('./services/domain/routing/route-feasibility');
const { normalizeParty } = require('./services/domain/pricing/traveller-pricing');
const { LIVE_PROVIDER_VERIFICATION_VERSION, verifyTourWithLiveProviders } = require('./services/live-provider-verification');

const GENERATED_TOUR_DATE_VERSION = '1.1.0-gv-live-667a-provider-reverified-date-sync';

function dateSyncEnabled() {
  return String(process.env.ENABLE_CANONICAL_ITINERARY_DATE_SYNC_666B || '').trim().toLowerCase() === 'true';
}

function clean(value) { return String(value ?? '').trim(); }
function safeIsoDate(value) {
  const text = clean(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
function addDaysIso(value, days) {
  const date = new Date(`${safeIsoDate(value)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stopNights(stop) { return Math.max(1, Math.round(finite(stop?.nights || stop?.minimumSuggestedNights, 2))); }

function queryFromPayload(payload = {}, tour = {}) {
  const input = payload.query && typeof payload.query === 'object' ? { ...payload.query } : {};
  const party = tour.passengerPricing || tour.party || {};
  const budget = tour.budget?.total || {};
  const currency = clean(input.currency || budget.currency || tour.displayBudget?.currency || 'CAD').toUpperCase();
  const totalNights = Math.max(1, Math.round(finite(input.totalNights || tour.totalNights, 0)));
  return {
    ...input,
    currency,
    budget: clean(input.budget || budget.amount || tour.displayBudget?.totalBudget || ''),
    budgetUsd: clean(input.budgetUsd || tour.totalBudgetUsd || ''),
    totalNights: String(totalNights),
    adults: clean(input.adults || party.adults || 1),
    children: clean(input.children || party.children || 0),
    infants: clean(input.infants || party.infants || 0),
    rooms: clean(input.rooms || party.rooms || 1),
    passengers: clean(input.passengers || party.travellers || party.adults || 1),
    departureDate: safeIsoDate(payload.departureDate || input.departureDate)
  };
}

function rawStops(tour = {}) {
  if (Array.isArray(tour.stops) && tour.stops.length) return clone(tour.stops);
  const cities = Array.isArray(tour.cities) ? tour.cities : [];
  const stays = Array.isArray(tour.stays) ? tour.stays : [];
  return cities.map((city, index) => ({
    ...clone(city),
    ...clone(stays[index] || {}),
    cityId: city.cityId || city.id || stays[index]?.cityId || stays[index]?.id || null,
    city: city.city || stays[index]?.city || null,
    country: city.country || stays[index]?.country || '',
    code: city.code || city.airportCode || null,
    airportCode: city.airportCode || city.code || null,
    latitude: city.latitude ?? city.lat,
    longitude: city.longitude ?? city.lng,
    nights: stopNights(stays[index] || city),
    hotel: clone(stays[index]?.hotel || city.hotel || {})
  }));
}

function rawLegs(tour = {}) {
  const source = Array.isArray(tour.legs) && tour.legs.length ? tour.legs : tour.backendLegs;
  return Array.isArray(source) ? clone(source) : [];
}

function stripStaleDateEvidence(leg = {}) {
  const next = { ...leg };
  delete next.cheapestOneWay;
  delete next.providerDateEvidence;
  delete next.providerObservation;
  delete next.liveFareVerified;
  delete next.dateSource;
  delete next.dateLabel;
  delete next.departureDate;
  delete next.booking;
  delete next.bookingUrl;
  delete next.providerUrl;
  // Keep unit pricing, route endpoints, mode, and travel-duration evidence.
  return next;
}

function prepareTourForDate(tour = {}, departureDate) {
  const selected = safeIsoDate(departureDate);
  if (!selected) throw new Error('A valid departure date is required.');
  const stops = rawStops(tour);
  const sourceLegs = rawLegs(tour);
  if (!stops.length || sourceLegs.length < stops.length + 1) {
    throw new Error('The current itinerary is incomplete and cannot be recalculated safely.');
  }

  let currentDate = selected;
  const legs = sourceLegs.map((sourceLeg, index) => {
    const next = stripStaleDateEvidence(sourceLeg);
    const legDate = currentDate;
    const prepared = {
      ...next,
      departureDate: legDate,
      dateLabel: legDate,
      dateSource: 'user-selected-canonical-itinerary-date',
      automaticTourDate: {
        departureDate: legDate,
        source: 'user-selected-canonical-itinerary-date',
        providerBacked: false,
        minDepartureDate: legDate
      }
    };
    if (index < stops.length) currentDate = addDaysIso(legDate, stopNights(stops[index]));
    return prepared;
  });

  for (let index = 0; index < stops.length; index += 1) {
    const arrivalDate = safeIsoDate(legs[index]?.departureDate);
    stops[index] = {
      ...stops[index],
      arrivalDate,
      departureDate: addDaysIso(arrivalDate, stopNights(stops[index])),
      dateSource: 'user-selected-canonical-itinerary-date'
    };
  }

  return {
    ...clone(tour),
    legs,
    stops,
    totalNights: stops.reduce((sum, stop) => sum + stopNights(stop), 0),
    selectedDepartureDate: selected
  };
}

function overBudget(tour = {}, query = {}) {
  const total = finite(tour.estimatedTotalUsd, 0);
  const directBudget = finite(tour.totalBudgetUsd || query.budgetUsd, 0);
  if (directBudget > 0) return total > directBudget + Math.max(5, directBudget * 0.005);
  return false;
}

async function recalculateGeneratedTourDate(payload = {}) {
  if (!dateSyncEnabled()) return { ok: true, supported: false, reason: 'feature-disabled', requiredFlag: 'ENABLE_CANONICAL_ITINERARY_DATE_SYNC_666B=true' };
  const tour = payload.tour && typeof payload.tour === 'object' ? payload.tour : null;
  if (!tour) return { ok: true, supported: false, reason: 'missing-tour', message: 'The current tour was not supplied.' };
  const query = queryFromPayload(payload, tour);
  if (!query.departureDate) return { ok: true, supported: false, reason: 'invalid-departure-date', message: 'Choose a valid departure date.' };

  const prepared = prepareTourForDate(tour, query.departureDate);
  let enrichment = await enrichTourWithCheapFlights(prepared, query);
  const liveVerification = await verifyTourWithLiveProviders(enrichment.tour, query);
  enrichment = { ...enrichment, tour: liveVerification.tour, liveProviderVerification: liveVerification.summary };
  if (liveVerification.summary?.overBudget) {
    return {
      ok: true,
      supported: false,
      version: GENERATED_TOUR_DATE_VERSION,
      reason: 'date-adjustment-provider-verified-over-budget',
      message: 'Provider evidence for that date would push the trip above budget. Keeping the current itinerary.',
      routeControl: { action: 'date', routeCitiesPreserved: true, liveProviderVerification: liveVerification.summary }
    };
  }
  const normalized = guardEnabled() ? normalizeAirportIntegrity(enrichment.tour, query) : enrichment.tour;
  const visualizerTour = buildVisualizerTour(normalized, query, enrichment);
  const guard = evaluateTour(visualizerTour, query);
  if (!guard.accepted) {
    return {
      ok: true,
      supported: false,
      version: GENERATED_TOUR_DATE_VERSION,
      reason: 'date-adjustment-feasibility-guard',
      message: 'That date would make the itinerary too rushed or inconsistent. Keeping the current route.',
      routeControl: { action: 'date', routeCitiesPreserved: true, reasons: guard.reasons, metrics: guard.metrics }
    };
  }
  const resultTour = guard.tour;
  if (resultTour?.itineraryDatePlan?.consistent === false) {
    return {
      ok: true,
      supported: false,
      version: GENERATED_TOUR_DATE_VERSION,
      reason: 'stale-or-mixed-itinerary-dates',
      message: 'The selected date could not be synchronized across every route leg.',
      routeControl: { action: 'date', routeCitiesPreserved: true, itineraryDatePlan: resultTour.itineraryDatePlan }
    };
  }
  if (overBudget(resultTour, query)) {
    return {
      ok: true,
      supported: false,
      version: GENERATED_TOUR_DATE_VERSION,
      reason: 'date-adjustment-over-budget',
      message: 'That date would push the complete trip above the entered budget. Keeping the current itinerary.',
      routeControl: { action: 'date', routeCitiesPreserved: true, estimatedTotalUsd: resultTour.estimatedTotalUsd, budgetUsd: resultTour.totalBudgetUsd }
    };
  }

  const party = normalizeParty(query);
  return {
    ok: true,
    supported: true,
    version: GENERATED_TOUR_DATE_VERSION,
    mode: 'generated-tour-date-recalculation',
    routeControl: {
      enabled: true,
      action: 'date',
      selectedDepartureDate: query.departureDate,
      routeCitiesPreserved: true,
      recalculatedByBackend: true,
      providerVerificationRequired: true,
      providerVerificationVersion: LIVE_PROVIDER_VERIFICATION_VERSION,
      party,
      message: 'Departure date updated. Every later leg, stay window, total, and partner search was recalculated.'
    },
    tour: resultTour,
    tours: [resultTour],
    diagnostics: {
      itineraryDatePlan: resultTour.itineraryDatePlan,
      providerDateSummary: enrichment.summary || null,
      liveProviderVerification: enrichment.liveProviderVerification || null,
      routeFeasibilityGuard: { accepted: true, metrics: guard.metrics, warnings: guard.warnings }
    }
  };
}

module.exports = {
  GENERATED_TOUR_DATE_VERSION,
  dateSyncEnabled,
  recalculateGeneratedTourDate,
  _internal: { safeIsoDate, addDaysIso, queryFromPayload, rawStops, rawLegs, stripStaleDateEvidence, prepareTourForDate, overBudget }
};
