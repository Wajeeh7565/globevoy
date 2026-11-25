#!/usr/bin/env node
'use strict';
// GV-PRICE-INDEX-001 design study: store per-hotel price calendars, or city summaries?
//   node tests/performance/price-index-design-study.cjs [--json] [--fixture <prices/hotels JSON>]
// Offline, no paid calls. Without --fixture (or PRICE_INDEX_FIXTURE) it uses the
// Barcelona-shaped SYNTHETIC inputs; with a real file it loads that file.
//
// Three separate questions, reported separately:
//  A. Storage and reads (real or synthetic: only sizes matter).
//  B. Complete stays at one hotel: what a per-night city number misses (real or
//     synthetic: compares the calendars with themselves).
//  C. Planning accuracy vs "what a live check would find". ONLY with synthetic inputs,
//     where that answer is known by construction. This is NOT live hotel pricing
//     accuracy, which is not measured yet (Task 5 probe, then Task 6 live checks).

const path = require('path');
const F = require('../backend/fixtures/price-index-fixture.cjs');
const S = require('../../backend/services/domain/pricing/hotel-price-index/summary.js');
const A = require('../../backend/services/domain/pricing/hotel-price-index/analysis.js');
const { bandOf } = require('../../backend/services/domain/pricing/hotel-price-index/hotel-sample.js');

const argFixture = (() => { const i = process.argv.indexOf('--fixture'); return i > 0 ? path.resolve(process.argv[i + 1]) : process.env.PRICE_INDEX_FIXTURE; })();
const fx = F.load(argFixture);
const answer = { data: fx.hotels.data.map(h => ({ hotelId: h.hotelId, prices: h.prices.map(p => ({ day: String(p.day).slice(0, 10), usd: Number(p.avgPriceUsd ?? p.usd) })) })) };
const days = [...new Set(answer.data.flatMap(h => h.prices.map(p => p.day)))].sort();
const sumHotels = S.fromHotels('city', answer);
const sumV1 = S.fromHotels('city', answer, { stayNights: [] });

// ---- A. storage -----------------------------------------------------------------
const kb = o => +(Buffer.byteLength(JSON.stringify(o)) / 1024).toFixed(1);
const rawItem = { pk: 'PI#hotels#city', from: days[0], hotels: answer.data.map(h => { const m = new Map(h.prices.map(p => [p.day, p.usd])); return { id: h.hotelId, p: days.map(d => m.get(d) ?? null) }; }) };
const storage = {
  days: days.length,
  rawCalendarsKb: kb(rawItem), summaryKb: kb(sumHotels), summaryWithoutStaysKb: kb(sumV1),
  readUnitsPerSearch3Cities: { raw: Math.ceil(kb(rawItem) / 4) * 3, summary: Math.ceil(kb(sumHotels) / 4) * 3 },
  hundredCitiesMb: { raw: +(kb(rawItem) * 100 / 1024).toFixed(1), summary: +(kb(sumHotels) * 100 / 1024).toFixed(2) }
};

// ---- B. complete stays at one hotel ---------------------------------------------
const stays = A.stayEffect(answer);
const bands = fx.stars ? A.bandMedians(answer, Object.fromEntries(Object.entries(fx.stars).map(([id, st]) => [id, bandOf({ stars: st })]))) : null;

