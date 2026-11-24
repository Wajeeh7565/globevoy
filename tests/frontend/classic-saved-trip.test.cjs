const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setTimeout: delay } = require('node:timers/promises');
const saved = require('../../backend/services/accounts/saved-trips/staging-saved-trips-705c');
const read = name => fs.readFileSync('frontend/scripts/' + name, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

const { generatedTours } = require('./generated-tour-fixtures.cjs');
const fixtures = generatedTours();

class Element {
  constructor(id = '') { this.id = id; this.dataset = {}; this.attrs = {}; this.handlers = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.classes = new Set(); this.classList = { toggle: (k, v) => v ? this.classes.add(k) : this.classes.delete(k), add: k => this.classes.add(k) }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { this.handlers[k] = fn; }
  closest() { return this.card || this; }
  set innerHTML(html) {
    this.html = html;
    this.cards = [...html.matchAll(/<article class="gv-saved-trip-card" data-trip-id="([^"]+)"/g)].map(m => {
      const card = new Element(); card.dataset.tripId = m[1];
      card.open = new Element(); card.open.card = card;
      card.delete = new Element(); card.delete.card = card;
      card.remove = () => { this.cards = this.cards.filter(c => c !== card); };
      return card;
    });
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) { return (this.cards || []).map(c => selector.includes('open') ? c.open : c.delete); }
  querySelector() { return this.cards?.[0] || null; }
}
function storage() {
  const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
function browser(tour, { signedIn = true, routeDetails = false } = {}) {
  const button = new Element(routeDetails ? 'gv-mtd-save' : 'mcv-save-trip');
  const status = new Element('gv-saved-trips-status');
  const profileStatus = new Element('gv-mtd-account-save-status');
  const elements = new Map([[button.id, button], [status.id, status], [profileStatus.id, profileStatus]]);
  const listeners = {};
  const location = new URL('https://globevoy.com/' + (routeDetails ? 'multi-city-trip.html' : 'multicity-visualizer.html') + '?origin=YYZ&budget=2500&currency=CAD&saved=true&snapshot=regression&departureDate=2027-03-08');
  location.assign = value => { location.href = new URL(value, location).href; };
  const window = { location, sessionStorage: storage(), localStorage: storage(), GLOBEVOY_AUTH_CONFIG: { enabled: true, apiBaseUrl: 'https://account.test' }, GlobevoyAuth705B: { getSession: () => signedIn ? { accessToken: 'offline-test-token' } : null } };
  const document = { readyState: 'loading', body: { classList: { contains: name => name === 'gv-mcv-page' } }, getElementById: id => elements.get(id) || null, addEventListener: (name, fn) => (listeners[name] ||= []).push(fn) };
  const rows = new Map(), posts = [], requests = []; let failMethod = '', holdPost, malformedPost = false;
  const db = { send: async cmd => {
    const i = cmd.input;
    if (cmd.name === 'PutItem') { rows.set(i.Item.SK.S, i.Item); return {}; }
    if (cmd.name === 'DeleteItem') { const item = rows.get(i.Key.SK.S); rows.delete(i.Key.SK.S); return { Attributes: item }; }
    throw new Error('Unexpected DB command');
  } };
  const dbOptions = { env: { GLOBEVOY_SAVED_TRIPS_TABLE: 'offline-test-table' }, ddb: db, commandFactory: (name,input) => ({ name,input }) };
  const fetch = async (url, opts) => {
    const method = opts.method, u = new URL(url); requests.push(method);
    if (failMethod === method) throw new TypeError('Offline simulated network failure');
    let data;
    if (method === 'POST') {
      posts.push(opts.body);
      if (holdPost) await holdPost;
      if (malformedPost) return { ok: true, status: 201, json: async () => ({ ok: true }) };
      const body = saved._internal.parseBody({ body: opts.body });
      const trip = await saved._internal.createTrip('synthetic-owner', body, dbOptions);
      data = { trip };
    } else if (method === 'GET') data = { trips: [...rows.values()].map(saved._internal.toPublicItem) };
    else if (method === 'DELETE') { await saved._internal.deleteTrip('synthetic-owner', u.searchParams.get('tripId'), dbOptions); data = { ok: true }; }
    else throw new Error('Unexpected HTTP method');
    return { ok: true, status: method === 'POST' ? 201 : 200, json: async () => data };
  };
  const context = vm.createContext({ window, document, location, sessionStorage: window.sessionStorage, localStorage: window.localStorage, fetch, URL, URLSearchParams, TextEncoder, Date, console, setTimeout, navigator: {}, history: { replaceState: (_,__,url) => { location.href = url; } } });
  vm.runInContext(read('saved-trips-705c.js'), context);
  vm.runInContext(read('saved-trips-705c-r3-route-details.js'), context);
  // Run the actual legacy persistence and feedback functions, not a replacement save.
  const visualizer = fs.readFileSync('tests/frontend/fixtures/visualizer-687b-save-harness.js', 'utf8');
  Object.assign(context, { tourFixture: tour, activePickIndex: 0, q: new URLSearchParams(location.search), $: selector => elements.get(selector.slice(1)), storageKey: 'globevoy.multi.selected.v1', FRONTEND_VERSION: 'regression', HANDOFF_WINDOW_PREFIX: 'regression:', cloneTour: plain, snapshotIdFromTour: () => 'regression', snapshotStorageKey: id => 'globevoy.generated.snapshot.v1.' + id, officialLegDate: leg => leg?.departureDate || '', safeIso: value => value || '', currentStopIds: t => t.cities.map(c => c.id).join(','), currentStopRefs: t => t.cities.map(c => c.code).join(','), pickRole: () => 'best-balance', showToast: () => {} });
  for (const name of ['persistTourSnapshot', 'saveTourSnapshot']) vm.runInContext(visualizer.match(new RegExp('function '+name+'\\(t\\)\\{[^\\n]+'))[0], context);
  window.sessionStorage.setItem('globevoy.multi.selected.v1', JSON.stringify(tour));
  for (const fn of listeners.DOMContentLoaded || []) fn();
  async function click() {
    const event = { target: button, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } };
    // Only matching listeners receive this target, as Element.closest would in a browser.
    button.closest = selector => selector.split(',').some(s => s.trim() === '#'+button.id) ? button : null;
    for (const fn of listeners.click || []) { fn(event); if (event.stopped) break; }
    if (!routeDetails) vm.runInContext('saveTourSnapshot(tourFixture)', context);
    await delay(25);
  }
  return { window, context, elements, button, status: routeDetails ? profileStatus : status, rows, posts, requests, click,
    runtime: window.GlobevoySavedTrips705C, details: window.GlobevoySavedTripsRouteDetails705CR3,
    fail: method => { failMethod = method; }, hold: p => { holdPost = p; }, malformed: () => { malformedPost = true; },
    myTrips: async () => { const root = new Element('gv-my-trips-list'); elements.set(root.id,root); await window.GlobevoySavedTrips705C.renderMyTrips(); return root; } };
}
async function settled(b) {
  for (let i=0; i<100 && (b.button.disabled || !b.posts.length); i++) await delay(10);
}

