'use strict';

// GV-REC-702B — freshness-aware recovery prioritization over the 702A
// mapped/reviewed-inactive pool. This module never calls providers and never
// activates a city. It exists specifically to avoid blindly repeating the
// July 2026 668-series audits.

const coverage702a = require('./global-recommendation-coverage-702a');
const activationSnapshot = require('../data/verified-city-activation-1000-668t.json');
const recovery668s = require('../data/inactive-city-recovery-wave1-150-668s.json');

const VERSION = 'GV-REC-702B';
const FLAG_NAME = 'ENABLE_GLOBAL_RECOVERY_PRIORITY_702B';
const DEFAULT_AS_OF = null;

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function upper(value) { return clean(value).toUpperCase(); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
function enabled() { return lower(process.env[FLAG_NAME]) === 'true'; }
function parseAsOf(value = DEFAULT_AS_OF) {
  const raw = clean(value);
  const parsed = raw ? Date.parse(raw) : Date.now();
  return Number.isFinite(parsed) ? parsed : Date.now();
}
function ageDays(lastVerifiedAt, asOfMs) {
  const checked = Date.parse(clean(lastVerifiedAt));
  if (!Number.isFinite(checked)) return null;
  return Math.max(0, Math.floor((asOfMs - checked) / 86400000));
}

const reviewAfterDays = Number(activationSnapshot.policy?.reviewAfterDays || 30);
const recoverySelectedIds = new Set(Array.isArray(recovery668s.cityIds) ? recovery668s.cityIds : []);

function activeRateByRegion() {
  const base = coverage702a.summary().regions || {};
  const result = {};
  for (const [region, stats] of Object.entries(base)) {
    const total = Number(stats?.total || 0);
    const active = Number(stats?.productionActive || 0);
    result[region] = total > 0 ? active / total : 0;
  }
  return result;
}

function blockerWeight(primaryGap) {
  const gap = lower(primaryGap);
  if (gap === 'retry-queue:missing-flight-observations') return 24;
  if (gap === 'retry-queue:flight-comfort-failure') return 16;
  if (gap === 'retry-queue:no-live-hotel-rate') return 12;
  if (gap === 'retry-queue:hotel-quality-failure') return 10;
  if (gap === 'reviewed-not-production-active') return 8;
  return 5;
}

function priorityLane(record, age, previouslyRecoveryAudited) {
  if (age === null) return 'due-now-missing-verification-date';
  if (age >= reviewAfterDays && !previouslyRecoveryAudited) return 'due-now-first-recovery';
  if (age >= reviewAfterDays && previouslyRecoveryAudited) return 'due-now-repeat-recovery';
  if (previouslyRecoveryAudited) return 'defer-recent-recovery';
  if (age >= Math.max(0, reviewAfterDays - 5)) return 'approaching-review';
  return 'defer-not-due';
}

function priorityRecord(record, asOfMs, regionRates) {
  const previouslyRecoveryAudited = recoverySelectedIds.has(record.cityId);
  const age = ageDays(record.activation?.lastVerifiedAt, asOfMs);
  const lane = priorityLane(record, age, previouslyRecoveryAudited);
  const regionRate = regionRates[record.worldRegion] ?? 0;
  const underCoverageBonus = Math.round((1 - Math.max(0, Math.min(1, regionRate))) * 20);

  let score = 50;
  score += blockerWeight(record.readiness?.primaryGap);
  score += underCoverageBonus;
  if (record.selectionTier === 'expansion-500') score += 10;
  if (record.group === 'GROUP_1') score += 6;
  if (record.route?.requiresGatewayTransfer) score -= 5;

  if (age === null) score += 20;
  else if (age >= reviewAfterDays) score += 18 + Math.min(12, age - reviewAfterDays);
  else if (age >= reviewAfterDays - 5) score += 6;

  if (previouslyRecoveryAudited) {
    // July 22 Recovery150 already spent a larger bounded search budget on these
    // cities. De-prioritize until their evidence crosses the review horizon.
    score -= age !== null && age >= reviewAfterDays ? 8 : 24;
  }

  return {
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    worldRegion: record.worldRegion,
    selectionTier: record.selectionTier,
    group: record.group,
    route: clone(record.route),
    primaryGap: record.readiness?.primaryGap || null,
    gapCodes: clone(record.readiness?.gapCodes || []),
    retryQueues: clone(record.activation?.retryQueues || []),
    lastVerifiedAt: record.activation?.lastVerifiedAt || null,
    evidenceAgeDays: age,
    reviewAfterDays,
    reviewDue: age === null || age >= reviewAfterDays,
    previousRecovery668S: previouslyRecoveryAudited,
    previousRecoveryWave: previouslyRecoveryAudited ? 1 : null,
    previousRecoveryPlanGeneratedAt: previouslyRecoveryAudited ? recovery668s.generatedAt : null,
    regionalProductionActiveRate: Number(regionRate.toFixed(4)),
    lane,
    priorityScore: Math.max(0, Math.round(score)),
    requiresExactItineraryVerification: true,
    activationAllowedByThisPlan: false
  };
}

function buildRecords(options = {}) {
  const asOfMs = parseAsOf(options.asOf);
  const regionRates = activeRateByRegion();
  const records = coverage702a._internal.auditedRecords()
    .filter(record => record.readiness?.tier === 'mapped-reviewed-inactive')
    .map(record => priorityRecord(record, asOfMs, regionRates));

  records.sort((a, b) => b.priorityScore - a.priorityScore
    || Number(b.reviewDue) - Number(a.reviewDue)
    || Number(a.previousRecovery668S) - Number(b.previousRecovery668S)
    || clean(a.displayName).localeCompare(clean(b.displayName))
    || upper(a.countryCode).localeCompare(upper(b.countryCode)));
  return { asOfMs, records };
}

function increment(map, key) {
  const safeKey = clean(key) || 'unknown';
  map[safeKey] = Number(map[safeKey] || 0) + 1;
}

function summary(options = {}) {
  const { asOfMs, records } = buildRecords(options);
  const lanes = {};
  const primaryGaps = {};
  const regions = {};
  let previousRecoverySurvivors = 0;
  let reviewDueCount = 0;
  let missingVerificationDateCount = 0;

  for (const record of records) {
    increment(lanes, record.lane);
    increment(primaryGaps, record.primaryGap);
    increment(regions, record.worldRegion);
    if (record.previousRecovery668S) previousRecoverySurvivors += 1;
    if (record.reviewDue) reviewDueCount += 1;
    if (record.evidenceAgeDays === null) missingVerificationDateCount += 1;
  }

  const notPreviouslyRecoveryAudited = records.length - previousRecoverySurvivors;
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    status: enabled() ? 'recovery-priority-ready' : 'feature-disabled',
    asOf: new Date(asOfMs).toISOString(),
    policy: {
      sourceActivationTaskId: activationSnapshot.taskId || 'GV-CITY-668T',
      sourceActivationGeneratedAt: activationSnapshot.generatedAt || null,
      reviewAfterDays,
      previousRecoveryTaskId: recovery668s.taskId || 'GV-CITY-668S',
      previousRecoveryGeneratedAt: recovery668s.generatedAt || null,
      previousRecoverySelectedCount: Number(recovery668s.summary?.selectedCount || recoverySelectedIds.size),
      previousRecoveryProductionReadyCount: Number(activationSnapshot.summary?.recoveredActiveCount || 0),
      thresholdsRelaxed: false
    },
    counts: {
      mappedReviewedInactive: records.length,
      previousRecoverySurvivors,
      notPreviouslyRecoveryAudited,
      reviewDue: reviewDueCount,
      notYetDue: records.length - reviewDueCount,
      missingVerificationDate: missingVerificationDateCount
    },
    lanes,
    primaryGaps,
    regions,
    recommendedFirstWave: clone(records.filter(record => record.lane === 'due-now-first-recovery').slice(0, 50)),
    nextAction: 'Use due-now-first-recovery as the first bounded provider re-check pool. Do not automatically re-run recent 668S survivors or activate any city from this plan alone.',
    disclaimer: '702B ranks old reviewed evidence for efficient re-checking. It makes no provider call, does not prove current inventory, and cannot activate a destination.'
  };
}

