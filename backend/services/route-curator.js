'use strict';

// GV-AI-662A: optional LLM-assisted route curator.
// The LLM is only allowed to rank already-valid backend candidates.
// It must not invent prices, dates, airports, hotels, or new cities.

const http = require('http');
const https = require('https');

function truthy(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function llmCuratorEnabled() {
  return truthy(process.env.ENABLE_LLM_ROUTE_CURATOR_662A || process.env.GV_LLM_ROUTE_CURATOR_ENABLED || '');
}

function deterministicCuratorEnabled() {
  const explicit = String(process.env.ENABLE_DETERMINISTIC_ROUTE_CURATOR_662A || '').trim().toLowerCase();
  if (explicit) return explicit === 'true';
  return true;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normaliseText(value) {
  return String(value || '').trim();
}

function cityName(node) {
  return normaliseText(node?.city || node?.name || node?.displayName || node?.cityName);
}

function countryName(node) {
  return normaliseText(node?.country || node?.countryName || node?.countryCode);
}

function tourId(tour, index = 0) {
  const explicit = normaliseText(tour?.tourId || tour?.id || tour?.routeId);
  if (explicit) return explicit;
  const origin = cityName(tour?.origin) || 'origin';
  const stops = Array.isArray(tour?.stops) ? tour.stops.map(cityName).filter(Boolean).join('-') : 'route';
  return `${origin}-${stops || 'route'}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function countryDiversity(tour = {}) {
  const originCountry = countryName(tour.origin).toLowerCase();
  const stopCountries = new Set((Array.isArray(tour.stops) ? tour.stops : [])
    .map((stop) => countryName(stop).toLowerCase())
    .filter(Boolean));
  const outsideOrigin = (Array.isArray(tour.stops) ? tour.stops : [])
    .filter((stop) => {
      const c = countryName(stop).toLowerCase();
      return c && originCountry && c !== originCountry;
    }).length;
  return { countryCount: stopCountries.size, outsideOrigin };
}

function estimateUsd(tour = {}) {
  return safeNumber(tour.estimatedTotalUsd || tour.totalEstimateUsd || tour.totalUsd || tour.estimatedTotal || 0, 0);
}

function stopCount(tour = {}) {
  return Array.isArray(tour.stops) ? tour.stops.length : 0;
}

function providerEvidenceCount(tour = {}) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  return legs.filter((leg) => leg?.providerBacked || leg?.liveFareVerified || String(leg?.dateSource || '').includes('provider')).length;
}

function tripNights(tour = {}, query = {}) {
  const explicit = safeNumber(query.totalNights || query.nights || query.tripNights || 0, 0);
  if (explicit > 0) return Math.round(explicit);
  const tourTotal = safeNumber(tour.totalNights, 0);
  if (tourTotal > 0) return Math.round(tourTotal);
  return (Array.isArray(tour.stops) ? tour.stops : []).reduce((sum, stop) => sum + safeNumber(stop?.nights, 0), 0) || 6;
}

function estimatedTravelHours(tour = {}) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  return legs.reduce((sum, leg) => {
    const explicit = safeNumber(leg?.estimatedDoorToDoorHours || leg?.travelHours, 0);
    if (explicit > 0) return sum + explicit;
    let minutes = safeNumber(leg?.durationMinutes || leg?.duration, 0);
    if (minutes > 2500 && minutes < 200000) minutes /= 60;
    if (minutes > 0) return sum + minutes / 60 + 3.5;
    const distance = safeNumber(leg?.distanceKm, 0);
    const mode = `${String(leg?.mode || '')} ${String(leg?.transportType || '')}`.toLowerCase();
    const segments = Array.isArray(leg?.segments) ? leg.segments : [];
    const hasFlight = mode.includes('flight') || segments.some(segment => `${String(segment?.mode || '')} ${String(segment?.transportType || '')}`.toLowerCase().includes('flight'));
    if (!hasFlight && (mode.includes('ground') || mode.includes('rail') || mode.includes('bus'))) return sum + Math.max(1, distance / 72 + 0.9);
    return sum + Math.max(4.3, distance / 790 + 3.85);
  }, 0);
}

function comfortScore(tour = {}, query = {}) {
  const nights = tripNights(tour, query);
  const stops = stopCount(tour);
  const travelHours = estimatedTravelHours(tour);
  const travelRatio = travelHours / Math.max(24, nights * 24);
  const stopNights = Array.isArray(tour.stops) ? tour.stops.map(stop => safeNumber(stop?.nights, 0)) : [];
  let score = 120;
  if (nights <= 6) score += stops === 1 ? 70 : stops === 2 ? 55 : -240;
  else if (nights <= 10) score += stops === 2 ? 70 : stops === 3 ? 50 : stops === 1 ? 30 : -180;
  else score += stops <= 3 ? 55 : -80;
  if (stopNights.some(value => value < 2)) score -= 500;
  score -= Math.max(0, travelRatio - 0.18) * 900;
  if (nights <= 5 && travelHours > 22) score -= 260;
  const confidence = tour.routeConfidence || {};
  score += Math.min(140, safeNumber(confidence.providerDiscoveredLegCount, providerEvidenceCount(tour)) * 55);
  if (confidence.level === 'provider-informed') score += 45;
  return score;
}

// GV-AI-662B: route common-sense guardrails. These are deliberately
// conservative: they never create data, they only rank already-valid
// backend candidates so the chosen route feels more like a real trip.
function roughCadBudget(query = {}) {
  const budget = safeNumber(query.budget || query.totalBudget || 0, 0);
  const currency = String(query.currency || 'CAD').toUpperCase();
  if (currency === 'USD') return budget * 1.35;
  if (currency === 'GBP') return budget * 1.72;
  if (currency === 'EUR') return budget * 1.47;
  if (currency === 'AUD') return budget * 0.9;
  return budget;
}

function regionForCountry(country = '') {
  const c = String(country || '').trim().toLowerCase();
  if (!c) return 'unknown';
  if (['canada', 'united states', 'mexico'].includes(c)) return 'north-america';
  if (['belize', 'guatemala', 'costa rica', 'panama', 'colombia', 'peru', 'ecuador', 'cuba', 'dominican republic', 'jamaica'].includes(c)) return 'latin-america-caribbean';
  if (['united kingdom', 'ireland', 'france', 'spain', 'portugal', 'italy', 'germany', 'netherlands', 'belgium', 'austria', 'switzerland', 'czech republic', 'poland', 'hungary', 'greece'].includes(c)) return 'europe';
  if (['egypt', 'morocco', 'tunisia', 'turkey', 'georgia', 'armenia', 'azerbaijan', 'united arab emirates', 'oman', 'qatar', 'jordan', 'lebanon'].includes(c)) return 'mena-caucasus';
  if (['thailand', 'vietnam', 'malaysia', 'singapore', 'indonesia', 'philippines', 'japan', 'south korea', 'taiwan', 'china', 'india', 'sri lanka', 'nepal'].includes(c)) return 'asia';
  return 'other';
}

function routeRegions(tour = {}) {
  const originRegion = regionForCountry(countryName(tour.origin));
  const stopRegions = (Array.isArray(tour.stops) ? tour.stops : []).map((stop) => regionForCountry(countryName(stop))).filter(Boolean);
  return { originRegion, stopRegions, uniqueStopRegions: new Set(stopRegions) };
}

function cityLower(stop = {}) {
  return cityName(stop).toLowerCase();
}

function containsCity(tour = {}, patterns = []) {
  const cities = (Array.isArray(tour.stops) ? tour.stops : []).map(cityLower);
  return patterns.some((p) => cities.some((c) => c.includes(p)));
}

function routeTheme(tour = {}, query = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const countries = stops.map((s) => countryName(s).toLowerCase());
  const cities = stops.map(cityLower);
  const regions = routeRegions(tour);
  const outside = countryDiversity(tour).outsideOrigin;
  if (countries.includes('mexico') && (countries.includes('costa rica') || countries.includes('panama') || countries.includes('belize') || countries.includes('guatemala'))) return 'Latin America discovery route';
  if (countries.includes('panama') && countries.includes('colombia')) return 'Culture and coast route';
  if (countries.includes('egypt') && countries.includes('georgia')) return 'Unexpected culture route';
  if (countries.includes('oman') && countries.includes('georgia')) return 'Gulf and Caucasus route';
  if (countries.includes('united kingdom') && (countries.includes('ireland') || countries.includes('portugal') || countries.includes('spain'))) return 'European value route';
  if (cities.some((c) => c.includes('tofino')) || cities.some((c) => c.includes('seattle')) || cities.some((c) => c.includes('victoria'))) return 'Pacific coast escape';
  if (outside > 0 && regions.uniqueStopRegions.size <= 2) return 'Cross-border discovery route';
  if (outside > 0) return 'Most memorable route';
  return 'Regional value route';
}

function routeCoherenceScore(tour = {}, query = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  if (!stops.length) return 0;
  const budgetCad = roughCadBudget(query);
  const { outsideOrigin, countryCount } = countryDiversity(tour);
  const { uniqueStopRegions } = routeRegions(tour);
  const regions = Array.from(uniqueStopRegions);
  let score = 0;
  // Good Globevoy routes usually have a clear story: one region, one cross-border
  // theme, or a meaningful anchor + discovery pairing.
  if (outsideOrigin > 0) score += 120;
  if (countryCount >= 2) score += 60;
  if (regions.length === 1) score += 80;
  if (regions.length === 2) score += 35;
  if (regions.length > 2) score -= 90;
  // Medium/high budgets should not default to domestic/local-only routes.
  if (outsideOrigin === 0 && budgetCad >= 1400) score -= 240;
  if (outsideOrigin === 0 && budgetCad >= 1000) score -= 120;
  // Avoid a few combinations that are valid but feel odd as a packaged tour.
  const has = (name) => containsCity(tour, [name]);
  if (has('las vegas') && (has('victoria') || has('tofino'))) score -= 180;
  if (has('ottawa') && has('montreal') && budgetCad >= 1300) score -= 130;
  if (has('quebec') && has('boston') && budgetCad >= 1500) score -= 70;
  // Reward route stories that have worked well in tests and match the product idea.
  const theme = routeTheme(tour, query);
  if (/latin america|culture and coast|unexpected|gulf and caucasus|european|pacific coast|cross-border/i.test(theme)) score += 95;
  return score;
}

function localFallbackPenalty(tour = {}, query = {}) {
  const budgetCad = roughCadBudget(query);
  const { outsideOrigin } = countryDiversity(tour);
  if (outsideOrigin === 0 && budgetCad >= 1200) return 180;
  if (outsideOrigin === 0 && budgetCad >= 900) return 80;
  return 0;
}

function deterministicWowScore(tour = {}, query = {}) {
  const { countryCount, outsideOrigin } = countryDiversity(tour);
  const stops = stopCount(tour);
  const provider = providerEvidenceCount(tour);
  const distance = Math.max(0, safeNumber(tour.totalDistanceKm, 0));
  const role = String(tour.tourRole || tour.recommendationLabel || '').toLowerCase();
  const roleScore = role.includes('most') ? 130 : role.includes('balance') ? 110 : role.includes('cost') ? 70 : 90;
  const diversityScore = countryCount * 55 + outsideOrigin * 80;
  const nights = tripNights(tour, query);
  const idealStops = nights <= 6 ? Math.min(2, stops) : nights <= 10 ? Math.min(3, stops) : Math.min(3, stops);
  const stopScore = stops === idealStops ? 95 : Math.max(-120, 70 - Math.abs(stops - idealStops) * 90);
  const evidenceScore = Math.min(160, provider * 55);
  const distanceScore = Math.min(90, distance / 110);
  const coherenceScore = routeCoherenceScore(tour, query) + comfortScore(tour, query);
  const total = estimateUsd(tour);
  const budget = safeNumber(query.budget || query.totalBudget || 0, 0);
  const budgetFit = budget > 0 ? Math.max(0, 85 - Math.abs(0.78 - (total / budget)) * 80) : 50;
  return roleScore + diversityScore + stopScore + evidenceScore + distanceScore + coherenceScore + budgetFit - localFallbackPenalty(tour, query);
}

function summarizeCandidate(tour = {}, index = 0, query = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  return {
    id: tourId(tour, index),
    role: tour.tourRole || tour.tourRoleLabel || tour.recommendationLabel || null,
    origin: { city: cityName(tour.origin), country: countryName(tour.origin), airportCode: tour.origin?.airportCode || tour.origin?.code || null },
    stops: stops.map((stop) => ({
      city: cityName(stop),
      country: countryName(stop),
      group: stop.group || null,
      nights: stop.nights || null,
      airportCode: stop.code || (Array.isArray(stop.airportCodes) ? stop.airportCodes[0] : null)
    })),
    estimatedTotal: tour.estimatedTotal || tour.totalEstimate || null,
    estimatedTotalUsd: estimateUsd(tour) || null,
    totalDistanceKm: tour.totalDistanceKm || null,
    routeTheme: routeTheme(tour, query),
    providerEvidenceLegs: providerEvidenceCount(tour),
    deterministicWowScore: Math.round(deterministicWowScore(tour, query))
  };
}

function postJson(urlString, payload, headers = {}, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (error) {
      reject(new Error('invalid-llm-curator-endpoint'));
      return;
    }
    const body = JSON.stringify(payload);
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      },
      timeout: Math.max(500, Math.min(Number(timeoutMs) || 2500, 6000))
    }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`llm-curator-http-${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(chunks || '{}'));
        } catch (error) {
          reject(new Error('llm-curator-invalid-json'));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('llm-curator-timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function endpointHeaders() {
  const headers = {};
  const key = normaliseText(process.env.GV_LLM_ROUTE_CURATOR_API_KEY || process.env.LLM_ROUTE_CURATOR_API_KEY);
  const provider = normaliseText(process.env.GV_LLM_PROVIDER || '').toLowerCase();
  // Gemini uses x-goog-api-key. Generic/OpenAI-compatible endpoints can still use Bearer.
  if (key && provider === 'gemini') headers['x-goog-api-key'] = key;
  else if (key) headers.Authorization = `Bearer ${key}`;
  const extra = normaliseText(process.env.GV_LLM_ROUTE_CURATOR_EXTRA_HEADERS_JSON || '');
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(headers, parsed);
    } catch (_) {}
  }
  return headers;
}

function llmEndpoint() {
  const explicit = normaliseText(process.env.GV_LLM_ROUTE_CURATOR_ENDPOINT || process.env.LLM_ROUTE_CURATOR_ENDPOINT);
  if (explicit) return explicit;
  const provider = normaliseText(process.env.GV_LLM_PROVIDER || '').toLowerCase();
  const model = normaliseText(process.env.GV_LLM_ROUTE_CURATOR_MODEL || 'gemini-3.5-flash');
  if (provider === 'gemini') {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }
  return '';
}

function isGeminiProvider() {
  return normaliseText(process.env.GV_LLM_PROVIDER || '').toLowerCase() === 'gemini';
}

function buildGeminiPayload(payload) {
  return {
    contents: [{
      role: 'user',
      parts: [{ text: JSON.stringify(payload) }]
    }],
    generationConfig: {
      temperature: 0.25,
      responseMimeType: 'application/json'
    }
  };
}

function extractRankedIds(response = {}) {
  const direct = response.rankedTourIds || response.rankedIds || response.routeIds || response.selectedTourIds;
  if (Array.isArray(direct)) return direct.map(String);
  const selected = response.selectedTourId || response.selectedId || response.bestTourId;
  if (selected) return [String(selected)];
  // OpenAI-compatible chat response support: expect JSON in message.content.
  const content = response?.choices?.[0]?.message?.content || response?.choices?.[0]?.text || response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (content) {
    try {
      const parsed = JSON.parse(content);
      return extractRankedIds(parsed);
    } catch (_) {}
  }
  return [];
}

function applyRankedIds(tours = [], rankedIds = []) {
  const list = Array.isArray(tours) ? tours : [];
  const idToTour = new Map(list.map((tour, index) => [tourId(tour, index), tour]));
  const selected = [];
  for (const id of rankedIds) {
    const key = String(id || '').trim();
    if (idToTour.has(key) && !selected.includes(idToTour.get(key))) selected.push(idToTour.get(key));
  }
  const remaining = list.filter((tour) => !selected.includes(tour));
  return selected.concat(remaining);
}

async function curateCandidateTours(tours = [], query = {}) {
  const list = Array.isArray(tours) ? tours.filter(Boolean) : [];
  const diagnostics = {
    enabled: llmCuratorEnabled(),
    deterministicFallbackEnabled: deterministicCuratorEnabled(),
    candidateCount: list.length,
    model: process.env.GV_LLM_ROUTE_CURATOR_MODEL || null,
    selectedBy: 'none'
  };
  if (!list.length) return { tours: list, diagnostics };

  const deterministicSorted = deterministicCuratorEnabled()
    ? list.slice().sort((a, b) => deterministicWowScore(b, query) - deterministicWowScore(a, query))
    : list.slice();

  if (!llmCuratorEnabled()) {
    return { tours: deterministicSorted, diagnostics: { ...diagnostics, selectedBy: deterministicCuratorEnabled() ? 'deterministic-wow-curator' : 'original-order' } };
  }

  const endpoint = llmEndpoint();
  if (!endpoint) {
    return { tours: deterministicSorted, diagnostics: { ...diagnostics, selectedBy: 'deterministic-wow-curator', llmSkippedReason: 'missing-endpoint' } };
  }

  const limit = Math.max(2, Math.min(Number(process.env.GV_LLM_ROUTE_CURATOR_CANDIDATE_LIMIT || query.llmCandidateLimit || 8) || 8, 12));
  const candidates = deterministicSorted.slice(0, limit).map((tour, index) => summarizeCandidate(tour, index, query));
  const payload = {
    task: 'Rank Globevoy route candidates. Return JSON only. Pick from candidate IDs only. Do not invent cities, prices, dates, airports, or hotels.',
    constraints: [
      'Every candidate is already budget-checked by Globevoy.',
      'Prefer memorable/international value when budget allows.',
      'Prefer routes that have a clear travel story or regional theme.',
      'Prefer provider-discovered flight connectivity over purely estimated routes when comfort and budget are comparable.',
      'Prefer fewer enjoyable cities over rushed multi-stop routes; travel days and airport time reduce usable vacation time.',
      'Avoid awkward zigzag routes or city pairs that feel unrelated.',
      'Avoid boring local-only routes unless budget is low or evidence is stronger.',
      'Avoid rushed routes and respect nights shown in candidates.',
      'Provider-backed evidence is helpful but never required to override budget safety.'
    ],
    requested: {
      origin: query.origin || query.originCity || null,
      budget: query.budget || query.totalBudget || null,
      currency: query.currency || null,
      travellers: query.travellers || query.travelers || query.passengers || null
    },
    candidates,
    responseSchema: { rankedTourIds: ['candidate-id-1', 'candidate-id-2'], reason: 'short internal note' }
  };

  try {
    const outboundPayload = isGeminiProvider() ? buildGeminiPayload(payload) : payload;
    const response = await postJson(endpoint, outboundPayload, endpointHeaders(), process.env.GV_LLM_ROUTE_CURATOR_TIMEOUT_MS || 2500);
    const rankedIds = extractRankedIds(response);
    const reordered = rankedIds.length ? applyRankedIds(deterministicSorted, rankedIds) : deterministicSorted;
    return {
      tours: reordered,
      diagnostics: {
        ...diagnostics,
        selectedBy: rankedIds.length ? 'llm-route-curator' : 'deterministic-wow-curator',
        evaluatedCandidateCount: candidates.length,
        rankedTourIds: rankedIds.slice(0, 5),
        llmReturnedUsableRanking: rankedIds.length > 0
      }
    };
  } catch (error) {
    return {
      tours: deterministicSorted,
      diagnostics: {
        ...diagnostics,
        selectedBy: 'deterministic-wow-curator',
        evaluatedCandidateCount: candidates.length,
        llmError: error.message || 'llm-curator-error'
      }
    };
  }
}

module.exports = {
  llmCuratorEnabled,
  deterministicCuratorEnabled,
  deterministicWowScore,
  summarizeCandidate,
  curateCandidateTours,
  _internal: { tourId, countryDiversity, routeTheme, routeCoherenceScore, applyRankedIds, extractRankedIds }
};
