'use strict';

// One authority for the traveller-facing price badge. Amounts in this ledger
// are party totals in ONE currency, never sums of rates and saved estimates.
const VERSION = 'GV-LIVE-712';
const MAX_AGE_MS = 5 * 60 * 1000; // Product freshness policy, not a price guarantee.
const clean = (v) => String(v ?? '').trim();
const currency = (v) => /^[A-Z]{3}$/.test(clean(v).toUpperCase()) ? clean(v).toUpperCase() : '';
const money = (v) => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
const round = (v, code) => Number(v.toFixed(new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits));
const flightLike = (leg) => /flight|\bair\b/.test(`${leg?.mode || ''} ${leg?.transportType || ''}`.toLowerCase());

function freshness(row, nowMs) {
  const observed = Date.parse(row?.observedAt || '');
  const expiry = Date.parse(row?.expiresAt || '');
  return Number.isFinite(observed) && observed <= nowMs && nowMs - observed <= MAX_AGE_MS && Number.isFinite(expiry) && expiry > nowMs;
}

function buildCurrentPricing(payload = {}, trip = {}, options = {}) {
  const nowMs = new Date(options.now || Date.now()).getTime();
  const checkedAt = new Date(nowMs).toISOString();
  const tour = trip?.tripSnapshot?.tour || {};
  const legs = Array.isArray(tour.backendLegs) ? tour.backendLegs : (Array.isArray(tour.legs) ? tour.legs : []);
  const stays = Array.isArray(tour.stops) && tour.stops.length ? tour.stops : Array.isArray(tour.stays) && tour.stays.length ? tour.stays : (tour.cities || []);
  const expectedFlights = legs.map((leg, index) => ({ leg, index })).filter(({ leg }) => flightLike(leg));
  const requiredFlights = expectedFlights.length;
  const requiredHotels = stays.length;
  const displayCurrency = currency(payload.snapshot?.currency || trip.priceSnapshot?.currency || tour.displayBudget?.currency) || 'CAD';
  const party = tour.passengerPricing || {};
  const expectedTravellers = Number(party.travellers || party.passengers || Number(party.adults || 1) + Number(party.children || 0) + Number(party.infants || 0));
  const flights = Array.isArray(payload.flights) ? payload.flights : [];
  const hotels = Array.isArray(payload.hotels) ? payload.hotels : [];
  const reasons = new Set();
  const eligibleFlights = [];
  const eligibleHotels = [];
  function uniqueRow(rows, index) { const matches = rows.filter((row) => row.index === index); return matches.length === 1 ? matches[0] : null; }
  for (const { leg, index } of expectedFlights) {
    const row = uniqueRow(flights, index);
    const exactDate = clean(leg.departureDate || leg.dateLabel || leg.providerDateEvidence?.departureDate).slice(0, 10);
    const valid = row && row.sourceType === 'LIVE' && row.productionEligible === true && row.providerPassengerCount === expectedTravellers && money(row.freshAmount) !== null && currency(row.currency) === displayCurrency && freshness(row, nowMs) && exactDate && row.departureDate === exactDate;
    if (valid) eligibleFlights.push(row);
    else reasons.add(!row ? 'flight-unavailable' : currency(row.currency) !== displayCurrency ? 'flight-currency-mismatch' : !freshness(row, nowMs) ? 'flight-price-expired' : row.providerPassengerCount !== expectedTravellers ? 'flight-travellers-unconfirmed' : 'flight-verification-incomplete');
  }
  for (let index = 0; index < requiredHotels; index += 1) {
    const row = uniqueRow(hotels, index);
    const valid = row && row.productionEligible === true && row.sandbox === false && row.environment === 'production' && row.availabilityVerified === true && row.priceVerified === true && row.dateConfirmed === true && row.travellerCount === expectedTravellers && Number.isInteger(row.roomCount) && row.roomCount > 0 && row.roomCount === Number(party.rooms || 1) && row.taxesAndFeesPresent === true && row.excludedFeesPresent === false && money(row.freshAmount) !== null && currency(row.currency) === displayCurrency && freshness(row, nowMs) && row.checkin && row.checkout && row.checkout > row.checkin;
    if (valid) eligibleHotels.push(row);
    else reasons.add(row?.providerReason || (!row ? 'hotel-unavailable' : currency(row.currency) !== displayCurrency ? 'hotel-currency-mismatch' : !freshness(row, nowMs) ? 'hotel-price-expired' : 'hotel-verification-incomplete'));
  }
  if (legs.length !== requiredFlights) reasons.add('other-transport-not-verified');
  if (!requiredFlights || !requiredHotels) reasons.add('trip-components-missing');
  const liveFlights = eligibleFlights.length;
  const liveHotels = eligibleHotels.length;
  const complete = requiredFlights > 0 && requiredHotels > 0 && requiredFlights === legs.length && liveFlights === requiredFlights && liveHotels === requiredHotels;
  const liveRows = [...eligibleFlights, ...eligibleHotels];
  const status = complete ? 'live' : liveRows.length ? 'partial' : 'estimate';
  const sum = (rows) => round(rows.reduce((n, row) => n + Number(row.freshAmount), 0), displayCurrency);
  const flightsTotal = requiredFlights > 0 && liveFlights === requiredFlights ? sum(eligibleFlights) : null;
  const hotelsTotal = requiredHotels > 0 && liveHotels === requiredHotels ? sum(eligibleHotels) : null;
  const currentTotal = complete ? round(flightsTotal + hotelsTotal, displayCurrency) : null;
  const planningTotal = currency(trip.priceSnapshot?.currency || displayCurrency) === displayCurrency ? money(trip.priceSnapshot?.tripEstimate ?? payload.snapshot?.savedTripTotal) : null;
  const budget = money(trip.priceSnapshot?.totalBudget);
  const reserve = Number(trip.priceSnapshot?.reserve || 0);
  const bookingReady = complete && eligibleFlights.every((row) => row.handoffEnabled === true && /^https:\/\//.test(row.handoffUrl || '')) && eligibleHotels.every((row) => /^https:\/\//.test(row.handoffUrl || ''));
  return {
    version: VERSION, status, label: status === 'live' ? 'Live' : status === 'partial' ? 'Partially live' : 'Estimate', currency: displayCurrency,
    currentTotal, planningTotal, flightsTotal, hotelsTotal, currentKnownSubtotal: liveRows.length ? sum(liveRows) : null,
    requiredFlights, liveFlights, requiredHotels, liveHotels, checkedAt,
    expiresAt: liveRows.length ? new Date(Math.min(...liveRows.map((row) => Math.min(Date.parse(row.expiresAt), Date.parse(row.observedAt) + MAX_AGE_MS)))).toISOString() : null,
    bookingReady, handoffMode: 'external-partner-search', finalPartnerConfirmationRequired: true,
    withinBudget: currentTotal !== null && budget !== null ? currentTotal <= budget - reserve : null,
    reasons: [...reasons], scope: 'flights-and-hotels-for-all-travellers'
  };
}

function applyCurrentPricing(payload, trip, options = {}) {
  if (payload?.ok !== true) return payload;
  const currentPricing = buildCurrentPricing(payload, trip, options);
  return { ...payload, currentPricing, trust: { ...(payload.trust || {}), wholeTripLive: currentPricing.status === 'live', currentTripTotalVerified: currentPricing.currentTotal !== null, finalPartnerConfirmationRequired: true } };
}

module.exports = { VERSION, MAX_AGE_MS, freshness, buildCurrentPricing, applyCurrentPricing };
