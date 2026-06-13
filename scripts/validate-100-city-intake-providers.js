#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const readline = require('readline');
const {
  ROOT,
  normalizeText,
  unique,
  METRO_REVIEW_CODES,
  HISTORICAL_HOLD_BACK_IDS
} = require('./registry-pipeline-utils');

const VALID_CURRENCIES = new Set([
  'CAD', 'USD', 'GBP', 'EUR', 'AUD', 'MXN', 'COP', 'CRC', 'PEN', 'CZK',
  'ISK', 'HUF', 'PLN', 'MAD', 'TRY', 'EGP', 'THB', 'JPY', 'KRW', 'TWD',
  'GEL', 'JOD', 'BRL', 'ARS', 'CLP', 'AED', 'CHF', 'SEK', 'NOK', 'DKK',
  'NZD', 'SGD', 'MYR', 'IDR', 'VND', 'PHP', 'ZAR'
]);
const STATE_ABBREVIATIONS = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY'
};
const REQUIRED_FIELDS = [
  'globevoyCityId',
  'displayCity',
  'country',
  'countryCode',
  'latitude',
  'longitude',
  'currency',
  'aliases',
  'normalizedSearchNames',
  'travelpayoutsCityCode',
  'travelpayoutsAirportCodes',
  'primaryAirportCode',
  'fallbackFlightUsd',
  'fallbackNightlyUsd',
  'dailySpendUsd',
  'activitiesLocalUsd',
  'theme',
  'styleTags',
  'recommendedDays',
  'nights',
  'frontendFallbackEligible',
  'productionStatus'
];

function usage() {
  console.log('Usage: node scripts/validate-100-city-intake-providers.js <intake.json> <cities.json> <airports.json> [agoda.csv|agoda.json|agoda-dir]');
  console.log('');
  console.log('Example: node scripts/validate-100-city-intake-providers.js path/to/intake.json path/to/cities.json path/to/airports.json');
}

function resolveInput(inputPath) {
  if (!inputPath) return null;
  const candidates = [
    path.resolve(process.cwd(), inputPath),
    path.resolve(ROOT, inputPath)
  ];
  if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, 'Downloads', inputPath));
  const found = candidates.find(candidate => fs.existsSync(candidate));
  return found || path.resolve(process.cwd(), inputPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureArray(value, label) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.records)) return value.records;
  if (value && Array.isArray(value.cities)) return value.cities;
  throw new Error(`${label} must be an array or contain records/cities array.`);
}

function distanceKm(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof a.lon !== 'number' || typeof b.lat !== 'number' || typeof b.lon !== 'number') return null;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) / 10;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map(header => header.trim());
  return rows
    .filter(values => values.some(value => String(value || '').trim() !== ''))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function firstPresent(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') return record[key];
  }
  return null;
}

function normalizeCountry(value) {
  const text = String(value || '').trim();
  const normalized = normalizeText(text);
  const countryAliases = {
    us: 'US',
    usa: 'US',
    'united states': 'US',
    'united states of america': 'US',
    at: 'AT',
    austria: 'AT',
    de: 'DE',
    germany: 'DE',
    gr: 'GR',
    greece: 'GR',
    hr: 'HR',
    croatia: 'HR'
  };
  return countryAliases[normalized] || text.toUpperCase();
}

function stripCityQualifiers(value) {
  return String(value || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*,\s*[A-Z]{2}\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stateTokens(region) {
  const tokens = unique([region, STATE_ABBREVIATIONS[region]].filter(Boolean));
  return tokens.map(normalizeText).filter(Boolean);
}

function agodaKey(city, countryCode) {
  return `${normalizeText(city)}|${countryCode}`;
}

async function buildAgodaIndexFromCsvStream(readable) {
  const index = new Map();
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let headers = null;
  let rowCount = 0;
  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line).map(header => header.trim());
      continue;
    }
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    addAgodaRowToIndex(index, row);
    rowCount += 1;
  }
  return { index, rowCount };
}

