'use strict';

// GV-REC-702F-A — Travelpayouts cache-evidence semantics.
//
// Pure/read-only semantics only. This module makes two facts explicit:
//   1) a reviewed static provider mapping can be valid even when a cache query
//      returns zero recent observations; and
//   2) a Travelpayouts Data API observation is cached provider evidence, not an
//      exact-date live shopping offer.
//
// This module performs no network requests, does not activate/deactivate cities,
// and is not imported by Lambda/runtime recommendation code.

const coverage702a = require('./admin/audits/global-recommendation-coverage-702a');
const {
  EVIDENCE_CLASSES_683C,
  RANKING_GRADES_683C
} = require('./flight-provider-contract-683c');

const VERSION = 'GV-REC-702F-A';
const SOURCE_PROVIDER = 'Travelpayouts/Aviasales Data API';

const CACHE_STATES = Object.freeze({
  OBSERVED: 'cached-observation-found',
  MISS: 'no-recent-cache-observation',
  PROVIDER_ERROR: 'cache-query-provider-error',
  NOT_CHECKED: 'cache-query-not-checked',
  STATIC_UNRESOLVED: 'static-provider-mapping-unresolved'
});

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function auditedRecord(cityId) {
  const key = clean(cityId);
  if (!key) return null;
  return coverage702a._internal.auditedRecords().find(record => record.cityId === key) || null;
}

function staticMappingState(cityId) {
  const record = auditedRecord(cityId);
  if (!record) {
    return {
      cityId: clean(cityId) || null,
      knownCity: false,
      staticProviderMappingVerified: false,
      travelpayoutsMapped: false,
      routeIdentityReady: false,
      mappingType: null,
      providerLocationCode: null
    };
  }

  const travelpayoutsMapped = record.staticProviderMappings?.travelpayoutsMapped === true;
  const routeIdentityReady = record.route?.hasUsableLocationCode === true;
  return {
    cityId: record.cityId,
    displayName: record.displayName,
    countryCode: record.countryCode,
    knownCity: true,
    staticProviderMappingVerified: travelpayoutsMapped && routeIdentityReady,
    travelpayoutsMapped,
    routeIdentityReady,
    mappingType: record.staticProviderMappings?.travelpayoutsMappingType || null,
    providerLocationCode: record.route?.providerLocationCode || record.route?.preferredAirportCode || record.route?.gatewayAirportCode || null
  };
}

function normalizeTravelpayoutsResult(cityId, raw = {}) {
  const mapping = staticMappingState(cityId);
  const status = lower(raw.status || raw.reason);
  const observationCount = Number.isFinite(Number(raw.observationCount))
    ? Math.max(0, Number(raw.observationCount))
    : (Array.isArray(raw.observations) ? raw.observations.length : (raw.inventoryObserved === true ? 1 : 0));
  const observed = observationCount > 0 || raw.inventoryObserved === true || status === 'live';
  const providerError = status === 'provider-error' || status.includes('provider-error');
  const credentialsUnavailable = status === 'provider-credentials-unavailable';
  const explicitStaticUnresolved = status === 'unresolved-static-mapping';

  let cacheObservationStatus;
  if (!mapping.staticProviderMappingVerified || explicitStaticUnresolved) {
    cacheObservationStatus = CACHE_STATES.STATIC_UNRESOLVED;
  } else if (providerError) {
    cacheObservationStatus = CACHE_STATES.PROVIDER_ERROR;
  } else if (credentialsUnavailable || status === 'not-checked') {
    cacheObservationStatus = CACHE_STATES.NOT_CHECKED;
  } else if (observed) {
    cacheObservationStatus = CACHE_STATES.OBSERVED;
  } else {
    cacheObservationStatus = CACHE_STATES.MISS;
  }

  const cacheEvidencePresent = cacheObservationStatus === CACHE_STATES.OBSERVED;
  const cacheMiss = cacheObservationStatus === CACHE_STATES.MISS;

  return {
    version: VERSION,
    provider: SOURCE_PROVIDER,
    cityId: mapping.cityId,
    displayName: mapping.displayName || null,
    countryCode: mapping.countryCode || null,

    // Mapping validity is a static/reviewed property. It must not be erased by
    // a zero-result cache query.
    staticProviderMappingVerified: mapping.staticProviderMappingVerified,
    mappingType: mapping.mappingType,
    providerLocationCode: mapping.providerLocationCode,

    // Observation state is a separate, time-sensitive cache fact.
    cacheObservationStatus,
    cacheEvidencePresent,
    cacheObservationCount: observationCount,

    // Travelpayouts Data API observations remain planning-grade cached evidence.
    evidenceClass: cacheEvidencePresent ? EVIDENCE_CLASSES_683C.CACHED_PROVIDER : EVIDENCE_CLASSES_683C.UNAVAILABLE,
    rankingGrade: cacheEvidencePresent ? RANKING_GRADES_683C.PLANNING_ONLY : RANKING_GRADES_683C.UNAVAILABLE,
    exactDateLiveVerificationSatisfied: false,
    decisionGradeFromTravelpayoutsCacheAlone: false,

    // A miss says nothing conclusive about route existence or future exact-date
    // availability. It only says this cache query returned no recent evidence.
    availabilityConclusion: !mapping.staticProviderMappingVerified
      ? 'static-provider-mapping-unresolved'
      : cacheEvidencePresent
        ? 'cached-provider-evidence-present'
        : cacheMiss
          ? 'unknown-not-proven-unavailable'
          : providerError
            ? 'unknown-provider-query-failed'
            : 'unknown-not-live-verified',

    liveVerificationRecommended: mapping.staticProviderMappingVerified && !cacheEvidencePresent,
    preferredLiveVerifier: 'Duffel exact-date offer request',

    // This semantics layer never promotes a city by itself.
    productionEligibleFromThisLayer: false,
    activationWritten: false,
    thresholdsRelaxed: false,
    sourceStatus: raw.status || raw.reason || null
  };
}