// ---- C. synthetic planning accuracy (synthetic inputs only) ----------------------
let synthetic = null;
if (fx.synthetic) {
  const sumCity = S.fromCity('city', { prices: fx.city.prices.map(p => ({ day: p.day, usd: p.avgPriceUsd })) });
  const cal = new Map(answer.data.map(h => [h.hotelId, new Map(h.prices.map(p => [p.day, p.usd]))]));
  function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const pick = (R, n) => { const out = []; while (out.length < n) { const nights = 2 + Math.floor(R() * 6), i = Math.floor(R() * (days.length - nights)); out.push({ i, nights, day: days[i] }); } return out; };
  const truth = s => mean(fx.bookable.slice(s.i, s.i + s.nights));
  const rawMin = s => mean(days.slice(s.i, s.i + s.nights).map(d => Math.min(...[...cal.values()].map(c => c.get(d)).filter(v => v != null))));
  const shape = sum => L => { const b = mean(L.map(s => truth(s) / S.seasonality(sum, s.day, s.nights))); return s => b * S.seasonality(sum, s.day, s.nights); };
  const OPTIONS = {
    'Today: flat regional price x 1.3': () => () => 84 * 1.3,
    'Today + learned city ratio (no index)': L => { const b = mean(L.map(truth)); return () => b; },
    'City endpoint: date shape x learned level': shape(sumCity),
    'City summary, per-night (v1): date shape x level': shape(sumV1),
    'City summary with complete stays (v2)': shape(sumHotels),
    'Raw hotel calendars: cheapest of 50 x ratio': L => { const r = mean(L.map(s => truth(s) / rawMin(s))); return s => r * rawMin(s); }
  };
  synthetic = {};
  for (const [name, make] of Object.entries(OPTIONS)) {
    const errs = [], under = [];
    for (let seed = 1; seed <= 20; seed++) {
      const R = rng(seed * 7919), learn = pick(R, 5), test = pick(R, 300), est = make(learn);
      for (const s of test) { const t = truth(s), e = est(s); errs.push(Math.abs(e - t) / t); under.push(e < t * 0.95); }
    }
    errs.sort((a, b) => a - b);
    synthetic[name] = { medianErrorPct: +(errs[Math.floor(errs.length / 2)] * 100).toFixed(1), within15Pct: +(errs.filter(e => e <= .15).length / errs.length * 100).toFixed(1), tooLowBy5PctOrMore: +(under.filter(Boolean).length / under.length * 100).toFixed(1) };
  }
}

const out = {
  input: fx.synthetic ? 'synthetic (Barcelona-shaped, made-up prices)' : `real file ${fx.file}`,
  dataset: { hotels: answer.data.length, prices: answer.data.reduce((s, h) => s + h.prices.length, 0), days: days.length, coverage: sumHotels.coverage, sampleMix: fx.mix || null, bandMedianUsd: bands },
  storage, completeStays: stays,
  syntheticPlanningAccuracy: synthetic,
  livePricingAccuracy: 'NOT MEASURED. Needs real live hotel checks (Task 5 probe for the price basis, then Task 6 against Nuitee live rates).'
};

if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); }
else {
  console.log(`Price Index design study, input: ${out.input}`);
  console.log(`  ${out.dataset.hotels} hotels, ${out.dataset.prices} prices, ${out.dataset.days} days` + (out.dataset.sampleMix ? `, sample ${JSON.stringify(out.dataset.sampleMix)}` : '') + (bands ? `, median USD/night by band ${JSON.stringify(bands)}` : ''));
  console.log(`A. Storage per city: raw calendars ${storage.rawCalendarsKb} KB, summary ${storage.summaryKb} KB (${storage.summaryWithoutStaysKb} KB without complete stays); reads per 3-city search: raw ${storage.readUnitsPerSearch3Cities.raw}, summary ${storage.readUnitsPerSearch3Cities.summary}`);
  console.log('B. Complete stays at ONE hotel vs per-night city numbers (negative = per-night number is lower than any bookable stay level):');
  for (const [n, v] of Object.entries(stays)) console.log(`   ${n} nights: per-night p25 vs stay p25 ${v.nightP25VsStayP25MedianPct}% (under by 5%+ in ${v.nightP25UnderBy5PctShare}% of check-ins); per-night min vs cheapest stay ${v.nightMinVsStayMinMedianPct}%; hotels with every night priced ${v.hotelsWithEveryNightMedianPct}%`);
  if (synthetic) {
    console.log('C. SYNTHETIC planning accuracy (made-up prices; the "live" answer is known by construction). NOT live accuracy:');
    for (const [k, v] of Object.entries(synthetic)) console.log(`   ${k.padEnd(50)} median error ${String(v.medianErrorPct).padStart(5)}%  within 15% ${String(v.within15Pct).padStart(5)}%  too low by 5%+ ${String(v.tooLowBy5PctOrMore).padStart(5)}%`);
  } else console.log('C. Synthetic accuracy: skipped (real input has no known live answer).');
  console.log(`Live hotel pricing accuracy: ${out.livePricingAccuracy}`);
}
module.exports = out;
