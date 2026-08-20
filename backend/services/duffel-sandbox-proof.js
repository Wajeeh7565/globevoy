'use strict';

const DUFFEL_PROOF_VERSION = 'GV-BOOK-676A';
const DUFFEL_API_BASE = 'https://api.duffel.com';
const MAX_SLICES = 6;
const MAX_OFFERS = 5;
const DOCS = Object.freeze({
  testMode: 'https://duffel.com/docs/api/overview/test-mode/duffel-airways',
  offerRequests: 'https://duffel.com/docs/api/v2/offer-requests',
  offers: 'https://duffel.com/docs/api/v2/offers',
  orders: 'https://duffel.com/docs/api/orders',
  stays: 'https://duffel.com/docs/guides/getting-started-with-stays',
  payments: 'https://duffel.com/docs/guides/choosing-a-payment-method'
});

class DuffelProofValidationError extends Error {
  constructor(message, code = 'invalid-duffel-proof-request') {
    super(message);
    this.name = 'DuffelProofValidationError';
    this.code = code;
  }
}

function truthy(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function safeDate(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : text;
}

function code(node) {
  const value = String(node?.displayCode || node?.airportCode || node?.code || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : '';
}

function amount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function currency(value, fallback = 'CAD') {
  const cur = String(value || fallback).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cur) ? cur : fallback;
}

function isGroundLeg(leg) {
  return /(ground|rail|bus|train|transfer)/i.test(String(leg?.mode || leg?.transportType || leg?.operator || ''));
}

function tourLegs(tour) {
  return Array.isArray(tour?.backendLegs) ? tour.backendLegs : (Array.isArray(tour?.legs) ? tour.legs : []);
}

function fromNode(leg, index, tour) {
  return leg?.from || (index === 0 ? tour?.origin : tour?.cities?.[index - 1]) || {};
}

function toNode(leg, index, tour, legs) {
  return leg?.to || tour?.cities?.[index] || (index === legs.length - 1 ? tour?.origin : {}) || {};
}

function legDate(leg) {
  const evidence = leg?.providerDateEvidence || leg?.cheapestOneWay || {};
  return safeDate(
    leg?.automaticTourDate?.departureDate ||
    leg?.departureDate ||
    evidence?.departureDate ||
    leg?.dateLabel
  );
}

function normalizeSlices(tour) {
  const legs = tourLegs(tour);
  if (legs.length < 2) {
    throw new DuffelProofValidationError('A multi-city Duffel proof needs at least two dated flight slices.', 'too-few-slices');
  }
  if (legs.length > MAX_SLICES) {
    throw new DuffelProofValidationError(`The sandbox proof supports up to ${MAX_SLICES} flight slices.`, 'too-many-slices');
  }
  const slices = [];
  legs.forEach((leg, index) => {
    if (isGroundLeg(leg)) {
      throw new DuffelProofValidationError('Ground, rail and bus legs cannot be included in a Duffel flight offer request.', 'ground-leg-not-supported');
    }
    const origin = code(fromNode(leg, index, tour));
    const destination = code(toNode(leg, index, tour, legs));
    const departureDate = legDate(leg);
    if (!origin || !destination) {
      throw new DuffelProofValidationError(`Flight slice ${index + 1} needs exact three-letter airport codes.`, 'missing-airport-code');
    }
    if (origin === destination) {
      throw new DuffelProofValidationError(`Flight slice ${index + 1} has the same origin and destination.`, 'same-airport');
    }
    if (!departureDate) {
      throw new DuffelProofValidationError(`Flight slice ${index + 1} needs an exact departure date.`, 'missing-departure-date');
    }
    slices.push({ origin, destination, departure_date: departureDate });
  });
  return slices;
}

function buildPassengers(payload) {
  const requested = Math.max(1, Math.min(9, Math.trunc(Number(payload?.travellers || payload?.passengers || 1) || 1)));
  return Array.from({ length: requested }, () => ({ type: 'adult' }));
}

function buildOfferRequest(payload) {
  const tour = payload?.tour || payload?.itinerary || {};
  return {
    data: {
      cabin_class: 'economy',
      max_connections: Math.max(0, Math.min(2, Math.trunc(Number(payload?.maxConnections ?? 1) || 0))),
      slices: normalizeSlices(tour),
      passengers: buildPassengers(payload)
    }
  };
}

function tokenMode(token) {
  const value = String(token || '').trim();
  if (!value) return 'none';
  if (value.startsWith('duffel_test_')) return 'test';
  if (value.startsWith('duffel_live_')) return 'live';
  return 'unknown';
}

function status(env = process.env) {
  const enabled = truthy(env.ENABLE_DUFFEL_SANDBOX_676A);
  const mode = tokenMode(env.DUFFEL_ACCESS_TOKEN);
  const configured = enabled && mode === 'test';
  return {
    ok: true,
    version: DUFFEL_PROOF_VERSION,
    provider: 'Duffel',
    enabled,
    configured,
    mode,
    sandboxOnly: true,
    orderCreationEnabled: false,
    paymentCollectionEnabled: false,
    capabilities: {
      multiCityFlightSearch: true,
      datedSlicesRequired: true,
      testOfferPricesAreReal: false,
      combinedDisplayTotal: true,
      oneCheckoutScreenPossible: true,
      oneAtomicFlightAndHotelTransactionProven: false,
      liveStaysSearchIncludedInThisProof: false
    },
    limitations: [
      'This proof searches Duffel Flights in test mode only.',
      'Duffel test schedules and prices are not realistic live inventory.',
      'Hotel amounts remain Globevoy estimates in this release.',
      'No order, hotel booking, payment intent or card collection is created.',
      'Flights Orders and Stays Bookings remain separate provider resources.'
    ],
    docs: DOCS
  };
}

function normalizeOffer(offer) {
  const slices = Array.isArray(offer?.slices) ? offer.slices : [];
  const operatingCarriers = [...new Set(slices.flatMap(slice => (slice?.segments || []).map(segment => segment?.operating_carrier?.name).filter(Boolean)))];
  return {
    id: String(offer?.id || ''),
    liveMode: Boolean(offer?.live_mode),
    totalAmount: amount(offer?.total_amount),
    totalCurrency: currency(offer?.total_currency, 'USD'),
    expiresAt: String(offer?.expires_at || ''),
    owner: {
      name: String(offer?.owner?.name || 'Unknown airline'),
      iataCode: String(offer?.owner?.iata_code || '')
    },
    operatingCarriers,
    sliceCount: slices.length,
    slices: slices.map(slice => ({
      origin: String(slice?.origin?.iata_code || slice?.origin?.iata_city_code || ''),
      destination: String(slice?.destination?.iata_code || slice?.destination?.iata_city_code || ''),
      duration: String(slice?.duration || ''),
      segments: (slice?.segments || []).map(segment => ({
        departingAt: String(segment?.departing_at || ''),
        arrivingAt: String(segment?.arriving_at || ''),
        operatingCarrier: String(segment?.operating_carrier?.name || ''),
        flightNumber: String(segment?.operating_carrier_flight_number || '')
      }))
    }))
  };
}

function estimatedHotelSubtotal(payload) {
  if (Number.isFinite(Number(payload?.hotelSubtotal))) return amount(payload.hotelSubtotal);
  const tour = payload?.tour || payload?.itinerary || {};
  const rate = amount(tour?.canonicalPricing?.exchangeRateFromUsd) || 1;
  const direct = Array.isArray(tour?.stays) ? tour.stays : [];
  return (tour?.cities || []).reduce((sum, city, index) => {
    const stay = direct[index] || {};
    const hotel = stay?.hotel || city?.hotel || {};
    const display = Number(hotel?.estimatedDisplayTotal || hotel?.partyStayDisplayTotal || hotel?.totalStayDisplay);
    if (Number.isFinite(display) && display >= 0) return sum + display;
    return sum + amount(hotel?.estimatedStayUsd || hotel?.totalStayUsd || stay?.estimatedStayUsd) * rate;
  }, 0);
}

function estimatedTransferSubtotal(payload) {
  if (Number.isFinite(Number(payload?.transferSubtotal))) return amount(payload.transferSubtotal);
  const tour = payload?.tour || payload?.itinerary || {};
  const rate = amount(tour?.canonicalPricing?.exchangeRateFromUsd) || 1;
  return tourLegs(tour).reduce((sum, leg) => {
    if (!isGroundLeg(leg)) return sum;
    const display = Number(leg?.estimatedDisplayTotal || leg?.partyTotalAmountDisplay);
    if (Number.isFinite(display) && display >= 0) return sum + display;
    return sum + amount(leg?.estimatedTransportUsd || leg?.amountUsd) * rate;
  }, 0);
}

function combinedTotal(selectedOffer, payload) {
  const displayCurrency = currency(payload?.currency || payload?.tour?.budget?.total?.currency || payload?.tour?.displayBudget?.currency || 'CAD');
  const hotelSubtotal = estimatedHotelSubtotal(payload);
  const transferSubtotal = estimatedTransferSubtotal(payload);
  const offerCurrency = selectedOffer?.totalCurrency || '';
  const currencyMatches = Boolean(selectedOffer && offerCurrency === displayCurrency);
  return {
    displayCurrency,
    currencyMatches,
    flightSandboxSubtotal: selectedOffer ? selectedOffer.totalAmount : null,
    flightSandboxCurrency: offerCurrency || null,
    hotelEstimateSubtotal: hotelSubtotal,
    transferEstimateSubtotal: transferSubtotal,
    combinedAmount: currencyMatches ? selectedOffer.totalAmount + hotelSubtotal + transferSubtotal : null,
    combinedAmountStatus: currencyMatches ? 'calculated' : 'currency-conversion-required',
    labels: {
      flight: 'Duffel test-mode flight offer — not a live market price',
      hotel: 'Globevoy hotel estimate — not a Duffel Stays quote',
      transfer: 'Globevoy transfer estimate',
      combined: currencyMatches ? 'Sandbox combined display total' : 'Combined display total unavailable until currencies match'
    }
  };
}

async function duffelRequest(path, options, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('HTTP fetch is unavailable in this runtime.');
  const response = await fetchImpl(`${DUFFEL_API_BASE}${path}`, options);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch (_) { throw new Error('Duffel returned a non-JSON response.'); }
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message || payload?.error?.message || `Duffel request failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

async function runProof(payload = {}, env = process.env, deps = {}) {
  const currentStatus = status(env);
  let request;
  try { request = buildOfferRequest(payload); } catch (error) {
    if (error instanceof DuffelProofValidationError) throw error;
    throw new DuffelProofValidationError(error.message || 'Invalid itinerary.');
  }

  const baseResult = {
    ...currentStatus,
    ok: true,
    requestSummary: {
      sliceCount: request.data.slices.length,
      passengerCount: request.data.passengers.length,
      cabinClass: request.data.cabin_class,
      maxConnections: request.data.max_connections,
      slices: request.data.slices
    },
    bookingArchitecture: {
      flightResource: 'Duffel Flights Order',
      stayResource: 'Duffel Stays Booking',
      oneCheckoutScreenPossible: true,
      oneAtomicTransactionProven: false,
      orderCreationEnabled: false,
      reason: 'This release proves search and combined display totals only. It does not collect payment or create provider bookings.'
    }
  };

  if (!currentStatus.enabled) {
    return { ...baseResult, providerRequestMade: false, reason: 'feature-disabled', offers: [], selectedOffer: null, total: combinedTotal(null, payload) };
  }
  if (currentStatus.mode === 'live') {
    return { ...baseResult, configured: false, providerRequestMade: false, reason: 'live-token-refused-for-sandbox-proof', offers: [], selectedOffer: null, total: combinedTotal(null, payload) };
  }
  if (currentStatus.mode !== 'test') {
    return { ...baseResult, configured: false, providerRequestMade: false, reason: 'duffel-test-token-required', offers: [], selectedOffer: null, total: combinedTotal(null, payload) };
  }

  const timeoutMs = Math.max(5000, Math.min(25000, Math.trunc(Number(env.DUFFEL_TIMEOUT_MS || 18000) || 18000)));
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await duffelRequest('/air/offer_requests?return_offers=true&supplier_timeout=10000&view=offers', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${String(env.DUFFEL_ACCESS_TOKEN).trim()}`
      },
      body: JSON.stringify(request),
      ...(controller ? { signal: controller.signal } : {})
    }, deps);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Duffel sandbox search timed out.');
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const offerRequest = response?.data || {};
  const offers = (Array.isArray(offerRequest?.offers) ? offerRequest.offers : [])
    .map(normalizeOffer)
    .filter(offer => offer.id && offer.sliceCount === request.data.slices.length && !offer.liveMode)
    .sort((a, b) => a.totalAmount - b.totalAmount)
    .slice(0, MAX_OFFERS);
  const selectedOffer = offers[0] || null;
  return {
    ...baseResult,
    configured: true,
    providerRequestMade: true,
    reason: selectedOffer ? 'sandbox-offers-returned' : 'no-matching-sandbox-offers',
    offerRequestId: String(offerRequest?.id || ''),
    liveMode: Boolean(offerRequest?.live_mode),
    offers,
    selectedOffer,
    total: combinedTotal(selectedOffer, payload)
  };
}

module.exports = {
  DUFFEL_PROOF_VERSION,
  DUFFEL_API_BASE,
  DOCS,
  DuffelProofValidationError,
  status,
  normalizeSlices,
  buildOfferRequest,
  normalizeOffer,
  combinedTotal,
  runProof
};
