'use strict';

// GV-CITY-668E — Agoda quality-candidate retrieval on top of multi-window provider verification.
// Provider mapping, live inventory, quality-qualified stay evidence, route comfort,
// and production recommendation eligibility are intentionally separate signals.

const crypto = require('crypto');
const staticAudit = require('../data/provider-mappings-1000-668b.json');
const registry = require('../data/unified-city-registry-1000-668b.json');
const snapshot = require('../data/provider-live-coverage-1000-668c.json');
const { fetchCheapOneWayFlightDates, addMonths } = require('./cheap-one-way-flights');
const { fetchAgodaCoverageProbe, buildStayDates, qualityCandidateRetrievalEnabled } = require('./agoda');
const routeFeasibility = require('./route-feasibility');

const VERSION = 'GV-CITY-668E';
const DEFAULT_BATCH_SIZE = 5;
const HARD_MAX_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 2;
const HARD_MAX_CONCURRENCY = 3;
const DEFAULT_FLIGHT_MONTHS = 3;
const HARD_MAX_FLIGHT_MONTHS = 4;
const DEFAULT_STAY_WINDOWS = 3;
const HARD_MAX_STAY_WINDOWS = 4;
const DEFAULT_MAX_FLIGHT_ATTEMPTS = 12;
const HARD_MAX_FLIGHT_ATTEMPTS = 20;
const DEFAULT_MAX_DURATION_MINUTES = 1080;
const DEFAULT_MAX_TRANSFERS = 1;

function clean(value) { return String(value || '').trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function enabled() {
  return lower(process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E) === 'true'
    || lower(process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D) === 'true'
    || lower(process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C) === 'true';
}
function safeIata(value) { const code = upper(value); return /^[A-Z]{3}$/.test(code) ? code : null; }
function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
function normalize(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function nowIso() { return new Date().toISOString(); }
function currentMonthUtc() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
function addDaysIso(dateText, days) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(clean(dateText))
    ? new Date(`${clean(dateText)}T00:00:00Z`)
    : new Date();
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function defaultVerificationMonth() {
  return addMonths(currentMonthUtc(), safeInt(process.env.GV_PROVIDER_COVERAGE_MONTH_OFFSET, 2, 1, 5));
}
function defaultStayDate() {
  return addDaysIso(new Date().toISOString().slice(0, 10), safeInt(process.env.GV_PROVIDER_COVERAGE_STAY_OFFSET_DAYS, 45, 21, 180));
}
function envCredentials() {
  return {
    travelpayouts: Boolean(clean(process.env.TRAVELPAYOUTS_TOKEN)) && lower(process.env.GLOBEVOY_USE_MOCKS) !== 'true',
    agoda: Boolean(clean(process.env.AGODA_SITE_ID) && clean(process.env.AGODA_API_KEY)) && lower(process.env.GLOBEVOY_USE_MOCKS) !== 'true'
  };
}

const staticRecords = Array.isArray(staticAudit.records) ? staticAudit.records.filter(Boolean) : [];
const staticById = new Map(staticRecords.map(record => [record.cityId, record]));
const registryRecords = Array.isArray(registry.records) ? registry.records.filter(Boolean) : [];
const registryById = new Map(registryRecords.map(record => [record.cityId, record]));
const snapshotRecords = Array.isArray(snapshot.records) ? snapshot.records.filter(Boolean) : [];
const snapshotById = new Map(snapshotRecords.map(record => [record.cityId, record]));

const REGION_ANCHORS = Object.freeze({
  Europe: ['LON', 'PAR', 'FRA', 'AMS'],
  Asia: ['SIN', 'BKK', 'DXB', 'DEL'],
  Africa: ['DXB', 'LON', 'IST', 'CAI'],
  Americas: ['YTO', 'NYC', 'MIA', 'MEX'],
  Oceania: ['SYD', 'SIN', 'AKL', 'MEL'],
  Other: ['DXB', 'LON', 'NYC', 'SIN']
});

// GV-CITY-668S additive recovery anchors. These are used only when the
// authenticated verifier explicitly requests recoveryMode or the 668S flag is
// enabled. Normal 668E verification behavior is unchanged.
const RECOVERY_REGION_ANCHORS = Object.freeze({
  Europe: ['LON', 'PAR', 'FRA', 'AMS', 'MAD', 'ROM', 'IST', 'CPH'],
  Asia: ['SIN', 'BKK', 'DXB', 'DEL', 'DOH', 'KUL', 'HKG', 'IST'],
  Africa: ['DXB', 'LON', 'IST', 'CAI', 'PAR', 'ADD', 'JNB', 'NBO'],
  Americas: ['YTO', 'NYC', 'MIA', 'MEX', 'LAX', 'PTY', 'BOG', 'GRU'],
  Oceania: ['SYD', 'SIN', 'AKL', 'MEL', 'BNE', 'LAX', 'HNL', 'NAN'],
  Other: ['DXB', 'LON', 'NYC', 'SIN', 'IST', 'PAR', 'MIA', 'BKK']
});

const COUNTRY_ANCHORS = Object.freeze({
  PK: ['DXB', 'DOH', 'IST', 'LON'], IN: ['DXB', 'BKK', 'SIN', 'DOH'], LK: ['DXB', 'BKK', 'SIN', 'DEL'],
  NP: ['DEL', 'DXB', 'BKK', 'DOH'], BD: ['BKK', 'DXB', 'DEL', 'SIN'],
  IR: ['IST', 'DXB', 'DOH', 'BKK'], IQ: ['IST', 'DXB', 'DOH', 'CAI'],
  EG: ['IST', 'DXB', 'LON', 'PAR'], DZ: ['PAR', 'LON', 'IST', 'MAD'], MA: ['PAR', 'LON', 'MAD', 'IST'],
  TN: ['PAR', 'LON', 'ROM', 'IST'], LY: ['IST', 'CAI', 'TUN', 'DXB'],
  CU: ['MIA', 'NYC', 'YTO', 'MEX'], BZ: ['MIA', 'NYC', 'YTO', 'MEX'], MX: ['MIA', 'NYC', 'YTO', 'MEX'],
  GT: ['MIA', 'MEX', 'NYC', 'YTO'], CV: ['LIS', 'PAR', 'LON', 'MAD'],
  PF: ['LAX', 'AKL', 'SYD', 'HNL'], CK: ['AKL', 'SYD', 'LAX', 'HNL'],
  GL: ['CPH', 'KEF', 'LON', 'YTO'], IS: ['LON', 'CPH', 'AMS', 'PAR']
});

function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value).split(',').map(clean).filter(Boolean);
}
function recoveryMode(options = {}) {
  return options.recoveryMode === true
    || lower(options.recoveryMode) === 'true'
    || lower(process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S) === 'true';
}