test('representative generated tours use one bounded serializer and retain route/date/price essentials', async () => {
  for (const tour of await fixtures) {
    const b = browser(tour), raw = b.runtime.currentPageSnapshot();
    assert.throws(() => saved._internal.parseBody({body: JSON.stringify(raw.body)}), /request-body-too-large/);
    assert.throws(() => saved._internal.normalizeInput(plain(raw.body)), /sensitive-data-not-allowed/);
    const compact = b.runtime._internal.compactAccountSnapshot(raw);
    assert.deepEqual(plain(b.details._internal.compactAccountSnapshot(raw)), plain(compact));
    assert.ok(Buffer.byteLength(JSON.stringify(compact.body)) < 64*1024);
    assert.ok(Buffer.byteLength(JSON.stringify(compact.body.tripSnapshot)) < 48*1024);
    saved._internal.parseBody({body:JSON.stringify(compact.body)});
    saved._internal.normalizeInput(plain(compact.body));
    assert.deepEqual(plain(compact.body.tripSnapshot.cities), plain(raw.body.tripSnapshot.cities));
    assert.equal(compact.body.tripSnapshot.tour.itineraryDatePlan.canonicalDepartureDate, tour.itineraryDatePlan.canonicalDepartureDate);
    assert.equal(compact.body.tripSnapshot.tour.itineraryDatePlan.canonicalReturnDate, tour.itineraryDatePlan.canonicalReturnDate);
    assert.deepEqual(plain(compact.body.tripSnapshot.tour.backendLegs.map(l=>l.departureDate)), tour.backendLegs.map(l=>l.departureDate || ''));
    assert.equal(compact.body.tripSnapshot.tour.recommendationLabel, tour.recommendationLabel);
    assert.deepEqual(plain(compact.body.priceSnapshot), plain(raw.body.priceSnapshot));
    assert.equal(JSON.stringify(tour), b.window.sessionStorage.getItem('globevoy.multi.selected.v1'));
    console.log('Generated-tour sizes (bytes):', Buffer.byteLength(JSON.stringify(raw.body)), '->', Buffer.byteLength(JSON.stringify(compact.body)));
  }
});

