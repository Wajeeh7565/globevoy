'use strict';

const { createHash } = require('node:crypto');
const { upcomingMonths } = require('./fare-map-ingest');
const { collectionMonthCount, sixMonthsAfter } = require('./search-window');

const HOUR = 3600000;
const MAX_RUN_MS = 20 * HOUR;
const MAX_REQUESTS = 54000;
const MIN_INTERVAL_MS = 1250;
// A task skipped at boot stays within 72 hours through the next 48-hour
// cycle and a full 20-hour pass, with one hour left for dispatch jitter.
const MAX_SKIP_AGE_MS = 3 * HOUR;

function buildWorldwidePlan(selectable, legacyOrigins, now = Date.now()) {
  const airportCodes = new Set(selectable.map(row => row[4]).filter(code => /^[A-Z]{3}$/.test(code)));
  const legacy = new Set(legacyOrigins);
  const today = new Date(now).toISOString().slice(0, 10);
  const lastDeparture = new Date(Date.parse(sixMonthsAfter(today)) - 86400000);
  const months = upcomingMonths(collectionMonthCount(now), now);
  const departureMonths = months.filter(month => month <= lastDeparture.toISOString().slice(0, 7));
  const existingKeys = [...legacy].sort();
  const newAirports = [...airportCodes].filter(code => !legacy.has(code)).sort();
  const tasks = [
    ...months.flatMap(month => existingKeys.map(origin => ({ origin, month }))),
    ...departureMonths.flatMap(month => newAirports.map(origin => ({ origin, month })))
  ];
  const fingerprint = createHash('sha256').update(tasks.map(t => t.origin+'#'+t.month).join(',')).digest('hex');
  return { airportCount: airportCodes.size, legacyKeys: legacy.size, addedAirportKeys: newAirports.length, departureMonths,
    returnBufferMonths: months.slice(departureMonths.length), fingerprint, tasks };
}

module.exports = { buildWorldwidePlan, MAX_RUN_MS, MAX_REQUESTS, MIN_INTERVAL_MS, MAX_SKIP_AGE_MS };
