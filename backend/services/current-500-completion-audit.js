'use strict';

// GV-CITY-668K — public, read-only completion plan for the final Current-500
// audit wave. This module never calls providers and never changes the 668J
// production activation allowlist.

const plan = require('../data/current-500-completion-audit-145-668k.json');

const VERSION = 'GV-CITY-668K';

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
function enabled() {
  return lower(process.env.ENABLE_CURRENT_500_COMPLETION_AUDIT_668K) === 'true';
}

const records = Array.isArray(plan.records) ? plan.records.filter(Boolean) : [];

function summary() {
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    status: enabled() ? 'current-500-completion-audit-plan-ready' : 'feature-disabled',
    generatedAt: plan.generatedAt,
    source: clone(plan.source),
    summary: clone(plan.summary),
    policy: clone(plan.policy),
    activationState: {
      currentVersion: 'GV-CITY-668J',
      auditedCount: Number(plan.source?.auditedCityCountBeforeRun || 400),
      productionActiveCount: Number(plan.source?.productionActiveCountBeforeRun || 259),
      current500AuditedCount: Number(plan.source?.current500AuditedBeforeRun || 355),
      current500ProductionActiveCount: Number(plan.source?.current500ProductionActiveBeforeRun || 246),
      unchangedUntilAuditImport: true
    },
    completionProjection: {
      current500AuditedAfterRun: Number(plan.summary?.projectedCurrent500AuditedAfterRun || 500),
      totalAuditedAfterRun: Number(plan.summary?.projectedTotalAuditedAfterRun || 545),
      activationImportRequired: true
    },
    nextAction: enabled()
      ? 'Run the authenticated Final145 audit. Review and import its output before changing production activation.'
      : 'Set ENABLE_CURRENT_500_COMPLETION_AUDIT_668K=true.',
    disclaimer: 'This is an audit target plan, not a live-provider result or production activation list.'
  };
}

function search(query = {}) {
  const q = normalize(query.q || query.query || '');
  const region = lower(query.region || query.worldRegion || '');
  const group = lower(query.group || '');
  const productReview = lower(query.productReviewRequired || query.productReview || '');
  const internationalAirport = lower(query.internationalAirport || '');
  const gateway = lower(query.gateway || query.requiresGatewayTransfer || '');
  const offset = safeInt(query.offset, 0, 0, records.length);
  const limit = safeInt(query.limit, 50, 1, 200);
  const matches = records.filter(record => {
    if (region && lower(record.worldRegion) !== region) return false;
    if (group && lower(record.group) !== group) return false;
    if (productReview === 'true' && record.productReviewRequired !== true) return false;
    if (productReview === 'false' && record.productReviewRequired !== false) return false;
    if (internationalAirport === 'true' && record.internationalAirportSignal !== true) return false;
    if (internationalAirport === 'false' && record.internationalAirportSignal !== false) return false;
    if (gateway === 'true' && record.requiresGatewayTransfer !== true) return false;
    if (gateway === 'false' && record.requiresGatewayTransfer !== false) return false;
    if (q) {
      const textValues = [record.cityId, record.displayName, record.country].map(normalize).filter(Boolean);
      const exactCodes = [record.countryCode, record.providerLocationCode, record.preferredAirportCode].map(normalize).filter(Boolean);
      if (!textValues.some(value => value.includes(q)) && !exactCodes.includes(q)) return false;
    }
    return true;
  });
  matches.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    status: enabled() ? 'current-500-completion-audit-plan-ready' : 'feature-disabled',
    offset,
    count: Math.min(limit, Math.max(0, matches.length - offset)),
    totalMatches: matches.length,
    records: clone(matches.slice(offset, offset + limit)),
    disclaimer: 'These cities are selected for audit only. They remain estimate-only until verified results are reviewed and imported.'
  };
}

module.exports = { VERSION, enabled, summary, search };