function listZipEntries(zipPath) {
  const result = childProcess.spawnSync('tar', ['-tf', zipPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'tar -tf failed').trim());
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

async function buildAgodaIndexFromZip(zipPath) {
  const entries = listZipEntries(zipPath);
  const csvEntry = entries.find(entry => /\.csv$/i.test(entry));
  if (!csvEntry) throw new Error('No CSV entry found inside Agoda ZIP.');
  const tar = childProcess.spawn('tar', ['-xOf', zipPath, csvEntry], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  tar.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  const result = await buildAgodaIndexFromCsvStream(tar.stdout);
  const exitCode = await new Promise(resolve => tar.on('close', resolve));
  if (exitCode !== 0) throw new Error(stderr.trim() || `tar exited with ${exitCode}`);
  return { ...result, csvEntry };
}

async function loadAgodaRows(optionalPath) {
  if (!optionalPath) {
    return { status: 'not-provided', rows: [], notes: ['No Agoda feed path was provided.'] };
  }

  const agodaPath = resolveInput(optionalPath);
  if (!fs.existsSync(agodaPath)) {
    return { status: 'missing', rows: [], notes: [`Agoda feed path not found: ${agodaPath}`] };
  }

  const stat = fs.statSync(agodaPath);
  if (stat.isDirectory()) {
    const candidate = fs.readdirSync(agodaPath)
      .map(name => path.join(agodaPath, name))
      .find(file => /\.(csv|json|jsonl)$/i.test(file));
    if (!candidate) return { status: 'unsupported-directory', rows: [], notes: [`No CSV/JSON/JSONL file found in ${agodaPath}.`] };
    return loadAgodaRows(candidate);
  }

  if (/\.zip$/i.test(agodaPath)) {
    try {
      const result = await buildAgodaIndexFromZip(agodaPath);
      return {
        status: 'parsed-zip-csv-stream',
        rows: [],
        index: result.index,
        notes: [`Stream-parsed ${result.rowCount} Agoda CSV rows from ZIP entry ${result.csvEntry}. Raw feed was not extracted or stored in the repo.`]
      };
    } catch (error) {
      return {
        status: 'zip-parse-error',
        rows: [],
        notes: [`ZIP input was detected but could not be parsed safely: ${error.message}`]
      };
    }
  }

  try {
    if (/\.csv$/i.test(agodaPath)) {
      return { status: 'parsed-csv', rows: parseCsv(fs.readFileSync(agodaPath, 'utf8')), notes: [`Parsed Agoda CSV: ${agodaPath}`] };
    }
    if (/\.jsonl$/i.test(agodaPath)) {
      const rows = fs.readFileSync(agodaPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));
      return { status: 'parsed-jsonl', rows, notes: [`Parsed Agoda JSONL: ${agodaPath}`] };
    }
    if (/\.json$/i.test(agodaPath)) {
      const data = readJson(agodaPath);
      return { status: 'parsed-json', rows: Array.isArray(data) ? data : Object.values(data), notes: [`Parsed Agoda JSON: ${agodaPath}`] };
    }
  } catch (error) {
    return { status: 'parse-error', rows: [], notes: [`Could not parse Agoda feed: ${error.message}`] };
  }

  return { status: 'unsupported-file', rows: [], notes: [`Unsupported Agoda file type: ${agodaPath}`] };
}

function buildAgodaIndex(rows) {
  const grouped = new Map();
  for (const row of rows) {
    addAgodaRowToIndex(grouped, row);
  }
  return grouped;
}

function addAgodaRowToIndex(grouped, row) {
  const city = firstPresent(row, ['city_name', 'CityName', 'city', 'City', 'destination_city', 'DestinationCity']);
  const country = firstPresent(row, ['country_code', 'CountryCode', 'countryisocode', 'CountryISOCode', 'country', 'Country', 'country_name', 'CountryName']);
  if (!city || !country) return;
  const cityId = firstPresent(row, ['city_id', 'CityId', 'agodaCityId', 'AgodaCityId', 'agoda_city_id', 'cityid']);
  const hotelId = firstPresent(row, ['hotel_id', 'HotelId', 'hotelId', 'hotelid']);
  const hotelName = firstPresent(row, ['hotel_name', 'HotelName', 'hotelName', 'name', 'Name']);
  const state = firstPresent(row, ['state', 'State', 'province', 'Province', 'region', 'Region']);
  const lat = Number(firstPresent(row, ['latitude', 'Latitude', 'lat', 'Lat']));
  const lon = Number(firstPresent(row, ['longitude', 'Longitude', 'lng', 'lon', 'Lon']));
  const countryCode = normalizeCountry(country);
  const cityVariants = unique([
    city,
    stripCityQualifiers(city)
  ]);
  const keys = unique(cityVariants.map(value => agodaKey(value, countryCode)));
  for (const key of keys) {
    if (!grouped.has(key)) {
      grouped.set(key, {
        cityName: stripCityQualifiers(city) || String(city).trim(),
        countryCode,
        cityIds: new Map(),
        coordinates: [],
        cityIdDetails: new Map()
      });
    }
    const item = grouped.get(key);
    const idKey = cityId || 'unknown-city-id';
    if (!item.cityIds.has(idKey)) item.cityIds.set(idKey, new Set());
    if (!item.cityIdDetails.has(idKey)) {
      item.cityIdDetails.set(idKey, {
        cityId: cityId || null,
        cityNames: new Set(),
        states: new Set(),
        hotelIds: new Set(),
        sampleHotels: [],
        coordinates: []
      });
    }
    const detail = item.cityIdDetails.get(idKey);
    detail.cityNames.add(String(city).trim());
    if (state) detail.states.add(String(state).trim());
    if (hotelId) {
      item.cityIds.get(idKey).add(String(hotelId));
      detail.hotelIds.add(String(hotelId));
    }
    if (hotelName && detail.sampleHotels.length < 5) detail.sampleHotels.push(String(hotelName).trim());
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      item.coordinates.push({ lat, lon });
      if (detail.coordinates.length < 100) detail.coordinates.push({ lat, lon });
    }
  }
}

