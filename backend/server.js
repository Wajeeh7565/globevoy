const http = require('http');
const { URL } = require('url');
const {
  getRecommendations,
  buildInvalidOriginResponse,
  buildValidationErrorResponse,
  isInvalidOriginError,
  isRecommendationValidationError
} = require('./recommendations');
const { fetchFlexDateWindows } = require('./services/providers/flights/flexible-dates');
const {
  getMultiCityTours,
  buildValidationErrorResponse: buildMultiCityValidationErrorResponse,
  isMultiCityValidationError
} = require('./multicity-routes');
const { fetchFlightDates683C, fetchFlightAcrossMonths683C, fetchDuffelShadow683D, duffelStatus683D } = require('./services/flight-provider-router-683c');
const { normalizeAmount683G, normalizeObservation683G, status683G } = require('./services/fx-normalization-683g');
const { simulateTour683H, status683H, seedCandidateStarts683H } = require('./services/duffel-p2-staging-683h');
const { getGeneratedTour } = require('./generated-tour');
const { getGeneratedTourControl } = require('./generated-tour-controls');
const { getMixedResults } = require('./mixed-results');
const { registrySummary, searchRegistry } = require('./services/city-registry');
const { coverageSummary, searchCoverage } = require('./services/admin/audits/provider-mapping-audit');
const { snapshotSummary: liveCoverageSummary, searchSnapshot: searchLiveCoverage, verifyBatch: verifyLiveCoverageBatch, isAuthorized: isLiveCoverageAuthorized } = require('./services/admin/audits/provider-live-coverage');
const { summary: verifiedActivationSummary, search: searchVerifiedActivation, retryQueues: verifiedActivationRetryQueues } = require('./services/verified-city-activation');
const { summary: remainingCurrentAuditSummary, search: searchRemainingCurrentAudit } = require('./services/admin/audits/remaining-current-city-audit');
const { summary: current500CompletionAuditSummary, search: searchCurrent500CompletionAudit } = require('./services/admin/audits/current-500-completion-audit');
const { summary: expansionPriorityAuditSummary, search: searchExpansionPriorityAudit } = require('./services/admin/audits/expansion-priority-city-audit');
const { summary: expansionPriorityAuditWave2Summary, search: searchExpansionPriorityAuditWave2 } = require('./services/admin/audits/expansion-priority-city-audit-wave2');
const { summary: finalExpansionAuditSummary, search: searchFinalExpansionAudit } = require('./services/admin/audits/final-expansion-city-audit');
const { summary: inactiveRecoveryWave1Summary, search: searchInactiveRecoveryWave1 } = require('./services/admin/audits/inactive-city-recovery-wave1');

const FLEX_ROUTE_CONFIG = {
  'lisbon-porto':     { originCode: 'YTO', destCode: 'LIS' },
  'rome-florence':    { originCode: 'YTO', destCode: 'ROM' },
  'paris-strasbourg': { originCode: 'NYC', destCode: 'PAR' }
};

const PORT = Number(process.env.PORT || 8787);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-GV-Admin-Token,X-GV-Provider-Canary,Authorization',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function headerValue683K(headers = {}, name = '') {
  const target = String(name || '').trim().toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key || '').trim().toLowerCase() === target) return String(value || '').trim();
  }
  return '';
}

function canaryHeaderRequested683K(headers = {}) {
  return headerValue683K(headers, 'x-gv-provider-canary').toUpperCase() === '683K';
}

