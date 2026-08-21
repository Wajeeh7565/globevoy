/* GV-BOOK-706A — owner-private Saved Trip -> Booking Workspace handoff. */
(function () {
  'use strict';

  if (window.GlobevoyMyTripsBooking706A) return;

  const VERSION = 'GV-BOOK-706A';
  const HANDOFF_PREFIX = 'gv.account.booking.handoff.706a.';
  const HANDOFF_TTL_MS = 15 * 60 * 1000;

  function runtime() { return window.GlobevoySavedTrips705C || null; }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function validTripId(value) { return /^[A-Za-z0-9_-]{8,80}$/.test(clean(value)); }
  function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; } }
  function announce(message, kind = '') {
    const node = document.getElementById('gv-saved-trips-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.kind = kind;
  }
  function sameOriginSourceQuery(sourceUrl) {
    try {
      const url = new URL(clean(sourceUrl), location.origin);
      if (url.origin !== location.origin) return new URLSearchParams();
      return url.searchParams;
    } catch (_) { return new URLSearchParams(); }
  }
  function stripUrlFields(subject) {
    if (!subject || typeof subject !== 'object') return;
    ['url', 'bookingUrl', 'providerUrl', 'directSearchUrl', 'groundBookingUrl', 'transportBookingUrl', 'railBookingUrl', 'busBookingUrl', 'hotelUrl', 'imageUrl', 'bookingLink'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(subject, key)) delete subject[key];
    });
  }
  function downgradeLeg(leg) {
    if (!leg || typeof leg !== 'object') return;
    stripUrlFields(leg);
    if (leg.providerDateEvidence && typeof leg.providerDateEvidence === 'object') {
      stripUrlFields(leg.providerDateEvidence);
      leg.providerDateEvidence.providerBacked = false;
      leg.providerDateEvidence.productionEligible = false;
      leg.providerDateEvidence.historicalSnapshot = true;
    }
    if (leg.providerVerification && typeof leg.providerVerification === 'object') {
      leg.providerVerification.verified = false;
      leg.providerVerification.exactDateMatch = false;
      leg.providerVerification.productionEligible = false;
      leg.providerVerification.historicalSnapshot = true;
    }
    if (leg.priceEvidence && typeof leg.priceEvidence === 'object') leg.priceEvidence.sourceType = 'ESTIMATED';
    if (leg.booking && typeof leg.booking === 'object') {
      stripUrlFields(leg.booking);
      leg.booking.status = 'revalidation-required';
      leg.booking.exactItineraryHint = false;
      if (leg.booking.trust && typeof leg.booking.trust === 'object') {
        leg.booking.trust.handoffState = 'revalidation-required';
        leg.booking.trust.exactItineraryHint = false;
      }
    }
  }
  function downgradeHotel(hotel) {
    if (!hotel || typeof hotel !== 'object') return;
    stripUrlFields(hotel);
    if (hotel.providerHotel && typeof hotel.providerHotel === 'object') stripUrlFields(hotel.providerHotel);
    if (hotel.providerVerification && typeof hotel.providerVerification === 'object') {
      hotel.providerVerification.verified = false;
      hotel.providerVerification.exactStayDates = false;
      hotel.providerVerification.productionEligible = false;
      hotel.providerVerification.historicalSnapshot = true;
    }
    if (hotel.priceEvidence && typeof hotel.priceEvidence === 'object') hotel.priceEvidence.sourceType = 'ESTIMATED';
    if (hotel.priceProvenance && typeof hotel.priceProvenance === 'object') hotel.priceProvenance.sourceType = 'ESTIMATED';
    if (hotel.booking && typeof hotel.booking === 'object') stripUrlFields(hotel.booking);
  }
  function accountTourForBooking(trip) {
    const tour = clone(trip?.tripSnapshot?.tour, null);
    if (!tour || !Array.isArray(tour.cities) || !tour.cities.length) return null;
    const capturedAt = clean(trip?.priceSnapshot?.capturedAt || trip?.updatedAt || trip?.createdAt);
    tour.savedAccountContext706A = {
      version: VERSION,
      tripId: clean(trip.tripId),
      capturedAt,
      snapshotOnly: true,
      requiresRevalidation: true
    };
    (Array.isArray(tour.backendLegs) ? tour.backendLegs : []).forEach(downgradeLeg);
    (Array.isArray(tour.legs) ? tour.legs : []).forEach(downgradeLeg);
    (Array.isArray(tour.cities) ? tour.cities : []).forEach(city => downgradeHotel(city?.hotel));
    (Array.isArray(tour.stays) ? tour.stays : []).forEach(stay => downgradeHotel(stay?.hotel));
    return tour;
  }
  function singleOfferForBooking(trip) {
    const snapshot = trip?.tripSnapshot || {};
    const price = trip?.priceSnapshot || {};
    if (snapshot.kind !== 'single' || !clean(snapshot.city)) return null;
    return {
      ...(clone(snapshot.offer, {}) || {}),
      city: clean(snapshot.city),
      country: clean(snapshot.country),
      code: clean(snapshot.code).toUpperCase(),
      nights: Math.max(1, number(snapshot.nights, 1)),
      flight: number(price.flightEstimate, 0),
      stay: number(price.stayEstimate, 0),
      total: number(price.tripEstimate, 0),
      remaining: number(price.remaining, 0),
      _accountTrip706A: clean(trip.tripId),
      _accountSnapshotOnly706A: true
    };
  }
  function bookingUrlForTrip(trip) {
    const snapshot = trip?.tripSnapshot || {};
    const price = trip?.priceSnapshot || {};
    const params = new URLSearchParams();
    params.set('accountTrip', clean(trip.tripId));
    params.set('accountSnapshot', '1');
    if (snapshot.kind === 'multi') {
      params.set('multi', 'true');
      return `booking.html?${params.toString()}`;
    }
    if (snapshot.kind !== 'single') return '';
    const source = sameOriginSourceQuery(snapshot.sourceUrl);
    params.set('multi', 'false');
    params.set('origin', clean(snapshot.origin));
    params.set('city', clean(snapshot.city));
    params.set('country', clean(snapshot.country));
    params.set('destinationCode', clean(snapshot.code).toUpperCase());
    params.set('passengers', String(Math.max(1, number(snapshot.travellers, 1))));
    params.set('currency', clean(price.currency || snapshot.currency || 'CAD').toUpperCase());
    params.set('budget', String(number(price.totalBudget, 0)));
    params.set('total', String(number(price.tripEstimate, 0)));
    params.set('reserve', String(number(price.reserve, 0)));
    params.set('remaining', String(number(price.remaining, 0)));
    ['departureDate', 'returnDate', 'adults', 'children', 'infants', 'rooms'].forEach(key => {
      const value = clean(source.get(key));
      if (value) params.set(key, value);
    });
    return `booking.html?${params.toString()}`;
  }
  function buildHandoff(trip) {
    if (!validTripId(trip?.tripId)) throw new Error('invalid-trip-id');
    const snapshot = trip?.tripSnapshot || {};
    const createdAt = Date.now();
    if (snapshot.kind === 'multi') {
      const tour = accountTourForBooking(trip);
      if (!tour) throw new Error('saved-multi-route-unavailable');
      return {
        version: VERSION,
        tripId: clean(trip.tripId),
        kind: 'multi',
        createdAt,
        expiresAt: createdAt + HANDOFF_TTL_MS,
        tour,
        priceSnapshot: clone(trip.priceSnapshot, {})
      };
    }
    const offer = singleOfferForBooking(trip);
    if (!offer) throw new Error('saved-single-route-unavailable');
    return {
      version: VERSION,
      tripId: clean(trip.tripId),
      kind: 'single',
      createdAt,
      expiresAt: createdAt + HANDOFF_TTL_MS,
      offer,
      priceSnapshot: clone(trip.priceSnapshot, {})
    };
  }
  async function continueToBooking(tripId, button) {
    const id = clean(tripId);
    if (!validTripId(id) || !runtime()?.api?.get) return;
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Loading…'; }
    try {
      // Fetch the exact owner-private record by tripId immediately before handoff.
      // The 705C API derives ownership only from the verified Cognito subject.
      const trip = await runtime().api.get(id);
      if (!trip || clean(trip.tripId) !== id) throw new Error('saved-trip-not-found');
      const handoff = buildHandoff(trip);
      sessionStorage.setItem(`${HANDOFF_PREFIX}${id}`, JSON.stringify(handoff));
      const path = bookingUrlForTrip(trip);
      if (!path) throw new Error('booking-route-unavailable');
      location.assign(path);
    } catch (error) {
      if (button) { button.disabled = false; button.setAttribute('aria-busy', 'false'); button.textContent = 'Continue booking'; }
      announce(error?.status === 401 ? 'Sign in again to continue this saved trip.' : 'This saved trip could not be prepared for booking. Your account data is unchanged.', 'error');
    }
  }
  function enhanceCards() {
    const root = document.getElementById('gv-my-trips-list');
    if (!root || !runtime()?.api?.get) return;
    root.querySelectorAll('.gv-saved-trip-card[data-trip-id]').forEach(card => {
      const actions = card.querySelector('.gv-saved-trip-card__actions');
      if (!actions || actions.querySelector('[data-gv-book-saved]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.gvBookSaved = '706a';
      button.textContent = 'Continue booking';
      actions.insertBefore(button, actions.querySelector('[data-gv-delete-saved]') || null);
    });
  }
  function install() {
    const root = document.getElementById('gv-my-trips-list');
    if (!root) return;
    const params = new URLSearchParams(location.search);
    if (params.get('bookingError')) announce('That private saved-trip booking link could not be restored. Open the trip from My Trips and try again.', 'error');
    root.addEventListener('click', event => {
      const button = event.target.closest?.('[data-gv-book-saved]');
      if (!button) return;
      const card = button.closest('[data-trip-id]');
      if (!card?.dataset.tripId) return;
      void continueToBooking(card.dataset.tripId, button);
    });
    const observer = new MutationObserver(enhanceCards);
    observer.observe(root, { childList: true, subtree: true });
    let attempts = 0;
    const timer = setInterval(() => {
      enhanceCards();
      if (runtime()?.api?.get || ++attempts > 80) clearInterval(timer);
    }, 125);
    enhanceCards();
  }

  window.GlobevoyMyTripsBooking706A = Object.freeze({
    version: VERSION,
    continueToBooking,
    buildHandoff,
    bookingUrlForTrip,
    _internal: Object.freeze({ accountTourForBooking, singleOfferForBooking, validTripId })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();