function findAgodaMatch(record, agodaIndex, agodaStatus) {
  if (!agodaIndex || !agodaIndex.size) {
    return {
      agodaCityId: null,
      agodaHotelCount: null,
      agodaCoverage: 'needs-review',
      agodaConfidence: 'needs-agoda-feed-review',
      agodaNotes: agodaStatus.notes
    };
  }

  const searchValues = unique([record.displayCity, stripCityQualifiers(record.displayCity), ...(record.aliases || [])]);
  const regionTokens = stateTokens(record.region);
  const candidates = searchValues
    .flatMap(value => [value, stripCityQualifiers(value)])
    .map(value => agodaKey(value, record.countryCode))
    .filter(key => agodaIndex.has(key))
    .map(key => agodaIndex.get(key));

  if (!candidates.length) {
    return {
      agodaCityId: null,
      agodaHotelCount: null,
      agodaCoverage: 'missing',
      agodaConfidence: 'missing',
      agodaNotes: ['No Agoda city/country match found in provided feed data.']
    };
  }

  const byId = new Map();
  for (const candidate of candidates) {
    for (const [cityId, hotelIds] of candidate.cityIds.entries()) {
      if (!byId.has(cityId)) byId.set(cityId, new Set());
      hotelIds.forEach(id => byId.get(cityId).add(id));
    }
  }
  const detailsById = new Map();
  for (const candidate of candidates) {
    if (!candidate.cityIdDetails) continue;
    for (const [cityId, detail] of candidate.cityIdDetails.entries()) {
      if (!detailsById.has(cityId)) {
        detailsById.set(cityId, {
          cityId: detail.cityId,
          cityNames: new Set(),
          states: new Set(),
          hotelIds: new Set(),
          sampleHotels: [],
          coordinates: []
        });
      }
      const merged = detailsById.get(cityId);
      detail.cityNames.forEach(value => merged.cityNames.add(value));
      detail.states.forEach(value => merged.states.add(value));
      detail.hotelIds.forEach(value => merged.hotelIds.add(value));
      detail.sampleHotels.forEach(value => {
        if (merged.sampleHotels.length < 5 && !merged.sampleHotels.includes(value)) merged.sampleHotels.push(value);
      });
      detail.coordinates.forEach(value => {
        if (merged.coordinates.length < 100) merged.coordinates.push(value);
      });
    }
  }
  const candidateSummaries = [...detailsById.entries()]
    .filter(([cityId]) => cityId !== 'unknown-city-id')
    .map(([cityId, detail]) => {
      const centroid = detail.coordinates.length
        ? {
            lat: detail.coordinates.reduce((sum, coord) => sum + coord.lat, 0) / detail.coordinates.length,
            lon: detail.coordinates.reduce((sum, coord) => sum + coord.lon, 0) / detail.coordinates.length
          }
        : null;
      const distance = distanceKm({ lat: record.latitude, lon: record.longitude }, centroid);
      const stateMatches = [...detail.states].some(state => regionTokens.includes(normalizeText(state)) || regionTokens.includes(normalizeText(STATE_ABBREVIATIONS[state])));
      return {
        cityId,
        cityNames: [...detail.cityNames],
        states: [...detail.states],
        hotelCount: detail.hotelIds.size,
        sampleHotels: detail.sampleHotels,
        coordinateDistanceKm: distance,
        stateMatches
      };
    })
    .sort((a, b) => {
      if (b.stateMatches !== a.stateMatches) return Number(b.stateMatches) - Number(a.stateMatches);
      if ((a.coordinateDistanceKm ?? Infinity) !== (b.coordinateDistanceKm ?? Infinity)) return (a.coordinateDistanceKm ?? Infinity) - (b.coordinateDistanceKm ?? Infinity);
      return b.hotelCount - a.hotelCount;
    });
  const ids = candidateSummaries.map(candidate => candidate.cityId);
  if (ids.length !== 1) {
    const safeCoordinateCandidate = candidateSummaries.find(candidate => candidate.coordinateDistanceKm !== null && candidate.coordinateDistanceKm <= 35 && (candidate.stateMatches || regionTokens.length === 0));
    const otherCloseCandidates = candidateSummaries.filter(candidate => candidate.cityId !== (safeCoordinateCandidate && safeCoordinateCandidate.cityId) && candidate.coordinateDistanceKm !== null && candidate.coordinateDistanceKm <= 35);
    if (safeCoordinateCandidate && otherCloseCandidates.length === 0) {
      return formatAgodaMatch(safeCoordinateCandidate, 'coordinate-match', 'Matched by normalized city/country plus coordinate/state disambiguation.');
    }
    return {
      agodaCityId: ids[0] || null,
      agodaHotelCount: ids[0] ? candidateSummaries[0].hotelCount : null,
      agodaCoverage: 'needs-review',
      agodaConfidence: 'ambiguous',
      agodaCandidates: candidateSummaries,
      agodaNotes: [`Agoda match has ${ids.length || 'unknown'} possible city IDs; review candidates before applying.`]
    };
  }

  return formatAgodaMatch(candidateSummaries[0], 'derived-match', 'Matched normalized city/alias and country in provided Agoda feed data.');
}

