'use strict';

// GV-PROVIDER-683C — provider-neutral flight search router.
// This is a search/evidence abstraction only. It has no order, booking, payment,
// ticketing or merchant-of-record capability.

const legacy = require('./cheap-one-way-flights');
const {
  FLIGHT_PROVIDER_CONTRACT_VERSION_683C,
  EVIDENCE_CLASSES_683C,
  RANKING_GRADES_683C,
  descriptor683C,
  normalizeResult683C
} = require('./flight-provider-contract-683c');

const DEFAULT_PROVIDER_ID_683C = 'travelpayouts-aviasales-data';
const duffel683D = require('./duffel/duffel-live-adapter-683d');
const adapters = new Map();

function travelpayoutsDescriptor() {
  return descriptor683C({
    id: DEFAULT_PROVIDER_ID_683C,
    label: 'Travelpayouts / Aviasales Data API',
    evidenceClass: EVIDENCE_CLASSES_683C.CACHED_PROVIDER,
    rankingGrade: RANKING_GRADES_683C.PLANNING_ONLY,
    livePricing: false,
    referralModelCompatible: true,
    supportsExactDate: true,
    supportsFlexibleDates: true,
    supportsMultiCity: false,
    productionApproved: true
  });
}

function decorateLegacyResult(rawResult, args, descriptor, extra = {}) {
  const normalized = normalizeResult683C(rawResult || {}, args || {}, descriptor);
  // Preserve legacy result selection semantics exactly. 683C adds canonical
  // metadata and row aliases; it does not change which Travelpayouts observation
  // P1/P2 would have selected before this release.
  const selectedLegacy = rawResult?.selectedObservation || rawResult?.bestBalanceObservation || rawResult?.bestObservation || null;
  const match = selectedLegacy && Array.isArray(normalized.observations)
    ? normalized.observations.find(row => row.departureDate === selectedLegacy.departureDate && Number(row.price) === Number(selectedLegacy.price))
    : null;
  return {
    ...normalized,
    ...extra,
    cheapestObservation: normalized.cheapestObservation || rawResult?.cheapestObservation || null,
    cheapestSuitableObservation: normalized.cheapestSuitableObservation || rawResult?.cheapestSuitableObservation || null,
    bestObservation: match || normalized.bestObservation || null,
    bestBalanceObservation: match || normalized.bestBalanceObservation || null,
    selectedObservation: match || normalized.selectedObservation || null
  };
}

registerAdapter683C({
  id: DEFAULT_PROVIDER_ID_683C,
  descriptor: travelpayoutsDescriptor(),
  async searchMonth(args = {}) {
    const raw = await legacy.fetchCheapOneWayFlightDates(args);
    return decorateLegacyResult(raw, args, travelpayoutsDescriptor(), {
      adapterSource: 'legacy-travelpayouts-cache-via-683c'
    });
  },
  async searchAcrossMonths(args = {}) {
    const raw = await legacy.fetchCheapestOneWayAcrossMonths(args);
    return decorateLegacyResult(raw, { ...args, month: args.startMonth || args.month }, travelpayoutsDescriptor(), {
      adapterSource: 'legacy-travelpayouts-cache-month-window-via-683c'
    });
  }
});

// 683D registers Duffel as a visible provider capability, but its normal router
// methods deliberately fail closed. This release is shadow-only; P1/P2 remain on
// the existing default provider until a later explicit promotion release.
registerAdapter683C({
  id: duffel683D.DUFFEL_PROVIDER_ID_683D,
  descriptor: duffel683D.descriptor683D(),
  async searchMonth(args = {}) {
    return duffel683D.searchMonth683D(args);
  },
  async searchAcrossMonths(args = {}) {
    return duffel683D.searchAcrossMonths683D(args);
  }
});

function validateAdapter683C(adapter = {}) {
  const errors = [];
  if (!String(adapter.id || '').trim()) errors.push('missing-id');
  if (!adapter.descriptor || typeof adapter.descriptor !== 'object') errors.push('missing-descriptor');
  if (typeof adapter.searchMonth !== 'function') errors.push('missing-searchMonth');
  if (typeof adapter.searchAcrossMonths !== 'function') errors.push('missing-searchAcrossMonths');
  return { valid: errors.length === 0, errors };
}

