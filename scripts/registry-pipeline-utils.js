const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT, 'release', 'city-registry-50-production-current.snapshot.json');
const BACKEND_PREVIEW_PATH = path.join(ROOT, 'release', 'generated-backend-destination-meta.preview.js');
const FRONTEND_PREVIEW_PATH = path.join(ROOT, 'release', 'generated-frontend-destination-data.preview.js');
const ALIGNMENT_REPORT_PATH = path.join(ROOT, 'release', 'generated-registry-alignment-report.md');
const PARITY_REPORT_PATH = path.join(ROOT, 'release', 'registry-pipeline-50-live-parity-report.md');

const COUNTRY_CODES = {
  Canada: 'CA',
  'United States': 'US',
  'Puerto Rico': 'PR',
  Mexico: 'MX',
  Colombia: 'CO',
  'Costa Rica': 'CR',
  Panama: 'PA',
  Peru: 'PE',
  Portugal: 'PT',
  Spain: 'ES',
  France: 'FR',
  Italy: 'IT',
  Ireland: 'IE',
  'United Kingdom': 'GB',
  'Czech Republic': 'CZ',
  Czechia: 'CZ',
  Iceland: 'IS',
  Germany: 'DE',
  Netherlands: 'NL',
  Hungary: 'HU',
  Poland: 'PL',
  Slovenia: 'SI',
  Morocco: 'MA',
  Turkey: 'TR',
  'Türkiye': 'TR',
  Egypt: 'EG',
  Thailand: 'TH',
  Japan: 'JP'
};

const COUNTRY_CURRENCIES = {
  CA: 'CAD',
  US: 'USD',
  PR: 'USD',
  MX: 'MXN',
  CO: 'COP',
  CR: 'CRC',
  PA: 'USD',
  PE: 'PEN',
  PT: 'EUR',
  ES: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  IE: 'EUR',
  GB: 'GBP',
  CZ: 'CZK',
  IS: 'ISK',
  DE: 'EUR',
  NL: 'EUR',
  HU: 'HUF',
  PL: 'PLN',
  SI: 'EUR',
  MA: 'MAD',
  TR: 'TRY',
  EG: 'EGP',
  TH: 'THB',
  JP: 'JPY'
};

const METRO_REVIEW_CODES = new Set(['NYC', 'LON', 'PAR', 'ROM', 'MIL', 'CHI', 'TYO', 'YEA', 'ORL']);
const HISTORICAL_HOLD_BACK_IDS = new Set(['edmonton-ca', 'moncton-ca', 'orlando-us', 'tbilisi-ge', 'amman-jo']);

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /BEGIN (RSA|OPENSSH|DSA|EC) PRIVATE KEY/i,
  /TRAVELPAYOUTS_TOKEN/i,
  /AGODA_API_KEY/i,
  /password\s*[:=]/i,
  /secret\s*[:=]/i,
  /api[_-]?key\s*[:=]/i,
  /token\s*[:=]/i
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalCountry(country) {
  if (/^czechia$/i.test(String(country || ''))) return 'Czech Republic';
  if (/^türkiye$/i.test(String(country || ''))) return 'Turkey';
  return country || null;
}

function slugPart(value) {
  return normalizeText(value).replace(/\s+/g, '-');
}

function unique(values) {
  return [...new Set((values || [])
    .filter(value => value !== null && value !== undefined && String(value).trim() !== '')
    .map(value => String(value).trim()))];
}

function cityCountryKey(record) {
  return `${normalizeText(record.city || record.displayCity)}|${normalizeText(canonicalCountry(record.country))}`;
}

function readJsonIfExists(relativePath, fallback) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadBackendDestinations() {
  const { DESTINATIONS } = require(path.join(ROOT, 'backend', 'src', 'data', 'destination-meta.js'));
  return Object.values(DESTINATIONS || {});
}

function loadFrontendDestinations() {
  const source = fs.readFileSync(path.join(ROOT, 'frontend', 'destination-data.js'), 'utf8');
  const context = { window: {}, console };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'frontend/destination-data.js' });
  return context.window.GLOBEVOY_DESTINATIONS || [];
}

function loadDraftRegistry() {
  return readJsonIfExists('backend/src/data/city-registry.draft.json', { cities: [] }).cities || [];
}

function findDraftRecord(draftRegistry, destination) {
  const key = cityCountryKey(destination);
  return draftRegistry.find(record => cityCountryKey(record) === key) || null;
}

function findFrontendRecord(frontendDestinations, destination) {
  const key = cityCountryKey(destination);
  return frontendDestinations.find(record => cityCountryKey(record) === key) || null;
}

