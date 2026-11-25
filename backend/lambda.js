const {
  getRecommendations,
  buildInvalidOriginResponse,
  buildValidationErrorResponse,
  isInvalidOriginError,
  isRecommendationValidationError
} = require('./services/domain/recommendations/recommendations');
const { fetchFlexDateWindows } = require('./services/providers/flights/flexible-dates');
const { fetchFareCalendar } = require('./services/providers/flights/fare-calendar');
const { fetchFlightDates683C, fetchFlightAcrossMonths683C, fetchDuffelShadow683D, duffelStatus683D } = require('./services/providers/flights/flight-provider-router-683c');
const { normalizeAmount683G, normalizeObservation683G, status683G } = require('./services/shared/fx-normalization-683g');
const { simulateTour683H, status683H, seedCandidateStarts683H } = require('./services/providers/flights/duffel/duffel-p2-staging-683h');
const { getGeneratedTour } = require('./services/domain/tours/generated-tour');
const { getBookingLinks: getIgnavBookingLinks, configured: ignavConfigured } = require('./services/providers/flights/ignav/ignav');
const { getGeneratedTourControl } = require('./services/domain/tours/generated-tour-controls');
const { recalculateGeneratedTourDate } = require('./services/domain/tours/generated-tour-dates');
const { evaluateTravelEntryEligibility } = require('./services/domain/eligibility/travel-entry-eligibility');
const { status: duffelSandboxStatus, runProof: runDuffelSandboxProof, DuffelProofValidationError } = require('./services/providers/flights/duffel/duffel-sandbox-proof');
const {
  getMultiCityTours,
  buildValidationErrorResponse: buildMultiCityValidationErrorResponse,
  isMultiCityValidationError
} = require('./services/domain/routing/multicity-routes');
const { getMixedResults } = require('./services/domain/recommendations/mixed-results');
const { registrySummary, searchRegistry } = require('./services/cities/registry/city-registry');
const { coverageSummary, searchCoverage } = require('./services/admin/audits/provider-mapping-audit');
const { snapshotSummary: liveCoverageSummary, searchSnapshot: searchLiveCoverage, verifyBatch: verifyLiveCoverageBatch, isAuthorized: isLiveCoverageAuthorized } = require('./services/admin/audits/provider-live-coverage');
const { summary: verifiedActivationSummary, search: searchVerifiedActivation, retryQueues: verifiedActivationRetryQueues } = require('./services/cities/registry/verified-city-activation');
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

const CORS_ALLOWED_ORIGINS_686D_P1 = new Set([
  'https://globevoy.com',
  'https://686d-preview.dttux5e6ddtzb.amplifyapp.com'
]);

function resolveCorsOrigin686DP1(event = {}) {
  const requestOrigin = headerValue683K(event.headers || {}, 'origin');
  if (requestOrigin) {
    return CORS_ALLOWED_ORIGINS_686D_P1.has(requestOrigin) ? requestOrigin : '';
  }

  // Preserve the existing production header for non-browser requests while
  // refusing any configured value that is outside the explicit allowlist.
  const configuredOrigin = String(process.env.CORS_ORIGIN || '').trim();
  return CORS_ALLOWED_ORIGINS_686D_P1.has(configuredOrigin)
    ? configuredOrigin
    : 'https://globevoy.com';
}

function buildCorsHeaders686DP1(event = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin'
  };
  const allowedOrigin = resolveCorsOrigin686DP1(event);
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

function parseJsonBody(event = {}) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(String(event.body), 'base64').toString('utf8') : String(event.body);
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('Request body is too large.');
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' ? parsed : {};
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
  // Never trust a public query-string copy of the private canary marker.
  delete next.__gvProviderCanary683K;
  const requested = canaryHeaderRequested683K(headers);
  const authorized = requested && isLiveCoverageAuthorized(headers);
  if (authorized) next.__gvProviderCanary683K = 'authorized-production-canary';
  return { query: next, requested, authorized, denied: requested && !authorized };
}

