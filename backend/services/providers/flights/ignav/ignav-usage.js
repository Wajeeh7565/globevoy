'use strict';

const counters = {
  'fare-sent': 'fareRequests',
  'booking-link-sent': 'bookingLinkRequests',
  'local-hit': 'localCacheHits',
  'shared-hit': 'sharedCacheHits',
  'joined': 'concurrentJoins',
  'failed': 'failedRequests',
  'timeout': 'timeouts',
  'blocked': 'quotaBlocked'
};

function record(options, event, details = {}) {
  const field = counters[event];
  if (field && options.usage) options.usage[field] = (options.usage[field] || 0) + 1;
  const env = options.env || process.env;
  if (env.IGNAV_USAGE_LOG !== 'on' && !options.logIgnavUsage) return;
  // Only operational fields are accepted. Request inputs and provider payloads never enter logs.
  const row = { event: 'ignav-usage', action: event };
  for (const key of ['endpoint', 'audience', 'outcome', 'window', 'strategy']) {
    const value = details[key] ?? (key === 'audience' ? options.ignavAudience : undefined);
    if (typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)) row[key] = value;
  }
  for (const key of ['latencyMs', 'status', 'checks', 'rounds', 'unusedSpares', 'shown', 'used', 'allowance', 'threshold', 'sparesStarted', ...Object.values(counters)]) {
    const value = details[key];
    if (Number.isFinite(value) && value >= 0) row[key] = value;
  }
  try { (options.logIgnavUsage || (entry => console.info(JSON.stringify(entry))))(row); } catch (_) { /* logging is best effort */ }
}

module.exports = { record };
