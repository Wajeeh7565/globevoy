#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  COUNTRY_CURRENCIES,
  METRO_REVIEW_CODES,
  HISTORICAL_HOLD_BACK_IDS,
  SECRET_PATTERNS,
  normalizeText,
  unique
} = require('./registry-pipeline-utils');

const inputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(ROOT, 'release', 'city-registry-50-production-current.snapshot.json');

const REQUIRED_TOP_LEVEL = ['registryVersion', 'status', 'recordCount', 'cities'];
const REQUIRED_CITY_FIELDS = [
  'globevoyCityId',
  'displayCity',
  'country',
  'latitude',
  'longitude',
  'airportCode',
  'travelpayoutsCityCode',
  'travelpayoutsAirportCodes',
  'agodaCoverageStatus',
  'currency',
  'aliases',
  'normalizedSearchNames',
  'theme',
  'fallbackFlightUsd',
  'fallbackStayEstimate',
  'fallbackNightlyUsd',
  'dailySpendUsd',
  'frontendDisplayStatus',
  'backendStatus',
  'providerConfidence',
  'productionStatus',
  'notes'
];

const errors = new Map();
const warnings = new Map();

function add(map, group, message) {
  if (!map.has(group)) map.set(group, []);
  map.get(group).push(message);
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function duplicates(records, selector, options = {}) {
  const seen = new Map();
  records.forEach(record => {
    const values = Array.isArray(selector(record)) ? selector(record) : [selector(record)];
    values.forEach(value => {
      if (options.ignoreBlank !== false && isBlank(value)) return;
      const key = String(value).toLowerCase();
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(record.globevoyCityId || record.displayCity);
    });
  });
  return [...seen.entries()]
    .map(([value, ids]) => ({ value, ids: unique(ids) }))
    .filter(item => item.ids.length > 1);
}

function validateProductionImportSafety() {
  const runtimeFiles = [
    'backend/src/data/destination-meta.js',
    'backend/src/recommendations.js',
    'backend/src/lambda.js',
    'backend/src/server.js',
    'frontend/index.html',
    'frontend/explore.html',
    'frontend/ask.html',
    'frontend/destination-data.js'
  ];
  const unsafeImportPattern = /(require\(|import\s+.*from|<script[^>]+src=|fetch\().*(city-registry|origin-airport-mapping|production-candidate|generated-.*preview|100-candidate)/i;

  runtimeFiles.forEach(relativePath => {
    const filePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    if (unsafeImportPattern.test(text)) {
      add(errors, 'Production import safety', `${relativePath} appears to import/fetch a draft, candidate, or generated preview artifact.`);
    }
  });
}

function run() {
  let raw;
  let registry;

  try {
    raw = fs.readFileSync(inputPath, 'utf8');
    registry = JSON.parse(raw);
  } catch (error) {
    add(errors, 'JSON parse', `Could not parse ${inputPath}: ${error.message}`);
    printResult(null);
    process.exit(1);
  }

  SECRET_PATTERNS.forEach(pattern => {
    if (pattern.test(raw)) add(errors, 'Secret scan', `Snapshot contains secret-like text matching ${pattern}.`);
  });

  REQUIRED_TOP_LEVEL.forEach(field => {
    if (!(field in registry)) add(errors, 'Top-level schema', `Missing top-level field: ${field}`);
  });

  if (registry.status !== 'snapshot-not-production-source') {
    add(errors, 'Top-level schema', `Expected status snapshot-not-production-source, found ${registry.status}.`);
  }

  const records = Array.isArray(registry.cities) ? registry.cities : [];
  if (!Array.isArray(registry.cities)) add(errors, 'Top-level schema', 'cities must be an array.');
  if (registry.recordCount !== records.length) {
    add(errors, 'Top-level schema', `recordCount ${registry.recordCount} does not match cities length ${records.length}.`);
  }
  if (records.length !== 50) {
    add(warnings, 'Record count', `Expected current production snapshot count 50; found ${records.length}.`);
  }

  records.forEach(record => {
    REQUIRED_CITY_FIELDS.forEach(field => {
      if (!(field in record) || isBlank(record[field]) && !['region'].includes(field)) {
        add(errors, 'Required fields', `${record.globevoyCityId || record.displayCity || 'unknown'} missing ${field}.`);
      }
    });

    if (typeof record.latitude !== 'number' || record.latitude < -90 || record.latitude > 90) {
      add(errors, 'Coordinates', `${record.globevoyCityId} has invalid latitude ${record.latitude}.`);
    }
    if (typeof record.longitude !== 'number' || record.longitude < -180 || record.longitude > 180) {
      add(errors, 'Coordinates', `${record.globevoyCityId} has invalid longitude ${record.longitude}.`);
    }
    if (!/^[A-Z0-9]{3}$/.test(String(record.travelpayoutsCityCode || ''))) {
      add(warnings, 'Airport/city code sanity', `${record.globevoyCityId} has non-standard city code ${record.travelpayoutsCityCode}.`);
    }
    (record.travelpayoutsAirportCodes || []).forEach(code => {
      if (!/^[A-Z0-9]{3}$/.test(String(code))) {
        add(warnings, 'Airport/city code sanity', `${record.globevoyCityId} has non-standard airport code ${code}.`);
      }
    });
    if (!Object.values(COUNTRY_CURRENCIES).includes(record.currency)) {
      add(warnings, 'Currency consistency', `${record.globevoyCityId} has currency ${record.currency || 'missing'} needing review.`);
    }
    if (record.frontendDisplayStatus !== 'curated-frontend-ready') {
      add(warnings, 'Frontend/backend alignment', `${record.globevoyCityId} frontend status: ${record.frontendDisplayStatus}.`);
    }
    if (record.backendStatus !== 'live' || record.productionStatus !== 'live') {
      add(errors, 'Production status', `${record.globevoyCityId} should be live in the production-current snapshot.`);
    }
    if (HISTORICAL_HOLD_BACK_IDS.has(record.globevoyCityId)) {
      add(warnings, 'Hold-back city handling', `${record.globevoyCityId} is historically marked hold-back but is present in current live backend; keep product review note.`);
    }
    if (METRO_REVIEW_CODES.has(record.travelpayoutsCityCode)) {
      add(warnings, 'Metro-code risk', `${record.globevoyCityId} uses metro/city code ${record.travelpayoutsCityCode}; keep airport-list policy reviewed.`);
    }
  });

  duplicates(records, record => record.globevoyCityId, { ignoreBlank: false }).forEach(item => {
    add(errors, 'Duplicate Globevoy IDs', `${item.value}: ${item.ids.join(', ')}`);
  });
  duplicates(records, record => `${normalizeText(record.displayCity)}|${normalizeText(record.country)}`, { ignoreBlank: false }).forEach(item => {
    add(errors, 'Duplicate city names', `${item.value}: ${item.ids.join(', ')}`);
  });
  duplicates(records, record => record.normalizedSearchNames || []).forEach(item => {
    add(warnings, 'Duplicate aliases', `${item.value}: ${item.ids.join(', ')}`);
  });
  duplicates(records, record => record.agodaCityId).forEach(item => {
    add(errors, 'Duplicate Agoda IDs', `${item.value}: ${item.ids.join(', ')}`);
  });
  duplicates(records, record => record.travelpayoutsCityCode).forEach(item => {
    add(warnings, 'Duplicate Travelpayouts city codes', `${item.value}: ${item.ids.join(', ')}`);
  });

  validateProductionImportSafety();
  printResult(registry);
  process.exit(errors.size ? 1 : 0);
}

function printGrouped(title, map) {
  console.log(`${title} (${[...map.values()].reduce((sum, values) => sum + values.length, 0)})`);
  if (!map.size) {
    console.log('  None.');
    return;
  }
  [...map.entries()].forEach(([group, messages]) => {
    console.log(`\n  ${group}`);
    messages.forEach(message => console.log(`  - ${message}`));
  });
}

function printResult(registry) {
  const errorCount = [...errors.values()].reduce((sum, values) => sum + values.length, 0);
  const warningCount = [...warnings.values()].reduce((sum, values) => sum + values.length, 0);
  console.log('Globevoy production-current registry validation');
  console.log(`Registry: ${inputPath}`);
  if (registry && Array.isArray(registry.cities)) console.log(`Total records: ${registry.cities.length}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Warnings: ${warningCount}\n`);
  printGrouped('Errors', errors);
  console.log('');
  printGrouped('Warnings', warnings);
  console.log(`\nResult: ${errorCount ? 'FAIL' : 'PASS'}`);
}

run();