function fallbackCityId(destination, draftRecord) {
  if (destination.globevoyCityId) return destination.globevoyCityId;
  if (draftRecord && draftRecord.globevoyCityId) return draftRecord.globevoyCityId;
  const countryCode = COUNTRY_CODES[canonicalCountry(destination.country)] || 'XX';
  return `${slugPart(destination.city)}-${countryCode.toLowerCase()}`;
}

function frontendDisplayStatus(frontendRecord) {
  if (!frontendRecord) {
    return {
      status: 'missing-curated-frontend-record',
      missingFields: ['frontend-record', 'map-x-y', 'image', 'whyItFits', 'styleTags']
    };
  }

  const missingFields = [];
  if (frontendRecord.x === undefined || frontendRecord.y === undefined) missingFields.push('map-x-y');
  if (!frontendRecord.img) missingFields.push('image');
  if (!frontendRecord.whyItFits) missingFields.push('whyItFits');
  if (!Array.isArray(frontendRecord.styleTags) || frontendRecord.styleTags.length === 0) missingFields.push('styleTags');
  if (!frontendRecord.costs || frontendRecord.costs.flightDemandUsd === undefined) missingFields.push('flightDemandUsd');

  return {
    status: missingFields.length ? 'curated-frontend-record-needs-review' : 'curated-frontend-ready',
    missingFields
  };
}

function providerConfidence(destination) {
  const agodaStatus = destination.agodaCoverageStatus || 'unverified';
  const travelStatus = destination.providerCoverage && destination.providerCoverage.travelpayouts
    ? destination.providerCoverage.travelpayouts.status
    : 'needs-review';

  if (agodaStatus === 'strong' && (travelStatus === 'strong' || travelStatus === 'ready')) return 'strong';
  if (['strong', 'partial'].includes(agodaStatus) && travelStatus !== 'missing') return 'partial';
  return 'needs-review';
}

function buildSnapshotRecord(destination, frontendRecord, draftRecord) {
  const country = canonicalCountry(destination.country);
  const countryCode = COUNTRY_CODES[country] || (draftRecord && draftRecord.countryCode) || null;
  const id = fallbackCityId(destination, draftRecord);
  const travelpayoutsCityCode = destination.travelpayoutsCityCode || destination.code;
  const travelpayoutsAirportCodes = unique(destination.travelpayoutsAirportCodes || [destination.primaryAirportCode || destination.code]);
  const primaryAirportCode = destination.primaryAirportCode || travelpayoutsAirportCodes[0] || destination.code;
  const aliases = unique([
    ...(destination.aliases || []),
    ...(draftRecord && draftRecord.aliases ? draftRecord.aliases : []),
    destination.city,
    `${destination.city}, ${country}`,
    `${destination.city} ${country}`,
    destination.code,
    travelpayoutsCityCode,
    primaryAirportCode
  ]);
  const normalizedSearchNames = unique([
    ...(destination.normalizedSearchNames || []),
    ...(draftRecord && draftRecord.normalizedSearchNames ? draftRecord.normalizedSearchNames : []),
    ...aliases.map(normalizeText)
  ]);
  const displayStatus = frontendDisplayStatus(frontendRecord);
  const warnings = [];

  if (displayStatus.missingFields.length) warnings.push('frontend-display-review-needed');
  if (METRO_REVIEW_CODES.has(travelpayoutsCityCode)) warnings.push('metro-code-policy-review');
  if (HISTORICAL_HOLD_BACK_IDS.has(id)) warnings.push('historical-hold-back-live-review-debt');
  if (!destination.agodaCityId) warnings.push('agoda-city-id-missing');
  if (destination.agodaHotelCount === undefined || destination.agodaHotelCount === null) warnings.push('agoda-hotel-count-missing');
  if (!destination.fallbackFlightUsd) warnings.push('fallback-flight-missing');
  if (!destination.fallbackNightlyUsd) warnings.push('fallback-stay-missing');
  if (!countryCode || !COUNTRY_CURRENCIES[countryCode]) warnings.push('currency-needs-review');

  return {
    globevoyCityId: id,
    displayCity: destination.city,
    country,
    countryCode,
    region: draftRecord && draftRecord.region ? draftRecord.region : null,
    latitude: destination.lat,
    longitude: destination.lng,
    airportCode: destination.code,
    travelpayoutsCityCode,
    travelpayoutsAirportCodes,
    primaryAirportCode,
    nearestMajorAirportCode: destination.nearestMajorAirportCode || primaryAirportCode,
    agodaCityId: destination.agodaCityId || null,
    agodaHotelCount: destination.agodaHotelCount === undefined ? null : destination.agodaHotelCount,
    agodaCoverageStatus: destination.agodaCoverageStatus || 'unverified',
    currency: COUNTRY_CURRENCIES[countryCode] || null,
    aliases,
    normalizedSearchNames,
    theme: destination.theme || null,
    styleTags: frontendRecord && Array.isArray(frontendRecord.styleTags) ? frontendRecord.styleTags : [],
    recommendedDays: frontendRecord && frontendRecord.recommendedDays !== undefined ? frontendRecord.recommendedDays : null,
    nights: frontendRecord && frontendRecord.nights !== undefined ? frontendRecord.nights : null,
    days: destination.days || null,
    season: destination.season || null,
    seasonInsight: destination.seasonInsight || null,
    fallbackFlightUsd: destination.fallbackFlightUsd === undefined ? null : destination.fallbackFlightUsd,
    fallbackStayEstimate: {
      nightlyUsd: destination.fallbackNightlyUsd === undefined ? null : destination.fallbackNightlyUsd,
      source: 'backend/src/data/destination-meta.js'
    },
    fallbackNightlyUsd: destination.fallbackNightlyUsd === undefined ? null : destination.fallbackNightlyUsd,
    dailySpendUsd: destination.dailySpendUsd === undefined ? null : destination.dailySpendUsd,
    dailySpendSource: destination.dailySpendSource || null,
    activitiesLocalUsd: destination.activitiesLocalUsd === undefined ? null : destination.activitiesLocalUsd,
    frontendDisplayStatus: displayStatus.status,
    frontendMissingFields: displayStatus.missingFields,
    backendStatus: 'live',
    providerConfidence: providerConfidence(destination),
    providerCoverage: destination.providerCoverage || {
      travelpayouts: { status: 'needs-review' },
      agoda: { status: destination.agodaCoverageStatus || 'unverified' }
    },
    registryValidationStatus: destination.registryValidationStatus || (draftRecord && draftRecord.validationStatus) || 'production-current-needs-periodic-review',
    imageUrl: frontendRecord && frontendRecord.img ? frontendRecord.img : destination.img || null,
    imageStatus: frontendRecord && frontendRecord.img ? 'frontend-curated-image' : destination.img ? 'backend-image-needs-frontend-review' : 'missing',
    copyStatus: frontendRecord && frontendRecord.whyItFits ? 'frontend-curated-copy' : 'backend-copy-needs-frontend-review',
    productionStatus: 'live',
    warnings,
    notes: [
      'Production-current snapshot record only; not imported by runtime.',
      displayStatus.status === 'curated-frontend-ready'
        ? 'Curated frontend record exists.'
        : 'Frontend may rely on API fallback rendering or needs curated display review.',
      draftRecord ? 'Matched historical draft registry record for identity/provider context.' : 'No matching draft registry record found.'
    ].join(' ')
  };
}

