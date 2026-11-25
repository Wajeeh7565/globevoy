#!/usr/bin/env node
// GV-JINKO-DISC-001: manual check of Jinko's discovery endpoints. Run on your own
// computer; nothing is deployed and nothing is saved.
//
//   Sandbox (free):   JINKO_API_KEY=jnk_sandbox_t_... node ops/providers/jinko-discovery-check.mjs
//   Dry run:          node ops/providers/jinko-discovery-check.mjs --dry-run
//   Production (BILLED, needs approval): JINKO_API_KEY=jnk_t_... node ops/providers/jinko-discovery-check.mjs --production --max-calls 3
//
// Default: 3 calls (find_dates, lowest_fare, find_destination). Hard maximum 10.
// Keep the key in your shell only. Do not paste it into chat or commit it.
// Prices are printed for this check and not stored anywhere (Jinko API terms 5.2.2).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClient, HARD_MAX_CALLS } = require('../../backend/services/providers/flights/jinko/jinko-discovery.js');

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const plus = d => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);

// Legs that had gaps in the Nov 24-25 live tests (Travelpayouts or Ignav).
const CHECKS = [
  ['find_dates', { origins: ['YUL'], destinations: ['YYZ'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(30), end: plus(60) }], currency: 'CAD', limit: 31 }],
  ['lowest_fare', { origins: ['LHR'], destinations: ['AGA'], trip_type: 'oneway', departure_dates: [plus(45)], currency: 'CAD', limit: 5 }],
  ['find_destination', { origins: ['LHE'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(30), end: plus(90) }], currency: 'CAD', limit: 20 }],
  ['find_dates', { origins: ['CUN'], destinations: ['BWI'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(40), end: plus(70) }], currency: 'CAD', limit: 31 }],
  ['flight_calendar', { origins: ['YYZ'], destinations: ['IKA'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(30), end: plus(90) }], currency: 'CAD', limit: 20 }],
  ['find_destination', { origins: ['ADD'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(30), end: plus(90) }], currency: 'CAD', limit: 20 }],
  ['find_dates', { origins: ['TNG'], destinations: ['ALC'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(30), end: plus(60) }], currency: 'CAD', limit: 31 }],
  ['lowest_fare', { origins: ['YVR'], destinations: ['MNL'], trip_type: 'oneway', departure_dates: [plus(50)], currency: 'CAD', limit: 5 }],
  ['find_dates', { origins: ['DXB'], destinations: ['AYT'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(30), end: plus(60) }], currency: 'CAD', limit: 31 }],
  ['find_destination', { origins: ['YYZ'], trip_type: 'oneway', departure_date_ranges: [{ start: plus(30), end: plus(90) }], currency: 'CAD', limit: 20 }]
];

const max = Math.min(HARD_MAX_CALLS, Math.max(1, Number(val('--max-calls', 3)) || 3));
const plan = CHECKS.slice(0, max);
if (flag('--dry-run')) { for (const [e, r] of plan) console.log(e, JSON.stringify(r)); process.exit(0); }

const key = process.env.JINKO_API_KEY || '';
if (!key) { console.error('Set JINKO_API_KEY in your shell (sandbox keys start with jnk_sandbox_t_).'); process.exit(2); }
const sandbox = key.startsWith('jnk_sandbox_');
if (!sandbox && !flag('--production')) { console.error('This is a production key (billed). Add --production only after approval.'); process.exit(2); }
console.log(`Jinko discovery check: ${sandbox ? 'SANDBOX (not billed)' : 'PRODUCTION (billed)'}, ${plan.length} call(s), timeout 2.5 s, no retries\n`);

const client = createClient({ apiKey: key, allowProduction: !sandbox, maxCalls: plan.length, timeoutMs: Number(val('--timeout-ms', 2500)) });
const age = t => (t ? Math.round((Date.now() - Date.parse(t)) / 3600e3) + ' h old' : 'no priced_at');
for (const [endpoint, req] of plan) {
  const r = await client.call(endpoint, req);
  const last = client.usage().log.at(-1);
  const route = `${req.origins.join(',')}${req.destinations ? '-' + req.destinations.join(',') : ' (anywhere)'}`;
  if (!r.ok) { console.log(`${endpoint.padEnd(16)} ${route.padEnd(14)} FAILED ${r.reason}${r.code ? ' ' + r.code : ''} (${last.ms} ms)`); continue; }
  if (r.status === 'no-cached-fare') { console.log(`${endpoint.padEnd(16)} ${route.padEnd(14)} no cached fare (${r.emptyReason || 'no reason'}) (${last.ms} ms): NOT proof there is no flight`); continue; }
  const list = r.destinations ? r.destinations.map(d => d.lowest).filter(Boolean) : r.itineraries;
  const cheapest = list.slice().sort((a, b) => a.total - b.total)[0];
  console.log(`${endpoint.padEnd(16)} ${route.padEnd(14)} ${list.length} result(s) (${last.ms} ms)` + (cheapest ? `; cheapest ${cheapest.currency} ${cheapest.total} on ${String(cheapest.departure).slice(0, 10)} ${cheapest.destination}, ${cheapest.stops ?? '?'} stops, ${age(cheapest.pricedAt)}` : ''));
}
const u = client.usage();
console.log(`\ncalls made ${u.calls}/${u.maxCalls}, refused ${u.refused}${u.stopped ? ', stopped: ' + u.stopped : ''}`);
if (!sandbox) console.log('Now check the dashboard Billing page and note the cost of these calls before running more.');
