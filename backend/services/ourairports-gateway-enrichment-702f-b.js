'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../data/unified-city-registry-1000-668b.json');
const source = require('../data/ourairports-source-702f-b.json');

const VERSION = 'GV-REC-702F-B';
const ALLOWED_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport', 'seaplane_base']);
const TYPE_PENALTY = Object.freeze({ large_airport: 0, medium_airport: 20, small_airport: 60, seaplane_base: 90 });

function clean(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return clean(v).toUpperCase(); }
function lower(v) { return clean(v).toLowerCase(); }
function validIata(v) { return /^[A-Z]{3}$/.test(upper(v)); }
function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function round1(v) { return Math.round(Number(v) * 10) / 10; }

function parseCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

function parseAirportsCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  const index = Object.fromEntries(headers.map((h, i) => [h, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const type = clean(cells[index.type]);
    const iata = upper(cells[index.iata_code]);
    const latitude = finite(cells[index.latitude_deg]);
    const longitude = finite(cells[index.longitude_deg]);
    const scheduled = lower(cells[index.scheduled_service]) === 'yes';
    if (!scheduled || !validIata(iata) || latitude == null || longitude == null || !ALLOWED_TYPES.has(type)) continue;
    rows.push({
      iata,
      type,
      name: clean(cells[index.name]),
      latitude,
      longitude,
      countryCode: upper(cells[index.iso_country]),
      municipality: clean(cells[index.municipality]),
      scheduledService: true
    });
  }
  return rows;
}

function radians(v) { return Number(v) * Math.PI / 180; }
function haversineKm(a, b) {
  const lat1 = radians(a.latitude); const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(Number(b.longitude) - Number(a.longitude));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function currentCodes(city = {}) {
  return Array.from(new Set([
    city.origin?.preferredAirportCode,
    ...(city.origin?.airportCodes || []),
    city.providers?.travelpayouts?.preferredAirportCode,
    ...(city.providers?.travelpayouts?.airportCodes || [])
  ].map(upper).filter(validIata)));
}

function existingGatewayCode(city = {}) {
  return upper(city.origin?.gateway?.airportCode || city.providers?.travelpayouts?.gateway?.airportCode || '');
}

function candidateScore(city, airport, distanceKm) {
  const sameCountry = upper(city.countryCode) === upper(airport.countryCode);
  const cityName = lower(city.displayName);
  const municipality = lower(airport.municipality);
  const municipalityBonus = cityName && municipality && (municipality.includes(cityName) || cityName.includes(municipality)) ? -20 : 0;
  return distanceKm + (TYPE_PENALTY[airport.type] ?? 120) + (sameCountry ? 0 : 80) + municipalityBonus;
}

function nearbyCandidates(city, airports, limit = 8) {
  const out = [];
  for (const airport of airports) {
    const km = haversineKm(city, airport);
    const sameCountry = upper(city.countryCode) === upper(airport.countryCode);
    if ((sameCountry && km > 400) || (!sameCountry && km > 200)) continue;
    out.push({
      iata: airport.iata,
      name: airport.name,
      type: airport.type,
      municipality: airport.municipality || null,
      countryCode: airport.countryCode,
      scheduledService: true,
      distanceKm: round1(km),
      sameCountry,
      reviewScore: round1(candidateScore(city, airport, km))
    });
  }
  out.sort((a, b) => a.reviewScore - b.reviewScore || a.distanceKm - b.distanceKm || a.iata.localeCompare(b.iata));
  return out.slice(0, Math.max(1, Math.min(Number(limit) || 8, 12)));
}

function airportEvidence(code, city, byIata) {
  const iata = upper(code);
  if (!validIata(iata)) return { iata: iata || null, status: 'missing-code', scheduledService: false };
  const airport = byIata.get(iata) || null;
  if (!airport) return { iata, status: 'not-found-in-pinned-ourairports', scheduledService: false };
  const km = haversineKm(city, airport);
  return {
    iata,
    status: airport.scheduledService ? 'scheduled-service-confirmed' : 'no-scheduled-service',
    scheduledService: airport.scheduledService === true,
    name: airport.name,
    type: airport.type,
    municipality: airport.municipality || null,
    countryCode: airport.countryCode,
    distanceKm: round1(km)
  };
}

function classify(city, preferredEvidence, gatewayEvidence, candidates) {
  const best = candidates[0] || null;
  if (!preferredEvidence?.iata) return best ? 'review-missing-preferred-airport' : 'no-nearby-scheduled-service-candidate';
  if (!preferredEvidence.scheduledService) return best ? 'review-current-preferred-not-confirmed' : 'no-nearby-scheduled-service-candidate';
  if (gatewayEvidence?.iata && !gatewayEvidence.scheduledService) return 'review-existing-gateway-not-confirmed';
  if (best && best.iata !== preferredEvidence.iata) {
    const preferredPenalty = TYPE_PENALTY[preferredEvidence.type] ?? 120;
    const bestPenalty = TYPE_PENALTY[best.type] ?? 120;
    const materiallyCloser = Number(preferredEvidence.distanceKm || 9999) - best.distanceKm >= 75;
    const materiallyLarger = preferredPenalty - bestPenalty >= 40 && best.distanceKm <= Number(preferredEvidence.distanceKm || 9999) + 80;
    if (materiallyCloser || materiallyLarger) return 'review-alternative-gateway-candidate';
  }
  return 'current-mapping-confirmed';
}

function enrichCity(city, airports, byIata) {
  const codes = currentCodes(city);
  const preferredCode = upper(city.origin?.preferredAirportCode || city.providers?.travelpayouts?.preferredAirportCode || codes[0] || '');
  const preferredEvidence = airportEvidence(preferredCode, city, byIata);
  const gatewayCode = existingGatewayCode(city);
  const gatewayEvidence = gatewayCode ? airportEvidence(gatewayCode, city, byIata) : null;
  const candidates = nearbyCandidates(city, airports, 8);
  const classification = classify(city, preferredEvidence, gatewayEvidence, candidates);
  const reviewPriority = [
    'review-current-preferred-not-confirmed',
    'review-existing-gateway-not-confirmed',
    'review-missing-preferred-airport',
    'no-nearby-scheduled-service-candidate'
  ].includes(classification) ? 'high' : classification === 'review-alternative-gateway-candidate' ? 'medium' : 'none';

  return {
    cityId: city.cityId,
    displayName: city.displayName,
    country: city.country,
    countryCode: city.countryCode,
    latitude: city.latitude,
    longitude: city.longitude,
    selectionTier: city.selectionTier,
    requiresGatewayTransfer: city.origin?.requiresGatewayTransfer === true,
    currentMapping: {
      preferredAirportCode: preferredCode || null,
      airportCodes: codes,
      preferredEvidence,
      existingGatewayCode: gatewayCode || null,
      existingGatewayEvidence: gatewayEvidence
    },
    generatedCandidates: candidates,
    review: {
      classification,
      priority: reviewPriority,
      topCandidate: candidates[0] || null,
      routingChanged: false,
      automaticOverrideAllowed: false
    }
  };
}

function buildReport(csvText, options = {}) {
  const airports = parseAirportsCsv(csvText);
  const byIata = new Map(airports.map(row => [row.iata, row]));
  const cities = Array.isArray(options.registryRecords) ? options.registryRecords : (registry.records || []);
  const records = cities.map(city => enrichCity(city, airports, byIata));
  const counts = {};
  for (const row of records) counts[row.review.classification] = (counts[row.review.classification] || 0) + 1;
  const reviewQueue = records.filter(row => row.review.priority !== 'none')
    .sort((a, b) => ({ high: 0, medium: 1 }[a.review.priority] - ({ high: 0, medium: 1 }[b.review.priority])
      || a.displayName.localeCompare(b.displayName));

  return {
    ok: true,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    source,
    policy: {
      scheduledServiceRequiredForGeneratedCandidates: true,
      validIataRequired: true,
      sameCountryRadiusKm: 400,
      crossBorderRadiusKm: 200,
      maximumCandidatesPerCity: 8,
      reviewOnly: true,
      routingChanged: false,
      automaticOverrideAllowed: false,
      providerCallsPerformed: false
    },
    summary: {
      curatedCityCount: records.length,
      eligibleScheduledServiceAirportCount: airports.length,
      citiesWithNearbyCandidates: records.filter(row => row.generatedCandidates.length > 0).length,
      preferredAirportScheduledServiceConfirmed: records.filter(row => row.currentMapping.preferredEvidence?.scheduledService).length,
      existingGatewayCount: records.filter(row => row.currentMapping.existingGatewayCode).length,
      existingGatewayScheduledServiceConfirmed: records.filter(row => row.currentMapping.existingGatewayEvidence?.scheduledService).length,
      reviewQueueCount: reviewQueue.length,
      highPriorityReviewCount: reviewQueue.filter(row => row.review.priority === 'high').length,
      mediumPriorityReviewCount: reviewQueue.filter(row => row.review.priority === 'medium').length,
      classifications: counts,
      routingChanged: false
    },
    reviewQueue,
    records
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--csv') out.csv = argv[++i];
    else if (key === '--out') out.out = argv[++i];
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  if (!args.csv || !args.out) {
    console.error('Usage: node ourairports-gateway-enrichment-702f-b.js --csv <airports.csv> --out <report.json>');
    process.exit(2);
  }
  const csvText = fs.readFileSync(path.resolve(args.csv), 'utf8');
  const report = buildReport(csvText);
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
}

module.exports = {
  VERSION,
  parseCsvLine,
  parseAirportsCsv,
  haversineKm,
  currentCodes,
  nearbyCandidates,
  airportEvidence,
  classify,
  enrichCity,
  buildReport
};
