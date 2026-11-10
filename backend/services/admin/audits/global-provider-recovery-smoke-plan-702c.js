'use strict';

// GV-REC-702C — deterministic plan for the first bounded provider recovery smoke.
// Planning only: no provider calls, no credentials, no activation writes.

const recoveryPriority = require('./global-recovery-priority-702b');

const VERSION = 'GV-REC-702C';
const HARD_MAX_CITIES = 10;
const TARGET_LANE = 'due-now-first-recovery';
const TARGET_GAP = 'retry-queue:missing-flight-observations';

const RECOVERY_POLICY = Object.freeze({
  flightMonths: 4,
  regionalAnchorCount: 6,
  maximumFlightAttempts: 20,
  maxComfortDurationMinutes: 1080,
  maxComfortTransfers: 1,
  maximumGatewayTransferMinutes: 180,
  thresholdsRelaxed: false
});

function clean(value) { return String(value || '').trim(); }
function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function buildSmokePlan(options = {}) {
  const limit = safeInt(options.limit, HARD_MAX_CITIES, 1, HARD_MAX_CITIES);
  const asOf = clean(options.asOf) || undefined;
  const source = recoveryPriority.search({
    asOf,
    lane: TARGET_LANE,
    gap: TARGET_GAP,
    previousRecovery: 'false',
    due: 'true',
    limit: 200
  });

  const candidates = (Array.isArray(source.records) ? source.records : [])
    .filter(record => record.lane === TARGET_LANE)
    .filter(record => record.primaryGap === TARGET_GAP)
    .filter(record => record.previousRecovery668S === false)
    .filter(record => record.reviewDue === true)
    .slice(0, limit)
    .map((record, index) => ({
      rank: index + 1,
      cityId: record.cityId,
      displayName: record.displayName,
      country: record.country,
      countryCode: record.countryCode,
      worldRegion: record.worldRegion,
      selectionTier: record.selectionTier,
      providerLocationCode: record.route?.providerLocationCode || null,
      preferredAirportCode: record.route?.preferredAirportCode || null,
      gatewayAirportCode: record.route?.gatewayAirportCode || null,
      primaryGap: record.primaryGap,
      evidenceAgeDays: record.evidenceAgeDays,
      priorityScore: record.priorityScore,
      previousRecovery668S: false,
      reviewDue: true,
      requiresExactItineraryVerification: true,
      activationAllowedByThisPlan: false
    }));

  return {
    ok: true,
    version: VERSION,
    status: 'bounded-provider-smoke-plan-ready',
    asOf: source.asOf || asOf || null,
    sourcePriorityVersion: recoveryPriority.VERSION,
    sourceDueFirstRecoveryMatches: source.totalMatches,
    selectedCount: candidates.length,
    hardMaxCities: HARD_MAX_CITIES,
    providerScope: 'Travelpayouts-flight-only',
    targetLane: TARGET_LANE,
    targetGap: TARGET_GAP,
    recoveryPolicy: clone(RECOVERY_POLICY),
    candidates,
    safety: {
      planOnly: true,
      noProviderCalls: true,
      noAgodaCalls: true,
      noCredentials: true,
      noActivationWrites: true,
      noSnapshotWrites: true,
      thresholdsRelaxed: false,
      exactItineraryVerificationStillRequired: true
    }
  };
}

module.exports = {
  VERSION,
  HARD_MAX_CITIES,
  TARGET_LANE,
  TARGET_GAP,
  RECOVERY_POLICY,
  buildSmokePlan
};