function generatedTourQuery687BP1(query = {}, headers = {}) {
  const next = { ...(query || {}) };
  // Private internal marker: never trust a query-string copy supplied by a browser.
  delete next.__gvRequestOrigin687B;
  next.__gvRequestOrigin687B = headerValue683K(headers, 'origin');
  return next;
}

exports.handler = async function handler(event) {
  // GV-FAREMAP-001: scheduled fare-map refresh (EventBridge), never an HTTP route.
  const fareMapJob = require('./services/domain/fare-map/fare-map-job');
  if (fareMapJob.isFareMapEvent(event) && !event.rawPath && !event.requestContext) return fareMapJob.runFareMapJob();
  const providerCompare = require('./services/domain/live-fares/provider-compare');
  if (providerCompare.isProviderCompareEvent(event)) return providerCompare.runProviderCompare(event);
  const fareMapRoutes = require('./services/domain/fare-map/fare-map-routes-report');
  if (fareMapRoutes.isFareMapRoutesEvent(event)) return fareMapRoutes.runFareMapRoutesReport(event);
  const corsHeaders = () => buildCorsHeaders686DP1(event);
  const path = String(event.rawPath || event.path || '/api/recommendations').split('?')[0];
  const method = String(
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
    event.httpMethod || 'GET'
  ).toUpperCase();
  const query = event.queryStringParameters || {};

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders(),
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-GV-Admin-Token,X-GV-Provider-Canary,Authorization'
      },
      body: ''
    };
  }

  if (path === '/api/flex-windows') {
    if (process.env.GLOBEVOY_FLEX_DATES !== 'true') {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'feature-disabled' }) };
    }
    const routeConfig = FLEX_ROUTE_CONFIG[String(query.routeId || '')];
    if (!routeConfig) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'unsupported-route' }) };
    }
    const month = String(query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'invalid-month' }) };
    }
    try {
      const result = await fetchFlexDateWindows({ ...routeConfig, month });
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (_) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'provider-error' }) };
    }
  }

  if (path === '/api/mixed-results') {
    try {
      const result = await getMixedResults(query);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      if (isInvalidOriginError(error)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify(buildInvalidOriginResponse()) };
      }
      if (isRecommendationValidationError(error)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify(buildValidationErrorResponse(error)) };
      }
      if (isMultiCityValidationError(error)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify(buildMultiCityValidationErrorResponse(error)) };
      }
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: false, error: error.message || 'Mixed results generation failed', singleRecommendations: [], multiCityTours: [] })
      };
    }
  }




  if (path === '/api/remaining-current-city-audit') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    const result = hasQuery ? searchRemainingCurrentAudit(query) : remainingCurrentAuditSummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/current-500-completion-audit') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    const result = hasQuery ? searchCurrent500CompletionAudit(query) : current500CompletionAuditSummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }


  if (path === '/api/expansion-500-priority-audit') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    const result = hasQuery ? searchExpansionPriorityAudit(query) : expansionPriorityAuditSummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/expansion-500-priority-audit-wave2') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.productReviewRequired || query.productReview || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    const result = hasQuery ? searchExpansionPriorityAuditWave2(query) : expansionPriorityAuditWave2Summary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/expansion-500-final-audit') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.group || query.lane || query.auditLane || query.bothProvidersMapped || query.fullyMapped || query.agodaResolved || query.agodaMappingAccepted || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    const result = hasQuery ? searchFinalExpansionAudit(query) : finalExpansionAuditSummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/inactive-city-recovery-wave1') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.region || query.worldRegion || query.tier || query.selectionTier || query.group || query.lane || query.recoveryLane || query.queue || query.retryQueue || query.internationalAirport || query.gateway || query.requiresGatewayTransfer || query.offset || query.limit);
    const result = hasQuery ? searchInactiveRecoveryWave1(query) : inactiveRecoveryWave1Summary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/verified-city-activation') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.countryCode || query.status || query.activation || query.tier || query.queue || query.retryQueue || query.includeEvidence);
    const result = hasQuery ? searchVerifiedActivation(query) : verifiedActivationSummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/verified-city-activation/retry-queues') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(verifiedActivationRetryQueues()) };
  }


  if (path === '/api/provider-p2-latency-status/683m' || path === '/api/provider-p2-latency-status/683m-r4') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    if (!isLiveCoverageAuthorized(event.headers || {})) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'admin-authorization-required' }) };
    }
    const canaryHeaderPresent = canaryHeaderRequested683K(event.headers || {});
    const defaultStatus = status683H(process.env, {});
    const canaryContext = canaryHeaderPresent ? { __gvProviderCanary683K: 'authorized-production-canary' } : {};
    const providerStatus = status683H(process.env, canaryContext);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        version: 'GV-PROVIDER-683M-R4',
        latencyOptimizationStatusOnly: true,
        rateLimitRecoveryStatusOnly: true,
        canaryProtocol: '683K',
        canaryHeaderPresent,
        defaultOffSafe: defaultStatus.normalFlowEnabled === false && defaultStatus.productionCanary683KAuthorized === false,
        canaryRequestSafe: canaryHeaderPresent && providerStatus.productionCanary683KAuthorized === true && providerStatus.normalFlowEnabled === true,
        latencyOptimization683M: providerStatus.latencyOptimization683M || null,
        rateLimitRecovery683MR3: providerStatus.latencyOptimization683M?.rateLimitRecovery683MR3 || null,
      quotaReservationScheduling683MR4: providerStatus.latencyOptimization683M?.quotaReservationScheduling683MR4 || null,
        quotaReservationScheduling683MR4: providerStatus.latencyOptimization683M?.quotaReservationScheduling683MR4 || null,
        defaultStatus,
        providerStatus
      })
    };
  }

  if (path === '/api/provider-p2-canary-status/683k') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    if (!isLiveCoverageAuthorized(event.headers || {})) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'admin-authorization-required' }) };
    }
    const canaryHeaderPresent = canaryHeaderRequested683K(event.headers || {});
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
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        version: 'GV-PROVIDER-683K',
        productionCanaryStatusOnly: true,
        canaryHeaderPresent,
        defaultOffSafe,
        canaryRequestSafe,
        defaultStatus,
        providerStatus
      })
    };
  }

  if (path === '/api/provider-p2-staging-status/683j') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    if (!isLiveCoverageAuthorized(event.headers || {})) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'admin-authorization-required' }) };
    }
    const providerStatus = status683H();
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        version: 'GV-PROVIDER-683J-R2',
        stagingStatusOnly: true,
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
      })
    };
  }

  if (path === '/api/provider-p2-shadow/duffel-683h') {
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'POST required' }) };
    }
    if (!isLiveCoverageAuthorized(event.headers || {})) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'admin-authorization-required' }) };
    }
    try {
      const payload = parseJsonBody(event);
      const requestQuery = payload && payload.query && typeof payload.query === 'object' ? payload.query : payload;
      const baseline = await getGeneratedTour(requestQuery || {});
      if (!baseline?.supported || !baseline?.tour) {
        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: false, shadow: true, providerStatus: status683H(), reason: 'baseline-generated-tour-unavailable', baseline: { supported: Boolean(baseline?.supported), reason: baseline?.reason || null } }) };
      }
      const baselineP2 = baseline?.diagnostics?.wholeTripDateOptimization681BP2 || {};
      const candidateStarts = seedCandidateStarts683H((Array.isArray(baselineP2.candidates) ? baselineP2.candidates : []).map(row => row?.startDate).filter(Boolean), baselineP2.minimumDate || baseline.tour?.legs?.[0]?.departureDate, baselineP2.maximumShiftDays || 14, status683H().candidateCap);
      const simulation = await simulateTour683H({
        tour: baseline.tour,
        query: requestQuery || {},
        candidateStarts,
        baselineFirstLegResult: {},
        displayCurrency: String(requestQuery?.currency || requestQuery?.displayCurrency || baseline?.requested?.currency || 'USD').toUpperCase()
      });
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          ok: Boolean(simulation?.supported),
          shadow: true,
          rankingSimulationOnly: true,
          normalRecommendationChanged: false,
          providerStatus: status683H(),
          baseline: {
            supported: true,
            route: (baseline.tour?.stops || []).map(stop => stop?.city || stop?.name || stop?.airportCode || null).filter(Boolean),
            estimatedTotalUsd: baseline.tour?.estimatedTotalUsd || baseline.tour?.totalEstimateUsd || null,
            p2: baselineP2
          },
          simulation
        })
      };
    } catch (error) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, shadow: true, rankingSimulationOnly: true, error: error.message || '683H P2 shadow simulation failed' }) };
    }
  }

  if (path === '/api/provider-fx-normalize/683g') {
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'POST required' }) };
    }
    if (!isLiveCoverageAuthorized(event.headers || {})) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'admin-authorization-required' }) };
    }
    try {
      const payload = parseJsonBody(event);
      const result = payload && payload.observation
        ? await normalizeObservation683G(payload.observation, payload.displayCurrency || payload.targetCurrency)
        : await normalizeAmount683G(payload);
      return {
        statusCode: result?.supported ? 200 : 400,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: Boolean(result?.supported), shadow: true, fxStatus: status683G(), result })
      };
    } catch (error) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, shadow: true, error: error.message || 'FX normalization failed' }) };
    }
  }

  if (path === '/api/provider-flight-shadow/duffel-683d') {
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'POST required' }) };
    }
    if (!isLiveCoverageAuthorized(event.headers || {})) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'admin-authorization-required' }) };
    }
    try {
      const payload = parseJsonBody(event);
      const result = await fetchDuffelShadow683D(payload);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: Boolean(result?.supported), shadow: true, providerStatus: duffelStatus683D(), result })
      };
    } catch (error) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, shadow: true, error: error.message || 'Duffel shadow search failed' }) };
    }
  }

  if (path === '/api/provider-live-coverage') {
    if (method !== 'GET') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET required' }) };
    }
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.countryCode || query.classification || query.status || query.active || query.productionActive || query.tier);
    const result = hasQuery ? searchLiveCoverage(query) : liveCoverageSummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/provider-live-coverage/verify') {
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'POST required' }) };
    }
    if (!isLiveCoverageAuthorized(event.headers || {})) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'admin-authorization-required' }) };
    }
    try {
      const payload = parseJsonBody(event);
      const result = await verifyLiveCoverageBatch(payload);
      return { statusCode: result.ok ? 200 : 400, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: error.message || 'Live provider coverage verification failed' }) };
    }
  }

  if (path === '/api/provider-coverage') {
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.provider || query.countryCode || query.status || query.mappingType || query.tier || query.unresolved);
    const result = hasQuery ? searchCoverage(query) : coverageSummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/city-registry') {
    const hasQuery = Boolean(String(query.q || query.query || '').trim() || query.mode || query.countryCode || query.tier || query.activation || query.verifiedActivation || query.live || query.productionActive || query.queue || query.retryQueue);
    const result = hasQuery ? searchRegistry(query) : registrySummary();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
  }

  if (path === '/api/duffel-sandbox-proof') {
    if (method === 'GET') {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(duffelSandboxStatus()) };
    }
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'GET or POST required' }) };
    }
    try {
      const body = parseJsonBody(event);
      const result = await runDuffelSandboxProof(body);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      if (error instanceof DuffelProofValidationError) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, version: 'GV-BOOK-676A', error: error.message, code: error.code }) };
      }
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ ok: false, version: 'GV-BOOK-676A', error: error?.message || 'Duffel sandbox proof failed.' }) };
    }
  }

  if (path === '/api/travel-entry-eligibility') {
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'POST required' }) };
    }
    try {
      const body = parseJsonBody(event);
      const result = await evaluateTravelEntryEligibility(body);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      const statusCode = /too large|JSON/i.test(String(error?.message || '')) ? 400 : 500;
      return { statusCode, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: error?.message || 'Travel entry check failed.' }) };
    }
  }

  if (path === '/api/generated-tour') {
    try {
      const canary683K = generatedTourQuery683K(query, event.headers || {});
      if (canary683K.denied) {
        return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: '683k-production-canary-admin-authorization-required' }) };
      }
      const result = await getGeneratedTour(generatedTourQuery687BP1(canary683K.query, event.headers || {}));
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      if (isMultiCityValidationError(error)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify(buildMultiCityValidationErrorResponse(error)) };
      }
      if (isInvalidOriginError(error)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify(buildInvalidOriginResponse()) };
      }
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: error.message || 'Generated tour failed', tour: null, tours: [] }) };
    }
  }

  if (path === '/api/flight-booking-links') {
    // GV-FLIGHT-IGNAV-002: user-click lookup of booking links for one Ignav itinerary.
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'POST required' }) };
    }
    if (!ignavConfigured()) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: false, supported: false, reason: 'feature-disabled', links: [] }) };
    }
    try {
      const payload = parseJsonBody(event);
      const result = await getIgnavBookingLinks(String(payload.ignavId || ''), { proof: payload.bookingProof, ignavAudience: 'booking' });
      return { statusCode: result.ok ? 200 : 400, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (_) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, reason: 'invalid-request', links: [] }) };
    }
  }

  if (path === '/api/generated-tour-date') {
    if (method !== 'POST') {
      return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'POST required' }) };
    }
    try {
      const payload = parseJsonBody(event);
      const result = await recalculateGeneratedTourDate(payload);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: error.message || 'Generated tour date recalculation failed' }) };
    }
  }

  if (path === '/api/generated-tour-control') {
    try {
      const result = await getGeneratedTourControl(query);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      if (isMultiCityValidationError(error)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify(buildMultiCityValidationErrorResponse(error)) };
      }
      if (isInvalidOriginError(error)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify(buildInvalidOriginResponse()) };
      }
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: error.message || 'Generated tour control failed', tour: null, tours: [] }) };
    }
  }

  if (path === '/api/cheap-one-way-flights') {
    if (process.env.ENABLE_CHEAP_ONE_WAY_SCANNER_650A !== 'true') {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'feature-disabled', observations: [] }) };
    }
    try {
      const scannerArgs = {
        origin: String(query.origin || ''),
        destination: String(query.destination || ''),
        currency: String(query.currency || 'CAD'),
        month: String(query.month || ''),
        startMonth: String(query.startMonth || query.month || ''),
        months: String(query.months || ''),
        limit: String(query.limit || '10')
      };
      const result = (query.months || String(process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A || '').trim().toLowerCase() === 'true')
        ? await fetchFlightAcrossMonths683C(scannerArgs)
        : await fetchFlightDates683C(scannerArgs);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (_) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'provider-error', observations: [] }) };
    }
  }

  if (path === '/api/multicity-tours') {
    try {
      const result = await getMultiCityTours(query);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (error) {
      if (isMultiCityValidationError(error)) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify(buildMultiCityValidationErrorResponse(error))
        };
      }
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: false, error: error.message || 'Multi-city route generation failed', tours: [] })
      };
    }
  }

  if (path === '/api/fare-calendar') {
    if (process.env.GLOBEVOY_FARE_CALENDAR !== 'true') {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'feature-disabled', observations: [] }) };
    }
    try {
      const result = await fetchFareCalendar({
        origin: String(query.origin || ''),
        destination: String(query.destination || ''),
        currency: String(query.currency || 'CAD'),
        month: String(query.month || ''),
        nights: String(query.nights || ''),
        minimumLeadDays: String(query.minimumLeadDays || '14')
      });
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
    } catch (_) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ supported: false, reason: 'provider-error', observations: [] }) };
    }
  }

  try {
    const payload = await getRecommendations(query);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(payload)
    };
  } catch (error) {
    if (isInvalidOriginError(error)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify(buildInvalidOriginResponse())
      };
    }
    if (isRecommendationValidationError(error)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify(buildValidationErrorResponse(error))
      };
    }
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: false,
        error: error.message || 'Recommendation request failed'
      })
    };
  }
};

// One event at the public request boundary; internal/provider calls are not wrapped.
exports.handler = require('./services/analytics/search-activity').wrap(exports.handler);