function anchorsForRecord(record, options = {}) {
  const explicit = parseList(options.anchorOrigins).map(safeIata).filter(Boolean);
  const registryRecord = registryById.get(record.cityId) || {};
  const countryAnchors = COUNTRY_ANCHORS[upper(record.countryCode)] || [];
  const standardRegionAnchors = REGION_ANCHORS[registryRecord.worldRegion || 'Other'] || REGION_ANCHORS.Other;
  const recoveryRegionAnchors = RECOVERY_REGION_ANCHORS[registryRecord.worldRegion || 'Other'] || RECOVERY_REGION_ANCHORS.Other;
  const useRecovery = recoveryMode(options);
  const regionAnchors = useRecovery ? [...recoveryRegionAnchors, ...standardRegionAnchors] : standardRegionAnchors;
  const destinationCodes = new Set(flightDestinationCandidates(record).map(candidate => candidate.code));
  const defaultAnchorCount = useRecovery ? 6 : 4;
  return [...new Set([...explicit, ...countryAnchors, ...regionAnchors].map(safeIata).filter(Boolean))]
    .filter(code => !destinationCodes.has(code))
    .slice(0, safeInt(options.anchorCount, defaultAnchorCount, 1, 6));
}

function flightMonths(request = {}) {
  const explicit = parseList(request.months).filter(value => /^\d{4}-\d{2}$/.test(value));
  if (explicit.length) return [...new Set(explicit)].slice(0, HARD_MAX_FLIGHT_MONTHS);
  const first = /^\d{4}-\d{2}$/.test(clean(request.month)) ? clean(request.month) : defaultVerificationMonth();
  const count = safeInt(request.monthCount || process.env.GV_PROVIDER_COVERAGE_MONTH_COUNT, DEFAULT_FLIGHT_MONTHS, 1, HARD_MAX_FLIGHT_MONTHS);
  return Array.from({ length: count }, (_, index) => addMonths(first, index));
}

function stayCheckIns(request = {}) {
  const explicit = parseList(request.checkIns).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (explicit.length) return [...new Set(explicit)].slice(0, HARD_MAX_STAY_WINDOWS);
  const first = /^\d{4}-\d{2}-\d{2}$/.test(clean(request.checkIn)) ? clean(request.checkIn) : defaultStayDate();
  const count = safeInt(request.stayWindowCount || process.env.GV_PROVIDER_COVERAGE_STAY_WINDOW_COUNT, DEFAULT_STAY_WINDOWS, 1, HARD_MAX_STAY_WINDOWS);
  const spacing = safeInt(request.stayWindowSpacingDays || process.env.GV_PROVIDER_COVERAGE_STAY_SPACING_DAYS, 30, 14, 60);
  return Array.from({ length: count }, (_, index) => addDaysIso(first, spacing * index));
}

function gatewayOverrideFor(record) {
  try {
    const gateway = routeFeasibility?._internal?.gatewayFor?.({ city: record.displayName, country: record.country });
    if (!gateway?.airportCode) return null;
    return {
      airportCode: safeIata(gateway.airportCode),
      gatewayCity: gateway.gatewayCity || null,
      mode: gateway.transferMode || 'ground-transfer',
      distanceKm: Number(gateway.transferDistanceKm || 0) || null,
      minutes: Number(gateway.transferMinutes || 0) || null,
      estimatedOneWayUsd: Number(gateway.estimatedOneWayUsd || 0) || null,
      preferGateway: gateway.preferGateway === true,
      note: gateway.note || null
    };
  } catch (_) {
    return null;
  }
}