function coverageFromHotelCount(hotelCount) {
  if (hotelCount >= 100) return 'strong';
  if (hotelCount >= 25) return 'partial';
  return 'weak';
}

function formatAgodaMatch(candidate, confidence, note) {
  return {
    agodaCityId: candidate.cityId,
    agodaHotelCount: candidate.hotelCount,
    agodaCoverage: coverageFromHotelCount(candidate.hotelCount),
    agodaConfidence: confidence,
    agodaCandidates: [candidate],
    agodaNotes: [note]
  };
}

function classifyTravelpayouts(record, cityMatch, primaryAirportMatch, sameNameCities, cityAirports) {
  if (!cityMatch && !primaryAirportMatch) return 'missing';
  if (!cityMatch || !primaryAirportMatch) return 'needs-review';
  if (cityMatch.country_code !== record.countryCode || primaryAirportMatch.country_code !== record.countryCode) return 'needs-review';
  if (cityMatch.has_flightable_airport !== true) return 'confirmed-with-warning';
  if (primaryAirportMatch.iata_type !== 'airport' || primaryAirportMatch.flightable !== true) return 'confirmed-with-warning';
  const sameNameRisk = sameNameCities.some(city => city.country_code !== record.countryCode);
  const extraFlightableAirports = cityAirports
    .filter(airport => airport.iata_type === 'airport' && airport.flightable === true && airport.code !== record.primaryAirportCode)
    .map(airport => airport.code);
  if (sameNameRisk || extraFlightableAirports.length || METRO_REVIEW_CODES.has(record.travelpayoutsCityCode)) return 'confirmed-with-warning';
  return 'confirmed';
}

