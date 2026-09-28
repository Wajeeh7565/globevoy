'use strict';
const assert = require('assert');

process.env.ENABLE_STAY22_EVIDENCE_682B = 'true';
process.env.STAY22_ALLOW_DEMO_682B = 'true';
process.env.STAY22_PRODUCTION_APPROVED_682B = 'true';
process.env.STAY22_API_KEY = 'validation-only-key';
process.env.ENABLE_STAY22_P2_DATE_PRICING_682B = 'true';
process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';

const identity = require('./services/providers/stays/shared/property-identity-682c');
const stay22 = require('./services/providers/stays/stay22/stay22-evidence-682b');
const live = require('./services/domain/live-fares/live-provider-verification');
const generated = require('./generated-tour');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
}
function payload(results, currency='USD') {
  return { meta: { currency, checkin: '2026-08-27', checkout: '2026-08-30', nights: 3 }, results };
}
function property({ id, name, address='Ottawa, Canada', total=300, supplier='booking', supplierId='sup-1' }) {
  return { id, name, type:'Hotel', rating:{ value:8.4, hotelStars:4, count:300 }, location:{ address }, suppliers:{ [supplier]:{ id:supplierId, link:'https://www.stay22.com/example', price:{ total } } } };
}

const selectedHotel = {
  name: 'Hilton Garden Inn Ottawa Downtown',
  hotelName: 'Hilton Garden Inn Ottawa Downtown',
  agodaHotelId: 'agoda-123',
  providerHotel: { provider:'Agoda', hotelName:'Hilton Garden Inn Ottawa Downtown', hotelId:'agoda-123', bookingUrl:'https://www.agoda.com/example' }
};
const selectedIdentity = identity.buildPropertyIdentity(selectedHotel, { city:'Ottawa', country:'Canada' });
const baseQuery = { city:'Ottawa', country:'Canada', checkIn:'2026-08-27', checkOut:'2026-08-30', adults:1, rooms:1, currency:'USD', targetProperty:selectedIdentity.canonicalName, targetIdentity:selectedIdentity };

test('682C version is exported through identity and generated-tour layers', () => {
  assert.equal(identity.PROPERTY_IDENTITY_VERSION_682C, 'GV-PROVIDER-682C');
  assert.equal(generated.PROPERTY_IDENTITY_VERSION_682C, 'GV-PROVIDER-682C');
  assert.match(generated.GENERATED_TOUR_VERSION, /682c-property-identity-hardening/);
});

test('specific selected hotel preserves canonical name, city and Agoda provider id', () => {
  assert.equal(selectedIdentity.status, 'specific-property');
  assert.equal(selectedIdentity.canonicalName, 'Hilton Garden Inn Ottawa Downtown');
  assert.equal(selectedIdentity.city, 'Ottawa');
  assert(selectedIdentity.providerRefs.some(ref => ref.provider === 'agoda' && ref.id === 'agoda-123'));
  assert.equal(selectedIdentity.safeForTargetedProviderSearch, true);
});

test('generic planning placeholder cannot become a targeted property identity', () => {
  const generic = identity.buildPropertyIdentity({ name:'Sharm el Sheikh central value stay' }, { city:'Sharm el Sheikh', country:'Egypt' });
  assert.equal(generic.status, 'generic-placeholder');
  assert.equal(generic.safeForTargetedProviderSearch, false);
});

test('exact normalized property name and consistent location is accepted', () => {
  const row = { propertyName:'Hilton Garden Inn Ottawa Downtown', address:'110 Lyon St N, Ottawa, Canada' };
  const match = identity.evaluateRowMatch(row, selectedIdentity);
  assert.equal(match.eligible, true);
  assert(match.score >= 0.99);
  assert.equal(match.basis, 'normalized-name-exact');
});

test('same brand but different Ottawa property is rejected', () => {
  const row = { propertyName:'Hilton Garden Inn Ottawa Airport', address:'Ottawa, Canada' };
  const match = identity.evaluateRowMatch(row, selectedIdentity);
  assert.equal(match.eligible, false);
});

test('matching name in conflicting city is rejected', () => {
  const row = { propertyName:'Hilton Garden Inn Ottawa Downtown', address:'Toronto, Canada' };
  const match = identity.evaluateRowMatch(row, selectedIdentity);
  assert.equal(match.eligible, false);
});

test('Stay22 targeted request carries identity and produces explicit match decision', async () => {
  stay22.clearCache();
  let urlSeen;
  const result = await stay22.fetchStay22Evidence(baseQuery, process.env, { _fetchFn: async url => { urlSeen = new URL(String(url)); return response(payload([property({ id:'stay22-1', name:'Hilton Garden Inn Ottawa Downtown', total:789 })])); } });
  assert.equal(urlSeen.searchParams.get('hotelsearch'), 'Hilton Garden Inn Ottawa Downtown');
  assert.equal(result.targetIdentity.version, 'GV-PROVIDER-682C');
  assert.equal(result.propertyMatchDecision.matched, true);
  assert.equal(result.exactPropertyMatch.propertyId, 'stay22-1');
  assert.equal(result.exactPropertyMatch.propertyIdentityVersion, 'GV-PROVIDER-682C');
});

