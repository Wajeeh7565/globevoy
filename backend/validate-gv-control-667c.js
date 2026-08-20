'use strict';

process.env.ENABLE_STABLE_ROUTE_CONTROLS_667C = 'true';

const fs = require('fs');
const path = require('path');
const controls = require('./generated-tour-controls');
const {
  indexes,
  normalizeStopRecords,
  mutateStopRecords,
  parseCurrentStopRefs,
  resolveExistingStopRef,
  stableStopIdentityEnabled
} = controls._internal;

const checks = [];
function check(name, condition, details = null) {
  checks.push({ name, passed: Boolean(condition), details });
  if (!condition) throw new Error(`Validation failed: ${name}`);
}

const idx = indexes();
const origin = idx.byId.get('toronto-ca');
check('667C feature flag is active', stableStopIdentityEnabled());
check('Toronto origin exists', Boolean(origin));

const canonicalQuery = {
  origin: 'YYZ',
  currency: 'CAD',
  budget: 2000,
  totalNights: 5,
  action: 'shuffle',
  stopIndex: 1,
  currentStops: 'havana-cu,tulum-mx',
  currentStopRefs: JSON.stringify([
    { cityId: 'havana-cu', city: 'Havana', countryCode: 'CU', code: 'HAV' },
    { cityId: 'tulum-mx', city: 'Tulum', countryCode: 'MX', code: 'TQO', gatewayAirportCode: 'CUN' }
  ]),
  variant: 'gv-control-667c-validation'
};

const parsed = parseCurrentStopRefs(canonicalQuery);
check('frontend-shaped stop references parse', parsed.length === 2, parsed);
check('gateway airport is metadata, not an extra stop', parsed[1].gatewayAirportCode === 'CUN' && parsed.length === 2, parsed[1]);

const resolved = normalizeStopRecords(canonicalQuery, idx, origin);
check('Havana and Tulum both resolve as existing route stops', resolved.map(r => r.cityId).join(',') === 'havana-cu,tulum-mx', resolved.map(r => r.cityId));
check('limited existing stop is preserved even when not eligible as a new candidate', resolved[0]?.multiCitySuitability?.status === 'limited');

const shuffled = mutateStopRecords(canonicalQuery, idx, origin);
check('Toronto-Havana-Tulum shuffle no longer returns minimum-two-stops', shuffled.supported === true && shuffled.reason !== 'minimum-two-stops', { reason: shuffled.reason, message: shuffled.message });
check('unselected Havana stop is preserved', shuffled.records?.[0]?.cityId === 'havana-cu', shuffled.records?.map(r => r.cityId));
check('selected Tulum stop is replaced', shuffled.records?.[1]?.cityId !== 'tulum-mx', shuffled.records?.map(r => r.cityId));
check('shuffle returns exactly two destination stops', shuffled.records?.length === 2, shuffled.records?.map(r => r.cityId));

const byCityCountry = resolveExistingStopRef({ city: 'Havana', countryCode: 'CU' }, idx, origin);
check('city and country fallback resolves a stop without an ID', byCityCountry?.cityId === 'havana-cu', byCityCountry?.cityId);
const byCode = resolveExistingStopRef({ code: 'TQO', city: 'Tulum', countryCode: 'MX' }, idx, origin);
check('IATA/location-code fallback resolves a stop without an ID', byCode?.cityId === 'tulum-mx', byCode?.cityId);

const malformedFallback = normalizeStopRecords({ ...canonicalQuery, currentStopRefs: '{bad json', currentStops: 'havana-cu,tulum-mx' }, idx, origin);
check('malformed structured references safely fall back to legacy IDs', malformedFallback.length === 2, malformedFallback.map(r => r.cityId));

const unresolved = mutateStopRecords({
  ...canonicalQuery,
  currentStops: 'havana-cu,unknown-place',
  currentStopRefs: JSON.stringify([
    { cityId: 'havana-cu', city: 'Havana', countryCode: 'CU' },
    { cityId: 'unknown-place', city: 'Unknown Place', countryCode: 'ZZ' }
  ])
}, idx, origin);
check('unresolved current stop leaves route unchanged with accurate error', unresolved.supported === false && unresolved.reason === 'route-stop-identity-unresolved', unresolved);
check('unresolved identity error does not falsely claim fewer than two stops', !/needs at least two/i.test(unresolved.message || ''), unresolved.message);

const actualOneStop = mutateStopRecords({
  ...canonicalQuery,
  action: 'refresh',
  currentStops: 'tulum-mx',
  currentStopRefs: JSON.stringify([{ cityId: 'tulum-mx', city: 'Tulum', countryCode: 'MX' }])
}, idx, origin);
check('an actual one-stop route still receives the two-destination guard', actualOneStop.supported === false && actualOneStop.reason === 'minimum-two-stops', actualOneStop);

const frontendPath = path.resolve(__dirname, '../gv_control_667c_frontend/scripts/multicity-visualizer-651b.js');
const frontend = fs.readFileSync(frontendPath, 'utf8');
check('frontend sends structured currentStopRefs', frontend.includes('params.currentStopRefs=currentStopRefs(t)'));
check('frontend preserves legacy currentStops for compatibility', frontend.includes('params.currentStops=currentStopIds(t)'));
check('frontend separates route stop index from leg index', frontend.includes('const controlIndex=Number.isFinite(Number(item.stopIndex))'));
check('frontend includes gateway identity metadata', frontend.includes('gatewayAirportCode'));

const output = {
  version: controls.CONTROL_VERSION,
  task: 'GV-CONTROL-667C',
  passed: checks.filter(c => c.passed).length,
  total: checks.length,
  checks,
  sampleShuffle: {
    before: ['havana-cu', 'tulum-mx'],
    after: shuffled.records.map(r => r.cityId),
    message: shuffled.message
  }
};
fs.writeFileSync(path.resolve(__dirname, 'VALIDATION_GV_CONTROL_667C.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