function registerAdapter683C(adapter = {}) {
  const check = validateAdapter683C(adapter);
  if (!check.valid) throw new Error(`Invalid GV-PROVIDER-683C adapter: ${check.errors.join(',')}`);
  const id = String(adapter.id).trim();
  adapters.set(id, { ...adapter, id, descriptor: descriptor683C(adapter.descriptor) });
  return id;
}

function unregisterAdapter683C(id) {
  if (String(id || '') === DEFAULT_PROVIDER_ID_683C) return false;
  return adapters.delete(String(id || ''));
}

function selectedProviderId683C(explicit) {
  const raw = String(explicit || process.env.GV_FLIGHT_PROVIDER_683C || DEFAULT_PROVIDER_ID_683C).trim();
  return raw || DEFAULT_PROVIDER_ID_683C;
}

function getAdapter683C(id) {
  return adapters.get(selectedProviderId683C(id)) || null;
}

function providerUnavailableResult(args = {}, providerId, reason = 'provider-adapter-unavailable') {
  return normalizeResult683C({ supported: false, reason, observations: [] }, args, {
    id: providerId || 'unavailable-provider',
    label: providerId || 'Unavailable provider',
    evidenceClass: EVIDENCE_CLASSES_683C.UNAVAILABLE,
    rankingGrade: RANKING_GRADES_683C.UNAVAILABLE,
    productionApproved: false
  });
}

async function fetchFlightDates683C(args = {}, options = {}) {
  const id = selectedProviderId683C(options.providerId || args.providerId);
  const adapter = getAdapter683C(id);
  if (!adapter) return providerUnavailableResult(args, id);
  try {
    const result = await adapter.searchMonth({ ...args, providerId: undefined });
    // Third-party/future adapters are normalized here even if they return their
    // own compact canonical rows. The default adapter already returns normalized
    // output, so this is idempotent for the current production path.
    return result?.providerContract?.version === FLIGHT_PROVIDER_CONTRACT_VERSION_683C
      ? result
      : normalizeResult683C(result || {}, args, adapter.descriptor);
  } catch (error) {
    return providerUnavailableResult(args, id, `provider-adapter-error:${String(error?.message || 'unknown')}`);
  }
}

async function fetchFlightAcrossMonths683C(args = {}, options = {}) {
  const id = selectedProviderId683C(options.providerId || args.providerId);
  const adapter = getAdapter683C(id);
  if (!adapter) return providerUnavailableResult({ ...args, month: args.startMonth || args.month }, id);
  try {
    const result = await adapter.searchAcrossMonths({ ...args, providerId: undefined });
    return result?.providerContract?.version === FLIGHT_PROVIDER_CONTRACT_VERSION_683C
      ? result
      : normalizeResult683C(result || {}, { ...args, month: args.startMonth || args.month }, adapter.descriptor);
  } catch (error) {
    return providerUnavailableResult({ ...args, month: args.startMonth || args.month }, id, `provider-adapter-error:${String(error?.message || 'unknown')}`);
  }
}

async function fetchDuffelShadow683D(args = {}, options = {}) {
  const raw = await duffel683D.searchExactDate683D(args, options);
  return normalizeResult683C(raw || {}, args, duffel683D.descriptor683D());
}

function duffelStatus683D(env = process.env) {
  return duffel683D.status683D(env);
}

function adapterSummary683C() {
  return {
    version: FLIGHT_PROVIDER_CONTRACT_VERSION_683C,
    defaultProvider: DEFAULT_PROVIDER_ID_683C,
    selectedProvider: selectedProviderId683C(),
    adapters: [...adapters.values()].map(adapter => ({ ...adapter.descriptor })),
    bookingCapability: false,
    orderCapability: false,
    paymentCapability: false,
    secretValuesReturned: false
  };
}

module.exports = {
  FLIGHT_PROVIDER_CONTRACT_VERSION_683C,
  DEFAULT_PROVIDER_ID_683C,
  validateAdapter683C,
  registerAdapter683C,
  unregisterAdapter683C,
  selectedProviderId683C,
  getAdapter683C,
  fetchFlightDates683C,
  fetchFlightAcrossMonths683C,
  fetchDuffelShadow683D,
  duffelStatus683D,
  adapterSummary683C,
  _adapters: adapters
};