function validateRecord(record, cities, airports, agodaIndex, agodaStatus) {
  const errors = [];
  const warnings = [];
  const aliases = Array.isArray(record.aliases) ? record.aliases : [];
  const normalizedAliases = [record.displayCity, ...(record.aliases || []), ...(record.normalizedSearchNames || [])].map(normalizeText);
  const cityCode = record.travelpayoutsCityCode;
  const primaryAirportCode = record.primaryAirportCode || (record.travelpayoutsAirportCodes || [])[0];
  const cityByCode = cities.find(city => city.code === cityCode && city.country_code === record.countryCode);
  const sameNameCities = cities.filter(city => normalizeText(city.name) === normalizeText(record.displayCity));
  const aliasNameCities = cities.filter(city => normalizedAliases.includes(normalizeText(city.name)) && city.country_code === record.countryCode);
  const cityMatch = cityByCode || aliasNameCities.find(city => city.code === cityCode);
  const cityAirports = airports.filter(airport => airport.city_code === cityCode && airport.country_code === record.countryCode);
  const primaryAirportMatch = airports.find(airport => airport.code === primaryAirportCode && airport.city_code === cityCode && airport.country_code === record.countryCode);
  const tpStatus = classifyTravelpayouts(record, cityMatch, primaryAirportMatch, sameNameCities, cityAirports);
  const missingFields = REQUIRED_FIELDS.filter(field => {
    const value = record[field];
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  });

  if (missingFields.length) warnings.push(`Missing or blank intake fields: ${missingFields.join(', ')}`);
  if (typeof record.latitude !== 'number' || record.latitude < -90 || record.latitude > 90) errors.push('Invalid latitude.');
  if (typeof record.longitude !== 'number' || record.longitude < -180 || record.longitude > 180) errors.push('Invalid longitude.');
  if (!VALID_CURRENCIES.has(record.currency)) warnings.push(`Currency ${record.currency || 'missing'} needs review.`);
  if (!aliases.length) warnings.push('Aliases are missing.');
  if (HISTORICAL_HOLD_BACK_IDS.has(record.globevoyCityId)) errors.push('Hold-back city is included without intentional review status.');
  if (record.frontendFallbackEligible !== true) warnings.push('Frontend fallback eligibility is not true.');
  if (String(record.productionStatus || '').toLowerCase() === 'live' || String(record.productionStatus || '').toLowerCase() === 'ready') {
    errors.push(`Production status should remain review-only, found ${record.productionStatus}.`);
  }
  if (!cityMatch) errors.push('Travelpayouts city code not found with matching country.');
  if (cityMatch && cityMatch.has_flightable_airport !== true) warnings.push('Travelpayouts city has_flightable_airport is not true.');
  if (!primaryAirportMatch) errors.push('Primary airport code not found with matching city_code and country.');
  if (primaryAirportMatch && primaryAirportMatch.iata_type !== 'airport') warnings.push(`Primary airport iata_type is ${primaryAirportMatch.iata_type}.`);
  if (primaryAirportMatch && primaryAirportMatch.flightable !== true) warnings.push('Primary airport flightable is not true.');
  if (METRO_REVIEW_CODES.has(cityCode)) warnings.push(`Metro-code review needed for ${cityCode}.`);

  const extraFlightableAirportCodes = cityAirports
    .filter(airport => airport.iata_type === 'airport' && airport.flightable === true && airport.code !== primaryAirportCode)
    .map(airport => airport.code);
  const sameNameRisks = sameNameCities
    .filter(city => city.country_code !== record.countryCode || city.code !== cityCode)
    .map(city => `${city.name}:${city.country_code}:${city.code}`);
  if (extraFlightableAirportCodes.length) warnings.push(`Additional flightable associated airport codes: ${unique(extraFlightableAirportCodes).join(', ')}.`);
  if (sameNameRisks.length) warnings.push(`Same-name city records exist: ${unique(sameNameRisks).join('; ')}.`);

  const coordinateDistanceKm = cityMatch
    ? distanceKm({ lat: record.latitude, lon: record.longitude }, cityMatch.coordinates)
    : null;
  if (coordinateDistanceKm !== null && coordinateDistanceKm > 25) {
    warnings.push(`Provider city coordinate is ${coordinateDistanceKm} km from registry coordinate; keep display coordinate reviewed.`);
  }

  const agoda = findAgodaMatch(record, agodaIndex, agodaStatus);
  const pricingNeedsReview = [
    'fallbackFlightUsd',
    'fallbackNightlyUsd',
    'dailySpendUsd',
    'activitiesLocalUsd'
  ].some(field => record[field] === undefined || record[field] === null || Number(record[field]) <= 0);
  const estimateReviewStatus = pricingNeedsReview ? 'needs-review' : 'provisional-needs-product-approval';
  const classification = errors.length
    ? 'reject-or-defer'
    : tpStatus === 'confirmed' && agoda.agodaConfidence !== 'missing' && agoda.agodaConfidence !== 'needs-agoda-feed-review'
      ? 'confirmed-with-warning'
      : tpStatus;

  return {
    globevoyCityId: record.globevoyCityId,
    displayCity: record.displayCity,
    country: record.country,
    countryCode: record.countryCode,
    region: record.region || null,
    currency: record.currency,
    latitude: record.latitude,
    longitude: record.longitude,
    travelpayoutsCityCode: cityCode,
    travelpayoutsClassification: classification,
    travelpayoutsStatus: tpStatus,
    travelpayoutsCityMatch: cityMatch ? {
      name: cityMatch.name,
      country_code: cityMatch.country_code,
      code: cityMatch.code,
      coordinates: cityMatch.coordinates,
      has_flightable_airport: cityMatch.has_flightable_airport
    } : null,
    primaryAirportCode,
    primaryAirportMatch: primaryAirportMatch ? {
      code: primaryAirportMatch.code,
      city_code: primaryAirportMatch.city_code,
      country_code: primaryAirportMatch.country_code,
      name: primaryAirportMatch.name,
      iata_type: primaryAirportMatch.iata_type,
      flightable: primaryAirportMatch.flightable,
      coordinates: primaryAirportMatch.coordinates
    } : null,
    associatedAirportCodes: cityAirports.map(airport => ({
      code: airport.code,
      name: airport.name,
      iata_type: airport.iata_type,
      flightable: airport.flightable
    })),
    duplicateRiskNotes: [
      ...extraFlightableAirportCodes.map(code => `additional flightable airport ${code}`),
      ...sameNameRisks.map(risk => `same-name city ${risk}`)
    ],
    metroCodeRisk: METRO_REVIEW_CODES.has(cityCode) ? 'needs-review' : 'low',
    coordinateDistanceKmFromRegistryToProviderCity: coordinateDistanceKm,
    coordinateReviewStatus: coordinateDistanceKm === null ? 'needs-review' : coordinateDistanceKm > 25 ? 'review-provider-coordinate-vs-display-city-center' : 'ok',
    agodaCityId: agoda.agodaCityId,
    agodaHotelCount: agoda.agodaHotelCount,
    agodaCoverage: agoda.agodaCoverage,
    agodaConfidence: agoda.agodaConfidence,
    agodaCandidates: agoda.agodaCandidates || [],
    agodaNotes: agoda.agodaNotes,
    estimateReviewStatus,
    frontendFallbackEligible: record.frontendFallbackEligible === true,
    productionStatus: 'non-production-product-review-only',
    readyForProductProviderReview: !errors.length,
    readyForProduction: false,
    recommendedDecision: errors.length ? 'reject-or-defer-until-fixed' : 'keep-for-product-provider-review',
    errors,
    warnings
  };
}