function flightDestinationCandidates(record) {
  const directCode = safeIata(record.travelpayouts?.locationCode || record.travelpayouts?.preferredAirportCode);
  const staticGateway = record.travelpayouts?.gateway?.airportCode ? {
    airportCode: safeIata(record.travelpayouts.gateway.airportCode),
    gatewayCity: record.travelpayouts.gateway.gatewayCity || null,
    mode: record.travelpayouts.gateway.mode || 'ground-transfer',
    distanceKm: Number(record.travelpayouts.gateway.distanceKm || 0) || null,
    minutes: Number(record.travelpayouts.gateway.minutes || 0) || null,
    preferGateway: record.travelpayouts.mappingType === 'gateway-airport'
  } : null;
  const override = gatewayOverrideFor(record);
  const gateway = override?.airportCode ? override : staticGateway;
  const direct = directCode ? { code: directCode, kind: 'direct', mappingType: record.travelpayouts?.mappingType || 'direct' } : null;
  const gatewayCandidate = gateway?.airportCode ? { code: gateway.airportCode, kind: 'gateway', mappingType: 'gateway-airport', gateway } : null;
  const ordered = gateway?.preferGateway ? [gatewayCandidate, direct] : [direct, gatewayCandidate];
  const seen = new Set();
  return ordered.filter(candidate => candidate?.code && !seen.has(candidate.code) && seen.add(candidate.code));
}

function assessFlightComfort(sample = {}, request = {}, gateway = null) {
  const maxDuration = safeInt(request.maxComfortDurationMinutes || process.env.GV_PROVIDER_COVERAGE_MAX_COMFORT_DURATION_MINUTES, DEFAULT_MAX_DURATION_MINUTES, 180, 2400);
  const maxTransfers = safeInt(request.maxComfortTransfers || process.env.GV_PROVIDER_COVERAGE_MAX_COMFORT_TRANSFERS, DEFAULT_MAX_TRANSFERS, 0, 3);
  const duration = Number(sample.durationMinutes);
  const transfers = Number(sample.transfers);
  const durationKnown = Number.isFinite(duration) && duration > 0;
  const transfersKnown = Number.isFinite(transfers) && transfers >= 0;
  const flightQualified = durationKnown && transfersKnown && duration <= maxDuration && transfers <= maxTransfers;
  const gatewayMinutes = Number(gateway?.minutes || 0);
  const gatewayQualified = !gateway || !Number.isFinite(gatewayMinutes) || gatewayMinutes <= safeInt(request.maxGatewayTransferMinutes, 180, 30, 360);
  return {
    qualified: flightQualified && gatewayQualified,
    durationKnown,
    transfersKnown,
    durationMinutes: durationKnown ? duration : null,
    transfers: transfersKnown ? transfers : null,
    maxDurationMinutes: maxDuration,
    maxTransfers,
    gatewayTransferMinutes: gateway ? (Number.isFinite(gatewayMinutes) ? gatewayMinutes : null) : null,
    gatewayTransferQualified: gatewayQualified,
    reasons: [
      !durationKnown ? 'duration-unknown' : (duration > maxDuration ? 'duration-too-long' : null),
      !transfersKnown ? 'transfers-unknown' : (transfers > maxTransfers ? 'too-many-transfers' : null),
      !gatewayQualified ? 'gateway-transfer-too-long' : null
    ].filter(Boolean)
  };
}

function observationRank(entry) {
  const sample = entry.sample || {};
  const comfort = entry.comfort || {};
  return [
    comfort.qualified ? 0 : 1,
    Number.isFinite(Number(sample.transfers)) ? Number(sample.transfers) : 99,
    Number.isFinite(Number(sample.durationMinutes)) ? Number(sample.durationMinutes) : 99999,
    Number.isFinite(Number(sample.amount)) ? Number(sample.amount) : 999999
  ];
}
function compareRank(a, b) {
  const ar = observationRank(a); const br = observationRank(b);
  for (let index = 0; index < ar.length; index += 1) if (ar[index] !== br[index]) return ar[index] - br[index];
  return 0;
}

function publicSnapshotRecord(record) {
  if (!record) return null;
  return {
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    selectionTier: record.selectionTier,
    staticMapping: record.staticMapping,
    live: record.live,
    providerCoverage: record.providerCoverage || null,
    recommendationReadiness: record.recommendationReadiness || null,
    classification: record.classification,
    productionActivation: record.productionActivation,
    lastVerifiedAt: record.lastVerifiedAt || null
  };
}

function snapshotSummary() {
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    snapshotVersion: snapshot.version,
    status: snapshot.status,
    summary: clone(snapshot.summary || {}),
    policy: {
      multiWindowFlightVerification: true,
      multiWindowStayVerification: true,
      gatewayFallbackRepair: true,
      providerCoverageSeparatedFromRecommendationReadiness: true,
      comfortQualifiedEvidenceRequiredForProductionRecommendation: true,
      agodaQualityCandidateRetrieval: qualityCandidateRetrievalEnabled(),
      agodaCandidateSorts: ['Recommended', 'AllGuestsReviewScore', 'StarRatingDesc'],
      agodaCandidateMaximumPerStrategy: 30
    },
    credentialsAvailable: envCredentials(),
    disclaimer: 'The packaged snapshot is inherited from 668C. Live 668E counts become authoritative after rerunning the verifier and importing its output.'
  };
}

