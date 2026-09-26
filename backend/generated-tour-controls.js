'use strict';
// GV-ROUTE-652A: guarded generated-tour edit controls.
// Supports add, remove, shuffle/replace, and refresh without exposing raw flight search.
// Prices remain planning estimates until partner verification.

const { getGeneratedTour, buildVisualizerTour, enrichTourWithCheapFlights, _internal: generatedTourInternal } = require('./generated-tour');
const { loadGroupedCityFoundation } = require('./data/grouped-city-foundation');
const { resolveOrigin } = require('./data/destination-meta');
const { attachTourPresentation } = require('./budget-presentation');
const { GUARD_VERSION, guardEnabled, maxStopsForTrip, normalizeAirportIntegrity, evaluateTour } = require('./services/route-feasibility');
const { PRICING_INTEGRITY_VERSION, normalizeParty, applyTravellerPricingToTour } = require('./services/domain/pricing/traveller-pricing');
const { LIVE_PROVIDER_VERIFICATION_VERSION, verifyTourWithLiveProviders } = require('./services/live-provider-verification');

const CONTROL_VERSION = '2.2.0-gv-quality-680b-saved-route-recovery';
const MIN_STOPS = 2;
const MAX_STOPS = 5;
const RESERVE_PERCENT = 0.10;

function stableStopIdentityEnabled() {
  return String(process.env.ENABLE_STABLE_ROUTE_CONTROLS_667C || '').trim().toLowerCase() === 'true';
}

function stakeholderReadiness669eEnabled() {
  return String(process.env.ENABLE_STAKEHOLDER_READINESS_669E || '').trim().toLowerCase() === 'true';
}