function duplicateValues(records, selector) {
  const seen = new Map();
  const duplicates = [];
  for (const record of records) {
    const values = Array.isArray(selector(record)) ? selector(record) : [selector(record)];
    for (const value of values) {
      if (value === null || value === undefined || String(value).trim() === '') continue;
      const key = String(value).toLowerCase();
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(record.globevoyCityId || record.displayCity);
    }
  }
  for (const [value, ids] of seen.entries()) {
    const uniqueIds = unique(ids);
    if (uniqueIds.length > 1) duplicates.push({ value, ids: uniqueIds });
  }
  return duplicates;
}

function buildSummary(records, agodaStatus) {
  return {
    totalRecords: records.length,
    travelpayoutsConfirmedCount: records.filter(r => ['confirmed', 'confirmed-with-warning'].includes(r.travelpayoutsStatus)).length,
    travelpayoutsCleanConfirmedCount: records.filter(r => r.travelpayoutsStatus === 'confirmed').length,
    travelpayoutsNeedsReviewCount: records.filter(r => ['needs-review', 'missing'].includes(r.travelpayoutsStatus)).length,
    agodaConfirmedCount: records.filter(r => ['confirmed', 'derived-match', 'coordinate-match'].includes(r.agodaConfidence)).length,
    agodaNeedsReviewCount: records.filter(r => !['confirmed', 'derived-match', 'coordinate-match'].includes(r.agodaConfidence)).length,
    pricingNeedsReviewCount: records.filter(r => r.estimateReviewStatus !== 'provisional-needs-product-approval').length,
    provisionalPricingCount: records.filter(r => r.estimateReviewStatus === 'provisional-needs-product-approval').length,
    rejectOrDeferCount: records.filter(r => r.recommendedDecision === 'reject-or-defer-until-fixed').length,
    readyForProductProviderReviewCount: records.filter(r => r.readyForProductProviderReview).length,
    readyForProductionCount: records.filter(r => r.readyForProduction).length,
    agodaInputStatus: agodaStatus.status,
    duplicateGlobevoyIds: duplicateValues(records, r => r.globevoyCityId),
    duplicateAliases: duplicateValues(records, r => [r.displayCity, ...(r.aliases || [])]),
    duplicateTravelpayoutsCodes: duplicateValues(records, r => r.travelpayoutsCityCode),
    duplicateAgodaIds: duplicateValues(records, r => r.agodaCityId)
  };
}