function searchSnapshot(query = {}) {
  const q = normalize(query.q || query.query || '');
  const countryCode = upper(query.countryCode || query.country || '');
  const classification = lower(query.classification || query.status || '');
  const activeOnly = lower(query.active || query.productionActive || '') === 'true';
  const tier = lower(query.tier || '');
  const requested = safeInt(query.limit, 25, 1, 100);
  const matches = snapshotRecords.filter(record => {
    if (countryCode && upper(record.countryCode) !== countryCode) return false;
    if (classification && lower(record.classification) !== classification) return false;
    if (activeOnly && record.productionActivation?.eligible !== true) return false;
    if (tier && lower(record.selectionTier) !== tier) return false;
    if (q) {
      const values = [record.cityId, record.displayName, record.country, record.countryCode, record.staticMapping?.travelpayouts?.locationCode]
        .map(normalize).filter(Boolean);
      if (!values.some(value => value.includes(q) || q.includes(value))) return false;
    }
    return true;
  });
  matches.sort((a, b) => Number(b.productionActivation?.eligible) - Number(a.productionActivation?.eligible)
    || clean(a.displayName).localeCompare(clean(b.displayName)));
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    count: Math.min(requested, matches.length),
    totalMatches: matches.length,
    records: matches.slice(0, requested).map(publicSnapshotRecord),
    disclaimer: 'Static or single-window evidence is not sufficient for production recommendation eligibility.'
  };
}

function providerResultBase(provider, status, details = {}) {
  return {
    provider,
    status,
    verified: status === 'live',
    checkedAt: nowIso(),
    ...details
  };
}

async function verifyTravelpayouts(record, request = {}, options = {}) {
  if (!record.travelpayouts?.mappingAccepted) {
    return providerResultBase('Travelpayouts/Aviasales', 'unresolved-static-mapping', { productionEligible: false, providerMappingVerified: false });
  }
  const injected = typeof options._fetchFn === 'function';
  const credentials = envCredentials();
  if (!credentials.travelpayouts && !injected) {
    return providerResultBase('Travelpayouts/Aviasales', 'provider-credentials-unavailable', { productionEligible: false, providerMappingVerified: false });
  }

  const candidates = flightDestinationCandidates(record);
  if (!candidates.length) {
    return providerResultBase('Travelpayouts/Aviasales', 'unresolved-static-mapping', { productionEligible: false, providerMappingVerified: false });
  }
  const months = flightMonths(request);
  const anchors = anchorsForRecord(record, request);
  const maxAttempts = safeInt(request.maxFlightAttempts || process.env.GV_PROVIDER_COVERAGE_MAX_FLIGHT_ATTEMPTS, DEFAULT_MAX_FLIGHT_ATTEMPTS, 1, HARD_MAX_FLIGHT_ATTEMPTS);
  const attempts = [];
  const liveEntries = [];
  let attemptCount = 0;

  outer:
  for (const candidate of candidates) {
    // Interleave months per regional origin. This prevents one empty month from
    // consuming the entire bounded attempt budget across every anchor.
    for (const origin of anchors) {
      for (const month of months) {
        if (attemptCount >= maxAttempts) break outer;
        attemptCount += 1;
        let result;
        try {
          result = await fetchCheapOneWayFlightDates({
            origin,
            destination: candidate.code,
            currency: upper(request.currency || 'CAD') || 'CAD',
            month,
            limit: safeInt(request.flightResultLimit, 8, 1, 12),
            _fetchFn: options._fetchFn
          });
        } catch (error) {
          result = { supported: false, reason: 'provider-error', error: error.message, observations: [] };
        }
        const observations = Array.isArray(result?.observations) ? result.observations : [];
        attempts.push({
          origin,
          destination: candidate.code,
          destinationKind: candidate.kind,
          month,
          supported: Boolean(result?.supported),
          reason: result?.reason || null,
          observationCount: observations.length,
          endpointUsed: result?.endpointUsed || null,
          cacheHit: Boolean(result?.cacheHit)
        });
        for (const observation of observations) {
          const sample = {
            departureDate: observation.departureDate || null,
            amount: Number(observation.price || 0) || null,
            currency: observation.currency || upper(request.currency || 'CAD'),
            transfers: Number.isFinite(Number(observation.transfers)) ? Number(observation.transfers) : null,
            durationMinutes: Number(observation.durationMinutes || 0) || null,
            bookingLinkPresent: Boolean(observation.bookingLink)
          };
          liveEntries.push({ candidate, origin, month, sample, comfort: assessFlightComfort(sample, request, candidate.gateway) });
        }
        if (liveEntries.some(entry => entry.comfort.qualified)) break outer;
      }
    }
  }

  if (!liveEntries.length) {
    const providerError = attempts.some(attempt => attempt.reason === 'provider-error');
    return providerResultBase('Travelpayouts/Aviasales', providerError ? 'provider-error' : 'no-live-observations', {
      productionEligible: false,
      providerMappingVerified: false,
      destinationCandidates: candidates,
      scannedMonths: months,
      anchorOrigins: anchors,
      attempts,
      evidenceMode: injected ? 'injected-test-response' : 'production-provider-response'
    });
  }

  liveEntries.sort(compareRank);
  const selected = liveEntries[0];
  const productionEvidence = !injected && credentials.travelpayouts;
  return providerResultBase('Travelpayouts/Aviasales', 'live', {
    productionEligible: productionEvidence,
    providerMappingVerified: productionEvidence,
    inventoryObserved: true,
    comfortQualified: selected.comfort.qualified,
    comfort: selected.comfort,
    mappingType: selected.candidate.mappingType,
    destinationCode: selected.candidate.code,
    destinationKind: selected.candidate.kind,
    gatewayFallbackUsed: selected.candidate.kind === 'gateway',
    gateway: selected.candidate.gateway || null,
    verifiedOrigin: selected.origin,
    verificationMonth: selected.month,
    scannedMonths: months,
    anchorOrigins: anchors,
    observationCount: liveEntries.length,
    sample: selected.sample,
    attempts,
    evidenceMode: productionEvidence ? 'production-provider-response' : 'injected-test-response'
  });
}