function buildProductionSnapshot() {
  const backendDestinations = loadBackendDestinations();
  const frontendDestinations = loadFrontendDestinations();
  const draftRegistry = loadDraftRegistry();
  const records = backendDestinations.map(destination => {
    const frontendRecord = findFrontendRecord(frontendDestinations, destination);
    const draftRecord = findDraftRecord(draftRegistry, destination);
    return buildSnapshotRecord(destination, frontendRecord, draftRecord);
  });

  return {
    registryVersion: 'production-current-50-v1',
    status: 'snapshot-not-production-source',
    generatedAt: new Date().toISOString(),
    generatedFrom: [
      'backend/src/data/destination-meta.js',
      'frontend/destination-data.js',
      'backend/src/data/city-registry.draft.json'
    ],
    productionWarning: 'Review artifact only. Do not import this file into runtime backend or frontend code.',
    recordCount: records.length,
    counts: {
      backendProductionCount: backendDestinations.length,
      frontendCuratedCount: frontendDestinations.length,
      frontendCuratedReady: records.filter(record => record.frontendDisplayStatus === 'curated-frontend-ready').length,
      frontendNeedsReview: records.filter(record => record.frontendDisplayStatus !== 'curated-frontend-ready').length
    },
    cities: records
  };
}

function scanTextForSecrets(label, text) {
  return SECRET_PATTERNS
    .filter(pattern => pattern.test(text))
    .map(pattern => `${label} matched ${pattern}`);
}

function escapeJs(value) {
  return JSON.stringify(value, null, 2);
}

function ensureReleaseDir() {
  fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true });
}

module.exports = {
  ROOT,
  SNAPSHOT_PATH,
  BACKEND_PREVIEW_PATH,
  FRONTEND_PREVIEW_PATH,
  ALIGNMENT_REPORT_PATH,
  PARITY_REPORT_PATH,
  COUNTRY_CURRENCIES,
  METRO_REVIEW_CODES,
  HISTORICAL_HOLD_BACK_IDS,
  SECRET_PATTERNS,
  normalizeText,
  canonicalCountry,
  unique,
  cityCountryKey,
  loadBackendDestinations,
  loadFrontendDestinations,
  buildProductionSnapshot,
  scanTextForSecrets,
  escapeJs,
  ensureReleaseDir
};