function outputStem(intakePath) {
  const baseName = path.basename(intakePath, '.json');
  return path.join(ROOT, 'release', `${baseName}-provider-validation.scripted`);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeCsv(filePath, records) {
  const headers = [
    'globevoyCityId',
    'displayCity',
    'country',
    'countryCode',
    'currency',
    'travelpayoutsCityCode',
    'travelpayoutsStatus',
    'primaryAirportCode',
    'primaryAirportName',
    'primaryAirportFlightable',
    'metroCodeRisk',
    'coordinateDistanceKm',
    'coordinateReviewStatus',
    'agodaCityId',
    'agodaHotelCount',
    'agodaCoverage',
    'agodaConfidence',
    'estimateReviewStatus',
    'frontendFallbackEligible',
    'readyForProductProviderReview',
    'readyForProduction',
    'recommendedDecision',
    'errors',
    'warnings'
  ];
  const lines = [headers.join(',')];
  for (const record of records) {
    const row = {
      globevoyCityId: record.globevoyCityId,
      displayCity: record.displayCity,
      country: record.country,
      countryCode: record.countryCode,
      currency: record.currency,
      travelpayoutsCityCode: record.travelpayoutsCityCode,
      travelpayoutsStatus: record.travelpayoutsStatus,
      primaryAirportCode: record.primaryAirportCode,
      primaryAirportName: record.primaryAirportMatch && record.primaryAirportMatch.name,
      primaryAirportFlightable: record.primaryAirportMatch && record.primaryAirportMatch.flightable,
      metroCodeRisk: record.metroCodeRisk,
      coordinateDistanceKm: record.coordinateDistanceKmFromRegistryToProviderCity,
      coordinateReviewStatus: record.coordinateReviewStatus,
      agodaCityId: record.agodaCityId,
      agodaHotelCount: record.agodaHotelCount,
      agodaCoverage: record.agodaCoverage,
      agodaConfidence: record.agodaConfidence,
      estimateReviewStatus: record.estimateReviewStatus,
      frontendFallbackEligible: record.frontendFallbackEligible,
      readyForProductProviderReview: record.readyForProductProviderReview,
      readyForProduction: record.readyForProduction,
      recommendedDecision: record.recommendedDecision,
      errors: record.errors,
      warnings: record.warnings
    };
    lines.push(headers.map(header => csvCell(row[header])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function writeMarkdown(filePath, output) {
  const records = output.records;
  const summary = output.summary;
  let md = '# Globevoy City Intake Provider Validation - Scripted Report\n\n';
  md += `Status: ${output.status}  \n`;
  md += `Created: ${output.createdAt}  \n`;
  md += `Intake: ${output.inputPaths.intakeJson}  \n`;
  md += `Travelpayouts cities: ${output.inputPaths.travelpayoutsCitiesJson}  \n`;
  md += `Travelpayouts airports: ${output.inputPaths.travelpayoutsAirportsJson}  \n`;
  md += `Agoda input: ${output.inputPaths.agodaFeed || 'not provided'}\n\n`;
  md += '## Summary\n\n';
  md += `- Total records checked: ${summary.totalRecords}\n`;
  md += `- Travelpayouts confirmed or confirmed-with-warning: ${summary.travelpayoutsConfirmedCount}\n`;
  md += `- Travelpayouts clean confirmed: ${summary.travelpayoutsCleanConfirmedCount}\n`;
  md += `- Travelpayouts needs-review/missing: ${summary.travelpayoutsNeedsReviewCount}\n`;
  md += `- Agoda confirmed: ${summary.agodaConfirmedCount}\n`;
  md += `- Agoda needs-review: ${summary.agodaNeedsReviewCount}\n`;
  md += `- Pricing provisional or needs review: ${summary.provisionalPricingCount + summary.pricingNeedsReviewCount}\n`;
  md += `- Reject/defer count: ${summary.rejectOrDeferCount}\n`;
  md += `- Ready for product/provider review: ${summary.readyForProductProviderReviewCount}\n`;
  md += `- Ready for production: ${summary.readyForProductionCount}\n\n`;
  md += '## City-by-City Table\n\n';
  md += '| City | Country | Code | Travelpayouts | Primary Airport | Agoda | Estimate | Decision |\n';
  md += '|---|---|---:|---|---|---|---|---|\n';
  for (const record of records) {
    md += `| ${record.displayCity} | ${record.country} | ${record.travelpayoutsCityCode} | ${record.travelpayoutsStatus} | ${record.primaryAirportMatch ? record.primaryAirportMatch.name : 'missing'} | ${record.agodaConfidence} | ${record.estimateReviewStatus} | ${record.recommendedDecision} |\n`;
  }
  md += '\n## Blockers\n\n';
  const blockers = records.flatMap(record => record.errors.map(error => `${record.displayCity}: ${error}`));
  if (blockers.length) blockers.forEach(blocker => { md += `- ${blocker}\n`; });
  else md += '- No blocking Travelpayouts/static-code errors found in this run.\n';
  if (summary.agodaNeedsReviewCount) md += `- Agoda remains needs-review for ${summary.agodaNeedsReviewCount} records.\n`;
  if (summary.provisionalPricingCount) md += `- Product approval is still required for provisional fallback estimates on ${summary.provisionalPricingCount} records.\n`;
  md += '\n## Next Recommended Action\n\n';
  md += 'Use this script for future intake batches, then add a compact derived Agoda candidate input once Agoda feed matching is reviewed. Keep all generated outputs as review artifacts until product/provider sign-off is complete.\n';
  fs.writeFileSync(filePath, md);
}

function writeNotes(filePath) {
  const md = `# Globevoy City Intake Provider Validation Script Notes

Status: non-production script notes

## Purpose

The script validates non-production city intake batches without wiring anything into production. It checks Travelpayouts/Aviasales static city and airport identity, optional Agoda-derived matching, intake quality, duplicates, coordinate sanity, currencies, hold-back exclusion, and frontend fallback eligibility.

## Usage

\`\`\`bash
node scripts/validate-100-city-intake-providers.js path/to/intake.json path/to/cities.json path/to/airports.json
\`\`\`

Optional Agoda CSV/JSON/ZIP input:

\`\`\`bash
node scripts/validate-100-city-intake-providers.js path/to/intake.json path/to/cities.json path/to/airports.json path/to/agoda-derived.csv
node scripts/validate-100-city-intake-providers.js path/to/intake.json path/to/cities.json path/to/airports.json path/to/agoda-feed.zip
\`\`\`

## Agoda Input Policy

The script can parse compact CSV, JSON, JSONL, or ZIP inputs. ZIP files are stream-parsed with \`tar -xOf\`; the raw feed is not extracted into the repo and is not stored in release artifacts.

## Outputs

For an intake file named \`release/example.json\`, the script writes:

- \`release/example-provider-validation.scripted.json\`
- \`release/example-provider-validation.scripted.csv\`
- \`release/example-provider-validation.scripted.md\`

These outputs are review artifacts only and must not be imported by runtime frontend or backend code.
`;
  fs.writeFileSync(filePath, md);
}

async function run() {
  const [, , intakeArg, citiesArg, airportsArg, agodaArg] = process.argv;
  if (!intakeArg || !citiesArg || !airportsArg) {
    usage();
    process.exit(1);
  }

  const intakePath = resolveInput(intakeArg);
  const citiesPath = resolveInput(citiesArg);
  const airportsPath = resolveInput(airportsArg);
  if (!fs.existsSync(intakePath)) throw new Error(`Intake JSON not found: ${intakePath}`);
  if (!fs.existsSync(citiesPath)) throw new Error(`Travelpayouts cities JSON not found: ${citiesPath}`);
  if (!fs.existsSync(airportsPath)) throw new Error(`Travelpayouts airports JSON not found: ${airportsPath}`);

  const intake = readJson(intakePath);
  const records = ensureArray(intake, 'intake JSON');
  const cities = ensureArray(readJson(citiesPath), 'cities JSON');
  const airports = ensureArray(readJson(airportsPath), 'airports JSON');
  const agodaStatus = await loadAgodaRows(agodaArg);
  const agodaIndex = agodaStatus.index || buildAgodaIndex(agodaStatus.rows);
  const validatedRecords = records.map(record => validateRecord(record, cities, airports, agodaIndex, agodaStatus));
  const summary = buildSummary(validatedRecords, agodaStatus);
  const output = {
    artifact: 'city-registry-intake-provider-validation-scripted',
    status: 'non-production-review-artifact',
    createdAt: new Date().toISOString(),
    inputPaths: {
      intakeJson: intakePath,
      travelpayoutsCitiesJson: citiesPath,
      travelpayoutsAirportsJson: airportsPath,
      agodaFeed: agodaArg ? resolveInput(agodaArg) : null
    },
    agodaInput: {
      status: agodaStatus.status,
      notes: agodaStatus.notes
    },
    summary,
    records: validatedRecords
  };

  const stem = outputStem(intakePath);
  const jsonPath = `${stem}.json`;
  const csvPath = `${stem}.csv`;
  const mdPath = `${stem}.md`;
  writeJson(jsonPath, output);
  writeCsv(csvPath, validatedRecords);
  writeMarkdown(mdPath, output);
  writeNotes(path.join(ROOT, 'release', 'city-registry-100-intake-provider-validation-script-notes.md'));

  console.log('Globevoy city intake provider validation');
  console.log(`Records checked: ${summary.totalRecords}`);
  console.log(`Travelpayouts confirmed or confirmed-with-warning: ${summary.travelpayoutsConfirmedCount}`);
  console.log(`Agoda confirmed: ${summary.agodaConfirmedCount}`);
  console.log(`Agoda needs-review: ${summary.agodaNeedsReviewCount}`);
  console.log(`Reject/defer: ${summary.rejectOrDeferCount}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Markdown: ${mdPath}`);
  if (summary.rejectOrDeferCount) process.exit(2);
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