for (const routeDetails of [false,true]) test((routeDetails?'Route-details':'Classic visualizer')+' Save -> My Trips -> safe reopen -> Delete', async () => {
  const tour = (await fixtures)[0], b = browser(tour,{routeDetails});
  await b.click(); await settled(b);
  assert.equal(b.posts.length,1); assert.equal(b.rows.size,1);
  assert.match(b.button.textContent,/Saved to account/);
  const root = await b.myTrips(); assert.match(root.innerHTML,/Saved prices are snapshots/);
  assert.equal(root.cards.length,1);
  const stored = [...b.rows.values()][0], trip = saved._internal.toPublicItem(stored);
  assert.equal(trip.priceSnapshot.requiresRevalidation,true); assert.equal(trip.priceSnapshot.snapshotOnly,true);
  const before = b.window.localStorage.getItem('globevoy.generated.snapshot.v1.regression');
  if (!routeDetails) assert.deepEqual(JSON.parse(before).tour,tour);
  const path = b.runtime.seedTripForOpen(trip); assert.match(path,/^(multicity-visualizer|multi-city-trip)\.html\?/);
  assert.deepEqual(JSON.parse(b.window.sessionStorage.getItem('globevoy.multi.selected.v1')),trip.tripSnapshot.tour);
  assert.equal(b.runtime.seedTripForOpen({...trip,tripSnapshot:{...trip.tripSnapshot,sourceUrl:'https://evil.test/trip.html'}}),'');
  b.fail('DELETE'); await root.cards[0].delete.handlers.click(); assert.equal(b.rows.size,1); assert.equal(root.cards.length,1);
  b.fail(''); await root.cards[0].delete.handlers.click(); assert.equal(b.rows.size,0); assert.equal(root.cards.length,0);
  assert.match(root.innerHTML,/No saved trips yet/);
});

for (const routeDetails of [false,true]) test((routeDetails?'Route-details':'Classic visualizer')+' never reports account success before a valid API response',async()=>{
  const b=browser((await fixtures)[0],{routeDetails});let resolve;b.hold(new Promise(r=>{resolve=r;}));
  await b.click();assert.equal(b.rows.size,0);assert.match(b.button.textContent,/Saving/);assert.doesNotMatch(b.button.textContent,/Saved to account/);assert.equal(b.button.attrs['aria-pressed'],'false');
  resolve();await settled(b);assert.match(b.button.textContent,/Saved to account/);
  const failed=browser((await fixtures)[0],{routeDetails});failed.fail('POST');await failed.click();await settled(failed);assert.equal(failed.rows.size,0);assert.doesNotMatch(failed.button.textContent,/Saved to account/);assert.match(failed.status.textContent,/could not update/);
  const malformed=browser((await fixtures)[0],{routeDetails});malformed.malformed();await malformed.click();await settled(malformed);assert.equal(malformed.rows.size,0);assert.doesNotMatch(malformed.button.textContent,/Saved to account/);
});

test('oversized compact requests and sensitive payloads remain rejected without weakening server validation',async()=>{
  const b=browser((await fixtures)[0]);const raw=plain(b.runtime.currentPageSnapshot());
  raw.body.tripSnapshot.sourceUrl='x'.repeat(45*1024);
  assert.throws(()=>b.runtime._internal.compactAccountSnapshot(raw),/compact-snapshot-too-large/);
  raw.body.tripSnapshot.sourceUrl='\u65c5'.repeat(15*1024);
  assert.throws(()=>b.runtime._internal.compactAccountSnapshot(raw),/compact-snapshot-too-large/);
  const other=plain(b.runtime.currentPageSnapshot());other.body.providerRefs={diagnostics:'x'.repeat(61*1024)};
  assert.throws(()=>b.runtime._internal.compactAccountSnapshot(other),/compact-request-too-large/);
  const compact=plain(b.runtime._internal.compactAccountSnapshot(b.runtime.currentPageSnapshot()));
  compact.body.tripSnapshot.password='not-a-real-credential';assert.throws(()=>saved._internal.normalizeInput(compact.body),/sensitive-data-not-allowed/);
  compact.body.tripSnapshot={text:'x'.repeat(49*1024)};assert.throws(()=>saved._internal.normalizeInput(compact.body),/trip-snapshot-too-large/);
});

test('signed-out Save keeps the full guest tour and performs no private API requests',async()=>{
  const tour=(await fixtures)[0],b=browser(tour,{signedIn:false});await b.click();
  assert.deepEqual(JSON.parse(b.window.localStorage.getItem('globevoy.generated.snapshot.v1.regression')).tour,tour);
  assert.equal(b.requests.length,0);assert.equal(b.rows.size,0);assert.doesNotMatch(b.button.textContent,/account/);
  const root=await b.myTrips();assert.equal(root.hidden,true);
});

for (const routeDetails of [false,true]) test((routeDetails?'Route-details':'Classic visualizer')+' ignores stale refreshes after a completed save', async()=>{
  const b=browser((await fixtures)[0],{routeDetails});
  const original=b.context.fetch; let resolve;
  b.context.fetch=async()=>{await new Promise(r=>{resolve=r});return {ok:true,status:200,json:async()=>({trips:[]})}};
  const refresh=routeDetails?b.details.refresh():b.runtime.refreshPageSaveState();
  b.context.fetch=original;
  await b.click();await settled(b);assert.match(b.button.textContent,/Saved to account/);
  resolve();await refresh;assert.match(b.button.textContent,/Saved to account/);assert.equal(b.button.attrs['aria-pressed'],'true');
});
