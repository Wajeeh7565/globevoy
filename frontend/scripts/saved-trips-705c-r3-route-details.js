/* GV-ACCOUNT-705C-R3 — compact multi-city route-details saves for owner-private account storage. */
(function () {
  'use strict';

  if (window.GlobevoySavedTripsRouteDetails705CR3) return;

  const VERSION = 'GV-ACCOUNT-705C-R3';
  const BUTTON_ID = 'gv-mtd-save';
  const MAX_COMPACT_BYTES = 40 * 1024;
  const state = { busy: false, tripId: null, clientSaveKey: null, installed: false };

  function runtime() { return window.GlobevoySavedTrips705C || null; }
  function session() { return window.GlobevoyAuth705B?.getSession?.() || null; }
  function button() { return document.getElementById(BUTTON_ID); }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; } }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function compactString(value, max = 600) { const text = clean(value); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
  function compactPoint(value = {}) {
    const point = object(value);
    const lat = number(point.lat ?? point.latitude, NaN);
    const lng = number(point.lng ?? point.longitude, NaN);
    const out = {};
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90) out.lat = lat;
    if (Number.isFinite(lng) && lng >= -180 && lng <= 180) out.lng = lng;
    return out;
  }
  function compactAirportNode(value = {}) {
    const node = object(value);
    return {
      city: compactString(node.city, 100),
      country: compactString(node.country, 100),
      countryCode: compactString(node.countryCode, 8),
      code: compactString(node.code, 8).toUpperCase(),
      airportCode: compactString(node.airportCode, 8).toUpperCase(),
      displayCode: compactString(node.displayCode, 8).toUpperCase(),
      ...compactPoint(node)
    };
  }
  function compactTrust(value = {}) {
    const trust = object(value);
    return {
      handoffState: compactString(trust.handoffState, 80),
      exactItineraryHint: trust.exactItineraryHint === true
    };
  }
  function compactProviderEvidence(value = {}) {
    const evidence = object(value);
    return {
      departureDate: compactString(evidence.departureDate, 20),
      appliedToEstimate: evidence.appliedToEstimate !== false,
      providerBacked: evidence.providerBacked === true,
      productionEligible: evidence.productionEligible !== false,
      partyTotalAmountDisplay: number(evidence.partyTotalAmountDisplay, 0),
      partyTotalAmountUsd: number(evidence.partyTotalAmountUsd, 0)
    };
  }
  function compactVerification(value = {}) {
    const verification = object(value);
    return {
      verified: verification.verified === true,
      exactDateMatch: verification.exactDateMatch === true,
      exactStayDates: verification.exactStayDates === true,
      productionEligible: verification.productionEligible === true
    };
  }
  function compactLeg(value = {}) {
    const leg = object(value);
    const segments = Array.isArray(leg.segments) ? leg.segments.slice(0, 6).map(segment => ({
      mode: compactString(segment?.mode, 30),
      transportType: compactString(segment?.transportType, 30)
    })) : [];
    return {
      from: compactAirportNode(leg.from),
      to: compactAirportNode(leg.to),
      mode: compactString(leg.mode, 30),
      transportType: compactString(leg.transportType, 30),
      operator: compactString(leg.operator || leg.airline, 120),
      departureDate: compactString(leg.departureDate, 20),
      dateLabel: compactString(leg.dateLabel, 40),
      automaticTourDate: { departureDate: compactString(leg?.automaticTourDate?.departureDate, 20) },
      estimatedDisplayTotal: number(leg.estimatedDisplayTotal, 0),
      partyTotalAmountDisplay: number(leg.partyTotalAmountDisplay, 0),
      partyTotalAmountUsd: number(leg.partyTotalAmountUsd, 0),
      estimatedTransportUsd: number(leg.estimatedTransportUsd, 0),
      estimatedFlightUsd: number(leg.estimatedFlightUsd, 0),
      amountUsd: number(leg.amountUsd, 0),
      distanceKm: number(leg.distanceKm, 0),
      segments,
      providerDateEvidence: compactProviderEvidence(leg.providerDateEvidence || leg.cheapestOneWay),
      providerVerification: compactVerification(leg.providerVerification),
      booking: {
        status: compactString(leg?.booking?.status, 80),
        exactItineraryHint: leg?.booking?.exactItineraryHint === true,
        trust: compactTrust(leg?.booking?.trust)
      }
    };
  }
  function compactHotel(value = {}) {
    const hotel = object(value);
    const providerHotel = object(hotel.providerHotel);
    return {
      name: compactString(hotel.name || hotel.hotelName, 180),
      hotelName: compactString(hotel.hotelName || hotel.name, 180),
      hotelId: compactString(hotel.hotelId || hotel.providerHotelId || providerHotel.hotelId, 120),
      estimatedDisplayTotal: number(hotel.estimatedDisplayTotal, 0),
      partyStayDisplayTotal: number(hotel.partyStayDisplayTotal, 0),
      totalStayDisplay: number(hotel.totalStayDisplay, 0),
      estimatedStayUsd: number(hotel.estimatedStayUsd, 0),
      totalStayUsd: number(hotel.totalStayUsd, 0),
      providerVerification: compactVerification(hotel.providerVerification),
      priceProvenance: { category: compactString(hotel?.priceProvenance?.category, 80) },
      providerHotel: { hotelId: compactString(providerHotel.hotelId, 120) }
    };
  }
  function compactCity(value = {}) {
    const city = object(value);
    return {
      id: compactString(city.id || city.cityId, 120),
      cityId: compactString(city.cityId || city.id, 120),
      city: compactString(city.city, 120),
      country: compactString(city.country, 120),
      countryCode: compactString(city.countryCode, 8),
      code: compactString(city.code || city.airportCode, 8).toUpperCase(),
      airportCode: compactString(city.airportCode || city.code, 8).toUpperCase(),
      nights: Math.max(0, number(city.nights, 0)),
      ...compactPoint(city),
      hotel: compactHotel(city.hotel)
    };
  }
  function compactStay(value = {}) {
    const stay = object(value);
    return {
      city: compactString(stay.city, 120),
      country: compactString(stay.country, 120),
      nights: Math.max(0, number(stay.nights, 0)),
      ...compactPoint(stay),
      estimatedStayUsd: number(stay.estimatedStayUsd, 0),
      hotel: compactHotel(stay.hotel)
    };
  }
  function compactTour(value = {}) {
    const tour = object(value);
    const legs = Array.isArray(tour.backendLegs) ? tour.backendLegs : (Array.isArray(tour.legs) ? tour.legs : []);
    const stays = Array.isArray(tour.stays) ? tour.stays : [];
    const budget = object(tour.budget);
    const displayBudget = object(tour.displayBudget);
    const pricing = object(tour.canonicalPricing);
    const passenger = object(tour.passengerPricing);
    const routeControl = object(tour.routeControl);
    return {
      schemaVersion: 1,
      savedSnapshotMode: 'compact-account-route',
      title: compactString(tour.title, 180),
      routeId: compactString(tour.routeId || tour.tourId, 160),
      tourId: compactString(tour.tourId || tour.routeId, 160),
      pickRole: compactString(tour.pickRole, 80),
      pickRoleLabel: compactString(tour.pickRoleLabel, 100),
      tourRole: compactString(tour.tourRole, 80),
      tourRoleLabel: compactString(tour.tourRoleLabel, 100),
      recommendationLabel: compactString(tour.recommendationLabel, 120),
      recommendationExplanation: compactString(tour.recommendationExplanation, 700),
      whyCitiesWork: compactString(tour.whyCitiesWork, 700),
      displayOptionNumber: Math.max(0, number(tour.displayOptionNumber, 0)),
      departureDate: compactString(tour.departureDate, 20),
      totalNights: Math.max(0, number(tour.totalNights, 0)),
      origin: compactAirportNode(tour.origin),
      cities: (Array.isArray(tour.cities) ? tour.cities : []).slice(0, 12).map(compactCity),
      backendLegs: legs.slice(0, 16).map(compactLeg),
      stays: stays.slice(0, 12).map(compactStay),
      budget: {
        total: clone(budget.total, {}),
        personalReserve: clone(budget.personalReserve || budget.personalExpenseReserve, {}),
        estimatedCoreTotal: clone(budget.estimatedCoreTotal, {}),
        remainingCoreRoom: clone(budget.remainingCoreRoom, {}),
        accommodation: clone(budget.accommodation, {}),
        flightRange: clone(budget.flightRange, {})
      },
      displayBudget: {
        currency: compactString(displayBudget.currency, 8).toUpperCase(),
        totalBudget: number(displayBudget.totalBudget, 0),
        tripEstimate: number(displayBudget.tripEstimate, 0),
        amountLeft: number(displayBudget.amountLeft, 0),
        reserveAmount: number(displayBudget.reserveAmount, 0),
        exchangeRateFromUsd: number(displayBudget.exchangeRateFromUsd, 0)
      },
      canonicalPricing: {
        canonicalDisplayTotal: number(pricing.canonicalDisplayTotal, 0),
        transportDisplayTotal: number(pricing.transportDisplayTotal, 0),
        stayDisplayTotal: number(pricing.stayDisplayTotal, 0),
        exchangeRateFromUsd: number(pricing.exchangeRateFromUsd, 0)
      },
      passengerPricing: {
        adults: Math.max(0, number(passenger.adults, 0)),
        children: Math.max(0, number(passenger.children, 0)),
        infants: Math.max(0, number(passenger.infants, 0)),
        travellers: Math.max(1, number(passenger.travellers || passenger.passengers, 1)),
        passengers: Math.max(1, number(passenger.passengers || passenger.travellers, 1)),
        rooms: Math.max(1, number(passenger.rooms, 1))
      },
      itineraryDatePlan: { canonicalDepartureDate: compactString(tour?.itineraryDatePlan?.canonicalDepartureDate, 20) },
      routeControl: {
        action: compactString(routeControl.action, 40),
        datesAdjusted: routeControl.datesAdjusted === true,
        restoredFromSharedLink: routeControl.restoredFromSharedLink === true,
        message: compactString(routeControl.message, 500)
      }
    };
  }
  function jsonBytes(value) {
    const raw = JSON.stringify(value);
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(raw).length : raw.length;
  }
  function compactAccountSnapshot(currentSnapshot) {
    const body = clone(currentSnapshot?.body, null);
    if (!body?.tripSnapshot?.tour) return currentSnapshot;
    body.tripSnapshot.tour = compactTour(body.tripSnapshot.tour);
    body.tripSnapshot.snapshotMode = 'compact-account-route';
    body.tripSnapshot.savedByVersion = VERSION;
    const compacted = { ...currentSnapshot, body };
    const bytes = jsonBytes(body.tripSnapshot);
    if (bytes > MAX_COMPACT_BYTES) {
      const error = new Error('compact-snapshot-too-large');
      error.status = 413;
      error.compactBytes = bytes;
      throw error;
    }
    return compacted;
  }

  function statusNode() {
    let node = document.getElementById('gv-mtd-account-save-status');
    if (node) return node;
    const actions = document.querySelector('.gv-mtd-actions');
    if (!actions) return null;
    node = document.createElement('p');
    node.id = 'gv-mtd-account-save-status';
    node.className = 'gv-mtd-disclaimer';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    actions.insertAdjacentElement('afterend', node);
    return node;
  }
  function announce(message, kind = '') { const node = statusNode(); if (node) { node.textContent = message || ''; node.dataset.kind = kind; } }
  function setButtonState(saved, busy = false) {
    const node = button();
    if (!node) return;
    node.disabled = Boolean(busy);
    node.setAttribute('aria-busy', String(Boolean(busy)));
    node.setAttribute('aria-pressed', String(Boolean(saved)));
    node.textContent = busy ? 'Saving…' : (saved ? 'Saved to account ✓' : 'Save trip');
  }
  function snapshot() { return runtime()?._internal?.multiSnapshot?.() || null; }
  async function findCloudMatch(currentSnapshot) {
    if (!currentSnapshot || !session() || !runtime()?.api) return null;
    const trips = await runtime().api.list();
    return trips.find((trip) => trip?.tripSnapshot?.clientSaveKey === currentSnapshot.clientSaveKey) || null;
  }
  async function refresh() {
    if (!button() || !session() || !runtime()?.api) return null;
    const currentSnapshot = snapshot();
    if (!currentSnapshot) return null;
    try {
      const match = await findCloudMatch(currentSnapshot);
      state.tripId = match?.tripId || null;
      state.clientSaveKey = currentSnapshot.clientSaveKey;
      setButtonState(Boolean(match));
      return match;
    } catch (_) { return null; }
  }
  function errorMessage(error) {
    const code = String(error?.payload?.error || error?.message || 'saved-trip-update-failed');
    if (error?.status === 401 || code === 'sign-in-required') return 'Sign in again to save this trip to your account.';
    if (error?.status === 413 || /too-large/i.test(code)) return 'This route is still too large to save safely. Your trip is unchanged.';
    if (/sensitive-data/i.test(code)) return 'This route contains provider data that cannot be stored in your account. Your trip is unchanged.';
    return 'We could not update your saved trips right now. Your trip itself is unchanged.';
  }
  async function toggle() {
    if (state.busy || !session() || !runtime()?.api) return;
    const fullSnapshot = snapshot();
    if (!fullSnapshot) { announce('The current route snapshot is not ready yet. Try Save trip again in a moment.', 'error'); return; }
    state.busy = true;
    setButtonState(Boolean(state.tripId), true);
    try {
      let match = null;
      if (state.tripId && state.clientSaveKey === fullSnapshot.clientSaveKey) match = { tripId: state.tripId };
      else match = await findCloudMatch(fullSnapshot);
      if (match?.tripId) {
        await runtime().api.remove(match.tripId);
        state.tripId = null;
        state.clientSaveKey = fullSnapshot.clientSaveKey;
        setButtonState(false);
        announce('Removed from your Globevoy account. Your browser copy is unchanged.', 'success');
      } else {
        const compactSnapshot = compactAccountSnapshot(fullSnapshot);
        const created = await runtime().api.create(compactSnapshot.body);
        state.tripId = created?.tripId || null;
        state.clientSaveKey = fullSnapshot.clientSaveKey;
        setButtonState(true);
        announce('Saved privately to your Globevoy account. Prices will be checked again before booking.', 'success');
      }
    } catch (error) {
      setButtonState(Boolean(state.tripId));
      announce(errorMessage(error), 'error');
    } finally {
      state.busy = false;
      const node = button();
      if (node) { node.disabled = false; node.setAttribute('aria-busy', 'false'); }
    }
  }
  function onClick(event) {
    const target = event.target.closest?.(`#${BUTTON_ID}`);
    if (!target || !session()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggle();
  }
  function install() {
    if (state.installed || !button()) return;
    state.installed = true;
    document.addEventListener('click', onClick, true);
    if (session()) { setTimeout(refresh, 150); setTimeout(refresh, 600); }
  }

  window.GlobevoySavedTripsRouteDetails705CR3 = Object.freeze({
    version: VERSION,
    install,
    refresh,
    _internal: Object.freeze({ snapshot, findCloudMatch, compactAccountSnapshot, compactTour, jsonBytes, errorMessage })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
