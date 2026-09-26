'use strict';

// GV-MVP-666A: passenger-aware flight/transfer pricing and room-aware stay totals.
// All internal totals remain in USD. Provider observations are treated as per-person
// flight fares and per-room nightly stay rates unless the source explicitly says otherwise.

const PRICING_INTEGRITY_VERSION = 'GV-CONTROL-667D';

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback, min, max) {
  return Math.min(max, Math.max(min, Math.round(finite(value, fallback))));
}

function pricingIntegrityEnabled() {
  const raw = String(process.env.ENABLE_PASSENGER_ROOM_PRICING_666A || '').trim().toLowerCase();
  return raw ? raw === 'true' : true;
}

function familyOccupancy669dEnabled() {
  return String(process.env.ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D || '').trim().toLowerCase() === 'true';
}

function normalizeParty(query = {}) {
  const explicitAdults = query.adults !== undefined && String(query.adults).trim() !== '';
  const explicitChildren = query.children !== undefined && String(query.children).trim() !== '';
  const explicitInfants = query.infants !== undefined && String(query.infants).trim() !== '';
  const totalFallback = integer(query.passengers ?? query.travellers ?? query.travelers, 1, 1, 18);
  const children = explicitChildren ? integer(query.children, 0, 0, 12) : 0;
  const infants = explicitInfants ? integer(query.infants, 0, 0, 6) : 0;
  const adults = explicitAdults
    ? integer(query.adults, 1, 1, 12)
    : Math.max(1, totalFallback - children - infants);
  const travellers = adults + children + infants;
  // Children normally occupy a seat. Infant pricing varies significantly by airline,
  // so use a conservative 10% planning allowance until the partner confirms it.
  const flightFareUnits = Number((adults + children + infants * 0.10).toFixed(2));
  const seatCount = adults + children;

  const maxAdultsPerRoom = integer(process.env.GV_MAX_ADULTS_PER_ROOM_666A, 2, 1, 6);
  const configuredMaxGuestsPerRoom = integer(process.env.GV_MAX_GUESTS_PER_ROOM_666A, 3, 1, 8);
  // GV-PROD-669D uses a conservative family planning occupancy of two sleeping
  // guests per room. Partner inventory can later confirm a larger family room,
  // but the MVP must not under-budget a three-person family as one standard room.
  const familyMaxGuestsPerRoom = integer(process.env.GV_MAX_GUESTS_PER_ROOM_669D, 2, 1, 8);
  const maxGuestsPerRoom = familyOccupancy669dEnabled() && children > 0
    ? Math.min(configuredMaxGuestsPerRoom, familyMaxGuestsPerRoom)
    : configuredMaxGuestsPerRoom;
  const minimumRooms = Math.max(
    1,
    Math.ceil(adults / maxAdultsPerRoom),
    Math.ceil((adults + children) / maxGuestsPerRoom)
  );
  const requestedRooms = integer(query.rooms, minimumRooms, 1, 9);
  const rooms = Math.max(minimumRooms, requestedRooms);

  return {
    adults,
    children,
    infants,
    travellers,
    seatCount,
    flightFareUnits,
    rooms,
    maxAdultsPerRoom,
    maxGuestsPerRoom,
    configuredMaxGuestsPerRoom,
    occupancyPolicyVersion: familyOccupancy669dEnabled() ? 'GV-PROD-669D' : PRICING_INTEGRITY_VERSION,
    familyOccupancyConservative: familyOccupancy669dEnabled() && children > 0,
    assumptions: {
      flightFareBasis: 'per-passenger-observation-or-estimate',
      childFareRule: 'one-seat-equivalent-per-child-for-planning; partner confirms exact child fare',
      infantFareRule: 'ten-percent-planning-allowance; partner confirms exact infant fare',
      hotelRateBasis: 'per-room-per-night',
      groundTransferRule: 'public rail/bus estimates are per traveller; private/taxi estimates are per party'
    }
  };
}