function generatedTourQuery683K(query = {}, headers = {}) {
  const next = { ...(query || {}) };
  delete next.__gvProviderCanary683K;
  const requested = canaryHeaderRequested683K(headers);
  const authorized = requested && isLiveCoverageAuthorized(headers);
  if (authorized) next.__gvProviderCanary683K = 'authorized-production-canary';
  return { query: next, requested, authorized, denied: requested && !authorized };
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (_) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'globevoy-api-prototype' });
    return;
  }

  if (url.pathname === '/api/flex-windows') {
    if (process.env.GLOBEVOY_FLEX_DATES !== 'true') {
      sendJson(res, 200, { supported: false, reason: 'feature-disabled' });
      return;
    }
    const routeConfig = FLEX_ROUTE_CONFIG[String(url.searchParams.get('routeId') || '')];
    if (!routeConfig) {
      sendJson(res, 200, { supported: false, reason: 'unsupported-route' });
      return;
    }
    const month = String(url.searchParams.get('month') || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      sendJson(res, 200, { supported: false, reason: 'invalid-month' });
      return;
    }
    try {
      const result = await fetchFlexDateWindows({ ...routeConfig, month });
      sendJson(res, 200, result);
    } catch (_) {
      sendJson(res, 200, { supported: false, reason: 'provider-error' });
    }
    return;
  }

  if (url.pathname === '/api/mixed-results') {
    try {
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = await getMixedResults(query);
      sendJson(res, 200, payload);
    } catch (error) {
      if (isInvalidOriginError(error)) {
        sendJson(res, 400, buildInvalidOriginResponse());
        return;
      }
      if (isRecommendationValidationError(error)) {
        sendJson(res, 400, buildValidationErrorResponse(error));
        return;
      }
      if (isMultiCityValidationError(error)) {
        sendJson(res, 400, buildMultiCityValidationErrorResponse(error));
        return;
      }
      sendJson(res, 500, { ok: false, error: error.message || 'Mixed results generation failed', singleRecommendations: [], multiCityTours: [] });
    }
    return;
  }




  if (url.pathname === '/api/remaining-current-city-audit') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    sendJson(res, 200, hasQuery ? searchRemainingCurrentAudit(query) : remainingCurrentAuditSummary());
    return;
  }

  if (url.pathname === '/api/current-500-completion-audit') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    sendJson(res, 200, hasQuery ? searchCurrent500CompletionAudit(query) : current500CompletionAuditSummary());
    return;
  }


  if (url.pathname === '/api/expansion-500-priority-audit') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    sendJson(res, 200, hasQuery ? searchExpansionPriorityAudit(query) : expansionPriorityAuditSummary());
    return;
  }

  if (url.pathname === '/api/expansion-500-priority-audit-wave2') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    sendJson(res, 200, hasQuery ? searchExpansionPriorityAuditWave2(query) : expansionPriorityAuditWave2Summary());
    return;
  }


  if (url.pathname === '/api/expansion-500-final-audit') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.lane || query.auditLane || query.bothProvidersMapped || query.fullyMapped || query.agodaResolved || query.agodaMappingAccepted || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    sendJson(res, 200, hasQuery ? searchFinalExpansionAudit(query) : finalExpansionAuditSummary());
    return;
  }

  if (url.pathname === '/api/inactive-city-recovery-wave1') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.tier || query.selectionTier || query.group || query.lane || query.recoveryLane || query.queue || query.retryQueue || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    sendJson(res, 200, hasQuery ? searchInactiveRecoveryWave1(query) : inactiveRecoveryWave1Summary());
    return;
  }

  if (url.pathname === '/api/verified-city-activation') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.countryCode || query.status || query.activation || query.tier || query.queue || query.retryQueue || query.includeEvidence);
    sendJson(res, 200, hasQuery ? searchVerifiedActivation(query) : verifiedActivationSummary());
    return;
  }

  if (url.pathname === '/api/verified-city-activation/retry-queues') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    sendJson(res, 200, verifiedActivationRetryQueues());
    return;
  }


  if (url.pathname === '/api/provider-p2-latency-status/683m' || url.pathname === '/api/provider-p2-latency-status/683m-r4') {
    if (req.method !== 'GET') return sendJson(res, 405, { ok:false, error:'GET required' });
    if (!isLiveCoverageAuthorized(req.headers || {})) return sendJson(res, 403, { ok:false, error:'admin-authorization-required' });
    const canaryHeaderPresent = canaryHeaderRequested683K(req.headers || {});
    const defaultStatus = status683H(process.env, {});
    const canaryContext = canaryHeaderPresent ? { __gvProviderCanary683K: 'authorized-production-canary' } : {};
    const providerStatus = status683H(process.env, canaryContext);
    return sendJson(res, 200, {
      ok:true,
      version:'GV-PROVIDER-683M-R4',
      latencyOptimizationStatusOnly:true,
      rateLimitRecoveryStatusOnly:true,
      canaryProtocol:'683K',
      canaryHeaderPresent,
      defaultOffSafe: defaultStatus.normalFlowEnabled === false && defaultStatus.productionCanary683KAuthorized === false,
      canaryRequestSafe: canaryHeaderPresent && providerStatus.productionCanary683KAuthorized === true && providerStatus.normalFlowEnabled === true,
      latencyOptimization683M: providerStatus.latencyOptimization683M || null,
      rateLimitRecovery683MR3: providerStatus.latencyOptimization683M?.rateLimitRecovery683MR3 || null,
      quotaReservationScheduling683MR4: providerStatus.latencyOptimization683M?.quotaReservationScheduling683MR4 || null,
      defaultStatus,
      providerStatus
    });
  }

  if (url.pathname === '/api/provider-p2-canary-status/683k') {
    if (req.method !== 'GET') return sendJson(res, 405, { ok:false, error:'GET required' });
    if (!isLiveCoverageAuthorized(req.headers || {})) return sendJson(res, 403, { ok:false, error:'admin-authorization-required' });
    const canaryHeaderPresent = canaryHeaderRequested683K(req.headers || {});
    const defaultStatus = status683H(process.env, {});
    const canaryContext = canaryHeaderPresent ? { __gvProviderCanary683K: 'authorized-production-canary' } : {};
    const providerStatus = status683H(process.env, canaryContext);
    const defaultOffSafe = defaultStatus.normalFlowEnabled === false
      && defaultStatus.productionCanary683KAuthorized === false
      && defaultStatus.productionApproved === false;
    const canaryRequestSafe = canaryHeaderPresent
      && providerStatus.productionCanary683KAuthorized === true
      && providerStatus.normalFlowEnabled === true
      && providerStatus.rankingScope === 'P2-production-canary-request-only-683k'
      && providerStatus.productionApproved === false
      && providerStatus.orderCapability === false
      && providerStatus.paymentCapability === false
      && providerStatus.bookingCapability === false
      && providerStatus.ticketingCapability === false;
    return sendJson(res, 200, {
      ok:true,
      version:'GV-PROVIDER-683K',
      productionCanaryStatusOnly:true,
      canaryHeaderPresent,
      defaultOffSafe,
      canaryRequestSafe,
      defaultStatus,
      providerStatus
    });
  }

  if (url.pathname === '/api/provider-p2-staging-status/683j') {
    if (req.method !== 'GET') return sendJson(res, 405, { ok:false, error:'GET required' });
    if (!isLiveCoverageAuthorized(req.headers || {})) return sendJson(res, 403, { ok:false, error:'admin-authorization-required' });
    const providerStatus = status683H();
    return sendJson(res, 200, {
      ok:true,
      version:'GV-PROVIDER-683J-R2',
      stagingStatusOnly:true,
      providerStatus,
      activationSafe: providerStatus.runtimeEnvironment === 'staging'
        && providerStatus.stagingRuntimeConfirmed === true
        && providerStatus.activation683J === true
        && providerStatus.explicitEnableFlag === true
        && providerStatus.stagingAcknowledgement === true
        && providerStatus.normalFlowEnabled === true
        && providerStatus.productionApproved === false
        && providerStatus.orderCapability === false
        && providerStatus.paymentCapability === false
        && providerStatus.bookingCapability === false
        && providerStatus.ticketingCapability === false
    });
  }

  if (url.pathname === '/api/provider-p2-shadow/duffel-683h') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'POST required' });
      return;
    }
    if (!isLiveCoverageAuthorized(req.headers || {})) {
      sendJson(res, 403, { ok: false, error: 'admin-authorization-required' });
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const requestQuery = payload && payload.query && typeof payload.query === 'object' ? payload.query : payload;
      const baseline = await getGeneratedTour(requestQuery || {});
      if (!baseline?.supported || !baseline?.tour) {
        sendJson(res, 200, { ok: false, shadow: true, providerStatus: status683H(), reason: 'baseline-generated-tour-unavailable', baseline: { supported: Boolean(baseline?.supported), reason: baseline?.reason || null } });
        return;
      }
      const baselineP2 = baseline?.diagnostics?.wholeTripDateOptimization681BP2 || {};
      const candidateStarts = seedCandidateStarts683H((Array.isArray(baselineP2.candidates) ? baselineP2.candidates : []).map(row => row?.startDate).filter(Boolean), baselineP2.minimumDate || baseline.tour?.legs?.[0]?.departureDate, baselineP2.maximumShiftDays || 14, status683H().candidateCap);
      const simulation = await simulateTour683H({ tour: baseline.tour, query: requestQuery || {}, candidateStarts, baselineFirstLegResult: {}, displayCurrency: String(requestQuery?.currency || requestQuery?.displayCurrency || baseline?.requested?.currency || 'USD').toUpperCase() });
      sendJson(res, 200, { ok: Boolean(simulation?.supported), shadow: true, rankingSimulationOnly: true, normalRecommendationChanged: false, providerStatus: status683H(), baseline: { supported: true, route: (baseline.tour?.stops || []).map(stop => stop?.city || stop?.name || stop?.airportCode || null).filter(Boolean), estimatedTotalUsd: baseline.tour?.estimatedTotalUsd || baseline.tour?.totalEstimateUsd || null, p2: baselineP2 }, simulation });
    } catch (error) {
      sendJson(res, 400, { ok: false, shadow: true, rankingSimulationOnly: true, error: error.message || '683H P2 shadow simulation failed' });
    }
    return;
  }

  if (url.pathname === '/api/provider-fx-normalize/683g') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'POST required' });
      return;
    }
    if (!isLiveCoverageAuthorized(req.headers || {})) {
      sendJson(res, 403, { ok: false, error: 'admin-authorization-required' });
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const result = payload && payload.observation
        ? await normalizeObservation683G(payload.observation, payload.displayCurrency || payload.targetCurrency)
        : await normalizeAmount683G(payload);
      sendJson(res, result?.supported ? 200 : 400, { ok: Boolean(result?.supported), shadow: true, fxStatus: status683G(), result });
    } catch (error) {
      sendJson(res, 400, { ok: false, shadow: true, error: error.message || 'FX normalization failed' });
    }
    return;
  }

  if (url.pathname === '/api/provider-flight-shadow/duffel-683d') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'POST required' });
      return;
    }
    if (!isLiveCoverageAuthorized(req.headers || {})) {
      sendJson(res, 403, { ok: false, error: 'admin-authorization-required' });
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const result = await fetchDuffelShadow683D(payload);
      sendJson(res, 200, { ok: Boolean(result?.supported), shadow: true, providerStatus: duffelStatus683D(), result });
    } catch (error) {
      sendJson(res, 400, { ok: false, shadow: true, error: error.message || 'Duffel shadow search failed' });
    }
    return;
  }

  if (url.pathname === '/api/provider-live-coverage') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'GET required' });
      return;
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.countryCode || query.classification || query.status || query.active || query.productionActive || query.tier);
    sendJson(res, 200, hasQuery ? searchLiveCoverage(query) : liveCoverageSummary());
    return;
  }

  if (url.pathname === '/api/provider-live-coverage/verify') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'POST required' });
      return;
    }
    if (!isLiveCoverageAuthorized(req.headers || {})) {
      sendJson(res, 403, { ok: false, error: 'admin-authorization-required' });
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const result = await verifyLiveCoverageBatch(payload);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Live provider coverage verification failed' });
    }
    return;
  }

  if (url.pathname === '/api/provider-coverage') {
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.provider || query.countryCode || query.status || query.mappingType || query.tier || query.unresolved);
    sendJson(res, 200, hasQuery ? searchCoverage(query) : coverageSummary());
    return;
  }

  if (url.pathname === '/api/city-registry') {
    const query = Object.fromEntries(url.searchParams.entries());
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.mode || query.countryCode || query.tier || query.activation || query.verifiedActivation || query.live || query.productionActive || query.queue || query.retryQueue);
    sendJson(res, 200, hasQuery ? searchRegistry(query) : registrySummary());
    return;
  }

  if (url.pathname === '/api/generated-tour') {
    try {
      const query = Object.fromEntries(url.searchParams.entries());
      const canary683K = generatedTourQuery683K(query, req.headers || {});
      if (canary683K.denied) return sendJson(res, 403, { ok:false, error:'683k-production-canary-admin-authorization-required' });
      const payload = await getGeneratedTour(canary683K.query);
      sendJson(res, 200, payload);
    } catch (error) {
      if (isMultiCityValidationError(error)) {
        sendJson(res, 400, buildMultiCityValidationErrorResponse(error));
        return;
      }
      sendJson(res, 500, { ok: false, error: error.message || 'Generated tour failed', tour: null, tours: [] });
    }
    return;
  }

  if (url.pathname === '/api/generated-tour-control') {
    try {
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = await getGeneratedTourControl(query);
      sendJson(res, 200, payload);
    } catch (error) {
      if (isMultiCityValidationError(error)) {
        sendJson(res, 400, buildMultiCityValidationErrorResponse(error));
        return;
      }
      sendJson(res, 500, { ok: false, error: error.message || 'Generated tour control failed', tour: null, tours: [] });
    }
    return;
  }

  if (url.pathname === '/api/cheap-one-way-flights') {
    if (process.env.ENABLE_CHEAP_ONE_WAY_SCANNER_650A !== 'true') {
      sendJson(res, 200, { supported: false, reason: 'feature-disabled', observations: [] });
      return;
    }
    try {
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = (query.months || String(process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A || '').trim().toLowerCase() === 'true')
        ? await fetchFlightAcrossMonths683C(query)
        : await fetchFlightDates683C(query);
      sendJson(res, 200, payload);
    } catch (_) {
      sendJson(res, 200, { supported: false, reason: 'provider-error', observations: [] });
    }
    return;
  }

  if (url.pathname === '/api/multicity-tours') {
    try {
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = await getMultiCityTours(query);
      sendJson(res, 200, payload);
    } catch (error) {
      if (isMultiCityValidationError(error)) {
        sendJson(res, 400, buildMultiCityValidationErrorResponse(error));
        return;
      }
      sendJson(res, 500, { ok: false, error: error.message || 'Multi-city route generation failed', tours: [] });
    }
    return;
  }

  if (url.pathname !== '/api/recommendations') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    const query = Object.fromEntries(url.searchParams.entries());
    const payload = await getRecommendations(query);
    sendJson(res, 200, payload);
  } catch (error) {
    if (isInvalidOriginError(error)) {
      sendJson(res, 400, buildInvalidOriginResponse());
      return;
    }

    if (isRecommendationValidationError(error)) {
      sendJson(res, 400, buildValidationErrorResponse(error));
      return;
    }

    sendJson(res, 500, {
      ok: false,
      error: error.message || 'Recommendation request failed'
    });
  }
});

server.listen(PORT, () => {
  console.log(`Globevoy API prototype listening on port ${PORT}`);
});
