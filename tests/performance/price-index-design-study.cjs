#!/usr/bin/env node
'use strict';
// GV-PRICE-INDEX-001 design study: store per-hotel price calendars, or city summaries?
//   node tests/performance/price-index-design-study.cjs [--json]
// Offline, no paid calls. Uses the Barcelona-shaped test inputs (synthetic prices,
// real sizes) unless PRICE_INDEX_FIXTURE points at a real sandbox file.
//
// Accuracy question: how well does each option predict what a live check would
// actually find (cheapest good room, per night) for a random 2-6 night stay?
// Every option keeps today's learned per-city ratio (hotel price memory, learned
// from 5 live checks), so this measures what the index ADDS.

const F = require('../backend/fixtures/price-index-fixture.cjs');
const S = require('../../backend/services/domain/pricing/hotel-price-index/summary.js');

const fx = F.build();
const days = fx.days, idx = new Map(days.map((d, i) => [d, i]));
const sumHotels = S.fromHotels('barcelona-es', { data: fx.hotels.data.map(h => ({ hotelId: h.hotelId, prices: h.prices.map(p => ({ day: p.day, usd: p.avgPriceUsd })) })) });
const sumCity = S.fromCity('barcelona-es', { prices: fx.city.prices.map(p => ({ day: p.day, usd: p.avgPriceUsd })) });
const calendars = new Map(fx.hotels.data.map(h => [h.hotelId, new Map(h.prices.map(p => [p.day, p.avgPriceUsd]))]));

// ---- storage -------------------------------------------------------------------
const kb = o => +(Buffer.byteLength(JSON.stringify(o)) / 1024).toFixed(1);
const rawItem = { pk: 'PI#hotels#barcelona-es', from: days[0], hotels: fx.hotels.data.map(h => ({ id: h.hotelId, p: days.map(d => calendars.get(h.hotelId).get(d) ?? null) })) };
const storage = {
  rawCalendarsKbPerCity: kb(rawItem), summaryKbPerCity: kb(sumHotels), cityEndpointKbPerCity: kb(sumCity),
  // one search reads ~3 cities; DynamoDB bills reads in 4 KB units
  readUnitsPerSearch: { raw: Math.ceil(kb(rawItem) / 4) * 3, summary: Math.ceil(kb(sumHotels) / 4) * 3 },
  hundredCitiesMb: { raw: +(kb(rawItem) * 100 / 1024).toFixed(1), summary: +(kb(sumHotels) * 100 / 1024).toFixed(2) },
  fitsOneItem400Kb: { raw: kb(rawItem) * 365 / 182 < 400, summary: true }
};

// ---- accuracy ------------------------------------------------------------------
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function stays(R, n) { const out = []; while (out.length < n) { const nights = 2 + Math.floor(R() * 5), i = Math.floor(R() * (days.length - nights)); out.push({ i, nights, day: days[i] }); } return out; }
const truth = s => mean(fx.bookable.slice(s.i, s.i + s.nights));
const rawMin = s => mean(days.slice(s.i, s.i + s.nights).map(d => Math.min(...[...calendars.values()].map(c => c.get(d)).filter(v => v != null))));
const p25 = s => { const v = sumHotels.p25.slice(s.i, s.i + s.nights).filter(x => x != null); return v.length ? mean(v) : sumHotels.median; };
const REGIONAL_NIGHTLY = 84, MARGIN = 1.3;      // today's planning model for southern Europe

const OPTIONS = {
  'Today: flat regional price x 1.3': () => s => REGIONAL_NIGHTLY * MARGIN,
  'Today + learned city ratio (no index)': L => { const b = mean(L.map(truth)); return () => b; },
  'City endpoint: season shape x learned level': L => { const b = mean(L.map(s => truth(s) / S.seasonality(sumCity, s.day, s.nights))); return s => b * S.seasonality(sumCity, s.day, s.nights); },
  'City summary from 50 hotels: shape x learned level': L => { const b = mean(L.map(s => truth(s) / S.seasonality(sumHotels, s.day, s.nights))); return s => b * S.seasonality(sumHotels, s.day, s.nights); },
  'City summary p25 x learned ratio': L => { const r = mean(L.map(s => truth(s) / p25(s))); return s => r * p25(s); },
  'Raw hotel calendars: cheapest of 50 x learned ratio': L => { const r = mean(L.map(s => truth(s) / rawMin(s))); return s => r * rawMin(s); }
};

const results = {};
for (const [name, make] of Object.entries(OPTIONS)) {
  const errs = [], under = [];
  for (let seed = 1; seed <= 20; seed++) {
    const R = rng(seed * 7919), learn = stays(R, 5), test = stays(R, 300), est = make(learn);
    for (const s of test) { const t = truth(s), e = est(s); errs.push(Math.abs(e - t) / t); under.push(e < t * 0.95); }
  }
  errs.sort((a, b) => a - b);
  results[name] = { medianErrorPct: +(errs[Math.floor(errs.length / 2)] * 100).toFixed(1), within15Pct: +(errs.filter(e => e <= .15).length / errs.length * 100).toFixed(1), underBy5PctOrMore: +(under.filter(Boolean).length / under.length * 100).toFixed(1) };
}

const out = { synthetic: fx.synthetic, dataset: { hotels: fx.hotels.data.length, prices: fx.hotels.data.reduce((s, h) => s + h.prices.length, 0), days: days.length, coverage: sumHotels.coverage }, storage, accuracy: results };
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`Price Index design study (${out.synthetic ? 'synthetic prices, sandbox-sized' : 'real sandbox file'}): ${out.dataset.hotels} hotels, ${out.dataset.prices} prices, ${out.dataset.days} days`);
  console.log(`Storage per city: raw calendars ${storage.rawCalendarsKbPerCity} KB, summary ${storage.summaryKbPerCity} KB, city endpoint ${storage.cityEndpointKbPerCity} KB`);
  console.log(`Read units per search (3 cities): raw ${storage.readUnitsPerSearch.raw}, summary ${storage.readUnitsPerSearch.summary}; 100 cities: raw ${storage.hundredCitiesMb.raw} MB, summary ${storage.hundredCitiesMb.summary} MB`);
  console.log('Accuracy vs live price (20 x 300 stays, 5 learning checks):');
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(52)} median error ${String(v.medianErrorPct).padStart(5)}%  within 15% ${String(v.within15Pct).padStart(5)}%  too low by 5%+ ${String(v.underBy5PctOrMore).padStart(5)}%`);
}
module.exports = out;
