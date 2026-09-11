import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(path.join(web, 'package.json'));
// Run the actual TypeScript modules and render their actual JSX, without a
// provider call, browser account, copied implementation, or new test dependency.
export function loadSource(relative, mocks = {}, cache = new Map()) {
  const filename = path.resolve(web, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  } });
  const module = { exports: {} };
  cache.set(filename, module);
  const require = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.join(web, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const target = [base, `${base}.ts`, `${base}.tsx`].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
      if (!target) throw new Error(`Unresolved test import: ${name}`);
      return loadSource(path.relative(web, target), mocks, cache);
    }
    return nativeRequire(name);
  };
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports;
}

const { formatReviewMoney, reviewPricing, flightComparisonLabel } = loadSource('lib/trip-review-pricing-712c.ts');
const now = Date.parse('2026-09-11T04:00:00Z');
const session = { accessToken: 'test-only', user: { sub: 'owner-a' } };
const trip = {
  tripId: 'trip712test', name: 'Cancún + Philadelphia', priceSnapshot: { tripEstimate: 2000, currency: 'CAD' },
  tripSnapshot: { kind: 'multi', origin: 'YYZ', travellers: 1, cities: [{ city: 'Cancún', nights: 4 }, { city: 'Philadelphia', nights: 3 }] }
};

export function fixture() {
  return {
    ok: true, snapshot: { currency: 'CAD', savedTripTotal: 2000 },
    revalidation: { state: 'changed', applied: true, allFlightLegsLive: true, liveFlightLegCount: 3, requiredFlightLegCount: 3, handoffEnabled: true },
    currentPricing: {
      version: 'GV-LIVE-712', status: 'partial', currency: 'CAD', currentTotal: null, planningTotal: 2000,
      flightsTotal: 1051, hotelsTotal: null, currentKnownSubtotal: 1051, requiredFlights: 3, liveFlights: 3,
      requiredHotels: 2, liveHotels: 0, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(), withinBudget: null
    },
    hotelRevalidation: { allVerified: true, hotelAdjustedTripEstimate: null, totalCount: 2, verifiedCount: 2, liveCount: 0, attempted: true },
    flights: [{ index: 0, origin: 'YYZ', destination: 'CUN', departureDate: '2026-11-10', freshAmount: 236, currency: 'CAD', sourceType: 'LIVE', handoffEnabled: true, handoffUrl: 'https://www.aviasales.com/search' }],
    hotels: ['Cancún', 'Philadelphia'].map((city, index) => ({ index, city, nights: index ? 3 : 4, currency: 'CAD', savedEstimate: 400, freshAmount: 300,
      state: 'verified', availabilityVerified: true, sandbox: true, environment: 'sandbox', productionEligible: false, handoffUrl: 'https://www.agoda.com/test-only' }))
  };
}

function hookHarness(values = []) {
  let index = 0;
  const effects = [], writes = [];
  return { effects, writes, react: { ...React,
    useState(initial) { const slot = index++; return [slot in values ? values[slot] : typeof initial === 'function' ? initial() : initial, (value) => writes.push({ slot, value })]; },
    useMemo(fn) { return fn(); }, useEffect(fn) { effects.push(fn); }
  } };
}

export function renderReview(result, time = now) {
  const hooks = hookHarness(['trip712test', trip, false, false, result, '', true, time]);
  const { TripReviewClient710G } = loadSource('components/booking/trip-review-client-710g.tsx', {
    react: hooks.react, '@/components/account/auth-provider': { useAuth: () => ({ session, loading: false }) },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
  });
  return renderToStaticMarkup(React.createElement(TripReviewClient710G));
}

test('missing or malformed amounts never become zero; genuine zero and negative deltas remain valid', () => {
  for (const value of [null, undefined, '', ' ', false, true, NaN, Infinity, '123']) assert.equal(formatReviewMoney(value), '—');
  assert.equal(formatReviewMoney(0), '$0');
  assert.equal(formatReviewMoney(-12), '-$12');
});

test('sandbox hotels preserve Partially live, current flight subtotal, and unknown budget', () => {
  const input = fixture(), original = structuredClone(input);
  const result = reviewPricing(input, now);
  assert.equal(result.label, 'Partially live');
  assert.equal(result.currentTotal, null);
  assert.equal(result.flightsTotal, 1051);
  assert.equal(result.withinBudget, null);
  assert.deepEqual(input, original);
});