function search(query = {}) {
  const { asOfMs, records } = buildRecords({ asOf: query.asOf });
  const lane = lower(query.lane || '');
  const region = lower(query.region || query.worldRegion || '');
  const gap = lower(query.gap || query.primaryGap || '');
  const previousRecovery = lower(query.previousRecovery || query.recovery668s || '');
  const due = lower(query.due || query.reviewDue || '');
  const selectionTier = lower(query.tier || query.selectionTier || '');
  const offset = safeInt(query.offset, 0, 0, records.length);
  const limit = safeInt(query.limit, 50, 1, 200);

  const matches = records.filter(record => {
    if (lane && lower(record.lane) !== lane) return false;
    if (region && lower(record.worldRegion) !== region) return false;
    if (gap && lower(record.primaryGap) !== gap && !record.gapCodes.map(lower).includes(gap)) return false;
    if (previousRecovery === 'true' && !record.previousRecovery668S) return false;
    if (previousRecovery === 'false' && record.previousRecovery668S) return false;
    if (due === 'true' && !record.reviewDue) return false;
    if (due === 'false' && record.reviewDue) return false;
    if (selectionTier && lower(record.selectionTier) !== selectionTier) return false;
    return true;
  });

  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    asOf: new Date(asOfMs).toISOString(),
    offset,
    count: Math.min(limit, Math.max(0, matches.length - offset)),
    totalMatches: matches.length,
    records: clone(matches.slice(offset, offset + limit)),
    disclaimer: 'Priority output is a re-check worklist only; it is not an activation or availability result.'
  };
}

function resolve(input, options = {}) {
  const raw = clean(input);
  if (!raw) return null;
  const countryCode = upper(options.countryCode);
  const normalized = lower(raw);
  const { records } = buildRecords({ asOf: options.asOf });
  const matches = records.filter(record => {
    if (countryCode && upper(record.countryCode) !== countryCode) return false;
    return record.cityId === raw
      || lower(record.displayName) === normalized
      || upper(record.route?.providerLocationCode) === upper(raw)
      || upper(record.route?.preferredAirportCode) === upper(raw);
  });
  return matches.length === 1 ? clone(matches[0]) : null;
}

module.exports = {
  VERSION,
  FLAG_NAME,
  enabled,
  summary,
  search,
  resolve,
  _internal: {
    reviewAfterDays,
    recoverySelectedIds,
    activeRateByRegion,
    blockerWeight,
    priorityLane,
    priorityRecord,
    buildRecords,
    ageDays,
    parseAsOf
  }
};
