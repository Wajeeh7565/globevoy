'use strict';

// GV-REC-687B — AI-assisted diverse multi-tour selection.
// Safety boundary: AI may only choose among already-valid backend candidates.
// It never creates cities, prices, dates, airports, hotels, or booking claims.

const http = require('http');
const https = require('https');
const { deterministicWowScore, summarizeCandidate, _internal: curatorInternal } = require('./route-curator');

const VERSION = 'GV-REC-687B-P3';
const PREVIEW_ORIGIN_687B = 'https://686d-preview.dttux5e6ddtzb.amplifyapp.com';
const PRODUCTION_ORIGIN_687B = 'https://globevoy.com';
const SUPPORTED_ROLES = Object.freeze(['lowest-cost', 'best-balance', 'most-memorable', 'something-different', 'hidden-gem']);

function truthy(value) { return String(value || '').trim().toLowerCase() === 'true'; }
function enabled(query = {}) {
  // P3 production promotion: the trusted browser Origin injected by lambda.js is the gate.
  // No extra Lambda environment variable is required, avoiding the 4 KB env limit.
  return clean(query.__gvRequestOrigin687B) === PRODUCTION_ORIGIN_687B;
}
function llmEnabled(query = {}) { return enabled(query) && truthy(process.env.ENABLE_LLM_ROUTE_CURATOR_662A || process.env.GV_LLM_ROUTE_CURATOR_ENABLED || ''); }
function safeNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }

function normalizeRole(value) {
  const raw = lower(value).replace(/[_\s]+/g, '-');
  if (raw.includes('lowest') || raw === 'cost') return 'lowest-cost';
  if (raw.includes('memorable') || raw.includes('inspiring') || raw.includes('discover')) return 'most-memorable';
  if (raw.includes('different') || raw.includes('surprise') || raw.includes('wildcard')) return 'something-different';
  if (raw.includes('hidden') || raw.includes('gem') || raw.includes('under-the-radar')) return 'hidden-gem';
  if (raw.includes('balance') || raw.includes('recommended') || raw.includes('overall')) return 'best-balance';
  return SUPPORTED_ROLES.includes(raw) ? raw : 'best-balance';
}

function roleLabel(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'lowest-cost') return 'Lowest cost';
  if (normalized === 'most-memorable') return 'Most inspiring';
  if (normalized === 'something-different') return 'Something different';
  if (normalized === 'hidden-gem') return 'Hidden gem';
  return 'Best overall';
}

function stopKey(stop = {}) {
  return lower(stop.cityId || stop.id || stop.airportCode || stop.code || stop.city || stop.displayCity).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function routeStops(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : (Array.isArray(tour.cities) ? tour.cities : []);
  return stops.map(stopKey).filter(Boolean);
}

function routeKey(tour = {}) { return routeStops(tour).join('>'); }
function routeCountries(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : (Array.isArray(tour.cities) ? tour.cities : []);
  return [...new Set(stops.map(stop => lower(stop.country || stop.countryName || stop.countryCode)).filter(Boolean))];
}

function parseExcludedRouteKeys(query = {}) {
  const raw = query.diversityExcludedRoutes ?? query.excludeRouteKeys ?? query.excludedRoutes ?? '';
  let values = [];
  if (Array.isArray(raw)) values = raw;
  else if (raw && typeof raw === 'object') values = Object.values(raw);
  else {
    const text = clean(raw);
    if (!text) return [];
    if (text.startsWith('[')) {
      try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) values = parsed; } catch (_) {}
    }
    if (!values.length) values = text.split(/\|\||\n|;/g);
  }
  return [...new Set(values.map(value => lower(value)).filter(Boolean))].slice(0, 8);
}

function stopSetFromRouteKey(key = '') { return new Set(lower(key).split('>').map(part => part.trim()).filter(Boolean)); }