async function verifyAgoda(record, request = {}, options = {}) {
  const agoda = record.agoda || {};
  if (!agoda.mappingAccepted || !Number(agoda.cityId)) {
    return providerResultBase('Agoda', 'unresolved-static-mapping', {
      productionEligible: false,
      providerMappingVerified: false,
      inventoryObserved: false,
      agodaCityId: null,
      reason: agoda.reason || agoda.status || 'no-agoda-mapping'
    });
  }
  const injected = typeof options._fetchFn === 'function';
  const credentials = envCredentials();
  if (!credentials.agoda && !injected) {
    return providerResultBase('Agoda', 'provider-credentials-unavailable', {
      productionEligible: false,
      providerMappingVerified: false,
      inventoryObserved: false,
      agodaCityId: Number(agoda.cityId)
    });
  }

  const nights = safeInt(request.nights, 2, 1, 7);
  const checkIns = stayCheckIns(request);
  const registryRecord = registryById.get(record.cityId) || {};
  const destination = {
    id: record.cityId,
    city: record.displayName,
    code: record.travelpayouts?.locationCode || null,
    agodaCityId: Number(agoda.cityId),
    fallbackNightlyUsd: Number(registryRecord.destination?.fallbackNightlyUsd || 85)
  };
  const requestedAdults = safeInt(request.adults, 2, 1, 8);
  const occupancyVariants = [{ adults: requestedAdults, children: safeInt(request.children, 0, 0, 6), rooms: safeInt(request.rooms, 1, 1, 4), kind: 'requested' }];
  if (requestedAdults !== 1 || Number(request.children || 0) !== 0 || Number(request.rooms || 1) !== 1) {
    occupancyVariants.push({ adults: 1, children: 0, rooms: 1, kind: 'coverage-fallback' });
  }

  const attempts = [];
  let bestInventory = null;
  let bestQualified = null;
  // Try every date for the requested occupancy before using the one-adult
  // coverage fallback. This avoids mistaking an occupancy issue for a date issue.
  for (const occupancy of occupancyVariants) {
    for (const checkIn of checkIns) {
      let probe;
      try {
        probe = await fetchAgodaCoverageProbe({
          destination,
          nights,
          checkIn,
          currency: upper(request.currency || 'CAD') || 'CAD',
          adults: occupancy.adults,
          children: occupancy.children,
          rooms: occupancy.rooms,
          qualityCandidateStrategyCount: request.agodaQualityStrategyCount,
          qualityCandidateMaxResult: request.agodaQualityMaxResult,
          forceQualityCandidateRetrieval: request.forceAgodaQualityCandidateRetrieval === true,
          _fetchFn: options._fetchFn
        });
      } catch (error) {
        attempts.push({ checkIn, occupancy, status: 'provider-error', error: error.message });
        continue;
      }
      const attempt = {
        checkIn: probe.checkIn || buildStayDates(checkIn, nights).checkIn,
        checkOut: probe.checkOut || buildStayDates(checkIn, nights).checkOut,
        occupancy,
        status: probe.reason === 'provider-error' ? 'provider-error' : (probe.qualityQualifiedRate ? 'quality-qualified-live-rate' : (probe.inventoryObserved ? 'live-inventory-unqualified' : 'no-live-rate')),
        rawHotelCount: Number(probe.rawHotelCount || 0),
        pricedHotelCount: Number(probe.pricedHotelCount || 0),
        structuralQualityCount: Number(probe.structuralQualityCount || 0),
        qualityQualifiedCount: Number(probe.qualityQualifiedCount || 0),
        rejectedCount: Number(probe.rejectedCount || 0),
        candidateRetrievalMode: probe.candidateRetrievalMode || null,
        selectedStrategy: probe.selectedStrategy || null,
        strategiesRequested: Number(probe.strategiesRequested || 0),
        strategyAttempts: Array.isArray(probe.strategyAttempts) ? probe.strategyAttempts : [],
        rejectionReasons: probe.rejectionReasons || {}
      };
      attempts.push(attempt);
      if (probe.inventoryObserved && !bestInventory) bestInventory = { probe, occupancy };
      if (probe.qualityQualifiedRate) {
        bestQualified = { probe, occupancy };
        break;
      }
    }
    if (bestQualified) break;
  }

  const productionResponse = !injected && credentials.agoda;
  if (bestQualified) {
    const probe = bestQualified.probe;
    return providerResultBase('Agoda', 'live', {
      productionEligible: productionResponse,
      providerMappingVerified: productionResponse,
      inventoryObserved: true,
      qualityQualifiedRate: true,
      agodaCityId: Number(agoda.cityId),
      mappingType: agoda.mappingType,
      checkIn: probe.checkIn,
      checkOut: probe.checkOut,
      occupancy: bestQualified.occupancy,
      occupancyFallbackUsed: bestQualified.occupancy.kind === 'coverage-fallback',
      rawHotelCount: Number(probe.rawHotelCount || 0),
      pricedHotelCount: Number(probe.pricedHotelCount || 0),
      structuralQualityCount: Number(probe.structuralQualityCount || 0),
      qualityQualifiedCount: Number(probe.qualityQualifiedCount || 0),
      candidateRetrievalMode: probe.candidateRetrievalMode || null,
      selectedStrategy: probe.selectedStrategy || null,
      rejectionReasons: probe.rejectionReasons || {},
      sample: probe.sample || null,
      attempts,
      evidenceMode: productionResponse ? 'production-provider-response' : 'injected-test-response'
    });
  }
  if (bestInventory) {
    const probe = bestInventory.probe;
    return providerResultBase('Agoda', 'live-inventory-unqualified', {
      productionEligible: false,
      providerMappingVerified: productionResponse,
      inventoryObserved: true,
      qualityQualifiedRate: false,
      agodaCityId: Number(agoda.cityId),
      mappingType: agoda.mappingType,
      checkIn: probe.checkIn,
      checkOut: probe.checkOut,
      occupancy: bestInventory.occupancy,
      rawHotelCount: Number(probe.rawHotelCount || 0),
      pricedHotelCount: Number(probe.pricedHotelCount || 0),
      structuralQualityCount: Number(probe.structuralQualityCount || 0),
      qualityQualifiedCount: Number(probe.qualityQualifiedCount || 0),
      candidateRetrievalMode: probe.candidateRetrievalMode || null,
      selectedStrategy: probe.selectedStrategy || null,
      rejectionReasons: probe.rejectionReasons || {},
      attempts,
      evidenceMode: productionResponse ? 'production-provider-response' : 'injected-test-response'
    });
  }
  const providerError = attempts.length && attempts.every(attempt => attempt.status === 'provider-error');
  return providerResultBase('Agoda', providerError ? 'provider-error' : 'no-live-rate', {
    productionEligible: false,
    providerMappingVerified: false,
    inventoryObserved: false,
    qualityQualifiedRate: false,
    agodaCityId: Number(agoda.cityId),
    mappingType: agoda.mappingType,
    scannedCheckIns: checkIns,
    attempts,
    evidenceMode: injected ? 'injected-test-response' : 'production-provider-response'
  });
}

