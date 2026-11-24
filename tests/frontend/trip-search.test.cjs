'use strict';
// GV-WEB-2: the new homepage/results search logic (frontend/scripts/trip-search.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const FIX = JSON.parse(fs.readFileSync('tests/frontend/fixtures/generated-tour-sample.json', 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));

function load({ responses, member = false, search = '' } = {}) {
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const calls = [];
  const window = {
    GlobevoyApi: {
      isConfigured: () => true,
      getGeneratedTour: async params => { calls.push(params); const r = responses[params.routeRole]; if (r instanceof Error) throw r; return clone(r); }
    }
  };
  const context = vm.createContext({ window, location: { search, pathname: '/results.html', hash: '' }, sessionStorage: store(), localStorage: store(), URLSearchParams, Date, JSON, Math, Number, String, Array, Object, Promise, Set });
  if (member) context.sessionStorage.setItem('globevoy.auth.session.705b-r3', JSON.stringify({ version: 'GV-ACCOUNT-705B-R3', accessToken: 't', user: { sub: 'u' }, expiresAt: Date.now() + 3600e3 }));
  vm.runInContext(fs.readFileSync('frontend/scripts/trip-search.js', 'utf8'), context);
  return { S: window.GlobevoyTripSearch, calls, context };
}
const okResponses = () => ({ 'best-balance': FIX['best-balance'], 'lowest-cost': FIX['lowest-cost'], 'most-memorable': FIX['most-memorable'] });
const SEARCH = { origin: 'Toronto (YYZ)', budget: 3000, currency: 'CAD', adults: 1, month: '', pace: 'balanced' };

test('trips with any estimated flight or hotel price are never shown', () => {
  const { S } = load({ responses: {} });
  assert.equal(S.isFullyLive(FIX['best-balance'].tour), true);
  const estimate = FIX['best-balance'].tours[1];
  assert.equal(S.isFullyLive(estimate), false, 'hotel without a live rate');
  const flight = clone(FIX['best-balance'].tour); flight.legs[1].liveFareVerified = false;
  assert.equal(S.isFullyLive(flight), false, 'flight without a live fare');
  const partial = clone(FIX['best-balance'].tour); partial.ignavLiveFares.partial = true;
  assert.equal(S.isFullyLive(partial), false, 'partially live flights');
});

test('guests get one live trip from a single request', async () => {
  const { S, calls } = load({ responses: okResponses() });
  const r = await S.findTrips(SEARCH, { member: false });
  assert.equal(calls.length, 1);
  assert.equal(r.trips.length, 1);
  assert.equal(r.trips[0].tour.routeId, FIX['best-balance'].tour.routeId);
  assert.ok(r.trips.every(t => S.isFullyLive(t.tour)));
});

test('a guest still sees a live trip when the main pick fails its live check (no flaky error page)', async () => {
  const responses = okResponses();
  responses['best-balance'] = clone(FIX['best-balance']);
  responses['best-balance'].tour.cities[0].hotel.livePriceVerified = false; // main pick not live
  responses['best-balance'].tours = [responses['best-balance'].tour, FIX['most-memorable'].tour];
  const { S } = load({ responses });
  const r = await S.findTrips(SEARCH, { member: false });
  assert.equal(r.trips.length, 1);
  assert.equal(r.trips[0].tour.routeId, FIX['most-memorable'].tour.routeId);
});

test('signed-in travellers get three different trips and "Lowest cost" is the cheapest one', async () => {
  const { S, calls } = load({ responses: okResponses(), member: true });
  const r = await S.findTrips(SEARCH, { member: true });
  assert.equal(calls.length, 3);
  assert.equal(r.trips.length, 3);
  assert.equal(new Set(r.trips.map(t => t.tour.routeId)).size, 3);
  assert.ok(!r.trips.some(t => t.tour.routeId === 'estimate-only'));
  const lowest = r.trips.find(t => t.role === 'lowest-cost');
  const cheapest = Math.min(...r.trips.map(t => S.tripTotal(t.tour)));
  assert.equal(S.tripTotal(lowest.tour), cheapest);
  assert.deepEqual(clone(r.trips.map(t => t.meta.label)), ['Best use of your budget', 'Lowest cost', 'Something different']);
});

test('no-trip answers keep the suggested budget; total failure is reported as an error', async () => {
  const nt = load({ responses: { 'best-balance': FIX.noTrip } });
  const r = await nt.S.findTrips(SEARCH, { member: false });
  assert.equal(r.trips.length, 0);
  assert.equal(r.noTrip.suggestedBudget, 2900);
  const down = load({ responses: { 'best-balance': new Error('timeout') } });
  const f = await down.S.findTrips(SEARCH, { member: false });
  assert.equal(f.trips.length, 0);
  assert.equal(f.failed, true);
});

test('dates stay open unless the traveller picks a month; old pinned links are unpinned', () => {
  const { S } = load({ responses: {} });
  const open = S.apiParams(SEARCH, 'best-balance', 1);
  assert.equal(open.preferredMonth, undefined);
  assert.equal(open.month, undefined);
  assert.equal(open.flexibility, undefined);
  assert.equal(open.minimumLeadDays, undefined, 'the backend decides how far ahead trips start');
  const picked = S.apiParams({ ...SEARCH, month: '2027-02' }, 'best-balance', 1);
  assert.equal(picked.preferredMonth, '2027-02');
  assert.equal(picked.flexibility, 'month');
  const old = S.readSearch(new URLSearchParams('origin=Toronto+(YYZ)&budget=2500&currency=CAD&passengers=2&preferredMonth=2026-12&month=2026-12&flexibility=month'));
  assert.equal(old.month, '', 'the old form forced the current month; that lock is dropped');
  assert.equal(old.adults, 2);
  const url = S.resultsUrl({ origin: 'Montreal (YUL)', budget: '2500', currency: 'USD', adults: 2, month: '2027-03', pace: 'see-more' });
  const back = S.readSearch(new URLSearchParams(url.split('?')[1]));
  assert.deepEqual({ ...back }, { origin: 'Montreal (YUL)', budget: 2500, currency: 'USD', adults: 2, month: '2027-03', pace: 'see-more' });
});

test('replaced pages redirect to the new homepage or results page', () => {
  for (const page of ['multicity-visualizer', 'mixed-results', 'multi-city', 'explore', 'ask']) {
    const html = fs.readFileSync(`frontend/pages/${page}.html`, 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const [search, expected] of [['?budget=3000&origin=Toronto', 'results.html?budget=3000&origin=Toronto'], ['', 'index.html']]) {
      let to;
      vm.runInNewContext(script, { URLSearchParams, location: { search, hash: '', replace: v => { to = v; } } });
      assert.equal(to, expected, page);
    }
  }
});

test('new pages load only files that exist', () => {
  for (const page of ['index', 'results']) {
    const html = fs.readFileSync(`frontend/pages/${page}.html`, 'utf8');
    for (const m of html.matchAll(/(?:src|href)="\.\/([^"?#]+)/g)) {
      const file = m[1].endsWith('.html') ? 'frontend/pages/' + m[1] : 'frontend/' + m[1];
      assert.ok(fs.existsSync(file), `${page}.html -> ${m[1]}`);
    }
    assert.ok(!/illustrative|prototype|demo preference/i.test(html), page + ' still has prototype wording');
  }
});