function modeText(leg = {}) {
  return `${String(leg.mode || '')} ${String(leg.transportType || '')} ${String(leg.operator || '')}`.trim().toLowerCase();
}

function hasFlightComponent(leg = {}) {
  if (modeText(leg).includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some(segment => `${String(segment?.mode || '')} ${String(segment?.transportType || '')}`.toLowerCase().includes('flight'));
}

function isPrivateTransfer(leg = {}) {
  const text = modeText(leg);
  return /taxi|private|rideshare|ride-share|car hire|rental car|chauffeur/.test(text);
}

function isGroundTransfer(leg = {}) {
  const text = modeText(leg);
  if (hasFlightComponent(leg)) return false;
  return Boolean(text);
}

function transportMultiplier(leg, party) {
  if (isGroundTransfer(leg)) return isPrivateTransfer(leg) ? 1 : party.travellers;
  return party.flightFareUnits;
}

function unitTransportUsd(leg = {}) {
  const existing = finite(leg?.pricingIntegrity?.unitAmountUsd, 0);
  if (existing > 0) return existing;
  return finite(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd, 0);
}

function samePartySnapshot(pricing = {}, party = {}) {
  return Number(pricing.adults) === Number(party.adults)
    && Number(pricing.children) === Number(party.children)
    && Number(pricing.infants) === Number(party.infants)
    && Number(pricing.travellers) === Number(party.travellers);
}

function livePartyTotalUsd(leg = {}, options = {}, party = {}) {
  if (isGroundTransfer(leg)) return null;

  const explicitBasis = String(options.amountBasis || '').trim().toLowerCase();
  if (explicitBasis === 'party-total') {
    const explicit = finite(options.partyTotalAmountUsd ?? options.unitAmountUsd, 0);
    if (explicit > 0) return { amountUsd: explicit, source: 'explicit-party-total-option' };
  }

  const pricing = leg?.pricingIntegrity || {};
  if (String(pricing.amountBasis || '').toLowerCase() === 'party-total'
      && samePartySnapshot(pricing, party)) {
    const preserved = finite(pricing.partyTotalUsd, 0);
    if (preserved > 0) return { amountUsd: preserved, source: 'preserved-pricing-integrity-party-total' };
  }

  const evidenceRows = [leg?.providerDateEvidence, leg?.cheapestOneWay, leg?.providerObservation]
    .filter(row => row && typeof row === 'object');
  for (const evidence of evidenceRows) {
    if (String(evidence.fareAmountBasis || '').trim().toLowerCase() !== 'party-total') continue;
    const evidencePassengers = integer(
      evidence.providerPassengerCount ?? evidence.passengers,
      party.travellers,
      1,
      18
    );
    if (evidencePassengers !== party.travellers) continue;
    const amount = finite(
      evidence.rankingPriceUsd
        ?? evidence.partyTotalAmountUsd
        ?? evidence.providerPartyTotalAmountUsd
        ?? evidence.providerPartyTotalAmount,
      0
    );
    if (amount > 0) return { amountUsd: amount, source: 'live-provider-party-total-evidence' };
  }
  return null;
}

function annotateTransportEvidence(evidence, { partyTotalMode, base, total, party }) {
  if (!evidence || typeof evidence !== 'object') return evidence;
  if (partyTotalMode) {
    return {
      ...evidence,
      fareAmountBasis: 'party-total',
      providerPassengerCount: integer(evidence.providerPassengerCount ?? evidence.passengers, party.travellers, 1, 18),
      partyTotalAmountUsd: total,
      derivedAveragePerFareUnitUsd: party.flightFareUnits > 0
        ? Number((total / party.flightFareUnits).toFixed(2))
        : null,
      passengerPricingApplied: false,
      passengerMultiplierApplied: false,
      providerPartyTotalPreserved: true
    };
  }
  return {
    ...evidence,
    perPassengerAmountUsd: finite(evidence.perPassengerAmountUsd, base),
    partyTotalAmountUsd: total,
    passengerPricingApplied: true,
    passengerMultiplierApplied: true
  };
}

function priceTransportLeg(leg = {}, query = {}, options = {}) {
  const party = options.party || normalizeParty(query);
  const ground = isGroundTransfer(leg);
  const multiplier = transportMultiplier(leg, party);
  const partyTotalEvidence = ground ? null : livePartyTotalUsd(leg, options, party);
  const partyTotalMode = Boolean(partyTotalEvidence && partyTotalEvidence.amountUsd > 0);
  const base = partyTotalMode
    ? partyTotalEvidence.amountUsd / Math.max(0.000001, party.flightFareUnits)
    : (finite(options.unitAmountUsd, 0) || unitTransportUsd(leg));
  const total = Math.round(partyTotalMode ? partyTotalEvidence.amountUsd : base * multiplier);
  const next = {
    ...leg,
    estimatedTransportUsd: total,
    estimatedFlightUsd: ground ? 0 : total,
    amountUsd: total,
    pricingIntegrity: {
      ...(leg.pricingIntegrity || {}),
      version: PRICING_INTEGRITY_VERSION,
      unitAmountUsd: Number(base.toFixed(2)),
      unitBasis: ground
        ? (isPrivateTransfer(leg) ? 'per-party-transfer' : 'per-traveller-transfer')
        : (partyTotalMode ? 'provider-party-total-flight-fare' : 'per-passenger-flight-fare'),
      amountBasis: partyTotalMode ? 'party-total' : 'per-unit',
      sourceAmountUsd: Number((partyTotalMode ? partyTotalEvidence.amountUsd : base).toFixed(2)),
      sourceAmountBasis: partyTotalMode ? 'provider-party-total' : 'unit-amount',
      multiplier: partyTotalMode ? 1 : multiplier,
      partyFareUnits: party.flightFareUnits,
      partyTotalUsd: total,
      providerPartyTotalPreserved: partyTotalMode,
      providerPassengerCount: partyTotalMode ? party.travellers : null,
      partyTotalSource: partyTotalMode ? partyTotalEvidence.source : null,
      adults: party.adults,
      children: party.children,
      infants: party.infants,
      travellers: party.travellers,
      seatCount: party.seatCount
    }
  };
  if (next.providerObservation && typeof next.providerObservation === 'object') {
    next.providerObservation = annotateTransportEvidence(next.providerObservation, { partyTotalMode, base, total, party });
  }
  if (next.cheapestOneWay && typeof next.cheapestOneWay === 'object') {
    next.cheapestOneWay = annotateTransportEvidence(next.cheapestOneWay, { partyTotalMode, base, total, party });
  }
  if (next.providerDateEvidence && typeof next.providerDateEvidence === 'object') {
    next.providerDateEvidence = annotateTransportEvidence(next.providerDateEvidence, { partyTotalMode, base, total, party });
  }
  return next;
}

function baseNightlyPerRoom(hotel = {}, nights = 1) {
  const existing = finite(hotel?.pricingIntegrity?.nightlyPerRoomUsd, 0);
  if (existing > 0) return existing;
  const nightly = finite(hotel.estimatedNightlyUsd || hotel.averageNightlyUsd, 0);
  if (nightly > 0) return nightly;
  const stay = finite(hotel.estimatedStayUsd || hotel.totalStayUsd, 0);
  return stay > 0 ? stay / Math.max(1, nights) : 0;
}

function priceStopStay(stop = {}, query = {}, options = {}) {
  const party = options.party || normalizeParty(query);
  const nights = Math.max(0, integer(stop.nights, 0, 0, 60));
  const hotel = { ...(stop.hotel || {}) };
  const nightlyPerRoom = finite(options.nightlyPerRoomUsd, 0) || baseNightlyPerRoom(hotel, nights || 1);
  const roomCount = Math.max(1, integer(options.rooms, party.rooms, 1, 9));
  const nightlyAllRooms = Math.round(nightlyPerRoom * roomCount);
  const stayTotal = Math.round(nightlyPerRoom * roomCount * nights);
  const pricedHotel = {
    ...hotel,
    estimatedNightlyUsd: Number(nightlyPerRoom.toFixed(2)),
    averageNightlyUsd: Number(nightlyPerRoom.toFixed(2)),
    estimatedNightlyAllRoomsUsd: nightlyAllRooms,
    estimatedStayUsd: stayTotal,
    totalStayUsd: stayTotal,
    rooms: roomCount,
    adults: party.adults,
    children: party.children,
    infants: party.infants,
    pricingIntegrity: {
      ...(hotel.pricingIntegrity || {}),
      version: PRICING_INTEGRITY_VERSION,
      nightlyPerRoomUsd: Number(nightlyPerRoom.toFixed(2)),
      roomCount,
      nights,
      partyStayTotalUsd: stayTotal,
      adults: party.adults,
      children: party.children,
      infants: party.infants,
      rateBasis: 'per-room-per-night'
    }
  };
  return { ...stop, hotel: pricedHotel };
}


function gatewayAccessPricing(origin = {}, party) {
  const gateway = origin.gatewayAirport || null;
  const distanceKm = finite(gateway?.distanceKm, 0);
  if (!gateway || distanceKm <= 0) return null;
  const unitOneWayUsd = Math.round(Math.min(95, Math.max(15, 12 + distanceKm * 0.18)));
  const oneWayPartyUsd = Math.round(unitOneWayUsd * party.travellers);
  const roundTripPartyUsd = oneWayPartyUsd * 2;
  return {
    version: PRICING_INTEGRITY_VERSION,
    originCity: origin.city || origin.displayCity || null,
    gatewayCity: gateway.gatewayCity || null,
    airportCode: gateway.airportCode || origin.airportCode || origin.code || null,
    distanceKm: Math.round(distanceKm),
    transferMode: gateway.transferMode || 'ground-access',
    unitOneWayUsd,
    oneWayPartyUsd,
    roundTripPartyUsd,
    travellers: party.travellers,
    source: 'nearby-airport-ground-access-planning-estimate',
    finalPriceRequiresPartnerConfirmation: true
  };
}


function destinationGatewayAccessPricing(stop = {}, party) {
  const gateway = stop.gatewayAirport || null;
  if (!gateway || String(gateway.transferMode || '').toLowerCase() === 'local-airport') return null;
  const distanceKm = finite(gateway.transferDistanceKm ?? gateway.distanceKm, 0);
  const explicitUnit = finite(gateway.estimatedOneWayUsd, 0);
  const unitOneWayUsd = Math.round(explicitUnit || Math.min(90, Math.max(12, 10 + distanceKm * 0.20)));
  const oneWayPartyUsd = Math.round(unitOneWayUsd * party.travellers);
  const roundTripPartyUsd = oneWayPartyUsd * 2;
  return {
    version: PRICING_INTEGRITY_VERSION,
    destinationCity: stop.city || stop.displayCity || null,
    gatewayCity: gateway.gatewayCity || gateway.city || null,
    airportCode: gateway.airportCode || stop.airportCode || stop.code || null,
    localAirportCode: stop.localAirportCode || null,
    distanceKm: Math.round(distanceKm),
    transferMinutes: finite(gateway.transferMinutes, 0) || null,
    transferMode: gateway.transferMode || 'ground-transfer',
    unitOneWayUsd,
    oneWayPartyUsd,
    roundTripPartyUsd,
    travellers: party.travellers,
    source: 'destination-gateway-transfer-planning-estimate-667d',
    finalPriceRequiresPartnerConfirmation: true,
    note: gateway.note || null
  };
}

function applyTravellerPricingToTour(tour = {}, query = {}) {
  if (!pricingIntegrityEnabled() || !tour || typeof tour !== 'object') return tour;
  const party = normalizeParty(query);
  const legs = (Array.isArray(tour.legs) ? tour.legs : []).map(leg => priceTransportLeg(leg, query, { party }));
  const stops = (Array.isArray(tour.stops) ? tour.stops : []).map(stop => {
    const priced = priceStopStay(stop, query, { party });
    const destinationAccess = destinationGatewayAccessPricing(priced, party);
    return destinationAccess ? { ...priced, destinationAccess, destinationAccessEstimateUsd: destinationAccess.roundTripPartyUsd } : priced;
  });
  const originAccess = gatewayAccessPricing(tour.origin || {}, party);
  const routeTransportEstimateUsd = Math.round(legs.reduce((sum, leg) => sum + finite(leg.estimatedTransportUsd, 0), 0));
  const originAccessEstimateUsd = Math.round(originAccess?.roundTripPartyUsd || 0);
  const destinationAccessEstimateUsd = Math.round(stops.reduce((sum, stop) => sum + finite(stop.destinationAccessEstimateUsd || stop?.destinationAccess?.roundTripPartyUsd, 0), 0));
  const destinationAccesses = stops.map((stop, index) => stop.destinationAccess ? { index, ...stop.destinationAccess } : null).filter(Boolean);
  const totalTransportEstimateUsd = routeTransportEstimateUsd + originAccessEstimateUsd + destinationAccessEstimateUsd;
  const totalHotelEstimateUsd = Math.round(stops.reduce((sum, stop) => sum + finite(stop?.hotel?.estimatedStayUsd, 0), 0));
  const estimatedTotalUsd = totalTransportEstimateUsd + totalHotelEstimateUsd;
  const budget = finite(tour.totalBudgetUsd || query.budgetUsd, 0);
  const reserve = finite(tour.reserveAmountUsd, budget * finite(tour.reservePercent, 0.10));
  const usable = finite(tour.usableTripBudgetUsd, budget - reserve);
  return {
    ...tour,
    legs,
    stops,
    totalFlightEstimateUsd: totalTransportEstimateUsd,
    totalTransportEstimateUsd,
    routeTransportEstimateUsd,
    originAccessEstimateUsd,
    originAccess,
    destinationAccessEstimateUsd,
    destinationAccesses,
    totalHotelEstimateUsd,
    estimatedTotalUsd,
    amountLeftUsd: budget ? budget - estimatedTotalUsd : finite(tour.amountLeftUsd, 0),
    usableBudgetRoomUsd: usable ? usable - estimatedTotalUsd : null,
    affordabilityStatus: budget && estimatedTotalUsd > budget ? 'over-user-budget' : 'within-budget',
    passengerPricing: {
      enabled: true,
      version: PRICING_INTEGRITY_VERSION,
      ...party,
      totalTransportEstimateUsd,
      routeTransportEstimateUsd,
      originAccessEstimateUsd,
      originAccess,
      destinationAccessEstimateUsd,
      destinationAccesses,
      totalHotelEstimateUsd,
      estimatedTotalUsd,
      finalProviderPriceRequired: true
    }
  };
}

function providerFarePartyTotalUsd(perPassengerUsd, query = {}) {
  const party = normalizeParty(query);
  return Math.round(Math.max(0, finite(perPassengerUsd, 0)) * party.flightFareUnits);
}

module.exports = {
  PRICING_INTEGRITY_VERSION,
  pricingIntegrityEnabled,
  familyOccupancy669dEnabled,
  normalizeParty,
  providerFarePartyTotalUsd,
  priceTransportLeg,
  priceStopStay,
  applyTravellerPricingToTour,
  _internal: { destinationGatewayAccessPricing, isGroundTransfer, isPrivateTransfer, transportMultiplier, baseNightlyPerRoom, gatewayAccessPricing, familyOccupancy669dEnabled, samePartySnapshot, livePartyTotalUsd, annotateTransportEvidence }
};