function classifyCoverage(record, flight, stay) {
  const flightInventory = flight?.inventoryObserved === true;
  const stayInventory = stay?.inventoryObserved === true;
  const providerFlight = flight?.providerMappingVerified === true;
  const providerStay = stay?.providerMappingVerified === true;
  const qualityStay = stay?.productionEligible === true && stay?.qualityQualifiedRate === true;
  const comfortFlight = flight?.productionEligible === true && flight?.comfortQualified === true;
  const gateway = flight?.destinationKind === 'gateway' || record.travelpayouts?.mappingType === 'gateway-airport';

  let classification = 'estimate-only';
  if (!record.agoda?.mappingAccepted) classification = flightInventory ? 'live-flights-only' : 'unresolved';
  else if (flightInventory && stayInventory) classification = gateway ? 'gateway-supported' : 'live-both';
  else if (flightInventory) classification = 'live-flights-only';
  else if (stayInventory) classification = 'live-stays-only';
  else if ([flight?.status, stay?.status].includes('provider-error')) classification = 'provider-error';
  else if ([flight?.status, stay?.status].includes('provider-credentials-unavailable')) classification = 'pending-provider-credentials';

  const providerCoverageEligible = providerFlight && providerStay;
  const productionEligible = providerCoverageEligible && qualityStay && comfortFlight;
  const reasons = [];
  if (!providerFlight) reasons.push(`flight-provider:${flight?.status || 'missing'}`);
  if (!providerStay) reasons.push(`stay-provider:${stay?.status || 'missing'}`);
  if (providerStay && !qualityStay) reasons.push('stay-quality:no-qualified-live-rate');
  if (providerFlight && !comfortFlight) reasons.push(`flight-comfort:${(flight?.comfort?.reasons || ['not-qualified']).join('|')}`);

  return {
    classification,
    providerCoverage: {
      eligible: providerCoverageEligible,
      classification: providerCoverageEligible ? (gateway ? 'gateway-supported' : 'live-both') : classification,
      flightInventoryObserved: flightInventory,
      stayInventoryObserved: stayInventory,
      flightMappingVerified: providerFlight,
      stayMappingVerified: providerStay,
      gatewaySupported: gateway
    },
    recommendationReadiness: {
      eligible: productionEligible,
      qualityQualifiedStayObserved: qualityStay,
      comfortQualifiedFlightObserved: comfortFlight,
      reasons
    },
    productionActivation: {
      eligible: productionEligible,
      mode: productionEligible ? (gateway ? 'gateway-supported' : 'direct-or-metro') : 'inactive',
      reason: productionEligible ? 'providers-live-stay-quality-qualified-flight-comfort-qualified' : reasons.join(';'),
      activationPolicyVersion: VERSION
    }
  };
}

