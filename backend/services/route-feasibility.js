'use strict';

// GV-GUARD-664A — final route feasibility and airport-integrity guard.
// This module never invents prices. It validates/normalizes already-generated
// routes before the deterministic/LLM curator can choose one.

const GUARD_VERSION = 'GV-CONTROL-667D';

function truthy(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function guardEnabled() {
  const explicit = String(process.env.ENABLE_ROUTE_FEASIBILITY_GUARD_664A || '').trim().toLowerCase();
  if (explicit) return explicit === 'true';
  return true;
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function safeCode(value) {
  const code = clean(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function cityName(node = {}) {
  return clean(node.city || node.displayCity || node.name || node.cityName);
}

function countryName(node = {}) {
  return clean(node.country || node.countryName || node.countryCode);
}

function requestedNights(query = {}, tour = {}) {
  const raw = query.totalNights ?? query.nights ?? query.tripNights ?? query.durationNights;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  const tourNights = Number(tour.totalNights);
  if (Number.isFinite(tourNights) && tourNights > 0) return Math.round(tourNights);
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const sum = stops.reduce((total, stop) => total + Math.max(0, number(stop?.nights, 0)), 0);
  return sum || 6;
}

function maxStopsForNights(nights) {
  const n = Math.max(1, Math.round(number(nights, 6)));
  // GV-UX-674A: protect useful time in each city. Four to nine nights support
  // at most two destinations; ten to fourteen may support three; longer trips
  // may support four when the budget and geography also pass.
  if (n <= 9) return 2;
  if (n <= 14) return 3;
  return 4;
}

function maxStopsForTrip(query = {}, tour = {}) {
  const hasExplicitNights = [query.totalNights, query.nights, query.tripNights, query.durationNights]
    .some(value => value !== undefined && value !== null && String(value).trim() !== '');
  const hasTourNights = Number.isFinite(Number(tour.totalNights)) && Number(tour.totalNights) > 0;
  // Before adaptive duration runs, allow at most three stops. Once a trip length
  // exists, apply the stricter nights-based cap.
  const cap = (!hasExplicitNights && !hasTourNights) ? 3 : maxStopsForNights(requestedNights(query, tour));
  const explicit = Number(query.maxStops ?? query.stops);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(cap, Math.round(explicit)));
  return cap;
}

function radians(value) {
  return number(value) * Math.PI / 180;
}

function hasCoordinates(node = {}) {
  const lat = Number(node.latitude ?? node.lat);
  const lng = Number(node.longitude ?? node.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function haversineKm(a = {}, b = {}) {
  if (!hasCoordinates(a) || !hasCoordinates(b)) return 0;
  const lat1 = radians(a.latitude ?? a.lat);
  const lat2 = radians(b.latitude ?? b.lat);
  const dLat = lat2 - lat1;
  const dLng = radians(number(b.longitude ?? b.lng) - number(a.longitude ?? a.lng));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function routeNodes(tour = {}) {
  const origin = tour.origin || {};
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  return [origin, ...stops, origin];
}

function orderedDistanceKm(tour = {}) {
  const nodes = routeNodes(tour);
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i += 1) total += haversineKm(nodes[i], nodes[i + 1]);
  return total;
}

function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const result = [];
  for (let i = 0; i < values.length; i += 1) {
    const head = values[i];
    const rest = values.slice(0, i).concat(values.slice(i + 1));
    for (const tail of permutations(rest)) result.push([head, ...tail]);
  }
  return result;
}

function shortestCycleDistanceKm(tour = {}) {
  const origin = tour.origin || {};
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  if (!stops.length || stops.length > 5 || !hasCoordinates(origin) || stops.some(stop => !hasCoordinates(stop))) return orderedDistanceKm(tour);
  let best = Infinity;
  for (const order of permutations(stops)) {
    const nodes = [origin, ...order, origin];
    let total = 0;
    for (let i = 0; i < nodes.length - 1; i += 1) total += haversineKm(nodes[i], nodes[i + 1]);
    if (total < best) best = total;
  }
  return Number.isFinite(best) ? best : orderedDistanceKm(tour);
}

function macroRegion(country = '') {
  const c = lower(country);
  if (!c) return 'unknown';
  if (['canada', 'united states', 'us', 'usa', 'mexico'].includes(c)) return 'north-america';
  if (['belize', 'guatemala', 'costa rica', 'panama', 'colombia', 'peru', 'ecuador', 'brazil', 'argentina', 'chile', 'cuba', 'dominican republic', 'jamaica'].includes(c)) return 'latin-america-caribbean';
  if (['united kingdom', 'ireland', 'france', 'spain', 'portugal', 'italy', 'germany', 'netherlands', 'belgium', 'austria', 'switzerland', 'czech republic', 'poland', 'hungary', 'greece', 'croatia', 'slovenia', 'denmark', 'sweden', 'norway', 'finland', 'iceland'].includes(c)) return 'europe';
  if (['egypt', 'morocco', 'tunisia', 'turkey', 'türkiye', 'georgia', 'armenia', 'azerbaijan', 'united arab emirates', 'oman', 'qatar', 'jordan', 'lebanon', 'iran', 'iraq', 'israel', 'saudi arabia'].includes(c)) return 'mena-caucasus';
  if (['thailand', 'vietnam', 'malaysia', 'singapore', 'indonesia', 'philippines', 'japan', 'south korea', 'taiwan', 'china', 'india', 'sri lanka', 'nepal', 'pakistan'].includes(c)) return 'asia';
  if (['australia', 'new zealand'].includes(c)) return 'oceania';
  if (['south africa', 'kenya', 'tanzania', 'ghana', 'senegal', 'nigeria', 'ethiopia'].includes(c)) return 'sub-saharan-africa';
  return 'other';
}

const GATEWAY_AIRPORTS = Object.freeze({
  'lucca|italy': {
    airportCode: 'PSA',
    gatewayCity: 'Pisa',
    transferMode: 'ground-transfer',
    transferDistanceKm: 35,
    note: 'Fly through Pisa (PSA), then continue to Lucca by ground transfer.'
  },
  'san miguel de allende|mexico': {
    airportCode: 'BJX',
    gatewayCity: 'León/Guanajuato',
    transferMode: 'ground-transfer',
    transferDistanceKm: 95,
    note: 'Fly through León/Guanajuato (BJX), then continue by ground transfer.'
  },
  'tofino|canada': {
    airportCode: 'YAZ',
    gatewayCity: 'Tofino',
    transferMode: 'local-airport',
    transferDistanceKm: 0,
    transferMinutes: 0,
    estimatedOneWayUsd: 0,
    note: 'Tofino/Long Beach Airport (YAZ) is used when provider support is available.'
  },
  'tulum|mexico': {
    airportCode: 'CUN',
    gatewayCity: 'Cancun',
    transferMode: 'ground-transfer',
    transferDistanceKm: 118,
    transferMinutes: 105,
    estimatedOneWayUsd: 35,
    preferGateway: true,
    note: 'Use Cancun (CUN) as the practical international gateway, then continue to Tulum by ground transfer.'
  },
  'caye caulker|belize': {
    airportCode: 'BZE',
    gatewayCity: 'Belize City',
    transferMode: 'ferry-or-domestic-hop',
    transferDistanceKm: 50,
    transferMinutes: 90,
    estimatedOneWayUsd: 40,
    preferGateway: true,
    note: 'Use Belize City (BZE) as the practical international gateway, then continue to Caye Caulker by ferry or domestic hop.'
  }
});

function gatewayIntegrity667dEnabled() {
  return String(process.env.ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D || '').trim().toLowerCase() === 'true';
}

function gatewayFor(node = {}) {
  const key = `${lower(cityName(node))}|${lower(countryName(node))}`;
  return GATEWAY_AIRPORTS[key] || null;
}

function endpointCode(node = {}) {
  return safeCode(node.airportCode) || safeCode(node.code) || (Array.isArray(node.airportCodes) ? node.airportCodes.map(safeCode).find(Boolean) : null);
}

function explicitOriginAirport(query = {}) {
  const raw = lower(query.origin || query.originCode || query.from || query.startingCity);
  if (/\byhm\b|hamilton/.test(raw)) return 'YHM';
  if (/\bytz\b|billy bishop/.test(raw)) return 'YTZ';
  if (/\bthr\b/.test(raw)) return 'THR';
  if (/\bika\b/.test(raw)) return 'IKA';
  if (/\bcdg\b|charles de gaulle/.test(raw)) return 'CDG';
  if (/\bory\b|orly/.test(raw)) return 'ORY';
  if (/\bbva\b|beauvais/.test(raw)) return 'BVA';
  return null;
}

function normalizeOriginAirport(origin = {}, query = {}, stops = []) {
  const next = { ...origin };
  const city = lower(cityName(next));
  const explicit = explicitOriginAirport(query);
  if (city === 'toronto') {
    // Toronto city searches use Pearson by default. Only a deliberate airport
    // search may keep YHM/YTZ.
    const selected = explicit === 'YHM' || explicit === 'YTZ' ? explicit : 'YYZ';
    next.code = selected;
    next.airportCode = selected;
    next.displayCode = selected;
    next.airportCodes = Array.from(new Set([selected, ...(Array.isArray(next.airportCodes) ? next.airportCodes : []), 'YYZ', 'YTZ', 'YHM']));
    next.airportSelectionReason = selected === 'YYZ' ? 'toronto-default-international-airport-664a' : 'explicit-user-airport-selection';
  }
  if (city === 'tehran') {
    const international = stops.some(stop => lower(countryName(stop)) && lower(countryName(stop)) !== 'iran' && lower(countryName(stop)) !== 'ir');
    const selected = explicit === 'THR' && !international ? 'THR' : 'IKA';
    next.code = selected;
    next.airportCode = selected;
    next.displayCode = selected;
    next.airportCodes = Array.from(new Set([selected, ...(Array.isArray(next.airportCodes) ? next.airportCodes : []), 'IKA', 'THR']));
    next.airportSelectionReason = selected === 'IKA' ? 'tehran-international-default-664a' : 'explicit-domestic-airport-selection';
  }
  if (city === 'paris') {
    // Paris city searches default to a practical main airport. Beauvais is kept
    // only when the user deliberately selects it, and its access burden is priced.
    const selected = ['CDG', 'ORY', 'BVA'].includes(explicit) ? explicit : 'CDG';
    next.code = selected;
    next.airportCode = selected;
    next.displayCode = selected;
    next.airportCodes = Array.from(new Set([selected, 'CDG', 'ORY', 'BVA', ...(Array.isArray(next.airportCodes) ? next.airportCodes : [])]));
    next.airportSelectionReason = selected === 'BVA' ? 'explicit-beauvais-selection-with-access-cost-667b' : 'paris-main-airport-default-667b';
    if (selected === 'BVA') {
      next.gatewayAirport = {
        airportCode: 'BVA',
        gatewayCity: 'Beauvais',
        distanceKm: 85,
        transferMode: 'airport-coach',
        note: 'Paris Beauvais requires a substantial ground transfer; Globevoy includes a planning estimate for airport access.'
      };
    } else if (next.gatewayAirport?.airportCode === 'BVA') {
      delete next.gatewayAirport;
    }
  }
  return next;
}

function normalizeStopAirport(stop = {}) {
  const next = { ...stop };
  const city = lower(cityName(next));
  let existing = endpointCode(next);
  if (city === 'paris' && existing === 'BVA') {
    existing = 'CDG';
    next.code = 'CDG';
    next.airportCode = 'CDG';
    next.displayCode = 'CDG';
    next.airportSelectionReason = 'paris-destination-main-airport-default-667b';
  }
  const gateway = gatewayFor(next);
  if (gatewayIntegrity667dEnabled() && gateway && gateway.preferGateway) {
    const localAirportCode = existing || null;
    next.code = gateway.airportCode;
    next.airportCode = gateway.airportCode;
    next.displayCode = gateway.airportCode;
    next.localAirportCode = localAirportCode;
    next.airportCodes = Array.from(new Set([gateway.airportCode, localAirportCode, ...(Array.isArray(next.airportCodes) ? next.airportCodes.map(safeCode).filter(Boolean) : [])].filter(Boolean)));
    next.gatewayAirport = {
      airportCode: gateway.airportCode,
      gatewayCity: gateway.gatewayCity,
      city: gateway.gatewayCity,
      transferMode: gateway.transferMode,
      transferDistanceKm: gateway.transferDistanceKm,
      transferMinutes: gateway.transferMinutes || null,
      estimatedOneWayUsd: gateway.estimatedOneWayUsd || null,
      destinationCity: cityName(next),
      note: gateway.note
    };
    next.requiresGroundAccessTransfer = gateway.transferMode !== 'local-airport';
    next.airportSelectionReason = 'practical-destination-gateway-667d';
    return next;
  }
  if (existing) {
    next.code = safeCode(next.code) || existing;
    next.airportCode = safeCode(next.airportCode) || existing;
    next.airportCodes = Array.from(new Set([existing, ...(Array.isArray(next.airportCodes) ? next.airportCodes.map(safeCode).filter(Boolean) : [])]));
    return next;
  }
  if (!gateway) return next;
  next.code = gateway.airportCode;
  next.airportCode = gateway.airportCode;
  next.airportCodes = [gateway.airportCode];
  next.gatewayAirport = {
    airportCode: gateway.airportCode,
    gatewayCity: gateway.gatewayCity,
    city: gateway.gatewayCity,
    transferMode: gateway.transferMode,
    transferDistanceKm: gateway.transferDistanceKm,
    transferMinutes: gateway.transferMinutes || null,
    estimatedOneWayUsd: gateway.estimatedOneWayUsd || null,
    destinationCity: cityName(next),
    note: gateway.note
  };
  next.requiresGroundAccessTransfer = gateway.transferMode !== 'local-airport';
  return next;
}

function sameCity(a = {}, b = {}) {
  return lower(cityName(a)) && lower(cityName(a)) === lower(cityName(b));
}

function normalizeLegEndpoints(legs = [], origin = {}, stops = []) {
  const nodes = [origin, ...stops, origin];
  return (Array.isArray(legs) ? legs : []).map((leg, index) => {
    const expectedFrom = nodes[index] || leg.from || {};
    const expectedTo = nodes[index + 1] || leg.to || {};
    const from = { ...(leg.from || {}), ...expectedFrom };
    const to = { ...(leg.to || {}), ...expectedTo };
    const fromCode = endpointCode(expectedFrom);
    const toCode = endpointCode(expectedTo);
    if (fromCode) { from.code = fromCode; from.airportCode = fromCode; }
    if (toCode) { to.code = toCode; to.airportCode = toCode; }
    const destinationGateway = expectedTo.gatewayAirport || null;
    return {
      ...leg,
      from,
      to,
      fromCode: fromCode || leg.fromCode || null,
      toCode: toCode || leg.toCode || null,
      destinationGateway,
      groundAccessTransferRequired: !!destinationGateway && destinationGateway.transferMode !== 'local-airport'
    };
  });
}

function normalizeAirportIntegrity(tour = {}, query = {}) {
  const stops = (Array.isArray(tour.stops) ? tour.stops : []).map(normalizeStopAirport);
  const origin = normalizeOriginAirport(tour.origin || {}, query, stops);
  const legs = normalizeLegEndpoints(tour.legs || [], origin, stops);
  const mapCoordinates = [
    { type: 'origin', cityId: origin.cityId, city: cityName(origin), latitude: origin.latitude, longitude: origin.longitude },
    ...stops.map(stop => ({ type: 'stop', cityId: stop.cityId, city: cityName(stop), latitude: stop.latitude, longitude: stop.longitude })),
    { type: 'return', cityId: origin.cityId, city: cityName(origin), latitude: origin.latitude, longitude: origin.longitude }
  ];
  return { ...tour, origin, stops, legs, mapCoordinates };
}

function legDistances(tour = {}) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const explicit = legs.map(leg => number(leg.distanceKm, 0)).filter(value => value > 0);
  if (explicit.length === legs.length && explicit.length) return explicit;
  const nodes = routeNodes(tour);
  const values = [];
  for (let i = 0; i < nodes.length - 1; i += 1) values.push(haversineKm(nodes[i], nodes[i + 1]));
  return values;
}

function explicitTripNights(query = {}) {
  const raw = query.totalNights ?? query.nights ?? query.tripNights ?? query.durationNights;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function normalizeDurationMinutes(value) {
  let minutes = number(value, 0);
  // Some provider payloads expose duration in seconds. Keep the conversion
  // conservative so a normal 90- to 1200-minute duration is not changed.
  if (minutes > 2500 && minutes < 200000) minutes /= 60;
  return minutes > 0 ? minutes : 0;
}

function estimateLegTravelHours(leg = {}, distanceKm = 0) {
  const mode = `${lower(leg.mode)} ${lower(leg.transportType)} ${lower(leg.type)}`.trim();
  const segments = Array.isArray(leg.segments) ? leg.segments : [];
  const hasFlight = mode.includes('flight') || segments.some(segment => `${lower(segment?.mode)} ${lower(segment?.transportType)}`.includes('flight'));
  const transfers = Math.max(0, Math.round(number(leg.transfers ?? leg.stops ?? leg.connectionCount, 0)));
  const explicitMinutes = normalizeDurationMinutes(
    leg.durationMinutes ?? leg.tripDurationMinutes ?? leg.duration ?? leg.providerDurationMinutes
  );
  if (!hasFlight && (mode.includes('ground') || mode.includes('rail') || mode.includes('bus') || mode.includes('transfer'))) {
    const movingHours = explicitMinutes ? explicitMinutes / 60 : Math.max(0.75, number(distanceKm, 0) / 72);
    return Number((movingHours + 0.9).toFixed(2));
  }
  const airborneHours = explicitMinutes
    ? explicitMinutes / 60
    : Math.max(0.75, number(distanceKm, 0) / 790 + 0.35);
  const airportOverhead = 3.5;
  const connectionOverhead = transfers * 1.75 + (!explicitMinutes && distanceKm > 6500 ? 1.4 : 0);
  return Number((airborneHours + airportOverhead + connectionOverhead).toFixed(2));
}

function stopTravelProfiles(tour = {}, distances = []) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  return stops.map((stop, index) => {
    const inboundDistanceKm = number(distances[index], 0);
    const outboundDistanceKm = number(distances[index + 1], 0);
    const inboundHours = estimateLegTravelHours(legs[index] || {}, inboundDistanceKm);
    const outboundHours = estimateLegTravelHours(legs[index + 1] || {}, outboundDistanceKm);
    const maxDistanceKm = Math.max(inboundDistanceKm, outboundDistanceKm);
    const maxTravelHours = Math.max(inboundHours, outboundHours);
    const ultraLongHaul = maxDistanceKm >= 6500 || maxTravelHours >= 13;
    const longHaul = ultraLongHaul || maxDistanceKm >= 3000 || maxTravelHours >= 8.5;
    const minimumNights = ultraLongHaul ? 4 : longHaul ? 3 : 2;
    const nights = Math.max(0, number(stop.nights, 0));
    // Arrival and departure travel do not consume the full door-to-door burden
    // inside the destination, but they do remove meaningful usable time.
    const usableHours = Math.max(0, nights * 24 - inboundHours * 0.58 - outboundHours * 0.42);
    const minimumUsefulHours = ultraLongHaul ? 56 : longHaul ? 44 : 30;
    return {
      city: cityName(stop),
      nights,
      inboundDistanceKm: Math.round(inboundDistanceKm),
      outboundDistanceKm: Math.round(outboundDistanceKm),
      inboundHours,
      outboundHours,
      maxTravelHours,
      longHaul,
      ultraLongHaul,
      minimumNights,
      usableHours: Number(usableHours.toFixed(1)),
      minimumUsefulHours
    };
  });
}

function evaluateTour(tour = {}, query = {}) {
  if (!guardEnabled()) {
    return {
      accepted: true,
      tour,
      reasons: [],
      warnings: [],
      metrics: { disabled: true }
    };
  }
  const normalized = normalizeAirportIntegrity(tour, query);
  const stops = Array.isArray(normalized.stops) ? normalized.stops : [];
  const nights = requestedNights(query, normalized);
  const explicitNights = explicitTripNights(query);
  const maxStops = maxStopsForNights(nights);
  const reasons = [];
  const warnings = [];

  if (stops.length < 1) reasons.push('at-least-one-destination-required');
  if (stops.length > maxStops) reasons.push(`too-many-stops-for-${nights}-night-trip`);
  if (nights < stops.length * 2) reasons.push('trip-too-rushed-for-stop-count');
  if (stops.some(stop => number(stop.nights, 0) < 2)) reasons.push('minimum-two-nights-per-destination-not-met');

  const allocatedNights = stops.reduce((sum, stop) => sum + Math.max(0, number(stop.nights, 0)), 0);
  if (explicitNights && allocatedNights > explicitNights) reasons.push('allocated-city-nights-exceed-requested-trip-length');
  if (explicitNights && allocatedNights < explicitNights - 1) warnings.push('unallocated-trip-nights-remain');

  const cityKeys = stops.map(stop => `${lower(cityName(stop))}|${lower(countryName(stop))}`);
  if (new Set(cityKeys).size !== cityKeys.length) reasons.push('duplicate-destination-city');

  const stopRegionList = stops.map(stop => macroRegion(countryName(stop))).filter(region => region !== 'unknown');
  const regions = new Set(stopRegionList);
  const originRegion = macroRegion(countryName(normalized.origin));
  if (nights <= 10 && regions.size > 2) reasons.push('too-many-macro-regions-for-short-trip');

  const distances = legDistances(normalized);
  const maxLeg = distances.length ? Math.max(...distances) : 0;
  const sorted = distances.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const ordered = orderedDistanceKm(normalized);
  const shortest = shortestCycleDistanceKm(normalized);
  const backtrackingRatio = shortest > 0 ? ordered / shortest : 1;
  if (backtrackingRatio > 1.42) reasons.push('excessive-geographic-backtracking');
  if (stops.length >= 3 && maxLeg > 3500 && median < 950) reasons.push('isolated-long-haul-after-regional-hops');
  if (stops.length >= 3 && originRegion !== 'unknown') {
    const sameAsOrigin = stopRegionList.filter(region => region === originRegion).length;
    const outsideOriginRegions = new Set(stopRegionList.filter(region => region !== originRegion));
    if (sameAsOrigin >= 2 && outsideOriginRegions.size === 1 && maxLeg > 3500) {
      reasons.push('single-long-haul-outlier-after-regional-stops');
    }
  }

  const legs = Array.isArray(normalized.legs) ? normalized.legs : [];
  const travelHours = distances.map((distance, index) => estimateLegTravelHours(legs[index] || {}, distance));
  const totalTravelHours = travelHours.reduce((sum, value) => sum + value, 0);
  const travelBurdenRatio = totalTravelHours / Math.max(24, nights * 24);
  const stopProfiles = stopTravelProfiles(normalized, distances);

  for (const profile of stopProfiles) {
    if (profile.nights < profile.minimumNights) {
      reasons.push(`insufficient-nights-for-travel-burden:${profile.city || 'destination'}:${profile.minimumNights}`);
    }
    if (profile.usableHours < profile.minimumUsefulHours) {
      reasons.push(`insufficient-usable-destination-time:${profile.city || 'destination'}`);
    }
  }

  // A five-night trip should not be marketed as a multi-city long-haul race.
  // Prefer a single strong destination, or two genuinely nearby cities.
  if (nights <= 5 && stops.length > 1) {
    const longHaulProfiles = stopProfiles.filter(profile => profile.longHaul);
    const interStopKm = distances.length > 2 ? Math.max(...distances.slice(1, -1)) : 0;
    if (longHaulProfiles.length || maxLeg > 3000) reasons.push('five-night-trip-should-not-chain-long-haul-destinations');
    if (interStopKm > 900) reasons.push('five-night-multi-city-stops-are-not-nearby-enough');
    if (totalTravelHours > 22) reasons.push('five-night-trip-loses-too-much-time-to-travel');
  }
  if (nights <= 6 && stops.length > 1 && stopProfiles.some(profile => profile.ultraLongHaul)) {
    reasons.push('short-trip-ultra-long-haul-must-use-fewer-destinations');
  }
  if (nights <= 6 && stops.length > 1 && maxLeg > 3500) {
    const interStopKm = distances.length > 2 ? Math.max(...distances.slice(1, -1)) : 0;
    if (interStopKm > 1500) reasons.push('short-trip-long-haul-cities-are-too-far-apart');
  }
  const maximumTravelBurdenRatio = nights <= 6 ? 0.24 : nights <= 10 ? 0.29 : 0.33;
  if (travelBurdenRatio > maximumTravelBurdenRatio) reasons.push('too-much-of-trip-is-spent-in-transit');

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const inbound = legs[index] || {};
    const outbound = legs[index + 1] || {};
    const usesFlight = [inbound, outbound].some(leg => lower(leg.mode || leg.transportType).includes('flight'));
    if (usesFlight && !endpointCode(stop)) reasons.push(`missing-flightable-airport:${cityName(stop) || index + 1}`);
    if (stop.gatewayAirport) warnings.push(`gateway-airport:${cityName(stop)}:${stop.gatewayAirport.airportCode}`);
  }

  for (let index = 0; index < legs.length; index += 1) {
    const transfers = Number(legs[index]?.transfers ?? legs[index]?.stops ?? legs[index]?.connectionCount);
    if (!Number.isFinite(transfers)) continue;
    if (transfers > 2) reasons.push(`too-many-connections-on-leg-${index + 1}`);
    if (nights <= 6 && transfers > 1) reasons.push(`short-trip-leg-${index + 1}-has-too-many-connections`);
  }

  const accepted = reasons.length === 0;
  return {
    accepted,
    tour: normalized,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    metrics: {
      nights,
      allocatedNights,
      stopCount: stops.length,
      maximumStops: maxStops,
      macroRegionCount: regions.size,
      orderedDistanceKm: Math.round(ordered),
      shortestCycleDistanceKm: Math.round(shortest),
      backtrackingRatio: Number(backtrackingRatio.toFixed(3)),
      longestLegKm: Math.round(maxLeg),
      medianLegKm: Math.round(median),
      estimatedTravelHours: Number(totalTravelHours.toFixed(1)),
      travelBurdenRatio: Number(travelBurdenRatio.toFixed(3)),
      stopTravelProfiles: stopProfiles
    }
  };
}

function guardCandidateTours(tours = [], query = {}) {
  const list = Array.isArray(tours) ? tours.filter(Boolean) : [];
  if (!guardEnabled()) {
    return {
      tours: list,
      diagnostics: { enabled: false, version: GUARD_VERSION, inputCount: list.length, acceptedCount: list.length, rejectedCount: 0, rejected: [] }
    };
  }
  const accepted = [];
  const rejected = [];
  for (let index = 0; index < list.length; index += 1) {
    const result = evaluateTour(list[index], query);
    if (result.accepted) accepted.push(result.tour);
    else rejected.push({
      tourId: list[index]?.tourId || list[index]?.routeId || `candidate-${index + 1}`,
      cities: (list[index]?.stops || []).map(cityName),
      reasons: result.reasons,
      metrics: result.metrics
    });
  }
  return {
    tours: accepted,
    diagnostics: {
      enabled: true,
      version: GUARD_VERSION,
      inputCount: list.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      rejected: rejected.slice(0, 12)
    }
  };
}

module.exports = {
  GUARD_VERSION,
  guardEnabled,
  requestedNights,
  maxStopsForNights,
  maxStopsForTrip,
  normalizeAirportIntegrity,
  evaluateTour,
  guardCandidateTours,
  _internal: {
    haversineKm,
    orderedDistanceKm,
    shortestCycleDistanceKm,
    macroRegion,
    gatewayFor,
  gatewayIntegrity667dEnabled,
    endpointCode,
    normalizeOriginAirport,
    estimateLegTravelHours,
    stopTravelProfiles
  }
};