function routeControl667dEnabled() {
  const raw = String(process.env.ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D || '').trim().toLowerCase();
  return raw === 'true';
}
function safeIsoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
function addDaysIso(value, days) {
  const raw = safeIsoDate(value);
  if (!raw) return null;
  const date = new Date(`${raw}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.round(finiteNumber(days, 0))));
  return date.toISOString().slice(0, 10);
}
function todayIsoUtc() { return new Date().toISOString().slice(0, 10); }
function automaticLeadDays680B(query = {}) {
  const raw = Number(query.minimumLeadDays || query.automaticLeadDays || process.env.GV_AUTOMATIC_MIN_LEAD_DAYS || 14);
  return Math.max(7, Math.min(Number.isFinite(raw) ? Math.round(raw) : 14, 60));
}
function adjustedControlDepartureDate680B(query = {}) {
  const requested = safeIsoDate(query.departureDate || query.currentDepartureDate);
  if (!requested) return null;
  const exact = String(query.dateMode || '').trim().toLowerCase() === 'exact' || String(query.flexible ?? '').trim().toLowerCase() === 'false';
  if (exact) return requested;
  const floor = addDaysIso(todayIsoUtc(), automaticLeadDays680B(query));
  return requested >= floor ? requested : floor;
}
function applyPreservedDateSchedule(tour = {}, departureDate) {
  const selected = safeIsoDate(departureDate);
  if (!selected) return { tour, preserved: false };
  const stops = (Array.isArray(tour.stops) ? tour.stops : []).map(stop => ({ ...stop }));
  const legs = (Array.isArray(tour.legs) ? tour.legs : []).map(leg => ({ ...leg }));
  if (!stops.length || legs.length < stops.length + 1) return { tour, preserved: false };
  let current = selected;
  for (let index = 0; index < legs.length; index += 1) {
    legs[index] = {
      ...legs[index],
      departureDate: current,
      dateLabel: current,
      dateSource: 'route-control-preserved-date-667d',
      automaticTourDate: { departureDate: current, source: 'route-control-preserved-date-667d', providerBacked: false }
    };
    if (index < stops.length) {
      const nights = Math.max(1, Math.round(finiteNumber(stops[index].nights, 2)));
      stops[index] = { ...stops[index], arrivalDate: current, departureDate: addDaysIso(current, nights), dateSource: 'route-control-preserved-date-667d' };
      current = stops[index].departureDate;
    }
  }
  return { tour: { ...tour, legs, stops, selectedDepartureDate: selected }, preserved: true };
}

const REGION_NIGHTLY_USD = {
  'central-europe': 112,
  'east-asia': 105,
  'eastern-europe': 82,
  'mexico-central-america-caribbean': 92,
  'middle-east': 110,
  'north-africa': 72,
  'north-america-east': 145,
  'north-america-west': 150,
  'northern-europe': 130,
  'oceania': 140,
  'south-america': 82,
  'south-asia': 64,
  'southeast-asia': 68,
  'southern-europe': 102,
  'sub-saharan-africa': 88,
  'western-europe': 122
};

function normalizeCityKey(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function finiteNumber(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function roundTo(value, step = 1) { return Math.round(value / step) * step; }
function radians(degrees) { return degrees * Math.PI / 180; }
function haversineKm(a, b) {
  const lat1 = radians(finiteNumber(a.latitude ?? a.lat));
  const lat2 = radians(finiteNumber(b.latitude ?? b.lat));
  const dLat = lat2 - lat1;
  const dLng = radians(finiteNumber(b.longitude ?? b.lng) - finiteNumber(a.longitude ?? a.lng));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function normalizeBudgetUsd(query = {}) {
  if (query.budgetUsd !== undefined && String(query.budgetUsd).trim() !== '') return Math.max(1, finiteNumber(query.budgetUsd, 0));
  const budget = Math.max(1, finiteNumber(query.budget, 0));
  const currency = String(query.currency || 'USD').toUpperCase();
  if (currency === 'CAD') return budget * finiteNumber(process.env.CAD_TO_USD, 0.735);
  if (currency === 'AUD') return budget * finiteNumber(process.env.AUD_TO_USD, 0.66);
  if (currency === 'EUR') return budget * 1.08;
  if (currency === 'GBP') return budget * 1.27;
  return budget;
}
function indexes() {
  const foundation = loadGroupedCityFoundation();
  const records = foundation.records || [];
  const byId = new Map();
  const byLocationCode = new Map();
  const byAirportCode = new Map();
  const byCityCountry = new Map();
  const byCityName = new Map();
  for (const record of records) {
    byId.set(String(record.cityId || '').toLowerCase(), record);
    const locationCode = String(record.providerSupport?.flight?.locationCode || '').toUpperCase();
    if (locationCode) byLocationCode.set(locationCode, record);
    for (const code of record.providerSupport?.flight?.airportCodes || []) byAirportCode.set(String(code).toUpperCase(), record);
    const cityKey = normalizeCityKey(record.displayCity);
    byCityCountry.set(`${cityKey}|${String(record.countryCode || '').toUpperCase()}`, record);
    if (!byCityName.has(cityKey)) byCityName.set(cityKey, []);
    byCityName.get(cityKey).push(record);
  }
  return { records, byId, byLocationCode, byAirportCode, byCityCountry, byCityName };
}
function resolveOriginRecord(query, idx) {
  const requestedOrigin = String(query.origin || query.originCode || '').trim();
  const resolved = resolveOrigin(requestedOrigin);
  if (resolved) {
    const cityMatch = idx.byCityCountry.get(`${normalizeCityKey(resolved.city)}|${String(resolved.countryCode || '').toUpperCase()}`) || null;
    if (stakeholderReadiness669eEnabled() && cityMatch) return cityMatch;
    return idx.byLocationCode.get(String(resolved.code || '').toUpperCase())
      || idx.byAirportCode.get(String(resolved.airportCode || '').toUpperCase())
      || cityMatch;
  }
  const upper = requestedOrigin.toUpperCase();
  return idx.byLocationCode.get(upper) || idx.byAirportCode.get(upper) || idx.records.find(item => normalizeCityKey(item.displayCity) === normalizeCityKey(requestedOrigin)) || null;
}
function parseStops(value) { return String(value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean); }
function parseCurrentStopRefs(query = {}) {
  if (stableStopIdentityEnabled() && String(query.currentStopRefs || '').trim()) {
    try {
      const parsed = JSON.parse(String(query.currentStopRefs));
      if (Array.isArray(parsed)) {
        return parsed
          .filter(item => item && typeof item === 'object')
          .map(item => ({
            cityId: String(item.cityId || item.id || '').trim().toLowerCase(),
            code: String(item.code || item.locationCode || '').trim().toUpperCase(),
            airportCode: String(item.airportCode || '').trim().toUpperCase(),
            gatewayAirportCode: String(item.gatewayAirportCode || item.gatewayCode || '').trim().toUpperCase(),
            city: String(item.city || item.displayCity || '').trim(),
            country: String(item.country || '').trim(),
            countryCode: String(item.countryCode || '').trim().toUpperCase()
          }))
          .filter(item => item.cityId || item.code || item.airportCode || item.gatewayAirportCode || item.city);
      }
    } catch (_) {
      // Fall through to the legacy comma-separated list for backward compatibility.
    }
  }
  return parseStops(query.currentStops).map(cityId => ({ cityId }));
}
function existingStopRecordAllowed(record, originRecord) {
  if (!record || !originRecord || String(record.cityId || '') === String(originRecord.cityId || '')) return false;
  return Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude));
}
function resolveExistingStopRef(ref = {}, idx, originRecord) {
  let record = null;
  const cityId = String(ref.cityId || ref.id || '').trim().toLowerCase();
  if (cityId) record = idx.byId.get(cityId) || null;
  const codes = [ref.code, ref.locationCode, ref.airportCode, ref.gatewayAirportCode, ref.gatewayCode]
    .map(value => String(value || '').trim().toUpperCase())
    .filter(Boolean);
  for (const code of codes) {
    if (record) break;
    record = idx.byLocationCode.get(code) || idx.byAirportCode.get(code) || null;
  }
  const city = String(ref.city || ref.displayCity || '').trim();
  const countryCode = String(ref.countryCode || '').trim().toUpperCase();
  if (!record && city && countryCode) record = idx.byCityCountry.get(`${normalizeCityKey(city)}|${countryCode}`) || null;
  if (!record && city) {
    const matches = idx.byCityName.get(normalizeCityKey(city)) || [];
    const country = normalizeCityKey(ref.country);
    record = matches.find(item => countryCode && String(item.countryCode || '').toUpperCase() === countryCode)
      || matches.find(item => country && normalizeCityKey(item.country) === country)
      || (matches.length === 1 ? matches[0] : null);
  }
  return existingStopRecordAllowed(record, originRecord) ? record : null;
}
function resolveCurrentStopRecords(query, idx, originRecord) {
  const refs = parseCurrentStopRefs(query);
  const records = [];
  const unresolved = [];
  const seen = new Set();
  for (const ref of refs) {
    const record = stableStopIdentityEnabled()
      ? resolveExistingStopRef(ref, idx, originRecord)
      : idx.byId.get(String(ref.cityId || '').toLowerCase());
    if (!record || (!stableStopIdentityEnabled() && !recordEligible(record, originRecord))) {
      unresolved.push(ref);
      continue;
    }
    const key = String(record.cityId || '').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      records.push(record);
    }
  }
  return { refs, records, unresolved };
}
function recordEligible(record, originRecord) {
  if (!record || !originRecord || record.cityId === originRecord.cityId) return false;
  if (!['GROUP_1', 'GROUP_2'].includes(record.group)) return false;
  if (record.providerSupport?.bothProviderReady !== true) return false;
  if (record.multiCitySuitability?.status !== 'strong') return false;
  if (String(record.multiCitySuitability?.activationTier || '').toUpperCase() !== 'CORE') return false;
  if (!Number.isFinite(Number(record.latitude)) || !Number.isFinite(Number(record.longitude))) return false;
  const originLocation = String(originRecord.providerSupport?.flight?.locationCode || '').toUpperCase();
  const destinationLocation = String(record.providerSupport?.flight?.locationCode || '').toUpperCase();
  if (originLocation && destinationLocation && originLocation === destinationLocation) return false;
  return true;
}
function seedOffset(query) { const raw = String(query.variant || query.seed || Date.now()); let n = 0; for (const ch of raw) n = (n * 31 + ch.charCodeAt(0)) % 100000; return n; }

function budgetContext(query = {}) {
  const budgetUsd = normalizeBudgetUsd(query);
  const reserveUsd = Math.round(budgetUsd * RESERVE_PERCENT);
  const usableUsd = Math.max(1, budgetUsd);
  const toleranceUsd = Math.max(18, budgetUsd * 0.025);
  return { budgetUsd, reserveUsd, usableUsd, toleranceUsd, ceilingUsd: budgetUsd + toleranceUsd };
}
function maxStopsForBudget(query = {}) {
  const { budgetUsd } = budgetContext(query);
  let budgetCap = MAX_STOPS;
  if (budgetUsd < 1100) budgetCap = 2;
  else if (budgetUsd < 1900) budgetCap = 3;
  else if (budgetUsd < 2800) budgetCap = 4;
  return guardEnabled() ? Math.min(budgetCap, maxStopsForTrip(query)) : budgetCap;
}
function maxNightsForBudget(query = {}, stopCount = 2) {
  const { budgetUsd } = budgetContext(query);
  // GV-UX-674A keeps adaptive duration stable when a route is edited instead of
  // silently collapsing a 6/8/10/12-night trip back to the older short caps.
  if (budgetUsd < 1100) return Math.max(stopCount * 2, 6);
  if (budgetUsd < 1900) return Math.max(stopCount * 2, 8);
  if (budgetUsd < 2800) return Math.max(stopCount * 2, 10);
  return Math.max(stopCount * 2, 14);
}
function estimateRecordsUsd(records, originRecord, query = {}) {
  const party = normalizeParty(query);
  const nights = allocateNights(records, query);
  const nodes = [originRecord, ...records, originRecord];
  let transport = 0;
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const leg = estimateTransportUsd(nodes[i], nodes[i + 1]);
    transport += leg.costUsd * (leg.mode === 'flight' ? party.flightFareUnits : party.travellers);
  }
  const hotel = records.reduce((sum, record, index) => sum + nightlyUsd(record) * nights[index] * party.rooms, 0);
  return Math.round(transport + hotel);
}
function budgetDecision(records, originRecord, query = {}) {
  const ctx = budgetContext(query);
  const estimatedUsd = estimateRecordsUsd(records, originRecord, query);
  return { ...ctx, estimatedUsd, withinBudget: estimatedUsd <= ctx.ceilingUsd };
}
function budgetMessage(decision, action) {
  const overUsd = Math.max(0, Math.round(decision.estimatedUsd - decision.usableUsd));
  if (action === 'add') return `Adding another destination would exceed the trip budget by about US$${overUsd}. Keeping the current route.`;
  if (action === 'shuffle' || action === 'replace') return `That replacement would exceed the trip budget by about US$${overUsd}. Keeping the current route.`;
  return `This route is over the trip budget by about US$${overUsd}. Try a larger budget or fewer stops.`;
}

function candidateReplacements({ query, idx, originRecord, currentStopIds, target }) {
  const used = new Set(currentStopIds.map(String));
  used.add(String(originRecord.cityId || '').toLowerCase());
  const targetCluster = target?.multiCitySuitability?.regionCluster || originRecord?.multiCitySuitability?.regionCluster || null;
  const targetCountry = target?.countryCode || originRecord?.countryCode || null;
  const candidates = idx.records
    .filter(record => recordEligible(record, originRecord))
    .filter(record => !used.has(String(record.cityId || '').toLowerCase()))
    .map(record => {
      const sameCluster = targetCluster && record.multiCitySuitability?.regionCluster === targetCluster ? 1 : 0;
      const sameCountry = targetCountry && record.countryCode === targetCountry ? 1 : 0;
      const distance = haversineKm(target || originRecord, record);
      const readiness = finiteNumber(record.multiCitySuitability?.readinessScore, 0);
      const groupBalance = target && target.group !== record.group ? 14 : 0;
      const estimatedLeg = estimateTransportUsd(target || originRecord, record).costUsd;
      return { record, score: sameCluster * 55 + sameCountry * 18 + readiness * 0.28 + groupBalance - distance / 220 - estimatedLeg / 32 };
    })
    .sort((a, b) => b.score - a.score || a.record.cityId.localeCompare(b.record.cityId))
    .map(item => item.record);
  const offset = seedOffset(query);
  if (!candidates.length) return [];
  return [...candidates.slice(offset), ...candidates.slice(0, offset)];
}
function chooseBudgetFitReplacement({ query, idx, originRecord, currentRecords, targetIndex, action }) {
  const target = currentRecords[Math.max(0, Math.min(currentRecords.length - 1, targetIndex))] || currentRecords[currentRecords.length - 1] || originRecord;
  const candidates = candidateReplacements({ query, idx, originRecord, currentStopIds: currentRecords.map(r => r.cityId), target });
  let lowestOverBudget = null;
  for (const candidate of candidates.slice(0, 60)) {
    let tentative = currentRecords.slice();
    if (action === 'add') tentative.push(candidate);
    else tentative[Math.max(0, Math.min(tentative.length - 1, targetIndex))] = candidate;
    const decision = budgetDecision(tentative, originRecord, query);
    if (decision.withinBudget) return { record: candidate, decision };
    if (!lowestOverBudget || decision.estimatedUsd < lowestOverBudget.decision.estimatedUsd) lowestOverBudget = { record: candidate, decision };
  }
  return { record: null, decision: lowestOverBudget?.decision || null };
}
function chooseReplacement({ query, idx, originRecord, currentStopIds, target }) {
  return candidateReplacements({ query, idx, originRecord, currentStopIds, target })[0] || null;
}

function replacementOptions674A(query, idx, originRecord, currentRecords, stopIndex, limit = 4) {
  const safeIndex = Math.max(0, Math.min(currentRecords.length - 1, Math.floor(finiteNumber(stopIndex, 0))));
  const target = currentRecords[safeIndex] || originRecord;
  const currentDecision = budgetDecision(currentRecords, originRecord, query);
  const candidates = candidateReplacements({
    query,
    idx,
    originRecord,
    currentStopIds: currentRecords.map(record => record.cityId),
    target
  });
  const options = [];
  for (const candidate of candidates.slice(0, 100)) {
    const tentative = currentRecords.slice();
    tentative[safeIndex] = candidate;
    const decision = budgetDecision(tentative, originRecord, query);
    if (!decision.withinBudget) continue;
    const nights = allocateNights(tentative, query)[safeIndex] || 2;
    const distanceKm = Math.round(haversineKm(target, candidate));
    const sameCluster = target?.multiCitySuitability?.regionCluster && target.multiCitySuitability.regionCluster === candidate.multiCitySuitability?.regionCluster;
    options.push({
      cityId: candidate.cityId,
      city: candidate.displayCity,
      country: candidate.country,
      countryCode: candidate.countryCode,
      code: candidate.providerSupport?.flight?.locationCode || null,
      airportCode: (candidate.providerSupport?.flight?.airportCodes || [])[0] || null,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      group: candidate.group,
      nights,
      estimatedTotalUsd: decision.estimatedUsd,
      estimatedDeltaUsd: Math.round(decision.estimatedUsd - currentDecision.estimatedUsd),
      distanceFromCurrentStopKm: distanceKm,
      reason: sameCluster
        ? 'Fits the same route region with a practical budget estimate.'
        : 'Adds a different discovery while keeping the full route inside budget.'
    });
    if (options.length >= Math.max(1, Math.min(5, limit))) break;
  }
  return options;
}
function normalizeStopRecords(query, idx, originRecord) {
  return resolveCurrentStopRecords(query, idx, originRecord).records;
}
function targetRecord(records, stopIndex) { return records[Math.max(0, Math.min(records.length - 1, stopIndex))] || null; }

function mutateStopRecords(query, idx, originRecord) {
  const action = String(query.action || 'refresh').trim().toLowerCase();
  const stopIndex = Math.max(0, Math.floor(finiteNumber(query.stopIndex, 0)));
  const stopResolution = resolveCurrentStopRecords(query, idx, originRecord);
  const records = stopResolution.records;
  const allowedMaxStops = Math.min(MAX_STOPS, maxStopsForBudget(query));
  const minimumStops = action === 'restore' ? 1 : MIN_STOPS;
  if (stableStopIdentityEnabled() && stopResolution.unresolved.length) {
    return {
      supported: false,
      reason: 'route-stop-identity-unresolved',
      message: 'Globevoy could not safely identify every current destination, so the route was left unchanged. Refresh the tour and try again.',
      unresolvedStops: stopResolution.unresolved
    };
  }
  let next = records.slice(0, allowedMaxStops);
  let message = 'Route refreshed within your trip budget.';
  if (!next.length && action !== 'restore') {
    const fallback = chooseBudgetFitReplacement({ query, idx, originRecord, currentRecords: [], targetIndex: 0, action: 'add' }).record
      || chooseReplacement({ query, idx, originRecord, currentStopIds: [], target: originRecord });
    if (fallback) next = [fallback];
  }
  if (action === 'remove') {
    if (next.length <= MIN_STOPS) return { supported: false, reason: 'minimum-two-stops', message: 'This route needs at least two destination stops before removal.' };
    next.splice(stopIndex, 1); message = 'Destination removed and route rebalanced within budget.';
  } else if (action === 'add') {
    if (next.length >= allowedMaxStops) return { supported: false, reason: 'trip-max-stops', message: `This trip length and budget support up to ${allowedMaxStops} destination stop${allowedMaxStops === 1 ? '' : 's'}. Increase the trip length or budget before adding another city.` };
    const fit = chooseBudgetFitReplacement({ query, idx, originRecord, currentRecords: next, targetIndex: next.length - 1, action: 'add' });
    if (!fit.record) return { supported: false, reason: 'no-affordable-add-candidate', message: fit.decision ? budgetMessage(fit.decision, 'add') : 'No add-destination candidate could stay inside the trip budget.' };
    next.push(fit.record); message = `${fit.record.displayCity} added and route estimate kept inside budget.`;
  } else if (action === 'shuffle' || action === 'replace') {
    if (!next.length) return { supported: false, reason: 'no-current-stops', message: 'No current stops were available to shuffle.' };
    const target = targetRecord(next, stopIndex);
    const requestedReplacementId = String(query.replacementCityId || query.replacementId || '').trim().toLowerCase();
    let fit;
    if (requestedReplacementId) {
      const requested = idx.byId.get(requestedReplacementId) || null;
      const alreadyUsed = next.some((record, index) => index !== stopIndex && String(record.cityId || '').toLowerCase() === requestedReplacementId);
      if (!requested || alreadyUsed || !recordEligible(requested, originRecord)) {
        return { supported: false, reason: 'invalid-replacement-choice', message: 'That replacement is no longer available for this route. Choose another city.' };
      }
      const tentative = next.slice();
      tentative[stopIndex] = requested;
      const decision = budgetDecision(tentative, originRecord, query);
      fit = decision.withinBudget ? { record: requested, decision } : { record: null, decision };
    } else {
      fit = chooseBudgetFitReplacement({ query, idx, originRecord, currentRecords: next, targetIndex: stopIndex, action: 'shuffle' });
    }
    if (!fit.record) return { supported: false, reason: 'no-affordable-shuffle-candidate', message: fit.decision ? budgetMessage(fit.decision, 'shuffle') : 'No replacement city could stay inside the trip budget.' };
    next[stopIndex] = fit.record; message = `${target?.displayCity || 'Destination'} swapped for ${fit.record.displayCity}, within budget.`;
  } else if (action === 'restore') { message = 'Saved route restored with its selected destinations and budget guardrails.'; } else if (action === 'date') { message = 'Departure date updated and the complete itinerary was recalculated.'; } else { message = 'Route refreshed with the current stops and budget guardrails.'; }
  const unique = [...new Map(next.map(record => [record.cityId, record])).values()].slice(0, allowedMaxStops);
  if (unique.length < minimumStops) {
    const providedCount = stopResolution.refs.length;
    return {
      supported: false,
      reason: providedCount >= minimumStops ? 'route-stop-identity-unresolved' : (minimumStops === 1 ? 'minimum-one-stop' : 'minimum-two-stops'),
      message: providedCount >= minimumStops
        ? 'Globevoy could not safely preserve every saved destination, so the route was left unchanged.'
        : (minimumStops === 1 ? 'A saved route needs at least one destination stop.' : 'A generated tour needs at least two destination stops.')
    };
  }
  if (stakeholderReadiness669eEnabled() && action === 'restore' && generatedTourInternal?.allTourStopsProductionActive) {
    const active = generatedTourInternal.allTourStopsProductionActive({ stops: unique.map(record => ({ cityId: record.cityId, city: record.displayCity, countryCode: record.countryCode, code: record.providerSupport?.flight?.locationCode || null })) });
    if (!active) return { supported: false, reason: 'saved-route-inactive-destination', message: 'This saved route contains a destination that is no longer production-active. Generate a fresh route instead.' };
  }
  const decision = budgetDecision(unique, originRecord, query);
  if (!decision.withinBudget && action !== 'restore') return { supported: false, reason: 'over-budget', message: budgetMessage(decision, action), budgetGuardrail: decision };
  if (!decision.withinBudget && action === 'restore') message = `Saved route restored, but the current planning estimate is over budget by about US$${Math.max(0, Math.round(decision.estimatedUsd - decision.budgetUsd))}. Review current partner prices before booking.`;
  return { supported: true, records: unique, action, message, budgetGuardrail: decision, restoredOverBudget: action === 'restore' && !decision.withinBudget, allowedMaxStops };
}
function originPublic(record) {
  return { cityId: record.cityId, city: record.displayCity, country: record.country, countryCode: record.countryCode, code: record.providerSupport?.flight?.locationCode || null, airportCode: (record.providerSupport?.flight?.airportCodes || [])[0] || null, latitude: record.latitude, longitude: record.longitude, isOrigin: true };
}
function node(record) { return { cityId: record.cityId, city: record.displayCity, code: record.providerSupport?.flight?.locationCode || null, latitude: record.latitude, longitude: record.longitude }; }
function estimateTransportUsd(from, to) { const km = haversineKm(from, to); if (from.countryCode === to.countryCode && km <= 750) return { mode: 'ground', transportType: km <= 260 ? 'bus-or-shuttle' : 'rail-or-bus', distanceKm: Math.round(km), costUsd: roundTo(clamp(28 + km * 0.16, 35, 150), 5) }; return { mode: 'flight', transportType: 'flight', distanceKm: Math.round(km), costUsd: roundTo(clamp(95 + km * 0.075, 75, 520), 5) }; }
function nightlyUsd(record) { const cluster = record.multiCitySuitability?.regionCluster; const base = REGION_NIGHTLY_USD[cluster] || 100; const depth = record.providerSupport?.hotel?.depth || record.multiCitySuitability?.hotelDepth || 'unknown'; const depthMul = depth === 'very-strong' ? .96 : depth === 'strong' ? 1 : depth === 'standard' ? 1.05 : depth === 'limited' ? 1.12 : 1.15; const groupMul = record.group === 'GROUP_1' ? 1.04 : .94; return roundTo(base * depthMul * groupMul * .78, 5); }
function allocateNights(records, query) { const stopCount = Math.max(1, records.length); const requested = Math.round(finiteNumber(query.totalNights, stopCount * 2)); const capped = Math.min(maxNightsForBudget(query, stopCount), Math.max(stopCount * 2, requested)); const total = Math.max(stopCount * 2, capped); const base = Math.floor(total / stopCount); let rem = total - base * stopCount; return records.map(() => base + (rem-- > 0 ? 1 : 0)); }
function buildControlledTour(records, originRecord, query, meta) {
  const origin = originPublic(originRecord);
  const nights = allocateNights(records, query);
  const stops = records.map((record, index) => { const nightly = nightlyUsd(record); return { cityId: record.cityId, city: record.displayCity, country: record.country, countryCode: record.countryCode, code: record.providerSupport?.flight?.locationCode || null, airportCodes: record.providerSupport?.flight?.airportCodes || [], group: record.group, groupSubtype: record.groupSubtype, regionCluster: record.multiCitySuitability?.regionCluster || null, latitude: record.latitude, longitude: record.longitude, nights: nights[index], hotel: { provider: 'Agoda', providerCityId: record.providerSupport?.hotel?.cityId || null, hotelCoverageCount: record.providerSupport?.hotel?.hotelCount || 0, coverageDepth: record.providerSupport?.hotel?.depth || null, estimatedNightlyUsd: nightly, estimatedStayUsd: nightly * nights[index], lodgingStyle: 'value', estimateSource: 'route-control-region-hotel-planning-fallback', livePriceVerified: false }, replaceable: true, removable: true }; });
  const nodes = [originRecord, ...records, originRecord];
  const legs = [];
  for (let i = 0; i < nodes.length - 1; i++) { const selected = estimateTransportUsd(nodes[i], nodes[i + 1]); legs.push({ legNumber: i + 1, from: node(nodes[i]), to: node(nodes[i + 1]), mode: selected.mode, transportType: selected.transportType, distanceKm: selected.distanceKm, estimatedTransportUsd: selected.costUsd, estimatedFlightUsd: selected.mode === 'flight' ? selected.costUsd : 0, estimateSource: selected.mode === 'flight' ? 'route-control-distance-flight-planning-fallback' : 'route-control-ground-planning-fallback', liveFareVerified: false, providerVerificationRequired: true }); }
  const totalTransport = legs.reduce((s, l) => s + finiteNumber(l.estimatedTransportUsd), 0);
  const totalHotel = stops.reduce((s, stop) => s + finiteNumber(stop.hotel?.estimatedStayUsd), 0);
  const total = Math.round(totalTransport + totalHotel);
  const budgetUsd = normalizeBudgetUsd(query);
  const reserve = Math.round(budgetUsd * RESERVE_PERCENT);
  const usable = budgetUsd - reserve;
  const raw = { tourId: `gv652a-${meta.action}-${records.map(r => r.cityId).join('-')}`, tourRole: meta.action === 'add' ? 'expanded-route' : meta.action === 'shuffle' ? 'shuffled-route' : meta.action === 'restore' ? 'saved-route' : 'refreshed-route', tourRoleLabel: meta.action === 'add' ? 'Expanded route' : meta.action === 'shuffle' ? 'Shuffled route' : meta.action === 'restore' ? 'Saved route' : 'Refreshed route', origin, stops, legs, totalNights: stops.reduce((s, st) => s + st.nights, 0), totalDistanceKm: legs.reduce((s, l) => s + finiteNumber(l.distanceKm), 0), totalFlightEstimateUsd: totalTransport, totalTransportEstimateUsd: totalTransport, totalHotelEstimateUsd: totalHotel, estimatedTotalUsd: total, totalBudgetUsd: budgetUsd, reservePercent: RESERVE_PERCENT, reserveAmountUsd: reserve, usableTripBudgetUsd: usable, amountLeftUsd: usable - total, affordabilityStatus: usable >= total ? 'within-protected-budget' : 'over-budget', pricingStatus: 'route-control-planning-estimates-provider-verification-required', selectionSource: meta.action === 'restore' ? 'saved-route-restoration-669e' : 'user-route-control-recalculation', mapCoordinates: [{ type: 'origin', cityId: origin.cityId, city: origin.city, latitude: origin.latitude, longitude: origin.longitude }, ...stops.map(stop => ({ type: 'stop', cityId: stop.cityId, city: stop.city, latitude: stop.latitude, longitude: stop.longitude })), { type: 'return', cityId: origin.cityId, city: origin.city, latitude: origin.latitude, longitude: origin.longitude }], routeExplanation: [`Route updated by ${meta.action}.`, 'Transport and hotel values are recalculated planning estimates until partner confirmation.'], editableActions: { removeStop: stops.length > MIN_STOPS, replaceStop: true, addStop: stops.length < maxStopsForBudget(query), reorderStops: true, undo: true } };
  const airportNormalized = guardEnabled() ? normalizeAirportIntegrity(raw, query) : raw;
  const passengerPriced = attachTourPresentation(applyTravellerPricingToTour(airportNormalized, query), query);
  return buildVisualizerTour(passengerPriced, query, { summary: { enabled: false, source: 'route-control-planning-fallback', scannedLegCount: 0, liveProviderCallsMade: 0, passengerPricingVersion: PRICING_INTEGRITY_VERSION } });
}
async function getGeneratedTourControl(query = {}) {
  if (String(process.env.ENABLE_GENERATED_TOUR_651A || '').trim().toLowerCase() !== 'true') return { ok: true, supported: false, reason: 'feature-disabled', requiredFlag: 'ENABLE_GENERATED_TOUR_651A=true' };
  const action = String(query.action || 'refresh').trim().toLowerCase();
  if (action === 'refresh' && !String(query.currentStops || '').trim()) return getGeneratedTour(query);
  const idx = indexes();
  const originRecord = resolveOriginRecord(query, idx);
  if (!originRecord) {
    const regenerated = await getGeneratedTour(query);
    const tour = regenerated.tour || (Array.isArray(regenerated.tours) ? regenerated.tours[0] : null);
    if (tour) {
      return {
        ...regenerated,
        version: CONTROL_VERSION,
        mode: 'generated-tour-control-global-fallback',
        routeControl: {
          enabled: true,
          action,
          message: 'This origin uses global fallback coverage, so the route was regenerated with budget guardrails.',
          recalculatedByBackend: true,
          providerVerificationRequired: true,
          limitedControlsForGlobalOrigin: true
        },
        tour,
        tours: [tour]
      };
    }
    return { ok: true, supported: false, reason: 'origin-not-resolved', message: 'This origin is searchable, but route editing needs global fallback coverage.', tour: null, tours: [] };
  }
  if (action === 'replacement-options') {
    const stopResolution = resolveCurrentStopRecords(query, idx, originRecord);
    if (stableStopIdentityEnabled() && stopResolution.unresolved.length) {
      return { ok: true, supported: false, version: CONTROL_VERSION, reason: 'route-stop-identity-unresolved', message: 'Globevoy could not safely identify every current destination, so replacement choices were not generated.' };
    }
    if (!stopResolution.records.length) {
      return { ok: true, supported: false, version: CONTROL_VERSION, reason: 'no-current-stops', message: 'No current destinations were available to replace.' };
    }
    const stopIndex = Math.max(0, Math.floor(finiteNumber(query.stopIndex, 0)));
    const options = replacementOptions674A(query, idx, originRecord, stopResolution.records, stopIndex, finiteNumber(query.optionLimit, 4));
    return {
      ok: true,
      supported: options.length > 0,
      version: CONTROL_VERSION,
      mode: 'generated-tour-replacement-options',
      message: options.length ? `Choose one of ${options.length} budget-safe replacement cities.` : 'No replacement city passed the current budget and route checks.',
      replacementOptions: options,
      routeControl: {
        enabled: true,
        action,
        stopIndex,
        allowedMaxStops: maxStopsForBudget(query),
        optionCount: options.length,
        recalculatedByBackend: true,
        providerVerificationRequired: true
      }
    };
  }

  const edited = mutateStopRecords(query, idx, originRecord);
  if (!edited.supported) return { ok: true, supported: false, version: CONTROL_VERSION, reason: edited.reason, message: edited.message, budgetGuardrail: edited.budgetGuardrail || null, routeControl: edited, tour: null, tours: [] };
  let tour = buildControlledTour(edited.records, originRecord, query, edited);
  let providerDateSummary = tour.cheapFlightScanner || null;
  let liveProviderVerification = null;
  let datesPreserved = false;
  let datesAdjusted = false;
  const originalRequestedDepartureDate = safeIsoDate(query.departureDate || query.currentDepartureDate);
  const requestedDepartureDate = adjustedControlDepartureDate680B(query);
  if (originalRequestedDepartureDate && requestedDepartureDate && originalRequestedDepartureDate !== requestedDepartureDate) datesAdjusted = true;
  const preserveRequested = routeControl667dEnabled() && ['shuffle', 'replace', 'refresh', 'restore'].includes(edited.action) && requestedDepartureDate;

  if (preserveRequested) {
    const preserved = applyPreservedDateSchedule(tour, requestedDepartureDate);
    if (preserved.preserved) {
      const live = await verifyTourWithLiveProviders(preserved.tour, { ...query, departureDate: requestedDepartureDate });
      const candidate = buildVisualizerTour(live.tour, { ...query, departureDate: requestedDepartureDate }, { summary: { enabled: true, source: 'route-control-date-preservation-667d', preservedDepartureDate: requestedDepartureDate }, liveProviderVerification: live.summary });
      const preservedGuard = evaluateTour(candidate, { ...query, departureDate: requestedDepartureDate });
      if ((!live.summary?.overBudget || edited.action === 'restore') && preservedGuard.accepted) {
        tour = preservedGuard.tour;
        liveProviderVerification = live.summary;
        providerDateSummary = candidate.cheapFlightScanner || providerDateSummary;
        datesPreserved = true;
      }
    }
  }

  if (!datesPreserved) {
    if (preserveRequested) datesAdjusted = true;
    if (String(process.env.ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B || process.env.ENABLE_CHEAP_ONE_WAY_SCANNER_650A || '').trim().toLowerCase() === 'true') {
      let enriched = await enrichTourWithCheapFlights(tour, query);
      const live = await verifyTourWithLiveProviders(enriched.tour, query);
      liveProviderVerification = live.summary;
      if (live.summary?.overBudget && edited.action !== 'restore') {
        return { ok: true, supported: false, version: CONTROL_VERSION, reason: 'route-control-provider-verified-over-budget', message: 'That edit would exceed the budget after provider verification. Keeping the current route.', routeControl: { enabled: true, action: edited.action, liveProviderVerification: live.summary }, tour: null, tours: [] };
      }
      enriched = { ...enriched, tour: live.tour, liveProviderVerification: live.summary };
      tour = buildVisualizerTour(enriched.tour, query, enriched);
      providerDateSummary = enriched.summary || providerDateSummary;
    } else {
      const live = await verifyTourWithLiveProviders(tour, query);
      liveProviderVerification = live.summary;
      if (live.summary?.overBudget && edited.action !== 'restore') {
        return { ok: true, supported: false, version: CONTROL_VERSION, reason: 'route-control-provider-verified-over-budget', message: 'That edit would exceed the budget after provider verification. Keeping the current route.', routeControl: { enabled: true, action: edited.action, liveProviderVerification: live.summary }, tour: null, tours: [] };
      }
      tour = buildVisualizerTour(live.tour, query, { summary: providerDateSummary || {}, liveProviderVerification: live.summary });
    }
  }
  const guard = evaluateTour(tour, query);
  if (!guard.accepted) {
    return {
      ok: true,
      supported: false,
      version: CONTROL_VERSION,
      reason: 'route-control-feasibility-guard',
      message: 'That edit would make the trip too rushed, geographically inconsistent, or airport-incomplete. Keeping the current route.',
      routeControl: { enabled: true, action: edited.action, allowedMaxStops: edited.allowedMaxStops || maxStopsForBudget(query), routeFeasibilityGuard: { version: GUARD_VERSION, reasons: guard.reasons, metrics: guard.metrics } },
      tour: null,
      tours: []
    };
  }
  tour = guard.tour;
  const restoredOverBudget = edited.restoredOverBudget === true || (edited.action === 'restore' && liveProviderVerification?.overBudget === true);
  const routeMessage = restoredOverBudget
    ? `${edited.message}${datesAdjusted ? ' The flexible departure was moved to respect the minimum booking lead time.' : ''}`
    : datesAdjusted
    ? `${edited.message} Dates were adjusted to keep this route feasible and within budget.`
    : datesPreserved
      ? `${edited.message} Your existing trip dates were preserved.`
      : edited.message;
  return { ok: true, supported: true, version: CONTROL_VERSION, mode: 'generated-tour-control', routeControl: { enabled: true, action: edited.action, preferredStops: edited.records.map(record => record.cityId), message: routeMessage, selectedDepartureDate: datesPreserved ? requestedDepartureDate : (requestedDepartureDate || null), datesPreserved, datesAdjusted, restoredOverBudget, gatewayTransferIntegrity: routeControl667dEnabled(), budgetGuardrail: edited.budgetGuardrail || null, allowedMaxStops: edited.allowedMaxStops || maxStopsForBudget(query), recalculatedByBackend: true, providerVerificationRequired: true, providerVerificationVersion: LIVE_PROVIDER_VERIFICATION_VERSION, passengerPricingVersion: PRICING_INTEGRITY_VERSION, providerDateSummary, liveProviderVerification, routeFeasibilityGuard: { version: GUARD_VERSION, accepted: true, metrics: guard.metrics, warnings: guard.warnings } }, tour, tours: [tour] };
}
module.exports = { CONTROL_VERSION, getGeneratedTourControl, _internal: { routeControl667dEnabled, stakeholderReadiness669eEnabled, safeIsoDate, addDaysIso, automaticLeadDays680B, adjustedControlDepartureDate680B, applyPreservedDateSchedule, mutateStopRecords, chooseReplacement, replacementOptions674A, indexes, resolveOriginRecord, buildControlledTour, normalizeStopRecords, parseCurrentStopRefs, resolveExistingStopRef, stableStopIdentityEnabled } };