async function verifyCityCoverage(cityId, request = {}, options = {}) {
  const record = staticById.get(clean(cityId));
  if (!record) return { ok: false, cityId: clean(cityId), error: 'unknown-city-id', version: VERSION };
  const [flight, stay] = await Promise.all([
    verifyTravelpayouts(record, request, options),
    verifyAgoda(record, request, options)
  ]);
  const classification = classifyCoverage(record, flight, stay);
  const effectiveGateway = flight?.gatewayFallbackUsed ? flight.gateway : (record.travelpayouts?.gateway || gatewayOverrideFor(record));
  return {
    ok: true,
    version: VERSION,
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    selectionTier: record.selectionTier,
    staticMapping: {
      travelpayouts: {
        mappingAccepted: record.travelpayouts?.mappingAccepted === true,
        mappingType: record.travelpayouts?.mappingType || null,
        locationCode: record.travelpayouts?.locationCode || null,
        gateway: effectiveGateway || null,
        verificationCandidates: flightDestinationCandidates(record)
      },
      agoda: {
        mappingAccepted: record.agoda?.mappingAccepted === true,
        mappingType: record.agoda?.mappingType || null,
        cityId: record.agoda?.cityId || null,
        hotelCount: Number(record.agoda?.hotelCount || 0)
      }
    },
    live: { travelpayouts: flight, agoda: stay },
    providerCoverage: classification.providerCoverage,
    recommendationReadiness: classification.recommendationReadiness,
    classification: classification.classification,
    productionActivation: classification.productionActivation,
    lastVerifiedAt: nowIso()
  };
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  return results;
}

function selectBatch(request = {}) {
  const ids = Array.isArray(request.cityIds) ? request.cityIds.map(clean).filter(Boolean) : [];
  const envCap = safeInt(process.env.GV_PROVIDER_COVERAGE_MAX_BATCH, DEFAULT_BATCH_SIZE, 1, HARD_MAX_BATCH_SIZE);
  const requestedSize = safeInt(request.batchSize || request.limit, DEFAULT_BATCH_SIZE, 1, envCap);
  if (ids.length) return [...new Set(ids)].slice(0, envCap);
  const start = safeInt(request.batchStart || request.offset, 0, 0, Math.max(0, staticRecords.length - 1));
  return staticRecords.slice(start, start + requestedSize).map(record => record.cityId);
}

async function verifyBatch(request = {}, options = {}) {
  if (!enabled() && !options.ignoreFeatureFlag) {
    return { ok: false, enabled: false, version: VERSION, error: 'feature-disabled', records: [] };
  }
  const cityIds = selectBatch(request);
  const concurrency = safeInt(request.concurrency || process.env.GV_PROVIDER_COVERAGE_CONCURRENCY, DEFAULT_CONCURRENCY, 1, HARD_MAX_CONCURRENCY);
  const records = await mapWithConcurrency(cityIds, concurrency, cityId => verifyCityCoverage(cityId, request, options));
  const valid = records.filter(record => record?.ok);
  const classCounts = {};
  for (const record of valid) classCounts[record.classification] = (classCounts[record.classification] || 0) + 1;
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    generatedAt: nowIso(),
    requestedCount: cityIds.length,
    completedCount: valid.length,
    failedCount: records.length - valid.length,
    providerCoverageEligibleCount: valid.filter(record => record.providerCoverage?.eligible).length,
    productionActiveCount: valid.filter(record => record.productionActivation?.eligible).length,
    classificationCounts: classCounts,
    credentialsAvailable: envCredentials(),
    verificationPolicy: {
      recoveryMode: recoveryMode(request),
      flightMonths: flightMonths(request),
      regionalAnchorCount: safeInt(request.anchorCount, recoveryMode(request) ? 6 : 4, 1, 6),
      maximumFlightAttempts: safeInt(request.maxFlightAttempts || process.env.GV_PROVIDER_COVERAGE_MAX_FLIGHT_ATTEMPTS, DEFAULT_MAX_FLIGHT_ATTEMPTS, 1, HARD_MAX_FLIGHT_ATTEMPTS),
      flightResultLimit: safeInt(request.flightResultLimit, 8, 1, 12),
      stayCheckIns: stayCheckIns(request),
      gatewayFallbackRepair: true,
      comfortQualificationRequired: true,
      qualityQualifiedStayRequired: true,
      agodaQualityCandidateRetrieval: qualityCandidateRetrievalEnabled(),
      agodaQualityStrategyCount: safeInt(request.agodaQualityStrategyCount || process.env.GV_AGODA_QUALITY_STRATEGY_COUNT, 2, 1, 3),
      agodaQualityMaxResult: safeInt(request.agodaQualityMaxResult || process.env.GV_AGODA_QUALITY_MAX_RESULT, 30, 10, 30),
      thresholdsRelaxed: false
    },
    records,
    persistence: 'not-persisted-by-lambda-response',
    nextStep: 'Merge the response into an activation snapshot with the supplied 668E runner.'
  };
}