test('ambiguous fuzzy alternatives fail closed rather than choosing a random property', () => {
  const target = identity.buildPropertyIdentity({ name:'Grand Plaza Ottawa Centre' }, { city:'Ottawa', country:'Canada' });
  const rows = [
    { propertyName:'Grand Plaza Ottawa Center East', address:'Ottawa, Canada', total:200 },
    { propertyName:'Grand Plaza Ottawa Center West', address:'Ottawa, Canada', total:190 }
  ];
  const result = identity.chooseConfidentMatch(rows, target, { nameThreshold:0.50, ambiguityMargin:0.05 });
  assert.equal(result.row, null);
  assert.equal(result.decision.reason, 'ambiguous-property-match');
});

test('generic stay receives city benchmark only and never same-property replacement', async () => {
  stay22.clearCache();
  const genericStop = { city:'Sharm el Sheikh', country:'Egypt', nights:3, arrivalDate:'2026-08-27', departureDate:'2026-08-30', hotel:{ name:'Sharm el Sheikh central value stay', estimatedStayUsd:153, estimatedNightlyUsd:51 } };
  const result = await live._internal.verifyStay(genericStop, { currency:'USD', adults:1, rooms:1 }, {
    _stay22FetchFn: async () => response(payload([property({ id:'other-1', name:'Xperience Hill-Top Beach Resort', address:'Sharm el Sheikh, Egypt', total:144 })])),
    _agodaFetchFn: async () => response({}, 503)
  });
  assert.notEqual(result.outcome, 'verified-stay22');
  assert.equal(result.stop.hotel.estimatedStayUsd, 153);
  assert.equal(result.stop.hotel.propertyIdentity.status, 'generic-placeholder');
});

test('approved exact Stay22 match preserves Agoda identity and records matched Stay22 identity', async () => {
  stay22.clearCache();
  const stop = { city:'Ottawa', country:'Canada', nights:3, arrivalDate:'2026-08-27', departureDate:'2026-08-30', hotel:{ ...selectedHotel, estimatedStayUsd:549, estimatedNightlyUsd:183 } };
  const result = await live._internal.verifyStay(stop, { currency:'USD', adults:1, rooms:1 }, {
    _stay22FetchFn: async () => response(payload([property({ id:'stay22-target', name:'Hilton Garden Inn Ottawa Downtown', total:789 })])),
    _agodaFetchFn: async () => response({}, 503)
  });
  assert.equal(result.outcome, 'verified-stay22');
  assert.equal(result.stop.hotel.propertyIdentity.version, 'GV-PROVIDER-682C');
  assert(result.stop.hotel.propertyIdentity.providerRefs.some(ref => ref.provider === 'agoda' && ref.id === 'agoda-123'));
  assert.equal(result.stop.hotel.propertyIdentity.matchedStay22PropertyId, 'stay22-target');
  assert.equal(result.stop.hotel.providerVerification.propertyIdentityVersion, 'GV-PROVIDER-682C');
  assert.equal(result.stop.hotel.providerVerification.propertyMatchBasis, 'normalized-name-exact');
  assert.equal(result.stop.hotel.providerHotel.bookingUrl, 'https://www.agoda.com/example');
});

test('P2 property targeting uses preserved identity and rejects generic placeholders', () => {
  const specificStop = { city:'Ottawa', country:'Canada', hotel:selectedHotel };
  const genericStop = { city:'Sharm el Sheikh', country:'Egypt', hotel:{ name:'Sharm el Sheikh central value stay' } };
  assert.equal(generated._internal.selectedHotelIdentity682C(specificStop).safeForTargetedProviderSearch, true);
  assert.equal(generated._internal.selectedHotelName682B(specificStop), 'Hilton Garden Inn Ottawa Downtown');
  assert.equal(generated._internal.selectedHotelIdentity682C(genericStop).safeForTargetedProviderSearch, false);
  assert.equal(generated._internal.selectedHotelName682B(genericStop), null);
});

test('Stay22 different-property response remains non-match despite cheaper price', async () => {
  stay22.clearCache();
  const result = await stay22.fetchStay22Evidence(baseQuery, process.env, { _fetchFn: async () => response(payload([
    property({ id:'airport', name:'Hilton Garden Inn Ottawa Airport', total:100 }),
    property({ id:'other', name:'Budget Alternative Suites', total:80 })
  ])) });
  assert.equal(result.exactPropertyMatch, null);
  assert.equal(result.propertyMatchDecision.matched, false);
  assert(result.warnings.includes('no-confident-property-match'));
});

(async () => {
  for (const item of tests) { await item.fn(); passed += 1; }
  console.log(`PASS ${passed}/${tests.length} - GV-PROVIDER-682C backend`);
})().catch(error => { console.error('FAIL - GV-PROVIDER-682C backend'); console.error(error.stack || error); process.exit(1); });
