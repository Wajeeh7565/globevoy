'use strict';

// GV-PROVIDER-683D — live shadow smoke.
// Exactly three Duffel offer-request searches. No deployment and no mutation API.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.ENABLE_DUFFEL_LIVE_683D = 'true';
process.env.ENABLE_DUFFEL_SHADOW_683D = 'true';

const { fetchDuffelShadow683D, duffelStatus683D } = require('./services/providers/flights/flight-provider-router-683c');

const cases = [
  { name: 'LAX-LAS', origin: 'LAX', destination: 'LAS', departureDate: '2026-09-01', currency: 'USD', passengers: 1 },
  { name: 'YYZ-LIS', origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'CAD', passengers: 1 },
  { name: 'DUB-SSH', origin: 'DUB', destination: 'SSH', departureDate: '2026-08-27', currency: 'EUR', passengers: 1 }
];

function cheapest(rows = []) {
  return rows.filter(row => Number(row?.totalPrice) > 0)
    .slice().sort((a,b) => Number(a.totalPrice)-Number(b.totalPrice) || Number(a.durationMinutes || Infinity)-Number(b.durationMinutes || Infinity))[0] || null;
}

function compact(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    origin: row.origin,
    destination: row.destination,
    departureDate: row.departureDate,
    totalPrice: row.totalPrice,
    currency: row.currency,
    requestedCurrency: row.requestedCurrency,
    currencyMismatch: row.currencyMismatch,
    airline: row.airline,
    stops: row.stops,
    durationMinutes: row.durationMinutes,
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    expiresAt: row.expiresAt,
    liveMode: row.liveMode,
    providerEndpoint: row.providerEndpoint,
    sourceType: row.priceEvidence?.sourceType || row.sourceType || null,
    productionEligible: row.priceEvidence?.productionEligible ?? false,
    isBookable: row.priceEvidence?.isBookable ?? false
  };
}

(async()=>{
  const status = duffelStatus683D();
  assert.equal(status.tokenMode, 'live', 'DUFFEL_ACCESS_TOKEN must be a live token.');
  assert.equal(status.shadowEnabled, true);
  assert.equal(status.productionApproved, false);
  assert.equal(status.rankingEnabled, false);

  console.log('=== GV-PROVIDER-683D live shadow smoke ===');
  console.log('No deployment. No ranking change. No order. No payment. No booking.');
  console.log('Exactly 3 Duffel offer-request searches are planned.');

  const results = [];
  for (const spec of cases) {
    process.stdout.write(`Searching ${spec.name} ${spec.departureDate} (${spec.currency}) ... `);
    const result = await fetchDuffelShadow683D(spec);
    assert.equal(result.supported, true, `${spec.name}: ${result.reason || 'no supported result'}`);
    const best = cheapest(result.observations);
    assert.ok(best, `${spec.name}: no usable live observation`);
    assert.equal(best.provider, 'duffel-live-683d');
    assert.equal(best.providerEvidenceClass, 'LIVE_PROVIDER');
    assert.equal(best.liveMode, true);
    assert.equal(best.providerEndpoint, '/air/offer_requests');
    assert.ok(Number.isFinite(Date.parse(best.expiresAt)) && Date.parse(best.expiresAt) > Date.now(), `${spec.name}: expiry missing/past`);
    assert.equal(result.providerContract.provider.productionApproved, false);
    results.push({ case: spec, supported: result.supported, observationCount: result.observations.length, cheapest: compact(best), currencyMismatchObserved: Boolean(result.currencyMismatchObserved) });
    console.log(`LIVE ${best.currency} ${Number(best.totalPrice).toFixed(2)}; offers=${result.observations.length}; mismatch=${Boolean(best.currencyMismatch)}`);
  }

  const output = {
    version: 'GV-PROVIDER-683D',
    capturedAt: new Date().toISOString(),
    decision: 'DUFFEL_LIVE_SHADOW_ADAPTER_WORKING',
    safety: {
      shadowOnly: true,
      productionApproved: false,
      rankingEnabled: false,
      allowedEndpoint: '/air/offer_requests',
      plannedRequestCount: cases.length,
      orderActions: false,
      paymentActions: false,
      bookingActions: false,
      tokenValueReturned: false
    },
    providerStatus: status,
    results
  };

  const outDir = process.env.GV_683D_OUTPUT_DIR
    ? path.resolve(process.env.GV_683D_OUTPUT_DIR)
    : path.join(__dirname, 'GV-PROVIDER-683D-LIVE-OUTPUT');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'GV-PROVIDER-683D-LIVE-SMOKE.json'), JSON.stringify(output, null, 2));

  const md = [];
  md.push('# GV-PROVIDER-683D — Live Shadow Smoke');
  md.push('');
  md.push(`Captured: ${output.capturedAt}`);
  md.push('');
  md.push(`Decision: **${output.decision}**`);
  md.push('');
  md.push('No deployment, ranking change, order, payment, reservation, or booking action was performed.');
  md.push('');
  md.push('| Case | Requested | Live returned | Cheapest | Airline | Stops | Expiry | Price evidence |');
  md.push('|---|---|---|---:|---|---:|---|---|');
  for (const row of results) {
    const x = row.cheapest;
    md.push(`| ${row.case.name} | ${row.case.currency} | ${x.currency}${x.currencyMismatch ? ' (mismatch)' : ''} | ${Number(x.totalPrice).toFixed(2)} | ${x.airline || '-'} | ${x.stops ?? '-'} | ${x.expiresAt || '-'} | ${x.sourceType || '-'} |`);
  }
  md.push('');
  md.push('683D remains shadow-only. These observations do not enter P1/P2 ranking in this release.');
  fs.writeFileSync(path.join(outDir, 'GV-PROVIDER-683D-LIVE-SMOKE.md'), md.join('\n')+'\n');

  console.log('Decision: DUFFEL_LIVE_SHADOW_ADAPTER_WORKING');
  console.log(`Outputs: ${outDir}`);
})().catch(error=>{ console.error(error.stack || error); process.exit(1); });