function recalculateSnapshotSummary(records) {
  const counts = {};
  for (const record of records) counts[record.classification || 'pending'] = (counts[record.classification || 'pending'] || 0) + 1;
  return {
    recordCount: records.length,
    verifiedAtLeastOnceCount: records.filter(record => record.lastVerifiedAt).length,
    pendingCount: records.filter(record => !record.lastVerifiedAt || record.classification === 'pending').length,
    providerCoverageEligibleCount: records.filter(record => record.providerCoverage?.eligible === true).length,
    productionActiveCount: records.filter(record => record.productionActivation?.eligible === true).length,
    comfortQualifiedCount: records.filter(record => record.recommendationReadiness?.comfortQualifiedFlightObserved === true).length,
    qualityQualifiedStayCount: records.filter(record => record.recommendationReadiness?.qualityQualifiedStayObserved === true).length,
    liveBothCount: records.filter(record => record.classification === 'live-both').length,
    gatewaySupportedCount: records.filter(record => record.classification === 'gateway-supported').length,
    liveFlightsOnlyCount: records.filter(record => record.classification === 'live-flights-only').length,
    liveStaysOnlyCount: records.filter(record => record.classification === 'live-stays-only').length,
    estimateOnlyCount: records.filter(record => record.classification === 'estimate-only').length,
    unresolvedCount: records.filter(record => record.classification === 'unresolved').length,
    providerErrorCount: records.filter(record => record.classification === 'provider-error').length,
    pendingCredentialsCount: records.filter(record => record.classification === 'pending-provider-credentials').length,
    classificationCounts: counts
  };
}

function mergeResultsIntoSnapshot(results = [], baseSnapshot = snapshot) {
  const map = new Map((Array.isArray(baseSnapshot.records) ? baseSnapshot.records : []).map(record => [record.cityId, clone(record)]));
  for (const result of results) {
    if (!result?.ok || !result.cityId || !map.has(result.cityId)) continue;
    map.set(result.cityId, clone(result));
  }
  const records = staticRecords.map(record => map.get(record.cityId) || null).filter(Boolean);
  return {
    ...clone(baseSnapshot),
    taskId: VERSION,
    version: '1.2.0',
    generatedAt: nowIso(),
    status: records.some(record => record.lastVerifiedAt) ? 'quality-candidate-live-verification' : 'verification-run-required',
    policy: {
      ...(clone(baseSnapshot.policy || {})),
      multiWindowFlightVerification: true,
      multiWindowStayVerification: true,
      gatewayFallbackRepair: true,
      providerCoverageSeparatedFromRecommendationReadiness: true,
      comfortQualifiedEvidenceRequiredForProductionRecommendation: true,
      agodaQualityCandidateRetrieval: qualityCandidateRetrievalEnabled(),
      agodaCandidateSorts: ['Recommended', 'AllGuestsReviewScore', 'StarRatingDesc'],
      agodaCandidateMaximumPerStrategy: 30
    },
    summary: recalculateSnapshotSummary(records),
    records
  };
}

function isAuthorized(headers = {}) {
  const expected = clean(process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN);
  if (!expected) return false;
  const normalizedHeaders = Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [lower(key), clean(value)]));
  const received = normalizedHeaders['x-gv-admin-token'] || normalizedHeaders.authorization?.replace(/^Bearer\s+/i, '') || '';
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = {
  VERSION,
  enabled,
  snapshotSummary,
  searchSnapshot,
  verifyCityCoverage,
  verifyBatch,
  mergeResultsIntoSnapshot,
  recalculateSnapshotSummary,
  isAuthorized,
  _internal: {
    staticRecords,
    staticById,
    registryById,
    snapshot,
    snapshotById,
    anchorsForRecord,
    recoveryMode,
    flightMonths,
    stayCheckIns,
    gatewayOverrideFor,
    flightDestinationCandidates,
    assessFlightComfort,
    verifyTravelpayouts,
    verifyAgoda,
    classifyCoverage,
    selectBatch,
    envCredentials,
    defaultVerificationMonth,
    defaultStayDate,
    mapWithConcurrency
  }
};