test('rendered 712B case never shows a zero full total or a sandbox hotel booking link', () => {
  const html = renderReview(fixture());
  assert.match(html, /Full current total unavailable/);
  assert.match(html, /Partially live/);
  assert.match(html, /\$1,051/);
  assert.match(html, /Sandbox test rate/);
  assert.match(html, /Compare on Aviasales/);
  assert.match(html, /its flights and prices may differ/);
  assert.doesNotMatch(html, />\$0<|Fresh trip evidence|Within saved budget|href="https:\/\/www.agoda.com\/test-only"/);
});

test('legacy verified hotel response cannot manufacture a complete live total', () => {
  const input = fixture(); delete input.currentPricing;
  input.hotelRevalidation.hotelAdjustedTripEstimate = 1700;
  assert.equal(reviewPricing(input, now).currentTotal, null);
  assert.match(renderReview(input), /Full current total unavailable/);
});

test('a complete production ledger displays its exact total and budget outcome', () => {
  const input = fixture();
  input.hotels.forEach((hotel) => Object.assign(hotel, { sandbox: false, environment: 'production', productionEligible: true }));
  Object.assign(input.currentPricing, { status: 'live', liveHotels: 2, hotelsTotal: 600, currentTotal: 1651, withinBudget: false });
  assert.equal(reviewPricing(input, now).currentTotal, 1651);
  const html = renderReview(input);
  assert.match(html, /\$1,651/); assert.match(html, /Over saved budget/);
  assert.doesNotMatch(html, /Sandbox test rate|Full current total unavailable/);
});

test('malformed and contradictory live ledgers remain incomplete', () => {
  for (const currentTotal of [null, 0, NaN, Infinity, -1]) {
    const input = fixture(); Object.assign(input.currentPricing, { status: 'live', liveHotels: 2, currentTotal });
    assert.equal(reviewPricing(input, now).complete, false);
  }
  const input = fixture(); Object.assign(input.currentPricing, { status: 'live', liveHotels: 2, currentTotal: 1651 });
  assert.equal(reviewPricing(input, now).complete, false, 'sandbox rows cannot accompany a Live badge');
});

test('expired evidence removes current totals and asks for another check', () => {
  const input = fixture();
  const result = reviewPricing(input, now + 300000);
  assert.equal(result.label, 'Needs verification'); assert.equal(result.flightsTotal, null);
  const html = renderReview(input, now + 300000);
  assert.match(html, /evidence has expired/); assert.doesNotMatch(html, /href="https:\/\/www.aviasales.com/);
});

test('initial review asks for a check without claiming unavailable or zero prices', () => {
  const html = renderReview(null);
  assert.match(html, /Check required/); assert.doesNotMatch(html, /Full current total unavailable|>\$0</);
});

test('comparison labels distinguish Aviasales hosts from unrelated hosts', () => {
  assert.equal(flightComparisonLabel('https://www.aviasales.com/search'), 'Compare on Aviasales');
  assert.equal(flightComparisonLabel('https://aviasales.com.example.org'), 'Compare with flight partner');
  assert.equal(flightComparisonLabel(null), 'Compare with flight partner');
});

function tripsHarness(authSession, listSavedTrips, values = [[trip], false, '', '', '', 'all']) {
  const hooks = hookHarness(values);
  const { MyTripsClient } = loadSource('components/account/my-trips-client.tsx', {
    react: hooks.react,
    '@/components/account/auth-provider': { useAuth: () => ({ session: authSession, loading: false, clear() {} }) },
    '@/lib/api': { listSavedTrips, GlobevoyApiError: class extends Error {} },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
  });
  return { ...hooks, html: renderToStaticMarkup(React.createElement(MyTripsClient)) };
}

test('signed-out My Trips hides existing private rows, clears them, and never loads', () => {
  let calls = 0;
  const view = tripsHarness(null, () => { calls++; });
  assert.match(view.html, /Sign in to see saved journeys/);
  assert.doesNotMatch(view.html, /Cancún|Philadelphia|2,000/);
  view.effects[1]();
  assert.deepEqual(view.writes.find((write) => write.slot === 0)?.value, []);
  assert.equal(calls, 0);
});

test('an in-flight My Trips response cannot restore private rows after sign-out cleanup', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const view = tripsHarness(session, () => pending, [[], false, '', '', '', 'all']);
  const cleanup = view.effects[1](); cleanup(); resolve([trip]);
  await pending; await Promise.resolve();
  assert.equal(view.writes.filter((write) => write.slot === 0).length, 0);
});

test('rendered saved trip cards retain estimate status and current-price action', () => {
  const view = tripsHarness(session, () => Promise.resolve([trip]));
  assert.match(view.html, /Saved snapshot · price check needed/);
  assert.match(view.html, /gv-evidence--estimate/);
  assert.match(view.html, /Check current prices/);
  assert.match(view.html, /checks current provider evidence before partner handoff/);
});