function overlapWithExcluded(tour = {}, excludedRouteKeys = []) {
  const current = new Set(routeStops(tour));
  if (!current.size || !excludedRouteKeys.length) return { maxCount: 0, maxRatio: 0, exact: false, sharedStops: [] };
  let maxCount = 0; let maxRatio = 0; let exact = false; let sharedStops = [];
  const currentKey = routeKey(tour);
  for (const key of excludedRouteKeys) {
    const other = stopSetFromRouteKey(key);
    const shared = [...current].filter(item => other.has(item));
    const ratio = shared.length / Math.max(1, Math.min(current.size, other.size));
    if (shared.length > maxCount || ratio > maxRatio) sharedStops = shared;
    maxCount = Math.max(maxCount, shared.length);
    maxRatio = Math.max(maxRatio, ratio);
    if (currentKey && currentKey === key) exact = true;
  }
  return { maxCount, maxRatio, exact, sharedStops };
}

function estimatedTotalUsd(tour = {}) {
  return safeNumber(tour.estimatedTotalUsd || tour.totalEstimateUsd || tour.totalUsd || tour.estimatedTotal || tour.totalEstimate || 0, 0);
}

function budgetUsd(query = {}) {
  const amount = safeNumber(query.budget || query.totalBudget || 0, 0);
  const currency = String(query.currency || 'CAD').toUpperCase();
  const toUsd = { USD: 1, CAD: 0.735, EUR: 1.087, GBP: 1.266, AUD: 0.658 };
  return amount * (toUsd[currency] || 1);
}

function hiddenGemStrength(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  return stops.reduce((sum, stop) => {
    const group = lower(stop.group || stop.cityGroup || stop.classification?.group);
    const explicit = safeNumber(stop.hiddenGemStrength || stop.hiddenGemScore || stop.classification?.hiddenGemStrength, 0);
    return sum + explicit + (group.includes('2') ? 60 : 0);
  }, 0);
}

function deterministicRoleScore(tour = {}, query = {}, roleInput = 'best-balance', excludedRouteKeys = []) {
  const role = normalizeRole(roleInput);
  const total = estimatedTotalUsd(tour);
  const budget = budgetUsd(query);
  const utilization = budget > 0 && total > 0 ? total / budget : 0.78;
  const wow = safeNumber(deterministicWowScore(tour, query), 0);
  const overlap = overlapWithExcluded(tour, excludedRouteKeys);
  const diversity = curatorInternal.countryDiversity ? curatorInternal.countryDiversity(tour) : { countryCount: routeCountries(tour).length, outsideOrigin: 0 };
  const theme = curatorInternal.routeTheme ? curatorInternal.routeTheme(tour, query) : '';
  const gem = hiddenGemStrength(tour);
  const distance = safeNumber(tour.totalDistanceKm, 0);

  if (overlap.exact) return -1e12;
  const novelty = 1 - overlap.maxRatio;
  let score = wow * 12;
  if (role === 'lowest-cost') {
    // Lowest-cost remains deterministic and literal. AI never overrides it.
    score = -total * 10000 - overlap.maxRatio * 500000 - overlap.maxCount * 10000;
  } else if (role === 'best-balance') {
    score += 1600 - Math.abs(0.78 - utilization) * 2200 + diversity.countryCount * 180 + novelty * 650;
  } else if (role === 'most-memorable') {
    score += diversity.countryCount * 520 + diversity.outsideOrigin * 300 + Math.min(700, distance / 18) + gem * 1.8 + novelty * 950;
  } else if (role === 'something-different') {
    score += novelty * 2300 - overlap.maxCount * 450 + diversity.countryCount * 300 + Math.min(450, distance / 35);
    if (/regional value/i.test(theme)) score -= 220;
  } else if (role === 'hidden-gem') {
    score += gem * 6 + novelty * 1300 + diversity.countryCount * 180;
  }
  // Strongly discourage near-duplicate portfolios for every non-cost lane.
  if (role !== 'lowest-cost') score -= overlap.maxRatio * 1800 + overlap.maxCount * 220;
  return score;
}

function endpoint() {
  const explicit = clean(process.env.GV_LLM_ROUTE_CURATOR_ENDPOINT || process.env.LLM_ROUTE_CURATOR_ENDPOINT);
  if (explicit) return explicit;
  const provider = lower(process.env.GV_LLM_PROVIDER);
  const model = clean(process.env.GV_LLM_ROUTE_CURATOR_MODEL || 'gemini-3.5-flash');
  if (provider === 'gemini') return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return '';
}

