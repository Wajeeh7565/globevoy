'use strict';

// GV-CITY-668S — public, read-only Inactive City Recovery Wave 1 plan.
// This module never calls providers and never changes the 668R production
// activation allowlist.

const plan = require('../../../data/inactive-city-recovery-wave1-150-668s.json');

const VERSION = 'GV-CITY-668S';

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function normalize(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function enabled() { return lower(process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S) === 'true'; }

const records = Array.isArray(plan.records) ? plan.records.filter(Boolean) : [];

function summary() {
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    status: enabled() ? 'inactive-city-recovery-wave-1-plan-ready' : 'feature-disabled',
    generatedAt: plan.generatedAt,
    source: clone(plan.source),
    summary: clone(plan.summary),
    policy: clone(plan.policy),
    activationState: {
      currentVersion: 'GV-CITY-668R',
      auditedCount: Number(plan.source?.auditedCityCountBeforeRun || 1000),
      productionActiveCount: Number(plan.source?.productionActiveCountBeforeRun || 421),
      reviewedInactiveCount: Number(plan.source?.reviewedInactiveCountBeforeRun || 579),
      current500ActiveCount: Number(plan.source?.current500ActiveBeforeRun || 309),
      expansion500ActiveCount: Number(plan.source?.expansion500ActiveBeforeRun || 112),
      unchangedUntilRecoveryImport: true
    },
    auditProjection: {
      auditedAfterRun: 1000,
      unauditedAfterRun: 0,
      productionActiveAfterRun: '421 + reviewed production-ready recoveries',
      activationImportRequired: true
    },
    nextAction: enabled()
      ? 'Run the authenticated Recovery150 audit. Review and import only production-qualified recoveries.'
      : 'Set ENABLE_INACTIVE_CITY_RECOVERY_668S=true.',
    disclaimer: 'This is a recovery audit target plan, not a production activation list. Existing qualification thresholds remain unchanged.'
  };
}

function search(query = {}) {
  const q = normalize(query.q || query.query || '');
  const region = lower(query.region || query.worldRegion || '');
  const tier = lower(query.tier || query.selectionTier || '');
  const group = lower(query.group || '');
  const lane = lower(query.lane || query.recoveryLane || '');
  const queue = lower(query.queue || query.retryQueue || '');
  const internationalAirport = lower(query.internationalAirport || '');
  const gateway = lower(query.gateway || query.requiresGatewayTransfer || '');
  const offset = safeInt(query.offset, 0, 0, records.length);
  const limit = safeInt(query.limit, 50, 1, 200);

  const matches = records.filter(record => {
    if (region && lower(record.worldRegion) !== region) return false;
    if (tier && lower(record.selectionTier) !== tier) return false;
    if (group && lower(record.group) !== group) return false;
    if (lane && lower(record.recoveryLane) !== lane) return false;
    if (queue && !(record.retryQueues || []).some(value => lower(value) === queue)) return false;
    if (internationalAirport === 'true' && record.internationalAirportSignal !== true) return false;
    if (internationalAirport === 'false' && record.internationalAirportSignal !== false) return false;
    if (gateway === 'true' && record.requiresGatewayTransfer !== true) return false;
    if (gateway === 'false' && record.requiresGatewayTransfer !== false) return false;
    if (q) {
      const values = [
        record.cityId, record.displayName, record.country, record.countryCode,
        record.recoveryLane, record.previousClassification, record.previousActivationReason,
        ...(record.retryQueues || [])
      ].map(normalize).filter(Boolean);
      if (!values.some(value => value.includes(q))) return false;
    }
    return true;
  });

  matches.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    status: enabled() ? 'inactive-city-recovery-wave-1-plan-ready' : 'feature-disabled',
    offset,
    count: Math.min(limit, Math.max(0, matches.length - offset)),
    totalMatches: matches.length,
    records: clone(matches.slice(offset, offset + limit)),
    disclaimer: 'Selected cities remain estimate-only until new provider results are reviewed and imported.'
  };
}

module.exports = { VERSION, enabled, summary, search };
