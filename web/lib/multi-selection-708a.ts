import type { JsonObject } from '@/lib/contracts';
import type { RecommendationCardModel, ResultsSearch } from '@/lib/recommendations-708a';

function clean(value: unknown): string { return String(value == null ? '' : value).trim(); }
function finite(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function record(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function rows(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as JsonObject[] : []; }
function displayRate(raw: JsonObject, currency: string): number {
  const display = record(raw.displayBudget);
  const canonical = record(raw.canonicalPricing);
  const explicit = finite(display.exchangeRateFromUsd ?? canonical.exchangeRateFromUsd, 0);
  if (explicit > 0) return explicit;
  return ({ USD: 1, CAD: 1.36, AUD: 1.52, EUR: 0.92, GBP: 0.79 } as Record<string, number>)[currency] || 1;
}
function displayFromUsd(value: unknown, raw: JsonObject, currency: string): number { return Math.round(finite(value, 0) * displayRate(raw, currency)); }
function transportLabel(leg: JsonObject): string {
  return clean(leg.transportType || leg.mode || 'connection').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Keep the exact storage shape expected by the legacy multicity visualizer until
// R4 migrates that consumer. This is the React equivalent of adaptBackendTour()
// in mixed-results-674a.js.
export function legacyMultiSelectionPayload(item: RecommendationCardModel, search: ResultsSearch, params: URLSearchParams): JsonObject {
  const raw = item.raw;
  const rawCities = item.cities || [];
  // Older browser/demo tours are already in the consumer shape.
  if (!rows(raw.stops).length && rows(raw.cities).length) return raw;

  const stops = rows(raw.stops);
  const legs = rows(raw.legs);
  const display = record(raw.displayBudget);
  const origin = record(raw.origin);
  const exactStart = clean(params.get('startDate') || params.get('departureDate'));
  const exactEnd = clean(params.get('endDate') || params.get('returnDate'));
  const actualFlightUsd = legs.reduce((sum, leg) => sum + finite(leg.estimatedFlightUsd, 0), 0);
  const groundTransportUsd = legs.reduce((sum, leg) => sum + (clean(leg.mode).toLowerCase() === 'flight' ? 0 : finite(leg.estimatedTransportUsd, 0)), 0);
  const stays = stops.map((stop, index) => ({
    id: clean(stop.cityId || stop.id || rawCities[index]?.id),
    city: clean(stop.city || rawCities[index]?.city),
    country: clean(stop.country || rawCities[index]?.country),
    nights: Math.max(0, Math.round(finite(stop.nights, 0))),
    checkIn: exactStart || 'Flexible timing',
    checkOut: exactEnd || 'Flexible timing',
    dateLabel: exactStart && exactEnd ? `${exactStart} to ${exactEnd}` : 'Flexible timing',
    hotel: stop.hotel || null
  }));
  const internalLegs = legs.slice(1, Math.max(1, legs.length - 1)).map((leg) => {
    const from = record(leg.from); const to = record(leg.to);
    return {
      type: transportLabel(leg), from: clean(from.city), to: clean(to.city),
      amount: displayFromUsd(leg.estimatedTransportUsd, raw, search.currency), mode: clean(leg.mode), source: clean(leg.estimateSource)
    };
  });
  const routeId = clean(raw.tourId || raw.routeId || item.routeId);
  const explanation = Array.isArray(raw.routeExplanation) ? raw.routeExplanation.map(clean).filter(Boolean).join(' ') : clean(raw.recommendationExplanation || raw.whyCitiesWork || item.why);
  const cities = rawCities.map((city) => ({
    id: city.id, city: city.city, country: city.country, airportCode: city.code, code: city.code,
    latitude: city.lat, longitude: city.lng
  }));
  const totalNights = Math.max(1, Math.round(finite(raw.totalNights, stays.reduce((sum, stay) => sum + finite(stay.nights, 0), 0))));
  return {
    routeId,
    title: clean(raw.title || item.title),
    origin: {
      city: clean(origin.city) || search.originCity,
      country: clean(origin.country),
      code: clean(origin.airportCode || origin.code || search.originCode),
      latitude: finite(origin.latitude ?? origin.lat, undefined as unknown as number),
      longitude: finite(origin.longitude ?? origin.lng, undefined as unknown as number)
    },
    cities,
    stays,
    transport: internalLegs,
    backendLegs: legs,
    departureDate: exactStart,
    returnDate: exactEnd,
    totalNights,
    recommendationLabel: clean(raw.tourRoleLabel || raw.recommendationLabel || item.label || 'Best balance'),
    recommendationExplanation: explanation,
    whyCitiesWork: explanation,
    travellerFit: clean(record(raw.budgetAdaptivePolicy).band) ? `Budget-adaptive ${clean(record(raw.budgetAdaptivePolicy).band).replace(/-/g, ' ')} route` : 'Connected multi-city route',
    automaticScore: finite(raw.score ?? raw.automaticScore, item.score),
    pricingStatus: clean(raw.pricingStatus),
    budgetAdaptivePolicy: raw.budgetAdaptivePolicy || null,
    displayBudget: display,
    budget: {
      total: { amount: finite(display.totalBudget, search.budget), currency: search.currency },
      personalReserve: { amount: finite(display.reserveAmount, item.reserveAmount), currency: search.currency },
      personalExpenseReserve: { amount: finite(display.reserveAmount, item.reserveAmount), currency: search.currency },
      usableCoreBudget: { amount: finite(display.usableTripBudget, Math.max(0, search.budget - item.reserveAmount)), currency: search.currency },
      flightRange: {
        minimum: displayFromUsd(actualFlightUsd, raw, search.currency), midpoint: displayFromUsd(actualFlightUsd, raw, search.currency), maximum: displayFromUsd(actualFlightUsd, raw, search.currency), currency: search.currency
      },
      accommodation: { amount: finite(display.accommodationEstimate, 0), currency: search.currency },
      intercity: { amount: displayFromUsd(groundTransportUsd, raw, search.currency), currency: search.currency },
      estimatedCoreTotal: { amount: finite(display.tripEstimate, item.total), currency: search.currency },
      remainingCoreRoom: { amount: finite(display.amountLeft, item.remaining), currency: search.currency }
    }
  };
}