function headers() {
  const out = {};
  const key = clean(process.env.GV_LLM_ROUTE_CURATOR_API_KEY || process.env.LLM_ROUTE_CURATOR_API_KEY);
  const provider = lower(process.env.GV_LLM_PROVIDER);
  if (key && provider === 'gemini') out['x-goog-api-key'] = key;
  else if (key) out.Authorization = `Bearer ${key}`;
  return out;
}

function postJson(urlString, payload, requestHeaders = {}, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlString); } catch (_) { reject(new Error('invalid-diversity-llm-endpoint')); return; }
    const body = JSON.stringify(payload);
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.request({ protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port || undefined, path: `${parsed.pathname || '/'}${parsed.search || ''}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...requestHeaders }, timeout: Math.max(500, Math.min(Number(timeoutMs) || 2500, 6000)) }, (res) => {
      let chunks = ''; res.setEncoding('utf8'); res.on('data', chunk => { chunks += chunk; });
      res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error(`diversity-llm-http-${res.statusCode}`)); return; } try { resolve(JSON.parse(chunks || '{}')); } catch (_) { reject(new Error('diversity-llm-invalid-json')); } });
    });
    req.on('timeout', () => req.destroy(new Error('diversity-llm-timeout'))); req.on('error', reject); req.write(body); req.end();
  });
}

function geminiPayload(payload) {
  return { contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }], generationConfig: { temperature: 0.35, responseMimeType: 'application/json' } };
}

function extractRankedIds(response = {}) {
  const direct = response.rankedTourIds || response.rankedIds || response.routeIds;
  if (Array.isArray(direct)) return direct.map(String);
  const content = response?.choices?.[0]?.message?.content || response?.choices?.[0]?.text || response?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
  if (content) { try { return extractRankedIds(JSON.parse(content)); } catch (_) {} }
  return [];
}

function candidateId(tour, index, query) { return summarizeCandidate(tour, index, query).id; }

function applyRankedIds(tours = [], rankedIds = [], query = {}) {
  const map = new Map(tours.map((tour, index) => [candidateId(tour, index, query), tour]));
  const selected = [];
  for (const id of rankedIds) { const tour = map.get(String(id)); if (tour && !selected.includes(tour)) selected.push(tour); }
  return selected.concat(tours.filter(tour => !selected.includes(tour)));
}

async function selectDiverseRoleCandidate(tours = [], query = {}) {
  const list = Array.isArray(tours) ? tours.filter(Boolean) : [];
  const role = normalizeRole(query.routeRole || query.tourRole || query.pickRole || query.diversityRole || 'best-balance');
  const excludedRouteKeys = parseExcludedRouteKeys(query);
  const diagnostics = { enabled: enabled(query), version: VERSION, role, roleLabel: roleLabel(role), candidateCount: list.length, excludedRouteCount: excludedRouteKeys.length, aiAttempted: false, selectedBy: 'none' };
  if (!list.length) return { tour: null, tours: [], diagnostics };
  if (!enabled(query)) return { tour: null, tours: list, diagnostics: { ...diagnostics, selectedBy: 'feature-disabled' } };

  let ranked = list.slice().sort((a, b) => deterministicRoleScore(b, query, role, excludedRouteKeys) - deterministicRoleScore(a, query, role, excludedRouteKeys) || estimatedTotalUsd(a) - estimatedTotalUsd(b));
  let excludedAll = false;
  const nonExact = ranked.filter(tour => !overlapWithExcluded(tour, excludedRouteKeys).exact);
  if (nonExact.length) ranked = nonExact;
  else excludedAll = excludedRouteKeys.length > 0;

  const limit = Math.max(3, Math.min(Number(process.env.GV_AI_ROUTE_DIVERSITY_CANDIDATE_LIMIT_687B || query.diversityCandidateLimit || 12) || 12, 16));
  const shortlist = ranked.slice(0, limit);
  let llmRankedIds = [];
  let llmError = null;

  // Lowest cost is a factual ranking and is intentionally never delegated to AI.
  if (role !== 'lowest-cost' && llmEnabled(query) && endpoint() && shortlist.length > 1) {
    diagnostics.aiAttempted = true;
    const summaries = shortlist.map((tour, index) => ({
      ...summarizeCandidate(tour, index, query),
      routeKey: routeKey(tour),
      countries: routeCountries(tour),
      overlapWithAlreadyShown: overlapWithExcluded(tour, excludedRouteKeys),
      deterministicDiversityScore: Math.round(deterministicRoleScore(tour, query, role, excludedRouteKeys))
    }));
    const payload = {
      task: 'Select the best Globevoy route for the requested portfolio role. Return candidate IDs only. Never invent a city, route, price, date, airport, hotel, availability claim, or booking status.',
      requestedRole: role,
      requestedRoleMeaning: role === 'best-balance' ? 'best overall balance of budget, comfort, evidence and discovery' : role === 'most-memorable' ? 'most inspiring coherent journey' : role === 'something-different' ? 'most different from routes already shown while still coherent and useful' : 'under-the-radar discovery value without sacrificing route coherence',
      alreadyShownRouteKeys: excludedRouteKeys,
      constraints: [
        'Choose only IDs from candidates.',
        'Avoid routes already shown.',
        'Prefer low city overlap with routes already shown.',
        'Prefer a different country/region/theme when quality is comparable.',
        'Do not override budget, route-feasibility, passport or provider-evidence rules.',
        'A coherent two-city route is better than a random collection of far-apart cities.'
      ],
      candidates: summaries,
      responseSchema: { rankedTourIds: ['candidate-id-1', 'candidate-id-2'], reason: 'short internal note' }
    };
    try {
      const outbound = lower(process.env.GV_LLM_PROVIDER) === 'gemini' ? geminiPayload(payload) : payload;
      const response = await postJson(endpoint(), outbound, headers(), process.env.GV_LLM_ROUTE_CURATOR_TIMEOUT_MS || 2500);
      llmRankedIds = extractRankedIds(response).filter(Boolean);
      if (llmRankedIds.length) ranked = applyRankedIds(shortlist, llmRankedIds, query).concat(ranked.filter(tour => !shortlist.includes(tour)));
    } catch (error) { llmError = error.message || 'diversity-llm-error'; }
  }

  const selected = ranked[0] || list[0];
  const selectedOverlap = overlapWithExcluded(selected, excludedRouteKeys);
  const decorated = {
    ...selected,
    sourceTourRole687B: selected.tourRole || selected.tourRoleLabel || selected.recommendationLabel || null,
    tourRole: role,
    tourRoleLabel: roleLabel(role),
    recommendationLabel: roleLabel(role),
    aiAssistedRouteDiversity687B: {
      version: VERSION,
      role,
      roleLabel: roleLabel(role),
      selectedBy: role === 'lowest-cost' ? 'deterministic-lowest-cost' : (llmRankedIds.length ? 'llm-candidate-id-selection' : 'deterministic-diversity-fallback'),
      routeKey: routeKey(selected),
      excludedRouteCount: excludedRouteKeys.length,
      maxOverlapRatioWithEarlierRoutes: Number(selectedOverlap.maxRatio.toFixed(3)),
      maxSharedStopCountWithEarlierRoutes: selectedOverlap.maxCount,
      thresholdsRelaxed: false,
      aiMayInventTravelFacts: false
    }
  };
  return {
    tour: decorated,
    tours: [decorated],
    diagnostics: {
      ...diagnostics,
      selectedBy: decorated.aiAssistedRouteDiversity687B.selectedBy,
      selectedRouteKey: routeKey(selected),
      selectedOverlap,
      shortlistedCandidateCount: shortlist.length,
      llmReturnedUsableRanking: llmRankedIds.length > 0,
      llmRankedTourIds: llmRankedIds.slice(0, 5),
      llmError,
      allCandidatesWereExactExclusions: excludedAll
    }
  };
}

module.exports = {
  VERSION,
  PREVIEW_ORIGIN_687B,
  PRODUCTION_ORIGIN_687B,
  SUPPORTED_ROLES,
  enabled,
  llmEnabled,
  normalizeRole,
  roleLabel,
  routeKey,
  parseExcludedRouteKeys,
  overlapWithExcluded,
  deterministicRoleScore,
  selectDiverseRoleCandidate,
  _internal: { routeStops, routeCountries, hiddenGemStrength, extractRankedIds, applyRankedIds, estimatedTotalUsd, budgetUsd }
};
