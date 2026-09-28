'use strict';

// GV-CITY-668C live audit runner.
// Run in a trusted environment with production provider credentials. It checkpoints after each bounded chunk.

const fs = require('fs');
const path = require('path');
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
const service = require('./services/admin/audits/provider-live-coverage');
const template = require('./data/provider-live-coverage-1000-668c.json');
const pilot = require('./data/provider-live-pilot-100-668c.json');
const staticAudit = require('./data/provider-mappings-1000-668b.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  return args;
}
function clean(value) { return String(value || '').trim(); }
function int(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function writeCsv(file, records) {
  const header = ['cityId','displayName','country','countryCode','classification','productionActive','travelpayoutsStatus','agodaStatus','lastVerifiedAt'];
  const rows = [header.join(',')];
  for (const record of records) {
    rows.push([
      record.cityId, record.displayName, record.country, record.countryCode, record.classification,
      record.productionActivation?.eligible === true,
      record.live?.travelpayouts?.status || '', record.live?.agoda?.status || '', record.lastVerifiedAt || ''
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(file, `${rows.join('\n')}\n`);
}
function loadBase(outputFile, resume) {
  if (resume && fs.existsSync(outputFile)) return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  return JSON.parse(JSON.stringify(template));
}
function selectIds(args) {
  if (args['city-ids']) return [...new Set(clean(args['city-ids']).split(',').map(clean).filter(Boolean))];
  if (args.all) {
    const start = int(args.start, 0, 0, 999);
    const limit = int(args.limit, 1000 - start, 1, 1000 - start);
    return staticAudit.records.slice(start, start + limit).map(record => record.cityId);
  }
  const count = int(args.pilot === true ? 100 : args.pilot, 100, 1, 100);
  return pilot.cityIds.slice(0, count);
}
function usage() {
  console.log(`GV-CITY-668C live provider audit\n\n` +
    `Required environment: TRAVELPAYOUTS_TOKEN, AGODA_SITE_ID, AGODA_API_KEY\n\n` +
    `Examples:\n` +
    `  node run-gv-city-668c-live-audit.js --pilot 100 --output ./GV-CITY-668C_LIVE_RESULTS.json\n` +
    `  node run-gv-city-668c-live-audit.js --all --start 0 --limit 500 --resume --output ./GV-CITY-668C_LIVE_RESULTS.json\n` +
    `  node run-gv-city-668c-live-audit.js --city-ids toronto-ca,paris-fr --output ./sample.json\n\n` +
    `Options: --chunk-size 1..10, --concurrency 1..3, --month YYYY-MM, --check-in YYYY-MM-DD, --dry-run, --allow-partial-credentials`);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  const cityIds = selectIds(args);
  const outputFile = path.resolve(clean(args.output) || 'GV-CITY-668C_LIVE_COVERAGE_RESULTS.json');
  const chunkSize = int(args['chunk-size'], 5, 1, 10);
  const concurrency = int(args.concurrency, 2, 1, 3);
  const hasTravelpayouts = Boolean(clean(process.env.TRAVELPAYOUTS_TOKEN));
  const hasAgoda = Boolean(clean(process.env.AGODA_SITE_ID) && clean(process.env.AGODA_API_KEY));

  const plan = {
    taskId: 'GV-CITY-668C', cityCount: cityIds.length, chunkSize, concurrency, outputFile,
    credentials: { travelpayouts: hasTravelpayouts, agoda: hasAgoda },
    mode: args.all ? 'all-or-range' : (args['city-ids'] ? 'explicit-city-ids' : 'pilot')
  };
  console.log(JSON.stringify(plan, null, 2));
  if (args['dry-run']) return;
  if ((!hasTravelpayouts || !hasAgoda) && !args['allow-partial-credentials']) {
    throw new Error('Production Travelpayouts and Agoda credentials are both required. Use --allow-partial-credentials only for a deliberate partial audit.');
  }

  let merged = loadBase(outputFile, Boolean(args.resume));
  for (let offset = 0; offset < cityIds.length; offset += chunkSize) {
    const chunk = cityIds.slice(offset, offset + chunkSize);
    const response = await service.verifyBatch({
      cityIds: chunk,
      concurrency,
      month: args.month,
      checkIn: args['check-in'],
      currency: args.currency || 'CAD',
      nights: args.nights || 2,
      adults: args.adults || 2,
      rooms: args.rooms || 1,
      anchorOrigins: args.anchors || ''
    }, { ignoreFeatureFlag: true });
    merged = service.mergeResultsIntoSnapshot(response.records, merged);
    merged.runMetadata = {
      taskId: 'GV-CITY-668C', mode: plan.mode, requestedCityCount: cityIds.length,
      completedThroughIndex: Math.min(cityIds.length, offset + chunk.length),
      chunkSize, concurrency, lastCheckpointAt: new Date().toISOString()
    };
    fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2));
    console.log(JSON.stringify({
      checkpoint: `${Math.min(cityIds.length, offset + chunk.length)}/${cityIds.length}`,
      productionActiveCount: merged.summary.productionActiveCount,
      verifiedAtLeastOnceCount: merged.summary.verifiedAtLeastOnceCount,
      classificationCounts: merged.summary.classificationCounts
    }));
  }

  const base = outputFile.replace(/\.json$/i, '');
  writeCsv(`${base}_ALL.csv`, merged.records);
  writeCsv(`${base}_PRODUCTION_ACTIVE.csv`, merged.records.filter(record => record.productionActivation?.eligible === true));
  writeCsv(`${base}_REVIEW.csv`, merged.records.filter(record => ['unresolved','provider-error','estimate-only','live-flights-only','live-stays-only'].includes(record.classification)));
  console.log(JSON.stringify({
    ok: true,
    outputFile,
    allCsv: `${base}_ALL.csv`,
    productionActiveCsv: `${base}_PRODUCTION_ACTIVE.csv`,
    reviewCsv: `${base}_REVIEW.csv`,
    summary: merged.summary
  }, null, 2));
})().catch(error => {
  console.error(`GV-CITY-668C audit failed: ${error.message}`);
  process.exitCode = 1;
});