function baselineSemantics() {
  const records = coverage702a._internal.auditedRecords();
  const normalized = records.map(record => {
    const mapping = staticMappingState(record.cityId);
    const retryQueues = Array.isArray(record.activation?.retryQueues) ? record.activation.retryQueues : [];
    const missingFlightObservation = retryQueues.includes('missing-flight-observations');
    return {
      cityId: record.cityId,
      displayName: record.displayName,
      countryCode: record.countryCode,
      productionActiveIn668T: record.readiness?.productionActive === true,
      staticProviderMappingVerified: mapping.staticProviderMappingVerified,
      historicalMissingFlightObservation: missingFlightObservation,
      historicalPrimaryGap: record.readiness?.primaryGap || null,
      correctInterpretation: missingFlightObservation && mapping.staticProviderMappingVerified
        ? 'valid-static-mapping-no-historical-cache-observation'
        : null
    };
  });

  const staticallyMapped = normalized.filter(row => row.staticProviderMappingVerified);
  const missingFlight = normalized.filter(row => row.historicalMissingFlightObservation);
  const mappedMissingFlight = missingFlight.filter(row => row.staticProviderMappingVerified);
  const primaryMissingFlight = normalized.filter(row => row.historicalPrimaryGap === 'retry-queue:missing-flight-observations');

  return {
    ok: true,
    version: VERSION,
    status: 'cache-semantics-audit-ready',
    counts: {
      curatedCities: normalized.length,
      staticTravelpayoutsMappingsVerified: staticallyMapped.length,
      historicalMissingFlightObservationRetryQueue: missingFlight.length,
      mappedCitiesWithHistoricalMissingFlightObservation: mappedMissingFlight.length,
      primaryMissingFlightObservationGap: primaryMissingFlight.length
    },
    semantics: {
      positiveTravelpayoutsObservation: 'CACHED_PROVIDER / PLANNING_ONLY',
      zeroTravelpayoutsObservation: 'NO_RECENT_CACHE_OBSERVATION',
      zeroObservationDoesNotMean: ['invalid-static-mapping', 'route-does-not-exist', 'future-itinerary-unavailable'],
      exactDateLiveVerifier: 'Duffel offer request'
    },
    productionImpact: {
      activationWritten: false,
      runtimeImported: false,
      changes668T: false
    },
    records: clone(normalized)
  };
}

module.exports = {
  VERSION,
  SOURCE_PROVIDER,
  CACHE_STATES,
  staticMappingState,
  normalizeTravelpayoutsResult,
  baselineSemantics,
  _internal: { auditedRecord }
};
