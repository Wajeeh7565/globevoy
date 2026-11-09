'use strict';

const { getRecommendations } = require('./recommendations');
const { getMultiCityTours } = require('../routing/multicity-routes');
const { presentationPolicy } = require('../pricing/budget-presentation');

const MIXED_RESULTS_VERSION = '1.0.1-gv-mixed-610c-route-620a';

function isMixedResults610CEnabled() {
  return String(process.env.ENABLE_MIXED_RESULTS_610C || '').trim().toLowerCase() === 'true';
}

function disabledResponse() {
  return {
    ok: false,
    supported: false,
    version: MIXED_RESULTS_VERSION,
    reason: 'feature-disabled',
    requiredFlag: 'ENABLE_MIXED_RESULTS_610C=true',
    singleRecommendations: [],
    multiCityTours: []
  };
}

function integerOr(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function allEquationsConsistent(items) {
  return items.every(item => item?.displayBudget?.equation?.consistent === true);
}

async function getMixedResults(query = {}) {
  if (!isMixedResults610CEnabled()) return disabledResponse();

  const singleQuery = {
    ...query,
    limit: query.singleLimit ?? query.limit ?? 30
  };
  const adaptiveEnabled = String(process.env.ENABLE_BUDGET_ADAPTIVE_ROUTES_620A || '').trim().toLowerCase() === 'true';
  const explicitRouteNights = query.multiTotalNights ?? query.routeNights;
  const multiQuery = adaptiveEnabled
    ? {
        ...query,
        ...(explicitRouteNights !== undefined ? { totalNights: explicitRouteNights } : {}),
        adaptiveDuration: explicitRouteNights === undefined ? 'true' : 'false',
        maxStops: query.multiMaxStops ?? query.maxStops ?? 3
      }
    : {
        ...query,
        totalNights: explicitRouteNights ?? 8,
        maxStops: query.multiMaxStops ?? query.maxStops ?? 3
      };

  const [single, multi] = await Promise.all([
    getRecommendations(singleQuery),
    getMultiCityTours(multiQuery)
  ]);

  const singleRecommendations = single.recommendations || [];
  const multiCityTours = multi.tours || [];

  return {
    ok: true,
    supported: true,
    version: MIXED_RESULTS_VERSION,
    servedAt: new Date().toISOString(),
    requested: {
      origin: single.requested?.origin || multi.requested?.origin || null,
      displayBudget: single.requested?.displayBudget || multi.requested?.displayBudget || null,
      singleNights: single.requested?.nights || integerOr(query.nights, 5),
      multiTotalNights: multi.requested?.totalNights || integerOr(multiQuery.totalNights, 8),
      multiMaxStops: multi.requested?.maxStops || integerOr(multiQuery.maxStops, 3)
    },
    presentationPolicy: presentationPolicy(),
    singleRecommendations,
    multiCityTours,
    multiCityStatus: multi.supported === false ? multi.reason : (multiCityTours.length ? 'available' : 'no-feasible-tour'),
    noFeasibleMultiCityTour: multi.noFeasibleTour || null,
    consistencyDiagnostics: {
      singleCardCount: singleRecommendations.length,
      multiCityCardCount: multiCityTours.length,
      singleEquationsConsistent: allEquationsConsistent(singleRecommendations),
      multiCityEquationsConsistent: allEquationsConsistent(multiCityTours),
      allCardEquationsConsistent: allEquationsConsistent([...singleRecommendations, ...multiCityTours])
    },
    sourceVersions: {
      recommendations: single.version,
      multiCity: multi.version
    }
  };
}

module.exports = {
  MIXED_RESULTS_VERSION,
  isMixedResults610CEnabled,
  disabledResponse,
  getMixedResults
};
